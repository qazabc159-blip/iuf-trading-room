import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getCompanies, getSignals, getStrategyIdeas, getThemes } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText, cleanThemeThesis } from "@/lib/operator-copy";
import { MemberQuoteRow } from "./MemberQuoteRow";

export const dynamic = "force-dynamic";

type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type SignalRow = Awaited<ReturnType<typeof getSignals>>["data"][number];
type IdeasView = Awaited<ReturnType<typeof getStrategyIdeas>>["data"];
type IdeaRow = IdeasView["items"][number];
type DetailData = {
  theme: ThemeRow | null;
  companies: CompanyRow[];
  signals: SignalRow[];
  ideas: IdeaRow[];
};
type LoadState =
  | { state: "LIVE"; data: DetailData; updatedAt: string; source: string }
  | { state: "EMPTY"; data: DetailData; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: DetailData; updatedAt: string; source: string; reason: string };

const emptyData: DetailData = {
  theme: null,
  companies: [],
  signals: [],
  ideas: [],
};

async function loadThemeDetail(slug: string): Promise<LoadState> {
  const source = "正式主題資料 / 公司主檔 / 訊號資料 / 策略想法";
  const updatedAt = new Date().toISOString();

  try {
    const themesEnvelope = await getThemes();
    const theme = themesEnvelope.data.find((item) => item.slug === slug) ?? null;
    if (!theme) {
      return {
        state: "EMPTY",
        data: emptyData,
        updatedAt,
        source,
        reason: `找不到主題代碼 ${slug}。`,
      };
    }

    const [companiesEnvelope, signalsEnvelope, ideasEnvelope] = await Promise.all([
      getCompanies(),
      getSignals({ themeId: theme.id }),
      getStrategyIdeas({
        themeId: theme.id,
        decisionMode: "paper",
        includeBlocked: true,
        limit: 20,
        sort: "score",
      }),
    ]);
    return {
      state: "LIVE",
      data: {
        theme,
        companies: companiesEnvelope.data.filter((company) => company.themeIds.includes(theme.id)),
        signals: signalsEnvelope.data,
        ideas: ideasEnvelope.data.items,
      },
      updatedAt: theme.updatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyData,
      updatedAt,
      source,
      reason: friendlyDataError(error, "主題明細暫時無法讀取。"),
    };
  }
}

