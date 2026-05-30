import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ticketHtml = readFileSync(new URL("../public/ui-final-v031/paper_trading_room/index.html", import.meta.url), "utf8");
const liveHydration = readFileSync(new URL("./final-v031-live.ts", import.meta.url), "utf8");
const backendProxy = readFileSync(new URL("../app/api/ui-final-v031/backend/route.ts", import.meta.url), "utf8");

describe("final-v031 paper ticket price gate", () => {
  it("keeps an invalid paper ticket out of the ready-submit state", () => {
    expect(ticketHtml).toContain("const validTicket=validQty&&validPrice");
    expect(ticketHtml).toContain("submitBtn.disabled=true");
    expect(ticketHtml).toContain("紙上單未就緒");
    expect(ticketHtml).toContain("請輸入有效委託價");
    expect(ticketHtml).toContain("待輸入 <small>NTD</small>");
    expect(ticketHtml).toContain("window.__IUF_TICKET_LOCK_REASON__");
  });

  it("does not fall back to selected quote for an invalid limit-price submit", () => {
    expect(liveHydration).toContain("const rawPx = Number");
    expect(liveHydration).toContain('const px = orderType === "market" ? selectedPx : rawPx');
    expect(liveHydration).toContain("const invalidPrice = priceRequired");
    expect(liveHydration).toContain('submit.dataset.blocked = "invalid_ticket"');
    expect(liveHydration).toContain("window.__IUF_TICKET_LOCK_REASON__");
  });

  it("localizes selected sector labels before rendering the trading room header", () => {
    expect(liveHydration).toContain("sector: industryLabel(company?.chainPosition");
    expect(liveHydration).toContain("sector:industryLabel(company?.chainPosition");
    expect(liveHydration).toContain('setText(".symhead .meta", industryLabel(selected.sector');
  });

  it("keeps K-line overlays as real toggle controls instead of decorative labels", () => {
    expect(ticketHtml).toContain('type="button" class="tool on" data-layer="ma"');
    expect(ticketHtml).toContain('type="button" class="tool on" data-layer="vwap"');
    expect(ticketHtml).toContain("function syncToolLayers()");
    expect(ticketHtml).toContain("chart.dataset[layer]=isOn?'on':'off'");
  });

  it("does not keep stale trading-room candles when a timeframe has no verified OHLCV", () => {
    expect(ticketHtml).toContain("function renderChartUnavailable(tf,reason)");
    expect(ticketHtml).toContain("NO_INTRADAY_DATA");
    expect(ticketHtml).toContain("技術指標暫停");
    expect(ticketHtml).toContain('.chart-panel[data-chart-state="blocked"] .sr-line');
    expect(ticketHtml).toContain('.chart-panel[data-chart-state="blocked"] .lv-line');
    expect(ticketHtml).toContain("renderChartUnavailable(tf,'K 線端點讀取失敗，已停止沿用舊圖')");
    expect(liveHydration).toContain("drawChart owns the empty/degraded state");
    expect(liveHydration).toContain('if (typeof window.drawChart === "function")');
    expect(liveHydration).not.toContain('if (typeof window.drawChart === "function" && chartBars.length > 0)');
  });

  it("requests verified 5m and 15m OHLCV directly instead of fetching 1m and relabeling it", () => {
    expect(ticketHtml).toContain("const TF_API_INTERVAL_MAP={'5m':'5m','15m':'15m','1d':'1d','1w':'1w'}");
    expect(ticketHtml).toContain("const TF_AGG_MINUTES={}");
    expect(ticketHtml).toContain("TF_DISABLED_REASONS={'1m'");
    expect(ticketHtml).not.toContain("const TF_API_INTERVAL_MAP={'1m':'1m','5m':'1m','15m':'1m','1d':'1d','1w':'1w'}");
  });

  it("surfaces KGI SIM quote auth unavailable instead of vague empty tables", () => {
    expect(liveHydration).toContain("gateway_quote_auth");
    expect(liveHydration).toContain("KGI_QUOTE_AUTH_UNAVAILABLE");
    expect(liveHydration).toContain("KGI SIM 已登入，行情權限未開");
    expect(liveHydration).toContain("KGI_GATEWAY_UNREACHABLE");
    expect(liveHydration).toContain("KGI gateway 連線中斷");
    expect(liveHydration).toContain("KGI gateway 目前連不到");
    expect(liveHydration).toContain("hydrateKgiReadinessNote()");
  });

  it("allows the final-v031 backend proxy to read KGI SIM status", () => {
    expect(liveHydration).toContain('soft(apiGet("/api/v1/kgi/status"))');
    expect(backendProxy).toContain("^\\/api\\/v1\\/kgi\\/status");
  });
  it("uses Taiwan heatmap polarity in the market-intel industry heatmap", () => {
    const marketIntelHtml = readFileSync(new URL("../public/ui-final-v031/market_intel/index.html", import.meta.url), "utf8");
    expect(liveHydration).toContain('? "rgba(230,57,70," + alpha + ")"');
    expect(liveHydration).toContain('? "rgba(46,204,113," + alpha + ")"');
    expect(marketIntelHtml).toContain(".htile .pct.up { color: var(--bad); }");
    expect(marketIntelHtml).toContain(".htile .pct.dn { color: var(--ok); }");
  });

  it("shows a formal institutional-data degraded state instead of a blank syncing line", () => {
    expect(liveHydration).toContain("三大法人資料尚未回傳");
    expect(liveHydration).toContain("本頁不顯示假法人買賣超");
    expect(liveHydration).not.toContain("法人買賣超資料同步中</div>");
  });
});
