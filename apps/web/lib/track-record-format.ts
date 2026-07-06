/**
 * Pure formatting/mapping helpers for the /track-record public scorecard.
 * No React, no fetch — keeps the 1:1 mapping from `TrackRecordPerformance`
 * fields to the three scorecard windows (1d/5d/20d), and the NAV whitelist
 * payload back into the shape `FAutoNavPanel` expects, unit-testable against
 * fixture payloads so a page-render change can't silently drift from what
 * the backend actually returned.
 */
import type { TrackRecordPerformance } from "./api";
import { formatMonthDay } from "./weekly-review-format";
import type { FAutoNavResponse, NavCurvePoint, TrackRecordNavResponse } from "./fauto-sim-api";

export const TRACK_RECORD_SMALL_SAMPLE_THRESHOLD = 20;

export type TrackRecordScoreWindow = {
  label: string;
  hit: number | null;
  excess: number | null;
  sample: number;
  /** true when `sample` is below the threshold — caller shows "紀錄累積中" instead of a number. */
  smallSample: boolean;
};

/** Maps the backend's 1d/5d/20d fields into the three windows shown on the page, in order. */
export function buildTrackRecordScoreWindows(perf: TrackRecordPerformance): TrackRecordScoreWindow[] {
  return [
    {
      label: "隔日",
      hit: perf.overall_hit_rate_1d,
      excess: null,
      sample: perf.picks_with_ret_1d,
      smallSample: perf.picks_with_ret_1d < TRACK_RECORD_SMALL_SAMPLE_THRESHOLD,
    },
    {
      label: "5 日",
      hit: perf.overall_hit_rate_5d,
      excess: perf.avg_excess_5d,
      sample: perf.picks_with_ret_5d,
      smallSample: perf.picks_with_ret_5d < TRACK_RECORD_SMALL_SAMPLE_THRESHOLD,
    },
    {
      label: "20 日",
      hit: perf.overall_hit_rate_20d,
      excess: perf.avg_excess_20d,
      sample: perf.picks_with_ret_20d,
      smallSample: perf.picks_with_ret_20d < TRACK_RECORD_SMALL_SAMPLE_THRESHOLD,
    },
  ];
}

/** "樣本 N 筆推薦，自 MM/DD 起" — empty range segment when the backend hasn't set earliest_pick_date. */
export function formatTrackRecordRangeText(perf: TrackRecordPerformance): string {
  return perf.earliest_pick_date ? `自 ${formatMonthDay(perf.earliest_pick_date)} 起` : "";
}

// ── NAV whitelist -> FAutoNavPanel adapter ───────────────────────────────────
//
// The public /track-record/nav payload drops navCurve.returnPct/weekNum and
// summary.currentWeekNum/lastNavDate (see #1177 PR body: "both derivable
// client-side from equity vs. summary.initialEquity"). This reconstructs
// exactly those fields so the existing `FAutoNavPanel` (built for the
// Owner-only /ops/f-auto page, #1155) can be reused as-is with zero changes
// to that component.

/**
 * Re-derives returnPct (%) and weekNum for each public navCurve point.
 * - returnPct: (equity / initialEquity - 1) * 100 — identical arithmetic to
 *   what the backend computes server-side for the full payload.
 * - weekNum: the most recent week whose basketDate is on/before this point's
 *   date, walking `weeks` in the ascending order the backend already returns
 *   them in (weeks[] is kept as-is by the whitelist, only navCurve is thinned).
 */
export function adaptTrackRecordNavCurve(
  navCurve: TrackRecordNavResponse["navCurve"],
  weeks: TrackRecordNavResponse["weeks"],
  initialEquity: number,
): NavCurvePoint[] {
  return navCurve.map((p) => {
    let weekNum = weeks[0]?.weekNum ?? 1;
    for (const w of weeks) {
      if (w.basketDate <= p.date) weekNum = w.weekNum;
      else break;
    }
    const returnPct = initialEquity > 0 ? (p.equity / initialEquity - 1) * 100 : 0;
    return { navDate: p.date, equityTwd: p.equity, returnPct, weekNum, source: p.source };
  });
}

/** Rebuilds a full `FAutoNavResponse` from the public whitelist payload so `FAutoNavPanel` can render it unmodified. */
export function adaptTrackRecordNavForPanel(pub: TrackRecordNavResponse): FAutoNavResponse {
  if (!pub.summary) {
    // FAutoNavPanel type declares `summary: FAutoNavSummary` (non-null), but its
    // own render logic branches on `source === "empty_ledger"` before ever
    // touching `summary` — matches how the existing Owner route's `no_db`/
    // `empty_ledger` cases are already handled by that component today.
    return { source: pub.source, navCurve: [], weeks: pub.weeks, summary: null as unknown as FAutoNavResponse["summary"] };
  }

  const navCurve = adaptTrackRecordNavCurve(pub.navCurve, pub.weeks, pub.summary.initialEquity);
  const lastWeek = pub.weeks[pub.weeks.length - 1];
  const lastPoint = pub.navCurve[pub.navCurve.length - 1];

  return {
    source: pub.source,
    navCurve,
    weeks: pub.weeks,
    summary: {
      initialEquity: pub.summary.initialEquity,
      currentEquity: pub.summary.currentEquity,
      cumulativeReturnPct: pub.summary.cumulativeReturnPct,
      totalRealizedPnlTwd: pub.summary.totalRealizedPnlTwd,
      currentWeekNum: lastWeek?.weekNum ?? 0,
      lastNavDate: lastPoint?.date ?? "",
    },
  };
}