function formatTime(value: string | null | undefined) {
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

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
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

function marketStateLabel(state: ThemeRow["marketState"] | string | null | undefined) {
  if (state === "Attack") return "進攻";
  if (state === "Selective Attack") return "選擇性進攻";
  if (state === "Defense") return "防守";
  if (state === "Preservation") return "保全";
  return state ?? "--";
}

function lifecycleLabel(value: string | null | undefined) {
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

function marketTone(state: ThemeRow["marketState"]) {
  if (state === "Attack" || state === "Selective Attack") return "up";
  if (state === "Defense" || state === "Preservation") return "down";
  return "gold";
}

function directionTone(direction: IdeaRow["direction"] | SignalRow["direction"]) {
  if (direction === "bullish") return "up";
  if (direction === "bearish") return "down";
  return "muted";
}

function directionLabel(direction: IdeaRow["direction"] | SignalRow["direction"]) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "中性";
}

function decisionTone(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return "up";
  if (decision === "review") return "gold";
  return "down";
}

function decisionLabel(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待審";
  return "不進流程";
}

function categoryLabel(value: string | null | undefined) {
  if (!value) return "未分類";
  const key = value.toLowerCase();
  if (key === "earnings") return "財報";
  if (key === "revenue") return "營收";
  if (key === "news") return "新聞";
  if (key === "company") return "公司";
  if (key === "market") return "市場";
  if (key === "industry") return "產業";
  if (key === "theme") return "主題";
  if (key === "technical") return "技術";
  if (key === "fundamental") return "基本面";
  if (key === "test" || key === "dryrun") return "驗證";
  return value.replace(/[_-]/g, " ");
}

function themeDisplayName(theme: ThemeRow) {
  const bySlug: Record<string, string> = {
    "orphan-audit-trail": "待歸檔稽核軌跡",
    "orphan-ai-optics": "AI 光通訊封裝",
    "5g": "5G 通訊",
    abf: "ABF 載板",
    ai: "AI 伺服器",
    apple: "Apple 供應鏈",
    cowos: "CoWoS 先進封裝",
    cpo: "CPO 光通訊",
  };
  return bySlug[theme.slug.toLowerCase()] ?? theme.name.replace(/^\[ORPHAN\]\s*/i, "待歸檔：");
}

function themeThesisText(theme: ThemeRow) {
  return cleanThemeThesis(theme.slug, theme.thesis);
}

function themeNarrative(value: string | null | undefined) {
  return cleanNarrativeText(value, "主題敘述待整理；目前僅保留來源資料，不作自動解讀。");
}

function signalText(signal: SignalRow) {
  const value = `${signal.title || "未命名訊號"}${signal.summary ? ` / ${signal.summary}` : ""}`;
  return cleanExternalHeadline(value, "訊號文字待整理；保留來源紀錄，不納入正式判讀。");
}

function isInternalTestSignal(signal: SignalRow) {
  const text = `${signal.title} ${signal.summary ?? ""} ${signal.category}`.toLowerCase();
  return /bruce|dryrun|smoke|test signal|verify/.test(text);
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{stateLabel(result.state)}</span>
      <span>主題資料 / 公司 / 訊號 / 策略想法</span>
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

const DETAIL_CSS = `
  ._bty-detail-layout {
    display: grid;
    grid-template-columns: 1fr 340px;
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 900px) {
    ._bty-detail-layout { grid-template-columns: 1fr; }
  }
  ._bty-hero-accent {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 12px;
  }
  ._bty-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }
  ._bty-theme-title {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.2;
    color: var(--night-ink, #e0e0e0);
    margin-bottom: 4px;
  }
  ._bty-theme-thesis {
    font-size: 13px;
    line-height: 1.7;
    color: rgba(255,255,255,0.65);
    margin: 10px 0 0;
  }
  ._bty-notes-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 14px;
  }
  @media (max-width: 600px) {
    ._bty-notes-grid { grid-template-columns: 1fr; }
  }
  ._bty-note-box {
    padding: 10px 12px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
  }
  ._bty-note-label {
    font-size: 10px;
    color: #ffb800;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 5px;
  }
  ._bty-note-text {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    line-height: 1.6;
  }
  ._bty-member-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
    margin-top: 10px;
  }
  ._bty-member-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,184,0,0.15);
    border-radius: 6px;
    transition: background 0.1s, border-color 0.1s;
  }
  ._bty-member-card:hover {
    background: rgba(255,184,0,0.06);
    border-color: rgba(255,184,0,0.35);
  }
  ._bty-member-card-link {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-decoration: none;
    color: inherit;
  }
  ._bty-member-quote-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid rgba(255,255,255,0.06);
    position: relative;
    z-index: 1;
  }
  ._bty-member-price {
    font-family: var(--mono, monospace);
    font-size: 11px;
    color: rgba(255,255,255,0.7);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  ._bty-member-price i {
    font-style: normal;
    font-size: 10px;
  }
  ._bty-member-price[data-tone="up"] { color: #ff6b35; }
  ._bty-member-price[data-tone="down"] { color: #2ecc71; }
  ._bty-member-price[data-tone="flat"] { color: rgba(255,255,255,0.5); }
  ._bty-member-watch-btn {
    min-height: 26px;
    padding: 0 8px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.03);
    color: rgba(255,255,255,0.75);
    font-size: 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  ._bty-member-watch-btn[data-tone="ok"] {
    border-color: rgba(46,204,113,0.5);
    background: rgba(46,204,113,0.14);
    color: #4adb88;
  }
  ._bty-member-watch-btn[data-tone="bad"] {
    border-color: rgba(230,57,70,0.5);
    background: rgba(230,57,70,0.14);
    color: #ff6b77;
  }
  ._bty-member-watch-btn:disabled {
    cursor: default;
    opacity: 0.85;
  }
  @media (max-width: 480px) {
    ._bty-member-watch-btn { min-height: 34px; padding: 0 10px; }
  }
  ._bty-member-ticker {
    font-size: 15px;
    font-weight: 700;
    color: #ffb800;
    font-family: var(--mono, monospace);
  }
  ._bty-member-name {
    font-size: 12px;
    color: rgba(255,255,255,0.8);
    font-weight: 500;
  }
  ._bty-member-meta {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
  }
  ._bty-idea-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  ._bty-idea-card {
    padding: 10px 12px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.07);
    border-left: 3px solid rgba(255,184,0,0.4);
    border-radius: 4px;
  }
  ._bty-idea-row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  ._bty-signal-stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  ._bty-signal-card {
    padding: 9px 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 4px;
  }
  ._bty-signal-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 5px;
  }
  ._bty-signal-text {
    font-size: 12px;
    color: rgba(255,255,255,0.75);
    line-height: 1.5;
  }
  @media (prefers-reduced-motion: reduce) {
    ._bty-member-card { transition: none !important; }
  }
`;

export default async function ThemeDetailPage({ params }: { params: Promise<{ short: string }> }) {
  const { short } = await params;
  const result = await loadThemeDetail(short);
  const theme = result.data.theme;
  const displaySignals = result.data.signals.filter((signal) => !isInternalTestSignal(signal));
  const detailLive = result.state === "LIVE";
  const dependentState = result.state === "EMPTY" ? "EMPTY" : "BLOCKED";
  const dependentTone = result.state === "EMPTY" ? "gold" : "status-bad";
  const dependentReason =
    result.state === "EMPTY"
      ? "找不到主題主檔，因此不顯示相關公司、訊號與策略想法。"
      : "主題明細資料暫停，相關公司、訊號與策略想法先隱藏。";
  const coreCount = detailLive && theme ? theme.corePoolCount : null;
  const observationCount = detailLive && theme ? theme.observationPoolCount : null;
  const memberCount = detailLive ? result.data.companies.length : null;
  const ideaCount = detailLive ? result.data.ideas.length : null;
  const signalCount = detailLive ? displaySignals.length : null;

  return (
    <PageFrame
      code={theme ? `10-${theme.priority}` : "10-D"}
      title={theme ? themeDisplayName(theme) : short}
      sub={theme ? `${theme.slug} / ${marketStateLabel(theme.marketState)}` : "主題明細暫停"}
      note="此頁讀取正式主題、公司、訊號與策略想法；只顯示已接上來源的研究資料，不提供下單動作。"
    >
      <style>{DETAIL_CSS}</style>

      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "優先", value: theme?.priority ?? "--", tone: theme?.priority === 1 ? "gold" : "muted" },
          { label: "核心", value: coreCount ?? "--", tone: (coreCount ?? 0) > 0 ? "gold" : "muted" },
          { label: "觀察", value: observationCount ?? "--" },
          { label: "成員", value: memberCount ?? "--" },
          { label: "想法", value: ideaCount ?? "--", tone: (ideaCount ?? 0) > 0 ? "up" : "muted" },
          { label: "訊號", value: signalCount ?? "--" },
        ]}
        columns={7}
      />

      <div className="_bty-detail-layout">
        <div>
          <Panel code="THM-SRC" title="主題工作頁" sub="投資命題 / 現在性" right={stateLabel(result.state)}>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            {theme && (
              <div>
                <div className="_bty-hero-accent">
                  <span
                    className="_bty-badge"
                    style={{
                      background: marketTone(theme.marketState) === "up" ? "rgba(255,107,53,0.2)" : "rgba(79,195,247,0.2)",
                      color: marketTone(theme.marketState) === "up" ? "#ff6b35" : "#4fc3f7",
                      border: `1px solid ${marketTone(theme.marketState) === "up" ? "rgba(255,107,53,0.4)" : "rgba(79,195,247,0.4)"}`,
                    }}
                  >
                    {marketStateLabel(theme.marketState)}
                  </span>
                  <span className="_bty-badge" style={{ background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" }}>
                    {lifecycleLabel(theme.lifecycle)}
                  </span>
                  <span className="_bty-badge" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>
                    P{theme.priority} 優先序
                  </span>
                  <span className="tg soft" style={{ fontSize: 11, marginLeft: "auto" }}>更新 {formatDate(theme.updatedAt)}</span>
                </div>
                <div className="_bty-theme-title">{themeDisplayName(theme)}</div>
                <div className="tg soft" style={{ fontSize: 11 }}>{theme.slug} / 正式主題主檔</div>
                <p className="_bty-theme-thesis">{themeThesisText(theme)}</p>
                <div className="_bty-notes-grid">
                  <div className="_bty-note-box">
                    <div className="_bty-note-label">現在性</div>
                    <div className="_bty-note-text">{themeNarrative(theme.whyNow)}</div>
                  </div>
                  <div className="_bty-note-box">
                    <div className="_bty-note-label">瓶頸</div>
                    <div className="_bty-note-text">{themeNarrative(theme.bottleneck)}</div>
                  </div>
                </div>
              </div>
            )}
          </Panel>

          <Panel code="MEM-LST" title="成員公司" sub="正式公司主檔連結" right={detailLive ? `${result.data.companies.length} 檔` : stateLabel(dependentState)}>
            {!detailLive && <div className="terminal-note"><span className={`tg ${dependentTone}`}>{stateLabel(dependentState)}</span> {dependentReason}</div>}
            {detailLive && result.data.companies.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有公司掛在此主題。</div>}
            {detailLive && result.data.companies.length > 0 && (
              <div className="_bty-member-grid">
                {result.data.companies.map((company) => (
                  <div className="_bty-member-card" key={company.id}>
                    <Link className="_bty-member-card-link" href={`/companies/${company.ticker}`}>
                      <span className="_bty-member-ticker">{company.ticker}</span>
                      <span className="_bty-member-name">{company.name}</span>
                      <span className="_bty-member-meta">{company.market} / {company.chainPosition}</span>
                      <span className="_bty-member-meta">{company.beneficiaryTier}</span>
                    </Link>
                    <MemberQuoteRow ticker={company.ticker} name={company.name} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div>
          <Panel code="IDEA-ATT" title="連結策略想法" sub="依主題篩選正式策略資料" right={detailLive ? `${result.data.ideas.length} 筆` : stateLabel(dependentState)}>
            {!detailLive && <div className="terminal-note"><span className={`tg ${dependentTone}`}>{stateLabel(dependentState)}</span> {dependentReason}</div>}
            {detailLive && result.data.ideas.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有策略想法掛在此主題。</div>}
            {detailLive && result.data.ideas.length > 0 && (
              <div className="_bty-idea-stack">
                {result.data.ideas.slice(0, 8).map((idea) => (
                  <div className="_bty-idea-card" key={`${idea.companyId}-${idea.symbol}`}>
                    <div className="_bty-idea-row">
                      <Link href={`/companies/${idea.symbol}`} className="tg gold" style={{ fontWeight: 700, fontSize: 14 }}>{idea.symbol}</Link>
                      <span className={`tg ${directionTone(idea.direction)}`} style={{ fontSize: 11 }}>{directionLabel(idea.direction)}</span>
                      <span className={`tg ${decisionTone(idea.marketData.decision)}`} style={{ fontSize: 11 }}>{decisionLabel(idea.marketData.decision)}</span>
                      <span className="num" style={{ marginLeft: "auto", fontSize: 16, fontWeight: 700 }}>{idea.score.toFixed(1)}</span>
                    </div>
                    <div className="tc soft" style={{ fontSize: 11 }}>{cleanNarrativeText(idea.rationale.primaryReason, "策略原因待整理；只保留候選列，不自動轉委託。")}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel code="SIG-TAPE" title="主題訊號流" sub="正式訊號資料" right={detailLive ? `${displaySignals.length} 則` : stateLabel(dependentState)}>
            {!detailLive && <div className="terminal-note"><span className={`tg ${dependentTone}`}>{stateLabel(dependentState)}</span> {dependentReason}</div>}
            {detailLive && displaySignals.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有正式訊號掛在此主題；驗證訊號不顯示。</div>}
            {detailLive && displaySignals.length > 0 && (
              <div className="_bty-signal-stack">
                {displaySignals.slice(0, 10).map((signal) => (
                  <div className="_bty-signal-card" key={signal.id}>
                    <div className="_bty-signal-meta">
                      <span className="tg soft" style={{ fontSize: 10 }}>{formatTime(signal.createdAt)}</span>
                      <span className="_bty-badge" style={{ background: "rgba(255,184,0,0.12)", color: "#ffb800", padding: "1px 6px", fontSize: 10 }}>{categoryLabel(signal.category)}</span>
                      <span className={`tg ${directionTone(signal.direction)}`} style={{ fontSize: 11 }}>{directionLabel(signal.direction)}</span>
                      <span className="tg soft" style={{ fontSize: 10 }}>信心 {signal.confidence}</span>
                    </div>
                    <div className="_bty-signal-text">{signalText(signal)}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
