import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import {
  getFinMindDiagnostics,
  getFinMindStatus,
  getMarketDataOverview,
  getOpsSnapshot,
  getSignals,
  getStrategyIdeas,
  getThemes,
  listStrategyRuns,
  type FinMindDiagnosticsStatus,
  type FinMindSourceStatus,
  type MarketDataOverview,
  type OpsSnapshotData,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanThemeThesis } from "@/lib/operator-copy";

export const dynamic = "force-dynamic";

type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type SignalRow = Awaited<ReturnType<typeof getSignals>>["data"][number];
type StrategyIdeaView = Awaited<ReturnType<typeof getStrategyIdeas>>["data"];
type StrategyRunView = Awaited<ReturnType<typeof listStrategyRuns>>["data"];

type DashboardFinMindStatus = FinMindSourceStatus & {
  diagnostics: FinMindDiagnosticsStatus | null;
  diagnosticsError?: string;
};

type SourceState = "LIVE" | "EMPTY" | "BLOCKED";
type LoadState<T> =
  | { state: "LIVE"; data: T; updatedAt: string; source: string }
  | { state: "EMPTY"; data: T; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: T; updatedAt: string; source: string; reason: string };

const TAIPEI_TIME_ZONE = "Asia/Taipei";

function nowIso() {
  return new Date().toISOString();
}

async function load<T>(
  source: string,
  emptyValue: T,
  fn: () => Promise<T>,
  isEmpty: (value: T) => boolean,
  emptyReason = "正式資料來源目前回傳 0 筆。"
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

function statusText(state: SourceState) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function statusTone(state: SourceState) {
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function StatusPill({ state, label }: { state: SourceState; label?: string }) {
  return <span className={`tg ${statusTone(state)}`}>{label ?? statusText(state)}</span>;
}

function formatCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-TW") : "--";
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

function taipeiDateKey(value?: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: TAIPEI_TIME_ZONE });
}

function todayTaipeiKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TAIPEI_TIME_ZONE });
}

function daysBetweenDateKeys(left: string, right: string) {
  const [ly, lm, ld] = left.split("-").map(Number);
  const [ry, rm, rd] = right.split("-").map(Number);
  if (!ly || !lm || !ld || !ry || !rm || !rd) return null;
  return Math.floor((Date.UTC(ry, rm - 1, rd) - Date.UTC(ly, lm - 1, ld)) / 86_400_000);
}

function freshness(value: string | null | undefined) {
  const key = taipeiDateKey(value);
  if (!key) return { label: "時間未知", tone: "gold", ageDays: null as number | null };
  const ageDays = daysBetweenDateKeys(key, todayTaipeiKey());
  if (ageDays === null) return { label: "時間未知", tone: "gold", ageDays };
  if (ageDays <= 0) return { label: "今日資料", tone: "status-ok", ageDays };
  if (ageDays === 1) return { label: "昨日資料", tone: "status-ok", ageDays };
  if (ageDays <= 7) return { label: `過期 ${ageDays} 天`, tone: "gold", ageDays };
  return { label: `過期 ${ageDays} 天`, tone: "status-bad", ageDays };
}

function latestIso(values: Array<string | null | undefined>) {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isFinite(time) && time > latestTime) {
      latest = value;
      latestTime = time;
    }
  }
  return latest;
}

function sourceLine<T>({ state, label, maxAgeDays = 1 }: { state: LoadState<T>; label: string; maxAgeDays?: number }) {
  const info = freshness(state.updatedAt);
  const stale = state.state === "LIVE" && info.ageDays !== null && info.ageDays > maxAgeDays;
  return {
    label,
    source: state.source,
    state: stale ? "BLOCKED" as const : state.state,
    updatedAt: state.updatedAt,
    freshness: info,
    reason: stale ? `資料已${info.label}，不放入今日戰情判讀。` : state.state === "LIVE" ? undefined : state.reason,
  };
}

