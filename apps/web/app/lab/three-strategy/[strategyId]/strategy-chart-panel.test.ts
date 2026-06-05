import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chartSource = readFileSync(new URL("./StrategyChartPanel.tsx", import.meta.url), "utf8");

describe("StrategyChartPanel product truth", () => {
  it("does not render mock_for_demo sample trades as a customer-facing trade table", () => {
    expect(chartSource).toContain("function isRealTradeEntry");
    expect(chartSource).toContain("entries.filter(isRealTradeEntry)");
    expect(chartSource).toContain("產品頁不顯示假交易表格");
    expect(chartSource).toContain("已排除 mock_for_demo 示範列");
  });

  it("keeps the table for real strategy snapshot entries only", () => {
    expect(chartSource).toContain("realEntries.map");
    expect(chartSource).toContain("正式交易紀錄");
    expect(chartSource).not.toContain("<div className=\"_chart-note\">\\u4f86\\u6e90 / mock_for_demo");
  });
});
