/**
 * page-p0-visual-copy.test.ts
 * Homepage P0 product-copy regression gate.
 *
 * 2026-07-14 載體轉移（第二次）：正式首頁改回 React server component
 * （page.tsx），恢復幾週打磨的資料層／取代掉當天稍早的 iframe + inline
 * script 靜態頁（public/home-exact/index.html 仍保留供 /home-exact 預覽路由
 * 使用，但 "/" 不再吃它）。本檔的產品鐵律驗證目標隨之轉回 page.tsx 本身。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("homepage P0 visual product copy (React server component carrier)", () => {
  it("keeps internal OpenAlice admin links out of the customer homepage", () => {
    expect(pageSource).not.toContain("/admin/brain/llm");
    expect(pageSource).not.toContain("/admin/events");
    expect(pageSource).not.toContain("/admin/portfolio/snapshots");
    expect(pageSource).not.toContain("/admin/tools");
    expect(pageSource).not.toContain("/admin/uta/accounts");
    expect(pageSource).not.toContain("/admin/strategies");
  });

  it("does not expose raw English daily-brief headings in the homepage brief preview", () => {
    // heading 轉譯表存在（英文 key 只作為 mapping key，非顯示文案）
    expect(pageSource).toContain('"market overview": "盤勢總覽"');
    expect(pageSource).toContain('"theme summaries": "題材摘要"');
    expect(pageSource).toContain('"company notes": "公司觀察"');
  });

  it("surfaces real AI recommendations on the customer homepage instead of hiding them behind debug pages", () => {
    expect(pageSource).toContain("deriveHomeAiRecommendationCards");
    expect(pageSource).toContain('className="recwrap"');
  });

  it("P0-2 (2026-07-10): homepage AI recommendations use the same v3 canonical source, not the retired legacy engine", () => {
    // reports/product_critique_20260710 P0-2：首頁推薦必須與 /ai-recommendations
    // 同一條 v3 canonical（getAiRecommendationsV3），不吃已退役的 legacy 引擎。
    expect(pageSource).toContain("getAiRecommendationsV3");
    expect(pageSource).not.toContain("recommendations/today");
  });

  it("does not let one slow market-intel source blank the whole homepage intel panel", () => {
    // news-top10 與 announcements 各自 Promise.allSettled + 各自 catch，單源
    // 失敗（timeout/reject）不清空整個 intel 面板，只在雙源皆失敗才 BLOCKED。
    expect(pageSource).toContain("getNewsTop10");
    expect(pageSource).toContain("getMarketIntelAnnouncements");
    expect(pageSource).toContain("Promise.allSettled");
    expect(pageSource).toContain("if (newsFailed && announcementsFailed)");
  });
});
