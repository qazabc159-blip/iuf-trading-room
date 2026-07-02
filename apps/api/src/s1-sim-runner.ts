/**
 * s1-sim-runner.ts — S1 IUF_LS_OMNI_V1_ROUTER SIM Auto-Trade Pipeline
 *
 * Athena packet: athena_s1_quant_lab_delivery_packet_for_trading_room_2026_05_19_v1.md
 * Yang ACK: 22:34 TST 2026-05-19 "我選F-AUTO ... 明早直接開始正式跑"
 *
 * Schedule (wired by startSchedulers):
 *   Tuesday ~08:30 TST → runS1SignalTick()       cont_liq signal + basket
 *   Tuesday ~09:00 TST → runS1OrderSubmitTick()  KGI SIM submit x8
 *   Daily  ~14:00 TST  → runS1EodReportTick()    mark-to-market EOD report
 *
 * Hard lines:
 *   - SIM only. No real-money writes.
 *   - No "alpha confirmed" / "L5/L10 PASS" wording (Athena firewall).
 *   - Reports to reports/trading_room/s1_sim_basket/ and s1_sim_daily/.
 *   - Fail-safe: per-step error is logged + skipped; never crash the process.
 *   - Universe: DB workspace companies (liquidity-filtered, < 40 for KGI cap).
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getFinMindClient } from "./data-sources/finmind-client.js";
import { auditLogs, companies, getDb, isDatabaseMode, workspaces } from "@iuf-trading-room/db";
import { extractKgiTradeId, reconcileKgiOrder } from "./broker/kgi-order-reconciliation.js";
import { upsertLastCloses, getLastCloses, type LastCloseEntry } from "./quote-last-close-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface S1BasketEntry {
  rank: number;
  symbol: string;
  score_cont_liq: number;
  z_volratio: number;
  z_trailret20d: number;
  latest_price: number | null;
  target_notional_twd: number;
  target_shares: number;
  sizing_note: string;
}

export interface S1Basket {
  schema: "s1_sim_basket_v1";
  generated_at_tst: string;
  signal_date: string;
  regime: string;
  exposure_weight: number;
  capital_twd: number;
  long_target_twd: number;
  per_name_target_twd: number;
  basket: S1BasketEntry[];
  universe_count: number;
  failsafe_notes: string[];
}

export interface S1OrderSubmitResult {
  schema: "s1_order_submit_v1";
  submitted_at_tst: string;
  trading_date: string;
  basket_date: string;
  orders_attempted: number;
  orders_accepted: number;
  orders_rejected: number;
  results: Array<{
    symbol: string;
    shares: number;
    status: "accepted" | "rejected" | "skipped" | "filled" | "partially_filled" | "cancelled" | "unconfirmed";
    trade_id: string | null;
    filled_shares?: number;
    remaining_shares?: number;
    avg_fill_price?: number | null;
    settlement_source?: string;
    settlement_confirmed?: boolean;
    confirmed_at?: string | null;
    error: string | null;
  }>;
  failsafe_notes: string[];
}

export interface S1EodReport {
  schema: "s1_eod_report_v1";
  trading_date: string;
  generated_at_tst: string;
  completion_status: "complete" | "partial";
  pricing_coverage: {
    priced_positions: number;
    total_positions: number;
  };
  positions: Array<{
    symbol: string;
    shares: number;
    avg_cost: number;
    last_price: number | null;
    unrealized_pnl_twd: number | null;
    market_value_twd: number | null;
  }>;
  total_unrealized_pnl_twd: number | null;
  total_market_value_twd: number | null;
  cash_residual_estimated_twd: number;
  data_source: string;
  notes: string[];
}

export type S1CapitalSource = "latest_subscription" | "env" | "default";

export interface S1CapitalConfig {
  capitalTwd: number;
  source: S1CapitalSource;
  subscriptionId: string | null;
  createdAt: string | null;
}

export const S1_AUTO_SCHEDULER_POLICY = {
  enabled: true,
  mode: "weekly_tuesday_kgi_sim",
  signalWindowTst: "Tuesday 08:30-08:55",
  orderSubmitWindowTst: "Tuesday 09:00-09:20",
  eodWindowTst: "Weekdays 14:45-15:30",
  pollIntervalMs: 15 * 60 * 1000,
  signalCatchupBeforeOrder: true,
  manualTriggerRole: "owner_backup_only",
} as const;

// ---------------------------------------------------------------------------
// Config & helpers
// ---------------------------------------------------------------------------

export const S1_DEFAULT_CAPITAL_TWD = 10_000_000;
export const S1_MIN_CAPITAL_TWD = 50_000;
export const S1_MAX_CAPITAL_TWD = 10_000_000;
export const S1_AUDIT_ACTIONS = {
  signalGenerated: "s1_sim.signal_generated",
  ordersSubmitted: "s1_sim.orders_submitted",
  eodGenerated: "s1_sim.eod_generated",
} as const;

function normalizeS1Capital(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.floor(n);
  if (rounded < S1_MIN_CAPITAL_TWD || rounded > S1_MAX_CAPITAL_TWD) return null;
  return rounded;
}

function envS1Capital(): S1CapitalConfig | null {
  const capital = normalizeS1Capital(process.env["S1_SIM_CAPITAL_TWD"]);
  if (capital === null) return null;
  return {
    capitalTwd: capital,
    source: "env",
    subscriptionId: null,
    createdAt: null,
  };
}

async function resolveS1WorkspaceId(): Promise<string | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .limit(1)
    .catch(() => [] as Array<{ id: string }>);

  return rows[0]?.id ?? null;
}

async function writeS1ObservationAudit(input: {
  workspaceId: string;
  action: typeof S1_AUDIT_ACTIONS[keyof typeof S1_AUDIT_ACTIONS];
  tradingDate: string;
  data: S1Basket | S1OrderSubmitResult | S1EodReport;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(auditLogs).values({
      workspaceId: input.workspaceId,
      actorId: null,
      action: input.action,
      entityType: "s1_sim",
      entityId: input.tradingDate,
      payload: {
        schema: "s1_sim_observation_audit_v1",
        persisted_at: new Date().toISOString(),
        data: input.data,
      },
    });
  } catch (e) {
    console.warn("[s1-audit] failed to persist observation audit:", e instanceof Error ? e.message : String(e));
  }
}

async function readS1ObservationAudit<T>(
  action: typeof S1_AUDIT_ACTIONS[keyof typeof S1_AUDIT_ACTIONS],
  tradingDate: string,
): Promise<T | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  const workspaceId = await resolveS1WorkspaceId();
  if (!workspaceId) return null;

  const rows = await db
    .select({ payload: auditLogs.payload })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        eq(auditLogs.action, action),
        eq(auditLogs.entityType, "s1_sim"),
        eq(auditLogs.entityId, tradingDate),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1)
    .catch(() => [] as Array<{ payload: unknown }>);

  const payload = rows[0]?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = (payload as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as T;
}

/**
 * Latest audit entry for an action within a trading-date window (inclusive).
 * entityId stores the trading date as YYYY-MM-DD, so lexicographic compare works.
 * Needed because S1 is weekly: mid-week EOD reports must find LAST Tuesday's
 * orders, not today's (which don't exist Wed–Mon).
 */
async function readLatestS1ObservationAuditInWindow<T>(
  action: typeof S1_AUDIT_ACTIONS[keyof typeof S1_AUDIT_ACTIONS],
  window: { from: string; to: string },
): Promise<{ tradingDate: string; data: T } | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  const workspaceId = await resolveS1WorkspaceId();
  if (!workspaceId) return null;

  const rows = await db
    .select({ entityId: auditLogs.entityId, payload: auditLogs.payload })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        eq(auditLogs.action, action),
        eq(auditLogs.entityType, "s1_sim"),
        gte(auditLogs.entityId, window.from),
        lte(auditLogs.entityId, window.to),
      ),
    )
    .orderBy(desc(auditLogs.entityId), desc(auditLogs.createdAt))
    .limit(1)
    .catch(() => [] as Array<{ entityId: string | null; payload: unknown }>);

  const row = rows[0];
  if (!row?.entityId) return null;
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = (payload as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return { tradingDate: row.entityId, data: data as T };
}

