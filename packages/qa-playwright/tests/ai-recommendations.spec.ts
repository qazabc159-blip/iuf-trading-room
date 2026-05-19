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
    entryZone?: { low?: number; high?: number; reason?: string };
    stopLoss?: number;
    tp1?: number;
    tp2?: number;
    why_buy?: string[];
    why_not_buy?: string[];
    risk?: string[] | string;
  }>;
};

test("/ai-recommendations renders 5+ non-fallback v3 cards with full trade plan", async ({ page, request }, testInfo) => {
  const payload = await fetchJson<AiRecommendationV3Response>(request, "/api/v1/ai-recommendations/v3");

  await page.goto("/ai-recommendations", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);
  await expect(page.locator("._src-card")).toHaveCount(payload.items.length);
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
