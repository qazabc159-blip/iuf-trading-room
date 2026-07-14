import Link from "next/link";
import { cache, Suspense } from "react";
import type { CSSProperties } from "react";

import { IndustryHeatmap, type IndustryHeatmapTile } from "./components/industry-heatmap";
import { MarketStateBanner } from "@/components/MarketStateBanner";
import { HomeBriefColumn, type BriefSegmentView } from "./home-brief-column";
import { HomeRecCtaRow } from "./home-rec-cta";
import { HomeZoomController } from "./home-zoom-controller";
import {
  getAiRecommendationsV3,
  getBriefs,
  getContentDrafts,
  getKgiCoreHeatmap,
  getKgiMarketOverview,
  getLabStrategySnapshot,
  getMarketDataOverview,
  getMarketIntelAnnouncements,
  getNewsTop10,
  getTwseMarketHeatmap,
  getTwseMarketOverview,
  type AiRecommendationV3Response,
  type CompanyAnnouncement,
  type KgiCoreHeatmap,
  type KgiCoreHeatmapTile,
  type KgiMarketOverview,
  type LabStrategySnapshot,
  type MarketDataOverview,
  type MarketDataOverviewLeader,
  type NewsAiItem,
  type NewsTop10Data,
  type TwseIndustryHeatmap,
  type TwseIndustryHeatmapTile,
  type TwseMarketOverview,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { hasProductHeatmapCoverage } from "@/lib/heatmap-product-coverage";
import { heatmapIndustryLabel } from "@/lib/heatmap-industry-label";
import { deriveHomeAiRecommendationCards } from "@/lib/home-ai-recommendation-rows";
import { isKgiGatewayScheduledOff, isKgiTradingHours, kgiCoreTilesAreNull } from "@/lib/kgi-trading-hours";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";
import { getTrackRecordNav, type TrackRecordNavSummary } from "@/lib/fauto-sim-api";
import { MISSING_COMPANY_NAME_LABEL } from "@/lib/ui-vocab";
import { buildV3PanelState } from "./ai-recommendations/v3-view";
import { formatRecommendationTimestamp } from "./ai-recommendations/source-trail-time";
import type { DailyBrief } from "@iuf-trading-room/contracts";

// ══════════════════════════════════════════════════════════════════════════
// 首頁「原封搬原稿」React server component 版（2026-07-14 楊董終令：重做，
// 恢復幾週打磨的 React 資料層與元件，只換皮膚成原稿版面，不再用 iframe +
// inline script 重造輪子）。
//
// 資料層／熱力圖管線／breadth／index 讀值／文案清洗全部承自舊版
// server-component 首頁（git show 70c8a980~1:apps/web/app/page.tsx，逐字保留
// 邏輯，只做三處新增：①saneStockPct 過濾垃圾漲跌停外數值 ②TAIEX 日線走勢
// ③文字密度真截斷）。`<IndustryHeatmap>` 元件與 industry-heatmap.tsx 內的
// treemap/分組/自適應標籤邏輯完全未動，只 import 使用。
//
// v5.1 LEDGER 版面 CSS（`.tac-ledger` 系列 class）已在 globals.css 就緒
// （2026-07-13 逐塊移植原稿），本檔只需輸出對應 markup。舊版「cockpit」
// 面板（Panel/HeroPanel/TopCommandBar/MarketMoversPanel/... 等）與其專屬
// helper 一併不再保留——它們從未被 Ledger 版面掛載，是前一輪已放棄設計的
// 死碼，這裡不隨全檔搬遷（Simplicity First）。fetch 清單同理砍掉
// finmind/ops/dashboard-snapshot 三項（Ledger 沒有任何面板消費它們）。
//
// 側欄/HeaderDock 保留鐵律：本頁刻意不使用舊 `.tactical-dashboard` root
// class——globals.css 對它掛了 `body:has(.tactical-dashboard) .app-sidebar
// {display:none}`，是 7/14 楊董抓到「側欄呢？」的根因之一。新 root class
// `.home-ledger-shell` 是全新命名，globals.css 沒有任何 `:has()` 規則指到
// 它，這頁只是掛在 app 殼裡的一般 route 內容區塊。
// ══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LoadState<T> =
  | { state: "LIVE"; data: T; updatedAt: string; source: string }
  | { state: "EMPTY"; data: T; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: T; updatedAt: string; source: string; reason: string };

type DashboardState = "LIVE" | "STALE" | "EMPTY" | "REVIEW" | "BLOCKED" | "DEGRADED";

type DailyBriefDashboard = {
  today: string;
  state: "PUBLISHED" | "AWAITING_REVIEW" | "MISSING" | "BLOCKED";
  latestDate: string | null;
  latest: DailyBrief | null;
  todayBrief: DailyBrief | null;
  draftCount: number;
  reason?: string;
};

type S1StrategyData = LabStrategySnapshot;

type IntelItem = CompanyAnnouncement & {
  companyId?: string;
  ticker: string;
  companyName: string;
  feedKind?: "ai_selected" | "official_announcement";
  impactTier?: NewsAiItem["impact_tier"];
  whyMatters?: string | null;
  sourceLabel?: string;
};

type MarketIntelDashboard = {
  items: IntelItem[];
  selected: Array<{ id: string; ticker: string; name: string }>;
  failures: number;
  aiSelectedCount: number;
  officialCount: number;
  sourceState: {
    newsEndpoint: string;
    announcementsEndpoint: string;
    newsMode: NewsTop10Data["selection_mode"] | null;
    newsAsOf: string | null;
    newsNextRefreshAt: string | null;
    newsStaleReason: string | null;
    newsAiCallSuccess: boolean | null;
    newsInputRows: number | null;
    announcementsSource: "twse_announcements" | "finmind_stock_news" | "mixed" | "empty" | null;
    owner: string;
    nextAction: string;
  };
};

type RealtimeMarketDashboard = {
  kgiOverview: KgiMarketOverview | null;
  kgiCoreHeatmap: KgiCoreHeatmap | null;
  twseOverview: TwseMarketOverview | null;
  twseHeatmap: TwseIndustryHeatmap | null;
};

type MarketIndexDisplay = {
  sym: string;
  name: string;
  price: number | null;
  chg: number | null;
  pct: number | null;
  updatedAt: string | null;
  label: string;
  source: "realtime" | "close" | "fallback" | "none";
};

type BreadthDisplay = {
  up: number;
  down: number;
  flat: number;
  total: number;
  amount: number | null;
  updatedAt: string | null;
  label: string;
};

type HeatTile = IndustryHeatmapTile & {
  placeholder?: boolean;
};

const TAIPEI_TIME_ZONE = "Asia/Taipei";
const ANNOUNCEMENT_DAYS = 30;
const MAX_INTEL_ROWS = 12;
const MAX_HEATMAP_TILES = 240;
const HEATMAP_SECTOR_LABELS: Record<string, string> = {
  semiconductors: "半導體業",
  "semiconductor equipment & materials": "半導體設備材料",
  "electronic components": "電子零組件",
  "computer hardware": "電腦及週邊設備",
  "electronics & computer distribution": "電子通路",
  "consumer electronics": "消費性電子",
  "communication equipment": "通信網路",
  "banks - regional": "金融銀行",
  steel: "鋼鐵工業",
  "specialty chemicals": "化學工業",
  chemicals: "化學工業",
  "auto parts": "汽車零組件",
  biotechnology: "生技醫療",
  "medical devices": "醫療器材",
  "real estate": "建材營造",
  construction: "建材營造",
  "packaged foods": "食品工業",
  "textile manufacturing": "紡織纖維",
  "shipping & ports": "航運業",
  airlines: "航空運輸",
};

function nowIso() {
  return new Date().toISOString();
}

async function load<T>(
  source: string,
  emptyValue: T,
  fn: () => Promise<T>,
  isEmpty: (value: T) => boolean,
  emptyReason: string,
): Promise<LoadState<T>> {
  const updatedAt = nowIso();
  try {
    const data = await fn();
    if (isEmpty(data)) {
      return { state: "EMPTY", data, updatedAt, source, reason: emptyReason };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyValue,
      updatedAt,
      source,
      reason: friendlyDataError(error),
    };
  }
}

// ── Per-fetch timeout wrapper ─────────────────────────────────────────────────
const FETCH_MARKET_MS = 15000; // TWSE EOD can be slow on cold cache; backend 3s internal timeout + 5min cache
const KGI_MARKET_ENDPOINT_MS = 3500;
const FETCH_PRODUCT_MS = 12000; // brief/recommendations/S1 product truth
const FETCH_INTEL_MS = 12000;
const INTEL_SOURCE_MS = 7000;
const PUBLIC_MARKET_ENDPOINT_MS = 10000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | { _timeout: string }> {
  return Promise.race([
    p,
    new Promise<{ _timeout: string }>((resolve) => setTimeout(() => resolve({ _timeout: `timeout_${ms}ms_${label}` }), ms)),
  ]);
}

async function timedFetch<T>(label: string, ms: number, p: Promise<T>): Promise<T | { _timeout: string }> {
  const t0 = Date.now();
  const result = await withTimeout(p, ms, label);
  const elapsed = Date.now() - t0;
  const isTimeout = typeof result === "object" && result !== null && "_timeout" in result;
  if (isTimeout) {
    console.warn(`[homepage-fetch] ${label} TIMEOUT after ${elapsed}ms (budget: ${ms}ms)`);
  } else {
    console.warn(`[homepage-fetch] ${label} took ${elapsed}ms (status: ok)`);
  }
  return result;
}

function isTimeoutSentinel(value: unknown): value is { _timeout: string } {
  return typeof value === "object" && value !== null && "_timeout" in value && typeof (value as { _timeout?: unknown })._timeout === "string";
}

function todayTaipeiDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TAIPEI_TIME_ZONE });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", { timeZone: TAIPEI_TIME_ZONE, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatClock(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { timeZone: TAIPEI_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-TW", { timeZone: TAIPEI_TIME_ZONE, month: "2-digit", day: "2-digit" });
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-TW") : "--";
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPrice(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const digits = value >= 1000 ? 0 : value >= 100 ? 1 : 2;
  return value.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function stateFromLoad(input: LoadState<unknown> | LoadState<unknown>["state"]): DashboardState {
  const state = typeof input === "string" ? input : input.state;
  if (state === "LIVE") return "LIVE";
  if (state === "EMPTY") return "EMPTY";
  return "BLOCKED";
}

function unwrapMaybeData<T>(value: T | { data: T }): T {
  return typeof value === "object" && value !== null && "data" in value ? (value as { data: T }).data : (value as T);
}

function unwrapKgiCoreHeatmap(value: KgiCoreHeatmap | { data: KgiCoreHeatmap }): KgiCoreHeatmap {
  if (typeof value === "object" && value !== null && Array.isArray((value as KgiCoreHeatmap).data)) {
    return value as KgiCoreHeatmap;
  }
  return unwrapMaybeData<KgiCoreHeatmap>(value);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function taipeiDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: TAIPEI_TIME_ZONE });
}

