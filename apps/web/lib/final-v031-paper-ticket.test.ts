import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ticketHtml = readFileSync(new URL("../public/ui-final-v031/paper_trading_room/index.html", import.meta.url), "utf8");
const tradingCss = readFileSync(new URL("../public/ui-final-v031/paper_trading_room/trading.css", import.meta.url), "utf8");
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
    expect(companyBidAskPanelSource).toContain("這不是系統故障");
    expect(companyTickStreamPanelSource).toContain("這不是系統故障");
  });

  // 2026-07-17: 楊董裁決「空態=整欄位移除，非佔位卡」覆寫先前的「休市/待回傳」小徽章
  // 佔位卡做法（見 feedback_login_company_redesign_rules_2026_07_16）。closed/waiting/
  // blocked 現在一律 return null，不再渲染任何徽章文字 — 鎖住這個方向，防止退回舊佔位卡。
  it("collapses BidAsk/TickStream panels entirely (no placeholder badge) when there is no live data", () => {
    expect(companyBidAskPanelSource).toContain(
      'state.status === "closed" || state.status === "waiting" || state.status === "blocked"'
    );
    expect(companyTickStreamPanelSource).toContain(
      'state.status === "closed" || state.status === "waiting" || state.status === "blocked"'
    );
    expect(companyBidAskPanelSource).not.toContain('<span className="badge badge-yellow">休市</span>');
    expect(companyTickStreamPanelSource).not.toContain('<span className="badge badge-yellow">休市</span>');
    expect(companyBidAskPanelSource).not.toContain('<span className="badge badge-yellow">待回傳</span>');
    expect(companyTickStreamPanelSource).not.toContain('<span className="badge badge-yellow">待回傳</span>');
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
    expect(liveHydration).toContain('symbol: "1514", name: "亞力"');
    expect(liveHydration).toContain('symbol: "2066", name: "世德"');
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
    expect(routeSource).toContain("height: calc(100dvh - 62px) !important;");
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
    // 2026-07-18: header-dock 隱藏規則已從只鎖 paper-trading-room 擴大到不分
    // data-final-screen 值（見 FinalOnlyFrame.tsx 同日註解）——market-intel/
    // desk-exact 用的 final-v031 變體同樣是頂到頂部的 100dvh iframe，沒有留白
    // 給這顆浮動列，會壓住頁面自己的右上角內容（Elva 全產品走查 P1-b）。
    expect(frameSource).toContain('body:has(.iuf-final-content-frame) .header-dock');
    expect(frameSource).toContain('body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .app-sidebar {');
    expect(frameSource).toContain('z-index: 2147483001 !important;');
    expect(frameSource).not.toContain('body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .app-sidebar,\n        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .source-badge');
    expect(frameSource).toContain('body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .source-badge');
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
    expect(liveHydration).toContain("sameSym(live._companyIdSymbol, symbol)");
    expect(liveHydration).toContain('closePaperQuoteStream("symbol_changing")');
    expect(liveHydration).not.toContain("refreshPaperQuotePulse();\n    window.updateRealChartFrame");
  });

  it("keeps watchlist remove controls out of the row symbol-switch capture handler", () => {
    expect(liveHydration).toContain('event.target?.closest?.(".wldel, .wladd")');
    expect(liveHydration).toContain("e.stopImmediatePropagation()");
  });

  it("rehydrates market-intel search, detail drawer, and real theme navigation", () => {
    const marketIntelHtml = readFileSync(new URL("../public/ui-final-v031/market_intel/index.html", import.meta.url), "utf8");
    expect(marketIntelHtml).toContain("window.__IUF_APPLY_MARKET_FILTERS__=applyFeedFilters");
    expect(marketIntelHtml).toContain("window.__IUF_MARKET_FEED_ITEMS__||[]");
    expect(marketIntelHtml).toContain("row.dataset.feedIndex");
    expect(marketIntelHtml).toContain('target="_top" href="/themes"');
    expect(liveHydration).toContain("window.__IUF_MARKET_FEED_ITEMS__ = items");
    expect(liveHydration).toContain("data-feed-index=\"'+i+'\"");
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

  it("wires the final-v031 trading room manual ticket through the unified order endpoint", () => {
    expect(ticketHtml).toContain('id="submit-kgi-sim-btn"');
    // Label updated: "送出 KGI 模擬單" (was "送出 KGI SIM" before broker selector)
    expect(ticketHtml).toContain("送出 KGI 模擬單");
    expect(liveHydration).toContain("正式實單仍鎖定");
    expect(backendProxy).toContain("^\\/api\\/v1\\/trading\\/orders");
  });

  it("converges paper and KGI submit into the single unified order endpoint (統一下單流 D1/D5, 2026-07-09)", () => {
    // Single submit path: both handlers post to the unified endpoint via
    // submitUnifiedOrder(), not the legacy paper-submit action or a direct
    // KGI SIM fetch.
    expect(liveHydration).toContain('const submitUnifiedOrder = async (payload) => {');
    expect(liveHydration).toContain('await apiFetch("/api/v1/trading/orders", { method: "POST"');
    expect(liveHydration).not.toContain('fetch("/api/ui-final-v031-paper/submit"');
    expect(liveHydration).not.toContain('path=/api/v1/kgi/sim/order');
    // Preview stays on the pre-existing endpoint (design §4 PR-3 scope) —
    // only the submit leg moved.
    expect(liveHydration).toContain('apiPost("/api/v1/paper/preview", directPayload)');
    // accountId resolved from GET /uta/accounts (D6 prerequisite), never
    // silently defaulted to paper for a KGI-intended submit.
    expect(liveHydration).toContain('const loadBrokerAccounts = async () => {');
    expect(liveHydration).toContain('apiGet("/api/v1/uta/accounts")');
    expect(liveHydration).toContain('accountIdForBroker("kgi", accounts)');
    expect(liveHydration).toContain('找不到 KGI 模擬帳號，請重新整理後再試');
    // Reason-code vocab (D5) — backend message/error/reason strings never
    // render raw; every branch maps through a Chinese label table.
    expect(liveHydration).toContain('const kgiChannelReasonLabel = (reason) =>');
    expect(liveHydration).toContain('const unifiedBlockedMessage = (data) =>');
    expect(liveHydration).not.toContain('body.message || body.reason || body.error');
    expect(liveHydration).not.toContain('message.slice(0, 80) || activeBrokerCopy.shortName');
  });

  it("broker selector defaults to paper and routes KGI through SIM channel", () => {
    // Paper is the initial default — paper button has active class, KGI does not
    expect(ticketHtml).toContain('class="bbtn active" data-broker="paper"');
    expect(ticketHtml).not.toContain('class="bbtn active" data-broker="kgi"');
    // KGI SIM button is hidden by default (paper selected)
    expect(ticketHtml).toContain('id="submit-kgi-sim-btn"');
    expect(ticketHtml).toContain('style="display:none"');
    // Live hydration wires broker selector with localStorage persistence
    expect(liveHydration).toContain("ACTIVE_BROKER_STORAGE_KEY");
    expect(liveHydration).toContain("iuf-active-broker");
    expect(liveHydration).toContain("activeBrokerKey()");
    expect(liveHydration).toContain("setActiveBroker(");
    expect(liveHydration).toContain("applyBrokerSubmitVisibility()");
    expect(liveHydration).toContain("brokerSubmitCopy(");
    // Paper submit shows for paper broker; KGI submit shows for KGI broker
    expect(liveHydration).toContain("paperBtn.style.display = 'none'");
    expect(liveHydration).toContain("kgiBtn.style.display = 'none'");
    // Dynamic labels use brokerSubmitCopy helper — no more hardcoded "KGI SIM" in labels
    expect(liveHydration).toContain("activeBrokerCopy.shortName");
    expect(liveHydration).toContain("送出模擬訂單");
    expect(liveHydration).toContain("送出 KGI 模擬單");
    // Fubon is always disabled — never selectable
    expect(ticketHtml).toContain('data-broker="fubon" disabled');
    // D6 (2026-07-09): account strip reads GET /uta/accounts (seeded,
    // gatewayStatus-bearing), not the old adapter catalog.
    expect(liveHydration).toContain('apiGet("/api/v1/uta/accounts")');
    expect(liveHydration).not.toContain('apiGet("/api/v1/uta/adapters")');
  });

  it("統一下單流 D6: broker strip is the account strip — gatewayStatus badges + accountId reuse (2026-07-09)", () => {
    // Real, unit-tested badge mapping (see gateway-status-badge.test.ts) is
    // mirrored inline for DOM rendering — same four states, same wording as
    // /settings/broker's trust card.
    expect(liveHydration).toContain("function gatewayBadge(status) {");
    expect(liveHydration).toContain("'reachable'");
    expect(liveHydration).toContain("'pending'");
    expect(liveHydration).toContain("'paired_unreachable'");
    expect(liveHydration).toContain("已連線");
    expect(liveHydration).toContain("等待配對");
    expect(liveHydration).toContain("等待連線");
    expect(liveHydration).toContain("未配對");
    // Badge is sourced from live.accounts (D6), matched by adapterKey per button.
    expect(liveHydration).toContain("const accountsList = Array.isArray(live.accounts) ? live.accounts : [];");
    expect(liveHydration).toContain("accountsList.find((a) => a && a.adapterKey === bk)");
    // Submit-time account lookup reuses the strip's already-fetched accounts
    // instead of a second round-trip.
    expect(liveHydration).toContain("if (Array.isArray(live.accounts) && live.accounts.length) return live.accounts;");
    // Fubon excluded from the account strip's selectable set, same as before.
    expect(liveHydration).toContain("a.adapterKey !== 'fubon'");
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

  it("keeps the homepage heatmap on a two-source fallback chain (kgi-core tiles, twse industry aggregate)", () => {
    // 2026-07-14 載體轉移（第二次）：正式首頁改回 React server component
    // （page.tsx）。等價意圖鎖：熱力圖管線必須同時打 kgi-core（個股磚格）與
    // twse（產業彙總）兩源 fallback，單源冷掉不得讓熱力圖整塊消失。
    expect(homePageSource).toContain("getKgiCoreHeatmap");
    expect(homePageSource).toContain("getTwseMarketHeatmap");
    expect(homePageSource).toContain("function mergeCoreHeatmapWithRepresentativeFeed");
  });

  it("keeps the homepage TAIEX mini-chart backed by owned intraday index history instead of an empty line", () => {
    expect(apiServerSource).toContain("type OverviewMisIndexBar");
    expect(apiServerSource).toContain("_overviewMisIndexHistory");
    expect(apiServerSource).toContain("function updateOverviewMisIndexHistory");
    expect(apiServerSource).toContain("function mergeOverviewIndexHistory");
    expect(apiServerSource).toContain('key: "TAIEX"');
    expect(apiServerSource).toContain("history: mergeOverviewIndexHistory");
    expect(apiServerSource).not.toContain('history: (enrichedIndex["history"] as unknown[]) ?? []');
    // 首頁真的把這份歷史畫成折線圖（IndexHistoryBand 的 .idxhistband 區塊，
    // 2026-07-14 楊董糾正後從 IdxAnchorPanel 移出成 heroband 正下方全寬窄帶），
    // 不是只有後端資料存在但前端沒有消費的死資料。
    expect(homePageSource).toContain("marketContext?.index?.history");
    expect(homePageSource).toContain('className="idxhistband"');
    expect(homePageSource).toContain("function IndexOhlcChart");
  });

  it("guards the paper submit path against a missing accountId, matching the KGI submit guard (Pete review 🟡 #1, 2026-07-09)", () => {
    // Paper ticket resolves accountId the same way KGI does, but previously
    // had no explicit guard — a failed /uta/accounts fetch would silently
    // send accountId:"" into the unified_orders audit trail. Mirror the
    // existing KGI guard shape (blocked label + gate copy + return, no raw
    // engineering text).
    expect(liveHydration).toContain('const accountId = accountIdForBroker("paper", accounts);');
    expect(liveHydration).toContain('找不到模擬帳號，請重新整理後再試');
    const paperAccountIdGuardIndex = liveHydration.indexOf('const accountId = accountIdForBroker("paper", accounts);');
    const paperGuardSlice = liveHydration.slice(paperAccountIdGuardIndex, paperAccountIdGuardIndex + 400);
    expect(paperGuardSlice).toContain('if (!accountId) {');
    expect(paperGuardSlice).toContain('找不到模擬帳號，請重新整理後再試');
    // KGI guard still exists with its own accountId-specific copy, unchanged.
    expect(liveHydration).toContain('accountIdForBroker("kgi", accounts)');
    expect(liveHydration).toContain('找不到 KGI 模擬帳號，請重新整理後再試');
  });

  it("renders a distinct 查詢失敗 badge when GET /uta/accounts itself fails, never mislabeling it as a real unpaired account (Pete review 🟡 #2, 2026-07-09)", () => {
    // Server-side payload builder tracks fetch failure separately from an
    // empty-but-successful accounts list.
    expect(liveHydration).toContain("let accountsFetchFailed = false;");
    expect(liveHydration).toContain("accountsFetchFailed = true;");
    expect(liveHydration).toContain("accountsFetchFailed,");
    // hydrateBrokerStrip only shows the failure badge when there's no
    // matched account AND the fetch is known to have failed — a real
    // gatewayStatus from a successful response always wins.
    expect(liveHydration).toContain("live.accountsFetchFailed");
    expect(liveHydration).toContain("狀態查詢失敗");
    const badgeBlockIndex = liveHydration.indexOf("const badge = account");
    expect(badgeBlockIndex).toBeGreaterThan(-1);
    const badgeBlockSlice = liveHydration.slice(badgeBlockIndex, badgeBlockIndex + 400);
    expect(badgeBlockSlice).toContain("gatewayBadge(account.gatewayStatus)");
    expect(badgeBlockSlice).toContain("live.accountsFetchFailed");
    expect(badgeBlockSlice).toContain("狀態查詢失敗");
  });

  it("shows a formal institutional-data degraded state instead of a blank syncing line", () => {
    expect(liveHydration).toContain("三大法人資料尚未回傳");
    expect(liveHydration).toContain("本頁不顯示假法人買賣超");
    expect(liveHydration).not.toContain("法人買賣超資料同步中</div>");
  });

  it("adds a 委託回報 panel consuming GET /api/v1/uta/orders (統一下單流 D3, 2026-07-10)", () => {
    // New ledger tab + tbody, distinct from the legacy paper-only 委託 tab.
    expect(ticketHtml).toContain('<button class="tb" data-lt="uta-orders">委託回報 <span class="c" id="badge-uta-orders">0</span></button>');
    expect(ticketHtml).toContain('<div class="ltab" data-lt="uta-orders">');
    expect(ticketHtml).toContain('id="uta-orders-body"');
    // Honest empty state, not a blank table — both the SSR placeholder and
    // the client-hydrated no-orders-today fallback.
    expect(ticketHtml).toContain("委託回報載入中…");
    expect(liveHydration).toContain("今日無委託");
    // Server-side initial build fetches the unified order ledger.
    expect(liveHydration).toContain("listUnifiedOrders(20)");
    expect(liveHydration).toContain("isUnifiedOrderFromTaipeiToday");
    // Client-side 15s refresh also fetches it, through the same proxy path
    // already allow-listed for GET /uta/orders.
    expect(liveHydration).toContain('soft(apiGet("/api/v1/uta/orders?limit=20"))');
    expect(backendProxy).toContain("orders)(?:\\?|$)");
    // Four-state honest vocabulary — never render the raw status enum.
    expect(liveHydration).toContain("const UTA_ORDER_STATUS_LABELS = {");
    expect(liveHydration).toContain('pending: "待送出"');
    expect(liveHydration).toContain('submitted: "已受理"');
    expect(liveHydration).toContain('partial_fill: "部分成交"');
    expect(liveHydration).toContain('filled: "已成交"');
    expect(liveHydration).toContain('cancelled: "已撤單"');
    expect(liveHydration).toContain('rejected: "已拒絕"');
    expect(liveHydration).not.toContain("esc(row.status)");
    // Reuses the desk's existing four .st CSS states (pending/filled/
    // cancelled/rejected) instead of inventing new visual states.
    expect(liveHydration).toContain('const utaOrderStatusClass = (status) => status === "filled" ? "filled" : status === "cancelled" ? "cancelled" : status === "rejected" ? "rejected" : "pending";');
    // Channel label distinguishes paper vs KGI SIM rows in the same table.
    expect(liveHydration).toContain('const utaOrderChannelLabel = (adapterKey) =>');
    expect(liveHydration).toContain('"凱基 SIM"');
  });

  it("keeps the 委託回報 table usable at 390px via scoped horizontal scroll, not the general .ltab.on rule", () => {
    const routeSource = readFileSync(new URL("../app/api/ui-final-v031/[screen]/route.ts", import.meta.url), "utf8");
    expect(routeSource).toContain('.ltab[data-lt="uta-orders"] {');
    expect(routeSource).toContain("overflow-x: auto !important;");
    expect(routeSource).toContain('.ltab[data-lt="uta-orders"] table {');
    expect(routeSource).toContain("min-width: 560px !important;");
  });

  it("collapses the duplicated 五檔 depth renderers into one shared renderDepthPanel() (盤口密度 PR-B, 2026-07-10)", () => {
    // Both the 3s quote-pulse path (applyPaperQuotePulse) and the 15s full
    // refresh path (hydratePaper) used to each carry their own near-identical
    // 5-ask/5-bid render block — one of them (hydratePaper's) had a dead
    // "非交易時段" branch immediately overwritten by the very next statement,
    // never actually shown. Collapsed to one definition + two call sites,
    // both routed through the same tick-flash state map.
    const renderFnCount = (liveHydration.match(/function renderDepthPanel\(/g) || []).length;
    expect(renderFnCount).toBe(1);
    expect(liveHydration).toContain("if (bidAsk) renderDepthPanel(bidAsk, selected.price);");
    expect(liveHydration).toContain("renderDepthPanel(live.bidAsk, selected.price);");
    expect(liveHydration).not.toContain("目前為非交易時段，盤口暫不更新");
  });

  it("adds 內外盤比 (buy/sell imbalance) + restrained tick-flash to the depth ladder, reusing existing CRT tokens (盤口密度 PR-B, 2026-07-10)", () => {
    expect(liveHydration).toContain("const totalBidQty = bidsRaw.reduce((sum, [, q]) => sum + Number(q || 0), 0);");
    expect(liveHydration).toContain('const bidSharePct = totalQty > 0 ? Math.round((totalBidQty / totalQty) * 100) : 50;');
    expect(liveHydration).toContain("imb-bid");
    expect(liveHydration).toContain("imb-ask");
    // Tick flash only fires when a level's price actually changed since the
    // last render (restraint) — never an unconditional flash every refresh.
    expect(liveHydration).toContain("const changed = prevPrice != null && Number(prevPrice) !== Number(p);");
    expect(liveHydration).toContain("tick-flash");
    // CSS: reuses existing --ok / --bad / --brand-glow tokens — no new colors.
    expect(tradingCss).toContain(".imb-bar .imb-bid{background:var(--ok)}");
    expect(tradingCss).toContain(".imb-bar .imb-ask{background:var(--bad)}");
    expect(tradingCss).toContain("@keyframes iufDepthTickFlash{0%{background:var(--brand-glow)}100%{background:transparent}}");
    // Respects prefers-reduced-motion — the flash animation is disabled, not
    // just visually toned down.
    expect(tradingCss).toContain("@media (prefers-reduced-motion: reduce){");
    expect(tradingCss).toContain(".tape .row.tick-flash{animation:none}");
  });

  it("tightens 五檔 row density and bounds the ladder in a real scroll container instead of unconstrained overflow (盤口密度 PR-B, 2026-07-10)", () => {
    // Row font/line-height tightened from the pre-PR-B 11.5px/1.3 to 10.5px/1.05.
    expect(tradingCss).toContain("font:500 10.5px/1.05 var(--mono)");
    expect(tradingCss).not.toContain("font:500 11.5px/1.3 var(--mono)");
    // #depth/#tape (.stk) must be a real bounded+scrollable box on desktop —
    // pre-PR-B it had no overflow rule at all, so its content (measured
    // intrinsic height ~234px against a 70-86px slot) silently overflowed
    // past its own box with zero scroll affordance; anything beyond the
    // first ~2.5 rows was hard-clipped mid-row by the ancestor
    // .cpane{overflow:hidden} with no way to reach it.
    expect(tradingCss).toContain("overflow-y:auto;scrollbar-width:none");
    expect(tradingCss).toContain(".tape .stk::-webkit-scrollbar{width:0;height:0}");
    // Mobile fix: .troom becomes flex column on <=767px, breaking the fixed
    // grid-row height chain that .tape .stk's flex:1 1 auto/min-height:0
    // depends on — without a floor this collapsed #depth to 0 height
    // (hidden), a real mobile regression caught by real-browser testing, not
    // just a desktop-only tightening. Fixed with a mobile-scoped min-height
    // floor that doesn't touch the desktop-tight behavior.
    const routeSource = readFileSync(new URL("../app/api/ui-final-v031/[screen]/route.ts", import.meta.url), "utf8");
    expect(routeSource).toContain(".tape .stk {");
    expect(routeSource).toContain("min-height: 70px !important;");
    expect(routeSource).toContain("max-height: 200px !important;");
  });

  it("P0-1 (product critique 2026-07-10): unlocks the capital/ticket section on a fast standalone fetch instead of waiting on the whole desk payload", () => {
    // The slow, symbol-specific waterfall (company → quote → OHLCV → optional
    // KGI bidask/ticks) used to gate the capital section's DOM update even
    // though GET /paper/portfolio itself resolves independently and much
    // faster — verified against prod (~1.3s vs ~7-10s for the full payload).
    expect(liveHydration).toContain("async function fetchCapitalFast()");
    expect(liveHydration).toContain('if (live.screen === "paper-trading-room") fetchCapitalFast();');
    expect(liveHydration).toContain('apiGetRaw("/api/v1/paper/portfolio")');
    // fetchCapitalFast never overwrites data the full refresh already landed.
    const fastFnIndex = liveHydration.indexOf("async function fetchCapitalFast()");
    const fastFnSlice = liveHydration.slice(fastFnIndex, fastFnIndex + 1200);
    expect(fastFnSlice).toContain("if (live.baseCapitalTWD !== null && live.baseCapitalTWD !== undefined) return;");
  });

  it("P0-1: distinguishes a genuine 401/403 on the capital fetch from the ordinary in-flight loading state, instead of always claiming the Owner needs to log in", () => {
    // SSR fastShell payload never claims unauthorized — only a real rejected
    // fetch can set this.
    expect(liveHydration).toContain("baseCapitalUnauthorized: false,");
    expect(liveHydration).toContain("const baseCapitalUnauthorized = !portfolioRawResult.ok");
    expect(liveHydration).toContain('/^api_(?:401|403)$/.test(String(portfolioRawResult.error?.message || ""))');
    // Honest loading copy for the common (not-yet-fetched) case...
    expect(liveHydration).toContain('capitalReady ? n(capitalTWD) : (capitalUnauthorized ? "待授權" : "載入中")');
    expect(liveHydration).toContain("本金資料載入中，請稍候");
    expect(liveHydration).toContain("資料載入中");
    // ...while the genuine-401/403 copy from before this fix is still intact.
    expect(liveHydration).toContain("需要 Owner 登入才能預覽 / 送出紙上單");
    expect(liveHydration).toContain("需要 Owner 登入");
  });

  it("P0-4 (product critique 2026-07-10): only counts netQtyShares>0 rows as a held position, so a fully closed round-trip can't show 持倉市值 0 next to 持有 1 檔", () => {
    // GET /paper/portfolio keeps a row for every symbol ever traded,
    // including ones that net back to 0 shares (avgCostPerShare:null,
    // note:"net_flat_or_short") — those are not a currently-held position.
    expect(liveHydration).toContain("const openPositions = portfolio.filter((pos) => Number(pos.netQtyShares || 0) > 0);");
    expect(liveHydration).toContain('mktValEl.innerHTML = openPositions.length');
    expect(liveHydration).toContain('const posCountEl = $("#summary-poscount"); if (posCountEl) posCountEl.textContent = String(openPositions.length);');
    expect(liveHydration).toContain('const badgePositions = $(\'.lhead .tb[data-lt="positions"] .c\'); if (badgePositions) badgePositions.textContent = String(openPositions.length);');
  });

  it("P0-4: subtracts invested cost from available cash instead of always repeating the static base-capital number", () => {
    // GET /paper/portfolio's summary.baseCapitalTWD is a fixed constant
    // (PAPER_BROKER_INITIAL_CASH) never adjusted for trades — 可用資金 used
    // to render the exact same number as 模擬本金 regardless of how much was
    // tied up in open positions. summary.investedCostTWD (backend-computed,
    // netQtyShares>0 rows only) is threaded through and subtracted.
    expect(liveHydration).toContain("investedCostTWD: null as number | null,");
    expect(liveHydration).toContain("const investedCostTWD = portfolioRawResult.ok ? ((portfolioEnvelope?.summary?.investedCostTWD) ?? null) : null;");
    // #1238 (2026-07-12): backend now returns a FIFO lot-matched, reconciled
    // summary.availableCashTWD directly — preferred when present; the
    // baseCapitalTWD-minus-investedCostTWD expression below survives only as
    // the fallback for a stale cache that hasn't picked up the new field.
    expect(liveHydration).toContain("Number(capitalTWD) - investedCostTWD");
    expect(liveHydration).toContain("availableCashReady ? Number(availableCashFromBackend) : Number(capitalTWD) - investedCostTWD");
    expect(liveHydration).toContain('summaryAvailEl.textContent = capitalReady ? n(availableCashTWD) : "--";');
    expect(liveHydration).toContain("window.__IUF_AVAIL_CASH__ = capitalReady ? availableCashTWD : 0;");
    expect(liveHydration).toContain('pAvail.textContent = capitalReady ? n(availableCashTWD) : "--";');
    // fetchCapitalFast's fast path also carries investedCostTWD, not just
    // baseCapitalTWD, so the fast-unlocked ticket shows correct available
    // cash too, not a stale full-base-capital number.
    expect(liveHydration).toContain("const investedCost = raw?.summary?.investedCostTWD;");
  });

  it("#1238 (2026-07-12): consumes the FIFO lot-matched realizedPnlTwd/unrealizedPnlTwd/availableCashTWD backend fields with a null-safe fallback, never crashing on a stale cache missing them", () => {
    // Type carries the three new fields as optional — a response from before
    // #1238 (or a stale CDN/browser cache) simply omits them, never crashes.
    expect(liveHydration).toContain("availableCashTWD: null as number | null,");
    expect(liveHydration).toContain("realizedPnlTwd: null as number | null,");
    expect(liveHydration).toContain("unrealizedPnlTwd: null as number | null,");
    // clientPaperPayload() (15s refresh) and fetchCapitalFast() (fast path)
    // both extract all three fields from summary.
    expect(liveHydration).toContain("const availableCashTWD = portfolioRawResult.ok ? ((portfolioEnvelope?.summary?.availableCashTWD) ?? null) : null;");
    expect(liveHydration).toContain("const realizedPnlTwd = portfolioRawResult.ok ? ((portfolioEnvelope?.summary?.realizedPnlTwd) ?? null) : null;");
    expect(liveHydration).toContain("const unrealizedPnlTwd = portfolioRawResult.ok ? ((portfolioEnvelope?.summary?.unrealizedPnlTwd) ?? null) : null;");
    expect(liveHydration).toContain("availableCashTWD: numOrNull(raw?.summary?.availableCashTWD),");
    expect(liveHydration).toContain("realizedPnlTwd: numOrNull(raw?.summary?.realizedPnlTwd),");
    expect(liveHydration).toContain("unrealizedPnlTwd: numOrNull(raw?.summary?.unrealizedPnlTwd),");
    // 已實現損益 (#summary-realized, new) renders an honest "—" when the
    // backend field is absent — there is no pre-#1238 client-computable
    // fallback for realized P&L (unlike 可用資金/未實現損益 above), so this
    // must never fabricate a number.
    expect(liveHydration).toContain('const summaryRealizedEl = $("#summary-realized");');
    expect(liveHydration).toContain('summaryRealizedEl.textContent = capitalReady ? "—" : (capitalUnauthorized ? "待授權" : "載入中");');
    // 未實現損益 (#summary-pnl, relabeled from 總損益) prefers the backend
    // FIFO value; the pre-#1238 client-computed mark-to-open-positions
    // estimate survives only as the fallback branch.
    expect(liveHydration).toContain("const unrealizedReady = live.unrealizedPnlTwd !== null && live.unrealizedPnlTwd !== undefined");
    expect(liveHydration).toContain("if (unrealizedReady) {");
    expect(liveHydration).toContain("} else if (openPositions.length) {");
    // Browser hydration script stays plain JS — no TypeScript-only param
    // annotations even in this new helper.
    expect(liveHydration).toContain("const numOrNull = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));");
  });

  it("桌面重排 (2026-07-13): 五檔盤口 moved to rpane above the ticket, 資金摘要 moved to lpane below the watchlist — #depth/#summary-* ids and renderFautoSummary()'s grid lookup preserved", () => {
    // ② depth ladder now lives inside .rpane, directly before the ticket
    // header, not inside the center .tape strip anymore.
    const rpaneIndex = ticketHtml.indexOf('<aside class="rpane">');
    const depthIndex = ticketHtml.indexOf('id="depth"');
    const thIndex = ticketHtml.indexOf('<div class="th">');
    expect(rpaneIndex).toBeGreaterThan(-1);
    expect(depthIndex).toBeGreaterThan(rpaneIndex);
    expect(thIndex).toBeGreaterThan(depthIndex);
    // ⑦ capital summary now lives inside .lpane, after the watchlist groups,
    // still using the exact original inline-styled 2-col grid markup so
    // renderFautoSummary()'s `$("#summary-capital")?.closest("div[style*=
    // 'grid-template-columns']")` lookup in final-v031-live.ts keeps working.
    const lpaneCloseIndex = ticketHtml.indexOf("</aside>");
    const capitalIndex = ticketHtml.indexOf('id="summary-capital"');
    expect(capitalIndex).toBeGreaterThan(-1);
    expect(capitalIndex).toBeLessThan(lpaneCloseIndex);
    expect(ticketHtml).toContain('style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font:500 11.5px/1.4 var(--sans);color:var(--fg-2)"');
    // Only one #depth / one #summary-capital in the whole document — moved,
    // not duplicated.
    expect((ticketHtml.match(/id="depth"/g) || []).length).toBe(1);
    expect((ticketHtml.match(/id="summary-capital"/g) || []).length).toBe(1);
    // Center .tape strip now holds only 最近成交 (recent trades) — depth and
    // capital summary no longer sit inside it as siblings.
    expect(ticketHtml).not.toContain('<div class="h">委買 / 委賣 五檔</div>');
    expect(ticketHtml).toContain('<div class="tape solo">');
  });

  it("桌面重排 (2026-07-13): 已實現/未實現損益分列 — new #summary-realized cell, 未實現損益 label on the existing #summary-pnl id", () => {
    expect(ticketHtml).toContain('id="summary-realized"');
    expect(ticketHtml).toContain(">已實現損益<");
    expect(ticketHtml).toContain(">未實現損益<");
    expect(ticketHtml).not.toContain(">總損益<");
    expect(ticketHtml).toContain('id="summary-pnl"');
  });

  it("桌面重排 (2026-07-13, 楊董修正 a): 張/股單位切換 glued immediately next to the quantity field via .qtyunit, not split into a row2 column with 委託類型", () => {
    // #t-unit and #t-qty now share one .qtyunit flex row inside the same
    // .field — not two separate .field columns in a .field.row2.
    const qtyFieldIndex = ticketHtml.indexOf('<div class="qtyunit">');
    expect(qtyFieldIndex).toBeGreaterThan(-1);
    const qtyIndex = ticketHtml.indexOf('id="t-qty"', qtyFieldIndex);
    const unitIndex = ticketHtml.indexOf('id="t-unit"', qtyFieldIndex);
    expect(qtyIndex).toBeGreaterThan(qtyFieldIndex);
    expect(unitIndex).toBeGreaterThan(qtyIndex);
    // 委託類型 now pairs with 委託價 instead of 單位.
    const otypeIndex = ticketHtml.indexOf('id="t-otype"');
    const priceIndex = ticketHtml.indexOf('id="t-pricewrap"');
    expect(otypeIndex).toBeGreaterThan(-1);
    expect(priceIndex).toBeGreaterThan(otypeIndex);
    expect(unitIndex).toBeGreaterThan(priceIndex);
    // 必填 badge + LOT/SHARE sub-labels for the 1000x risk-critical control.
    expect(ticketHtml).toContain('<span class="unit-req">單位必填</span>');
    expect(ticketHtml).toContain('data-unit="lot" class="on">張 <span class="req">LOT</span>');
    expect(ticketHtml).toContain('data-unit="share">股 <span class="req">SHARE</span>');
    // Hydration's existing units-toggle listener still targets #t-unit by id
    // — zero JS logic change, only the surrounding DOM moved.
    expect(ticketHtml).toContain("document.querySelectorAll('#t-unit button')");
  });

  it("桌面重排 (2026-07-13): 點盤口價位帶入委託價 — depth-click-to-fill delegated listener targets #depth .row .px and writes #t-price", () => {
    expect(ticketHtml).toContain("#depth .row .px");
    expect(ticketHtml).toContain("const priceInput=document.getElementById('t-price')");
    expect(ticketHtml).toContain("priceInput.value=val.toFixed(2)");
    expect(ticketHtml).toContain("if(typeof updPreview==='function')updPreview()");
    // Static hint text next to the ladder, matching the approved mock's
    // "點任一檔價位 帶入委託價" affordance copy.
    expect(ticketHtml).toContain('<div class="depth-hint">點任一檔價位 <b>帶入委託價</b></div>');
  });

  it("桌面重排 (2026-07-13): .cpane row-track height rule (86px) stays scoped to the center 最近成交 strip, not force-applied to the relocated rpane/lpane panels", () => {
    // The pre-existing always-on body[data-screen-label] rule is kept
    // byte-identical (other assertions in this file lock its exact text) —
    // a MORE specific follow-up rule overrides height for the two new
    // locations instead of editing it in place.
    expect(ticketHtml).toContain('body[data-screen-label="Trading Room v1"] .rpane > .tape,');
    expect(ticketHtml).toContain('body[data-screen-label="Trading Room v1"] .lpane > .tape{');
    const routeSource = readFileSync(new URL("../app/api/ui-final-v031/[screen]/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(routeSource).toContain(".cpane > .tape {");
    expect(routeSource).toContain(".rpane > .tape,\n    .lpane > .tape {\n      max-height: 200px !important;\n    }");
    // Units toggle must not be forced to width:100% inside the new .qtyunit
    // row (it would crowd out the adjacent quantity stepper) — a more
    // specific selector wins regardless of source order.
    expect(routeSource).toContain(".tform .field .qtyunit .units {");
    expect(routeSource).toContain("width: auto !important;");
  });

  it("P0-4: tags cost-basis-substituted prices and closed rows in the 模擬庫存 ledger instead of silently presenting them as live/held (mirrors #1149's 未計價/以成本估 pattern)", () => {
    expect(liveHydration).toContain("const priceIsEstimated = isOpen && !isSelected && rowPrice != null;");
    expect(liveHydration).toContain("以成本估");
    expect(liveHydration).toContain("已平倉");
    expect(liveHydration).toContain("部分以成本估");
  });

  it("P1-9 (product critique 2026-07-10): resolves a real name/price for every 自選 row through the same fallback-rich quote endpoint used for the selected symbol, not just the selected one", () => {
    // 2454/4971-style dead rows: price:null/name:item.name||item.symbol was
    // hard-coded for every non-selected watchlist symbol, by construction —
    // never even attempted a fetch.
    expect(liveHydration).toContain("async function resolveWatchlistExtras(symbols, selectedSymbol)");
    expect(liveHydration).toContain('apiGet("/api/v1/companies?ticker=" + encodeURIComponent(sym))');
    expect(liveHydration).toContain('apiGet("/api/v1/companies/" + encodeURIComponent(co.id) + "/quote/realtime")');
    expect(liveHydration).toContain("const watchlistExtras = await resolveWatchlistExtras(myWatchlistSeed.map((item) => item.symbol), selectedSymbol);");
    // Load failures are tagged with an explicit reason, not a silent dash.
    expect(liveHydration).toContain('"自選 · 查無報價"');
    expect(liveHydration).toContain('"自選 · 查無名稱"');
  });

  it("P1-9: decouples 自選 from the slow full clientPaperPayload chain (same fetchCapitalFast pattern) so handoff never shows an empty watchlist context", () => {
    expect(liveHydration).toContain("async function fetchWatchlistFast()");
    expect(liveHydration).toContain('const rows = await apiGet("/api/v1/watchlist");');
    expect(liveHydration).toContain("if (live.screen === \"paper-trading-room\") fetchWatchlistFast();");
    // Fired alongside (right after), not instead of, the full refresh.
    expect(liveHydration).toContain('if (live.screen === "paper-trading-room") fetchCapitalFast();');
    expect(liveHydration).toContain("// P1-9: same decoupling for 自選 — see fetchWatchlistFast() above.");
  });

  it("P1-7 (product critique 2026-07-10): tags F-AUTO holdings/summary strip with an explicit 未經券商回報對帳 disclaimer whenever data_source isn't a live broker gateway read", () => {
    expect(liveHydration).toContain('const brokerConfirmed = live.fauto.data_source === "kgi_gateway";');
    expect(liveHydration).toContain("未經券商回報對帳");
    expect(liveHydration).toContain("const brokerConfirmedSummary = f.data_source === \"kgi_gateway\";");
  });
});
