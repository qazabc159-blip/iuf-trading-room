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
import { getPaperHealth, type PaperHealthState } from "@/lib/paper-orders-api";

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
  draftCount: number;
  reason?: string;
};

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
  return "受阻";
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
  if (dataset.state === "EMPTY" || dataset.state === "STALE" || dataset.state === "FALLBACK" || dataset.state === "DEGRADED") return "EMPTY";
  return "BLOCKED";
}

function datasetLabel(dataset: FinMindDatasetStatus) {
  if (dataset.state === "LIVE" || dataset.state === "READY") return "正常";
  if (dataset.state === "EMPTY") return "無資料";
  if (dataset.state === "STALE") return "過期";
  if (dataset.state === "DEGRADED" || dataset.state === "FALLBACK") return "降級";
  return "受阻";
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
        reason: "FinMind token 尚未就緒或資料源受阻。",
      };
    }
    return {
      state: status.data.state === "LIVE_READY" ? "LIVE" : "EMPTY",
      data,
      updatedAt: status.data.updatedAt ?? updatedAt,
      source: "FinMind",
      ...(status.data.state === "LIVE_READY" ? {} : { reason: "FinMind 已設定，但仍有資料集尚未正式回補。" }),
    } as LoadState<FinMindDashboard | null>;
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
    { today, state: "BLOCKED", latestDate: null, draftCount: 0, reason: "每日簡報資料讀取失敗。" },
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
        return { today, state: "PUBLISHED" as const, latestDate: todayBrief.date.slice(0, 10), draftCount: todayDrafts.length };
      }
      if (todayDrafts.length > 0) {
        return { today, state: "AWAITING_REVIEW" as const, latestDate: latest?.date.slice(0, 10) ?? null, draftCount: todayDrafts.length };
      }
      return {
        today,
        state: "MISSING" as const,
        latestDate: latest?.date.slice(0, 10) ?? null,
        draftCount: todayDrafts.length,
        reason: "今天尚未看到 published 簡報，也沒有待審草稿。",
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
    "紙上交易健康檢查目前沒有資料。",
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
    <Panel code="SRC" title="FinMind 資料燃料" sub="Sponsor 999 / token 安全 / 資料集回補" right={<StatusPill state={finmind.state} />}>
      {sourceLine({ state: finmind, label: "FinMind 診斷" })}
      <MetricStrip
        columns={4}
        cells={[
          { label: "Token", value: status?.tokenPresent ? "存在" : "缺少", tone: status?.tokenPresent ? "status-ok" : "status-bad" },
          { label: "用量", value: `${formatCount(status?.quota.used)} / ${formatCount(status?.quota.limit)}`, tone: "muted" },
          { label: "方案", value: quotaTierLabel(quotaTier), tone: quotaTier === "sponsor999" ? "status-ok" : "gold" },
          { label: "上限", value: `${formatCount(quotaLimit)} / 小時`, tone: quotaOverride ? "status-bad" : quotaLimit ? "status-ok" : "gold" },
          { label: "正常資料集", value: live, tone: live > 0 ? "status-ok" : "gold" },
          { label: "最近請求", value: latestDataset, tone: "muted" },
        ]}
      />
      {quotaOverride && (
        <div className="terminal-note compact">
          <span className="tg status-bad">Quota 設定異常</span>
          Sponsor 999 應顯示 6,000 次 / 小時；目前後端回傳 {formatCount(quotaLimit)}。請檢查 Railway 的 `FINMIND_QUOTA_LIMIT_PER_HOUR` 是否仍被舊值覆寫。
        </div>
      )}
      <div className="dashboard-dataset-ribbon" aria-label="FinMind 資料集狀態">
        {datasets.slice(0, 14).map((dataset) => (
          <span className={`dashboard-dataset-token ${datasetClass(dataset)}`} key={dataset.key}>
            {dataset.label} / {datasetLabel(dataset)}
            {typeof dataset.rowCount === "number" ? ` · ${dataset.rowCount.toLocaleString("zh-TW")} 筆` : ""}
            {dataset.latestDate ? ` · ${dataset.latestDate}` : ""}
          </span>
        ))}
        {datasets.length === 0 && <span className="dashboard-dataset-token is-blocked">尚未讀到資料集狀態</span>}
      </div>
      <div className="terminal-note compact">
        FinMind 只負責正式資料顯示與研究燃料；不作為成交價、風控放行或策略有效性的替代證據。
      </div>
      <div className="dashboard-workflow-grid">
        <Link className="dashboard-command-card" href="/companies/2330">
          <span>檢查台積電公司頁</span>
          <strong>K 線、財務、籌碼與委託預覽</strong>
          <small>確認資料是否真的從 FinMind / DB 回來。</small>
        </Link>
        <Link className="dashboard-command-card" href="/market-intel">
          <span>市場情報</span>
          <strong>重大訊息與新聞等待正式接通</strong>
          <small>未接通時保持無資料，不用舊內容假裝新消息。</small>
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
    <Panel code="MKT" title="市場資料可用性" sub="報價、K 線與 paper preview 前置品質" right={<StatusPill state={market.state} />}>
      {sourceLine({ state: market, label: "市場資料總覽" })}
      <MetricStrip
        columns={5}
        cells={[
          { label: "追蹤標的", value: formatCount(data?.symbols.total), tone: data?.symbols.total ? "status-ok" : "muted" },
          { label: "紙上可用", value: formatCount(readiness?.paperUsable), tone: readiness?.paperUsable ? "status-ok" : "gold" },
          { label: "受阻標的", value: formatCount(readiness?.blocked), tone: readiness?.blocked ? "status-bad" : "muted" },
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

  return (
    <Panel code="BRF" title="OpenAlice 每日簡報" sub="自動產文、AI 審核、source trail、發布狀態" right={<StatusPill state={ops.state} />}>
      {sourceLine({ state: ops, label: "OpenAlice 營運快照" })}
      <MetricStrip
        columns={4}
        cells={[
          { label: "Runner", value: workerOk ? "healthy" : obs?.workerStatus ?? stateLabel(ops.state), tone: workerOk ? "status-ok" : "status-bad" },
          { label: "Dispatcher", value: sweepOk ? "healthy" : obs?.sweepStatus ?? stateLabel(ops.state), tone: sweepOk ? "status-ok" : "status-bad" },
          { label: "Queue", value: formatCount(queue?.totalJobs), tone: queue?.running ? "gold" : "muted" },
          { label: "今日簡報", value: briefState === "PUBLISHED" ? "已發布" : briefState === "AWAITING_REVIEW" ? "待審" : "缺稿", tone: stateTone(briefUiState) },
        ]}
      />
      <div className="dashboard-workflow-grid">
        <Link className="dashboard-command-card" href="/briefs">
          <span>每日簡報流程</span>
          <strong>{briefState === "PUBLISHED" ? "查看今日報告" : briefState === "AWAITING_REVIEW" ? "審核今日草稿" : "檢查產生流程"}</strong>
          <small>最新發布：{brief.data.latestDate ?? "--"} / 待審草稿：{brief.data.draftCount}</small>
        </Link>
        <Link className="dashboard-command-card" href="/ops">
          <span>OpenAlice 狀態</span>
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
    <Panel code="06-PORT" title="紙上交易工作流" sub="委託預覽、風控結果、部位回放 / 不連真實券商" right={<StatusPill state={paper.state} />}>
      {sourceLine({ state: paper, label: "Paper health" })}
      <MetricStrip
        columns={5}
        cells={[
          { label: "Preview", value: data?.previewReady ? "可預覽" : "受阻", tone: data?.previewReady ? "status-ok" : "status-bad" },
          { label: "Submit", value: submitReady ? "紙上可送" : "尚未啟用", tone: submitReady ? "gold" : "muted" },
          { label: "Gate", value: gateOpen ? "開啟" : "關閉", tone: gateOpen ? "status-ok" : "status-bad" },
          { label: "Queue", value: formatCount(data?.queueDepth), tone: data?.queueDepth ? "gold" : "muted" },
          { label: "最近成交", value: formatDateTime(data?.lastFillTs), tone: "muted" },
        ]}
      />
      <div className="terminal-note compact">
        紙上交易只顯示模擬流程；1 張等於 1,000 股，零股以實際股數計算。此處不呼叫真實下單路由。
      </div>
    </Panel>
  );
}

function strategyPanel(ideas: LoadState<Awaited<ReturnType<typeof getStrategyIdeas>>["data"] | null>, runs: LoadState<Awaited<ReturnType<typeof listStrategyRuns>>["data"] | null>) {
  const ideaCount = ideas.data?.items.length ?? 0;
  const blockedIdeas = ideas.data?.items.filter((item) => item.marketData.decision === "block").length ?? 0;
  const runCount = runs.data?.items.length ?? 0;
  return (
    <Panel code="LAB" title="策略與量化入口" sub="只顯示候選狀態；績效必須等 Athena + Bruce 核准" right={<StatusPill state={ideas.state === "LIVE" || runs.state === "LIVE" ? "LIVE" : ideas.state} />}>
      <MetricStrip
        columns={4}
        cells={[
          { label: "候選想法", value: formatCount(ideaCount), tone: ideaCount ? "gold" : "muted" },
          { label: "資料受阻", value: formatCount(blockedIdeas), tone: blockedIdeas ? "status-bad" : "muted" },
          { label: "批次紀錄", value: formatCount(runCount), tone: runCount ? "gold" : "muted" },
          { label: "治理狀態", value: "待核准", tone: "gold" },
        ]}
      />
      <div className="dashboard-workflow-grid">
        <Link className="dashboard-command-card" href="/ideas">
          <span>策略想法清單</span>
          <strong>看候選是否被資料品質擋下</strong>
          <small>不顯示未核准績效，不給方向建議。</small>
        </Link>
        <Link className="dashboard-command-card" href="/lab">
          <span>量化研究包</span>
          <strong>等待 Athena bundle 與 Bruce harness</strong>
          <small>未核准前只顯示 source、schema、review 狀態。</small>
        </Link>
      </div>
    </Panel>
  );
}

function actionDeck() {
  const actions = [
    { href: "/companies/2330", title: "檢查 2330 公司頁", sub: "K 線、FinMind、紙上 preview 都在同一條流程。" },
    { href: "/briefs", title: "每日簡報", sub: "看今天是否已發布、待審或缺稿。" },
    { href: "/portfolio", title: "紙上部位", sub: "確認預覽、成交回放、部位與稽核狀態。" },
    { href: "/market-intel", title: "重大訊息", sub: "等待 FinMind/news backend 完整接通後顯示。" },
  ];
  return (
    <Panel code="OPS" title="下一步工作流" sub="能推進的 workflow；不能推進的會說清楚">
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
      "OpenAlice 營運快照目前沒有資料。",
    ),
    loadDailyBriefDashboard(),
    loadPaperHealthState(),
    load(
      "Strategy ideas",
      null,
      async () => (await getStrategyIdeas({ limit: 8, includeBlocked: true, decisionMode: "paper", sort: "score" })).data,
      (value) => value === null || value.items.length === 0,
      "策略想法目前沒有可顯示資料。",
    ),
    load(
      "Strategy runs",
      null,
      async () => (await listStrategyRuns({ limit: 6, sort: "created_at" })).data,
      (value) => value === null || value.items.length === 0,
      "策略批次目前沒有可顯示資料。",
    ),
  ]);

  return (
    <PageFrame
      code="01"
      title="台股 AI 交易戰情室"
      sub="把資料、AI 簡報、量化候選、紙上交易與風控放進同一條作業流"
      note="這裡只顯示真實資料狀態。沒有資料就標示無資料；流程受阻就標示受阻；不使用舊內容或假資料填版面。"
    >
      <section className="dashboard-hero">
        <div className="dashboard-hero-main">
          <span className="tg gold">IUF / 台股研究與交易作業系統</span>
          <h2>先知道今天能做什麼，再進公司頁、簡報、紙上流程。</h2>
          <p>
            FinMind 負責台股資料燃料，OpenAlice 負責每日摘要與 source trail，Paper workflow 負責委託前風控與部位回放。
            首頁不再堆舊主題或舊訊號，而是告訴操盤者現在有哪些資料、哪些流程可用、哪些還需要接通。
          </p>
          <div className="dashboard-hero-kpis-inline">
            <div className="dashboard-hero-stat"><span>FinMind</span><strong className={stateTone(finmind.state)}>{stateLabel(finmind.state)}</strong></div>
            <div className="dashboard-hero-stat"><span>OpenAlice</span><strong className={stateTone(ops.state)}>{stateLabel(ops.state)}</strong></div>
            <div className="dashboard-hero-stat"><span>每日簡報</span><strong className={stateTone(brief.state)}>{brief.data.state === "PUBLISHED" ? "已發布" : brief.data.state === "AWAITING_REVIEW" ? "待審" : "待產生"}</strong></div>
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
          <Panel code="INT" title="重大訊息與新聞" sub="等待正式 news / announcement backend 接通" right={<StatusPill state="EMPTY" />}>
            <div className="terminal-note compact">
              這裡不放過期新聞，也不把外部摘要當正式消息。等 FinMind / news ingestion 完整部署後，會顯示 source trail、發布時間與影響分類。
            </div>
            <Link className="mini-button" href="/market-intel">打開重大訊息</Link>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
