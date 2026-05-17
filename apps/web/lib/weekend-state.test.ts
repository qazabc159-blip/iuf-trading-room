import { describe, it, expect } from "vitest";
import {
  getWeekendState,
  heatmapEmptyReason,
  heatmapSourceLabel,
  announcementsAreStale,
  intelStaleFooterNote,
} from "./weekend-state";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a Date object for a given Taipei-local date (approximated via UTC offset +8). */
function makeDate(year: number, month: number, day: number, hour = 12): Date {
  // UTC+8: subtract 8h so that new Date().toLocaleDateString("en-CA", {timeZone:"Asia/Taipei"})
  // yields the intended date.
  const utcMs = Date.UTC(year, month - 1, day, hour - 8);
  return new Date(utcMs);
}

// 2026-05-17 is a Sunday (dow=0).  2026-05-16 is Saturday.  2026-05-15 is Friday.
const SUNDAY_2026_05_17 = makeDate(2026, 5, 17, 14);
const SATURDAY_2026_05_16 = makeDate(2026, 5, 16, 14);
const FRIDAY_2026_05_15 = makeDate(2026, 5, 15, 14);
const WEDNESDAY_2026_05_13 = makeDate(2026, 5, 13, 14);

// ── getWeekendState ───────────────────────────────────────────────────────────

describe("getWeekendState", () => {
  it("detects Sunday as weekend, last trading day = Friday", () => {
    const s = getWeekendState(SUNDAY_2026_05_17);
    expect(s.isWeekend).toBe(true);
    expect(s.lastTradingDay).toBe("2026-05-15");
    expect(s.lastTradingDayLabel).toContain("5/15");
    expect(s.lastTradingDayLabel).toContain("五");
  });

  it("detects Saturday as weekend, last trading day = Friday", () => {
    const s = getWeekendState(SATURDAY_2026_05_16);
    expect(s.isWeekend).toBe(true);
    expect(s.lastTradingDay).toBe("2026-05-15");
  });

  it("detects Friday as weekday", () => {
    const s = getWeekendState(FRIDAY_2026_05_15);
    expect(s.isWeekend).toBe(false);
    expect(s.lastTradingDay).toBe("2026-05-15");
  });

  it("detects Wednesday as weekday", () => {
    const s = getWeekendState(WEDNESDAY_2026_05_13);
    expect(s.isWeekend).toBe(false);
    expect(s.lastTradingDay).toBe("2026-05-13");
  });
});

// ── heatmapEmptyReason ────────────────────────────────────────────────────────

describe("heatmapEmptyReason — weekend empty state", () => {
  it("returns weekend wording when layout is empty on Sunday", () => {
    const reason = heatmapEmptyReason("EMPTY", undefined, 0, SUNDAY_2026_05_17);
    expect(reason).toContain("週末休市");
    expect(reason).toContain("5/15");
    expect(reason).toContain("五");
  });

  it("returns sync wording when layout is empty on a weekday", () => {
    const reason = heatmapEmptyReason("EMPTY", undefined, 0, FRIDAY_2026_05_15);
    expect(reason).toContain("同步中");
    expect(reason).not.toContain("週末");
  });

  it("returns BLOCKED reason when marketState is BLOCKED, ignoring weekend", () => {
    const reason = heatmapEmptyReason("BLOCKED", "外部封鎖", 0, SUNDAY_2026_05_17);
    expect(reason).toBe("外部封鎖");
  });

  it("returns BLOCKED fallback when reason is undefined", () => {
    const reason = heatmapEmptyReason("BLOCKED", undefined, 0, FRIDAY_2026_05_15);
    expect(reason).toContain("無法更新");
  });

  it("returns sector-no-data wording when layout has tiles but sector is non-empty branch (marketState=LIVE)", () => {
    // layout.length > 0 means tiles exist — this branch is never reached in empty state
    // layout.length === 0 + marketState !== BLOCKED → weekend or sync
    const reason = heatmapEmptyReason("LIVE", undefined, 5, FRIDAY_2026_05_15);
    // layout.length > 0, marketState != BLOCKED → fallback text
    expect(reason).toContain("沒有足夠正式行情");
  });
});

// ── heatmapSourceLabel ────────────────────────────────────────────────────────

describe("heatmapSourceLabel", () => {
  it("returns TWSE盤後 label on weekend with empty layout", () => {
    const label = heatmapSourceLabel("FinMind 官方日資料", 0, SUNDAY_2026_05_17);
    expect(label).toContain("TWSE 盤後資料");
    expect(label).toContain("5/15");
  });

  it("returns base label on weekday regardless of layout", () => {
    const label = heatmapSourceLabel("FinMind 官方日資料", 0, FRIDAY_2026_05_15);
    expect(label).toBe("FinMind 官方日資料");
  });

  it("returns base label on weekend when layout has tiles", () => {
    const label = heatmapSourceLabel("FinMind 官方日資料", 7, SUNDAY_2026_05_17);
    expect(label).toBe("FinMind 官方日資料");
  });
});

// ── announcementsAreStale ─────────────────────────────────────────────────────

describe("announcementsAreStale", () => {
  it("returns true when all dates are ≥ 2 days old", () => {
    // now = Sunday 2026-05-17, items from Friday 2026-05-15 = 2 days ago
    const result = announcementsAreStale(["2026-05-15", "2026-05-14"], 2, SUNDAY_2026_05_17);
    expect(result).toBe(true);
  });

  it("returns false when at least one date is recent (< 2 days old)", () => {
    // now = Friday 14:00, item from same day = 0 hours old
    const todayIso = "2026-05-15";
    const result = announcementsAreStale([todayIso, "2026-05-10"], 2, FRIDAY_2026_05_15);
    expect(result).toBe(false);
  });

  it("returns true for empty array", () => {
    expect(announcementsAreStale([], 2, FRIDAY_2026_05_15)).toBe(true);
  });
});

// ── intelStaleFooterNote ──────────────────────────────────────────────────────

describe("intelStaleFooterNote", () => {
  it("returns stale cutoff note when items=0 and it is weekend", () => {
    const note = intelStaleFooterNote(0, SUNDAY_2026_05_17);
    expect(note).toContain("公告資料截至");
    expect(note).toContain("5/15");
  });

  it("returns standard note when items>0", () => {
    const note = intelStaleFooterNote(5, SUNDAY_2026_05_17);
    expect(note).toBe("來源路徑可讀");
  });

  it("returns standard note on weekday even with 0 items", () => {
    const note = intelStaleFooterNote(0, FRIDAY_2026_05_15);
    expect(note).toBe("來源路徑可讀");
  });
});
