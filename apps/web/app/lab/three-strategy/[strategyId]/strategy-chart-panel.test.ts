import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chartSource = readFileSync(new URL("./StrategyChartPanel.tsx", import.meta.url), "utf8");
const nonProductionSourceMarker = ["mock", "_for", "_demo"].join("");

describe("StrategyChartPanel product truth", () => {
  it("does not render non-production sample trades as a customer-facing trade table", () => {
    expect(chartSource).toContain("function isRealTradeEntry");
    expect(chartSource).toContain("entries.filter(isRealTradeEntry)");
    expect(chartSource).toContain("產品頁已隱藏非正式示範列");
    expect(chartSource).toContain("已排除非正式示範列");
    expect(chartSource).not.toContain(nonProductionSourceMarker);
    expect(chartSource).not.toContain("假交易");
  });

  it("keeps the table for real strategy snapshot entries only", () => {
    expect(chartSource).toContain("realEntries.map");
    expect(chartSource).toContain("正式交易紀錄");
    expect(chartSource).not.toContain(`來源 / ${nonProductionSourceMarker}`);
  });
});
