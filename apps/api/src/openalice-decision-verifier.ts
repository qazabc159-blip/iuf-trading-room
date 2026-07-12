/**
 * openalice-decision-verifier.ts — OpenAlice M4 Decision Outcome Tracking
 *
 * After deep_analyze decisions are executed (status=done, real report produced),
 * back-fill outcome.verification with forward price returns so the brain can
 * self-audit its stock-pick quality.
 *
 * Design principles:
 *   - Reuses price helpers from ai-rec-perf-store pattern (companies_ohlcv + 0050 benchmark)
 *   - No new table / no migration — writes into iuf_decisions.outcome JSONB
 *   - Fail-open per row: price unavailable → null (never blocks the whole run)
 *   - Only verifies "real report" deep_analyze (reportSummary must not contain sentinel)
 *   - Honest about maturity: today's decisions have no forward data yet (ret_1d/5d = null)
 *
 * outcome.verification schema (embedded in iuf_decisions.outcome JSONB):
 * {
 *   entry_date:   "YYYY-MM-DD",       // UTC date of decision (created_at)
 *   entry_close:  number | null,      // stock close on entry_date
 *   ret_1d:       number | null,      // (close+1d - entry_close) / entry_close
 *   ret_5d:       number | null,      // (close+5d - entry_close) / entry_close
 *   excess_1d:    number | null,      // ret_1d - 0050_ret_1d
 *   excess_5d:    number | null,      // ret_5d - 0050_ret_5d
 *   hit_1d:       boolean | null,     // excess_1d > 0
 *   hit_5d:       boolean | null,     // excess_5d > 0
 *   updated_at:   string              // ISO timestamp of last verification update
 * }
 *
 * Lane boundary:
 *   - Read-only access to companies_ohlcv (price source)
 *   - Writes ONLY to iuf_decisions.outcome (JSONB column — no migration needed)
 *   - Does NOT import or modify: ai-rec-perf-store, risk-engine, broker, web, market-data
 *   - Does NOT submit orders or mutate positions
 *   - SIM-safe: price reading only
 *
 * 2026-06-25: Initial M4 implementation (Jason, backend-strategy lane).
 */

import { sql as drizzleSql } from "drizzle-orm";
import { getDb, isDatabaseMode, execRows } from "@iuf-trading-room/db";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DecisionVerification {
  entry_date: string;
  entry_close: number | null;
  ret_1d: number | null;
  ret_5d: number | null;
  excess_1d: number | null;
  excess_5d: number | null;
  hit_1d: boolean | null;
  hit_5d: boolean | null;
  updated_at: string;
}

export interface DecisionPerformanceSummary {
  /** Number of deep_analyze decisions with a real report (eligible for verification) */
  eligible: number;
  /** How many have at least 1d return computed */
  verified_1d: number;
  /** How many have at least 5d return computed */
  verified_5d: number;
  /** Hit rate (excess_1d > 0) among verified 1d — null when sample < 1 */
  hit_rate_1d: number | null;
  /** Hit rate (excess_5d > 0) among verified 5d */
  hit_rate_5d: number | null;
  /** Average excess return (vs 0050) for 1d horizon */
  avg_excess_1d: number | null;
  /** Average excess return (vs 0050) for 5d horizon */
  avg_excess_5d: number | null;
  /** Benchmark ticker used */
  benchmark: string;
  computed_at: string;
}

// Row shape from iuf_decisions
type DecisionRow = {
  id: string;
  workspace_id: string;
  created_at: string | Date;
  outcome: Record<string, unknown> | string | null;
};

// ── Price helpers (same pattern as ai-rec-perf-store.ts, no import from it) ────
// We intentionally do NOT import from ai-rec-perf-store.ts to keep lane boundary
// clean. The logic is identical but scoped to this module.

type PriceDb = import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>;

/**
 * Get stock close price on or before a given date (decision entry baseline).
 * Returns null when no data found.
 */
async function getCloseOnOrBefore(
  db: PriceDb,
  ticker: string,
  dateStr: string   // YYYY-MM-DD
): Promise<number | null> {
  try {
    const res = await db.execute(drizzleSql`
      SELECT o.close AS close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE c.ticker = ${ticker}
        AND o.interval IN ('1d', 'day')
        AND o.dt::date <= ${dateStr}::date
      ORDER BY o.dt DESC
      LIMIT 1
    `);
    const v = parseFloat(execRows<{ close: string | null }>(res)[0]?.close ?? "");
    return isNaN(v) ? null : v;
  } catch {
    return null;
  }
}

/**
 * Get close price N trading days AFTER a given date.
 * Returns null when insufficient history (forward period not yet elapsed).
 */
