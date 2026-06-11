import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ReactTracePanel.tsx", import.meta.url), "utf8");

describe("ReactTracePanel product copy", () => {
  it("uses customer-facing analysis language instead of tool-call debug copy", () => {
    expect(source).toContain("AI 分析依據");
    expect(source).toContain("資料檢查：");
    expect(source).toContain("第 ${round_current}/${round_max} 輪");
    expect(source).toContain("等待 AI 分析依據回傳");
    expect(source).toContain("已達本次分析上限");
    expect(source).not.toContain("callTool(");
    expect(source).not.toContain("成本上限");
    expect(source).not.toContain("tool call");
    expect(source).not.toContain("v3 推理 trace");
  });
});
