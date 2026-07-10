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
  type MarketIntelAnnouncementsData,
  type MarketInstitutionalLine,
  type MarketInstitutionalSummary,
  type NewsAiItem,
  type NewsTop10Data,
  type OhlcvBar,
  type TwseIndustryHeatmapTile,
} from "@/lib/api";
import type { StrategyIdeasView } from "@iuf-trading-room/contracts";
import { industryLabel, INDUSTRY_LABEL_MAP } from "@/lib/industry-i18n";
import {
  getKgiStatus,
  getKgiPositions,
  getPaperHealth,
  getPaperPortfolioRaw,
  isUnifiedOrderFromTaipeiToday,
  listPaperFills,
  listPaperOrders,
  listUnifiedOrders,
  type KgiPositionsResponse,
  type KgiStatusResponse,
  type PaperFillLedgerRow,
  type PaperHealthState,
  type PaperOrderState,
  type PaperPortfolioPosition,
  type UnifiedOrderReportRow,
} from "@/lib/paper-orders-api";
import { getFAutoPortfolio, type FAutoPortfolio } from "@/lib/fauto-sim-api";

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
  fastPaperShell?: boolean;
};

type Settled<T> = PromiseSettledResult<T>;

const TRADING_ROOM_OHLCV_LOOKBACK_YEARS = 10;

function tradingRoomOhlcvFromDate(date = new Date()) {
  const from = new Date(date);
  from.setFullYear(from.getFullYear() - TRADING_ROOM_OHLCV_LOOKBACK_YEARS);
  return from.toISOString().slice(0, 10);
}

