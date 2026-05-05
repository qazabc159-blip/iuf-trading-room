import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
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
  summary: {
    total: 0,
    allow: 0,
    review: 0,
    block: 0,
    bullish: 0,
    bearish: 0,
    neutral: 0,
    quality: {
      strategyReady: 0,
      referenceOnly: 0,
      insufficient: 0,
      primaryReasons: [],
    },
  },
  items: [],
};

async function loadIdeas(): Promise<LoadState> {
  const source = "策略想法資料庫";
  const updatedAt = new Date().toISOString();

  try {
    const envelope = await getStrategyIdeas({
      decisionMode: "paper",
      includeBlocked: true,
      limit: 30,
      sort: "score",
    });
    const data = envelope.data;
    if (data.items.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt: data.generatedAt || updatedAt,
        source,
        reason: "正式策略想法資料庫目前回傳 0 筆。",
      };
    }
    return {
      state: "LIVE",
      data,
      updatedAt: data.generatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyIdeas,
      updatedAt,
      source,
      reason: friendlyDataError(error, "策略想法暫時無法讀取。"),
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

function directionLabel(direction: IdeaRow["direction"]) {
  if (direction === "bullish") return "看多";
  if (direction === "bearish") return "看空";
  return "中性";
}

function decisionLabel(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待審";
  return "阻擋";
}

function decisionTone(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return "up";
  if (decision === "review") return "gold";
  return "down";
}

function directionTone(direction: IdeaRow["direction"]) {
  if (direction === "bullish") return "up";
  if (direction === "bearish") return "down";
  return "muted";
}

function reasonText(value: string | null | undefined) {
  return cleanNarrativeText(reasonLabel(value), "原因尚未完成中文整理。");
}

function qualityLabel(grade: IdeaRow["quality"]["grade"]) {
  if (grade === "strategy_ready") return "可策略觀察";
  if (grade === "reference_only") return "僅供參考";
  return "資料不足";
}

function readinessLabel(value: IdeaRow["marketData"]["readiness"]) {
  if (value === "ready") return "資料可用";
  if (value === "degraded") return "資料降級";
  return "資料阻擋";
}

function freshnessLabel(value: IdeaRow["marketData"]["freshnessStatus"]) {
  if (value === "fresh") return "資料新鮮";
  if (value === "stale") return "資料偏舊";
  return "缺資料";
}

function qualityTone(grade: IdeaRow["quality"]["grade"]) {
  if (grade === "strategy_ready") return "status-ok";
  if (grade === "reference_only") return "gold";
  return "status-bad";
}

function ideaSummary(idea: IdeaRow) {
  const theme = idea.topThemes[0]?.name ?? "尚未連結主題";
  const primary = reasonText(idea.rationale.primaryReason);
  return cleanNarrativeText(
    `${idea.companyName} / ${theme} / ${primary}`,
    `${idea.companyName} / ${theme} / 策略理由尚未整理完成。`
  );
}

function sourceLabel(idea: IdeaRow) {
  return idea.marketData.selectedSource ?? "正式市場資料";
}

function PromotionBlockedCell() {
  return (
    <span
      className="idea-promotion-block"
      title="策略想法轉模擬委託的正式轉單端點尚未開通。"
    >
      轉單待接
    </span>
  );
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

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</span>{" "}
      {result.reason}
    </div>
  );
}

function IdeaRowView({ idea }: { idea: IdeaRow }) {
  const themes = idea.topThemes.length ? idea.topThemes : [];
  return (
    <article className="strategy-idea-card" key={`${idea.companyId}-${idea.symbol}`}>
      <div className="strategy-idea-head">
        <div className="strategy-idea-symbol">
          <Link href={`/companies/${idea.symbol}`} className="tg gold">
            {idea.symbol}
          </Link>
          <strong>{idea.companyName}</strong>
          <span>{idea.market} / {idea.beneficiaryTier}</span>
        </div>
        <div className="strategy-idea-actions">
          <span className={directionTone(idea.direction)}>{directionLabel(idea.direction)}</span>
          <Link href={`/companies/${idea.symbol}`} className="mini-button">公司頁</Link>
          <PromotionBlockedCell />
        </div>
      </div>

      <p className="strategy-idea-copy">{ideaSummary(idea)}</p>

      <div className="strategy-idea-metrics">
        <span><b>{idea.score.toFixed(1)}</b><small>分數</small></span>
        <span><b>{percent(idea.confidence)}</b><small>信心</small></span>
        <span><b>{idea.signalCount}</b><small>訊號</small></span>
        <span className={decisionTone(idea.marketData.decision)}>
          <b>{decisionLabel(idea.marketData.decision)}</b><small>決策</small>
        </span>
      </div>

      <div className="strategy-idea-tags">
        {themes.length ? themes.map((theme) => (
          <span key={theme.themeId}>{theme.name} / {theme.score.toFixed(0)}</span>
        )) : <span>尚未連結主題</span>}
      </div>

      <div className="strategy-idea-footer">
        <span className={qualityTone(idea.quality.grade)}>
          {qualityLabel(idea.quality.grade)} / {reasonText(idea.quality.primaryReason)}
        </span>
        <span>{readinessLabel(idea.marketData.readiness)} / {freshnessLabel(idea.marketData.freshnessStatus)}</span>
        <span>來源：{sourceLabel(idea)}</span>
      </div>
    </article>
  );
}

export default async function IdeasPage() {
  const result = await loadIdeas();
  const summary = result.data.summary;
  const statsAvailable = result.state !== "BLOCKED";
  const topReason = summary.quality.primaryReasons[0]?.reason ?? "尚無主要原因";

  return (
    <PageFrame
      code="04"
      title="策略想法"
      sub="台股候選工作台"
      note="策略想法 / 正式策略資料；只做候選觀察與品質揭露，轉成模擬委託前維持暫停。"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "總數", value: statsAvailable ? summary.total : "--" },
          { label: "可觀察", value: statsAvailable ? summary.allow : "--", tone: "status-ok" },
          { label: "待審", value: statsAvailable ? summary.review : "--", tone: "gold" },
          { label: "阻擋", value: statsAvailable ? summary.block : "--", tone: "status-bad" },
          { label: "可用", value: statsAvailable ? summary.quality.strategyReady : "--", tone: statsAvailable && summary.quality.strategyReady > 0 ? "status-ok" : "muted" },
          { label: "更新", value: formatTime(result.updatedAt) },
        ]}
        columns={7}
      />

      <section className="ideas-command-deck">
        <div>
          <span className="tg gold">策略想法 / 候選觀察</span>
          <h2>先看資料是否夠真，再看股票是否值得追蹤。</h2>
          <p>
            這頁只呈現後端策略引擎產出的台股候選、主題連結、訊號數與資料品質。
            它不是下單頁，也不會把任何候選直接變成委託。
          </p>
        </div>
        <div className="ideas-summary-grid">
          <span><b className="status-ok">{statsAvailable ? summary.allow : "--"}</b><small>可觀察</small></span>
          <span><b className="gold">{statsAvailable ? summary.review : "--"}</b><small>待審</small></span>
          <span><b className="status-bad">{statsAvailable ? summary.block : "--"}</b><small>阻擋</small></span>
        </div>
      </section>

      <div className="ideas-workbench-layout">
        <Panel
          code="IDEA-OPN"
          title="候選清單"
          sub="紙上決策 / 只讀"
          right={stateLabel(result.state)}
        >
          <SourceLine result={result} />
          <EmptyOrBlocked result={result} />
          {result.state === "LIVE" && (
            <div className="strategy-idea-stack">
              {result.data.items.map((idea) => (
                <IdeaRowView idea={idea} key={`${idea.companyId}-${idea.symbol}`} />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          code="IDEA-QA"
          title="品質檢查"
          sub="策略想法 / 資料完整性"
          right={statsAvailable ? reasonText(topReason) : stateLabel(result.state)}
        >
          <div className="ideas-quality-stack">
            <div>
              <span>方向分布</span>
              <strong>{statsAvailable ? `${summary.bullish} 看多 / ${summary.bearish} 看空 / ${summary.neutral} 中性` : "--"}</strong>
            </div>
            <div>
              <span>可用性</span>
              <strong>{statsAvailable ? `${summary.quality.strategyReady} 可策略觀察 / ${summary.quality.referenceOnly} 參考 / ${summary.quality.insufficient} 不足` : "--"}</strong>
            </div>
            <div>
              <span>平均信心</span>
              <strong>
                {statsAvailable && result.data.items.length
                  ? percent(result.data.items.reduce((sum, idea) => sum + idea.confidence, 0) / result.data.items.length)
                  : "--"}
              </strong>
            </div>
            <div>
              <span>轉單政策</span>
              <strong>正式轉成模擬委託前一律暫停；本頁不建立券商委託。</strong>
            </div>
          </div>
          <div className="idea-source-note">
            <span>來源：{result.source}</span>
            <span>產生：{statsAvailable ? formatDateTime(result.data.generatedAt) : "策略想法來源未回應"}</span>
            <span>主要品質原因：{statsAvailable ? reasonText(topReason) : stateLabel(result.state)}</span>
          </div>
        </Panel>
      </div>
    </PageFrame>
  );
}
