import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ticketHtml = readFileSync(new URL("../public/ui-final-v031/paper_trading_room/index.html", import.meta.url), "utf8");
const liveHydration = readFileSync(new URL("./final-v031-live.ts", import.meta.url), "utf8");
const backendProxy = readFileSync(new URL("../app/api/ui-final-v031/backend/route.ts", import.meta.url), "utf8");
const fautoSimApi = readFileSync(new URL("./fauto-sim-api.ts", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const klineChartSource = readFileSync(new URL("../app/companies/[symbol]/OhlcvCandlestickChart.tsx", import.meta.url), "utf8");
const tradingRoomKlineFrameSource = readFileSync(new URL("../app/final-v031/portfolio/kline-frame/page.tsx", import.meta.url), "utf8");

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
    expect(liveHydration).toContain("Redraw the legacy SVG chart only when the real company-page K-line frame");
    expect(liveHydration).toContain('if (!realFrameMounted && typeof window.drawChart === "function")');
    expect(liveHydration).not.toContain('if (typeof window.drawChart === "function" && chartBars.length > 0)');
  });

  it("requests verified 5m and 15m OHLCV directly instead of fetching 1m and relabeling it", () => {
    expect(ticketHtml).toContain("const TF_API_INTERVAL_MAP={'5m':'5m','15m':'15m','1d':'1d','1w':'1w'}");
    expect(ticketHtml).toContain("const TF_AGG_MINUTES={}");
    expect(ticketHtml).toContain("TF_DISABLED_REASONS={'1m'");
    expect(ticketHtml).not.toContain("const TF_API_INTERVAL_MAP={'1m':'1m','5m':'1m','15m':'1m','1d':'1d','1w':'1w'}");
  });

  it("uses the real company-page chart frame in the trading room instead of exposing the legacy SVG chart", () => {
    expect(ticketHtml).toContain("chart-panel is-real-chart");
    expect(ticketHtml).toContain('id="real-kline-frame"');
    expect(ticketHtml).toContain('/final-v031/portfolio/kline-frame?symbol=2330');
    expect(ticketHtml).toContain("function updateRealChartFrame(sym)");
    expect(ticketHtml).toContain("syncRealChartFrameFromLocation");
    expect(ticketHtml).toContain("closest('.wrow[data-sym]')");
    expect(ticketHtml).toContain(".chart-panel.is-real-chart .chart-wrap{display:none!important}");
    expect(ticketHtml).toContain('scrolling="no"');
    expect(ticketHtml).toContain("contain:layout paint");
    expect(liveHydration).toContain("const mountedFrameSymbol = frame?.dataset?.symbol || window.__IUF_REAL_KLINE_FRAME_SYMBOL__ || \"\"");
    expect(liveHydration).toContain("!sameSym(mountedFrameSymbol, nextFrameSymbol)");
    expect(middleware).toContain('"/final-v031/portfolio/kline-frame"');
  });

  it("keeps the trading-room K-line iframe stable during live refreshes", () => {
    expect(ticketHtml).not.toContain("nextParams.set('rev',Date.now()");
    expect(ticketHtml).toContain("const nextSrc=buildRealChartFrameSrc(sym)");
    expect(ticketHtml).toContain("if(current!==nextSrc){");
    expect(ticketHtml).toContain("window.__IUF_REAL_KLINE_FRAME_RELOAD_COUNT__");
    expect(ticketHtml).toContain("window.__IUF_REAL_KLINE_FRAME_SYMBOL__=selected");
    expect(ticketHtml).toContain("frame.setAttribute('src',nextSrc)");
  });

  it("keeps the trading room in a single viewport without hiding tape or ledger", () => {
    expect(ticketHtml).toContain("grid-template-rows:auto minmax(0,1fr) 86px 132px");
    expect(ticketHtml).toContain("body[data-screen-label=\"Trading Room v1\"] .tape");
    expect(ticketHtml).toContain("body[data-screen-label=\"Trading Room v1\"] .ledger");
    expect(ticketHtml).not.toContain("body[data-screen-label=\"Trading Room v1\"] .ledger,\nbody[data-screen-label=\"Trading Room v1\"] .tape");
  });

  it("forces the embedded trading-room K-line frame to fill its viewport", () => {
    expect(tradingRoomKlineFrameSource).toContain("width: 100vw;");
    expect(tradingRoomKlineFrameSource).toContain("width: 100% !important;");
    expect(tradingRoomKlineFrameSource).toContain("overflow: hidden !important;");
    expect(tradingRoomKlineFrameSource).toContain("scrollbar-width: none;");
    expect(tradingRoomKlineFrameSource).toContain("align-self: stretch;");
  });

  it("keeps compact trading-room K-line height inside the frame instead of clipping the readout", () => {
    expect(klineChartSource).toContain("const chartHeight = compactTradingRoom ? 300");
    expect(tradingRoomKlineFrameSource).toContain(".trading-room-kline-host .kline-readout-ribbon");
    expect(tradingRoomKlineFrameSource).toContain("position: static !important;");
    expect(tradingRoomKlineFrameSource).toContain("min-height: 260px !important;");
  });

  it("shows a real loading state for the embedded K-line instead of a blank iframe", () => {
    expect(ticketHtml).toContain("real-kline-loading-overlay");
    expect(ticketHtml).toContain("正在載入真實 K 線");
    expect(ticketHtml).toContain("classList.add('is-loaded')");
    expect(tradingRoomKlineFrameSource).toContain("Promise.allSettled");
  });

  it("keeps trading-room K-line controls actionable and data-driven", () => {
    expect(klineChartSource).toContain("handleScroll");
    expect(klineChartSource).toContain("handleScale");
    expect(klineChartSource).toContain("data-testid=\"kline-viewport-tools\"");
    expect(klineChartSource).toContain("zoomLogicalRange(0.72)");
    expect(klineChartSource).toContain("zoomLogicalRange(1.38)");
    expect(klineChartSource).toContain("applyDefaultLatestRange");
    expect(klineChartSource).toContain("fitAllBars");
    expect(klineChartSource).toContain("buildIndicatorSignals");
    expect(klineChartSource).toContain("trading-room-kline-signal-strip");
    expect(klineChartSource).toContain("calcNullableEMA");
    expect(klineChartSource).toContain("chooseVolumePriceLevel");
    expect(tradingRoomKlineFrameSource).toContain(".trading-room-kline-host .kline-toolbar");
    expect(tradingRoomKlineFrameSource).toContain(".trading-room-kline-host .kline-viewport-tools");
    expect(tradingRoomKlineFrameSource).toContain("order: 2;");
    expect(tradingRoomKlineFrameSource).toContain("order: 4;");
  });

  it("does not reload the real K-line frame twice when selecting a watchlist row", () => {
    expect(ticketHtml).not.toContain("document.querySelectorAll('.wrow').forEach(r=>r.addEventListener('click',()=>pickRow(r.dataset.sym)))");
    expect(ticketHtml).toContain("frame.closest('.real-kline-frame-shell')?.classList.remove('is-loaded')");
    expect(ticketHtml).toContain("if(current!==nextSrc){");
    expect(ticketHtml).toContain("window.__IUF_REAL_KLINE_FRAME_RELOAD_COUNT__");
    expect(ticketHtml).toContain("window.__IUF_REAL_KLINE_FRAME_SYMBOL__=selected");
    expect(ticketHtml).toContain("if(row.dataset.iufEnhanced==='1')return;");
    expect(ticketHtml).toContain("if(!document.getElementById('real-kline-frame')&&typeof drawChart==='function')drawChart(sym);");
    expect(liveHydration).toContain('const realFrameMounted = !!document.getElementById("real-kline-frame")');
    expect(liveHydration).toContain('if (!realFrameMounted && typeof window.drawChart === "function")');
    expect(liveHydration).toContain("const mountedFrameSymbol = frame?.dataset?.symbol || window.__IUF_REAL_KLINE_FRAME_SYMBOL__ || \"\"");
    expect(liveHydration).toContain("!sameSym(mountedFrameSymbol, nextFrameSymbol)");
    expect(ticketHtml).not.toContain("pickRow(row.dataset.sym);\n    updateRealChartFrame(row.dataset.sym);");
  });

  it("drops stale trading-room refresh payloads after the user switches symbols", () => {
    expect(liveHydration).toContain("window.__IUF_FINAL_V031_STALE_REFRESH_DROPPED__");
    expect(liveHydration).toContain('live.screen === "paper-trading-room"');
    expect(liveHydration).toContain("!sameSym(next.selected.symbol, currentPaperSymbol)");
    expect(liveHydration).toContain("received: next.selected.symbol");
  });

  it("preserves the user zoom/pan window while toggling trading-room indicators", () => {
    expect(klineChartSource).toContain("viewportRef");
    expect(klineChartSource).toContain("chartViewportKey");
    expect(klineChartSource).toContain("Keep the viewport key stable while live data appends new bars.");
    expect(klineChartSource).toContain("subscribeVisibleLogicalRangeChange");
    expect(klineChartSource).toContain("savedViewport");
    expect(klineChartSource).not.toContain("chart.timeScale().fitContent();\n        if (chartBars.length > 12)");
    expect(klineChartSource).not.toContain("chartBars.length,\n      first?.dt");
  });

  it("keeps trading-room real chart symbol and plan levels synchronized", () => {
    expect(ticketHtml).toContain("function buildRealChartFrameSrc(sym)");
    expect(ticketHtml).toContain("['entry','stop','tp','from_rec','recommendationId','side']");
    expect(ticketHtml).toContain("window.__IUF_SELECT_PAPER_SYMBOL__");
    expect(liveHydration).toContain("window.__IUF_SELECT_PAPER_SYMBOL__ = selectPaperSymbol");
    expect(liveHydration).toContain("sameSym(item.symbol, selected.symbol)?'on':'");
    expect(liveHydration).toContain('sameSym(idea.symbol, selected.symbol) ? " on" : ""');
    expect(liveHydration).not.toContain("wlItems.map((item, i)");
    expect(liveHydration).toContain("prefillMatchesSelected");
    expect(liveHydration).toContain("removeMismatchedPaperPrefill");
    expect(liveHydration).toContain("prefillSymbol && selectedSymbol && prefillSymbol !== selectedSymbol");
    expect(liveHydration).toContain('["entry", "stop", "tp", "from_rec", "recommendationId", "side"]');
    expect(liveHydration).toContain("紙上單預覽");
  });

  it("keeps the trading-room quick-switch watchlist available after live hydration", () => {
    expect(liveHydration).toContain("DEFAULT_TRADING_ROOM_WATCHLIST");
    expect(liveHydration).toContain('symbol:"1514", name:"亞力"');
    expect(liveHydration).toContain('symbol:"2066", name:"世德"');
    expect(liveHydration).toContain(".concat(defaultWatchlist)");
    expect(liveHydration).toContain("sameSym(other.symbol, item.symbol)");
    expect(liveHydration).toContain('if (typeof window.pickRow === "function")');
    expect(liveHydration).toContain("window.pickRow(sym)");
  });

  it("keeps the embedded trading room locked to one viewport", () => {
    const routeSource = readFileSync(new URL("../app/api/ui-final-v031/[screen]/route.ts", import.meta.url), "utf8");
    expect(routeSource).toContain("height: 100dvh !important;");
    expect(routeSource).toContain("overflow: hidden !important;");
    expect(routeSource).toContain("scrollbar-width: none !important;");
    expect(routeSource).toContain("grid-template-columns: clamp(226px, 14vw, 252px) minmax(0, 1fr) clamp(372px, 22vw, 420px) !important;");
    expect(routeSource).toContain(".rpane,\n  .rpane *");
    expect(routeSource).toContain("overflow-y: hidden !important;");
    expect(routeSource).toContain("height: 34px;");
    expect(routeSource).toContain("overflow: hidden;");
    expect(routeSource).toContain("height: calc(100dvh - 34px) !important;");
    expect(ticketHtml).toContain("overflow:hidden;");
    expect(ticketHtml).toContain("grid-template-columns:clamp(226px,14vw,252px) minmax(0,1fr) clamp(372px,22vw,420px);");
    expect(ticketHtml).toContain("gap:8px;");
  });

  it("does not block the trading-room first paint on paper, KGI, and ideas endpoints", () => {
    const routeSource = readFileSync(new URL("../app/api/ui-final-v031/[screen]/route.ts", import.meta.url), "utf8");
    expect(routeSource).toContain('fastPaperShell: screen === "paper-trading-room"');
    expect(liveHydration).toContain("function buildPaperFastShellPayload");
    expect(liveHydration).toContain("fastShell: true");
    expect(liveHydration).toContain("refreshClientLive();");
    expect(liveHydration).toContain("setInterval(refreshClientLive, 15000)");
  });

  it("keeps trading-room price, depth, and tape moving from live quote endpoints without reloading the K-line frame", () => {
    expect(liveHydration).toContain("function refreshPaperQuotePulse()");
    expect(liveHydration).toContain("function applyPaperQuotePulse(nextSelected, bidAsk, ticks)");
    expect(liveHydration).toContain("function updatePaperQuoteQualityBadge(mode, options={})");
    expect(liveHydration).toContain("quote-quality-badge");
    expect(liveHydration).toContain("行情串流 LIVE");
    expect(liveHydration).toContain("行情串流重連中");
    expect(liveHydration).toContain("輪詢備援 LIVE");
    expect(liveHydration).toContain('"/api/v1/companies/" + encodeURIComponent(companyId) + "/quote/realtime"');
    expect(liveHydration).toContain("/api/v1/kgi/quote/bidask?symbol=");
    expect(liveHydration).toContain("/api/v1/kgi/quote/ticks?symbol=");
    expect(liveHydration).toContain("setInterval(refreshPaperQuotePulse, 3000)");
    expect(liveHydration).toContain("window.__IUF_FINAL_V031_QUOTE_PULSE_STARTED__");
    expect(liveHydration).toContain("paperQuotePulseBlockedUntil = Date.now() + 15000");
    expect(liveHydration).toContain("window.__IUF_FINAL_V031_QUOTE_PULSE_ERROR__");
    expect(liveHydration).toContain("if (!sameSym(symbol, paperPulseSymbol())) return;");
    expect(liveHydration).not.toContain("refreshPaperQuotePulse();\n    window.updateRealChartFrame");
  });

  it("draws real volume-price indicators instead of decorative technical labels", () => {
    expect(klineChartSource).toContain("function calcVolumePriceLevels");
    expect(klineChartSource).toContain("量價支撐");
    expect(klineChartSource).toContain("量價壓力");
    expect(klineChartSource).toContain("計畫進場");
    expect(klineChartSource).toContain("計畫停損");
    expect(klineChartSource).toContain("計畫目標");
    expect(klineChartSource).toContain("price: planLevels.entry");
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

  it("wires the final-v031 trading room manual ticket to KGI SIM only", () => {
    expect(ticketHtml).toContain('id="submit-kgi-sim-btn"');
    expect(ticketHtml).toContain("送出 KGI SIM");
    expect(liveHydration).toContain('fetch("/api/ui-final-v031/backend?path=/api/v1/kgi/sim/order"');
    expect(liveHydration).toContain('priceType: orderType === "market" ? "MKT" : undefined');
    expect(liveHydration).toContain("正式實單仍鎖定");
    expect(backendProxy).toContain("^\\/api\\/v1\\/kgi\\/sim\\/order");
  });

  it("routes the F-AUTO owner dashboard through the same-origin backend proxy", () => {
    expect(fautoSimApi).toContain("/api/ui-final-v031/backend?path=${encodeURIComponent(path)}");
    expect(fautoSimApi).toContain("res.status === 401 || res.status === 403");
    expect(backendProxy).toContain("^\\/api\\/v1\\/paper\\/(?:health|fills|orders|portfolio|positions|funds)");
    expect(backendProxy).toContain("^\\/api\\/v1\\/kgi\\/sim\\/(?:positions|orders|balance)");
    expect(backendProxy).toContain("^\\/api\\/v1\\/internal\\/kgi\\/sim\\/daily-smoke-status");
    expect(backendProxy).toContain("^\\/api\\/v1\\/internal\\/s1-sim\\/(?:status|basket|eod-report)");
  });

  it("keeps final-v031 live GET hydration readable when app-domain proxy auth is absent", () => {
    expect(liveHydration).toContain('const apiBaseRaw = String(window.__IUF_FINAL_V031_API_BASE__ || "")');
    expect(liveHydration).toContain('const apiBase = apiBaseRaw.endsWith("/") ? apiBaseRaw.slice(0, -1) : apiBaseRaw');
    expect(liveHydration).toContain('if (method === "GET" && direct && (res.status === 401 || res.status === 403))');
    expect(liveHydration).toContain("return fetch(direct, requestInit)");
  });

  it("keeps browser hydration script free of TypeScript-only parameter annotations", () => {
    expect(liveHydration).not.toMatch(/\([A-Za-z_$][\w$]*:\s*(?:string|number|boolean|unknown|any)\)\s*=>/);
    expect(liveHydration).not.toContain("(message: string)");
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
