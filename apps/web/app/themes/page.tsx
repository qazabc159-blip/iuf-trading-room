import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getThemes } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanThemeThesis, THEME_THESIS_FALLBACK_TEXT } from "@/lib/operator-copy";
import { formatSourceTimestamp, latestIso, sourceFreshnessLabel } from "@/lib/source-freshness";

export const dynamic = "force-dynamic";

type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type LoadState =
  | { state: "LIVE"; data: ThemeRow[]; updatedAt: string; source: string }
  | { state: "EMPTY"; data: ThemeRow[]; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: ThemeRow[]; updatedAt: string; source: string; reason: string };

function friendlyError(error: unknown) {
  return friendlyDataError(error, "主題資料暫時無法讀取。");
}

async function loadThemes(): Promise<LoadState> {
  const source = "正式主題資料";
  const updatedAt = new Date().toISOString();

  try {
    const envelope = await getThemes();
    const data = envelope.data;
    if (data.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "目前沒有可顯示的正式主題。",
      };
    }
    return {
      state: "LIVE",
      data,
      updatedAt: latestIso(data.map((theme) => theme.updatedAt)) ?? updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: [],
      updatedAt,
      source,
      reason: friendlyError(error),
    };
  }
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

function marketLabel(state: ThemeRow["marketState"]) {
  if (state === "Attack") return "進攻";
  if (state === "Selective Attack") return "選擇進攻";
  if (state === "Defense") return "防守";
  if (state === "Preservation") return "保全";
  if (state === "Balanced") return "平衡";
  return state;
}

function marketTone(state: ThemeRow["marketState"]) {
  if (state === "Attack" || state === "Selective Attack") return "up";
  if (state === "Defense" || state === "Preservation") return "down";
  return "gold";
}

