import { describe, expect, it } from "vitest";

import type { AiRecommendationV3Item, AiRecommendationV3Response } from "./api";
import { deriveHomeAiRecommendationCards } from "./home-ai-recommendation-rows";
import { mapV3ItemToStockRecCard } from "@/app/ai-recommendations/v3-view";

/**
 * P0-2 consistency lock（2026-07-10，reports/product_critique_20260710/
 * PRODUCT_CRITIQUE_v1.md）：首頁「今日 AI 推薦行動板」跟 /ai-recommendations
 * 正式頁（AI-01 canonical panel，`page.tsx` 的
 * `v3Items.map((item) => mapV3ItemToStockRecCard(item, v3Result.data)).filter(Boolean)`）
 * 必須輸出同一份清單。這裡直接重放 /ai-recommendations 頁那段 map+filter，
 * 對照 `deriveHomeAiRecommendationCards` 的輸出，鎖住兩邊不會分岔。
 */
function replicateAiRecommendationsPageDerivation(data: AiRecommendationV3Response) {
  return (data.items ?? [])
    .map((item) => mapV3ItemToStockRecCard(item, data))
    .filter((card): card is NonNullable<typeof card> => card !== null);
}

function item(overrides: Partial<AiRecommendationV3Item>): AiRecommendationV3Item {
  return {
    ticker: "2330",
    companyName: "台積電",
    confidence: 0.8,
    totalScore: 80,
    bucket: "A",
    entryZone: { low: 900, high: 920, reason: "OTE" },
    tp1Structured: { price: 960 },
    stopLossStructured: { price: 870 },
    why_buy: ["理由一"],
    source: "ai_recommendations_v3",
    ...overrides,
  };
}

describe("homepage AI recommendation rows vs /ai-recommendations canonical derivation", () => {
  it("produces the exact same actionable card list (same tickers, same order) as the /ai-recommendations page pattern", () => {
    const data: AiRecommendationV3Response = {
      runId: "run-1",
      status: "complete",
      generatedAt: "2026-07-10T08:31:00+08:00",
      itemCount: 5,
      items: [
        item({ ticker: "2330", bucket: "A+", totalScore: 90 }),
        item({ ticker: "3443", companyName: "創意", bucket: "A", totalScore: 78 }),
        item({ ticker: "2408", companyName: "南亞科", bucket: "B", totalScore: 68 }),
        // bucket C 必須被兩邊同時排除——這正是 legacy cont_liq_v36 污染
        // 情境下「看起來像推薦但其實是排除名單」的防線。
        item({ ticker: "9999", companyName: "應被排除", bucket: "C", totalScore: 40 }),
        item({ ticker: "2454", companyName: "聯發科", bucket: "A", totalScore: 82 }),
      ],
    };

    const canonical = replicateAiRecommendationsPageDerivation(data);
    const home = deriveHomeAiRecommendationCards(data, 5);

    expect(home.map((c) => c.ticker)).toEqual(canonical.map((c) => c.ticker));
    expect(home).toEqual(canonical);
    expect(home.map((c) => c.ticker)).not.toContain("9999");
  });

  it("truncates to the requested limit while preserving the canonical prefix order", () => {
    const data: AiRecommendationV3Response = {
      runId: "run-2",
      status: "complete",
      generatedAt: "2026-07-10T08:31:00+08:00",
      itemCount: 7,
      items: [
        item({ ticker: "T1", totalScore: 90, bucket: "A+" }),
        item({ ticker: "T2", totalScore: 88, bucket: "A" }),
        item({ ticker: "T3", totalScore: 85, bucket: "A" }),
        item({ ticker: "T4", totalScore: 80, bucket: "B" }),
        item({ ticker: "T5", totalScore: 79, bucket: "B" }),
        item({ ticker: "T6", totalScore: 75, bucket: "B" }),
        item({ ticker: "T7", totalScore: 70, bucket: "B" }),
      ],
    };

    const canonical = replicateAiRecommendationsPageDerivation(data);
    const home = deriveHomeAiRecommendationCards(data, 5);

    expect(canonical.map((c) => c.ticker)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7"]);
    expect(home.map((c) => c.ticker)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(home).toEqual(canonical.slice(0, 5));
  });

  it("returns an empty list (not fabricated rows) when the v3 payload has no items", () => {
    const data: AiRecommendationV3Response = {
      runId: null,
      status: "empty",
      generatedAt: "2026-07-10T08:31:00+08:00",
      itemCount: 0,
      items: [],
    };

    expect(deriveHomeAiRecommendationCards(data, 5)).toEqual([]);
    expect(deriveHomeAiRecommendationCards(null, 5)).toEqual([]);
  });
});
