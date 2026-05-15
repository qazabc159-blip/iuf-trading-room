import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getStrategyRunById, listStrategyRuns } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanNarrativeText } from "@/lib/operator-copy";
import { reasonLabel } from "@/lib/strategy-vocab";

export const dynamic = "force-dynamic";

type RunRecord = Awaited<ReturnType<typeof getStrategyRunById>>["data"];
type RunsView = Awaited<ReturnType<typeof listStrategyRuns>>["data"];
type RunOutput = RunRecord["outputs"][number];
type RunListItem = RunsView["items"][number];
type DetailData = {
  run: RunRecord | null;
  runs: RunsView;
};
type LoadState =
  | { state: "LIVE"; data: DetailData; updatedAt: string; source: string }
  | { state: "EMPTY"; data: DetailData; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: DetailData; updatedAt: string; source: string; reason: string };

const emptyRuns: RunsView = { total: 0, items: [] };

async function loadDetail(id: string): Promise<LoadState> {
  const source = "正式策略批次 / 批次明細";
  const updatedAt = new Date().toISOString();

  try {
    const [runEnvelope, runsEnvelope] = await Promise.all([
      getStrategyRunById(id),
      listStrategyRuns({ decisionMode: "paper", limit: 50, sort: "created_at" }),
    ]);
    const run = runEnvelope.data;
    if (run.outputs.length === 0 && run.items.length === 0) {
      return {
        state: "EMPTY",
        data: { run, runs: runsEnvelope.data },
        updatedAt: run.generatedAt || updatedAt,
        source,
        reason: "策略批次存在，但沒有產出候選股票。",
      };
    }
    return {
      state: "LIVE",
      data: { run, runs: runsEnvelope.data },
      updatedAt: run.generatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: { run: null, runs: emptyRuns },
      updatedAt,
      source,
      reason: friendlyDataError(error, "策略批次明細暫時無法讀取。"),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "ok";
  if (state === "EMPTY") return "warn";
  return "bad";
}

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function decisionTone(decision: RunOutput["marketDecision"]) {
  if (decision === "allow") return "status-ok";
  if (decision === "review") return "gold";
  return "status-bad";
}

function decisionLabel(decision: RunOutput["marketDecision"]) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待審";
  return "不進流程";
}

function directionTone(direction: RunOutput["direction"]) {
  if (direction === "bullish") return "up";
  if (direction === "bearish") return "down";
  return "muted";
}

function directionLabel(direction: RunOutput["direction"]) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "中性";
}

function modeLabel(mode: string | null | undefined) {
  if (mode === "paper") return "模擬候選";
  if (mode === "live") return "正式檢查";
  if (mode === "strategy") return "策略篩選";
  return mode ?? "--";
}

function shortRunId(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function queryLabel(key: string) {
  const labels: Record<string, string> = {
    limit: "候選上限",
    signalDays: "訊號天數",
    includeBlocked: "包含不進流程",
    market: "市場",
    themeId: "主題 ID",
    theme: "主題",
    symbol: "股票",
    decisionMode: "模式",
    decisionFilter: "決策篩選",
    qualityFilter: "品質篩選",
    sort: "排序",
  };
  return labels[key] ?? key;
}

function formatQueryValue(value: unknown) {
  if (Array.isArray(value)) return value.join(" / ") || "--";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value === null || value === undefined || value === "") return "--";
  if (value === "paper") return "模擬候選";
  if (value === "live") return "正式檢查";
  if (value === "strategy") return "策略篩選";
  if (value === "score") return "分數";
  if (value === "created_at") return "建立時間";
  if (value === "symbol") return "股票代號";
  if (value === "signal_strength") return "訊號強度";
  if (value === "signal_recency") return "訊號時效";
  if (value === "theme_rank") return "主題熱度";
  return String(value);
}

function PromotionBlockedCell() {
  return (
    <span
      className="tg down"
      title="策略想法尚未開放直接轉入模擬委託；請到交易室重新核對風控與委託條件。"
      style={{ display: "grid", gap: 3, minWidth: 0, lineHeight: 1.45 }}
    >
      <span>轉單暫停</span>
      <span className="tc soft">
        等待交易室交接
      </span>
    </span>
  );
}

function portfolioPrefillHref(symbol: string) {
  return `/portfolio?ticker=${encodeURIComponent(symbol)}&prefill=true&from_run=true`;
}

