import { NextResponse } from "next/server";
import { getAiRecommendationsV3 } from "@/lib/api";
import { deriveHomeAiRecommendationCards } from "@/lib/home-ai-recommendation-rows";

// 首頁「原封搬原稿」預覽（/home-exact，2026-07-14）專用的最小 JSON 端點。
// 目的：AI 推薦卡片的「可行動」過濾/映射（bucket=C 排除、高風險排除、總分<65
// 排除、entry/stop/tp 欄位命名）已經是 lib/home-ai-recommendation-rows.ts 的
// deriveHomeAiRecommendationCards() 這條唯一正式邏輯（/ai-recommendations 正式頁
// 與既有 / 首頁都吃同一段程式碼）。/home-exact 的靜態頁只用 vanilla JS 讀資料，
// 沒有辦法直接 import 這段 server-only TS 邏輯，因此在這裡原樣重用它、只吐出
// 精簡後的 JSON，避免在前端另外重寫一份過濾規則（=「發明第二套 payload 語意」）。
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

export async function GET() {
  try {
    const data = await getAiRecommendationsV3();
    const cards = deriveHomeAiRecommendationCards(data, 5);
    return NextResponse.json(
      { generatedAt: data?.generatedAt ?? null, cards },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json(
      { generatedAt: null, cards: [], error: message },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
