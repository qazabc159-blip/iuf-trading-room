/**
 * track-record-handlers.ts — Public read helpers for the /track-record scorecard page (P0-C).
 *
 * Design constraint (2026-07-05 task spec): the existing Owner-only endpoints
 *   - GET /api/v1/admin/ai-rec/performance  (server.ts)
 *   - GET /api/v1/portfolio/f-auto/nav      (server.ts)
 * stay Owner-only — no loosening. Instead, this file provides:
 *   1. `buildFAutoNavFull()` — the F-AUTO NAV ledger query, extracted verbatim
 *      from the /portfolio/f-auto/nav handler so both the Owner route and the
 *      new public route read from the exact same aggregation logic (no
 *      second copy of the SQL to drift out of sync).
 *   2. `toPublicPerformance()` / `toPublicNav()` — field whitelists applied on
 *      top of the same-source aggregates before they reach the public routes.
 *      No per-pick detail, no by_bucket breakdown, no internal-only fields.
 *
 * Lane: strategy backend (Jason). Consumed by server.ts only.
 */

import { isDatabaseMode, getDb } from "@iuf-trading-room/db";
import type { AiRecPerfResult } from "./ai-rec-perf-store.js";

// ── AI-rec performance whitelist ─────────────────────────────────────────────

export type TrackRecordPerformancePublic = {
  overall_hit_rate_1d: number | null;
  overall_hit_rate_5d: number | null;
  overall_hit_rate_20d: number | null;
  avg_excess_1d: number | null;
  avg_excess_5d: number | null;
  avg_excess_20d: number | null;
  total_picks: number;
  picks_with_ret_1d: number;
  picks_with_ret_5d: number;
  picks_with_ret_20d: number;
  earliest_pick_date: string | null;
  benchmark: string;
};

/** Whitelists `AiRecPerfResult` down to the public scorecard fields — drops by_bucket, latest_pick_date, computed_at. */
export function toPublicPerformance(perf: AiRecPerfResult): TrackRecordPerformancePublic {
  return {
    overall_hit_rate_1d: perf.overall_hit_rate_1d,
    overall_hit_rate_5d: perf.overall_hit_rate_5d,
    overall_hit_rate_20d: perf.overall_hit_rate_20d,
    avg_excess_1d: perf.avg_excess_1d,
    avg_excess_5d: perf.avg_excess_5d,
    avg_excess_20d: perf.avg_excess_20d,
    total_picks: perf.total_picks,
    picks_with_ret_1d: perf.picks_with_ret_1d,
    picks_with_ret_5d: perf.picks_with_ret_5d,
    picks_with_ret_20d: perf.picks_with_ret_20d,
    earliest_pick_date: perf.earliest_pick_date,
    benchmark: perf.benchmark,
  };
}

// ── F-AUTO NAV: same-source query, shared by Owner + public routes ──────────

/**
 * Pricing quality for a NAV point: "official" = every position priced from
 * TWSE/TPEX official EOD closes; "mis_fallback_full" = TWSE/TPEX did not
 * publish in time but the MIS date-validated fallback covered every position
 * (2026-07-09 ledger stall fix — see s1-sim-runner.ts
 * S1PositionsSnapshot.fullyPriced doc comment). Rows written before this
 * field existed (e.g. Phase 1/2 `backfill_dry_run` rows) carry no quality
 * marker and read as "official" — they were computed from a historical PIT
 * source, not degraded live pricing, so "official" is the accurate default.
 */
export type FAutoNavPricingQuality = "official" | "mis_fallback_full";

/** Reads the pricing-quality marker sim-ledger-backfill.ts writes into the
 * `notes` text column (e.g. "daily_mark_to_market (pricing_quality: mis_fallback_full)").
 * Defaults to "official" when no marker is present. */
export function derivePricingQuality(notes: string | null): FAutoNavPricingQuality {
  return notes?.includes("pricing_quality: mis_fallback_full") ? "mis_fallback_full" : "official";
}

export type FAutoNavCurvePointFull = {
  navDate: string;
  equityTwd: number;
  returnPct: number;
  weekNum: number;
  source: string;
  /** See FAutoNavPricingQuality doc comment. */
  pricingQuality: FAutoNavPricingQuality;
};

export type FAutoNavWeekFull = {
  weekNum: number;
  basketDate: string;
  realizedPnlTwd: number | null;
  equityAfterTwd: number;
  cashResidualTwd: number;
  basketCostTwd: number;
  source: string;
};

export type FAutoNavSummaryFull = {
  initialEquity: number;
  currentEquity: number;
  cumulativeReturnPct: number;
  totalRealizedPnlTwd: number;
  currentWeekNum: number | null;
  lastNavDate: string;
} | null;

export type FAutoNavFull = {
  ok: true;
  source: string;
  navCurve: FAutoNavCurvePointFull[];
  weeks: FAutoNavWeekFull[];
  summary: FAutoNavSummaryFull;
  asOf?: string;
};

