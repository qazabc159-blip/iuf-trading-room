import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { listStrategyRuns } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanNarrativeText } from "@/lib/operator-copy";
import { reasonLabel } from "@/lib/strategy-vocab";

export const dynamic = "force-dynamic";

type RunsView = Awaited<ReturnType<typeof listStrategyRuns>>["data"];
type RunRow = RunsView["items"][number];
type LoadState =
  | { state: "LIVE"; data: RunsView; updatedAt: string; source: string }
  | { state: "EMPTY"; data: RunsView; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: RunsView; updatedAt: string; source: string; reason: string };

const emptyRuns: RunsView = {
  total: 0,
  items: [],
};

async function loadRuns(): Promise<LoadState> {
  const source = "策略批次資料庫";
  const updatedAt = new Date().toISOString();

  try {
    const envelope = await listStrategyRuns({
      decisionMode: "paper",
      limit: 50,
      sort: "created_at",
    });
    const data = envelope.data;
    if (data.items.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "策略批次目前回傳 0 筆，不顯示假批次紀錄。",
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyRuns,
      updatedAt,
      source,
      reason: friendlyDataError(error, "策略批次暫時無法讀取。"),
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
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function decisionModeLabel(value: string) {
  if (value === "paper") return "模擬候選";
  if (value === "live") return "正式模式";
  if (value === "strategy") return "策略篩選";
  return value;
}

function directionLabel(value: string) {
  if (value === "bullish") return "看多";
  if (value === "bearish") return "看空";
  if (value === "neutral") return "中性";
  return value;
}

function decisionTone(decision: RunRow["summary"] extends { allow: number } ? "allow" | "review" | "block" : never) {
  if (decision === "allow") return "up";
  if (decision === "review") return "gold";
  return "down";
}

function qualityPrimary(view: RunsView) {
  const counts = view.items.reduce(
    (acc, run) => {
      acc.ready += run.quality.strategyReady;
      acc.reference += run.quality.referenceOnly;
      acc.insufficient += run.quality.insufficient;
      return acc;
    },
    { ready: 0, reference: 0, insufficient: 0 }
  );
  return counts;
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="runs-source-line">
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{stateLabel(result.state)}</span>
      <span>來源：{result.source}</span>
      <span>更新 {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function shortRunId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function modeCopy(value: string) {
  if (value === "paper") return "只產生模擬候選，不會送單";
  if (value === "strategy") return "僅做策略篩選，不連交易流程";
  if (value === "live") return "正式模式需後端與風控 gate 明確放行";
  return "讀取後端批次設定";
}

function topIdeaText(run: RunRow) {
  if (!run.topIdea) return "此批次沒有主要候選；保留批次紀錄，不產生假結論。";
  const idea = run.topIdea;
  const reason = reasonLabel(idea.primaryReason);
  return cleanNarrativeText(
    `${idea.symbol} ${idea.companyName} / ${directionLabel(idea.direction)} / ${reason}`,
    `${idea.symbol} ${idea.companyName} / ${directionLabel(idea.direction)} / 原因待後端整理`
  );
}

function qualityText(run: RunRow) {
  const reason = reasonLabel(run.quality.primaryReason);
  return cleanNarrativeText(reason, "品質原因待後端整理。");
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

export default async function RunsPage() {
  const result = await loadRuns();
  const statsAvailable = result.state !== "BLOCKED";
  const counts = qualityPrimary(result.data);
  const totals = result.data.items.reduce(
    (acc, run) => {
      acc.allow += run.summary.allow;
      acc.review += run.summary.review;
      acc.block += run.summary.block;
      return acc;
    },
    { allow: 0, review: 0, block: 0 }
  );
  const avgConfidence = result.data.items.length
    ? result.data.items.reduce((sum, run) => sum + (run.topIdea?.confidence ?? 0), 0) / result.data.items.length
    : 0;

  return (
    <PageFrame
      code="05"
      title="策略批次"
      sub="候選名單快照"
      note="策略批次 / 正式資料庫；每一批都是一次策略篩選快照，本頁只讀，永遠不送出委託。"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "批次", value: statsAvailable ? result.data.total : "--" },
          { label: "可觀察", value: statsAvailable ? totals.allow : "--", tone: "status-ok" },
          { label: "待審", value: statsAvailable ? totals.review : "--", tone: "gold" },
          { label: "阻擋", value: statsAvailable ? totals.block : "--", tone: "status-bad" },
          { label: "可用", value: statsAvailable ? counts.ready : "--", tone: statsAvailable && counts.ready > 0 ? "status-ok" : "muted" },
          { label: "信心", value: statsAvailable && result.data.items.length ? percent(avgConfidence) : "--" },
        ]}
        columns={7}
      />

      <section className="runs-command-deck">
        <div>
          <span className="tg gold">策略批次 / 批次監控</span>
          <h2>這裡不是下單台，是策略引擎每次篩選留下的候選快照。</h2>
          <p>
            每一個批次記錄當時的資料條件、候選股票、品質原因與可觀察狀態。
            只有後端風控與轉單契約完成後，候選才會進入模擬委託預覽；本頁永遠不直接送單。
          </p>
        </div>
        <div className="runs-command-rail">
          <span>資料狀態</span>
          <strong className={stateTone(result.state)}>{stateLabel(result.state)}</strong>
          <span>{result.source}</span>
        </div>
      </section>

      <div className="runs-layout">
        <Panel
          code="RUN-Q"
          title="批次佇列"
          sub="策略批次 / 模擬候選 / 只讀"
          right={stateLabel(result.state)}
        >
          <SourceLine result={result} />
          <EmptyOrBlocked result={result} />
          {result.state === "LIVE" && (
            <div className="run-card-grid">
              {result.data.items.map((run) => (
                <Link href={`/runs/${encodeURIComponent(run.id)}`} className="run-card" key={run.id}>
                  <div className="run-card-head">
                    <span className="tg gold">批次 {shortRunId(run.id)}</span>
                    <span className="tc">{formatDateTime(run.generatedAt)}</span>
                  </div>
                  <div className="run-card-titleline">
                    <strong>{decisionModeLabel(run.decisionMode)}</strong>
                    <span>{modeCopy(run.decisionMode)}</span>
                  </div>
                  <div className="run-card-metrics">
                    <span><b className={decisionTone("allow")}>{run.summary.allow}</b><small>可觀察</small></span>
                    <span><b className={decisionTone("review")}>{run.summary.review}</b><small>待審</small></span>
                    <span><b className={decisionTone("block")}>{run.summary.block}</b><small>阻擋</small></span>
                    <span><b>{run.quality.strategyReady}</b><small>可用</small></span>
                  </div>
                  <p>{topIdeaText(run)}</p>
                  <div className="run-card-foot">
                    <span>{qualityText(run)}</span>
                    <span className="mini-button">看明細</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel code="RUN-QA" title="真實狀態檢查" sub="端點真實性 / 不靜默造假" right={result.source}>
          <div className="runs-truth-stack">
            <span>來源：{result.source}</span>
            <span>
              品質：{statsAvailable ? `可用 ${counts.ready} / 參考 ${counts.reference} / 不足 ${counts.insufficient}` : "策略批次來源恢復前維持暫停"}
            </span>
            <span>寫入政策：本頁只看列表與明細；策略執行、轉單與下單不在本頁。</span>
            <span>轉單狀態：後端預覽契約尚未啟用前，前端只顯示候選與風險原因。</span>
          </div>
        </Panel>
      </div>
    </PageFrame>
  );
}
