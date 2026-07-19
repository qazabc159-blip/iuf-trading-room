import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("./[strategyId]/page.tsx", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

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

  // Pete review #1311 round 2（🔴 must-fix）：badge／下一個動作三個渲染點
  // （首頁迷你卡／目錄卡／詳情 Panel）都必須呼叫同一支
  // `deriveStrategyProgress()` 現算，不准各自存靜態欄位或各刻一份推導邏輯
  // ——用原始碼層級的 import/呼叫檢查鎖住這個結構性要求，不是只測純函式。
  it("三個渲染點都從 lib/quant-strategies-content 呼叫 deriveStrategyProgress，沒有各自的靜態 statusBadge/nextAction 或重複推導邏輯", () => {
    for (const source of [pageSource, detailSource, homeSource]) {
      expect(source).toContain("deriveStrategyProgress");
      // `strategy.statusBadge`/`strategy.nextAction` was the old static-field
      // antipattern; `progress.nextAction`/`progress.badge` (the derived
      // result) is fine and expected — only the `strategy.*` receiver is banned.
      expect(source).not.toMatch(/strategy\.statusBadge\b/);
      expect(source).not.toMatch(/strategy\.nextAction\b/);
      expect(source).not.toContain("STAGE_BADGES"); // no local re-implementation of the badge table
    }
  });

  // Pete re-review（🔴）：目錄頁 + 詳情頁都吃了 `todayTaipeiDate()` render-
  // time 依賴（透過 deriveStrategyProgress），兩者都必須宣告
  // `force-dynamic`，否則 Next.js 會把 render 當下的日期烤進靜態/預先渲染
  // 的 HTML，凍結在部署當下那一刻——跟 /ops 頁頭時鐘凍結同一類陷阱。詳情頁
  // 第一輪漏補，這裡用原始碼層級斷言鎖住兩個檔案都要有，不能只靠
  // `next build` 路由表人工核對。
  it("目錄頁與詳情頁都宣告 force-dynamic（吃了 today 現算依賴，不能被凍結成靜態 HTML）", () => {
    for (const source of [pageSource, detailSource]) {
      expect(source).toMatch(/export const dynamic = ["']force-dynamic["'];/);
    }
  });
});
