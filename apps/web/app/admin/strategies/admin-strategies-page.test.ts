import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("admin strategies page copy", () => {
  it("uses readable product language for visible strategy states", () => {
    expect(pageSource).toContain("Quant Lab 策略狀態");
    expect(pageSource).toContain("待楊董複核");
    expect(pageSource).toContain("C04 風險閘未過");
    expect(pageSource).toContain("已撤回說法：不可引用");
    expect(pageSource).toContain("關閉：{item}");
    expect(pageSource).toContain("下一步：");
    expect(pageSource).toContain("對推薦系統影響：");
    expect(pageSource).toContain("查看 {lane.evidenceFiles.length} 份證據檔案");
    expect(pageSource).toContain("<details");
  });

  it("does not expose the old English governance labels in rendered copy", () => {
    expect(pageSource).not.toContain("OWNER-REVIEW PACKET");
    expect(pageSource).not.toContain("BASELINE — C04 BLOCKED");
    expect(pageSource).not.toContain("RESEARCH-PAUSED");
    expect(pageSource).not.toContain("Ground truth: Codex S1 state");
    expect(pageSource).not.toContain("Quant Lab — Strategy Lanes");
    expect(pageSource).not.toContain("disabled · {item}");
    expect(pageSource).not.toContain("Next action:");
    expect(pageSource).not.toContain("Recommendation impact:");
    expect(pageSource).not.toContain("證據檔案（只讀，IUF_QUANT_LAB）");
  });
});