function closeLabel(updatedAt: string | null | undefined) {
  return taipeiDate(updatedAt) === todayTaipeiDate() ? "今日收盤" : "昨日收盤";
}

function isStaleTimestamp(value: string | null | undefined, staleAfterSec = 60) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() > staleAfterSec * 1000;
}

function loadStateData<T>(state: LoadState<T | null>) {
  return state.state === "LIVE" || state.state === "EMPTY" ? state.data : null;
}

function freshnessText(updatedAt: string | null | undefined, state: DashboardState) {
  if (!updatedAt) return state === "EMPTY" ? "尚未回報" : "--";
  const time = Date.parse(updatedAt);
  if (!Number.isFinite(time)) return formatDateTime(updatedAt);
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (state === "LIVE") {
    if (minutes < 60) return `${Math.max(1, minutes)} 分鐘`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} 小時`;
  }
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} 天前`;
  return formatDateTime(updatedAt);
}

function maskUnsafeAdviceText(text: string) {
  const patterns = [/買進/g, /賣出/g, /目標價/g, /必賺/g, /保證/g, /勝率/g];
  return patterns.reduce((next, pattern) => next.replace(pattern, "[交易建議字詞已遮蔽]"), text);
}

function safeBriefText(text: string) {
  return maskUnsafeAdviceText(cleanNarrativeText(text));
}

function briefHeadingText(heading: string | null | undefined, index: number) {
  const raw = heading?.trim() ?? "";
  const key = raw.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  const known: Record<string, string> = {
    "market overview": "盤勢總覽",
    "theme summaries": "題材摘要",
    "company notes": "公司觀察",
    "risk notes": "風險提示",
    risks: "風險提示",
    confirmation: "確認狀態",
  };
  if (known[key]) return known[key];
  const fallback = ["盤勢總覽", "題材摘要", "公司觀察"][index] ?? "簡報段落";
  return cleanExternalHeadline(raw, fallback);
}

function polishedBriefText(text: string) {
  const cleaned = safeBriefText(text);
  return cleaned
    .replace(/\bMarket State\s*:\s*/gi, "市場狀態：")
    .replace(/\bActive Themes\s*:\s*/gi, "活躍題材：")
    .replace(/\bPriority\s*(\d+)\s*:\s*/gi, "優先級 $1：")
    .replace(/\bMarket Overview\b/gi, "盤勢總覽")
    .replace(/\bTheme Summaries\b/gi, "題材摘要")
    .replace(/\bCompany Notes\b/gi, "公司觀察")
    .replace(/\[Discovery\/([^\]]+)\]/gi, "（探索／$1）")
    .replace(/\s+—\s+/g, "；")
    .replace(/\s*•\s*/g, "、")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function categoryLabel(category: string | null | undefined) {
  if (!category) return "重大訊息";
  const key = category.toLowerCase();
  if (key === "ai_selected") return "AI 精選";
  if (key === "high") return "高影響";
  if (key === "mid" || key === "medium") return "中影響";
  if (key === "low") return "低影響";
  if (key === "earnings" || key === "financial") return "財報";
  if (key === "revenue") return "營收";
  if (key === "news") return "新聞";
  if (key === "theme") return "主題";
  if (key === "industry") return "產業";
  if (key === "supply_chain") return "供應鏈";
  if (key === "technical") return "技術面";
  if (key === "fundamental") return "基本面";
  if (key === "material" || key === "announcement") return "重大訊息";
  return category.replace(/[_-]/g, " ");
}

function intelTitleText(item: IntelItem) {
  const title = cleanExternalHeadline(item.title?.trim() ?? "");
  return title || "重大訊息標題未回傳";
}

function aiNewsToIntelItem(item: NewsAiItem): IntelItem {
  return {
    id: item.id,
    date: item.date,
    title: item.headline,
    category: item.impact_tier ?? "ai_selected",
    body: item.why_matters ?? undefined,
    ticker: item.ticker ?? "MARKET",
    companyName: item.companyName ?? "大盤",
    url: item.url ?? null,
    source: item.source,
    feedKind: "ai_selected",
    impactTier: item.impact_tier,
    whyMatters: item.why_matters,
    sourceLabel: item.source === "twse_announcements" ? "官方公告" : item.source === "finmind_stock_news" ? "FinMind 新聞" : "混合來源",
  };
}

function officialAnnouncementToIntelItem(item: CompanyAnnouncement): IntelItem {
  return {
    ...item,
    ticker: item.ticker ?? "MARKET",
    companyName: item.companyName ?? "大盤",
    feedKind: "official_announcement",
    sourceLabel: item.source?.includes("twse") ? "官方公告" : item.source?.includes("finmind") ? "FinMind" : "正式來源",
  };
}

function asDraftRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function draftDate(payload: unknown, fallback: string | null) {
  const record = asDraftRecord(payload);
  const value = record.date ?? record.targetDate;
  return typeof value === "string" ? value.slice(0, 10) : (fallback?.slice(0, 10) ?? null);
}

// ── 文字密度真截斷（2026-07-14 楊董標準：跟原稿一句話密度看齊，非 CSS clamp）──
function splitZhSentences(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of s) {
    cur += ch;
    if (ch === "。" || ch === "；") {
      out.push(cur);
      cur = "";
    }
  }
  if (cur) out.push(cur);
  return out;
}

function hardTruncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  let cut = s.slice(0, maxLen);
  const lastBoundary = Math.max(cut.lastIndexOf("，"), cut.lastIndexOf("、"), cut.lastIndexOf(" "), cut.lastIndexOf("："));
  if (lastBoundary > maxLen * 0.6) cut = cut.slice(0, lastBoundary);
  return cut.replace(/[，、\s：]+$/, "") + "…";
}

// AI 推薦理由：取第一句，仍過長才硬截斷
function firstSentence(text: string | null | undefined, maxLen: number): string {
  if (!text) return "";
  const s = text.trim();
  const head = splitZhSentences(s)[0] || s;
  return hardTruncate(head, maxLen);
}

// 簡報段落節錄：取前 maxSentences 句，仍過長才硬截斷
function firstSentences(text: string | null | undefined, maxSentences: number, maxLen: number): string {
  if (!text) return "";
  const s = text.trim();
  const head = splitZhSentences(s).slice(0, maxSentences).join("") || s;
  return hardTruncate(head, maxLen);
}

// 台股個股單日漲跌停 ±10%（留 1% 緩衝給極少數除權息類特殊情形）。任何個股
// |pct|>11% 都不是合法值，代表上游來源在盤後空窗回傳了 stale/殘值或壞掉的
// changePct（2026-07-14 楊董抓到 2330 顯示 -90.91%/2454 顯示 -98.21% 這類
// 垃圾值，見 iframe 版修復 jim_memory 2026-07-14 條目）。寧可顯示「無行情」
// 也不顯示錯誤數字。
const TAIWAN_STOCK_DAILY_LIMIT_PCT = 11;
function saneStockPct(pct: number | null): number | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  if (Math.abs(pct) > TAIWAN_STOCK_DAILY_LIMIT_PCT) return null;
  return pct;
}

