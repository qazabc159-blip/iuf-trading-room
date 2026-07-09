import { describe, expect, it } from "vitest";
import { isSignalStale, minutesAgo, relativeTimeLabel, SIGNAL_STALE_MINUTES } from "./signal-freshness";

// Fixed "now" anchor: 2026-07-09 10:00:00 Taipei (UTC+8) = 2026-07-09T02:00:00Z
const NOW = Date.parse("2026-07-09T02:00:00.000Z");

describe("minutesAgo", () => {
  it("returns null for missing/invalid input", () => {
    expect(minutesAgo(null, NOW)).toBeNull();
    expect(minutesAgo(undefined, NOW)).toBeNull();
    expect(minutesAgo("not-a-date", NOW)).toBeNull();
  });

  it("computes whole minutes elapsed", () => {
    const fiveMinAgo = new Date(NOW - 5 * 60_000).toISOString();
    expect(minutesAgo(fiveMinAgo, NOW)).toBe(5);
  });

  it("clamps future timestamps to 0 (clock skew safety)", () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(minutesAgo(future, NOW)).toBe(0);
  });
});

describe("relativeTimeLabel", () => {
  it("shows 剛剛 for <1 minute", () => {
    expect(relativeTimeLabel(new Date(NOW - 10_000).toISOString(), NOW)).toBe("剛剛");
  });

  it("shows N 分鐘前 under an hour", () => {
    expect(relativeTimeLabel(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe("12 分鐘前");
  });

  it("shows N 小時前 under a day", () => {
    expect(relativeTimeLabel(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe("3 小時前");
  });

  it("shows N 天前 for multi-day age", () => {
    expect(relativeTimeLabel(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe("2 天前");
  });

  it("shows 時間未知 for unparsable input", () => {
    expect(relativeTimeLabel(null, NOW)).toBe("時間未知");
  });
});

describe("isSignalStale", () => {
  it("treats missing timestamp as stale (honest default, not a trust signal)", () => {
    expect(isSignalStale(null, NOW)).toBe(true);
  });

  it("treats same-day, within-threshold signals as fresh", () => {
    const oneHourAgo = new Date(NOW - 60 * 60_000).toISOString();
    expect(isSignalStale(oneHourAgo, NOW)).toBe(false);
  });

  it("treats same-day signals past the threshold as stale", () => {
    const pastThreshold = new Date(NOW - (SIGNAL_STALE_MINUTES + 1) * 60_000).toISOString();
    expect(isSignalStale(pastThreshold, NOW)).toBe(true);
  });

  it("treats prior-day signals as stale even if under the minute threshold", () => {
    // 2026-07-08T23:50:00Z Taipei = 2026-07-09T07:50 local -> still previous Taipei calendar day at NOW-2h check
    const priorDay = "2026-07-08T10:00:00.000Z"; // 2026-07-08 18:00 Taipei — different calendar day
    expect(isSignalStale(priorDay, NOW)).toBe(true);
  });
});
