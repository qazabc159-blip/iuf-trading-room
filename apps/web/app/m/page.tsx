import Link from "next/link";

import {
  getBriefs,
  getKillSwitch,
  getMarketDataOverview,
  getStrategyIdeas,
  getThemes,
} from "@/lib/api";

export const dynamic = "force-dynamic";

const ACCOUNT_ID = "paper-default";

type BriefRow = Awaited<ReturnType<typeof getBriefs>>["data"][number];
type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type IdeaRow = Awaited<ReturnType<typeof getStrategyIdeas>>["data"]["items"][number];
type MarketOverview = Awaited<ReturnType<typeof getMarketDataOverview>>["data"];
type KillState = Awaited<ReturnType<typeof getKillSwitch>>["data"];
type MobileData = {
  briefs: BriefRow[];
  themes: ThemeRow[];
  ideas: IdeaRow[];
  overview: MarketOverview | null;
  kill: KillState | null;
};
type LoadState =
  | { state: "LIVE"; data: MobileData; updatedAt: string; source: string }
  | { state: "EMPTY"; data: MobileData; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: MobileData; updatedAt: string; source: string; reason: string };

const emptyData: MobileData = {
  briefs: [],
  themes: [],
  ideas: [],
  overview: null,
  kill: null,
};

async function loadMobileBrief(): Promise<LoadState> {
  const source = "GET briefs/themes/strategy-ideas/market-data-overview/kill-switch";
  const updatedAt = new Date().toISOString();

  try {
    const [briefsEnvelope, themesEnvelope, ideasEnvelope, overviewEnvelope, killEnvelope] = await Promise.all([
      getBriefs(),
      getThemes(),
      getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 8, sort: "score" }),
      getMarketDataOverview(),
      getKillSwitch(ACCOUNT_ID),
    ]);
    const data: MobileData = {
      briefs: briefsEnvelope.data,
      themes: themesEnvelope.data,
      ideas: ideasEnvelope.data.items,
      overview: overviewEnvelope.data,
      kill: killEnvelope.data,
    };
    if (data.briefs.length === 0 && data.themes.length === 0 && data.ideas.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "Mobile brief sources returned no brief, theme, or idea rows.",
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyData,
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

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
}

function signed(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function directionTone(direction: IdeaRow["direction"]) {
  if (direction === "bullish") return "up";
  if (direction === "bearish") return "down";
  return "muted";
}

export default async function MobileBrief() {
  const result = await loadMobileBrief();
  const latestBrief = result.data.briefs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
  const themes = result.data.themes.slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)).slice(0, 5);
  const ideas = result.data.ideas.slice(0, 4);
  const overview = result.data.overview;
  const activeSource = overview?.quotes.readiness.connectedSources.join("/") || "none";

  return (
    <main>
      <header className="mobile-head">
        <div>
          <div className="tg soft">IUF TR / MOBILE BRIEF</div>
          <h1>Brief</h1>
          <div className="tg soft" style={{ marginTop: 8 }}>{result.source}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={`tg ${stateTone(result.state)}`}>{result.state}</div>
          <div className="digits">{formatTime(result.updatedAt)}</div>
        </div>
      </header>

      {result.state !== "LIVE" && (
        <MobileSection code="SRC" title="source state" right={result.state}>
          <div className="mobile-card">
            <div className={`tg ${stateTone(result.state)}`}>{result.state}</div>
            <div className="tc soft" style={{ marginTop: 8 }}>{result.reason}</div>
          </div>
        </MobileSection>
      )}

      <MobileSection code="MKT" title="market data" right={activeSource.toUpperCase()}>
        <MobileMetric label="KILL" value={result.data.kill?.mode ?? "--"} tone={result.data.kill?.engaged ? "down" : "gold"} />
        <MobileMetric label="QUOTES" value={overview?.quotes.total ?? 0} sub={`${overview?.quotes.fresh ?? 0} fresh`} tone={(overview?.quotes.fresh ?? 0) > 0 ? "up" : "muted"} />
        <MobileMetric label="PAPER-USABLE" value={overview?.quotes.readiness.effectiveSelection.paperUsable ?? 0} sub={`${overview?.quotes.readiness.effectiveSelection.blocked ?? 0} blocked`} tone="gold" />
      </MobileSection>

      <MobileSection code="BRF" title="latest brief" right={latestBrief?.status ?? "EMPTY"}>
        {!latestBrief && <div className="mobile-card"><div className="tg gold">EMPTY</div><div className="tc soft">No daily brief row.</div></div>}
        {latestBrief && (
          <div className="mobile-card">
            <div className="tg gold">{latestBrief.date} / {latestBrief.marketState}</div>
            <div className="tc" style={{ fontSize: 18, marginTop: 8 }}>{latestBrief.sections[0]?.heading ?? "Brief"}</div>
            <div className="tc soft" style={{ marginTop: 7, lineHeight: 1.65 }}>{latestBrief.sections[0]?.body ?? "No section body."}</div>
          </div>
        )}
      </MobileSection>

      <MobileSection code="THM" title="theme sweep" right={`${themes.length} REAL`}>
        {themes.map((theme) => (
          <Link className="mobile-card" href={`/themes/${theme.slug}`} key={theme.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="tg gold">P{theme.priority} / {theme.slug}</span>
              <span className="tg soft">{theme.marketState}</span>
            </div>
            <div className="tc" style={{ fontSize: 18, marginTop: 5 }}>{theme.name}</div>
            <div className="tg soft" style={{ marginTop: 7 }}>{theme.lifecycle} / core {theme.corePoolCount} / obs {theme.observationPoolCount}</div>
          </Link>
        ))}
      </MobileSection>

      <MobileSection code="IDA" title="paper ideas" right={`${ideas.length} REAL`}>
        {ideas.map((idea) => (
          <Link className="mobile-card" href={`/companies/${idea.symbol}`} key={`${idea.companyId}-${idea.symbol}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="tg gold">{idea.symbol}</span>
              <span className={`tg session-pill ${directionTone(idea.direction)}`}>{idea.direction}</span>
            </div>
            <div className="tc" style={{ marginTop: 8 }}>{idea.rationale.primaryReason}</div>
            <div className="tg soft" style={{ marginTop: 7 }}>decision {idea.marketData.decision} / score {idea.score.toFixed(1)} / conf {signed(idea.confidence * 100, 0)}%</div>
          </Link>
        ))}
      </MobileSection>
    </main>
  );
}

function MobileSection({ code, title, right, children }: { code: string; title: string; right: string; children: React.ReactNode }) {
  return (
    <section className="mobile-section">
      <div className="mobile-section-head">
        <span className="tg gold">{code} / {title}</span>
        <span className="tg soft">{right}</span>
      </div>
      {children}
    </section>
  );
}

function MobileMetric({ label, value, sub, tone = "muted" }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="mobile-row">
      <span className="tg soft">{label}</span>
      <span className={`tg ${tone}`} style={{ fontSize: 17 }}>{value}</span>
      {sub && <span className={`tg ${tone}`}>{sub}</span>}
    </div>
  );
}
