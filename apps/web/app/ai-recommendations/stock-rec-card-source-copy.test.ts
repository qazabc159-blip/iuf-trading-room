import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 2026-07-23 (Jim, AI 投研晨報 v2): displaySourceTrail()/displaySource()/
// BUCKET_CONFIG moved out of StockRecCard.tsx into rec-card-shared.ts (plain
// module, no "use client") so the new Server Component newspaper layout
// (MorningBriefLead/MorningBriefStory) can call them directly — a Server
// Component cannot invoke a plain function re-exported from a "use client"
// file, only render it as JSX (caught via a real local render, not just
// code review: "Attempted to call displaySource() from the server but
// displaySource is on the client"). Zero logic changes, same strings.
const sharedSource = readFileSync(new URL("./rec-card-shared.ts", import.meta.url), "utf8");
const cardSource = readFileSync(new URL("./StockRecCard.tsx", import.meta.url), "utf8");

describe("rec-card-shared source copy (displaySourceTrail)", () => {
  it("turns raw backend source trail into customer-facing evidence copy", () => {
    expect(sharedSource).toContain("export function displaySourceTrail");
    expect(sharedSource).toContain("推薦來源：AI 推薦引擎");
    expect(sharedSource).toContain("推薦批次：已讀取今日推薦結果");
    expect(sharedSource).toContain("官方公告：目前無可用新公告");
    expect(sharedSource).toContain("技術/量價：已納入報價與 K 線資料");
    expect(sharedSource).toContain("新聞/題材：已納入市場新聞資料");
    expect(sharedSource).toContain("uniqueParts(parts).join(\"；\")");
  });

  it("StockRecCard.tsx re-exports (not redefines) the shared helpers", () => {
    expect(cardSource).toContain('from "./rec-card-shared"');
    expect(cardSource).not.toContain("export function displaySourceTrail");
    expect(cardSource).toContain("<b>資料依據</b>");
    expect(cardSource).not.toContain("<b>資料路徑</b>");
  });
});

describe("StockRecCard source copy", () => {
  it("does not expose backend/debug wording in the customer recommendation card", () => {
    expect(cardSource).toContain("資料完整度提醒");
    expect(cardSource).toContain("部分 AI 敘事仍在補強");
    expect(cardSource).toContain("搭配部位上限使用");
    expect(cardSource).not.toContain("本卡仍顯示後端回傳內容");
    expect(cardSource).not.toContain("未用前端假資料補齊");
    expect(cardSource).not.toMatch(/<small>[^<]*(fallback|get_company_technical|LLM|rank=|lastPrice)/i);
  });
});
