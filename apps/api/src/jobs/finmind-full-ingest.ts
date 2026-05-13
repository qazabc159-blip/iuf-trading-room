/**
 * finmind-full-ingest.ts — FinMind sponsor 11-dataset full ingest orchestrator
 *
 * Implements楊董 mandate: "所有資源你都給我活用起來"
 * Wraps all 11 FinMind dataset sync functions into a single orchestrated run
 * with per-dataset audit log entries (action='finmind.ingest').
 *
 * Hard lines:
 *   - FINMIND_API_TOKEN NEVER logged (boolean-only)
 *   - silent fail FORBIDDEN — every dataset result logged (skipped or not)
 *   - no fake data — all rows from real FinMind API calls
 *   - quota guard: 11 datasets * N tickers; caller is responsible for batch size
 *   - kill switch respected (individual job functions handle it internally)
 *   - DB unavailable → graceful DEGRADED (no throw out of the function)
 *
 * Datasets covered:
 *   1. TaiwanStockMonthRevenue          → tw_monthly_revenue
 *   2. TaiwanStockFinancialStatements   → tw_financial_statements
 *   3. TaiwanStockBalanceSheet          → tw_balance_sheet
 *   4. TaiwanStockCashFlowsStatement    → tw_cashflow_statement
 *   5. TaiwanStockDividend              → tw_dividend
 *   6. TaiwanStockInstitutionalInvestorsBuySell → tw_institutional_buysell
 *   7. TaiwanStockMarginPurchaseShortSale       → tw_margin_short
 *   8. TaiwanStockShareholding          → tw_shareholding
 *   9. TaiwanStockMarketValue           → tw_market_value
 *  10. TaiwanStockPER                   → tw_valuation
 *  11. TaiwanStockNews                  → tw_stock_news [EXPERIMENTAL]
 */

import { sql as drizzleSql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, isDatabaseMode, auditLogs } from "@iuf-trading-room/db";

import {
  runMonthlyRevenueSync,
  runFinancialStatementsSync,
  runBalanceSheetSync,
  runCashFlowsSync,
  type FundamentalSyncResult
} from "./fundamentals-finmind-sync.js";
import {
  runInstitutionalBuySellSync,
  runMarginShortSync,
  runShareholdingSync,
  type TradingFlowSyncResult
} from "./trading-flow-finmind-sync.js";
import {
  runDividendSync,
  runMarketValueSync,
  runValuationSync,
  runStockNewsSync,
  queryMarketIntelDatasetStats,
  type MarketIntelSyncResult
} from "./market-intel-finmind-sync.js";
import {
  queryFundamentalDatasetStats
} from "./fundamentals-finmind-sync.js";
import {
  queryTradingFlowDatasetStats
} from "./trading-flow-finmind-sync.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FullIngestDatasetResult = {
  dataset: string;
  table: string;
  rowsUpserted: number;
  rowsQuarantined: number;
  skipped: boolean;
  skipReason: string | null;
  durationMs: number;
  state: "synced" | "skipped" | "error";
  error?: string;
  experimental?: boolean;
};

export type FullIngestResult = {
  runId: string;
  triggeredBy: "cron" | "manual";
  workspaceSlug: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  totalRowsUpserted: number;
  totalRowsQuarantined: number;
  datasetsAttempted: number;
  datasetsSynced: number;
  datasetsSkipped: number;
  datasetsErrored: number;
  datasets: FullIngestDatasetResult[];
  quotaNote: string;
};

// ── In-memory state ───────────────────────────────────────────────────────────
// Track last ingest result for GET /api/v1/internal/finmind/ingest-status

let _lastFullIngestResult: FullIngestResult | null = null;
let _ingestRunning = false;

export function getLastFullIngestResult(): FullIngestResult | null {
  return _lastFullIngestResult;
}

export function isFullIngestRunning(): boolean {
  return _ingestRunning;
}

// ── Audit log writer ──────────────────────────────────────────────────────────

