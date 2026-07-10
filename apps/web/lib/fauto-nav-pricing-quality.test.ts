import { describe, expect, it } from "vitest";
import {
  degradedPricingCount,
  hasDegradedPricing,
  weekHasDegradedPricing,
} from "./fauto-nav-pricing-quality";
import type { NavCurvePoint } from "./fauto-sim-api";

function point(overrides: Partial<NavCurvePoint>): NavCurvePoint {
  return {
    navDate: "2026-07-01",
    equityTwd: 10_000_000,
    returnPct: 0,
    weekNum: 1,
    source: "live",
    ...overrides,
  };
}

const allOfficial: NavCurvePoint[] = [
  point({ navDate: "2026-06-30", weekNum: 4, pricingQuality: "official" }),
  point({ navDate: "2026-07-01", weekNum: 5 }), // undefined marker — pre-#1192 row
  point({ navDate: "2026-07-02", weekNum: 5, pricingQuality: "official" }),
];

const withDegraded: NavCurvePoint[] = [
  point({ navDate: "2026-06-30", weekNum: 4, pricingQuality: "official" }),
  point({ navDate: "2026-07-01", weekNum: 5, pricingQuality: "mis_fallback_full" }),
  point({ navDate: "2026-07-02", weekNum: 5, pricingQuality: "official" }),
];

describe("hasDegradedPricing", () => {
  it("returns false when every point is official or unmarked (pre-#1192 rows)", () => {
    expect(hasDegradedPricing(allOfficial)).toBe(false);
  });

  it("returns true when at least one point is mis_fallback_full", () => {
    expect(hasDegradedPricing(withDegraded)).toBe(true);
  });

  it("returns false for an empty curve", () => {
    expect(hasDegradedPricing([])).toBe(false);
  });
});

describe("degradedPricingCount", () => {
  it("counts only mis_fallback_full points", () => {
    expect(degradedPricingCount(allOfficial)).toBe(0);
    expect(degradedPricingCount(withDegraded)).toBe(1);
  });
});

describe("weekHasDegradedPricing", () => {
  it("is true only for the week number containing a degraded point", () => {
    expect(weekHasDegradedPricing(4, withDegraded)).toBe(false);
    expect(weekHasDegradedPricing(5, withDegraded)).toBe(true);
  });

  it("is false for every week when the curve is all official", () => {
    expect(weekHasDegradedPricing(4, allOfficial)).toBe(false);
    expect(weekHasDegradedPricing(5, allOfficial)).toBe(false);
  });
});
