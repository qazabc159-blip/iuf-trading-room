/**
 * page-p1-home-cluster.test.ts
 * Homepage P1 誠實措辭 regression gate（product_critique_20260710 P1-1/P1-11/P1-12）。
 *
 * 2026-07-14 載體轉移：正式首頁改為「原封搬原稿」靜態頁
 * （public/home-exact/index.html），本檔驗證目標隨之轉移。兩條舊鎖退役並註記：
 * - P1-1（禁裸 GET endpoint）：原稿設計「一模一樣」鐵律（楊董 2026-07-13 欽定）
 *   自帶 sfoot 來源標註「來源 GET /api/v1/ai-recommendations/v3」——那是蓄意的
 *   來源憑證行，非工程語意洩漏，verbatim 鐵律優先，該鎖對新首頁不適用。
 * - P1-12（ticker 不冒充公司名）：新載體排行渲染為 `item.name || item.market`
 *   fallback 鏈，尚無 name!==symbol 防呆——列 follow-up（Jim，P2），不假綠鎖。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(
  new URL("../public/home-exact/index.html", import.meta.url),
  "utf8",
);

describe("homepage P1 home-cluster fixes (verbatim-artifact carrier)", () => {
  // P1-11：休市時段不得偽裝即時——原稿自帶誠實標記句，鎖住不被改掉。
  it("keeps the honest off-hours close-label disclosure from the artifact", () => {
    expect(homeSource).toContain("休市時段顯示「MM/DD 收盤」誠實標記，非即時價");
    expect(homeSource).toContain('data-slot="idx-source"');
  });

  // P1-11：大盤錨點的日期戳 slot 存在（script 以真資料時間覆寫，非寫死「即時」）。
  it("stamps the index anchor with a data-driven date slot, not a hardcoded live badge", () => {
    expect(homeSource).toContain('data-slot="idx-stamp"');
  });

  // P1-12 意圖保留：排行公司名缺失時不留空殼 —— 新載體以 name→market fallback
  // 呈現，name!==symbol 防呆為列管 follow-up（見檔頭註記）。
  it("renders rankings company names through an explicit fallback chain", () => {
    expect(homeSource).toContain('item.name || item.market');
  });
});
