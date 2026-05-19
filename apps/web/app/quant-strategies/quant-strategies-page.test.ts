import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("quant strategies score pending state", () => {
  it("does not render missing quant scores as a perpetual loading state", () => {
    expect(pageSource).not.toContain("<strong>讀取中</strong>");
    expect(pageSource).toContain("待正式分數");
    expect(pageSource).toContain("endpoint 未回傳");
  });
});
