import { describe, expect, it } from "vitest";
import { monthlyRevenueCadenceNote, quarterlyReportCadenceNote } from "./report-cadence-freshness";

describe("quarterlyReportCadenceNote", () => {
  it("returns a note when Q1 (3/31) is still within the ~120 day filing grace (B2 repro case)", () => {
    // Diagnosis repro: 2330 Q1 26 (period end 2026-03-31), evaluated on
    // 2026-07-12 — ~103 days later, well inside the 120-day quarterly window.
    const note = quarterlyReportCadenceNote("2026-03-31", new Date("2026-07-12T00:00:00Z"));
    expect(note).not.toBeNull();
    expect(note).toContain("2026-03-31");
  });

  it("returns null once genuinely past the grace window", () => {
    const note = quarterlyReportCadenceNote("2026-03-31", new Date("2026-12-01T00:00:00Z"));
    expect(note).toBeNull();
  });

  it("returns null for missing date", () => {
    expect(quarterlyReportCadenceNote(null)).toBeNull();
    expect(quarterlyReportCadenceNote(undefined)).toBeNull();
  });
});

describe("monthlyRevenueCadenceNote", () => {
  it("returns a note when May revenue is still within the ~45 day filing grace", () => {
    const note = monthlyRevenueCadenceNote(2026, 5, new Date("2026-07-12T00:00:00Z"));
    expect(note).not.toBeNull();
    expect(note).toContain("2026/05");
  });

  it("returns null once genuinely past the grace window", () => {
    const note = monthlyRevenueCadenceNote(2026, 5, new Date("2026-09-01T00:00:00Z"));
    expect(note).toBeNull();
  });

  it("returns null for missing year/month", () => {
    expect(monthlyRevenueCadenceNote(null, 5)).toBeNull();
    expect(monthlyRevenueCadenceNote(2026, null)).toBeNull();
  });
});
