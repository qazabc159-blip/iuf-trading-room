import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { listStrategyRuns } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanNarrativeText } from "@/lib/operator-copy";
import { formatSourceTimestamp, latestIso, sourceFreshnessLabel } from "@/lib/source-freshness";
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

function userFacingReason(error: unknown, fallback: string) {
  return friendlyDataError(error, fallback)
    .replace(/token|secret|session|cookie|authorization|bearer|api[-_]?key|env|database|redis|model|chain/gi, "資料來源");
}

async function loadRuns(): Promise<LoadState> {
  const source = "量化研究批次";
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
        reason: "目前沒有紙上交易研究批次；等候選資料與市場資料到齊後再產生。",
      };
    }
    return {
      state: "LIVE",
      data,
      updatedAt: latestIso(data.items.map((run) => run.generatedAt)) ?? updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyRuns,
      updatedAt,
      source,
      reason: userFacingReason(error, "量化研究讀取失敗"),
    };
  }
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
  if (state === "LIVE") return "可用";
  if (state === "EMPTY") return "尚無批次";
  return "需處理";
}

function decisionModeLabel(value: string) {
  if (value === "paper") return "紙上交易研究";
  if (value === "live") return "實盤前檢查";
  if (value === "strategy") return "策略研究";
  return value;
}

function directionLabel(value: string) {
  if (value === "bullish") return "偏多研究";
  if (value === "bearish") return "偏空研究";
  if (value === "neutral") return "中性觀察";
  return value;
}

function decisionTone(decision: "allow" | "review" | "block") {
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
  const freshness = result.state === "LIVE" ? sourceFreshnessLabel(result.updatedAt) : null;
  return (
    <div className="runs-source-line">
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{stateLabel(result.state)}</span>
      <span>來源：{result.source}</span>
      <span>更新 {formatSourceTimestamp(result.updatedAt)}</span>
      {freshness && <span className={`tg ${freshness.tone}`}>{freshness.label}</span>}
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function shortRunId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function modeCopy(value: string) {
  if (value === "paper") return "只產生紙上交易候選與風控檢查。";
  if (value === "strategy") return "研究模式，只看資料品質與候選理由。";
  if (value === "live") return "實盤前檢查，不在頁面送出委託。";
  return "研究批次。";
}

function topIdeaText(run: RunRow) {
  if (!run.topIdea) return "這個批次沒有足夠候選，不產生交易訊號。";
  const idea = run.topIdea;
  const reason = reasonLabel(idea.primaryReason);
  return cleanNarrativeText(
    `${idea.symbol} ${idea.companyName} / ${directionLabel(idea.direction)} / ${reason}`,
    `${idea.symbol} ${idea.companyName} / 研究候選 / 資料理由待確認`
  );
}

function qualityText(run: RunRow) {
  const reason = reasonLabel(run.quality.primaryReason);
  return cleanNarrativeText(reason, "資料品質待確認");
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
      sub="候選批次、資料品質與紙上交易入口"
      note="這裡只顯示研究狀態與候選理由；未驗證績效不展示，也不提供買賣建議。"
    >
      <MetricStrip
        cells={[
          { label: "研究狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "批次", value: statsAvailable ? result.data.total : "--" },
          { label: "可進研究", value: statsAvailable ? totals.allow : "--", tone: "status-ok" },
          { label: "待審", value: statsAvailable ? totals.review : "--", tone: "gold" },
          { label: "不進流程", value: statsAvailable ? totals.block : "--", tone: "status-bad" },
          { label: "資料足夠", value: statsAvailable ? counts.ready : "--", tone: statsAvailable && counts.ready > 0 ? "status-ok" : "muted" },
          { label: "平均信心", value: statsAvailable && result.data.items.length ? percent(avgConfidence) : "--" },
        ]}
        columns={7}
      />

      <section className="runs-command-deck">
        <div>
          <span className="tg gold">策略批次 / 紙上交易研究</span>
          <h2>先確認候選資料足夠，再進紙上交易驗證。</h2>
          <p>
            批次把市場資料、公司資料與候選理由整理在一起。頁面呈現的是研究可用性，不是績效宣傳，也不是買賣建議。
          </p>
        </div>
        <div className="runs-command-rail">
          <span>研究狀態</span>
          <strong className={stateTone(result.state)}>{stateLabel(result.state)}</strong>
          <span>{result.source}</span>
        </div>
      </section>

      <div className="runs-layout">
        <Panel
          code="RUN-Q"
          title="研究批次"
          sub="紙上交易模式下的候選清單與資料品質。"
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
                    <span><b className={decisionTone("allow")}>{run.summary.allow}</b><small>可進研究</small></span>
                    <span><b className={decisionTone("review")}>{run.summary.review}</b><small>待審</small></span>
                    <span><b className={decisionTone("block")}>{run.summary.block}</b><small>不進流程</small></span>
                    <span><b>{run.quality.strategyReady}</b><small>資料足夠</small></span>
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

        <Panel code="RUN-QA" title="研究邊界" sub="避免把候選批次誤讀成績效或建議。" right={result.source}>
          <div className="runs-truth-stack">
            <span>資料品質：{statsAvailable ? `足夠 ${counts.ready} / 參考 ${counts.reference} / 不足 ${counts.insufficient}` : "等待讀取"}</span>
            <span>候選分數只代表研究排序，不等於未來報酬。</span>
            <span>批次只做紙上交易與研究入口，不會送真實委託。</span>
            <span>需要回到公司頁看 K 線、重大訊息、財務與 paper preview。</span>
          </div>
        </Panel>
      </div>
    </PageFrame>
  );
}
