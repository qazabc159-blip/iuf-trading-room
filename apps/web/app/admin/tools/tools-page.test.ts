import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("ToolCenter admin page product truth", () => {
  it("shows the real read and audit endpoints for each tool", () => {
    expect(source).toContain("真實資料端點");
    expect(source).toContain("GET {toolDetailEndpoint(tool.toolKey)}");
    expect(source).toContain("稽核 {TOOL_CALLS_ENDPOINT}");
    expect(source).toContain("toolKey={encodeURIComponent(tool.toolKey)}");
  });

  it("keeps execution scoped to the backend callTool wrapper", () => {
    expect(source).toContain("後端 callTool 包裝層");
    expect(source).toContain("此頁沒有手動執行按鈕");
  });

  it("renders known tool descriptions in product Chinese instead of raw registry English", () => {
    expect(source).toContain("AI 精選新聞");
    expect(source).toContain("讀取今日 AI 篩選後的重要新聞與情緒判斷");
    expect(source).toContain("反向壓力審核");
    expect(source).not.toContain("Re-runs AI reviewer pipeline");
    expect(source).not.toContain("Returns today top-10 AI-curated news items");
  });
});
