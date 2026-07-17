import { describe, expect, it } from "vitest";
import { taipeiCalendarDate } from "./taipei-date";

describe("taipeiCalendarDate", () => {
  it("plain date string passes through unchanged", () => {
    expect(taipeiCalendarDate("2026-07-17")).toBe("2026-07-17");
  });

  it("Taipei-local '+08:00' timestamp keeps the same calendar date", () => {
    expect(taipeiCalendarDate("2026-07-17T13:30:00+08:00")).toBe("2026-07-17");
  });

  it("UTC 'Z' timestamp that rolls into the next Taipei day resolves to the NEXT day (the real prod bug shape)", () => {
    // 16:00 UTC + 8h = 00:00 next day Taipei.
    expect(taipeiCalendarDate("2026-07-16T16:00:00.000Z")).toBe("2026-07-17");
  });

  it("UTC 'Z' timestamp that does NOT roll over keeps the same calendar date", () => {
    // 05:30 UTC + 8h = 13:30 same day Taipei.
    expect(taipeiCalendarDate("2026-07-09T05:30:00.000Z")).toBe("2026-07-09");
  });

  it("null/undefined/empty/malformed → null", () => {
    expect(taipeiCalendarDate(null)).toBeNull();
    expect(taipeiCalendarDate(undefined)).toBeNull();
    expect(taipeiCalendarDate("")).toBeNull();
    expect(taipeiCalendarDate("not-a-date")).toBeNull();
  });
});
