import { describe, expect, it } from "vitest";
import type { AiRecPerformance } from "./api";
import {
  buildTrackRecordScoreWindows,
  formatTrackRecordRangeText,
  TRACK_RECORD_SMALL_SAMPLE_THRESHOLD,
} from "./track-record-format";

// Fixture shaped exactly like a real GET /api/v1/admin/ai-rec/performance
// response — asserts the page's derived windows stay a 1:1 mirror of what
// the backend actually returned (no silent renaming/dropping of fields).
const FIXTURE: AiRecPerformance = {
  overall_hit_rate_1d: 0.62,
  overall_hit_rate_5d: 0.593,
  overall_hit_rate_20d: null,
  avg_excess_1d: 0.004,
  avg_excess_5d: -0.0089,
  avg_excess_20d: null,
  total_picks: 50,
  picks_with_ret_1d: 50,
  picks_with_ret_5d: 48,
  picks_with_ret_20d: 3,
  earliest_pick_date: "2026-06-01",
  latest_pick_date: "2026-07-01",
  benchmark: "0050",
  computed_at: "2026-07-01T09:00:00Z",
};

describe("buildTrackRecordScoreWindows", () => {
  it("maps the 3 windows in 1d/5d/20d order with the backend's own values", () => {
    const windows = buildTrackRecordScoreWindows(FIXTURE);
    expect(windows).toHaveLength(3);
    expect(windows.map((w) => w.label)).toEqual(["隔日", "5 日", "20 日"]);

    expect(windows[0]).toMatchObject({ hit: FIXTURE.overall_hit_rate_1d, excess: null, sample: FIXTURE.picks_with_ret_1d });
    expect(windows[1]).toMatchObject({
      hit: FIXTURE.overall_hit_rate_5d,
      excess: FIXTURE.avg_excess_5d,
      sample: FIXTURE.picks_with_ret_5d,
    });
    expect(windows[2]).toMatchObject({
      hit: FIXTURE.overall_hit_rate_20d,
      excess: FIXTURE.avg_excess_20d,
      sample: FIXTURE.picks_with_ret_20d,
    });
  });

  it("1d window never carries an excess figure (backend doesn't compute one)", () => {
    const windows = buildTrackRecordScoreWindows(FIXTURE);
    expect(windows[0].excess).toBeNull();
  });

  it("flags smallSample only when the window's own sample count is below the threshold", () => {
    const windows = buildTrackRecordScoreWindows(FIXTURE);
    // 1d: 50 samples >= 20 -> not small
    expect(windows[0].smallSample).toBe(false);
    // 5d: 48 samples >= 20 -> not small
    expect(windows[1].smallSample).toBe(false);
    // 20d: 3 samples < 20 -> small, must show "累積中" not a number
    expect(windows[2].smallSample).toBe(true);
  });

  it("threshold is exactly 20 samples (boundary is inclusive of 20, not 19)", () => {
    const atThreshold: AiRecPerformance = { ...FIXTURE, picks_with_ret_5d: TRACK_RECORD_SMALL_SAMPLE_THRESHOLD };
    const belowThreshold: AiRecPerformance = { ...FIXTURE, picks_with_ret_5d: TRACK_RECORD_SMALL_SAMPLE_THRESHOLD - 1 };
    expect(buildTrackRecordScoreWindows(atThreshold)[1].smallSample).toBe(false);
    expect(buildTrackRecordScoreWindows(belowThreshold)[1].smallSample).toBe(true);
  });

  it("handles a zero-sample window (brand new deployment, no verified picks yet)", () => {
    const empty: AiRecPerformance = {
      ...FIXTURE,
      overall_hit_rate_1d: null,
      overall_hit_rate_5d: null,
      overall_hit_rate_20d: null,
      avg_excess_1d: null,
      avg_excess_5d: null,
      avg_excess_20d: null,
      picks_with_ret_1d: 0,
      picks_with_ret_5d: 0,
      picks_with_ret_20d: 0,
    };
    const windows = buildTrackRecordScoreWindows(empty);
    expect(windows.every((w) => w.smallSample)).toBe(true);
    expect(windows.every((w) => w.hit === null)).toBe(true);
  });
});

describe("formatTrackRecordRangeText", () => {
  it("formats the earliest pick date as MM/DD with a leading 自...起", () => {
    expect(formatTrackRecordRangeText(FIXTURE)).toBe("自 06/01 起");
  });

  it("returns an empty string when the backend hasn't set earliest_pick_date", () => {
    expect(formatTrackRecordRangeText({ ...FIXTURE, earliest_pick_date: null })).toBe("");
  });
});