export async function resolveS1SimCapitalTwd(workspaceId: string): Promise<S1CapitalConfig> {
  const envConfig = envS1Capital();

  if (isDatabaseMode()) {
    const db = getDb();
    if (db) {
      try {
        const rows = await db
          .select({
            id: auditLogs.id,
            createdAt: auditLogs.createdAt,
            payload: auditLogs.payload,
          })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.workspaceId, workspaceId),
              eq(auditLogs.action, "quant_strategy.subscribe"),
              eq(auditLogs.entityId, "cont_liq_v36"),
            ),
          )
          .orderBy(desc(auditLogs.createdAt))
          .limit(1);

        const row = rows[0];
        const payload =
          row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
            ? row.payload as Record<string, unknown>
            : {};
        const latestCapital = normalizeS1Capital(payload["capital_twd"]);
        if (row && latestCapital !== null) {
          return {
            capitalTwd: latestCapital,
            source: "latest_subscription",
            subscriptionId: typeof payload["subscription_id"] === "string" ? payload["subscription_id"] : row.id,
            createdAt: row.createdAt.toISOString(),
          };
        }
      } catch (e) {
        console.warn("[s1-capital] failed to read latest quant subscription:", e instanceof Error ? e.message : String(e));
      }
    }
  }

  return envConfig ?? {
    capitalTwd: S1_DEFAULT_CAPITAL_TWD,
    source: "default",
    subscriptionId: null,
    createdAt: null,
  };
}

/** Volume-mount path for persistent reports. Railway: /data, local: runtime-data */
function reportsBase(): string {
  const mount = process.env["RAILWAY_VOLUME_MOUNT_PATH"] ?? process.env["DATA_DIR"] ?? "runtime-data";
  return join(mount, "trading_room");
}

/** KGI gateway base URL */
function kgiGatewayUrl(): string {
  return (
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787"
  );
}

/** Taipei date string YYYY-MM-DD */
function taipeiDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/** Taipei HHMM number */
function taipeiHHMM(): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
  return parseInt(fmt.replace(":", ""), 10);
}

/** Round down to nearest 1000-share board lot */
function roundDownBoardLot(shares: number): number {
  return Math.floor(shares / 1000) * 1000;
}

/** Days ago ISO string */
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Cross-sectional z-score over an array of values */
function zScore(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / std);
}

/** Write JSON file, creating parent dirs as needed */
async function writeJson(path: string, data: unknown): Promise<void> {
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

/** Write Markdown file, creating parent dirs as needed */
async function writeMd(path: string, content: string): Promise<void> {
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, content, "utf-8");
}

async function readS1BasketForDate(date: string): Promise<S1Basket | null> {
  const p = join(reportsBase(), "s1_sim_basket", `${date}.json`);
  try {
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as S1Basket;
  } catch {
    return readS1ObservationAudit<S1Basket>(S1_AUDIT_ACTIONS.signalGenerated, date);
  }
}

export async function hasS1BasketForDate(date = taipeiDateStr()): Promise<boolean> {
  return (await readS1BasketForDate(date)) !== null;
}

export type S1SignalCatchupResult =
  | "existing_today_basket"
  | "generated_today_basket"
  | "skipped_outside_order_window"
  | "missing_after_signal";

// ---------------------------------------------------------------------------
// Module-level dedup guards (prevent multi-fire within same day/window)
// ---------------------------------------------------------------------------

let _signalLastFiredDate = "";
let _orderSubmitLastFiredDate = "";
let _eodLastFiredDate = "";
let _signalRunInFlight: Promise<void> | null = null;
let _eodRunInFlight: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// A. cont_liq signal runner + regime classifier + order sizing
// ---------------------------------------------------------------------------

/**
 * Compute cont_liq scores for a universe of symbols, then size orders.
 * Universe: uses workspace companies from DB (already liquidity-filtered).
 * If fewer than 8 symbols have data, basket is truncated (skip halted stocks).
 */
export async function runS1SignalTick(options: { force?: boolean } = {}): Promise<void> {
  if (_signalRunInFlight) {
    console.log("[s1-signal] signal run already in flight, waiting");
    await _signalRunInFlight;
    return;
  }

  _signalRunInFlight = runS1SignalTickOnce(options).finally(() => {
    _signalRunInFlight = null;
  });

  await _signalRunInFlight;
}

