import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("quant strategies score pending state", () => {
  it("does not render missing quant scores as a perpetual loading state", () => {
    expect(pageSource).not.toContain("<strong>讀取中</strong>");
    expect(pageSource).toContain("待正式分數");
    expect(pageSource).toContain("等待正式資料源");
    expect(pageSource).not.toContain("endpoint 未回傳");
  });

  it("keeps the visible quant strategy page in product language", () => {
    expect(pageSource).toContain("LAB 核准快照");
    expect(pageSource).toContain("主排序候選池");
    expect(pageSource).toContain("20/60 強弱低回撤");
    expect(pageSource).toContain("連續流動性強弱");
    expect(pageSource).toContain("模擬模式 v1");
    expect(pageSource).not.toContain("LAB SANCTIONED SNAPSHOT");
    expect(pageSource).not.toContain("MAIN execution rank buffer");
    expect(pageSource).not.toContain("Continuous liquidity RS");
  });
});
