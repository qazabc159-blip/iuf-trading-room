import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const strategySource = readFileSync(new URL("./strategy-data.ts", import.meta.url), "utf8");

describe("quant strategies S1-only product surface", () => {
  it("surfaces S1 as the only formal quant strategy", () => {
    expect(pageSource).toContain("S1 F-AUTO");
    expect(pageSource).toContain("目前正式產品只開 S1");
    expect(pageSource).toContain("資金會由後端 S1 runner 讀取");
    expect(pageSource).toContain("loadQuantStrategies");
    expect(strategySource).toContain('id: "cont_liq_v36"');
    expect(strategySource).not.toContain("class5_revenue_momentum");
    expect(strategySource).not.toContain("family_c_sbl_overlay");
  });

  it("keeps the page honest about SIM-only execution", () => {
    expect(pageSource).toContain("SIM-only guard");
    expect(pageSource).toContain("不會開啟真實委託");
    expect(pageSource).toContain("F-AUTO 觀察面板：Owner 後台");
    expect(pageSource).not.toContain('href="/ops/f-auto"');
    expect(pageSource).not.toContain("LAB SANCTIONED SNAPSHOT");
    expect(pageSource).not.toContain("MAIN execution rank buffer");
    expect(pageSource).not.toContain("Continuous liquidity RS");
  });

  it("does not ship hardcoded performance or placeholder holdings", () => {
    expect(strategySource).not.toContain("netReturnPct: 400.89");
    expect(strategySource).not.toContain('symbol: "2330"');
    expect(strategySource).not.toContain("示意：實際 basket");
    expect(strategySource).toContain("hydrateQuantStrategy");
  });
});