function SourceLine<T>({ state, label, maxAgeDays = 1 }: { state: LoadState<T>; label: string; maxAgeDays?: number }) {
  const line = sourceLine({ state, label, maxAgeDays });
  return (
    <div className="tg soft source-line">
      <StatusPill state={line.state} label={line.state === "BLOCKED" && line.reason?.includes("過期") ? "過期" : undefined} />
      <span>{label}</span>
      <span>來源：{line.source}</span>
      <span>更新：{formatDateTime(line.updatedAt)}</span>
      <span className={`tg ${line.freshness.tone}`}>{line.freshness.label}</span>
      {line.reason && <span>{line.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked<T>({ state, maxAgeDays = 1 }: { state: LoadState<T>; maxAgeDays?: number }) {
  const info = freshness(state.updatedAt);
  const stale = state.state === "LIVE" && info.ageDays !== null && info.ageDays > maxAgeDays;
  if (state.state === "LIVE" && !stale) return null;
  const reason = state.state === "LIVE" ? "" : state.reason;
  return (
    <div className="terminal-note">
      <StatusPill state={stale ? "BLOCKED" : state.state} label={stale ? "過期" : undefined} />{" "}
      {stale ? `資料已${info.label}，暫不放入今日決策區。` : reason}
    </div>
  );
}

function themeName(theme: ThemeRow) {
  return theme.name.replace(/^\[ORPHAN\]\s*/i, "待整理：");
}

function isInternalTestSignal(signal: SignalRow) {
  const text = `${signal.title} ${signal.summary ?? ""} ${signal.category}`.toLowerCase();
  return /bruce|dryrun|smoke|test signal|verify/.test(text);
}

function directionText(value: string) {
  if (value === "bullish") return "正向";
  if (value === "bearish") return "負向";
  return "中性";
}

function decisionText(value: string) {
  if (value === "allow") return "可觀察";
  if (value === "review") return "需審核";
  if (value === "block") return "阻擋";
  return value;
}

function tone(value: number | null | undefined) {
  if (typeof value !== "number") return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

function signedPct(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

async function loadFinMindStatus(): Promise<LoadState<DashboardFinMindStatus | null>> {
  const updatedAt = nowIso();
  const [statusResult, diagnosticsResult] = await Promise.allSettled([
    getFinMindStatus(),
    getFinMindDiagnostics(),
  ]);

  if (statusResult.status === "rejected" && diagnosticsResult.status === "rejected") {
    return {
      state: "BLOCKED",
      data: null,
      updatedAt,
      source: "FinMind",
      reason: `${friendlyDataError(statusResult.reason)} / ${friendlyDataError(diagnosticsResult.reason)}`,
    };
  }

  const diagnostics = diagnosticsResult.status === "fulfilled" ? diagnosticsResult.value.data : null;
  const status = statusResult.status === "fulfilled"
    ? statusResult.value.data
    : {
        source: "FINMIND" as const,
        state: diagnostics?.tokenPresent ? "LIVE_READY" as const : "BLOCKED" as const,
        tokenPresent: diagnostics?.tokenPresent ?? false,
        quota: {
          used: diagnostics?.inProcess.requestCount ?? null,
          limit: diagnostics?.quotaLimitPerHour ?? null,
          source: diagnostics ? `diagnostics:${diagnostics.quotaTier}` : "diagnostics_unavailable",
        },
        datasets: [],
        notes: diagnostics ? [diagnostics.note] : [],
        updatedAt,
      };

  const data: DashboardFinMindStatus = {
    ...status,
    diagnostics,
    diagnosticsError: diagnosticsResult.status === "rejected" ? friendlyDataError(diagnosticsResult.reason) : undefined,
  };

  if (!data.tokenPresent && !diagnostics?.tokenPresent) {
    return { state: "BLOCKED", data, updatedAt: data.updatedAt || updatedAt, source: "FinMind", reason: "後端未偵測到 FinMind token。" };
  }

  return { state: "LIVE", data, updatedAt: data.updatedAt || updatedAt, source: "FinMind" };
}

function Hero({ sources }: { sources: Array<ReturnType<typeof sourceLine>> }) {
  const healthy = sources.filter((item) => item.state === "LIVE").length;
  const blocked = sources.filter((item) => item.state === "BLOCKED").length;
  return (
    <section className="dashboard-hero dashboard-command-deck" aria-label="戰情台資料健康">
      <div className="dashboard-hero-main">
        <span className="tg gold">IUF 台股戰情室</span>
        <h2>先確認資料能不能用，再進交易工作流。</h2>
        <p>
          這一頁只呈現真實來源狀態。過期、空資料、登入失效或後端阻擋都會被標示出來，不會把舊訊號包裝成今日情報。
          KGI 正式下單仍鎖在 <code>libCGCrypt.so</code> 之外；紙上交易只做預覽與風控說明。
        </p>
        <div className="dashboard-hero-kpis dashboard-hero-kpis-inline">
          <div className="dashboard-hero-stat">
            <span className="tg soft">可用來源</span>
            <strong className="num status-ok">{healthy}</strong>
          </div>
          <div className="dashboard-hero-stat">
            <span className="tg soft">需處理</span>
            <strong className={`num ${blocked > 0 ? "down" : "status-ok"}`}>{blocked}</strong>
          </div>
          <div className="dashboard-hero-stat">
            <span className="tg soft">交易能力</span>
            <strong className="num gold">Paper</strong>
          </div>
          <div className="dashboard-hero-stat">
            <span className="tg soft">正式下單</span>
            <strong className="num down">封鎖</strong>
          </div>
        </div>
      </div>
      <div className="dashboard-source-rail" aria-label="資料來源狀態">
        {sources.map((section) => (
          <div className="dashboard-source-chip" key={section.label}>
            <div>
              <span className="tg gold">{section.label}</span>
              <span className="tg soft"> / {formatDateTime(section.updatedAt)}</span>
              <span className={`tg ${section.freshness.tone}`}> / {section.freshness.label}</span>
            </div>
            <StatusPill state={section.state} label={section.state === "BLOCKED" && section.reason?.includes("過期") ? "過期" : undefined} />
          </div>
        ))}
      </div>
    </section>
  );
}

function FinMindPanel({ finmind }: { finmind: LoadState<DashboardFinMindStatus | null> }) {
  const data = finmind.data;
  const diagnostics = data?.diagnostics ?? null;
  const datasets = data?.datasets ?? [];
  const ready = datasets.filter((dataset) => dataset.state === "READY");
  const degraded = datasets.filter((dataset) => dataset.state === "DEGRADED");
  const blocked = datasets.filter((dataset) => dataset.state === "BLOCKED");
  const quotaLimit = data?.quota.limit ?? diagnostics?.quotaLimitPerHour ?? null;
  const quotaUsed = data?.quota.used ?? diagnostics?.inProcess.requestCount ?? null;

  return (
    <Panel code="SRC-FIN" title="FinMind 資料源" sub="Sponsor 999 / 不顯示 token 值" right={<StatusPill state={finmind.state} />}>
      <SourceLine state={finmind} label="FinMind 診斷" maxAgeDays={1} />
      <div className="quote-strip">
        <div className="quote-card">
          <div className="tg">Token</div>
          <div className={`quote-last ${data?.tokenPresent || diagnostics?.tokenPresent ? "up" : "down"}`}>
            {data?.tokenPresent || diagnostics?.tokenPresent ? "存在" : "缺少"}
          </div>
          <div className="tg soft">只顯示 presence，不顯示 token 值。</div>
        </div>
        <div className="quote-card">
          <div className="tg">Quota</div>
          <div className="quote-last num">{formatCount(quotaLimit)} / 小時</div>
          <div className="tg soft">後端目前記錄使用 {formatCount(quotaUsed)} 次。</div>
        </div>
        <div className="quote-card">
          <div className="tg">資料集</div>
          <div className="quote-last num status-ok">{ready.length}</div>
          <div className="tg soft">正常 {ready.length} / 降級 {degraded.length} / 阻擋 {blocked.length}</div>
        </div>
        <div className="quote-card">
          <div className="tg">最近請求</div>
          <div className="quote-last">{diagnostics?.inProcess.lastDataset ?? "--"}</div>
          <div className="tg soft">{formatDateTime(diagnostics?.inProcess.lastFetchTs)}</div>
        </div>
      </div>
      {finmind.state !== "LIVE" && <EmptyOrBlocked state={finmind} />}
    </Panel>
  );
}

function MarketPanel({ overview }: { overview: LoadState<MarketDataOverview | null> }) {
  if (overview.state !== "LIVE" || !overview.data) {
    return (
      <Panel code="MKT" title="市場資料" sub="報價 / 可用性" right={<StatusPill state={overview.state} />}>
        <SourceLine state={overview} label="市場資料" />
        <EmptyOrBlocked state={overview} />
      </Panel>
    );
  }

  const data = overview.data;
  const leaders = [...data.leaders.topGainers.slice(0, 3), ...data.leaders.topLosers.slice(0, 3)];
  return (
    <Panel code="MKT" title="市場資料" sub="行情覆蓋與 paper 可用性" right={<StatusPill state="LIVE" />}>
      <SourceLine state={overview} label="市場資料" />
      <div className="quote-strip">
        <div className="quote-card">
          <div className="tg">報價總數</div>
          <div className="quote-last num">{formatCount(data.quotes.total)}</div>
          <div className="tg soft">新鮮 {formatCount(data.quotes.fresh)} / 過期 {formatCount(data.quotes.stale)}</div>
        </div>
        <div className="quote-card">
          <div className="tg">Paper 可用</div>
          <div className="quote-last num status-ok">{formatCount(data.quotes.readiness.effectiveSelection.paperUsable)}</div>
          <div className="tg soft">阻擋 {formatCount(data.quotes.readiness.effectiveSelection.blocked)}</div>
        </div>
        <div className="quote-card">
          <div className="tg">資料來源</div>
          <div className="quote-last">{data.quotes.readiness.connectedSources.join(" / ") || "--"}</div>
          <div className="tg soft">只做資料狀態，不作為成交價。</div>
        </div>
      </div>
      {leaders.length > 0 && (
        <div className="data-table compact">
          {leaders.map((item) => (
            <div className="row" key={`${item.source}-${item.symbol}-${item.changePct}`}>
              <span className="tg gold">{item.symbol}</span>
              <span className={`num ${tone(item.changePct)}`}>{signedPct(item.changePct)}</span>
              <span className="tg soft">{item.source.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function OpenAlicePanel({ ops }: { ops: LoadState<OpsSnapshotData | null> }) {
  const openAlice = ops.data?.openAlice;
  const obs = openAlice?.observability;
  const workerState: SourceState = obs?.workerStatus === "healthy" ? "LIVE" : obs ? "BLOCKED" : ops.state;
  const sweepState: SourceState = obs?.sweepStatus === "healthy" ? "LIVE" : obs ? "BLOCKED" : ops.state;

  return (
    <Panel code="BRF" title="OpenAlice / 每日簡報" sub="來源追蹤與工作佇列" right={<StatusPill state={workerState} />}>
      <SourceLine state={ops} label="營運快照" />
      <div className="quote-strip">
        <div className="quote-card">
          <div className="tg">Runner</div>
          <div className={`quote-last ${statusTone(workerState)}`}>{obs?.workerStatus ?? statusText(ops.state)}</div>
          <div className="tg soft">心跳：{formatDateTime(obs?.workerHeartbeatAt)}</div>
        </div>
        <div className="quote-card">
          <div className="tg">Dispatcher</div>
          <div className={`quote-last ${statusTone(sweepState)}`}>{obs?.sweepStatus ?? statusText(ops.state)}</div>
          <div className="tg soft">掃描：{formatDateTime(obs?.lastSweepAt)}</div>
        </div>
        <div className="quote-card">
          <div className="tg">Queue</div>
          <div className="quote-last num">{formatCount(openAlice?.queue.totalJobs)}</div>
          <div className="tg soft">queued {formatCount(openAlice?.queue.queued)} / running {formatCount(openAlice?.queue.running)} / review {formatCount(openAlice?.queue.reviewable)}</div>
        </div>
        <div className="quote-card">
          <div className="tg">已發布簡報</div>
          <div className="quote-last num">{formatCount(ops.data?.stats.publishedBriefs)}</div>
          <div className="tg soft">沒有 source trail 時不當作投資建議。</div>
        </div>
      </div>
      {workerState !== "LIVE" && (
        <div className="terminal-note">
          <StatusPill state="BLOCKED" /> OpenAlice 沒有健康心跳；每日簡報區只顯示狀態，不產生建議文字。
        </div>
      )}
    </Panel>
  );
}

function ThemesPanel({ themes }: { themes: LoadState<ThemeRow[]> }) {
  const updatedAt = themes.state === "LIVE" ? latestIso(themes.data.map((item) => item.updatedAt)) ?? themes.updatedAt : themes.updatedAt;
  const view = { ...themes, updatedAt } as LoadState<ThemeRow[]>;
  const fresh = freshness(updatedAt);
  const stale = fresh.ageDays !== null && fresh.ageDays > 7;
  const rows = themes.state === "LIVE" && !stale ? themes.data.slice(0, 6) : [];

  return (
    <Panel code="THM" title="主題資料" sub="資料庫主題 / 過期不進今日戰情" right={<StatusPill state={stale ? "BLOCKED" : themes.state} label={stale ? "過期" : undefined} />}>
      <SourceLine state={view} label="主題資料" maxAgeDays={7} />
      <EmptyOrBlocked state={view} maxAgeDays={7} />
      {rows.map((theme) => (
        <Link href={`/themes/${theme.slug}`} className="row dashboard-theme-row" key={theme.id}>
          <span className="tg soft">{theme.priority}</span>
          <span>
            <strong className="tc" style={{ color: "var(--night-ink)", fontSize: 16 }}>{themeName(theme)}</strong>
            <span className="tg soft" style={{ display: "block", marginTop: 4 }}>{cleanThemeThesis(theme.slug, theme.thesis)}</span>
          </span>
          <span className="tg gold">觀察</span>
          <span className="tg soft">{formatDateTime(theme.updatedAt)}</span>
        </Link>
      ))}
    </Panel>
  );
}

function IdeasPanel({ ideas }: { ideas: LoadState<StrategyIdeaView | null> }) {
  const updatedAt = ideas.state === "LIVE" && ideas.data ? ideas.data.generatedAt : ideas.updatedAt;
  const view = { ...ideas, updatedAt } as LoadState<StrategyIdeaView | null>;
  const fresh = freshness(updatedAt);
  const stale = fresh.ageDays !== null && fresh.ageDays > 1;
  const rows = ideas.state === "LIVE" && ideas.data && !stale ? ideas.data.items.slice(0, 5) : [];

  return (
    <Panel code="IDEA" title="策略想法" sub="只顯示候選，不等於下單建議" right={<StatusPill state={stale ? "BLOCKED" : ideas.state} label={stale ? "過期" : undefined} />}>
      <SourceLine state={view} label="策略想法 API" maxAgeDays={1} />
      <EmptyOrBlocked state={view} maxAgeDays={1} />
      {rows.map((idea) => (
        <Link href={`/companies/${idea.symbol}`} className="row idea-row" key={`${idea.companyId}-${idea.symbol}`}>
          <span className="tg gold">{idea.symbol}</span>
          <span className="tg soft">{idea.companyName}</span>
          <span className="tg">{directionText(idea.direction)}</span>
          <span className="num">{idea.score.toFixed(1)}</span>
          <span className="tg gold">{decisionText(idea.marketData.decision)}</span>
        </Link>
      ))}
    </Panel>
  );
}

function SignalsPanel({ signals }: { signals: LoadState<SignalRow[]> }) {
  const cleanSignals = signals.state === "LIVE" ? signals.data.filter((signal) => !isInternalTestSignal(signal)) : [];
  const updatedAt = signals.state === "LIVE" ? latestIso(cleanSignals.map((item) => item.createdAt)) ?? signals.updatedAt : signals.updatedAt;
  const view = { ...signals, updatedAt } as LoadState<SignalRow[]>;
  const fresh = freshness(updatedAt);
  const stale = fresh.ageDays !== null && fresh.ageDays > 1;
  const rows = signals.state === "LIVE" && !stale ? cleanSignals.slice(0, 5) : [];

  return (
    <Panel code="SIG" title="訊號證據" sub="過期與內部測試訊號不放入戰情" right={<StatusPill state={stale ? "BLOCKED" : signals.state} label={stale ? "過期" : undefined} />}>
      <SourceLine state={view} label="訊號證據 API" maxAgeDays={1} />
      <EmptyOrBlocked state={view} maxAgeDays={1} />
      {rows.map((signal) => (
        <div className="row dashboard-signal-row" key={signal.id}>
          <span className="tg soft">{formatDateTime(signal.createdAt)}</span>
          <span className="tc signal-title-main">{cleanExternalHeadline(signal.title || signal.summary || "未命名訊號")}</span>
          <span className="tg gold">信心 {signal.confidence}</span>
          <span className="tg soft">{directionText(signal.direction)}</span>
        </div>
      ))}
    </Panel>
  );
}

function RunsPanel({ runs }: { runs: LoadState<StrategyRunView | null> }) {
  const updatedAt = runs.state === "LIVE" && runs.data ? latestIso(runs.data.items.map((item) => item.generatedAt)) ?? runs.updatedAt : runs.updatedAt;
  const view = { ...runs, updatedAt } as LoadState<StrategyRunView | null>;
  const rows = runs.state === "LIVE" && runs.data ? runs.data.items.slice(0, 4) : [];

  return (
    <Panel code="RUNS" title="策略批次" sub="只顯示產出狀態，不顯示績效假數字" right={<StatusPill state={runs.state} />}>
      <SourceLine state={view} label="策略批次 API" maxAgeDays={7} />
      <EmptyOrBlocked state={view} maxAgeDays={7} />
      {rows.map((run) => (
        <Link href={`/runs/${run.id}`} className="row telex-row" key={run.id} style={{ gridTemplateColumns: "120px 1fr 80px" }}>
          <span className="tg soft">{formatDateTime(run.generatedAt)}</span>
          <span className="tg">{run.topSymbols.join(" / ") || "未列候選股"}</span>
          <span className="num">{run.summary.total}</span>
        </Link>
      ))}
    </Panel>
  );
}

function ActionDeck() {
  const actions = [
    { href: "/companies/2330", title: "檢查 2330 公司頁", sub: "K 線、FinMind、紙上 preview 都在同一頁確認。" },
    { href: "/portfolio", title: "紙上交易投組", sub: "只讀 paper portfolio，不連真實券商。" },
    { href: "/briefs", title: "每日簡報", sub: "等待 OpenAlice source trail 完整後才放入判讀。" },
    { href: "/ops", title: "營運監控", sub: "檢查 OpenAlice、資料佇列與工作心跳。" },
  ];
  return (
    <Panel code="OPS" title="下一步交易工作流" sub="能推進的 workflow，不能推進的會說清楚">
      <div className="quote-strip">
        {actions.map((action) => (
          <Link href={action.href} className="quote-card" key={action.href}>
            <div className="tg gold">{action.title}</div>
            <div className="tg soft" style={{ marginTop: 8 }}>{action.sub}</div>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function NotReadyPanel() {
  const rows = [
    { label: "重大訊息", reason: "尚未接到可驗證來源與篩選規則。", next: "等待 OpenAlice 或正式新聞 adapter 提供 source trail。" },
    { label: "量化研究", reason: "沒有 Athena + Bruce approval 前不顯示 Sharpe、勝率或 equity curve。", next: "只顯示 bundle 狀態，不顯示假績效。" },
    { label: "訊號證據", reason: "過期或內部測試訊號不進首頁戰情。", next: "等來源追蹤與時間新鮮度通過。" },
    { label: "策略想法", reason: "候選想法不是買賣建議。", next: "等 paper gate、風控與資料品質都通過。" },
  ];

  return (
    <Panel code="SRC" title="暫不當作今日情報的區塊" sub="不是刪除功能，而是阻止舊資料誤導">
      <div className="data-table compact">
        {rows.map((row) => (
          <div className="row" key={row.label}>
            <span className="tg gold">{row.label}</span>
            <span className="tc soft">{row.reason}</span>
            <span className="tg soft">{row.next}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default async function DashboardPage() {
  const [overview, themes, ideas, runs, signals, ops, finmind] = await Promise.all([
    load("市場資料 API", null, async () => (await getMarketDataOverview({ includeStale: true, topLimit: 5 })).data, (value) => value === null || value.quotes.total === 0, "市場資料目前回傳 0 筆，不能顯示盤勢。"),
    load("主題資料庫", [], async () => (await getThemes()).data, (value) => value.length === 0, "主題資料庫目前沒有可顯示項目。"),
    load("策略想法 API", null, async () => (await getStrategyIdeas({ limit: 8, includeBlocked: true, decisionMode: "paper", sort: "score" })).data, (value) => value === null || value.items.length === 0, "策略想法目前沒有可顯示候選。"),
    load("策略批次 API", null, async () => (await listStrategyRuns({ limit: 6, sort: "created_at" })).data, (value) => value === null || value.items.length === 0, "策略批次目前沒有產出紀錄。"),
    load("訊號證據 API", [], async () => (await getSignals()).data, (value) => value.length === 0, "訊號證據目前沒有正式資料。"),
    load("營運快照 API", null, async () => (await getOpsSnapshot({ auditHours: 24, recentLimit: 6 })).data, (value) => value === null, "營運快照目前沒有資料。"),
    loadFinMindStatus(),
  ]);

  const marketUpdatedAt = overview.state === "LIVE" && overview.data?.generatedAt ? overview.data.generatedAt : overview.updatedAt;
  const opsUpdatedAt = ops.state === "LIVE" && ops.data ? ops.data.generatedAt : ops.updatedAt;
  const ideasUpdatedAt = ideas.state === "LIVE" && ideas.data ? ideas.data.generatedAt : ideas.updatedAt;
  const signalsUpdatedAt = signals.state === "LIVE" ? latestIso(signals.data.map((item) => item.createdAt)) ?? signals.updatedAt : signals.updatedAt;
  const themesUpdatedAt = themes.state === "LIVE" ? latestIso(themes.data.map((item) => item.updatedAt)) ?? themes.updatedAt : themes.updatedAt;

  const sourceStatuses = [
    sourceLine({ state: { ...finmind, updatedAt: finmind.updatedAt }, label: "FinMind", maxAgeDays: 1 }),
    sourceLine({ state: { ...overview, updatedAt: marketUpdatedAt }, label: "市場資料", maxAgeDays: 1 }),
    sourceLine({ state: { ...ops, updatedAt: opsUpdatedAt }, label: "OpenAlice", maxAgeDays: 1 }),
    sourceLine({ state: { ...themes, updatedAt: themesUpdatedAt }, label: "主題資料", maxAgeDays: 7 }),
    sourceLine({ state: { ...ideas, updatedAt: ideasUpdatedAt }, label: "策略想法", maxAgeDays: 1 }),
    sourceLine({ state: { ...signals, updatedAt: signalsUpdatedAt }, label: "訊號證據", maxAgeDays: 1 }),
  ];

  const summary = sourceStatuses
    .map((item) => `${item.label} ${item.state === "LIVE" ? "正常" : item.reason?.includes("過期") ? "過期" : statusText(item.state)}`)
    .join(" / ");

  return (
    <PageFrame
      code="01"
      title="交易戰情台"
      sub="資料健康與交易工作流"
      note={`資料狀態 / ${summary}`}
    >
      <Hero sources={sourceStatuses} />
      <FinMindPanel finmind={finmind} />
      <div className="main-grid dashboard-mosaic-grid">
        <div className="dashboard-mosaic-primary">
          <MarketPanel overview={{ ...overview, updatedAt: marketUpdatedAt }} />
          <OpenAlicePanel ops={{ ...ops, updatedAt: opsUpdatedAt }} />
          <ActionDeck />
        </div>
        <div className="dashboard-mosaic-secondary">
          <ThemesPanel themes={{ ...themes, updatedAt: themesUpdatedAt }} />
          <IdeasPanel ideas={{ ...ideas, updatedAt: ideasUpdatedAt }} />
          <SignalsPanel signals={{ ...signals, updatedAt: signalsUpdatedAt }} />
          <RunsPanel runs={runs} />
          <NotReadyPanel />
        </div>
      </div>
    </PageFrame>
  );
}
