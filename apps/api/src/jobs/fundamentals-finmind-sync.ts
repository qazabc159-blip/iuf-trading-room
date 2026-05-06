/**
 * fundamentals-finmind-sync.ts — BLOCK #4 PR A: FinMind 4 Fundamental Dataset ETL
 *
 * Datasets:
 *   1. TaiwanStockMonthRevenue   → tw_monthly_revenue   (stock_id, revenue_year_month)
 *   2. TaiwanStockFinancialStatements → tw_financial_statements (stock_id, period_end, item_name)
 *   3. TaiwanStockBalanceSheet   → tw_balance_sheet     (stock_id, period_end, item_name)
 *   4. TaiwanStockCashFlowsStatement  → tw_cashflow_statement (stock_id, period_end, item_name)
 *
 * Cadence (per Athena spec §1):
 *   - Monthly revenue: every 10th of month 19:00 TST + daily sweep last 30d 19:30
 *   - Financials/Balance/Cashflow: quarterly release windows (1/15, 4/30, 7/30, 10/31)
 *     daily sweep during T-2..T+14, weekly otherwise
 *
 * Hard lines:
 *   - FINMIND_API_TOKEN never logged (boolean-only exposure)
 *   - state=LIVE requires real SQL row evidence (never faked)
 *   - graceful fallback when DB table not yet migrated (state=DEGRADED, no throw)
 *   - idempotent upsert on every run
 *   - withFinMindRetry wraps every API call
 *   - recordFinMindRequest ticks for every batch
 *   - kill switch respected — all jobs emit skipped=killswitch_on when ON
 */

import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "@iuf-trading-room/db";
import { getFinMindClient, recordFinMindRequest } from "../data-sources/finmind-client.js";

// ── Kill switch gate ──────────────────────────────────────────────────────────
// Respect existing FinMind kill switch env flag (same as OHLCV scheduler).
// If FINMIND_KILL_SWITCH=true, all jobs skip with logged reason.

function isFinMindKillSwitchOn(): boolean {
  return process.env.FINMIND_KILL_SWITCH === "true";
}

// ── Shared retry wrapper ──────────────────────────────────────────────────────

export interface FinMindRetryResult<T> {
  ok: boolean;
  rows: T[];
  error: string | null;
  calls: number;
}

/**
 * withFinMindRetry — wraps a FinMind API call with exponential backoff.
 * On 429/network error: retries with delay doubling up to 6h cap.
 * Every attempt (success or fail) ticks recordFinMindRequest.
 */
export async function withFinMindRetry<T>(
  datasetKey: string,
  fn: () => Promise<T[]>,
  opts?: { maxRetries?: number }
): Promise<FinMindRetryResult<T>> {
  const maxRetries = opts?.maxRetries ?? 3;
  const BASE_DELAY_MS = 1_000;
  const MAX_DELAY_MS = 6 * 60 * 60 * 1_000; // 6h cap

  let lastError: string | null = null;
  let calls = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    calls++;
    try {
      const rows = await fn();
      recordFinMindRequest({ dataset: datasetKey, ok: true });
      return { ok: true, rows, error: null, calls };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      recordFinMindRequest({ dataset: datasetKey, ok: false });

      if (attempt < maxRetries) {
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        console.warn(`[fundamentals-sync] ${datasetKey} retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${lastError}`);
        await sleep(delay);
      }
    }
  }

  return { ok: false, rows: [], error: lastError, calls };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Source trail fields appended to every cache row ───────────────────────────
// fetched_at: wall-clock at ingest
// source: 'finmind' (anticipates future TEJ / KGI fan-in)
// source_version: nullable (not always surfaced by API)

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Returns 'YYYY-MM' for a given date string 'YYYY-MM-DD'
function toYearMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

// ── Table existence guard ─────────────────────────────────────────────────────
// When DB table doesn't exist yet (pre-migration), return false so caller can
// emit state=DEGRADED instead of crashing.