async function loadDailyBriefDashboard(): Promise<LoadState<DailyBriefDashboard>> {
  const today = todayTaipeiDate();
  return load<DailyBriefDashboard>(
    "OpenAlice / Daily Brief",
    { today, state: "BLOCKED", latestDate: null, latest: null, todayBrief: null, draftCount: 0, reason: "每日簡報資料讀取失敗。" },
    async () => {
      const briefs = (await getBriefs()).data;
      const sortedBriefs = [...briefs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const latest = sortedBriefs[0] ?? null;
      const todayBrief = sortedBriefs.find((brief) => brief.status === "published" && brief.date.slice(0, 10) === today) ?? null;

      if (todayBrief) {
        return { today, state: "PUBLISHED" as const, latestDate: todayBrief.date.slice(0, 10), latest, todayBrief, draftCount: 0 };
      }

      const drafts = (await getContentDrafts({ status: "awaiting_review", limit: 50 })).data;
      const todayDrafts = drafts.filter((draft) => draft.targetTable === "daily_briefs" && draftDate(draft.payload, draft.targetEntityId) === today);
      if (todayDrafts.length > 0) {
        return { today, state: "AWAITING_REVIEW" as const, latestDate: latest?.date.slice(0, 10) ?? null, latest, todayBrief: null, draftCount: todayDrafts.length };
      }
      return {
        today,
        state: "MISSING" as const,
        latestDate: latest?.date.slice(0, 10) ?? null,
        latest,
        todayBrief: null,
        draftCount: todayDrafts.length,
        reason: "今天尚未發布每日簡報，也沒有等待確認的今日草稿。",
      };
    },
    (value) => value.state === "MISSING",
    "今天尚未產生每日簡報。",
  );
}

async function loadRealtimeMarketDashboard(): Promise<LoadState<RealtimeMarketDashboard | null>> {
  return load<RealtimeMarketDashboard | null>(
    "Main market public/realtime feed",
    null,
    async () => {
      const [kgiOverview, kgiCoreHeatmap, twseOverview, twseHeatmap] = await Promise.allSettled([
        withTimeout(getKgiMarketOverview(), KGI_MARKET_ENDPOINT_MS, "kgi_overview"),
        withTimeout(getKgiCoreHeatmap(), KGI_MARKET_ENDPOINT_MS, "kgi_core_heatmap"),
        withTimeout(getTwseMarketOverview(), PUBLIC_MARKET_ENDPOINT_MS, "twse_overview"),
        withTimeout(getTwseMarketHeatmap(), PUBLIC_MARKET_ENDPOINT_MS, "twse_heatmap"),
      ]);

      const kgiOverviewValue = kgiOverview.status === "fulfilled" && !isTimeoutSentinel(kgiOverview.value) ? unwrapMaybeData(kgiOverview.value) : null;
      const kgiCoreHeatmapValue = kgiCoreHeatmap.status === "fulfilled" && !isTimeoutSentinel(kgiCoreHeatmap.value) ? unwrapKgiCoreHeatmap(kgiCoreHeatmap.value) : null;
      const twseOverviewValue = twseOverview.status === "fulfilled" && !isTimeoutSentinel(twseOverview.value) ? twseOverview.value : null;
      const twseHeatmapValue = twseHeatmap.status === "fulfilled" && !isTimeoutSentinel(twseHeatmap.value) ? twseHeatmap.value : null;
      return { kgiOverview: kgiOverviewValue, kgiCoreHeatmap: kgiCoreHeatmapValue, twseOverview: twseOverviewValue, twseHeatmap: twseHeatmapValue };
    },
    (value) => {
      if (!value) return true;
      return !value.kgiOverview?.taiex && !value.twseOverview?.taiex && !value.kgiCoreHeatmap?.data?.length && !value.kgiCoreHeatmap?.tiles?.length && !value.twseHeatmap?.data?.length;
    },
    "本日盤後資料",
  );
}

async function loadMarketIntelDashboard(): Promise<LoadState<MarketIntelDashboard>> {
  const newsEndpoint = "GET /api/v1/market-intel/news-top10";
  const announcementsEndpoint = `GET /api/v1/market-intel/announcements?days=${ANNOUNCEMENT_DAYS}&limit=${MAX_INTEL_ROWS}&scope=market`;
  return load<MarketIntelDashboard>(
    "AI 精選市場情報",
    {
      items: [],
      selected: [],
      failures: 0,
      aiSelectedCount: 0,
      officialCount: 0,
      sourceState: {
        newsEndpoint,
        announcementsEndpoint,
        newsMode: null,
        newsAsOf: null,
        newsNextRefreshAt: null,
        newsStaleReason: null,
        newsAiCallSuccess: null,
        newsInputRows: null,
        announcementsSource: null,
        owner: "Jason / Elva",
        nextAction: "確認 AI 精選排程與官方公告來源；前端不顯示示意新聞。",
      },
    },
    async () => {
      const [newsResult, announcementsResult] = await Promise.allSettled([
        withTimeout(getNewsTop10(), INTEL_SOURCE_MS, "market_intel_news"),
        withTimeout(getMarketIntelAnnouncements({ days: ANNOUNCEMENT_DAYS, limit: MAX_INTEL_ROWS, scope: "market" }), INTEL_SOURCE_MS, "market_intel_announcements"),
      ]);
      const newsTimeoutLabel = newsResult.status === "fulfilled" && isTimeoutSentinel(newsResult.value) ? newsResult.value._timeout : null;
      const announcementsTimeoutLabel = announcementsResult.status === "fulfilled" && isTimeoutSentinel(announcementsResult.value) ? announcementsResult.value._timeout : null;
      const newsTimedOut = newsTimeoutLabel !== null;
      const announcementsTimedOut = announcementsTimeoutLabel !== null;
      const newsFailed = newsResult.status === "rejected" || newsTimedOut;
      const announcementsFailed = announcementsResult.status === "rejected" || announcementsTimedOut;
      if (newsFailed && announcementsFailed) {
        if (newsResult.status === "rejected") throw newsResult.reason;
        if (newsTimeoutLabel) throw new Error(newsTimeoutLabel);
        throw new Error("market_intel_unavailable");
      }
      const news = newsResult.status === "fulfilled" && !isTimeoutSentinel(newsResult.value) ? newsResult.value.data : null;
      const aggregate = announcementsResult.status === "fulfilled" && !isTimeoutSentinel(announcementsResult.value) ? announcementsResult.value.data : null;
      const newsFailureReason = newsResult.status === "rejected" ? friendlyDataError(newsResult.reason) : newsTimeoutLabel ? newsTimeoutLabel : null;
      const announcementsFailureReason = announcementsResult.status === "rejected" ? friendlyDataError(announcementsResult.reason) : announcementsTimeoutLabel ? announcementsTimeoutLabel : null;
      const aiItems = news?.items.map(aiNewsToIntelItem) ?? [];
      const officialItems = aggregate?.items.map(officialAnnouncementToIntelItem) ?? [];
      const items = [...aiItems, ...officialItems].slice(0, MAX_INTEL_ROWS);
      return {
        items,
        selected: aggregate?.selected ?? [],
        failures: (aggregate?.failures ?? 0) + (newsFailureReason ? 1 : 0) + (announcementsFailureReason ? 1 : 0),
        aiSelectedCount: aiItems.length,
        officialCount: officialItems.length,
        sourceState: {
          newsEndpoint,
          announcementsEndpoint,
          newsMode: news?.selection_mode ?? null,
          newsAsOf: news?.as_of ?? null,
          newsNextRefreshAt: news?.next_refresh_at ?? null,
          newsStaleReason: news?.stale_reason ?? newsFailureReason,
          newsAiCallSuccess: typeof news?.ai_call_success === "boolean" ? news.ai_call_success : null,
          newsInputRows: typeof news?.input_row_count === "number" ? news.input_row_count : null,
          announcementsSource: aggregate?.source ?? (announcementsFailureReason ? null : "empty"),
          owner: "Jason / Elva",
          nextAction: aiItems.length > 0
            ? "用 AI 精選項目串到推薦股票、公司頁與主題頁；官方公告若為空仍維持正式 empty state。"
            : "確認 news-top10 排程、owner-session 權限與官方公告 sourceState；前端不顯示示意新聞。",
        },
      };
    },
    (value) => value.items.length === 0,
    `目前沒有可顯示的 AI 精選市場情報或官方重大訊息。`,
  );
}

function buildHeatmap(market: LoadState<MarketDataOverview | null>): HeatTile[] {
  const contextRows = market.data?.marketContext?.heatmap ?? [];
  if (contextRows.length > 0) {
    return contextRows.slice(0, MAX_HEATMAP_TILES).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      sector: item.sector,
      pct: typeof item.changePct === "number" ? saneStockPct(item.changePct) : null,
      weight: item.weight,
      source: item.source,
      price: typeof item.last === "number" ? item.last : null,
      date: item.date,
      open: item.open ?? null,
      high: item.high ?? null,
      low: item.low ?? null,
      close: item.close ?? (typeof item.last === "number" ? item.last : null),
      prevClose: item.prevClose ?? null,
      change: item.change ?? null,
      volume: item.volume,
      readiness: item.readiness,
      freshnessStatus: item.freshnessStatus,
    }));
  }

  const leaders = market.data?.leaders;
  if (!leaders) return [];
  const seen = new Set<string>();
  const rows: MarketDataOverviewLeader[] = [...leaders.mostActive, ...leaders.topGainers, ...leaders.topLosers];
  return rows
    .filter((item) => {
      if (seen.has(item.symbol)) return false;
      seen.add(item.symbol);
      return true;
    })
    .slice(0, 30)
    .map((item, index) => ({
      symbol: item.symbol,
      name: item.name ?? item.market,
      pct: typeof item.changePct === "number" ? saneStockPct(item.changePct) : null,
      weight: typeof item.volume === "number" && item.volume > 0 ? Math.log10(item.volume + 10) : Math.max(1, 6 - index * 0.18),
      source: item.source,
      price: typeof item.last === "number" ? item.last : null,
      readiness: item.readiness,
      freshnessStatus: item.freshnessStatus,
    }));
}

function buildKgiCoreHeatmap(feed: LoadState<RealtimeMarketDashboard | null>): HeatTile[] {
  const rows = loadStateData(feed)?.kgiCoreHeatmap;
  const tiles = rows?.data ?? rows?.tiles ?? [];
  return tiles
    .filter((item) => item.symbol && item.symbol.trim().length > 0)
    .slice(0, 40)
    .map((item: KgiCoreHeatmapTile, index) => {
      const price = finite(item.last ?? item.price ?? item.close);
      const pct = saneStockPct(finite(item.changePct ?? item.pct));
      const tradingValue = finite(item.tradingValue);
      const volume = finite(item.volume);
      const weight = finite(item.weight) ?? (tradingValue ? Math.pow(tradingValue, 0.34) : volume ? Math.log10(volume + 10) : Math.max(1, 24 - index));
      return {
        symbol: item.symbol,
        name: item.name ?? item.symbol,
        sector: item.sector ?? null,
        pct,
        weight,
        source: "realtime",
        price,
        date: item.date ?? item.updatedAt ?? null,
        close: finite(item.close ?? item.last ?? item.price),
        prevClose: finite(item.prevClose),
        change: finite(item.change),
        volume,
        readiness: "ready" as const,
        freshnessStatus: "fresh" as const,
        sourceState: item.sourceState === "live" || item.sourceState === "twse_eod" || item.sourceState === "cache" || item.sourceState === "no_data" ? item.sourceState : undefined,
        sourceLabel: item.sourceLabel ?? null,
      };
    });
}

function hasVerifiedMove(tile: HeatTile) {
  return (
    (typeof tile.pct === "number" && Number.isFinite(tile.pct)) ||
    (typeof tile.change === "number" && Number.isFinite(tile.change)) ||
    (typeof tile.close === "number" && Number.isFinite(tile.close) && typeof tile.prevClose === "number" && Number.isFinite(tile.prevClose) && tile.prevClose > 0)
  );
}