async function runS1SignalTickOnce(options: { force?: boolean } = {}): Promise<void> {
  const todayTst = taipeiDateStr();

  if (!options.force && _signalLastFiredDate === todayTst) {
    console.log("[s1-signal] already fired today, skipping");
    return;
  }
  _signalLastFiredDate = todayTst;

  const failsafe_notes: string[] = [];
  console.log(`[s1-signal] START signal_date=${todayTst}`);

  // 1. Get universe from DB companies
  const db = getDb();
  if (!db) {
    console.warn("[s1-signal] DB unavailable — skipping signal compute");
    _signalLastFiredDate = ""; // allow retry
    return;
  }

  // Resolve first workspace
  const wsRows = await db
    .select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces)
    .limit(1)
    .catch(() => [] as Array<{ id: string; slug: string }>);

  if (wsRows.length === 0) {
    console.warn("[s1-signal] no workspace found — skipping");
    _signalLastFiredDate = "";
    return;
  }
  const workspaceId = wsRows[0].id;

  const companyRows = await db
    .select({ ticker: companies.ticker })
    .from(companies)
    .where(eq(companies.workspaceId, workspaceId))
    .catch(() => [] as Array<{ ticker: string }>);

  // Filter to Taiwan 4-digit tickers only
  const universe = companyRows
    .map((r) => r.ticker)
    .filter((t) => /^\d{4}$/.test(t));

  if (universe.length < 8) {
    console.warn(`[s1-signal] universe too small (${universe.length} tickers), skipping`);
    failsafe_notes.push(`universe_too_small: ${universe.length} tickers, need >=8`);
    _signalLastFiredDate = ""; // allow retry
    return;
  }

  console.log(`[s1-signal] universe size=${universe.length}`);

  // 2. Fetch price data per symbol from FinMind (last 30 trading days = ~42 calendar days)
  const finmind = getFinMindClient();
  const startDate = daysAgoIso(45); // 45 calendar days ≈ 30 trading days with buffer

  type SymbolData = {
    symbol: string;
    trailRet20d: number;   // 20-day trailing return
    volRatio5v20: number;  // 5-day vs 20-day volume ratio
    latestPrice: number | null;
    latestVolume: number | null;
  };

  const symbolData: SymbolData[] = [];

  // Batch fetch — FinMind quota: 6,000/hour, so 500 stocks is fine
  const FINMIND_BATCH_CONCURRENCY = 10;
  for (let i = 0; i < universe.length; i += FINMIND_BATCH_CONCURRENCY) {
    const batch = universe.slice(i, i + FINMIND_BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        const bars = await finmind.getStockPriceAdj(symbol, startDate, null);
        if (bars.length < 5) return null; // insufficient data

        // Sort ascending by date (should already be sorted, but ensure)
        const sorted = [...bars].sort((a, b) => a.dt.localeCompare(b.dt));

        const last = sorted[sorted.length - 1];
        const latestPrice = last?.close ?? null;
        const latestVolume = last?.volume ?? null;

        if (!latestPrice || latestPrice <= 0) return null;

        // 20-day trailing return
        const bars20 = sorted.slice(-21); // last 21 bars → 20-period return
        const price20dAgo = bars20[0]?.close;
        const priceLast = bars20[bars20.length - 1]?.close;
        if (!price20dAgo || !priceLast || price20dAgo <= 0) return null;
        const trailRet20d = (priceLast - price20dAgo) / price20dAgo;

        // 5d vs 20d volume ratio
        const vol5 = sorted.slice(-5).reduce((s, b) => s + b.volume, 0) / 5;
        const vol20 = sorted.slice(-20).reduce((s, b) => s + b.volume, 0) / 20;
        const volRatio5v20 = vol20 > 0 ? vol5 / vol20 : 0;

        return {
          symbol,
          trailRet20d,
          volRatio5v20,
          latestPrice,
          latestVolume
        };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        symbolData.push(r.value);
      }
    }
  }

  if (symbolData.length < 8) {
    console.warn(`[s1-signal] only ${symbolData.length} symbols with data, need >=8`);
    failsafe_notes.push(`insufficient_data: only ${symbolData.length} symbols returned data`);
    // FinMind lag: wait 30min and retry
    failsafe_notes.push("failsafe_action: will retry next scheduler tick (~15min)");
    _signalLastFiredDate = ""; // allow retry
    return;
  }

  // 3. Cross-sectional z-scores
  const symbols = symbolData.map((d) => d.symbol);
  const zRet = zScore(symbolData.map((d) => d.trailRet20d));
  const zVol = zScore(symbolData.map((d) => d.volRatio5v20));

  const scored = symbolData.map((d, i) => ({
    symbol: d.symbol,
    z_trailret20d: zRet[i] ?? 0,
    z_volratio: zVol[i] ?? 0,
    score_cont_liq: (zRet[i] ?? 0) + (zVol[i] ?? 0),
    latestPrice: d.latestPrice,
    latestVolume: d.latestVolume
  }));

  // 4. Regime classifier (per Athena packet spec)
  // Use 0050 as market proxy (if available in universe; else default "sideways")
  const etf0050 = symbolData.find((d) => d.symbol === "0050");
  let regime = "sideways";
  let exposureWeight = 0.5;

  // We only have trailing 20d return for individual stocks; for regime we use
  // the 0050 ETF as market proxy, or fall back to first-pass median.
  const medianRet = [...symbolData]
    .map((d) => d.trailRet20d)
    .sort((a, b) => a - b)[Math.floor(symbolData.length / 2)] ?? 0;

  const marketRet20d = etf0050?.trailRet20d ?? medianRet;
  // Simplified regime (60d not available in 30-day window — use 20d proxy):
  // vol20 percentile approximated by volRatio distribution
  const volRatios = symbolData.map((d) => d.volRatio5v20).sort((a, b) => a - b);
  const volPctile = volRatios[Math.floor(volRatios.length * 0.95)] ?? 0;
  const breadthPositive = symbolData.filter((d) => d.trailRet20d > 0).length / symbolData.length;

  if (volPctile > 2.0 && marketRet20d < -0.10) {
    regime = "crisis";
    exposureWeight = 0.00;
  } else if (marketRet20d < -0.05) {
    regime = "risk_off";
    exposureWeight = 0.20;
  } else if (marketRet20d > 0.05 && breadthPositive > 0.70) {
    regime = "risk_on";
    exposureWeight = 1.00;
  } else {
    regime = "sideways";
    exposureWeight = 0.50;
  }

  console.log(`[s1-signal] regime=${regime} exposureWeight=${exposureWeight} marketRet20d=${marketRet20d.toFixed(4)}`);

  // 5. Top-8 tradable selection
  //
  // Board-lot sizing can turn a high-priced candidate into 0 shares
  // (for example when one 1,000-share lot costs more than the per-name
  // target). The production basket must not count those as usable S1
  // positions, so keep walking the ranked list until we have eight entries
  // that can actually submit at least one board lot.
  const desiredBasketSize = exposureWeight > 0 ? 8 : 0;
  const rankedCandidates = [...scored].sort((a, b) => b.score_cont_liq - a.score_cont_liq);

  // 6. Order sizing (per Athena packet + latest S1 SIM capital subscription)
  const capitalConfig = await resolveS1SimCapitalTwd(workspaceId);
  const CAPITAL_TWD = capitalConfig.capitalTwd;
  failsafe_notes.push(
    `capital_source:${capitalConfig.source}` +
      (capitalConfig.subscriptionId ? ` subscription:${capitalConfig.subscriptionId}` : ""),
  );
  const longTarget = CAPITAL_TWD * exposureWeight;
  const perNameTarget = desiredBasketSize > 0 ? longTarget / desiredBasketSize : 0;

  const basket: S1BasketEntry[] = [];
  const skippedUntradable: string[] = [];

  for (const s of desiredBasketSize > 0 ? rankedCandidates : []) {
    const price = s.latestPrice ?? 0;
    const rawShares = price > 0 ? perNameTarget / price : 0;
    const boardLotShares = roundDownBoardLot(rawShares);
    const actualNotional = boardLotShares * price;

    // Capacity check: 2% ADV20 soft cap
    // We don't have ADV20 from FinMind here (only bars used for signal)
    // Use 5d avg volume × price as ADV20 proxy
    const adv5 = s.latestVolume ?? 0;
    const adv20Proxy = adv5 * price;
    const adv2pct = adv20Proxy * 0.02;
    const adv5pct = adv20Proxy * 0.05;

    let sizingNote = "SIZED";
    let finalShares = boardLotShares;

    if (adv20Proxy > 0 && actualNotional > adv5pct) {
      // Hard cap at 5% ADV
      finalShares = roundDownBoardLot((adv5pct / price));
      sizingNote = "HARD_CAP_5PCT_ADV";
    } else if (adv20Proxy > 0 && actualNotional > adv2pct) {
      sizingNote = "SOFT_FLAG_2PCT_ADV";
    }

    const entry: S1BasketEntry = {
      rank: basket.length + 1,
      symbol: s.symbol,
      score_cont_liq: parseFloat(s.score_cont_liq.toFixed(4)),
      z_volratio: parseFloat(s.z_volratio.toFixed(4)),
      z_trailret20d: parseFloat(s.z_trailret20d.toFixed(4)),
      latest_price: price > 0 ? price : null,
      target_notional_twd: parseFloat((finalShares * price).toFixed(0)),
      target_shares: finalShares,
      sizing_note: sizingNote
    };

    if (exposureWeight > 0 && entry.target_shares <= 0) {
      skippedUntradable.push(`${entry.symbol}:zero_board_lot price=${price} per_name_target=${perNameTarget.toFixed(0)} note=${sizingNote}`);
      continue;
    }

    basket.push(entry);
    if (basket.length >= desiredBasketSize) break;
  }

  if (skippedUntradable.length > 0) {
    failsafe_notes.push(`skipped_untradable_zero_share:${skippedUntradable.join("|")}`);
  }
  if (exposureWeight > 0 && basket.length < desiredBasketSize) {
    failsafe_notes.push(`tradable_basket_shortfall:${basket.length}/${desiredBasketSize}`);
  }

  // 7. Write basket JSON
  const basketObj: S1Basket = {
    schema: "s1_sim_basket_v1",
    generated_at_tst: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).replace(" ", "T") + "+08:00",
    signal_date: todayTst,
    regime,
    exposure_weight: exposureWeight,
    capital_twd: CAPITAL_TWD,
    long_target_twd: longTarget,
    per_name_target_twd: perNameTarget,
    basket,
    universe_count: symbolData.length,
    failsafe_notes
  };

  const basketPath = join(reportsBase(), "s1_sim_basket", `${todayTst}.json`);
  try {
    await writeJson(basketPath, basketObj);
    console.log(`[s1-signal] basket written to ${basketPath}`);
  } catch (e) {
    console.error("[s1-signal] failed to write basket JSON:", e instanceof Error ? e.message : String(e));
  }
  await writeS1ObservationAudit({
    workspaceId,
    action: S1_AUDIT_ACTIONS.signalGenerated,
    tradingDate: todayTst,
    data: basketObj,
  });

  console.log(`[s1-signal] DONE regime=${regime} basket=[${basket.map((s) => s.symbol).join(",")}] skipped=${skippedUntradable.length}`);
}

export async function ensureS1BasketBeforeOrderSubmit(): Promise<S1SignalCatchupResult> {
  const todayTst = taipeiDateStr();
  const existing = await readS1BasketForDate(todayTst);
  if (existing) return "existing_today_basket";

  if (!isS1OrderSubmitWindow()) {
    return "skipped_outside_order_window";
  }

  console.warn("[s1-order] today basket missing inside order window; auto-generating signal before SIM submit");
  await runS1SignalTick({ force: true });

  const generated = await readS1BasketForDate(todayTst);
  return generated ? "generated_today_basket" : "missing_after_signal";
}

// ---------------------------------------------------------------------------
// B. KGI SIM order submitter
// ---------------------------------------------------------------------------

/**
 * Read today's basket and submit each entry to KGI SIM via the gateway client.
 * If the signal window was missed but the Tuesday order window is open, the
 * runner generates today's basket first. It never submits stale prior-day
 * baskets.
 *
 * Retry: 3x exponential backoff per order (200ms, 400ms, 800ms).
 * Fail-safe: rejection → log + NO auto-retry (per Athena spec).
 */
