import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  getBriefs,
  getContentDrafts,
  getFinMindDiagnostics,
  getFinMindStatus,
  getMarketDataOverview,
  getOpsSnapshot,
  getStrategyIdeas,
  listStrategyRuns,
  type FinMindDatasetStatus,
  type FinMindDiagnosticsStatus,
  type FinMindSourceStatus,
  type MarketDataOverview,
  type OpsSnapshotData,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";
import { getPaperHealth, type PaperHealthState } from "@/lib/paper-orders-api";
import type { DailyBrief } from "@iuf-trading-room/contracts";

export const dynamic = "force-dynamic";

type SourceState = "LIVE" | "EMPTY" | "BLOCKED";
type LoadState<T> =
  | { state: "LIVE"; data: T; updatedAt: string; source: string }
  | { state: "EMPTY"; data: T; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: T; updatedAt: string; source: string; reason: string };

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

const TAIPEI_TIME_ZONE = "Asia/Taipei";

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

function formatCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-TW") : "--";
}

function stateLabel(state: SourceState) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "阻擋";
}

function stateTone(state: SourceState) {
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function StatusPill({ state, label }: { state: SourceState; label?: string }) {
  return <span className={`tg ${stateTone(state)}`}>{label ?? stateLabel(state)}</span>;
}

function datasetState(dataset: FinMindDatasetStatus): SourceState {
  if (dataset.state === "LIVE" || dataset.state === "READY") return "LIVE";
  if (dataset.state === "BLOCKED" || dataset.state === "ERROR" || dataset.state === "MOCK" || dataset.state === "CLOSED") {
    return "BLOCKED";
  }
  return "EMPTY";
}

function datasetLabel(dataset: FinMindDatasetStatus) {
  if (dataset.state === "LIVE" || dataset.state === "READY") return "正常";
  if (dataset.state === "STALE") return "過期";
  if (dataset.state === "DEGRADED" || dataset.state === "FALLBACK") return "降級";
  if (dataset.state === "BLOCKED") return "阻擋";
  if (dataset.state === "ERROR") return "錯誤";
  if (dataset.state === "MOCK") return "假資料停用";
  if (dataset.state === "CLOSED") return "關閉";
  return "無資料";
}

function datasetClass(dataset: FinMindDatasetStatus) {
  const state = datasetState(dataset);
  if (state === "LIVE") return "is-ready";
  if (state === "EMPTY") return "is-pending";
  return "is-blocked";
}

function quotaTierLabel(value: string | null | undefined) {
  if (value === "sponsor999") return "Sponsor 999";
  if (value === "free") return "Free";
  if (value === "none") return "未設定";
  return value ?? "--";
}

function finmindQuotaTier(status: FinMindSourceStatus | null | undefined, diagnostics: FinMindDiagnosticsStatus | null | undefined) {
  return status?.global?.quotaTier ?? diagnostics?.quotaTier ?? "none";
}

function finmindQuotaLimit(status: FinMindSourceStatus | null | undefined, diagnostics: FinMindDiagnosticsStatus | null | undefined) {
  return status?.quota.limit ?? status?.global?.rateLimitPerHour ?? diagnostics?.quotaLimitPerHour ?? null;
}

function hasSponsorQuotaOverride(status: FinMindSourceStatus | null | undefined, diagnostics: FinMindDiagnosticsStatus | null | undefined) {
  const tier = finmindQuotaTier(status, diagnostics);
  const limit = finmindQuotaLimit(status, diagnostics);
  return tier === "sponsor999" && typeof limit === "number" && limit < 6000;
}

function sourceLine<T>({ state, label }: { state: LoadState<T>; label: string }) {
  return (
    <div className="tg soft source-line">
      <StatusPill state={state.state} />
      <span>{label}</span>
      <span>來源：{state.source}</span>
      <span>更新：{formatDateTime(state.updatedAt)}</span>
      {"reason" in state && <span>{state.reason}</span>}
    </div>
  );
}

function asDraftRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function draftDate(payload: unknown, fallback: string | null) {
  const record = asDraftRecord(payload);
  const value = record.date ?? record.targetDate;
  return typeof value === "string" ? value.slice(0, 10) : fallback?.slice(0, 10) ?? null;
}

function maskUnsafeAdviceText(text: string) {
  const patterns = [/買進/g, /賣出/g, /目標價/g, /必賺/g, /保證/g, /勝率/g];
  return patterns.reduce((next, pattern) => next.replace(pattern, "[投資建議字詞已遮蔽]"), text);
}

function safeBriefText(text: string) {
  return maskUnsafeAdviceText(cleanNarrativeText(text));
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
      const todayBrief = sortedBriefs.find((brief) => brief.status === "published" && brief.date.slice(0, 10) === today);
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

function finMindPanel(finmind: LoadState<FinMindDashboard | null>) {
  const status = finmind.data?.status;
  const diagnostics = finmind.data?.diagnostics;
  const datasets = status?.datasets ?? [];
  const live = datasets.filter((item) => datasetState(item) === "LIVE").length;
  const pending = datasets.filter((item) => datasetState(item) === "EMPTY").length;
  const blocked = datasets.filter((item) => datasetState(item) === "BLOCKED").length;
  const latestDataset = diagnostics?.inProcess.lastDataset ?? datasets.find((item) => item.latestDate)?.label ?? "--";
  const quotaTier = finmindQuotaTier(status, diagnostics);
  const quotaLimit = finmindQuotaLimit(status, diagnostics);
  const quotaOverride = hasSponsorQuotaOverride(status, diagnostics);

  return (
    <Panel code="SRC" title="FinMind 資料中樞" sub="Sponsor 999 / token 安全 / 官方資料流" right={<StatusPill state={finmind.state} />}>
      {sourceLine({ state: finmind, label: "FinMind 診斷" })}
      <MetricStrip
        columns={4}
        cells={[
          { label: "Token", value: status?.tokenPresent ? "存在" : "缺少", tone: status?.tokenPresent ? "status-ok" : "status-bad" },
          { label: "配額", value: `${formatCount(status?.quota.used)} / ${formatCount(status?.quota.limit)}`, tone: "muted" },
          { label: "方案", value: quotaTierLabel(quotaTier), tone: quotaTier === "sponsor999" ? "status-ok" : "gold" },
          { label: "每小時", value: quotaLimit ? `${formatCount(quotaLimit)} 次` : "--", tone: quotaOverride ? "status-bad" : quotaLimit ? "status-ok" : "gold" },
          { label: "可用資料集", value: live, tone: live > 0 ? "status-ok" : "gold" },
          { label: "等待回補", value: pending, tone: pending ? "gold" : "muted" },
          { label: "阻擋資料集", value: blocked, tone: blocked ? "status-bad" : "muted" },
          { label: "最新請求", value: latestDataset, tone: "muted" },
        ]}
      />
      {quotaOverride && (
        <div className="terminal-note compact">
          <span className="tg status-bad">配額設定異常</span>
          Sponsor 999 應為每小時 6,000 次；目前後端回報 {formatCount(quotaLimit)} 次，請檢查 Railway 的配額設定。
        </div>
      )}
      <div className="dashboard-dataset-ribbon" aria-label="FinMind dataset readiness">
        {datasets.slice(0, 14).map((dataset) => (
          <span className={`dashboard-dataset-token ${datasetClass(dataset)}`} key={dataset.key}>
            {dataset.label} / {datasetLabel(dataset)}
            {typeof dataset.rowCount === "number" ? ` · ${dataset.rowCount.toLocaleString("zh-TW")} 筆` : ""}
            {dataset.latestDate ? ` · ${dataset.latestDate}` : ""}
          </span>
        ))}
        {datasets.length === 0 && <span className="dashboard-dataset-token is-blocked">後端尚未回傳資料集狀態</span>}
      </div>
      <div className="dashboard-workflow-grid">
        <Link className="dashboard-command-card" href="/companies/2330">
          <span>公司頁實測</span>
          <strong>看 K 線、FinMind、紙上 preview 是否通</strong>
          <small>用 2330 當基準，不發送真實委託。</small>
        </Link>
        <Link className="dashboard-command-card" href="/market-intel">
          <span>重大訊息</span>
          <strong>檢查公告、新聞與 FinMind 資料狀態</strong>
          <small>沒有 source trail 的內容不當作投資依據。</small>
        </Link>
      </div>
    </Panel>
  );
}

function marketPanel(market: LoadState<MarketDataOverview | null>) {
  const data = market.data;
  const readiness = data?.quotes.readiness.effectiveSelection;
  const barQuality = data?.quality.bars;
  return (
    <Panel code="MKT" title="市場資料可用度" sub="報價、K 線與 paper preview 可用性" right={<StatusPill state={market.state} />}>
      {sourceLine({ state: market, label: "市場資料總覽" })}
      <MetricStrip
        columns={5}
        cells={[
          { label: "追蹤股票", value: formatCount(data?.symbols.total), tone: data?.symbols.total ? "status-ok" : "muted" },
          { label: "可紙上預覽", value: formatCount(readiness?.paperUsable), tone: readiness?.paperUsable ? "status-ok" : "gold" },
          { label: "阻擋", value: formatCount(readiness?.blocked), tone: readiness?.blocked ? "status-bad" : "muted" },
          { label: "K 線可用", value: formatCount(barQuality?.ready), tone: barQuality?.ready ? "status-ok" : "gold" },
          { label: "最新報價", value: formatDateTime(data?.quotes.latestQuoteTimestamp), tone: "muted" },
        ]}
      />
      {"reason" in market && <div className="terminal-note compact"><StatusPill state={market.state} /> {market.reason}</div>}
    </Panel>
  );
}

function openAlicePanel(ops: LoadState<OpsSnapshotData | null>, brief: LoadState<DailyBriefDashboard>) {
  const obs = ops.data?.openAlice.observability;
  const queue = ops.data?.openAlice.queue;
  const workerOk = obs?.workerStatus === "healthy";
  const sweepOk = obs?.sweepStatus === "healthy";
  const briefState = brief.data.state;
  const briefUiState: SourceState = briefState === "PUBLISHED" ? "LIVE" : briefState === "AWAITING_REVIEW" || briefState === "MISSING" ? "EMPTY" : "BLOCKED";
  const displayBrief = brief.data.todayBrief ?? brief.data.latest;
  const displayBriefDate = displayBrief?.date.slice(0, 10) ?? null;
  const isStaleBrief = Boolean(displayBriefDate && displayBriefDate !== brief.data.today);
  const previewSections = displayBrief?.sections.slice(0, 2) ?? [];

  return (
    <Panel code="BRF" title="OpenAlice 每日工作流" sub="自動產生、審核佇列與 source trail" right={<StatusPill state={ops.state} />}>
      {sourceLine({ state: ops, label: "OpenAlice 營運快照" })}
      <MetricStrip
        columns={4}
        cells={[
          { label: "Runner", value: workerOk ? "healthy" : obs?.workerStatus ?? stateLabel(ops.state), tone: workerOk ? "status-ok" : "status-bad" },
          { label: "Dispatcher", value: sweepOk ? "healthy" : obs?.sweepStatus ?? stateLabel(ops.state), tone: sweepOk ? "status-ok" : "status-bad" },
          { label: "Queue", value: formatCount(queue?.totalJobs), tone: queue?.running ? "gold" : "muted" },
          { label: "每日簡報", value: briefState === "PUBLISHED" ? "已發布" : briefState === "AWAITING_REVIEW" ? "待審核" : "未產生", tone: stateTone(briefUiState) },
        ]}
      />
      <div className="homepage-brief-preview">
        <header>
          <span className={`tg ${stateTone(isStaleBrief ? "EMPTY" : briefUiState)}`}>
            {displayBrief ? (isStaleBrief ? "最新正式版過期" : "今日正式版") : "尚無正式版"}
          </span>
          <strong>{displayBriefDate ?? "等待 OpenAlice 產生每日簡報"}</strong>
          <small>source trail 未閉環時不當作投資依據；投資建議字詞會遮蔽。</small>
        </header>
        {previewSections.length > 0 ? (
          <div className="homepage-brief-section-grid">
            {previewSections.map((section, index) => (
              <article className="homepage-brief-section" key={`${section.heading}:${index}`}>
                <span>#{String(index + 1).padStart(2, "0")}</span>
                <h3>{cleanExternalHeadline(section.heading)}</h3>
                <p>{safeBriefText(section.body)}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="state-reason">{brief.data.reason ?? "目前沒有可展示的正式簡報段落；請看草稿佇列與 reviewer 狀態。"}</p>
        )}
      </div>
      <div className="dashboard-workflow-grid">
        <Link className="dashboard-command-card" href="/briefs">
          <span>每日簡報</span>
          <strong>{briefState === "PUBLISHED" ? "今日簡報已發布" : briefState === "AWAITING_REVIEW" ? "今日草稿等待審核" : "今日簡報尚未閉環"}</strong>
          <small>最後發布：{brief.data.latestDate ?? "--"} / 今日草稿：{brief.data.draftCount}</small>
        </Link>
        <Link className="dashboard-command-card" href="/ops">
          <span>OpenAlice 監控</span>
          <strong>檢查 runner、dispatcher、queue</strong>
          <small>心跳：{formatDateTime(obs?.workerHeartbeatAt)} / 掃描：{formatDateTime(obs?.lastSweepAt)}</small>
        </Link>
      </div>
    </Panel>
  );
}

function paperPanel(paper: LoadState<PaperHealthState | null>) {
  const data = paper.data;
  const gateOpen = Boolean(data?.gate.gateOpen);
  const submitReady = Boolean(data?.submitReady);
  return (
    <Panel code="06-PORT" title="紙上交易狀態" sub="preview、風控與部位讀取；不連接真實券商" right={<StatusPill state={paper.state} />}>
      {sourceLine({ state: paper, label: "Paper health" })}
      <MetricStrip
        columns={5}
        cells={[
          { label: "Preview", value: data?.previewReady ? "可預覽" : "阻擋", tone: data?.previewReady ? "status-ok" : "status-bad" },
          { label: "送出", value: submitReady ? "後端允許" : "前端鎖定", tone: submitReady ? "gold" : "muted" },
          { label: "Gate", value: gateOpen ? "通過" : "鎖定", tone: gateOpen ? "status-ok" : "status-bad" },
          { label: "Queue", value: formatCount(data?.queueDepth), tone: data?.queueDepth ? "gold" : "muted" },
          { label: "最後成交", value: formatDateTime(data?.lastFillTs), tone: "muted" },
        ]}
      />
      <div className="terminal-note compact">
        台股單位固定揭露：1 張 = 1,000 股；零股以實際股數計算。公司頁預設使用 1 股零股 preview，不送真實委託。
      </div>
    </Panel>
  );
}

function strategyPanel(ideas: LoadState<StrategyIdeasData | null>, runs: LoadState<StrategyRunsData | null>) {
  const ideaCount = ideas.data?.items.length ?? 0;
  const blockedIdeas = ideas.data?.items.filter((item) => item.marketData.decision === "block").length ?? 0;
  const runCount = runs.data?.items.length ?? 0;
  const panelState = ideas.state === "LIVE" || runs.state === "LIVE" ? "LIVE" : ideas.state;

  return (
    <Panel code="LAB" title="策略與量化入口" sub="只顯示資料狀態；未核准績效不展示" right={<StatusPill state={panelState} />}>
      <MetricStrip
        columns={4}
        cells={[
          { label: "候選想法", value: formatCount(ideaCount), tone: ideaCount ? "gold" : "muted" },
          { label: "資料阻擋", value: formatCount(blockedIdeas), tone: blockedIdeas ? "status-bad" : "muted" },
          { label: "批次", value: formatCount(runCount), tone: runCount ? "gold" : "muted" },
          { label: "績效", value: "待 Athena / Bruce", tone: "gold" },
        ]}
      />
      <div className="dashboard-workflow-grid">
        <Link className="dashboard-command-card" href="/ideas">
          <span>策略想法</span>
          <strong>先確認候選資料是否足夠</strong>
          <small>不顯示買賣建議，不把分數當績效。</small>
        </Link>
        <Link className="dashboard-command-card" href="/lab">
          <span>量化研究</span>
          <strong>等待 Athena bundle 與 Bruce harness</strong>
          <small>只有通過審核的指標才會上線。</small>
        </Link>
      </div>
    </Panel>
  );
}

function actionDeck() {
  const actions = [
    { href: "/companies/2330#paper-order", title: "檢查 2330 公司頁", sub: "K 線、FinMind、紙上 preview 是否通。" },
    { href: "/briefs", title: "每日簡報", sub: "確認 OpenAlice 今日草稿、source trail 與發布狀態。" },
    { href: "/portfolio", title: "紙上交易部位", sub: "看部位、fills、readiness rail，不連真實券商。" },
    { href: "/market-intel", title: "重大訊息", sub: "追 FinMind news、公告與市場資料缺口。" },
  ];
  return (
    <Panel code="OPS" title="下一步交易工作流" sub="能推進的 workflow 要清楚；不能推進的要說明原因">
      <div className="dashboard-workflow-grid">
        {actions.map((action) => (
          <Link href={action.href} className="dashboard-command-card" key={action.href}>
            <span>{action.title}</span>
            <strong>{action.sub}</strong>
            <small>打開</small>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

export default async function DashboardPage() {
  const [finmind, market, ops, brief, paper, ideas, runs] = await Promise.all([
    loadFinMindDashboard(),
    load(
      "Market data overview",
      null,
      async () => (await getMarketDataOverview({ includeStale: true, topLimit: 5 })).data,
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

  return (
    <PageFrame
      code="01"
      title="台股 AI 交易戰情室"
      sub="資料中樞、AI 簡報、策略候選與紙上交易工作流"
      note="首頁只呈現可驗證資料狀態與下一步工作流；沒有來源的內容不當作投資依據。"
    >
      <section className="dashboard-hero">
        <div className="dashboard-hero-main">
          <span className="tg gold">IUF / 台股投資作業系統</span>
          <h2>把散亂資訊變成可驗證、可風控、可執行的交易流程。</h2>
          <p>
            FinMind 負責官方台股資料，OpenAlice 負責每日自動整理與 source trail，Paper workflow 負責 preview、風控與部位回寫。
            這裡不顯示未核准績效、不提供買賣建議，也不把 K 線或 FinMind 當成交價。
          </p>
          <div className="dashboard-hero-kpis-inline">
            <div className="dashboard-hero-stat"><span>FinMind</span><strong className={stateTone(finmind.state)}>{stateLabel(finmind.state)}</strong></div>
            <div className="dashboard-hero-stat"><span>OpenAlice</span><strong className={stateTone(ops.state)}>{stateLabel(ops.state)}</strong></div>
            <div className="dashboard-hero-stat"><span>每日簡報</span><strong className={stateTone(brief.state)}>{brief.data.state === "PUBLISHED" ? "已發布" : brief.data.state === "AWAITING_REVIEW" ? "待審核" : "未產生"}</strong></div>
            <div className="dashboard-hero-stat"><span>Paper</span><strong className={stateTone(paper.state)}>{stateLabel(paper.state)}</strong></div>
          </div>
        </div>
      </section>

      <div className="main-grid dashboard-mosaic-grid">
        <div className="dashboard-mosaic-primary">
          {finMindPanel(finmind)}
          {marketPanel(market)}
          {openAlicePanel(ops, brief)}
          {paperPanel(paper)}
        </div>
        <div className="dashboard-mosaic-secondary">
          {actionDeck()}
          {strategyPanel(ideas, runs)}
          <Panel code="INT" title="重大訊息與新聞" sub="FinMind news / TWSE announcement backend" right={<StatusPill state="EMPTY" />}>
            <div className="terminal-note compact">
              新聞與公告必須帶來源與時間；如果 ingestion 尚未完整回補，就顯示缺口，不補假內容。
            </div>
            <Link className="mini-button" href="/market-intel">打開重大訊息</Link>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
