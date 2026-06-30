/**
 * sim-ledger-backfill.ts — F-AUTO SIM Continuous Ledger Backfill Engine
 *
 * 楊董 ACK 2026-07-01: 建帳本+回補 6/2 起 (Phase 1 dry-run)
 *
 * Purpose:
 *   Reads the 5-week basket history from audit_logs, fetches PIT closing
 *   prices via FinMind API, and computes a continuous NAV curve as if the
 *   F-AUTO SIM had been trading a rolling equity account (not a weekly reset).
 *
 * Hard lines:
 *   - SIM-ONLY: no real-money writes. No broker interaction.
 *   - PIT-strict: entry/exit prices are from the SAME TUESDAY as the
 *     basket generation date. No look-ahead.
 *   - DRY-RUN default: set DRY_RUN=false to persist to sim_ledger_* tables.
 *   - No automatic execution from server.ts — must be triggered manually.
 *
 * Assumptions (楊董 must audit before Phase 2):
 *   A1. Assumed execution price = Tuesday closing price (PIT close, not basket latest_price)
 *   A2. No transaction costs (no brokerage fee, no securities tax)
 *   A3. All 8 positions per week: assumed fully filled at Tuesday close regardless of KGI SIM status
 *   A4. 6/23 week (accepted=0): treated same as other weeks (consistent audit-rebuild logic)
 *   A5. 5348 trading halt days (close=0): use last known good close via walk-back
 *   A6. 1435 (sparse data before 6/18): price from FinMind; entry 6/30 at 27.35
 *   A7. 50% exposure (exposure_weight=0.5): capital_twd=10M, ~4.5M deployed, ~5.5M cash
 *   A8. Cash residual = equity - actual_basket_cost (mark-to-market each day)
 *   A9. No daily compounding or reinvestment of dividends
 *   A10. 5/20-5/31: no data — ledger starts 6/2 (PIT honest)
 */

import { getDb, isDatabaseMode } from "@iuf-trading-room/db";
import { sql as drizzleSql } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────────

export interface LedgerBasketEntry {
  symbol: string;
  shares: number;
}

export interface LedgerWeekResult {
  weekNum: number;
  basketDate: string;           // YYYY-MM-DD
  initialEquity: number;
  basketCostTwd: number;
  cashResidualTwd: number;
  realizedPnlTwd: number | null; // null = week 1 (first entry)
  equityAfterTwd: number;
  positions: Array<{
    symbol: string;
    shares: number;
    entryPrice: number;
    entrySource: string;
    exitPrice: number | null;
    exitDate: string | null;
    realizedPnl: number | null;
  }>;
}

export interface LedgerNavPoint {
  navDate: string;              // YYYY-MM-DD
  equityTwd: number;
  returnPct: number;
  weekNum: number;
  source: "backfill_dry_run" | "live_eod";
}

export interface BackfillResult {
  initialEquity: number;
  weeks: LedgerWeekResult[];
  navCurve: LedgerNavPoint[];
  totalRealizedPnl: number;
  finalEquity: number;
  cumulativeReturnPct: number;
  assumptions: string[];
  priceDataWarnings: string[];
}

// ── PIT price source: FinMind TaiwanStockPrice ─────────────────────────────

const FINMIND_TOKEN = process.env["FINMIND_API_TOKEN"] ?? "";

