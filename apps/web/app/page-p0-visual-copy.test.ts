import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("homepage P0 visual product copy", () => {
  it("keeps internal OpenAlice admin links out of the customer homepage", () => {
    expect(source).not.toContain("const adminNav: Array<");
    expect(source).not.toContain("const internalNav: Array<");
    for (const href of [
      "/admin/brain/llm",
      "/admin/events",
      "/admin/portfolio/snapshots",
      "/admin/tools",
      "/admin/uta/accounts",
      "/admin/strategies",
    ]) {
      expect(source).not.toContain(href);
    }
  });

  it("does not expose raw English daily-brief headings in the homepage brief preview", () => {
    expect(source).toContain('"market overview": "盤勢總覽"');
    expect(source).toContain('"theme summaries": "題材摘要"');
    expect(source).toContain('"company notes": "公司觀察"');
    expect(source).toContain("function polishedBriefText");
    expect(source).toContain("AI 簡報只整理盤勢、題材與公司觀察");
  });

  it("surfaces real AI recommendations on the customer homepage instead of hiding them behind debug pages", () => {
    expect(source).toContain("getRecommendationsToday");
    expect(source).toContain("function AiRecommendationActionPanel");
    expect(source).toContain("今日 AI 推薦行動板");
    expect(source).toContain("data-testid=\"homepage-ai-recommendations\"");
    expect(source).toContain("GET /api/v1/recommendations/today");
    expect(source).toContain("recommendationTradeHref");
    expect(source).toContain("進交易室");
  });

  it("does not let one slow market-intel source blank the whole homepage intel panel", () => {
    expect(source).toContain("const FETCH_INTEL_MS = 12000");
    expect(source).toContain("const INTEL_SOURCE_MS = 7000");
    expect(source).toContain("withTimeout(getNewsTop10(), INTEL_SOURCE_MS, \"market_intel_news\")");
    expect(source).toContain("\"market_intel_announcements\"");
    expect(source).toContain("newsFailed && announcementsFailed");
    expect(source).toContain("timedFetch(\"intel\", FETCH_INTEL_MS");
  });
});
