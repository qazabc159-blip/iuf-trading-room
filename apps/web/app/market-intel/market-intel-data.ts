// /market-intel 房子樣式重做的資料層（2026-07-21）。
//
// 沿用既有正式端點（見 apps/web/lib/api.ts），映射邏輯改寫自
// apps/web/lib/final-v031-live.ts 的 buildMarketIntelPayload()（舊 iframe
// 版用），但那些是模組內未匯出的私有函式、且與其他三個 final-v031 screen
// 的 hydration script 耦合，不安全直接 import——這裡是獨立、僅供本頁使用
// 的輕量版本，行為刻意保持一致（分鐘級新鮮度文字、公告來源過濾規則等）。
import {
  getFinMindStatus,
  getMarketIntelAnnouncements,
  getMarketInstitutionalSummary,
  getNewsTop10,
  getTwseMarketHeatmap,
  type CompanyAnnouncement,
  type NewsAiItem,
} from "@/lib/api";
import { industryLabel } from "@/lib/industry-i18n";

// 2026-07-17 P0 教訓（MARKET_INTEL_OUTAGE_RCA）：apps/web/lib/api.ts 的
// request()/requestRaw() 不帶 AbortSignal，單一上游卡住會讓整頁 SSR 掛住。
// 用 race 幫每個來源都設一個上限，逾時視同該來源不可用（走既有 empty 分支），
// 不是放大成整頁 500。
const UPSTREAM_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
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

const TOPIC_LABEL: Record<string, string> = {
  ai: "AI 硬體",
  semi: "半導體",
  fin: "金融",
  auto: "電動車",
  market: "市場",
};

function inferTopic(text: string): keyof typeof TOPIC_LABEL {
  if (/AI|GB200|伺服器|散熱|ASIC|GPU|CoWoS/i.test(text)) return "ai";
  if (/半導體|晶圓|製程|IC|封測|矽|SoC/i.test(text)) return "semi";
  if (/金控|銀行|壽險|金融|利率/i.test(text)) return "fin";
  if (/電動車|車用|EV|汽車/i.test(text)) return "auto";
  return "market";
}

// 剝去轉載頭條尾巴的來源站名（例："...｜新聞快訊｜豐雲學堂 - sinotrade.com.tw"）。
function cleanHeadline(raw: string): string {
  let text = raw.trim();
  text = text.replace(/\s+-\s+[\w.-]+\.(?:com|net|org|tw|cn|io)(?:\.\w+)?\s*$/i, "");
  while (true) {
    const match = text.match(/^(.*)[｜|]([^｜|]{1,16})$/);
    if (!match || /[，。,.!?]/.test(match[2]!)) break;
    text = match[1]!.trim();
  }
  return text.trim() || raw.trim();
}

function isTwTicker(value?: string | null) {
  return /^[0-9]{4}[A-Z]?$/.test(String(value ?? "").trim());
}

function companyHref(symbol?: string | null) {
  return isTwTicker(symbol) ? `/companies/${encodeURIComponent(String(symbol))}` : "/companies";
}

function recommendationHref(symbol?: string | null) {
  return isTwTicker(symbol) ? `/ai-recommendations?symbol=${encodeURIComponent(String(symbol))}` : "/ai-recommendations";
}

export type MarketIntelFeedItem = {
  id: string;
  symbol: string;
  name: string;
  title: string;
  source: string;
  tag: string;
  topic: keyof typeof TOPIC_LABEL;
  topicLabel: string;
  why: string;
  age: string;
  companyHref: string;
  recommendationHref: string;
};

// impact_tier 是後端 enum（HIGH/MID/LOW），沒有 tags 時當 fallback 標籤用——
// 直接顯示會漏工程字串，翻成人話再上畫面。
function impactLabel(tier: NewsAiItem["impact_tier"]): string | null {
  if (tier === "HIGH") return "高關注";
  if (tier === "MID") return "中度關注";
  if (tier === "LOW") return "低度關注";
  return null;
}

function mapNewsItem(item: NewsAiItem, index: number): MarketIntelFeedItem {
  const title = cleanHeadline(item.headline || "市場訊息");
  const tag = item.tags?.[0] ?? impactLabel(item.impact_tier) ?? "市場情報";
  const topic = inferTopic(`${title} ${tag}`);
  return {
    id: item.id ?? `news-${index}`,
    symbol: item.ticker ?? "大盤",
    name: item.companyName ?? "",
    title,
    source: sourceLabel(item.source),
    tag,
    topic,
    topicLabel: TOPIC_LABEL[topic],
    why: item.why_matters ?? "已列入今日研究清單，需搭配來源狀態與 AI 推薦交叉判讀。",
    age: minutesAgoText(item.date),
    companyHref: companyHref(item.ticker),
    recommendationHref: recommendationHref(item.ticker),
  };
}

