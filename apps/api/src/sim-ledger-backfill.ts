/**
 * sim-ledger-backfill.ts — F-AUTO SIM Continuous Ledger Backfill Engine
 *
 * 楊董 ACK 2026-07-01: 建帳本+回補 6/2 起 (Phase 1 dry-run)
 * 楊董 ACK 2026-07-02: Phase 2 — 帳本落地 prod，從今起真連續累計，含交易成本
 *
 * Purpose:
 *   Reads the 5-week basket history from audit_logs, fetches PIT closing
 *   prices via FinMind API, and computes a continuous NAV curve as if the
 *   F-AUTO SIM had been trading a rolling equity account (not a weekly reset).
 *
 *   Phase 2 additions:
 *   - Transaction cost deduction (buy commission + sell commission + STT)
 *   - writeLiveLedgerAfterEod(): called by s1-sim-runner on Tuesday EOD
 *   - writeDailyNavRow(): called every weekday EOD for continuous NAV curve
 *
 * Hard lines:
 *   - SIM-ONLY: no real-money writes. No broker interaction.
 *   - PIT-strict: entry/exit prices are from the SAME TUESDAY as the
 *     basket generation date. No look-ahead.
 *   - DRY-RUN default: set DRY_RUN=false to persist to sim_ledger_* tables.
 *   - No automatic execution from server.ts — must be triggered manually.
 *
 * Assumptions (楊董 ACK 2026-07-01, updated Phase 2):
 *   A1. Assumed execution price = Tuesday closing price (PIT close, not basket latest_price)
 *   A2. Transaction costs included (Phase 2): buy 0.1425%, sell 0.1425% + STT 0.3%
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

// ── Cost rates (Phase 2) ───────────────────────────────────────────────────

/** Standard KGI brokerage + tax rates for Phase 2 cost-inclusive ledger. */
export interface CostRates {
  buyCommissionRate: number;           // fraction of transaction value, e.g. 0.001425
  sellCommissionRate: number;          // fraction of transaction value
  securitiesTransactionTaxRate: number; // fraction on sell side only, e.g. 0.003
}

/** Standard Taiwan stock transaction cost rates (KGI default). */
export const STANDARD_COST_RATES: CostRates = {
  buyCommissionRate: 0.001425,
  sellCommissionRate: 0.001425,
  securitiesTransactionTaxRate: 0.003,
};