async function writeIngestAuditLog(params: {
  workspaceId: string;
  runId: string;
  dataset: string;
  table: string;
  rowsUpserted: number;
  rowsQuarantined: number;
  skipped: boolean;
  skipReason: string | null;
  durationMs: number;
  triggeredBy: "cron" | "manual";
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLogs).values({
      workspaceId: params.workspaceId,
      actorId: null,
      action: "finmind.ingest" as string,
      entityType: "finmind_dataset",
      entityId: `${params.dataset}:${params.runId}`,
      payload: {
        run_id: params.runId,
        dataset: params.dataset,
        table: params.table,
        rows_upserted: params.rowsUpserted,
        rows_quarantined: params.rowsQuarantined,
        skipped: params.skipped,
        skip_reason: params.skipReason,
        duration_ms: params.durationMs,
        triggered_by: params.triggeredBy
      }
    });
  } catch (err) {
    // Non-fatal: audit log failure must not block ingest
    console.warn(
      `[finmind-full-ingest] audit log write failed for dataset=${params.dataset}: ` +
      (err instanceof Error ? err.message : String(err))
    );
  }
}

// ── Table row count helper for post-sync verification ─────────────────────────

async function getTableRowCount(tableName: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const result = await db.execute(drizzleSql`
      SELECT COUNT(*)::int AS row_count FROM ${drizzleSql.identifier(tableName)}
    `);
    const row = (result as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(result) ? (result as unknown[])[0] : result);
    const rowCount = row as Record<string, unknown>;
    return typeof rowCount?.row_count === "number"
      ? (rowCount.row_count as number)
      : parseInt(String(rowCount?.row_count ?? "0"), 10);
  } catch {
    return 0;
  }
}

// ── Dataset registry ──────────────────────────────────────────────────────────

type SyncResult = FundamentalSyncResult | TradingFlowSyncResult | MarketIntelSyncResult;

type DatasetSpec = {
  dataset: string;
  table: string;
  experimental?: boolean;
  fn: (tickers: Array<{ ticker: string }>, opts?: { startDate?: string; endDate?: string }) => Promise<SyncResult>;
  startDateDaysBack: number;
};

const DATASET_REGISTRY: DatasetSpec[] = [
  {
    dataset: "TaiwanStockMonthRevenue",
    table: "tw_monthly_revenue",
    fn: runMonthlyRevenueSync,
    startDateDaysBack: 60   // 2 months back for full initial load
  },
  {
    dataset: "TaiwanStockFinancialStatements",
    table: "tw_financial_statements",
    fn: runFinancialStatementsSync,
    startDateDaysBack: 730  // 2 years quarterly data
  },
  {
    dataset: "TaiwanStockBalanceSheet",
    table: "tw_balance_sheet",
    fn: runBalanceSheetSync,
    startDateDaysBack: 730
  },
  {
    dataset: "TaiwanStockCashFlowsStatement",
    table: "tw_cashflow_statement",
    fn: runCashFlowsSync,
    startDateDaysBack: 730
  },
  {
    dataset: "TaiwanStockDividend",
    table: "tw_dividend",
    fn: runDividendSync,
    startDateDaysBack: 1095  // 3 years dividend history
  },
  {
    dataset: "TaiwanStockInstitutionalInvestorsBuySell",
    table: "tw_institutional_buysell",
    fn: runInstitutionalBuySellSync,
    startDateDaysBack: 30
  },
  {
    dataset: "TaiwanStockMarginPurchaseShortSale",
    table: "tw_margin_short",
    fn: runMarginShortSync,
    startDateDaysBack: 30
  },
  {
    dataset: "TaiwanStockShareholding",
    table: "tw_shareholding",
    fn: runShareholdingSync,
    startDateDaysBack: 90  // 13 weeks
  },
  {
    dataset: "TaiwanStockMarketValue",
    table: "tw_market_value",
    fn: runMarketValueSync,
    startDateDaysBack: 90
  },
  {
    dataset: "TaiwanStockPER",
    table: "tw_valuation",
    fn: runValuationSync,
    startDateDaysBack: 30
  },
  {
    dataset: "TaiwanStockNews",
    table: "tw_stock_news",
    fn: runStockNewsSync,
    startDateDaysBack: 1,   // 24h incremental
    experimental: true
  }
];