export async function runS1OrderSubmitTick(): Promise<void> {
  const todayTst = taipeiDateStr();

  if (_orderSubmitLastFiredDate === todayTst) {
    console.log("[s1-order] already fired today, skipping");
    return;
  }
  _orderSubmitLastFiredDate = todayTst;

  const failsafe_notes: string[] = [];
  console.log(`[s1-order] START trading_date=${todayTst}`);

  // 1. Ensure today's basket exists through the automatic path.
  const catchupResult = await ensureS1BasketBeforeOrderSubmit();
  failsafe_notes.push(`signal_catchup:${catchupResult}`);

  let basket: S1Basket | null = await readS1BasketForDate(todayTst);
  const basketDate = todayTst;

  if (!basket) {
    console.warn("[s1-order] no today basket found after auto catch-up — skipping order submit");
    failsafe_notes.push("no_today_basket_found: signal runner did not produce today's basket");
    _orderSubmitLastFiredDate = ""; // allow retry
    return;
  }

  console.log(`[s1-order] using basket from ${basketDate}`);

  if (basket.basket.length === 0) {
    console.warn("[s1-order] basket is empty (likely crisis regime / no exposure) — skipping");
    failsafe_notes.push(`regime=${basket.regime} exposure=${basket.exposure_weight} → no orders`);
    return;
  }

  // 2. Connect to KGI gateway
  const { KgiGatewayClient, KgiGatewayUnreachableError } = await import("./broker/kgi-gateway-client.js");
  const gatewayUrl = kgiGatewayUrl();
  const client = new KgiGatewayClient({ gatewayBaseUrl: gatewayUrl, connectTimeoutMs: 10_000 });

  // 3. Login (simulation=true)
  const personId = process.env["KGI_PERSON_ID"] ?? "";
  const personPwd = process.env["KGI_PERSON_PWD"] ?? "";
  const accountId = process.env["KGI_ACCOUNT"] ?? "0012826";

  if (!personId || !personPwd) {
    console.warn("[s1-order] KGI_PERSON_ID / KGI_PERSON_PWD not set — skipping order submit");
    failsafe_notes.push("credentials_missing: KGI_PERSON_ID or KGI_PERSON_PWD not set in env");
    _orderSubmitLastFiredDate = ""; // allow retry when configured
    return;
  }

  try {
    await client.login({ personId, personPwd, simulation: true });
    console.log("[s1-order] KGI SIM login OK");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[s1-order] login failed:", msg);
    failsafe_notes.push(`login_failed: ${msg}`);
    _orderSubmitLastFiredDate = ""; // allow retry
    return;
  }

  // Set account
  try {
    await client.setAccount(accountId);
    console.log(`[s1-order] set-account OK account=${accountId.slice(0, 3)}***`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[s1-order] set-account failed (non-fatal, may proceed):", msg);
    failsafe_notes.push(`set_account_failed: ${msg}`);
  }

  // 4. Submit orders
  const orderResults: S1OrderSubmitResult["results"] = [];

  for (const entry of basket.basket) {
    if (entry.target_shares <= 0) {
      console.log(`[s1-order] ${entry.symbol} shares=0, skipping`);
      orderResults.push({
        symbol: entry.symbol,
        shares: 0,
        status: "skipped",
        trade_id: null,
        error: "zero_shares"
      });
      continue;
    }

    // Retry loop: 3x with exponential backoff
    let accepted = false;
    let tradeId: string | null = null;
    let brokerStatus: S1OrderSubmitResult["results"][number]["status"] = "unconfirmed";
    let filledShares = 0;
    let remainingShares = entry.target_shares;
    let avgFillPrice: number | null = null;
    let settlementSource = "submission_only";
    let settlementConfirmed = false;
    let confirmedAt: string | null = null;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const tradeRaw = await client.createOrder({
          action: "Buy",
          symbol: entry.symbol,
          qty: entry.target_shares,
          price: undefined, // MARKET order
          timeInForce: "ROD",
          orderCond: "Cash",
          oddLot: false,
          name: "S1_SIM_AUTO"
        });

        const tradeRecord = tradeRaw as Record<string, unknown>;
        tradeId = extractKgiTradeId(tradeRecord["trade_id"])
          ?? extractKgiTradeId(tradeRecord["broker_order_id"])
          ?? extractKgiTradeId(tradeRecord["kgi_response_repr"])
          ?? extractKgiTradeId(tradeRecord);

        accepted = true;
        console.log(`[s1-order] ${entry.symbol} qty=${entry.target_shares} accepted tradeId=${tradeId ?? "null"}`);
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (e instanceof KgiGatewayUnreachableError && attempt < 3) {
          // Exponential backoff: 200ms, 400ms
          await new Promise((r) => setTimeout(r, 200 * attempt));
          console.warn(`[s1-order] ${entry.symbol} attempt ${attempt} failed: ${lastError} — retrying`);
        } else {
          // KGI SIM rejection → log + NO auto-retry (Athena spec)
          console.error(`[s1-order] ${entry.symbol} REJECTED after ${attempt} attempt(s): ${lastError}`);
          break;
        }
      }
    }

    if (accepted) {
      for (let poll = 0; poll < 3; poll++) {
        await new Promise((r) => setTimeout(r, 1_500));
        try {
          const [events, trades, deals] = await Promise.all([
            client.getRecentOrderEvents(100).catch(() => []),
            client.getTrades(false).catch(() => null),
            client.getDeals().catch(() => null),
          ]);
          const reconciled = reconcileKgiOrder({
            order: {
              tradeId,
              symbol: entry.symbol,
              side: "buy",
              requestedQty: entry.target_shares,
            },
            events,
            trades,
            deals,
          });
          brokerStatus = reconciled.status;
          filledShares = reconciled.filledQty;
          remainingShares = reconciled.remainingQty;
          avgFillPrice = reconciled.avgFillPrice;
          settlementSource = reconciled.settlementSource;
          settlementConfirmed = reconciled.settlementConfirmed;
          confirmedAt = reconciled.confirmedAt;
          if (reconciled.brokerReportConfirmed) {
            console.log(
              `[s1-order] ${entry.symbol} broker ${reconciled.status} ` +
              `filled=${reconciled.filledQty}/${reconciled.requestedQty} source=${reconciled.settlementSource}`
            );
            break;
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      }
      if (!settlementConfirmed && brokerStatus === "unconfirmed") {
        lastError = "matching_broker_report_not_received";
      }
    }

    orderResults.push({
      symbol: entry.symbol,
      shares: entry.target_shares,
      status: accepted ? brokerStatus : "rejected",
      trade_id: tradeId,
      filled_shares: filledShares,
      remaining_shares: remainingShares,
      avg_fill_price: avgFillPrice,
      settlement_source: settlementSource,
      settlement_confirmed: settlementConfirmed,
      confirmed_at: confirmedAt,
      error: accepted && brokerStatus === "unconfirmed" ? lastError : accepted ? null : lastError
    });
  }

  // 5. Write submit result
  const submitResult: S1OrderSubmitResult = {
    schema: "s1_order_submit_v1",
    submitted_at_tst: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).replace(" ", "T") + "+08:00",
    trading_date: todayTst,
    basket_date: basketDate,
    orders_attempted: orderResults.filter((r) => r.status !== "skipped").length,
    // KGI SIM never returns a broker fill report — submitted orders stay "unconfirmed"
    // forever. Count "unconfirmed" as accepted (submission reached the broker) so the
    // counter reflects real activity rather than showing 0 when 8 orders went through.
    orders_accepted: orderResults.filter((r) => ["accepted", "filled", "partially_filled", "cancelled", "unconfirmed"].includes(r.status)).length,
    orders_rejected: orderResults.filter((r) => r.status === "rejected").length,
    results: orderResults,
    failsafe_notes
  };

  const submitPath = join(reportsBase(), "s1_sim_daily", `${todayTst}_orders.json`);
  try {
    await writeJson(submitPath, submitResult);
    console.log(`[s1-order] submit result written to ${submitPath}`);
  } catch (e) {
    console.error("[s1-order] failed to write submit JSON:", e instanceof Error ? e.message : String(e));
  }
  const workspaceId = await resolveS1WorkspaceId();
  if (workspaceId) {
    await writeS1ObservationAudit({
      workspaceId,
      action: S1_AUDIT_ACTIONS.ordersSubmitted,
      tradingDate: todayTst,
      data: submitResult,
    });
  }

  const accepted = orderResults.filter((r) => ["accepted", "filled", "partially_filled", "cancelled"].includes(r.status)).length;
  const rejected = orderResults.filter((r) => r.status === "rejected").length;
  console.log(`[s1-order] DONE accepted=${accepted} rejected=${rejected} skipped=${orderResults.length - accepted - rejected}`);
}

