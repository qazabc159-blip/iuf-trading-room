import { describe, it, expect } from "vitest";
import { realtimeFreshnessMode } from "./realtime-freshness";

describe("realtimeFreshnessMode — post-close CLOSE state (6/15 fix)", () => {
  it("today's off-hours MIS close maps to 'close', not intraday or eod", () => {
    // 6/15 15:13: MIS still serves the day's final snapshot after the session
    // (state=CLOSE, source=twse_intraday). It is today's real close.
    expect(
      realtimeFreshnessMode({ state: "CLOSE", source: "twse_intraday", freshness: "stale", lastPrice: 2375 }),
    ).toBe("close");
  });

  it("intraday LIVE still maps to intraday", () => {
    expect(
      realtimeFreshnessMode({
        state: "LIVE",
        source: "twse_intraday",
        freshness: "fresh",
        lastPrice: 2375,
        updatedAt: new Date().toISOString(),
      }),
    ).toBe("intraday");
  });

  it("post-close EOD reference (yesterday's close) still maps to eod, not close", () => {
    expect(
      realtimeFreshnessMode({
        state: "STALE",
        source: "twse_openapi_eod",
        freshness: "stale",
        lastPrice: 2310,
        referenceReason: "post_close_reference",
      }),
    ).toBe("eod");
  });
});
