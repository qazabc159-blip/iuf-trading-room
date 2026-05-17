import {
  getCompanyByTicker,
  getCompanyOhlcv,
  getCompanyQuoteRealtime,
  getFinMindStatus,
  getKgiBidAsk,
  getKgiTicks,
  getMarketIntelAnnouncements,
  getMarketInstitutionalSummary,
  getNewsTop10,
  getStrategyIdeas,
  getTwseMarketHeatmap,
  type CompanyAnnouncement,
  type MarketInstitutionalLine,
  type MarketInstitutionalSummary,
  type NewsAiItem,
  type OhlcvBar,
  type TwseIndustryHeatmapTile,
} from "@/lib/api";
import type { StrategyIdeasView } from "@iuf-trading-room/contracts";
import { industryLabel, INDUSTRY_LABEL_MAP } from "@/lib/industry-i18n";
import {
  getKgiPositions,
  getPaperHealth,
  getPaperPortfolioRaw,
  listPaperFills,
  listPaperOrders,
  type KgiPositionsResponse,
  type PaperFillLedgerRow,
  type PaperHealthState,
  type PaperOrderState,
  type PaperPortfolioPosition,
} from "@/lib/paper-orders-api";

export type FinalV031Screen = "market-intel" | "strategy-ideas" | "paper-trading-room";

export type PaperPrefillHandoff = {
  enabled: true;
  symbol: string | null;
  recommendationId: string | null;
  side: "buy" | "sell" | null;
  entry: string | null;
  stop: string | null;
  target: string | null;
  source: "ai_recommendations" | "strategy_home" | "home_paper_preview" | "strategy_run" | "url";
};

type FinalV031PayloadOptions = {
  paperPrefill?: PaperPrefillHandoff | null;
};

type Settled<T> = PromiseSettledResult<T>;