async function tableExists(tableName: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const result = await db.execute(drizzleSql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
      ) AS exists
    `);
    const row = (result as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(result) ? result[0] : result);
    return row?.exists === true || row?.exists === 'true';
  } catch {
    return false;
  }
}

// ── Sync result type ──────────────────────────────────────────────────────────

export interface FundamentalSyncResult {
  dataset: string;
  tickersAttempted: number;
  tickersSuccess: number;
  tickersFailed: number;
  rowsUpserted: number;
  rowsQuarantined: number;
  skipped: boolean;
  skipReason: string | null;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

// ── 1. TaiwanStockMonthRevenue ────────────────────────────────────────────────

/**
 * runMonthlyRevenueSync — pull 月營收 for all tickers.
 *
 * Upsert key: (stock_id, revenue_year_month)
 * DB table: tw_monthly_revenue
 * Cadence: every 10th of month 19:00 + daily sweep last 30d
 */
export async function runMonthlyRevenueSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<FundamentalSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const dataset = "TaiwanStockMonthRevenue";

  if (isFinMindKillSwitchOn()) {
    console.log(`[fundamentals-sync] ${dataset} skipped=killswitch_on`);
    return makeSkipped(dataset, "killswitch_on", t0, startedAt);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    console.log(`[fundamentals-sync] ${dataset} skipped=no_token`);
    return makeSkipped(dataset, "no_token", t0, startedAt);
  }

  const db = getDb();
  if (!db) {
    console.warn(`[fundamentals-sync] ${dataset} skipped=no_db`);
    return makeSkipped(dataset, "no_db", t0, startedAt);
  }

  const tableReady = await tableExists("tw_monthly_revenue");
  if (!tableReady) {
    console.warn(`[fundamentals-sync] ${dataset} skipped=table_not_migrated (state=DEGRADED)`);
    return makeSkipped(dataset, "table_not_migrated", t0, startedAt);
  }

  const client = getFinMindClient();
  const startDate = opts?.startDate ?? daysAgoIso(30);
  const endDate = opts?.endDate ?? todayIso();
  const fetchedAt = new Date().toISOString();

  let tickersSuccess = 0;
  let tickersFailed = 0;
  let rowsUpserted = 0;
  let rowsQuarantined = 0;

  for (const { ticker } of tickers) {
    const result = await withFinMindRetry(dataset, () =>
      client.getMonthRevenue(ticker, startDate, endDate)
    );

    if (!result.ok || result.rows.length === 0) {
      if (!result.ok) tickersFailed++;
      continue;
    }

    // QA + upsert
    for (const row of result.rows) {
      // Basic QA: revenue must be numeric
      if (typeof row.revenue !== "number" || isNaN(row.revenue)) {
        rowsQuarantined++;
        await quarantineRow("tw_monthly_revenue", {
          stock_id: row.stock_id,
          date: row.date,
          reason_code: "invalid_revenue_nan",
          raw: JSON.stringify(row)
        }, db).catch(() => {});
        continue;
      }

      const revenueYearMonth = toYearMonth(row.date);

      try {
        await db.execute(drizzleSql`
          INSERT INTO tw_monthly_revenue
            (stock_id, revenue_year_month, revenue_date, revenue, revenue_month, revenue_year,
             country, fetched_at, source)
          VALUES
            (${row.stock_id}, ${revenueYearMonth}, ${row.date}, ${row.revenue},
             ${row.revenue_month}, ${row.revenue_year}, ${row.country ?? "TW"},
             ${fetchedAt}, 'finmind')
          ON CONFLICT (stock_id, revenue_year_month)
          DO UPDATE SET
            revenue       = EXCLUDED.revenue,
            revenue_month = EXCLUDED.revenue_month,
            revenue_year  = EXCLUDED.revenue_year,
            revenue_date  = EXCLUDED.revenue_date,
            country       = EXCLUDED.country,
            fetched_at    = EXCLUDED.fetched_at,
            source        = EXCLUDED.source
        `);
        rowsUpserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[fundamentals-sync] ${dataset} upsert error ticker=${ticker}: ${msg}`);
        tickersFailed++;
      }
    }
    tickersSuccess++;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  console.log(`[fundamentals-sync] ${dataset} DONE tickers=${tickers.length} success=${tickersSuccess} failed=${tickersFailed} rowsUpserted=${rowsUpserted} rowsQuarantined=${rowsQuarantined} durationMs=${durationMs}`);

  return {
    dataset,
    tickersAttempted: tickers.length,
    tickersSuccess,
    tickersFailed,
    rowsUpserted,
    rowsQuarantined,
    skipped: false,
    skipReason: null,
    durationMs,
    startedAt,
    finishedAt
  };
}