// 只保留真官方公告（排除轉載新聞混進同一個 fallback bucket）。
function isOfficialMarketAnnouncement(item: CompanyAnnouncement) {
  const source = String(item.source ?? "").toLowerCase();
  const title = `${item.title ?? ""} ${item.body ?? ""}`;
  if (source.includes("finmind_stock_news")) return false;
  if (/cmoney|money-link|yahoo|udn|pchome|小編|新聞網|news/i.test(title)) return false;
  return source.includes("twse") || source.includes("mops") || source.includes("announcement");
}

// 後端 category 有時是原始英文/半形分類字串（見 company 頁 AnnouncementsPanel
// 的同款坑），先分桶成人話再顯示，不要讓 category 原字面漏到畫面。
function announcementCategoryLabel(category: string | null | undefined): string {
  const text = String(category ?? "").toLowerCase();
  if (/material|announcement|major|重大|公告|法說|股東會/.test(text)) return "重大訊息";
  if (/dividend|financial|revenue|eps|earnings|財報|營收|股利|配息|盈餘/.test(text)) return "財務公告";
  return category || "一般公告";
}

function mapAnnouncement(item: CompanyAnnouncement, index: number): MarketIntelFeedItem {
  const title = item.title || item.body || "官方重大訊息";
  const tag = announcementCategoryLabel(item.category);
  const topic = inferTopic(`${title} ${tag}`);
  return {
    id: item.id ?? `ann-${index}`,
    symbol: item.ticker ?? "公告",
    name: item.companyName ?? "",
    title,
    source: sourceLabel(item.source),
    tag,
    topic,
    topicLabel: TOPIC_LABEL[topic],
    why: item.body?.slice(0, 72) || "官方來源已進入今日市場情報，請搭配 AI 推薦做研究判讀。",
    age: minutesAgoText(item.date),
    companyHref: companyHref(item.ticker),
    recommendationHref: recommendationHref(item.ticker),
  };
}

export type MarketIntelFeedState = {
  live: boolean;
  label: string;
  summary: string;
  detail: string;
};

function buildFeedState(items: MarketIntelFeedItem[], aiSelectedCount: number, selectionMode: string | null): MarketIntelFeedState {
  if (items.length > 0) {
    const usingAi = aiSelectedCount > 0;
    return {
      live: usingAi,
      label: usingAi ? "AI 精選已回傳" : "官方公告備援",
      summary: `顯示 ${items.length} 則${usingAi ? " AI 精選" : "官方公告"}`,
      detail: selectionMode === "ai" ? "AI 篩選已完成今日排程。" : "AI 精選暫無項目，改用官方公告排序；不顯示示意新聞。",
    };
  }
  return {
    live: false,
    label: "等待正式資料",
    summary: "目前沒有可呈現的正式市場情報",
    detail: "AI 精選與官方公告排程尚未回傳；資料到位後自動顯示，不顯示示意新聞。",
  };
}

