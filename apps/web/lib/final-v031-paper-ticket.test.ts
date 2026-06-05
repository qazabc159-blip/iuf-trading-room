import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ticketHtml = readFileSync(new URL("../public/ui-final-v031/paper_trading_room/index.html", import.meta.url), "utf8");
const liveHydration = readFileSync(new URL("./final-v031-live.ts", import.meta.url), "utf8");
const backendProxy = readFileSync(new URL("../app/api/ui-final-v031/backend/route.ts", import.meta.url), "utf8");
const fautoSimApi = readFileSync(new URL("./fauto-sim-api.ts", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const klineChartSource = readFileSync(new URL("../app/companies/[symbol]/OhlcvCandlestickChart.tsx", import.meta.url), "utf8");
const tradingRoomKlineFrameSource = readFileSync(new URL("../app/final-v031/portfolio/kline-frame/page.tsx", import.meta.url), "utf8");
const companyPageSource = readFileSync(new URL("../app/companies/[symbol]/page.tsx", import.meta.url), "utf8");
const companiesRegistryPageSource = readFileSync(new URL("../app/companies/page.tsx", import.meta.url), "utf8");
const companyBidAskPanelSource = readFileSync(new URL("../app/companies/[symbol]/BidAskPanel.tsx", import.meta.url), "utf8");
const companyTickStreamPanelSource = readFileSync(new URL("../app/companies/[symbol]/LiveTickStreamPanel.tsx", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const apiClientSource = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
const apiOhlcvSource = readFileSync(new URL("../../api/src/companies-ohlcv.ts", import.meta.url), "utf8");
const apiServerSource = readFileSync(new URL("../../api/src/server.ts", import.meta.url), "utf8");
const homePageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

describe("final-v031 paper ticket price gate", () => {
  it("renders company KGI quote panels as closed during off-hours instead of product-broken blocked", () => {
    expect(companyBidAskPanelSource).toContain('| { status: "closed"; reason: string }');
    expect(companyTickStreamPanelSource).toContain('| { status: "closed"; reason: string }');
    expect(companyBidAskPanelSource).toContain('| { status: "waiting"; reason: string }');
    expect(companyTickStreamPanelSource).toContain('| { status: "waiting"; reason: string }');
    expect(companyBidAskPanelSource).toContain('setState({ status: "closed", reason: offHoursReason() })');
    expect(companyTickStreamPanelSource).toContain('setState({ status: "closed", reason: offHoursReason() })');
    expect(companyBidAskPanelSource).toContain('setState({ status: "waiting", reason: "KGI 唯讀五檔目前尚未回傳有效委買委賣');
    expect(companyTickStreamPanelSource).toContain('setState({ status: "waiting", reason: "KGI 唯讀逐筆目前尚未回傳有效成交明細');
    expect(companyBidAskPanelSource).toContain('<span className="badge badge-yellow">休市</span>');
    expect(companyTickStreamPanelSource).toContain('<span className="badge badge-yellow">休市</span>');
    expect(companyBidAskPanelSource).toContain('<span className="badge badge-yellow">待回傳</span>');
    expect(companyTickStreamPanelSource).toContain('<span className="badge badge-yellow">待回傳</span>');
    expect(companyBidAskPanelSource).toContain("這不是系統故障");
    expect(companyTickStreamPanelSource).toContain("這不是系統故障");
  });

  it("keeps an invalid paper ticket out of the ready-submit state", () => {
    expect(ticketHtml).toContain("const validTicket=validQty&&validPrice");
    expect(ticketHtml).toContain("submitBtn.disabled=true");
    expect(ticketHtml).toContain("紙上單未就緒");
    expect(ticketHtml).toContain("請輸入有效委託價");
    expect(ticketHtml).toContain("待輸入 <small>NTD</small>");
    expect(ticketHtml).toContain("window.__IUF_TICKET_LOCK_REASON__");
  });

  it("uses customer-facing safety copy in the trading-room shell", () => {
    expect(ticketHtml).toContain("紙上單模式啟用");
    expect(ticketHtml).toContain("正式下單停用");
    expect(ticketHtml).toContain("KGI 唯讀");
    expect(ticketHtml).toContain("模擬帳本隔離");
    expect(ticketHtml).toContain("待授權");
    expect(ticketHtml).toContain("已鎖定");
    expect(ticketHtml).toContain("買進<span class=\"tag\">買方</span>");
    expect(ticketHtml).toContain("賣出<span class=\"tag\">賣方</span>");
    expect(ticketHtml).toContain("<span class=\"sub\">平台模擬</span>");
    expect(liveHydration).toContain("需要 Owner 登入才能預覽 / 送出紙上單");
    expect(liveHydration).toContain("需要 Owner 登入");
    expect(ticketHtml).not.toContain("PAPER MODE ACTIVE");
    expect(ticketHtml).not.toContain("REAL ORDER DISABLED");
    expect(ticketHtml).not.toContain("KGI READ-ONLY");
    expect(ticketHtml).not.toContain("AUTH REQUIRED");
    expect(ticketHtml).not.toContain("LOCKED");
    expect(ticketHtml).not.toContain(">LONG<");
    expect(ticketHtml).not.toContain(">SHORT<");
    expect(ticketHtml).not.toContain("<span class=\"sub\">PAPER</span>");
    expect(liveHydration).not.toContain("KGI READ-ONLY");
    expect(liveHydration).not.toContain("AUTH REQUIRED");
    expect(liveHydration).not.toContain("owner session");
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
    expect(ticketHtml).toContain("contain:size layout paint");
    expect(liveHydration).toContain("const mountedFrameSymbol = frame?.dataset?.symbol || window.__IUF_REAL_KLINE_FRAME_SYMBOL__ || \"\"");
    expect(liveHydration).toContain("!sameSym(mountedFrameSymbol, nextFrameSymbol)");
    expect(middleware).toContain('"/final-v031/portfolio/kline-frame"');
  });

  it("keeps the trading-room K-line iframe stable during live refreshes", () => {
    expect(ticketHtml).not.toContain("nextParams.set('rev',Date.now()");
    expect(ticketHtml).toContain('data-symbol="2330"');
    expect(ticketHtml).toContain("let __realChartSymbol='2330'");
    expect(ticketHtml).toContain("function sameChartSym(left,right)");
    expect(ticketHtml).toContain("const nextSrc=buildRealChartFrameSrc(sym)");
    expect(ticketHtml).toContain("const sameHandoff=!handoffSymbol||sameChartSym(handoffSymbol,selected)");
    expect(ticketHtml).toContain("if(current!==nextSrc){");
    expect(ticketHtml).toContain("if(sym&&!sameChartSym(sym,__realChartSymbol))updateRealChartFrame(sym)");
    expect(ticketHtml).toContain("window.__IUF_REAL_KLINE_FRAME_RELOAD_COUNT__");
    expect(ticketHtml).toContain("window.__IUF_REAL_KLINE_FRAME_SYMBOL__=selected");
    expect(ticketHtml).toContain("frame.setAttribute('src',nextSrc)");
  });

  it("keeps the trading room in a single viewport without hiding tape or ledger", () => {
    expect(ticketHtml).toContain("grid-template-rows:auto minmax(0,1fr) 86px 132px");
    expect(ticketHtml).toContain("width:100vw;");
    expect(ticketHtml).toContain("height:calc(100dvh - 32px);");
    expect(ticketHtml).toContain("body[data-screen-label=\"Trading Room v1\"] .tape");
    expect(ticketHtml).toContain("body[data-screen-label=\"Trading Room v1\"] .ledger");
    expect(ticketHtml).not.toContain("body[data-screen-label=\"Trading Room v1\"] .ledger,\nbody[data-screen-label=\"Trading Room v1\"] .tape");
  });

  it("forces the embedded trading-room K-line frame to fill its viewport", () => {
    expect(tradingRoomKlineFrameSource).toContain("width: 100vw;");
    expect(tradingRoomKlineFrameSource).toContain("position: fixed;");
    expect(tradingRoomKlineFrameSource).toContain("width: 100% !important;");
    expect(tradingRoomKlineFrameSource).toContain("overflow: hidden !important;");
    expect(tradingRoomKlineFrameSource).toContain("scrollbar-width: none !important;");
    expect(tradingRoomKlineFrameSource).toContain("align-self: stretch;");
  });

  it("keeps compact trading-room K-line height inside the frame instead of clipping the readout", () => {
    expect(klineChartSource).toContain("const chartHeight = compactTradingRoom ? 300");
    expect(tradingRoomKlineFrameSource).toContain(".trading-room-kline-host .kline-readout-ribbon");
    expect(tradingRoomKlineFrameSource).toContain("position: static !important;");
    expect(tradingRoomKlineFrameSource).toContain("flex: 1 1 0 !important;");
    expect(tradingRoomKlineFrameSource).toContain("min-height: 0 !important;");
  });

  it("keeps the company-page K-line readout out of the chart canvas", () => {
    expect(globalCss).toContain(".company-workbench-shell .kline-price-ribbon");
    expect(globalCss).toContain("position: static;");
    expect(globalCss).toContain("grid-template-columns: max-content max-content max-content minmax(0, 1fr);");
    expect(globalCss).toContain(".company-workbench-shell .kline-chart-canvas");
    expect(globalCss).toContain("order: 2;");
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

  it("fetches enough real K-line history instead of accepting a tiny partial cache", () => {
    expect(apiOhlcvSource).toContain("const MIN_DAILY_BARS_BEFORE_FINMIND_BACKFILL = 720");
    expect(apiOhlcvSource).toContain("const MIN_DAILY_BARS_FOR_LONG_WINDOW = 180");
    expect(apiOhlcvSource).toContain("const FINMIND_DAILY_CHUNK_DAYS = 730");
    expect(apiOhlcvSource).toContain("const FINMIND_DAILY_PERSIST_CHUNK_SIZE = 500");
    expect(apiOhlcvSource).toContain("const MAX_DAILY_BARS_QUERY_LIMIT = 2500");
    expect(apiOhlcvSource).toContain("const DEFAULT_DAILY_BACKFILL_DAYS = 3650");
    expect(apiOhlcvSource).toContain("function isLongDailyWindow");
    expect(apiOhlcvSource).toContain("function isOfficialTaiwanOhlcvRequest");
    expect(apiOhlcvSource).toContain("function needsOwnedDepthBackfill");
    expect(apiOhlcvSource).toContain("function getFinMindDailyBarsForRequest");
    expect(apiOhlcvSource).toContain("finMindDailyChunks(startDate, endDate)");
    expect(apiOhlcvSource).toContain("hasEnoughDailyDepthForRequest(finmindBars, params)");
    expect(apiOhlcvSource).toContain("if (shouldTryFinMind) return []");
    expect(apiOhlcvSource).toContain("cachedNeedsOwnedBackfill");
    expect(apiOhlcvSource).toContain("!cachedNeedsOwnedBackfill");
    expect(apiOhlcvSource).toContain("function persistFinMindDailyBarsSoon");
    expect(apiOhlcvSource).toContain("persistFinMindDailyBarsSoon(companyId, session.workspace.id, finmindBars)");
    expect(apiOhlcvSource).toContain(".onConflictDoUpdate");
    expect(apiOhlcvSource).toContain("source: \"tej\" as const");
    expect(apiOhlcvSource).toContain(".limit(MAX_DAILY_BARS_QUERY_LIMIT)");
    expect(apiOhlcvSource).toContain("nDaysAgoIso(DEFAULT_DAILY_BACKFILL_DAYS)");
    expect(liveHydration).toContain("TRADING_ROOM_OHLCV_LOOKBACK_YEARS = 10");
    expect(liveHydration).toContain('from: tradingRoomOhlcvFromDate()');
    expect(liveHydration).toContain('"/ohlcv?interval=1d&from=" + encodeURIComponent(ohlcvFromParam)');
    expect(tradingRoomKlineFrameSource).toContain("from.setFullYear(from.getFullYear() - 10)");
    expect(tradingRoomKlineFrameSource).toContain("getCompanyKBar(company.id, requestedKbarDate, { days: 20 })");
    expect(companyPageSource).toContain("from.setFullYear(from.getFullYear() - 10)");
  });

  it("refuses shallow cached weekly/monthly K-lines even when FinMind token state changes", () => {
    expect(apiOhlcvSource).toContain("needsOwnedDepthBackfill(cached, params, interval)");
    expect(apiOhlcvSource).toContain("isDerivedInterval(interval) && isOfficialTaiwanOhlcvRequest(params, interval)");
    expect(apiOhlcvSource).not.toContain("isDerivedInterval(interval) && shouldTryFinMind");
    expect(apiOhlcvSource).toContain("deriveOfficialBarsFromDaily(companyId, session.workspace.id, params, interval)");
    expect(apiOhlcvSource).toMatch(/interval === "1d" &&\s+isOfficialTaiwanOhlcvRequest\(params, interval\)/);
  });

  it("keeps owner OHLCV backfill able to target product-visible symbols", () => {
    const finmindFullIngestSource = readFileSync(
      new URL("../../api/src/jobs/finmind-full-ingest.ts", import.meta.url),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(apiServerSource).toContain('symbols?: ["2330", "6202"]');
    expect(apiServerSource).toContain("symbols: z.array(z.string().regex(/^\\d{4}$/)).min(1).max(80).optional()");
    expect(apiServerSource).toContain("invalid_symbols_dataset");
    expect(apiServerSource).toContain("symbols: body.symbols");
    expect(finmindFullIngestSource).toContain("symbols?: string[]");
    expect(finmindFullIngestSource).toContain("const requestedSymbols = Array.from");
    expect(finmindFullIngestSource).toContain('symbols=${requestedSymbols.length > 0 ? requestedSymbols.join(",") : "auto"}');
    expect(finmindFullIngestSource).toContain("requestedSymbols");
    expect(finmindFullIngestSource).toContain("allOhlcvTickers.find((row) => row.ticker === symbol)");
  });

  it("loads the company registry from the lightweight real company pool before the full-list fallback", () => {
    expect(apiServerSource).toContain('app.get("/api/v1/companies/lite"');
    expect(apiServerSource).toContain("getCompaniesLiteCached(c.get(\"repo\"), workspaceSlug)");
    expect(apiClientSource).toContain("export async function getCompaniesLite");
    expect(apiClientSource).toContain("/api/v1/companies/lite");
    expect(companiesRegistryPageSource).toContain("getCompaniesLite({ limit: 2500 })");
    expect(companiesRegistryPageSource).toContain("const response = await getCompanies();");
    expect(companiesRegistryPageSource.indexOf("getCompaniesLite({ limit: 2500 })")).toBeLessThan(
      companiesRegistryPageSource.indexOf("const response = await getCompanies();"),
    );
  });

  it("does not replace the trading-room chart with a sparse-data card while backfill runs", () => {
    expect(klineChartSource).not.toContain("|| insufficientTrend) return");
    expect(klineChartSource).toContain("data-testid=\"kline-backfill-warning\"");
    expect(klineChartSource).toContain("renderInsufficientAsCard && insufficientTrend");
    expect(klineChartSource).toContain("tradingRoomSparseDerivedInterval");
    expect(klineChartSource).toContain("const renderInsufficientAsCard = tradingRoomDailyDepthShort || tradingRoomSparseDerivedInterval");
    expect(klineChartSource).toContain('compactTradingRoom &&');
    expect(klineChartSource).toContain('interval !== "1d"');
    expect(klineChartSource).toContain("chartBars.length < MIN_TREND_BARS");
    expect(klineChartSource).toContain('setInterval("1d")');
    expect(klineChartSource).toContain('setRange("all")');
    expect(klineChartSource).not.toContain("chartBars.length < MIN_TREND_BARS &&\n      effectiveBars.length >= MIN_TREND_BARS");
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
    expect(liveHydration).toContain('String(left || "").trim().toUpperCase()');
    expect(liveHydration).toContain("const seededSymbol = String(paperPrefill()?.symbol || live.selected?.symbol || \"2330\").trim().toUpperCase()");
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
    expect(liveHydration).not.toMatch(/[�-]/u);
    expect(liveHydration).toContain(".concat(defaultWatchlist)");
    expect(liveHydration).toContain("sameSym(other.symbol, item.symbol)");
    expect(liveHydration).toContain('if (typeof window.pickRow === "function")');
    expect(liveHydration).toContain("window.pickRow(sym)");
  });

  it("keeps the embedded trading room locked to one viewport", () => {
    const routeSource = readFileSync(new URL("../app/api/ui-final-v031/[screen]/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(routeSource).toContain("height: 100dvh !important;");
    expect(routeSource).toContain("overflow: hidden !important;");
    expect(routeSource).toContain("scrollbar-width: none !important;");
    expect(routeSource).toContain("grid-template-columns: clamp(220px, 13.5vw, 252px) minmax(0, 1fr) clamp(344px, 20.5vw, 392px) !important;");
    expect(routeSource).toContain(".rpane,\n  .rpane *");
    expect(routeSource).toContain("overflow-y: hidden !important;");
    expect(routeSource).toContain("height: 32px;");
    expect(routeSource).toContain("overflow: hidden;");
    expect(routeSource).toContain("height: calc(100dvh - 32px) !important;");
    expect(ticketHtml).toContain("overflow:hidden;");
    expect(ticketHtml).toContain("grid-template-columns:clamp(220px,13.5vw,252px) minmax(0,1fr) clamp(344px,20.5vw,392px);");
    expect(ticketHtml).toContain("gap:6px;");
  });

  it("isolates the trading room from the app chrome and native scrollbars", () => {
    const frameSource = readFileSync(new URL("../components/FinalOnlyFrame.tsx", import.meta.url), "utf8");
    expect(frameSource).toContain('data-final-screen={isTradingRoom ? "paper-trading-room" : "final-v031"}');
    expect(frameSource).toContain('position: fixed;');
    expect(frameSource).toContain('z-index: 2147483000;');
    expect(frameSource).toContain('left: 252px;');
    expect(frameSource).toContain('width: calc(100vw - 252px);');
    expect(frameSource).toContain('max-width: calc(100vw - 252px);');
    expect(frameSource).toContain('body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .header-dock');
    expect(frameSource).toContain('body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .app-sidebar {');
    expect(frameSource).toContain('z-index: 2147483001 !important;');
    expect(frameSource).not.toContain('body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .app-sidebar,\n        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .source-badge');
    expect(frameSource).toContain('body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .command-palette');
    expect(ticketHtml).toContain("scrollbar-width:none;");
    expect(ticketHtml).toContain("contain:size layout paint;");
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
    expect(liveHydration).toContain("function shouldFetchRawKgiQuoteSnapshot");
    expect(liveHydration).toContain("function shouldFetchRawKgiQuote(quote)");
    expect(liveHydration).toContain("function fetchRawKgiQuoteExtras(symbol, quote)");
    expect(liveHydration).toContain('source === "kgi-gateway"');
    expect(liveHydration).toContain("rawQuoteExtras.skipped");
    expect(liveHydration).toContain("/api/v1/kgi/quote/bidask?symbol=");
    expect(liveHydration).toContain("/api/v1/kgi/quote/ticks?symbol=");
    expect(liveHydration).toContain("setInterval(refreshPaperQuotePulse, 3000)");
    expect(liveHydration).toContain("window.__IUF_FINAL_V031_QUOTE_PULSE_STARTED__");
    expect(liveHydration).toContain("paperQuotePulseBlockedUntil = Date.now() + 15000");
    expect(liveHydration).toContain("window.__IUF_FINAL_V031_QUOTE_PULSE_ERROR__");
    expect(liveHydration).toContain("if (!sameSym(symbol, paperPulseSymbol())) return;");
    expect(liveHydration).not.toContain("refreshPaperQuotePulse();\n    window.updateRealChartFrame");
  });

  it("keeps trading-room OHLC and change math tied to quote semantics instead of reusing last price as open", () => {
    expect(liveHydration).toContain("function resolveTradingRoomQuoteSnapshot");
    expect(liveHydration).toContain("function resolvePaperQuoteSnapshot");
    expect(liveHydration).toContain("quote?.prevClose");
    expect(liveHydration).toContain("quote?.previousClose");
    expect(liveHydration).toContain("quote?.referencePrice");
    expect(liveHydration).toContain("open: firstFiniteNumber(quote?.open, lastBar?.open, lastPrice)");
    expect(liveHydration).toContain("open: firstNum(quote?.open, lastBar?.open, lastPrice)");
    expect(liveHydration).toContain("open: quoteSnapshot.open");
    expect(liveHydration).toContain("const changePct = quoteSnapshot.changePct");
    expect(liveHydration).not.toContain("open: quote?.lastPrice ?? lastBar?.open");
    expect(liveHydration).not.toContain("open:quote?.lastPrice ?? lastBar?.open");
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

  it("keeps product K-line quality owned by our database instead of discovering shallow charts in the browser", () => {
    expect(apiServerSource).toContain("/api/v1/diagnostics/kline-depth");
    expect(apiServerSource).toContain("OWNED_DAILY_KLINE_REQUIRED_BARS = 720");
    expect(apiServerSource).toContain("OWNED_DAILY_KLINE_DEEP_BACKFILL_DAYS = 3650");
    expect(apiServerSource).toContain("OWNED_DAILY_KLINE_PRIORITY_TICKERS");
    expect(apiServerSource).toContain('"2330", "6202", "2317", "2454"');
    expect(apiServerSource).toContain("resolveOhlcvDeepBackfillCandidates");
    expect(apiServerSource).toContain("FINMIND_OHLCV_DEEP_BACKFILL_BATCH_SIZE");
    expect(apiServerSource).toContain('schedulerPositiveInt("FINMIND_OHLCV_DEEP_BACKFILL_BATCH_SIZE", 48)');
    expect(apiServerSource).toContain("OWNED_DAILY_KLINE_PRIORITY.get(a.ticker)");
    expect(apiServerSource).toContain("preserveOrder = false");
    expect(apiServerSource).toContain("preserveOrder=${preserveOrder}");
    expect(apiServerSource).toMatch(
      /takeFinMindSchedulerBatch\([\s\S]*"ohlcv-deep-backfill"[\s\S]*schedulerPositiveInt\("FINMIND_OHLCV_DEEP_BACKFILL_BATCH_SIZE", 48\),\s*true\s*\)/
    );
    expect(apiServerSource).toContain("ohlcv-deep-backfill");
    expect(apiServerSource).toContain("COUNT(*) FILTER (WHERE source != 'mock' AND interval = '1d')");
    expect(apiOhlcvSource).toContain("aggregateDailyOhlcvBars");
    expect(apiOhlcvSource).toContain("deriveOfficialBarsFromDaily");
    expect(apiOhlcvSource).toContain("Weekly/monthly are derived from official daily bars instead of mock.");
  });

  it("self-heals shallow trading-room K-line props with a no-store deep refetch", () => {
    expect(klineChartSource).toContain("TRADING_ROOM_PRODUCT_DAILY_BARS = 720");
    expect(klineChartSource).toContain("fetchTradingRoomDeepDailyBars");
    expect(klineChartSource).toContain("tradingRoomDeepOhlcvProxyUrl");
    expect(klineChartSource).toContain("/api/ui-final-v031/backend?path=");
    expect(klineChartSource).toContain("iufDeepBackfill");
    expect(klineChartSource).toContain('cache: "no-store"');
    expect(klineChartSource).toContain('"x-iuf-kline-depth": "trading-room-deep-refetch"');
    expect(klineChartSource).toContain("effectiveBars");
    expect(klineChartSource).toContain("effectiveOfficialBars < TRADING_ROOM_PRODUCT_DAILY_BARS");
    expect(klineChartSource).toContain("renderInsufficientAsCard = tradingRoomDailyDepthShort");
  });

  it("keeps the full-market heatmap visible from verified representative tiles when TWSE industry rows are cold", () => {
    expect(homePageSource).toContain("function buildMarketWideRowsFromHeatmap");
    expect(homePageSource).toContain("owned_representative_aggregate");
    expect(homePageSource).toContain("const derivedFullMarketRows = fullMarketRows.length > 0");
    expect(homePageSource).toContain("wideRowsUseRepresentativeAggregate");
    expect(homePageSource).toContain("rows={derivedFullMarketRows}");
    expect(homePageSource).toContain('marketState={derivedFullMarketRows.length > 0 ? "LIVE" : stateFromLoad(realtimeMarket)}');
  });

  it("keeps the homepage TAIEX mini-chart backed by owned intraday index history instead of an empty line", () => {
    expect(apiServerSource).toContain("type OverviewMisIndexBar");
    expect(apiServerSource).toContain("_overviewMisIndexHistory");
    expect(apiServerSource).toContain("function updateOverviewMisIndexHistory");
    expect(apiServerSource).toContain("function mergeOverviewIndexHistory");
    expect(apiServerSource).toContain('key: "TAIEX"');
    expect(apiServerSource).toContain("history: mergeOverviewIndexHistory");
    expect(apiServerSource).not.toContain('history: (enrichedIndex["history"] as unknown[]) ?? []');
  });

  it("shows a formal institutional-data degraded state instead of a blank syncing line", () => {
    expect(liveHydration).toContain("三大法人資料尚未回傳");
    expect(liveHydration).toContain("本頁不顯示假法人買賣超");
    expect(liveHydration).not.toContain("法人買賣超資料同步中</div>");
  });
});