function betterHeatmapName(symbol: string, preferred?: string | null, fallback?: string | null) {
  const preferredName = preferred?.trim();
  const fallbackName = fallback?.trim();
  if (preferredName && preferredName !== symbol) return preferredName;
  if (fallbackName && fallbackName !== symbol) return fallbackName;
  return preferredName || fallbackName || symbol;
}

function mergeHeatmapQuote(base: HeatTile | undefined, overlay: HeatTile) {
  if (!base) return overlay;
  const overlayHasMove = hasVerifiedMove(overlay);
  const baseHasMove = hasVerifiedMove(base);
  const quote = overlayHasMove ? overlay : baseHasMove ? base : overlay;
  const context = baseHasMove ? base : overlayHasMove ? overlay : base;

  return {
    ...context,
    ...quote,
    symbol: overlay.symbol || base.symbol,
    name: betterHeatmapName(overlay.symbol || base.symbol, overlay.name, base.name),
    sector: overlay.sector ?? base.sector ?? null,
    source: quote.source || context.source,
    weight: Number.isFinite(quote.weight) && quote.weight > 0 ? quote.weight : context.weight,
    date: quote.date ?? context.date,
    open: quote.open ?? context.open,
    high: quote.high ?? context.high,
    low: quote.low ?? context.low,
    close: quote.close ?? context.close,
    prevClose: quote.prevClose ?? context.prevClose,
    change: quote.change ?? context.change,
    volume: quote.volume ?? context.volume,
    price: quote.price ?? context.price,
    pct: quote.pct ?? context.pct,
    readiness: quote.readiness ?? context.readiness,
    freshnessStatus: quote.freshnessStatus ?? context.freshnessStatus,
    sourceState: quote.sourceState ?? context.sourceState,
    sourceLabel: quote.sourceLabel ?? context.sourceLabel,
  };
}

function mergeCoreHeatmapWithRepresentativeFeed(coreTiles: HeatTile[], representativeFeed: HeatTile[]) {
  const rowsBySymbol = new Map<string, HeatTile>();

  for (const tile of representativeFeed) {
    if (!tile.symbol || !hasVerifiedMove(tile)) continue;
    rowsBySymbol.set(tile.symbol, tile);
  }

  for (const tile of coreTiles) {
    if (!tile.symbol) continue;
    const existing = rowsBySymbol.get(tile.symbol);
    if (tile.sourceState === "live" || !existing || !hasVerifiedMove(existing)) {
      rowsBySymbol.set(tile.symbol, mergeHeatmapQuote(existing, tile));
    }
  }

  return [...rowsBySymbol.values()];
}

function buildTwseIndustryRows(feed: LoadState<RealtimeMarketDashboard | null>): TwseIndustryHeatmapTile[] {
  return (loadStateData(feed)?.twseHeatmap?.data ?? []).filter((item) => item.industry && Number.isFinite(item.avgChangePct)).sort((left, right) => right.stockCount - left.stockCount);
}

function buildMarketWideRowsFromHeatmap(heatmap: HeatTile[]): TwseIndustryHeatmapTile[] {
  const byIndustry = new Map<string, { industry: string; weightedPct: number; weight: number; gainerCount: number; loserCount: number; flatCount: number; stockCount: number }>();

  for (const tile of heatmap) {
    if (tile.placeholder) continue;
    if (typeof tile.pct !== "number" || !Number.isFinite(tile.pct)) continue;
    const industry = heatmapSectorLabel(heatmapSectorName(tile));
    const weight = Math.max(1, Number.isFinite(tile.weight) ? tile.weight : 1);
    const current = byIndustry.get(industry) ?? { industry, weightedPct: 0, weight: 0, gainerCount: 0, loserCount: 0, flatCount: 0, stockCount: 0 };
    current.weight += weight;
    current.weightedPct += tile.pct * weight;
    current.stockCount += 1;
    if (tile.pct > 0.05) current.gainerCount += 1;
    else if (tile.pct < -0.05) current.loserCount += 1;
    else current.flatCount += 1;
    byIndustry.set(industry, current);
  }

  return [...byIndustry.values()]
    .map((row) => ({
      industry: row.industry,
      avgChangePct: row.weight > 0 ? Math.round((row.weightedPct / row.weight) * 100) / 100 : 0,
      gainerCount: row.gainerCount,
      loserCount: row.loserCount,
      flatCount: row.flatCount,
      stockCount: row.stockCount,
      source: "owned_representative_aggregate",
    }))
    .filter((row) => row.stockCount > 0)
    .sort((left, right) => right.stockCount - left.stockCount || Math.abs(right.avgChangePct) - Math.abs(left.avgChangePct));
}

function readMarketIndex(feed: LoadState<RealtimeMarketDashboard | null>, market: LoadState<MarketDataOverview | null>, nowDate: Date = new Date()): MarketIndexDisplay {
  const data = loadStateData(feed);
  const kgi = data?.kgiOverview?.taiex ?? null;
  if (kgi && finite(kgi.value) !== null) {
    const stale = isStaleTimestamp(kgi.ts, data?.kgiOverview?.staleAfterSec ?? 60);
    const offHours = isKgiGatewayScheduledOff(nowDate);
    return {
      sym: "TAIEX",
      name: "加權指數",
      price: finite(kgi.value),
      chg: finite(kgi.change),
      pct: finite(kgi.changePct),
      updatedAt: kgi.ts,
      label: stale ? (offHours ? "休市快照" : "資料更新中") : "即時",
      source: stale ? "fallback" : "realtime",
    };
  }

  const twse = data?.twseOverview?.taiex ?? null;
  if (twse && finite(twse.value) !== null) {
    return { sym: "TAIEX", name: "加權指數", price: finite(twse.value), chg: finite(twse.change), pct: finite(twse.changePct), updatedAt: twse.ts, label: closeLabel(twse.ts), source: "close" };
  }

  const index = market.data?.marketContext?.index;
  if (index && index.last !== null && index.state !== "EMPTY") {
    return { sym: index.symbol ?? "TAIEX", name: index.name, price: index.last, chg: index.change, pct: index.changePct, updatedAt: index.timestamp, label: "昨日收盤", source: "fallback" };
  }

  return { sym: "TAIEX", name: "加權指數", price: null, chg: null, pct: null, updatedAt: null, label: "資料更新中", source: "none" };
}

function readMarketBreadth(feed: LoadState<RealtimeMarketDashboard | null>, market: LoadState<MarketDataOverview | null>, heatmap: HeatTile[]): BreadthDisplay {
  const data = loadStateData(feed);
  const kgiBreadth = data?.kgiOverview?.breadth ?? null;
  const kgiTotal = finite(kgiBreadth?.total);
  if (kgiBreadth && kgiTotal !== null && kgiTotal > 0) {
    return { up: finite(kgiBreadth.up) ?? 0, down: finite(kgiBreadth.down) ?? 0, flat: finite(kgiBreadth.flat) ?? 0, total: kgiTotal, amount: finite(kgiBreadth.amount), updatedAt: kgiBreadth.updatedAt ?? data?.kgiOverview?.updatedAt ?? null, label: "即時" };
  }

  const twseRows = buildTwseIndustryRows(feed);
  if (twseRows.length > 0) {
    const up = twseRows.reduce((sum, row) => sum + row.gainerCount, 0);
    const down = twseRows.reduce((sum, row) => sum + row.loserCount, 0);
    const flat = twseRows.reduce((sum, row) => sum + row.flatCount, 0);
    return { up, down, flat, total: up + down + flat, amount: null, updatedAt: data?.twseOverview?.taiex?.ts ?? null, label: closeLabel(data?.twseOverview?.taiex?.ts) };
  }

  const legacyBreadth = market.data?.marketContext?.breadth;
  if (legacyBreadth && legacyBreadth.total > 0) {
    return { up: legacyBreadth.up, down: legacyBreadth.down, flat: legacyBreadth.flat, total: legacyBreadth.total, amount: null, updatedAt: legacyBreadth.updatedAt, label: "本日盤後資料" };
  }

  const actualHeatmap = heatmap.filter((item) => !item.placeholder);
  const up = actualHeatmap.filter((item) => (item.pct ?? 0) > 0).length;
  const down = actualHeatmap.filter((item) => (item.pct ?? 0) < 0).length;
  const flat = Math.max(0, actualHeatmap.length - up - down);
  return { up, down, flat, total: actualHeatmap.length, amount: null, updatedAt: null, label: "資料更新中" };
}

function heatmapSectorName(tile: HeatTile) {
  const sector = tile.sector?.trim();
  return sector && sector.length > 0 ? sector : "其他";
}

function heatmapSectorLabel(sector: string) {
  const normalized = sector.trim().toLowerCase();
  if (HEATMAP_SECTOR_LABELS[normalized]) return HEATMAP_SECTOR_LABELS[normalized];
  if (normalized.includes("semiconductor")) return "半導體業";
  if (normalized.includes("electronic")) return "電子類股";
  if (normalized.includes("bank")) return "金融銀行";
  if (normalized.includes("steel")) return "鋼鐵工業";
  if (normalized.includes("chemical")) return "化學工業";
  if (sector === "其他") return "其他";
  return sector;
}

function hasMarketOverviewData(value: MarketDataOverview | null): boolean {
  if (!value) return false;
  return value.quotes.total > 0 || value.marketContext.index.last !== null || value.marketContext.breadth.total > 0 || value.marketContext.heatmap.length > 0;
}

