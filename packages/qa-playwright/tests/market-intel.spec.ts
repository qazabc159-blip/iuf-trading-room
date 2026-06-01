import { expect, test } from "@playwright/test";
import { expectNoServerError, extractFrame, fetchJson, requireText, saveRouteScreenshot } from "./helpers";

type NewsTop10Response = {
  data: {
    run_id: string;
    as_of: string;
    selection_mode: string;
    ai_call_success: boolean;
    stale_reason: string | null;
    items: Array<{
      rank: number;
      ticker: string | null;
      headline: string;
      source: string;
      impact_tier: "HIGH" | "MID" | "MEDIUM" | "LOW" | string | null;
      why_matters: string | null;
    }>;
  };
};

test("/market-intel renders AI-selected news cards with source, impact, and why matters @smoke", async ({ page, request }, testInfo) => {
  const payload = await fetchJson<NewsTop10Response>(request, "/api/v1/market-intel/news-top10");
  const items = payload.data.items;

  expect(
    ["ai", "fallback"],
    "news-top10 must be AI selected or an enriched deterministic fallback, not a raw dump",
  ).toContain(payload.data.selection_mode);
  if (payload.data.selection_mode === "ai") {
    expect(payload.data.ai_call_success, "AI mode must have a successful selector call").toBe(true);
  }
  expect(
    items.length,
    "AI selected news must render at least 9 real items; do not pad fake news to force a top-10 count",
  ).toBeGreaterThanOrEqual(9);

  const completeItems = items.filter((item) => item.source && item.impact_tier && item.why_matters);
  expect(completeItems.length, "CI smoke requires at least 9 news cards with source, impact, and why").toBeGreaterThanOrEqual(9);

  for (const [index, item] of completeItems.entries()) {
    requireText(item.headline, `items[${index}].headline`);
    requireText(item.source, `items[${index}].source`);
    requireText(item.impact_tier, `items[${index}].impact_tier`);
    requireText(item.why_matters, `items[${index}].why_matters`);
  }

  await page.goto("/market-intel", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);

  const hasFrame = await page.locator("iframe").count();
  const surface = hasFrame > 0 ? extractFrame(page).locator("body") : page.locator("body");
  await expect(surface).toContainText(/AI|MARKET|NEWS|市場|情報|精選|新聞/i);
  await saveRouteScreenshot(page, testInfo, "market-intel");
});

test("/market-intel strict gate has fresh AI news with no null fields or duplicate ranks", async ({ request }) => {
  const payload = await fetchJson<NewsTop10Response>(request, "/api/v1/market-intel/news-top10");
  const items = payload.data.items;

  expect(payload.data.stale_reason, "strict P0 gate requires fresh AI news").toBeNull();
  expect(items.filter((item) => !item.why_matters).length, "strict P0 gate allows no null why_matters").toBe(0);
  expect(items.filter((item) => !item.impact_tier).length, "strict P0 gate allows no null impact_tier").toBe(0);

  const duplicateRanks = items
    .map((item) => item.rank)
    .filter((rank, index, ranks) => ranks.indexOf(rank) !== index);
  expect(duplicateRanks, "strict P0 gate requires unique ranks").toEqual([]);
});