// ---------------------------------------------------------------------------
// C. Daily EOD mark-to-market report (14:00 TST)
// ---------------------------------------------------------------------------

/**
 * Fetch KGI SIM positions, mark-to-market, write daily report.
 * Uses gateway /position endpoint. Falls back to order submit file if gateway unavailable.
 */
type S1PositionRow = {
  symbol: string;
  shares: number;
  avg_cost: number;
  last_price: number | null;
  unrealized_pnl_twd: number | null;
  market_value_twd: number | null;
};

export interface S1PositionsSnapshot {
  positions: S1PositionRow[];
  dataSource: string;
  notes: string[];
  /** Trading date the positions belong to (last rebalance Tuesday, or today). */
  positionsDate: string;
  cashResidualTwd: number;
  totalUnrealizedPnlTwd: number | null;
  totalMarketValueTwd: number | null;
  pricedPositionCount: number;
  pricingComplete: boolean;
}

/**
 * Builds the current S1 holdings view. Shared by the daily EOD report and the
 * trading-room portfolio endpoint (B3) — single source of truth for the
 * gateway → audit-rebuild → order-file source chain (audit R4).
 */
export async function buildS1PositionsSnapshot(): Promise<S1PositionsSnapshot> {
  const todayTst = taipeiDateStr();
  const notes: string[] = [];

  // 0. Rebuild this week's positions from the durable audit log FIRST.
  // S1 is weekly: positions entered on Tuesday carry until the next rebalance.
  // KGI SIM session positions are ephemeral (EC2 stops 14:10 / any relogin resets
  // them), so the gateway legitimately answers [] mid-week — that must never be
  // recorded as "no positions" (6/10 audit R4: 跨日持倉失真).
  const lookbackFrom = taipeiDateStr(-7);
  const latestOrdersAudit = await readLatestS1ObservationAuditInWindow<S1OrderSubmitResult>(
    S1_AUDIT_ACTIONS.ordersSubmitted,
    { from: lookbackFrom, to: todayTst },
  );
  const positionsDate = latestOrdersAudit?.tradingDate ?? todayTst;

  // Basket of the same trading date — entry-price estimates + cash residual.
  let basketForResidual: S1Basket | null = null;
  try {
    const basketPath = join(reportsBase(), "s1_sim_basket", `${positionsDate}.json`);
    const raw = await fs.readFile(basketPath, "utf-8");
    basketForResidual = JSON.parse(raw) as S1Basket;
  } catch {
    // File gone (redeploy) — try audit log
    basketForResidual = await readS1ObservationAudit<S1Basket>(
      S1_AUDIT_ACTIONS.signalGenerated,
      positionsDate,
    );
  }
  const entryBySymbol = new Map((basketForResidual?.basket ?? []).map((e) => [e.symbol, e]));

  const auditPositionCandidates = latestOrdersAudit?.data.results ?? [];
  // S1 runs in KGI SIM only (prod_write_blocked=true). The SIM gateway accepts
  // orders but never returns a broker fill/deal report, so an order stays
  // "accepted"/"unconfirmed" forever — in SIM that IS the simulated holding.
  // #1089's filled-only filter therefore zeroed the whole F-AUTO portfolio
  // (6/17 repro: 8 accepted 6/16 orders → 0 positions). Count accepted/
  // unconfirmed as held in SIM; prefer a real fill's shares/price when present.
  const HELD_STATUSES = new Set(["filled", "partially_filled", "accepted", "unconfirmed"]);
  const auditPositions: S1PositionRow[] = auditPositionCandidates
    .filter((r) => HELD_STATUSES.has(r.status))
    .map((r) => ({
      symbol: r.symbol,
      // filled_shares is 0 (not null) when KGI SIM never sends a fill report.
      // `0 ?? r.shares` returns 0 because ?? only replaces null/undefined.
      // Use basket target_shares (r.shares) as the share count for SIM-held orders
      // that never received a real fill — that is the intended notional quantity.
      shares: (r.filled_shares != null && r.filled_shares > 0) ? r.filled_shares : r.shares,
      avg_cost: r.avg_fill_price ?? entryBySymbol.get(r.symbol)?.latest_price ?? 0,
      last_price: null,
      unrealized_pnl_twd: null,
      market_value_twd: null,
    }));
  // Only genuinely non-held outcomes are excluded from the holdings rebuild.
  const unconfirmedAuditOrders = auditPositionCandidates.filter(
    (r) => r.status === "rejected" || r.status === "skipped" || r.status === "cancelled"
  );

  // 1. Fetch positions from KGI gateway (live prices when the session still has them)
  const { KgiGatewayClient } = await import("./broker/kgi-gateway-client.js");
  const client = new KgiGatewayClient({ gatewayBaseUrl: kgiGatewayUrl(), connectTimeoutMs: 10_000 });

  let positions: S1PositionRow[] = [];
  let dataSource = "kgi_gateway";

  try {
    const rawPositions = await client.getPosition();
    const gatewayPositions = rawPositions
      .filter((p) => p.netQuantity !== 0)
      .map((p) => ({
        symbol: p.symbol,
        shares: p.netQuantity,
        // BUG-11 fix: KGI gateway `lastPrice` is the current market price, NOT the
        // entry cost. Use basket entry price as avg_cost when available; fall back
        // to gateway lastPrice only if no basket data exists.
        avg_cost: entryBySymbol.get(p.symbol)?.latest_price ?? p.lastPrice ?? 0,
        last_price: p.lastPrice ?? null,
        unrealized_pnl_twd: p.unrealized !== undefined ? p.unrealized : null,
        market_value_twd: p.lastPrice !== undefined && p.lastPrice !== null
          ? p.netQuantity * p.lastPrice
          : null,
      }));

    if (auditPositions.length > 0) {
      // S1/F-AUTO is a strategy portfolio, not a raw KGI-account viewer. A
      // gateway account may contain unrelated manual odd-lot SIM positions
      // (6/17 repro: raw 0050 x2) and must not hide the Tuesday S1 basket.
      // Use durable S1 audit as the holdings set, then enrich same-symbol rows
      // with gateway last price / PnL when available.
      const gatewayBySymbol = new Map(gatewayPositions.map((p) => [p.symbol, p]));
      let enriched = 0;
      positions = auditPositions.map((auditPosition) => {
        const gatewayPosition = gatewayBySymbol.get(auditPosition.symbol);
        if (!gatewayPosition) return auditPosition;
        enriched += 1;
        const lastPrice = gatewayPosition.last_price ?? auditPosition.last_price;
        return {
          ...auditPosition,
          last_price: lastPrice,
          unrealized_pnl_twd: gatewayPosition.unrealized_pnl_twd ?? auditPosition.unrealized_pnl_twd,
          market_value_twd:
            lastPrice == null ? auditPosition.market_value_twd : auditPosition.shares * lastPrice,
        };
      });
      dataSource = enriched > 0 ? "audit_log_rebuild_with_gateway_marks" : "audit_log_rebuild";
      notes.push(`s1_audit_primary: rebuilt ${auditPositions.length} S1 holdings from ${positionsDate} submitted SIM orders`);
      if (enriched > 0) {
        notes.push(`gateway_marks_applied: enriched ${enriched}/${auditPositions.length} S1 holdings with matching KGI gateway rows`);
      }
      const strategySymbols = new Set(auditPositions.map((p) => p.symbol));
      const extraGatewaySymbols = gatewayPositions
        .map((p) => p.symbol)
        .filter((symbol) => !strategySymbols.has(symbol));
      if (extraGatewaySymbols.length > 0) {
        notes.push(`gateway_extra_positions_ignored_for_s1: ${extraGatewaySymbols.join(",")}`);
      }
    } else if (gatewayPositions.length > 0) {
      positions = gatewayPositions;
      dataSource = "kgi_gateway";
      notes.push(`gateway_positions_without_s1_audit: ${gatewayPositions.length} gateway positions shown because no S1 audit holdings were found`);
    } else if (unconfirmedAuditOrders.length > 0) {
      notes.push(`gateway_empty_nonheld_orders: ${unconfirmedAuditOrders.length} rejected/skipped/cancelled submitted orders exist; not counted as holdings`);
    } else {
      console.log(`[s1-eod] fetched ${positions.length} positions from KGI gateway`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[s1-eod] gateway unavailable: ${msg} — rebuilding from audit`);
    notes.push(`gateway_unavailable: ${msg}`);

    if (auditPositions.length > 0) {
      positions = auditPositions;
      dataSource = "audit_log_fallback";
      notes.push(`positions_from_audit_log: rebuilt ${auditPositions.length} S1 holdings from ${positionsDate} submitted SIM orders`);
    } else if (unconfirmedAuditOrders.length > 0) {
      notes.push(`orders_not_held: ${unconfirmedAuditOrders.length} rejected/skipped/cancelled orders are not counted as holdings`);
    } else {
      // Legacy fallback: today's order submit file (ephemeral — may be gone after redeploy)
      dataSource = "order_file_fallback";
      const orderPath = join(reportsBase(), "s1_sim_daily", `${todayTst}_orders.json`);
      try {
        const raw = await fs.readFile(orderPath, "utf-8");
        const orderResult = JSON.parse(raw) as S1OrderSubmitResult;
        notes.push("positions_from_order_file: avg_cost and last_price unknown without KGI fill confirmation");
        positions = orderResult.results
          .filter((r) => HELD_STATUSES.has(r.status))
          .map((r) => ({
            symbol: r.symbol,
            shares: r.filled_shares ?? r.shares,
            avg_cost: r.avg_fill_price ?? 0,
            last_price: null,
            unrealized_pnl_twd: null,
            market_value_twd: null
          }));
      } catch {
        notes.push("no_order_file_found: positions unknown (file ephemeral, no audit_log entry in 7-day window)");
      }
    }
  }

  // 1b. Mark-to-market all positions with EOD closes (best effort).
  // Runs for both audit-rebuilt AND gateway-sourced positions:
  //   - For audit_log_rebuild/fallback: last_price is null, must be filled.
  //   - For kgi_gateway: BUG-11 fix — after EC2 stops at 14:10, gateway
  //     `lastPrice` may be a mid-session tick, not the official closing price.
  //     Overwrite last_price with TWSE/TPEX EOD close for accurate valuation.
  //     Also recalculate unrealized_pnl_twd from (close - avg_cost) * shares
  //     so it's consistent with the official close, not the gateway's unrealized.
  // S1 holdings span listed (TWSE) and OTC (TPEX) symbols — a TWSE-only price
  // map leaves OTC positions (e.g. 5701) permanently un-priced (last_price=null
  // forever), which in turn nulls out the whole-portfolio totals below.
  let officialCloseMarkedCount = 0;
  if (positions.length > 0) {
    try {
      // TPEX closes via the shared cached getter — the 6/11 inline fetch used
      // a 3s timeout on the ~4MB payload, which silently timed out from
      // Railway (europe-west4) and left OTC symbols unpriced with no trace.
      const { getStockDayAllRows, getTpexMainboardCloseRows } = await import("./data-sources/twse-openapi-client.js");

      const [stockRows, tpexRows] = await Promise.all([
        getStockDayAllRows(),
        getTpexMainboardCloseRows(),
      ]);

      // YELLOW-1 fix: validate TWSE STOCK_DAY_ALL date before using it.
      // TWSE publishes today's official closes at ~14:30-15:00 TST. Before that
      // window the endpoint still serves YESTERDAY's data. If we detect that
      // stockRows[0].Date (ROC "115/06/30") maps to a date other than today,
      // skip the entire mark-to-market pass so pricingComplete stays false and
      // the 15-min scheduler retry can try again after TWSE publishes.
      //
      // Concrete failure mode (6/30 observed): at 14:08 TST, STOCK_DAY_ALL
      // returned yesterday's close. The S1 basket entry price (avg_cost) is also
      // yesterday's close. mark-to-market set last_price = yesterday close = avg_cost
      // → unrealized = 0, officialCloseMarkedCount = 8 = positions.length →
      // pricingComplete = true → _eodLastFiredDate locked today → NO more retries.
      const stockDateRaw = (stockRows[0] as { Date?: string } | undefined)?.Date?.trim() ?? "";
      const stockDateIso = (() => {
        const parts = stockDateRaw.split("/");
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10) + 1911;
          if (isFinite(y) && y > 1900) {
            return `${y}-${(parts[1] ?? "").padStart(2, "0")}-${(parts[2] ?? "").padStart(2, "0")}`;
          }
        }
        return null;
      })();
      if (stockDateIso && stockDateIso !== todayTst) {
        notes.push(
          `twse_eod_stale: STOCK_DAY_ALL data_date=${stockDateIso} != today=${todayTst}` +
          ` — mark-to-market skipped, will retry after TWSE publishes today's closes`
        );
        // Fall through with officialCloseMarkedCount=0 → pricingComplete=false → retry enabled.
      } else {
        // TWSE data is fresh (or no date to check) — proceed with mark-to-market.
        if (tpexRows.length === 0) {
          notes.push("tpex_eod_unavailable: OTC closes missing (fetch failed or empty) — OTC positions stay unpriced");
        }

        const closeBySymbol = new Map(stockRows.map((r) => [r.Code?.trim(), parseFloat(r.ClosingPrice)]));
        for (const row of tpexRows) {
          const code = row.SecuritiesCompanyCode?.trim();
          if (!code || closeBySymbol.has(code)) continue; // TWSE takes precedence
          const close = parseFloat(row.Close ?? "");
          if (isFinite(close)) closeBySymbol.set(code, close);
        }

        let marked = 0;
        for (const p of positions) {
          const close = closeBySymbol.get(p.symbol);
          if (close !== undefined && isFinite(close) && close > 0) {
            p.last_price = close;
            p.market_value_twd = Math.round(p.shares * close);
            if (p.avg_cost > 0) p.unrealized_pnl_twd = Math.round((close - p.avg_cost) * p.shares);
            marked++;
          }
        }
        officialCloseMarkedCount = marked;
        if (marked > 0) notes.push(`mark_to_market: last_price for ${marked}/${positions.length} positions from TWSE+TPEX EOD closes`);

        // 1b-persist: write successfully priced S1 positions to quote_last_close.
        // Enables the DB fallback (step 1d) to recover on next restart/盤後 gap.
        // Source determined per-symbol: TWSE STOCK_DAY_ALL takes precedence over TPEX.
        if (marked > 0) {
          const twseSymbolSet = new Set(stockRows.map((r) => r.Code?.trim()).filter(Boolean) as string[]);
          const toWrite: LastCloseEntry[] = positions
            .filter((p) => p.last_price !== null && closeBySymbol.has(p.symbol))
            .map((p) => ({
              symbol:     p.symbol,
              closePrice: p.last_price!,
              tradeDate:  todayTst,
              source:     (twseSymbolSet.has(p.symbol) ? "twse_eod" : "tpex_eod") as LastCloseEntry["source"],
            }));
          const dbForWrite = getDb();
          if (dbForWrite && toWrite.length > 0) {
            upsertLastCloses(dbForWrite, toWrite).catch((e: unknown) => {
              console.warn("[s1-eod] persisted_close write failed:", e instanceof Error ? e.message : String(e));
            });
          }
        }
      }
    } catch {
      notes.push("mark_to_market_unavailable: TWSE/TPEX EOD fetch failed");
    }
  }

  // 1c. MIS fallback: price any positions still null after TWSE+TPEX mark-to-market.
  // YELLOW-2 fix: 1435/2483/6226 (all likely TPEX-listed) were absent from both
  // STOCK_DAY_ALL (TWSE only) and getTpexMainboardCloseRows() at 16:12 TST, yet
  // the individual quote endpoint had them via MIS (tse_/otc_ dual-try). MIS keeps
  // the official 13:30 session close available post-market with today's trade date,
  // making it equivalent to TWSE/TPEX official EOD for pricing purposes.
  //
  // Strategy: serial fetch per unpriced symbol, try tse_ prefix first then otc_.
  // Uses 4s timeout and fail-open — a failed MIS fetch just leaves last_price=null
  // for that symbol (reported in notes, no exception propagated).
  // Does NOT update officialCloseMarkedCount — pricingComplete remains governed by
  // TWSE+TPEX official mark count, preserving the stale-data retry semantics above.
  const stillNullPositions = positions.filter((p) => p.last_price === null);
  if (stillNullPositions.length > 0) {
    const todayYmd = todayTst.replace(/-/g, ""); // "2026-06-30" → "20260630"
    const _misParseNum = (s?: string): number | null => {
      if (!s || s === "-" || s.trim() === "") return null;
      const n = Number(s.replace(/,/g, "").trim());
      return isFinite(n) && n > 0 ? n : null;
    };
    for (const p of stillNullPositions) {
      let maked = false;
      for (const prefix of ["tse", "otc"] as const) {
        if (maked) break;
        try {
          const exCh = encodeURIComponent(`${prefix}_${p.symbol}.tw`);
          const resp = await fetch(
            `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}&json=1&delay=0`,
            { signal: AbortSignal.timeout(4_000), headers: { Accept: "application/json" } }
          );
          if (!resp.ok) continue;
          const data = await resp.json() as { msgArray?: Array<Record<string, string>>; rtcode?: string };
          if (data.rtcode !== "0000" || !data.msgArray?.length) continue;
          const msg = data.msgArray[0];
          if (!msg) continue;
          // MIS date guard: "d" field is "20260630" — must match today
          if ((msg["d"] ?? "").replace(/-/g, "") !== todayYmd) continue;
          const bPrices = msg["b"]?.split("_").filter(Boolean);
          const aPrices = msg["a"]?.split("_").filter(Boolean);
          const last = _misParseNum(msg["z"]) ?? _misParseNum(bPrices?.[0]) ?? _misParseNum(aPrices?.[0]);
          if (last === null) continue;
          p.last_price = last;
          p.market_value_twd = Math.round(p.shares * last);
          if (p.avg_cost > 0) p.unrealized_pnl_twd = Math.round((last - p.avg_cost) * p.shares);
          notes.push(`mis_close_fallback: ${p.symbol} priced ${last} via MIS ${prefix}_ (TWSE/TPEX EOD absent)`);
          maked = true;
        } catch {
          // fail-open: next prefix or next symbol
        }
      }
    }

    // 1c-persist: write MIS-priced positions to quote_last_close.
    // MIS post-session close is date-validated above (d === todayYmd), so it is
    // equivalent to TWSE/TPEX official EOD for mark-to-market purposes.
    const misPriced = stillNullPositions.filter((p) => p.last_price !== null);
    if (misPriced.length > 0) {
      const dbForMis = getDb();
      if (dbForMis) {
        const misEntries: LastCloseEntry[] = misPriced.map((p) => ({
          symbol:     p.symbol,
          closePrice: p.last_price!,
          tradeDate:  todayTst,
          source:     "mis_close" as const,
        }));
        upsertLastCloses(dbForMis, misEntries).catch((e: unknown) => {
          console.warn("[s1-eod] mis persisted_close write failed:", e instanceof Error ? e.message : String(e));
        });
      }
    }
  }

  // 1d. DB persisted close fallback: last resort after TWSE+TPEX+MIS all fail.
  // Reads quote_last_close written by previous successful pricing passes.
  // Recovers after deploy restart or 盤後 data-supplier gap without null market values.
  // Note clearly labeled in notes as 'persisted_close_fallback' with data_date so the
  // frontend can show the appropriate staleness indicator rather than pretending it's live.
  {
    const stillNullAfterAll = positions.filter((p) => p.last_price === null);
    if (stillNullAfterAll.length > 0) {
      const dbForFallback = getDb();
      if (dbForFallback) {
        try {
          const stored = await getLastCloses(dbForFallback, stillNullAfterAll.map((p) => p.symbol));
          for (const p of stillNullAfterAll) {
            const entry = stored.get(p.symbol);
            if (!entry) continue;
            p.last_price = entry.closePrice;
            p.market_value_twd = Math.round(p.shares * entry.closePrice);
            if (p.avg_cost > 0) p.unrealized_pnl_twd = Math.round((entry.closePrice - p.avg_cost) * p.shares);
            notes.push(
              `persisted_close_fallback: ${p.symbol} priced ${entry.closePrice} from DB` +
              ` (trade_date=${entry.tradeDate}, source=${entry.source})`
            );
          }
        } catch {
          notes.push("persisted_close_fallback_failed: DB read error — positions remain null");
        }
      }
    }
  }

  // Totals: partial-sum over priced positions rather than requiring full
  // coverage — an OTC symbol with no price for the day no longer nulls out
  // the whole portfolio's market value / unrealized P&L.
  const pricedPositions = positions.filter((p) => p.last_price !== null);
  // Completion: every holding has a valid closing price from any authoritative
  // source (TWSE+TPEX official closes or MIS post-session close). The shifted
  // window (14:45+) ensures all three are equivalent representations of the
  // 13:30 session close. For retries driven by stale TWSE data (YELLOW-1 guard
  // above), officialCloseMarkedCount=0 even if MIS prices all positions, keeping
  // pricingComplete=false until TWSE publishes fresh data.
  const pricingComplete = positions.length > 0 &&
    officialCloseMarkedCount > 0 &&
    pricedPositions.length === positions.length;
  const unrealizedKnownPositions = positions.filter((p) => p.unrealized_pnl_twd !== null);
  const totalUnrealized = unrealizedKnownPositions.length > 0
    ? unrealizedKnownPositions.reduce((s, p) => s + (p.unrealized_pnl_twd ?? 0), 0)
    : null;
  const totalMarketValue = pricedPositions.length > 0
    ? pricedPositions.reduce((s, p) => s + (p.market_value_twd ?? 0), 0)
    : null;
  if (positions.length > 0 && pricedPositions.length < positions.length) {
    notes.push(`mark_to_market_coverage: ${pricedPositions.length}/${positions.length} positions priced`);
  }

  // Estimated cash residual from the basket that the current positions belong to.
  let cashResidual = S1_DEFAULT_CAPITAL_TWD; // assume default capital undeployed until basket found
  if (basketForResidual) {
    const deployed = basketForResidual.basket.reduce((s, e) => s + e.target_notional_twd, 0);
    cashResidual = basketForResidual.capital_twd - deployed;
  } else {
    notes.push("basket_not_found: cash_residual is estimated as full capital");
  }

  return {
    positions,
    dataSource,
    notes,
    positionsDate,
    cashResidualTwd: cashResidual,
    totalUnrealizedPnlTwd: totalUnrealized,
    totalMarketValueTwd: totalMarketValue,
    pricedPositionCount: pricedPositions.length,
    pricingComplete,
  };
}

