import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("ToolCenter admin page product truth", () => {
  it("forces dynamic rendering so admin truth state is not served from stale prerender cache", () => {
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain("export const revalidate = 0");
  });

  it("keeps real read and audit endpoints behind collapsed technical details", () => {
    expect(source).not.toContain("<th>真實資料端點</th>");
    expect(source).toContain("<th>輸入欄位</th>");
    expect(source).toContain("<summary>查看技術細節</summary>");
    expect(source).toContain("資料端點 GET {toolDetailEndpoint(tool.toolKey)}");
    expect(source).toContain("稽核 {TOOL_CALLS_ENDPOINT}");
    expect(source).toContain("toolKey={encodeURIComponent(tool.toolKey)}");
  });

  it("keeps execution scoped to the backend callTool wrapper", () => {
    expect(source).toContain("後端 callTool 包裝層");
    expect(source).toContain("只能由後端受控流程觸發");
    expect(source).toContain("此頁沒有手動執行按鈕");
  });

  it("explains when recent calls are outside the 24h stats window", () => {
    expect(source).toContain("最近一筆工具呼叫是");
    expect(source).toContain("只會出現在下方「近期 50 筆呼叫」");
    expect(source).toContain("不會計入 24h 統計");
  });

  it("renders known tool descriptions in product Chinese instead of raw registry English", () => {
    expect(source).toContain("AI 精選新聞");
    expect(source).toContain("讀取今日 AI 篩選後的重要新聞與情緒判斷");
    expect(source).toContain("反向壓力審核");
    expect(source).not.toContain("Re-runs AI reviewer pipeline");
    expect(source).not.toContain("Returns today top-10 AI-curated news items");
  });
});
