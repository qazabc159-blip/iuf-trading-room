import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getStrategyIdeas } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

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

function directionLabel(direction: IdeaRow["direction"]) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
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
  if (!value) return "原因未列明";
  return value
    .replace(/missing_bars/g, "K 線資料不足")
    .replace(/no_theme/g, "尚未連結主題")
    .replace(/readiness:degraded/g, "資料品質降級")
    .replace(/readiness:blocked/g, "資料品質阻擋")
    .replace(/_/g, " ");
}

function PromotionBlockedCell() {
  return (
    <span
      className="tg soft"
      title="策略想法轉模擬委託的正式轉單端點尚未開通。"
      style={{ display: "grid", gap: 4, minWidth: 0, lineHeight: 1.35 }}
    >
      <span className="gold">轉單暫停</span>
      <span className="tc soft" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        等正式轉單端點
      </span>
    </span>
  );
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "12px 0 14px" }}>
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

function IdeaRowView({ idea }: { idea: IdeaRow }) {
  const theme = idea.topThemes[0]?.name ?? "未連結主題";
  return (
    <div className="row idea-row" key={`${idea.companyId}-${idea.symbol}`}>
      <Link href={`/companies/${idea.symbol}`} className="tg gold">
        {idea.symbol}
      </Link>
      <span className={`tg ${directionTone(idea.direction)}`}>{directionLabel(idea.direction)}</span>
      <span className="num">{idea.score.toFixed(1)}</span>
      <span className={`tg ${decisionTone(idea.marketData.decision)}`}>
        {decisionLabel(idea.marketData.decision)}
      </span>
      <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {idea.companyName} / {theme} / {reasonText(idea.rationale.primaryReason)}
      </span>
      <Link href={`/companies/${idea.symbol}`} className="mini-button">
        查看
      </Link>
      <PromotionBlockedCell />
    </div>
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
      sub="紙上候選清單"
      note="策略想法 / 正式策略資料；轉成模擬委託前維持暫停"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "總數", value: statsAvailable ? summary.total : "--" },
          { label: "可觀察", value: statsAvailable ? summary.allow : "--", tone: "up" },
          { label: "待審", value: statsAvailable ? summary.review : "--", tone: "gold" },
          { label: "阻擋", value: statsAvailable ? summary.block : "--", tone: "down" },
          { label: "可用", value: statsAvailable ? summary.quality.strategyReady : "--", tone: statsAvailable && summary.quality.strategyReady > 0 ? "up" : "muted" },
          { label: "更新", value: formatTime(result.updatedAt) },
        ]}
        columns={7}
      />

      <Panel
        code="IDEA-OPN"
        title="策略想法候選"
        sub="紙上決策 / 只讀"
        right={stateLabel(result.state)}
      >
        <SourceLine result={result} />
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <>
            <div className="row idea-row table-head tg">
              <span>代號</span>
              <span>方向</span>
              <span>分數</span>
              <span>決策</span>
              <span>理由</span>
              <span>連結</span>
              <span>轉單</span>
            </div>
            {result.data.items.map((idea) => (
              <IdeaRowView idea={idea} key={`${idea.companyId}-${idea.symbol}`} />
            ))}
          </>
        )}
      </Panel>

      <Panel
        code="IDEA-QA"
        title="品質檢查"
        sub="策略想法 / 資料完整性"
        right={statsAvailable ? reasonText(topReason) : stateLabel(result.state)}
      >
        <div className="quote-strip" style={{ gridTemplateColumns: "repeat(6, minmax(120px, 1fr))", marginTop: 0 }}>
          <div className="quote-card">
            <div className="tg quote-symbol">偏多</div>
            <div className="quote-last num up">{statsAvailable ? summary.bullish : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">偏空</div>
            <div className="quote-last num down">{statsAvailable ? summary.bearish : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">中性</div>
            <div className="quote-last num muted">{statsAvailable ? summary.neutral : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">參考</div>
            <div className="quote-last num gold">{statsAvailable ? summary.quality.referenceOnly : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">不足</div>
            <div className="quote-last num down">{statsAvailable ? summary.quality.insufficient : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">平均信心</div>
            <div className="quote-last num">
              {statsAvailable && result.data.items.length
                ? percent(result.data.items.reduce((sum, idea) => sum + idea.confidence, 0) / result.data.items.length)
                : "--"}
            </div>
          </div>
        </div>
        <div className="tg soft" style={{ display: "grid", gap: 8, paddingBottom: 14 }}>
          <span>來源：{result.source}</span>
          <span>產生：{statsAvailable ? formatDateTime(result.data.generatedAt) : "策略想法來源未回應"}</span>
          <span>轉單：正式轉成模擬委託前一律暫停；本頁不會建立券商委託。</span>
        </div>
      </Panel>
    </PageFrame>
  );
}
