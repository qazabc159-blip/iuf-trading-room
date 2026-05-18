import { describe, expect, it } from "vitest";
import { isKgiTradingHours, kgiCoreTilesAreNull, kgiNextOpenLabel } from "./kgi-trading-hours";

/**
 * Helper: construct a Date in Asia/Taipei (UTC+8) from explicit local time parts.
 * We pass the TST local time as UTC+8 by subtracting 8 hours to get UTC.
 */
function tst(
  year: number,
  month: number, // 1-based
  day: number,
  hour: number,
  minute: number,
): Date {
  // UTC = TST - 8h
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0));
}

describe("isKgiTradingHours", () => {
  // Weekday: Monday 2026-05-18 09:30 TST → inside window
  it("weekday 09:30 → true", () => {
    expect(isKgiTradingHours(tst(2026, 5, 18, 9, 30))).toBe(true);
  });

  // Weekday: Monday 2026-05-18 13:00 TST → inside window
  it("weekday 13:00 → true", () => {
    expect(isKgiTradingHours(tst(2026, 5, 18, 13, 0))).toBe(true);
  });

  // Boundary: Monday 09:00 exactly → true (open)
  it("weekday 09:00 exactly → true", () => {
    expect(isKgiTradingHours(tst(2026, 5, 18, 9, 0))).toBe(true);
  });

  // Boundary: Monday 14:10 exactly → true (close boundary inclusive)
  it("weekday 14:10 exactly → true", () => {
    expect(isKgiTradingHours(tst(2026, 5, 18, 14, 10))).toBe(true);
  });

  // Weekday after close: Monday 14:30 TST → false
  it("weekday 14:30 → false", () => {
    expect(isKgiTradingHours(tst(2026, 5, 18, 14, 30))).toBe(false);
  });

  // Weekday before open: Monday 08:00 TST → false
  it("weekday 08:00 → false", () => {
    expect(isKgiTradingHours(tst(2026, 5, 18, 8, 0))).toBe(false);
  });

  // Saturday: 2026-05-16 10:00 TST → false (weekend)
  it("Saturday 10:00 → false", () => {
    expect(isKgiTradingHours(tst(2026, 5, 16, 10, 0))).toBe(false);
  });

  // Sunday: 2026-05-17 10:00 TST → false (weekend)
  it("Sunday 10:00 → false", () => {
    expect(isKgiTradingHours(tst(2026, 5, 17, 10, 0))).toBe(false);
  });

  // Boundary: Monday 14:11 TST → false (1 min after close)
  it("weekday 14:11 → false", () => {
    expect(isKgiTradingHours(tst(2026, 5, 18, 14, 11))).toBe(false);
  });

  // Boundary: Monday 08:59 TST → false (1 min before open)
  it("weekday 08:59 → false", () => {
    expect(isKgiTradingHours(tst(2026, 5, 18, 8, 59))).toBe(false);
  });
});

describe("kgiCoreTilesAreNull", () => {
  it("empty array → true", () => {
    expect(kgiCoreTilesAreNull([])).toBe(true);
  });

  it("all null tiles → true", () => {
    expect(kgiCoreTilesAreNull([
      { pct: null, price: null },
      { pct: null, price: null },
      { pct: null, price: null },
    ])).toBe(true);
  });

  it("one tile has pct → false", () => {
    expect(kgiCoreTilesAreNull([
      { pct: 1.5, price: null },
      { pct: null, price: null },
    ])).toBe(false);
  });

  it("one tile has price → false", () => {
    expect(kgiCoreTilesAreNull([
      { pct: null, price: 500 },
    ])).toBe(false);
  });

  it("all tiles with real data → false", () => {
    expect(kgiCoreTilesAreNull([
      { pct: 2.3, price: 600 },
      { pct: -1.2, price: 450 },
    ])).toBe(false);
  });
});

describe("kgiNextOpenLabel", () => {
  it("weekday before open points to today 09:00", () => {
    expect(kgiNextOpenLabel(tst(2026, 5, 18, 8, 0))).toBe("今日 09:00");
  });

  it("weekday after close points to next day", () => {
    expect(kgiNextOpenLabel(tst(2026, 5, 18, 15, 0))).toBe("次日 09:00");
  });

  it("weekend points to Monday", () => {
    expect(kgiNextOpenLabel(tst(2026, 5, 17, 10, 0))).toBe("明日 (一) 09:00");
  });
});
