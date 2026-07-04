/**
 * Pure formatting/mapping helpers for the /track-record public scorecard.
 * No React, no fetch — keeps the 1:1 mapping from `AiRecPerformance` fields
 * to the three scorecard windows (1d/5d/20d) unit-testable against a fixture
 * payload, so a page-render change can't silently drift from what the
 * backend actually returned.
 */
import type { AiRecPerformance } from "./api";
import { formatMonthDay } from "./weekly-review-format";

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
export function buildTrackRecordScoreWindows(perf: AiRecPerformance): TrackRecordScoreWindow[] {
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
export function formatTrackRecordRangeText(perf: AiRecPerformance): string {
  return perf.earliest_pick_date ? `自 ${formatMonthDay(perf.earliest_pick_date)} 起` : "";
}