function okValue<T>(result: Settled<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

export type BrokerGatewayStatus = "unpaired" | "pending" | "paired_unreachable" | "reachable";

export type GatewayStatusBadge = {
  label: string;
  color: string;
  border: string;
  background: string;
};

// 統一下單流 D6（帳號帶，2026-07-09）: four-state gatewayStatus -> badge copy,
// same wording/colors as the /settings/broker trust card (#1163,
// apps/web/app/settings/broker/broker-connections.tsx's gatewayBadge()) so
// the trading-room account strip and the settings page never disagree about
// what "已連線" vs "等待配對" means. Kept as a real, unit-testable function
// (unlike the rest of the ticket-submit vocab in this file, which has to be
// inlined as plain JS text inside the <script> template because it ships as
// a raw string with no bundler import access) — the trading-room hydration
// script mirrors this exact mapping inline for the same reason.
export function gatewayStatusBadge(status: string | null | undefined): GatewayStatusBadge {
  if (status === "reachable") {
    return { label: "已連線", color: "#34d399", border: "rgba(52,211,153,0.32)", background: "rgba(52,211,153,0.10)" };
  }
  if (status === "pending") {
    return { label: "等待配對", color: "#fbbf24", border: "rgba(251,191,36,0.34)", background: "rgba(251,191,36,0.10)" };
  }
  if (status === "paired_unreachable") {
    return { label: "等待連線", color: "#fbbf24", border: "rgba(251,191,36,0.34)", background: "rgba(251,191,36,0.10)" };
  }
  return { label: "未配對", color: "#9ca3af", border: "rgba(156,163,175,0.26)", background: "rgba(156,163,175,0.08)" };
}

function settledState(result: Settled<unknown>) {
  return result.status === "fulfilled" ? "live" : "blocked";
}

function shouldFetchRawKgiQuoteSnapshot(quote: { source?: string | null; state?: string | null; freshness?: string | null } | null | undefined) {
  const source = String(quote?.source ?? "").toLowerCase();
  const state = String(quote?.state ?? "").toUpperCase();
  const freshness = String(quote?.freshness ?? "").toLowerCase();
  return source === "kgi-gateway" && (state === "LIVE" || freshness === "fresh");
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

function isTwTicker(value?: string | null) {
  return /^[0-9]{4}[A-Z]?$/.test(String(value ?? "").trim());
}

const DEFAULT_TRADING_ROOM_WATCHLIST = [
  { symbol: "2330", name: "台積電", meta: "核心觀察" },
  { symbol: "1514", name: "亞力", meta: "電機設備" },
  { symbol: "1560", name: "中砂", meta: "半導體設備" },
  { symbol: "1590", name: "亞德客-KY", meta: "自動化設備" },
  { symbol: "1721", name: "三晃", meta: "化學材料" },
  { symbol: "1723", name: "中碳", meta: "材料 / 能源" },
  { symbol: "1809", name: "中釉", meta: "材料" },
  { symbol: "2066", name: "世德", meta: "車用零組件" },
] as const;

function companyHref(symbol?: string | null) {
  return isTwTicker(symbol) ? `/companies/${encodeURIComponent(String(symbol))}` : "/companies";
}

function recommendationHref(symbol?: string | null) {
  return isTwTicker(symbol) ? `/ai-recommendations?symbol=${encodeURIComponent(String(symbol))}` : "/ai-recommendations";
}

function topicHref(tag?: string | null) {
  return `/themes?query=${encodeURIComponent(String(tag || "市場情報"))}`;
}

function marketFeedState(
  items: Array<{ source?: string; category?: string }>,
  news: NewsTop10Data | null,
  announcements: MarketIntelAnnouncementsData | null,
  newsError: string | null,
  announcementsError: string | null,
) {
  if (items.length > 0) {
    const source = news?.items?.length ? "AI 精選" : "官方公告 fallback";
    return {
      state: news?.items?.length ? "live" : "partial",
      label: news?.items?.length ? "AI 精選已回傳" : "官方公告 fallback",
      summary: `顯示 ${items.length} 則 ${source}`,
      detail: news?.selection_mode === "ai" ? "AI selector 已完成今日篩選。" : "使用正式公告或備援排序；未顯示示意新聞。",
      nextAction: "持續比對 AI 推薦股票、公司頁與主題頁連結。",
    };
  }

  const details = [
    newsError ? `news-top10 error: ${newsError}` : null,
    announcementsError ? `announcements error: ${announcementsError}` : null,
    news?.stale_reason ? `stale_reason: ${news.stale_reason}` : null,
    announcements?.source ? `announcements source: ${announcements.source}` : null,
  ].filter(Boolean).join("；");

  return {
    state: "empty",
    label: "等待正式資料",
    summary: "目前沒有可呈現的正式 AI 精選市場情報",
    detail: details || "後端尚未回傳今日 AI 精選或官方公告項目。",
    nextAction: "等待下一輪市場情報同步；前端不顯示示意新聞。",
  };
}

function settledErrorLabel<T>(result: Settled<T>) {
  if (result.status === "fulfilled") return null;
  const reason = result.reason;
  return reason instanceof Error ? reason.message : String(reason ?? "unknown_error");
}

// Strip publisher boilerplate tails from scraped headlines, e.g.
// "...｜新聞快訊｜豐雲學堂 - sinotrade.com.tw" (6/10 audit: headline 帶來源站尾巴).
function cleanHeadline(raw: string): string {
  let text = raw.trim();
  // Drop a trailing " - domain.tld" segment
  text = text.replace(/\s+-\s+[\w.-]+\.(?:com|net|org|tw|cn|io)(?:\.\w+)?\s*$/i, "");
  // Drop trailing ｜/| separated publisher segments (short, no sentence punctuation)
  while (true) {
    const m = text.match(/^(.*)[｜|]([^｜|]{1,16})$/);
    if (!m || /[，。,.!?]/.test(m[2]!)) break;
    text = m[1]!.trim();
  }
  return text.trim() || raw.trim();
}

function mapNewsItem(item: NewsAiItem, index: number) {
  const title = cleanHeadline(item.headline || "市場訊息");
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
    companyHref: companyHref(item.ticker),
    recommendationHref: recommendationHref(item.ticker),
    topicHref: topicHref(tag),
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
    companyHref: companyHref(item.ticker),
    recommendationHref: recommendationHref(item.ticker),
    topicHref: topicHref(tag),
  };
}

function isOfficialMarketAnnouncement(item: CompanyAnnouncement) {
  const source = String(item.source ?? "").toLowerCase();
  const title = `${item.title ?? ""} ${item.body ?? ""}`;
  if (source.includes("finmind_stock_news")) return false;
  if (/cmoney|money-link|yahoo|udn|pchome|小編|新聞網|news/i.test(title)) return false;
  return source.includes("twse") || source.includes("mops") || source.includes("announcement");
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
  const newsError = settledErrorLabel(newsResult);
  const announcementsError = settledErrorLabel(announcementsResult);

  const heatmapTiles = (heatmapRaw?.data ?? []).map(mapHeatmapTile);
  const institutional = institutionalRaw ? mapInstitutional(institutionalRaw as MarketInstitutionalSummary) : null;

  const aiItems = news?.items?.map(mapNewsItem) ?? [];
  const announcementItems = announcements?.items?.filter(isOfficialMarketAnnouncement).map(mapAnnouncement) ?? [];
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
  // 3 real sources. The old 4th「主管機關公告」slot was a hardcoded-warn placeholder
  // (duplicate of MOPS) that made the health bar permanently look broken (audit A2:
  // 來源正常 2/4 forever) — removed from both the list and the denominator.
  const sourceOkCount = [mopsLive, finMindLive, aiLive].filter(Boolean).length;
  const feedState = marketFeedState(items, news, announcements, newsError, announcementsError);

  return {
    screen: "market-intel" as const,
    generatedAt: new Date().toISOString(),
    stats: {
      total: Math.max(news?.input_row_count ?? 0, items.length),
      aiSelected: news?.items?.length ?? 0,
      sourceOk: sourceOkCount,
      sourceTotal: 3,
      nextRefresh: nextRefreshText(news?.next_refresh_at),
    },
    topicCounts: {
      all: items.length,
      ai: topicCounts.ai ?? 0,
      semi: topicCounts.semi ?? 0,
      fin: topicCounts.fin ?? 0,
      auto: topicCounts.auto ?? 0,
    },
    items,
    feedState,
    sources: [
      {
        name: "公開資訊觀測站",
        label: mopsLive ? `官方公告已回傳 ${announcements?.items?.length ?? 0} 則` : (announcementsError ? "官方公告同步異常" : "目前無可呈現公告"),
        state: mopsLive ? "ok" : "warn",
        status: mopsLive ? "正常" : "待確認",
        fresh: announcements?.items?.[0]?.date ? minutesAgoText(announcements.items[0].date) : "同步中",
      },
      {
        name: "FinMind 市場資料",
        label: finMindLive ? "市場資料源可用" : "市場資料源同步中",
        state: finMindLive ? "ok" : "warn",
        status: finMindLive ? "正常" : "同步中",
        fresh: finMind?.updatedAt ? minutesAgoText(finMind.updatedAt) : "同步中",
      },
      {
        name: "AI 精選訊息",
        label: aiLive ? `AI 精選已回傳 ${news?.items?.length ?? 0} 則` : "AI 精選尚無可顯示項目",
        state: aiLive ? "ok" : "warn",
        status: aiLive ? (news?.selection_mode === "ai" ? "AI 篩選" : "備援") : "待回傳",
        fresh: news?.as_of ? minutesAgoText(news.as_of) : "同步中",
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

// 「下次抓取」must format a FUTURE time. The old code reused minutesAgoText and
// swapped 前→後, which printed「剛剛」whenever the schedule was due/overdue (audit A2).
function nextRefreshText(iso: string | null | undefined): string {
  if (!iso) return "排程中";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "排程中";
  if (ms <= 60_000) return "即將更新";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} 分鐘後`;
  return `${Math.round(minutes / 60)} 小時後`;
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
    reason: ideaReasonText(item.rationale.primaryReason || item.marketData.primaryReason),
    missing: item.quality.primaryReason,
    themes,
    delta: index % 3 === 0 ? "0.06" : index % 3 === 1 ? "0.03" : "0.00",
  };
}

// Backend primaryReason can be an engineering code (e.g. "fallback:higher_priority_unavailable") —
// the 6/10 audit caught it rendered verbatim under「為什麼被選出」. Translate to product wording.
function ideaReasonText(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) return "候選理由待資料補齊。";
  const labels: Record<string, string> = {
    "fallback:higher_priority_stale": "即時報價暫時過期，已改用備援報價來源評估。",
    "fallback:higher_priority_missing": "即時報價缺漏，已改用備援報價來源評估。",
    "fallback:higher_priority_unavailable": "即時報價來源暫停，已改用備援報價來源評估。",
    "fallback:no_fresh_quote": "目前沒有新鮮報價，暫以最近可用資料評估。",
    "fallback:no_quote": "目前沒有可用報價，此候選僅供觀察。",
    "stale:age_exceeded": "報價已超過新鮮度上限，評估僅供參考。",
    "stale:missing_last": "缺少最新成交價，評估僅供參考。",
    "stale:no_quote": "目前沒有可用報價，評估僅供參考。",
    "stale:provider_unavailable": "報價供應來源暫停，評估僅供參考。",
    "synthetic_source": "使用合成參考價，評估僅供參考。",
    "non_live_source": "使用非即時資料來源評估。",
    "provider_disconnected": "報價連線中斷，評估僅供參考。",
    "missing_quote": "缺少報價資料，此候選僅供觀察。",
  };
  return labels[value] ?? value;
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

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const n = finiteNumber(value);
    if (n !== null) return n;
  }
  return null;
}

function resolveTradingRoomQuoteSnapshot(
  quote: Awaited<ReturnType<typeof getCompanyQuoteRealtime>> | null,
  lastBar: OhlcvBar | null,
  prevBar: OhlcvBar | null,
  fallbackPrice: number | null,
) {
  const lastPrice = firstFiniteNumber(quote?.lastPrice, lastBar?.close, fallbackPrice);
  const previous = firstFiniteNumber(
    quote?.prevClose,
    quote?.previousClose,
    quote?.referencePrice,
    quote?.yesterdayClose,
    prevBar?.close,
  );
  const computedChange = lastPrice !== null && previous !== null
    ? Number((lastPrice - previous).toFixed(2))
    : null;
  const computedChangePct = computedChange !== null && previous
    ? Number(((computedChange / previous) * 100).toFixed(2))
    : null;

  return {
    lastPrice,
    open: firstFiniteNumber(quote?.open, lastBar?.open, lastPrice),
    high: firstFiniteNumber(quote?.high, lastBar?.high, lastPrice),
    low: firstFiniteNumber(quote?.low, lastBar?.low, lastPrice),
    previous,
    change: computedChange ?? firstFiniteNumber(quote?.change),
    changePct: computedChangePct ?? firstFiniteNumber(quote?.changePct),
    volume: firstFiniteNumber(quote?.volume, lastBar?.volume),
  };
}

function paperPrefillSourceLabel(source: PaperPrefillHandoff["source"]) {
  if (source === "ai_recommendations") return "AI 推薦帶入";
  if (source === "strategy_home") return "首頁策略帶入";
  if (source === "home_paper_preview") return "首頁紙上交易帶入";
  if (source === "strategy_run") return "策略執行紀錄帶入";
  return "網址參數帶入";
}

function paperPrefillWatchMeta(prefill: PaperPrefillHandoff) {
  const source = paperPrefillSourceLabel(prefill.source);
  return prefill.recommendationId ? `${source} · ${prefill.recommendationId}` : source;
}

function sameSymbol(left: string | null | undefined, right: string | null | undefined) {
  return String(left ?? "").toUpperCase() === String(right ?? "").toUpperCase();
}

function buildPaperFastShellPayload(options: FinalV031PayloadOptions = {}) {
  const prefill = options.paperPrefill ?? null;
  const selectedSymbol = prefill?.symbol ?? "2330";
  const selectedDefault = DEFAULT_TRADING_ROOM_WATCHLIST.find((item) => sameSymbol(item.symbol, selectedSymbol));
  const prefillWatch = prefill?.enabled && selectedSymbol
    ? [{
        symbol: selectedSymbol,
        name: selectedDefault?.name ?? selectedSymbol,
        meta: paperPrefillWatchMeta(prefill),
        price: null,
        changePct: null,
      }]
    : [];

  return {
    screen: "paper-trading-room" as const,
    generatedAt: new Date().toISOString(),
    fastShell: true,
    health: null,
    baseCapitalTWD: null,
    fauto: null as FAutoPortfolio | null,
    selected: {
      symbol: selectedSymbol,
      name: selectedDefault?.name ?? selectedSymbol,
      sector: industryLabel(selectedDefault?.meta ?? ""),
      price: null,
      open: null,
      high: null,
      low: null,
      close: null,
      previous: null,
      change: null,
      changePct: null,
      volume: null,
      quoteState: "LOADING",
    },
    watchlist: [
      ...prefillWatch,
      ...DEFAULT_TRADING_ROOM_WATCHLIST.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        meta: item.meta,
        price: null,
        changePct: null,
      })),
    ].filter((item, index, arr) => arr.findIndex((other) => sameSymbol(other.symbol, item.symbol)) === index),
    ideas: [],
    portfolio: [],
    orders: [],
    fills: [],
    utaOrders: [] as UnifiedOrderReportRow[],
    kgi: null,
    kgiStatus: null,
    dataStates: {
      health: "loading",
      portfolio: "loading",
      fills: "loading",
      orders: "loading",
      utaOrders: "loading",
      kgi: "loading",
      kgiStatus: "loading",
      ideas: "loading",
    },
    ohlcv: [],
    bidAsk: null,
    ticks: [],
    prefill,
    _companyId: null,
    _companyIdSymbol: null,
  };
}

async function buildPaperPayload(options: FinalV031PayloadOptions = {}) {
  const [healthResult, portfolioRawResult, fillsResult, ordersResult, utaOrdersResult, kgiResult, kgiStatusResult, ideasResult, fautoResult] = await Promise.allSettled([
    getPaperHealth(),
    getPaperPortfolioRaw(),
    listPaperFills(),
    listPaperOrders(),
    listUnifiedOrders(20),
    getKgiPositions(),
    getKgiStatus(),
    getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 200, sort: "score" }),
    getFAutoPortfolio(),
  ]);

  const health = okValue<PaperHealthState | null>(healthResult, null);
  const portfolioRawOk = portfolioRawResult.status === "fulfilled";
  const portfolioRaw = okValue(portfolioRawResult, { positions: [] as PaperPortfolioPosition[], summary: { baseCapitalTWD: 0, currency: "TWD", simulated: true, paperMode: true, positionCount: 0, investedCostTWD: 0, note: "" } });
  const portfolio = portfolioRaw.positions;
  const baseCapitalTWD = portfolioRawOk ? portfolioRaw.summary.baseCapitalTWD : null;
  const fills = okValue<PaperFillLedgerRow[]>(fillsResult, []);
  const orders = okValue<PaperOrderState[]>(ordersResult, []);
  // D3 委託回報面板 (2026-07-10): 跨券商 unified_orders 帳，只顯示台北時間今日的委託。
  const utaOrdersAll = okValue(utaOrdersResult, { orders: [] as UnifiedOrderReportRow[] }).orders ?? [];
  const utaOrders = utaOrdersAll.filter((row) => isUnifiedOrderFromTaipeiToday(row.createdAt));
  const kgi = okValue<KgiPositionsResponse | null>(kgiResult, null);
  const kgiStatus = okValue<KgiStatusResponse | null>(kgiStatusResult, null);
  // F-AUTO holdings (B3): cross-day S1 positions via gateway → audit rebuild chain
  const fautoSettled = fautoResult.status === "fulfilled" ? fautoResult.value : null;
  const fauto = fautoSettled && fautoSettled.ok ? fautoSettled.data : null;
  const ideas = ideasResult.status === "fulfilled" ? ideasResult.value.data : null;
  const mappedIdeas = ideas?.items?.map(mapIdea) ?? [];
  const prefill = options.paperPrefill ?? null;
  const selectedSymbol = prefill?.symbol ?? portfolio[0]?.symbol ?? mappedIdeas[0]?.symbol ?? "2330";
  const selectedPosition = portfolio.find((pos) => sameSymbol(pos.symbol, selectedSymbol)) ?? null;
  const selectedIdea = mappedIdeas.find((idea) => sameSymbol(idea.symbol, selectedSymbol)) ?? mappedIdeas[0] ?? null;

  const [companyResult, quoteResult] = await Promise.allSettled([
    getCompanyByTicker(selectedSymbol),
    getCompanyQuoteRealtime(selectedSymbol),
  ]);
  const company = okValue(companyResult, null);
  const quote = okValue(quoteResult, null);
  let bidAsk = null;
  let ticks = null;
  if (shouldFetchRawKgiQuoteSnapshot(quote)) {
    const [bidAskResult, ticksResult] = await Promise.allSettled([
      getKgiBidAsk(selectedSymbol),
      getKgiTicks(selectedSymbol, 16),
    ]);
    bidAsk = okValue(bidAskResult, null);
    ticks = okValue(ticksResult, null);
  }
  const ohlcv = company
    ? await getCompanyOhlcv(company.id, { interval: "1d", from: tradingRoomOhlcvFromDate() }).catch(() => [] as OhlcvBar[])
    : [];
  const lastBar = latestOhlcv(ohlcv);
  const prevBar = ohlcv.length > 1 ? ohlcv[ohlcv.length - 2] ?? null : null;
  const quoteSnapshot = resolveTradingRoomQuoteSnapshot(
    quote,
    lastBar,
    prevBar,
    selectedPosition?.avgCostPerShare ?? null,
  );
  const lastPrice = quoteSnapshot.lastPrice;
  const previous = quoteSnapshot.previous;
  const change = quoteSnapshot.change;
  const changePct = quoteSnapshot.changePct;

  const defaultWatchlist = DEFAULT_TRADING_ROOM_WATCHLIST.map((item) => ({
    symbol: item.symbol,
    name: item.name,
    meta: item.meta,
    price: item.symbol === selectedSymbol ? lastPrice : null,
    changePct: item.symbol === selectedSymbol ? changePct : null,
  }));
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
    ...defaultWatchlist,
  ]
    .filter((item, index, arr) => arr.findIndex((other) => sameSymbol(other.symbol, item.symbol)) === index);

  return {
    screen: "paper-trading-room" as const,
    generatedAt: new Date().toISOString(),
    health,
    baseCapitalTWD,
    fauto,
    selected: {
      symbol: selectedSymbol,
      name: company?.name ?? selectedSymbol,
      sector: industryLabel(company?.chainPosition ?? selectedIdea?.sector ?? "台股"),
      price: lastPrice,
      open: quoteSnapshot.open,
      high: quoteSnapshot.high,
      low: quoteSnapshot.low,
      close: lastPrice,
      previous,
      change,
      changePct,
      volume: quoteSnapshot.volume,
      quoteState: quote?.state ?? "NO_DATA",
    },
    watchlist,
    ideas: mappedIdeas,
    portfolio,
    orders,
    fills,
    utaOrders,
    kgi,
    kgiStatus,
    dataStates: {
      health: settledState(healthResult),
      portfolio: settledState(portfolioRawResult),
      fills: settledState(fillsResult),
      orders: settledState(ordersResult),
      utaOrders: settledState(utaOrdersResult),
      kgi: settledState(kgiResult),
      kgiStatus: settledState(kgiStatusResult),
      ideas: settledState(ideasResult),
    },
    ohlcv,
    bidAsk,
    ticks: ticks?.ticks ?? [],
    prefill,
    _companyId: company?.id ?? null,
    _companyIdSymbol: selectedSymbol,
  };
}

export async function buildFinalV031LivePayload(screen: FinalV031Screen, options: FinalV031PayloadOptions = {}) {
  try {
    if (screen === "market-intel") return await buildMarketIntelPayload();
    if (screen === "strategy-ideas") return await buildIdeasPayload();
    if (options.fastPaperShell) return buildPaperFastShellPayload(options);
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
  let currentPaperSymbol = null;
  const apiBaseRaw = String(window.__IUF_FINAL_V031_API_BASE__ || "");
  const apiBase = apiBaseRaw.endsWith("/") ? apiBaseRaw.slice(0, -1) : apiBaseRaw;
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
  const directApiUrl = (path) => apiBase ? apiBase + path : null;
  const apiFetch = async (path, init={}) => {
    const method = (init.method || "GET").toUpperCase();
    const requestInit = {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", "x-workspace-slug": workspaceSlug, ...(init.headers || {}) }
    };
    const res = await fetch(apiUrl(path), requestInit);
    const direct = directApiUrl(path);
    if (method === "GET" && direct && (res.status === 401 || res.status === 403)) {
      return fetch(direct, requestInit);
    }
    return res;
  };
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
  // ── Unified order flow (統一下單流 D1/D5, 2026-07-09) ────────────────────
  // Single submit entry point for both paper and KGI SIM tickets — replaces
  // the old dual path (/api/ui-final-v031-paper/submit + direct
  // /api/v1/kgi/sim/order fetch). Reason-code vocab below mirrors
  // apps/web/lib/paper-order-vocab.ts's label-map + graceful-fallback
  // pattern; inlined (not imported) because this whole block ships as a raw
  // <script> string with no bundler import access — see
  // app/api/ui-final-v031/[screen]/route.ts's injectLiveData().
  const KGI_CHANNEL_REASON_LABELS = {
    not_sim_env: "目前 KGI 模擬環境未啟用，暫時無法送出模擬單",
    unsupported_order_type: "KGI 模擬單不支援此委託類型",
    missing_limit_price: "限價單需要填入有效的委託價格",
    gateway_unreachable: "目前連不到凱基模擬交易主機，請稍後再試",
    gateway_auth_error: "凱基模擬交易連線驗證失敗，請確認連線狀態",
    gateway_not_logged_in: "凱基模擬帳號尚未登入，請確認連線狀態",
    live_order_blocked: "正式下單目前鎖定中，僅能使用模擬單",
    order_not_enabled: "凱基模擬下單功能目前未開啟",
    order_validation_rejected: "凱基模擬單未通過委託格式檢查，請確認欄位",
    order_upstream_error: "凱基模擬交易主機處理委託時發生錯誤，請稍後再試",
    unknown_error: "凱基模擬單送出失敗，原因不明，請稍後再試"
  };
  const kgiChannelReasonLabel = (reason) => KGI_CHANNEL_REASON_LABELS[String(reason || "")] || "凱基模擬單無法送出，請稍後再試";
  // 委託回報面板 (D3, 2026-07-10): mirrors unifiedOrderStatusLabel()/
  // unifiedOrderChannelLabel() in lib/paper-orders-api.ts — inlined here for
  // the same no-bundler-import-access reason as KGI_CHANNEL_REASON_LABELS
  // above. Four visual states map onto the existing .st.{filled|pending|
  // cancelled|rejected} CSS already shipped in trading.css: pending/submitted/
  // partial_fill are all "still in flight" (amber "pending" look), each with
  // its own honest Chinese label — never the raw enum.
  const UTA_ORDER_STATUS_LABELS = {
    pending: "待送出",
    submitted: "已受理",
    partial_fill: "部分成交",
    filled: "已成交",
    cancelled: "已撤單",
    rejected: "已拒絕"
  };
  const utaOrderStatusLabel = (status) => UTA_ORDER_STATUS_LABELS[String(status || "")] || "狀態同步中";
  const utaOrderStatusClass = (status) => status === "filled" ? "filled" : status === "cancelled" ? "cancelled" : status === "rejected" ? "rejected" : "pending";
  const utaOrderChannelLabel = (adapterKey) => adapterKey === "kgi" ? "凱基 SIM" : adapterKey === "paper" ? "紙上" : adapterKey === "fubon" ? "富邦" : (adapterKey || "—");
  const RISK_GUARD_LABELS = {
    max_per_trade: "單筆風控上限",
    max_daily_loss: "單日損失上限",
    max_single_position: "單一部位上限",
    max_theme_correlated: "主題關聯曝險上限",
    max_gross_exposure: "總曝險上限",
    max_open_orders: "未平倉委託上限",
    max_orders_per_minute: "每分鐘委託上限",
    max_absolute_notional: "模擬金額上限",
    symbol_whitelist: "白名單限制",
    symbol_blacklist: "黑名單限制",
    duplicate_order: "重複委託防呆",
    stale_quote: "報價過舊",
    trading_hours: "交易時段",
    broker_disconnected: "券商連線中斷",
    reconcile_mismatch: "對帳不一致",
    kill_switch: "停止交易開關",
    manual_disable: "人工停用"
  };
  const riskGuardLabel = (key) => RISK_GUARD_LABELS[String(key || "")] || String(key || "").replace(/_/g, " ");
  // Builds the Chinese "why blocked" line from a SubmitOrderResult-shaped
  // body (order:null, riskCheck, blocked:true, quoteGate) — the 422 shape
  // POST /trading/orders returns when risk or the quote gate rejects.
  const unifiedBlockedMessage = (data) => {
    const guards = data && data.riskCheck && Array.isArray(data.riskCheck.guards) ? data.riskCheck.guards : [];
    const blockedGuards = guards.filter((g) => g && g.decision === "block").map((g) => riskGuardLabel(g.guard));
    if (blockedGuards.length) return "未通過：" + blockedGuards.join("、");
    const gate = data && data.quoteGate;
    if (gate && gate.blocked) {
      if (gate.freshnessStatus === "stale") return "報價過舊，暫不能送出委託";
      if (gate.readiness === "blocked") return "報價資料目前不可用";
      return "報價檢查未通過，暫不能送出委託";
    }
    return "委託未通過風控檢查";
  };
  // Account picker (D6 prerequisite for D1): resolves the accountId the
  // active broker should submit under. Full account-strip UI (badges,
  // localStorage active-account memory) is a separate slice — this is only
  // enough to route submits correctly. Cached per hydration pass; a fetch
  // failure degrades to an empty accountId, which the submit-time guard
  // below refuses to send for the KGI channel (never silently misroutes a
  // KGI-intended order to paper).
  let accountsCache = null;
  const loadBrokerAccounts = async () => {
    // D6 (2026-07-09): the account strip (hydrateBrokerStrip) already fetches
    // GET /uta/accounts on every hydratePaper() refresh for badge rendering —
    // reuse that instead of a second round-trip when it's already populated.
    if (Array.isArray(live.accounts) && live.accounts.length) return live.accounts;
    if (accountsCache) return accountsCache;
    try {
      accountsCache = await apiGet("/api/v1/uta/accounts");
    } catch {
      accountsCache = [];
    }
    return accountsCache;
  };
  const accountIdForBroker = (brokerKey, accounts) => {
    const wantKey = brokerKey === "kgi" ? "kgi" : "paper";
    const match = (accounts || []).find((a) => a && a.adapterKey === wantKey);
    return match ? String(match.id) : "";
  };
  const submitUnifiedOrder = async (payload) => {
    const res = await apiFetch("/api/v1/trading/orders", { method: "POST", body: JSON.stringify(payload) });
    const body = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  };
  const soft = (promise) => promise.then((data) => ({ ok:true, data })).catch((error) => ({ ok:false, error }));
  const softState = (result) => result && result.ok ? "live" : "blocked";
  function shouldFetchRawKgiQuote(quote) {
    const source = String(quote?.source || "").toLowerCase();
    const state = String(quote?.state || "").toUpperCase();
    const freshness = String(quote?.freshness || "").toLowerCase();
    return source === "kgi-gateway" && (state === "LIVE" || freshness === "fresh");
  }
  async function fetchRawKgiQuoteExtras(symbol, quote) {
    if (!shouldFetchRawKgiQuote(quote)) {
      return {
        skipped:true,
        bidAskResult:{ ok:true, data:null, skipped:true },
        ticksResult:{ ok:true, data:{ ticks:[] }, skipped:true }
      };
    }
    const [bidAskResult, ticksResult] = await Promise.all([
      soft(apiGet("/api/v1/kgi/quote/bidask?symbol=" + encodeURIComponent(symbol))),
      soft(apiGet("/api/v1/kgi/quote/ticks?symbol=" + encodeURIComponent(symbol) + "&limit=16"))
    ]);
    return { skipped:false, bidAskResult, ticksResult };
  }
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
    if (source === "ai_recommendations") return "AI 推薦帶入";
    if (source === "strategy_home") return "首頁策略帶入";
    if (source === "home_paper_preview") return "首頁紙上交易帶入";
    if (source === "strategy_run") return "策略執行紀錄帶入";
    return "網址參數帶入";
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
  const sameSym = (left, right) => String(left || "").trim().toUpperCase() === String(right || "").trim().toUpperCase();
  if (live.screen === "paper-trading-room") {
    const seededSymbol = String(paperPrefill()?.symbol || live.selected?.symbol || "2330").trim().toUpperCase();
    currentPaperSymbol = /^[0-9A-Z._-]{2,16}$/.test(seededSymbol) ? seededSymbol : "2330";
  }
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
  const isTwTicker = (value) => /^[0-9]{4}[A-Z]?$/.test(String(value || "").trim());
  const companyHref = (symbol) => isTwTicker(symbol) ? "/companies/" + encodeURIComponent(String(symbol)) : "/companies";
  const recommendationHref = (symbol) => isTwTicker(symbol) ? "/ai-recommendations?symbol=" + encodeURIComponent(String(symbol)) : "/ai-recommendations";
  const topicHref = (tag) => "/themes?query=" + encodeURIComponent(String(tag || "市場情報"));
  const marketFeedState = (items, news, announcements, newsOk, announcementsOk) => {
    if (items.length > 0) {
      const source = news?.items?.length ? "AI 精選" : "官方公告 fallback";
      return {
        state: news?.items?.length ? "live" : "partial",
        label: news?.items?.length ? "AI 精選已回傳" : "官方公告 fallback",
        summary: "顯示 " + items.length + " 則 " + source,
        detail: news?.selection_mode === "ai" ? "AI selector 已完成今日篩選。" : "使用正式公告或備援排序；未顯示示意新聞。",
        nextAction: "持續比對 AI 推薦股票、公司頁與主題頁連結。"
      };
    }
    const details = [
      newsOk ? null : "news-top10 未回傳",
      announcementsOk ? null : "announcements 未回傳",
      news?.stale_reason ? "stale_reason: " + news.stale_reason : null,
      announcements?.source ? "announcements source: " + announcements.source : null
    ].filter(Boolean).join("；");
    return {
      state: "empty",
      label: "等待正式資料",
      summary: "目前沒有可呈現的正式 AI 精選市場情報",
      detail: details || "後端尚未回傳今日 AI 精選或官方公告項目。",
      nextAction: "等待下一輪市場情報同步；前端不顯示示意新聞。"
    };
  };
  const setText = (sel, value) => { const node = $(sel); if (node) node.textContent = value; };
  const setCount = (label, value) => {
    const stat = $$(".taskhdr .stat").find((node) => node.textContent.includes(label));
    const val = stat && $(".v", stat);
    if (val) val.textContent = String(value ?? "0");
  };

  // Mirror of cleanHeadline — strip publisher tails like "｜新聞快訊｜豐雲學堂 - sinotrade.com.tw".
  function clientCleanHeadline(raw) {
    let text = String(raw || "").trim();
    text = text.replace(/\s+-\s+[\w.-]+\.(?:com|net|org|tw|cn|io)(?:\.\w+)?\s*$/i, "");
    while (true) {
      const m = text.match(/^(.*)[｜|]([^｜|]{1,16})$/);
      if (!m || /[，。,.!?]/.test(m[2])) break;
      text = m[1].trim();
    }
    return text.trim() || String(raw || "").trim();
  }

  // Mirror of nextRefreshText — formats a FUTURE schedule time, never「剛剛」.
  function clientNextRefreshText(iso) {
    if (!iso) return "排程中";
    const ms = Date.parse(iso) - Date.now();
    if (!Number.isFinite(ms)) return "排程中";
    if (ms <= 60000) return "即將更新";
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return minutes + " 分鐘後";
    return Math.round(minutes / 60) + " 小時後";
  }

  function clientNewsItem(item, index) {
    const title = clientCleanHeadline(item.headline || item.title || "正式市場訊息");
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
      rank: item.rank || index + 1,
      companyHref: companyHref(item.ticker || item.symbol),
      recommendationHref: recommendationHref(item.ticker || item.symbol),
      topicHref: topicHref(tag)
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
      rank: index + 1,
      companyHref: companyHref(item.ticker || item.symbol),
      recommendationHref: recommendationHref(item.ticker || item.symbol),
      topicHref: topicHref(tag)
    };
  }

  // Mirror of the server-side ideaReasonText — engineering reason codes must not
  // surface under「為什麼被選出」(6/10 audit).
  function clientIdeaReasonText(raw) {
    const value = String(raw || "").trim();
    if (!value) return "候選理由待資料補齊。";
    const labels = {
      "fallback:higher_priority_stale": "即時報價暫時過期，已改用備援報價來源評估。",
      "fallback:higher_priority_missing": "即時報價缺漏，已改用備援報價來源評估。",
      "fallback:higher_priority_unavailable": "即時報價來源暫停，已改用備援報價來源評估。",
      "fallback:no_fresh_quote": "目前沒有新鮮報價，暫以最近可用資料評估。",
      "fallback:no_quote": "目前沒有可用報價，此候選僅供觀察。",
      "stale:age_exceeded": "報價已超過新鮮度上限，評估僅供參考。",
      "stale:missing_last": "缺少最新成交價，評估僅供參考。",
      "stale:no_quote": "目前沒有可用報價，評估僅供參考。",
      "stale:provider_unavailable": "報價供應來源暫停，評估僅供參考。",
      "synthetic_source": "使用合成參考價，評估僅供參考。",
      "non_live_source": "使用非即時資料來源評估。",
      "provider_disconnected": "報價連線中斷，評估僅供參考。",
      "missing_quote": "缺少報價資料，此候選僅供觀察。"
    };
    return labels[value] || value;
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
      reason: clientIdeaReasonText(item.rationale?.primaryReason || item.marketData?.primaryReason),
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
    const annItems = (announcements?.items || []).filter((item) => {
      const source = String(item.source || "").toLowerCase();
      const title = String(item.title || "") + " " + String(item.body || "");
      if (source.includes("finmind_stock_news")) return false;
      if (/cmoney|money-link|yahoo|udn|pchome|小編|新聞網|news/i.test(title)) return false;
      return source.includes("twse") || source.includes("mops") || source.includes("announcement");
    }).map(clientAnnouncementItem);
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
    const feedState = marketFeedState(items, news, announcements, newsResult.ok, announcementResult.ok);
    return {
      screen: "market-intel",
      generatedAt: new Date().toISOString(),
      stats: {
        total: Math.max(news?.input_row_count || 0, items.length),
        aiSelected: news?.items?.length || 0,
        sourceOk: [mopsLive, finMindLive, aiLive].filter(Boolean).length,
        sourceTotal: 3,
        nextRefresh: clientNextRefreshText(news?.next_refresh_at)
      },
      topicCounts: { all: items.length, ai: counts.ai || 0, semi: counts.semi || 0, fin: counts.fin || 0, auto: counts.auto || 0 },
      items,
      feedState,
      sources: [
        { name:"公開資訊觀測站", label:mopsLive ? "官方公告進入市場情報 " + (announcements?.items?.length || 0) + " 則" : "目前無可呈現公告", state:mopsLive ? "ok" : "warn", status:mopsLive ? "正常" : "待確認", fresh: announcements?.items?.[0]?.date ? ago(announcements.items[0].date) : "尚未同步" },
        { name:"FinMind 市場資料", label:finMindLive ? "市場資料源可用" : "市場資料源同步中", state:finMindLive ? "ok" : "warn", status:finMindLive ? "正常" : "待確認", fresh: finMind?.updatedAt ? ago(finMind.updatedAt) : "尚未同步" },
        { name:"AI 精選訊息", label:aiLive ? "AI 精選已回傳 " + (news?.items?.length || 0) + " 則" : "AI 精選尚無可顯示項目", state:aiLive ? "ok" : "warn", status:aiLive ? (news?.selection_mode === "ai" ? "AI 篩選" : "備援") : "待回傳", fresh: news?.as_of ? ago(news.as_of) : "尚未同步" }
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

  function numVal(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function firstNum() {
    for (let i = 0; i < arguments.length; i++) {
      const n = numVal(arguments[i]);
      if (n !== null) return n;
    }
    return null;
  }
  function resolvePaperQuoteSnapshot(quote, lastBar, prevBar, fallbackPrice) {
    const lastPrice = firstNum(quote?.lastPrice, lastBar?.close, fallbackPrice);
    const previous = firstNum(quote?.prevClose, quote?.previousClose, quote?.referencePrice, quote?.yesterdayClose, prevBar?.close);
    const computedChange = lastPrice !== null && previous !== null ? Number((lastPrice - previous).toFixed(2)) : null;
    const computedPct = computedChange !== null && previous ? Number(((computedChange / previous) * 100).toFixed(2)) : null;
    return {
      lastPrice,
      open: firstNum(quote?.open, lastBar?.open, lastPrice),
      high: firstNum(quote?.high, lastBar?.high, lastPrice),
      low: firstNum(quote?.low, lastBar?.low, lastPrice),
      previous,
      change: computedChange ?? firstNum(quote?.change),
      changePct: computedPct ?? firstNum(quote?.changePct),
      volume: firstNum(quote?.volume, lastBar?.volume)
    };
  }

  async function clientPaperPayload() {
    const [healthResult, portfolioRawResult, fillsResult, ordersResult, utaOrdersResult, kgiResult, kgiStatusResult, ideasResult, fautoResult, watchlistResult] = await Promise.all([
      soft(apiGet("/api/v1/paper/health")),
      soft(apiGetRaw("/api/v1/paper/portfolio")),
      soft(apiGet("/api/v1/paper/fills")),
      soft(apiGet("/api/v1/paper/orders")),
      soft(apiGet("/api/v1/uta/orders?limit=20")),
      soft(apiGet("/api/v1/portfolio/kgi/positions")),
      soft(apiGet("/api/v1/kgi/status")),
      soft(apiGet("/api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&limit=8&sort=score")),
      soft(apiGetRaw("/api/v1/portfolio/f-auto")),
      soft(apiGet("/api/v1/watchlist"))
    ]);
    const fauto = fautoResult.ok ? fautoResult.data : null;
    // Account strip (統一下單流 D6, 2026-07-09): reads GET /uta/accounts, which
    // #1165 (PR-2) now seeds with a baseline paper + kgi row per workspace so
    // it's never empty. Replaces the old /uta/adapters catalog fetch (that
    // endpoint carries no gatewayStatus and pre-dated account seeding — see
    // final-v031-live.ts's original 2026-06-24 comment, since removed).
    // Fubon stays excluded here too — its strip button is static/disabled in
    // the vendor HTML and never becomes selectable.
    let accounts = [];
    let accountsFetchFailed = false;
    try {
      const accountsRes = await soft(apiGet("/api/v1/uta/accounts"));
      if (accountsRes.ok && Array.isArray(accountsRes.data)) {
        accounts = accountsRes.data.filter((a) => a && a.adapterKey && a.adapterKey !== 'fubon');
      } else {
        // Query failed (network/5xx) or returned a malformed body — distinct
        // from "account genuinely unpaired", which is a real gatewayStatus
        // value inside a successful response. hydrateBrokerStrip renders a
        // separate 查詢失敗 badge for this case so the operator isn't told a
        // paired account is unpaired just because the read failed.
        accountsFetchFailed = true;
      }
    } catch {
      // fallback to HTML static strip — safe to ignore
      accountsFetchFailed = true;
    }
    // User-managed watchlist (replaces the hardcoded default symbols). { data: [{symbol,name}] }.
    const myWatchlist = (watchlistResult.ok
      ? ((watchlistResult.data?.data) || (Array.isArray(watchlistResult.data) ? watchlistResult.data : []))
      : []) || [];
    const portfolioEnvelope = portfolioRawResult.ok ? portfolioRawResult.data : null;
    const portfolio = (portfolioEnvelope && Array.isArray(portfolioEnvelope.data) ? portfolioEnvelope.data : (portfolioRawResult.ok && Array.isArray(portfolioRawResult.data) ? portfolioRawResult.data : []));
    const baseCapitalTWD = portfolioRawResult.ok ? ((portfolioEnvelope?.summary?.baseCapitalTWD) ?? null) : null;
    const fills = fillsResult.ok ? fillsResult.data || [] : [];
    const orders = ordersResult.ok ? ordersResult.data || [] : [];
    // D3 委託回報面板 (2026-07-10): mirrors isUnifiedOrderFromTaipeiToday() in
    // lib/paper-orders-api.ts — inlined here because this whole block ships as
    // a raw <script> string with no bundler import access.
    const utaOrdersAllRaw = (utaOrdersResult.ok && utaOrdersResult.data && Array.isArray(utaOrdersResult.data.orders)) ? utaOrdersResult.data.orders : [];
    const utaTaipeiDateKey = (epochMs) => new Date(epochMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const utaTodayKey = utaTaipeiDateKey(Date.now());
    const utaOrders = utaOrdersAllRaw.filter((row) => { const t = Date.parse(row.createdAt); return Number.isFinite(t) && utaTaipeiDateKey(t) === utaTodayKey; });
    const ideas = ideasResult.ok ? (ideasResult.data?.items || []).map(clientMapIdea) : [];
    const prefill = paperPrefill();
    const selectedSymbol = currentPaperSymbol || prefill?.symbol || portfolio[0]?.symbol || ideas[0]?.symbol || "2330";
    const selectedPosition = portfolio.find((pos) => sameSym(pos.symbol, selectedSymbol)) || null;
    const selectedIdea = ideas.find((idea) => sameSym(idea.symbol, selectedSymbol)) || ideas[0] || null;
    const companiesResult = await soft(apiGet("/api/v1/companies?ticker=" + encodeURIComponent(selectedSymbol)));
    const company = companiesResult.ok ? (companiesResult.data || [])[0] || null : null;
    const ohlcvFrom = new Date();
    ohlcvFrom.setFullYear(ohlcvFrom.getFullYear() - 10);
    const ohlcvFromParam = ohlcvFrom.toISOString().slice(0, 10);
    const [quoteResult, ohlcvResult] = await Promise.all([
      company ? soft(apiGet("/api/v1/companies/" + encodeURIComponent(company.id) + "/quote/realtime")) : soft(Promise.resolve(null)),
      company ? soft(apiGet("/api/v1/companies/" + encodeURIComponent(company.id) + "/ohlcv?interval=1d&from=" + encodeURIComponent(ohlcvFromParam))) : soft(Promise.resolve([])),
    ]);
    const ohlcv = ohlcvResult.ok ? ohlcvResult.data || [] : [];
    const lastBar = ohlcv.length ? ohlcv[ohlcv.length - 1] : null;
    const prevBar = ohlcv.length > 1 ? ohlcv[ohlcv.length - 2] : null;
    const quote = quoteResult.ok ? quoteResult.data : null;
    const rawQuoteExtras = await fetchRawKgiQuoteExtras(selectedSymbol, quote);
    const bidAskResult = rawQuoteExtras.bidAskResult;
    const ticksResult = rawQuoteExtras.ticksResult;
    const quoteSnapshot = resolvePaperQuoteSnapshot(quote, lastBar, prevBar, selectedPosition?.avgCostPerShare ?? null);
    const lastPrice = quoteSnapshot.lastPrice;
    const previous = quoteSnapshot.previous;
    const change = quoteSnapshot.change;
    const changePct = quoteSnapshot.changePct;
    const prefillSymbol = String(prefill?.symbol || "").trim().toUpperCase();
    const selectedSymbolUpper = String(selectedSymbol || "").trim().toUpperCase();
    const prefillMatchesSelected = !!prefill?.enabled && selectedSymbolUpper && (!prefillSymbol || prefillSymbol === selectedSymbolUpper);
    // User-managed watchlist drives the desk's symbol universe (was a hardcoded 8).
    // A brand-new user with an empty list gets 2330 as a starting seed.
    const myWatchlistSeed = myWatchlist.length ? myWatchlist : [{ symbol: "2330", name: "台積電" }];
    const defaultWatchlist = myWatchlistSeed.map((item) => ({ symbol:item.symbol, name:item.name || item.symbol, meta:"自選", price:sameSym(item.symbol, selectedSymbol) ? lastPrice : null, changePct:sameSym(item.symbol, selectedSymbol) ? changePct : null }));
    const prefillWatch = prefillMatchesSelected ? [{ symbol:selectedSymbol, name:company?.name || selectedSymbol, meta:prefill.recommendationId ? paperPrefillSourceLabel(prefill.source) + " · " + prefill.recommendationId : paperPrefillSourceLabel(prefill.source), price:lastPrice, changePct }] : [];
    const watchlist = prefillWatch.concat(portfolio.map((pos) => ({ symbol:pos.symbol, name:pos.symbol, meta:String(pos.netQtyShares || 0) + " 股 · " + String(pos.fillCount || 0) + " 筆成交", price:pos.symbol === selectedSymbol ? lastPrice : pos.avgCostPerShare, changePct:pos.symbol === selectedSymbol ? changePct : null })))
      .concat(ideas.map((idea) => ({ symbol:idea.symbol, name:idea.companyName, meta:idea.status + " · " + idea.signalCount + " 訊號", price:null, changePct:null })))
      .concat(defaultWatchlist)
      .filter((item, index, arr) => arr.findIndex((other) => sameSym(other.symbol, item.symbol)) === index);
    return {
      screen:"paper-trading-room",
      generatedAt:new Date().toISOString(),
      health: healthResult.ok ? healthResult.data : null,
      baseCapitalTWD,
      fauto,
      selected:{ symbol:selectedSymbol, name:company?.name || selectedSymbol, sector:industryLabel(company?.chainPosition || selectedIdea?.sector || "台股"), price:lastPrice, open:quoteSnapshot.open, high:quoteSnapshot.high, low:quoteSnapshot.low, close:lastPrice, previous, change, changePct, volume:quoteSnapshot.volume, quoteState:quote?.state || "NO_DATA" },
      watchlist,
      myWatchlist: defaultWatchlist,
      myWatchlistCount: myWatchlist.length,
      ideas,
      portfolio,
      orders,
      fills,
      utaOrders,
      kgi:kgiResult.ok ? kgiResult.data : null,
      kgiStatus:kgiStatusResult.ok ? kgiStatusResult.data : null,
      dataStates:{
        health:softState(healthResult),
        portfolio:softState(portfolioRawResult),
        fills:softState(fillsResult),
        orders:softState(ordersResult),
        utaOrders:softState(utaOrdersResult),
        kgi:softState(kgiResult),
        kgiStatus:softState(kgiStatusResult),
        ideas:softState(ideasResult)
      },
      ohlcv,
      bidAsk:bidAskResult.ok ? bidAskResult.data : null,
      ticks:ticksResult.ok ? (ticksResult.data?.ticks || []) : [],
      accounts,
      accountsFetchFailed,
      prefill,
      _companyId: company?.id ?? null,
      _companyIdSymbol: selectedSymbol,
    };
  }

  async function selectPaperSymbol(symbol) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!/^[0-9A-Z._-]{2,16}$/.test(normalized)) return;
    closePaperQuoteStream("symbol_changing");
    const activePrefill = paperPrefill();
    const activePrefillSymbol = String(activePrefill?.symbol || "").trim().toUpperCase();
    const shouldClearPrefill = !!activePrefill?.enabled && activePrefillSymbol && activePrefillSymbol !== normalized;
    currentPaperSymbol = normalized;
    live = Object.assign({}, live, {
      selected: { symbol: normalized, name: "載入中", quoteState: "LOADING" },
      bidAsk: null,
      ticks: [],
      _companyId: null,
      _companyIdSymbol: null,
    });
    window.__IUF_FINAL_V031_LIVE__ = live;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('symbol', normalized);
      if (shouldClearPrefill) {
        ["entry", "stop", "tp", "from_rec", "recommendationId", "side"].forEach((key) => url.searchParams.delete(key));
      }
      window.history.replaceState(null, '', url);
    } catch {
      // ignore history failures in embedded contexts
    }
    const rows = $$('.wrow');
    rows.forEach((row) => row.classList.toggle('on', String(row.dataset.sym || '').toUpperCase() === normalized));
    setText('.symhead .sym', normalized);
    setText('.symhead .nm', '載入中');
    const immediateSymInput = $("#t-sym");
    if (immediateSymInput) {
      immediateSymInput.value = normalized;
      immediateSymInput.setAttribute("value", normalized);
    }
    removeMismatchedPaperPrefill(normalized, activePrefill);
    await refreshClientLive();
    openPaperQuoteStream();
  }
  window.__IUF_SELECT_PAPER_SYMBOL__ = selectPaperSymbol;

  function removeMismatchedPaperPrefill(symbol, snapshotPrefill = null) {
    const selectedSymbol = String(symbol || "").trim().toUpperCase();
    const activePrefill = snapshotPrefill || paperPrefill();
    const prefillSymbol = String(activePrefill?.symbol || "").trim().toUpperCase();
    if (!selectedSymbol || !prefillSymbol || prefillSymbol === selectedSymbol) return false;
    const existing = $("#rec-prefill-box");
    if (existing) existing.remove();
    [".lv-label.entry", ".lv-label.stop", ".lv-label.target"].forEach((selector) => {
      const node = $(selector);
      if (node) node.textContent = "";
    });
    const staleEntryPrice = firstNumber(activePrefill?.entry);
    const priceInput = $("#t-price");
    const currentPrice = firstNumber(priceInput?.value);
    if (priceInput && staleEntryPrice != null && currentPrice === staleEntryPrice) {
      priceInput.value = "";
      priceInput.setAttribute("value", "");
    }
    return true;
  }

  function attachPaperRowHandlers() {
    $$('.wrow').forEach((row) => {
      if (row.dataset.iufEnhanced === '1') return;
      row.dataset.iufEnhanced = '1';
      row.addEventListener('click', (event) => {
        if (event.target?.closest?.(".wldel, .wladd")) return;
        const sym = row.dataset.sym;
        if (!sym) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (typeof window.pickRow === "function") {
          window.pickRow(sym);
        } else if (typeof window.updateRealChartFrame === "function") {
          window.updateRealChartFrame(sym);
        }
        selectPaperSymbol(sym).catch((error) => {
          window.__IUF_FINAL_V031_CLIENT_ERROR__ = error instanceof Error ? error.message : 'symbol_select_failed';
        });
      }, true);
    });
  }

  let paperSearchTimer = null;
  function renderPaperSearchResults(results, query) {
    const wl = $('#wl-my');
    if (!wl) return;
    let group = wl.querySelector('.group');
    if (!group) {
      group = document.createElement('div');
      group.className = 'group';
      wl.prepend(group);
    }
    wl.querySelectorAll('[data-search-result="1"]').forEach((el) => el.remove());
    if (!query) {
      group.textContent = String((live.watchlist || []).length || 0) + ' 檔自選 / 候選';
      wl.querySelectorAll('.wrow').forEach((row) => { row.style.display = ''; });
      return;
    }
    wl.querySelectorAll('.wrow').forEach((row) => {
      if (row.dataset.searchResult !== '1') row.style.display = 'none';
    });
    if (!Array.isArray(results) || results.length === 0) {
      group.textContent = '找不到符合的股票';
      return;
    }
    group.textContent = '搜尋結果 · ' + results.length + ' 檔（全 1900+ 台股可搜）';
    let anchor = group;
    for (const match of results) {
      const ticker = String(match.ticker || '').toUpperCase();
      if (!ticker) continue;
      const row = document.createElement('div');
      row.className = 'wrow';
      row.dataset.searchResult = '1';
      row.dataset.sym = ticker;
      row.style.cursor = 'pointer';
      row.innerHTML = '<span class="sym">' + esc(ticker) + '</span><div class="body"><div class="nm">' + esc(match.name || ticker) + '</div><div class="meta">' + esc(industryLabel(match.sector || '台股')) + '</div></div><div class="price"><span class="v">--</span><span class="d flat">點選載入</span></div>';
      if (anchor.parentNode) anchor.parentNode.insertBefore(row, anchor.nextSibling);
      anchor = row;
    }
    attachPaperRowHandlers();
  }

  function _unused_renderPaperSearchResult_legacy(match, query) {
    const wl = $('#wl-my');
    if (!wl) return;
    let group = wl.querySelector('.group');
    if (!group) {
      group = document.createElement('div');
      group.className = 'group';
      wl.prepend(group);
    }
    if (match && match.error === "blocked") {
      group.textContent = "\u641c\u5c0b\u8cc7\u6599\u672a\u6388\u6b0a";
      wl.querySelectorAll('.wrow').forEach((row) => {
        row.style.display = 'none';
      });
      let row = wl.querySelector('[data-search-result="1"]');
      if (!row) {
        row = document.createElement('div');
        row.className = 'wrow';
        row.dataset.searchResult = '1';
        wl.insertBefore(row, group.nextSibling);
      }
      row.removeAttribute('data-sym');
      row.style.display = '';
      row.innerHTML = '<span class="sym">AUTH</span><div class="body"><div class="nm">\u9700\u8981\u767b\u5165\u5f8c\u624d\u80fd\u641c\u5c0b\u53f0\u80a1</div><div class="meta">\u672a\u6388\u6b0a\u6642\u4e0d\u986f\u793a\u9810\u8a2d\u5047\u7d50\u679c</div></div>';
      return;
    }
    if (!match) {
      group.textContent = query ? '找不到符合的股票' : String((live.watchlist || []).length || 0) + ' 檔自選 / 候選';
      wl.querySelectorAll('.wrow').forEach((row) => {
        row.style.display = query ? 'none' : '';
      });
      return;
    }
    const ticker = String(match.ticker || '').toUpperCase();
    group.textContent = '搜尋結果';
    wl.querySelectorAll('.wrow').forEach((row) => {
      row.style.display = String(row.dataset.sym || '').toUpperCase() === ticker ? '' : 'none';
    });
    let row = wl.querySelector('[data-search-result="1"]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'wrow';
      row.dataset.searchResult = '1';
      wl.insertBefore(row, group.nextSibling);
    }
    row.dataset.sym = ticker;
    row.style.display = '';
    row.innerHTML = '<span class="sym">' + esc(ticker) + '</span><div class="body"><div class="nm">' + esc(match.name || ticker) + '</div><div class="meta">' + esc(industryLabel(match.sector || '台股')) + '</div></div><div class="price"><span class="v">--</span><span class="d flat">點選載入</span></div>';
    attachPaperRowHandlers();
  }

  function attachPaperSearch() {
    const input = $('.lpane .search input');
    if (!input || input.dataset.iufSearchEnhanced === '1') return;
    input.dataset.iufSearchEnhanced = '1';
    const runSearch = async () => {
      const query = String(input.value || '').trim();
      if (!query) {
        renderPaperSearchResults([], '');
        return;
      }
      // Use new /search endpoint returning array (dropdown)
      const results = await apiGet('/api/v1/companies/search?q=' + encodeURIComponent(query) + '&limit=30').catch(() => null);
      if (!results || !Array.isArray(results)) {
        renderPaperSearchResults([], query);
        return;
      }
      renderPaperSearchResults(results, query);
    };
    input.addEventListener('input', () => {
      window.clearTimeout(paperSearchTimer);
      paperSearchTimer = window.setTimeout(() => {
        runSearch().catch((error) => {
          window.__IUF_FINAL_V031_CLIENT_ERROR__ = error instanceof Error ? error.message : 'search_failed';
        });
      }, 180);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const query = String(input.value || '').trim().toUpperCase();
      const row = $('#wl-my .wrow:not([style*="display: none"])');
      const sym = row?.dataset.sym || (/^[0-9A-Z._-]{2,16}$/.test(query) ? query : null);
      if (sym) selectPaperSymbol(sym).catch(() => {});
    });
  }

  async function refreshClientLive() {
    try {
      const next = live.screen === "market-intel"
        ? await clientMarketPayload()
        : live.screen === "strategy-ideas"
          ? await clientIdeasPayload()
          : await clientPaperPayload();
      if (
        live.screen === "paper-trading-room"
        && currentPaperSymbol
        && next?.selected?.symbol
        && !sameSym(next.selected.symbol, currentPaperSymbol)
      ) {
        window.__IUF_FINAL_V031_STALE_REFRESH_DROPPED__ = {
          expected: currentPaperSymbol,
          received: next.selected.symbol,
          at: new Date().toISOString(),
        };
        return;
      }
      if (live.screen === "paper-trading-room" && next?.selected) {
        next.selected = mergePaperSelectedWithLastGoodQuote(next.selected);
      }
      live = Object.assign({}, live, next, live.screen === "paper-trading-room" ? { fastShell:false } : {});
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
    window.__IUF_MARKET_AGE_LOCKED__ = true;
    const counts = live.topicCounts || {};
    [["all","全部"],["ai","AI 硬體"],["semi","半導體"],["fin","金融"],["auto","電動車"]].forEach(([key,label]) => {
      const btn = $$("#topicseg button").find((node) => node.textContent.includes(label));
      const c = btn && $(".c", btn);
      if (c) c.textContent = String(counts[key] ?? 0);
    });
    const feed = $("#feed");
    if (feed) {
      const items = live.items || [];
      const feedState = live.feedState || {};
      window.__IUF_MARKET_FEED_ITEMS__ = items;
      feed.removeAttribute("data-static-placeholder");
      feed.innerHTML = items.length ? items.map((item, i) => {
        const links = [
          item.companyHref ? '<a target="_top" href="'+esc(item.companyHref)+'">查看公司</a>' : '',
          item.topicHref ? '<a target="_top" href="'+esc(item.topicHref)+'">查看主題</a>' : '',
          item.recommendationHref ? '<a target="_top" href="'+esc(item.recommendationHref)+'">查看推薦</a>' : ''
        ].filter(Boolean).join('<span>·</span>');
        return '<div class="feedrow" style="--i:'+i+'" data-feed-index="'+i+'" data-cat="'+esc(item.category || "all")+'"><span class="sym">'+esc(item.symbol)+'</span><div class="body"><div class="t">'+esc(item.title)+'</div><div class="m"><span>'+esc(item.source)+'</span><span>·</span><span><b>'+esc(item.tag)+'</b></span>'+ (item.name ? '<span>·</span><span>'+esc(item.name)+'</span>' : '') + (links ? '<span>·</span>' + links : '') +'</div></div><div class="why"><b>為什麼重要</b>　'+esc(item.why)+'</div><span class="age">'+esc(item.age)+'</span><span class="arr">›</span></div>';
      }).join("") : '<div class="feedrow" data-cat="all"><span class="sym">DATA</span><div class="body"><div class="t">'+esc(feedState.summary || "目前沒有可呈現的正式 AI 精選市場情報")+'</div><div class="m"><span>AI 精選排程尚未回傳</span><span>·</span><span>不顯示示意新聞</span></div></div><div class="why"><b>狀態</b>　'+esc(feedState.nextAction || "等待下一輪市場情報同步；前端不顯示示意資料。")+'</div><span class="age">EMPTY</span><span class="arr">›</span></div>';
      if (typeof window.__IUF_APPLY_MARKET_FILTERS__ === "function") {
        window.__IUF_APPLY_MARKET_FILTERS__();
      }
    }
    const feedState = live.feedState || {};
    const feedPill = $("#market-feed-state-pill");
    if (feedPill) {
      const ok = (live.items || []).length > 0;
      feedPill.className = "pill " + (ok ? "ok" : "warn");
      feedPill.innerHTML = "<i></i>" + esc(feedState.label || (ok ? "正式資料已回傳" : "等待正式資料"));
    }
    const feedSummary = $("#market-feed-summary");
    if (feedSummary) {
      feedSummary.innerHTML = '<span>'+esc(feedState.summary || "等待正式資料源")+'</span><span>·</span><span>'+esc(feedState.detail || "不顯示示意新聞")+'</span>';
    }
    const feedback = $("#fbk span");
    if (feedback) {
      feedback.innerHTML = (live.items || []).length
        ? esc(feedState.detail || "正式資料已回傳；每則情報提供來源、為什麼重要與下一步 CTA。")
        : '目前 <b>沒有正式 AI 精選市場情報</b>。'+esc(feedState.nextAction || "等待下一輪市場情報同步；前端不顯示示意新聞。");
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
            ? "rgba(230,57,70," + alpha + ")"
            : tile.tone === "dn"
              ? "rgba(46,204,113," + alpha + ")"
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
          ? '<div style="font:11px/1.5 var(--sans);color:var(--fg-3);margin-top:6px">三大法人資料尚未完成今日回補；來源：FinMind / TWSE institutional summary。此區不補假數字。</div>'
          : ''
        );
    } else if (instPanel && !inst) {
      instPanel.innerHTML = '<div style="color:var(--fg-3);font:12px/1.8 var(--sans);text-align:left;padding:10px 12px;border:1px solid rgba(145,160,181,.16);border-radius:6px;background:rgba(17,24,34,.48)"><b style="color:var(--fg-1)">三大法人資料尚未回傳</b><br>需要資料源：FinMind TaiwanStockInstitutionalInvestorsBuySell / TWSE institutional summary。Owner：Jason data lane。下一步：盤後回補或修復 ingest；本頁不顯示假法人買賣超。</div>';
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

  function normalizeTickSymbol(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/\.TW$/, "")
      .replace(/[^0-9A-Z._-]/g, "");
  }

  function tickSymbolMatch(tick, symbol) {
    if (!tick || typeof tick !== "object" || !symbol) return null;
    const expected = normalizeTickSymbol(symbol);
    const keys = ["symbol", "stockNo", "stockId", "stock_id", "code", "ticker", "ch"];
    let sawSymbolField = false;
    for (const key of keys) {
      const raw = tick[key];
      if (raw == null || raw === "") continue;
      sawSymbolField = true;
      if (normalizeTickSymbol(raw) === expected) return true;
    }
    return sawSymbolField ? false : null;
  }

  function latestTick(ticks, symbol, allowUnlabeled = true) {
    const arr = Array.isArray(ticks) ? ticks.filter(Boolean) : [];
    if (!arr.length) return null;
    const compatible = arr.filter((tick) => {
      const match = tickSymbolMatch(tick, symbol);
      return match === true || (allowUnlabeled && match === null);
    });
    if (!compatible.length) return null;
    const scored = compatible.map((tick, index) => {
      const ts = Date.parse(tick._received_at || tick.datetime || tick.timestamp || tick.ts || "");
      return { tick, score: Number.isFinite(ts) ? ts : index };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored[scored.length - 1].tick;
  }

  function tickLastPrice(tick) {
    if (!tick) return null;
    const raw = tick.close ?? tick.price ?? tick.closePrice ?? tick.lastPrice ?? null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function paperPulseSymbol() {
    return String(currentPaperSymbol || live.selected?.symbol || "2330").trim().toUpperCase();
  }

  let paperQuoteStream = null;
  let paperQuoteStreamSymbol = null;
  let paperQuoteStreamLastMessageAt = 0;
  let paperQuoteStreamBackoffUntil = 0;
  let paperLastGoodQuote = null;

  function usableQuotePrice(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  function rememberPaperGoodQuote(selected, bidAsk, ticks) {
    if (!selected?.symbol || !sameSym(selected.symbol, paperPulseSymbol())) return;
    const lastPrice = usableQuotePrice(selected.price ?? selected.close ?? selected.lastPrice);
    if (lastPrice == null) return;
    paperLastGoodQuote = {
      symbol: String(selected.symbol).toUpperCase(),
      selected: Object.assign({}, selected, { price: lastPrice }),
      bidAsk: bidAsk !== undefined ? bidAsk : live.bidAsk,
      ticks: ticks !== undefined ? ticks : live.ticks,
      at: Date.now(),
    };
  }

  function mergePaperSelectedWithLastGoodQuote(selected) {
    const current = selected || {};
    const symbol = String(current.symbol || paperPulseSymbol() || "").toUpperCase();
    const currentPrice = usableQuotePrice(current.price ?? current.close ?? current.lastPrice);
    if (currentPrice != null) {
      return usableQuotePrice(current.price) == null
        ? Object.assign({}, current, { price: currentPrice })
        : current;
    }
    if (
      !symbol
      || !paperLastGoodQuote
      || !sameSym(paperLastGoodQuote.symbol, symbol)
      || Date.now() - paperLastGoodQuote.at > 60000
    ) {
      return current;
    }
    window.__IUF_FINAL_V031_LAST_GOOD_QUOTE_USED__ = {
      symbol,
      at: new Date().toISOString(),
      ageMs: Date.now() - paperLastGoodQuote.at,
    };
    return Object.assign({}, current, paperLastGoodQuote.selected);
  }

  function quoteAgeText(ts) {
    const value = Number(ts);
    if (!Number.isFinite(value) || value <= 0) return "尚未更新";
    const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
    return seconds <= 1 ? "剛剛" : seconds + " 秒前";
  }

  function ensurePaperQuoteQualityBadge() {
    let badge = $("#quote-quality-badge");
    if (badge) return badge;
    const bar = $(".psafe") || $(".symhead .meta");
    if (!bar) return null;
    badge = document.createElement("span");
    badge.id = "quote-quality-badge";
    badge.className = "badge read quote-quality-badge";
    badge.innerHTML = "<i></i><span>行情串流連線中</span>";
    bar.appendChild(badge);
    return badge;
  }

  function updatePaperQuoteQualityBadge(mode, options={}) {
    if (live.screen !== "paper-trading-room") return;
    const badge = ensurePaperQuoteQualityBadge();
    if (!badge) return;
    const degraded = Boolean(options.degraded);
    const lastMessageAt = options.lastMessageAt ?? paperQuoteStreamLastMessageAt;
    const age = quoteAgeText(lastMessageAt);
    const upstream = options.upstream || null;
    const blocked = upstream && (upstream.bidAsk?.status === 401 || upstream.ticks?.status === 401);
    // Off-hours: EC2 gateway is scheduled off (08:20-14:10 TST weekday only)
    const _now = new Date();
    const _dow = _now.getDay();
    const _taipeiMs = _now.getTime() + _now.getTimezoneOffset() * 60000 + 8 * 3600000;
    const _taipeiDate = new Date(_taipeiMs);
    const _tMin = _taipeiDate.getUTCHours() * 60 + _taipeiDate.getUTCMinutes();
    const _isScheduledOff = _dow === 0 || _dow === 6 || _tMin < 8 * 60 + 20 || _tMin > 14 * 60 + 10;
    let label = "行情串流連線中";
    let className = "badge read quote-quality-badge";
    if (mode === "stream" && !degraded) {
      label = "行情串流 LIVE · " + age;
      className = "badge iso quote-quality-badge";
    } else if (mode === "stream" && degraded) {
      label = _isScheduledOff ? "盤後 · 明日 09:00 恢復" : (blocked ? "行情需登入 · " + age : "行情串流退化 · " + age);
      className = _isScheduledOff ? "badge read quote-quality-badge" : (blocked ? "badge locked quote-quality-badge" : "badge read quote-quality-badge");
    } else if (mode === "fallback") {
      label = _isScheduledOff ? "盤後 · 明日 09:00 恢復" : (degraded ? "輪詢備援退化 · " + age : "輪詢備援 LIVE · " + age);
      className = degraded ? "badge read quote-quality-badge" : "badge iso quote-quality-badge";
    } else if (mode === "reconnecting") {
      label = _isScheduledOff ? "盤後 · 明日 09:00 恢復" : ("行情串流重連中 · " + age);
      className = "badge read quote-quality-badge";
    } else if (mode === "stale") {
      label = _isScheduledOff ? "盤後 · 明日 09:00 恢復" : "行情延遲 · " + age;
      className = "badge locked quote-quality-badge";
    } else if (mode === "blocked") {
      label = _isScheduledOff ? "盤後 · 明日 09:00 恢復" : "行情暫不可用";
      className = "badge locked quote-quality-badge";
    }
    badge.className = className;
    badge.dataset.mode = mode;
    badge.dataset.degraded = String(degraded);
    badge.title = "交易室價格來源狀態；串流優先，斷線才退回輪詢。";
    badge.innerHTML = "<i></i><span>" + esc(label) + "</span>";
  }

  function setPaperQuoteStreamState(next) {
    const state = Object.assign({}, window.__IUF_FINAL_V031_QUOTE_STREAM_STATE__ || {}, next, {
      updatedAt: new Date().toISOString(),
    });
    window.__IUF_FINAL_V031_QUOTE_STREAM_STATE__ = state;
    if (state.state === "message") {
      updatePaperQuoteQualityBadge("stream", {
        degraded: Boolean(state.degraded),
        lastMessageAt: state.lastMessageAt,
        upstream: state.upstream || null,
      });
    } else if (state.state === "ready") {
      updatePaperQuoteQualityBadge("stream", {
        degraded: true,
        lastMessageAt: state.lastMessageAt,
        upstream: state.upstream || null,
      });
    } else if (state.state === "error") {
      const recent = paperQuoteStreamLastMessageAt && (Date.now() - paperQuoteStreamLastMessageAt) < 15000;
      updatePaperQuoteQualityBadge(recent ? "reconnecting" : (paperQuoteStreamLastMessageAt ? "stale" : "blocked"), {
        lastMessageAt: paperQuoteStreamLastMessageAt,
      });
    } else if (state.state === "connecting" || state.state === "open") {
      updatePaperQuoteQualityBadge("stream", { degraded: true, lastMessageAt: paperQuoteStreamLastMessageAt });
    }
    return state;
  }

  function closePaperQuoteStream(reason) {
    if (paperQuoteStream) {
      try { paperQuoteStream.close(); } catch {}
    }
    paperQuoteStream = null;
    paperQuoteStreamSymbol = null;
    if (reason) setPaperQuoteStreamState({ state: "closed", reason });
  }

  function paperQuoteStreamIsFresh() {
    return paperQuoteStream && paperQuoteStreamLastMessageAt && (Date.now() - paperQuoteStreamLastMessageAt) < 5000;
  }

  function applyPaperQuoteStreamPayload(payload) {
    if (!payload || typeof payload !== "object") return;
    const symbol = String(payload.symbol || paperPulseSymbol()).trim().toUpperCase();
    if (!sameSym(symbol, paperPulseSymbol())) return;
    const quote = payload.quote || null;
    const bidAsk = payload.bidAsk || null;
    const ticks = Array.isArray(payload.ticks) ? payload.ticks : [];
    const payloadPrice = payload.lastPrice != null ? Number(payload.lastPrice) : null;
    const quotePrice = quote?.lastPrice != null ? Number(quote.lastPrice) : null;
    const authoritativePrice = (Number.isFinite(payloadPrice) && payloadPrice > 0 ? payloadPrice : null)
      ?? (Number.isFinite(quotePrice) && quotePrice > 0 ? quotePrice : null);
    const tick = latestTick(ticks, symbol, authoritativePrice == null);
    const tickPrice = tickLastPrice(tick);
    const lastPrice = authoritativePrice ?? tickPrice;
    if (lastPrice == null && !bidAsk && !ticks.length) return;
    const sameSelected = sameSym(live.selected?.symbol, symbol);
    const previous = usableQuotePrice(
      payload.prevClose
      ?? quote?.prevClose
      ?? quote?.previousClose
      ?? quote?.referencePrice
      ?? quote?.yesterdayClose
      ?? (sameSelected ? live.selected?.previous : null)
    );
    const computedChange = previous != null && lastPrice != null ? Number((lastPrice - Number(previous)).toFixed(2)) : null;
    const computedPct = computedChange != null && previous ? Number(((computedChange / Number(previous)) * 100).toFixed(2)) : null;
    const payloadChange = payload.change != null ? Number(payload.change) : NaN;
    const payloadPct = payload.changePct != null ? Number(payload.changePct) : NaN;
    const tickChange = tick?.price_chg != null || tick?.change != null || tick?.changePrice != null
      ? Number(tick?.price_chg ?? tick?.change ?? tick?.changePrice)
      : NaN;
    const tickPct = tick?.pct_chg != null || tick?.changePct != null || tick?.changePercent != null
      ? Number(tick?.pct_chg ?? tick?.changePct ?? tick?.changePercent)
      : NaN;
    const liveChange = sameSelected ? live.selected?.change : null;
    const livePct = sameSelected ? live.selected?.changePct : null;
    const change = computedChange
      ?? (Number.isFinite(payloadChange) ? payloadChange : null)
      ?? (Number.isFinite(tickChange) ? tickChange : null)
      ?? liveChange
      ?? null;
    const changePct = computedPct
      ?? (Number.isFinite(payloadPct) ? payloadPct : null)
      ?? (Number.isFinite(tickPct) ? tickPct : null)
      ?? livePct
      ?? null;
    const nextSelected = Object.assign({}, sameSelected ? (live.selected || {}) : {}, {
      symbol,
      price: lastPrice ?? (sameSelected ? live.selected?.price : null) ?? null,
      close: lastPrice ?? (sameSelected ? live.selected?.close : null) ?? null,
      previous,
      open: quote?.open ?? tick?.open ?? (sameSelected ? live.selected?.open : null),
      high: quote?.high ?? tick?.high ?? (sameSelected ? live.selected?.high : null),
      low: quote?.low ?? tick?.low ?? (sameSelected ? live.selected?.low : null),
      volume: quote?.volume ?? tick?.total_volume ?? tick?.volume ?? (sameSelected ? live.selected?.volume : null),
      bid: quote?.bid ?? bidAsk?.bid_prices?.[0] ?? null,
      ask: quote?.ask ?? bidAsk?.ask_prices?.[0] ?? null,
      change,
      changePct,
      quoteState: payload.degraded ? "DEGRADED" : (ticks.length || lastPrice != null ? "LIVE" : live.selected?.quoteState ?? "NO_DATA"),
    });
    applyPaperQuotePulse(nextSelected, bidAsk, ticks);
  }

  function openPaperQuoteStream() {
    if (live.screen !== "paper-trading-room") return false;
    if (typeof window.EventSource !== "function") {
      setPaperQuoteStreamState({ state: "unsupported", reason: "eventsource_unavailable" });
      return false;
    }
    if (document.hidden) return false;
    const symbol = paperPulseSymbol();
    if (!/^[0-9A-Z._-]{2,16}$/.test(symbol)) return false;
    if (Date.now() < paperQuoteStreamBackoffUntil) return false;
    if (paperQuoteStream && paperQuoteStreamSymbol === symbol) return true;
    closePaperQuoteStream("symbol_changed");
    const params = new URLSearchParams({ symbol });
    if (live._companyId && sameSym(live._companyIdSymbol, symbol)) {
      params.set("companyId", String(live._companyId));
    }
    const url = "/api/ui-final-v031/quote-stream?" + params.toString();
    try {
      const stream = new EventSource(url);
      paperQuoteStream = stream;
      paperQuoteStreamSymbol = symbol;
      setPaperQuoteStreamState({ state: "connecting", symbol, url, lastMessageAt: null, degraded: null });
      stream.addEventListener("open", () => {
        setPaperQuoteStreamState({ state: "open", symbol, url });
      });
      stream.addEventListener("ready", (event) => {
        paperQuoteStreamLastMessageAt = Date.now();
        setPaperQuoteStreamState({ state: "ready", symbol, url, lastMessageAt: paperQuoteStreamLastMessageAt, ready: event.data || null });
      });
      stream.addEventListener("quote", (event) => {
        paperQuoteStreamLastMessageAt = Date.now();
        const payload = JSON.parse(event.data || "{}");
        setPaperQuoteStreamState({
          state: "message",
          symbol,
          url,
          lastMessageAt: paperQuoteStreamLastMessageAt,
          sequence: payload.sequence ?? null,
          degraded: Boolean(payload.degraded),
          upstream: payload.upstream || null,
        });
        applyPaperQuoteStreamPayload(payload);
      });
      stream.addEventListener("error", () => {
        setPaperQuoteStreamState({ state: "error", symbol, url, lastMessageAt: paperQuoteStreamLastMessageAt || null });
        if (stream.readyState === EventSource.CLOSED) {
          paperQuoteStreamBackoffUntil = Date.now() + 5000;
          closePaperQuoteStream("eventsource_closed");
        }
      });
      return true;
    } catch (error) {
      paperQuoteStreamBackoffUntil = Date.now() + 5000;
      setPaperQuoteStreamState({ state: "error", symbol, reason: error instanceof Error ? error.message : "eventsource_failed" });
      return false;
    }
  }

  function applyPaperQuotePulse(nextSelected, bidAsk, ticks) {
    if (!nextSelected?.symbol || !sameSym(nextSelected.symbol, paperPulseSymbol())) return;
    const selected = mergePaperSelectedWithLastGoodQuote(nextSelected);
    rememberPaperGoodQuote(selected, bidAsk, ticks);
    const chg = selected.change;
    const pct = selected.changePct;
    const tone = chg == null ? "flat" : Number(chg) >= 0 ? "up" : "dn";
    const sameSelected = sameSym(live.selected?.symbol, selected.symbol);
    live = Object.assign({}, live, {
      selected: Object.assign({}, sameSelected ? (live.selected || {}) : {}, selected),
      bidAsk: bidAsk !== undefined ? bidAsk : live.bidAsk,
      ticks: ticks !== undefined ? ticks : live.ticks,
    });
    window.__IUF_FINAL_V031_LIVE__ = live;
    const selectedPrice = usableQuotePrice(selected.price ?? selected.close ?? selected.lastPrice);
    window.__IUF_SELECTED_PRICE__ = selectedPrice != null ? selectedPrice : window.__IUF_SELECTED_PRICE__;
    setText(".symhead .sym", selected.symbol || "--");
    setText(".symhead .nm", selected.name || selected.symbol || "--");
    const pv = $(".symhead .price .v"); if (pv) { pv.textContent = price(selected.price); pv.className = "v " + tone; }
    const pd = $(".symhead .price .d"); if (pd) {
      const state = selected.quoteState && selected.quoteState !== "LIVE" ? String(selected.quoteState) + " " : "";
      pd.textContent = chg == null ? state + "等待即時價" : state + (Number(chg) >= 0 ? "▲ +" : "▼ -") + Math.abs(Number(chg)).toFixed(2) + "  " + (Number(pct) >= 0 ? "+" : "-") + Math.abs(Number(pct || 0)).toFixed(2) + "%";
      pd.className = "d " + tone;
    }
    const stats = $$(".symhead .stats .s .v");
    if (stats[0] && selected.open != null) stats[0].textContent = price(selected.open);
    if (stats[1] && selected.high != null) stats[1].textContent = price(selected.high);
    if (stats[2] && selected.low != null) stats[2].textContent = price(selected.low);
    if (stats[3] && selected.previous != null) stats[3].textContent = price(selected.previous);
    if (stats[4] && selected.volume != null) stats[4].textContent = n(selected.volume) + " 股";
    const activeRow = $$(".wrow[data-sym]").find((row) => sameSym(row.dataset.sym, selected.symbol));
    if (activeRow) {
      activeRow.classList.add("on");
      const priceCell = $(".price", activeRow);
      if (priceCell) priceCell.outerHTML = rowPrice({ price: selected.price, changePct: selected.changePct });
    }
    const priceInput = $("#t-price");
    if (priceInput && document.activeElement !== priceInput && selected.price != null) {
      priceInput.value = Number(selected.price).toFixed(2);
      priceInput.setAttribute("value", priceInput.value);
    }
    const ohlcC = $("#ohlc-c"); if (ohlcC && selected.price != null) ohlcC.textContent = price(selected.price);
    if (typeof window.updPreview === "function") {
      try { window.updPreview(); } catch {}
    }
    const depth = $("#depth");
    if (depth && bidAsk) {
      const asks = (bidAsk.ask_prices || []).map((p, i) => [p, bidAsk.ask_volumes?.[i] ?? 0]).slice(0, 5).reverse();
      const bids = (bidAsk.bid_prices || []).map((p, i) => [p, bidAsk.bid_volumes?.[i] ?? 0]).slice(0, 5);
      const max = Math.max(1, ...asks.map((x) => x[1]), ...bids.map((x) => x[1]));
      depth.innerHTML = asks.map(([p,q]) => '<div class="row"><span class="px up">'+price(p)+'</span><div class="bar"><i class="ask" style="width:'+Math.round(q/max*90)+'%"></i></div><span class="qty">'+esc(q)+'</span></div>').join("") + '<div class="row last"><span class="px">'+price(selected.price)+'</span><span class="qty" style="text-align:center;color:var(--fg-3)">LIVE</span><span class="qty">--</span></div>' + bids.map(([p,q]) => '<div class="row"><span class="px dn">'+price(p)+'</span><div class="bar"><i class="bid" style="width:'+Math.round(q/max*90)+'%"></i></div><span class="qty">'+esc(q)+'</span></div>').join("");
    }
    const tape = $("#tape");
    if (tape && Array.isArray(ticks) && ticks.length) {
      const previous = selected.previous;
      tape.innerHTML = ticks.slice(-12).reverse().map((t) => {
        const px = tickLastPrice(t);
        const qty = t.volume ?? t.qty ?? t.quantity ?? t.total_volume ?? null;
        const ts = t.datetime || t.timestamp || t.ts || t._received_at || "";
        const tone2 = previous != null && px != null ? (Number(px) >= Number(previous) ? "up" : "dn") : "up";
        return '<div class="row" style="grid-template-columns:80px 1fr 70px"><span class="px '+esc(tone2)+'">'+price(px)+'</span><span class="qty" style="color:var(--fg-3);text-align:left">'+esc(String(ts).slice(11,19) || String(ts).slice(0,8) || "--")+'</span><span class="qty">'+esc(qty ?? "--")+'</span></div>';
      }).join("");
    }
  }

  let paperQuotePulseBusy = false;
  let paperQuotePulseBlockedUntil = 0;
  async function refreshPaperQuotePulse() {
    if (live.screen !== "paper-trading-room" || document.hidden || paperQuotePulseBusy) return;
    openPaperQuoteStream();
    if (paperQuoteStreamIsFresh()) return;
    if (Date.now() < paperQuotePulseBlockedUntil) return;
    const symbol = paperPulseSymbol();
    if (!/^[0-9A-Z._-]{2,16}$/.test(symbol)) return;
    paperQuotePulseBusy = true;
    try {
      const companyId = live._companyId && sameSym(live._companyIdSymbol, symbol)
        ? live._companyId
        : null;
      const quoteResult = companyId
        ? await soft(apiGet("/api/v1/companies/" + encodeURIComponent(companyId) + "/quote/realtime"))
        : { ok:true, data:null };
      if (!sameSym(symbol, paperPulseSymbol())) return;
      const quote = quoteResult.ok ? quoteResult.data : null;
      const rawQuoteExtras = await fetchRawKgiQuoteExtras(symbol, quote);
      const bidAskResult = rawQuoteExtras.bidAskResult;
      const ticksResult = rawQuoteExtras.ticksResult;
      const bidAsk = bidAskResult.ok ? bidAskResult.data : null;
      const ticksData = ticksResult.ok ? ticksResult.data : null;
      const ticks = ticksData?.ticks || [];
      const hasUsableResponse = Boolean(quote || bidAsk || ticksData);
      const hasFailedResponse = !quoteResult.ok || (!rawQuoteExtras.skipped && (!bidAskResult.ok || !ticksResult.ok));
      if (!hasUsableResponse && hasFailedResponse) {
        paperQuotePulseBlockedUntil = Date.now() + 15000;
        updatePaperQuoteQualityBadge("blocked", { degraded: true });
        return;
      }
      paperQuotePulseBlockedUntil = 0;
      const quotePrice = quote?.lastPrice != null ? Number(quote.lastPrice) : null;
      const authoritativePrice = Number.isFinite(quotePrice) && quotePrice > 0 ? quotePrice : null;
      const tick = latestTick(ticks, symbol, authoritativePrice == null);
      const tickPrice = tickLastPrice(tick);
      const lastPrice = authoritativePrice ?? tickPrice;
      if (lastPrice == null && !bidAsk && !ticks.length) return;
      const sameSelected = sameSym(live.selected?.symbol, symbol);
      const previous = usableQuotePrice(
        quote?.prevClose
        ?? quote?.previousClose
        ?? quote?.referencePrice
        ?? quote?.yesterdayClose
        ?? (sameSelected ? live.selected?.previous : null)
      );
      const computedChange = previous != null && lastPrice != null ? Number((lastPrice - Number(previous)).toFixed(2)) : null;
      const computedPct = computedChange != null && previous ? Number(((computedChange / Number(previous)) * 100).toFixed(2)) : null;
      const tickChange = tick?.price_chg != null || tick?.change != null || tick?.changePrice != null
        ? Number(tick?.price_chg ?? tick?.change ?? tick?.changePrice)
        : NaN;
      const tickPct = tick?.pct_chg != null || tick?.changePct != null || tick?.changePercent != null
        ? Number(tick?.pct_chg ?? tick?.changePct ?? tick?.changePercent)
        : NaN;
      const change = computedChange
        ?? (Number.isFinite(tickChange) ? tickChange : null)
        ?? (sameSelected ? live.selected?.change : null)
        ?? null;
      const changePct = computedPct
        ?? (Number.isFinite(tickPct) ? tickPct : null)
        ?? (sameSelected ? live.selected?.changePct : null)
        ?? null;
      const nextSelected = Object.assign({}, sameSelected ? (live.selected || {}) : {}, {
        symbol,
        price: lastPrice ?? (sameSelected ? live.selected?.price : null) ?? null,
        close: lastPrice ?? (sameSelected ? live.selected?.close : null) ?? null,
        previous,
        open: quote?.open ?? tick?.open ?? (sameSelected ? live.selected?.open : null),
        high: quote?.high ?? tick?.high ?? (sameSelected ? live.selected?.high : null),
        low: quote?.low ?? tick?.low ?? (sameSelected ? live.selected?.low : null),
        volume: quote?.volume ?? tick?.total_volume ?? tick?.volume ?? (sameSelected ? live.selected?.volume : null),
        bid: quote?.bid ?? bidAsk?.bid_prices?.[0] ?? null,
        ask: quote?.ask ?? bidAsk?.ask_prices?.[0] ?? null,
        change,
        changePct,
        quoteState: quote?.state ?? (ticks.length ? "LIVE" : (sameSelected ? live.selected?.quoteState : null) ?? "NO_DATA"),
      });
      applyPaperQuotePulse(nextSelected, bidAsk, ticks);
      updatePaperQuoteQualityBadge("fallback", {
        degraded: hasFailedResponse,
        lastMessageAt: Date.now(),
        upstream: {
          quote: { ok: quoteResult.ok },
          bidAsk: { ok: bidAskResult.ok },
          ticks: { ok: ticksResult.ok },
        },
      });
    } catch (error) {
      window.__IUF_FINAL_V031_QUOTE_PULSE_ERROR__ = error instanceof Error ? error.message : "quote_pulse_failed";
      updatePaperQuoteQualityBadge("blocked", { degraded: true });
    } finally {
      paperQuotePulseBusy = false;
    }
  }

  const kgiQuoteAuth = () => live.kgiStatus?.gateway_quote_auth || null;
  const kgiQuoteBlockedReason = (label) => {
    const auth = kgiQuoteAuth();
    const code = String(auth?.errorCode || "");
    const state = String(auth?.state || "");
    if (code === "KGI_GATEWAY_UNREACHABLE" || state === "gateway_unreachable") return "KGI gateway 目前連不到；" + label + "暫停，不補假資料。";
    if (code === "KGI_QUOTE_AUTH_UNAVAILABLE") return "KGI SIM 已登入，但凱基沒有提供 SIM 行情權限/token；" + label + "暫停，不補假資料。";
    if (code === "QUOTE_DISABLED") return "KGI 唯讀行情目前停用；" + label + "暫停，不補假資料。";
    if (code === "KGI_NOT_LOGGED_IN") return "KGI gateway 尚未登入；" + label + "暫停，不補假資料。";
    if (auth && auth.available === false) return "KGI 唯讀行情目前不可用（" + esc(code || auth.state || "blocked") + "）；" + label + "暫停，不補假資料。";
    return "KGI 唯讀行情暫無回傳；" + label + "暫停，不補假資料。";
  };

  function hydrateKgiReadinessNote() {
    const note = $('.ltab[data-lt="kgi"] .kginote');
    if (!note) return;
    const auth = kgiQuoteAuth();
    const status = live.kgiStatus || {};
    const positions = live.kgi?.positions || [];
    const isGatewayUnreachable = String(auth?.errorCode || "") === "KGI_GATEWAY_UNREACHABLE" || String(auth?.state || "") === "gateway_unreachable";
    const isAuthUnavailable = String(auth?.errorCode || "") === "KGI_QUOTE_AUTH_UNAVAILABLE";
    const title = isGatewayUnreachable
      ? "KGI gateway 連線中斷"
      : isAuthUnavailable
      ? "KGI SIM 已登入，行情權限未開"
      : auth?.available
        ? "KGI 唯讀行情可用"
        : "KGI 唯讀狀態已同步";
    const detail = isGatewayUnreachable
      ? "API 已確認目前連不到 KGI gateway 主機或 tunnel；Paper 交易仍可用，KGI 五檔、逐筆與券商庫存讀取暫停。"
      : isAuthUnavailable
      ? "目前可讀 gateway / 帳號狀態；即時五檔與逐筆因凱基未提供 SIM 行情 token 暫停，不會補假資料。"
      : auth?.available
        ? "gateway 已登入且行情授權可用；若表格為空，代表目前沒有券商庫存或尚未收到該股票逐筆。"
        : kgiQuoteBlockedReason("行情讀取");
    const rows = [
      status.kgi_env ? "環境：" + esc(status.kgi_env).toUpperCase() : null,
      status.prod_write_blocked ? "正式下單：封鎖" : null,
      auth ? "行情：" + (auth.available ? "可訂閱" : esc(auth.errorCode || auth.state || "不可用")) : null,
      "庫存：" + positions.length + " 筆",
    ].filter(Boolean);
    note.innerHTML = '<span class="pill" style="color:var(--info);border-color:var(--info-line);background:var(--info-bg)"><i style="background:var(--info)"></i>KGI 唯讀</span> <b>'+esc(title)+'</b><br><span>'+esc(detail)+'</span><br><span style="color:var(--fg-3)">'+rows.join(" · ")+'</span>';
  }

  // ── Active broker selection (persisted in localStorage) ─────────────────────
  // Default = paper. KGI SIM is selectable from the broker strip.
  // Fubon stays disabled/soon — never selectable.
  const ACTIVE_BROKER_STORAGE_KEY = 'iuf-active-broker';
  function activeBrokerKey() {
    try { return String(window.localStorage.getItem(ACTIVE_BROKER_STORAGE_KEY) || 'paper'); } catch { return 'paper'; }
  }
  function setActiveBroker(key) {
    try { window.localStorage.setItem(ACTIVE_BROKER_STORAGE_KEY, String(key)); } catch { /* ignore */ }
  }
  // Returns UI copy for submit buttons and gate text based on active broker.
  function brokerSubmitCopy(brokerKey) {
    if (brokerKey === 'kgi') return { prefix: '送出 KGI 模擬單', sub: 'KGI SIM', shortName: 'KGI 模擬單' };
    return { prefix: '送出模擬訂單', sub: '平台模擬', shortName: '模擬訂單' };
  }

  // 統一下單流 D6（帳號帶，2026-07-09）: gatewayStatus -> badge copy/color.
  // Mirrors the real, unit-tested gatewayStatusBadge() exported from this
  // same file (final-v031-live.ts, outside this <script> template) and the
  // /settings/broker trust card's wording 1:1 — inlined here for the same
  // reason as the D5 reason-code vocab in the submit handlers above: this
  // whole block ships as a raw string with no bundler import access.
  function gatewayBadge(status) {
    if (status === 'reachable') return { label: '已連線', color: '#34d399', border: 'rgba(52,211,153,0.32)', background: 'rgba(52,211,153,0.10)' };
    if (status === 'pending') return { label: '等待配對', color: '#fbbf24', border: 'rgba(251,191,36,0.34)', background: 'rgba(251,191,36,0.10)' };
    if (status === 'paired_unreachable') return { label: '等待連線', color: '#fbbf24', border: 'rgba(251,191,36,0.34)', background: 'rgba(251,191,36,0.10)' };
    return { label: '未配對', color: '#9ca3af', border: 'rgba(156,163,175,0.26)', background: 'rgba(156,163,175,0.08)' };
  }

  // Phase 2 (multi-broker, 2026-06-24): broker strip is now clickable — paper is the
  // default; selecting KGI routes the ticket through the unified
  // POST /api/v1/trading/orders endpoint's KGI SIM channel (統一下單流 D1,
  // 2026-07-09 — see submitUnifiedOrder()).
  // Fubon stays display-only (disabled button, isActive=false). Real-money channels
  // remain locked (prod_write_blocked guard unchanged).
  //
  // D6 (2026-07-09): this is now the "帳號帶" — each selectable button also
  // shows a gatewayStatus badge sourced from live.accounts (GET
  // /uta/accounts, seeded by #1165 so paper+kgi rows always exist).
  function hydrateBrokerStrip() {
    const strip = $('#broker-strip');
    if (!strip) return;
    const currentKey = activeBrokerKey();
    const accountsList = Array.isArray(live.accounts) ? live.accounts : [];
    // Apply active class to matching button; ensure fubon stays disabled.
    const btns = strip.querySelectorAll('.bbtn');
    btns.forEach((btn) => {
      const bk = btn.dataset && btn.dataset.broker;
      if (!bk) return;
      if (bk === 'fubon') return; // always disabled / soon — do not touch
      const isActive = bk === currentKey;
      btn.classList.toggle('active', isActive);
      // Remove placeholder tooltip from selectable buttons
      if (bk !== 'fubon') btn.removeAttribute('title');
      // D6 帳號帶: gatewayStatus badge, one per selectable broker button.
      // 查詢失敗態（Pete review 🟡 2026-07-09）: when GET /uta/accounts itself
      // failed, accountsList is empty for every broker — same shape as a
      // genuinely unpaired account. Render a distinct grey "查詢失敗" badge in
      // that case so the operator can tell "read failed, unknown" apart from
      // "read succeeded, this account really is unpaired" (gatewayBadge's
      // own 'unpaired' label). Only fires when the fetch actually failed —
      // never overrides a real gatewayStatus from a successful response.
      const account = accountsList.find((a) => a && a.adapterKey === bk) || null;
      const badge = account
        ? gatewayBadge(account.gatewayStatus)
        : (live.accountsFetchFailed
          ? { label: '狀態查詢失敗', color: '#9ca3af', border: 'rgba(156,163,175,0.26)', background: 'rgba(156,163,175,0.08)' }
          : null);
      if (badge) {
        let stat = btn.querySelector('.bstat');
        if (!stat) {
          stat = document.createElement('span');
          stat.className = 'bstat';
          stat.style.marginLeft = '6px';
          stat.style.padding = '1px 6px';
          stat.style.borderRadius = '999px';
          stat.style.fontSize = '10px';
          stat.style.fontWeight = '700';
          stat.style.letterSpacing = '0.02em';
          stat.style.border = '1px solid transparent';
          btn.appendChild(stat);
        }
        stat.textContent = badge.label;
        stat.style.color = badge.color;
        stat.style.borderColor = badge.border;
        stat.style.background = badge.background;
        stat.title = account && account.accountLabel ? account.accountLabel + ' · ' + badge.label : badge.label;
      }
      if (!btn.dataset.brokerClickWired) {
        btn.dataset.brokerClickWired = '1';
        btn.addEventListener('click', () => {
          if (bk === 'fubon') return;
          setActiveBroker(bk);
          hydrateBrokerStrip();
          applyBrokerSubmitVisibility();
        });
      }
    });
    applyBrokerSubmitVisibility();
  }

  // Show the correct submit button and update its label based on active broker.
  function applyBrokerSubmitVisibility() {
    const currentKey = activeBrokerKey();
    const paperBtn = $('#submit-btn');
    const kgiBtn = $('#submit-kgi-sim-btn');
    if (!paperBtn || !kgiBtn) return;
    const copy = brokerSubmitCopy(currentKey);
    if (currentKey === 'kgi') {
      // KGI SIM flow is active
      paperBtn.style.display = 'none';
      kgiBtn.style.display = '';
      const kgiFirstSpan = kgiBtn.querySelector('span:first-child');
      if (kgiFirstSpan) {
        const kgiLabel = kgiBtn.querySelector('#submit-kgi-sim-label') || kgiFirstSpan.querySelector('b');
        if (kgiLabel) {
          kgiFirstSpan.childNodes[0].textContent = copy.prefix + '　';
        }
      }
      const kgiSub = kgiBtn.querySelector('.sub');
      if (kgiSub) kgiSub.textContent = copy.sub;
    } else {
      // Paper flow is active (default)
      kgiBtn.style.display = 'none';
      paperBtn.style.display = '';
      const paperFirstSpan = paperBtn.querySelector('span:first-child');
      if (paperFirstSpan) {
        paperFirstSpan.childNodes[0].textContent = copy.prefix + '　';
      }
      const paperSub = paperBtn.querySelector('.sub');
      if (paperSub) paperSub.textContent = copy.sub;
    }
  }

  // Wire the 自選 add box + per-row remove buttons to the watchlist CRUD API,
  // then refresh the desk so the change is reflected immediately.
  function attachWatchlistManage() {
    const addBtn = $("#wl-add-btn");
    const addInput = $("#wl-add-input");
    const doAdd = async () => {
      const sym = String((addInput && addInput.value) || "").trim().toUpperCase();
      if (!/^[0-9A-Z._-]{2,16}$/.test(sym)) return;
      if (addBtn) addBtn.disabled = true;
      try {
        await apiPost("/api/v1/watchlist", { symbol: sym });
        if (addInput) addInput.value = "";
        await refreshClientLive();
      } catch (_err) { /* keep desk usable on failure */ }
      finally { if (addBtn) addBtn.disabled = false; }
    };
    if (addBtn) addBtn.addEventListener("click", doAdd);
    if (addInput) addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
    $$("#wl-my .wldel").forEach((btn) => btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const sym = btn.dataset && btn.dataset.del;
      if (!sym) return;
      btn.disabled = true;
      try { await apiPost("/api/v1/watchlist/remove", { symbol: sym }); await refreshClientLive(); }
      catch (_err) { btn.disabled = false; }
    }));
  }

  function applyPaperPrefill(selected) {
    const prefill = paperPrefill();
    const existing = $("#rec-prefill-box");
    if (!prefill?.enabled) {
      if (existing) existing.remove();
      return;
    }

    const selectedSymbol = String(selected?.symbol || "").trim().toUpperCase();
    const prefillSymbol = String(prefill.symbol || "").trim().toUpperCase();
    if (prefillSymbol && selectedSymbol && prefillSymbol !== selectedSymbol) {
      removeMismatchedPaperPrefill(selectedSymbol);
      const submit = $("#submit-btn");
      const label = $("#submit-btn-label") || submit?.querySelector("b");
      if (label) {
        if (!label.id) label.id = "submit-btn-label";
        label.textContent = "紙上單預覽";
      }
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
      box.innerHTML = '<div class="k">AI 推薦紙上單預覽</div><div class="v">'+esc(selected.symbol || prefill.symbol || "推薦標的")+' 已帶入交易室紙上單預覽；此區只建立平台模擬紀錄，不會建立券商委託。</div><div class="m">'+meta.map((item) => '<span>'+esc(item)+'</span>').join("")+'</div>';
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
        label.textContent = "AI 推薦帶入的紙上單預覽";
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
    const selected = mergePaperSelectedWithLastGoodQuote(live.selected || {});
    if (selected !== live.selected) {
      live = Object.assign({}, live, { selected });
      window.__IUF_FINAL_V031_LIVE__ = live;
    }
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
        sec: industryLabel(selected.sector || "台股"),
        price: selected.price,
        open: selected.open,
        high: selected.high,
        low: selected.low,
        prev: selected.previous,
        vol: selected.volume
      };
    }
    window.__IUF_SYM_DATA_LIVE__ = symLive;

    // 4. Redraw the legacy SVG chart only when the real company-page K-line frame
    // is not mounted. The trading room uses the real iframe; repainting the hidden
    // SVG on every 15s hydration makes symbol switches feel jumpy without adding
    // user-visible value.
    const realFrameMounted = !!document.getElementById("real-kline-frame");
    if (!realFrameMounted && typeof window.drawChart === "function") {
      window.drawChart(selected.symbol || "2330");
    }
    if (typeof window.updateRealChartFrame === "function") {
      const nextFrameSymbol = selected.symbol || "2330";
      const frame = document.getElementById("real-kline-frame");
      const mountedFrameSymbol = frame?.dataset?.symbol || window.__IUF_REAL_KLINE_FRAME_SYMBOL__ || "";
      if (!realFrameMounted || !sameSym(mountedFrameSymbol, nextFrameSymbol)) {
        window.updateRealChartFrame(nextFrameSymbol);
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    setText(".symhead .sym", selected.symbol || "—");
    setText(".symhead .nm", (selected.name || selected.symbol || "—"));
    setText(".symhead .meta", industryLabel(selected.sector || "台股"));
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
      const myItems = live.myWatchlist || [];
      if (false) {
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
        // 自選 tab: user-managed — add box + per-row remove, from live.myWatchlist.
        const addBar = '<div class="wladd"><input id="wl-add-input" maxlength="16" placeholder="加股票代碼，如 2330" /><button type="button" id="wl-add-btn">加入</button></div>';
        const rows = myItems.map((item) => '<div class="wrow '+(sameSym(item.symbol, selected.symbol)?'on':'')+'" data-sym="'+esc(item.symbol)+'"><span class="sym">'+esc(item.symbol)+'</span><div class="body"><div class="nm">'+esc(item.name)+'</div><div class="meta">'+esc(item.meta)+'</div></div>'+rowPrice(item)+'<button type="button" class="wldel" data-del="'+esc(item.symbol)+'" title="從自選移除">×</button></div>').join("");
        const emptyRow = '<div class="wrow" data-search-result="1"><span class="sym">＋</span><div class="body"><div class="nm">自選清單是空的</div><div class="meta">在上方輸入代碼加入</div></div></div>';
        wl.innerHTML = addBar + '<div class="group">'+esc(myItems.length)+' 檔自選</div>' + (rows || emptyRow);
        attachWatchlistManage();
      }
    }
    attachPaperRowHandlers();
    attachPaperSearch();
    const wtMy = $('#wtabs button[data-tab="my"] .c'); if (wtMy) wtMy.textContent = String((live.myWatchlist || []).length);
    const wtSig = $('#wtabs button[data-tab="sig"] .c'); if (wtSig) wtSig.textContent = String((live.ideas || []).length);
    const wtPaper = $('#wtabs button[data-tab="paper"] .c'); if (wtPaper) wtPaper.textContent = String((live.ideas || []).filter((idea) => String(idea.status || "").toLowerCase() !== "block").length);
    const symInput = $("#t-sym"); if (symInput) { symInput.value = (selected.symbol || "") + "　" + (selected.name || ""); symInput.setAttribute("value", symInput.value); }
    const selectedPrice = usableQuotePrice(selected.price ?? selected.close ?? selected.lastPrice);
    if (selectedPrice != null) window.__IUF_SELECTED_PRICE__ = selectedPrice;
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
    // 委託回報（D3, 2026-07-10）: 跨券商 unified_orders 帳（紙上 + 凱基 SIM），
    // 與上面的 #orders-body（只有紙上單通道）分開顯示，避免多券商活動被誤看成單一來源。
    const utaOrdersArr = (live.utaOrders || []).slice(0, 20);
    const utaOrdersBody = $('#uta-orders-body');
    if (utaOrdersBody) utaOrdersBody.innerHTML = utaOrdersArr.map((row) => {
      const isBuy = row.action === "Buy";
      const qtyUnit = row.quantityUnit === "LOT" ? "張" : "股";
      const priceText = row.priceType === "Market" ? "市價" : price(row.limitPrice);
      const statusLabel = utaOrderStatusLabel(row.status);
      const statusClass = utaOrderStatusClass(row.status);
      return '<tr><td class="ts">'+esc((row.createdAt || "").slice(11,19) || "—")+'</td><td class="sym">'+esc(row.symbol)+'</td><td>'+esc(utaOrderChannelLabel(row.adapterKey))+'</td><td><span class="side '+(isBuy ? "buy" : "sell")+'">'+(isBuy ? "買進" : "賣出")+'</span></td><td class="r">'+esc(row.qty ?? "—")+' '+qtyUnit+'</td><td class="r px">'+priceText+'</td><td><span class="st '+statusClass+'"><i></i>'+esc(statusLabel)+'</span></td></tr>';
    }).join("") || '<tr><td colspan="7" style="color:var(--fg-3)">今日無委託</td></tr>';
    const badgeUtaOrders = $("#badge-uta-orders"); if (badgeUtaOrders) badgeUtaOrders.textContent = String(utaOrdersArr.length);
    const fillsArr = (live.fills || []).slice(0, 12);
    const fillsBody = $('#fills-body') || $('.ltab[data-lt="fills"] tbody');
    if (fillsBody) fillsBody.innerHTML = fillsArr.map((fill) => '<tr><td class="ts">'+esc((fill.fillTime || "").slice(5,16) || "—")+'</td><td class="sym">'+esc(fill.symbol)+'</td><td><span class="side '+(fill.side === "sell" ? "sell" : "buy")+'">'+(fill.side === "sell" ? "賣出" : "買進")+'</span></td><td class="r px">'+price(fill.fillPrice)+'</td><td class="r">'+esc(fill.fillQty)+'</td><td class="r">'+n(Number(fill.fillQty || 0) * Number(fill.fillPrice || 0))+'</td><td class="ts">'+esc(fill.orderId)+'</td></tr>').join("") || '<tr><td colspan="7" style="color:var(--fg-3)">尚無成交紀錄</td></tr>';
    const badgeFills = $("#badge-fills"); if (badgeFills) badgeFills.textContent = String(fillsArr.length);
    const posBody = $('.ltab[data-lt="positions"] tbody');
    if (posBody) posBody.innerHTML = (live.portfolio || []).map((pos) => '<tr><td class="sym">'+esc(pos.symbol)+'</td><td>'+esc(pos.symbol)+'</td><td class="r">'+n(pos.netQtyShares)+' 股</td><td class="r">'+price(pos.avgCostPerShare)+'</td><td class="r px">'+price(pos.symbol === selected.symbol ? selected.price : pos.avgCostPerShare)+'</td><td class="r">'+n(Number(pos.netQtyShares || 0) * Number(pos.symbol === selected.symbol ? selected.price || 0 : pos.avgCostPerShare || 0))+'</td><td class="r">需即時價換算</td><td class="r">—</td><td class="ts">'+esc(pos.fillCount)+' 筆</td></tr>').join("") || '<tr><td colspan="9">目前沒有模擬庫存。</td></tr>';
    const kgiBody = $('.ltab[data-lt="kgi"] tbody');
    if (kgiBody) {
      const liveKgiRows = (live.kgi?.positions || []).map((pos) => '<tr><td class="sym">'+esc(pos.symbol)+'</td><td>'+esc(pos.symbol)+'</td><td class="r">'+n(pos.netQtyShares)+' 股</td><td class="r">—</td><td class="r px">'+price(pos.lastPrice)+'</td><td class="r">'+n(Number(pos.netQtyShares || 0) * Number(pos.lastPrice || 0))+'</td><td class="r pnl '+(Number(pos.unrealizedPnl || 0) >= 0 ? "up" : "dn")+'">'+n(pos.unrealizedPnl)+'</td><td><span class="src kgi">即時讀取</span></td></tr>').join("");
      // B3: gateway session is ephemeral (EC2 stops 14:10) — when it has nothing,
      // show the S1/F-AUTO holdings rebuilt from the durable audit chain instead
      // of an empty table, with the data source labeled honestly.
      const fautoRows = !liveKgiRows && live.fauto && (live.fauto.positions || []).length
        ? (live.fauto.positions || []).map((pos) => {
            const mv = pos.last_price !== null ? Number(pos.shares || 0) * Number(pos.last_price || 0) : null;
            const srcLabel = live.fauto.data_source === "kgi_gateway" ? "即時讀取" : "重建(" + esc(String(live.fauto.positions_date || "").slice(5)) + " 委託)";
            return '<tr><td class="sym">'+esc(pos.symbol)+'</td><td>'+esc(pos.symbol)+'</td><td class="r">'+n(pos.shares)+' 股</td><td class="r">'+(pos.avg_cost > 0 ? price(pos.avg_cost) : "—")+'</td><td class="r px">'+(pos.last_price !== null ? price(pos.last_price) : "—")+'</td><td class="r">'+(mv !== null ? n(mv) : "—")+'</td><td class="r pnl '+(Number(pos.unrealized_pnl_twd || 0) >= 0 ? "up" : "dn")+'">'+(pos.unrealized_pnl_twd !== null ? n(pos.unrealized_pnl_twd) : "—")+'</td><td><span class="src kgi">'+srcLabel+'</span></td></tr>';
          }).join("")
        : "";
      kgiBody.innerHTML = liveKgiRows || fautoRows || '<tr><td colspan="8">目前沒有可顯示的券商庫存讀取資料。</td></tr>';
      const badgeKgiTab = $('.lhead .tb[data-lt="kgi"] .c');
      if (badgeKgiTab && !liveKgiRows && fautoRows) badgeKgiTab.textContent = String((live.fauto.positions || []).length);
    }
    // B3: F-AUTO summary line under 部位/資金摘要 — capital, positions, MV, cash + source
    (function renderFautoSummary() {
      const summaryGrid = $("#summary-capital")?.closest("div[style*='grid-template-columns']");
      if (!summaryGrid) return;
      let line = $("#fauto-summary-line");
      if (!live.fauto) { if (line) line.remove(); return; }
      const f = live.fauto;
      if (!line) {
        line = document.createElement("div");
        line.id = "fauto-summary-line";
        line.style.cssText = "grid-column:1 / -1;padding-top:8px;border-top:1px solid var(--line);font:500 11px/1.5 var(--sans);color:var(--fg-3)";
        summaryGrid.appendChild(line);
      }
      const mv = f.total_market_value_twd;
      const srcText = f.data_source === "kgi_gateway" ? "KGI 即時" : "audit 重建（" + esc(String(f.positions_date || "")) + " 進場）";
      line.innerHTML = 'F-AUTO 10M SIM　本金 <b style="color:var(--fg-1);font-weight:500">' + n(f.capital_twd) + '</b>　·　持倉 <b style="color:var(--fg-1);font-weight:500">' + String((f.positions || []).length) + '</b> 檔'
        + (mv !== null ? '　·　市值 <b style="color:var(--fg-1);font-weight:500">' + n(mv) + '</b>' : '')
        + '　·　現金 <b style="color:var(--fg-1);font-weight:500">' + n(f.cash_residual_estimated_twd) + '</b>　·　來源 ' + srcText;
    })();
    hydrateKgiReadinessNote();
    hydrateBrokerStrip();
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
    if (depth && !live.bidAsk) {
      depth.innerHTML = '<div class="row" style="grid-column:1/-1;color:var(--fg-3);font-size:11px;padding:10px 0;text-align:center">'+esc(kgiQuoteBlockedReason("五檔"))+'</div>';
    }
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
    if (tape && !(live.ticks || []).length) {
      tape.innerHTML = '<div class="row" style="grid-template-columns:1fr;color:var(--fg-3);font-size:11px;padding:10px 0;text-align:center">'+esc(kgiQuoteBlockedReason("逐筆成交"))+'</div>';
    }
    const ohlcvLast = (live.ohlcv || []).length ? live.ohlcv[live.ohlcv.length - 1] : null;
    const ohlcO = $("#ohlc-o"); if (ohlcO) ohlcO.textContent = ohlcvLast ? price(ohlcvLast.open) : (selected.open ? price(selected.open) : "—");
    const ohlcH = $("#ohlc-h"); if (ohlcH) ohlcH.textContent = ohlcvLast ? price(ohlcvLast.high) : (selected.high ? price(selected.high) : "—");
    const ohlcL = $("#ohlc-l"); if (ohlcL) ohlcL.textContent = ohlcvLast ? price(ohlcvLast.low) : (selected.low ? price(selected.low) : "—");
    const ohlcC = $("#ohlc-c"); if (ohlcC) ohlcC.textContent = ohlcvLast ? price(ohlcvLast.close ?? selected.price) : (selected.price ? price(selected.price) : "—");
    // BUG_005 — capital: 模擬本金 / 可用資金 DOM update
    const capitalTWD = live.baseCapitalTWD;
    const capitalReady = capitalTWD !== null && capitalTWD !== undefined && !Number.isNaN(Number(capitalTWD));
    const summaryCapEl = $("#summary-capital"); if (summaryCapEl) summaryCapEl.textContent = capitalReady ? n(capitalTWD) : "待授權";
    const summaryAvailEl = $("#summary-avail"); if (summaryAvailEl) summaryAvailEl.textContent = capitalReady ? n(capitalTWD) : "--";
    // expose to updPreview() in vendor HTML
    window.__IUF_AVAIL_CASH__ = capitalReady ? Number(capitalTWD) : 0;
    if (capitalReady) {
      delete window.__IUF_TICKET_LOCK_REASON__;
    } else {
      window.__IUF_TICKET_LOCK_REASON__ = "需要 Owner 登入才能預覽 / 送出紙上單";
    }
    const pAvail = $("#p-avail"); if (pAvail) pAvail.textContent = capitalReady ? n(capitalTWD) : "--";
    try {
      if (typeof window.updPreview === "function") window.updPreview();
    } catch {
      // Vendor preview is best-effort; backend preview still validates again on click.
    }
    // Apply broker-based submit button visibility on every hydration pass.
    applyBrokerSubmitVisibility();
    const submit = $("#submit-btn");
    const kgiSubmit = $("#submit-kgi-sim-btn");
    const getKgiSubmitLabel = () => $("#submit-kgi-sim-label") || kgiSubmit?.querySelector("b");
    const activeBroker = activeBrokerKey();
    const activeBrokerCopy = brokerSubmitCopy(activeBroker);
    if (submit && !capitalReady) {
      submit.disabled = true;
      const blockedLabel = $("#submit-btn-label") || submit.querySelector("b");
      if (blockedLabel) blockedLabel.textContent = "需要 Owner 登入才能預覽 / 送出紙上單";
      const gate = $(".gate .h .v"); if (gate) gate.textContent = "\u8cc7\u6599\u672a\u6388\u6b0a";
    }
    if (kgiSubmit && !capitalReady) {
      kgiSubmit.disabled = true;
      kgiSubmit.classList.add("is-blocked");
      kgiSubmit.setAttribute("aria-disabled", "true");
      kgiSubmit.dataset.blocked = "owner_session_required";
      const kgiBlockedLabel = getKgiSubmitLabel();
      if (kgiBlockedLabel) kgiBlockedLabel.textContent = "需要 Owner 登入";
    }
    // ── Unified submit (統一下單流 D1, 2026-07-09) ────────────────────────────
    // Both tickets share one core: build the ticket fields, run the existing
    // paper/preview risk-check dry-run (unchanged — preview stays on
    // /api/v1/paper/preview per design §4 PR-3 scope), then POST the single
    // real submit to /api/v1/trading/orders via submitUnifiedOrder(). Channel
    // routing (paper vs KGI SIM) is decided server-side from accountId, not
    // by which endpoint the client calls. No confirmation step is added here
    // (楊董 F2-O1: SIM tickets stay one-click) — submit cadence is unchanged.
    //
    // Self-reported pre-existing bug fixed alongside D1 (not caused by this
    // change, but it made the new endpoint unverifiable in a real browser so
    // it had to be fixed here): hydratePaper() re-runs on every refresh cycle
    // (line ~1672/3152) and this block re-queried submit/kgiSubmit and
    // called addEventListener() unconditionally each time, stacking a new
    // listener per hydration pass with no dedup (unlike hydrateBrokerStrip's
    // dataset.brokerClickWired guard just above). Because the FIRST pass is
    // always the fastPaperShell placeholder (capitalReady frozen false), and
    // browsers invoke same-target listeners in registration order, that first
    // stale listener always ran first and called stopImmediatePropagation()
    // before its own capitalReady check — permanently swallowing every click
    // for every later listener, including ones with real, ready data. Fixed
    // the same way hydrateBrokerStrip does: wire the listener once, and read
    // capitalReady/selected fresh at click time (from the shared live object,
    // which IS kept current) instead of the stale hydration-time snapshot.
    if (submit && !submit.dataset.iufSubmitWired) {
    submit.dataset.iufSubmitWired = "1";
    submit.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const capitalTWDNow = live.baseCapitalTWD;
      const capitalReady = capitalTWDNow !== null && capitalTWDNow !== undefined && !Number.isNaN(Number(capitalTWDNow));
      if (!capitalReady) return;
      const selected = mergePaperSelectedWithLastGoodQuote(live.selected || {});
      const qty = Number($("#t-qty")?.value || 0);
      const unit = $("#t-unit .on")?.dataset.unit === "share" ? "SHARE" : "LOT";
      const orderType = $("#t-otype")?.value || "limit";
      const side = $("#side .on")?.dataset.side || "buy";
      const rawPx = Number($("#t-price")?.value || 0);
      const selectedPx = Number(selected.price || 0);
      const px = orderType === "market" ? selectedPx : rawPx;
      const getSubmitLabel = () => $("#submit-btn-label") || submit.querySelector("b");
      const priceRequired = orderType !== "market";
      const invalidQty = !Number.isFinite(qty) || qty <= 0;
      const invalidPrice = priceRequired && (!Number.isFinite(rawPx) || rawPx <= 0);
      const invalidMarketPrice = !priceRequired && (!Number.isFinite(selectedPx) || selectedPx <= 0);
      if (invalidQty || invalidPrice || invalidMarketPrice) {
        const reason = invalidQty ? "請輸入有效數量" : (priceRequired ? "請輸入有效委託價" : "等待有效市價");
        const lbl = getSubmitLabel(); if (lbl) lbl.textContent = reason;
        const gate = $(".gate .h .v"); if (gate) gate.textContent = reason;
        submit.disabled = true;
        submit.classList.add("is-blocked");
        submit.setAttribute("aria-disabled", "true");
        submit.dataset.blocked = "invalid_ticket";
        return;
      }
      submit.disabled = true;
      submit.classList.remove("is-blocked");
      submit.removeAttribute("aria-disabled");
      delete submit.dataset.blocked;
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

        const accounts = await loadBrokerAccounts();
        const accountId = accountIdForBroker("paper", accounts);
        if (!accountId) {
          const blockedLabel = getSubmitLabel(); if (blockedLabel) blockedLabel.textContent = "紙上單未送出";
          const gate = $(".gate .h .v"); if (gate) gate.textContent = "找不到模擬帳號，請重新整理後再試";
          return;
        }
        const submitLabel1 = getSubmitLabel(); if (submitLabel1) submitLabel1.textContent = "送單中...";
        const orderPayload = { accountId, symbol: selected.symbol, side, type: orderType, quantity: qty, quantity_unit: unit, price: orderType === "market" ? null : px };
        const result = await submitUnifiedOrder(orderPayload);

        if (result.status === 409) {
          const body = result.body || {};
          const message = body.error === "channel_coming_soon" ? "此券商通道即將開放，敬請期待" : kgiChannelReasonLabel(body.reason);
          const blockedLabel = getSubmitLabel(); if (blockedLabel) blockedLabel.textContent = "紙上單未送出";
          const gate = $(".gate .h .v"); if (gate) gate.textContent = message;
          return;
        }
        if (!result.ok) {
          const data = result.body && result.body.data;
          const message = data ? unifiedBlockedMessage(data) : "紙上單未通過";
          const blockedLabel = getSubmitLabel(); if (blockedLabel) blockedLabel.textContent = "紙上單未通過";
          const gate = $(".gate .h .v"); if (gate) gate.textContent = message;
          return;
        }

        const order = result.body && result.body.data && result.body.data.order;
        const orderId = order && order.id ? String(order.id) : "";
        const lbl1 = getSubmitLabel(); if (lbl1) lbl1.textContent = orderId ? "紙上單 #" + orderId : "紙上單已送出";
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
    }

    if (kgiSubmit && !kgiSubmit.dataset.iufSubmitWired) {
    kgiSubmit.dataset.iufSubmitWired = "1";
    kgiSubmit.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const capitalTWDNow = live.baseCapitalTWD;
      const capitalReady = capitalTWDNow !== null && capitalTWDNow !== undefined && !Number.isNaN(Number(capitalTWDNow));
      if (!capitalReady) return;
      const selected = mergePaperSelectedWithLastGoodQuote(live.selected || {});
      const activeBrokerCopy = brokerSubmitCopy(activeBrokerKey());
      const qty = Number($("#t-qty")?.value || 0);
      const unit = $("#t-unit .on")?.dataset.unit === "share" ? "SHARE" : "LOT";
      const orderType = String($("#t-otype")?.value || "limit");
      const side = $("#side .on")?.dataset.side || "buy";
      const rawPx = Number($("#t-price")?.value || 0);
      const selectedPx = Number(selected.price || 0);
      const priceRequired = orderType !== "market";
      const invalidQty = !Number.isFinite(qty) || qty <= 0;
      const invalidPrice = priceRequired && (!Number.isFinite(rawPx) || rawPx <= 0);
      const invalidMarketPrice = !priceRequired && (!Number.isFinite(selectedPx) || selectedPx <= 0);
      const kgiLabel = getKgiSubmitLabel();
      const setGate = (message) => { const gate = $(".gate .h .v"); if (gate) gate.textContent = message; };
      if (orderType !== "market" && orderType !== "limit") {
        if (kgiLabel) kgiLabel.textContent = activeBrokerCopy.shortName + " 不支援停損單";
        setGate(activeBrokerCopy.shortName + " 只支援市價 / 限價");
        return;
      }
      if (invalidQty || invalidPrice || invalidMarketPrice) {
        const reason = invalidQty ? "請輸入有效數量" : (priceRequired ? "請輸入有效委託價" : "等待有效市價");
        if (kgiLabel) kgiLabel.textContent = reason;
        setGate(reason);
        return;
      }

      kgiSubmit.disabled = true;
      kgiSubmit.classList.remove("is-blocked");
      kgiSubmit.removeAttribute("aria-disabled");
      delete kgiSubmit.dataset.blocked;
      if (kgiLabel) kgiLabel.textContent = activeBrokerCopy.shortName + " 風控預檢中...";
      const px = orderType === "market" ? selectedPx : rawPx;
      const payload = {
        symbol: selected.symbol,
        side,
        orderType,
        qty,
        quantity_unit: unit,
        price: orderType === "market" ? null : px,
      };
      try {
        const directPayload = Object.assign({}, payload, { idempotencyKey: "v031_kgi_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2) });
        let preview;
        try {
          preview = { ok: true, data: await apiPost("/api/v1/paper/preview", directPayload) };
        } catch {
          preview = await fetch("/api/ui-final-v031-paper/preview", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((r) => r.json());
        }
        if (!preview.ok) throw new Error(preview.error || "preview_failed");

        const accounts = await loadBrokerAccounts();
        const accountId = accountIdForBroker("kgi", accounts);
        if (!accountId) {
          if (kgiLabel) kgiLabel.textContent = activeBrokerCopy.shortName + " 帳號未設定";
          setGate("找不到 KGI 模擬帳號，請重新整理後再試");
          return;
        }

        if (kgiLabel) kgiLabel.textContent = activeBrokerCopy.shortName + " 送單中...";
        const orderPayload = { accountId, symbol: selected.symbol, side, type: orderType, quantity: qty, quantity_unit: unit, price: orderType === "market" ? null : px };
        const result = await submitUnifiedOrder(orderPayload);

        if (result.status === 409) {
          const body = result.body || {};
          const message = body.error === "channel_coming_soon" ? "此券商通道即將開放，敬請期待" : kgiChannelReasonLabel(body.reason);
          if (kgiLabel) kgiLabel.textContent = activeBrokerCopy.shortName + " 未送出";
          setGate(message);
          return;
        }
        if (!result.ok) {
          const data = result.body && result.body.data;
          const message = data ? unifiedBlockedMessage(data) : activeBrokerCopy.shortName + " 未通過風控";
          if (kgiLabel) kgiLabel.textContent = activeBrokerCopy.shortName + " 未通過";
          setGate(message);
          return;
        }

        const order = result.body && result.body.data && result.body.data.order;
        const tradeId = order && order.brokerOrderId ? String(order.brokerOrderId) : (order && order.id ? String(order.id) : "");
        if (kgiLabel) kgiLabel.textContent = tradeId ? activeBrokerCopy.shortName + " #" + tradeId : activeBrokerCopy.shortName + " 已送出";
        setGate(activeBrokerCopy.shortName + " 已送出（正式實單仍鎖定）");
        try { await refreshClientLive(); } catch { /* ignore */ }
      } catch (err) {
        if (kgiLabel) kgiLabel.textContent = activeBrokerCopy.shortName + " 未送出";
        setGate(activeBrokerCopy.shortName + " 未送出，請確認委託內容或稍後再試");
      } finally {
        setTimeout(() => { kgiSubmit.disabled = false; }, 1200);
      }
    }, true);
    }

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
    const badgePositions = $('.lhead .tb[data-lt="positions"] .c'); if (badgePositions) badgePositions.textContent = String(portfolio.length);
    const badgeKgi = $('.lhead .tb[data-lt="kgi"] .c'); if (badgeKgi) badgeKgi.textContent = String(live.kgi?.positions?.length || 0);

    // ── Events table (synthesised from fills + orders) ────────────────────────
    const eventsBody = $("#events-body");
    if (eventsBody) {
      const events = [];
      // fills → buy/sell events
      (live.fills || []).slice(0, 100).forEach((f) => {
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
    const badgeEvents = $('.lhead .tb[data-lt="events"] .c'); if (badgeEvents) badgeEvents.textContent = String((live.fills || []).length + (live.orders || []).length);
    const wlSig = $("#wl-sig");
    const wlSigGroup = $("#wl-sig-group");
    const ideas = live.ideas || [];
    if (wlSig && ideas.length) {
      if (wlSigGroup) wlSigGroup.textContent = "策略候選 · " + ideas.length + " 檔";
      // Remove old static rows (keep only group div)
      Array.from(wlSig.querySelectorAll(".wrow")).forEach((el) => el.remove());
      ideas.forEach((idea) => {
        const div = document.createElement("div");
        div.className = "wrow" + (sameSym(idea.symbol, selected.symbol) ? " on" : "");
        div.dataset.sym = String(idea.symbol || "");
        const tone = String(idea.statusClass || "") === "allow" ? "ok" : String(idea.statusClass || "") === "block" ? "bad" : "warn";
        div.innerHTML = '<span class="sym">' + esc(String(idea.symbol || "—")) + '</span><div class="body"><div class="nm">' + esc(String(idea.companyName || idea.symbol || "—")) + '</div><div class="meta">' + esc(String(idea.signalCount || 0)) + ' 訊號 · ' + esc(String(idea.completeness || 0)) + '%</div></div><div class="price"><span class="v">—</span><span class="d ' + tone + '">' + esc(String(idea.status || "—")) + '</span></div>';
        wlSig.appendChild(div);
      });
    } else if (wlSig) {
      if (wlSigGroup) wlSigGroup.textContent = "\u7b56\u7565\u8a0a\u865f\u672a\u8f09\u5165";
      Array.from(wlSig.querySelectorAll(".wrow")).forEach((el) => el.remove());
      const div = document.createElement("div");
      div.className = "wrow";
      div.innerHTML = '<span class="sym">DATA</span><div class="body"><div class="nm">\u7b49\u5f85\u7b56\u7565\u8a0a\u865f\u56de\u50b3</div><div class="meta">\u4e0d\u986f\u793a\u9810\u8a2d\u5019\u9078</div></div>';
      wlSig.appendChild(div);
    }

    // ── Watchlist wl-paper (allow-only ideas) ─────────────────────────────────
    const wlPaper = $("#wl-paper");
    const wlPaperGroup = $("#wl-paper-group");
    const allowIdeas = ideas.filter((idea) => String(idea.decision || "") === "allow" || String(idea.decision || "") === "review");
    if (wlPaper && allowIdeas.length) {
      if (wlPaperGroup) wlPaperGroup.textContent = "可觀察 · 來自策略想法 · " + allowIdeas.length + " 檔";
      Array.from(wlPaper.querySelectorAll(".wrow")).forEach((el) => el.remove());
      allowIdeas.slice(0, 6).forEach((idea) => {
        const div = document.createElement("div");
        div.className = "wrow" + (sameSym(idea.symbol, selected.symbol) ? " on" : "");
        div.dataset.sym = String(idea.symbol || "");
        div.innerHTML = '<span class="sym">' + esc(String(idea.symbol || "—")) + '</span><div class="body"><div class="nm">' + esc(String(idea.companyName || idea.symbol || "—")) + '</div><div class="meta">AI 評分 ' + esc(String(idea.score || "—")) + ' · ' + esc(String(idea.confidence || "—")) + '</div></div><div class="price"><span class="v">—</span><span class="d ok">' + esc(String(idea.status || "—")) + '</span></div>';
        wlPaper.appendChild(div);
      });
    } else if (wlPaper) {
      if (wlPaperGroup) wlPaperGroup.textContent = "Paper \u5019\u9078\u672a\u8f09\u5165";
      Array.from(wlPaper.querySelectorAll(".wrow")).forEach((el) => el.remove());
      const div = document.createElement("div");
      div.className = "wrow";
      div.innerHTML = '<span class="sym">DATA</span><div class="body"><div class="nm">\u7b49\u5f85\u7d19\u4e0a\u4ea4\u6613\u5019\u9078\u56de\u50b3</div><div class="meta">\u4e0d\u986f\u793a\u9810\u8a2d\u5019\u9078</div></div>';
      wlPaper.appendChild(div);
    }
  }

  if (live.screen === "market-intel") hydrateMarket();
  if (live.screen === "strategy-ideas") hydrateIdeas();
  if (live.screen === "paper-trading-room") hydratePaper();
  refreshClientLive();
  if (live.screen === "paper-trading-room") {
    updatePaperQuoteQualityBadge("stream", { degraded: true });
    if (!window.__IUF_FINAL_V031_QUOTE_PULSE_STARTED__) {
      window.__IUF_FINAL_V031_QUOTE_PULSE_STARTED__ = true;
      openPaperQuoteStream();
      refreshPaperQuotePulse();
      setInterval(refreshPaperQuotePulse, 3000);
    }
    if (!window.__IUF_FINAL_V031_LIVE_REFRESH_STARTED__) {
      window.__IUF_FINAL_V031_LIVE_REFRESH_STARTED__ = true;
      setInterval(refreshClientLive, 15000);
    }
  }
})();
</script>`;
}