async function getCloseNDaysAfter(
  db: PriceDb,
  ticker: string,
  dateStr: string,   // YYYY-MM-DD
  n: number
): Promise<number | null> {
  try {
    const res = await db.execute(drizzleSql`
      SELECT o.close AS close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE c.ticker = ${ticker}
        AND o.interval IN ('1d', 'day')
        AND o.dt > ${dateStr}::date
      ORDER BY o.dt ASC
      LIMIT 1 OFFSET ${drizzleSql.raw(String(n - 1))}
    `);
    const v = parseFloat(execRows<{ close: string | null }>(res)[0]?.close ?? "");
    return isNaN(v) ? null : v;
  } catch {
    return null;
  }
}

/** Compute (end - start) / start. Returns null if either price is null/zero. */
function calcReturn(start: number | null, end: number | null): number | null {
  if (start === null || end === null || start === 0) return null;
  return (end - start) / start;
}

// ── Sentinel check (same string as governance gate in action-executor) ─────────

const EMPTY_REPORT_SENTINEL = "報告生成失敗";

/**
 * Extract primary ticker from a deep_analyze decision's outcome.
 * Reads outcome.tickers[0] → outcome.analyses[0].ticker → null.
 */
function extractTickerFromOutcome(outcome: Record<string, unknown>): string | null {
  // Primary: outcome.tickers array (executor writes this)
  const tickers = outcome["tickers"];
  if (Array.isArray(tickers) && typeof tickers[0] === "string" && tickers[0].trim()) {
    return tickers[0].trim();
  }

  // Fallback: outcome.analyses[0].ticker
  const analyses = outcome["analyses"];
  if (Array.isArray(analyses)) {
    const first = analyses[0] as Record<string, unknown> | undefined;
    if (first && typeof first["ticker"] === "string" && first["ticker"].trim()) {
      return first["ticker"].trim();
    }
  }

  return null;
}

/**
 * Returns true when the decision's deep_analyze outcome has at least one real report
 * (i.e. no sentinel string and status=complete).
 */
function hasRealReport(outcome: Record<string, unknown>): boolean {
  const analyses = outcome["analyses"];
  if (!Array.isArray(analyses)) return false;

  for (const a of analyses) {
    const item = a as Record<string, unknown>;
    if (item["status"] === "complete") {
      const summary = typeof item["reportSummary"] === "string" ? item["reportSummary"] : "";
      if (!summary.includes(EMPTY_REPORT_SENTINEL)) return true;
    }
  }
  return false;
}

// ── UTC date helper ────────────────────────────────────────────────────────────

function toUtcDateStr(dt: string | Date): string {
  const d = typeof dt === "string" ? new Date(dt) : dt;
  return d.toISOString().slice(0, 10);
}

// ── Core: compute verification for a single decision ──────────────────────────

/**
 * Compute forward returns for one deep_analyze decision.
 * Returns null when the ticker cannot be determined or entry price unavailable.
 * Returns partial (ret_1d=null) when forward period not yet elapsed.
 */
export async function computeVerification(
  db: PriceDb,
  decisionId: string,
  entryDate: string,
  ticker: string
): Promise<DecisionVerification | null> {
  const BENCHMARK = "0050";

  // Entry close (stock)
  const entryClose = await getCloseOnOrBefore(db, ticker, entryDate);
  if (entryClose === null) {
    // No price data for this ticker — cannot verify
    return null;
  }

  // Forward prices (stock + benchmark)
  const [stockP1, stockP5, benchP0, benchP1, benchP5] = await Promise.all([
    getCloseNDaysAfter(db, ticker, entryDate, 1),
    getCloseNDaysAfter(db, ticker, entryDate, 5),
    getCloseOnOrBefore(db, BENCHMARK, entryDate),
    getCloseNDaysAfter(db, BENCHMARK, entryDate, 1),
    getCloseNDaysAfter(db, BENCHMARK, entryDate, 5),
  ]);

  const ret1d = calcReturn(entryClose, stockP1);
  const ret5d = calcReturn(entryClose, stockP5);

  const benchRet1d = calcReturn(benchP0, benchP1);
  const benchRet5d = calcReturn(benchP0, benchP5);

  const excess1d = ret1d !== null && benchRet1d !== null ? ret1d - benchRet1d : null;
  const excess5d = ret5d !== null && benchRet5d !== null ? ret5d - benchRet5d : null;

  return {
    entry_date: entryDate,
    entry_close: entryClose,
    ret_1d: ret1d,
    ret_5d: ret5d,
    excess_1d: excess1d,
    excess_5d: excess5d,
    hit_1d: excess1d !== null ? excess1d > 0 : null,
    hit_5d: excess5d !== null ? excess5d > 0 : null,
    updated_at: new Date().toISOString(),
  };
}

