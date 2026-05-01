import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { listStrategyRuns } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

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

function decisionModeLabel(value: string) {
  if (value === "paper") return "模擬";
  if (value === "live") return "實盤";
  return value;
}

function directionLabel(value: string) {
  if (value === "bullish") return "偏多";
  if (value === "bearish") return "偏空";
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
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{stateLabel(result.state)}</span>
      <span>來源：{result.source}</span>
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
      sub="策略產出紀錄"
      note="策略批次 / 正式資料庫；本頁只讀，永遠不送出委託。"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "批次", value: statsAvailable ? result.data.total : "--" },
          { label: "可觀察", value: statsAvailable ? totals.allow : "--", tone: "up" },
          { label: "待審", value: statsAvailable ? totals.review : "--", tone: "gold" },
          { label: "阻擋", value: statsAvailable ? totals.block : "--", tone: "down" },
          { label: "可用", value: statsAvailable ? counts.ready : "--", tone: statsAvailable && counts.ready > 0 ? "up" : "muted" },
          { label: "信心", value: statsAvailable && result.data.items.length ? percent(avgConfidence) : "--" },
        ]}
        columns={7}
      />

      <Panel
        code="RUN-TBL"
        title={`${formatTime(result.updatedAt)} 台北`}
        sub="策略批次 / 模擬決策 / 只讀"
        right={stateLabel(result.state)}
      >
        <SourceLine result={result} />
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <>
            <div className="row position-row table-head tg" style={{ gridTemplateColumns: "170px 136px 86px 72px 72px 72px 1fr 80px" }}>
              <span>ID</span><span>產生</span><span>模式</span><span>可觀察</span><span>待審</span><span>阻擋</span><span>主要想法</span><span>明細</span>
            </div>
            {result.data.items.map((run) => (
              <Link
                href={`/runs/${encodeURIComponent(run.id)}`}
                className="row position-row"
                style={{ gridTemplateColumns: "170px 136px 86px 72px 72px 72px 1fr 80px" }}
                key={run.id}
              >
                <span className="tg gold">{run.id}</span>
                <span className="tg soft">{formatDateTime(run.generatedAt)}</span>
                <span className="tg">{decisionModeLabel(run.decisionMode)}</span>
                <span className={`num ${decisionTone("allow")}`}>{run.summary.allow}</span>
                <span className={`num ${decisionTone("review")}`}>{run.summary.review}</span>
                <span className={`num ${decisionTone("block")}`}>{run.summary.block}</span>
                <span className="tg soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {run.topIdea ? `${run.topIdea.symbol} / ${directionLabel(run.topIdea.direction)} / ${run.topIdea.score.toFixed(1)} / ${run.topSymbols.join(", ")}` : "無主要想法"}
                </span>
                <span className="mini-button">查看</span>
              </Link>
            ))}
          </>
        )}
      </Panel>

      <Panel code="RUN-QA" title="真實狀態檢查" sub="端點真實性 / 不靜默造假" right={result.source}>
        <div className="tg soft" style={{ display: "grid", gap: 6, paddingBottom: 12 }}>
          <span>來源：{result.source}</span>
          <span>
            品質：{statsAvailable ? `可用 ${counts.ready} / 參考 ${counts.reference} / 不足 ${counts.insufficient}` : "策略批次來源恢復前維持暫停"}
          </span>
          <span>寫入政策：只看列表與明細；策略執行與下單不在本頁。</span>
        </div>
      </Panel>
    </PageFrame>
  );
}