function okValue<T>(result: Settled<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function sourceLabel(source?: string | null) {
  if (!source) return "正式資料";
  if (source.includes("twse")) return "公開資訊";
  if (source.includes("finmind")) return "FinMind";
  if (source.includes("mixed")) return "混合來源";
  return source;
}

function minutesAgoText(dateLike?: string | null) {
  if (!dateLike) return "剛剛";
  const ts = Date.parse(dateLike);
  if (!Number.isFinite(ts)) return "剛剛";
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.round(hours / 24)} 天前`;
}

function inferTopic(text: string) {
  if (/AI|GB200|伺服器|散熱|ASIC|GPU|CoWoS/i.test(text)) return "ai";
  if (/半導體|晶圓|製程|IC|封測|矽|SoC/i.test(text)) return "semi";
  if (/金控|銀行|壽險|金融|利率/i.test(text)) return "fin";
  if (/電動車|車用|EV|汽車/i.test(text)) return "auto";
  return "all";
}

function mapNewsItem(item: NewsAiItem, index: number) {
  const title = item.headline || "市場訊息";
  const tag = item.tags?.[0] ?? item.impact_tier ?? "市場";
  return {
    symbol: item.ticker ?? "大盤",
    name: item.companyName ?? "",
    title,
    source: sourceLabel(item.source),
    tag,
    why: item.why_matters ?? "已列入今日研究清單，需搭配來源狀態與策略想法交叉判讀。",
    age: minutesAgoText(item.date),
    category: inferTopic(`${title} ${tag}`),
    rank: item.rank ?? index + 1,
  };
}

function mapAnnouncement(item: CompanyAnnouncement, index: number) {
  const title = item.title || item.body || "官方重大訊息";
  const tag = item.category || "官方公告";
  return {
    symbol: item.ticker ?? "公告",
    name: item.companyName ?? "",
    title,
    source: sourceLabel(item.source),
    tag,
    why: item.body?.slice(0, 72) || "官方來源已進入今日市場情報，請搭配策略想法做研究判讀。",
    age: minutesAgoText(item.date),
    category: inferTopic(`${title} ${tag}`),
    rank: index + 1,
  };
}

function mapHeatmapTile(tile: TwseIndustryHeatmapTile) {
  const pct = tile.avgChangePct ?? 0;
  const intensity = Math.min(1, Math.abs(pct) / 4);
  const tone = pct > 0.3 ? "up" : pct < -0.3 ? "dn" : "flat";
  return {
    industry: industryLabel(tile.industry),
    rawIndustry: tile.industry,
    avgChangePct: pct,
    gainerCount: tile.gainerCount ?? 0,
    loserCount: tile.loserCount ?? 0,
    stockCount: tile.stockCount ?? 0,
    tone,
    intensity: Math.round(intensity * 100),
    label: (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%",
  };
}

function mapInstitutional(raw: MarketInstitutionalSummary) {
  const institutions = (raw.institutions ?? []) as MarketInstitutionalLine[];
  const foreign = institutions.find((inst) => inst.name?.includes("外")) ?? null;
  const invest = institutions.find((inst) => inst.name?.includes("投信")) ?? null;
  const dealer = institutions.find((inst) => inst.name?.includes("自營")) ?? null;
  return {
    asOf: raw.asOf ?? null,
    state: raw.state ?? "unavailable",
    totalNet: raw.totalNet ?? null,
    foreign: foreign ? { buy: foreign.buy, sell: foreign.sell, net: foreign.net } : null,
    invest: invest ? { buy: invest.buy, sell: invest.sell, net: invest.net } : null,
    dealer: dealer ? { buy: dealer.buy, sell: dealer.sell, net: dealer.net } : null,
    topNetBuy: (raw.topNetBuy ?? []).slice(0, 5),
    topNetSell: (raw.topNetSell ?? []).slice(0, 5),
  };
}

async function buildMarketIntelPayload() {
  const [newsResult, announcementsResult, finMindResult, heatmapResult, institutionalResult] = await Promise.allSettled([
    getNewsTop10(),
    getMarketIntelAnnouncements({ days: 30, limit: 20, scope: "market" }),
    getFinMindStatus(),
    getTwseMarketHeatmap(),
    getMarketInstitutionalSummary(),
  ]);

  const news = newsResult.status === "fulfilled" ? newsResult.value.data : null;
  const announcements = announcementsResult.status === "fulfilled" ? announcementsResult.value.data : null;
  const finMind = finMindResult.status === "fulfilled" ? finMindResult.value.data : null;
  const heatmapRaw = heatmapResult.status === "fulfilled" ? heatmapResult.value : null;
  const institutionalRaw = institutionalResult.status === "fulfilled" ? institutionalResult.value : null;

  const heatmapTiles = (heatmapRaw?.data ?? []).map(mapHeatmapTile);
  const institutional = institutionalRaw ? mapInstitutional(institutionalRaw as MarketInstitutionalSummary) : null;

  const aiItems = news?.items?.map(mapNewsItem) ?? [];
  const announcementItems = announcements?.items?.map(mapAnnouncement) ?? [];
  const items = (aiItems.length ? aiItems : announcementItems).slice(0, 12);
  const topicCounts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1;
    return acc;
  }, {});

  const finMindLive =
    !!finMind &&
    (finMind.state === "LIVE_READY" ||
      finMind.datasets?.some((dataset) => dataset.state === "LIVE"));
  const mopsLive = (announcements?.items?.length ?? 0) > 0 && (announcements?.failures ?? 0) === 0;
  const aiLive = !!news?.items?.length && news.ai_call_success !== false;
  const sourceOkCount = [mopsLive, finMindLive, aiLive].filter(Boolean).length;

  return {
    screen: "market-intel" as const,
    generatedAt: new Date().toISOString(),
    stats: {
      total: Math.max(news?.input_row_count ?? 0, items.length),
      aiSelected: news?.items?.length ?? 0,
      sourceOk: sourceOkCount,
      sourceTotal: 4,
      nextRefresh: news?.next_refresh_at ? minutesAgoText(news.next_refresh_at).replace("前", "後") : "排程中",
    },
    topicCounts: {
      all: items.length,
      ai: topicCounts.ai ?? 0,
      semi: topicCounts.semi ?? 0,
      fin: topicCounts.fin ?? 0,
      auto: topicCounts.auto ?? 0,
    },
    items,
    sources: [
      {
        name: "公開資訊觀測站",
        label: mopsLive ? "官方公告已回傳" : "目前無可呈現公告",
        state: mopsLive ? "ok" : "warn",
        status: mopsLive ? "正常" : "待確認",
        fresh: announcements?.items?.[0]?.date ? minutesAgoText(announcements.items[0].date) : "同步中",
      },
      {
        name: "FinMind 市場資料",
        label: finMindLive ? "市場資料可用" : "資料源同步中",
        state: finMindLive ? "ok" : "warn",
        status: finMindLive ? "正常" : "同步中",
        fresh: finMind?.updatedAt ? minutesAgoText(finMind.updatedAt) : "同步中",
      },
      {
        name: "AI 精選訊息",
        label: news?.selection_mode === "ai" ? "已完成今日篩選" : "使用備援排序",
        state: aiLive ? "ok" : "warn",
        status: aiLive ? "正常" : "備援",
        fresh: news?.as_of ? minutesAgoText(news.as_of) : "同步中",
      },
      {
        name: "主管機關公告",
        label: "資料欄位待人工確認",
        state: "warn",
        status: "待確認",
        fresh: "排程探測",
      },
    ],
    readiness: {
      coverage: Math.min(100, Math.max(0, Math.round((items.length / 12) * 100))),
      freshness: finMindLive || aiLive ? 90 : 45,
      reviewQueue: Math.max(0, announcements?.failures ?? 0),
    },
    heatmap: heatmapTiles,
    institutional,
  };
}

function confidenceText(value: number) {
  if (value >= 0.75) return "高";
  if (value >= 0.55) return "中高";
  if (value >= 0.35) return "中";
  return "低";
}

function qualityPct(item: StrategyIdeasView["items"][number]) {
  if (item.quality.grade === "strategy_ready") return Math.max(80, Math.round(item.confidence * 100));
  if (item.quality.grade === "reference_only") return Math.max(45, Math.round(item.confidence * 85));
  return Math.max(20, Math.round(item.confidence * 70));
}

function decisionClass(decision: string) {
  if (decision === "allow") return "allow";
  if (decision === "review") return "review";
  return "block";
}

function decisionLabel(decision: string) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待確認";
  return "不進流程";
}

function directionLabel(direction: string) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "中性";
}

function mapIdea(item: StrategyIdeasView["items"][number], index: number) {
  const decision = item.marketData.decision;
  const themes = item.topThemes.map((theme) => theme.name).filter(Boolean);
  const pct = qualityPct(item);
  return {
    symbol: item.symbol,
    companyName: item.companyName,
    sector: themes[0] ?? item.market,
    meta: `${item.market} / ${themes[0] ?? "主題待確認"}`,
    decision,
    status: decisionLabel(decision),
    statusClass: decisionClass(decision),
    direction: directionLabel(item.direction),
    score: (item.score / 100).toFixed(2),
    confidence: confidenceText(item.confidence),
    completeness: pct,
    signalCount: item.signalCount,
    latest: minutesAgoText(item.latestSignalAt),
    reason: item.rationale.primaryReason || item.marketData.primaryReason,
    missing: item.quality.primaryReason,
    themes,
    delta: index % 3 === 0 ? "0.06" : index % 3 === 1 ? "0.03" : "0.00",
  };
}

async function buildIdeasPayload() {
  const result = await Promise.allSettled([
    getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 12, sort: "score" }),
  ]);
  const view = result[0].status === "fulfilled" ? result[0].value.data : null;
  const items = view?.items?.map(mapIdea) ?? [];
  const summary = view?.summary ?? {
    total: items.length,
    allow: items.filter((item) => item.decision === "allow").length,
    review: items.filter((item) => item.decision === "review").length,
    block: items.filter((item) => item.decision === "block").length,
    bullish: items.filter((item) => item.direction === "偏多").length,
    bearish: items.filter((item) => item.direction === "偏空").length,
    neutral: items.filter((item) => item.direction === "中性").length,
    quality: { strategyReady: 0, referenceOnly: 0, insufficient: 0, primaryReasons: [] },
  };

  return {
    screen: "strategy-ideas" as const,
    generatedAt: view?.generatedAt ?? new Date().toISOString(),
    summary,
    items,
    selected: items[0] ?? null,
  };
}

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("zh-TW");
}

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value >= 1000 ? value.toLocaleString("zh-TW", { maximumFractionDigits: 1 }) : value.toFixed(2);
}

function latestOhlcv(ohlcv: OhlcvBar[]) {
  return ohlcv.length ? ohlcv[ohlcv.length - 1] : null;
}

function paperPrefillSourceLabel(source: PaperPrefillHandoff["source"]) {
  if (source === "ai_recommendations") return "來源 AI 推薦";
  if (source === "strategy_home") return "來源 首頁策略";
  if (source === "home_paper_preview") return "來源 首頁紙上交易";
  if (source === "strategy_run") return "來源 策略 Run";
  return "來源 URL";
}

function paperPrefillWatchMeta(prefill: PaperPrefillHandoff) {
  const source = paperPrefillSourceLabel(prefill.source);
  return prefill.recommendationId ? `${source} · ${prefill.recommendationId}` : source;
}

function sameSymbol(left: string | null | undefined, right: string | null | undefined) {
  return String(left ?? "").toUpperCase() === String(right ?? "").toUpperCase();
}

async function buildPaperPayload(options: FinalV031PayloadOptions = {}) {
  const [healthResult, portfolioRawResult, fillsResult, ordersResult, kgiResult, ideasResult] = await Promise.allSettled([
    getPaperHealth(),
    getPaperPortfolioRaw(),
    listPaperFills(),
    listPaperOrders(),
    getKgiPositions(),
    getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 8, sort: "score" }),
  ]);

  const health = okValue<PaperHealthState | null>(healthResult, null);
  const portfolioRaw = okValue(portfolioRawResult, { positions: [] as PaperPortfolioPosition[], summary: { baseCapitalTWD: 10_000_000, currency: "TWD", simulated: true, paperMode: true, positionCount: 0, investedCostTWD: 0, note: "" } });
  const portfolio = portfolioRaw.positions;
  const baseCapitalTWD = portfolioRaw.summary.baseCapitalTWD;
  const fills = okValue<PaperFillLedgerRow[]>(fillsResult, []);
  const orders = okValue<PaperOrderState[]>(ordersResult, []);
  const kgi = okValue<KgiPositionsResponse | null>(kgiResult, null);
  const ideas = ideasResult.status === "fulfilled" ? ideasResult.value.data : null;
  const mappedIdeas = ideas?.items?.map(mapIdea) ?? [];
  const prefill = options.paperPrefill ?? null;
  const selectedSymbol = prefill?.symbol ?? portfolio[0]?.symbol ?? mappedIdeas[0]?.symbol ?? "2330";
  const selectedPosition = portfolio.find((pos) => sameSymbol(pos.symbol, selectedSymbol)) ?? null;
  const selectedIdea = mappedIdeas.find((idea) => sameSymbol(idea.symbol, selectedSymbol)) ?? mappedIdeas[0] ?? null;

  const [companyResult, quoteResult, bidAskResult, ticksResult] = await Promise.allSettled([
    getCompanyByTicker(selectedSymbol),
    getCompanyQuoteRealtime(selectedSymbol),
    getKgiBidAsk(selectedSymbol),
    getKgiTicks(selectedSymbol, 16),
  ]);
  const company = okValue(companyResult, null);
  const quote = okValue(quoteResult, null);
  const bidAsk = okValue(bidAskResult, null);
  const ticks = okValue(ticksResult, null);
  const ohlcv = company
    ? await getCompanyOhlcv(company.id, { interval: "1d" }).catch(() => [] as OhlcvBar[])
    : [];
  const lastBar = latestOhlcv(ohlcv);
  const lastPrice = quote?.lastPrice ?? lastBar?.close ?? selectedPosition?.avgCostPerShare ?? null;
  const previous = ohlcv.length > 1 ? ohlcv[ohlcv.length - 2]?.close : null;
  const change = lastPrice != null && previous != null ? lastPrice - previous : null;
  const changePct = change != null && previous ? (change / previous) * 100 : null;

  const watchlist = [
    ...(prefill?.enabled && selectedSymbol ? [{
      symbol: selectedSymbol,
      name: company?.name ?? selectedSymbol,
      meta: paperPrefillWatchMeta(prefill),
      price: lastPrice,
      changePct,
    }] : []),
    ...portfolio.map((pos) => ({
      symbol: pos.symbol,
      name: pos.symbol,
      meta: `${formatMoney(pos.netQtyShares)} 股 · ${pos.fillCount} 筆成交`,
      price: pos.symbol === selectedSymbol ? lastPrice : pos.avgCostPerShare,
      changePct: pos.symbol === selectedSymbol ? changePct : null,
    })),
    ...mappedIdeas.map((idea) => ({
      symbol: idea.symbol,
      name: idea.companyName,
      meta: `${idea.status} · ${idea.signalCount} 訊號`,
      price: null,
      changePct: null,
    })),
  ]
    .filter((item, index, arr) => arr.findIndex((other) => other.symbol === item.symbol) === index)
    .slice(0, 10);

  return {
    screen: "paper-trading-room" as const,
    generatedAt: new Date().toISOString(),
    health,
    baseCapitalTWD,
    selected: {
      symbol: selectedSymbol,
      name: company?.name ?? selectedSymbol,
      sector: company?.chainPosition ?? selectedIdea?.sector ?? "台股",
      price: lastPrice,
      open: quote?.lastPrice ?? lastBar?.open ?? null,
      high: lastBar?.high ?? null,
      low: lastBar?.low ?? null,
      close: lastPrice,
      previous,
      change,
      changePct,
      volume: quote?.volume ?? lastBar?.volume ?? null,
      quoteState: quote?.state ?? "NO_DATA",
    },
    watchlist,
    ideas: mappedIdeas,
    portfolio,
    orders,
    fills,
    kgi,
    ohlcv,
    bidAsk,
    ticks: ticks?.ticks ?? [],
    prefill,
  };
}

export async function buildFinalV031LivePayload(screen: FinalV031Screen, options: FinalV031PayloadOptions = {}) {
  try {
    if (screen === "market-intel") return await buildMarketIntelPayload();
    if (screen === "strategy-ideas") return await buildIdeasPayload();
    return await buildPaperPayload(options);
  } catch (error) {
    return {
      screen,
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "資料載入失敗",
    };
  }
}

function jsonScriptValue(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function finalV031HydrationScript(payload: unknown) {
  const clientApiBase = process.env.NEXT_PUBLIC_API_BASE_URL
    ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
  const workspaceSlug = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

  return `<script data-iuf-final-v031-live>
window.__IUF_FINAL_V031_LIVE__=${jsonScriptValue(payload)};
window.__IUF_FINAL_V031_API_BASE__=${JSON.stringify(clientApiBase)};
window.__IUF_FINAL_V031_API_PROXY__="/api/ui-final-v031/backend?path=";
window.__IUF_FINAL_V031_WORKSPACE_SLUG__=${JSON.stringify(workspaceSlug)};
window.__IUF_FINAL_V031_INDUSTRY_LABELS__=${jsonScriptValue(INDUSTRY_LABEL_MAP)};
(() => {
  let live = window.__IUF_FINAL_V031_LIVE__;
  if (!live || !live.screen) return;
  const apiProxy = window.__IUF_FINAL_V031_API_PROXY__;
  const workspaceSlug = window.__IUF_FINAL_V031_WORKSPACE_SLUG__;
  const industryLabels = window.__IUF_FINAL_V031_INDUSTRY_LABELS__ || {};
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const n = (value, fallback="—") => value === null || value === undefined || Number.isNaN(Number(value)) ? fallback : Number(value).toLocaleString("zh-TW");
  const price = (value) => value === null || value === undefined || Number.isNaN(Number(value)) ? "—" : (Number(value) >= 1000 ? Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 1 }) : Number(value).toFixed(2));
  const cls = (status) => status === "ok" || status === "allow" ? "ok" : status === "block" || status === "bad" ? "bad" : "warn";
  const unwrap = (json) => json && typeof json === "object" && Object.prototype.hasOwnProperty.call(json, "data") ? json.data : json;
  const apiUrl = (path) => apiProxy + encodeURIComponent(path);
  const apiFetch = async (path, init={}) => fetch(apiUrl(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", "x-workspace-slug": workspaceSlug, ...(init.headers || {}) }
  });
  const apiGetRaw = async (path) => {
    const res = await apiFetch(path, {
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "x-workspace-slug": workspaceSlug }
    });
    if (!res.ok) throw new Error("api_" + res.status);
    return await res.json();
  };
  const apiGet = async (path) => {
    return unwrap(await apiGetRaw(path));
  };
  const apiPost = async (path, body) => {
    const res = await apiFetch(path, {
      method: "POST",
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error((json && (json.error || json.message)) || ("api_" + res.status));
    return unwrap(json);
  };
  const soft = (promise) => promise.then((data) => ({ ok:true, data })).catch((error) => ({ ok:false, error }));
  const queryText = (value, max=80) => {
    const text = String(value || "").trim().replace(/[<>]/g, "");
    return text ? text.slice(0, max) : null;
  };
  const paperPrefillSource = (params, recommendationId) => {
    if (recommendationId) return "ai_recommendations";
    if (queryText(params.get("from_strategy"), 40)) return "strategy_home";
    if (queryText(params.get("from_home"), 40)) return "home_paper_preview";
    if (queryText(params.get("from_run"), 40)) return "strategy_run";
    return "url";
  };
  const paperPrefillSourceLabel = (source) => {
    if (source === "ai_recommendations") return "來源 AI 推薦";
    if (source === "strategy_home") return "來源 首頁策略";
    if (source === "home_paper_preview") return "來源 首頁紙上交易";
    if (source === "strategy_run") return "來源 策略 Run";
    return "來源 URL";
  };
  const readPaperPrefillFromUrl = () => {
    if (live.screen !== "paper-trading-room") return null;
    const params = new URLSearchParams(window.location.search);
    const rawSymbol = String(params.get("ticker") || params.get("symbol") || "").trim().toUpperCase();
    const symbol = /^[A-Z0-9._-]{1,16}$/.test(rawSymbol) ? rawSymbol : null;
    const rawRecommendationId = queryText(params.get("from_rec"), 96);
    const invalidAiHandoff = !!rawRecommendationId && !symbol;
    const recommendationId = invalidAiHandoff ? null : rawRecommendationId;
    const entry = invalidAiHandoff ? null : queryText(params.get("entry"), 40);
    const stop = invalidAiHandoff ? null : queryText(params.get("stop"), 40);
    const target = invalidAiHandoff ? null : queryText(params.get("tp"), 40);
    const rawSide = invalidAiHandoff ? "" : String(params.get("side") || "").trim();
    const side = rawSide === "buy" || rawSide === "sell" ? rawSide : null;
    const source = paperPrefillSource(params, recommendationId);
    const prefillEnabled = invalidAiHandoff ? false : params.get("prefill") === "true";
    const enabled = prefillEnabled || !!(symbol || recommendationId || side || entry || stop || target) || source !== "url";
    return enabled ? { enabled:true, symbol, recommendationId, side, entry, stop, target, source } : null;
  };
  const paperPrefill = () => live.prefill || readPaperPrefillFromUrl();
  const industryLabel = (raw) => {
    const key = String(raw || "").trim();
    if (!key) return "未知產業";
    return industryLabels[key] || key;
  };
  const sameSym = (left, right) => String(left || "").toUpperCase() === String(right || "").toUpperCase();
  const firstNumber = (value) => {
    const match = String(value || "").replace(/,/g, "").match(/\\d+(?:\\.\\d+)?/);
    return match ? Number(match[0]) : null;
  };
  const ago = (dateLike) => {
    if (!dateLike) return "剛剛";
    const ts = Date.parse(dateLike);
    if (!Number.isFinite(ts)) return "剛剛";
    const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (minutes < 1) return "剛剛";
    if (minutes < 60) return String(minutes) + " 分鐘前";
    const hours = Math.round(minutes / 60);
    if (hours < 24) return String(hours) + " 小時前";
    return String(Math.round(hours / 24)) + " 天前";
  };
  const sourceName = (source) => {
    const text = String(source || "");
    if (text.includes("finmind")) return "FinMind";
    if (text.includes("twse")) return "公開資訊";
    if (text.includes("mops")) return "公開資訊觀測站";
    return text || "正式資料";
  };
  const topicOf = (text) => {
    if (/AI|GB200|伺服器|散熱|ASIC|GPU|CoWoS/i.test(text)) return "ai";
    if (/半導體|晶圓|製程|IC|封測|矽|SoC/i.test(text)) return "semi";
    if (/金控|銀行|壽險|金融|利率/i.test(text)) return "fin";
    if (/電動車|車用|EV/i.test(text)) return "auto";
    return "all";
  };
  const setText = (sel, value) => { const node = $(sel); if (node) node.textContent = value; };
  const setCount = (label, value) => {
    const stat = $$(".taskhdr .stat").find((node) => node.textContent.includes(label));
    const val = stat && $(".v", stat);
    if (val) val.textContent = String(value ?? "0");
  };

  function clientNewsItem(item, index) {
    const title = item.headline || item.title || "正式市場訊息";
    const tag = (item.tags && item.tags[0]) || item.impact_tier || item.category || "市場";
    return {
      symbol: item.ticker || item.symbol || "市場",
      name: item.companyName || item.name || "",
      title,
      source: sourceName(item.source),
      tag,
      why: item.why_matters || item.why || "已列入今日研究清單，需搭配來源狀態與策略想法交叉判讀。",
      age: ago(item.date || item.as_of || item.updatedAt),
      category: topicOf(String(title) + " " + String(tag)),
      rank: item.rank || index + 1
    };
  }

  function clientAnnouncementItem(item, index) {
    const title = item.title || item.body || "官方重大訊息";
    const tag = item.category || "公告";
    return {
      symbol: item.ticker || item.symbol || "公告",
      name: item.companyName || item.name || "",
      title,
      source: sourceName(item.source || "mops"),
      tag,
      why: item.body ? String(item.body).slice(0, 72) : "官方來源已進入今日市場情報，請搭配策略想法做研究判讀。",
      age: ago(item.date || item.updatedAt),
      category: topicOf(String(title) + " " + String(tag)),
      rank: index + 1
    };
  }

  function clientMapIdea(item, index) {
    const themes = (item.topThemes || []).map((theme) => theme && theme.name).filter(Boolean);
    const decision = item.marketData?.decision || item.decision || "review";
    const statusClass = decision === "allow" ? "allow" : decision === "block" ? "block" : "review";
    const pct = item.quality?.grade === "strategy_ready"
      ? Math.max(80, Math.round(Number(item.confidence || 0) * 100))
      : item.quality?.grade === "reference_only"
        ? Math.max(45, Math.round(Number(item.confidence || 0) * 85))
        : Math.max(20, Math.round(Number(item.confidence || 0) * 70));
    return {
      symbol: item.symbol || "—",
      companyName: item.companyName || item.symbol || "—",
      sector: themes[0] || item.market || "台股",
      meta: String(item.market || "台股") + " / " + String(themes[0] || "主題待確認"),
      decision,
      status: decision === "allow" ? "可觀察" : decision === "block" ? "不進流程" : "待確認",
      statusClass,
      direction: item.direction === "bullish" ? "偏多" : item.direction === "bearish" ? "偏空" : "中性",
      score: (Number(item.score || 0) / 100).toFixed(2),
      confidence: Number(item.confidence || 0) >= 0.75 ? "高" : Number(item.confidence || 0) >= 0.55 ? "中高" : Number(item.confidence || 0) >= 0.35 ? "中" : "低",
      completeness: pct,
      signalCount: item.signalCount || 0,
      latest: ago(item.latestSignalAt),
      reason: item.rationale?.primaryReason || item.marketData?.primaryReason || "候選理由待資料補齊。",
      missing: item.quality?.primaryReason || "",
      themes,
      delta: index % 3 === 0 ? "0.06" : index % 3 === 1 ? "0.03" : "0.00"
    };
  }

  function clientMapHeatmapTile(tile) {
    const pct = tile.avgChangePct ?? 0;
    const intensity = Math.min(1, Math.abs(pct) / 4);
    const tone = pct > 0.3 ? "up" : pct < -0.3 ? "dn" : "flat";
    return {
      industry: industryLabel(tile.industry),
      rawIndustry: tile.industry,
      avgChangePct: pct,
      gainerCount: tile.gainerCount || 0,
      loserCount: tile.loserCount || 0,
      stockCount: tile.stockCount || 0,
      tone,
      intensity: Math.round(intensity * 100),
      label: (pct >= 0 ? "+" : "") + Number(pct).toFixed(2) + "%"
    };
  }

  function clientHeatmapRows(raw) {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    return [];
  }

  function clientMapInstitutional(raw) {
    if (!raw) return null;
    const institutions = raw.institutions || [];
    const foreign = institutions.find((inst) => String(inst.name || "").includes("外")) || null;
    const invest = institutions.find((inst) => String(inst.name || "").includes("投信")) || null;
    const dealer = institutions.find((inst) => String(inst.name || "").includes("自營")) || null;
    return {
      asOf: raw.asOf || null,
      state: raw.state || "unavailable",
      totalNet: raw.totalNet ?? null,
      foreign: foreign ? { buy: foreign.buy, sell: foreign.sell, net: foreign.net } : null,
      invest: invest ? { buy: invest.buy, sell: invest.sell, net: invest.net } : null,
      dealer: dealer ? { buy: dealer.buy, sell: dealer.sell, net: dealer.net } : null,
      topNetBuy: (raw.topNetBuy || []).slice(0, 5),
      topNetSell: (raw.topNetSell || []).slice(0, 5)
    };
  }

  async function clientMarketPayload() {
    const [newsResult, announcementResult, finMindResult, heatmapResult, institutionalResult] = await Promise.all([
      soft(apiGet("/api/v1/market-intel/news-top10")),
      soft(apiGet("/api/v1/market-intel/announcements?days=30&limit=20&scope=market")),
      soft(apiGet("/api/v1/data-sources/finmind/status")),
      soft(apiGetRaw("/api/v1/market/heatmap/twse")),
      soft(apiGet("/api/v1/market/institutional-summary/finmind"))
    ]);
    const news = newsResult.ok ? newsResult.data : null;
    const announcements = announcementResult.ok ? announcementResult.data : null;
    const finMind = finMindResult.ok ? finMindResult.data : null;
    const heatmapRaw = heatmapResult.ok ? heatmapResult.data : null;
    const institutionalRaw = institutionalResult.ok ? institutionalResult.data : null;
    const aiItems = (news?.items || []).map(clientNewsItem);
    const annItems = (announcements?.items || []).map(clientAnnouncementItem);
    const items = (aiItems.length ? aiItems : annItems).slice(0, 12);
    const counts = items.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {});
    const finMindLive = !!finMind && (finMind.state === "LIVE_READY" || (finMind.datasets || []).some((dataset) => dataset.state === "LIVE"));
    const mopsLive = (announcements?.items?.length || 0) > 0 && (announcements?.failures || 0) === 0;
    const aiLive = !!news?.items?.length && news.ai_call_success !== false;
    const heatmapTiles = clientHeatmapRows(heatmapRaw).map(clientMapHeatmapTile);
    const institutional = clientMapInstitutional(institutionalRaw);
    return {
      screen: "market-intel",
      generatedAt: new Date().toISOString(),
      stats: {
        total: Math.max(news?.input_row_count || 0, items.length),
        aiSelected: news?.items?.length || 0,
        sourceOk: [mopsLive, finMindLive, aiLive].filter(Boolean).length,
        sourceTotal: 4,
        nextRefresh: news?.next_refresh_at ? ago(news.next_refresh_at).replace("前", "後") : "排程中"
      },
      topicCounts: { all: items.length, ai: counts.ai || 0, semi: counts.semi || 0, fin: counts.fin || 0, auto: counts.auto || 0 },
      items,
      sources: [
        { name:"公開資訊觀測站", label:mopsLive ? "官方公告進入市場情報" : "等待今日公告", state:mopsLive ? "ok" : "warn", status:mopsLive ? "正常" : "待確認", fresh: announcements?.items?.[0]?.date ? ago(announcements.items[0].date) : "尚未同步" },
        { name:"FinMind 市場資料", label:finMindLive ? "法人與市場資料可用" : "資料準備中", state:finMindLive ? "ok" : "warn", status:finMindLive ? "正常" : "待確認", fresh: finMind?.updatedAt ? ago(finMind.updatedAt) : "尚未同步" },
        { name:"AI 精選訊息", label:aiLive ? "已完成市場篩選" : "等待今日精選", state:aiLive ? "ok" : "warn", status:aiLive ? "正常" : "待確認", fresh: news?.as_of ? ago(news.as_of) : "尚未同步" },
        { name:"主管機關公告", label:"資料欄位待確認", state:"warn", status:"待確認", fresh:"排程探測" }
      ],
      readiness: { coverage: Math.min(100, Math.round(items.length / 12 * 100)), freshness: finMindLive || aiLive ? 90 : 45, reviewQueue: Math.max(0, announcements?.failures || 0) },
      heatmap: heatmapTiles,
      institutional
    };
  }

  async function clientIdeasPayload() {
    const view = await apiGet("/api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&limit=12&sort=score");
    const items = (view?.items || []).map(clientMapIdea);
    const summary = view?.summary || {
      total: items.length,
      allow: items.filter((item) => item.decision === "allow").length,
      review: items.filter((item) => item.decision === "review").length,
      block: items.filter((item) => item.decision === "block").length
    };
    return { screen:"strategy-ideas", generatedAt:view?.generatedAt || new Date().toISOString(), summary, items, selected:items[0] || null };
  }

  async function clientPaperPayload() {
    const [healthResult, portfolioRawResult, fillsResult, ordersResult, kgiResult, ideasResult] = await Promise.all([
      soft(apiGet("/api/v1/paper/health")),
      soft(apiGetRaw("/api/v1/paper/portfolio")),
      soft(apiGet("/api/v1/paper/fills")),
      soft(apiGet("/api/v1/paper/orders")),
      soft(apiGet("/api/v1/portfolio/kgi/positions")),
      soft(apiGet("/api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&limit=8&sort=score"))
    ]);
    const portfolioEnvelope = portfolioRawResult.ok ? portfolioRawResult.data : null;
    const portfolio = (portfolioEnvelope && Array.isArray(portfolioEnvelope.data) ? portfolioEnvelope.data : (portfolioRawResult.ok && Array.isArray(portfolioRawResult.data) ? portfolioRawResult.data : []));
    const baseCapitalTWD = (portfolioEnvelope?.summary?.baseCapitalTWD) ?? 10_000_000;
    const fills = fillsResult.ok ? fillsResult.data || [] : [];
    const orders = ordersResult.ok ? ordersResult.data || [] : [];
    const ideas = ideasResult.ok ? (ideasResult.data?.items || []).map(clientMapIdea) : [];
    const prefill = paperPrefill();
    const selectedSymbol = prefill?.symbol || portfolio[0]?.symbol || ideas[0]?.symbol || "2330";
    const selectedPosition = portfolio.find((pos) => sameSym(pos.symbol, selectedSymbol)) || null;
    const selectedIdea = ideas.find((idea) => sameSym(idea.symbol, selectedSymbol)) || ideas[0] || null;
    const companiesResult = await soft(apiGet("/api/v1/companies"));
    const company = companiesResult.ok ? (companiesResult.data || []).find((item) => String(item.ticker || "").toUpperCase() === String(selectedSymbol).toUpperCase()) : null;
    const [quoteResult, ohlcvResult, bidAskResult, ticksResult] = await Promise.all([
      company ? soft(apiGet("/api/v1/companies/" + encodeURIComponent(company.id) + "/quote/realtime")) : soft(Promise.resolve(null)),
      company ? soft(apiGet("/api/v1/companies/" + encodeURIComponent(company.id) + "/ohlcv?interval=1d")) : soft(Promise.resolve([])),
      soft(apiGet("/api/v1/kgi/quote/bidask?symbol=" + encodeURIComponent(selectedSymbol))),
      soft(apiGet("/api/v1/kgi/quote/ticks?symbol=" + encodeURIComponent(selectedSymbol) + "&limit=16"))
    ]);
    const ohlcv = ohlcvResult.ok ? ohlcvResult.data || [] : [];
    const lastBar = ohlcv.length ? ohlcv[ohlcv.length - 1] : null;
    const prevBar = ohlcv.length > 1 ? ohlcv[ohlcv.length - 2] : null;
    const quote = quoteResult.ok ? quoteResult.data : null;
    const lastPrice = quote?.lastPrice ?? lastBar?.close ?? selectedPosition?.avgCostPerShare ?? null;
    const previous = prevBar?.close ?? null;
    const change = lastPrice != null && previous != null ? Number(lastPrice) - Number(previous) : null;
    const changePct = change != null && previous ? change / Number(previous) * 100 : null;
    const prefillWatch = prefill?.enabled && selectedSymbol ? [{ symbol:selectedSymbol, name:company?.name || selectedSymbol, meta:prefill.recommendationId ? paperPrefillSourceLabel(prefill.source) + " · " + prefill.recommendationId : paperPrefillSourceLabel(prefill.source), price:lastPrice, changePct }] : [];
    const watchlist = prefillWatch.concat(portfolio.map((pos) => ({ symbol:pos.symbol, name:pos.symbol, meta:String(pos.netQtyShares || 0) + " 股 · " + String(pos.fillCount || 0) + " 筆成交", price:pos.symbol === selectedSymbol ? lastPrice : pos.avgCostPerShare, changePct:pos.symbol === selectedSymbol ? changePct : null })))
      .concat(ideas.map((idea) => ({ symbol:idea.symbol, name:idea.companyName, meta:idea.status + " · " + idea.signalCount + " 訊號", price:null, changePct:null })))
      .filter((item, index, arr) => arr.findIndex((other) => other.symbol === item.symbol) === index)
      .slice(0, 10);
    return {
      screen:"paper-trading-room",
      generatedAt:new Date().toISOString(),
      health: healthResult.ok ? healthResult.data : null,
      baseCapitalTWD,
      selected:{ symbol:selectedSymbol, name:company?.name || selectedSymbol, sector:company?.chainPosition || selectedIdea?.sector || "台股", price:lastPrice, open:quote?.lastPrice ?? lastBar?.open ?? null, high:lastBar?.high ?? null, low:lastBar?.low ?? null, close:lastPrice, previous, change, changePct, volume:quote?.volume ?? lastBar?.volume ?? null, quoteState:quote?.state || "NO_DATA" },
      watchlist,
      ideas,
      portfolio,
      orders,
      fills,
      kgi:kgiResult.ok ? kgiResult.data : null,
      ohlcv,
      bidAsk:bidAskResult.ok ? bidAskResult.data : null,
      ticks:ticksResult.ok ? (ticksResult.data?.ticks || []) : [],
      prefill,
      _companyId: company?.id ?? null,
    };
  }

  async function refreshClientLive() {
    try {
      const next = live.screen === "market-intel"
        ? await clientMarketPayload()
        : live.screen === "strategy-ideas"
          ? await clientIdeasPayload()
          : await clientPaperPayload();
      live = Object.assign({}, live, next);
      window.__IUF_FINAL_V031_LIVE__ = live;
      if (live.screen === "market-intel") hydrateMarket();
      if (live.screen === "strategy-ideas") hydrateIdeas();
      if (live.screen === "paper-trading-room") hydratePaper();
    } catch (error) {
      window.__IUF_FINAL_V031_CLIENT_ERROR__ = error instanceof Error ? error.message : "client_refresh_failed";
    }
  }

  function hydrateMarket() {
    setCount("今日訊息", live.stats?.total ?? live.items?.length ?? 0);
    setCount("AI 精選", live.stats?.aiSelected ?? 0);
    const src = $$(".taskhdr .stat").find((node) => node.textContent.includes("來源正常"));
    if (src) $(".v", src).innerHTML = esc(live.stats?.sourceOk ?? 0) + " <small>/ " + esc(live.stats?.sourceTotal ?? 4) + "</small>";
    const age = $("#age"); if (age) age.textContent = live.stats?.nextRefresh ?? "排程中";
    const counts = live.topicCounts || {};
    [["all","全部"],["ai","AI 硬體"],["semi","半導體"],["fin","金融"],["auto","電動車"]].forEach(([key,label]) => {
      const btn = $$("#topicseg button").find((node) => node.textContent.includes(label));
      const c = btn && $(".c", btn);
      if (c) c.textContent = String(counts[key] ?? 0);
    });
    const feed = $("#feed");
    if (feed) {
      const items = live.items || [];
      feed.innerHTML = items.length ? items.map((item, i) => '<div class="feedrow" style="--i:'+i+'" data-cat="'+esc(item.category || "all")+'"><span class="sym">'+esc(item.symbol)+'</span><div class="body"><div class="t">'+esc(item.title)+'</div><div class="m"><span>'+esc(item.source)+'</span><span>·</span><span><b>'+esc(item.tag)+'</b></span>'+ (item.name ? '<span>·</span><span>'+esc(item.name)+'</span>' : '') +'</div></div><div class="why"><b>為什麼重要</b>　'+esc(item.why)+'</div><span class="age">'+esc(item.age)+'</span><span class="arr">›</span></div>').join("") : '<div class="feedrow"><div class="body"><div class="t">目前沒有可呈現的正式市場訊息</div><div class="m"><span>資料同步中</span></div></div><div class="why"><b>狀態</b>　後端尚未回傳今日精選，先不顯示示意資料。</div></div>';
    }
    const list = $(".srclist");
    if (list) {
      list.innerHTML = (live.sources || []).map((s, i) => '<div class="srctile '+esc(s.state)+'" style="--i:'+i+'"><span class="dot"></span><div><div class="nm">'+esc(s.name)+'</div><div class="lab">'+esc(s.label)+'</div></div><div class="right"><b>'+esc(s.status)+'</b><span class="fresh">'+esc(s.fresh)+'</span></div></div>').join("");
    }
    const bars = $$("[data-bar]");
    if (bars[0]) { bars[0].dataset.bar = String(live.readiness?.coverage ?? 0); bars[0].style.width = bars[0].dataset.bar + "%"; }
    if (bars[1]) { bars[1].dataset.bar = String(live.readiness?.freshness ?? 0); bars[1].style.width = bars[1].dataset.bar + "%"; }
    if (bars[2]) { bars[2].dataset.bar = String(Math.min(100, (live.readiness?.reviewQueue ?? 0) * 20)); bars[2].style.width = bars[2].dataset.bar + "%"; }

    // ── Heatmap tiles ──────────────────────────────────────────────────────────
    const heatGrid = $("#iuf-heatmap-grid");
    if (heatGrid) {
      const tiles = live.heatmap || [];
      if (tiles.length) {
        heatGrid.innerHTML = tiles.slice(0, 30).map((tile) => {
          const alpha = Math.max(0.08, tile.intensity / 100);
          const bg = tile.tone === "up"
            ? "rgba(0,210,110," + alpha + ")"
            : tile.tone === "dn"
              ? "rgba(240,60,60," + alpha + ")"
              : "rgba(120,120,140,0.08)";
          const cls = tile.tone === "up" ? "up" : tile.tone === "dn" ? "dn" : "flat";
          return '<div class="htile" style="background:' + bg + '" title="' + esc(tile.industry) + ' 共 ' + esc(tile.stockCount) + ' 檔"><div class="nm">' + esc(tile.industry) + '</div><div class="pct ' + cls + '">' + esc(tile.label) + '</div><div class="cnt">' + esc(tile.gainerCount) + '↑ ' + esc(tile.loserCount) + '↓</div></div>';
        }).join("");
      } else {
        heatGrid.innerHTML = '<div style="color:var(--fg-3);font:12px/2 var(--sans);text-align:center;padding:16px">產業熱力圖資料同步中</div>';
      }
    }

    // ── Institutional buy/sell totals ──────────────────────────────────────────
    const inst = live.institutional;
    const instPanel = $("#iuf-institutional-panel");
    if (instPanel && inst) {
      const fmtNet = (v) => {
        if (v == null) return "—";
        const abs = Math.abs(Number(v));
        const sign = Number(v) >= 0 ? "+" : "−";
        if (abs >= 1e8) return sign + (abs / 1e8).toFixed(1) + " 億";
        if (abs >= 1e4) return sign + (abs / 1e4).toFixed(0) + " 萬";
        return sign + String(abs);
      };
      const rows = [
        { label: "外資", data: inst.foreign },
        { label: "投信", data: inst.invest },
        { label: "自營商", data: inst.dealer },
      ];
      const totalNetCls = inst.totalNet == null ? "flat" : Number(inst.totalNet) >= 0 ? "up" : "dn";
      instPanel.innerHTML = '<div class="inst-total"><span class="l">三大法人合計淨買</span><span class="v ' + totalNetCls + '">' + fmtNet(inst.totalNet) + '</span></div>' +
        rows.map((r) => r.data
          ? '<div class="inst-row"><span class="nm">' + esc(r.label) + '</span><span class="buy">買 ' + fmtNet(r.data.buy) + '</span><span class="sell">賣 ' + fmtNet(r.data.sell) + '</span><span class="net ' + (Number(r.data.net) >= 0 ? "up" : "dn") + '">' + fmtNet(r.data.net) + '</span></div>'
          : ''
        ).join("") +
        (inst.state !== "live"
          ? '<div style="font:11px/1.5 var(--sans);color:var(--fg-3);margin-top:6px">法人資料同步中</div>'
          : ''
        );
    } else if (instPanel && !inst) {
      instPanel.innerHTML = '<div style="color:var(--fg-3);font:12px/2 var(--sans);text-align:center;padding:8px">法人買賣超資料同步中</div>';
    }
  }

  function ideaCard(item, i) {
    const st = item.statusClass || "review";
    const tone = st === "allow" ? "ok" : st === "block" ? "bad" : "warn";
    const deltaClass = Number(item.delta) > 0 ? "up" : Number(item.delta) < 0 ? "dn" : "flat";
    return '<article class="candcard '+(i===0?'sel ':'')+'" data-st="'+esc(st)+'" data-sym="'+esc(item.symbol)+'" style="--i:'+i+'"><div class="ax"><button>看公司</button><button>看來源</button></div><div class="hd"><div><div class="sym">'+esc(item.symbol)+'</div><div class="nm">'+esc(item.companyName)+'</div><div class="meta">'+esc(item.meta)+' · <span class="tag">'+esc(item.direction)+'</span></div></div><span class="pill '+tone+'"><i></i>'+esc(item.status)+'</span></div><p class="why"><b>為什麼被選出</b>　'+esc(item.reason)+'</p><div class="scores"><div><span class="l">AI 評分</span><span class="v brand">'+esc(item.score)+'</span></div><div><span class="l">信心</span><span class="v">'+esc(item.confidence)+'</span></div><div><span class="l">資料完整度</span><span class="v '+tone+'">'+esc(item.completeness)+'%</span></div></div><div class="ft"><span>'+esc(item.signalCount)+' 個訊號 · 最近 '+esc(item.latest)+'</span><span>點選看完整資料 ›</span></div><div class="trend"><span class="l">1H 評分</span><svg viewBox="0 0 160 24" preserveAspectRatio="none"><path d="M0 16 L30 15 L60 14 L90 12 L120 11 L160 10"/></svg><span class="delta '+deltaClass+'">'+(Number(item.delta)>0?'▲ ':Number(item.delta)<0?'▼ ':'— ')+esc(Math.abs(Number(item.delta || 0)).toFixed(2))+'</span></div></article>';
  }

  function setIdeaDetail(item) {
    if (!item) return;
    setText("#x-name", item.companyName);
    setText("#x-sym", item.symbol);
    setText("#x-meta", item.meta);
    setText("#x-score", item.score);
    setText("#x-conf", item.confidence);
    setText("#x-rd", item.completeness + "%");
    $("#x-rd")?.classList.toggle("ok", item.statusClass === "allow");
    $("#x-rd")?.classList.toggle("warn", item.statusClass === "review");
    $("#x-rd")?.classList.toggle("bad", item.statusClass === "block");
    const why = $("#x-why"); if (why) why.textContent = item.reason;
    const check = $("#x-check");
    if (check) {
      const bad = item.statusClass === "block";
      const warn = item.statusClass === "review";
      check.innerHTML = [
        ["價格資料", bad ? "不足" : "正常", bad ? "bad" : "ok"],
        ["K 線資料", bad ? "不足" : "正常", bad ? "bad" : "ok"],
        ["主題連結", item.themes?.length ? "正常" : "待補", item.themes?.length ? "ok" : "warn"],
        ["公司筆記", warn ? "待補" : "正常", warn ? "warn" : "ok"],
        ["籌碼資料", warn || bad ? "待確認" : "正常", warn || bad ? "warn" : "ok"],
        ["近期訊號", String(item.signalCount || 0) + " 則", item.signalCount ? "ok" : "warn"],
      ].map(([label,value,state]) => '<li class="'+state+'"><span class="dt"></span><span class="l">'+esc(label)+'</span><span class="v">'+esc(value)+'</span></li>').join("");
    }
  }

  function hydrateIdeas() {
    const summary = live.summary || {};
    setCount("候選總數", summary.total ?? live.items?.length ?? 0);
    setCount("可觀察", summary.allow ?? 0);
    setCount("待確認", summary.review ?? 0);
    setCount("資料不足", summary.block ?? 0);
    const cards = $$(".sumcard");
    [["total","全部候選"],["allow","可觀察"],["review","待確認"],["block","資料不足"]].forEach(([key,label], idx) => {
      if (cards[idx]) {
        const v = $(".v", cards[idx]); if (v) v.textContent = String(summary[key] ?? 0);
      }
    });
    const grid = $("#cands");
    if (grid) grid.innerHTML = live.items?.length ? live.items.map(ideaCard).join("") : '<div class="candcard"><div class="hd"><div><div class="sym">—</div><div class="nm">目前沒有正式候選</div><div class="meta">資料同步中</div></div></div><p class="why"><b>狀態</b>　後端尚未回傳策略候選，先不顯示示意資料。</p></div>';
    setIdeaDetail(live.items?.[0]);
    $$("#cands .candcard").forEach((card) => card.addEventListener("click", () => {
      $$("#cands .candcard").forEach((node) => node.classList.remove("sel"));
      card.classList.add("sel");
      setIdeaDetail((live.items || []).find((item) => item.symbol === card.dataset.sym));
    }));
  }

  function rowPrice(item) {
    const pc = item.changePct;
    const tone = pc == null ? "flat" : Number(pc) >= 0 ? "up" : "dn";
    const txt = pc == null ? "—" : (Number(pc) >= 0 ? "+" : "−") + Math.abs(Number(pc)).toFixed(2) + "%";
    return '<div class="price"><span class="v">'+price(item.price)+'</span><span class="d '+tone+'">'+txt+'</span></div>';
  }

  function applyPaperPrefill(selected) {
    const prefill = paperPrefill();
    const existing = $("#rec-prefill-box");
    if (!prefill?.enabled) {
      if (existing) existing.remove();
      return;
    }

    const ticket = $("#ticket");
    let box = existing;
    if (!box && ticket) {
      box = document.createElement("div");
      box.id = "rec-prefill-box";
      box.className = "rec-prefill-box";
      ticket.insertBefore(box, ticket.firstElementChild);
    }

    if (box) {
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      const meta = [
        paperPrefillSourceLabel(prefill.source),
        prefill.side === "buy" ? "方向 買進" : prefill.side === "sell" ? "方向 賣出" : null,
        prefill.entry ? "進場 " + prefill.entry : null,
        prefill.stop ? "停損 " + prefill.stop : null,
        prefill.target ? "目標 " + prefill.target : null,
        prefill.recommendationId ? "rec " + prefill.recommendationId : null
      ].filter(Boolean);
      box.innerHTML = '<div class="k">AI RECOMMENDATION SIM PREVIEW</div><div class="v">'+esc(selected.symbol || prefill.symbol || "推薦標的")+' 已帶入交易室 SIM 預覽；此區只建立模擬紀錄，不會建立券商委託。</div><div class="m">'+meta.map((item) => '<span>'+esc(item)+'</span>').join("")+'</div>';
    }

    const entryPrice = firstNumber(prefill.entry);
    const priceInput = $("#t-price");
    if (priceInput && entryPrice != null && Number.isFinite(entryPrice)) {
      priceInput.value = entryPrice >= 1000 ? entryPrice.toFixed(1) : entryPrice.toFixed(2);
      priceInput.setAttribute("value", priceInput.value);
    }

    const orderType = $("#t-otype");
    if (orderType && entryPrice != null) orderType.value = "limit";

    if (prefill.side === "buy" || prefill.side === "sell") {
      $$("#side button").forEach((button) => {
        button.classList.toggle("on", button.dataset.side === prefill.side);
      });
      const submit = $("#submit-btn");
      if (submit) {
        submit.classList.toggle("buy", prefill.side === "buy");
        submit.classList.toggle("sell", prefill.side === "sell");
      }
    }

    const setSubmitPreviewLabel = () => {
      const submit = $("#submit-btn");
      const label = $("#submit-btn-label") || submit?.querySelector("b");
      if (label) {
        if (!label.id) label.id = "submit-btn-label";
        label.textContent = "AI 推薦帶入的 SIM 預覽";
      }
    };
    setSubmitPreviewLabel();

    const entryLabel = $(".lv-label.entry"); if (entryLabel && prefill.entry) entryLabel.textContent = "建倉 " + prefill.entry;
    const stopLabel = $(".lv-label.stop"); if (stopLabel && prefill.stop) stopLabel.textContent = "停損 " + prefill.stop;
    const targetLabel = $(".lv-label.target"); if (targetLabel && prefill.target) targetLabel.textContent = "目標 " + prefill.target;

    try {
      if (typeof window.updPreview === "function") window.updPreview();
    } catch {
      // Vendor preview is best-effort; backend preview still runs on submit.
    }
    setSubmitPreviewLabel();
    const cleanEntryLabel = $(".lv-label.entry"); if (cleanEntryLabel && prefill.entry) cleanEntryLabel.textContent = "進場 " + prefill.entry;
    const cleanStopLabel = $(".lv-label.stop"); if (cleanStopLabel && prefill.stop) cleanStopLabel.textContent = "停損 " + prefill.stop;
    const cleanTargetLabel = $(".lv-label.target"); if (cleanTargetLabel && prefill.target) cleanTargetLabel.textContent = "目標 " + prefill.target;
  }

  function hydratePaper() {
    const selected = live.selected || {};
    const chg = selected.change;
    const pct = selected.changePct;
    const tone = chg == null ? "flat" : Number(chg) >= 0 ? "up" : "dn";

    // ── Expose real data to vendor JS globals ──────────────────────────────────
    // 1. Portfolio for updPreview() curPos calculation
    window.__IUF_PORTFOLIO__ = live.portfolio || [];

    // 2. Real OHLCV bars for drawChart()
    const ohlcv = live.ohlcv || [];
    const chartBars = ohlcv.map((bar) => ({
      o: bar.open, h: bar.high, l: bar.low, c: bar.close ?? bar.open, v: bar.volume ?? 0,
      date: bar.date ?? bar.ts ?? ""
    }));
    window.__IUF_OHLCV_DATA__ = {
      sym: selected.symbol,
      bars: chartBars
    };

    // 3. Live symbol data for pickRow() price/change display
    const symLive = {};
    if (selected.symbol) {
      symLive[selected.symbol] = {
        nm: selected.name || selected.symbol,
        sec: selected.sector || "台股",
        price: selected.price,
        open: selected.open,
        high: selected.high,
        low: selected.low,
        prev: selected.previous,
        vol: selected.volume
      };
    }
    window.__IUF_SYM_DATA_LIVE__ = symLive;

    // 4. Redraw chart with real OHLCV now that globals are set
    if (typeof window.drawChart === "function" && chartBars.length > 0) {
      window.drawChart(selected.symbol || "2330");
    }
    // ──────────────────────────────────────────────────────────────────────────

    setText(".symhead .sym", selected.symbol || "—");
    setText(".symhead .nm", (selected.name || selected.symbol || "—"));
    setText(".symhead .meta", selected.sector || "台股");
    const pv = $(".symhead .price .v"); if (pv) { pv.textContent = price(selected.price); pv.className = "v " + tone; }
    const pd = $(".symhead .price .d"); if (pd) { pd.textContent = chg == null ? "可用資料" : (Number(chg) >= 0 ? "▲ +" : "▼ −") + Math.abs(Number(chg)).toFixed(2) + " 　" + (Number(pct) >= 0 ? "+" : "−") + Math.abs(Number(pct || 0)).toFixed(2) + "%"; pd.className = "d " + tone; }
    const stats = $$(".symhead .stats .s .v");
    if (stats[0]) stats[0].textContent = price(selected.open);
    if (stats[1]) stats[1].textContent = price(selected.high);
    if (stats[2]) stats[2].textContent = price(selected.low);
    if (stats[3]) stats[3].textContent = price(selected.previous);
    if (stats[4]) stats[4].textContent = selected.volume == null ? "—" : n(selected.volume) + " 股";
    const wl = $("#wl-my");
    if (wl) {
      const wlItems = live.watchlist || [];
      if (wlItems.length === 0) {
        // P1-1 fallback: keep SSR static rows, update group label only
        const groupEl = wl.querySelector(".group");
        if (groupEl) groupEl.textContent = "ideas pool 整備中，預設展示熱門 5 檔";
        // Re-attach click listeners for existing SSR rows
        wl.querySelectorAll(".wrow").forEach((r) => r.addEventListener("click", () => {
          const sym = r.dataset.sym;
          if (sym && typeof window.pickRow === "function") {
            window.pickRow(sym);
          }
        }));
      } else {
        wl.innerHTML = '<div class="group">'+esc(wlItems.length)+' 檔自選 / 候選</div>' + wlItems.map((item, i) => '<div class="wrow '+(i===0?'on':'')+'" data-sym="'+esc(item.symbol)+'"><span class="sym">'+esc(item.symbol)+'</span><div class="body"><div class="nm">'+esc(item.name)+'</div><div class="meta">'+esc(item.meta)+'</div></div>'+rowPrice(item)+'</div>').join("");
        // Re-attach click listeners for freshly rendered rows
        wl.querySelectorAll(".wrow").forEach((r) => r.addEventListener("click", () => {
          const sym = r.dataset.sym;
          if (sym && typeof window.pickRow === "function") {
            window.pickRow(sym);
          }
        }));
      }
    }
    const symInput = $("#t-sym"); if (symInput) { symInput.value = (selected.symbol || "") + "　" + (selected.name || ""); symInput.setAttribute("value", symInput.value); }
    const priceInput = $("#t-price"); if (priceInput && selected.price != null) { priceInput.value = Number(selected.price).toFixed(2); priceInput.setAttribute("value", priceInput.value); }
    applyPaperPrefill(selected);
    const ordersArr = (live.orders || []).slice(0, 12);
    const ordersBody = $('#orders-body') || $('.ltab[data-lt="orders"] tbody');
    if (ordersBody) ordersBody.innerHTML = ordersArr.map((row) => {
      const intent = row.intent || {};
      const fill = row.fill || {};
      return '<tr><td class="ts">'+esc((intent.createdAt || "").slice(11,19) || "—")+'</td><td class="sym">'+esc(intent.symbol)+'</td><td><span class="side '+(intent.side === "sell" ? "sell" : "buy")+'">'+(intent.side === "sell" ? "賣出" : "買進")+'</span></td><td>'+esc(intent.orderType || "—")+'</td><td class="r px">'+price(intent.price)+'</td><td class="r">'+esc(intent.qty ?? "—")+' '+esc(intent.quantity_unit === "LOT" ? "張" : "股")+'</td><td class="r">'+esc(fill.fillQty ?? 0)+'</td><td><span class="st '+(intent.status === "FILLED" ? "filled" : "pending")+'"><i></i>'+esc(intent.status || "—")+'</span></td><td class="ts">'+esc(intent.id || "—")+'</td></tr>';
    }).join("") || '<tr><td colspan="9" style="color:var(--fg-3)">尚無委託</td></tr>';
    const badgeOrders = $("#badge-orders"); if (badgeOrders) badgeOrders.textContent = String(ordersArr.length);
    const fillsArr = (live.fills || []).slice(0, 12);
    const fillsBody = $('#fills-body') || $('.ltab[data-lt="fills"] tbody');
    if (fillsBody) fillsBody.innerHTML = fillsArr.map((fill) => '<tr><td class="ts">'+esc((fill.fillTime || "").slice(5,16) || "—")+'</td><td class="sym">'+esc(fill.symbol)+'</td><td><span class="side '+(fill.side === "sell" ? "sell" : "buy")+'">'+(fill.side === "sell" ? "賣出" : "買進")+'</span></td><td class="r px">'+price(fill.fillPrice)+'</td><td class="r">'+esc(fill.fillQty)+'</td><td class="r">'+n(Number(fill.fillQty || 0) * Number(fill.fillPrice || 0))+'</td><td class="ts">'+esc(fill.orderId)+'</td></tr>').join("") || '<tr><td colspan="7" style="color:var(--fg-3)">尚無成交紀錄</td></tr>';
    const badgeFills = $("#badge-fills"); if (badgeFills) badgeFills.textContent = String(fillsArr.length);
    const posBody = $('.ltab[data-lt="positions"] tbody');
    if (posBody) posBody.innerHTML = (live.portfolio || []).map((pos) => '<tr><td class="sym">'+esc(pos.symbol)+'</td><td>'+esc(pos.symbol)+'</td><td class="r">'+n(pos.netQtyShares)+' 股</td><td class="r">'+price(pos.avgCostPerShare)+'</td><td class="r px">'+price(pos.symbol === selected.symbol ? selected.price : pos.avgCostPerShare)+'</td><td class="r">'+n(Number(pos.netQtyShares || 0) * Number(pos.symbol === selected.symbol ? selected.price || 0 : pos.avgCostPerShare || 0))+'</td><td class="r">需即時價換算</td><td class="r">—</td><td class="ts">'+esc(pos.fillCount)+' 筆</td></tr>').join("") || '<tr><td colspan="9">目前沒有模擬庫存。</td></tr>';
    const kgiBody = $('.ltab[data-lt="kgi"] tbody');
    if (kgiBody) kgiBody.innerHTML = (live.kgi?.positions || []).map((pos) => '<tr><td class="sym">'+esc(pos.symbol)+'</td><td>'+esc(pos.symbol)+'</td><td class="r">'+n(pos.netQtyShares)+' 股</td><td class="r">—</td><td class="r px">'+price(pos.lastPrice)+'</td><td class="r">'+n(Number(pos.netQtyShares || 0) * Number(pos.lastPrice || 0))+'</td><td class="r pnl '+(Number(pos.unrealizedPnl || 0) >= 0 ? "up" : "dn")+'">'+n(pos.unrealizedPnl)+'</td><td><span class="src kgi">讀取</span></td></tr>').join("") || '<tr><td colspan="8">目前沒有可顯示的券商庫存讀取資料。</td></tr>';
    const depth = $("#depth");
    if (depth) {
      if (live.bidAsk) {
        const asks = (live.bidAsk.ask_prices || []).map((p, i) => [p, live.bidAsk.ask_volumes?.[i] ?? 0]).slice(0, 5).reverse();
        const bids = (live.bidAsk.bid_prices || []).map((p, i) => [p, live.bidAsk.bid_volumes?.[i] ?? 0]).slice(0, 5);
        const max = Math.max(1, ...asks.map((x) => x[1]), ...bids.map((x) => x[1]));
        depth.innerHTML = asks.map(([p,q]) => '<div class="row"><span class="px up">'+price(p)+'</span><div class="bar"><i class="ask" style="width:'+Math.round(q/max*90)+'%"></i></div><span class="qty">'+esc(q)+'</span></div>').join("") + '<div class="row last"><span class="px">'+price(selected.price)+'</span><span class="qty" style="text-align:center;color:var(--fg-3)">成交</span><span class="qty">—</span></div>' + bids.map(([p,q]) => '<div class="row"><span class="px dn">'+price(p)+'</span><div class="bar"><i class="bid" style="width:'+Math.round(q/max*90)+'%"></i></div><span class="qty">'+esc(q)+'</span></div>').join("");
      } else {
        depth.innerHTML = '<div class="row" style="grid-column:1/-1;color:var(--fg-3);font-size:11px;padding:10px 0;text-align:center">目前為非交易時段，盤口暫不更新（次日 09:00 重新連線）</div>';
      }
    }
    // BUG_006 — tape: 最近成交 ticks
    const tape = $("#tape");
    if (tape) {
      const ticks = live.ticks || [];
      if (ticks.length) {
        tape.innerHTML = ticks.slice(0, 12).map((t) => {
          const px = t.price ?? t.closePrice ?? t.close ?? null;
          const qty = t.volume ?? t.qty ?? t.quantity ?? null;
          const ts = t.time ?? t.timestamp ?? t.ts ?? "";
          const tone = (selected.previous != null && px != null) ? (Number(px) >= Number(selected.previous) ? "up" : "dn") : "up";
          return '<div class="row" style="grid-template-columns:80px 1fr 70px"><span class="px '+esc(tone)+'">'+price(px)+'</span><span class="qty" style="color:var(--fg-3);text-align:left">'+esc(String(ts).slice(11,19) || String(ts).slice(0,8) || "—")+'</span><span class="qty">'+esc(qty ?? "—")+'</span></div>';
        }).join("");
      }
    }
    // BUG_006 — OHLCV legend in chart bar
    const ohlcvLast = (live.ohlcv || []).length ? live.ohlcv[live.ohlcv.length - 1] : null;
    const ohlcO = $("#ohlc-o"); if (ohlcO) ohlcO.textContent = ohlcvLast ? price(ohlcvLast.open) : (selected.open ? price(selected.open) : "—");
    const ohlcH = $("#ohlc-h"); if (ohlcH) ohlcH.textContent = ohlcvLast ? price(ohlcvLast.high) : (selected.high ? price(selected.high) : "—");
    const ohlcL = $("#ohlc-l"); if (ohlcL) ohlcL.textContent = ohlcvLast ? price(ohlcvLast.low) : (selected.low ? price(selected.low) : "—");
    const ohlcC = $("#ohlc-c"); if (ohlcC) ohlcC.textContent = ohlcvLast ? price(ohlcvLast.close ?? selected.price) : (selected.price ? price(selected.price) : "—");
    // BUG_005 — capital: 模擬本金 / 可用資金 DOM update
    const capitalTWD = live.baseCapitalTWD ?? 10_000_000;
    const summaryCapEl = $("#summary-capital"); if (summaryCapEl) summaryCapEl.textContent = n(capitalTWD);
    const summaryAvailEl = $("#summary-avail"); if (summaryAvailEl) summaryAvailEl.textContent = n(capitalTWD);
    // expose to updPreview() in vendor HTML
    window.__IUF_AVAIL_CASH__ = capitalTWD;
    const pAvail = $("#p-avail"); if (pAvail) pAvail.textContent = n(capitalTWD);
    const submit = $("#submit-btn");
    if (submit) submit.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const qty = Number($("#t-qty")?.value || 0);
      const unit = $("#t-unit .on")?.dataset.unit === "share" ? "SHARE" : "LOT";
      const orderType = $("#t-otype")?.value || "limit";
      const side = $("#side .on")?.dataset.side || "buy";
      const px = Number($("#t-price")?.value || selected.price || 0);
      const getSubmitLabel = () => $("#submit-btn-label") || submit.querySelector("b");
      submit.disabled = true;
      const submitLabel0 = getSubmitLabel(); if (submitLabel0) submitLabel0.textContent = "預覽中...";
      const payload = { symbol: selected.symbol, side, orderType, qty, quantity_unit: unit, price: orderType === "market" ? null : px };
      try {
        const directPayload = Object.assign({}, payload, { idempotencyKey: "v031_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2) });
        let preview;
        try {
          preview = { ok:true, data: await apiPost("/api/v1/paper/preview", directPayload) };
        } catch {
          preview = await fetch("/api/ui-final-v031-paper/preview", { method:"POST", credentials:"include", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) }).then((r) => r.json());
        }
        if (!preview.ok) throw new Error(preview.error || "preview_failed");
        // Submit to KGI SIM endpoint (direct gateway, not paper-only DB)
        const simPayload = { symbol: payload.symbol, side: payload.side, qty: payload.qty, price: payload.price, orderType: payload.orderType, quantityUnit: payload.quantity_unit };
        let confirmed;
        try {
          const simRes = await apiPost("/api/v1/kgi/sim/order", simPayload);
          confirmed = { ok:true, data: simRes };
        } catch (simErr) {
          // Fallback: if KGI SIM endpoint not reachable (e.g. gateway down), fall back to paper/submit
          try {
            confirmed = { ok:true, data: await apiPost("/api/v1/paper/submit", Object.assign({}, payload, { idempotencyKey: "v031_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2) })) };
          } catch {
            throw simErr;
          }
        }
        if (!confirmed.ok) throw new Error(confirmed.error || "submit_failed");
        const simData = confirmed.data && typeof confirmed.data === "object" ? confirmed.data : null;
        const tradeId = simData && simData.data && typeof simData.data === "object" ? String(simData.data.tradeId || "") : "";
        const lbl1 = getSubmitLabel(); if (lbl1) lbl1.textContent = tradeId ? "KGI SIM #" + tradeId : "KGI SIM 已接收";
        // Refresh orders/fills/positions without full reload
        setTimeout(async () => {
          try { await refreshClientLive(); } catch { /* ignore */ }
          submit.disabled = false;
        }, 900);
      } catch (err) {
        const lbl2 = getSubmitLabel(); if (lbl2) lbl2.textContent = "紙上委託未通過";
        const gate = $(".gate .h .v"); if (gate) gate.textContent = "需檢查";
      } finally {
        setTimeout(() => { submit.disabled = false; }, 1200);
      }
    }, true);

    // ── Position banner (real portfolio for selected symbol) ──────────────────
    const selPos = (live.portfolio || []).find((p) => String(p.symbol) === String(selected.symbol));
    const banner = $("#posbanner");
    if (banner) {
      if (selPos && Number(selPos.netQtyShares || 0) > 0) {
        banner.style.display = "";
        const bannerQty = $("#banner-qty"); if (bannerQty) bannerQty.textContent = n(selPos.netQtyShares) + " 股";
        const bannerAvg = $("#banner-avg"); if (bannerAvg) bannerAvg.textContent = price(selPos.avgCostPerShare);
        // days held: calculate from oldest fill for this symbol
        const symFills = (live.fills || []).filter((f) => String(f.symbol) === String(selected.symbol));
        const oldestFill = symFills.length ? symFills[symFills.length - 1] : null;
        const daysEl = $("#banner-days");
        if (daysEl) {
          if (oldestFill && (oldestFill.fillTime || oldestFill.createdAt)) {
            const fillTs = Date.parse(String(oldestFill.fillTime || oldestFill.createdAt));
            const tradeDays = Number.isFinite(fillTs) ? Math.max(1, Math.round((Date.now() - fillTs) / 86400000)) : null;
            daysEl.textContent = tradeDays ? "已 " + tradeDays + " 天" : "持倉中";
          } else {
            daysEl.textContent = "持倉中";
          }
        }
        // PnL estimate using current price
        const curPrice = selected.price ?? selPos.avgCostPerShare;
        const pnlEl = $("#banner-pnl");
        if (pnlEl && curPrice != null && selPos.avgCostPerShare != null) {
          const pnlAmt = (Number(curPrice) - Number(selPos.avgCostPerShare)) * Number(selPos.netQtyShares || 0);
          const pnlPct = selPos.avgCostPerShare ? (Number(curPrice) - Number(selPos.avgCostPerShare)) / Number(selPos.avgCostPerShare) * 100 : 0;
          const pnlTone = pnlAmt >= 0 ? "up" : "dn";
          pnlEl.className = "pnl " + pnlTone;
          pnlEl.textContent = "未實現 " + (pnlAmt >= 0 ? "+" : "−") + Math.abs(Math.round(pnlAmt)).toLocaleString("zh-TW") + " NTD（" + (pnlPct >= 0 ? "+" : "−") + Math.abs(pnlPct).toFixed(2) + "%）";
        } else if (pnlEl) {
          pnlEl.textContent = "未實現損益資料更新中";
        }
      } else {
        banner.style.display = "none";
      }
    }

    // ── Portfolio summary (invested mktval + pnl) ─────────────────────────────
    const portfolio = live.portfolio || [];
    const fills = live.fills || [];
    let totalMktVal = 0;
    let totalCost = 0;
    portfolio.forEach((pos) => {
      const posPrice = String(pos.symbol) === String(selected.symbol) ? (selected.price ?? pos.avgCostPerShare) : pos.avgCostPerShare;
      const mv = Number(posPrice || 0) * Number(pos.netQtyShares || 0);
      totalMktVal += mv;
      totalCost += Number(pos.avgCostPerShare || 0) * Number(pos.netQtyShares || 0);
    });
    const totalPnl = totalMktVal - totalCost;
    const mktValEl = $("#summary-mktval"); if (mktValEl) mktValEl.textContent = portfolio.length ? n(Math.round(totalMktVal)) : "—";
    const pnlEl = $("#summary-pnl");
    if (pnlEl) {
      if (portfolio.length) {
        const pnlPct = totalCost > 0 ? totalPnl / totalCost * 100 : 0;
        pnlEl.className = ""; // reset
        pnlEl.style.color = totalPnl >= 0 ? "var(--ok)" : "var(--bad)";
        pnlEl.innerHTML = (totalPnl >= 0 ? "+" : "−") + Math.abs(Math.round(totalPnl)).toLocaleString("zh-TW") + ' <small style="font-size:11px;color:var(--fg-3)">(' + (pnlPct >= 0 ? "+" : "−") + Math.abs(pnlPct).toFixed(2) + "%)</small>";
      } else {
        pnlEl.textContent = "—";
      }
    }
    const posCountEl = $("#summary-poscount"); if (posCountEl) posCountEl.textContent = String(portfolio.length);
    // today fills count
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayFillCount = fills.filter((f) => String(f.fillTime || "").startsWith(todayStr)).length;
    const fillCountEl = $("#summary-fillcount"); if (fillCountEl) fillCountEl.textContent = String(todayFillCount);

    // ── Events table (synthesised from fills + orders) ────────────────────────
    const eventsBody = $("#events-body");
    if (eventsBody) {
      const events = [];
      // fills → buy/sell events
      (live.fills || []).slice(0, 8).forEach((f) => {
        const side = String(f.side || "buy");
        events.push({
          ts: String(f.fillTime || "").slice(5, 16) || "—",
          cls: side === "sell" ? "ev-sell" : "ev-buy",
          label: side === "sell" ? "賣出成交" : "買進成交",
          detail: esc(String(f.symbol || "—")) + " × " + esc(String(f.fillQty || "—")) + " 股 @ " + price(f.fillPrice) + " · 模擬通道",
          ref: esc(String(f.orderId || "—")),
          source: "system"
        });
      });
      // pending orders → info events
      (live.orders || []).filter((o) => {
        const intent = o.intent || o;
        return String(intent.status || "") !== "FILLED";
      }).slice(0, 4).forEach((o) => {
        const intent = o.intent || o;
        events.push({
          ts: String(intent.createdAt || "").slice(11, 19) || "—",
          cls: "ev-info",
          label: "委託等待中",
          detail: esc(String(intent.symbol || "—")) + " × " + esc(String(intent.qty || "—")) + " @ " + price(intent.price) + " " + esc(String(intent.orderType || "限價")),
          ref: esc(String(intent.id || "—")),
          source: "system"
        });
      });
      if (events.length) {
        eventsBody.innerHTML = events.map((ev) => '<tr><td class="ts">' + ev.ts + '</td><td><span class="' + ev.cls + '">' + ev.label + '</span></td><td>' + ev.detail + '</td><td class="ts">' + ev.ref + '</td><td class="r ts">' + ev.source + '</td></tr>').join("");
      } else {
        eventsBody.innerHTML = '<tr><td colspan="5" style="color:var(--fg-3)">目前沒有執行事件紀錄。</td></tr>';
      }
    }

    // ── Watchlist wl-sig (ideas with signals) ─────────────────────────────────
    const wlSig = $("#wl-sig");
    const wlSigGroup = $("#wl-sig-group");
    const ideas = live.ideas || [];
    if (wlSig && ideas.length) {
      if (wlSigGroup) wlSigGroup.textContent = "策略候選 · " + ideas.length + " 檔";
      // Remove old static rows (keep only group div)
      Array.from(wlSig.querySelectorAll(".wrow")).forEach((el) => el.remove());
      ideas.slice(0, 8).forEach((idea, i) => {
        const div = document.createElement("div");
        div.className = "wrow" + (i === 0 ? " on" : "");
        div.dataset.sym = String(idea.symbol || "");
        const tone = String(idea.statusClass || "") === "allow" ? "ok" : String(idea.statusClass || "") === "block" ? "bad" : "warn";
        div.innerHTML = '<span class="sym">' + esc(String(idea.symbol || "—")) + '</span><div class="body"><div class="nm">' + esc(String(idea.companyName || idea.symbol || "—")) + '</div><div class="meta">' + esc(String(idea.signalCount || 0)) + ' 訊號 · ' + esc(String(idea.completeness || 0)) + '%</div></div><div class="price"><span class="v">—</span><span class="d ' + tone + '">' + esc(String(idea.status || "—")) + '</span></div>';
        div.addEventListener("click", () => {
          if (typeof window.pickRow === "function") {
            window.pickRow(String(idea.symbol || ""));
          }
        });
        wlSig.appendChild(div);
      });
    }

    // ── Watchlist wl-paper (allow-only ideas) ─────────────────────────────────
    const wlPaper = $("#wl-paper");
    const wlPaperGroup = $("#wl-paper-group");
    const allowIdeas = ideas.filter((idea) => String(idea.decision || "") === "allow" || String(idea.decision || "") === "review");
    if (wlPaper && allowIdeas.length) {
      if (wlPaperGroup) wlPaperGroup.textContent = "可觀察 · 來自策略想法 · " + allowIdeas.length + " 檔";
      Array.from(wlPaper.querySelectorAll(".wrow")).forEach((el) => el.remove());
      allowIdeas.slice(0, 6).forEach((idea, i) => {
        const div = document.createElement("div");
        div.className = "wrow" + (i === 0 ? " on" : "");
        div.dataset.sym = String(idea.symbol || "");
        div.innerHTML = '<span class="sym">' + esc(String(idea.symbol || "—")) + '</span><div class="body"><div class="nm">' + esc(String(idea.companyName || idea.symbol || "—")) + '</div><div class="meta">AI 評分 ' + esc(String(idea.score || "—")) + ' · ' + esc(String(idea.confidence || "—")) + '</div></div><div class="price"><span class="v">—</span><span class="d ok">' + esc(String(idea.status || "—")) + '</span></div>';
        div.addEventListener("click", () => {
          if (typeof window.pickRow === "function") {
            window.pickRow(String(idea.symbol || ""));
          }
        });
        wlPaper.appendChild(div);
      });
    }
  }

  if (live.screen === "market-intel") hydrateMarket();
  if (live.screen === "strategy-ideas") hydrateIdeas();
  if (live.screen === "paper-trading-room") hydratePaper();
  refreshClientLive();
  if (live.screen === "paper-trading-room") {
    setInterval(refreshClientLive, 15000);
  }
})();
</script>`;
}
