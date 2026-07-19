import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("./[strategyId]/page.tsx", import.meta.url), "utf8");

const BANNED_PATTERNS: RegExp[] = [
  /approved/i,
  /live-ready/i,
  /alpha confirmed/i,
  /可以跟單/,
  /保證獲利/,
  /已驗證/,
  /前向/,
  /S1\b/,
  /V5-1/,
  /V3-4/,
  /F-AUTO/i,
  /cont_liq_v36/,
];

describe("quant strategies v9.1 fact-sheet page", () => {
  it("目錄頁改為純內容 fact-sheet，不再打後端績效 API", () => {
    expect(pageSource).toContain("QUANT_STRATEGIES_CONTENT");
    expect(pageSource).not.toContain("loadQuantStrategies");
    expect(pageSource).not.toContain("getLabStrategySnapshot");
    expect(pageSource).not.toContain("getTrackRecordNav");
  });

  it("目錄頁與詳情頁都不出現禁字（S1/F-AUTO/前向/保證獲利 等）", () => {
    for (const source of [pageSource, detailSource]) {
      for (const pattern of BANNED_PATTERNS) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("目錄頁保留淨值曲線的「將揭露」誠實空位，不渲染任何績效數字欄位", () => {
    expect(pageSource).toContain("淨值曲線 · 將揭露");
    expect(pageSource).not.toMatch(/netReturnPct|maxDrawdownPct|hitRatePct|realSimReturnPct/);
  });

  it("詳情頁沿用既有 PageFrame QNT- 家族 routing pattern", () => {
    expect(detailSource).toContain('code="QNT-D"');
    expect(detailSource).toContain("getQuantStrategyContent");
  });
});
