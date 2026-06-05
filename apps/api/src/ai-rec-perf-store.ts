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

/** Get latest close price for a ticker from companies_ohlcv. Returns null if unavailable. */
async function getLatestCloseFromDb(
  db: import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>,
  ticker: string
): Promise<number | null> {
  try {
    const { sql } = await import("drizzle-orm");
    const rows = (await db.execute(sql`
      SELECT o.close AS close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE c.ticker = ${ticker}
        AND o.interval IN ('1d', 'day')
      ORDER BY o.dt DESC
      LIMIT 1
    `)) as unknown as { rows: Array<{ close: string | null }> };
    const v = parseFloat(rows.rows?.[0]?.close ?? "");
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
    const rows = (await db.execute(sql`
      SELECT o.close AS close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE c.ticker = ${ticker}
        AND o.interval IN ('1d', 'day')
        AND o.dt > ${pickDate}::date
      ORDER BY o.dt ASC
      LIMIT 1 OFFSET ${n - 1}
    `)) as unknown as { rows: Array<{ close: string | null }> };
    const v = parseFloat(rows.rows?.[0]?.close ?? "");
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
export async function snapshotV3Picks(result: AiRecommendationV3RunResult): Promise<void> {
  if (result.status !== "complete" && result.status !== "synthesis_format_error") return;
  if (!result.items || result.items.length === 0) return;

  try {
    const { getDb, isDatabaseMode } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return;
    const db = getDb();
    if (!db) return;

    const pickDate = todayTst();
    const { sql } = await import("drizzle-orm");

    for (const item of result.items) {
      if (!item.ticker) continue;

      // Resolve pick price from companies_ohlcv (fail-open: null if unavailable)
      const pickPrice = await getLatestCloseFromDb(db as unknown as import("drizzle-orm/node-postgres").NodePgDatabase<Record<string, never>>, item.ticker);

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
           ${entryLow !== null ? Number(entryLow).toFixed(2) : null},
           ${entryHigh !== null ? Number(entryHigh).toFixed(2) : null},
           ${tp1 !== null ? Number(tp1).toFixed(2) : null},
           ${tp2 !== null ? Number(tp2).toFixed(2) : null},
           ${stopLoss !== null ? Number(stopLoss).toFixed(2) : null},
           ${result.runId})
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

    console.info(`[ai-rec-perf] snapshot written: ${result.items.length} picks for ${pickDate}`);
  } catch (err) {
    // Fail-open: snapshot failure must not propagate
    console.warn("[ai-rec-perf] snapshotV3Picks failed (non-fatal):", err instanceof Error ? err.message : err);
  }
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
    `)) as unknown as {
      rows: Array<{ id: string; pick_date: string; ticker: string; pick_price: number }>
    };

    if (!rows.rows?.length) return { updated: 0, errors: 0 };

    for (const row of rows.rows) {
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
        const taiexPickRows = (await db.execute(sql`
          SELECT o.close::float AS close
          FROM companies_ohlcv o
          INNER JOIN companies c ON c.id = o.company_id
          WHERE c.ticker = ${taiexTicker}
            AND o.interval IN ('1d', 'day')
            AND o.dt = ${pick_date}::date
          LIMIT 1
        `)) as unknown as { rows: Array<{ close: number | null }> };
        const taiexPickPrice = taiexPickRows.rows?.[0]?.close ?? taiexP0 ?? null;

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
    `)) as unknown as {
      rows: Array<{
        total_picks: number;
        earliest_pick_date: string | null;
        latest_pick_date: string | null;
        n_1d: number; hit_1d: number; avg_excess_1d: number | null;
        n_5d: number; hit_5d: number; avg_excess_5d: number | null;
        n_20d: number; hit_20d: number; avg_excess_20d: number | null;
      }>
    };

    const o = overall.rows?.[0];

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
    `)) as unknown as {
      rows: Array<{
        bucket: string;
        sample_count: number;
        n_1d: number; hit_1d: number; avg_excess_1d: number | null;
        n_5d: number; hit_5d: number; avg_excess_5d: number | null;
        n_20d: number; hit_20d: number; avg_excess_20d: number | null;
      }>
    };

    const bucketStats: AiRecPerfBucketStat[] = (byBucket.rows ?? []).map(b => ({
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
    const totalPicksAll = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM ai_rec_pick_snapshots
      WHERE (${fromFilter}::date IS NULL OR pick_date >= ${fromFilter}::date)
        AND (${toFilter}::date IS NULL OR pick_date <= ${toFilter}::date)
    `)) as unknown as { rows: Array<{ n: number }> };

    return {
      overall_hit_rate_1d: o && o.n_1d > 0 ? o.hit_1d / o.n_1d : null,
      overall_hit_rate_5d: o && o.n_5d > 0 ? o.hit_5d / o.n_5d : null,
      overall_hit_rate_20d: o && o.n_20d > 0 ? o.hit_20d / o.n_20d : null,
      avg_excess_1d: o?.avg_excess_1d !== null && o?.avg_excess_1d !== undefined ? Number(o.avg_excess_1d) : null,
      avg_excess_5d: o?.avg_excess_5d !== null && o?.avg_excess_5d !== undefined ? Number(o.avg_excess_5d) : null,
      avg_excess_20d: o?.avg_excess_20d !== null && o?.avg_excess_20d !== undefined ? Number(o.avg_excess_20d) : null,
      total_picks: totalPicksAll.rows?.[0]?.n ?? 0,
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
