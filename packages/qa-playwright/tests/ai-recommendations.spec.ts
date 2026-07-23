import { expect, test } from "@playwright/test";
import { expectNoServerError, fetchJson, requireNumber, requireText, saveRouteScreenshot } from "./helpers";

type AiRecommendationV3Response = {
  ok: boolean;
  runId: string;
  status: string;
  itemCount: number;
  usedFallback: boolean;
  synthesisFallbackUsed: boolean;
  fullAiReportParsed: boolean;
  items: Array<{
    ticker: string;
    source: string;
    bucket?: string;
    totalScore?: number;
    action?: string;
    entryZone?: { low?: number; high?: number; reason?: string };
    stopLoss?: number;
    tp1?: number;
    tp2?: number;
    why_buy?: string[];
    why_not_buy?: string[];
    risk?: string[] | string;
  }>;
};

// Sync source: apps/web/app/ai-recommendations/v3-view.ts::isActionableV3Item
// (Pete PR #1353 review 💭 nit). The page filters raw backend items through
// isActionableV3Item + slices to 5 before rendering `.lead`/`.story` — it
// does NOT render one DOM node per raw payload.items entry. Asserting DOM
// count against payload.items.length only happened to be correct because
// today's fixture data has exactly 5 actionable items; if the backend ever
// returns >5 items or includes a C-bucket/高風險排除 row, this would go
// stale and false-red (or worse, false-green on a coincidence). Mirroring
// the same predicate here keeps the assertion honest without importing
// across the web/qa-playwright package boundary.
function isActionableItem(item: AiRecommendationV3Response["items"][number]): boolean {
  if (item.bucket === "C") return false;
  if ((item.action ?? "").includes("高風險排除")) return false;
  if (typeof item.totalScore === "number" && item.totalScore < 65) return false;
  return true;
}

// 2026-07-23 (Jim, AI 投研晨報 v2 重設計): 舊版每檔一張 `._src-card` 格狀卡片
// 全部換成「頭版特稿 (.lead, rank #1) + 內頁欄目 (.story, rank #2-5)」的報紙
// 版式（reports/design_redesign_20260722/drafts/ai_rec_redesign_v2.html）。
// 選擇器同步換成 `.lead, .story`；後端 payload 層的驗收（trade plan 齊全/
// status=complete/無備援）維持不動，因為資料層完全沒改，只換呈現層。
test("/ai-recommendations renders 5+ non-fallback v3 cards with full trade plan", async ({ page, request }, testInfo) => {
  const payload = await fetchJson<AiRecommendationV3Response>(request, "/api/v1/ai-recommendations/v3");

  await page.goto("/ai-recommendations", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);
  const expectedCardCount = Math.min(5, payload.items.filter(isActionableItem).length);
  await expect(page.locator(".amb-shell .lead, .amb-shell .story")).toHaveCount(expectedCardCount);
  // exactly one lead article (rank #1, 頭版特稿)
  await expect(page.locator(".amb-shell article.lead")).toHaveCount(1);
  await saveRouteScreenshot(page, testInfo, "ai-recommendations");

  expect(payload.ok).toBe(true);
  expect(payload.itemCount, "v3 backend must produce at least 5 cards").toBeGreaterThanOrEqual(5);
  expect(payload.items.length).toBeGreaterThanOrEqual(5);

  for (const [index, item] of payload.items.entries()) {
    requireText(item.ticker, `items[${index}].ticker`);
    requireText(item.source, `items[${index}].source`);
    requireNumber(item.entryZone?.low, `items[${index}].entryZone.low`);
    requireNumber(item.entryZone?.high, `items[${index}].entryZone.high`);
    requireNumber(item.stopLoss, `items[${index}].stopLoss`);
    requireNumber(item.tp1, `items[${index}].tp1`);
    requireNumber(item.tp2, `items[${index}].tp2`);
    expect((item.why_buy ?? []).length, `items[${index}].why_buy must not be empty`).toBeGreaterThan(0);
    expect((item.why_not_buy ?? item.risk ?? []).length, `items[${index}].risk must not be empty`).toBeGreaterThan(0);
  }

  expect(payload.status, "v3 must be a fully accepted synthesis").toBe("complete");
  expect(payload.fullAiReportParsed, "v3 final AI report must parse").toBe(true);
  expect(payload.usedFallback, "usedFallback=false is required for GREEN").toBe(false);
  expect(payload.synthesisFallbackUsed, "synthesisFallbackUsed=false is required for GREEN").toBe(false);
});
