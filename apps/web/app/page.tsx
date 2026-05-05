import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { WatchlistSurface, type WatchlistSurfaceState } from "@/components/watchlist/WatchlistSurface";
import {
  getCompanies,
  getCompanyAnnouncements,
  getFinMindStatus,
  getMarketDataOverview,
  getOpenAliceObservability,
  getSignals,
  getStrategyIdeas,
  getThemes,
  getWatchlistOverview,
  listStrategyRuns,
  type CompanyAnnouncement,
  type FinMindSourceStatus,
  type MarketDataOverview,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanThemeThesis } from "@/lib/operator-copy";

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
      reason: friendlyDataError(error),
    };
  }
}

function stateText(state: LoadState<unknown>["state"] | WatchlistSurfaceState["state"] | "LOADING") {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  if (state === "LOADING") return "讀取中";
  return "暫停";
}

function stateTone(state: LoadState<unknown>["state"] | WatchlistSurfaceState["state"] | "LOADING") {
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  if (state === "LOADING") return "gold";
  return "status-bad";
}

function StatePill({ state }: { state: LoadState<unknown>["state"] | WatchlistSurfaceState["state"] | "LOADING" }) {
  return <span className={`tg ${stateTone(state)}`}>{stateText(state)}</span>;
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

function formatAge(value: string | null | undefined) {
  if (!value) return "--";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "--";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function signed(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function tone(value: number | null | undefined) {
  if (typeof value !== "number") return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
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
  if (value === "Discovery") return "發掘";
  if (value === "Validation") return "驗證";
  if (value === "Expansion") return "擴張";
  if (value === "Crowded") return "擁擠";
  if (value === "Distribution") return "出貨";
  if (value === "Incubation") return "培養";
  if (value === "Monitoring") return "觀察";
  if (value === "active") return "啟用";
  if (value === "watch") return "觀察";
  if (value === "paused") return "暫停";
  if (value === "retired") return "退役";
  return value ?? "--";
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

function categoryText(value: string | null | undefined) {
  if (!value) return "未分類";
  const key = value.toLowerCase();
  if (key === "earnings") return "財報";
  if (key === "revenue") return "營收";
  if (key === "news") return "新聞";
  if (key === "company") return "公司";
  if (key === "market") return "市場";
  if (key === "theme") return "主題";
  if (key === "industry") return "產業";
  if (key === "supply_chain") return "供應鏈";
  if (key === "technical") return "技術面";
  if (key === "fundamental") return "基本面";
  if (key === "test" || key === "dryrun") return "測試";
  return value.replace(/[_-]/g, " ");
}

function isInternalCleanupTheme(theme: ThemeRow) {
  const text = `${theme.slug} ${theme.name} ${theme.thesis ?? ""}`.toLowerCase();
  return /\bbroken\b|deprecated|placeholder|\[broken/.test(text);
}

function isInternalTestSignal(signal: SignalRow) {
  const text = `${signal.title} ${signal.summary ?? ""} ${signal.category}`.toLowerCase();
  return /bruce|dryrun|smoke|test signal|verify/.test(text);
}

function themeDisplayName(theme: ThemeRow) {
  const bySlug: Record<string, string> = {
    "orphan-audit-trail": "稽核軌跡檢查",
    "orphan-ai-optics": "AI 光通訊",
    "5g": "5G",
    abf: "ABF 載板",
    ai: "AI 伺服器",
    apple: "Apple 供應鏈",
    cowos: "CoWoS",
    cpo: "CPO 光電共封裝",
  };
  return bySlug[theme.slug.toLowerCase()] ?? theme.name.replace(/^\[ORPHAN\]\s*/i, "待整理：");
}

function themeThesisText(theme: ThemeRow) {
  return cleanThemeThesis(theme.slug, theme.thesis);
}

function signalTitleText(signal: SignalRow) {
  const raw = `${signal.title || "未命名訊號"}${signal.summary ? ` / ${signal.summary}` : ""}`;
  return cleanExternalHeadline(raw);
}

function intelTitleText(item: NewsItem) {
  return cleanExternalHeadline(item.title, "重大訊息文字尚未完成整理；保留來源紀錄。");
}

function reasonText(value: string | null | undefined) {
  if (!value) return "尚未提供原因";
  return value
    .replace(/missing_bars/g, "K 線資料不足")
    .replace(/no_theme/g, "尚未對應主題")
    .replace(/readiness:degraded/g, "資料品質降級")
    .replace(/readiness:blocked/g, "資料品質阻擋")
    .replace(/_/g, " ");
}

function sourceReason(state: LoadState<unknown> | WatchlistSurfaceState) {
  return state.state === "LIVE" ? undefined : state.reason;
}

function SourceLine<T>({ state, label }: { state: LoadState<T>; label: string }) {
  return (
    <div className="tg soft" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
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

type DashboardSourceStatus = {
  label: string;
  state: LoadState<unknown>["state"] | WatchlistSurfaceState["state"];
  source: string;
  updatedAt: string;
  reason?: string;
  next: string;
};

function DashboardBlockedSummary({ sections }: { sections: DashboardSourceStatus[] }) {
  return (
    <Panel code="OPS-HLT" title="資料狀態總覽" sub="所有停用狀態都必須說明來源與原因" right={<span className="tg down">暫停</span>}>
      <div className="dashboard-blocked-summary">
        <div>
          <span className="tg gold">資料真實性</span>
          <h3>部分資料來源暫時不可用，戰情台不會用假資料補畫面。</h3>
          <p>
            這裡只顯示正式來源回傳的狀態。缺資料就標出 owner、原因與下一步，不用裝飾面板假裝已經接好。
          </p>
        </div>
        <div className="blocked-source-grid" aria-label="資料來源狀態">
          {sections.map((section) => (
            <div className="blocked-source-row" key={section.label}>
              <div>
                <strong>{section.label}</strong>
                <span className="tg soft">來源：{section.source} / 更新 {formatDateTime(section.updatedAt)}</span>
              </div>
              <StatePill state={section.state} />
              <p>{section.reason ?? section.next}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function MarketStrip({ overview }: { overview: LoadState<MarketDataOverview | null> }) {
  if (overview.state !== "LIVE" || !overview.data) {
    return (
      <div>
        <SourceLine state={overview} label="市場總覽" />
        <div className="quote-strip">
          <div className="quote-card">
            <div className="tg"><span className="quote-symbol">市場總覽</span><span className="quote-state">{stateText(overview.state)}</span></div>
            <div className="quote-last num">--</div>
            <div className="tg soft">{overview.state === "LIVE" ? "尚無市場總覽資料" : overview.reason}</div>
          </div>
        </div>
      </div>
    );
  }

  const data = overview.data;
  const topGainer = data.leaders.topGainers[0] ?? null;
  const topLoser = data.leaders.topLosers[0] ?? null;
  const active = data.leaders.mostActive[0] ?? null;
  const connected = data.quotes.readiness.connectedSources.join("/") || "尚未連線";
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
      label: "大量",
      symbol: item.symbol,
      value: item.volume ? `${item.volume.toLocaleString("zh-TW")} 股` : "--",
      tone: "muted",
      source: item.source,
    })),
  ];

  const cards = [
    { key: "quotes", label: "報價", value: String(data.quotes.total), sub: `${data.quotes.fresh} 新鮮 / ${data.quotes.stale} 偏舊`, tone: data.quotes.fresh > 0 ? "up" : "muted" },
    { key: "symbols", label: "股票池", value: String(data.symbols.total), sub: data.symbols.byMarket.slice(0, 3).map((m) => `${m.market}:${m.total}`).join(" / ") || "尚無股票池", tone: "muted" },
    { key: "providers", label: "資料源", value: connected.toUpperCase(), sub: `優先 ${data.quotes.readiness.preferredSourceOrder.join(">")}`, tone: connected === "尚未連線" ? "down" : "up" },
    { key: "usable", label: "可模擬", value: String(data.quotes.readiness.effectiveSelection.paperUsable), sub: `${data.quotes.readiness.effectiveSelection.blocked} 檔阻擋`, tone: data.quotes.readiness.effectiveSelection.paperUsable > 0 ? "status-ok" : "gold" },
    { key: "gainer", label: "最強", value: topGainer?.symbol ?? "--", sub: topGainer ? `${signed(topGainer.changePct)}% ${topGainer.source}` : "無資料", tone: tone(topGainer?.changePct) },
    { key: "loser", label: "最弱", value: topLoser?.symbol ?? "--", sub: topLoser ? `${signed(topLoser.changePct)}% ${topLoser.source}` : "無資料", tone: tone(topLoser?.changePct) },
    { key: "active", label: "大量", value: active?.symbol ?? "--", sub: active?.volume ? `${active.volume.toLocaleString("zh-TW")} 股` : "無資料", tone: "muted" },
  ];

  return (
    <div>
      <SourceLine state={overview} label="市場總覽" />
      {tapeItems.length > 0 && (
        <div className="market-tape" aria-label="台股即時跑馬燈">
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
      <div className="quote-strip market-command-strip">
        {cards.map((card) => (
          <div className="quote-card" key={card.key}>
            <div className="tg">
              <span className="quote-symbol">{card.label}</span>
              <span className="quote-state">真實資料</span>
            </div>
            <div className={`quote-last num ${card.tone}`}>{card.value}</div>
            <div className="tg soft">{card.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinMindStatusPanel({ finmind }: { finmind: LoadState<FinMindSourceStatus | null> }) {
  const datasets = finmind.state === "LIVE" && finmind.data ? finmind.data.datasets : [];
  const ready = datasets.filter((dataset) => dataset.state === "READY");
  const blocked = datasets.filter((dataset) => dataset.state === "BLOCKED");

  return (
    <section className="dashboard-readiness-deck" aria-label="台股資料接線圖">
      <div className="dashboard-readiness-copy">
        <span className="tg gold">FinMind Sponsor 999</span>
        <h3>現在的重點是把台股資料接滿，不是急著送單。</h3>
        <p>
          Sponsor 999 讓公司頁可以逐步補 K 線、分 K、月營收、財報、法人、融資券、股利、PER/PBR、市值與股權資料。
          這裡只顯示資料來源狀態；KGI live submit 仍等 `libCGCrypt.so`，不會被這個面板解鎖。
        </p>
      </div>
      <div className="dashboard-readiness-lanes">
        <div className="dashboard-readiness-lane">
          <div>
            <span className="tg gold">來源狀態</span>
            <strong>{stateText(finmind.state)}</strong>
          </div>
          <StatePill state={finmind.state} />
          <p>{finmind.state === "LIVE" ? "FinMind token 存在，後端資料源診斷可讀。" : finmind.reason}</p>
        </div>
        <div className="dashboard-readiness-lane">
          <div>
            <span className="tg gold">可用資料集</span>
            <strong>{ready.length}</strong>
          </div>
          <StatePill state={ready.length > 0 ? "LIVE" : "EMPTY"} />
          <p>只計入已實作並可讀的官方 FinMind 資料集。</p>
        </div>
        <div className="dashboard-readiness-lane">
          <div>
            <span className="tg gold">待接資料集</span>
            <strong>{blocked.length}</strong>
          </div>
          <StatePill state={blocked.length > 0 ? "EMPTY" : "LIVE"} />
          <p>待接不代表錯誤，只代表前後端還沒有正式露出該資料。</p>
        </div>
      </div>
      <div className="dashboard-dataset-ribbon" aria-label="FinMind 資料集狀態">
        <span className="tg soft">已接資料</span>
        {(ready.length > 0 ? ready : blocked).slice(0, 9).map((dataset) => (
          <span className={`dashboard-dataset-token ${dataset.state === "READY" ? "is-ready" : "is-pending"}`} key={dataset.key}>
            {dataset.label}
          </span>
        ))}
        {datasets.length === 0 && <span className="dashboard-dataset-token is-pending">等待資料源診斷</span>}
      </div>
    </section>
  );
}

function ThemesPanel({ themes }: { themes: LoadState<ThemeRow[]> }) {
  const visibleThemes = themes.state === "LIVE"
    ? themes.data.filter((theme) => !isInternalCleanupTheme(theme)).slice(0, 8)
    : [];

  return (
    <Panel code="THM-SCOPE" title="主題資料" sub="台股主題與產業脈絡" right={<StatePill state={themes.state} />}>
      <SourceLine state={themes} label="主題資料" />
      <EmptyOrBlocked state={themes} />
      {themes.state === "LIVE" && (
        <div className="row dashboard-theme-row table-head tg">
          <span>#</span><span>主題</span><span>盤勢 / 階段</span><span>更新</span>
        </div>
      )}
      {visibleThemes.map((theme) => (
        <Link href={`/themes/${theme.slug}`} key={theme.id} className="row dashboard-theme-row">
          <span className="tg soft">{theme.priority}</span>
          <span>
            <strong className="tc" style={{ color: "var(--night-ink)", fontSize: 16 }}>{themeDisplayName(theme)}</strong>
            <span className="tg soft" style={{ display: "block", marginTop: 4 }}>{themeThesisText(theme)}</span>
          </span>
          <span className="tg gold">{marketText(theme.marketState)} / {lifecycleText(theme.lifecycle)}</span>
          <span className="tg soft">{formatDate(theme.updatedAt)}</span>
        </Link>
      ))}
    </Panel>
  );
}

function IdeasPanel({ ideas }: { ideas: LoadState<StrategyIdeaData | null> }) {
  const items = ideas.state === "LIVE" && ideas.data ? ideas.data.items.slice(0, 6) : [];
  return (
    <Panel code="IDEA-OPN" title="策略想法" sub="紙上候選，不自動送單" right={<StatePill state={ideas.state} />}>
      <SourceLine state={ideas} label="策略想法" />
      <EmptyOrBlocked state={ideas} />
      {items.map((idea) => (
        <div className="row idea-row" key={`${idea.companyId}-${idea.symbol}`}>
          <Link className="tg gold" href={`/companies/${idea.symbol}`}>
            {idea.symbol}
          </Link>
          <span className={`tg ${idea.direction === "bearish" ? "down" : idea.direction === "bullish" ? "up" : "muted"}`}>{directionText(idea.direction)}</span>
          <span className="num">{idea.score.toFixed(1)}</span>
          <span className={`tg ${idea.marketData.decision === "allow" ? "up" : idea.marketData.decision === "review" ? "gold" : "down"}`}>
            {decisionText(idea.marketData.decision)}
          </span>
          <span className="tc soft">{idea.companyName} / {reasonText(idea.rationale.primaryReason)}</span>
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
    <Panel code="SIG-TAPE" title="訊號證據" sub="正式訊號與依據" right={<StatePill state={signals.state} />}>
      <SourceLine state={signals} label="訊號證據" />
      {hiddenCount > 0 && <div className="tg soft" style={{ marginBottom: 10 }}>已隱藏內部測試訊號 {hiddenCount} 筆，不放入戰情判讀。</div>}
      <EmptyOrBlocked state={signals} />
      {visibleSignals.map((signal) => (
        <div className="row dashboard-signal-row" key={signal.id}>
          <span className="tg soft signal-time">{formatDateTime(signal.createdAt)}</span>
          <span className="tc signal-title-main">{signalTitleText(signal)}</span>
          <span className="tg soft signal-confidence">信心 {signal.confidence}</span>
          <span className={`tg signal-meta ${signal.direction === "bullish" ? "up" : signal.direction === "bearish" ? "down" : "gold"}`}>
            {categoryText(signal.category)} / {directionText(signal.direction)}
          </span>
        </div>
      ))}
    </Panel>
  );
}

function MarketIntelPanel({ news }: { news: LoadState<NewsItem[]> }) {
  return (
    <Panel code="MKT-INTEL" title="台股重大訊息" sub="公司公告與消息線索" right={<StatePill state={news.state} />}>
      <SourceLine state={news} label="重大訊息" />
      <EmptyOrBlocked state={news} />
      {news.state === "LIVE" && news.data.slice(0, 8).map((item) => (
        <Link href={`/companies/${item.ticker}`} className="row telex-row" key={`${item.ticker}-${item.id}`}>
          <span className="tg soft">{formatDate(item.date)}</span>
          <span className="tg gold">{item.ticker}</span>
          <span className="tc market-intel-title">{intelTitleText(item)}</span>
          <span className="tg soft">{categoryText(item.category)}</span>
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
      <Panel code="OPS-HLT" title="市場資料來源" sub="報價連線與資料新鮮度" right={<StatePill state={overview.state} />}>
        <SourceLine state={overview} label="市場資料來源" />
        <EmptyOrBlocked state={overview} />
        {providers.map((provider) => (
          <div className="row health-row" key={provider.source}>
            <span className="tg gold">{provider.source.toUpperCase()}</span>
            <span className={`tg ${provider.connected ? "status-ok" : "gold"}`}><span className="status-dot" />{provider.connected ? "連線" : "中斷"}</span>
            <span className="tg soft">{formatTime(provider.lastMessageAt)}</span>
            <span className="num soft">{provider.latencyMs ?? "--"}ms</span>
          </div>
        ))}
      </Panel>

      <Panel code="RUNS" title="策略批次紀錄" sub="策略候選產出與批次狀態" right={<StatePill state={runs.state} />}>
        <SourceLine state={runs} label="策略批次" />
        <EmptyOrBlocked state={runs} />
        {runItems.map((run) => (
          <Link href={`/runs/${run.id}`} className="row telex-row" style={{ gridTemplateColumns: "90px 1fr 70px" }} key={run.id}>
            <span className="tg soft">{formatDate(run.generatedAt)}</span>
            <span className="tg" style={{ color: "var(--night-ink)" }}>{run.topSymbols.join(" / ") || "尚無標的"}</span>
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
      reason: "公司資料尚未可用，因此暫時無法查詢個股重大訊息。",
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
      reason: "目前沒有可查詢重大訊息的公司。",
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
  const partialSource = failures > 0 ? `重大訊息；${failures}/${settled.length} 檔讀取失敗` : source;

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
      reason: "重大訊息端點暫時無法讀取。",
    } satisfies LoadState<NewsItem[]>;
  }

  return {
    state: "EMPTY",
    data: [],
    updatedAt,
    source: partialSource,
    reason: failures > 0
      ? "部分公司查詢失敗，其餘公司近 14 天沒有重大訊息。"
      : "選定公司近 14 天沒有重大訊息。",
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
      reason: friendlyDataError(error),
    };
  }
}

async function loadFinMindStatus(): Promise<LoadState<FinMindSourceStatus | null>> {
  const source = "FinMind Sponsor";
  const updatedAt = new Date().toISOString();
  try {
    const res = await getFinMindStatus();
    const data = res.data;
    if (!data.tokenPresent || data.state === "BLOCKED") {
      return {
        state: "BLOCKED",
        data,
        updatedAt: data.updatedAt || updatedAt,
        source,
        reason: "FinMind token 或資料源診斷尚未就緒。",
      };
    }
    return {
      state: "LIVE",
      data,
      updatedAt: data.updatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: null,
      updatedAt,
      source,
      reason: friendlyDataError(error),
    };
  }
}

async function loadOpenAliceStatus(): Promise<LoadState<Awaited<ReturnType<typeof getOpenAliceObservability>>["data"] | null>> {
  const source = "OpenAlice";
  const updatedAt = new Date().toISOString();
  try {
    const res = await getOpenAliceObservability();
    const data = res.data;
    if (data.workerStatus === "healthy" && data.sweepStatus === "healthy") {
      return {
        state: "LIVE",
        data,
        updatedAt: data.workerHeartbeatAt || data.lastSweepAt || updatedAt,
        source,
      };
    }
    return {
      state: "BLOCKED",
      data,
      updatedAt: data.workerHeartbeatAt || data.lastSweepAt || updatedAt,
      source,
      reason: `OpenAlice worker=${data.workerStatus}、sweep=${data.sweepStatus}；最近心跳 ${formatAge(data.workerHeartbeatAt)}。舊簡報或舊摘要不能當成今日資料。`,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: null,
      updatedAt,
      source,
      reason: friendlyDataError(error, "OpenAlice 觀測端點暫時無法讀取。"),
    };
  }
}

export default async function DashboardPage() {
  const [overview, themes, companies, ideas, runs, signals, watchlist, finmind, openalice] = await Promise.all([
    load("市場總覽", null, async () => (await getMarketDataOverview({ includeStale: true, topLimit: 5 })).data, (value) => value === null || value.quotes.total === 0),
    load("主題資料", [], async () => (await getThemes()).data, (value) => value.length === 0),
    load("公司資料", [], async () => (await getCompanies()).data, (value) => value.length === 0),
    load("策略想法", null, async () => (await getStrategyIdeas({ limit: 8, includeBlocked: true, decisionMode: "paper", sort: "score" })).data, (value) => value === null || value.items.length === 0),
    load("策略批次", null, async () => (await listStrategyRuns({ limit: 6, sort: "created_at" })).data, (value) => value === null || value.items.length === 0),
    load("訊號證據", [], async () => (await getSignals()).data, (value) => value.length === 0),
    loadWatchlist(),
    loadFinMindStatus(),
    loadOpenAliceStatus(),
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
    `FinMind ${stateText(finmind.state)}`,
    `OpenAlice ${stateText(openalice.state)}`,
  ].join(" / ");

  const heroStats = [
    { label: "市場總覽", value: stateText(marketOverview.state), tone: marketOverview.state === "LIVE" ? "status-ok" : marketOverview.state === "EMPTY" ? "muted" : "status-bad" },
    { label: "主題", value: themes.state === "LIVE" ? String(themes.data.length) : stateText(themes.state), tone: themes.state === "LIVE" ? "gold" : "muted" },
    { label: "策略想法", value: ideas.state === "LIVE" && ideas.data ? String(ideas.data.summary.total) : stateText(ideas.state), tone: ideas.state === "LIVE" ? "gold" : "muted" },
    { label: "訊號", value: signals.state === "LIVE" ? String(signals.data.filter((signal) => !isInternalTestSignal(signal)).length) : stateText(signals.state), tone: signals.state === "LIVE" ? "gold" : "muted" },
    { label: "FinMind", value: stateText(finmind.state), tone: finmind.state === "LIVE" ? "status-ok" : "status-bad" },
    { label: "OpenAlice", value: stateText(openalice.state), tone: openalice.state === "LIVE" ? "status-ok" : "status-bad" },
  ];
  const sourceStatuses: DashboardSourceStatus[] = [
    {
      label: "FinMind",
      state: finmind.state,
      source: finmind.source,
      updatedAt: finmind.updatedAt,
      reason: sourceReason(finmind),
      next: "FinMind 正常後會支援公司頁 K 線、財報、法人、融資券與股權資料。",
    },
    {
      label: "OpenAlice",
      state: openalice.state,
      source: openalice.source,
      updatedAt: openalice.updatedAt,
      reason: sourceReason(openalice),
      next: "OpenAlice 正常後才顯示今日 AI 摘要；過期摘要必須紅色揭露。",
    },
    {
      label: "市場總覽",
      state: marketOverview.state,
      source: marketOverview.source,
      updatedAt: marketOverview.updatedAt,
      reason: sourceReason(marketOverview),
      next: "市場資料恢復後會自動顯示報價、漲跌與量能排行。",
    },
    {
      label: "觀察清單",
      state: watchlist.state,
      source: watchlist.source,
      updatedAt: watchlist.updatedAt,
      reason: sourceReason(watchlist),
      next: "觀察清單恢復後會顯示報價與風控提示。",
    },
    {
      label: "主題資料",
      state: themes.state,
      source: themes.source,
      updatedAt: themes.updatedAt,
      reason: sourceReason(themes),
      next: "主題資料恢復後會顯示台股主題脈絡。",
    },
    {
      label: "策略想法",
      state: ideas.state,
      source: ideas.source,
      updatedAt: ideas.updatedAt,
      reason: sourceReason(ideas),
      next: "策略想法恢復後只作紙上候選，不會自動送單。",
    },
    {
      label: "訊號證據",
      state: signals.state,
      source: signals.source,
      updatedAt: signals.updatedAt,
      reason: sourceReason(signals),
      next: "訊號恢復後會顯示正式證據紀錄。",
    },
    {
      label: "重大訊息",
      state: news.state,
      source: news.source,
      updatedAt: news.updatedAt,
      reason: sourceReason(news),
      next: "重大訊息恢復後會顯示公司公告與消息線索。",
    },
  ];
  const dashboardDegraded = sourceStatuses.filter((section) => section.state === "BLOCKED").length >= 4;

  return (
    <PageFrame
      code="01"
      title="交易戰情室"
      sub="台股戰情台"
      note={`戰情台 / ${summary}`}
    >
      <section className="dashboard-hero dashboard-command-deck" aria-label="戰情台狀態">
        <div className="dashboard-hero-main">
          <span className="tg gold">IUF 台股戰情室</span>
          <h2>台股資料中樞，候選標的即時歸隊。</h2>
          <p>
            FinMind 負責盤勢、K 線、財報與籌碼補強；策略、訊號、重大訊息與觀察清單集中在同一張戰情圖。
            KGI live submit 仍等 `libCGCrypt.so`，交易送出層維持鎖定。
          </p>
          <div className="dashboard-hero-kpis dashboard-hero-kpis-inline">
            {heroStats.map((item) => (
              <div className="dashboard-hero-stat" key={item.label}>
                <span className="tg soft">{item.label}</span>
                <strong className={`num ${item.tone}`}>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="dashboard-source-rail" aria-label="資料來源狀態">
          {sourceStatuses.map((section) => (
            <div className="dashboard-source-chip" key={section.label}>
              <div>
                <span className="tg gold">{section.label}</span>
                <span className="tg soft"> / {formatDateTime(section.updatedAt)}</span>
              </div>
              <StatePill state={section.state} />
            </div>
          ))}
        </div>
      </section>

      <MarketStrip overview={marketOverview} />
      <FinMindStatusPanel finmind={finmind} />

      {dashboardDegraded && (
        <div className="dashboard-health-alert">
          <DashboardBlockedSummary sections={sourceStatuses} />
        </div>
      )}

      <div className={`main-grid dashboard-mosaic-grid ${dashboardDegraded ? "is-degraded" : ""}`}>
        <div className="dashboard-mosaic-primary">
          <Panel code="WCH-LST" title="觀察清單" sub="報價、風控與候選股" right={<StatePill state={watchlist.state} />}>
            <WatchlistSurface result={watchlist} />
          </Panel>
          <ThemesPanel themes={themes} />
          <IdeasPanel ideas={ideas} />
        </div>

        <div className="dashboard-mosaic-secondary">
          <MarketIntelPanel news={news} />
          <SignalsPanel signals={signals} />
          <OpsPanel overview={marketOverview} runs={runs} />
        </div>
      </div>
    </PageFrame>
  );
}
