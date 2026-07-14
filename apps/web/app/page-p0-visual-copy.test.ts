/**
 * page-p0-visual-copy.test.ts
 * Homepage P0 product-copy regression gate.
 *
 * 2026-07-14 載體轉移：正式首頁改為「原封搬原稿」靜態頁
 * （public/home-exact/index.html，inline script 接真資料），page.tsx 只剩全屏
 * iframe wrapper。本檔的產品鐵律不變，驗證目標從 page.tsx 轉到新載體：
 * index.html（版面＋script）與 app/api/home-exact/recommendations/route.ts
 * （v3 canonical 推薦來源）。舊 server-component 專屬鎖（timeout 常數、
 * function 名）由新載體的等價 marker 取代。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrapperSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const homeSource = readFileSync(
  new URL("../public/home-exact/index.html", import.meta.url),
  "utf8",
);
const recRouteSource = readFileSync(
  new URL("./api/home-exact/recommendations/route.ts", import.meta.url),
  "utf8",
);

describe("homepage P0 visual product copy (verbatim-artifact carrier)", () => {
  it("keeps internal OpenAlice admin links out of the customer homepage", () => {
    for (const src of [wrapperSource, homeSource]) {
      expect(src).not.toContain("/admin/brain/llm");
      expect(src).not.toContain("/admin/events");
      expect(src).not.toContain("/admin/portfolio/snapshots");
      expect(src).not.toContain("/admin/tools");
      expect(src).not.toContain("/admin/uta/accounts");
      expect(src).not.toContain("/admin/strategies");
    }
  });

  it("does not expose raw English daily-brief headings in the homepage brief preview", () => {
    // heading 轉譯表存在（英文 key 只作為 mapping key，非顯示文案）
    expect(homeSource).toContain('"market overview": "盤勢總覽"');
    expect(homeSource).toContain('"theme summaries": "題材摘要"');
    expect(homeSource).toContain('"company notes": "公司觀察"');
  });

  it("surfaces real AI recommendations on the customer homepage instead of hiding them behind debug pages", () => {
    expect(homeSource).toContain('data-slot="rec-list"');
    expect(homeSource).toContain("/api/home-exact/recommendations");
  });

  it("P0-2 (2026-07-10): homepage AI recommendations use the same v3 canonical source, not the retired legacy engine", () => {
    // reports/product_critique_20260710 P0-2：首頁推薦必須與 /ai-recommendations
    // 同一條 v3 canonical。新載體經 /api/home-exact/recommendations server route
    // 重用 deriveHomeAiRecommendationCards（本身讀 getAiRecommendationsV3）。
    expect(recRouteSource).toContain("deriveHomeAiRecommendationCards");
    expect(homeSource).not.toContain("recommendations/today");
    expect(recRouteSource).not.toContain("recommendations/today");
  });

  it("does not let one slow market-intel source blank the whole homepage intel panel", () => {
    // 新載體：news-top10 與 announcements 各自 fetch、各自 catch，單源失敗
    // 不清空整個 intel 面板。
    expect(homeSource).toContain("news-top10");
    expect(homeSource).toContain("announcements");
    const intelSection = homeSource.slice(homeSource.indexOf("news-top10") - 2000);
    expect(intelSection).toContain("catch");
  });
});