function barWidth(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.min(100, Math.round((value / total) * 100))}%`;
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="runs-source-line">
      <span className={`parity-badge ${stateTone(result.state)}`}>{stateLabel(result.state)}</span>
      <span>來源：{result.source}</span>
      <span>更新 {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function ideaReasonText(idea: RunOutput) {
  return cleanNarrativeText(
    `${idea.companyName} / ${idea.topThemeName ?? "未連結主題"} / ${reasonLabel(idea.primaryReason)}`,
    `${idea.companyName} / 原因待整理`
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`parity-badge ${stateTone(result.state)}`}>{stateLabel(result.state)}</span>{" "}
      {result.reason}
    </div>
  );
}

function buildLineage(run: RunRecord | null, runs: RunsView) {
  if (!run) return [];
  const sorted = runs.items.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const index = sorted.findIndex((item) => item.id === run.id);
  const newer = index > 0 ? sorted[index - 1] : null;
  const older = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;
  return [
    { label: "較新", item: newer },
    { label: "目前", item: sorted[index] ?? null },
    { label: "較舊", item: older },
  ] satisfies { label: string; item: RunListItem | null }[];
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: encodedId } = await params;
  const id = decodeURIComponent(encodedId);
  const result = await loadDetail(id);
  const run = result.data.run;
  const runAvailable = run !== null;
  const summary = run?.summary ?? {
    total: 0,
    allow: 0,
    review: 0,
    block: 0,
    bullish: 0,
    bearish: 0,
    neutral: 0,
    quality: { strategyReady: 0, referenceOnly: 0, insufficient: 0, primaryReasons: [] },
  };
  const outputs = run?.outputs ?? [];
  const lineage = buildLineage(run, result.data.runs);
  const unavailableReason = result.state === "LIVE" ? "策略批次資料不存在。" : result.reason;

  return (
    <PageFrame
      code="05-D"
      title="批次明細"
      sub={run ? `${shortRunId(run.id)} / ${modeLabel(run.query.decisionMode)}` : `${shortRunId(id)} / 暫停`}
      note="此頁讀取正式策略批次資料；候選不是買賣建議。公司頁只看研究資料，模擬預覽與風控核對請到交易室。"
    >
      {/* parity-kpi-bar hero */}
      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">狀態</span>
          <span className={`parity-kpi-value ${stateTone(result.state)}`}>
            {stateLabel(result.state)}
          </span>
          <span className="parity-kpi-sub">{result.source}</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">總候選數</span>
          <span className={`parity-kpi-value ${runAvailable && summary.total > 0 ? "warn" : "dim"}`}>
            {runAvailable ? summary.total : "--"}
          </span>
          <span className="parity-kpi-sub">本批次</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">可觀察</span>
          <span className={`parity-kpi-value ${runAvailable && summary.allow > 0 ? "ok" : "dim"}`}>
            {runAvailable ? summary.allow : "--"}
          </span>
          <span className="parity-kpi-sub">通過決策門檻</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">待審</span>
          <span className={`parity-kpi-value ${runAvailable && summary.review > 0 ? "warn" : "dim"}`}>
            {runAvailable ? summary.review : "--"}
          </span>
          <span className="parity-kpi-sub">需人工確認</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">不進流程</span>
          <span className={`parity-kpi-value ${runAvailable && summary.block > 0 ? "bad" : "dim"}`}>
            {runAvailable ? summary.block : "--"}
          </span>
          <span className="parity-kpi-sub">已篩除</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">策略可用</span>
          <span className={`parity-kpi-value ${runAvailable && summary.quality.strategyReady > 0 ? "ok" : "dim"}`}>
            {runAvailable ? summary.quality.strategyReady : "--"}
          </span>
          <span className="parity-kpi-sub">品質達標</span>
        </div>
      </div>

      <div className="runs-detail-layout">
        <div>
          <Panel code="RUN-QRY" title="批次條件" sub="策略批次 / 唯讀" right={stateLabel(result.state)}>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            {run && (
              <div className="run-query-grid">
                {Object.entries(run.query).map(([key, value]) => (
                  <div className="run-query-chip" key={key}>
                    <span>{queryLabel(key)}</span>
                    <strong>{formatQueryValue(value)}</strong>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel code="RUN-IDEA" title="候選股票" sub="公司連結與轉單狀態" right={runAvailable ? `${outputs.length} 筆` : stateLabel(result.state)}>
            {!runAvailable && (
              <div className="terminal-note">
                <span className={`parity-badge ${stateTone(result.state)}`}>{stateLabel(result.state)}</span> {unavailableReason}
              </div>
            )}
            {runAvailable && outputs.length === 0 && (
              <div className="parity-empty" style={{ minHeight: 120 }}>
                <div className="parity-empty-icon">◌</div>
                <h3>此批次沒有候選股票</h3>
                <p>策略批次存在但無候選輸出；不補假資料。</p>
              </div>
            )}
            {runAvailable && outputs.map((idea) => (
              <div className="run-output-card" key={`${idea.companyId}-${idea.symbol}`}>
                <div className="run-output-symbol">
                  <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
                  <strong>{idea.companyName}</strong>
                  <span className="tc">{idea.topThemeName ?? "未連結主題"}</span>
                </div>
                <div className="run-output-metrics">
                  <span className={directionTone(idea.direction)}>{directionLabel(idea.direction)}</span>
                  <span>{idea.score.toFixed(1)} 分</span>
                  <span className={decisionTone(idea.marketDecision)}>{decisionLabel(idea.marketDecision)}</span>
                </div>
                <p>{ideaReasonText(idea)}</p>
                <Link href={`/companies/${idea.symbol}`} className="mini-button">公司頁</Link>
                <Link href={portfolioPrefillHref(idea.symbol)} className="mini-button">帶到交易室</Link>
                <PromotionBlockedCell />
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="RUN-OUT" title="結果分布" sub="批次摘要" right={run ? shortRunId(run.id) : "暫停"}>
            {!runAvailable && (
              <div className="terminal-note">
                <span className={`parity-badge ${stateTone(result.state)}`}>{stateLabel(result.state)}</span> {unavailableReason}
              </div>
            )}
            {runAvailable && (
              <>
                {[
                  ["可觀察", summary.allow, "up"],
                  ["待審", summary.review, "gold"],
                  ["不進流程", summary.block, "down"],
                  ["偏多", summary.bullish, "up"],
                  ["偏空", summary.bearish, "down"],
                  ["中性", summary.neutral, "muted"],
                ].map(([label, value, tone]) => (
                  <div style={{ padding: "10px 0", borderBottom: "1px solid var(--night-rule)" }} key={label}>
                    <div className="tg" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{label}</span><span className={String(tone)}>{value}</span>
                    </div>
                    <div className="bar" style={{ marginTop: 8 }}>
                      <span style={{ width: barWidth(Number(value), Math.max(1, summary.total)), background: tone === "gold" ? "var(--gold-bright)" : tone === "status-ok" ? "var(--tw-dn-bright)" : tone === "status-bad" ? "var(--tw-up-bright)" : tone === "up" ? "var(--tw-up-bright)" : tone === "down" ? "var(--tw-dn-bright)" : "var(--night-mid)" }} />
                    </div>
                  </div>
                ))}
                <div className="tg soft" style={{ display: "grid", gap: 6, padding: "12px 0" }}>
                  <span>產生：{formatDateTime(run.generatedAt)}</span>
                  <span>平均信心：{outputs.length ? percent(outputs.reduce((sum, item) => sum + item.confidence, 0) / outputs.length) : "--"}</span>
                  <span>交易邊界：候選不是買賣建議；模擬預覽、風控核對與委託執行只在交易室處理。</span>
                </div>
              </>
            )}
          </Panel>

          <Panel code="RUN-LIN" title="批次脈絡" sub="較新 / 較舊批次" right="瀏覽">
            {!runAvailable && <div className="terminal-note"><span className={`parity-badge ${stateTone(result.state)}`}>{stateLabel(result.state)}</span> {unavailableReason}</div>}
            {runAvailable && lineage.length === 0 && (
              <div className="parity-empty" style={{ minHeight: 80 }}>
                <h3>沒有可用批次脈絡</h3>
              </div>
            )}
            {runAvailable && lineage.map(({ label, item }) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "70px 1fr" }} key={label}>
                <span className="tg gold">{label}</span>
                {item ? (
                  <Link href={`/runs/${encodeURIComponent(item.id)}`} className="tg">{shortRunId(item.id)} / {modeLabel(item.decisionMode)}</Link>
                ) : (
                  <span className="tg soft">無</span>
                )}
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
