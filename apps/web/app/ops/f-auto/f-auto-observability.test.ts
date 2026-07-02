import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(new URL("./FAutoSimPanel.tsx", import.meta.url), "utf8");
const connSource = readFileSync(new URL("./KgiConnectionLight.tsx", import.meta.url), "utf8");
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
    expect(apiSource).toContain("KgiSimOrdersResult");
    expect(apiSource).toContain("normalizedReconciliation");
    expect(panelSource).toContain("已送出 / 成交待確認");
    expect(panelSource).toContain("券商回報");
    expect(panelSource).toContain("成交確認");
    expect(panelSource).toContain("等待券商回報");
    expect(panelSource).toContain("closureStateLabel");
  });

  it("normalizes daily smoke diagnostics into actionable product copy", () => {
    expect(apiSource).toContain("entry.overallStatus");
    expect(apiSource).toContain("entry.firedAt");
    expect(apiSource).toContain("entry.prodBrokerAuditCount");
    expect(apiSource).toContain("登入成功，但 KGI 行情 token 不可用");
    expect(apiSource).toContain("KGI gateway 無法連線");
    expect(panelSource).toContain('if (status === "partial") return "部分通過"');
    expect(panelSource).toContain('fmtDatetime(entry.date)');
  });

  it("gives owners a primary navigation entry", () => {
    expect(sidebarSource).toContain("OWNER_NAV");
    expect(sidebarSource).toContain('path: "/ops/f-auto"');
    expect(sidebarSource).toContain("S1 持倉 / 損益");
  });

  // ── Auto-refresh polling ───────────────────────────────────────────────────

  it("defines intraday and off-hours poll interval constants", () => {
    // 45s intraday (09:00-13:30 TST session), 5min off-hours
    expect(panelSource).toContain("POLL_INTRADAY_MS = 45_000");
    expect(panelSource).toContain("POLL_OFFHOURS_MS = 5 * 60_000");
  });

  it("uses useAutoRefresh hook to drive all fetches via tick", () => {
    expect(panelSource).toContain("useAutoRefresh");
    expect(panelSource).toContain("const { tick, triggerRefresh, lastRefreshedAt } = useAutoRefresh()");
    // All primary fetches wired to tick
    expect(panelSource).toContain("useFetch(getFAutoPortfolio, tick)");
    expect(panelSource).toContain("useFetch(getKgiSimOrders, tick)");
    expect(panelSource).toContain("useFetch(getDailySmokeHistory, tick)");
    expect(panelSource).toContain("useFetch(getS1SimStatus, tick, false)");
    // EOD and basket effects also depend on tick
    expect(panelSource).toContain("}, [selectedDate, tick]);");
    expect(panelSource).toContain("}, [basketDate, tick]);");
  });

  it("pauses polling when tab is hidden and resumes immediately on visibility restore", () => {
    // visibilitychange listener wired
    expect(panelSource).toContain("visibilitychange");
    expect(panelSource).toContain("document.addEventListener");
    expect(panelSource).toContain("document.removeEventListener");
    // Checks document.hidden before firing refresh
    expect(panelSource).toContain("document.hidden");
    // On visible: immediate refresh then reschedule
    expect(panelSource).toContain("triggerRefresh()");
    expect(panelSource).toContain("scheduleNext()");
    // Timer cleanup on unmount
    expect(panelSource).toContain("clearTimeout");
  });

  it("shows last updated timestamp and manual refresh button", () => {
    // Last refreshed at display
    expect(panelSource).toContain("最後刷新");
    expect(panelSource).toContain("lastRefreshedAt");
    expect(panelSource).toContain("fmtTime(lastRefreshedAt)");
    expect(panelSource).toContain("頁面載入時");
    // Data as_of display
    expect(panelSource).toContain("資料截至");
    expect(panelSource).toContain("dataAsOf");
    // Interval info label
    expect(panelSource).toContain("45 秒自動刷新");
    expect(panelSource).toContain("5 分鐘自動刷新");
    // Manual refresh button
    expect(panelSource).toContain("_fauto-refresh-btn");
    expect(panelSource).toContain("手動重整所有面板");
    expect(panelSource).toContain("onClick={triggerRefresh}");
  });

  it("preserves last good data on poll failure (stale-data guard)", () => {
    // useFetch must keep lastGoodRef and suppress error/loading on background polls
    expect(panelSource).toContain("lastGoodRef");
    expect(panelSource).toContain("hadGoodData");
    expect(panelSource).toContain("silently keep last good data");
    // Same guard in EOD and basket effects
    expect(panelSource).toContain("eodLastGoodRef");
    expect(panelSource).toContain("basketLastGoodRef");
  });

  it("KgiConnectionLight accepts refreshTick prop and re-fetches on tick", () => {
    expect(connSource).toContain("refreshTick");
    expect(connSource).toContain("}, [refreshTick]);");
    // Also has stale-data guard
    expect(connSource).toContain("lastGoodRef");
    expect(connSource).toContain("hadGoodData");
    // Panel passes tick to it
    expect(panelSource).toContain("KgiConnectionLight refreshTick={tick}");
  });

  it("uses isKgiTradingHours to select poll interval", () => {
    expect(panelSource).toContain("isKgiTradingHours");
    expect(panelSource).toContain("POLL_INTRADAY_MS");
    expect(panelSource).toContain("POLL_OFFHOURS_MS");
    // Import from trading hours helper
    expect(panelSource).toContain('from "@/lib/kgi-trading-hours"');
  });

  // ── Display honesty (6/30 breakdown fix) ─────────────────────────────────────

  it("marks unpriced positions with 未計價 badge instead of showing null as zero", () => {
    // The badge appears in SimPositionsPanel for lastPrice == null
    expect(panelSource).toContain("未計價");
    expect(panelSource).toContain("_fauto-unpriced-badge");
    // API layer exposes the new field
    expect(apiSource).toContain("marketValueIsEstimated");
  });

  it("estimates market value from avg_cost when lastPrice is null", () => {
    // portfolioPositionsState must compute cost-estimated market value
    expect(panelSource).toContain("以成本估");
    expect(panelSource).toContain("_fauto-estimated-tag");
    // Logic: avgCost * shares when lastPrice is null
    expect(panelSource).toContain("avgCost * position.shares");
    expect(panelSource).toContain("marketValueIsEstimated");
  });

  it("shows dual-denominator PnL: vs 動用資金 (primary) and vs 本金 (secondary)", () => {
    expect(panelSource).toContain("動用資金");
    expect(panelSource).toContain("vs 動用資金");
    expect(panelSource).toContain("vs 本金");
    expect(panelSource).toContain("pnlVsCostPct");
    expect(panelSource).toContain("pnlVsCapitalPct");
    // costBasis is the denominator for 動用資金
    expect(panelSource).toContain("costBasis");
  });

  it("shows 曝險 (exposure %) and 現金水位 in summary", () => {
    expect(panelSource).toContain("曝險");
    expect(panelSource).toContain("exposurePct");
    expect(panelSource).toContain("現金水位");
  });

  it("shows 持有天數 from positions_date", () => {
    expect(panelSource).toContain("calcHoldingDays");
    expect(panelSource).toContain("holdingDays");
    expect(panelSource).toContain("開倉");
    expect(panelSource).toContain("fmtShortDate");
  });

  it("shows total assets as priced + estimated + cash breakdown", () => {
    expect(panelSource).toContain("totalAssetsEstimated");
    expect(panelSource).toContain("hasUnpricedPositions");
    expect(panelSource).toContain("pricedMV");
    expect(panelSource).toContain("estimatedMV");
    expect(panelSource).toContain("總資產（估）");
    expect(panelSource).toContain("_fauto-summary-breakdown");
  });

  it("surfaces persisted_close_fallback staleness notice in the UI", () => {
    expect(panelSource).toContain("persisted_close_fallback");
    expect(panelSource).toContain("_fauto-summary-staleness");
    expect(panelSource).toContain("hasPersistedFallback");
  });
});