// ── 2. TaiwanStockFinancialStatements ─────────────────────────────────────────

/**
 * runFinancialStatementsSync — pull 損益表 for all tickers.
 *
 * Upsert key: (stock_id, period_end, item_name)
 * DB table: tw_financial_statements
 */
export async function runFinancialStatementsSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<FundamentalSyncResult> {
  return runFinancialDatasetSync("TaiwanStockFinancialStatements", "tw_financial_statements", tickers, opts);
}

// ── 3. TaiwanStockBalanceSheet ────────────────────────────────────────────────

/**
 * runBalanceSheetSync — pull 資產負債表 for all tickers.
 *
 * Upsert key: (stock_id, period_end, item_name)
 * DB table: tw_balance_sheet
 */
export async function runBalanceSheetSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<FundamentalSyncResult> {
  return runFinancialDatasetSync("TaiwanStockBalanceSheet", "tw_balance_sheet", tickers, opts);
}

// ── 4. TaiwanStockCashFlowsStatement ─────────────────────────────────────────

/**
 * runCashFlowsSync — pull 現金流量表 for all tickers.
 *
 * Upsert key: (stock_id, period_end, item_name)
 * DB table: tw_cashflow_statement
 */
export async function runCashFlowsSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<FundamentalSyncResult> {
  return runFinancialDatasetSync("TaiwanStockCashFlowsStatement", "tw_cashflow_statement", tickers, opts);
}

// ── Shared financial statements ETL (income / balance / cashflow share same shape) ──

type FinancialDatasetKey =
  | "TaiwanStockFinancialStatements"
  | "TaiwanStockBalanceSheet"
  | "TaiwanStockCashFlowsStatement";

type FinancialTableName =
  | "tw_financial_statements"
  | "tw_balance_sheet"
  | "tw_cashflow_statement";

interface FinancialRow {
  date: string;
  stock_id: string;
  type: string;
  value: number;
  origin_name?: string;
}