function marketBadgeColor(state: ThemeRow["marketState"]) {
  if (state === "Attack") return "#ff6b35";
  if (state === "Selective Attack") return "#ffb800";
  if (state === "Defense") return "#4fc3f7";
  if (state === "Preservation") return "#7986cb";
  return "#888";
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

function lifecycleBadgeColor(value: string | null | undefined) {
  if (value === "Expansion" || value === "active") return "rgba(76,175,80,0.25)";
  if (value === "Discovery" || value === "Validation") return "rgba(255,184,0,0.2)";
  if (value === "Crowded" || value === "Distribution") return "rgba(255,107,53,0.2)";
  if (value === "retired" || value === "paused") return "rgba(120,120,120,0.2)";
  return "rgba(100,100,100,0.2)";
}

function hasBrokenText(value: string | null | undefined) {
  if (!value) return false;
  return /�|Ã|Â|undefined|null/i.test(value);
}

function isEnglishHeavy(value: string | null | undefined) {
  if (!value) return false;
  const latin = value.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = value.match(/[一-鿿]/g)?.length ?? 0;
  return latin >= 12 && latin > cjk * 2;
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
  const mapped = bySlug[theme.slug.toLowerCase()];
  if (mapped) return mapped;
  return theme.name.replace(/^\[ORPHAN\]\s*/i, "待歸檔：");
}

function themeThesisText(theme: ThemeRow) {
  if (!theme.thesis || hasBrokenText(theme.thesis) || isEnglishHeavy(theme.thesis)) {
    return cleanThemeThesis(theme.slug, theme.thesis);
  }
  return cleanThemeThesis(theme.slug, theme.thesis);
}

/** Card-level description line: only render when there's a real description
 * (curated slug override or usable raw thesis) — the generic "說明待整理"
 * placeholder is honest but is filler when repeated on every card, so it's
 * omitted rather than shown. reports/product_critique_20260710/
 * PRODUCT_CRITIQUE_v1.md P1-6: "有就顯沒有就不加". */
function themeCardDescription(theme: ThemeRow): string | null {
  const text = themeThesisText(theme);
  return text === THEME_THESIS_FALLBACK_TEXT ? null : text;
}

function themeStageText(theme: ThemeRow) {
  const parts = [
    marketLabel(theme.marketState),
    lifecycleLabel(theme.lifecycle),
    theme.priority === 1 ? "優先追蹤" : "例行觀察",
  ];
  return parts.filter(Boolean).join(" / ");
}

function isInternalCleanupTheme(theme: ThemeRow) {
  const text = `${theme.slug} ${theme.name} ${theme.thesis ?? ""}`.toLowerCase();
  return /\bbroken\b|deprecated|placeholder|\[broken/.test(text);
}

function SourceLine({ result }: { result: LoadState }) {
  const freshness = result.state === "LIVE" ? sourceFreshnessLabel(result.updatedAt) : null;
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
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

const THEMES_CSS = `
  ._bty-theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
    margin-top: 16px;
  }
  ._bty-theme-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    text-decoration: none;
    color: inherit;
    transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease;
    position: relative;
    overflow: hidden;
  }
  ._bty-theme-card::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: var(--_accent, #ffb800);
    opacity: 0.7;
  }
  ._bty-theme-card:hover {
    transform: translateY(-3px);
    border-color: rgba(255,255,255,0.18);
    background: rgba(255,255,255,0.055);
  }
  ._bty-theme-card.priority-1 {
    border-color: rgba(255,184,0,0.25);
    background: rgba(255,184,0,0.04);
  }
  ._bty-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  ._bty-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  ._bty-p-badge {
    background: rgba(255,184,0,0.18);
    color: #ffb800;
    font-size: 11px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 3px;
  }
  ._bty-p1-badge {
    background: rgba(255,184,0,0.3);
    color: #ffd04d;
  }
  ._bty-card-title {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--night-ink, #e0e0e0);
  }
  ._bty-card-slug {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    font-family: var(--mono, monospace);
  }
  ._bty-card-thesis {
    font-size: 12px;
    line-height: 1.6;
    color: rgba(255,255,255,0.6);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  ._bty-card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.07);
  }
  ._bty-pool-row {
    display: flex;
    gap: 10px;
  }
  ._bty-pool-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  ._bty-pool-num {
    font-size: 16px;
    font-weight: 700;
    color: #ffb800;
    font-family: var(--mono, monospace);
    line-height: 1;
  }
  ._bty-pool-label {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
  }
  ._bty-hero-kpi {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 1px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  ._bty-kpi-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 8px;
    background: rgba(0,0,0,0.25);
    gap: 4px;
  }
  ._bty-kpi-val {
    font-size: 22px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    line-height: 1;
    color: #e0e0e0;
  }
  ._bty-kpi-val.ok { color: #4fc3f7; }
  ._bty-kpi-val.up { color: #ff6b35; }
  ._bty-kpi-val.down { color: #4fc3f7; }
  ._bty-kpi-val.gold { color: #ffb800; }
  ._bty-kpi-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.45);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  @media (prefers-reduced-motion: reduce) {
    ._bty-theme-card { transition: none !important; }
    ._bty-theme-card:hover { transform: none; }
  }
`;

export default async function ThemesPage() {
  const result = await loadThemes();
  const themes = result.data.slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const visibleThemes = themes.filter((theme) => !isInternalCleanupTheme(theme));
  const hiddenCleanupCount = themes.length - visibleThemes.length;
  const countsAvailable = result.state !== "BLOCKED";
  const attackCount = visibleThemes.filter((theme) => theme.marketState === "Attack" || theme.marketState === "Selective Attack").length;
  const defenseCount = visibleThemes.filter((theme) => theme.marketState === "Defense" || theme.marketState === "Preservation").length;
  const coreTotal = visibleThemes.reduce((sum, theme) => sum + theme.corePoolCount, 0);
  const observationTotal = visibleThemes.reduce((sum, theme) => sum + theme.observationPoolCount, 0);
  const priorityOneCount = visibleThemes.filter((theme) => theme.priority === 1).length;
  const activeCount = result.data.filter((theme) => theme.lifecycle === "Expansion" || theme.lifecycle === "Validation").length;
  // P1-6: when every classification bucket is 0 (no live theme is yet
  // attacking/defending/active/priority-1 — all still in research), showing
  // four separate "0" cells reads as broken rather than honest. Collapse
  // them into one explanatory sentence instead.
  const allClassificationZero =
    countsAvailable && attackCount === 0 && defenseCount === 0 && priorityOneCount === 0 && activeCount === 0;

  return (
    <PageFrame
      code="10"
      title="主題板"
      sub="台股主題階梯"
      note="主題板 / 正式主題資料；依產業與題材分類公司池，是查找個股研究與 AI 推薦標的的分類索引——點主題可看關聯公司，個股詳細研究在公司板、進場想法在 AI 推薦。只顯示已連結公司池與可追蹤狀態。"
    >
      <style>{THEMES_CSS}</style>

      {/* Hero KPI strip */}
      <div className="_bty-hero-kpi">
        <div className="_bty-kpi-cell">
          <span className={`_bty-kpi-val ${result.state === "LIVE" ? "ok" : "gold"}`}>{stateLabel(result.state)}</span>
          <span className="_bty-kpi-lbl">狀態</span>
        </div>
        <div className="_bty-kpi-cell">
          <span className="_bty-kpi-val gold">{countsAvailable ? visibleThemes.length : "--"}</span>
          <span className="_bty-kpi-lbl">主題總數</span>
        </div>
        {!allClassificationZero && (
          <>
            <div className="_bty-kpi-cell">
              <span className="_bty-kpi-val up">{countsAvailable ? attackCount : "--"}</span>
              <span className="_bty-kpi-lbl">進攻主題</span>
            </div>
            <div className="_bty-kpi-cell">
              <span className="_bty-kpi-val down">{countsAvailable ? defenseCount : "--"}</span>
              <span className="_bty-kpi-lbl">防守主題</span>
            </div>
          </>
        )}
        <div className="_bty-kpi-cell">
          <span className="_bty-kpi-val gold">{countsAvailable ? coreTotal : "--"}</span>
          <span className="_bty-kpi-lbl">核心公司</span>
        </div>
        <div className="_bty-kpi-cell">
          <span className="_bty-kpi-val">{countsAvailable ? observationTotal : "--"}</span>
          <span className="_bty-kpi-lbl">觀察公司</span>
        </div>
        {!allClassificationZero && (
          <div className="_bty-kpi-cell">
            <span className="_bty-kpi-val gold">{countsAvailable ? priorityOneCount : "--"}</span>
            <span className="_bty-kpi-lbl">優先追蹤主題</span>
          </div>
        )}
      </div>

      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">主題狀態</span>
          <span className={`parity-kpi-value ${result.state === "LIVE" ? "ok" : result.state === "EMPTY" ? "warn" : "bad"}`}>
            {result.state === "LIVE" ? "可用" : result.state === "EMPTY" ? "無主題" : "需處理"}
          </span>
          <span className="parity-kpi-sub">主題板</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">主題數</span>
          <span className="parity-kpi-value">{result.state !== "BLOCKED" ? result.data.length : "--"}</span>
          <span className="parity-kpi-sub">台股主題</span>
        </div>
        {!allClassificationZero && (
          <div className="parity-kpi-cell">
            <span className="parity-kpi-label">活躍主題</span>
            <span className={`parity-kpi-value ${activeCount > 0 ? "ok" : "dim"}`}>
              {result.state !== "BLOCKED" ? String(activeCount) : "--"}
            </span>
            <span className="parity-kpi-sub">成長/驗證期</span>
          </div>
        )}
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">研究中</span>
          <span className={`parity-kpi-value ${result.state !== "BLOCKED" && result.data.some((t) => t.lifecycle === "Discovery") ? "warn" : "dim"}`}>
            {result.state !== "BLOCKED" ? String(result.data.filter((t) => t.lifecycle === "Discovery").length) : "--"}
          </span>
          <span className="parity-kpi-sub">探索期</span>
        </div>
      </div>
      {result.state === "LIVE" && visibleThemes.length > 0 && allClassificationZero && (
        <div className="terminal-note compact">
          <span className="tg gold">主題分類建置中</span> 目前 {visibleThemes.length} 個主題皆在研究階段，暫無進攻／防守／活躍分類可顯示。
        </div>
      )}

      <Panel
        code="THM-LDR"
        title="主題雷達"
        sub="正式主題資料 / 公司池連結"
        right={stateLabel(result.state)}
      >
        <SourceLine result={result} />
        {result.state === "LIVE" && hiddenCleanupCount > 0 && (
          <div className="terminal-note compact">
            待整理主題 {hiddenCleanupCount} 筆已收納；不在正式主題表顯示待修、佔位或退役項目。
          </div>
        )}
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <div className="_bty-theme-grid">
            {visibleThemes.map((theme) => {
              const accentColor = marketBadgeColor(theme.marketState);
              const description = themeCardDescription(theme);
              return (
                <Link
                  href={`/themes/${theme.slug}`}
                  className={`_bty-theme-card${theme.priority === 1 ? " priority-1" : ""}`}
                  key={theme.id}
                  style={{ "--_accent": accentColor } as React.CSSProperties}
                >
                  <div className="_bty-card-header">
                    <span className={`_bty-p-badge${theme.priority === 1 ? " _bty-p1-badge" : ""}`}>P{theme.priority}</span>
                    <span
                      className="_bty-badge"
                      style={{
                        background: `${accentColor}22`,
                        color: accentColor,
                        border: `1px solid ${accentColor}44`,
                      }}
                    >
                      {marketLabel(theme.marketState)}
                    </span>
                    <span
                      className="_bty-badge"
                      style={{
                        background: lifecycleBadgeColor(theme.lifecycle),
                        color: "rgba(255,255,255,0.7)",
                      }}
                    >
                      {lifecycleLabel(theme.lifecycle)}
                    </span>
                    <span className="tg soft" style={{ marginLeft: "auto", fontSize: 11 }}>{formatDate(theme.updatedAt)}</span>
                  </div>

                  <div>
                    <div className="_bty-card-title">{themeDisplayName(theme)}</div>
                    <div className="_bty-card-slug">{theme.slug}</div>
                  </div>

                  {description && <p className="_bty-card-thesis">{description}</p>}

                  <div className="_bty-card-footer">
                    <span className="tg soft" style={{ fontSize: 11 }}>{themeStageText(theme)}</span>
                    <div className="_bty-pool-row">
                      <div className="_bty-pool-cell">
                        <span className="_bty-pool-num">{theme.corePoolCount}</span>
                        <span className="_bty-pool-label">核心</span>
                      </div>
                      <div className="_bty-pool-cell">
                        <span className="_bty-pool-num" style={{ color: "rgba(255,255,255,0.5)" }}>{theme.observationPoolCount}</span>
                        <span className="_bty-pool-label">觀察</span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Panel>
    </PageFrame>
  );
}
