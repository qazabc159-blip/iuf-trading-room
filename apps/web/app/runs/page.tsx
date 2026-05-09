import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
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

const emptyRuns: RunsView = { total: 0, items: [] };

function userFacingReason(error: unknown, fallback: string) {
  return friendlyDataError(error, fallback)
    .replace(/token|secret|session|cookie|authorization|bearer|api[-_]?key|env|database|redis|model|chain/gi, "資料來源");
}

async function loadRuns(): Promise<LoadState> {
  const source = "量化研究批次";
  const updatedAt = new Date().toISOString();
  try {
    const envelope = await listStrategyRuns({ decisionMode: "paper", limit: 50, sort: "created_at" });
    const data = envelope.data;
    if (data.items.length === 0) {
      return { state: "EMPTY", data, updatedAt, source, reason: "目前沒有紙上交易研究批次；等候選資料與市場資料到齊後再產生。" };
    }
    return { state: "LIVE", data, updatedAt: latestIso(data.items.map((r) => r.generatedAt)) ?? updatedAt, source };
  } catch (error) {
    return { state: "BLOCKED", data: emptyRuns, updatedAt, source, reason: userFacingReason(error, "量化研究讀取失敗") };
  }
}

function formatDateTime(v: string | null | undefined) {
  if (!v) return "--";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function percent(v: number) { return `${Math.round(v * 100)}%`; }
function stateTone(s: LoadState["state"]): "ok" | "warn" | "bad" { return s === "LIVE" ? "ok" : s === "EMPTY" ? "warn" : "bad"; }
function stateLabel(s: LoadState["state"]) { return s === "LIVE" ? "可用" : s === "EMPTY" ? "尚無批次" : "需處理"; }
function decisionModeLabel(v: string) {
  return v === "paper" ? "紙上交易研究" : v === "live" ? "實盤前檢查" : v === "strategy" ? "策略研究" : v;
}
function directionLabel(v: string) {
  return v === "bullish" ? "偏多研究" : v === "bearish" ? "偏空研究" : v === "neutral" ? "中性觀察" : v;
}
function qualityPrimary(view: RunsView) {
  return view.items.reduce((acc, r) => {
    acc.ready += r.quality.strategyReady;
    acc.reference += r.quality.referenceOnly;
    acc.insufficient += r.quality.insufficient;
    return acc;
  }, { ready: 0, reference: 0, insufficient: 0 });
}
function shortRunId(id: string) { return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id; }
function topIdeaText(run: RunRow) {
  if (!run.topIdea) return "這個批次沒有足夠候選，不產生交易訊號。";
  const idea = run.topIdea;
  return cleanNarrativeText(
    `${idea.symbol} ${idea.companyName} / ${directionLabel(idea.direction)} / ${reasonLabel(idea.primaryReason)}`,
    `${idea.symbol} ${idea.companyName} / 研究候選 / 資料理由待確認`
  );
}
function qualityText(run: RunRow) {
  return cleanNarrativeText(reasonLabel(run.quality.primaryReason), "資料品質待確認");
}

export default async function RunsPage() {
  const result = await loadRuns();
  const statsAvailable = result.state !== "BLOCKED";
  const counts = qualityPrimary(result.data);
  const totals = result.data.items.reduce((acc, r) => {
    acc.allow += r.summary.allow; acc.review += r.summary.review; acc.block += r.summary.block;
    return acc;
  }, { allow: 0, review: 0, block: 0 });
  const avgConf = result.data.items.length
    ? result.data.items.reduce((s, r) => s + (r.topIdea?.confidence ?? 0), 0) / result.data.items.length : 0;
  const freshness = result.state === "LIVE" ? sourceFreshnessLabel(result.updatedAt) : null;

  return (
    <PageFrame code="05" title="策略批次" sub="候選批次、資料品質與紙上交易入口"
      note="這裡只顯示研究狀態與候選理由；未驗證績效不展示，也不提供買賣建議。">
      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">研究狀態</span>
          <span className={`parity-kpi-value ${stateTone(result.state)}`}>{stateLabel(result.state)}</span>
          <span className="parity-kpi-sub">{result.source}</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">批次</span>
          <span className="parity-kpi-value">{statsAvailable ? result.data.total : "--"}</span>
          <span className="parity-kpi-sub">研究批次</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">可進研究</span>
          <span className="parity-kpi-value ok">{statsAvailable ? totals.allow : "--"}</span>
          <span className="parity-kpi-sub">通過門控</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">待審</span>
          <span className="parity-kpi-value warn">{statsAvailable ? totals.review : "--"}</span>
          <span className="parity-kpi-sub">需確認</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">不進流程</span>
          <span className="parity-kpi-value bad">{statsAvailable ? totals.block : "--"}</span>
          <span className="parity-kpi-sub">市場阻擋</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">資料足夠</span>
          <span className={`parity-kpi-value ${statsAvailable && counts.ready > 0 ? "ok" : "dim"}`}>
            {statsAvailable ? counts.ready : "--"}
          </span>
          <span className="parity-kpi-sub">可策略觀察</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">平均信心</span>
          <span className="parity-kpi-value">{statsAvailable && result.data.items.length ? percent(avgConf) : "--"}</span>
          <span className="parity-kpi-sub">{freshness ? freshness.label : formatSourceTimestamp(result.updatedAt)}</span>
        </div>
      </div>

      <div className="parity-hero">
        <div className="parity-hero-eyebrow">IUF / STRATEGY RUNS / 研究批次</div>
        <h2>先確認候選資料足夠，再進紙上交易驗證。</h2>
        <p>批次把市場資料、公司資料與候選理由整理在一起。頁面呈現的是研究可用性，不是績效宣傳，也不是買賣建議。</p>
      </div>

      {result.state !== "LIVE" && (
        <div className="terminal-note">
          <span className={`tg ${result.state === "EMPTY" ? "gold" : "status-bad"}`}>{stateLabel(result.state)}</span>{" "}
          {"reason" in result ? result.reason : ""}
        </div>
      )}

      {result.state === "LIVE" && result.data.items.length > 0 && (
        <section className="parity-section">
          <div className="parity-section-head">
            <h3>研究批次清單</h3>
            <span className="spacer" />
            <span className="parity-badge ok">{stateLabel(result.state)}</span>
            {freshness && <span className={`parity-badge ${freshness.tone === "status-ok" ? "ok" : "warn"}`}>{freshness.label}</span>}
          </div>
          <div className="parity-section-body">
            <div className="parity-card-grid">
              {result.data.items.map((run) => (
                <Link href={`/runs/${encodeURIComponent(run.id)}`} key={run.id} style={{ textDecoration: "none" }}>
                  <article className="parity-card" data-state="review">
                    <div className="parity-card-eyebrow">
                      <span className="tg gold">批次 {shortRunId(run.id)}</span>
                      <span className="spacer" />
                      <span className="parity-badge warn">{decisionModeLabel(run.decisionMode)}</span>
                      <span className="tg muted" style={{ fontSize: 10 }}>{formatDateTime(run.generatedAt)}</span>
                    </div>
                    <div className="parity-card-sub">{topIdeaText(run)}</div>
                    <div className="parity-card-metrics">
                      <span><b className="ok">{run.summary.allow}</b><small>可進研究</small></span>
                      <span><b className="warn">{run.summary.review}</b><small>待審</small></span>
                      <span><b className="bad">{run.summary.block}</b><small>不進流程</small></span>
                      <span><b>{run.quality.strategyReady}</b><small>資料足夠</small></span>
                    </div>
                    <div style={{ paddingTop: 10, borderTop: "1px solid var(--night-rule)", fontSize: 11, color: "var(--night-soft)" }}>
                      {qualityText(run)}
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {result.state === "LIVE" && result.data.items.length === 0 && (
        <div className="parity-empty">
          <div className="parity-empty-icon">∅</div>
          <h3>目前沒有批次</h3>
          <p>等候選資料與市場資料到齊後，系統會自動產生研究批次。</p>
        </div>
      )}
    </PageFrame>
  );
}
