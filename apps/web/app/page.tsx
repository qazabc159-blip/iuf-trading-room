import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import {
  getCompanies,
  getCompanyAnnouncements,
  getMarketDataOverview,
  getSignals,
  getStrategyIdeas,
  getThemes,
  listStrategyRuns,
  type CompanyAnnouncement,
  type MarketDataOverview,
} from "@/lib/api";

export const dynamic = "force-dynamic";

type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type SignalRow = Awaited<ReturnType<typeof getSignals>>["data"][number];
type StrategyIdeaRow = Awaited<ReturnType<typeof getStrategyIdeas>>["data"]["items"][number];
type StrategyRunRow = Awaited<ReturnType<typeof listStrategyRuns>>["data"]["items"][number];

type LoadState<T> =
  | { state: "LIVE"; data: T; updatedAt: string; source: string }
  | { state: "EMPTY"; data: T; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: T; updatedAt: string; source: string; reason: string };

type NewsItem = CompanyAnnouncement & {
  companyId: string;
  ticker: string;
  companyName: string;
};

async function load<T>(
  source: string,
  emptyValue: T,
  fn: () => Promise<T>,
  isEmpty: (value: T) => boolean
): Promise<LoadState<T>> {
  const updatedAt = new Date().toISOString();
  try {
    const data = await fn();
    if (isEmpty(data)) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: `${source} returned zero rows.`,
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyValue,
      updatedAt,
      source,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function tone(value: number | null | undefined) {
  if (typeof value !== "number") return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

function signed(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function StatePill({ state }: { state: LoadState<unknown>["state"] | "LOADING" }) {
  const color = state === "LIVE" ? "var(--gold-bright)"
    : state === "EMPTY" ? "var(--night-mid)"
      : state === "LOADING" ? "var(--gold)"
        : "var(--tw-up-bright)";
  return <span style={{ color, fontWeight: 700, letterSpacing: "0.16em" }}>{state}</span>;
}

function StateLine<T>({ state }: { state: LoadState<T> }) {
  return (
    <div className="tg soft" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
      <StatePill state={state.state} />
      <span>{state.source}</span>
      <span>updated {formatTime(state.updatedAt)}</span>
      {state.state !== "LIVE" && <span>{state.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked<T>({ state }: { state: LoadState<T> }) {
  if (state.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <StatePill state={state.state} /> {state.reason}
    </div>
  );
}

function MarketStrip({ overview }: { overview: LoadState<MarketDataOverview | null> }) {
  if (overview.state !== "LIVE" || !overview.data) {
    return (
      <div>
        <StateLine state={overview} />
        <div className="quote-strip">
          <div className="quote-card">
            <div className="tg"><span className="quote-symbol">MKT-OVR</span><span className="quote-state">{overview.state}</span></div>
            <div className="quote-last num">--</div>
            <div className="tg soft">{overview.state === "LIVE" ? "No overview payload." : overview.reason}</div>
          </div>
        </div>
      </div>
    );
  }

  const data = overview.data;
  const topGainer = data.leaders.topGainers[0] ?? null;
  const topLoser = data.leaders.topLosers[0] ?? null;
  const active = data.leaders.mostActive[0] ?? null;
  const connected = data.quotes.readiness.connectedSources.join("/") || "none";

  const cards = [
    { key: "quotes", label: "QUOTES", value: String(data.quotes.total), sub: `${data.quotes.fresh} fresh / ${data.quotes.stale} stale`, tone: data.quotes.fresh > 0 ? "up" : "muted" },
    { key: "symbols", label: "SYMBOLS", value: String(data.symbols.total), sub: data.symbols.byMarket.slice(0, 3).map((m) => `${m.market}:${m.total}`).join(" / ") || "no symbol master", tone: "muted" },
    { key: "providers", label: "SOURCES", value: connected.toUpperCase(), sub: `preferred ${data.quotes.readiness.preferredSourceOrder.join(">")}`, tone: connected === "none" ? "down" : "up" },
    { key: "usable", label: "PAPER-USABLE", value: String(data.quotes.readiness.effectiveSelection.paperUsable), sub: `${data.quotes.readiness.effectiveSelection.blocked} blocked`, tone: data.quotes.readiness.effectiveSelection.paperUsable > 0 ? "up" : "gold" },
    { key: "gainer", label: "TOP GAINER", value: topGainer?.symbol ?? "--", sub: topGainer ? `${signed(topGainer.changePct)}% ${topGainer.source}` : "empty", tone: tone(topGainer?.changePct) },
    { key: "loser", label: "TOP LOSER", value: topLoser?.symbol ?? "--", sub: topLoser ? `${signed(topLoser.changePct)}% ${topLoser.source}` : "empty", tone: tone(topLoser?.changePct) },
    { key: "active", label: "MOST ACTIVE", value: active?.symbol ?? "--", sub: active?.volume ? `${active.volume.toLocaleString()} vol` : "empty", tone: "muted" },
  ];

  return (
    <div>
      <StateLine state={overview} />
      <div className="quote-strip">
        {cards.map((card) => (
          <div className="quote-card" key={card.key}>
            <div className="tg">
              <span className="quote-symbol">{card.label}</span>
              <span className="quote-state">LIVE</span>
            </div>
            <div className={`quote-last num ${card.tone}`}>{card.value}</div>
            <div className="tg soft">{card.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThemesPanel({ themes }: { themes: LoadState<ThemeRow[]> }) {
  return (
    <Panel code="THM-SCOPE" title={`${formatTime(themes.updatedAt)} TPE`} sub="THEMES · DB SOURCE" right={themes.state}>
      <StateLine state={themes} />
      <EmptyOrBlocked state={themes} />
      {themes.state === "LIVE" && (
        <div className="row theme-row table-head tg">
          <span>#</span><span>THEME</span><span>STATE</span><span>LIFE</span><span>POOL</span><span>UPDATED</span>
        </div>
      )}
      {themes.state === "LIVE" && themes.data
        .slice()
        .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
        .slice(0, 8)
        .map((theme) => (
          <Link href={`/themes/${theme.slug}`} key={theme.id} className="row theme-row">
            <span className="tg soft">{theme.priority}</span>
            <span>
              <strong className="tc" style={{ color: "var(--night-ink)", fontSize: 16 }}>{theme.name}</strong>
              <span className="tg soft" style={{ display: "block", marginTop: 3 }}>{theme.slug}</span>
            </span>
            <span className="tg gold">{theme.marketState}</span>
            <span className="tg muted">{theme.lifecycle}</span>
            <span className="num">{theme.corePoolCount}/{theme.observationPoolCount}</span>
            <span className="tg soft">{formatDate(theme.updatedAt)}</span>
          </Link>
        ))}
    </Panel>
  );
}

function IdeasPanel({ ideas }: { ideas: LoadState<Awaited<ReturnType<typeof getStrategyIdeas>>["data"] | null> }) {
  const items = ideas.state === "LIVE" && ideas.data ? ideas.data.items.slice(0, 6) : [];
  return (
    <Panel code="IDEA-OPN" title={`${formatTime(ideas.updatedAt)} TPE`} sub="STRATEGY IDEAS · PAPER DECISION" right={ideas.state}>
      <StateLine state={ideas} />
      <EmptyOrBlocked state={ideas} />
      {items.map((idea) => (
        <div className="row idea-row" key={`${idea.companyId}-${idea.symbol}`}>
          <Link className="tg" href={`/companies/${idea.symbol}`} style={{ color: "var(--night-ink)", fontWeight: 700 }}>
            {idea.symbol}
          </Link>
          <span className={`tg ${idea.direction === "bearish" ? "down" : idea.direction === "bullish" ? "up" : "muted"}`}>{idea.direction.toUpperCase()}</span>
          <span className="num">{idea.score.toFixed(1)}</span>
          <span className={`tg ${idea.marketData.decision === "allow" ? "up" : idea.marketData.decision === "review" ? "gold" : "down"}`}>
            {idea.marketData.decision.toUpperCase()}
          </span>
          <span className="tc soft">{idea.rationale.primaryReason}</span>
          <Link href={`/companies/${idea.symbol}`} className="mini-button">DETAIL</Link>
        </div>
      ))}
    </Panel>
  );
}

function SignalsPanel({ signals }: { signals: LoadState<SignalRow[]> }) {
  return (
    <Panel code="SIG-TAPE" title={`${formatTime(signals.updatedAt)} TPE`} sub="SIGNALS · DB LEDGER" right={signals.state}>
      <StateLine state={signals} />
      <EmptyOrBlocked state={signals} />
      {signals.state === "LIVE" && signals.data.slice(0, 7).map((signal) => (
        <div className="row telex-row" key={signal.id}>
          <span className="tg soft">{formatTime(signal.createdAt)}</span>
          <span className={`tg ${signal.direction === "bullish" ? "up" : signal.direction === "bearish" ? "down" : "muted"}`}>
            {signal.direction.toUpperCase()}
          </span>
          <span className="tg" style={{ color: "var(--night-ink)" }}>{signal.title}</span>
          <span className="tg soft">C{signal.confidence}</span>
        </div>
      ))}
    </Panel>
  );
}

function MarketIntelPanel({ news }: { news: LoadState<NewsItem[]> }) {
  return (
    <Panel code="MKT-INTEL" title={`${formatTime(news.updatedAt)} TPE`} sub="TWSE MATERIAL NEWS" right={news.state}>
      <StateLine state={news} />
      <EmptyOrBlocked state={news} />
      {news.state === "LIVE" && news.data.slice(0, 8).map((item) => (
        <Link href={`/companies/${item.ticker}`} className="row telex-row" key={`${item.ticker}-${item.id}`}>
          <span className="tg soft">{formatDate(item.date)}</span>
          <span className="tg gold">{item.ticker}</span>
          <span className="tg" style={{ color: "var(--night-ink)" }}>{item.title}</span>
          <span className="tg soft">{item.category || "TWSE"}</span>
        </Link>
      ))}
    </Panel>
  );
}

function OpsPanel({ overview, runs }: { overview: LoadState<MarketDataOverview | null>; runs: LoadState<Awaited<ReturnType<typeof listStrategyRuns>>["data"] | null> }) {
  const providers = overview.state === "LIVE" && overview.data ? overview.data.providers : [];
  const runItems = runs.state === "LIVE" && runs.data ? runs.data.items.slice(0, 4) : [];
  return (
    <>
      <Panel code="OPS-HLT" title={`${formatTime(overview.updatedAt)} TPE`} sub="MARKET DATA PROVIDERS" right={overview.state}>
        <StateLine state={overview} />
        <EmptyOrBlocked state={overview} />
        {providers.map((provider) => (
          <div className="row health-row" key={provider.source}>
            <span className="tg" style={{ color: provider.connected ? "var(--night-ink)" : "var(--gold)", fontWeight: 700 }}>
              {provider.source.toUpperCase()}
            </span>
            <span className={`tg ${provider.connected ? "muted" : "gold"}`}><span className="status-dot" />{provider.connected ? "CONNECTED" : "DISCONNECTED"}</span>
            <span className="tg soft">{formatTime(provider.lastMessageAt)}</span>
            <span className="num soft">{provider.latencyMs ?? "--"}ms</span>
          </div>
        ))}
      </Panel>

      <Panel code="RUNS" title={`${formatTime(runs.updatedAt)} TPE`} sub="STRATEGY RUNS · DB" right={runs.state}>
        <StateLine state={runs} />
        <EmptyOrBlocked state={runs} />
        {runItems.map((run) => (
          <Link href={`/runs/${run.id}`} className="row telex-row" style={{ gridTemplateColumns: "90px 1fr 70px" }} key={run.id}>
            <span className="tg soft">{formatDate(run.generatedAt)}</span>
            <span className="tg" style={{ color: "var(--night-ink)" }}>{run.topSymbols.join(" / ") || "no symbols"}</span>
            <span className="num">{run.summary.total}</span>
          </Link>
        ))}
      </Panel>
    </>
  );
}

async function loadNews(companies: LoadState<CompanyRow[]>, ideas: LoadState<Awaited<ReturnType<typeof getStrategyIdeas>>["data"] | null>) {
  const source = "GET /api/v1/companies/:id/announcements?days=14";
  if (companies.state !== "LIVE") {
    return {
      state: "BLOCKED",
      data: [],
      updatedAt: new Date().toISOString(),
      source,
      reason: "Company list is unavailable, so Market Intel cannot choose tickers.",
    } satisfies LoadState<NewsItem[]>;
  }

  const byId = new Map(companies.data.map((company) => [company.id, company]));
  const ideaCompanyIds = ideas.state === "LIVE" && ideas.data
    ? ideas.data.items.map((idea) => idea.companyId)
    : [];
  const selected = [...new Set(ideaCompanyIds)]
    .map((id) => byId.get(id))
    .filter((company): company is CompanyRow => Boolean(company))
    .concat(companies.data)
    .filter((company, index, all) => all.findIndex((item) => item.id === company.id) === index)
    .slice(0, 8);

  if (selected.length === 0) {
    return {
      state: "EMPTY",
      data: [],
      updatedAt: new Date().toISOString(),
      source,
      reason: "No companies are available to query for TWSE material announcements.",
    } satisfies LoadState<NewsItem[]>;
  }

  const settled = await Promise.allSettled(
    selected.map(async (company) => {
      const res = await getCompanyAnnouncements(company.id, { days: 14 });
      return res.data.map((row) => ({
        ...row,
        companyId: company.id,
        ticker: company.ticker,
        companyName: company.name,
      }));
    })
  );

  const rows = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const updatedAt = new Date().toISOString();
  const failures = settled.filter((result) => result.status === "rejected").length;
  const partialSource = failures > 0 ? `${source} (${failures}/${settled.length} calls failed)` : source;

  if (rows.length > 0) {
    return {
      state: "LIVE",
      data: rows
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, 12),
      updatedAt,
      source: partialSource,
    } satisfies LoadState<NewsItem[]>;
  }

  if (failures === settled.length) {
    return {
      state: "BLOCKED",
      data: [],
      updatedAt,
      source,
      reason: "All announcement endpoint calls failed.",
    } satisfies LoadState<NewsItem[]>;
  }

  return {
    state: "EMPTY",
    data: [],
    updatedAt,
    source: partialSource,
    reason: failures > 0
      ? "Successful announcement requests returned zero rows; coverage is partial because some company calls failed."
      : "TWSE returned zero material announcements for the selected symbols.",
  } satisfies LoadState<NewsItem[]>;
}

export default async function DashboardPage() {
  const [overview, themes, companies, ideas, runs, signals] = await Promise.all([
    load("GET /api/v1/market-data/overview", null, async () => (await getMarketDataOverview({ includeStale: true, topLimit: 5 })).data, (value) => value === null || value.quotes.total === 0),
    load("GET /api/v1/themes", [], async () => (await getThemes()).data, (value) => value.length === 0),
    load("GET /api/v1/companies", [], async () => (await getCompanies()).data, (value) => value.length === 0),
    load("GET /api/v1/strategy/ideas?decisionMode=paper", null, async () => (await getStrategyIdeas({ limit: 8, includeBlocked: true, decisionMode: "paper", sort: "score" })).data, (value) => value === null || value.items.length === 0),
    load("GET /api/v1/strategy/runs", null, async () => (await listStrategyRuns({ limit: 6, sort: "created_at" })).data, (value) => value === null || value.items.length === 0),
    load("GET /api/v1/signals", [], async () => (await getSignals()).data, (value) => value.length === 0),
  ]);
  const news = await loadNews(companies, ideas);
  const marketOverview = overview.state === "LIVE" && overview.data?.generatedAt
    ? { ...overview, updatedAt: overview.data.generatedAt }
    : overview;

  const summary = [
    `themes ${themes.state === "LIVE" ? themes.data.length : themes.state}`,
    `ideas ${ideas.state === "LIVE" && ideas.data ? ideas.data.summary.total : ideas.state}`,
    `signals ${signals.state === "LIVE" ? signals.data.length : signals.state}`,
    `news ${news.state === "LIVE" ? news.data.length : news.state}`,
  ].join(" · ");

  return (
    <PageFrame
      code="01"
      title="Trading Room"
      sub="Real-data dashboard"
      note={`[01] DASHBOARD · ${summary}`}
    >
      <MarketStrip overview={marketOverview} />

      <div className="main-grid">
        <div>
          <ThemesPanel themes={themes} />
        </div>

        <div>
          <MarketIntelPanel news={news} />
          <IdeasPanel ideas={ideas} />
        </div>

        <div>
          <SignalsPanel signals={signals} />
          <OpsPanel overview={marketOverview} runs={runs} />
        </div>
      </div>
    </PageFrame>
  );
}