// ── Daily verification tick ────────────────────────────────────────────────────

/**
 * updateDecisionVerifications — daily cron job.
 *
 * Scans iuf_decisions for done deep_analyze rows with a real report whose
 * outcome.verification is absent or stale (updated > 24h ago or ret_1d still null
 * but 1+ day elapsed), computes forward returns, and back-fills outcome.verification.
 *
 * Processes up to MAX_ROWS_PER_TICK per call (batched like updateForwardReturns).
 * Called once daily from server.ts after ai-rec-perf cron (15:00+ TST window).
 *
 * Honest about maturity:
 *   - If forward data not yet in DB (period not elapsed), ret_Nd stays null.
 *   - We re-run until filled: rows with null ret_1d that are >1 trading day old
 *     will be retried on subsequent daily runs.
 *
 * Returns { updated, skipped, errors }.
 */
export async function updateDecisionVerifications(workspaceId?: string): Promise<{
  updated: number;
  skipped: number;
  errors: number;
}> {
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  if (!isDatabaseMode()) return { updated, skipped, errors };
  const db = getDb();
  if (!db) return { updated, skipped, errors };

  const typedDb = db as unknown as PriceDb;
  const workspaceFilter = workspaceId
    ? drizzleSql`AND workspace_id = ${workspaceId}`
    : drizzleSql``;

  try {
    // Find done deep_analyze decisions whose verification is absent or stale.
    // "stale" = verification.updated_at is older than 24h AND ret_5d still null.
    // We only look at rows where created_at < today (forward data needs time to mature).
    const rows = await db.execute(drizzleSql`
      SELECT id, workspace_id, created_at, outcome
      FROM iuf_decisions
      WHERE action_type = 'deep_analyze'
        ${workspaceFilter}
        AND status = 'done'
        AND created_at < NOW() - INTERVAL '1 day'
        AND (
          outcome->'verification' IS NULL
          OR (
            (outcome->'verification'->>'ret_5d') IS NULL
            AND (outcome->'verification'->>'updated_at')::timestamptz < NOW() - INTERVAL '1 day'
          )
        )
      ORDER BY created_at ASC
      LIMIT ${drizzleSql.raw(String(MAX_ROWS_PER_TICK))}
    `);

    const pendingRows = execRows<DecisionRow>(rows);

    if (pendingRows.length === 0) {
      console.info("[openalice-decision-verifier] no decisions pending verification");
      return { updated, skipped, errors };
    }

    console.info(`[openalice-decision-verifier] verifying ${pendingRows.length} decisions`);

    for (const row of pendingRows) {
      try {
        const outcome = parseOutcome(row.outcome);

        // Only verify real reports — skip sentinel / advisory / unknown
        if (!hasRealReport(outcome)) {
          skipped++;
          continue;
        }

        const ticker = extractTickerFromOutcome(outcome);
        if (!ticker) {
          skipped++;
          continue;
        }

        const entryDate = toUtcDateStr(row.created_at);
        const verification = await computeVerification(typedDb, row.id, entryDate, ticker);

        if (!verification) {
          // No price data for this ticker — mark as skipped (not an error)
          skipped++;
          continue;
        }

        // Merge verification into existing outcome JSONB
        await db.execute(drizzleSql`
          UPDATE iuf_decisions
          SET outcome = jsonb_set(
            COALESCE(outcome, '{}'::jsonb),
            '{verification}',
            ${JSON.stringify(verification)}::jsonb,
            true
          )
          WHERE workspace_id = ${row.workspace_id}
            AND id = ${row.id}::uuid
        `);

        updated++;
        console.log(
          `[openalice-decision-verifier] ${row.id} ${ticker} ${entryDate} ` +
            `ret_1d=${verification.ret_1d?.toFixed(4) ?? "n/a"} ` +
            `excess_1d=${verification.excess_1d?.toFixed(4) ?? "n/a"} ` +
            `hit_1d=${verification.hit_1d ?? "pending"}`
        );
      } catch (e) {
        errors++;
        console.warn(
          "[openalice-decision-verifier] row error:",
          e instanceof Error ? e.message : String(e)
        );
      }
    }

    console.info(
      `[openalice-decision-verifier] done — updated=${updated} skipped=${skipped} errors=${errors}`
    );
  } catch (e) {
    console.warn(
      "[openalice-decision-verifier] outer error:",
      e instanceof Error ? e.message : String(e)
    );
  }

  return { updated, skipped, errors };
}

// ── Performance summary query ──────────────────────────────────────────────────

