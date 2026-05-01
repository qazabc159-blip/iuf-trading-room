import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { WatchlistSurface } from "@/components/watchlist/WatchlistSurface";
import type { WatchlistSurfaceState } from "@/components/watchlist/WatchlistSurface";
import {
  getCompanies,
  getCompanyAnnouncements,
  getMarketDataOverview,
  getSignals,
  getStrategyIdeas,
  getThemes,
  getWatchlistOverview,
  listStrategyRuns,
  type CompanyAnnouncement,
  type MarketDataOverview,
} from "@/lib/api";

export const dynamic = "force-dynamic";

type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type SignalRow = Awaited<ReturnType<typeof getSignals>>["data"][number];
type StrategyIdeaData = Awaited<ReturnType<typeof getStrategyIdeas>>["data"];
type StrategyRunData = Awaited<ReturnType<typeof listStrategyRuns>>["data"];

type LoadState<T> =
  | { state: "LIVE"; data: T; updatedAt: string; source: string }
  | { state: "EMPTY"; data: T; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: T; updatedAt: string; source: string; reason: string };

type NewsItem = CompanyAnnouncement & {
  companyId: string;
  ticker: string;
  companyName: string;
};

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|failed to fetch|ECONNREFUSED|network/i.test(message)) return "前端暫時無法連到後端 API。";
  if (/401|unauthorized|unauthenticated/i.test(message)) return "登入狀態已失效，請重新登入。";
  if (/404|not found/i.test(message)) return "後端端點尚未提供。";
  return message;
}

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
        reason: "正式資料來源目前回傳 0 筆。",
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyValue,
      updatedAt,
      source,
      reason: friendlyError(error),
    };
  }
}

