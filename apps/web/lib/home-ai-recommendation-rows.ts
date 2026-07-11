import type { AiRecommendationV3Response } from "./api";
import { mapV3ItemToStockRecCard } from "@/app/ai-recommendations/v3-view";
import type { StockRecCardData } from "@/app/ai-recommendations/StockRecCard";

/**
 * 首頁「今日 AI 推薦行動板」P0-2 修復（2026-07-10，reports/product_critique_20260710/
 * PRODUCT_CRITIQUE_v1.md）：首頁過去吃 legacy `/api/v1/recommendations/today`
 * （strategySource: cont_liq_v36，已被取代的引擎），跟 /ai-recommendations 正式頁的
 * v3 批次是兩份互相矛盾的清單。/ai-recommendations/page.tsx 的正式做法
 * （AI-01 canonical panel）就是：
 *   v3Result.data.items.map((item) => mapV3ItemToStockRecCard(item, v3Result.data)).filter(Boolean)
 * 這裡原樣複用同一個 `mapV3ItemToStockRecCard`（內建 isActionableV3Item 過濾：
 * bucket=C／「高風險排除」／總分<65 一律不進清單），保證首頁跟 /ai-recommendations
 * 在同一份 v3 payload 下，過濾與排序規則完全一致——不是「看起來像」，是同一段程式碼。
 */
export function deriveHomeAiRecommendationCards(
  data: AiRecommendationV3Response | null,
  limit = 5,
): StockRecCardData[] {
  const items = data?.items ?? [];
  const cards = items
    .map((item) => mapV3ItemToStockRecCard(item, data))
    .filter((card): card is StockRecCardData => card !== null);
  return cards.slice(0, limit);
}
