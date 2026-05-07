import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import {
  getBriefs,
  getCompanies,
  getCompanyAnnouncements,
  getContentDrafts,
  getFinMindDiagnostics,
  getFinMindStatus,
  getMarketDataOverview,
  getOpsSnapshot,
  getStrategyIdeas,
  listStrategyRuns,
  type CompanyAnnouncement,
  type FinMindDatasetStatus,
  type FinMindDiagnosticsStatus,
  type FinMindSourceStatus,
  type MarketDataOverview,
  type MarketDataOverviewLeader,
  type OpsSnapshotData,
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
type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];

type IntelItem = CompanyAnnouncement & {
  companyId: string;
  ticker: string;
  companyName: string;
};

type MarketIntelDashboard = {
  items: IntelItem[];
  selected: CompanyRow[];
  failures: number;
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

type HeatTile = {
  symbol: string;
  name: string;
  pct: number | null;
  weight: number;
  source: string;
  price: number | null;
  readiness?: "ready" | "degraded" | "blocked";
  freshnessStatus?: "fresh" | "stale" | "missing";
  placeholder?: boolean;
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
const MAX_INTEL_COMPANIES = 16;
const MAX_INTEL_ROWS = 12;

const EMPTY_TAPE_QUOTES: TapeQuote[] = [
  { sym: "TAIEX", name: "加權指數", price: null, chg: null, pct: null, placeholder: true },
  { sym: "TPEX", name: "櫃買指數", price: null, chg: null, pct: null, placeholder: true },
  { sym: "上漲", name: "上漲家數", price: null, chg: null, pct: null, unit: "家", flow: true, placeholder: true },
  { sym: "下跌", name: "下跌家數", price: null, chg: null, pct: null, unit: "家", flow: true, placeholder: true },
  { sym: "排行", name: "盤中排行", price: null, chg: null, pct: null, placeholder: true },
  { sym: "熱力圖", name: "台股公司池", price: null, chg: null, pct: null, placeholder: true },
  { sym: "重大訊息", name: "官方資訊流", price: null, chg: null, pct: null, placeholder: true },
  { sym: "Paper", name: "紙上交易", price: null, chg: null, pct: null, placeholder: true },
];

const EMPTY_HEATMAP: HeatTile[] = Array.from({ length: 12 }, (_, index) => ({
  symbol: `EMPTY-${String(index + 1).padStart(2, "0")}`,
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
    EMPTY: "無資料",
    REVIEW: "AI 審核中",
    BLOCKED: "阻擋",
    DEGRADED: "降級",
  };
  return labels[state];
}

function statusCode(status: TacticalStatus) {
  const labels: Record<TacticalStatus, string> = {
    live: "LIVE",
    stale: "STALE",
    empty: "EMPTY",
    review: "AI_REVIEWING",
    blocked: "BLOCKED",
    degraded: "DEGRADED",
  };
  return labels[status];
}

function statusZh(status: TacticalStatus) {
  const labels: Record<TacticalStatus, string> = {
    live: "正常",
    stale: "過期",
    empty: "無資料",
    review: "AI 審核中",
    blocked: "阻擋",
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
        reason: "今天尚未發布每日簡報，也沒有等待審核的今日草稿。",
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

async function loadMarketIntelDashboard(ideas: LoadState<StrategyIdeasData | null>): Promise<LoadState<MarketIntelDashboard>> {
  return load<MarketIntelDashboard>(
    "TWSE OpenAPI 重大訊息",
    { items: [], selected: [], failures: 0 },
    async () => {
      const companies = (await getCompanies()).data ?? [];
      if (companies.length === 0) {
        return { items: [], selected: [], failures: 0 };
      }

      const byId = new Map(companies.map((company) => [company.id, company]));
      const ideaCompanies = (ideas.data?.items ?? [])
        .map((idea) => byId.get(idea.companyId))
        .filter((company): company is CompanyRow => Boolean(company));
      const selected = [...ideaCompanies, ...companies]
        .filter((company, index, all) => all.findIndex((item) => item.id === company.id) === index)
        .slice(0, MAX_INTEL_COMPANIES);

      const settled = await Promise.allSettled(
        selected.map(async (company) => {
          const response = await getCompanyAnnouncements(company.id, { days: ANNOUNCEMENT_DAYS });
          return (response.data ?? []).map((item) => ({
            ...item,
            companyId: company.id,
            ticker: company.ticker,
            companyName: company.name,
          }));
        }),
      );

      const failures = settled.filter((result) => result.status === "rejected").length;
      if (selected.length > 0 && failures === settled.length) {
        throw new Error("重大訊息 API 目前全部查詢失敗。");
      }

      const items = settled
        .flatMap((result) => result.status === "fulfilled" ? result.value : [])
        .sort((left, right) => right.date.localeCompare(left.date) || left.ticker.localeCompare(right.ticker))
        .slice(0, MAX_INTEL_ROWS);

      return { items, selected, failures };
    },
    (value) => value.items.length === 0,
    `選定公司近 ${ANNOUNCEMENT_DAYS} 天沒有重大訊息。`,
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
      desc: "候選觀察 / gate reason",
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
      note: brief.data.state === "PUBLISHED" ? "今日已發布" : brief.data.state === "AWAITING_REVIEW" ? `${brief.data.draftCount} 草稿待審` : "待產生",
      detail: brief.data.reason ?? "每日簡報只顯示已發布或待審狀態，不偽裝成正式新聞。",
      href: "/briefs",
    },
    {
      key: "paper",
      name: "模擬交易",
      short: "Paper",
      desc: "預覽 / 風控 / 部位",
      state: paperState,
      updatedAt: paper.data?.lastFillTs ?? paper.updatedAt,
      note: paper.data?.previewReady ? "可預覽" : "待開啟",
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
    return contextRows.slice(0, 23).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      pct: typeof item.changePct === "number" ? item.changePct : null,
      weight: item.weight,
      source: item.source,
      price: typeof item.last === "number" ? item.last : null,
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
    .slice(0, 23)
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

function buildTapeQuotes(heatmap: HeatTile[], market: LoadState<MarketDataOverview | null>): TapeQuote[] {
  const index = market.data?.marketContext?.index;
  const breadth = market.data?.marketContext?.breadth;
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
  if (decision === "review") return "待審";
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
        {quote.placeholder && <em>EMPTY</em>}
      </span>
    );
  }
  return (
    <span className="tac-tape-item">
      <b>{quote.sym}</b>
      <span>{quote.name}</span>
      <strong>{formatPrice(quote.price)}</strong>
      <strong className={tone}>{change > 0 ? "+" : ""}{formatPrice(quote.chg)} ({formatPercent(quote.pct)})</strong>
      {quote.placeholder && <em>EMPTY</em>}
    </span>
  );
}

function TacticalSidebar({ liveCount, alertCount }: { liveCount: number; alertCount: number }) {
  const nav = [
    { href: "/", title: "戰情台總覽", sub: "盤勢與任務", code: "01", active: true },
    { href: "/market-intel", title: "市場情報", sub: "重大訊息", code: "02" },
    { href: "/companies", title: "公司板", sub: "台股公司池", code: "03" },
    { href: "/ideas", title: "策略想法", sub: "候選清單", code: "04" },
    { href: "/runs", title: "策略批次", sub: "批次紀錄", code: "05" },
    { href: "/portfolio", title: "模擬交易室", sub: "委託與部位", code: "06" },
    { href: "/signals", title: "訊號證據", sub: "訊號與依據", code: "07" },
    { href: "/plans", title: "交易計畫", sub: "計畫註記", code: "08" },
    { href: "/themes", title: "主題板", sub: "產業主題", code: "09" },
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
        <div className="tac-mode"><span />模擬模式 / 風控守門</div>
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
          <b>{liveCount} LIVE / {alertCount} ALERT</b>
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
      <div className="tac-ticker-label"><span />LIVE FEED</div>
      <div className="tac-ticker-track-wrap">
        {!hasRealQuotes && (
          <span className="tac-demo-badge">
            市場資料 {market.state} · 等待後端真資料
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
        <span>盤勢總覽 · AI 簡報 · 模擬交易工作流</span>
        <b>D+0 · 觀察日</b>
      </div>
      <div>
        <PulseBars state={market.state === "LIVE" ? "LIVE" : "EMPTY"} />
        <span suppressHydrationWarning>{formatDateTime(now)} 台北</span>
        <button type="button">搜尋 <kbd>⌘ K</kbd></button>
        <StatusChip state={market.state === "LIVE" ? "LIVE" : "EMPTY"} label="真實資料" />
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
  paper,
  brief,
  intel,
  now,
}: {
  heatmap: HeatTile[];
  market: LoadState<MarketDataOverview | null>;
  paper: LoadState<PaperHealthState | null>;
  brief: LoadState<DailyBriefDashboard>;
  intel: LoadState<MarketIntelDashboard>;
  now: string;
}) {
  const index = market.data?.marketContext?.index;
  const breadth = market.data?.marketContext?.breadth;
  const actualHeatmap = heatmap.filter((item) => !item.placeholder);
  const indexReady = Boolean(index && index.last !== null && index.state !== "EMPTY");
  const twii = indexReady && index ? {
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
  const marketReady = market.state === "LIVE" && indexReady && actualHeatmap.length > 0;
  const fallbackUp = actualHeatmap.filter((item) => (item.pct ?? 0) > 0).length;
  const fallbackDown = actualHeatmap.filter((item) => (item.pct ?? 0) < 0).length;
  const fallbackFlat = Math.max(0, actualHeatmap.length - fallbackUp - fallbackDown);
  const upCount = breadth && breadth.total > 0 ? breadth.up : fallbackUp;
  const downCount = breadth && breadth.total > 0 ? breadth.down : fallbackDown;
  const flatCount = breadth && breadth.total > 0 ? breadth.flat : fallbackFlat;
  const breadthTotal = breadth && breadth.total > 0 ? breadth.total : actualHeatmap.length;
  const downPct = breadthTotal ? Math.round((downCount / breadthTotal) * 1000) / 10 : 0;
  const briefState = brief.data.state === "PUBLISHED" ? "已發布" : brief.data.state === "AWAITING_REVIEW" ? "待審" : "待產生";
  const paperState = paper.data?.previewReady ? "可預覽" : "待開啟";
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
        {!indexReady && <span className="tac-demo-badge floating">大盤指數尚未接入</span>}
        <div>
          <div className="tac-index-title"><b>{twii.sym}</b><span>{twii.name}</span></div>
          <div className="tac-index-main">
            <strong>{formatPrice(twii.price)}</strong>
            <span className={(twii.chg ?? 0) > 0 ? "price-up" : (twii.chg ?? 0) < 0 ? "price-down" : ""}>
              {(twii.chg ?? 0) > 0 ? "▲" : (twii.chg ?? 0) < 0 ? "▼" : "—"} {formatPrice(twii.chg === null ? null : Math.abs(twii.chg))}
            </span>
            <span className={(twii.pct ?? 0) > 0 ? "price-up" : (twii.pct ?? 0) < 0 ? "price-down" : ""}>{formatPercent(twii.pct)}</span>
          </div>
          <IntradayChart points={makeSpark("twii", (twii.pct ?? 0) < 0 ? "BLOCKED" : indexReady ? "LIVE" : "EMPTY", 60)} />
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
        <Metric label="市場覆蓋" value={`${formatNumber(market.data?.quotes.fresh)} / ${formatNumber(market.data?.quotes.total)}`} sub={market.state === "LIVE" ? "可用報價 / 監看股票" : "市場資料未完整回傳"} tone={market.state === "LIVE" ? "live" : "empty"} />
        <Metric label="重大訊息" value={formatNumber(intel.data.items.length)} sub={`${formatNumber(intel.data.selected.length)} 檔公司 · ${ANNOUNCEMENT_DAYS} 天`} tone={intel.state === "LIVE" ? "live" : intel.state === "EMPTY" ? "empty" : "blocked"} />
        <Metric label="AI 簡報" value={briefState} sub={brief.data.latestDate ? `最新 ${brief.data.latestDate}` : "等待發布或審核"} tone={brief.data.state === "PUBLISHED" ? "live" : brief.data.state === "AWAITING_REVIEW" ? "review" : "empty"} />
        <Metric label="模擬交易" value={paperState} sub="僅 paper preview / 風控檢查" tone={paper.data?.previewReady ? "live" : "empty"} />
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

function IntradayChart({ points }: { points: number[] }) {
  const path = sparkPath(points, 360, 46);
  return (
    <svg className="tac-intraday" viewBox="0 0 360 46" preserveAspectRatio="none" aria-hidden>
      <path d={`${path} L360,46 L0,46 Z`} />
      <path d={path} />
    </svg>
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
      title="盤中排行"
      sub={hasRealLeaders ? "即時報價來源回傳的漲跌與成交排行" : "等待後端行情回補真實排行；不顯示假股票。"}
      right={<><PulseBars state={hasRealLeaders ? "LIVE" : "EMPTY"} /><span>{hasRealLeaders ? "REAL" : "EMPTY"}</span></>}
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

function HeatmapPanel({ heatmap, market }: { heatmap: HeatTile[]; market: LoadState<MarketDataOverview | null> }) {
  const rows = heatmap.length > 0 ? heatmap : EMPTY_HEATMAP;
  const hasRealHeatmap = market.state === "LIVE" && rows.some((row) => !row.placeholder);
  return (
    <Panel
      eyebrow="HEATMAP"
      title="台股公司池 · HEATMAP"
      sub={hasRealHeatmap ? "市值權重 × 漲跌幅" : "等待後端行情回補；不顯示假價格。"}
      right={<div className="tac-heat-legend"><span>▲ 漲</span><span>— 平</span><span>▼ 跌</span></div>}
    >
      <div className="tac-heatmap">
        {rows.map((tile, index) => <HeatTileView tile={tile} index={index} key={`${tile.symbol}-${index}`} />)}
      </div>
      <div className="tac-heat-footer">
        <span>顯示 {hasRealHeatmap ? rows.length : 0} 檔 · {hasRealHeatmap ? "真實 quote leaders" : "EMPTY quote leaders"}</span>
        <span>-2% <i /> +2%</span>
      </div>
    </Panel>
  );
}

function HeatTileView({ tile, index }: { tile: HeatTile; index: number }) {
  const pct = tile.pct ?? 0;
  const tone = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const abs = Math.min(1, Math.abs(pct) / 2.2);
  const style = {
    "--heat": String(0.18 + abs * 0.42),
    "--weight": String(Math.max(1, Math.min(8, tile.weight))),
  } as CSSProperties;
  if (tile.placeholder) {
    return (
      <div
        className={`tac-heat-tile placeholder ${index === 0 ? "major" : index === 1 ? "secondary" : ""}`}
        style={style}
      >
        <span>EMPTY</span>
        <small>{tile.name}</small>
        <b>--</b>
      </div>
    );
  }
  return (
    <Link
      className={`tac-heat-tile ${tone} ${index === 0 ? "major" : index === 1 ? "secondary" : ""}`}
      href={`/companies/${encodeURIComponent(tile.symbol)}`}
      style={style}
    >
      <span>{tile.symbol}</span>
      <small>{tile.name}</small>
      <b>{formatPercent(tile.pct)}</b>
    </Link>
  );
}

function MarketIntelPanel({ intel }: { intel: LoadState<MarketIntelDashboard> }) {
  const featured = intel.data.items[0] ?? null;
  const rows = intel.data.items.slice(featured ? 1 : 0, featured ? 7 : 6);
  return (
    <Panel
      eyebrow="MARKET INTEL"
      title="重大訊息與市場情報"
      sub={intel.state === "LIVE" ? "官方公告進入今日工作流" : intel.reason}
      right={<StatusChip state={stateFromLoad(intel)} label={`${formatNumber(intel.data.items.length)} 筆`} />}
      className="tac-intel-panel"
    >
      {featured ? (
        <Link href={`/companies/${encodeURIComponent(featured.ticker)}`} className="tac-intel-feature">
          <span>{categoryLabel(featured.category)}</span>
          <strong>{intelTitleText(featured)}</strong>
          <small>{featured.ticker} · {featured.companyName} · {formatDate(featured.date)}</small>
        </Link>
      ) : (
        <div className="tac-empty-line">近 {ANNOUNCEMENT_DAYS} 天沒有可顯示的官方重大訊息。</div>
      )}
      <div className="tac-intel-list">
        {rows.map((item) => (
          <Link href={`/companies/${encodeURIComponent(item.ticker)}`} key={`${item.ticker}-${item.id}`}>
            <b>{item.ticker}</b>
            <span>{intelTitleText(item)}</span>
            <small>{formatDate(item.date)}</small>
            <em>{categoryLabel(item.category)}</em>
          </Link>
        ))}
      </div>
      <div className="tac-intel-foot">
        <span>查詢 {formatNumber(intel.data.selected.length)} 檔公司</span>
        <span>{intel.data.failures > 0 ? `${intel.data.failures} 檔查詢失敗` : "官方路徑可讀"}</span>
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
    { id: "03", name: "草稿", state: brief.data.draftCount > 0 || displayBrief ? "LIVE" as DashboardState : "EMPTY" as DashboardState, note: `${brief.data.draftCount} 份待審` },
    { id: "04", name: "審核", state: brief.data.state === "AWAITING_REVIEW" ? "REVIEW" as DashboardState : brief.data.state === "PUBLISHED" ? "LIVE" as DashboardState : "EMPTY" as DashboardState, note: brief.data.state === "PUBLISHED" ? "已通過" : "等待人工確認" },
    { id: "05", name: "發布", state: brief.data.state === "PUBLISHED" ? "LIVE" as DashboardState : "EMPTY" as DashboardState, note: brief.data.latestDate ?? "今日未發布" },
  ];
  return (
    <Panel eyebrow="AI BRIEF" title="AI 每日簡報" sub="只展示已發布或待審狀態；不把摘要偽裝成買賣建議" right={<StatusChip state={panelState} />}>
      <div className="tac-openalice-top">
        <Metric label="今日狀態" value={brief.data.state === "PUBLISHED" ? "已發布" : brief.data.state === "AWAITING_REVIEW" ? "待審" : "待產生"} sub={brief.data.today} tone={panelState === "LIVE" ? "live" : panelState === "REVIEW" ? "review" : "empty"} />
        <Metric label="待審草稿" value={brief.data.draftCount} sub="只讀審核佇列" tone={brief.data.draftCount > 0 ? "review" : "empty"} />
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

function PaperPanel({ paper }: { paper: LoadState<PaperHealthState | null> }) {
  const data = paper.data;
  const steps = [
    { id: "1", name: "公司頁預覽", desc: "委託前檢查", state: data?.previewReady ? "LIVE" : stateFromLoad(paper), count: data?.previewReady ? 1 : 0, note: data?.previewReady ? "可做風控預覽" : "等待開啟" },
    { id: "2", name: "風控檢查", desc: "限制與閘門", state: data?.gate.gateOpen ? "LIVE" : "BLOCKED", count: data?.gate.gateOpen ? 1 : 0, note: data?.gate.gateOpen ? "可檢查" : "目前關閉" },
    { id: "3", name: "委託草稿", desc: "只做紙上流程", state: data?.previewReady ? "LIVE" : "EMPTY", count: data?.queueDepth ?? 0, note: `${formatNumber(data?.queueDepth)} 筆等待` },
    { id: "4", name: "紙上送出", desc: "模擬環境", state: data?.submitReady ? "DEGRADED" : "EMPTY", count: data?.submitReady ? 1 : 0, note: "仍需確認流程" },
    { id: "5", name: "部位回寫", desc: "Portfolio / fills", state: data?.fillsReady || data?.portfolioReady ? "LIVE" : "EMPTY", count: data?.lastFillTs ? 1 : 0, note: data?.lastFillTs ? formatDateTime(data.lastFillTs) : "--" },
  ] satisfies Array<{ id: string; name: string; desc: string; state: DashboardState; count: number; note: string }>;
  return (
    <Panel eyebrow="PAPER FLOW" title="模擬交易流程" sub="preview / risk / draft / fill · 只做紙上交易與風控驗證" right={<StatusChip state={data?.previewReady ? "LIVE" : stateFromLoad(paper)} label="PAPER" />}>
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
        <div><span>測試資金</span><b>NT$ {formatNumber(PAPER_PREVIEW_CAPITAL_TWD)}</b><small>preview 使用明確 SHARE / LOT。</small></div>
        <div><span>單位提示</span><b>1 張 = 1,000 股</b><small>零股以實際股數計算。</small></div>
        <div className="blocked"><span>安全狀態</span><b>只允許紙上流程</b><small>首頁不送出真實委託。</small></div>
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
    { id: "3", title: "確認 AI 簡報", desc: brief.data.state === "PUBLISHED" ? "今日正式簡報已發布。" : "等待草稿、審核或發布。", href: "/briefs", state: brief.data.state === "PUBLISHED" ? "LIVE" as DashboardState : brief.data.state === "AWAITING_REVIEW" ? "REVIEW" as DashboardState : "EMPTY" as DashboardState, cta: "查看簡報" },
    { id: "4", title: "紙上交易預覽", desc: paper.data?.previewReady ? "可進公司頁做風控預覽。" : "等待 paper preview 開啟。", href: "/companies/2330#paper-order", state: paper.data?.previewReady ? "LIVE" as DashboardState : stateFromLoad(paper), cta: "開啟預覽" },
    { id: "5", title: "部位與成交回顧", desc: "只看 paper portfolio / fills，不連真實券商。", href: "/portfolio", state: paper.data?.portfolioReady || paper.data?.fillsReady ? "LIVE" as DashboardState : "EMPTY" as DashboardState, cta: "查看部位" },
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

export default async function DashboardPage() {
  const now = nowIso();
  const [finmind, market, ops, brief, paper, ideas, runs] = await Promise.all([
    loadFinMindDashboard(),
    load(
      "Market data overview",
      null,
      async () => (await getMarketDataOverview({ includeStale: true, topLimit: 12 })).data,
      (value) => value === null || value.quotes.total === 0,
      "市場資料總覽目前沒有可用報價。",
    ),
    load(
      "OpenAlice / Ops snapshot",
      null,
      async () => (await getOpsSnapshot({ auditHours: 24, recentLimit: 6 })).data,
      (value) => value === null,
      "OpenAlice 營運快照目前沒有回傳資料。",
    ),
    loadDailyBriefDashboard(),
    loadPaperHealthState(),
    load(
      "Strategy ideas",
      null,
      async () => (await getStrategyIdeas({ limit: 8, includeBlocked: true, decisionMode: "paper", sort: "score" })).data,
      (value) => value === null || value.items.length === 0,
      "策略想法目前沒有可用候選。",
    ),
    load(
      "Strategy runs",
      null,
      async () => (await listStrategyRuns({ limit: 6, sort: "created_at" })).data,
      (value) => value === null || value.items.length === 0,
      "策略批次目前沒有可用紀錄。",
    ),
  ]);

  const intel = await loadMarketIntelDashboard(ideas);
  const sources = buildSources({ finmind, market, ops, brief, paper, ideas, runs, intel });
  const realHeatmap = buildHeatmap(market);
  const heatmap = realHeatmap.length > 0 ? realHeatmap : EMPTY_HEATMAP;
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
            <HeroPanel heatmap={heatmap} market={market} paper={paper} brief={brief} intel={intel} now={now} />
            <MarketMoversPanel market={market} />
          </section>
          <section className="tac-two-grid tac-fresh-heat">
            <FreshnessPanel sources={sources} />
            <HeatmapPanel heatmap={realHeatmap} market={market} />
          </section>
          <section className="tac-two-grid">
            <MarketIntelPanel intel={intel} />
            <DailyBriefPanel market={market} intel={intel} brief={brief} />
          </section>
          <section className="tac-two-grid tac-paper-grid">
            <PaperPanel paper={paper} />
            <StrategyPanel ideas={ideas} />
          </section>
          <section className="tac-two-grid tac-bottom-grid">
            <WorkflowPanel market={market} intel={intel} brief={brief} paper={paper} />
            <DataReadinessPanel sources={sources} />
          </section>
          <section className="tac-single-grid">
            <DataGapPanel sources={sources} />
          </section>
        </div>
      </main>
    </div>
  );
}
