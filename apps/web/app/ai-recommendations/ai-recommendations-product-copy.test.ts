import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 2026-07-23 (Jim, AI 投研晨報 v2 重設計): 舊版 v1/v2「brain_react」分桶卡片格
// （cleanRecommendationText/formatGateStatus/formatStrategySource/RecommendationCard）
// 正是楊董退件的四不像版式本體，本輪已從 page.tsx 移除，改用
// MorningBriefLead.tsx / MorningBriefStory.tsx 的頭版/內頁版式。這份測試原本
// 釘死那些函式字面存在；換版式後對應函式已不存在，改為驗證新版式同樣不會把
// 原始後端 enum/debug 字串直接渲染出來，且缺欄位時不寫死假樣板文字。
const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const leadSource = readFileSync(new URL("./MorningBriefLead.tsx", import.meta.url), "utf8");
const storySource = readFileSync(new URL("./MorningBriefStory.tsx", import.meta.url), "utf8");
const copySource = readFileSync(new URL("./morning-brief-copy.ts", import.meta.url), "utf8");

describe("AI recommendations (AI 投研晨報 v2) product copy", () => {
  it("all numeric fields go through morning-brief-copy formatters, not raw interpolation", () => {
    for (const source of [leadSource, storySource]) {
      expect(source).toContain("fmtScore(");
      expect(source).toContain("fmtConfidence(");
      expect(source).toContain("fmtPrice(");
      // raw sub-score field interpolated directly (not through fmtScore) would look like {scores.theme_position}
      expect(source).not.toMatch(/\{scores\.[a-zA-Z_]+\}/);
    }
  });

  it("does not leak raw backend status enums (bucket/action/gateStatus) unformatted", () => {
    for (const source of [pageSource, leadSource, storySource]) {
      expect(source).not.toContain("{item.action}");
      expect(source).not.toContain("{item.bucket}");
      expect(source).not.toContain("{rec.quant");
    }
  });

  it("morning-brief-copy never fabricates boilerplate copy for missing fields (returns -- instead)", () => {
    expect(copySource).toContain('return "--"');
    expect(copySource).not.toContain("產業鏈定位資料庫尚無定位");
  });
});
