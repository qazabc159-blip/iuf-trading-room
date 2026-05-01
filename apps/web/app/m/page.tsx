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
        reason: "行動簡報沒有日報、主題或策略想法資料。",
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

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function modeLabel(mode: string | null | undefined) {
  if (mode === "trading") return "可交易";
  if (mode === "paper_only") return "紙上模式";
  if (mode === "liquidate_only") return "只減倉";
  if (mode === "halted") return "全鎖定";
  return "未知";
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

function marketLabel(value: string | null | undefined) {
  if (value === "Attack") return "進攻";
  if (value === "Selective Attack") return "選擇性進攻";
  if (value === "Defense") return "防守";
  if (value === "Preservation") return "保全";
  return value ?? "--";
}

function lifecycleLabel(value: string | null | undefined) {
  if (value === "active") return "啟用";
  if (value === "watch") return "觀察";
  if (value === "paused") return "暫停";
  if (value === "retired") return "退場";
  return value ?? "--";
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
  const mobileLive = result.state === "LIVE";

  return (
    <main>
      <header className="mobile-head">
        <div>
          <div className="tg soft">IUF 交易戰情室 / 行動簡報</div>
          <h1>盤前快覽</h1>
          <div className="tg soft" style={{ marginTop: 8 }}>日報 / 主題 / 策略 / 風控</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</div>
          <div className="digits">{formatTime(result.updatedAt)}</div>
        </div>
      </header>

      {result.state !== "LIVE" && (
        <MobileSection code="SRC" title="資料狀態" right={stateLabel(result.state)}>
          <div className="mobile-card">
            <div className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</div>
            <div className="tc soft" style={{ marginTop: 8 }}>{result.reason}</div>
          </div>
        </MobileSection>
      )}

      <MobileSection code="MKT" title="盤面資料" right={activeSource === "none" ? "無來源" : activeSource.toUpperCase()}>
        {result.state !== "LIVE" ? (
          <div className="mobile-card">
            <div className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</div>
            <div className="tc soft" style={{ marginTop: 8 }}>行動簡報資料尚未正常，盤面指標先隱藏。</div>
          </div>
        ) : !overview ? (
          <div className="mobile-card">
            <div className="tg gold">無資料</div>
            <div className="tc soft" style={{ marginTop: 8 }}>後端沒有回傳盤面總覽。</div>
          </div>
        ) : (
          <>
            <MobileMetric label="交易模式" value={modeLabel(result.data.kill?.mode)} tone={result.data.kill?.engaged ? "down" : "gold"} />
            <MobileMetric label="報價" value={overview.quotes.total} sub={`${overview.quotes.fresh} 筆新鮮`} tone={overview.quotes.fresh > 0 ? "up" : "muted"} />
            <MobileMetric label="紙上可用" value={overview.quotes.readiness.effectiveSelection.paperUsable} sub={`${overview.quotes.readiness.effectiveSelection.blocked} 筆阻擋`} tone="gold" />
          </>
        )}
      </MobileSection>

      <MobileSection code="BRF" title="最新日報" right={mobileLive ? latestBrief?.status ?? "無資料" : stateLabel(result.state)}>
        {!mobileLive && <div className="mobile-card"><div className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</div><div className="tc soft">日報資料先隱藏，等待行動簡報資料恢復正常。</div></div>}
        {mobileLive && !latestBrief && <div className="mobile-card"><div className="tg gold">無資料</div><div className="tc soft">目前沒有每日簡報。</div></div>}
        {mobileLive && latestBrief && (
          <div className="mobile-card">
            <div className="tg gold">{latestBrief.date} / {marketLabel(latestBrief.marketState)}</div>
            <div className="tc" style={{ fontSize: 18, marginTop: 8 }}>{latestBrief.sections[0]?.heading ?? "日報"}</div>
            <div className="tc soft" style={{ marginTop: 7, lineHeight: 1.65 }}>{latestBrief.sections[0]?.body ?? "目前沒有日報內容。"}</div>
          </div>
        )}
      </MobileSection>

      <MobileSection code="THM" title="主題掃描" right={mobileLive ? `${themes.length} 筆` : stateLabel(result.state)}>
        {!mobileLive && <div className="mobile-card"><div className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</div><div className="tc soft">主題掃描先隱藏，等待行動簡報資料恢復正常。</div></div>}
        {mobileLive && themes.length === 0 && <div className="mobile-card"><div className="tg gold">無資料</div><div className="tc soft">目前沒有主題資料。</div></div>}
        {mobileLive && themes.map((theme) => (
          <Link className="mobile-card" href={`/themes/${theme.slug}`} key={theme.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="tg gold">P{theme.priority} / {theme.slug}</span>
              <span className="tg soft">{marketLabel(theme.marketState)}</span>
            </div>
            <div className="tc" style={{ fontSize: 18, marginTop: 5 }}>{theme.name}</div>
            <div className="tg soft" style={{ marginTop: 7 }}>{lifecycleLabel(theme.lifecycle)} / 核心 {theme.corePoolCount} / 觀察 {theme.observationPoolCount}</div>
          </Link>
        ))}
      </MobileSection>

      <MobileSection code="IDA" title="紙上策略想法" right={mobileLive ? `${ideas.length} 筆` : stateLabel(result.state)}>
        {!mobileLive && <div className="mobile-card"><div className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</div><div className="tc soft">紙上策略想法先隱藏，等待行動簡報資料恢復正常。</div></div>}
        {mobileLive && ideas.length === 0 && <div className="mobile-card"><div className="tg gold">無資料</div><div className="tc soft">目前沒有紙上策略想法。</div></div>}
        {mobileLive && ideas.map((idea) => (
          <Link className="mobile-card" href={`/companies/${idea.symbol}`} key={`${idea.companyId}-${idea.symbol}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="tg gold">{idea.symbol}</span>
              <span className={`tg session-pill ${directionTone(idea.direction)}`}>{directionLabel(idea.direction)}</span>
            </div>
            <div className="tc" style={{ marginTop: 8 }}>{idea.rationale.primaryReason}</div>
            <div className="tg soft" style={{ marginTop: 7 }}>判斷 {decisionLabel(idea.marketData.decision)} / 分數 {idea.score.toFixed(1)} / 信心 {signed(idea.confidence * 100, 0)}%</div>
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
