import { describe, expect, it } from "vitest";
import type { RealtimeFreshnessInput } from "./realtime-freshness";
import { realtimeFreshnessMode } from "./realtime-freshness";

const baseQuote: RealtimeFreshnessInput = {
  symbol: "2330",
  lastPrice: 2385,
  bid: null,
  ask: null,
  volume: 28_441_321,
  freshness: "stale",
  state: "STALE",
  source: "twse_openapi_eod",
  updatedAt: "2026-06-05T01:05:00.000Z",
};

describe("computeFreshnessMode", () => {
  it("marks TWSE EOD fallback during the live session as stale", () => {
    expect(
      realtimeFreshnessMode({
        ...baseQuote,
        marketSession: "OPEN",
        referenceReason: "kgi_unavailable_eod_fallback",
      }, Date.parse("2026-06-05T01:05:05.000Z")),
    ).toBe("stale");
  });

  it("keeps post-close TWSE EOD reference as eod", () => {
    expect(
      realtimeFreshnessMode({
        ...baseQuote,
        marketSession: "POST-CLOSE",
        referenceReason: "post_close_reference",
      }, Date.parse("2026-06-05T07:00:00.000Z")),
    ).toBe("eod");
  });
});
