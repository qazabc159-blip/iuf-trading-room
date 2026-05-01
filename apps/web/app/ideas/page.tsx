import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getStrategyIdeas } from "@/lib/api";

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
  const source = "GET /api/v1/strategy/ideas?decisionMode=paper&includeBlocked=true&sort=score";
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
        reason: "Strategy endpoint returned zero paper-decision ideas. No fallback rows are rendered.",
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

const ideaRowWithPromoteStyle = {
  gridTemplateColumns: "74px 56px 54px 72px minmax(160px, 1fr) 88px minmax(170px, 0.72fr)",
};

function PromotionBlockedCell() {
  return (
    <span
      className="tg down"
      title="Contract 4 route POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-preview is not live. Owner: Jason + Bruce."
      style={{ display: "grid", gap: 3, minWidth: 0, lineHeight: 1.25 }}
    >
      <span>PROMOTE BLOCKED</span>
      <span className="tc soft" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Contract 4 route missing
      </span>
    </span>
  );
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{result.state}</span>
      <span>{result.source}</span>
      <span>updated {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{result.state}</span>{" "}
      {result.reason}
    </div>
  );
}

function IdeaRowView({ idea }: { idea: IdeaRow }) {
  const theme = idea.topThemes[0]?.name ?? "NO THEME";
  return (
    <div className="row idea-row" style={ideaRowWithPromoteStyle} key={`${idea.companyId}-${idea.symbol}`}>
      <Link href={`/companies/${idea.symbol}`} className="tg gold">
        {idea.symbol}
      </Link>
      <span className={`tg ${directionTone(idea.direction)}`}>{idea.direction}</span>
      <span className="num">{idea.score.toFixed(1)}</span>
      <span className={`tg ${decisionTone(idea.marketData.decision)}`}>
        {idea.marketData.decision}
      </span>
      <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {idea.companyName} / {theme} / {idea.rationale.primaryReason}
      </span>
      <Link href={`/companies/${idea.symbol}`} className="mini-button">
        DETAIL
      </Link>
      <PromotionBlockedCell />
    </div>
  );
}

export default async function IdeasPage() {
  const result = await loadIdeas();
  const summary = result.data.summary;
  const statsAvailable = result.state !== "BLOCKED";
  const topReason = summary.quality.primaryReasons[0]?.reason ?? "none";

  return (
    <PageFrame
      code="04"
      title="Ideas"
      sub="Strategy queue"
      note="[04] IDEAS reads the production strategy endpoint. Promote/order handoff stays BLOCKED until Contract 4 is approved."
    >
      <MetricStrip
        cells={[
          { label: "STATE", value: result.state, tone: stateTone(result.state) },
          { label: "TOTAL", value: statsAvailable ? summary.total : "--" },
          { label: "ALLOW", value: statsAvailable ? summary.allow : "--", tone: "up" },
          { label: "REVIEW", value: statsAvailable ? summary.review : "--", tone: "gold" },
          { label: "BLOCK", value: statsAvailable ? summary.block : "--", tone: "down" },
          { label: "READY", value: statsAvailable ? summary.quality.strategyReady : "--", tone: statsAvailable && summary.quality.strategyReady > 0 ? "up" : "muted" },
          { label: "UPDATED", value: formatTime(result.updatedAt) },
        ]}
        columns={7}
      />

      <Panel
        code="IDEA-OPN"
        title={`${formatTime(result.updatedAt)} TPE`}
        sub="STRATEGY IDEAS / PAPER DECISION / READ ONLY"
        right={result.state}
      >
        <SourceLine result={result} />
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <>
            <div className="row idea-row table-head tg" style={ideaRowWithPromoteStyle}>
              <span>SYMBOL</span>
              <span>DIR</span>
              <span>SCORE</span>
              <span>DECISION</span>
              <span>RATIONALE</span>
              <span>LINK</span>
              <span>PROMOTE</span>
            </div>
            {result.data.items.map((idea) => (
              <IdeaRowView idea={idea} key={`${idea.companyId}-${idea.symbol}`} />
            ))}
          </>
        )}
      </Panel>

      <Panel
        code="IDEA-QA"
        title="4-STATE AUDIT"
        sub="endpoint truth / no silent mock"
        right={statsAvailable ? topReason : result.state}
      >
        <div className="quote-strip" style={{ gridTemplateColumns: "repeat(6, minmax(120px, 1fr))", marginTop: 0 }}>
          <div className="quote-card">
            <div className="tg quote-symbol">BULLISH</div>
            <div className="quote-last num up">{statsAvailable ? summary.bullish : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">BEARISH</div>
            <div className="quote-last num down">{statsAvailable ? summary.bearish : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">NEUTRAL</div>
            <div className="quote-last num muted">{statsAvailable ? summary.neutral : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">REFERENCE</div>
            <div className="quote-last num gold">{statsAvailable ? summary.quality.referenceOnly : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">INSUFFICIENT</div>
            <div className="quote-last num down">{statsAvailable ? summary.quality.insufficient : "--"}</div>
          </div>
          <div className="quote-card">
            <div className="tg quote-symbol">CONF AVG</div>
            <div className="quote-last num">
              {statsAvailable && result.data.items.length
                ? percent(result.data.items.reduce((sum, idea) => sum + idea.confidence, 0) / result.data.items.length)
                : "--"}
            </div>
          </div>
        </div>
        <div className="tg soft" style={{ display: "grid", gap: 6, paddingBottom: 12 }}>
          <span>source: {result.source}</span>
          <span>generated: {statsAvailable ? formatDateTime(result.data.generatedAt) : "blocked until strategy idea source is live"}</span>
          <span>handoff: strategy idea to order remains BLOCKED / owner Jason + Bruce / `POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-preview` not live.</span>
        </div>
      </Panel>
    </PageFrame>
  );
}