// ── TAIEX 日線走勢：折線 + OHLC 影線 + hover 提示（純 SVG + CSS hover，
//    無需 client state，RSC 可直接輸出） ────────────────────────────────────
function IndexOhlcChart({ history }: { history: NonNullable<MarketDataOverview["marketContext"]["index"]["history"]> }) {
  const rows = history.filter((row) => typeof row.close === "number" && Number.isFinite(row.close)).slice(-64);

  if (rows.length < 2) {
    return (
      <svg className="tac-intraday tac-index-ohlc empty" viewBox="0 0 360 58" preserveAspectRatio="none" role="img" aria-label="加權指數日 K 資料等待回補">
        <path d="M0,52 L360,52" />
      </svg>
    );
  }

  const width = 360;
  const height = 58;
  const values = rows.flatMap((row) => [row.high ?? row.close ?? 0, row.low ?? row.close ?? 0, row.open ?? row.close ?? 0, row.close ?? 0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xFor = (index: number) => (index / (rows.length - 1)) * width;
  const yFor = (value: number | null | undefined) => {
    const safe = typeof value === "number" && Number.isFinite(value) ? value : min;
    return height - 6 - ((safe - min) / range) * (height - 12);
  };
  const closePath = rows
    .map((row, index) => {
      const x = xFor(index);
      const y = yFor(row.close);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `${closePath} L${width},${height} L0,${height} Z`;
  const hitWidth = Math.max(4, width / rows.length);
  const hitPct = Math.max(3, 100 / rows.length);

  return (
    <div className="tac-index-chart-wrap" role="img" aria-label="加權指數日 K 折線圖，滑過可查看日期、開高低收與成交量">
      <svg className="tac-intraday tac-index-ohlc" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="area" d={areaPath} />
        {rows.map((row, index) => {
          const x = xFor(index);
          const highY = yFor(row.high ?? row.close);
          const lowY = yFor(row.low ?? row.close);
          const openY = yFor(row.open ?? row.close);
          const closeY = yFor(row.close);
          const up = (row.close ?? 0) >= (row.open ?? row.close ?? 0);
          return (
            <g key={`${row.date}-${index}`} className={up ? "up" : "down"}>
              <line className="range" x1={x} x2={x} y1={highY} y2={lowY} />
              <line className="open" x1={x - 2.4} x2={x} y1={openY} y2={openY} />
              <line className="close" x1={x} x2={x + 2.4} y1={closeY} y2={closeY} />
              <rect className="hit" x={x - hitWidth / 2} y="0" width={hitWidth} height={height} />
            </g>
          );
        })}
        <path className="close-line" d={closePath} />
      </svg>
      <div className="tac-index-hover-layer">
        {rows.map((row, index) => {
          const xPct = (xFor(index) / width) * 100;
          const closeY = yFor(row.close);
          return (
            <div
              className="tac-index-point"
              key={`${row.date}-hit-${index}`}
              tabIndex={0}
              style={{ left: `${xPct}%`, width: `${hitPct}%`, "--marker-y": `${closeY}px`, "--tip-x": xPct > 78 ? "-92%" : xPct < 22 ? "-8%" : "-50%" } as CSSProperties}
              aria-label={`日期 ${row.date}，開 ${formatPrice(row.open)}，高 ${formatPrice(row.high)}，低 ${formatPrice(row.low)}，收 ${formatPrice(row.close)}，量 ${formatNumber(row.volume)}`}
            >
              <span className="tac-index-crosshair" />
              <div className="tac-index-tooltip">
                <b>{row.date}</b>
                <span>開 {formatPrice(row.open)}</span>
                <span>高 {formatPrice(row.high)}</span>
                <span>低 {formatPrice(row.low)}</span>
                <span>收 {formatPrice(row.close)}</span>
                <small>量 {formatNumber(row.volume)}</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type MoverRow = { symbol: string; name: string; last: number | null; changePct: number | null; volume: number | null };

// P1-12（reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md）：缺公司名
// 不得渲染成重複代號（如「9110 9110」）；backend 送 name=symbol 本身當自己的
// fallback，必須跟 symbol 比對而非只查 null，是則顯示誠實「名稱待補」。
function leaderToMover(row: MarketDataOverviewLeader): MoverRow {
  const trimmedName = row.name?.trim();
  const hasRealName = Boolean(trimmedName) && trimmedName !== row.symbol.trim();
  return { symbol: row.symbol, name: hasRealName ? trimmedName! : MISSING_COMPANY_NAME_LABEL, last: row.last, changePct: row.changePct ?? null, volume: row.volume ?? null };
}

function MarketWideHeatmap({
  rows,
  updatedAt,
  sourceLabel,
  marketState,
  reason,
}: {
  rows: TwseIndustryHeatmapTile[];
  updatedAt: string | null;
  sourceLabel: string;
  marketState: DashboardState;
  reason?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="tac-market-wide-heatmap empty">
        <strong>{marketState === "BLOCKED" ? (reason ?? "資料更新中") : "資料更新中"}</strong>
        <span>本日盤後資料，報價約 5-15 秒延遲</span>
      </div>
    );
  }

  const total = rows.reduce((sum, row) => sum + Math.max(1, row.stockCount), 0);
  return (
    <div className="tac-market-wide-heatmap">
      <div className="tac-market-wide-head">
        <span>{sourceLabel}</span>
        <span>{rows.length} 個產業 · {formatNumber(total)} 檔 · 更新 {formatDateTime(updatedAt)}</span>
      </div>
      <div className="tac-market-wide-grid">
        {rows.slice(0, 18).map((row) => {
          const pct = finite(row.avgChangePct) ?? 0;
          const tone = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
          const size = Math.max(1.1, Math.min(2.4, Math.sqrt(Math.max(1, row.stockCount)) / 9));
          const displayIndustry = heatmapIndustryLabel(row.industry);
          return (
            <div
              className={`tac-market-wide-cell ${tone}`}
              key={`${row.industry}-${displayIndustry}`}
              style={{ "--cell-grow": String(size), "--heat": String(Math.min(1, Math.abs(pct) / 3)) } as CSSProperties}
              title={`${displayIndustry}\n漲 ${row.gainerCount} / 平 ${row.flatCount} / 跌 ${row.loserCount}\n均幅 ${formatPercent(pct)}`}
            >
              <b>{displayIndustry}</b>
              <strong>{formatPercent(pct)}</strong>
              <span>{formatNumber(row.stockCount)} 檔</span>
            </div>
          );
        })}
      </div>
      <div className="tac-heat-footer">
        <span>全市場 · 昨日收盤；面積代表檔數，顏色代表產業平均漲跌。</span>
        <span className="tac-heat-scale" aria-label="漲跌幅色階">
          <em>≤ -3%</em>
          <i />
          <em>≥ +3%</em>
        </span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// LEDGER 版面元件（承自 2026-07-13 首次 v5.1 移植，逐塊沿用原稿 CSS class；
// CSS 定義在 globals.css .tac-ledger scope，本輪只加 .idxhist / brief-toggle-btn
// 兩處新樣式）。
// ══════════════════════════════════════════════════════════════════════════

function formatIndexGiant(value: number | null): [string, string | null] {
  if (value === null || !Number.isFinite(value)) return ["--", null];
  const [intPart, decPart] = value.toFixed(2).split(".");
  return [Number(intPart).toLocaleString("zh-TW"), decPart ?? null];
}

// ── Masthead 拆兩半（2026-07-14 楊董標準：冷啟動要快）：品牌/模式/MODE 三格
// 完全靜態、不依賴任何資料，跟著頁面外殼同步立即輸出；「今日焦點/市場/時鐘」
// 三格依賴 market/realtimeMarket/brief/intel，包成獨立 Suspense 邊界，不卡
// 整頁第一次繪製。 ─────────────────────────────────────────────────────────
function MastStatic() {
  return (
    <>
      <div className="mast-brand"><b>IUF·TR</b><small>TRADING ROOM</small></div>
      <div className="mast-mode"><i />OBSERVE</div>
      <div className="mast-slot"><small>MODE</small><b>台股觀察</b></div>
    </>
  );
}

function MastSkeleton() {
  return (
    <>
      <div className="mast-slot"><small>今日焦點</small><b>···</b></div>
      <div className="mast-spacer" />
      <div className="mast-slot"><small>市場</small><b>···</b></div>
      <div className="mast-clock"><b>--:--:--</b><small>UTC+8</small></div>
    </>
  );
}

async function MastDynamic({ now }: { now: string }) {
  const [market, realtimeMarket, brief, intel] = await Promise.all([
    timedLoad("market_for_mast", FETCH_MARKET_MS, cachedMarket, null),
    timedLoad("realtime_for_mast", FETCH_MARKET_MS, cachedRealtimeMarket, null),
    timedLoad("brief_for_mast", FETCH_PRODUCT_MS, cachedBrief, buildEmptyBrief()),
    timedLoad("intel_for_mast", FETCH_INTEL_MS, cachedIntel, buildEmptyIntel()),
  ]);
  const nowDate = new Date(now);
  const twii = readMarketIndex(realtimeMarket, market, nowDate);
  const focusText = brief.data.state === "PUBLISHED"
    ? `閱讀 ${formatDate(brief.data.todayBrief?.date ?? brief.data.today)} AI 簡報`
    : intel.data.items.length > 0
      ? `檢查 ${intel.data.items.length} 筆重大訊息`
      : "查看盤勢與候選觀察";
  const marketSlotLabel = twii.source === "realtime" ? "盤中" : twii.updatedAt ? `${formatDate(twii.updatedAt)} 收盤` : "資料更新中";
  return (
    <>
      <div className="mast-slot"><small>今日焦點</small><b>{focusText}</b></div>
      <div className="mast-spacer" />
      <div className="mast-slot"><small>市場</small><b>{marketSlotLabel}</b></div>
      <div className="mast-clock"><b suppressHydrationWarning>{formatClock(now)}</b><small>UTC+8</small></div>
    </>
  );
}

function IdxAnchorPanel({
  heatmap,
  market,
  realtimeMarket,
  now,
}: {
  heatmap: HeatTile[];
  market: LoadState<MarketDataOverview | null>;
  realtimeMarket: LoadState<RealtimeMarketDashboard | null>;
  now: string;
}) {
  const nowDate = new Date(now);
  const twii = readMarketIndex(realtimeMarket, market, nowDate);
  const breadth = readMarketBreadth(realtimeMarket, market, heatmap);
  const indexReady = twii.price !== null;
  const isClosedSnapshot = twii.source === "close" || twii.source === "fallback";
  const [giantInt, giantDec] = formatIndexGiant(twii.price);
  const upPct = breadth.total > 0 ? Math.round((breadth.up / breadth.total) * 1000) / 10 : null;
  const chgTone = (twii.chg ?? 0) > 0 ? "up" : (twii.chg ?? 0) < 0 ? "down" : "";
  return (
    <section className="idxanchor">
      <div className="eyebrow">大盤指數 <small>{twii.sym} · {twii.name}</small></div>
      {indexReady && isClosedSnapshot && (
        <div className="stamp">{formatDate(twii.updatedAt) === "--" ? twii.label : `${formatDate(twii.updatedAt)} 收盤`}<small>MARKET CLOSED</small></div>
      )}
      <div className="giant">{giantInt}{giantDec && <sub>.{giantDec}</sub>}</div>
      <div className="delta">
        <span className={chgTone}>{(twii.chg ?? 0) > 0 ? "▲" : (twii.chg ?? 0) < 0 ? "▼" : "—"} {formatPrice(twii.chg === null ? null : Math.abs(twii.chg))}</span>
        <span className={chgTone}>{formatPercent(twii.pct)}</span>
        <small>較前一交易日</small>
      </div>
      <div className="breadthline">
        <span className="k">漲跌家數</span>
        <span className="n up">{formatNumber(breadth.up)}<small>漲</small></span>
        <span className="n">{formatNumber(breadth.flat)}<small>平</small></span>
        <span className="n down">{formatNumber(breadth.down)}<small>跌</small></span>
        <div className="bbar">
          <i className="u" style={{ width: `${breadth.total ? (breadth.up / breadth.total) * 100 : 0}%` }} />
          <i className="f" style={{ width: `${breadth.total ? (breadth.flat / breadth.total) * 100 : 0}%` }} />
          <i className="d" style={{ width: `${breadth.total ? (breadth.down / breadth.total) * 100 : 0}%` }} />
        </div>
      </div>
      <div className="tot">共 {formatNumber(breadth.total)} 檔{upPct !== null ? ` · 上漲 ▶ ${upPct}%` : ""}</div>
      <div className="honest">休市時段顯示「MM/DD 收盤」誠實標記，非即時價。來源 <code>kgi/twse overview</code></div>
    </section>
  );
}

// TAIEX 日線走勢帶（2026-07-14 楊董糾正：折線圖先前塞在 454px 寬的 idxanchor
// 欄內，把 idxanchor 從原稿緊湊的 322px 撐高到 429-475px，heroband 兩欄等高
// 連帶把熱力圖磚格也拉高成扁平橫條——量測見 heroband 322px 原稿基準 vs 現行
// 454x429 對照。移出來自成一條 heroband 正下方的全寬窄帶，heroband/idxanchor
// 才能回原稿固定 322px 緊湊配置，折線圖本身改吃 maincol 全寬（既有
// .tac-index-* 系列樣式 width:100% 自動撐滿，無需改元件本身）。
function IndexHistoryBand({ market }: { market: LoadState<MarketDataOverview | null> }) {
  const historyRows = (market.data?.marketContext?.index?.history ?? []).filter((row) => typeof row.close === "number" && Number.isFinite(row.close));
  const histFirst = historyRows[0];
  const histLast = historyRows[historyRows.length - 1];
  return (
    <div className="idxhistband">
      <div className="idxhist-head">
        <span>TAIEX 日線 · 近 {historyRows.length} 交易日</span>
        {histFirst && histLast && <b>{formatDate(histFirst.date)} – {formatDate(histLast.date)}</b>}
      </div>
      <IndexOhlcChart history={historyRows} />
    </div>
  );
}

function HeatZonePanel({
  heatmap,
  market,
  realtimeMarket,
  selectedSectorParam,
  heatmapMode,
}: {
  heatmap: HeatTile[];
  market: LoadState<MarketDataOverview | null>;
  realtimeMarket: LoadState<RealtimeMarketDashboard | null>;
  selectedSectorParam?: string | null;
  heatmapMode: "core" | "all";
}) {
  const coreHeatmap = buildKgiCoreHeatmap(realtimeMarket);
  const fullMarketRows = buildTwseIndustryRows(realtimeMarket);
  const coreLastTs = loadStateData(realtimeMarket)?.kgiCoreHeatmap?.updatedAt ?? null;
  const now = new Date();
  const kgiOffHours = !isKgiTradingHours(now);
  const kgiTilesAllNull = kgiCoreTilesAreNull(coreHeatmap);
  const showKgiFallback = kgiTilesAllNull && kgiOffHours;
  const activeMode = heatmapMode === "all" ? "all" : "core";
  const hasRepresentativeFeed = hasProductHeatmapCoverage(heatmap);
  const showCoverageFallback = activeMode === "core" && !showKgiFallback && !hasRepresentativeFeed;
  const hasCore = coreHeatmap.length > 0 && !showKgiFallback && hasRepresentativeFeed;
  const displayHeatmap = hasCore ? mergeCoreHeatmapWithRepresentativeFeed(coreHeatmap, heatmap) : heatmap;
  const derivedFullMarketRows = fullMarketRows.length > 0 ? fullMarketRows : buildMarketWideRowsFromHeatmap(displayHeatmap.length > 0 ? displayHeatmap : heatmap);
  const sourceLabel = showKgiFallback
    ? `TWSE 收盤 · ${closeLabel(loadStateData(realtimeMarket)?.twseOverview?.taiex?.ts)}`
    : activeMode === "core"
      ? hasCore ? "即時" : coreLastTs ? `核心 · ${freshnessText(coreLastTs, "STALE")}前` : "核心 · 資料更新中"
      : `全市場 · ${closeLabel(loadStateData(realtimeMarket)?.twseOverview?.taiex?.ts)}`;
  const updatedAt = activeMode === "core"
    ? loadStateData(realtimeMarket)?.kgiCoreHeatmap?.updatedAt ?? market.data?.marketContext.breadth?.updatedAt ?? market.data?.generatedAt ?? null
    : loadStateData(realtimeMarket)?.twseOverview?.taiex?.ts ?? null;
  const displaySourceLabel = showCoverageFallback ? "TWSE 全市場 · 代表股資料暖機中" : sourceLabel;
  const effectiveMode: "core" | "all" = showKgiFallback || showCoverageFallback ? "all" : activeMode;

  return (
    <section className="heatzone">
      {/* 核心/全市場模式切換是原稿沒有的既有產品功能（原稿只有固定核心觀察池），
          用獨立 .heat-mode-row class（非原稿 .heat-kicker）避免跟下面
          IndustryHeatmap 內部逐字還原的原稿 .heat-kicker 語意衝突。 */}
      <div className="heat-mode-row">
        <span>{effectiveMode === "core" ? "核心觀察池" : "全市場"} · {displaySourceLabel}</span>
        <div className="heat-mode-tabs">
          <Link className={effectiveMode === "core" ? "is-active" : ""} href="/">核心熱力圖</Link>
          <Link className={effectiveMode === "all" ? "is-active" : ""} href="/?heatmap=all">全市場熱力圖</Link>
        </div>
      </div>
      {showKgiFallback && (
        <div className="tac-kgi-offhours-banner"><span>KGI 即時資料時段 09:00-14:10・現非交易時段，暫顯 TWSE 收盤資料</span></div>
      )}
      {showCoverageFallback && (
        <div className="tac-kgi-offhours-banner"><span>核心代表股資料仍在暖機，暫以全市場產業熱力圖顯示，避免呈現不完整代表池。</span></div>
      )}
      {effectiveMode === "all" ? (
        <MarketWideHeatmap
          rows={derivedFullMarketRows}
          updatedAt={updatedAt}
          sourceLabel={displaySourceLabel}
          marketState={derivedFullMarketRows.length > 0 ? "LIVE" : stateFromLoad(realtimeMarket)}
          reason={realtimeMarket.state === "BLOCKED" ? realtimeMarket.reason : undefined}
        />
      ) : (
        <IndustryHeatmap
          heatmap={displayHeatmap}
          initialSector={selectedSectorParam}
          updatedAt={updatedAt}
          sourceLabel={displaySourceLabel}
          marketState={hasCore ? "LIVE" : stateFromLoad(market)}
          reason={!hasCore && market.state === "BLOCKED" ? market.reason : undefined}
        />
      )}
    </section>
  );
}

// AI 推薦理由：取第一句（。／；前）＋ 40 字硬截斷（楊董密度標準）
function homeV3PrimaryReason(rawWhyBuy: string | null | undefined) {
  const firstLine = rawWhyBuy?.split("\n").find((line) => line.trim().length > 0);
  const cleaned = firstLine ? cleanNarrativeText(firstLine) : null;
  return cleaned ? firstSentence(cleaned, 40) : "推薦理由待回補；前端不補示意內容。";
}

function homeV3PlanSummary(card: { entry?: { ote_low?: number | null } | null; targets?: { sl?: number | null; tp1?: number | null; tp2?: number | null } | null }) {
  return [
    card.entry?.ote_low != null ? `進場 ${formatPrice(card.entry.ote_low)}` : null,
    card.targets?.sl != null ? `停損 ${formatPrice(card.targets.sl)}` : null,
    card.targets?.tp1 != null ? `TP1 ${formatPrice(card.targets.tp1)}` : null,
    card.targets?.tp2 != null ? `TP2 ${formatPrice(card.targets.tp2)}` : null,
  ].filter(Boolean).join(" · ") || "交易計畫待回補";
}

function RecHeadline({ recommendations }: { recommendations: LoadState<AiRecommendationV3Response> }) {
  const cards = deriveHomeAiRecommendationCards(recommendations.data, 5);
  const v3PanelState = buildV3PanelState({ data: recommendations.data, error: recommendations.state === "BLOCKED" ? recommendations.reason : null, visibleCount: cards.length });
  const generatedAtLabel = formatRecommendationTimestamp(recommendations.data.generatedAt);
  return (
    <section className="recwrap">
      <div className="tabrow">
        <div className="tab">AI 推薦個股 <span className="en">TODAY RECS</span></div>
        <div className="aside">
          {cards.length > 0 ? `正典 ${cards.length} 檔 · 生成 ${generatedAtLabel} · 點「帶入模擬單」進交易室紙上預覽，不送真實委託` : v3PanelState.detail}
        </div>
      </div>
      {cards.length > 0 ? (
        <div className="rec">
          {cards.map((card) => (
            <div className="rrow" key={card.ticker}>
              <div className="tk">{card.ticker}<small>{card.bucket} 推薦級</small></div>
              <div className="mid">
                <div className="co">{card.company_name ?? "公司名稱未回傳"}</div>
                <div className="rs">{homeV3PrimaryReason(card.why_buy)}</div>
                <div className="plan">{homeV3PlanSummary(card)}</div>
              </div>
              <div className="side">
                <div className="conf">信心 <b>{card.confidence != null ? `${Math.round(card.confidence * 100)}%` : "--"}</b></div>
                <div className="actbtns">
                  <HomeRecCtaRow ticker={card.ticker} companyName={card.company_name} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tac-empty-line">{v3PanelState.detail}</div>
      )}
      <div className="sfoot">來源 <code>GET /api/v1/ai-recommendations/v3</code> · 只顯示正式推薦 API 回傳，不以候選或假資料冒充。</div>
    </section>
  );
}

function BriefColumn({ brief }: { brief: LoadState<DailyBriefDashboard> }) {
  const displayBrief = brief.data.todayBrief ?? brief.data.latest;
  const previewSections = displayBrief?.sections.slice(0, 4) ?? [];
  const pillLabel = brief.data.state === "PUBLISHED" ? "已發布" : brief.data.state === "AWAITING_REVIEW" ? "待確認" : "待產生";
  const dateLabel = displayBrief ? formatDateTime(displayBrief.createdAt) : brief.data.today;
  // 楊董密度標準（2026-07-14）：預設每段節錄前 2 句／80 字，「展開全文」才顯示
  // 完整段落；真截斷（非 CSS line-clamp 遮蓋），見 HomeBriefColumn。
  const segments: BriefSegmentView[] = previewSections.map((section: DailyBrief["sections"][number], index: number) => {
    const heading = briefHeadingText(section.heading, index);
    const full = polishedBriefText(section.body);
    const preview = firstSentences(full, 2, 80);
    return { heading, preview, full };
  });
  return (
    <section className="briefcol brief">
      <div className="tab dim">AI 每日簡報 <span className="en">BRIEF</span></div>
      <HomeBriefColumn pillLabel={pillLabel} dateLabel={dateLabel} segments={segments} emptyReason={brief.data.reason ?? null} />
      <div className="sfoot">只顯示「已發布／待確認／待產生」，不偽裝即時新聞。來源 <code>/briefs</code></div>
    </section>
  );
}

function S1Bulletin({
  strategy,
  realSim,
}: {
  strategy: LoadState<S1StrategyData | null>;
  realSim: LoadState<TrackRecordNavSummary | null>;
}) {
  const snapshot = strategy.data;
  const netReturn = snapshot?.headlineMetrics.strategyNetAbsoluteReturnPct ?? null;
  const maxDrawdown = snapshot?.headlineMetrics.maxDrawdownNetPct ?? snapshot?.headlineMetrics.maxDrawdown ?? null;
  const realSimReturnPct = realSim.data?.cumulativeReturnPct ?? null;
  const isLiveVerifiedTrackRecord = snapshot?.isLiveVerifiedTrackRecord ?? false;
  return (
    <Link href="/quant-strategies" className="s1wrap">
      <div className="tab dim">量化策略 <span className="en">S1 · SIM-ONLY</span></div>
      {snapshot ? (
        <div className="s1notice">
          <div className="s1head"><b>S1</b><span>{snapshot.displayName_zh || snapshot.displayName}</span><em>KGI SIM-only</em></div>
          <div className="s1grid">
            <div className="s1cell">
              <div className="lab"><span className="dot res" />{isLiveVerifiedTrackRecord ? "累積報酬" : "研究回測 · 累積報酬"}</div>
              <div className={`v ${netReturn == null ? "" : netReturn >= 0 ? "up" : "down"}`}>{netReturn == null ? "--" : `${netReturn >= 0 ? "+" : ""}${netReturn.toFixed(2)}%`}</div>
              <div className="sub">歷史回測揭露 · 含成本 · 非未來保證</div>
            </div>
            <div className="s1cell">
              <div className="lab"><span className="dot sim" />實盤模擬 · 累積報酬</div>
              <div className={`v ${realSimReturnPct == null ? "" : realSimReturnPct >= 0 ? "up" : "down"}`}>{realSimReturnPct == null ? "--" : `${realSimReturnPct >= 0 ? "+" : ""}${realSimReturnPct.toFixed(2)}%`}</div>
              <div className="sub">KGI SIM 前進觀察 · 真實市況</div>
            </div>
          </div>
          <div className="s1-honest">
            <b>研究 ≠ 實盤。</b>
            {realSimReturnPct != null
              ? `實盤模擬 ${realSimReturnPct >= 0 ? "+" : ""}${realSimReturnPct.toFixed(2)}% 為前進觀察真值，並列不弱化；策略經穩健度折扣後判定偏樂觀。`
              : "實盤模擬資料目前無法讀取；不以研究回測數字代替。"}
          </div>
          <div className="s1-row2">
            <div className="k">最大回撤<b className="down">{maxDrawdown == null ? "--" : `${(maxDrawdown * 100).toFixed(2)}%`}</b></div>
            <div className="k">狀態<b style={{ fontFamily: "var(--sans-tc)", color: "var(--lg-amber-hi)" }}>{snapshot.orderState === "paper_allowed" ? "前進觀察中" : "待確認"}</b></div>
          </div>
        </div>
      ) : (
        <div className="tac-empty-line">S1 核准快照目前無法讀取；不顯示其他研究策略或假績效。</div>
      )}
      <div className="sfoot">唯一正式量化策略；研究快照與 KGI SIM 觀察分開呈現。來源 <code>/quant-strategies</code></div>
    </Link>
  );
}

function RankColumns({ market }: { market: LoadState<MarketDataOverview | null> }) {
  const leaders = market.data?.leaders;
  const hasReal = leaders ? !(leaders.topGainers.length === 0 && leaders.topLosers.length === 0) : false;
  const gainers = hasReal ? leaders!.topGainers.slice(0, 5).map(leaderToMover) : [];
  const losers = hasReal ? leaders!.topLosers.slice(0, 5).map(leaderToMover) : [];
  return (
    <section className="rkwrap">
      <div className="tabrow">
        <div className="tab dim">強勢個股排行 <span className="en">MOVERS</span></div>
        <div className="aside">漲跌幅 TOP 5 · 正式來源回傳；等待真資料時不顯示示意股票</div>
      </div>
      {hasReal ? (
        <div className="rk">
          <div className="col">
            <h4>漲幅排行 <span>%CHG ▲</span></h4>
            {gainers.map((row) => (
              <Link href={`/companies/${encodeURIComponent(row.symbol)}`} className="r" key={`up-${row.symbol}`}>
                <span className="tk">{row.symbol}</span>
                <span className="nm">{row.name}</span>
                <span className="pc up">{formatPercent(row.changePct)}</span>
              </Link>
            ))}
            {gainers.length === 0 && <div className="tac-empty-line">目前沒有排行資料。</div>}
          </div>
          <div className="col">
            <h4>跌幅排行 <span>%CHG ▼</span></h4>
            {losers.map((row) => (
              <Link href={`/companies/${encodeURIComponent(row.symbol)}`} className="r" key={`down-${row.symbol}`}>
                <span className="tk">{row.symbol}</span>
                <span className="nm">{row.name}</span>
                <span className="pc down">{formatPercent(row.changePct)}</span>
              </Link>
            ))}
            {losers.length === 0 && <div className="tac-empty-line">目前沒有排行資料。</div>}
          </div>
        </div>
      ) : (
        <div className="tac-empty-line">等待正式排行回傳；不顯示示意股票。</div>
      )}
      <div className="sfoot">來源 <code>market/leaders</code></div>
    </section>
  );
}

function NewsTape({ intel }: { intel: LoadState<MarketIntelDashboard> }) {
  const items = intel.data.items;
  const featured = items[0] ?? null;
  const rest = items.slice(featured ? 1 : 0, featured ? 9 : 8);
  const itemHref = (item: IntelItem): string => item.url ?? (item.ticker === "MARKET" ? "/market-intel" : `/companies/${encodeURIComponent(item.ticker)}`);
  const isLinkable = (item: IntelItem): boolean => Boolean(item.url) || item.feedKind !== "official_announcement";
  return (
    <aside className="tape">
      <div className="tape-label">每日精選新聞</div>
      <div className="tape-head">MARKET INTEL WIRE · {formatNumber(intel.data.aiSelectedCount)} AI / {formatNumber(intel.data.officialCount)} 公告</div>
      {featured ? (
        isLinkable(featured) ? (
          <Link href={itemHref(featured)} className="feat">
            <span className="tag">{featured.feedKind === "ai_selected" ? "AI 精選" : categoryLabel(featured.category)}</span>
            <h3>{intelTitleText(featured)}</h3>
            <div className="meta">{featured.ticker} {featured.companyName} · {formatDate(featured.date)} · {featured.sourceLabel ?? "正式來源"}</div>
          </Link>
        ) : (
          <div className="feat">
            <span className="tag">{categoryLabel(featured.category)}</span>
            <h3>{intelTitleText(featured)}</h3>
            <div className="meta">{featured.ticker} {featured.companyName} · {formatDate(featured.date)} · {featured.sourceLabel ?? "正式來源"}</div>
          </div>
        )
      ) : (
        <div className="tac-empty-line">{intel.state === "LIVE" ? "只顯示正式 endpoint 狀態；不顯示示意新聞。" : intel.reason}</div>
      )}
      {rest.map((item) => (
        isLinkable(item) ? (
          <Link href={itemHref(item)} className="trow" key={`${item.ticker}-${item.id}`}>
            <div className="tm">{formatDateTime(item.date)} <em>{item.feedKind === "ai_selected" ? categoryLabel(item.impactTier ?? "ai_selected") : categoryLabel(item.category)}</em> · {item.ticker}</div>
            <div className="h">{intelTitleText(item)}</div>
          </Link>
        ) : (
          <div className="trow" key={`${item.ticker}-${item.id}`}>
            <div className="tm">{formatDateTime(item.date)} <em>{categoryLabel(item.category)}</em> · {item.ticker}</div>
            <div className="h">{intelTitleText(item)}</div>
          </div>
        )
      ))}
      <div className="tfoot">AI 精選＋官方重大訊息合流；只顯示正式來源，不補示意新聞。來源 <code>market-intel</code></div>
    </aside>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 冷啟動加速（2026-07-14 楊董標準：首頁還是太慢）：拿掉單一大 Promise.
// allSettled 卡整頁的舊架構，改每個資料來源各自一個 React `cache()`（同一次
// request 內多個 Suspense 邊界共用同一份 fetch，不重複打 API）＋每個版面帶
// 各自獨立 <Suspense>，靜態殼（mast 品牌/模式/位框架）同步立即輸出。
// ══════════════════════════════════════════════════════════════════════════

function buildEmptyBrief(): DailyBriefDashboard {
  return { today: todayTaipeiDate(), state: "BLOCKED", latestDate: null, latest: null, todayBrief: null, draftCount: 0, reason: "載入失敗" };
}

function buildEmptyIntel(): MarketIntelDashboard {
  return {
    items: [],
    selected: [],
    failures: 0,
    aiSelectedCount: 0,
    officialCount: 0,
    sourceState: {
      newsEndpoint: "GET /api/v1/market-intel/news-top10",
      announcementsEndpoint: `GET /api/v1/market-intel/announcements?days=${ANNOUNCEMENT_DAYS}&limit=${MAX_INTEL_ROWS}&scope=market`,
      newsMode: null,
      newsAsOf: null,
      newsNextRefreshAt: null,
      newsStaleReason: null,
      newsAiCallSuccess: null,
      newsInputRows: null,
      announcementsSource: null,
      owner: "Jason / Elva",
      nextAction: "確認 AI 精選排程與官方公告來源；前端不顯示示意新聞。",
    },
  };
}

function buildEmptyRecommendations(): AiRecommendationV3Response {
  return { runId: null, status: "empty", generatedAt: nowIso(), itemCount: 0, items: [] };
}

// 每個資料來源各自 cache() 一次——同一次 request 內不論被幾個 Suspense 邊界
// awaited，實際 fetch 只打一次（React request memoization），各邊界仍各自
// 獨立 resolve/stream，不互相卡住。
const cachedMarket = cache((): Promise<LoadState<MarketDataOverview | null>> =>
  load("Market data overview", null, async () => (await getMarketDataOverview({ includeStale: true, topLimit: 20 })).data, (value) => !hasMarketOverviewData(value), "市場資料總覽目前沒有可用正式資料。"));
const cachedRealtimeMarket = cache((): Promise<LoadState<RealtimeMarketDashboard | null>> => loadRealtimeMarketDashboard());
const cachedBrief = cache((): Promise<LoadState<DailyBriefDashboard>> => loadDailyBriefDashboard());
const cachedRecommendations = cache((): Promise<LoadState<AiRecommendationV3Response>> =>
  load(
    "AI recommendations v3 (canonical, shared with /ai-recommendations)",
    buildEmptyRecommendations(),
    async () => await getAiRecommendationsV3(),
    (value) => (value.items?.length ?? 0) === 0,
    "今日 AI 推薦 v3 批次尚未回傳正式清單。",
  ));
const cachedS1Strategy = cache((): Promise<LoadState<S1StrategyData | null>> =>
  load("S1 strategy snapshot", null, async () => await getLabStrategySnapshot("cont_liq_v36"), (value) => value === null, "S1 核准快照目前無法讀取。"));
const cachedS1RealSim = cache((): Promise<LoadState<TrackRecordNavSummary | null>> =>
  load(
    "S1 F-AUTO SIM 實盤績效",
    null,
    async () => {
      const result = await getTrackRecordNav();
      return result.ok ? result.data.summary : null;
    },
    (value) => value === null,
    "S1 F-AUTO SIM 實盤績效目前無法讀取。",
  ));
const cachedIntel = cache((): Promise<LoadState<MarketIntelDashboard>> => loadMarketIntelDashboard());

// timedFetch 的 race-against-timeout 包一層：逾時回真的 BLOCKED LoadState
// （原本每個呼叫端各自手刻一段 `(() => {...})()`，現在收成一個 helper）。
async function timedLoad<T>(label: string, ms: number, loader: () => Promise<LoadState<T>>, fallbackData: T): Promise<LoadState<T>> {
  const result = await timedFetch(label, ms, loader());
  if (isTimeoutSentinel(result)) {
    return { state: "BLOCKED", data: fallbackData, updatedAt: nowIso(), source: label, reason: `資料延遲（${result._timeout}）` };
  }
  return result;
}

function skeletonStyleTag() {
  const pulse = "@keyframes _tac-pulse { 0%,100%{opacity:.18} 50%{opacity:.38} }";
  const skelCss = "._tac-skel { background:rgba(200,148,63,.09); border:1px solid rgba(200,148,63,.16); border-radius:2px; animation:_tac-pulse 1.6s ease-in-out infinite; }";
  const rowCss = "._tac-skel-row { display:flex; gap:1px; }";
  return pulse + " " + skelCss + " " + rowCss;
}

function HeroBandSkeleton() {
  return (
    <>
      <div className="_tac-skel-row" style={{ height: 322 }}>
        <div className="_tac-skel" style={{ flex: "0 0 454px" }} />
        <div className="_tac-skel" style={{ flex: 1 }} />
      </div>
      <div className="_tac-skel-row" style={{ height: 122, marginTop: 1 }}>
        <div className="_tac-skel" style={{ flex: 1 }} />
      </div>
    </>
  );
}

function LeadBandSkeleton() {
  return (
    <div className="_tac-skel-row" style={{ height: 220 }}>
      <div className="_tac-skel" style={{ flex: 1 }} />
      <div className="_tac-skel" style={{ flex: "0 0 348px" }} />
    </div>
  );
}

function FootBandSkeleton() {
  return (
    <div className="_tac-skel-row" style={{ height: 200 }}>
      <div className="_tac-skel" style={{ flex: "0 0 392px" }} />
      <div className="_tac-skel" style={{ flex: 1 }} />
    </div>
  );
}

function NewsTapeSkeleton() {
  return <div className="_tac-skel" style={{ minHeight: 400 }} />;
}

// ── 各版面各自獨立 async section — 各自 Suspense，互不卡住 ──────────────────
async function HeroBandSection({
  now,
  selectedSectorParam,
  heatmapMode,
}: {
  now: string;
  selectedSectorParam: string | null;
  heatmapMode: "core" | "all";
}) {
  const [market, realtimeMarket] = await Promise.all([
    timedLoad("market", FETCH_MARKET_MS, cachedMarket, null),
    timedLoad("main_market_feed", FETCH_MARKET_MS, cachedRealtimeMarket, null),
  ]);
  const coreHeatmap = buildKgiCoreHeatmap(realtimeMarket);
  const marketHeatmap = buildHeatmap(market);
  const hasRepresentativeFeed = hasProductHeatmapCoverage(marketHeatmap);
  const heatmap = coreHeatmap.length > 0 && hasRepresentativeFeed ? mergeCoreHeatmapWithRepresentativeFeed(coreHeatmap, marketHeatmap) : marketHeatmap;
  return (
    <>
      <div className="heroband">
        <IdxAnchorPanel heatmap={heatmap} market={market} realtimeMarket={realtimeMarket} now={now} />
        <HeatZonePanel heatmap={marketHeatmap} market={market} realtimeMarket={realtimeMarket} selectedSectorParam={selectedSectorParam} heatmapMode={heatmapMode} />
      </div>
      <IndexHistoryBand market={market} />
    </>
  );
}

async function LeadBandSection() {
  const [recommendations, brief] = await Promise.all([
    timedLoad("recommendations", FETCH_PRODUCT_MS, cachedRecommendations, buildEmptyRecommendations()),
    timedLoad("brief", FETCH_PRODUCT_MS, cachedBrief, buildEmptyBrief()),
  ]);
  return (
    <div className="leadband">
      <RecHeadline recommendations={recommendations} />
      <BriefColumn brief={brief} />
    </div>
  );
}

async function FootBandSection() {
  const [s1Strategy, s1RealSim, market] = await Promise.all([
    timedLoad("s1_strategy", FETCH_PRODUCT_MS, cachedS1Strategy, null),
    timedLoad("s1_real_sim", FETCH_PRODUCT_MS, cachedS1RealSim, null),
    timedLoad("market", FETCH_MARKET_MS, cachedMarket, null),
  ]);
  return (
    <div className="footband">
      <S1Bulletin strategy={s1Strategy} realSim={s1RealSim} />
      <RankColumns market={market} />
    </div>
  );
}

async function NewsTapeSection() {
  const intel = await timedLoad("intel", FETCH_INTEL_MS, cachedIntel, buildEmptyIntel());
  return <NewsTape intel={intel} />;
}

// ── Page entry point — 靜態殼同步輸出，各版面各自 Suspense stream ──────────
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ sector?: string; heatmap?: string }>;
}) {
  const params = await searchParams;
  const selectedSectorParam = params?.sector ?? null;
  const heatmapMode = params?.heatmap === "all" ? "all" : "core";
  const now = nowIso();

  return (
    <div className="home-ledger-shell">
      <style>{skeletonStyleTag()}</style>
      <HomeZoomController />
      <MarketStateBanner />
      <div className="tac-ledger">
        <header className="mast">
          <MastStatic />
          <Suspense fallback={<MastSkeleton />}>
            <MastDynamic now={now} />
          </Suspense>
        </header>
        <div className="sheet">
          <div className="maincol">
            <Suspense fallback={<HeroBandSkeleton />}>
              <HeroBandSection now={now} selectedSectorParam={selectedSectorParam} heatmapMode={heatmapMode} />
            </Suspense>
            <Suspense fallback={<LeadBandSkeleton />}>
              <LeadBandSection />
            </Suspense>
            <Suspense fallback={<FootBandSkeleton />}>
              <FootBandSection />
            </Suspense>
          </div>
          <Suspense fallback={<NewsTapeSkeleton />}>
            <NewsTapeSection />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