export async function runS1EodReportTick(): Promise<void> {
  if (_eodRunInFlight) {
    console.log("[s1-eod] EOD run already in flight, waiting");
    await _eodRunInFlight;
    return;
  }

  _eodRunInFlight = runS1EodReportTickOnce().finally(() => {
    _eodRunInFlight = null;
  });

  await _eodRunInFlight;
}

async function runS1EodReportTickOnce(): Promise<void> {
  const todayTst = taipeiDateStr();

  if (_eodLastFiredDate === todayTst) {
    console.log("[s1-eod] complete report already generated today, skipping");
    return;
  }

  console.log(`[s1-eod] START trading_date=${todayTst}`);
  const snapshot = await buildS1PositionsSnapshot();
  const { positions, dataSource, notes } = snapshot;
  const totalUnrealized = snapshot.totalUnrealizedPnlTwd;
  const totalMarketValue = snapshot.totalMarketValueTwd;
  const cashResidual = snapshot.cashResidualTwd;
  const completionStatus = snapshot.pricingComplete ? "complete" : "partial";
  const reportNotes = [...notes];
  if (!snapshot.pricingComplete) {
    reportNotes.push(
      `eod_partial_retry_pending: ${snapshot.pricedPositionCount}/${positions.length} positions priced; automatic scheduler will retry within the EOD window`,
    );
  }

  // 2. Write JSON report
  const report: S1EodReport = {
    schema: "s1_eod_report_v1",
    trading_date: todayTst,
    generated_at_tst: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).replace(" ", "T") + "+08:00",
    completion_status: completionStatus,
    pricing_coverage: {
      priced_positions: snapshot.pricedPositionCount,
      total_positions: positions.length,
    },
    positions,
    total_unrealized_pnl_twd: totalUnrealized,
    total_market_value_twd: totalMarketValue,
    cash_residual_estimated_twd: cashResidual,
    data_source: dataSource,
    notes: reportNotes,
  };

  // A partial mark is diagnostic evidence, not the official EOD result. Keep it
  // under a provisional filename so status/read endpoints cannot mistake a
  // 4/8 snapshot for the completed report. The canonical filename is written
  // only after every current holding has a closing price.
  const reportSuffix = snapshot.pricingComplete ? "" : "_partial";
  const reportJsonPath = join(reportsBase(), "s1_sim_daily", `${todayTst}${reportSuffix}.json`);
  const reportMdPath = join(reportsBase(), "s1_sim_daily", `${todayTst}${reportSuffix}.md`);

  let jsonWritten = false;
  try {
    await writeJson(reportJsonPath, report);
    jsonWritten = true;
  } catch (e) {
    console.error("[s1-eod] failed to write JSON report:", e instanceof Error ? e.message : String(e));
  }

  // Only complete reports enter the durable "eod_generated" audit stream.
  // Partial attempts remain provisional and retryable instead of surfacing as
  // a completed EOD observation after a redeploy.
  if (snapshot.pricingComplete) {
    const workspaceId = await resolveS1WorkspaceId();
    if (workspaceId) {
      await writeS1ObservationAudit({
        workspaceId,
        action: S1_AUDIT_ACTIONS.eodGenerated,
        tradingDate: todayTst,
        data: report,
      });
    }

    // Phase 2: live ledger writes — SIM-ONLY, fire-and-forget (never block EOD).
    // Tuesday (rebalance day): close prev week + open new week + NAV row.
    // Other weekdays: daily NAV row only.
    const taipeiMs = Date.now() + 8 * 3600 * 1000;
    const taipeiDay = new Date(taipeiMs).getUTCDay(); // 2 = Tuesday
    void (async () => {
      try {
        const { writeLiveLedgerAfterEod, writeDailyNavRow } = await import("./sim-ledger-backfill.js");
        if (taipeiDay === 2) {
          // Tuesday: full rebalance ledger write
          const ledgerResult = await writeLiveLedgerAfterEod({
            rebalanceDate: todayTst,
            currentPositions: snapshot.positions.map((p) => ({
              symbol: p.symbol,
              shares: p.shares,
              avg_cost: p.avg_cost,
              last_price: p.last_price,
              market_value_twd: p.market_value_twd,
            })),
            cashResidualTwd: snapshot.cashResidualTwd,
            totalMarketValueTwd: snapshot.totalMarketValueTwd,
          });
          console.log(
            `[s1-ledger] Tuesday rebalance ledger: written=${ledgerResult.written} ` +
            `weekNum=${ledgerResult.weekNum} realizedPnl=${ledgerResult.realizedPnlTwd} ` +
            `equity=${ledgerResult.equityAfterTwd} costs=${ledgerResult.transactionCostsTwd}`
          );
        } else {
          // Non-Tuesday: daily NAV row only (requires backfill already applied)
          await writeDailyNavRow({
            navDate: todayTst,
            cashResidualTwd: snapshot.cashResidualTwd,
            totalMarketValueTwd: snapshot.totalMarketValueTwd,
          });
          console.log(`[s1-ledger] daily NAV row written: ${todayTst}`);
        }
      } catch (e) {
        console.warn("[s1-ledger] live ledger write failed (non-fatal):", e instanceof Error ? e.message : String(e));
      }
    })();
  }

  // Markdown report
  const mdLines = [
    `# S1 SIM Day EOD Report — ${todayTst}`,
    ``,
    `Generated: ${report.generated_at_tst}  `,
    `Completion: ${report.completion_status} (${report.pricing_coverage.priced_positions}/${report.pricing_coverage.total_positions} positions priced)  `,
    `Data source: ${dataSource}  `,
    `Mode: KGI SIM forward observation (S1_IUF_LS_OMNI_SIM_OBSERVATION_PRODUCT_V0)`,
    ``,
    `## Positions`,
    ``,
    `| Symbol | Shares | Avg Cost | Last Price | Unrealized P&L (TWD) |`,
    `|--------|-------:|--------:|-----------:|--------------------:|`,
    ...positions.map((p) =>
      `| ${p.symbol} | ${p.shares.toLocaleString()} | ${p.avg_cost > 0 ? p.avg_cost.toFixed(2) : "—"} | ${p.last_price !== null ? p.last_price.toFixed(2) : "—"} | ${p.unrealized_pnl_twd !== null ? p.unrealized_pnl_twd.toFixed(0) : "—"} |`
    ),
    ``,
    `**Total unrealized P&L**: ${totalUnrealized !== null ? totalUnrealized.toFixed(0) + " TWD" : "— (data unavailable)"}  `,
    `**Total market value**: ${totalMarketValue !== null ? totalMarketValue.toFixed(0) + " TWD" : "— (data unavailable)"}  `,
    `**Estimated cash residual**: ${cashResidual.toLocaleString()} TWD`,
    ``,
    `## Notes`,
    ``,
    ...(reportNotes.length > 0 ? reportNotes.map((n) => `- ${n}`) : ["- No issues"]),
    ``,
    `---`,
    `*S1 SIM observation only. No fill confirmation, no return claim, no L5/L10 evidence. Per Yang ACK 22:34 TST 2026-05-19.*`
  ];

  try {
    await writeMd(reportMdPath, mdLines.join("\n"));
    console.log(`[s1-eod] report written: ${reportJsonPath}`);
  } catch (e) {
    console.error("[s1-eod] failed to write MD report:", e instanceof Error ? e.message : String(e));
  }

  if (snapshot.pricingComplete && jsonWritten) {
    _eodLastFiredDate = todayTst;
    console.log(
      `[s1-eod] COMPLETE positions=${positions.length} priced=${snapshot.pricedPositionCount}/${positions.length} unrealized=${totalUnrealized?.toFixed(0) ?? "unknown"}`,
    );
    return;
  }

  if (snapshot.pricingComplete) {
    console.warn("[s1-eod] complete snapshot was not persisted; leaving retry enabled");
    return;
  }

  console.warn(
    `[s1-eod] PARTIAL priced=${snapshot.pricedPositionCount}/${positions.length}; provisional report kept and retry remains enabled`,
  );
}