async function fetchFinMindPrices(
  symbols: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, Map<string, number>>> {
  // Returns: symbol -> date (YYYY-MM-DD) -> close price
  const result = new Map<string, Map<string, number>>();
  const warnings: string[] = [];

  for (const symbol of symbols) {
    const url = new URL("https://api.finmindtrade.com/api/v4/data");
    url.searchParams.set("dataset", "TaiwanStockPrice");
    url.searchParams.set("data_id", symbol);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("token", FINMIND_TOKEN);

    try {
      const resp = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "IUF-LedgerBackfill/1.0" },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const raw = (await resp.json()) as { data?: Array<{ date: string; close: number }> };
      const dateMap = new Map<string, number>();
      for (const row of raw.data ?? []) {
        if (row.close > 0) dateMap.set(row.date, row.close);
      }
      result.set(symbol, dateMap);
    } catch (e) {
      warnings.push(`FinMind fetch failed for ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
      result.set(symbol, new Map());
    }

    await new Promise((r) => setTimeout(r, 150)); // rate-limit friendly
  }

  return result;
}

/** Walk back through available dates to find last known close > 0 (PIT-safe) */
function getPitClose(
  priceMap: Map<string, Map<string, number>>,
  symbol: string,
  date: string,
): { price: number; source: string } | null {
  const dateMap = priceMap.get(symbol);
  if (!dateMap) return null;

  const direct = dateMap.get(date);
  if (direct && direct > 0) return { price: direct, source: "finmind_close" };

  // Walk back: find most recent date <= target with valid close
  const sorted = [...dateMap.keys()].sort();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = sorted[i]!;
    if (d <= date && (dateMap.get(d) ?? 0) > 0) {
      return { price: dateMap.get(d)!, source: `finmind_close_walkback_from_${d}` };
    }
  }
  return null;
}

// ── Basket loader from audit_logs ──────────────────────────────────────────

export async function loadBasketsFromAuditLogs(
  workspaceId?: string,
): Promise<Map<string, LedgerBasketEntry[]>> {
  const db = getDb();
  if (!db || !isDatabaseMode()) {
    throw new Error("Database mode required for basket loading");
  }

  const wsFilter = workspaceId
    ? drizzleSql`AND workspace_id = ${workspaceId}::uuid`
    : drizzleSql``;

  const rows = await db.execute(drizzleSql`
    SELECT
      DATE(created_at AT TIME ZONE 'Asia/Taipei') AS basket_date,
      payload
    FROM audit_logs
    WHERE action = 's1_sim.signal_generated'
      ${wsFilter}
    ORDER BY created_at ASC
  `);

  const result = new Map<string, LedgerBasketEntry[]>();
  for (const row of rows as unknown as Array<{ basket_date: string; payload: Record<string, unknown> }>) {
    const payload = row.payload;
    const basketData = (payload["data"] as Record<string, unknown>) ?? payload;
    const basket = (basketData["basket"] as Array<{ symbol: string; target_shares: number }>) ?? [];
    const dateKey = String(row.basket_date).slice(0, 10);
    if (!result.has(dateKey) && basket.length > 0) {
      result.set(dateKey, basket.map((e) => ({ symbol: e.symbol, shares: e.target_shares })));
    }
  }
  return result;
}

// ── Core backfill computation ──────────────────────────────────────────────

const TAIWAN_TRADING_DAYS_JUN2026 = [
  "2026-06-02","2026-06-03","2026-06-04","2026-06-05",
  "2026-06-08","2026-06-09","2026-06-10","2026-06-11","2026-06-12",
  "2026-06-15","2026-06-16","2026-06-17","2026-06-18",
  "2026-06-22","2026-06-23","2026-06-24","2026-06-25","2026-06-26",
  "2026-06-29","2026-06-30",
];

export async function runBackfill(options: {
  dryRun?: boolean;
  startDate?: string;
  rebalanceDates?: string[];
  initialEquity?: number;
  workspaceId?: string;
}): Promise<BackfillResult> {
  const {
    dryRun = true,
    startDate = "2026-06-01",
    rebalanceDates = ["2026-06-02","2026-06-09","2026-06-16","2026-06-23","2026-06-30"],
    initialEquity = 10_000_000,
    workspaceId,
  } = options;

  const assumptions = [
    "A1: Assumed execution price = Tuesday closing price (FinMind TaiwanStockPrice close, PIT)",
    "A2: No transaction costs (zero brokerage fee, zero securities transaction tax)",
    "A3: All 8 positions assumed fully filled at Tuesday close regardless of KGI SIM status",
    "A4: 6/23 week (accepted=0 in KGI SIM): treated same as other weeks (audit-rebuild consistency)",
    "A5: 5348 trading halt days (close=0): walk back to last known good close",
    "A6: 1435 sparse data pre-6/18: FinMind data available from 6/9 onward; entry 6/30 at 27.35",
    "A7: Cash residual = equity - actual basket cost at entry close price",
    "A8: 5/20-5/31 no data — ledger starts 6/2 (PIT honest, no fabrication)",
    "A9: FinMind TaiwanStockPrice dataset covers both TWSE (上市) and TPEX (上櫃) stocks",
    "A10: Odd-lot shares not normalized (basket target_shares already in trading units)",
  ];

  const priceWarnings: string[] = [];

  // Step 1: Load baskets from DB or use hardcoded fallback for dry-run
  let basketMap: Map<string, LedgerBasketEntry[]>;
  try {
    basketMap = await loadBasketsFromAuditLogs(workspaceId);
  } catch {
    priceWarnings.push("DB unavailable — using hardcoded basket data from 2026-07-01 dry-run");
    basketMap = getHardcodedBaskets();
  }

  // Step 2: Collect all unique symbols
  const allSymbols = new Set<string>();
  for (const entries of basketMap.values()) {
    for (const e of entries) allSymbols.add(e.symbol);
  }

  // Step 3: Fetch PIT close prices from FinMind
  const endDate = rebalanceDates[rebalanceDates.length - 1] ?? "2026-06-30";
  const priceMap = await fetchFinMindPrices([...allSymbols], startDate, endDate);

  // Step 4: Roll through each rebalance cycle
  let equity = initialEquity;
  const weeks: LedgerWeekResult[] = [];
  let prevBasket: LedgerBasketEntry[] = [];
  let prevEntryPrices = new Map<string, number>();
  let prevCost = 0;
  let prevCash = 0;

  for (let i = 0; i < rebalanceDates.length; i++) {
    const rbDate = rebalanceDates[i]!;
    const basket = basketMap.get(rbDate) ?? [];

    // Compute entry prices (PIT close on basket date)
    const entryPrices = new Map<string, number>();
    const positionDetails: LedgerWeekResult["positions"] = [];

    for (const pos of basket) {
      const priceResult = getPitClose(priceMap, pos.symbol, rbDate);
      if (!priceResult) {
        priceWarnings.push(`No PIT close for ${pos.symbol} on ${rbDate} — position omitted from cost`);
        entryPrices.set(pos.symbol, 0);
      } else {
        entryPrices.set(pos.symbol, priceResult.price);
      }
    }

    const actualCost = basket.reduce((s, p) => s + p.shares * (entryPrices.get(p.symbol) ?? 0), 0);

    // Compute realized PnL from exiting previous basket
    let realizedPnl: number | null = null;
    if (i > 0 && prevBasket.length > 0) {
      let exitTotal = 0;
      for (const pos of prevBasket) {
        const exitResult = getPitClose(priceMap, pos.symbol, rbDate);
        const exitPrice = exitResult?.price ?? prevEntryPrices.get(pos.symbol) ?? 0;
        exitTotal += pos.shares * exitPrice;
        const entryPrice = prevEntryPrices.get(pos.symbol) ?? 0;
        const pnl = (exitPrice - entryPrice) * pos.shares;
        positionDetails.push({
          symbol: pos.symbol,
          shares: pos.shares,
          entryPrice,
          entrySource: "finmind_close",
          exitPrice,
          exitDate: rbDate,
          realizedPnl: Math.round(pnl),
        });
      }
      realizedPnl = Math.round(exitTotal - prevCost);
      equity = Math.round(prevCash + exitTotal);
    }

    // Add current week's open positions (no exit yet)
    for (const pos of basket) {
      positionDetails.push({
        symbol: pos.symbol,
        shares: pos.shares,
        entryPrice: entryPrices.get(pos.symbol) ?? 0,
        entrySource: "finmind_close",
        exitPrice: null,
        exitDate: null,
        realizedPnl: null,
      });
    }

    const cashResidual = Math.round(equity - actualCost);

    weeks.push({
      weekNum: i + 1,
      basketDate: rbDate,
      initialEquity,
      basketCostTwd: Math.round(actualCost),
      cashResidualTwd: cashResidual,
      realizedPnlTwd: realizedPnl,
      equityAfterTwd: equity,
      positions: positionDetails,
    });

    prevBasket = basket;
    prevEntryPrices = entryPrices;
    prevCost = actualCost;
    prevCash = cashResidual;
  }

  // Step 5: Build daily NAV curve
  const navCurve: LedgerNavPoint[] = [];
  const tradingDays = TAIWAN_TRADING_DAYS_JUN2026.filter(
    (d) => d >= (rebalanceDates[0] ?? "2026-06-02") && d <= endDate
  );

  for (const day of tradingDays) {
    // Find which week we're in
    let weekIdx = 0;
    for (let j = 0; j < rebalanceDates.length; j++) {
      if (day >= rebalanceDates[j]!) weekIdx = j;
    }
    const week = weeks[weekIdx]!;
    const basket = basketMap.get(rebalanceDates[weekIdx]!) ?? [];

    let mv = 0;
    for (const pos of basket) {
      const priceResult = getPitClose(priceMap, pos.symbol, day);
      if (priceResult) mv += priceResult.price * pos.shares;
    }
    const nav = Math.round(week.cashResidualTwd + mv);
    const returnPct = ((nav - initialEquity) / initialEquity) * 100;

    navCurve.push({
      navDate: day,
      equityTwd: nav,
      returnPct: Math.round(returnPct * 10000) / 10000,
      weekNum: weekIdx + 1,
      source: "backfill_dry_run",
    });
  }

  // Step 6: Final summary
  const lastNav = navCurve[navCurve.length - 1];
  const finalEquity = lastNav?.equityTwd ?? equity;
  const cumulativeReturnPct = ((finalEquity - initialEquity) / initialEquity) * 100;
  const totalRealizedPnl = weeks
    .filter((w) => w.realizedPnlTwd !== null)
    .reduce((s, w) => s + (w.realizedPnlTwd ?? 0), 0);

  // Step 7: Persist if not dry-run
  if (!dryRun && isDatabaseMode()) {
    await persistBackfillResults({ weeks, navCurve });
  }

  return {
    initialEquity,
    weeks,
    navCurve,
    totalRealizedPnl,
    finalEquity,
    cumulativeReturnPct: Math.round(cumulativeReturnPct * 10000) / 10000,
    assumptions,
    priceDataWarnings: priceWarnings,
  };
}

// ── DB persistence (Phase 2) ───────────────────────────────────────────────

async function persistBackfillResults(data: {
  weeks: LedgerWeekResult[];
  navCurve: LedgerNavPoint[];
}): Promise<void> {
  const db = getDb();
  if (!db) return;

  for (const w of data.weeks) {
    await db.execute(drizzleSql`
      INSERT INTO sim_ledger_weeks
        (week_num, basket_date, initial_equity, basket_cost_twd,
         cash_residual_twd, realized_pnl_twd, equity_after_twd, source)
      VALUES
        (${w.weekNum}, ${w.basketDate}::date, ${w.initialEquity},
         ${w.basketCostTwd}, ${w.cashResidualTwd}, ${w.realizedPnlTwd ?? null},
         ${w.equityAfterTwd}, 'backfill_dry_run')
      ON CONFLICT (basket_date, source) DO UPDATE SET
        realized_pnl_twd = EXCLUDED.realized_pnl_twd,
        equity_after_twd = EXCLUDED.equity_after_twd,
        cash_residual_twd = EXCLUDED.cash_residual_twd,
        updated_at = NOW()
    `);

    for (const pos of w.positions) {
      if (pos.exitDate !== null) {
        await db.execute(drizzleSql`
          INSERT INTO sim_ledger_holdings
            (week_num, basket_date, symbol, shares, entry_price_twd,
             exit_price_twd, exit_date, realized_pnl_twd, entry_source, exit_source)
          VALUES
            (${w.weekNum - 1}, ${pos.exitDate}::date, ${pos.symbol}, ${pos.shares},
             ${pos.entryPrice}, ${pos.exitPrice}, ${pos.exitDate}::date,
             ${pos.realizedPnl}, 'finmind_close', 'finmind_close')
          ON CONFLICT (basket_date, symbol) DO UPDATE SET
            exit_price_twd = EXCLUDED.exit_price_twd,
            realized_pnl_twd = EXCLUDED.realized_pnl_twd
        `);
      }
    }
  }

  for (const nav of data.navCurve) {
    await db.execute(drizzleSql`
      INSERT INTO sim_ledger_nav
        (nav_date, equity_twd, initial_equity, return_pct, week_num, source)
      VALUES
        (${nav.navDate}::date, ${nav.equityTwd}, 10000000, ${nav.returnPct},
         ${nav.weekNum}, 'backfill_dry_run')
      ON CONFLICT (nav_date, source) DO UPDATE SET
        equity_twd = EXCLUDED.equity_twd,
        return_pct = EXCLUDED.return_pct
    `);
  }
}

// ── Hardcoded basket fallback (from prod API 2026-07-01 dry-run) ───────────

function getHardcodedBaskets(): Map<string, LedgerBasketEntry[]> {
  return new Map([
    ["2026-06-02", [
      {sym:"3191",shares:25000},{sym:"2492",shares:1000},{sym:"1568",shares:12000},
      {sym:"1563",shares:8000},{sym:"3481",shares:11000},{sym:"1530",shares:18000},
      {sym:"3537",shares:7000},{sym:"2302",shares:16000},
    ].map(e=>({symbol:e.sym,shares:e.shares}))],
    ["2026-06-09", [
      {sym:"5701",shares:101000},{sym:"5426",shares:18000},{sym:"8454",shares:1000},
      {sym:"3114",shares:13000},{sym:"1718",shares:62000},{sym:"6890",shares:2000},
      {sym:"2492",shares:1000},{sym:"3021",shares:7000},
    ].map(e=>({symbol:e.sym,shares:e.shares}))],
    ["2026-06-16", [
      {sym:"6173",shares:2000},{sym:"2478",shares:3000},{sym:"1714",shares:37000},
      {sym:"5345",shares:6000},{sym:"8042",shares:3000},{sym:"2483",shares:16000},
      {sym:"4939",shares:8000},{sym:"2484",shares:8000},
    ].map(e=>({symbol:e.sym,shares:e.shares}))],
    ["2026-06-23", [
      {sym:"5468",shares:18000},{sym:"2492",shares:1000},{sym:"6654",shares:2000},
      {sym:"2061",shares:10000},{sym:"3285",shares:12000},{sym:"5227",shares:14000},
      {sym:"3624",shares:3000},{sym:"6449",shares:1000},
    ].map(e=>({symbol:e.sym,shares:e.shares}))],
    ["2026-06-30", [
      {sym:"1435",shares:6000},{sym:"2483",shares:11000},{sym:"6226",shares:31000},
      {sym:"4716",shares:26000},{sym:"5489",shares:10000},{sym:"4707",shares:20000},
      {sym:"5348",shares:13000},{sym:"3230",shares:14000},
    ].map(e=>({symbol:e.sym,shares:e.shares}))],
  ]);
}

// ── Exports for testing ────────────────────────────────────────────────────

export const _getPitCloseForTest = getPitClose;
export const _getHardcodedBasketsForTest = getHardcodedBaskets;