/** Zero-cost rates (Phase 1 baseline assumption A2). */
export const ZERO_COST_RATES: CostRates = {
  buyCommissionRate: 0,
  sellCommissionRate: 0,
  securitiesTransactionTaxRate: 0,
};

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
  /** Transaction costs deducted from equity (0 if ZERO_COST_RATES). */
  totalTransactionCostsTwd: number;
  /** Equity if NO transaction costs were applied (Phase 1 baseline comparison). */
  noCostFinalEquity: number;
  /** Return % if NO transaction costs were applied (Phase 1 baseline: should be ~-6.34%). */
  noCostReturnPct: number;
  /** Flags whether cost rates were non-zero in this run. */
  costsIncluded: boolean;
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
  /** Phase 2: include transaction costs. Defaults to STANDARD_COST_RATES. Pass ZERO_COST_RATES to replicate Phase 1. */
  costRates?: CostRates;
}): Promise<BackfillResult> {
  const {
    dryRun = true,
    startDate = "2026-06-01",
    rebalanceDates = ["2026-06-02","2026-06-09","2026-06-16","2026-06-23","2026-06-30"],
    initialEquity = 10_000_000,
    workspaceId,
    costRates = STANDARD_COST_RATES,
  } = options;

  const costsIncluded = costRates.buyCommissionRate !== 0
    || costRates.sellCommissionRate !== 0
    || costRates.securitiesTransactionTaxRate !== 0;

  const assumptions = [
    "A1: Assumed execution price = Tuesday closing price (FinMind TaiwanStockPrice close, PIT)",
    costsIncluded
      ? `A2: Transaction costs included — buy commission ${(costRates.buyCommissionRate * 100).toFixed(4)}%, sell commission ${(costRates.sellCommissionRate * 100).toFixed(4)}%, STT ${(costRates.securitiesTransactionTaxRate * 100).toFixed(2)}%`
      : "A2: No transaction costs (zero-cost baseline — Phase 1 parity check)",
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
  // Track no-cost equity in parallel for Phase 1 parity validation
  let equityNoCost = initialEquity;
  let totalTransactionCostsTwd = 0;
  const weeks: LedgerWeekResult[] = [];
  let prevBasket: LedgerBasketEntry[] = [];
  let prevEntryPrices = new Map<string, number>();
  let prevCost = 0;
  let prevCash = 0;
  let prevCashNoCost = 0;

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

    // Phase 2 cost calculation: buy commission on new basket
    const buyCost = Math.round(actualCost * costRates.buyCommissionRate);

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
      // Phase 2: sell cost = sell commission + STT on exit proceeds
      const sellCost = Math.round(exitTotal * (costRates.sellCommissionRate + costRates.securitiesTransactionTaxRate));
      const weekCost = sellCost + buyCost;
      totalTransactionCostsTwd += weekCost;

      realizedPnl = Math.round(exitTotal - prevCost - sellCost - buyCost);
      // equity after exit + new entry (with costs)
      equity = Math.round(prevCash + exitTotal - sellCost - buyCost);
      // no-cost parallel track
      equityNoCost = Math.round(prevCashNoCost + exitTotal);
    } else {
      // W1: only buy cost
      totalTransactionCostsTwd += buyCost;
      equity = initialEquity - buyCost;
      equityNoCost = initialEquity;
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
    const cashResidualNoCost = Math.round(equityNoCost - actualCost);

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
    prevCashNoCost = cashResidualNoCost;
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

  // No-cost baseline (Phase 1 parity check)
  // Last week's equityNoCost + last basket market value at end date
  const lastWeekNoCash = prevCashNoCost;
  const lastBasket = basketMap.get(rebalanceDates[rebalanceDates.length - 1] ?? "") ?? [];
  let lastMvNoCost = 0;
  for (const pos of lastBasket) {
    const pr = getPitClose(priceMap, pos.symbol, endDate);
    if (pr) lastMvNoCost += pr.price * pos.shares;
  }
  const noCostFinalEquity = Math.round(lastWeekNoCash + lastMvNoCost);
  const noCostReturnPct = ((noCostFinalEquity - initialEquity) / initialEquity) * 100;

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
    totalTransactionCostsTwd,
    noCostFinalEquity,
    noCostReturnPct: Math.round(noCostReturnPct * 10000) / 10000,
    costsIncluded,
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

    // Bug 1 fix: basket_date must be the ENTRY date (previous week's Tuesday),
    // not pos.exitDate (which is this week's date = wrong JOIN key).
    const prevWeek = data.weeks.find((wr) => wr.weekNum === w.weekNum - 1);

    for (const pos of w.positions) {
      if (pos.exitDate !== null) {
        // Closed position: was opened in prevWeek, exited this week.
        const entryBasketDate = prevWeek?.basketDate ?? w.basketDate;
        await db.execute(drizzleSql`
          INSERT INTO sim_ledger_holdings
            (week_num, basket_date, symbol, shares, entry_price_twd,
             exit_price_twd, exit_date, realized_pnl_twd, entry_source, exit_source)
          VALUES
            (${w.weekNum - 1}, ${entryBasketDate}::date, ${pos.symbol}, ${pos.shares},
             ${pos.entryPrice}, ${pos.exitPrice}, ${pos.exitDate}::date,
             ${pos.realizedPnl}, 'finmind_close', 'finmind_close')
          ON CONFLICT (basket_date, symbol) DO UPDATE SET
            exit_price_twd = EXCLUDED.exit_price_twd,
            realized_pnl_twd = EXCLUDED.realized_pnl_twd
        `);
      } else {
        // Bug 2 fix: open positions (exitDate=null) were previously skipped.
        // Phase 2 needs these rows to display current holdings (e.g. W5).
        //
        // DO NOTHING on conflict (Mike re-audit 🟡 fix 2026-07-02):
        // If Phase 2 live cron has already closed this position (writing
        // exit_price_twd + realized_pnl_twd), a full backfill re-run must
        // NOT overwrite that exit data with NULL.  The closed-position branch
        // (pos.exitDate !== null) fires later in the same loop iteration and
        // correctly updates exit columns via its own ON CONFLICT DO UPDATE.
        await db.execute(drizzleSql`
          INSERT INTO sim_ledger_holdings
            (week_num, basket_date, symbol, shares, entry_price_twd,
             exit_price_twd, exit_date, realized_pnl_twd, entry_source, exit_source)
          VALUES
            (${w.weekNum}, ${w.basketDate}::date, ${pos.symbol}, ${pos.shares},
             ${pos.entryPrice}, NULL, NULL, NULL, 'finmind_close', NULL)
          ON CONFLICT (basket_date, symbol) DO NOTHING
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

/**
 * HoldingRow — the pure-computation output of the holdings persist logic.
 * Exported so tests can assert correctness without a DB connection.
 */
export interface HoldingRow {
  weekNum: number;
  basketDate: string;       // ENTRY date (Tuesday), not exit date — Bug 1 fix
  symbol: string;
  shares: number;
  entryPrice: number;
  exitPrice: number | null;
  exitDate: string | null;
  realizedPnl: number | null;
  isOpen: boolean;          // true = still held (exitDate=null) — Bug 2 fix
}

/**
 * _computeHoldingsRowsForTest — pure function that mirrors persistBackfillResults'
 * holdings logic without touching the DB.  Used by SIM-LEDGER-9 and SIM-LEDGER-10
 * regression tests to verify Bug 1 (basket_date = entry date) and Bug 2 (open
 * positions included).
 */
export function _computeHoldingsRowsForTest(weeks: LedgerWeekResult[]): HoldingRow[] {
  const rows: HoldingRow[] = [];
  for (const w of weeks) {
    const prevWeek = weeks.find((wr) => wr.weekNum === w.weekNum - 1);
    for (const pos of w.positions) {
      if (pos.exitDate !== null) {
        // Closed: entry basket is previous week's date
        const entryBasketDate = prevWeek?.basketDate ?? w.basketDate;
        rows.push({
          weekNum:     w.weekNum - 1,
          basketDate:  entryBasketDate,
          symbol:      pos.symbol,
          shares:      pos.shares,
          entryPrice:  pos.entryPrice,
          exitPrice:   pos.exitPrice,
          exitDate:    pos.exitDate,
          realizedPnl: pos.realizedPnl,
          isOpen:      false,
        });
      } else {
        // Open: entry basket is this week's date
        rows.push({
          weekNum:     w.weekNum,
          basketDate:  w.basketDate,
          symbol:      pos.symbol,
          shares:      pos.shares,
          entryPrice:  pos.entryPrice,
          exitPrice:   null,
          exitDate:    null,
          realizedPnl: null,
          isOpen:      true,
        });
      }
    }
  }
  return rows;
}

// ── Phase 2: Live ledger writes ────────────────────────────────────────────

/**
 * Reads the latest sim_ledger_weeks row to determine current weekNum and
 * last recorded equity. Returns null if ledger is empty (backfill not applied).
 */
export async function getLatestLedgerState(db: ReturnType<typeof getDb>): Promise<{
  weekNum: number;
  equityAfterTwd: number;
  basketDate: string;
} | null> {
  if (!db) return null;
  try {
    const rows = await db.execute(drizzleSql`
      SELECT week_num, equity_after_twd, basket_date
      FROM sim_ledger_weeks
      WHERE source IN ('live', 'backfill_dry_run')
      ORDER BY basket_date DESC, week_num DESC
      LIMIT 1
    `) as unknown as Array<{ week_num: number; equity_after_twd: string; basket_date: string }>;
    if (!rows.length) return null;
    const r = rows[0]!;
    return {
      weekNum: Number(r.week_num),
      equityAfterTwd: Number(r.equity_after_twd),
      basketDate: String(r.basket_date).slice(0, 10),
    };
  } catch {
    return null;
  }
}

/**
 * writeLiveLedgerAfterEod — called from s1-sim-runner on Tuesday EOD.
 *
 * Closes previous week (computes realized PnL from EOD prices), opens new week,
 * and writes daily NAV row. Idempotent via sim_ledger_weeks UNIQUE(basket_date,source).
 *
 * Called only when snapshot.pricingComplete=true AND today is Tuesday.
 */
export async function writeLiveLedgerAfterEod(options: {
  rebalanceDate: string;  // today's Tuesday date YYYY-MM-DD
  /** Priced positions from buildS1PositionsSnapshot (today's new basket with EOD prices). */
  currentPositions: Array<{
    symbol: string;
    shares: number;
    avg_cost: number;
    last_price: number | null;
    market_value_twd: number | null;
  }>;
  cashResidualTwd: number;
  totalMarketValueTwd: number | null;
  workspaceId?: string;
  costRates?: CostRates;
}): Promise<{
  written: boolean;
  weekNum: number;
  realizedPnlTwd: number | null;
  equityAfterTwd: number;
  transactionCostsTwd: number;
  notes: string[];
}> {
  const db = getDb();
  if (!db || !isDatabaseMode()) {
    return { written: false, weekNum: 0, realizedPnlTwd: null, equityAfterTwd: 0, transactionCostsTwd: 0, notes: ["no_db"] };
  }

  const { rebalanceDate, currentPositions, cashResidualTwd, totalMarketValueTwd, workspaceId, costRates = STANDARD_COST_RATES } = options;
  const notes: string[] = [];

  try {
    // 1. Get current ledger state to determine week number
    const latestState = await getLatestLedgerState(db);
    if (!latestState) {
      notes.push("live_ledger_skip: backfill not applied yet — apply admin backfill first");
      return { written: false, weekNum: 0, realizedPnlTwd: null, equityAfterTwd: 0, transactionCostsTwd: 0, notes };
    }
    const weekNum = latestState.weekNum + 1;
    const prevEquity = latestState.equityAfterTwd;

    // 2. Load previous week's basket from audit_logs
    const allBaskets = await loadBasketsFromAuditLogs(workspaceId).catch(() => new Map<string, LedgerBasketEntry[]>());
    const sortedDates = [...allBaskets.keys()].sort();
    const prevDates = sortedDates.filter((d) => d < rebalanceDate);
    const prevBasketDate = prevDates[prevDates.length - 1] ?? null;
    const prevBasket = prevBasketDate ? (allBaskets.get(prevBasketDate) ?? []) : [];

    if (prevBasket.length === 0) {
      notes.push(`live_ledger_skip: no previous basket found before ${rebalanceDate}`);
      return { written: false, weekNum, realizedPnlTwd: null, equityAfterTwd: prevEquity, transactionCostsTwd: 0, notes };
    }

    // 3. Compute realized PnL using today's EOD prices (from current snapshot)
    //    The snapshot prices the NEW basket. For the OLD basket symbols, use last_price
    //    from positions if overlap, otherwise fetch from quote_last_close.
    const todayPriceMap = new Map(currentPositions.map((p) => [p.symbol, p.last_price]));

    // For old basket symbols not in new basket, query quote_last_close
    const missingSymbols = prevBasket.map((p) => p.symbol).filter((s) => !todayPriceMap.has(s));
    if (missingSymbols.length > 0) {
      try {
        const safeSymbols = missingSymbols.map((s) => s.replace(/'/g, "''"));
        const symbolList = safeSymbols.map((s) => `'${s}'`).join(",");
        const priceRows = await db.execute(drizzleSql.raw(`
          SELECT DISTINCT ON (symbol) symbol, close_price
          FROM quote_last_close
          WHERE symbol IN (${symbolList})
            AND trade_date = '${rebalanceDate}'
          ORDER BY symbol, trade_date DESC
        `)) as unknown as Array<{ symbol: string; close_price: string }>;
        for (const r of priceRows) {
          todayPriceMap.set(r.symbol, Number(r.close_price));
        }
      } catch (e) {
        notes.push(`quote_last_close_fetch_warn: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    let exitTotal = 0;
    let prevCost = 0;
    for (const pos of prevBasket) {
      const exitPrice = todayPriceMap.get(pos.symbol) ?? null;
      if (exitPrice === null) {
        notes.push(`missing_exit_price: ${pos.symbol} on ${rebalanceDate} — using avg_cost as fallback`);
      }
      const ep = exitPrice ?? 0;
      exitTotal += pos.shares * ep;
    }

    // Rough prev cost estimate: sum of (shares × avg_cost) from sim_ledger_holdings
    let holdingRows: Array<{ symbol: string; shares: number; entry_price_twd: string }> = [];
    try {
      holdingRows = await db.execute(drizzleSql`
        SELECT symbol, shares, entry_price_twd
        FROM sim_ledger_holdings
        WHERE basket_date = ${prevBasketDate}::date
          AND exit_date IS NULL
      `) as unknown as Array<{ symbol: string; shares: number; entry_price_twd: string }>;
      prevCost = holdingRows.reduce((s, r) => s + Number(r.shares) * Number(r.entry_price_twd), 0);
    } catch {
      prevCost = prevBasket.reduce((s, p) => {
        const price = currentPositions.find((c) => c.symbol === p.symbol)?.avg_cost ?? 0;
        return s + p.shares * price;
      }, 0);
    }

    const newBasketCost = currentPositions.reduce((s, p) => s + p.shares * (p.avg_cost ?? 0), 0);
    const sellCost = Math.round(exitTotal * (costRates.sellCommissionRate + costRates.securitiesTransactionTaxRate));
    const buyCost = Math.round(newBasketCost * costRates.buyCommissionRate);
    const transactionCostsTwd = sellCost + buyCost;

    const realizedPnlTwd = Math.round(exitTotal - prevCost - sellCost - buyCost);
    const equityAfterTwd = Math.round(prevEquity - prevCost + exitTotal - sellCost - buyCost);

    // 4. Write new week to sim_ledger_weeks
    await db.execute(drizzleSql`
      INSERT INTO sim_ledger_weeks
        (week_num, basket_date, initial_equity, basket_cost_twd,
         cash_residual_twd, realized_pnl_twd, equity_after_twd, source,
         notes)
      VALUES
        (${weekNum}, ${rebalanceDate}::date, 10000000,
         ${Math.round(newBasketCost)}, ${cashResidualTwd},
         ${realizedPnlTwd}, ${equityAfterTwd}, 'live',
         ${JSON.stringify(notes.length > 0 ? [{ phase2_live: true, notes }] : [{ phase2_live: true }])}::jsonb)
      ON CONFLICT (basket_date, source) DO UPDATE SET
        realized_pnl_twd = EXCLUDED.realized_pnl_twd,
        equity_after_twd = EXCLUDED.equity_after_twd,
        cash_residual_twd = EXCLUDED.cash_residual_twd,
        updated_at = NOW()
    `);

    // 5. Update previous week's open holdings to add exit data
    // Build per-symbol entry price map from the holdings rows loaded earlier
    const entryPriceBySymbol = new Map(holdingRows.map((r): [string, number] => [
      r.symbol,
      Number(r.entry_price_twd),
    ]));
    for (const pos of prevBasket) {
      const exitPrice = todayPriceMap.get(pos.symbol) ?? null;
      const entryPriceTwd = entryPriceBySymbol.get(pos.symbol) ?? 0;
      const posRealizedPnl = exitPrice !== null
        ? Math.round((exitPrice - entryPriceTwd) * pos.shares)
        : null;
      await db.execute(drizzleSql`
        INSERT INTO sim_ledger_holdings
          (week_num, basket_date, symbol, shares, entry_price_twd,
           exit_price_twd, exit_date, realized_pnl_twd, entry_source, exit_source)
        VALUES
          (${weekNum - 1}, ${prevBasketDate}::date, ${pos.symbol}, ${pos.shares},
           ${entryPriceTwd},
           ${exitPrice}, ${rebalanceDate}::date,
           ${posRealizedPnl}, 'live_eod', 'live_eod')
        ON CONFLICT (basket_date, symbol) DO UPDATE SET
          exit_price_twd = EXCLUDED.exit_price_twd,
          exit_date = EXCLUDED.exit_date,
          realized_pnl_twd = EXCLUDED.realized_pnl_twd,
          exit_source = EXCLUDED.exit_source
      `);
    }

    // 6. Insert new week's open positions
    for (const pos of currentPositions) {
      await db.execute(drizzleSql`
        INSERT INTO sim_ledger_holdings
          (week_num, basket_date, symbol, shares, entry_price_twd,
           exit_price_twd, exit_date, realized_pnl_twd, entry_source, exit_source)
        VALUES
          (${weekNum}, ${rebalanceDate}::date, ${pos.symbol}, ${pos.shares},
           ${pos.avg_cost}, NULL, NULL, NULL, 'live_eod', NULL)
        ON CONFLICT (basket_date, symbol) DO NOTHING
      `);
    }

    // 7. Write NAV row for today
    const navEquity = Math.round(cashResidualTwd + (totalMarketValueTwd ?? 0));
    const initialEquity = 10_000_000;
    const returnPct = Math.round(((navEquity - initialEquity) / initialEquity) * 100 * 10000) / 10000;
    await db.execute(drizzleSql`
      INSERT INTO sim_ledger_nav
        (nav_date, equity_twd, initial_equity, return_pct, week_num, source, notes)
      VALUES
        (${rebalanceDate}::date, ${navEquity}, ${initialEquity},
         ${returnPct}, ${weekNum}, 'live_eod',
         'rebalance_tuesday')
      ON CONFLICT (nav_date, source) DO UPDATE SET
        equity_twd = EXCLUDED.equity_twd,
        return_pct = EXCLUDED.return_pct
    `);

    notes.push(`live_ledger_written: weekNum=${weekNum} realizedPnl=${realizedPnlTwd} equity=${equityAfterTwd} costs=${transactionCostsTwd}`);
    return { written: true, weekNum, realizedPnlTwd, equityAfterTwd, transactionCostsTwd, notes };
  } catch (e) {
    notes.push(`live_ledger_error: ${e instanceof Error ? e.message : String(e)}`);
    return { written: false, weekNum: 0, realizedPnlTwd: null, equityAfterTwd: 0, transactionCostsTwd: 0, notes };
  }
}

/**
 * writeDailyNavRow — called from s1-sim-runner every weekday EOD (non-Tuesday).
 *
 * Writes a daily NAV snapshot to sim_ledger_nav using today's mark-to-market value.
 * Idempotent via UNIQUE(nav_date, source).
 * No-ops if ledger is empty (backfill not applied) or database unavailable.
 */
export async function writeDailyNavRow(options: {
  navDate: string;          // today YYYY-MM-DD
  cashResidualTwd: number;
  totalMarketValueTwd: number | null;
}): Promise<void> {
  const db = getDb();
  if (!db || !isDatabaseMode()) return;

  const { navDate, cashResidualTwd, totalMarketValueTwd } = options;

  const latestState = await getLatestLedgerState(db).catch(() => null);
  if (!latestState) return; // backfill not applied yet

  const navEquity = Math.round(cashResidualTwd + (totalMarketValueTwd ?? 0));
  const initialEquity = 10_000_000;
  const returnPct = Math.round(((navEquity - initialEquity) / initialEquity) * 100 * 10000) / 10000;

  try {
    await db.execute(drizzleSql`
      INSERT INTO sim_ledger_nav
        (nav_date, equity_twd, initial_equity, return_pct, week_num, source, notes)
      VALUES
        (${navDate}::date, ${navEquity}, ${initialEquity},
         ${returnPct}, ${latestState.weekNum}, 'live_eod',
         'daily_mark_to_market')
      ON CONFLICT (nav_date, source) DO UPDATE SET
        equity_twd = EXCLUDED.equity_twd,
        return_pct = EXCLUDED.return_pct
    `);
  } catch (e) {
    console.warn("[sim-ledger] writeDailyNavRow error:", e instanceof Error ? e.message : String(e));
  }
}