/**
 * F-AUTO SIM NAV ledger read — extracted from the /portfolio/f-auto/nav Owner
 * route (server.ts) verbatim so behavior does not change for that route.
 * Returns continuous NAV series from sim_ledger_nav + weekly decomposition
 * from sim_ledger_weeks. `source: "no_db"` when Postgres isn't configured
 * (memory mode / CI).
 */
export async function buildFAutoNavFull(): Promise<FAutoNavFull> {
  const db = isDatabaseMode() ? getDb() : null;
  if (!db) {
    return { ok: true, source: "no_db", navCurve: [], weeks: [], summary: null };
  }

  const { sql: sqlRaw } = await import("drizzle-orm");

  const navRows = (await db.execute(sqlRaw`
    SELECT nav_date, equity_twd, return_pct, week_num, source, notes
    FROM sim_ledger_nav
    ORDER BY nav_date ASC
  `)) as unknown as Array<{
    nav_date: string;
    equity_twd: string;
    return_pct: string;
    week_num: number;
    source: string;
    notes: string | null;
  }>;

  const weekRows = (await db.execute(sqlRaw`
    SELECT week_num, basket_date, realized_pnl_twd, equity_after_twd,
           cash_residual_twd, basket_cost_twd, source
    FROM sim_ledger_weeks
    ORDER BY week_num ASC, basket_date ASC
  `)) as unknown as Array<{
    week_num: number;
    basket_date: string;
    realized_pnl_twd: string | null;
    equity_after_twd: string;
    cash_residual_twd: string;
    basket_cost_twd: string;
    source: string;
  }>;

  const navCurve: FAutoNavCurvePointFull[] = navRows.map((r) => ({
    navDate: String(r.nav_date).slice(0, 10),
    equityTwd: Number(r.equity_twd),
    returnPct: Number(r.return_pct),
    weekNum: Number(r.week_num),
    source: String(r.source),
    pricingQuality: derivePricingQuality(r.notes),
  }));

  const weeks: FAutoNavWeekFull[] = weekRows.map((r) => ({
    weekNum: Number(r.week_num),
    basketDate: String(r.basket_date).slice(0, 10),
    realizedPnlTwd: r.realized_pnl_twd !== null ? Number(r.realized_pnl_twd) : null,
    equityAfterTwd: Number(r.equity_after_twd),
    cashResidualTwd: Number(r.cash_residual_twd),
    basketCostTwd: Number(r.basket_cost_twd),
    source: String(r.source),
  }));

  const lastNav = navCurve[navCurve.length - 1] ?? null;
  const lastWeek = weekRows[weekRows.length - 1] ?? null;
  const initialEquity = 10_000_000;
  const totalRealizedPnl = weekRows
    .filter((r) => r.realized_pnl_twd !== null)
    .reduce((s, r) => s + Number(r.realized_pnl_twd), 0);

  const summary: FAutoNavSummaryFull = lastNav
    ? {
        initialEquity,
        currentEquity: lastNav.equityTwd,
        cumulativeReturnPct: lastNav.returnPct,
        totalRealizedPnlTwd: Math.round(totalRealizedPnl),
        currentWeekNum: lastWeek ? Number(lastWeek.week_num) : null,
        lastNavDate: lastNav.navDate,
      }
    : null;

  return {
    ok: true,
    source: navCurve.length > 0 ? "sim_ledger_live" : "empty_ledger",
    navCurve,
    weeks,
    summary,
    asOf: new Date().toISOString(),
  };
}

// ── F-AUTO NAV whitelist ──────────────────────────────────────────────────────

export type TrackRecordNavPublic = {
  source: string;
  navCurve: Array<{ date: string; equity: number; source: string }>;
  weeks: FAutoNavWeekFull[];
  summary: {
    initialEquity: number;
    currentEquity: number;
    cumulativeReturnPct: number;
    totalRealizedPnlTwd: number;
  } | null;
};

/**
 * Whitelists `FAutoNavFull` down to the public scorecard fields.
 * navCurve keeps only date/equity/source (drops returnPct + weekNum, both
 * derivable client-side from equity vs. summary.initialEquity). weeks[] is
 * kept as-is — it's already a weekly-granularity summary, not per-trade
 * detail. summary keeps only the 4 top-line figures (drops currentWeekNum +
 * lastNavDate, both redundant with the last navCurve/weeks entry).
 */
export function toPublicNav(full: FAutoNavFull): TrackRecordNavPublic {
  return {
    source: full.source,
    navCurve: full.navCurve.map((p) => ({ date: p.navDate, equity: p.equityTwd, source: p.source })),
    weeks: full.weeks,
    summary: full.summary
      ? {
          initialEquity: full.summary.initialEquity,
          currentEquity: full.summary.currentEquity,
          cumulativeReturnPct: full.summary.cumulativeReturnPct,
          totalRealizedPnlTwd: full.summary.totalRealizedPnlTwd,
        }
      : null,
  };
}
