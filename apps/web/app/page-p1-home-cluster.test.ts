/**
 * page-p1-home-cluster.test.ts
 * Source-grep regression gate for the P1 fixes on the homepage
 * (reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md P1-1/P1-11/P1-12).
 *
 * page.tsx is a Server Component containing JSX, and this repo's vitest
 * config has no React/JSX transform plugin (see
 * app/components/industry-heatmap-representatives.test.ts and
 * app/page-p0-visual-copy.test.ts for the established convention) — a
 * `.test.ts` file cannot `import` it directly, only read its source text.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("homepage P1 home-cluster fixes", () => {
  // P1-11: "市場覆蓋 0 / 1,000" during closed-market hours read as broken.
  it("relabels market coverage as an honest off-hours snapshot instead of a bare 0/N", () => {
    expect(source).toContain("function marketCoverageText");
    expect(source).toContain("freshTotal === 0 && isOffHours");
    expect(source).toContain("休市快照 · ${formatNumber(quoteTotal)} 檔");
    expect(source).toContain("marketCoverageText(market, isKgiGatewayScheduledOff(nowDate))");
  });

  // P1-11: the TAIEX index card's "資料更新中" badge at night implied a stuck
  // refresh, when off-hours staleness is the expected/correct state.
  it("relabels the TAIEX freshness badge for expected off-hours staleness, not a stuck refresh", () => {
    expect(source).toContain('label: stale ? (offHours ? "休市快照" : "資料更新中") : "即時"');
    expect(source).toContain("readMarketIndex(realtimeMarket, market, nowDate)");
  });

  // P1-12: a missing company name in the leaders/rankings table used to fall
  // back to repeating the ticker symbol as if it were the name ("9110 9110").
  // Verified against live prod (2026-07-11): the backend actually sends
  // `name` populated with the symbol itself (not null), so the fix has to
  // compare name-vs-symbol, not just null-check `row.name`.
  it("never repeats the ticker as a fake company name in the rankings table", () => {
    expect(source).toContain("MISSING_COMPANY_NAME_LABEL");
    expect(source).toContain("trimmedName !== row.symbol.trim()");
    expect(source).not.toContain("name: row.name ?? MISSING_COMPANY_NAME_LABEL");
    expect(source).not.toContain("function marketNameFromSymbol");
  });

  // P1-1: raw "GET /api/v1/..." endpoint strings used to print directly into
  // the homepage Market Intel panel footer / empty-state copy.
  it("never prints a raw GET endpoint string in the Market Intel panel", () => {
    expect(source).toContain("humanizeEndpointLabel(source.newsEndpoint)");
    expect(source).toContain("humanizeEndpointLabel(source.announcementsEndpoint)");
    expect(source).not.toContain("`${source.newsEndpoint} ·");
    expect(source).not.toContain("`${source.announcementsEndpoint} 目前沒有");
  });
});