function stateText(state: LoadState<unknown>["state"] | "LOADING") {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  if (state === "LOADING") return "讀取中";
  return "暫停";
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

function directionText(value: string) {
  if (value === "bullish") return "偏多";
  if (value === "bearish") return "偏空";
  return "中性";
}

function decisionText(value: string) {
  if (value === "allow") return "可觀察";
  if (value === "review") return "待審";
  if (value === "block") return "阻擋";
  return value;
}

function marketText(value: string | null | undefined) {
  if (value === "Attack") return "進攻";
  if (value === "Selective Attack") return "選擇性進攻";
  if (value === "Defense") return "防守";
  if (value === "Preservation") return "保全";
  if (value === "Balanced") return "平衡";
  return value ?? "--";
}

function lifecycleText(value: string | null | undefined) {
  if (value === "Discovery") return "探索";
  if (value === "Validation") return "驗證";
  if (value === "Expansion") return "擴張";
  if (value === "Crowded") return "擁擠";
  if (value === "Distribution") return "分配";
  if (value === "Incubation") return "孵化";
  if (value === "Monitoring") return "監控";
  if (value === "active") return "啟用";
  if (value === "watch") return "觀察";
  if (value === "paused") return "暫停";
  if (value === "retired") return "退場";
  return value ?? "--";
}

function categoryText(value: string | null | undefined) {
  if (!value) return "未分類";
  const key = value.toLowerCase();
  if (key === "earnings") return "財報";
  if (key === "revenue") return "營收";
  if (key === "news") return "新聞";
  if (key === "theme") return "主題";
  if (key === "industry") return "產業";
  if (key === "supply_chain") return "供應鏈";
  if (key === "technical") return "技術";
  if (key === "fundamental") return "基本面";
  if (key === "test" || key === "dryrun") return "內部測試";
  return value.replace(/[_-]/g, " ");
}

function hasBrokenText(value: string | null | undefined) {
  if (!value) return false;
  return /�|Ã|Â|undefined|null/i.test(value);
}

function themeThesisText(theme: ThemeRow) {
  if (!theme.thesis || hasBrokenText(theme.thesis)) {
    return "主題說明待整理；目前先顯示正式主題主檔與公司池數量。";
  }
  return theme.thesis;
}

function isInternalTestSignal(signal: SignalRow) {
  const text = `${signal.title} ${signal.summary ?? ""} ${signal.category}`.toLowerCase();
  return /bruce|dryrun|smoke|test signal|verify/.test(text);
}

function signalTitleText(signal: SignalRow) {
  const raw = `${signal.title || "未命名訊號"}${signal.summary ? ` / ${signal.summary}` : ""}`;
  if (hasBrokenText(raw)) return "訊號文字待整理；保留來源紀錄，不作交易解讀。";
  const cleaned = raw.replace(/^bruce-wave\d*-verify:\s*/i, "內部驗證：");
  if (/^[\x00-\x7F\s%.,:;()/-]+$/.test(cleaned) && /[A-Za-z]/.test(cleaned)) {
    return `外文訊號：${cleaned}`;
  }
  return cleaned;
}

function reasonText(value: string | null | undefined) {
  if (!value) return "理由待補";
  return value
    .replace(/missing_bars/g, "K 線資料不足")
    .replace(/no_theme/g, "尚未連結主題")
    .replace(/_/g, " ");
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
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
  return <span style={{ color, fontWeight: 700, letterSpacing: "0.16em" }}>{stateText(state)}</span>;
}

function StateLine<T>({ state, label }: { state: LoadState<T>; label: string }) {
  return (
    <div className="tg soft" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
      <StatePill state={state.state} />
      <span>{label}</span>
      <span>更新 {formatDateTime(state.updatedAt)}</span>
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
        <StateLine state={overview} label="市場總覽" />
        <div className="quote-strip">
          <div className="quote-card">
            <div className="tg"><span className="quote-symbol">市場總覽</span><span className="quote-state">{stateText(overview.state)}</span></div>
            <div className="quote-last num">--</div>
            <div className="tg soft">{overview.state === "LIVE" ? "沒有市場總覽資料。" : overview.reason}</div>
          </div>
        </div>
      </div>
    );
  }

  const data = overview.data;
  const topGainer = data.leaders.topGainers[0] ?? null;
  const topLoser = data.leaders.topLosers[0] ?? null;
  const active = data.leaders.mostActive[0] ?? null;
  const connected = data.quotes.readiness.connectedSources.join("/") || "無";
  const tapeItems = [
    ...data.leaders.topGainers.slice(0, 4).map((item) => ({
      label: "強勢",
      symbol: item.symbol,
      value: `${signed(item.changePct)}%`,
      tone: tone(item.changePct),
      source: item.source,
    })),
    ...data.leaders.topLosers.slice(0, 4).map((item) => ({
      label: "弱勢",
      symbol: item.symbol,
      value: `${signed(item.changePct)}%`,
      tone: tone(item.changePct),
      source: item.source,
    })),
    ...data.leaders.mostActive.slice(0, 4).map((item) => ({
      label: "成交",
      symbol: item.symbol,
      value: item.volume ? `${item.volume.toLocaleString("zh-TW")}股` : "--",
      tone: "muted",
      source: item.source,
    })),
  ];

  const cards = [
    { key: "quotes", label: "報價", value: String(data.quotes.total), sub: `${data.quotes.fresh} 新鮮 / ${data.quotes.stale} 過期`, tone: data.quotes.fresh > 0 ? "up" : "muted" },
    { key: "symbols", label: "股票池", value: String(data.symbols.total), sub: data.symbols.byMarket.slice(0, 3).map((m) => `${m.market}:${m.total}`).join(" / ") || "尚無股票主檔", tone: "muted" },
    { key: "providers", label: "來源", value: connected.toUpperCase(), sub: `優先 ${data.quotes.readiness.preferredSourceOrder.join(">")}`, tone: connected === "無" ? "down" : "up" },
    { key: "usable", label: "可模擬", value: String(data.quotes.readiness.effectiveSelection.paperUsable), sub: `${data.quotes.readiness.effectiveSelection.blocked} 檔暫停`, tone: data.quotes.readiness.effectiveSelection.paperUsable > 0 ? "up" : "gold" },
    { key: "gainer", label: "強勢", value: topGainer?.symbol ?? "--", sub: topGainer ? `${signed(topGainer.changePct)}% ${topGainer.source}` : "無資料", tone: tone(topGainer?.changePct) },
    { key: "loser", label: "弱勢", value: topLoser?.symbol ?? "--", sub: topLoser ? `${signed(topLoser.changePct)}% ${topLoser.source}` : "無資料", tone: tone(topLoser?.changePct) },
    { key: "active", label: "成交活躍", value: active?.symbol ?? "--", sub: active?.volume ? `${active.volume.toLocaleString("zh-TW")} 股` : "無資料", tone: "muted" },
  ];

  return (
    <div>
      <StateLine state={overview} label="市場總覽" />
      {tapeItems.length > 0 && (
        <div className="market-tape" aria-label="即時行情帶">
          <div className="market-tape-track">
            {[...tapeItems, ...tapeItems].map((item, index) => (
              <span className="market-tape-item" key={`${item.label}-${item.symbol}-${index}`}>
                <span className="tg gold">{item.label}</span>
                <span className="num">{item.symbol}</span>
                <span className={`num ${item.tone}`}>{item.value}</span>
                <span className="tg soft">{item.source.toUpperCase()}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="quote-strip">
        {cards.map((card) => (
          <div className="quote-card" key={card.key}>
            <div className="tg">
              <span className="quote-symbol">{card.label}</span>
              <span className="quote-state">正常</span>
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
    <Panel code="THM-SCOPE" title={`${formatTime(themes.updatedAt)} 台北`} sub="主題資料" right={<StatePill state={themes.state} />}>
      <StateLine state={themes} label="主題資料" />
      <EmptyOrBlocked state={themes} />
      {themes.state === "LIVE" && (
        <div className="row dashboard-theme-row table-head tg">
          <span>#</span><span>主題</span><span>盤勢</span><span>更新</span>
        </div>
      )}
      {themes.state === "LIVE" && themes.data
        .slice()
        .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
        .slice(0, 8)
        .map((theme) => (
          <Link href={`/themes/${theme.slug}`} key={theme.id} className="row dashboard-theme-row">
            <span className="tg soft">{theme.priority}</span>
            <span>
              <strong className="tc" style={{ color: "var(--night-ink)", fontSize: 16 }}>{theme.name}</strong>
              <span className="tg soft" style={{ display: "block", marginTop: 3 }}>{theme.slug} · {themeThesisText(theme)}</span>
            </span>
            <span className="tg gold">{marketText(theme.marketState)}</span>
            <span className="tg soft">{formatDate(theme.updatedAt)}</span>
          </Link>
        ))}
    </Panel>
  );
}

function IdeasPanel({ ideas }: { ideas: LoadState<StrategyIdeaData | null> }) {
  const items = ideas.state === "LIVE" && ideas.data ? ideas.data.items.slice(0, 6) : [];
  return (
    <Panel code="IDEA-OPN" title={`${formatTime(ideas.updatedAt)} 台北`} sub="策略想法 / 模擬決策" right={<StatePill state={ideas.state} />}>
      <StateLine state={ideas} label="策略想法" />
      <EmptyOrBlocked state={ideas} />
      {items.map((idea) => (
        <div className="row idea-row" key={`${idea.companyId}-${idea.symbol}`}>
          <Link className="tg" href={`/companies/${idea.symbol}`} style={{ color: "var(--night-ink)", fontWeight: 700 }}>
            {idea.symbol}
          </Link>
          <span className={`tg ${idea.direction === "bearish" ? "down" : idea.direction === "bullish" ? "up" : "muted"}`}>{directionText(idea.direction)}</span>
          <span className="num">{idea.score.toFixed(1)}</span>
          <span className={`tg ${idea.marketData.decision === "allow" ? "up" : idea.marketData.decision === "review" ? "gold" : "down"}`}>
            {decisionText(idea.marketData.decision)}
          </span>
          <span className="tc soft">{reasonText(idea.rationale.primaryReason)}</span>
          <Link href={`/companies/${idea.symbol}`} className="mini-button">查看</Link>
        </div>
      ))}
    </Panel>
  );
}

function SignalsPanel({ signals }: { signals: LoadState<SignalRow[]> }) {
  const visibleSignals = signals.state === "LIVE"
    ? signals.data.filter((signal) => !isInternalTestSignal(signal)).slice(0, 7)
    : [];
  const hiddenCount = signals.state === "LIVE"
    ? signals.data.length - signals.data.filter((signal) => !isInternalTestSignal(signal)).length
    : 0;

  return (
    <Panel code="SIG-TAPE" title={`${formatTime(signals.updatedAt)} 台北`} sub="訊號證據紀錄" right={<StatePill state={signals.state} />}>
      <StateLine state={signals} label="訊號證據" />
      {hiddenCount > 0 && <div className="tg soft" style={{ marginBottom: 8 }}>已收納內部測試訊號 {hiddenCount} 筆，不放入戰情台判讀。</div>}
      <EmptyOrBlocked state={signals} />
      {visibleSignals.map((signal) => (
        <div className="row dashboard-signal-row" key={signal.id}>
          <span className="tg soft">{formatDateTime(signal.createdAt)}</span>
          <span className="tg gold">{categoryText(signal.category)}</span>
          <span className={`tg ${signal.direction === "bullish" ? "up" : signal.direction === "bearish" ? "down" : "muted"}`}>
            {directionText(signal.direction)}
          </span>
          <span className="tc" style={{ color: "var(--night-ink)" }}>{signalTitleText(signal)}</span>
          <span className="tg soft">信心 {signal.confidence}</span>
        </div>
      ))}
    </Panel>
  );
}

function MarketIntelPanel({ news }: { news: LoadState<NewsItem[]> }) {
  return (
    <Panel code="MKT-INTEL" title={`${formatTime(news.updatedAt)} 台北`} sub="臺股重大訊息" right={<StatePill state={news.state} />}>
      <StateLine state={news} label="重大訊息" />
      <EmptyOrBlocked state={news} />
      {news.state === "LIVE" && news.data.slice(0, 8).map((item) => (
        <Link href={`/companies/${item.ticker}`} className="row telex-row" key={`${item.ticker}-${item.id}`}>
          <span className="tg soft">{formatDate(item.date)}</span>
          <span className="tg gold">{item.ticker}</span>
          <span className="tg" style={{ color: "var(--night-ink)" }}>{item.title}</span>
          <span className="tg soft">{item.category || "公告"}</span>
        </Link>
      ))}
    </Panel>
  );
}

function OpsPanel({ overview, runs }: { overview: LoadState<MarketDataOverview | null>; runs: LoadState<StrategyRunData | null> }) {
  const providers = overview.state === "LIVE" && overview.data ? overview.data.providers : [];
  const runItems = runs.state === "LIVE" && runs.data ? runs.data.items.slice(0, 4) : [];
  return (
    <>
      <Panel code="OPS-HLT" title={`${formatTime(overview.updatedAt)} 台北`} sub="市場資料來源" right={<StatePill state={overview.state} />}>
        <StateLine state={overview} label="市場資料來源" />
        <EmptyOrBlocked state={overview} />
        {providers.map((provider) => (
          <div className="row health-row" key={provider.source}>
            <span className="tg" style={{ color: provider.connected ? "var(--night-ink)" : "var(--gold)", fontWeight: 700 }}>
              {provider.source.toUpperCase()}
            </span>
            <span className={`tg ${provider.connected ? "muted" : "gold"}`}><span className="status-dot" />{provider.connected ? "連線" : "斷線"}</span>
            <span className="tg soft">{formatTime(provider.lastMessageAt)}</span>
            <span className="num soft">{provider.latencyMs ?? "--"}ms</span>
          </div>
        ))}
      </Panel>

      <Panel code="RUNS" title={`${formatTime(runs.updatedAt)} 台北`} sub="策略批次紀錄" right={<StatePill state={runs.state} />}>
        <StateLine state={runs} label="策略批次" />
        <EmptyOrBlocked state={runs} />
        {runItems.map((run) => (
          <Link href={`/runs/${run.id}`} className="row telex-row" style={{ gridTemplateColumns: "90px 1fr 70px" }} key={run.id}>
            <span className="tg soft">{formatDate(run.generatedAt)}</span>
            <span className="tg" style={{ color: "var(--night-ink)" }}>{run.topSymbols.join(" / ") || "無標的"}</span>
            <span className="num">{run.summary.total}</span>
          </Link>
        ))}
      </Panel>
    </>
  );
}

async function loadNews(companies: LoadState<CompanyRow[]>, ideas: LoadState<StrategyIdeaData | null>) {
  const source = "重大訊息";
  if (companies.state !== "LIVE") {
    return {
      state: "BLOCKED",
      data: [],
      updatedAt: new Date().toISOString(),
      source,
      reason: "公司清單無法讀取，因此重大訊息無法選股查詢。",
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
      reason: "目前沒有可查詢重大訊息的公司資料。",
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
  const partialSource = failures > 0 ? `重大訊息（${failures}/${settled.length} 檔失敗）` : source;

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
      reason: "重大訊息端點全部讀取失敗。",
    } satisfies LoadState<NewsItem[]>;
  }

  return {
    state: "EMPTY",
    data: [],
    updatedAt,
    source: partialSource,
    reason: failures > 0
      ? "成功的重大訊息請求回傳 0 筆；部分公司查詢失敗。"
      : "選定股票近 14 天沒有重大訊息。",
  } satisfies LoadState<NewsItem[]>;
}

async function loadWatchlist(): Promise<WatchlistSurfaceState> {
  const source = "觀察清單";
  const updatedAt = new Date().toISOString();
  try {
    const res = await getWatchlistOverview();
    return {
      state: "LIVE",
      data: res.data,
      updatedAt: res.data.generatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      updatedAt,
      source,
      reason: friendlyError(error),
    };
  }
}

export default async function DashboardPage() {
  const [overview, themes, companies, ideas, runs, signals, watchlist] = await Promise.all([
    load("市場總覽", null, async () => (await getMarketDataOverview({ includeStale: true, topLimit: 5 })).data, (value) => value === null || value.quotes.total === 0),
    load("主題資料", [], async () => (await getThemes()).data, (value) => value.length === 0),
    load("公司資料", [], async () => (await getCompanies()).data, (value) => value.length === 0),
    load("策略想法", null, async () => (await getStrategyIdeas({ limit: 8, includeBlocked: true, decisionMode: "paper", sort: "score" })).data, (value) => value === null || value.items.length === 0),
    load("策略批次", null, async () => (await listStrategyRuns({ limit: 6, sort: "created_at" })).data, (value) => value === null || value.items.length === 0),
    load("訊號證據", [], async () => (await getSignals()).data, (value) => value.length === 0),
    loadWatchlist(),
  ]);
  const news = await loadNews(companies, ideas);
  const marketOverview = overview.state === "LIVE" && overview.data?.generatedAt
    ? { ...overview, updatedAt: overview.data.generatedAt }
    : overview;

  const summary = [
    `主題 ${themes.state === "LIVE" ? themes.data.length : stateText(themes.state)}`,
    `想法 ${ideas.state === "LIVE" && ideas.data ? ideas.data.summary.total : stateText(ideas.state)}`,
    `訊號 ${signals.state === "LIVE" ? signals.data.length : stateText(signals.state)}`,
    `重大訊息 ${news.state === "LIVE" ? news.data.length : stateText(news.state)}`,
  ].join(" / ");

  const heroStats = [
    { label: "市場總覽", value: stateText(marketOverview.state), tone: marketOverview.state === "LIVE" ? "up" : marketOverview.state === "EMPTY" ? "muted" : "down" },
    { label: "主題", value: themes.state === "LIVE" ? String(themes.data.length) : stateText(themes.state), tone: themes.state === "LIVE" ? "gold" : "muted" },
    { label: "策略想法", value: ideas.state === "LIVE" && ideas.data ? String(ideas.data.summary.total) : stateText(ideas.state), tone: ideas.state === "LIVE" ? "gold" : "muted" },
    { label: "訊號", value: signals.state === "LIVE" ? String(signals.data.filter((signal) => !isInternalTestSignal(signal)).length) : stateText(signals.state), tone: signals.state === "LIVE" ? "gold" : "muted" },
  ];

  return (
    <PageFrame
      code="01"
      title="交易戰情室"
      sub="台股戰情台"
      note={`戰情台 / ${summary}`}
    >
      <section className="dashboard-hero" aria-label="戰情台狀態總覽">
        <div className="dashboard-hero-main">
          <span className="tg gold">IUF 台股戰情台</span>
          <h2>盤前、盤中、盤後都先看這一屏</h2>
          <p>這裡只呈現正式資料源與明確暫停原因；沒有資料就停住，不用假數字裝作正常。</p>
        </div>
        <div className="dashboard-hero-kpis">
          {heroStats.map((item) => (
            <div className="dashboard-hero-stat" key={item.label}>
              <span className="tg soft">{item.label}</span>
              <strong className={`num ${item.tone}`}>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>
      <MarketStrip overview={marketOverview} />

      <div className="main-grid">
        <div>
          <Panel code="WCH-LST" title={`${formatTime(watchlist.updatedAt)} 台北`} sub="觀察清單 / 報價 / 風控試算" right={<StatePill state={watchlist.state} />}>
            <WatchlistSurface result={watchlist} />
          </Panel>
          <ThemesPanel themes={themes} />
          <IdeasPanel ideas={ideas} />
        </div>

        <div>
          <MarketIntelPanel news={news} />
          <SignalsPanel signals={signals} />
          <OpsPanel overview={marketOverview} runs={runs} />
        </div>
      </div>
    </PageFrame>
  );
}
