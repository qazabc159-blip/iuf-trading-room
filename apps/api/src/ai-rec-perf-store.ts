/**
 * ai-rec-perf-store.ts — Forward-performance tracking for AI pick snapshots
 *
 * Responsibilities:
 *   1. snapshotV3Picks(result)   — called after v3 run completes; writes ai_rec_pick_snapshots rows
 *   2. updateForwardReturns()    — daily cron; fills ret_1d/5d/20d + excess vs TAIEX
 *   3. getAiRecPerformance()     — performance endpoint query: hit_rate, avg_excess by bucket
 *
 * Lane boundary: read-only access to companies_ohlcv and ai_recommendations_runs.
 *   Does NOT modify orchestrator-v3, does NOT touch risk/broker/frontend.
 *
 * Price source: companies_ohlcv (FinMind-sourced). TAIEX ticker = 'TAIEX' or '0000'.
 * Fail-open: missing prices → NULL; never blocks snapshot write.
 */

import type { AiRecommendationV3RunResult } from "./ai-recommendation-v2/orchestrator-v3.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AiRecPerfBucketStat {
  bucket: string;
  sampleCount: number;
  hit_rate_1d: number | null;   // fraction where excess_1d > 0
  hit_rate_5d: number | null;
  hit_rate_20d: number | null;
  avg_excess_1d: number | null;
  avg_excess_5d: number | null;
  avg_excess_20d: number | null;
}

export interface AiRecPerfResult {
  /** Overall hit rate (excess > 0) for 1d horizon, across A+/A/B buckets only */
  overall_hit_rate_1d: number | null;
  overall_hit_rate_5d: number | null;
  overall_hit_rate_20d: number | null;
  /** Average excess return vs TAIEX for 1d/5d/20d */
  avg_excess_1d: number | null;
  avg_excess_5d: number | null;
  avg_excess_20d: number | null;
  /** Sample counts */
  total_picks: number;
  picks_with_ret_1d: number;
  picks_with_ret_5d: number;
  picks_with_ret_20d: number;
  /** By-bucket breakdown */
  by_bucket: AiRecPerfBucketStat[];
  /** Date range in data */
  earliest_pick_date: string | null;
  latest_pick_date: string | null;
  computed_at: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Normalize db.execute() results. This repo's driver is drizzle-orm/postgres-js,
 * whose execute() returns the row array DIRECTLY — there is no `.rows` wrapper.
 * Every reader in this module was written against the node-postgres shape and
 * therefore ALWAYS saw zero rows (audit B2 root cause: performance forever 0,
 * forward returns a permanent no-op, backfill runsSeen=0). Accept both shapes.
 */
export function execRows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const wrapped = res as { rows?: T[] };
  return Array.isArray(wrapped?.rows) ? wrapped.rows : [];
}

