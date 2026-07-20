import { describe, expect, it } from "vitest";

import { isKgiTickFreshEnoughToTrust, KGI_TICK_FROZEN_THRESHOLD_MS } from "./kgi-tick-freshness";

const NOW = Date.parse("2026-07-20T09:30:00+08:00");

describe("isKgiTickFreshEnoughToTrust", () => {
  it("trusts a fresh (non-stale) tick", () => {
    expect(isKgiTickFreshEnoughToTrust({ stale: false, freshness: "fresh" }, NOW)).toBe(true);
  });

  it("trusts a null/undefined envelope (nothing to distrust)", () => {
    expect(isKgiTickFreshEnoughToTrust(null, NOW)).toBe(true);
    expect(isKgiTickFreshEnoughToTrust(undefined, NOW)).toBe(true);
  });

  it("trusts a stale tick with no staleSince (ops manual single-snapshot case — #1310)", () => {
    expect(isKgiTickFreshEnoughToTrust({ stale: true, freshness: "stale" }, NOW)).toBe(true);
  });

  it("trusts a stale tick whose staleSince is just past the 5s D-W2D-1 threshold (normal mid-session chop)", () => {
    const staleSince = new Date(NOW - 10_000).toISOString();
    expect(isKgiTickFreshEnoughToTrust({ stale: true, freshness: "stale", staleSince }, NOW)).toBe(true);
  });

  it("trusts a stale tick right at the frozen threshold boundary", () => {
    const staleSince = new Date(NOW - KGI_TICK_FROZEN_THRESHOLD_MS).toISOString();
    expect(isKgiTickFreshEnoughToTrust({ stale: true, freshness: "stale", staleSince }, NOW)).toBe(true);
  });

  it("distrusts a stale tick whose staleSince is well past the frozen threshold (the reported bug: frozen Friday close)", () => {
    const fridayClose = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(isKgiTickFreshEnoughToTrust({ stale: true, freshness: "stale", staleSince: fridayClose }, NOW)).toBe(false);
  });

  it("trusts when staleSince is unparseable (fail safe, not fail closed)", () => {
    expect(isKgiTickFreshEnoughToTrust({ stale: true, freshness: "stale", staleSince: "not-a-date" }, NOW)).toBe(true);
  });
});