// 下次抓取要顯示「未來」時間，不能沿用 minutesAgoText（那是算「過去」）。
function nextRefreshText(iso: string | null | undefined): string {
  if (!iso) return "排程中";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "排程中";
  if (ms <= 60_000) return "即將更新";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} 分鐘後`;
  return `${Math.round(minutes / 60)} 小時後`;
}

export type MarketIntelSource = {
  name: string;
  label: string;
  state: "ok" | "warn";
  status: string;
  fresh: string;
};

export type MarketIntelHeatmapTile = {
  industry: string;
  avgChangePct: number;
  gainerCount: number;
  loserCount: number;
  stockCount: number;
  tone: "up" | "down" | "flat";
  label: string;
};

function mapHeatmapTile(industry: string, avgChangePct: number, gainerCount: number, loserCount: number, stockCount: number): MarketIntelHeatmapTile {
  const tone = avgChangePct > 0.3 ? "up" : avgChangePct < -0.3 ? "down" : "flat";
  return {
    industry: industryLabel(industry),
    avgChangePct,
    gainerCount,
    loserCount,
    stockCount,
    tone,
    label: `${avgChangePct >= 0 ? "+" : ""}${avgChangePct.toFixed(2)}%`,
  };
}

export type MarketIntelInstitutionalLine = { buy: number; sell: number; net: number } | null;

export type MarketIntelInstitutional = {
  asOf: string | null;
  totalNet: number | null;
  foreign: MarketIntelInstitutionalLine;
  invest: MarketIntelInstitutionalLine;
  dealer: MarketIntelInstitutionalLine;
};

export type MarketIntelPayload = {
  generatedAt: string;
  stats: {
    total: number;
    aiSelected: number;
    sourceOk: number;
    sourceTotal: number;
    nextRefresh: string;
  };
  items: MarketIntelFeedItem[];
  feedState: MarketIntelFeedState;
  sources: MarketIntelSource[];
  heatmap: MarketIntelHeatmapTile[];
  institutional: MarketIntelInstitutional | null;
};

export async function loadMarketIntel(): Promise<MarketIntelPayload> {
  const [newsResult, announcementsResult, finMindResult, heatmapResult, institutionalResult] = await Promise.allSettled([
    withTimeout(getNewsTop10(), UPSTREAM_TIMEOUT_MS, "getNewsTop10"),
    withTimeout(getMarketIntelAnnouncements({ days: 30, limit: 20, scope: "market" }), UPSTREAM_TIMEOUT_MS, "getMarketIntelAnnouncements"),
    withTimeout(getFinMindStatus(), UPSTREAM_TIMEOUT_MS, "getFinMindStatus"),
    withTimeout(getTwseMarketHeatmap(), UPSTREAM_TIMEOUT_MS, "getTwseMarketHeatmap"),
    withTimeout(getMarketInstitutionalSummary(), UPSTREAM_TIMEOUT_MS, "getMarketInstitutionalSummary"),
  ]);

  const news = settledValue(newsResult)?.data ?? null;
  const announcements = settledValue(announcementsResult)?.data ?? null;
  const finMind = settledValue(finMindResult)?.data ?? null;
  const heatmapRaw = settledValue(heatmapResult);
  const institutionalRaw = settledValue(institutionalResult);

  const aiItems = news?.items?.map(mapNewsItem) ?? [];
  const announcementItems = announcements?.items?.filter(isOfficialMarketAnnouncement).map(mapAnnouncement) ?? [];
  const items = (aiItems.length ? aiItems : announcementItems).slice(0, 12);

  const finMindLive = !!finMind && (finMind.state === "LIVE_READY" || finMind.datasets?.some((dataset) => dataset.state === "LIVE"));
  const mopsLive = (announcements?.items?.length ?? 0) > 0 && (announcements?.failures ?? 0) === 0;
  const aiLive = !!news?.items?.length && news.ai_call_success !== false;
  const sourceOkCount = [mopsLive, finMindLive, aiLive].filter(Boolean).length;

  const heatmap = (heatmapRaw?.data ?? [])
    .map((tile) => mapHeatmapTile(tile.industry, tile.avgChangePct ?? 0, tile.gainerCount ?? 0, tile.loserCount ?? 0, tile.stockCount ?? 0))
    .sort((a, b) => Math.abs(b.avgChangePct) - Math.abs(a.avgChangePct))
    .slice(0, 12);

  let institutional: MarketIntelInstitutional | null = null;
  if (institutionalRaw) {
    const institutions = institutionalRaw.institutions ?? [];
    const line = (matchName: string) => {
      const found = institutions.find((inst) => inst.name?.includes(matchName));
      return found ? { buy: found.buy, sell: found.sell, net: found.net } : null;
    };
    institutional = {
      asOf: institutionalRaw.asOf ?? null,
      totalNet: institutionalRaw.totalNet ?? null,
      foreign: line("外"),
      invest: line("投信"),
      dealer: line("自營"),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      total: Math.max(news?.input_row_count ?? 0, items.length),
      aiSelected: news?.items?.length ?? 0,
      sourceOk: sourceOkCount,
      sourceTotal: 3,
      nextRefresh: nextRefreshText(news?.next_refresh_at),
    },
    items,
    feedState: buildFeedState(items, aiItems.length, news?.selection_mode ?? null),
    sources: [
      {
        name: "公開資訊觀測站",
        label: mopsLive ? `官方公告已回傳 ${announcements?.items?.length ?? 0} 則` : "目前無可呈現公告",
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
    heatmap,
    institutional,
  };
}