// ---------------------------------------------------------------------------
// Scheduler tick wrappers (exported — called from startSchedulers)
// ---------------------------------------------------------------------------

/** Tuesday ~08:30–08:50 TST: compute cont_liq signal + write basket */
export function isS1SignalWindow(): boolean {
  const hhmm = taipeiHHMM();
  // Tuesday only: check UTC weekday (Tue = 2). Weekly SIM-observation anchor
  // moved Monday→Tuesday per Yang 2026-06-02 (owner decision; forward SIM
  // observation cadence, not a backtest-matching claim).
  const taipeiMs = Date.now() + 8 * 3600 * 1000;
  const taipeiDay = new Date(taipeiMs).getUTCDay(); // 2 = Tuesday
  return taipeiDay === 2 && hhmm >= 830 && hhmm < 855;
}

/** Tuesday ~09:00–09:15 TST: submit orders */
export function isS1OrderSubmitWindow(): boolean {
  const hhmm = taipeiHHMM();
  const taipeiMs = Date.now() + 8 * 3600 * 1000;
  const taipeiDay = new Date(taipeiMs).getUTCDay();
  return taipeiDay === 2 && hhmm >= 900 && hhmm < 920;
}

/** Daily 14:45–15:30 TST weekdays: EOD report.
 *
 * Shifted from 14:00-14:30 (YELLOW-1 fix): TWSE STOCK_DAY_ALL typically
 * publishes today's official closes at 14:30-15:00 TST. Opening at 14:00
 * meant the first cron tick at ~14:08 received yesterday's data, which
 * matched avg_cost exactly (basket entry = yesterday's close) → unrealized=0
 * and false pricingComplete=true that locked _eodLastFiredDate and blocked
 * all subsequent retries. 14:45 start gives TWSE a 15-min buffer after its
 * target publish time; 15:30 end keeps the window within the same session day.
 */
export function isS1EodWindow(): boolean {
  const hhmm = taipeiHHMM();
  const taipeiMs = Date.now() + 8 * 3600 * 1000;
  const taipeiDay = new Date(taipeiMs).getUTCDay();
  return taipeiDay >= 1 && taipeiDay <= 5 && hhmm >= 1445 && hhmm < 1530;
}