// ── Workspace ticker resolver ─────────────────────────────────────────────────

async function resolveWorkspaceTickers(
  workspaceSlug: string
): Promise<Array<{ ticker: string }>> {
  const db = getDb();
  if (!db) return [];
  try {
    const ws = await db.execute(drizzleSql`
      SELECT id FROM workspaces WHERE slug = ${workspaceSlug} LIMIT 1
    `);
    const wsRow = (ws as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(ws) ? (ws as unknown[])[0] : ws);
    const workspaceId = (wsRow as Record<string, unknown>)?.id;
    if (!workspaceId) return [];

    const rows = await db.execute(drizzleSql`
      SELECT ticker FROM companies
      WHERE workspace_id = ${workspaceId as string}
        AND ticker ~ '^[0-9]{4}$'
    `);
    const tickerRows = (rows as { rows?: Record<string, unknown>[] })?.rows
      ?? (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
    return (tickerRows as Record<string, unknown>[])
      .map((r) => ({ ticker: String(r.ticker ?? "") }))
      .filter((r) => /^\d{4}$/.test(r.ticker));
  } catch (err) {
    console.warn(
      "[finmind-full-ingest] resolveWorkspaceTickers error:",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

// ── Workspace ID resolver ─────────────────────────────────────────────────────

async function resolveWorkspaceId(workspaceSlug: string): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const ws = await db.execute(drizzleSql`
      SELECT id FROM workspaces WHERE slug = ${workspaceSlug} LIMIT 1
    `);
    const wsRow = (ws as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(ws) ? (ws as unknown[])[0] : ws);
    return String((wsRow as Record<string, unknown>)?.id ?? "") || null;
  } catch {
    return null;
  }
}

// ── Date helper ───────────────────────────────────────────────────────────────

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * runFullIngest — runs all 11 FinMind datasets for a workspace.
 *
 * NOTE on quota: FinMind sponsor = 6000 req/hr.
 * With batchSize=50 and 11 datasets → 550 API calls max per full run.
 * Fine for sponsor tier. Larger batches can be configured via FINMIND_SCHEDULER_BATCH_SIZE.
 *
 * @param workspaceSlug - workspace slug (resolved from DB)
 * @param triggeredBy - 'cron' or 'manual' (stored in audit log)
 * @param batchSize - max tickers per dataset per run (default 50; sponsor can go higher)
 */
export async function runFullIngest(params: {
  workspaceSlug: string;
  triggeredBy: "cron" | "manual";
  batchSize?: number;
}): Promise<FullIngestResult> {
  if (_ingestRunning) {
    console.warn("[finmind-full-ingest] already running, skipping duplicate trigger");
    // Return a stub indicating already running
    const now = new Date().toISOString();
    return {
      runId: "already-running",
      triggeredBy: params.triggeredBy,
      workspaceSlug: params.workspaceSlug,
      startedAt: now,
      finishedAt: now,
      totalDurationMs: 0,
      totalRowsUpserted: 0,
      totalRowsQuarantined: 0,
      datasetsAttempted: 0,
      datasetsSynced: 0,
      datasetsSkipped: 0,
      datasetsErrored: 0,
      datasets: [],
      quotaNote: "already_running"
    };
  }

  _ingestRunning = true;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  console.log(
    `[finmind-full-ingest] START runId=${runId} workspace=${params.workspaceSlug} ` +
    `triggeredBy=${params.triggeredBy} datasets=11`
  );

  let workspaceId: string | null = null;
  let tickers: Array<{ ticker: string }> = [];

  try {
    [workspaceId, tickers] = await Promise.all([
      resolveWorkspaceId(params.workspaceSlug),
      resolveWorkspaceTickers(params.workspaceSlug)
    ]);
  } catch (err) {
    console.warn(
      "[finmind-full-ingest] workspace/tickers resolution failed:",
      err instanceof Error ? err.message : String(err)
    );
  }

  if (tickers.length === 0) {
    console.warn(
      `[finmind-full-ingest] no tickers found for workspace=${params.workspaceSlug}, ` +
      "all datasets will skip=no_tickers"
    );
  }

  const batchSize = params.batchSize
    ?? Math.min(50, Math.max(1, tickers.length));

  // Take a batch (sorted, from index 0 for manual trigger — we want all data)
  const tickerBatch = tickers.length > batchSize
    ? [...tickers].sort((a, b) => a.ticker.localeCompare(b.ticker)).slice(0, batchSize)
    : tickers;

  const datasetResults: FullIngestDatasetResult[] = [];

  for (const spec of DATASET_REGISTRY) {
    const dsT0 = Date.now();
    let dsResult: FullIngestDatasetResult;

    if (tickerBatch.length === 0) {
      dsResult = {
        dataset: spec.dataset,
        table: spec.table,
        rowsUpserted: 0,
        rowsQuarantined: 0,
        skipped: true,
        skipReason: "no_tickers",
        durationMs: 0,
        state: "skipped",
        ...(spec.experimental ? { experimental: true } : {})
      };
    } else {
      try {
        const startDate = daysAgoIso(spec.startDateDaysBack);
        const result = await spec.fn(tickerBatch, { startDate });
        const durationMs = Date.now() - dsT0;

        dsResult = {
          dataset: spec.dataset,
          table: spec.table,
          rowsUpserted: result.rowsUpserted,
          rowsQuarantined: result.rowsQuarantined,
          skipped: result.skipped,
          skipReason: result.skipReason,
          durationMs,
          state: result.skipped ? "skipped" : "synced",
          ...(spec.experimental ? { experimental: true } : {})
        };
      } catch (err) {
        const durationMs = Date.now() - dsT0;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[finmind-full-ingest] dataset=${spec.dataset} ERROR: ${errMsg}`);
        dsResult = {
          dataset: spec.dataset,
          table: spec.table,
          rowsUpserted: 0,
          rowsQuarantined: 0,
          skipped: false,
          skipReason: null,
          durationMs,
          state: "error",
          error: errMsg,
          ...(spec.experimental ? { experimental: true } : {})
        };
      }
    }

    datasetResults.push(dsResult);

    // Audit log per dataset (non-fatal if DB unavailable)
    if (workspaceId) {
      await writeIngestAuditLog({
        workspaceId,
        runId,
        dataset: spec.dataset,
        table: spec.table,
        rowsUpserted: dsResult.rowsUpserted,
        rowsQuarantined: dsResult.rowsQuarantined,
        skipped: dsResult.skipped,
        skipReason: dsResult.skipReason,
        durationMs: dsResult.durationMs,
        triggeredBy: params.triggeredBy
      }).catch(() => {});
    }

    console.log(
      `[finmind-full-ingest] dataset=${spec.dataset} state=${dsResult.state} ` +
      `rows=${dsResult.rowsUpserted} skipped=${dsResult.skipped} ` +
      `skipReason=${dsResult.skipReason ?? "none"} durationMs=${dsResult.durationMs}`
    );
  }

  const finishedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - t0;

  const totalRowsUpserted = datasetResults.reduce((sum, d) => sum + d.rowsUpserted, 0);
  const totalRowsQuarantined = datasetResults.reduce((sum, d) => sum + d.rowsQuarantined, 0);
  const datasetsSynced = datasetResults.filter((d) => d.state === "synced").length;
  const datasetsSkipped = datasetResults.filter((d) => d.state === "skipped").length;
  const datasetsErrored = datasetResults.filter((d) => d.state === "error").length;

  // Quota note: sponsor = 6000/hr; rough estimate = batch * 11 datasets
  const estimatedCalls = tickerBatch.length * DATASET_REGISTRY.length;
  const quotaNote = `estimated_api_calls=${estimatedCalls}/run; sponsor_limit=6000/hr`;

  const fullResult: FullIngestResult = {
    runId,
    triggeredBy: params.triggeredBy,
    workspaceSlug: params.workspaceSlug,
    startedAt,
    finishedAt,
    totalDurationMs,
    totalRowsUpserted,
    totalRowsQuarantined,
    datasetsAttempted: DATASET_REGISTRY.length,
    datasetsSynced,
    datasetsSkipped,
    datasetsErrored,
    datasets: datasetResults,
    quotaNote
  };

  _lastFullIngestResult = fullResult;
  _ingestRunning = false;

  console.log(
    `[finmind-full-ingest] DONE runId=${runId} ` +
    `synced=${datasetsSynced} skipped=${datasetsSkipped} errored=${datasetsErrored} ` +
    `totalRows=${totalRowsUpserted} durationMs=${totalDurationMs}`
  );

  return fullResult;
}

// ── Dataset status summary (for GET endpoint) ─────────────────────────────────

export interface DatasetStatusRow {
  dataset: string;
  table: string;
  rowCount: number;
  minDate: string | null;
  latestDate: string | null;
  lastIngestedAt: string | null;
  source: string;
  state: "LIVE" | "STALE" | "EMPTY" | "ERROR" | "DEGRADED";
  missingReason: string | null;
  experimental?: boolean;
}

/**
 * Query MIN(date), MAX(date), and MAX(fetched_at) for a table that has
 * a `date` column (text ISO) and a `fetched_at` column (timestamptz).
 * Returns nulls safely if the table is empty or missing.
 */
async function queryTableDateExtents(
  tableName: string
): Promise<{ minDate: string | null; maxDate: string | null; lastIngestedAt: string | null }> {
  const db = getDb();
  if (!db) return { minDate: null, maxDate: null, lastIngestedAt: null };
  try {
    const result = await db.execute(drizzleSql`
      SELECT
        MIN(date)::text       AS min_date,
        MAX(date)::text       AS max_date,
        MAX(fetched_at)::text AS last_ingested_at
      FROM ${drizzleSql.identifier(tableName)}
    `);
    const rawRow = (result as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(result) ? (result as unknown[])[0] : result);
    const row = rawRow as Record<string, unknown>;
    return {
      minDate: typeof row?.min_date === "string" ? row.min_date : null,
      maxDate: typeof row?.max_date === "string" ? row.max_date : null,
      lastIngestedAt: typeof row?.last_ingested_at === "string" ? row.last_ingested_at : null
    };
  } catch {
    return { minDate: null, maxDate: null, lastIngestedAt: null };
  }
}

/**
 * Query MIN(dt), MAX(dt), and MAX(updated_at or fetched_at) for companies_ohlcv.
 * companies_ohlcv uses `dt` not `date`, and has no `fetched_at`.
 */
async function queryOhlcvDateExtents(): Promise<{ minDate: string | null; maxDate: string | null; lastIngestedAt: string | null }> {
  const db = getDb();
  if (!db) return { minDate: null, maxDate: null, lastIngestedAt: null };
  try {
    const result = await db.execute(drizzleSql`
      SELECT
        MIN(dt)::text AS min_date,
        MAX(dt)::text AS max_date
      FROM companies_ohlcv
    `);
    const rawRow = (result as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(result) ? (result as unknown[])[0] : result);
    const row = rawRow as Record<string, unknown>;
    return {
      minDate: typeof row?.min_date === "string" ? row.min_date : null,
      maxDate: typeof row?.max_date === "string" ? row.max_date : null,
      lastIngestedAt: null  // companies_ohlcv has no fetched_at column
    };
  } catch {
    return { minDate: null, maxDate: null, lastIngestedAt: null };
  }
}

export async function queryAllDatasetStatus(): Promise<DatasetStatusRow[]> {
  const fundamentalTables: Array<{ table: string; dataset: string }> = [
    { table: "tw_monthly_revenue", dataset: "TaiwanStockMonthRevenue" },
    { table: "tw_financial_statements", dataset: "TaiwanStockFinancialStatements" },
    { table: "tw_balance_sheet", dataset: "TaiwanStockBalanceSheet" },
    { table: "tw_cashflow_statement", dataset: "TaiwanStockCashFlowsStatement" }
  ];

  const tradingFlowTables: Array<{ table: string; dataset: string; staleDays?: number }> = [
    { table: "tw_institutional_buysell", dataset: "TaiwanStockInstitutionalInvestorsBuySell" },
    { table: "tw_margin_short", dataset: "TaiwanStockMarginPurchaseShortSale" },
    { table: "tw_shareholding", dataset: "TaiwanStockShareholding", staleDays: 10 }
  ];

  const marketIntelTables: Array<{ table: string; dataset: string; staleDays?: number; dateCol?: string; experimental?: boolean }> = [
    { table: "tw_dividend", dataset: "TaiwanStockDividend", staleDays: 365, dateCol: "announcement_date" },
    { table: "tw_market_value", dataset: "TaiwanStockMarketValue", staleDays: 10 },
    { table: "tw_valuation", dataset: "TaiwanStockPER", staleDays: 5 },
    { table: "tw_stock_news", dataset: "TaiwanStockNews", staleDays: 1, dateCol: "fetched_at", experimental: true }
  ];

  // companies_ohlcv is not in the 3 registry groups above — handle separately
  const ohlcvStatusPromise: Promise<DatasetStatusRow> = (async () => {
    try {
      const db = getDb();
      if (!db) return {
        dataset: "TaiwanStockPriceAdj", table: "companies_ohlcv",
        rowCount: 0, minDate: null, latestDate: null, lastIngestedAt: null,
        source: "finmind", state: "EMPTY" as const, missingReason: "no_database"
      };
      const countRes = await db.execute(
        drizzleSql`SELECT COUNT(*)::int AS cnt, MAX(dt)::text AS latest FROM companies_ohlcv`
      );
      const _countRows = (countRes as { rows?: Record<string, unknown>[] })?.rows
        ?? (Array.isArray(countRes) ? countRes : []) as Record<string, unknown>[];
      const r = _countRows[0] as Record<string, unknown> | undefined;
      const rowCount = r ? (typeof r.cnt === "number" ? r.cnt : parseInt(String(r.cnt ?? "0"), 10)) : 0;
      const latestDate = r && typeof r.latest === "string" ? r.latest : null;
      const extents = rowCount > 0 ? await queryOhlcvDateExtents() : { minDate: null, maxDate: null, lastIngestedAt: null };
      const staleMs = 5 * 24 * 60 * 60 * 1000;
      const isStale = latestDate ? (Date.now() - new Date(latestDate).getTime()) > staleMs : true;
      const state: DatasetStatusRow["state"] = rowCount === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE";
      return {
        dataset: "TaiwanStockPriceAdj", table: "companies_ohlcv",
        rowCount, minDate: extents.minDate, latestDate, lastIngestedAt: null,
        source: "finmind", state, missingReason: rowCount === 0 ? "no_rows" : null
      };
    } catch (err) {
      return {
        dataset: "TaiwanStockPriceAdj", table: "companies_ohlcv",
        rowCount: 0, minDate: null, latestDate: null, lastIngestedAt: null,
        source: "finmind", state: "ERROR" as const,
        missingReason: err instanceof Error ? err.message.slice(0, 100) : "query_failed"
      };
    }
  })();

  const [ohlcvRow, ...otherRows] = await Promise.all([
    ohlcvStatusPromise,
    ...fundamentalTables.map(async ({ table, dataset }) => {
      const s = await queryFundamentalDatasetStats(table).catch(() => ({
        rowCount: 0, latestDate: null, state: "ERROR" as const, missingReason: "query_failed"
      }));
      const extents = s.rowCount > 0 ? await queryTableDateExtents(table).catch(() => ({ minDate: null, maxDate: null, lastIngestedAt: null })) : { minDate: null, maxDate: null, lastIngestedAt: null };
      return { dataset, table, source: "finmind", minDate: extents.minDate, lastIngestedAt: extents.lastIngestedAt, ...s };
    }),
    ...tradingFlowTables.map(async ({ table, dataset, staleDays }) => {
      const s = await queryTradingFlowDatasetStats(table, staleDays ?? 5).catch(() => ({
        rowCount: 0, latestDate: null, state: "ERROR" as const, missingReason: "query_failed"
      }));
      const extents = s.rowCount > 0 ? await queryTableDateExtents(table).catch(() => ({ minDate: null, maxDate: null, lastIngestedAt: null })) : { minDate: null, maxDate: null, lastIngestedAt: null };
      return { dataset, table, source: "finmind", minDate: extents.minDate, lastIngestedAt: extents.lastIngestedAt, ...s };
    }),
    ...marketIntelTables.map(async ({ table, dataset, staleDays, dateCol, experimental }) => {
      const s = await queryMarketIntelDatasetStats(table, staleDays ?? 7, dateCol ?? "date").catch(() => ({
        rowCount: 0, latestDate: null, state: "ERROR" as const, missingReason: "query_failed"
      }));
      const extents = s.rowCount > 0 ? await queryTableDateExtents(table).catch(() => ({ minDate: null, maxDate: null, lastIngestedAt: null })) : { minDate: null, maxDate: null, lastIngestedAt: null };
      return { dataset, table, source: "finmind", minDate: extents.minDate, lastIngestedAt: extents.lastIngestedAt, ...(experimental ? { experimental } : {}), ...s };
    })
  ]);

  return [ohlcvRow, ...otherRows];
}

// ── Per-dataset backfill (for POST /api/v1/internal/finmind/backfill) ──────────

export type BackfillDataset = "companies_ohlcv" | "tw_institutional_buysell" | "tw_margin_short" | "tw_dividend";

export interface DatasetBackfillResult {
  dataset: BackfillDataset;
  table: string;
  from: string;
  to: string;
  tickersAttempted: number;
  rowsUpserted: number;
  rowsQuarantined: number;
  skipped: boolean;
  skipReason: string | null;
  durationMs: number;
  state: "synced" | "skipped" | "error";
  error?: string;
}

/**
 * runDatasetBackfill — targeted date-range backfill for the 3 source-pack core tables.
 *
 * Designed for the admin endpoint POST /api/v1/internal/finmind/backfill.
 * Uses the existing sync functions with explicit startDate/endDate.
 *
 * Hard lines:
 *   - Owner-only (enforced at route level)
 *   - FINMIND_API_TOKEN required
 *   - No fake data
 *   - batchSize default 50 (sponsor quota: 6000/hr)
 *   - Respects FINMIND_KILL_SWITCH
 *   - from/to validated as YYYY-MM-DD; from <= to
 */
export async function runDatasetBackfill(params: {
  dataset: BackfillDataset;
  from: string;
  to: string;
  workspaceSlug: string;
  batchSize?: number;
}): Promise<DatasetBackfillResult> {
  const t0 = Date.now();
  const { dataset, from, to, workspaceSlug } = params;

  const tableMap: Record<BackfillDataset, string> = {
    companies_ohlcv: "companies_ohlcv",
    tw_institutional_buysell: "tw_institutional_buysell",
    tw_margin_short: "tw_margin_short",
    tw_dividend: "tw_dividend"
  };
  const table = tableMap[dataset];

  const baseResult = (
    state: DatasetBackfillResult["state"],
    extra: Partial<DatasetBackfillResult> = {}
  ): DatasetBackfillResult => ({
    dataset,
    table,
    from,
    to,
    tickersAttempted: 0,
    rowsUpserted: 0,
    rowsQuarantined: 0,
    skipped: state === "skipped",
    skipReason: null,
    durationMs: Date.now() - t0,
    state,
    ...extra
  });

  if (process.env.FINMIND_KILL_SWITCH === "true") {
    return baseResult("skipped", { skipReason: "kill_switch_active" });
  }

  if (!process.env.FINMIND_API_TOKEN) {
    return baseResult("skipped", { skipReason: "no_finmind_token" });
  }

  // Resolve workspace tickers
  const tickers = await resolveWorkspaceTickers(workspaceSlug);
  if (tickers.length === 0) {
    return baseResult("skipped", { skipReason: "no_tickers_in_workspace" });
  }

  const batchSize = params.batchSize ?? 50;
  const tickerBatch = tickers.length > batchSize
    ? [...tickers].sort((a, b) => a.ticker.localeCompare(b.ticker)).slice(0, batchSize)
    : tickers;

  console.log(
    `[finmind-backfill] START dataset=${dataset} from=${from} to=${to} ` +
    `tickers=${tickerBatch.length} workspace=${workspaceSlug}`
  );

  try {
    if (dataset === "companies_ohlcv") {
      // OHLCV uses runOhlcvFinmindSync which takes { companyId, ticker, workspaceId }
      // We need workspaceId for that — resolve it
      const workspaceId = await resolveWorkspaceId(workspaceSlug);
      if (!workspaceId) {
        return baseResult("skipped", { skipReason: "workspace_not_found" });
      }
      const db = getDb();
      if (!db) {
        return baseResult("skipped", { skipReason: "db_unavailable" });
      }
      // Fetch full company rows with IDs for OHLCV sync
      const companyRows = await db.execute(drizzleSql`
        SELECT id, ticker FROM companies
        WHERE workspace_id = ${workspaceId}
          AND ticker ~ '^[0-9]{4}$'
      `);
      const allCompanies = ((companyRows as { rows?: Record<string, unknown>[] })?.rows
        ?? (Array.isArray(companyRows) ? companyRows : []) as Record<string, unknown>[]) as Record<string, unknown>[];
      const ohlcvTickers = allCompanies
        .map((r) => ({ companyId: String(r.id ?? ""), ticker: String(r.ticker ?? ""), workspaceId }))
        .filter((r) => /^\d{4}$/.test(r.ticker))
        .slice(0, batchSize);

      // Import runOhlcvFinmindSync dynamically to avoid circular dep
      const { runOhlcvFinmindSync } = await import("./ohlcv-finmind-sync.js");
      const result = await runOhlcvFinmindSync(ohlcvTickers, {
        startDate: from,
        endDate: to,
        forceFinmind: true
      });
      return {
        dataset,
        table,
        from,
        to,
        tickersAttempted: result.tickersAttempted,
        rowsUpserted: result.tickersSuccess > 0
          ? result.results.reduce((s, r) => s + r.barsUpserted, 0)
          : 0,
        rowsQuarantined: 0,
        skipped: result.tickersAttempted === 0,
        skipReason: result.tickersAttempted === 0 ? "no_tickers" : null,
        durationMs: result.durationMs,
        state: result.tickersFailed === result.tickersAttempted && result.tickersAttempted > 0
          ? "error"
          : "synced"
      };
    } else if (dataset === "tw_institutional_buysell") {
      const result = await runInstitutionalBuySellSync(tickerBatch, { startDate: from, endDate: to });
      return {
        dataset, table, from, to,
        tickersAttempted: tickerBatch.length,
        rowsUpserted: result.rowsUpserted,
        rowsQuarantined: result.rowsQuarantined,
        skipped: result.skipped,
        skipReason: result.skipReason,
        durationMs: Date.now() - t0,
        state: result.skipped ? "skipped" : "synced"
      };
    } else if (dataset === "tw_margin_short") {
      const result = await runMarginShortSync(tickerBatch, { startDate: from, endDate: to });
      return {
        dataset, table, from, to,
        tickersAttempted: tickerBatch.length,
        rowsUpserted: result.rowsUpserted,
        rowsQuarantined: result.rowsQuarantined,
        skipped: result.skipped,
        skipReason: result.skipReason,
        durationMs: Date.now() - t0,
        state: result.skipped ? "skipped" : "synced"
      };
    } else {
      // tw_dividend
      const result = await runDividendSync(tickerBatch, { startDate: from, endDate: to });
      return {
        dataset, table, from, to,
        tickersAttempted: tickerBatch.length,
        rowsUpserted: result.rowsUpserted,
        rowsQuarantined: result.rowsQuarantined,
        skipped: result.skipped,
        skipReason: result.skipReason ?? null,
        durationMs: Date.now() - t0,
        state: result.skipped ? "skipped" : result.rowsUpserted >= 0 ? "synced" : "error"
      };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[finmind-backfill] dataset=${dataset} ERROR: ${errMsg}`);
    return baseResult("error", { error: errMsg, durationMs: Date.now() - t0 });
  }
}
