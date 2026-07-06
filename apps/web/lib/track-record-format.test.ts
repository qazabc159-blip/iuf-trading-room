import { describe, expect, it } from "vitest";
import type { TrackRecordPerformance } from "./api";
import type { TrackRecordNavResponse } from "./fauto-sim-api";
import {
  adaptTrackRecordNavCurve,
  adaptTrackRecordNavForPanel,
  buildTrackRecordScoreWindows,
  formatTrackRecordRangeText,
  TRACK_RECORD_SMALL_SAMPLE_THRESHOLD,
} from "./track-record-format";

// Fixture shaped exactly like a real GET /api/v1/track-record/performance
// response (#1177 whitelist — no computed_at/latest_pick_date/by_bucket) —
// asserts the page's derived windows stay a 1:1 mirror of what the backend
// actually returned (no silent renaming/dropping of fields).
const FIXTURE: TrackRecordPerformance = {
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
  benchmark: "0050",
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
    const atThreshold: TrackRecordPerformance = { ...FIXTURE, picks_with_ret_5d: TRACK_RECORD_SMALL_SAMPLE_THRESHOLD };
    const belowThreshold: TrackRecordPerformance = { ...FIXTURE, picks_with_ret_5d: TRACK_RECORD_SMALL_SAMPLE_THRESHOLD - 1 };
    expect(buildTrackRecordScoreWindows(atThreshold)[1].smallSample).toBe(false);
    expect(buildTrackRecordScoreWindows(belowThreshold)[1].smallSample).toBe(true);
  });

  it("handles a zero-sample window (brand new deployment, no verified picks yet)", () => {
    const empty: TrackRecordPerformance = {
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

// Fixture shaped like a real GET /api/v1/track-record/nav response (#1177
// whitelist — navCurve is {date, equity, source}, summary has 4 fields only,
// weeks[] kept as full FAutoNavWeekFull rows).
const NAV_FIXTURE: TrackRecordNavResponse = {
  source: "sim_ledger_live",
  navCurve: [
    { date: "2026-06-02", equity: 10_000_000, source: "backfill" },
    { date: "2026-06-05", equity: 9_950_000, source: "backfill" },
    { date: "2026-06-09", equity: 9_678_700, source: "live" },
    { date: "2026-06-12", equity: 9_700_000, source: "live" },
  ],
  weeks: [
    { weekNum: 1, basketDate: "2026-06-02", realizedPnlTwd: null, equityAfterTwd: 10_000_000, cashResidualTwd: 5_498_850, basketCostTwd: 4_501_150 },
    { weekNum: 2, basketDate: "2026-06-09", realizedPnlTwd: -321_300, equityAfterTwd: 9_678_700, cashResidualTwd: 5_000_000, basketCostTwd: 4_000_000 },
  ] as unknown as TrackRecordNavResponse["weeks"],
  summary: {
    initialEquity: 10_000_000,
    currentEquity: 9_700_000,
    cumulativeReturnPct: -3.0,
    totalRealizedPnlTwd: -321_300,
  },
};

describe("adaptTrackRecordNavCurve", () => {
  it("re-derives returnPct from equity vs. initialEquity for every point", () => {
    const points = adaptTrackRecordNavCurve(NAV_FIXTURE.navCurve, NAV_FIXTURE.weeks, NAV_FIXTURE.summary!.initialEquity);
    expect(points[0].returnPct).toBeCloseTo(0, 5);
    expect(points[1].returnPct).toBeCloseTo(-0.5, 5); // 9,950,000 / 10,000,000 - 1 = -0.5%
    expect(points[2].returnPct).toBeCloseTo(-3.213, 2); // 9,678,700 / 10,000,000 - 1
  });

  it("assigns each point the most recent week whose basketDate is on/before that point's date", () => {
    const points = adaptTrackRecordNavCurve(NAV_FIXTURE.navCurve, NAV_FIXTURE.weeks, NAV_FIXTURE.summary!.initialEquity);
    expect(points[0].weekNum).toBe(1); // 06/02 == week 1 basketDate
    expect(points[1].weekNum).toBe(1); // 06/05, before week 2's 06/09
    expect(points[2].weekNum).toBe(2); // 06/09 == week 2 basketDate
    expect(points[3].weekNum).toBe(2); // 06/12, after week 2, no week 3 yet
  });

  it("preserves date/equity/source 1:1 as navDate/equityTwd/source", () => {
    const points = adaptTrackRecordNavCurve(NAV_FIXTURE.navCurve, NAV_FIXTURE.weeks, NAV_FIXTURE.summary!.initialEquity);
    expect(points.map((p) => p.navDate)).toEqual(NAV_FIXTURE.navCurve.map((p) => p.date));
    expect(points.map((p) => p.equityTwd)).toEqual(NAV_FIXTURE.navCurve.map((p) => p.equity));
    expect(points.map((p) => p.source)).toEqual(NAV_FIXTURE.navCurve.map((p) => p.source));
  });
});

describe("adaptTrackRecordNavForPanel", () => {
  it("rebuilds a full FAutoNavResponse-shaped object from the whitelisted payload", () => {
    const adapted = adaptTrackRecordNavForPanel(NAV_FIXTURE);
    expect(adapted.source).toBe(NAV_FIXTURE.source);
    expect(adapted.navCurve).toHaveLength(NAV_FIXTURE.navCurve.length);
    expect(adapted.weeks).toBe(NAV_FIXTURE.weeks);
  });

  it("fills summary.currentWeekNum from the last week and lastNavDate from the last nav point", () => {
    const adapted = adaptTrackRecordNavForPanel(NAV_FIXTURE);
    expect(adapted.summary.currentWeekNum).toBe(2);
    expect(adapted.summary.lastNavDate).toBe("2026-06-12");
  });

  it("passes through the 4 whitelisted summary figures unchanged", () => {
    const adapted = adaptTrackRecordNavForPanel(NAV_FIXTURE);
    expect(adapted.summary.initialEquity).toBe(NAV_FIXTURE.summary!.initialEquity);
    expect(adapted.summary.currentEquity).toBe(NAV_FIXTURE.summary!.currentEquity);
    expect(adapted.summary.cumulativeReturnPct).toBe(NAV_FIXTURE.summary!.cumulativeReturnPct);
    expect(adapted.summary.totalRealizedPnlTwd).toBe(NAV_FIXTURE.summary!.totalRealizedPnlTwd);
  });

  it("handles a null summary (empty_ledger) without throwing", () => {
    const empty: TrackRecordNavResponse = { source: "empty_ledger", navCurve: [], weeks: [], summary: null };
    const adapted = adaptTrackRecordNavForPanel(empty);
    expect(adapted.source).toBe("empty_ledger");
    expect(adapted.navCurve).toEqual([]);
    expect(adapted.summary).toBeNull();
  });
});
