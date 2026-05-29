import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("ToolCenter admin page product truth", () => {
  it("shows the real read and audit endpoints for each tool", () => {
    expect(source).toContain("真實 endpoint");
    expect(source).toContain("GET {toolDetailEndpoint(tool.toolKey)}");
    expect(source).toContain("audit {TOOL_CALLS_ENDPOINT}");
    expect(source).toContain("toolKey={encodeURIComponent(tool.toolKey)}");
  });

  it("keeps execution scoped to the backend callTool wrapper", () => {
    expect(source).toContain("backend callTool wrapper");
    expect(source).toContain("此頁沒有手動執行按鈕");
  });
});