/** Get latest close price for a ticker from companies_ohlcv. Returns null if unavailable. */
async function getLatestCloseFromDb(
  db: import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>,
  ticker: string
): Promise<number | null> {
  try {
    const { sql } = await import("drizzle-orm");
    const res = await db.execute(sql`
      SELECT o.close AS close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE c.ticker = ${ticker}
        AND o.interval IN ('1d', 'day')
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
 * Get close price for a ticker N trading days after a given date.
 * Queries companies_ohlcv: finds the Nth row after pick_date in ascending order.
 * Returns null if insufficient history.
 */
async function getCloseNDaysAfter(
  db: import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>,
  ticker: string,
  pickDate: string,  // YYYY-MM-DD
  n: number
): Promise<number | null> {
  try {
    const { sql } = await import("drizzle-orm");
    // Find the Nth trading day AFTER pick_date (OFFSET n-1 skips n-1 rows)
    const res = await db.execute(sql`
      SELECT o.close AS close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE c.ticker = ${ticker}
        AND o.interval IN ('1d', 'day')
        AND o.dt > ${pickDate}::date
      ORDER BY o.dt ASC
      LIMIT 1 OFFSET ${n - 1}
    `);
    const v = parseFloat(execRows<{ close: string | null }>(res)[0]?.close ?? "");
    return isNaN(v) ? null : v;
  } catch {
    return null;
  }
}

/** Compute (end - start) / start return. Returns null if either price is null/zero. */
function calcReturn(start: number | null, end: number | null): number | null {
  if (start === null || end === null || start === 0) return null;
  return (end - start) / start;
}

/** Compute today's TST date string YYYY-MM-DD */
function todayTst(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// ── 1. snapshotV3Picks ────────────────────────────────────────────────────────

/**
 * Called after a v3 run completes. Writes one row per item into ai_rec_pick_snapshots.
 * Uses UPSERT (ON CONFLICT DO UPDATE) — safe to call multiple times for same run.
 * Fails silently: pick snapshot failure must never crash the v3 run caller.
 */
/** Minimal item shape shared by live results and DB-restored runs. */
interface PickItemLike {
  ticker?: string | null;
  bucket?: string | null;
  action?: string | null;
  confidence?: number | null;
  totalScore?: number | null;
  entryPriceRange?: { low?: number | null; high?: number | null } | null;
  entryZone?: { low?: number | null; high?: number | null } | null;
  tp1?: number | null;
  tp2?: number | null;
  stopLoss?: number | null;
  tp1Structured?: { price?: number | null } | null;
  tp2Structured?: { price?: number | null } | null;
  stopLossStructured?: { price?: number | null } | null;
}

type PerfDb = import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>;

/** Upsert one pick row. Throws on failure — callers decide whether to swallow. */
async function upsertPickRow(
  db: PerfDb,
  pickDate: string,
  item: PickItemLike,
  runId: string,
  pickPrice: number | null
): Promise<void> {
  const { sql } = await import("drizzle-orm");
  const bucket = item.bucket ?? "C";
  const action = item.action ?? "資料不足暫不推薦";
  const entryLow = item.entryPriceRange?.low ?? (item.entryZone?.low ?? null);
  const entryHigh = item.entryPriceRange?.high ?? (item.entryZone?.high ?? null);
  const tp1 = item.tp1 ?? (item.tp1Structured?.price ?? null);
  const tp2 = item.tp2 ?? (item.tp2Structured?.price ?? null);
  const stopLoss = item.stopLoss ?? (item.stopLossStructured?.price ?? null);

  await db.execute(sql`
    INSERT INTO ai_rec_pick_snapshots
      (pick_date, ticker, bucket, action, confidence, total_score,
       pick_price, entry_low, entry_high, tp1, tp2, stop_loss, run_id)
    VALUES
      (${pickDate}::date, ${item.ticker}, ${bucket}, ${action},
       ${item.confidence ?? null}, ${item.totalScore ?? null},
       ${pickPrice !== null ? pickPrice.toFixed(2) : null},
       ${entryLow !== null && entryLow !== undefined ? Number(entryLow).toFixed(2) : null},
       ${entryHigh !== null && entryHigh !== undefined ? Number(entryHigh).toFixed(2) : null},
       ${tp1 !== null && tp1 !== undefined ? Number(tp1).toFixed(2) : null},
       ${tp2 !== null && tp2 !== undefined ? Number(tp2).toFixed(2) : null},
       ${stopLoss !== null && stopLoss !== undefined ? Number(stopLoss).toFixed(2) : null},
       ${runId})
    ON CONFLICT (pick_date, ticker)
    DO UPDATE SET
      bucket       = EXCLUDED.bucket,
      action       = EXCLUDED.action,
      confidence   = EXCLUDED.confidence,
      total_score  = EXCLUDED.total_score,
      pick_price   = EXCLUDED.pick_price,
      entry_low    = EXCLUDED.entry_low,
      entry_high   = EXCLUDED.entry_high,
      tp1          = EXCLUDED.tp1,
      tp2          = EXCLUDED.tp2,
      stop_loss    = EXCLUDED.stop_loss,
      run_id       = EXCLUDED.run_id
  `);
}

/** Close price for ticker at the most recent trading day ≤ pickDate (historical backfill). */
async function getCloseOnOrBefore(db: PerfDb, ticker: string, pickDate: string): Promise<number | null> {
  try {
    const { sql } = await import("drizzle-orm");
    const res = await db.execute(sql`
      SELECT o.close AS close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE c.ticker = ${ticker}
        AND o.interval IN ('1d', 'day')
        AND o.dt::date <= ${pickDate}::date
      ORDER BY o.dt DESC
      LIMIT 1
    `);
    const v = parseFloat(execRows<{ close: string | null }>(res)[0]?.close ?? "");
    return isNaN(v) ? null : v;
  } catch {
    return null;
  }
}

export async function snapshotV3Picks(result: AiRecommendationV3RunResult): Promise<void> {
  if (result.status !== "complete" && result.status !== "synthesis_format_error") return;
  if (!result.items || result.items.length === 0) return;

  try {
    const { getDb, isDatabaseMode } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return;
    const db = getDb() as unknown as PerfDb | null;
    if (!db) return;

    const pickDate = todayTst();
    let written = 0;
    let failed = 0;

    for (const item of result.items) {
      if (!item.ticker) continue;
      try {
        // Resolve pick price from companies_ohlcv (fail-open: null if unavailable)
        const pickPrice = await getLatestCloseFromDb(db, item.ticker);
        await upsertPickRow(db, pickDate, item, result.runId, pickPrice);
        written++;
      } catch (itemErr) {
        // Per-item isolation: one bad row must not abort the rest of the batch
        // (the old single try/catch did exactly that — audit B2: total_picks=0).
        failed++;
        console.warn(`[ai-rec-perf] pick upsert failed ticker=${item.ticker}:`, itemErr instanceof Error ? itemErr.message : itemErr);
      }
    }

    console.info(`[ai-rec-perf] snapshot for ${pickDate}: written=${written} failed=${failed}`);
  } catch (err) {
    // Fail-open: snapshot failure must not propagate
    console.warn("[ai-rec-perf] snapshotV3Picks failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

/**
 * Historical backfill — rebuilds pick snapshots from ai_recommendations_runs
 * (status=complete v3 runs, latest run per Taipei date). No LLM involved; price
 * data comes from companies_ohlcv. Errors are RETURNED (not swallowed) so the
 * admin caller can see exactly why a write failed.
 */
export async function backfillPickSnapshots(): Promise<{
  runsSeen: number;
  picksWritten: number;
  picksFailed: number;
  errors: string[];
}> {
  const out = { runsSeen: 0, picksWritten: 0, picksFailed: 0, errors: [] as string[] };

  const { getDb, isDatabaseMode } = await import("@iuf-trading-room/db");
  if (!isDatabaseMode()) {
    out.errors.push("memory_mode");
    return out;
  }
  const db = getDb() as unknown as PerfDb | null;
  if (!db) {
    out.errors.push("no_db");
    return out;
  }

  const { sql } = await import("drizzle-orm");
  const runs = (await db.execute(sql`
    SELECT DISTINCT ON (((generated_at AT TIME ZONE 'Asia/Taipei')::date))
      run_id,
      items,
      ((generated_at AT TIME ZONE 'Asia/Taipei')::date)::text AS pick_date
    FROM ai_recommendations_runs
    WHERE trigger LIKE '%:v3'
      AND status = 'complete'
      AND jsonb_array_length(items) > 0
    ORDER BY ((generated_at AT TIME ZONE 'Asia/Taipei')::date), generated_at DESC
  `));

  for (const run of execRows<{ run_id: string; items: unknown; pick_date: string }>(runs)) {
    out.runsSeen++;
    const items = Array.isArray(run.items) ? (run.items as PickItemLike[]) : [];
    for (const item of items) {
      if (!item.ticker) continue;
      try {
        const pickPrice = await getCloseOnOrBefore(db, item.ticker, run.pick_date);
        await upsertPickRow(db, run.pick_date, item, run.run_id, pickPrice);
        out.picksWritten++;
      } catch (e) {
        out.picksFailed++;
        const msg = `${run.pick_date}/${item.ticker}: ${e instanceof Error ? e.message : String(e)}`;
        if (out.errors.length < 5) out.errors.push(msg);
      }
    }
  }

  console.info(`[ai-rec-perf] backfill: runs=${out.runsSeen} written=${out.picksWritten} failed=${out.picksFailed}`);
  return out;
}

// ── 2. updateForwardReturns ───────────────────────────────────────────────────

/**
 * Daily cron job — updates ret_1d/5d/20d and excess returns for all snapshots
 * that are missing or stale (ret_updated_at is null or < today).
 *
 * Logic:
 *   - For each snapshot where pick_price is not null:
 *     - Try to fetch price at +1, +5, +20 trading days from companies_ohlcv
 *     - Compute TAIEX return for same periods (ticker '0000' or 'TAIEX')
 *     - Compute excess = stock_ret - taiex_ret
 *   - Upsert ret columns and ret_updated_at
 *
 * Processes up to 50 rows per call to avoid long-running queries.
 * Called once daily from server.ts scheduler after market close (14:30+ TST).
 */
export async function updateForwardReturns(): Promise<{ updated: number; errors: number }> {
  let updated = 0;
  let errors = 0;

  try {
    const { getDb, isDatabaseMode } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return { updated, errors };
    const db = getDb();
    if (!db) return { updated, errors };

    const { sql } = await import("drizzle-orm");
    const typedDb = db as unknown as import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>;

    // Find rows needing update: pick_price is set but returns not yet computed or last update was old
    const todayStr = todayTst();
    const rows = (await db.execute(sql`
      SELECT id, pick_date::text AS pick_date, ticker, pick_price::float AS pick_price
      FROM ai_rec_pick_snapshots
      WHERE pick_price IS NOT NULL
        AND pick_date < ${todayStr}::date
        AND (ret_updated_at IS NULL OR ret_updated_at::date < ${todayStr}::date)
      ORDER BY ret_updated_at NULLS FIRST, pick_date DESC
      LIMIT 50
    `));
    const pendingRows = execRows<{ id: string; pick_date: string; ticker: string; pick_price: number }>(rows);

    if (!pendingRows.length) return { updated: 0, errors: 0 };

    for (const row of pendingRows) {
      try {
        const { id, pick_date, ticker, pick_price } = row;

        // Fetch forward prices for the stock
        const [stockP1, stockP5, stockP20] = await Promise.all([
          getCloseNDaysAfter(typedDb, ticker, pick_date, 1),
          getCloseNDaysAfter(typedDb, ticker, pick_date, 5),
          getCloseNDaysAfter(typedDb, ticker, pick_date, 20),
        ]);

        // TAIEX: try ticker '0000' first, then 'TAIEX'
        const taiexTicker = "0000";
        const [taiexP0, taiexP1, taiexP5, taiexP20] = await Promise.all([
          getLatestCloseFromDb(typedDb, taiexTicker),
          getCloseNDaysAfter(typedDb, taiexTicker, pick_date, 1),
          getCloseNDaysAfter(typedDb, taiexTicker, pick_date, 5),
          getCloseNDaysAfter(typedDb, taiexTicker, pick_date, 20),
        ]);

        // Use the stored pick_price as baseline for stock returns
        const ret1d = calcReturn(pick_price, stockP1);
        const ret5d = calcReturn(pick_price, stockP5);
        const ret20d = calcReturn(pick_price, stockP20);

        // For TAIEX baseline: get TAIEX close on pick_date (if available) or fall back to latest
        // We fetch TAIEX close ON pick_date via a direct query
        const taiexPickRows = await db.execute(sql`
          SELECT o.close::float AS close
          FROM companies_ohlcv o
          INNER JOIN companies c ON c.id = o.company_id
          WHERE c.ticker = ${taiexTicker}
            AND o.interval IN ('1d', 'day')
            AND o.dt = ${pick_date}::date
          LIMIT 1
        `);
        const taiexPickPrice = execRows<{ close: number | null }>(taiexPickRows)[0]?.close ?? taiexP0 ?? null;

        const taiexRet1d = calcReturn(taiexPickPrice, taiexP1);
        const taiexRet5d = calcReturn(taiexPickPrice, taiexP5);
        const taiexRet20d = calcReturn(taiexPickPrice, taiexP20);

        const excess1d = ret1d !== null && taiexRet1d !== null ? ret1d - taiexRet1d : null;
        const excess5d = ret5d !== null && taiexRet5d !== null ? ret5d - taiexRet5d : null;
        const excess20d = ret20d !== null && taiexRet20d !== null ? ret20d - taiexRet20d : null;

        await db.execute(sql`
          UPDATE ai_rec_pick_snapshots
          SET
            ret_1d         = ${ret1d},
            ret_5d         = ${ret5d},
            ret_20d        = ${ret20d},
            excess_1d      = ${excess1d},
            excess_5d      = ${excess5d},
            excess_20d     = ${excess20d},
            ret_updated_at = NOW()
          WHERE id = ${id}::uuid
        `);

        updated++;
      } catch (rowErr) {
        errors++;
        console.warn("[ai-rec-perf] updateForwardReturns row error:", rowErr instanceof Error ? rowErr.message : rowErr);
      }
    }

    console.info(`[ai-rec-perf] updateForwardReturns: updated=${updated} errors=${errors}`);
  } catch (err) {
    console.warn("[ai-rec-perf] updateForwardReturns outer error:", err instanceof Error ? err.message : err);
  }

  return { updated, errors };
}

// ── 3. getAiRecPerformance ────────────────────────────────────────────────────

/**
 * Performance query — aggregates hit_rate and avg_excess_return by bucket.
 * Only counts A+, A, B buckets for overall hit_rate (C is excluded from signal edge).
 *
 * Returned stats are based on rows with ret_updated_at IS NOT NULL (computed returns only).
 */
export async function getAiRecPerformance(opts: {
  fromDate?: string;   // YYYY-MM-DD filter, defaults to all time
  toDate?: string;
}): Promise<AiRecPerfResult> {
  const empty: AiRecPerfResult = {
    overall_hit_rate_1d: null,
    overall_hit_rate_5d: null,
    overall_hit_rate_20d: null,
    avg_excess_1d: null,
    avg_excess_5d: null,
    avg_excess_20d: null,
    total_picks: 0,
    picks_with_ret_1d: 0,
    picks_with_ret_5d: 0,
    picks_with_ret_20d: 0,
    by_bucket: [],
    earliest_pick_date: null,
    latest_pick_date: null,
    computed_at: new Date().toISOString(),
  };

  try {
    const { getDb, isDatabaseMode } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return empty;
    const db = getDb();
    if (!db) return empty;

    const { sql } = await import("drizzle-orm");

    const fromFilter = opts.fromDate ?? null;
    const toFilter = opts.toDate ?? null;

    // Overall stats (A+/A/B only for signal edge assessment)
    const overall = (await db.execute(sql`
      SELECT
        COUNT(*)::int                                       AS total_picks,
        MIN(pick_date)::text                               AS earliest_pick_date,
        MAX(pick_date)::text                               AS latest_pick_date,
        -- 1d stats
        COUNT(*) FILTER (WHERE excess_1d IS NOT NULL)::int AS n_1d,
        COUNT(*) FILTER (WHERE excess_1d > 0)::int         AS hit_1d,
        AVG(excess_1d) FILTER (WHERE excess_1d IS NOT NULL) AS avg_excess_1d,
        -- 5d stats
        COUNT(*) FILTER (WHERE excess_5d IS NOT NULL)::int AS n_5d,
        COUNT(*) FILTER (WHERE excess_5d > 0)::int         AS hit_5d,
        AVG(excess_5d) FILTER (WHERE excess_5d IS NOT NULL) AS avg_excess_5d,
        -- 20d stats
        COUNT(*) FILTER (WHERE excess_20d IS NOT NULL)::int AS n_20d,
        COUNT(*) FILTER (WHERE excess_20d > 0)::int         AS hit_20d,
        AVG(excess_20d) FILTER (WHERE excess_20d IS NOT NULL) AS avg_excess_20d
      FROM ai_rec_pick_snapshots
      WHERE bucket IN ('A+', 'A', 'B')
        AND (${fromFilter}::date IS NULL OR pick_date >= ${fromFilter}::date)
        AND (${toFilter}::date IS NULL OR pick_date <= ${toFilter}::date)
    `));

    const o = execRows<{
      total_picks: number;
      earliest_pick_date: string | null;
      latest_pick_date: string | null;
      n_1d: number; hit_1d: number; avg_excess_1d: number | null;
      n_5d: number; hit_5d: number; avg_excess_5d: number | null;
      n_20d: number; hit_20d: number; avg_excess_20d: number | null;
    }>(overall)[0];

    // By-bucket breakdown (all buckets including C)
    const byBucket = (await db.execute(sql`
      SELECT
        bucket,
        COUNT(*)::int                                       AS sample_count,
        COUNT(*) FILTER (WHERE excess_1d IS NOT NULL)::int AS n_1d,
        COUNT(*) FILTER (WHERE excess_1d > 0)::int         AS hit_1d,
        AVG(excess_1d) FILTER (WHERE excess_1d IS NOT NULL) AS avg_excess_1d,
        COUNT(*) FILTER (WHERE excess_5d IS NOT NULL)::int AS n_5d,
        COUNT(*) FILTER (WHERE excess_5d > 0)::int         AS hit_5d,
        AVG(excess_5d) FILTER (WHERE excess_5d IS NOT NULL) AS avg_excess_5d,
        COUNT(*) FILTER (WHERE excess_20d IS NOT NULL)::int AS n_20d,
        COUNT(*) FILTER (WHERE excess_20d > 0)::int         AS hit_20d,
        AVG(excess_20d) FILTER (WHERE excess_20d IS NOT NULL) AS avg_excess_20d
      FROM ai_rec_pick_snapshots
      WHERE (${fromFilter}::date IS NULL OR pick_date >= ${fromFilter}::date)
        AND (${toFilter}::date IS NULL OR pick_date <= ${toFilter}::date)
      GROUP BY bucket
      ORDER BY CASE bucket WHEN 'A+' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 ELSE 4 END
    `));

    const bucketStats: AiRecPerfBucketStat[] = execRows<{
      bucket: string;
      sample_count: number;
      n_1d: number; hit_1d: number; avg_excess_1d: number | null;
      n_5d: number; hit_5d: number; avg_excess_5d: number | null;
      n_20d: number; hit_20d: number; avg_excess_20d: number | null;
    }>(byBucket).map(b => ({
      bucket: b.bucket,
      sampleCount: b.sample_count,
      hit_rate_1d: b.n_1d > 0 ? b.hit_1d / b.n_1d : null,
      hit_rate_5d: b.n_5d > 0 ? b.hit_5d / b.n_5d : null,
      hit_rate_20d: b.n_20d > 0 ? b.hit_20d / b.n_20d : null,
      avg_excess_1d: b.avg_excess_1d !== null ? Number(b.avg_excess_1d) : null,
      avg_excess_5d: b.avg_excess_5d !== null ? Number(b.avg_excess_5d) : null,
      avg_excess_20d: b.avg_excess_20d !== null ? Number(b.avg_excess_20d) : null,
    }));

    // Total picks across all buckets
    const totalPicksAllRes = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM ai_rec_pick_snapshots
      WHERE (${fromFilter}::date IS NULL OR pick_date >= ${fromFilter}::date)
        AND (${toFilter}::date IS NULL OR pick_date <= ${toFilter}::date)
    `);
    const totalPicksAll = execRows<{ n: number }>(totalPicksAllRes);

    return {
      overall_hit_rate_1d: o && o.n_1d > 0 ? o.hit_1d / o.n_1d : null,
      overall_hit_rate_5d: o && o.n_5d > 0 ? o.hit_5d / o.n_5d : null,
      overall_hit_rate_20d: o && o.n_20d > 0 ? o.hit_20d / o.n_20d : null,
      avg_excess_1d: o?.avg_excess_1d !== null && o?.avg_excess_1d !== undefined ? Number(o.avg_excess_1d) : null,
      avg_excess_5d: o?.avg_excess_5d !== null && o?.avg_excess_5d !== undefined ? Number(o.avg_excess_5d) : null,
      avg_excess_20d: o?.avg_excess_20d !== null && o?.avg_excess_20d !== undefined ? Number(o.avg_excess_20d) : null,
      total_picks: totalPicksAll[0]?.n ?? 0,
      picks_with_ret_1d: o?.n_1d ?? 0,
      picks_with_ret_5d: o?.n_5d ?? 0,
      picks_with_ret_20d: o?.n_20d ?? 0,
      by_bucket: bucketStats,
      earliest_pick_date: o?.earliest_pick_date ?? null,
      latest_pick_date: o?.latest_pick_date ?? null,
      computed_at: new Date().toISOString(),
    };
  } catch (err) {
    console.warn("[ai-rec-perf] getAiRecPerformance error:", err instanceof Error ? err.message : err);
    return empty;
  }
}