/**
 * getDecisionPerformance — aggregate hit_rate / avg_excess across all verified
 * deep_analyze decisions.
 *
 * Called by getOrchestratorObservability (M3/endpoint reads).
 * Returns null when no data yet (pipe is new — honest, not fake 0%).
 * Fail-open: any DB error returns a null-fields summary.
 */
export async function getDecisionPerformance(workspaceId: string): Promise<DecisionPerformanceSummary> {
  const empty: DecisionPerformanceSummary = {
    eligible: 0,
    verified_1d: 0,
    verified_5d: 0,
    hit_rate_1d: null,
    hit_rate_5d: null,
    avg_excess_1d: null,
    avg_excess_5d: null,
    benchmark: "0050",
    computed_at: new Date().toISOString(),
  };

  if (!isDatabaseMode()) return empty;
  const db = getDb();
  if (!db) return empty;

  try {
    // Count eligible decisions (done deep_analyze with real report)
    const eligibleRes = await db.execute(drizzleSql`
      SELECT COUNT(*)::int AS n
      FROM iuf_decisions
      WHERE workspace_id = ${workspaceId}
        AND action_type = 'deep_analyze'
        AND status = 'done'
        AND outcome->'verification' IS NOT NULL
    `);
    const eligible = Number(execRows<{ n: number }>(eligibleRes)[0]?.n ?? 0);

    if (eligible === 0) return { ...empty, computed_at: new Date().toISOString() };

    // Aggregate returns from outcome.verification JSONB
    const statsRes = await db.execute(drizzleSql`
      SELECT
        COUNT(*) FILTER (WHERE (outcome->'verification'->>'ret_1d') IS NOT NULL)::int AS n_1d,
        COUNT(*) FILTER (WHERE (outcome->'verification'->>'ret_5d') IS NOT NULL)::int AS n_5d,
        COUNT(*) FILTER (
          WHERE (outcome->'verification'->>'excess_1d')::float > 0
        )::int AS hit_1d,
        COUNT(*) FILTER (
          WHERE (outcome->'verification'->>'excess_5d')::float > 0
        )::int AS hit_5d,
        AVG((outcome->'verification'->>'excess_1d')::float) FILTER (
          WHERE (outcome->'verification'->>'excess_1d') IS NOT NULL
        ) AS avg_excess_1d,
        AVG((outcome->'verification'->>'excess_5d')::float) FILTER (
          WHERE (outcome->'verification'->>'excess_5d') IS NOT NULL
        ) AS avg_excess_5d
      FROM iuf_decisions
      WHERE workspace_id = ${workspaceId}
        AND action_type = 'deep_analyze'
        AND status = 'done'
        AND outcome->'verification' IS NOT NULL
    `);

    const s = execRows<{
      n_1d: number; n_5d: number;
      hit_1d: number; hit_5d: number;
      avg_excess_1d: number | null; avg_excess_5d: number | null;
    }>(statsRes)[0];

    if (!s) return { ...empty, eligible, computed_at: new Date().toISOString() };

    return {
      eligible,
      verified_1d: s.n_1d ?? 0,
      verified_5d: s.n_5d ?? 0,
      hit_rate_1d: s.n_1d > 0 ? s.hit_1d / s.n_1d : null,
      hit_rate_5d: s.n_5d > 0 ? s.hit_5d / s.n_5d : null,
      avg_excess_1d: s.avg_excess_1d !== null ? Number(s.avg_excess_1d) : null,
      avg_excess_5d: s.avg_excess_5d !== null ? Number(s.avg_excess_5d) : null,
      benchmark: "0050",
      computed_at: new Date().toISOString(),
    };
  } catch (e) {
    console.warn(
      "[openalice-decision-verifier] getDecisionPerformance error:",
      e instanceof Error ? e.message : String(e)
    );
    return empty;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MAX_ROWS_PER_TICK = 30;

function parseOutcome(raw: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return raw;
}

// ── Test-only exports ──────────────────────────────────────────────────────────

/** Exposed for unit tests — verifies sentinel check logic. */
export function _hasRealReportForTest(outcome: Record<string, unknown>): boolean {
  return hasRealReport(outcome);
}

/** Exposed for unit tests — verifies ticker extraction. */
export function _extractTickerFromOutcomeForTest(outcome: Record<string, unknown>): string | null {
  return extractTickerFromOutcome(outcome);
}

/** Exposed for unit tests — verifies return calculation. */
export function _calcReturnForTest(start: number | null, end: number | null): number | null {
  return calcReturn(start, end);
}

/** Sentinel string used to detect empty reports — exported for test parity. */
export const _VERIFIER_SENTINEL_FOR_TEST = EMPTY_REPORT_SENTINEL;
