/**
 * page-p1-home-cluster.test.ts
 * Homepage P1 誠實措辭 regression gate（product_critique_20260710 P1-1/P1-11/P1-12）。
 *
 * 2026-07-14 載體轉移（第二次）：正式首頁改回 React server component
 * （page.tsx），驗證目標轉回 page.tsx。P1-12（ticker 不冒充公司名）現在有
 * 真的 name!==symbol 防呆（leaderToMover），鎖住不被改掉。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("homepage P1 home-cluster fixes (React server component carrier)", () => {
  // P1-11：休市時段不得偽裝即時——誠實標記句鎖住不被改掉。
  it("keeps the honest off-hours close-label disclosure", () => {
    expect(pageSource).toContain("休市時段顯示「MM/DD 收盤」誠實標記，非即時價");
  });

  // P1-11：大盤錨點的收盤日期戳只在真為收盤快照時渲染，非寫死「即時」。
  it("stamps the index anchor with a data-driven date, not a hardcoded live badge", () => {
    expect(pageSource).toContain('isClosedSnapshot = twii.source === "close" || twii.source === "fallback"');
    expect(pageSource).toContain("indexReady && isClosedSnapshot");
  });

  // P1-12：排行公司名缺失時不得渲染成重複代號（如「9110 9110」），backend 送
  // name=symbol 本身當自己的 fallback，必須跟 symbol 比對，不只查 null。
  it("renders rankings company names through a name!==symbol fallback guard, not a bare name||fallback chain", () => {
    expect(pageSource).toContain("function leaderToMover");
    expect(pageSource).toContain("trimmedName !== row.symbol.trim()");
    expect(pageSource).toContain("MISSING_COMPANY_NAME_LABEL");
  });
});
