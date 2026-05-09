import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { getStrategyIdeas } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanNarrativeText } from "@/lib/operator-copy";
import { formatSourceTimestamp, sourceFreshnessLabel } from "@/lib/source-freshness";
import { reasonLabel } from "@/lib/strategy-vocab";

export const dynamic = "force-dynamic";

type IdeasView = Awaited<ReturnType<typeof getStrategyIdeas>>["data"];
type IdeaRow = IdeasView["items"][number];
type LoadState =
  | { state: "LIVE"; data: IdeasView; updatedAt: string; source: string }
  | { state: "EMPTY"; data: IdeasView; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: IdeasView; updatedAt: string; source: string; reason: string };

const emptyIdeas: IdeasView = {
  generatedAt: new Date(0).toISOString(),
  summary: { total: 0, allow: 0, review: 0, block: 0, bullish: 0, bearish: 0, neutral: 0,
    quality: { strategyReady: 0, referenceOnly: 0, insufficient: 0, primaryReasons: [] } },
  items: [],
};

async function loadIdeas(): Promise<LoadState> {
  const source = "正式策略資料";
  const updatedAt = new Date().toISOString();
  try {
    const envelope = await getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 30, sort: "score" });
    const data = envelope.data;
    if (data.items.length === 0) {
      return { state: "EMPTY", data, updatedAt: data.generatedAt || updatedAt, source, reason: "目前沒有可顯示的正式策略想法。" };
    }
    return { state: "LIVE", data, updatedAt: data.generatedAt || updatedAt, source };
  } catch (error) {
    return { state: "BLOCKED", data: emptyIdeas, updatedAt, source, reason: friendlyDataError(error, "策略想法暫時無法讀取。") };
  }
}

