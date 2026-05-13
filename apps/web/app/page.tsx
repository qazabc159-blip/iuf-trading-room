import Link from "next/link";
import { Suspense } from "react";
import type { CSSProperties, ReactNode } from "react";

import { IndustryHeatmap, type IndustryHeatmapTile } from "./components/industry-heatmap";
import {
  getBriefs,
  getContentDrafts,
  getDashboardSnapshot,
  getFinMindDiagnostics,
  getFinMindStatus,
  getKgiCoreHeatmap,
  getKgiMarketOverview,
  getMarketDataOverview,
  getMarketIntelAnnouncements,
  getOpsSnapshot,
  getKgiQuoteStatus,
  getStrategyIdeas,
  getTwseMarketHeatmap,
  getTwseMarketOverview,
  listStrategyRuns,
  type CompanyAnnouncement,
  type DashboardSnapshot,
  type FinMindDatasetStatus,
  type FinMindDiagnosticsStatus,
  type FinMindSourceStatus,
  type KgiCoreHeatmap,
  type KgiCoreHeatmapTile,
  type KgiMarketOverview,
  type KgiQuoteStatus,
  type MarketDataOverview,
  type MarketDataOverviewLeader,
  type OpsSnapshotData,
  type TwseIndustryHeatmap,
  type TwseIndustryHeatmapTile,
  type TwseMarketOverview,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";
import { getPaperHealth, type PaperHealthState } from "@/lib/paper-orders-api";
import type { DailyBrief } from "@iuf-trading-room/contracts";

export const dynamic = "force-dynamic";

type LoadState<T> =
  | { state: "LIVE"; data: T; updatedAt: string; source: string }
  | { state: "EMPTY"; data: T; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: T; updatedAt: string; source: string; reason: string };

type DashboardState = "LIVE" | "STALE" | "EMPTY" | "REVIEW" | "BLOCKED" | "DEGRADED";
type TacticalStatus = "live" | "stale" | "empty" | "review" | "blocked" | "degraded";

type FinMindDashboard = {
  status: FinMindSourceStatus;
  diagnostics: FinMindDiagnosticsStatus | null;
};

type DailyBriefDashboard = {
  today: string;
  state: "PUBLISHED" | "AWAITING_REVIEW" | "MISSING" | "BLOCKED";
  latestDate: string | null;
  latest: DailyBrief | null;
  todayBrief: DailyBrief | null;
  draftCount: number;
  reason?: string;
};

type StrategyIdeasData = Awaited<ReturnType<typeof getStrategyIdeas>>["data"];
type StrategyRunsData = Awaited<ReturnType<typeof listStrategyRuns>>["data"];
type StrategyIdeaItem = StrategyIdeasData["items"][number];

type IntelItem = CompanyAnnouncement & {
  companyId?: string;
  ticker: string;
  companyName: string;
};

type MarketIntelDashboard = {
  items: IntelItem[];
  selected: Array<{ id: string; ticker: string; name: string }>;
  failures: number;
};

type BrokerAccessDashboard = {
  formalReadOnlyConnected: boolean;
  quoteDisabled: boolean;
  tickSubscriptions: number;
  bidAskSubscriptions: number;
  note: string;
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

type SourceTile = {
  key: string;
  name: string;
  short: string;
  desc: string;
  state: DashboardState;
  updatedAt: string | null;
  note: string;
  detail: string;
  href: string;
};

type HeatTile = IndustryHeatmapTile & {
  placeholder?: boolean;
};

type HeatTileLayout = HeatTile & {
  x: number;
  y: number;
  w: number;
  h: number;
  compact: boolean;
  labelMode: "full" | "compact" | "micro";
};

type TapeQuote = {
  sym: string;
  name: string;
  price: number | null;
  chg: number | null;
  pct: number | null;
  unit?: string;
  flow?: boolean;
  placeholder?: boolean;
};

const TAIPEI_TIME_ZONE = "Asia/Taipei";
const PAPER_PREVIEW_CAPITAL_TWD = 20_000;
const ANNOUNCEMENT_DAYS = 30;
const MAX_INTEL_ROWS = 12;
const MAX_HEATMAP_TILES = 240;
const HEATMAP_DISPLAY_TILES = 28;
const HEATMAP_SECTOR_OPTION_LIMIT = 8;
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
  "airlines": "航空運輸",
};

const EMPTY_TAPE_QUOTES: TapeQuote[] = [
  { sym: "TAIEX", name: "加權指數", price: null, chg: null, pct: null, placeholder: true },
  { sym: "TPEX", name: "櫃買指數", price: null, chg: null, pct: null, placeholder: true },
  { sym: "上漲", name: "上漲家數", price: null, chg: null, pct: null, unit: "家", flow: true, placeholder: true },
  { sym: "下跌", name: "下跌家數", price: null, chg: null, pct: null, unit: "家", flow: true, placeholder: true },
  { sym: "排行", name: "盤中排行", price: null, chg: null, pct: null, placeholder: true },
  { sym: "熱力圖", name: "台股公司池", price: null, chg: null, pct: null, placeholder: true },
  { sym: "重大訊息", name: "官方資訊流", price: null, chg: null, pct: null, placeholder: true },
  { sym: "紙上", name: "紙上交易", price: null, chg: null, pct: null, placeholder: true },
];

const EMPTY_HEATMAP: HeatTile[] = Array.from({ length: 12 }, (_, index) => ({
  symbol: `待${String(index + 1).padStart(2, "0")}`,
  name: "等待真實行情",
  pct: null,
  weight: index < 2 ? 3.4 : 2.2,
  source: "EMPTY",
  price: null,
  placeholder: true,
}));

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
// Returns either the real result or { _timeout: "<label>_<ms>ms" } sentinel.
// Caller detects _timeout and maps to BLOCKED with stale_reason (never fake-green).
const FETCH_SOFT_MS = 3000; // 3s soft budget — market/ops/brief/paper/broker/ideas/runs
const FETCH_HARD_MS = 5000; // 5s hard budget — finmind/intel(TWSE crawl)/snapshot

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T | { _timeout: string }> {
  return Promise.race([
    p,
    new Promise<{ _timeout: string }>((resolve) =>
      setTimeout(() => resolve({ _timeout: `timeout_${ms}ms_${label}` }), ms),
    ),
  ]);
}

// ── Per-fetch telemetry ───────────────────────────────────────────────────────
// Wraps a promise, logs duration + status, then returns result.
// Bruce: grep prod logs for "[homepage-fetch]" to identify culprit panels.
async function timedFetch<T>(
  label: string,
  ms: number,
  p: Promise<T>,
): Promise<T | { _timeout: string }> {
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

// ── Detect timeout sentinel ───────────────────────────────────────────────────
function isTimeoutSentinel(value: unknown): value is { _timeout: string } {
  return typeof value === "object" && value !== null && "_timeout" in value;
}

function todayTaipeiDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TAIPEI_TIME_ZONE });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatClock(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
  });
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
  return value.toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function tacticalStatus(state: DashboardState): TacticalStatus {
  if (state === "LIVE") return "live";
  if (state === "STALE") return "stale";
  if (state === "REVIEW" || state === "DEGRADED") return "review";
  if (state === "BLOCKED") return "blocked";
  return "empty";
}

function stateLabel(state: DashboardState) {
  const labels: Record<DashboardState, string> = {
    LIVE: "正常",
    STALE: "過期",
    EMPTY: "待資料",
    REVIEW: "整理中",
    BLOCKED: "需處理",
    DEGRADED: "降級",
  };
  return labels[state];
}

function statusCode(status: TacticalStatus) {
  const labels: Record<TacticalStatus, string> = {
    live: "可用",
    stale: "待更新",
    empty: "待資料",
    review: "待確認",
    blocked: "需處理",
    degraded: "降級",
  };
  return labels[status];
}

function statusZh(status: TacticalStatus) {
  const labels: Record<TacticalStatus, string> = {
    live: "正常",
    stale: "過期",
    empty: "待資料",
    review: "待確認",
    blocked: "需處理",
    degraded: "降級",
  };
  return labels[status];
}

function stateFromLoad(input: LoadState<unknown> | LoadState<unknown>["state"]): DashboardState {
  const state = typeof input === "string" ? input : input.state;
  if (state === "LIVE") return "LIVE";
  if (state === "EMPTY") return "EMPTY";
  return "BLOCKED";
}

