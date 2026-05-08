import Link from "next/link";

import {
  getBriefs,
  getKillSwitch,
  getMarketDataOverview,
  getStrategyIdeas,
  getThemes,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { briefAgeCopy, briefAgeDays, briefFreshnessForDate, briefFreshnessLabel, briefFreshnessTone } from "@/lib/freshness";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";
import { reasonLabel } from "@/lib/strategy-vocab";

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
      reason: friendlyDataError(error, "行動簡報暫時無法讀取。"),
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
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function modeLabel(mode: string | null | undefined) {
  if (mode === "trading") return "可交易";
  if (mode === "paper_only") return "模擬模式";
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
  if (value === "Balanced") return "平衡";
  return value ?? "--";
}

function lifecycleLabel(value: string | null | undefined) {
  if (value === "active") return "啟用";
  if (value === "watch") return "觀察";
  if (value === "paused") return "暫停";
  if (value === "retired") return "退場";
  if (value === "Discovery") return "探索";
  if (value === "Validation") return "驗證";
  if (value === "Expansion") return "擴張";
  if (value === "Crowded") return "擁擠";
  return value ?? "--";
}

function mobileThemeName(theme: ThemeRow) {
  const bySlug: Record<string, string> = {
    "orphan-audit-trail": "稽核軌跡檢查",
    "orphan-ai-optics": "AI 光通訊 / CPO",
    "5g": "5G",
    abf: "ABF 載板",
    ai: "AI 伺服器",
    apple: "Apple 供應鏈",
    cowos: "CoWoS 先進封裝",
    cpo: "CPO 光通訊",
    euv: "EUV 先進製程",
    hbm: "HBM 高頻寬記憶體",
  };
  const slugLabel = bySlug[theme.slug.toLowerCase()];
  if (slugLabel) return slugLabel;
  const cleaned = cleanExternalHeadline(theme.name, "主題");
  return cleaned.replace(/^\[[^\]]+\]\s*/, "").trim() || "主題";
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

const MOB_CSS = `
  ._bty-mob-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 20px 16px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  ._bty-mob-title {
    font-size: 22px;
    font-weight: 700;
    color: rgba(255,255,255,0.9);
    margin: 4px 0 6px;
    line-height: 1.2;
  }
  ._bty-mob-sub {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
  }
  ._bty-mob-time {
    font-family: var(--mono, monospace);
    font-size: 18px;
    font-weight: 700;
    color: #ffb800;
    text-align: right;
  }
  ._bty-mob-state-pill {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
    margin-top: 4px;
  }
  ._bty-mob-section {
    padding: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  ._bty-mob-section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  ._bty-mob-section-code {
    font-size: 10px;
    color: #ffb800;
    font-weight: 600;
    font-family: var(--mono, monospace);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  ._bty-mob-section-right {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
  }
  ._bty-mob-card {
    margin: 10px 12px;
    padding: 14px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    min-height: 64px;
    text-decoration: none;
    color: inherit;
    display: block;
    transition: background 0.1s;
  }
  ._bty-mob-card:active, a._bty-mob-card:hover {
    background: rgba(255,255,255,0.07);
  }
  ._bty-mob-card-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
  }
  ._bty-mob-symbol {
    font-size: 17px;
    font-weight: 700;
    color: #ffb800;
    font-family: var(--mono, monospace);
  }
  ._bty-mob-dir-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    min-height: 22px;
  }
  ._bty-mob-dir-pill.up {
    background: rgba(255,107,53,0.2);
    color: #ff6b35;
    border: 1px solid rgba(255,107,53,0.3);
  }
  ._bty-mob-dir-pill.down {
    background: rgba(79,195,247,0.2);
    color: #4fc3f7;
    border: 1px solid rgba(79,195,247,0.3);
  }
  ._bty-mob-dir-pill.muted {
    background: rgba(150,150,150,0.15);
    color: rgba(255,255,255,0.5);
    border: 1px solid rgba(150,150,150,0.2);
  }
  ._bty-mob-metric-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    background: rgba(255,255,255,0.06);
    margin: 10px 12px;
    border-radius: 8px;
    overflow: hidden;
  }
  ._bty-mob-metric-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 8px;
    background: rgba(0,0,0,0.3);
    gap: 4px;
    min-height: 56px;
    justify-content: center;
  }
  ._bty-mob-metric-val {
    font-size: 18px;
    font-weight: 700;
    color: #e0e0e0;
    font-family: var(--mono, monospace);
    line-height: 1;
  }
  ._bty-mob-metric-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-align: center;
  }
  ._bty-mob-brief-card {
    margin: 10px 12px;
    padding: 14px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
  }
  ._bty-mob-brief-headline {
    font-size: 16px;
    font-weight: 600;
    color: rgba(255,255,255,0.9);
    line-height: 1.35;
    margin: 8px 0 6px;
  }
  ._bty-mob-brief-body {
    font-size: 13px;
    color: rgba(255,255,255,0.55);
    line-height: 1.65;
  }
  @media (prefers-reduced-motion: reduce) {
    ._bty-mob-card { transition: none !important; }
  }
`;

export default async function MobileBrief() {
  const result = await loadMobileBrief();
  const latestBrief = result.data.briefs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
  const latestBriefAgeDays = briefAgeDays(latestBrief?.date);
  const latestBriefFreshness = result.state === "LIVE" ? briefFreshnessForDate(latestBrief?.date) : "BLOCKED";
  const themes = result.data.themes.slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)).slice(0, 5);
  const ideas = result.data.ideas.slice(0, 4);
  const overview = result.data.overview;
  const activeSource = overview?.quotes.readiness.connectedSources.join("/") || "none";
  const mobileLive = result.state === "LIVE";

  const stateColor = result.state === "LIVE" ? "#4caf50" : result.state === "EMPTY" ? "#ffb800" : "#ef5350";
  const modeTone = result.data.kill?.mode === "trading" ? "#4caf50"
    : result.data.kill?.mode === "halted" ? "#ef5350"
    : "#ffb800";

  return (
    <main>
      <style>{MOB_CSS}</style>

      {/* Header */}
      <div className="_bty-mob-head">
        <div>
          <div className="_bty-mob-sub">IUF 交易戰情室</div>
          <div className="_bty-mob-title">盤前快覽</div>
          <div className="_bty-mob-sub">日報 / 主題 / 策略 / 風控</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            className="_bty-mob-state-pill"
            style={{
              background: `${stateColor}22`,
              color: stateColor,
              border: `1px solid ${stateColor}44`,
            }}
          >
            {stateLabel(result.state)}
          </div>
          <div className="_bty-mob-time">{formatTime(result.updatedAt)}</div>
        </div>
      </div>

      {result.state !== "LIVE" && (
        <section className="_bty-mob-section">
          <div className="_bty-mob-section-head">
            <span className="_bty-mob-section-code">SRC</span>
            <span className="_bty-mob-section-right">{stateLabel(result.state)}</span>
          </div>
          <div className="_bty-mob-card">
            <div className={`tg ${stateTone(result.state)}`} style={{ fontWeight: 600 }}>{stateLabel(result.state)}</div>
            <div className="tc soft" style={{ marginTop: 8, fontSize: 13 }}>{result.reason}</div>
          </div>
        </section>
      )}

      {/* Market metrics */}
      <section className="_bty-mob-section">
        <div className="_bty-mob-section-head">
          <span className="_bty-mob-section-code">MKT / 盤面資料</span>
          <span className="_bty-mob-section-right">{activeSource === "none" ? "無來源" : activeSource.toUpperCase()}</span>
        </div>
        {result.state !== "LIVE" ? (
          <div className="_bty-mob-card">
            <div className={`tg ${stateTone(result.state)}`} style={{ fontWeight: 600 }}>{stateLabel(result.state)}</div>
            <div className="tc soft" style={{ marginTop: 8, fontSize: 13 }}>行動簡報資料尚未正常，盤面指標先隱藏。</div>
          </div>
        ) : !overview ? (
          <div className="_bty-mob-card">
            <div className="tg gold" style={{ fontWeight: 600 }}>無資料</div>
            <div className="tc soft" style={{ marginTop: 8, fontSize: 13 }}>後端沒有回傳盤面總覽。</div>
          </div>
        ) : (
          <div className="_bty-mob-metric-grid">
            <div className="_bty-mob-metric-cell">
              <span className="_bty-mob-metric-val" style={{ color: modeTone, fontSize: 14 }}>{modeLabel(result.data.kill?.mode)}</span>
              <span className="_bty-mob-metric-lbl">交易模式</span>
            </div>
            <div className="_bty-mob-metric-cell">
              <span className="_bty-mob-metric-val" style={{ color: overview.quotes.fresh > 0 ? "#4caf50" : "#888" }}>{overview.quotes.total}</span>
              <span className="_bty-mob-metric-lbl">報價總數</span>
            </div>
            <div className="_bty-mob-metric-cell">
              <span className="_bty-mob-metric-val" style={{ color: "#ffb800" }}>{overview.quotes.readiness.effectiveSelection.paperUsable}</span>
              <span className="_bty-mob-metric-lbl">模擬可用</span>
            </div>
          </div>
        )}
      </section>

      {/* Latest brief */}
      <section className="_bty-mob-section">
        <div className="_bty-mob-section-head">
          <span className="_bty-mob-section-code">BRF / 最新日報</span>
          <span className="_bty-mob-section-right">{mobileLive ? briefFreshnessLabel(latestBriefFreshness) : stateLabel(result.state)}</span>
        </div>
        {!mobileLive && (
          <div className="_bty-mob-card">
            <div className={`tg ${stateTone(result.state)}`} style={{ fontWeight: 600 }}>{stateLabel(result.state)}</div>
            <div className="tc soft" style={{ marginTop: 8, fontSize: 13 }}>日報資料先隱藏，等待行動簡報資料恢復正常。</div>
          </div>
        )}
        {mobileLive && !latestBrief && (
          <div className="_bty-mob-card">
            <div className="tg gold" style={{ fontWeight: 600 }}>無資料</div>
            <div className="tc soft" style={{ marginTop: 8, fontSize: 13 }}>目前沒有每日簡報。</div>
          </div>
        )}
        {mobileLive && latestBrief && (
          <div className="_bty-mob-brief-card">
            <div className={`tg ${briefFreshnessTone(latestBriefFreshness)}`} style={{ fontSize: 12 }}>
              {latestBrief.date} / {briefAgeCopy(latestBriefAgeDays)} / {marketLabel(latestBrief.marketState)}
            </div>
            {latestBriefFreshness === "STALE" && (
              <div className="tc soft" style={{ marginTop: 6, fontSize: 12 }}>
                這不是今天的日報；等待 OpenAlice 重新產出今日來源追蹤列。
              </div>
            )}
            <div className="_bty-mob-brief-headline">{cleanExternalHeadline(latestBrief.sections[0]?.heading, "日報")}</div>
            <div className="_bty-mob-brief-body">{cleanNarrativeText(latestBrief.sections[0]?.body, "目前沒有日報內容。")}</div>
          </div>
        )}
      </section>

      {/* Themes */}
      <section className="_bty-mob-section">
        <div className="_bty-mob-section-head">
          <span className="_bty-mob-section-code">THM / 主題掃描</span>
          <span className="_bty-mob-section-right">{mobileLive ? `${themes.length} 筆` : stateLabel(result.state)}</span>
        </div>
        {!mobileLive && (
          <div className="_bty-mob-card">
            <div className={`tg ${stateTone(result.state)}`} style={{ fontWeight: 600 }}>{stateLabel(result.state)}</div>
            <div className="tc soft" style={{ marginTop: 8, fontSize: 13 }}>主題掃描先隱藏，等待行動簡報資料恢復正常。</div>
          </div>
        )}
        {mobileLive && themes.length === 0 && (
          <div className="_bty-mob-card">
            <div className="tg gold" style={{ fontWeight: 600 }}>無資料</div>
            <div className="tc soft" style={{ marginTop: 8, fontSize: 13 }}>目前沒有主題資料。</div>
          </div>
        )}
        {mobileLive && themes.map((theme) => {
          const name = mobileThemeName(theme);
          return (
            <Link className="_bty-mob-card" href={`/themes/${theme.slug}`} key={theme.id}>
              <div className="_bty-mob-card-row">
                <span className="tg gold" style={{ fontSize: 13, fontWeight: 600 }}>P{theme.priority} / {name}</span>
                <span className="tg soft" style={{ fontSize: 11 }}>{marketLabel(theme.marketState)}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{name}</div>
              <div className="tg soft" style={{ fontSize: 11, marginTop: 6 }}>{lifecycleLabel(theme.lifecycle)} / 核心 {theme.corePoolCount} / 觀察 {theme.observationPoolCount}</div>
            </Link>
          );
        })}
      </section>

      {/* Ideas */}
      <section className="_bty-mob-section">
        <div className="_bty-mob-section-head">
          <span className="_bty-mob-section-code">IDA / 模擬策略想法</span>
          <span className="_bty-mob-section-right">{mobileLive ? `${ideas.length} 筆` : stateLabel(result.state)}</span>
        </div>
        {!mobileLive && (
          <div className="_bty-mob-card">
            <div className={`tg ${stateTone(result.state)}`} style={{ fontWeight: 600 }}>{stateLabel(result.state)}</div>
            <div className="tc soft" style={{ marginTop: 8, fontSize: 13 }}>模擬策略想法先隱藏，等待行動簡報資料恢復正常。</div>
          </div>
        )}
        {mobileLive && ideas.length === 0 && (
          <div className="_bty-mob-card">
            <div className="tg gold" style={{ fontWeight: 600 }}>無資料</div>
            <div className="tc soft" style={{ marginTop: 8, fontSize: 13 }}>目前沒有模擬策略想法。</div>
          </div>
        )}
        {mobileLive && ideas.map((idea) => (
          <Link className="_bty-mob-card" href={`/companies/${idea.symbol}`} key={`${idea.companyId}-${idea.symbol}`}>
            <div className="_bty-mob-card-row">
              <span className="_bty-mob-symbol">{idea.symbol}</span>
              <span className={`_bty-mob-dir-pill ${directionTone(idea.direction)}`}>{directionLabel(idea.direction)}</span>
            </div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>{reasonLabel(idea.rationale.primaryReason)}</div>
            <div className="tg soft" style={{ fontSize: 12, marginTop: 7 }}>判斷 {decisionLabel(idea.marketData.decision)} / 分數 {idea.score.toFixed(1)} / 信心 {signed(idea.confidence * 100, 0)}%</div>
          </Link>
        ))}
      </section>
    </main>
  );
}
