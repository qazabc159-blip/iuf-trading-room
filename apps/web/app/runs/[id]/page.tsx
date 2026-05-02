import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getStrategyRunById, listStrategyRuns } from "@/lib/api";

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
  const source = `GET /api/v1/strategy/runs/${id}`;
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
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", { hour12: false });
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
}

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function decisionTone(decision: RunOutput["marketDecision"]) {
  if (decision === "allow") return "up";
  if (decision === "review") return "gold";
  return "down";
}

function decisionLabel(decision: RunOutput["marketDecision"]) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待審";
  return "阻擋";
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
  if (mode === "paper") return "模擬";
  if (mode === "live") return "正式";
  return mode ?? "--";
}

function formatQueryValue(value: unknown) {
  if (Array.isArray(value)) return value.join(" / ") || "--";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value === null || value === undefined || value === "") return "--";
  if (value === "paper") return "模擬";
  if (value === "live") return "正式";
  return String(value);
}

const runIdeaRowWithPromoteStyle = {
  gridTemplateColumns: "74px 56px 54px 72px minmax(160px, 1fr) 88px minmax(170px, 0.72fr)",
};

function PromotionBlockedCell() {
  return (
    <span
      className="tg down"
      title="策略想法轉模擬委託預覽的後端契約尚未完成。負責人：策略交接與風控管線。"
      style={{ display: "grid", gap: 3, minWidth: 0, lineHeight: 1.25 }}
    >
      <span>轉單暫停</span>
      <span className="tc soft" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        等待後端預覽契約
      </span>
    </span>
  );
}

function barWidth(value: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.min(100, Math.round((value / total) * 100))}%`;
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{stateLabel(result.state)}</span>
      <span>策略批次資料</span>
      <span>更新 {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</span>{" "}
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
      title={run?.id ?? id}
      sub={run ? `策略批次 / ${modeLabel(run.query.decisionMode)}` : "策略批次暫停"}
      note="此頁讀取正式策略批次資料；策略想法轉模擬委託會保持暫停，直到後端預覽契約啟用。"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "總數", value: runAvailable ? summary.total : "--" },
          { label: "可觀察", value: runAvailable ? summary.allow : "--", tone: "up" },
          { label: "待審", value: runAvailable ? summary.review : "--", tone: "gold" },
          { label: "阻擋", value: runAvailable ? summary.block : "--", tone: "down" },
          { label: "可用", value: runAvailable ? summary.quality.strategyReady : "--", tone: runAvailable && summary.quality.strategyReady > 0 ? "up" : "muted" },
        ]}
        columns={6}
      />

      <div className="company-grid">
        <div>
          <Panel code="RUN-QRY" title="查詢條件" sub="策略批次 / 唯讀" right={stateLabel(result.state)}>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            {run && (
              <div style={{ border: "1px solid var(--night-rule-strong)" }}>
                {Object.entries(run.query).map(([key, value]) => (
                  <div className="row limit-row" key={key}>
                    <span className="tg gold">{key}</span>
                    <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{formatQueryValue(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel code="RUN-IDEA" title="候選股票" sub="公司連結與轉單狀態" right={runAvailable ? `${outputs.length} 筆` : stateLabel(result.state)}>
            {!runAvailable && (
              <div className="terminal-note">
                <span className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</span> {unavailableReason}
              </div>
            )}
            {runAvailable && outputs.length === 0 && (
              <div className="terminal-note">
                <span className="tg gold">無資料</span> 此批次沒有候選股票。
              </div>
            )}
            {runAvailable && outputs.map((idea) => (
              <div className="row idea-row" style={runIdeaRowWithPromoteStyle} key={`${idea.companyId}-${idea.symbol}`}>
                <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
                <span className={`tg ${directionTone(idea.direction)}`}>{directionLabel(idea.direction)}</span>
                <span className="num">{idea.score.toFixed(1)}</span>
                <span className={`tg ${decisionTone(idea.marketDecision)}`}>{decisionLabel(idea.marketDecision)}</span>
                <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {idea.companyName} / {idea.topThemeName ?? "未連結主題"} / {idea.primaryReason}
                </span>
                <Link href={`/companies/${idea.symbol}`} className="mini-button">公司</Link>
                <PromotionBlockedCell />
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="RUN-OUT" title="結果分布" sub="後端摘要" right={run?.id ?? "暫停"}>
            {!runAvailable && (
              <div className="terminal-note">
                <span className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</span> {unavailableReason}
              </div>
            )}
            {runAvailable && (
              <>
                {[
                  ["可觀察", summary.allow, "up"],
                  ["待審", summary.review, "gold"],
                  ["阻擋", summary.block, "down"],
                  ["偏多", summary.bullish, "up"],
                  ["偏空", summary.bearish, "down"],
                  ["中性", summary.neutral, "muted"],
                ].map(([label, value, tone]) => (
                  <div style={{ padding: "10px 0", borderBottom: "1px solid var(--night-rule)" }} key={label}>
                    <div className="tg" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{label}</span><span className={String(tone)}>{value}</span>
                    </div>
                    <div className="bar" style={{ marginTop: 8 }}>
                      <span style={{ width: barWidth(Number(value), Math.max(1, summary.total)), background: tone === "gold" ? "var(--gold-bright)" : tone === "up" ? "var(--tw-up-bright)" : tone === "down" ? "var(--tw-dn-bright)" : "var(--night-mid)" }} />
                    </div>
                  </div>
                ))}
                <div className="tg soft" style={{ display: "grid", gap: 6, padding: "12px 0" }}>
                  <span>產生：{formatDateTime(run.generatedAt)}</span>
                  <span>平均信心：{outputs.length ? percent(outputs.reduce((sum, item) => sum + item.confidence, 0) / outputs.length) : "--"}</span>
                  <span>寫入邊界：下單/執行控制在後端契約與風控 gate 通過前保持隱藏。</span>
                </div>
              </>
            )}
          </Panel>

          <Panel code="RUN-LIN" title="批次脈絡" sub="較新 / 較舊批次" right="瀏覽">
            {!runAvailable && <div className="terminal-note"><span className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</span> {unavailableReason}</div>}
            {runAvailable && lineage.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 沒有可用批次脈絡。</div>}
            {runAvailable && lineage.map(({ label, item }) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "70px 1fr" }} key={label}>
                <span className="tg gold">{label}</span>
                {item ? (
                  <Link href={`/runs/${encodeURIComponent(item.id)}`} className="tg">{item.id} / {modeLabel(item.decisionMode)}</Link>
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