async function runFinancialDatasetSync(
  datasetKey: FinancialDatasetKey,
  tableName: FinancialTableName,
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<FundamentalSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  if (isFinMindKillSwitchOn()) {
    console.log(`[fundamentals-sync] ${datasetKey} skipped=killswitch_on`);
    return makeSkipped(datasetKey, "killswitch_on", t0, startedAt);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    console.log(`[fundamentals-sync] ${datasetKey} skipped=no_token`);
    return makeSkipped(datasetKey, "no_token", t0, startedAt);
  }

  const db = getDb();
  if (!db) {
    console.warn(`[fundamentals-sync] ${datasetKey} skipped=no_db`);
    return makeSkipped(datasetKey, "no_db", t0, startedAt);
  }

  const tableReady = await tableExists(tableName);
  if (!tableReady) {
    console.warn(`[fundamentals-sync] ${datasetKey} skipped=table_not_migrated (state=DEGRADED)`);
    return makeSkipped(datasetKey, "table_not_migrated", t0, startedAt);
  }

  const client = getFinMindClient();
  // Default: last 2 years to cover historical quarterly data on first run
  const startDate = opts?.startDate ?? daysAgoIso(730);
  const endDate = opts?.endDate ?? todayIso();
  const fetchedAt = new Date().toISOString();

  let tickersSuccess = 0;
  let tickersFailed = 0;
  let rowsUpserted = 0;
  let rowsQuarantined = 0;

  for (const { ticker } of tickers) {
    let apiRows: FinancialRow[];
    const result = await withFinMindRetry(datasetKey, async () => {
      if (datasetKey === "TaiwanStockFinancialStatements") {
        return client.getFinancialStatements(ticker, startDate, endDate) as Promise<FinancialRow[]>;
      } else if (datasetKey === "TaiwanStockBalanceSheet") {
        return client.getBalanceSheet(ticker, startDate, endDate) as Promise<FinancialRow[]>;
      } else {
        return client.getCashFlow(ticker, startDate, endDate) as Promise<FinancialRow[]>;
      }
    });

    if (!result.ok || result.rows.length === 0) {
      if (!result.ok) tickersFailed++;
      continue;
    }
    apiRows = result.rows;

    for (const row of apiRows) {
      // QA: value must be numeric, date must look like YYYY-MM-DD, type must be non-empty
      if (!row.date || !row.type || typeof row.value !== "number" || isNaN(row.value)) {
        rowsQuarantined++;
        await quarantineRow(tableName, {
          stock_id: row.stock_id,
          date: row.date,
          item_name: row.type,
          reason_code: "invalid_row_shape",
          raw: JSON.stringify(row)
        }, db).catch(() => {});
        continue;
      }

      // period_end = date field (FinMind uses quarter-end date)
      const periodEnd = row.date;
      const itemName = row.type;

      try {
        await db.execute(drizzleSql`
          INSERT INTO ${drizzleSql.identifier(tableName)}
            (stock_id, period_end, item_name, value, origin_name, fetched_at, source)
          VALUES
            (${row.stock_id}, ${periodEnd}, ${itemName}, ${row.value},
             ${row.origin_name ?? null}, ${fetchedAt}, 'finmind')
          ON CONFLICT (stock_id, period_end, item_name)
          DO UPDATE SET
            value       = EXCLUDED.value,
            origin_name = EXCLUDED.origin_name,
            fetched_at  = EXCLUDED.fetched_at,
            source      = EXCLUDED.source
        `);
        rowsUpserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[fundamentals-sync] ${datasetKey} upsert error ticker=${ticker} item=${itemName}: ${msg}`);
        tickersFailed++;
      }
    }
    tickersSuccess++;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  console.log(`[fundamentals-sync] ${datasetKey} DONE tickers=${tickers.length} success=${tickersSuccess} failed=${tickersFailed} rowsUpserted=${rowsUpserted} rowsQuarantined=${rowsQuarantined} durationMs=${durationMs}`);

  return {
    dataset: datasetKey,
    tickersAttempted: tickers.length,
    tickersSuccess,
    tickersFailed,
    rowsUpserted,
    rowsQuarantined,
    skipped: false,
    skipReason: null,
    durationMs,
    startedAt,
    finishedAt
  };
}

// ── Quarantine helper ─────────────────────────────────────────────────────────
// Rows failing QA are routed to _quarantine_<table> rather than silently dropped.
// Table existence is checked; failure here is non-fatal (logged only).

async function quarantineRow(
  sourceTable: string,
  data: Record<string, string | null | undefined>,
  db: NonNullable<ReturnType<typeof getDb>>
): Promise<void> {
  const quarantineTable = `_quarantine_${sourceTable}`;
  const quarantineExists = await tableExists(quarantineTable);
  if (!quarantineExists) {
    // Quarantine table not migrated yet — log and move on
    console.warn(`[fundamentals-sync] quarantine table ${quarantineTable} not found, row dropped with reason=${data.reason_code}`);
    return;
  }
  try {
    await db.execute(drizzleSql`
      INSERT INTO ${drizzleSql.identifier(quarantineTable)}
        (stock_id, reason_code, raw_json, quarantined_at)
      VALUES
        (${data.stock_id ?? null}, ${data.reason_code ?? "unknown"}, ${data.raw ?? "{}"}, NOW())
    `);
  } catch (err) {
    console.warn(`[fundamentals-sync] quarantine insert failed for ${quarantineTable}:`, err instanceof Error ? err.message : String(err));
  }
}

// ── Skipped result helper ─────────────────────────────────────────────────────

function makeSkipped(
  dataset: string,
  reason: string,
  t0: number,
  startedAt: string
): FundamentalSyncResult {
  const now = new Date().toISOString();
  return {
    dataset,
    tickersAttempted: 0,
    tickersSuccess: 0,
    tickersFailed: 0,
    rowsUpserted: 0,
    rowsQuarantined: 0,
    skipped: true,
    skipReason: reason,
    durationMs: Date.now() - t0,
    startedAt,
    finishedAt: now
  };
}

// ── Cadence helpers ───────────────────────────────────────────────────────────
// Used by scheduler to decide whether to run or skip per cadence rule.

/** Returns true if today is the 10th of the month (monthly revenue burst day). */
export function isMonthlyRevenueBurstDay(): boolean {
  return new Date().getUTCDate() === 10;
}

/**
 * Returns true if we are within T-2..T+14 of a quarterly FSC release window.
 * FSC statutory dates: Jan 15, Apr 30, Jul 30, Oct 31.
 */
export function isInQuarterlyReleaseWindow(): boolean {
  const now = new Date();
  const year = now.getUTCFullYear();
  const quarterlyDates = [
    new Date(Date.UTC(year, 0, 15)),   // Jan 15
    new Date(Date.UTC(year, 3, 30)),   // Apr 30
    new Date(Date.UTC(year, 6, 30)),   // Jul 30
    new Date(Date.UTC(year, 9, 31)),   // Oct 31
  ];
  const T_MINUS = 2 * 24 * 60 * 60 * 1000;
  const T_PLUS  = 14 * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();

  return quarterlyDates.some(d => {
    const diff = nowMs - d.getTime();
    return diff >= -T_MINUS && diff <= T_PLUS;
  });
}

/**
 * Returns true if today is Sunday (weekly trigger for non-release-window financials).
 */
export function isWeeklyTriggerDay(): boolean {
  return new Date().getUTCDay() === 0;
}

// ── DB row stats helper ───────────────────────────────────────────────────────
// Used by the finmind/status panel to show real row counts for these 4 datasets.

export interface FundamentalDatasetStats {
  rowCount: number;
  latestDate: string | null;
  state: "LIVE" | "STALE" | "EMPTY" | "ERROR" | "DEGRADED";
  missingReason: string | null;
}

export async function queryFundamentalDatasetStats(tableName: string): Promise<FundamentalDatasetStats> {
  const db = getDb();
  if (!db) return { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "no_database" };

  const exists = await tableExists(tableName);
  if (!exists) return { rowCount: 0, latestDate: null, state: "DEGRADED", missingReason: "table_not_migrated" };

  try {
    let result: unknown;
    if (tableName === "tw_monthly_revenue") {
      result = await db.execute(drizzleSql`
        SELECT
          COUNT(*)::int        AS row_count,
          MAX(revenue_date)::text AS latest_date
        FROM tw_monthly_revenue
      `);
    } else {
      result = await db.execute(drizzleSql`
        SELECT
          COUNT(*)::int    AS row_count,
          MAX(period_end)::text AS latest_date
        FROM ${drizzleSql.identifier(tableName)}
      `);
    }

    const rawRow = (result as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(result) ? (result as unknown[])[0] : result);
    const row = rawRow as Record<string, unknown>;
    const rowCount  = typeof row?.row_count   === "number" ? (row.row_count as number)   : parseInt(String(row?.row_count   ?? "0"), 10);
    const latestDate = typeof row?.latest_date === "string" ? (row.latest_date as string) : null;

    if (rowCount === 0) return { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "no_rows" };

    // Stale = latest date > 35 days old (covers quarterly cadence)
    const staleMs = 35 * 24 * 60 * 60 * 1000;
    const isStale = latestDate ? (Date.now() - new Date(latestDate).getTime()) > staleMs : true;
    const state = isStale ? "STALE" : "LIVE";

    return { rowCount, latestDate, state, missingReason: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rowCount: 0, latestDate: null, state: "ERROR", missingReason: msg };
  }
}
