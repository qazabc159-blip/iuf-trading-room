import { describe, expect, it } from "vitest";
import { dataStateLabel, dataStateTone, formatAsOfDate } from "./data-state-copy";

describe("formatAsOfDate", () => {
  it("formats a full ISO date to MM/DD", () => {
    expect(formatAsOfDate("2026-07-03")).toBe("07/03");
  });

  it("formats an ISO datetime to MM/DD", () => {
    expect(formatAsOfDate("2026-07-03T13:30:00+08:00")).toBe("07/03");
  });

  it("returns null for empty/undefined input", () => {
    expect(formatAsOfDate(null)).toBeNull();
    expect(formatAsOfDate(undefined)).toBeNull();
    expect(formatAsOfDate("")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(formatAsOfDate("not-a-date")).toBeNull();
  });

  it("2026-07-18 banner-date-unify regression: a UTC 'Z' timestamp that rolls into the next Taipei day resolves to the TAIPEI date, not the UTC date", () => {
    // Real prod value of marketContext.index.timestamp on 2026-07-17's close:
    // "2026-07-16T16:00:00.000Z" — the UTC calendar date is 07/16, but
    // 16:00 UTC = 00:00 next day in Taipei (+8h), so the true Taipei trading
    // date is 07/17. A naive `value.slice(0, 10)` (the pre-fix implementation)
    // returned "07/16" — this is exactly why /companies/[symbol] and
    // /ai-recommendations showed "07/16 收盤資料" while the homepage (whose
    // KGI-sourced timestamp happened to already be in Taipei-local "+08:00"
    // form) correctly showed "07/17" for the SAME trading day.
    expect(formatAsOfDate("2026-07-16T16:00:00.000Z")).toBe("07/17");
  });
});

describe("dataStateLabel", () => {
  it("live -> 即時", () => {
    expect(dataStateLabel({ state: "live" })).toBe("即時");
  });

  it("close -> uses the data's own date, never today's date implicitly", () => {
    expect(dataStateLabel({ state: "close", asOf: "2026-07-02" })).toBe("07/02 收盤");
  });

  it("close without asOf falls back to plain 收盤 (never blank)", () => {
    expect(dataStateLabel({ state: "close" })).toBe("收盤");
  });

  it("delayed includes the reason", () => {
    expect(dataStateLabel({ state: "delayed", reason: "3/8 檔尚未計價" })).toBe("資料延遲：3/8 檔尚未計價");
  });

  it("delayed without reason still returns a non-empty label", () => {
    expect(dataStateLabel({ state: "delayed" })).toBe("資料延遲");
  });

  it("empty includes reason and eta when both present", () => {
    expect(dataStateLabel({ state: "empty", reason: "非交易時段", eta: "開盤後自動載入" })).toBe(
      "尚無資料：非交易時段（開盤後自動載入）",
    );
  });

  it("empty with no reason/eta still returns 尚無資料, never blank or 載入中", () => {
    expect(dataStateLabel({ state: "empty" })).toBe("尚無資料");
  });
});

describe("dataStateTone", () => {
  it("live is green, close/delayed are amber, empty is gray", () => {
    expect(dataStateTone("live").color).toBe("#34d399");
    expect(dataStateTone("close").color).toBe("#fbbf24");
    expect(dataStateTone("delayed").color).toBe("#fbbf24");
    expect(dataStateTone("empty").color).toBe("#9ca3af");
  });
});
