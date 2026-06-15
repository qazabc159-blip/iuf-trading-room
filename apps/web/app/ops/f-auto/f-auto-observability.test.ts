import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(new URL("./FAutoSimPanel.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../../lib/fauto-sim-api.ts", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../../../components/Sidebar.tsx", import.meta.url), "utf8");

describe("F-AUTO S1 product observability", () => {
  it("uses the durable F-AUTO portfolio for positions and funds", () => {
    expect(panelSource).toContain("getFAutoPortfolio");
    expect(panelSource).toContain("portfolioPositionsState");
    expect(panelSource).toContain("portfolioFundsState");
    expect(panelSource).toContain("eodRows.get(position.symbol)");
    expect(panelSource).toContain("eod?.unrealizedPnlTwd");
    expect(panelSource).toContain("不把查不到即時券商資料誤顯示成零持倉");
  });

  it("maps the persisted order share count and Taipei timestamp", () => {
    expect(apiSource).toContain("row.shares");
    expect(apiSource).toContain("row.submitted_at_tst");
    expect(panelSource).toContain("已送出 / 成交待確認");
  });

  it("gives owners a primary navigation entry", () => {
    expect(sidebarSource).toContain("OWNER_NAV");
    expect(sidebarSource).toContain('path: "/ops/f-auto"');
    expect(sidebarSource).toContain("S1 持倉 / 損益");
  });
});