function unwrapMaybeData<T>(value: T | { data: T }): T {
  return typeof value === "object" && value !== null && "data" in value
    ? (value as { data: T }).data
    : value as T;
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

function kgiIsLive(feed: LoadState<RealtimeMarketDashboard | null>) {
  const data = loadStateData(feed);
  return Boolean(data?.kgiOverview?.taiex && data.kgiOverview.sourceState !== "unavailable");
}

function marketSourceFallbackLabel(feed: LoadState<RealtimeMarketDashboard | null>) {
  if (kgiIsLive(feed)) return "即時";
  const data = loadStateData(feed);
  if (data?.twseOverview?.taiex) return closeLabel(data.twseOverview.taiex.ts);
  return "即時連線維護中，目前顯示昨日收盤";
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

function categoryLabel(category: string | null | undefined) {
  if (!category) return "重大訊息";
  const key = category.toLowerCase();
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

function asDraftRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function draftDate(payload: unknown, fallback: string | null) {
  const record = asDraftRecord(payload);
  const value = record.date ?? record.targetDate;
  return typeof value === "string" ? value.slice(0, 10) : fallback?.slice(0, 10) ?? null;
}

function finmindDatasetState(dataset: FinMindDatasetStatus): DashboardState {
  if (dataset.state === "LIVE" || dataset.state === "READY") return "LIVE";
  if (dataset.state === "STALE") return "STALE";
  if (dataset.state === "DEGRADED" || dataset.state === "FALLBACK") return "DEGRADED";
  if (dataset.state === "BLOCKED" || dataset.state === "ERROR" || dataset.state === "MOCK" || dataset.state === "CLOSED") {
    return "BLOCKED";
  }
  return "EMPTY";
}

async function loadFinMindDashboard(): Promise<LoadState<FinMindDashboard | null>> {
  const updatedAt = nowIso();
  try {
    const [status, diagnostics] = await Promise.all([
      getFinMindStatus(),
      getFinMindDiagnostics().then((response) => response.data).catch(() => null),
    ]);
    const data = { status: status.data, diagnostics };
    if (!status.data.tokenPresent || status.data.state === "BLOCKED") {
      return {
        state: "BLOCKED",
        data,
        updatedAt: status.data.updatedAt ?? updatedAt,
        source: "FinMind",
        reason: "FinMind token 或後端資料源目前不可用。",
      };
    }
    return status.data.state === "LIVE_READY"
      ? { state: "LIVE", data, updatedAt: status.data.updatedAt ?? updatedAt, source: "FinMind" }
      : {
        state: "EMPTY",
        data,
        updatedAt: status.data.updatedAt ?? updatedAt,
        source: "FinMind",
        reason: "FinMind 已設定，但仍有資料集等待排程或回補。",
      };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: null,
      updatedAt,
      source: "FinMind",
      reason: friendlyDataError(error),
    };
  }
}

async function loadDailyBriefDashboard(): Promise<LoadState<DailyBriefDashboard>> {
  const today = todayTaipeiDate();
  return load<DailyBriefDashboard>(
    "OpenAlice / Daily Brief",
    { today, state: "BLOCKED", latestDate: null, latest: null, todayBrief: null, draftCount: 0, reason: "每日簡報資料讀取失敗。" },
    async () => {
      const [briefsResult, draftsResult] = await Promise.allSettled([
        getBriefs(),
        getContentDrafts({ status: "awaiting_review", limit: 50 }),
      ]);
      if (briefsResult.status === "rejected" && draftsResult.status === "rejected") {
        throw briefsResult.reason;
      }

      const briefs = briefsResult.status === "fulfilled" ? briefsResult.value.data : [];
      const drafts = draftsResult.status === "fulfilled" ? draftsResult.value.data : [];
      const sortedBriefs = [...briefs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const latest = sortedBriefs[0] ?? null;
      const todayBrief = sortedBriefs.find((brief) => brief.status === "published" && brief.date.slice(0, 10) === today) ?? null;
      const todayDrafts = drafts.filter((draft) => draft.targetTable === "daily_briefs" && draftDate(draft.payload, draft.targetEntityId) === today);

      if (todayBrief) {
        return {
          today,
          state: "PUBLISHED" as const,
          latestDate: todayBrief.date.slice(0, 10),
          latest,
          todayBrief,
          draftCount: todayDrafts.length,
        };
      }
      if (todayDrafts.length > 0) {
        return {
          today,
          state: "AWAITING_REVIEW" as const,
          latestDate: latest?.date.slice(0, 10) ?? null,
          latest,
          todayBrief: null,
          draftCount: todayDrafts.length,
        };
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

async function loadPaperHealthState(): Promise<LoadState<PaperHealthState | null>> {
  return load(
    "Paper Health",
    null,
    async () => getPaperHealth(),
    (value) => value === null,
    "紙上交易健康檢查目前沒有回傳資料。",
  );
}

function brokerAccessFromStatus(status: KgiQuoteStatus): BrokerAccessDashboard {
  const tickSubscriptions = status.subscribed_symbols?.tick?.length ?? 0;
  const bidAskSubscriptions = status.subscribed_symbols?.bidask?.length ?? 0;
  return {
    formalReadOnlyConnected: Boolean(status.kgi_logged_in),
    quoteDisabled: Boolean(status.quote_disabled_flag),
    tickSubscriptions,
    bidAskSubscriptions,
    note: status.kgi_logged_in
      ? "正式券商環境已登入；首頁維持只讀，不提供真實委託入口。"
      : "正式券商環境尚未回報登入狀態；首頁只顯示紙上交易與風控。"
  };
}

async function loadBrokerAccessState(): Promise<LoadState<BrokerAccessDashboard | null>> {
  const updatedAt = nowIso();
  try {
    const data = brokerAccessFromStatus(await getKgiQuoteStatus());
    return { state: "LIVE", data, updatedAt, source: "正式券商只讀狀態" };
  } catch {
    return {
      state: "EMPTY",
      data: null,
      updatedAt,
      source: "正式券商只讀狀態",
      reason: "正式券商只讀狀態暫時無法確認；首頁仍維持紙上交易與風控流程。"
    };
  }
}

async function loadRealtimeMarketDashboard(): Promise<LoadState<RealtimeMarketDashboard | null>> {
  return load<RealtimeMarketDashboard | null>(
    "Main market public/realtime feed",
    null,
    async () => {
      const [kgiOverview, kgiCoreHeatmap, twseOverview, twseHeatmap] = await Promise.allSettled([
        getKgiMarketOverview(),
        getKgiCoreHeatmap(),
        getTwseMarketOverview(),
        getTwseMarketHeatmap(),
      ]);

      const kgiCoreHeatmapValue = kgiCoreHeatmap.status === "fulfilled"
        ? unwrapKgiCoreHeatmap(kgiCoreHeatmap.value)
        : null;
      return {
        kgiOverview: kgiOverview.status === "fulfilled" ? unwrapMaybeData(kgiOverview.value) : null,
        kgiCoreHeatmap: kgiCoreHeatmapValue,
        twseOverview: twseOverview.status === "fulfilled" ? twseOverview.value : null,
        twseHeatmap: twseHeatmap.status === "fulfilled" ? twseHeatmap.value : null,
      };
    },
    (value) => {
      if (!value) return true;
      return !value.kgiOverview?.taiex && !value.twseOverview?.taiex && !(value.kgiCoreHeatmap?.data?.length) && !(value.kgiCoreHeatmap?.tiles?.length) && !(value.twseHeatmap?.data?.length);
    },
    "即時連線維護中，目前顯示昨日收盤",
  );
}

async function loadMarketIntelDashboard(): Promise<LoadState<MarketIntelDashboard>> {
  return load<MarketIntelDashboard>(
    "公開資訊重大訊息",
    { items: [], selected: [], failures: 0 },
    async () => {
      const aggregate = await getMarketIntelAnnouncements({
        days: ANNOUNCEMENT_DAYS,
        limit: MAX_INTEL_ROWS,
        scope: "market",
      });
      return {
        items: aggregate.data.items.map((item) => ({
          ...item,
          ticker: item.ticker ?? "MARKET",
          companyName: item.companyName ?? "大盤",
        })),
        selected: aggregate.data.selected,
        failures: aggregate.data.failures,
      };
    },
    (value) => value.items.length === 0,
    `近 ${ANNOUNCEMENT_DAYS} 天沒有可顯示的大盤新聞或官方重大訊息。`,
  );
}

function openAliceDashboardState(ops: LoadState<OpsSnapshotData | null>, brief: LoadState<DailyBriefDashboard>): DashboardState {
  if (ops.state === "BLOCKED" || brief.state === "BLOCKED") return "BLOCKED";
  if (brief.data.state === "PUBLISHED") return "LIVE";
  if (brief.data.state === "AWAITING_REVIEW") return "REVIEW";
  return "EMPTY";
}

function buildSources(params: {
  finmind: LoadState<FinMindDashboard | null>;
  market: LoadState<MarketDataOverview | null>;
  ops: LoadState<OpsSnapshotData | null>;
  brief: LoadState<DailyBriefDashboard>;
  paper: LoadState<PaperHealthState | null>;
  ideas: LoadState<StrategyIdeasData | null>;
  runs: LoadState<StrategyRunsData | null>;
  intel: LoadState<MarketIntelDashboard>;
}): SourceTile[] {
  const { finmind, market, ops, brief, paper, ideas, runs, intel } = params;
  const datasets = finmind.data?.status.datasets ?? [];
  const liveDatasets = datasets.filter((item) => finmindDatasetState(item) === "LIVE").length;
  const klineState: DashboardState =
    market.state === "BLOCKED" ? "BLOCKED" :
      (market.data?.quality.bars.ready ?? 0) > 0 ? "LIVE" :
        (market.data?.quality.bars.degraded ?? 0) > 0 ? "DEGRADED" : "EMPTY";
  const companyState: DashboardState =
    finmind.state === "BLOCKED" ? "BLOCKED" : liveDatasets > 0 ? "LIVE" : "EMPTY";
  const signalCount = ideas.data?.items.reduce((sum: number, item: StrategyIdeaItem) => sum + item.signalCount, 0) ?? 0;
  const paperState: DashboardState = paper.state === "LIVE" && paper.data?.previewReady ? "LIVE" : stateFromLoad(paper);

  const rows: SourceTile[] = [
    {
      key: "market",
      name: "市場行情",
      short: "行情",
      desc: "報價 / 排行 / 熱力圖",
      state: stateFromLoad(market),
      updatedAt: market.data?.quotes.latestQuoteTimestamp ?? market.data?.generatedAt ?? market.updatedAt,
      note: `${formatNumber(market.data?.quotes.fresh)} / ${formatNumber(market.data?.quotes.total)} 檔`,
      detail: "行情資料不足時，首頁只標示缺口，不用假價格冒充即時盤。",
      href: "/companies",
    },
    {
      key: "kline",
      name: "K 線資料",
      short: "K 線",
      desc: "日線 / 技術面研究",
      state: klineState,
      updatedAt: market.data?.generatedAt ?? market.updatedAt,
      note: `${formatNumber(market.data?.quality.bars.ready)} 檔可讀`,
      detail: "K 線作為研究資料；若來源不足，不升格成交易訊號。",
      href: "/companies/2330",
    },
    {
      key: "company",
      name: "公司資料",
      short: "公司",
      desc: "財報 / 籌碼 / 基本面",
      state: companyState,
      updatedAt: finmind.data?.status.updatedAt ?? finmind.updatedAt,
      note: `${formatNumber(liveDatasets)} 個資料集`,
      detail: "公司頁串接官方資料集，缺資料時保留缺口，不補假內容。",
      href: "/companies/2330",
    },
    {
      key: "intel",
      name: "重大訊息",
      short: "重大訊息",
      desc: "官方公告 / 市場情報",
      state: stateFromLoad(intel),
      updatedAt: intel.data.items[0]?.date ?? intel.updatedAt,
      note: `${formatNumber(intel.data.items.length)} 筆 / ${formatNumber(intel.data.selected.length)} 檔`,
      detail: intel.state === "LIVE" ? "官方重大訊息已進首頁工作流。" : intel.reason,
      href: "/market-intel",
    },
    {
      key: "strategy",
      name: "策略候選",
      short: "策略",
      desc: "候選觀察 / 篩選理由",
      state: ideas.state === "LIVE" ? "LIVE" : stateFromLoad(ideas),
      updatedAt: ideas.data?.generatedAt ?? ideas.updatedAt,
      note: `${formatNumber(ideas.data?.items.length)} 候選 / ${formatNumber(ideas.data?.summary.block)} 阻擋`,
      detail: "候選分數不是績效，不產生交易建議。",
      href: "/ideas",
    },
    {
      key: "brief",
      name: "AI 每日簡報",
      short: "簡報",
      desc: "盤後整理 / 已審發布",
      state: openAliceDashboardState(ops, brief),
      updatedAt: brief.data.todayBrief?.createdAt ?? brief.data.latest?.createdAt ?? brief.updatedAt,
      note: brief.data.state === "PUBLISHED" ? "今日已發布" : brief.data.state === "AWAITING_REVIEW" ? `${brief.data.draftCount} 草稿待確認` : "待產生",
      detail: brief.data.reason ?? "每日簡報只顯示已發布或待確認狀態，不偽裝成正式新聞。",
      href: "/briefs",
    },
    {
      key: "paper",
      name: "紙上交易",
      short: "紙上",
      desc: "預覽 / 風控 / 部位",
      state: paperState,
      updatedAt: paper.data?.lastFillTs ?? paper.updatedAt,
      note: paper.data?.previewReady ? "可預覽" : "等待預覽",
      detail: "首頁只導向紙上交易與風控預覽，不送出真實委託。",
      href: "/portfolio",
    },
    {
      key: "quant",
      name: "量化批次",
      short: "Quant",
      desc: "候選 bundle / 批次紀錄",
      state: runs.state === "LIVE" ? "LIVE" : stateFromLoad(runs),
      updatedAt: runs.data?.items[0]?.createdAt ?? runs.updatedAt,
      note: `${formatNumber(runs.data?.items.length)} 批次 / ${formatNumber(signalCount)} 訊號`,
      detail: "批次紀錄只呈現資料狀態，不顯示未驗證績效。",
      href: "/runs",
    },
  ];

  return rows;
}

function buildHeatmap(market: LoadState<MarketDataOverview | null>): HeatTile[] {
  const contextRows = market.data?.marketContext?.heatmap ?? [];
  if (contextRows.length > 0) {
    return contextRows.slice(0, MAX_HEATMAP_TILES).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      sector: item.sector,
      pct: typeof item.changePct === "number" ? item.changePct : null,
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
  const rows: MarketDataOverviewLeader[] = [
    ...leaders.mostActive,
    ...leaders.topGainers,
    ...leaders.topLosers,
  ];
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
      pct: typeof item.changePct === "number" ? item.changePct : null,
      weight: typeof item.volume === "number" && item.volume > 0 ? Math.log10(item.volume + 10) : Math.max(1, 6 - index * 0.18),
      source: item.source,
      price: typeof item.last === "number" ? item.last : null,
      readiness: item.readiness,
      freshnessStatus: item.freshnessStatus,
    }));
}

type HeatmapSectorOption = {
  key: string;
  label: string;
  count: number;
  up: number;
  down: number;
  weight: number;
};

function buildKgiCoreHeatmap(feed: LoadState<RealtimeMarketDashboard | null>): HeatTile[] {
  const rows = loadStateData(feed)?.kgiCoreHeatmap;
  const tiles = rows?.data ?? rows?.tiles ?? [];
  return tiles
    .filter((item) => item.symbol && item.symbol.trim().length > 0)
    .slice(0, 32)
    .map((item: KgiCoreHeatmapTile, index) => {
      const price = finite(item.last ?? item.price ?? item.close);
      const pct = finite(item.changePct ?? item.pct);
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
        readiness: "ready",
        freshnessStatus: "fresh",
      };
    });
}

function buildTwseIndustryRows(feed: LoadState<RealtimeMarketDashboard | null>): TwseIndustryHeatmapTile[] {
  return (loadStateData(feed)?.twseHeatmap?.data ?? [])
    .filter((item) => item.industry && Number.isFinite(item.avgChangePct))
    .sort((left, right) => right.stockCount - left.stockCount);
}

function readMarketIndex(feed: LoadState<RealtimeMarketDashboard | null>, market: LoadState<MarketDataOverview | null>): MarketIndexDisplay {
  const data = loadStateData(feed);
  const kgi = data?.kgiOverview?.taiex ?? null;
  if (kgi && finite(kgi.value) !== null) {
    const stale = isStaleTimestamp(kgi.ts, data?.kgiOverview?.staleAfterSec ?? 60);
    return {
      sym: "TAIEX",
      name: "加權指數",
      price: finite(kgi.value),
      chg: finite(kgi.change),
      pct: finite(kgi.changePct),
      updatedAt: kgi.ts,
      label: stale ? "資料更新中" : "即時",
      source: stale ? "fallback" : "realtime",
    };
  }

  const twse = data?.twseOverview?.taiex ?? null;
  if (twse && finite(twse.value) !== null) {
    return {
      sym: "TAIEX",
      name: "加權指數",
      price: finite(twse.value),
      chg: finite(twse.change),
      pct: finite(twse.changePct),
      updatedAt: twse.ts,
      label: closeLabel(twse.ts),
      source: "close",
    };
  }

  const index = market.data?.marketContext?.index;
  if (index && index.last !== null && index.state !== "EMPTY") {
    return {
      sym: index.symbol ?? "TAIEX",
      name: index.name,
      price: index.last,
      chg: index.change,
      pct: index.changePct,
      updatedAt: index.timestamp,
      label: "即時連線維護中，目前顯示昨日收盤",
      source: "fallback",
    };
  }

  return { sym: "TAIEX", name: "加權指數", price: null, chg: null, pct: null, updatedAt: null, label: "資料更新中", source: "none" };
}

function readMarketBreadth(feed: LoadState<RealtimeMarketDashboard | null>, market: LoadState<MarketDataOverview | null>, heatmap: HeatTile[]): BreadthDisplay {
  const data = loadStateData(feed);
  const kgiBreadth = data?.kgiOverview?.breadth ?? null;
  const kgiTotal = finite(kgiBreadth?.total);
  if (kgiBreadth && kgiTotal !== null && kgiTotal > 0) {
    return {
      up: finite(kgiBreadth.up) ?? 0,
      down: finite(kgiBreadth.down) ?? 0,
      flat: finite(kgiBreadth.flat) ?? 0,
      total: kgiTotal,
      amount: finite(kgiBreadth.amount),
      updatedAt: kgiBreadth.updatedAt ?? data?.kgiOverview?.updatedAt ?? null,
      label: "即時",
    };
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
    return { up: legacyBreadth.up, down: legacyBreadth.down, flat: legacyBreadth.flat, total: legacyBreadth.total, amount: null, updatedAt: legacyBreadth.updatedAt, label: "即時連線維護中，目前顯示昨日收盤" };
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

function buildHeatmapSectorOptions(heatmap: HeatTile[]): HeatmapSectorOption[] {
  const bySector = new Map<string, HeatmapSectorOption>();
  for (const tile of heatmap.filter((item) => !item.placeholder)) {
    const key = heatmapSectorName(tile);
    const current = bySector.get(key) ?? { key, label: heatmapSectorLabel(key), count: 0, up: 0, down: 0, weight: 0 };
    current.count += 1;
    current.weight += Math.max(0.1, tile.weight);
    if ((tile.pct ?? 0) > 0) current.up += 1;
    if ((tile.pct ?? 0) < 0) current.down += 1;
    bySector.set(key, current);
  }

  const sectors = [...bySector.values()]
    .filter((sector) => sector.count > 0)
    .sort((left, right) => {
      const rightSemiconductor = right.label.includes("半導體") || right.key.toLowerCase().includes("semiconductor");
      const leftSemiconductor = left.label.includes("半導體") || left.key.toLowerCase().includes("semiconductor");
      const semiconductorBias = (rightSemiconductor ? 10_000 : 0) - (leftSemiconductor ? 10_000 : 0);
      if (semiconductorBias !== 0) return semiconductorBias;
      return right.weight - left.weight;
    })
    .slice(0, HEATMAP_SECTOR_OPTION_LIMIT);

  const total = heatmap.filter((item) => !item.placeholder).length;
  const allOption = {
    key: "ALL",
    label: "大盤精選",
    count: total,
    up: heatmap.filter((item) => !item.placeholder && (item.pct ?? 0) > 0).length,
    down: heatmap.filter((item) => !item.placeholder && (item.pct ?? 0) < 0).length,
    weight: heatmap.reduce((sum, item) => sum + Math.max(0.1, item.weight), 0),
  };
  return total > 0 ? [allOption, ...sectors] : [allOption];
}

function selectedHeatmapSector(options: HeatmapSectorOption[], requested: string | null | undefined) {
  const fallback = options[0] ?? { key: "ALL", label: "大盤精選", count: 0, up: 0, down: 0, weight: 0 };
  if (requested) {
    const matched = options.find((option) => option.key === requested || option.label === requested);
    if (matched) return matched;
  }
  return options.find((option) => option.label.includes("半導體") || option.key.toLowerCase().includes("semiconductor"))
    ?? options.find((option) => option.key !== "ALL")
    ?? fallback;
}

function heatmapRowsForSector(heatmap: HeatTile[], sector: HeatmapSectorOption) {
  const rows = sector.key === "ALL"
    ? heatmap
    : heatmap.filter((tile) => heatmapSectorName(tile) === sector.key);
  return rows
    .filter((item) => !item.placeholder)
    .sort((left, right) => {
      const weightDelta = Math.max(0.1, right.weight) - Math.max(0.1, left.weight);
      if (Math.abs(weightDelta) > 0.001) return weightDelta;
      return Math.abs(right.pct ?? 0) - Math.abs(left.pct ?? 0);
    })
    .slice(0, HEATMAP_DISPLAY_TILES);
}

function buildTreemapLayout(items: HeatTile[]): HeatTileLayout[] {
  const sorted = [...items]
    .sort((left, right) => {
      const weightDelta = Math.max(0.1, right.weight) - Math.max(0.1, left.weight);
      if (Math.abs(weightDelta) > 0.001) return weightDelta;
      return Math.abs(right.pct ?? 0) - Math.abs(left.pct ?? 0);
    });
  const totalWeight = sorted.reduce((sum, item) => sum + Math.sqrt(Math.max(0.1, item.weight)), 0);
  if (totalWeight <= 0) return [];

  const nodes = sorted.map((item) => ({
    item,
    area: (Math.sqrt(Math.max(0.1, item.weight)) / totalWeight) * 10_000,
  }));
  const rect = { x: 0, y: 0, w: 100, h: 100 };
  const layout: HeatTileLayout[] = [];
  let row: typeof nodes = [];

  function worstAspect(candidate: typeof nodes, side: number) {
    if (candidate.length === 0 || side <= 0) return Number.POSITIVE_INFINITY;
    const areas = candidate.map((node) => Math.max(0.01, node.area));
    const sum = areas.reduce((acc, area) => acc + area, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  }

  function labelMode(w: number, h: number): HeatTileLayout["labelMode"] {
    const area = w * h;
    if (area >= 150 && w >= 9 && h >= 9) return "full";
    if (area >= 62 && w >= 5.5 && h >= 5.5) return "compact";
    return "micro";
  }

  function pushRow(nodesInRow: typeof nodes) {
    if (nodesInRow.length === 0 || rect.w <= 0 || rect.h <= 0) return;
    const rowArea = nodesInRow.reduce((sum, node) => sum + node.area, 0);

    if (rect.w >= rect.h) {
      const rowH = Math.min(rect.h, rowArea / rect.w);
      let xCursor = rect.x;
      nodesInRow.forEach((node, index) => {
        const tileW = index === nodesInRow.length - 1 ? rect.x + rect.w - xCursor : node.area / rowH;
        const mode = labelMode(tileW, rowH);
        layout.push({ ...node.item, x: xCursor, y: rect.y, w: tileW, h: rowH, compact: mode !== "full", labelMode: mode });
        xCursor += tileW;
      });
      rect.y += rowH;
      rect.h -= rowH;
      return;
    }

    const rowW = Math.min(rect.w, rowArea / rect.h);
    let yCursor = rect.y;
    nodesInRow.forEach((node, index) => {
      const tileH = index === nodesInRow.length - 1 ? rect.y + rect.h - yCursor : node.area / rowW;
      const mode = labelMode(rowW, tileH);
      layout.push({ ...node.item, x: rect.x, y: yCursor, w: rowW, h: tileH, compact: mode !== "full", labelMode: mode });
      yCursor += tileH;
    });
    rect.x += rowW;
    rect.w -= rowW;
  }

  for (const node of nodes) {
    const side = Math.min(rect.w, rect.h);
    const nextRow = [...row, node];
    if (row.length === 0 || worstAspect(nextRow, side) <= worstAspect(row, side)) {
      row = nextRow;
    } else {
      pushRow(row);
      row = [node];
    }
  }
  pushRow(row);

  return layout;
}

function hasMarketOverviewData(value: MarketDataOverview | null): boolean {
  if (!value) return false;
  return (
    value.quotes.total > 0 ||
    value.marketContext.index.last !== null ||
    value.marketContext.breadth.total > 0 ||
    value.marketContext.heatmap.length > 0
  );
}

function marketCoverageText(market: LoadState<MarketDataOverview | null>) {
  const quoteTotal = market.data?.quotes.total ?? 0;
  if (quoteTotal > 0) {
    return `${formatNumber(market.data?.quotes.fresh)} / ${formatNumber(quoteTotal)}`;
  }
  const dailyTotal = market.data?.marketContext.heatmap.length ?? 0;
  return dailyTotal > 0 ? `${formatNumber(dailyTotal)} 檔` : "0 檔";
}

function buildTapeQuotes(heatmap: HeatTile[], market: LoadState<MarketDataOverview | null>): TapeQuote[] {
  const index = market.data?.marketContext?.index;
  const legacyBreadth = market.data?.marketContext?.breadth;
  const breadth = legacyBreadth;
  const realQuotes: TapeQuote[] = [];

  if (index && index.last !== null && index.state !== "EMPTY") {
    realQuotes.push({
      sym: index.symbol ?? "TWII",
      name: index.name,
      price: index.last,
      chg: index.change ?? 0,
      pct: index.changePct ?? 0,
    });
  }

  if (breadth && breadth.total > 0) {
    realQuotes.push(
      { sym: "上漲", name: "上漲家數", price: breadth.up, chg: breadth.up, pct: 0, unit: "家", flow: true },
      { sym: "下跌", name: "下跌家數", price: -breadth.down, chg: -breadth.down, pct: 0, unit: "家", flow: true },
    );
  }

  const marketQuotes = heatmap.slice(0, 12).map((item) => {
    const pct = item.pct ?? 0;
    const price = item.price ?? 0;
    return {
      sym: item.symbol,
      name: item.name,
      price,
      chg: price * (pct / 100),
      pct,
    };
  });
  realQuotes.push(...marketQuotes);

  return realQuotes.length > 0 ? realQuotes : EMPTY_TAPE_QUOTES;
}

function directionLabel(direction: StrategyIdeaItem["direction"]) {
  if (direction === "bullish") return "偏多研究";
  if (direction === "bearish") return "偏空研究";
  return "中性";
}

function decisionLabel(decision: StrategyIdeaItem["marketData"]["decision"]) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待確認";
  return "阻擋";
}

function makeSpark(seed: string, state: DashboardState, length = 20) {
  const base = state === "LIVE" ? 55 : state === "REVIEW" || state === "DEGRADED" || state === "STALE" ? 34 : 16;
  const swing = state === "LIVE" ? 10 : state === "BLOCKED" ? 4 : 7;
  const code = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Array.from({ length }, (_, index) => {
    const wave = Math.sin((index + code) * 0.74) * swing;
    const drift = (index % 5) * (state === "LIVE" ? 1.2 : -0.7);
    return Math.max(4, base + wave + drift);
  });
}

function sparkPath(points: number[], width: number, height: number) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point - min) / range) * (height - 2) - 1;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function Panel({
  eyebrow,
  title,
  sub,
  right,
  children,
  className = "",
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`tac-panel ${className}`}>
      <CornerMarks />
      <header className="tac-panel-h">
        <div>
          <span className="tac-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {right && <div className="tac-panel-right">{right}</div>}
      </header>
      {children}
    </section>
  );
}

function CornerMarks() {
  return (
    <>
      <span className="tac-corner tl" />
      <span className="tac-corner tr" />
      <span className="tac-corner bl" />
      <span className="tac-corner br" />
    </>
  );
}

function StatusChip({ state, label, compact = false }: { state: DashboardState | TacticalStatus; label?: string; compact?: boolean }) {
  const status = typeof state === "string" && state === state.toLowerCase() ? state as TacticalStatus : tacticalStatus(state as DashboardState);
  return (
    <span className={`tac-chip ${status} ${compact ? "compact" : ""}`}>
      <span className="dot" />
      {statusCode(status)}
      <small>{label ?? statusZh(status)}</small>
    </span>
  );
}

function Sparkline({ points, state, width = 56, height = 18 }: { points: number[]; state: DashboardState; width?: number; height?: number }) {
  const path = sparkPath(points, width, height);
  return (
    <svg className={`tac-spark ${tacticalStatus(state)}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={`${path} L${width},${height} L0,${height} Z`} />
      <path d={path} />
    </svg>
  );
}

function PulseBars({ state = "LIVE", count = 20 }: { state?: DashboardState; count?: number }) {
  return (
    <span className={`tac-pulse-bars ${tacticalStatus(state)}`} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <i key={index} style={{ "--bar": `${22 + ((index * 19) % 68)}%` } as CSSProperties} />
      ))}
    </span>
  );
}

function QuoteTapeItem({ quote }: { quote: TapeQuote }) {
  const change = quote.chg ?? 0;
  const tone = change > 0 ? "up" : change < 0 ? "down" : "flat";
  if (quote.flow) {
    return (
      <span className="tac-tape-item">
        <b>{quote.sym}</b>
        <span>{quote.name}</span>
        <strong className={tone}>{quote.price !== null && quote.price > 0 ? "+" : ""}{formatNumber(quote.price)} {quote.unit}</strong>
        {quote.placeholder && <em>待資料</em>}
      </span>
    );
  }
  return (
    <span className="tac-tape-item">
      <b>{quote.sym}</b>
      <span>{quote.name}</span>
      <strong>{formatPrice(quote.price)}</strong>
      <strong className={tone}>{change > 0 ? "+" : ""}{formatPrice(quote.chg)} ({formatPercent(quote.pct)})</strong>
      {quote.placeholder && <em>待資料</em>}
    </span>
  );
}

function TacticalSidebar({ liveCount, alertCount }: { liveCount: number; alertCount: number }) {
  const nav = [
    { href: "/", title: "戰情台總覽", sub: "盤勢與任務", code: "01", active: true },
    { href: "/market-intel", title: "市場情報", sub: "重大訊息", code: "02" },
    { href: "/companies", title: "公司板", sub: "台股公司池", code: "03" },
    { href: "/ideas", title: "策略想法", sub: "候選清單", code: "04" },
    { href: "/runs", title: "策略批次", sub: "量化紀錄", code: "05" },
    { href: "/portfolio", title: "紙上交易室", sub: "委託與部位", code: "06" },
    { href: "/alerts", title: "警示", sub: "風控提醒", code: "07" },
    { href: "/signals", title: "訊號證據", sub: "訊號與依據", code: "08" },
    { href: "/plans", title: "交易計畫", sub: "計畫註記", code: "09" },
    { href: "/themes", title: "主題板", sub: "產業主題", code: "10" },
    { href: "/lab", title: "量化研究", sub: "策略包", code: "11" },
    { href: "/briefs", title: "AI 每日簡報", sub: "OpenAlice", code: "12" },
  ];
  return (
    <aside className="tac-sidebar">
      <div className="tac-brand">
        <div className="tac-brand-row">
          <div className="tac-logo">I<span /></div>
          <div>
            <div className="tac-brand-kicker">IUF · 戰情台</div>
            <div className="tac-brand-version">v3.0 · TACTICAL</div>
          </div>
        </div>
        <strong>台股 AI 交易戰情室</strong>
        <small>操作員 · IUF-01</small>
        <div className="tac-mode"><span />觀察模式 / 風控守門</div>
      </div>
      <nav className="tac-nav">
        {nav.map((item) => (
          <Link className={item.active ? "active" : ""} href={item.href} key={item.code}>
            <span>{item.code}</span>
            <div>
              <b>{item.title}</b>
              <small>{item.sub}</small>
            </div>
            {item.active && <i />}
          </Link>
        ))}
      </nav>
      <div className="tac-sidebar-radar">
        <span className="tac-mini-radar" />
        <div>
          <small>MARKET · INTEL</small>
          <b>{liveCount} 項可用 / {alertCount} 件提醒</b>
        </div>
      </div>
      <div className="tac-sidebar-clock">
        <small>本機時鐘 · 台北</small>
        <b suppressHydrationWarning>{formatClock(nowIso())}</b>
      </div>
    </aside>
  );
}

function Ticker({ quotes, market }: { quotes: TapeQuote[]; market: LoadState<MarketDataOverview | null> }) {
  const hasRealQuotes = quotes.some((quote) => !quote.placeholder);
  return (
    <div className="tac-ticker">
      <div className="tac-ticker-label"><span />正式資料</div>
      <div className="tac-ticker-track-wrap">
        {!hasRealQuotes && (
          <span className="tac-demo-badge">
            登入後讀取正式行情
          </span>
        )}
        <div className="tac-ticker-track">
          <div>{quotes.map((quote, index) => <QuoteTapeItem quote={quote} key={`${quote.sym}-${index}-a`} />)}</div>
          <div aria-hidden>{quotes.map((quote, index) => <QuoteTapeItem quote={quote} key={`${quote.sym}-${index}-b`} />)}</div>
        </div>
      </div>
    </div>
  );
}

function TopCommandBar({ now, market }: { now: string; market: LoadState<MarketDataOverview | null> }) {
  return (
    <header className="tac-topbar">
      <div>
        <h1>交易戰情台</h1>
          <span>盤勢總覽 · AI 簡報 · 紙上交易工作流</span>
        <b>D+0 · 觀察日</b>
      </div>
      <div>
        <PulseBars state={market.state === "LIVE" ? "LIVE" : "EMPTY"} />
        <span suppressHydrationWarning>{formatDateTime(now)} 台北</span>
        <button type="button">搜尋 <kbd>⌘ K</kbd></button>
        <StatusChip state={market.state === "LIVE" ? "LIVE" : "EMPTY"} label="正式資料" />
      </div>
    </header>
  );
}

function AgendaStrip({
  market,
  intel,
  brief,
  now,
}: {
  market: LoadState<MarketDataOverview | null>;
  intel: LoadState<MarketIntelDashboard>;
  brief: LoadState<DailyBriefDashboard>;
  now: string;
}) {
  const items = [
    { time: "09:00", label: "開盤", state: "done" },
    { time: "10:30", label: "盤中排行", state: market.state === "LIVE" ? "done" : "doing" },
    { time: "13:30", label: "收盤", state: "done" },
    { time: "14:30", label: "策略候選掃描", state: "done" },
    { time: "15:00", label: "AI 簡報", state: brief.data.state === "PUBLISHED" ? "done" : "doing" },
    { time: "17:00", label: "重大訊息", state: intel.state === "LIVE" ? "done" : "todo" },
    { time: "現在", label: "現在", state: "now" },
    { time: "23:30", label: "次日計畫鎖定", state: "todo" },
  ];
  return (
    <section className="tac-agenda">
      <CornerMarks />
      <div className="tac-agenda-clock">
        <span>今日節奏</span>
        <b suppressHydrationWarning>{formatClock(now)}</b>
      </div>
      <ol>
        {items.map((item) => (
          <li className={item.state} key={`${item.time}-${item.label}`}>
            <span>{item.time}</span>
            <i />
            <b>{item.label}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}

function HeroPanel({
  heatmap,
  market,
  realtimeMarket,
  paper,
  broker,
  brief,
  intel,
  now,
}: {
  heatmap: HeatTile[];
  market: LoadState<MarketDataOverview | null>;
  realtimeMarket: LoadState<RealtimeMarketDashboard | null>;
  paper: LoadState<PaperHealthState | null>;
  broker: LoadState<BrokerAccessDashboard | null>;
  brief: LoadState<DailyBriefDashboard>;
  intel: LoadState<MarketIntelDashboard>;
  now: string;
}) {
  const index = market.data?.marketContext?.index;
  const legacyBreadth = market.data?.marketContext?.breadth;
  const actualHeatmap = heatmap.filter((item) => !item.placeholder);
  const legacyIndexReady = Boolean(index && index.last !== null && index.state !== "EMPTY");
  const legacyTwii = legacyIndexReady && index ? {
    sym: index.symbol ?? "TWII",
    name: index.name,
    price: index.last ?? null,
    chg: index.change ?? null,
    pct: index.changePct ?? null,
  } : {
    sym: "TWII",
    name: "加權指數",
    price: null,
    chg: null,
    pct: null,
  };
  const twii = readMarketIndex(realtimeMarket, market);
  const breadth = readMarketBreadth(realtimeMarket, market, actualHeatmap);
  const indexReady = twii.price !== null || legacyTwii.price !== null;
  const marketReady = indexReady && (actualHeatmap.length > 0 || breadth.total > 0);
  const fallbackUp = actualHeatmap.filter((item) => (item.pct ?? 0) > 0).length;
  const fallbackDown = actualHeatmap.filter((item) => (item.pct ?? 0) < 0).length;
  const fallbackFlat = Math.max(0, actualHeatmap.length - fallbackUp - fallbackDown);
  const upCount = breadth && breadth.total > 0 ? breadth.up : fallbackUp;
  const downCount = breadth && breadth.total > 0 ? breadth.down : fallbackDown;
  const flatCount = breadth && breadth.total > 0 ? breadth.flat : fallbackFlat;
  const breadthTotal = breadth && breadth.total > 0 ? breadth.total : actualHeatmap.length;
  const downPct = breadthTotal ? Math.round((downCount / breadthTotal) * 1000) / 10 : 0;
  const briefState = brief.data.state === "PUBLISHED" ? "已發布" : brief.data.latest ? "有最新" : "待產生";
  const tradeState = broker.data?.formalReadOnlyConnected ? "正式可登入" : paper.data?.previewReady ? "紙上可預覽" : "待檢查";
  const tradeTone: TacticalStatus = broker.data?.formalReadOnlyConnected || paper.data?.previewReady ? "live" : paper.state === "BLOCKED" ? "blocked" : "empty";
  const focusText = brief.data.state === "PUBLISHED"
    ? "閱讀今日 AI 簡報"
    : intel.data.items.length > 0
      ? `檢查 ${intel.data.items.length} 筆重大訊息`
      : "查看盤勢與候選觀察";
  return (
    <section className="tac-panel tac-hero-panel">
      <CornerMarks />
      <div className="tac-hero-status">
        <span><i />OBSERVE</span>
        <div><small>MODE</small><b>台股觀察</b></div>
        <div><small>SESSION</small><b suppressHydrationWarning>{formatClock(now)}</b></div>
        <div><small>TODAY FOCUS</small><b>{focusText}</b></div>
        <StatusChip state={marketReady ? "LIVE" : "EMPTY"} label={marketReady ? "盤勢" : "等待資料"} compact />
      </div>

      <div className="tac-index-card">
        {!indexReady && <span className="tac-demo-badge floating">資料更新中</span>}
        <div>
          <div className="tac-index-title"><b>{twii.sym}</b><span>{twii.name}</span><em>{twii.label}</em></div>
          <div className="tac-index-main">
            <strong>{formatPrice(twii.price)}</strong>
            <span className={(twii.chg ?? 0) > 0 ? "price-up" : (twii.chg ?? 0) < 0 ? "price-down" : ""}>
              {(twii.chg ?? 0) > 0 ? "▲" : (twii.chg ?? 0) < 0 ? "▼" : "—"} {formatPrice(twii.chg === null ? null : Math.abs(twii.chg))}
            </span>
            <span className={(twii.pct ?? 0) > 0 ? "price-up" : (twii.pct ?? 0) < 0 ? "price-down" : ""}>{formatPercent(twii.pct)}</span>
          </div>
          <IndexOhlcChart history={index?.history ?? []} />
        </div>
        <div className="tac-breadth">
          <div className="tac-index-title"><b>BREADTH</b><span>漲跌家數</span></div>
          <div className="tac-breadth-counts">
            <span className="price-up">{upCount}</span><small>漲</small>
            <span>{flatCount}</span><small>平</small>
            <span className="price-down">{downCount}</span><small>跌</small>
          </div>
          <div className="tac-breadth-bar">
            <i className="up" style={{ width: `${breadthTotal ? (upCount / breadthTotal) * 100 : 25}%` }} />
            <i className="flat" style={{ width: `${breadthTotal ? (flatCount / breadthTotal) * 100 : 10}%` }} />
            <i className="down" style={{ width: `${breadthTotal ? (downCount / breadthTotal) * 100 : 65}%` }} />
          </div>
          <small>共 {formatNumber(breadthTotal)} 檔 · 跌 ▶ {downPct}%</small>
        </div>
      </div>

      <div className="tac-hero-kpis">
        <Metric label="市場覆蓋" value={marketCoverageText(market)} sub={(market.data?.quotes.total ?? 0) > 0 ? "可用報價 / 監看股票" : "FinMind 官方日資料 / 公司池"} tone={market.state === "LIVE" ? "live" : "empty"} />
        <Metric label="重大訊息" value={formatNumber(intel.data.items.length)} sub={`${formatNumber(intel.data.selected.length)} 檔公司 · ${ANNOUNCEMENT_DAYS} 天`} tone={intel.state === "LIVE" ? "live" : intel.state === "EMPTY" ? "empty" : "blocked"} />
        <Metric label="AI 簡報" value={briefState} sub={brief.data.latestDate ? `最新 ${brief.data.latestDate}` : "等待今日整理"} tone={brief.data.state === "PUBLISHED" ? "live" : brief.data.latest ? "review" : "empty"} />
        <Metric label="交易環境" value={tradeState} sub={broker.data?.formalReadOnlyConnected ? "正式只讀 / 下單入口關閉" : "紙上預覽 / 風控檢查"} tone={tradeTone} />
      </div>
    </section>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub: string; tone: TacticalStatus }) {
  return (
    <div className="tac-metric">
      <span>{label}</span>
      <b className={tone}>{value}</b>
      <small>{sub}</small>
    </div>
  );
}

function IndexOhlcChart({ history }: { history: NonNullable<MarketDataOverview["marketContext"]["index"]["history"]> }) {
  const rows = history
    .filter((row) => typeof row.close === "number" && Number.isFinite(row.close))
    .slice(-64);

  if (rows.length < 2) {
    return (
      <svg className="tac-intraday tac-index-ohlc empty" viewBox="0 0 360 58" preserveAspectRatio="none" role="img" aria-label="加權指數日 K 資料等待回補">
        <path d="M0,52 L360,52" />
      </svg>
    );
  }

  const width = 360;
  const height = 58;
  const values = rows.flatMap((row) => [
    row.high ?? row.close ?? 0,
    row.low ?? row.close ?? 0,
    row.open ?? row.close ?? 0,
    row.close ?? 0,
  ]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xFor = (index: number) => (index / (rows.length - 1)) * width;
  const yFor = (value: number | null | undefined) => {
    const safe = typeof value === "number" && Number.isFinite(value) ? value : min;
    return height - 6 - ((safe - min) / range) * (height - 12);
  };
  const closePath = rows.map((row, index) => {
    const x = xFor(index);
    const y = yFor(row.close);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
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
              style={{
                left: `${xPct}%`,
                width: `${hitPct}%`,
                "--marker-y": `${closeY}px`,
                "--tip-x": xPct > 78 ? "-92%" : xPct < 22 ? "-8%" : "-50%",
              } as CSSProperties}
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

type MoverRow = {
  symbol: string;
  name: string;
  last: number | null;
  changePct: number | null;
  volume: number | null;
};

function marketNameFromSymbol(symbol: string) {
  return symbol;
}

function leaderToMover(row: MarketDataOverviewLeader): MoverRow {
  return {
    symbol: row.symbol,
    name: row.name ?? marketNameFromSymbol(row.symbol),
    last: row.last,
    changePct: row.changePct ?? null,
    volume: row.volume ?? null,
  };
}

function MarketMoversPanel({ market }: { market: LoadState<MarketDataOverview | null> }) {
  const leaders = market.data?.leaders;
  const hasLeaderRows = leaders ? !(
    leaders.topGainers.length === 0 &&
    leaders.topLosers.length === 0 &&
    leaders.mostActive.length === 0
  ) : false;
  const hasRealLeaders = market.state === "LIVE" && hasLeaderRows;
  const groups = [
    {
      key: "up",
      title: "漲幅排行",
      rows: hasRealLeaders ? leaders?.topGainers.slice(0, 5).map(leaderToMover) ?? [] : [],
    },
    {
      key: "down",
      title: "跌幅排行",
      rows: hasRealLeaders ? leaders?.topLosers.slice(0, 5).map(leaderToMover) ?? [] : [],
    },
    {
      key: "active",
      title: "成交活躍",
      rows: hasRealLeaders ? leaders?.mostActive.slice(0, 5).map(leaderToMover) ?? [] : [],
    },
  ];
  return (
    <Panel
      eyebrow="MARKET MOVERS"
      title="盤勢排行"
      sub={hasRealLeaders ? "正式資料來源回傳的漲跌與成交排行" : "等待正式排行回傳；不顯示示意股票。"}
      right={<><PulseBars state={hasRealLeaders ? "LIVE" : "EMPTY"} /><span>{hasRealLeaders ? "正式" : "待資料"}</span></>}
      className="tac-movers-panel"
    >
      <div className="tac-mover-board">
        {groups.map((group) => (
          <section key={group.key}>
            <h3>{group.title}</h3>
            <div className="tac-mover-list">
              {group.rows.map((row) => {
                const tone = (row.changePct ?? 0) > 0 ? "up" : (row.changePct ?? 0) < 0 ? "down" : "flat";
                return (
                  <Link href={`/companies/${encodeURIComponent(row.symbol)}`} key={`${group.key}-${row.symbol}`}>
                    <b>{row.symbol}</b>
                    <span>{row.name}</span>
                    <strong className={tone}>{formatPercent(row.changePct)}</strong>
                    <small>{formatPrice(row.last)}</small>
                  </Link>
                );
              })}
              {group.rows.length === 0 && <div className="tac-empty-line">目前沒有排行資料。</div>}
            </div>
          </section>
        ))}
      </div>
    </Panel>
  );
}

function FreshnessPanel({ sources }: { sources: SourceTile[] }) {
  const live = sources.filter((source) => source.state === "LIVE").length;
  const review = sources.filter((source) => source.state === "STALE" || source.state === "REVIEW" || source.state === "DEGRADED").length;
  const blocked = sources.length - live - review;
  return (
    <Panel eyebrow="FRESHNESS" title="資料新鮮度 · 時間軸" sub={`${sources.length} 項資料 vs 現在 · 對齊刻度`}>
      <div className="tac-fresh-list">
        {sources.map((source) => (
          <Link href={source.href} key={source.key}>
            <b>{source.short}</b>
            <div>
              <i className={tacticalStatus(source.state)} style={{ left: source.state === "LIVE" ? "6%" : source.state === "STALE" ? "58%" : source.state === "BLOCKED" ? "78%" : "92%" }} />
            </div>
            <small>{freshnessText(source.updatedAt, source.state)}</small>
          </Link>
        ))}
      </div>
      <div className="tac-fresh-legend">
        <span><i className="live" />{live} 新鮮</span>
        <span><i className="stale" />{review} 待確認</span>
        <span><i className="blocked" />{blocked} 無資料</span>
      </div>
    </Panel>
  );
}

function HeatmapPanel({
  heatmap,
  market,
  selectedSectorParam,
}: {
  heatmap: HeatTile[];
  market: LoadState<MarketDataOverview | null>;
  selectedSectorParam?: string | null;
}) {
  const heatmapSource = market.data?.marketContext.source === "finmind:official-daily" ? "FinMind 官方日資料" : "正式行情";
  const updatedAt = market.data?.marketContext.breadth?.updatedAt ?? market.data?.generatedAt ?? null;
  return (
    <Panel
      eyebrow="HEATMAP"
      title="台股產業熱力圖"
      sub="依產業查看代表股表現"
      right={<div className="tac-heat-legend"><span>產業切換</span><span>真實資料</span></div>}
    >
      <IndustryHeatmap
        heatmap={heatmap}
        initialSector={selectedSectorParam}
        updatedAt={updatedAt}
        sourceLabel={heatmapSource}
        marketState={stateFromLoad(market)}
        reason={market.state === "BLOCKED" ? market.reason : undefined}
      />
    </Panel>
  );
}

function RealtimeHeatmapPanel({
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
  const hasCore = coreHeatmap.length > 0;
  const activeMode = heatmapMode === "all" ? "all" : "core";
  const displayHeatmap = hasCore ? coreHeatmap : heatmap;
  const coreLastTs = loadStateData(realtimeMarket)?.kgiCoreHeatmap?.updatedAt ?? null;
  const sourceLabel = activeMode === "core"
    ? (hasCore ? "即時" : coreLastTs ? `核心 · 約 1 分鐘前最後一筆` : "核心 · 連線維護中")
    : `全市場 · ${closeLabel(loadStateData(realtimeMarket)?.twseOverview?.taiex?.ts)}`;
  const updatedAt = activeMode === "core"
    ? (loadStateData(realtimeMarket)?.kgiCoreHeatmap?.updatedAt ?? market.data?.marketContext.breadth?.updatedAt ?? market.data?.generatedAt ?? null)
    : (loadStateData(realtimeMarket)?.twseOverview?.taiex?.ts ?? null);

  return (
    <Panel
      eyebrow="HEATMAP"
      title="台股市場熱力圖"
      sub="核心觀察與全市場收盤視角分開呈現"
      right={<div className="tac-heat-legend"><span>{sourceLabel}</span></div>}
    >
      <div className="tac-heat-mode-tabs" aria-label="熱力圖切換">
        <Link className={activeMode === "core" ? "is-active" : ""} href="/">核心熱力圖</Link>
        <Link className={activeMode === "all" ? "is-active" : ""} href="/?heatmap=all">全市場熱力圖</Link>
      </div>
      {activeMode === "all" ? (
        <MarketWideHeatmap
          rows={fullMarketRows}
          updatedAt={updatedAt}
          sourceLabel={sourceLabel}
          marketState={fullMarketRows.length > 0 ? "LIVE" : stateFromLoad(realtimeMarket)}
          reason={realtimeMarket.state === "BLOCKED" ? realtimeMarket.reason : undefined}
        />
      ) : (
        <IndustryHeatmap
          heatmap={displayHeatmap}
          initialSector={selectedSectorParam}
          updatedAt={updatedAt}
          sourceLabel={sourceLabel}
          marketState={hasCore ? "LIVE" : stateFromLoad(market)}
          reason={!hasCore && market.state === "BLOCKED" ? market.reason : undefined}
        />
      )}
    </Panel>
  );
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
        <span>即時連線維護中，目前顯示昨日收盤</span>
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
          return (
            <div
              className={`tac-market-wide-cell ${tone}`}
              key={row.industry}
              style={{ "--cell-grow": String(size), "--heat": String(Math.min(1, Math.abs(pct) / 3)) } as CSSProperties}
              title={`${row.industry}\n漲 ${row.gainerCount} / 平 ${row.flatCount} / 跌 ${row.loserCount}\n均幅 ${formatPercent(pct)}`}
            >
              <b>{row.industry}</b>
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

function HeatTileView({ tile }: { tile: HeatTileLayout }) {
  const pct = tile.pct ?? 0;
  const tone = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const abs = Math.min(1, Math.abs(pct) / 3);
  const labelMode = tile.labelMode;
  const style = {
    "--heat": String(0.22 + abs * 0.52),
    "--weight": String(Math.max(1, Math.min(8, tile.weight))),
    left: `${tile.x}%`,
    top: `${tile.y}%`,
    width: `${tile.w}%`,
    height: `${tile.h}%`,
  } as CSSProperties;
  if (tile.placeholder) {
    return (
      <div
        className={`tac-heat-tile placeholder ${labelMode}`}
        style={style}
      >
        <span>待資料</span>
        {labelMode === "full" && <small>{tile.name}</small>}
        {labelMode !== "micro" && <b>--</b>}
      </div>
    );
  }
  const title = [
    `${tile.symbol} ${tile.name}`,
    `日期 ${tile.date ?? "--"}`,
    `開 ${formatPrice(tile.open)}`,
    `高 ${formatPrice(tile.high)}`,
    `低 ${formatPrice(tile.low)}`,
    `收 ${formatPrice(tile.close ?? tile.price)}`,
    `漲跌 ${formatPercent(tile.pct)}`,
    `成交量 ${formatNumber(tile.volume)}`,
  ].join("\n");
  return (
    <Link
      className={`tac-heat-tile ${tone} ${labelMode}`}
      href={`/companies/${encodeURIComponent(tile.symbol)}`}
      style={style}
      title={title}
      aria-label={title.replace(/\n/g, "，")}
    >
      <span>{tile.symbol}</span>
      {labelMode === "full" && <small>{tile.name}</small>}
      {labelMode !== "micro" && <b>{formatPercent(tile.pct)}</b>}
    </Link>
  );
}

function MarketIntelPanel({ intel }: { intel: LoadState<MarketIntelDashboard> }) {
  const featured = intel.data.items[0] ?? null;
  const rows = intel.data.items.slice(featured ? 1 : 0, featured ? 7 : 6);
  const itemHref = (item: IntelItem) => item.url ?? (item.ticker === "MARKET" ? "/market-intel" : `/companies/${encodeURIComponent(item.ticker)}`);
  return (
    <Panel
      eyebrow="MARKET INTEL"
      title="重要公告與大盤新聞"
      sub={intel.state === "LIVE" ? "只顯示官方重大訊息、台股大盤或市場級新聞" : intel.reason}
      right={<StatusChip state={stateFromLoad(intel)} label={`${formatNumber(intel.data.items.length)} 筆`} />}
      className="tac-intel-panel"
    >
      {featured ? (
        <Link href={itemHref(featured)} className="tac-intel-feature">
          <span>{categoryLabel(featured.category)}</span>
          <strong>{intelTitleText(featured)}</strong>
          <small>{featured.ticker} · {featured.companyName} · {formatDate(featured.date)}</small>
        </Link>
      ) : (
        <div className="tac-empty-line">近 {ANNOUNCEMENT_DAYS} 天沒有可顯示的官方重大訊息。</div>
      )}
      <div className="tac-intel-list">
        {rows.map((item) => (
          <Link href={itemHref(item)} key={`${item.ticker}-${item.id}`}>
            <b>{item.ticker}</b>
            <span>{intelTitleText(item)}</span>
            <small>{formatDate(item.date)}</small>
            <em>{categoryLabel(item.category)}</em>
          </Link>
        ))}
      </div>
      <div className="tac-intel-foot">
        <span>篩選大盤 / 市場級內容</span>
        <span>{intel.data.failures > 0 ? `${intel.data.failures} 路徑查詢失敗` : "來源路徑可讀"}</span>
      </div>
    </Panel>
  );
}

function DailyBriefPanel({
  market,
  intel,
  brief,
}: {
  market: LoadState<MarketDataOverview | null>;
  intel: LoadState<MarketIntelDashboard>;
  brief: LoadState<DailyBriefDashboard>;
}) {
  const panelState = brief.data.state === "PUBLISHED" ? "LIVE" : brief.data.state === "AWAITING_REVIEW" ? "REVIEW" : stateFromLoad(brief);
  const displayBrief = brief.data.todayBrief ?? brief.data.latest;
  const previewSections = displayBrief?.sections.slice(0, 3) ?? [];
  const steps = [
    { id: "01", name: "市場資料", state: stateFromLoad(market), note: market.state === "LIVE" ? "盤勢與公司資料" : "等待行情回補" },
    { id: "02", name: "重大訊息", state: stateFromLoad(intel), note: intel.state === "LIVE" ? `${intel.data.items.length} 筆官方訊息` : "公告與新聞缺口分開標示" },
    { id: "03", name: "草稿", state: brief.data.draftCount > 0 || displayBrief ? "LIVE" as DashboardState : "EMPTY" as DashboardState, note: `${brief.data.draftCount} 份待確認` },
    { id: "04", name: "確認", state: brief.data.state === "AWAITING_REVIEW" ? "REVIEW" as DashboardState : brief.data.state === "PUBLISHED" ? "LIVE" as DashboardState : "EMPTY" as DashboardState, note: brief.data.state === "PUBLISHED" ? "已通過" : "等待確認" },
    { id: "05", name: "發布", state: brief.data.state === "PUBLISHED" ? "LIVE" as DashboardState : "EMPTY" as DashboardState, note: brief.data.latestDate ?? "今日未發布" },
  ];
  return (
    <Panel eyebrow="AI BRIEF" title="AI 每日簡報" sub="只展示已發布或待確認狀態；不把摘要偽裝成買賣建議" right={<StatusChip state={panelState} />}>
      <div className="tac-openalice-top">
        <Metric label="今日狀態" value={brief.data.state === "PUBLISHED" ? "已發布" : brief.data.state === "AWAITING_REVIEW" ? "待確認" : "待產生"} sub={brief.data.today} tone={panelState === "LIVE" ? "live" : panelState === "REVIEW" ? "review" : "empty"} />
        <Metric label="待確認草稿" value={brief.data.draftCount} sub="簡報確認佇列" tone={brief.data.draftCount > 0 ? "review" : "empty"} />
        <Metric label="最新日期" value={brief.data.latestDate ?? "--"} sub="已發布簡報日期" tone={brief.data.latestDate ? "live" : "empty"} />
        <Metric label="摘要段落" value={formatNumber(displayBrief?.sections.length)} sub="遮蔽交易建議字詞" tone={displayBrief ? "live" : "empty"} />
      </div>
      <div className="tac-pipeline">
        {steps.map((step) => (
          <div className={tacticalStatus(step.state)} key={step.id}>
            <span>{step.id}</span>
            <b>{step.name}</b>
            <small>{step.note}</small>
          </div>
        ))}
      </div>
      {previewSections.length > 0 ? (
        <div className="tac-brief-preview">
          {previewSections.map((section: DailyBrief["sections"][number], index: number) => (
            <article key={`${section.heading}:${index}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{cleanExternalHeadline(section.heading)}</h3>
              <p>{safeBriefText(section.body)}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="tac-warning">{brief.data.reason ?? "今日 AI 簡報尚未發布。"}</div>
      )}
    </Panel>
  );
}

function DataReadinessPanel({ sources }: { sources: SourceTile[] }) {
  return (
    <Panel eyebrow="DATA READINESS" title="資料可用度" sub="放在底部作為缺口說明，不當成首頁主角" right={<span>{sources.length} 項</span>} className="tac-source-panel">
      <div className="tac-source-table">
        {sources.map((source) => (
          <Link href={source.href} key={source.key}>
            <b>{source.name}</b>
            <span>{source.desc}</span>
            <Sparkline points={makeSpark(source.key, source.state)} state={source.state} />
            <small>{formatDateTime(source.updatedAt)}</small>
            <StatusChip state={source.state} compact />
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function PaperPanel({
  paper,
  broker,
}: {
  paper: LoadState<PaperHealthState | null>;
  broker: LoadState<BrokerAccessDashboard | null>;
}) {
  const data = paper.data;
  const brokerReady = Boolean(broker.data?.formalReadOnlyConnected);
  const steps = [
    { id: "1", name: "正式環境", desc: "券商只讀登入", state: brokerReady ? "LIVE" : stateFromLoad(broker), count: brokerReady ? 1 : 0, note: brokerReady ? "已登入" : "等待回報" },
    { id: "2", name: "公司頁預覽", desc: "委託前檢查", state: data?.previewReady ? "LIVE" : stateFromLoad(paper), count: data?.previewReady ? 1 : 0, note: data?.previewReady ? "可做風控預覽" : "等待預覽" },
    { id: "3", name: "風控檢查", desc: "限制與守門", state: data?.gate.gateOpen ? "LIVE" : "BLOCKED", count: data?.gate.gateOpen ? 1 : 0, note: data?.gate.gateOpen ? "可檢查" : "目前關閉" },
    { id: "4", name: "委託草稿", desc: "只做紙上流程", state: data?.previewReady ? "LIVE" : "EMPTY", count: data?.queueDepth ?? 0, note: `${formatNumber(data?.queueDepth)} 筆等待` },
    { id: "5", name: "紙上送出", desc: "紙上流程", state: data?.submitReady ? "DEGRADED" : "EMPTY", count: data?.submitReady ? 1 : 0, note: "需操作員確認" },
    { id: "6", name: "部位回寫", desc: "部位 / 成交", state: data?.fillsReady || data?.portfolioReady ? "LIVE" : "EMPTY", count: data?.lastFillTs ? 1 : 0, note: data?.lastFillTs ? formatDateTime(data.lastFillTs) : "--" },
  ] satisfies Array<{ id: string; name: string; desc: string; state: DashboardState; count: number; note: string }>;
  const panelState: DashboardState = brokerReady ? "LIVE" : data?.previewReady ? "LIVE" : stateFromLoad(paper);
  const brokerNote = broker.data?.note ?? (broker.state === "LIVE" ? "等待只讀狀態回報" : broker.reason);
  return (
    <Panel eyebrow="TRADE FLOW" title="交易環境與紙上流程" sub="正式環境只讀確認；首頁仍只做紙上預覽與風控驗證" right={<StatusChip state={panelState} label={brokerReady ? "正式只讀" : "紙上"} />}>
      <div className="tac-paper-steps">
        {steps.map((step) => (
          <div className={tacticalStatus(step.state)} key={step.id}>
            <span>{step.id}</span>
            <b>{step.name}</b>
            <small>{step.desc}</small>
            <strong>{formatNumber(step.count)}</strong>
            <em>{step.note}</em>
          </div>
        ))}
      </div>
      <div className="tac-paper-bottom">
        <div><span>正式券商</span><b>{brokerReady ? "可登入" : "未連線"}</b><small>{brokerNote}</small></div>
        <div><span>測試資金</span><b>NT$ {formatNumber(PAPER_PREVIEW_CAPITAL_TWD)}</b><small>紙上預覽使用明確股數 / 張數。</small></div>
        <div><span>單位提示</span><b>1 張 = 1,000 股</b><small>零股以實際股數計算。</small></div>
        <div className="blocked"><span>安全狀態</span><b>下單入口關閉</b><small>首頁不送出真實委託。</small></div>
      </div>
    </Panel>
  );
}

function StrategyPanel({ ideas }: { ideas: LoadState<StrategyIdeasData | null> }) {
  const rows = ideas.data?.items.slice(0, 4) ?? [];
  return (
    <Panel eyebrow="STRATEGY" title="策略候選" sub="候選研究，不等於交易建議" right={<StatusChip state={ideas.state === "LIVE" ? "LIVE" : stateFromLoad(ideas)} />}>
      {rows.length > 0 ? (
        <div className="tac-strategy-table">
          <div><span>代號</span><span>名稱</span><span>立場</span><span>信心</span><span>閘門</span></div>
          {rows.map((idea: StrategyIdeaItem) => (
            <Link href={`/companies/${encodeURIComponent(idea.symbol)}#paper-order`} key={`${idea.companyId}-${idea.symbol}`}>
              <b>{idea.symbol}</b>
              <span>{idea.companyName}</span>
              <small>{directionLabel(idea.direction)}</small>
              <small>{Math.round(idea.confidence * 100)}%</small>
              <StatusChip state={idea.marketData.decision === "allow" ? "LIVE" : idea.marketData.decision === "review" ? "REVIEW" : "BLOCKED"} label={decisionLabel(idea.marketData.decision)} compact />
            </Link>
          ))}
        </div>
      ) : (
        <div className="tac-empty-line">策略候選目前沒有正式資料；不顯示假策略或假績效。</div>
      )}
    </Panel>
  );
}

function WorkflowPanel({
  market,
  intel,
  brief,
  paper,
}: {
  market: LoadState<MarketDataOverview | null>;
  intel: LoadState<MarketIntelDashboard>;
  brief: LoadState<DailyBriefDashboard>;
  paper: LoadState<PaperHealthState | null>;
}) {
  const items = [
    { id: "1", title: "看盤勢總覽", desc: market.state === "LIVE" ? "報價、排行與熱力圖已回傳。" : "行情不足時只標示缺口，不顯示假價格。", href: "/companies", state: stateFromLoad(market), cta: "查看公司池" },
    { id: "2", title: "讀重大訊息", desc: intel.data.items.length > 0 ? `今日工作流有 ${intel.data.items.length} 筆官方訊息。` : "目前沒有可顯示的官方重大訊息。", href: "/market-intel", state: stateFromLoad(intel), cta: "打開情報" },
    { id: "3", title: "確認 AI 簡報", desc: brief.data.state === "PUBLISHED" ? "今日正式簡報已發布。" : "等待整理、確認或發布。", href: "/briefs", state: brief.data.state === "PUBLISHED" ? "LIVE" as DashboardState : brief.data.state === "AWAITING_REVIEW" ? "REVIEW" as DashboardState : "EMPTY" as DashboardState, cta: "查看簡報" },
    { id: "4", title: "紙上交易預覽", desc: paper.data?.previewReady ? "可進公司頁做風控預覽。" : "等待紙上預覽開啟。", href: "/companies/2330#paper-order", state: paper.data?.previewReady ? "LIVE" as DashboardState : stateFromLoad(paper), cta: "開啟預覽" },
    { id: "5", title: "部位與成交回顧", desc: "只看紙上部位與成交紀錄，不連真實券商委託。", href: "/portfolio", state: paper.data?.portfolioReady || paper.data?.fillsReady ? "LIVE" as DashboardState : "EMPTY" as DashboardState, cta: "查看部位" },
  ];
  return (
    <Panel eyebrow="WORKFLOW" title="今日交易工作流" right={<span>{items.length} steps</span>}>
      <div className="tac-workflow">
        {items.map((item) => (
          <Link href={item.href} key={item.id}>
            <span>{item.id}</span>
            <div><b>{item.title}</b><small>{item.desc}</small></div>
            <StatusChip state={item.state} compact />
            <strong>{item.cta}</strong>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function DataGapPanel({ sources }: { sources: SourceTile[] }) {
  const gaps = [
    ...sources.filter((source) => source.state !== "LIVE").slice(0, 3).map((source) => ({
      name: source.name,
      why: source.detail,
      next: `查看 ${source.name} 詳細頁`,
      href: source.href,
      state: source.state,
    })),
    {
      name: "真實券商下單",
      why: "目前首頁只允許研究、簡報、風控與紙上交易流程。",
      next: "維持關閉，不在首頁提供真實委託入口",
      href: "/portfolio",
      state: "BLOCKED" as DashboardState,
    },
  ].slice(0, 4);
  return (
    <Panel eyebrow="DATA GAPS" title="資料缺口與安全邊界" right={<span>{gaps.length} 項</span>}>
      <div className="tac-blocked">
        {gaps.map((item) => (
          <Link href={item.href} key={`${item.name}-${item.state}`}>
            <div><b>{item.name}</b><StatusChip state={item.state} compact /></div>
            <p>原因：{item.why}</p>
            <small>下一步：{item.next}</small>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

// ── Dashboard skeleton shown immediately while DashboardContent streams ─────
// Inline <style> avoids touching globals.css (Codex own).
function DashboardSkeleton() {
  const pulse = "@keyframes _tac-pulse { 0%,100%{opacity:.18} 50%{opacity:.38} }";
  const skelCss = "._tac-skel { background:rgba(0,255,180,.07); border:1px solid rgba(0,255,180,.13); border-radius:2px; animation:_tac-pulse 1.6s ease-in-out infinite; }";
  const rowCss = "._tac-skel-row { display:flex; gap:8px; margin-bottom:8px; }";
  return (
    <>
      <style>{pulse + " " + skelCss + " " + rowCss}</style>
      <div className="tactical-dashboard">
        <div className="tac-scanline" />
        <aside style={{ width:200, minWidth:200, padding:"16px 12px", borderRight:"1px solid rgba(0,255,180,.15)", display:"flex", flexDirection:"column", gap:8 }}>
          <div className="_tac-skel" style={{ height:20, width:"80%" }} />
          <div className="_tac-skel" style={{ height:14, width:"60%" }} />
          <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:6 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="_tac-skel" style={{ height:12, width:`${55 + (i % 3) * 15}%` }} />
            ))}
          </div>
        </aside>
        <main className="tac-main" style={{ flex:1, overflow:"hidden" }}>
          <div className="_tac-skel" style={{ height:28, margin:"0 0 8px", borderRadius:0 }} />
          <div className="tac-content">
            <div className="_tac-skel-row">
              <div className="_tac-skel" style={{ height:36, flex:1 }} />
              <div className="_tac-skel" style={{ height:36, width:120 }} />
            </div>
            <div className="_tac-skel" style={{ height:40, marginBottom:8 }} />
            <div className="_tac-skel-row" style={{ height:220 }}>
              <div className="_tac-skel" style={{ flex:2 }} />
              <div className="_tac-skel" style={{ flex:1 }} />
            </div>
            <div className="_tac-skel-row" style={{ height:180 }}>
              <div className="_tac-skel" style={{ flex:3 }} />
              <div className="_tac-skel" style={{ flex:1 }} />
            </div>
            <div className="_tac-skel-row" style={{ height:160 }}>
              <div className="_tac-skel" style={{ flex:1 }} />
              <div className="_tac-skel" style={{ flex:1 }} />
            </div>
            <div className="_tac-skel-row" style={{ height:140 }}>
              <div className="_tac-skel" style={{ flex:1 }} />
              <div className="_tac-skel" style={{ flex:1 }} />
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

// ── All data fetching lives here — streamed behind Suspense ──────────────────
async function DashboardContent({
  selectedSectorParam,
  heatmapMode,
}: {
  selectedSectorParam: string | null;
  heatmapMode: "core" | "all";
}) {
  const now = nowIso();

  // ── Timeout-budgeted parallel fetches ──────────────────────────────────────
  // Each fetch is wrapped with timedFetch(label, budgetMs, promise).
  // Budget:
  //   FETCH_SOFT_MS (3s) — most panels: market, ops, brief, paper, broker, ideas, runs
  //   FETCH_HARD_MS (5s) — heavy queries: finmind (multi-dataset), intel (TWSE crawl), snapshot
  // If a fetch exceeds budget, timedFetch returns { _timeout: "..." } sentinel.
  // Result handler maps sentinel -> BLOCKED with real reason (never fake-green).
  //
  // Telemetry: grep prod logs for "[homepage-fetch]" to find culprit panels.
  const fetchT0 = Date.now();

  const [
    finmindResult,
    realtimeMarketResult,
    marketResult,
    opsResult,
    briefResult,
    paperResult,
    brokerResult,
    ideasResult,
    runsResult,
    intelResult,
    snapshotResult,
  ] = await Promise.allSettled([
    timedFetch("finmind", FETCH_HARD_MS, loadFinMindDashboard()),
    timedFetch("main_market_feed", FETCH_SOFT_MS, loadRealtimeMarketDashboard()),
    timedFetch("market", FETCH_SOFT_MS, load(
      "Market data overview",
      null,
      async () => (await getMarketDataOverview({ includeStale: true, topLimit: 20 })).data,
      (value) => !hasMarketOverviewData(value),
      "市場資料總覽目前沒有可用正式資料。",
    )),
    timedFetch("ops", FETCH_SOFT_MS, load(
      "OpenAlice / Ops snapshot",
      null,
      async () => (await getOpsSnapshot({ auditHours: 24, recentLimit: 6 })).data,
      (value) => value === null,
      "OpenAlice 營運快照目前沒有回傳資料。",
    )),
    timedFetch("brief", FETCH_SOFT_MS, loadDailyBriefDashboard()),
    timedFetch("paper", FETCH_SOFT_MS, loadPaperHealthState()),
    timedFetch("broker", FETCH_SOFT_MS, loadBrokerAccessState()),
    timedFetch("ideas", FETCH_SOFT_MS, load(
      "Strategy ideas",
      null,
      async () => (await getStrategyIdeas({ limit: 8, includeBlocked: true, decisionMode: "paper", sort: "score" })).data,
      (value) => value === null || value.items.length === 0,
      "策略想法目前沒有可用候選。",
    )),
    timedFetch("runs", FETCH_SOFT_MS, load(
      "Strategy runs",
      null,
      async () => (await listStrategyRuns({ limit: 6, sort: "created_at" })).data,
      (value) => value === null || value.items.length === 0,
      "策略批次目前沒有可用紀錄。",
    )),
    timedFetch("intel", FETCH_HARD_MS, loadMarketIntelDashboard()),
    timedFetch("snapshot", FETCH_HARD_MS, getDashboardSnapshot()),
  ]);

  const totalElapsed = Date.now() - fetchT0;
  console.warn(`[homepage-fetch] ALL_PANELS total=${totalElapsed}ms`);

  const updatedAt = nowIso();
  const emptyBrief: DailyBriefDashboard = {
    today: todayTaipeiDate(),
    state: "BLOCKED",
    latestDate: null,
    latest: null,
    todayBrief: null,
    draftCount: 0,
    reason: "載入失敗",
  };
  const emptyIntel: MarketIntelDashboard = { items: [], selected: [], failures: 0 };

  // ── Result unwrap: detect timeout sentinel -> BLOCKED with real reason ───────
  // isTimeoutSentinel() guards against fake-green: timeout is never silently swallowed.
  const finmind = (() => {
    if (finmindResult.status === "rejected") return { state: "BLOCKED" as const, data: null, updatedAt, source: "FinMind", reason: "載入失敗" };
    const v = finmindResult.value;
    if (isTimeoutSentinel(v)) return { state: "BLOCKED" as const, data: null, updatedAt, source: "FinMind", reason: `資料延遲（${v._timeout}）` };
    return v;
  })();
  const realtimeMarket = (() => {
    if (realtimeMarketResult.status === "rejected") return { state: "BLOCKED" as const, data: null, updatedAt, source: "Main market feed", reason: "即時連線維護中，目前顯示昨日收盤" };
    const v = realtimeMarketResult.value;
    if (isTimeoutSentinel(v)) return { state: "BLOCKED" as const, data: null, updatedAt, source: "Main market feed", reason: `資料更新中：${v._timeout}` };
    return v;
  })();
  const market = (() => {
    if (marketResult.status === "rejected") return { state: "BLOCKED" as const, data: null, updatedAt, source: "Market data overview", reason: "載入失敗" };
    const v = marketResult.value;
    if (isTimeoutSentinel(v)) return { state: "BLOCKED" as const, data: null, updatedAt, source: "Market data overview", reason: `資料延遲（${v._timeout}）` };
    return v;
  })();
  const ops = (() => {
    if (opsResult.status === "rejected") return { state: "BLOCKED" as const, data: null, updatedAt, source: "OpenAlice / Ops snapshot", reason: "載入失敗" };
    const v = opsResult.value;
    if (isTimeoutSentinel(v)) return { state: "BLOCKED" as const, data: null, updatedAt, source: "OpenAlice / Ops snapshot", reason: `資料延遲（${v._timeout}）` };
    return v;
  })();
  const brief = (() => {
    if (briefResult.status === "rejected") return { state: "BLOCKED" as const, data: emptyBrief, updatedAt, source: "OpenAlice / Daily Brief", reason: "載入失敗" };
    const v = briefResult.value;
    if (isTimeoutSentinel(v)) return { state: "BLOCKED" as const, data: emptyBrief, updatedAt, source: "OpenAlice / Daily Brief", reason: `資料延遲（${v._timeout}）` };
    return v;
  })();
  const paper = (() => {
    if (paperResult.status === "rejected") return { state: "BLOCKED" as const, data: null, updatedAt, source: "Paper Health", reason: "載入失敗" };
    const v = paperResult.value;
    if (isTimeoutSentinel(v)) return { state: "BLOCKED" as const, data: null, updatedAt, source: "Paper Health", reason: `資料延遲（${v._timeout}）` };
    return v;
  })();
  const broker = (() => {
    if (brokerResult.status === "rejected") return { state: "EMPTY" as const, data: null, updatedAt, source: "正式券商只讀狀態", reason: "載入失敗" };
    const v = brokerResult.value;
    if (isTimeoutSentinel(v)) return { state: "EMPTY" as const, data: null, updatedAt, source: "正式券商只讀狀態", reason: `資料延遲（${v._timeout}）` };
    return v;
  })();
  const ideas = (() => {
    if (ideasResult.status === "rejected") return { state: "BLOCKED" as const, data: null, updatedAt, source: "Strategy ideas", reason: "載入失敗" };
    const v = ideasResult.value;
    if (isTimeoutSentinel(v)) return { state: "BLOCKED" as const, data: null, updatedAt, source: "Strategy ideas", reason: `資料延遲（${v._timeout}）` };
    return v;
  })();
  const runs = (() => {
    if (runsResult.status === "rejected") return { state: "BLOCKED" as const, data: null, updatedAt, source: "Strategy runs", reason: "載入失敗" };
    const v = runsResult.value;
    if (isTimeoutSentinel(v)) return { state: "BLOCKED" as const, data: null, updatedAt, source: "Strategy runs", reason: `資料延遲（${v._timeout}）` };
    return v;
  })();
  const intel = (() => {
    if (intelResult.status === "rejected") return { state: "BLOCKED" as const, data: emptyIntel, updatedAt, source: "公開資訊重大訊息", reason: "載入失敗" };
    const v = intelResult.value;
    if (isTimeoutSentinel(v)) return { state: "BLOCKED" as const, data: emptyIntel, updatedAt, source: "公開資訊重大訊息", reason: `資料延遲（${v._timeout}）` };
    return v;
  })();
  const snapshot: DashboardSnapshot | null = (() => {
    if (snapshotResult.status === "rejected") return null;
    const v = snapshotResult.value;
    if (isTimeoutSentinel(v)) {
      console.warn("[homepage-fetch] snapshot timeout -- dashboard renders without aggregated panel");
      return null;
    }
    return v as DashboardSnapshot | null;
  })();

  if (snapshot) {
    console.info(
      `[dashboard] snapshot cache_hit=${snapshot._cache_hit} as_of=${snapshot.as_of} stale=${snapshot.stale_panels.join(",") || "none"}`
    );
  }

  const sources = buildSources({ finmind, market, ops, brief, paper, ideas, runs, intel });
  const coreHeatmap = buildKgiCoreHeatmap(realtimeMarket);
  const realHeatmap = coreHeatmap.length > 0 ? coreHeatmap : buildHeatmap(market);
  const heatmap = realHeatmap;
  const quotes = buildTapeQuotes(realHeatmap, market);
  const liveCount = sources.filter((source) => source.state === "LIVE").length;
  const alertCount = sources.length - liveCount;

  return (
    <div className="tactical-dashboard">
      <div className="tac-scanline" />
      <TacticalSidebar liveCount={liveCount} alertCount={alertCount} />
      <main className="tac-main">
        <Ticker quotes={quotes} market={market} />
        <div className="tac-content">
          <TopCommandBar now={now} market={market} />
          <AgendaStrip market={market} intel={intel} brief={brief} now={now} />
          <section className="tac-hero-grid">
            <HeroPanel heatmap={heatmap} market={market} realtimeMarket={realtimeMarket} paper={paper} broker={broker} brief={brief} intel={intel} now={now} />
            <MarketMoversPanel market={market} />
          </section>
          <section className="tac-two-grid tac-fresh-heat">
            <RealtimeHeatmapPanel heatmap={realHeatmap} market={market} realtimeMarket={realtimeMarket} selectedSectorParam={selectedSectorParam} heatmapMode={heatmapMode} />
            <FreshnessPanel sources={sources} />
          </section>
          <section className="tac-two-grid">
            <MarketIntelPanel intel={intel} />
            <DailyBriefPanel market={market} intel={intel} brief={brief} />
          </section>
          <section className="tac-two-grid tac-paper-grid">
            <PaperPanel paper={paper} broker={broker} />
            <StrategyPanel ideas={ideas} />
          </section>
          <section className="tac-two-grid tac-bottom-grid">
            <WorkflowPanel market={market} intel={intel} brief={brief} paper={paper} />
            <DataReadinessPanel sources={sources} />
          </section>
        </div>
      </main>
    </div>
  );
}

// ── Page entry point — sync shell + streamed data content ────────────────────
export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ sector?: string; heatmap?: string }>;
}) {
  const params = await searchParams;
  const selectedSectorParam = params?.sector ?? null;
  const heatmapMode = params?.heatmap === "all" ? "all" : "core";

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent selectedSectorParam={selectedSectorParam} heatmapMode={heatmapMode} />
    </Suspense>
  );
}