function formatTime(v: string | null | undefined) {
  if (!v) return "--";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDateTime(v: string | null | undefined) {
  if (!v) return "--";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function percent(v: number) { return `${Math.round(v * 100)}%`; }

function stateTone(s: LoadState["state"]): "ok" | "warn" | "bad" {
  return s === "LIVE" ? "ok" : s === "EMPTY" ? "warn" : "bad";
}
function stateLabel(s: LoadState["state"]) {
  return s === "LIVE" ? "正常" : s === "EMPTY" ? "無資料" : "暫停";
}
function directionLabel(d: IdeaRow["direction"]) {
  return d === "bullish" ? "偏多" : d === "bearish" ? "偏空" : "中性";
}
function decisionLabel(d: IdeaRow["marketData"]["decision"]) {
  return d === "allow" ? "可觀察" : d === "review" ? "待審" : "不進流程";
}
function decisionTone(d: IdeaRow["marketData"]["decision"]): "ok" | "warn" | "bad" {
  return d === "allow" ? "ok" : d === "review" ? "warn" : "bad";
}
function directionState(d: IdeaRow["direction"]): "ok" | "review" | "blue" {
  return d === "bullish" ? "ok" : d === "bearish" ? "review" : "blue";
}
function reasonText(v: string | null | undefined) {
  return cleanNarrativeText(reasonLabel(v), "原因尚未完成中文整理。");
}
function qualityLabel(g: IdeaRow["quality"]["grade"]) {
  return g === "strategy_ready" ? "可策略觀察" : g === "reference_only" ? "僅供參考" : "資料不足";
}
function qualityBadge(g: IdeaRow["quality"]["grade"]): "ok" | "warn" | "bad" {
  return g === "strategy_ready" ? "ok" : g === "reference_only" ? "warn" : "bad";
}
function readinessLabel(v: IdeaRow["marketData"]["readiness"]) {
  return v === "ready" ? "資料可用" : v === "degraded" ? "資料待補" : "資料不足";
}
function freshnessLabel(v: IdeaRow["marketData"]["freshnessStatus"]) {
  return v === "fresh" ? "資料新鮮" : v === "stale" ? "資料偏舊" : "缺資料";
}
function ideaSummary(idea: IdeaRow) {
  const theme = idea.topThemes[0]?.name ?? "尚未連結主題";
  return cleanNarrativeText(
    `${idea.companyName} / ${theme} / ${reasonText(idea.rationale.primaryReason)}`,
    `${idea.companyName} / ${theme} / 策略理由尚未整理完成。`
  );
}
function companyPaperHref(symbol: string) { return `/companies/${encodeURIComponent(symbol)}#paper-order`; }

function IdeaCard({ idea }: { idea: IdeaRow }) {
  const themes = idea.topThemes.length ? idea.topThemes : [];
  return (
    <article className="parity-card" data-state={directionState(idea.direction)}>
      <div className="parity-card-eyebrow">
        <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
        <span className={`parity-badge ${qualityBadge(idea.quality.grade)}`}>{qualityLabel(idea.quality.grade)}</span>
        <span className="spacer" />
        <span className={`parity-badge ${decisionTone(idea.marketData.decision)}`}>{decisionLabel(idea.marketData.decision)}</span>
      </div>
      <div className="parity-card-title">{idea.companyName}</div>
      <div className="parity-card-sub">{ideaSummary(idea)}</div>
      {themes.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {themes.map((t) => <span key={t.themeId} className="parity-badge warn">{t.name}</span>)}
        </div>
      )}
      <div className="parity-card-metrics">
        <span><b className="num">{idea.score.toFixed(1)}</b><small>分數</small></span>
        <span><b className="num">{percent(idea.confidence)}</b><small>信心</small></span>
        <span><b className="num">{idea.signalCount}</b><small>訊號</small></span>
        <span><b>{directionLabel(idea.direction)}</b><small>方向</small></span>
      </div>
      <div className="parity-card-foot">
        <Link href={`/companies/${idea.symbol}`}>公司頁</Link>
        <Link href={companyPaperHref(idea.symbol)}>紙上預覽</Link>
        <span style={{ marginLeft: "auto", color: "var(--night-soft)", fontSize: 11 }}>
          {readinessLabel(idea.marketData.readiness)} / {freshnessLabel(idea.marketData.freshnessStatus)}
        </span>
      </div>
    </article>
  );
}

export default async function IdeasPage() {
  const result = await loadIdeas();
  const summary = result.data.summary;
  const statsAvailable = result.state !== "BLOCKED";
  const topReason = summary.quality.primaryReasons[0]?.reason ?? null;
  const freshness = result.state === "LIVE" ? sourceFreshnessLabel(result.updatedAt) : null;
  const avgConf = result.state === "LIVE" && result.data.items.length
    ? result.data.items.reduce((s, i) => s + i.confidence, 0) / result.data.items.length : null;

  return (
    <PageFrame code="04" title="策略想法" sub="台股候選工作台"
      note="策略想法 / 正式策略資料；只做候選觀察與品質揭露，轉成模擬委託前維持暫停。">
      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">資料狀態</span>
          <span className={`parity-kpi-value ${stateTone(result.state)}`}>{stateLabel(result.state)}</span>
          <span className="parity-kpi-sub">{result.source}</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">總候選</span>
          <span className="parity-kpi-value">{statsAvailable ? summary.total : "--"}</span>
          <span className="parity-kpi-sub">候選想法</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">可觀察</span>
          <span className="parity-kpi-value ok">{statsAvailable ? summary.allow : "--"}</span>
          <span className="parity-kpi-sub">通過決策門</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">待審</span>
          <span className="parity-kpi-value warn">{statsAvailable ? summary.review : "--"}</span>
          <span className="parity-kpi-sub">資料或訊號不足</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">不進流程</span>
          <span className="parity-kpi-value bad">{statsAvailable ? summary.block : "--"}</span>
          <span className="parity-kpi-sub">市場或品質阻擋</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">資料足夠</span>
          <span className={`parity-kpi-value ${statsAvailable && summary.quality.strategyReady > 0 ? "ok" : "dim"}`}>
            {statsAvailable ? summary.quality.strategyReady : "--"}
          </span>
          <span className="parity-kpi-sub">可策略觀察</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">平均信心</span>
          <span className="parity-kpi-value">{avgConf !== null ? percent(avgConf) : "--"}</span>
          <span className="parity-kpi-sub">{freshness ? freshness.label : "更新 " + formatTime(result.updatedAt)}</span>
        </div>
      </div>

      <div className="parity-hero">
        <div className="parity-hero-eyebrow">IUF / STRATEGY IDEAS / 候選工作台</div>
        <h2>先看資料是否夠真，再看股票是否值得追蹤。</h2>
        <p>這頁只呈現系統整理出的台股候選、主題連結、訊號數與資料品質。它不是買賣建議，也不是下單頁；候選只能先進公司頁查看 K 線、來源狀態與紙上預覽。</p>
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
            <h3>候選清單</h3>
            <span className="spacer" />
            <span className="parity-badge ok">正常</span>
            {freshness && <span className={`parity-badge ${freshness.tone === "status-ok" ? "ok" : "warn"}`}>{freshness.label}</span>}
            <span className="tg muted" style={{ fontSize: 10 }}>產生：{formatDateTime(result.data.generatedAt)}</span>
          </div>
          <div className="parity-section-body">
            <div className="parity-card-grid">
              {result.data.items.map((idea) => <IdeaCard idea={idea} key={`${idea.companyId}-${idea.symbol}`} />)}
            </div>
          </div>
        </section>
      )}

      {result.state === "LIVE" && result.data.items.length === 0 && (
        <div className="parity-empty">
          <div className="parity-empty-icon">∅</div>
          <h3>目前沒有候選想法</h3>
          <p>策略想法尚未產生，或市場資料還未到齊。請等待下一次批次執行後再查看。</p>
        </div>
      )}

      {statsAvailable && (
        <section className="parity-section" style={{ marginTop: 20 }}>
          <div className="parity-section-head">
            <h3>品質總覽</h3>
            <span className="spacer" />
            {topReason && <span className="tg muted" style={{ fontSize: 10 }}>{reasonText(topReason)}</span>}
          </div>
          <div className="parity-section-body">
            <div className="parity-kpi-bar" style={{ margin: 0 }}>
              <div className="parity-kpi-cell"><span className="parity-kpi-label">偏多</span><span className="parity-kpi-value ok">{summary.bullish}</span></div>
              <div className="parity-kpi-cell"><span className="parity-kpi-label">偏空</span><span className="parity-kpi-value bad">{summary.bearish}</span></div>
              <div className="parity-kpi-cell"><span className="parity-kpi-label">中性</span><span className="parity-kpi-value dim">{summary.neutral}</span></div>
              <div className="parity-kpi-cell"><span className="parity-kpi-label">策略可用</span><span className="parity-kpi-value ok">{summary.quality.strategyReady}</span></div>
              <div className="parity-kpi-cell"><span className="parity-kpi-label">僅供參考</span><span className="parity-kpi-value warn">{summary.quality.referenceOnly}</span></div>
              <div className="parity-kpi-cell"><span className="parity-kpi-label">資料不足</span><span className="parity-kpi-value bad">{summary.quality.insufficient}</span></div>
            </div>
            <p style={{ marginTop: 12, color: "var(--night-soft)", fontSize: 13, lineHeight: 1.75 }}>
              轉入委託流程仍暫停；本頁只引導到公司頁紙上預覽，不建立券商委託。
            </p>
          </div>
        </section>
      )}
    </PageFrame>
  );
}
