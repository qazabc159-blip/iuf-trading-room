import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(new URL("./ContLiqPeriod1Panel.tsx", import.meta.url), "utf8");

describe("ContLiqPeriod1Panel benchmark source", () => {
  it("does not request 0050 through the KGI tick whitelist", () => {
    expect(panelSource).not.toContain('fetchLatestPrice("0050")');
    expect(panelSource).toContain("0050 is a benchmark and uses server-side OHLCV close");
    expect(panelSource).toContain("bench0050LatestPrice");
  });
});
