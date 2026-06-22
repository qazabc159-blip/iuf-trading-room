import { describe, expect, it } from "vitest";
import {
  recommendationDirectionSchema,
  type StockRecommendation,
} from "@iuf-trading-room/contracts";

import { buildRecommendationPrefillHref } from "./ai-recommendation-handoff";

function recommendation(overrides: Partial<StockRecommendation> = {}) {
  return {
    recommendationId: "rec-2330-20260622",
    ticker: "2330",
    direction: recommendationDirectionSchema.options[0],
    entryZone: { primary: "1010-1020" },
    invalidation: { price: 980 },
    targets: [
      { label: "TP1", price: 1080 },
      { label: "TP2", price: 1120 },
    ],
    ...overrides,
  } as StockRecommendation;
}

describe("AI recommendation SIM handoff", () => {
  it("carries only the validated SIM context into the paper room", () => {
    const href = buildRecommendationPrefillHref(recommendation());
    const url = new URL(href ?? "", "https://app.eycvector.local");

    expect(url.pathname).toBe("/portfolio");
    expect(url.searchParams.get("ticker")).toBe("2330");
    expect(url.searchParams.get("prefill")).toBe("true");
    expect(url.searchParams.get("from_rec")).toBe("rec-2330-20260622");
    expect(url.searchParams.get("side")).toBe("buy");
    expect(url.searchParams.get("entry")).toBe("1010-1020");
    expect(url.searchParams.get("stop")).toBe("980");
    expect(url.searchParams.get("tp")).toBe("1080");
  });

  it("refuses unsafe ticker values instead of generating a handoff URL", () => {
    expect(buildRecommendationPrefillHref(recommendation({ ticker: "2330<script>" }))).toBeNull();
  });
});
