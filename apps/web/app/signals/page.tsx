import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getCompanies, getSignals, getThemes } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline } from "@/lib/operator-copy";
import { formatSourceTimestamp, latestIso, sourceFreshnessLabel } from "@/lib/source-freshness";

export const dynamic = "force-dynamic";

type SignalRow = Awaited<ReturnType<typeof getSignals>>["data"][number];
type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type SignalData = {
  signals: SignalRow[];
  themes: ThemeRow[];
  companies: CompanyRow[];
};
type LoadState =
  | { state: "LIVE"; data: SignalData; updatedAt: string; source: string }
  | { state: "EMPTY"; data: SignalData; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: SignalData; updatedAt: string; source: string; reason: string };

const emptyData: SignalData = {
  signals: [],
  themes: [],
  companies: [],
};

function friendlyError(error: unknown) {
  return friendlyDataError(error, "訊號資料暫時無法讀取。");
}

async function loadSignals(): Promise<LoadState> {
  const source = "正式訊號資料";
  const updatedAt = new Date().toISOString();

  try {
    const [signalsEnvelope, themesEnvelope, companiesEnvelope] = await Promise.all([
      getSignals(),
      getThemes(),
      getCompanies(),
    ]);
    const data = {
      signals: signalsEnvelope.data,
      themes: themesEnvelope.data,
      companies: companiesEnvelope.data,
    };
    if (data.signals.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "目前沒有可顯示的正式訊號。",
      };
    }
    return {
      state: "LIVE",
      data,
      updatedAt: latestIso(data.signals.map((signal) => signal.createdAt)) ?? updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyData,
      updatedAt,
      source,
      reason: friendlyError(error),
    };
  }
}

function formatDateTime(value: string | null | undefined) {
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

function directionLabel(direction: SignalRow["direction"]) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "中性";
}

function directionTone(direction: SignalRow["direction"]) {
  if (direction === "bullish") return "up";
  if (direction === "bearish") return "down";
  return "muted";
}

function confidenceTone(confidence: number) {
  if (confidence >= 4) return "gold";
  if (confidence <= 2) return "down";
  return "muted";
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

function isInternalTestSignal(signal: SignalRow) {
  const text = `${signal.title} ${signal.summary ?? ""} ${signal.category}`.toLowerCase();
  return /bruce|dryrun|smoke|test signal|verify/.test(text);
}

function signalTitle(signal: SignalRow) {
  const value = `${signal.title || "未命名訊號"}${signal.summary ? ` / ${signal.summary}` : ""}`;
  if (hasBrokenText(value)) return "訊號文字待整理；保留來源紀錄，不作交易解讀。";
  const cleaned = value.replace(/^bruce-wave\d*-verify:\s*/i, "驗證訊號：");
  if ((/^[\x00-\x7F\s%.,:;()/-]+$/.test(cleaned) && /[A-Za-z]/.test(cleaned)) || isEnglishHeavy(cleaned)) {
    return cleanExternalHeadline(cleaned, "外文訊號待整理；保留來源紀錄，不納入正式判讀。");
  }
  return cleanExternalHeadline(cleaned, "外文訊號待整理；保留來源紀錄，不納入正式判讀。");
}

function themeLinkLabel(theme: ThemeRow) {
  return cleanExternalHeadline(theme.name.replace(/^\[ORPHAN\]\s*/i, "待歸檔："), "主題名稱待整理");
}

function firstTheme(signal: SignalRow, themes: ThemeRow[]) {
  const themeId = signal.themeIds[0];
  return themeId ? themes.find((theme) => theme.id === themeId) ?? null : null;
}

function firstCompany(signal: SignalRow, companies: CompanyRow[]) {
  const companyId = signal.companyIds[0];
  return companyId ? companies.find((company) => company.id === companyId) ?? null : null;
}

function directionAccent(direction: SignalRow["direction"]) {
  if (direction === "bullish") return "rgba(230,57,70,0.18)";
  if (direction === "bearish") return "rgba(46,204,113,0.18)";
  return "rgba(145,160,181,0.10)";
}

function directionBorder(direction: SignalRow["direction"]) {
  if (direction === "bullish") return "rgba(230,57,70,0.55)";
  if (direction === "bearish") return "rgba(46,204,113,0.55)";
  return "rgba(145,160,181,0.30)";
}

function confidenceWidth(confidence: number) {
  return `${Math.min(100, (confidence / 5) * 100)}%`;
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

const SIGNALS_CSS = `
._sig-hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 1px;
  background: rgba(220,228,240,0.09);
  border: 1px solid rgba(220,228,240,0.13);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 28px;
}
._sig-hero-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 22px;
  background: rgba(8,11,16,0.82);
  transition: background 0.15s;
}
._sig-hero-cell:hover {
  background: rgba(255,255,255,0.03);
}
._sig-hero-val {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -1px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  font-family: var(--mono, monospace);
}
._sig-hero-lbl {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.7);
  font-family: var(--mono, monospace);
}
._sig-grid {
  display: grid;
  gap: 12px;
  margin-top: 8px;
}
._sig-card {
  position: relative;
  display: grid;
  gap: 12px;
  padding: 20px 24px;
  border-radius: 4px;
  border: 1px solid rgba(220,228,240,0.08);
  border-left: 3px solid;
  background: rgba(8,11,16,0.55);
  transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s;
  cursor: default;
  overflow: hidden;
}
._sig-card:hover {
  transform: translateY(-2px);
  background: rgba(14,18,26,0.82);
  box-shadow: 0 8px 28px rgba(0,0,0,0.38);
}
@media (prefers-reduced-motion: reduce) {
  ._sig-card { transition: none; }
  ._sig-card:hover { transform: none; }
}
._sig-card-glow {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 80px;
  pointer-events: none;
}
._sig-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1;
}
._sig-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  font-family: var(--mono, monospace);
}
._sig-badge-bull {
  background: rgba(230,57,70,0.14);
  border: 1px solid rgba(230,57,70,0.48);
  color: #ff6b77;
}
._sig-badge-bear {
  background: rgba(46,204,113,0.12);
  border: 1px solid rgba(46,204,113,0.48);
  color: #4adb88;
}
._sig-badge-neutral {
  background: rgba(145,160,181,0.09);
  border: 1px solid rgba(145,160,181,0.28);
  color: #91a0b5;
}
._sig-badge-cat {
  background: rgba(200,148,63,0.10);
  border: 1px solid rgba(200,148,63,0.35);
  color: #e2b85c;
}
._sig-title {
  font-size: 15px;
  font-weight: 600;
  color: #e7ecf3;
  line-height: 1.6;
  overflow-wrap: break-word;
  word-break: normal;
  position: relative;
  z-index: 1;
}
._sig-conf-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1;
}
._sig-conf-track {
  flex: 1;
  height: 3px;
  background: rgba(220,228,240,0.08);
  border-radius: 2px;
  overflow: hidden;
}
._sig-conf-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}
._sig-links {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  position: relative;
  z-index: 1;
}
._sig-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 56px 32px;
  text-align: center;
}
._sig-empty-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(220,228,240,0.04);
  border: 1px solid rgba(220,228,240,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
._sig-skel {
  animation: _sig-pulse 1.4s ease-in-out infinite;
  background: rgba(220,228,240,0.05);
  border-radius: 4px;
}
@keyframes _sig-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
`;

export default async function SignalsPage() {
  const result = await loadSignals();
  const signals = result.data.signals.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const displaySignals = signals.filter((signal) => !isInternalTestSignal(signal));
  const hiddenInternalCount = signals.length - displaySignals.length;
  const countsAvailable = result.state !== "BLOCKED";
  const bullCount = displaySignals.filter((signal) => signal.direction === "bullish").length;
  const bearCount = displaySignals.filter((signal) => signal.direction === "bearish").length;
  const neutralCount = displaySignals.filter((signal) => signal.direction === "neutral").length;
  const highConfidenceCount = displaySignals.filter((signal) => signal.confidence >= 4).length;
  const categories = new Set(displaySignals.map((signal) => signal.category));

  return (
    <PageFrame
      code="08"
      title="訊號證據"
      sub="訊號流"
      note="訊號證據 / 正式訊號資料；連結主題與公司，不顯示假訊號。"
    >
      <style>{SIGNALS_CSS}</style>

      {/* Hero KPI bar */}
      <div className="_sig-hero">
        <div className="_sig-hero-cell">
          <span className="_sig-hero-val" style={{ color: countsAvailable ? "#e7ecf3" : "#566276" }}>
            {countsAvailable ? displaySignals.length : "--"}
          </span>
          <span className="_sig-hero-lbl">今日訊號</span>
        </div>
        <div className="_sig-hero-cell">
          <span className="_sig-hero-val" style={{ color: countsAvailable && bullCount > 0 ? "#ff6b77" : "#566276" }}>
            {countsAvailable ? bullCount : "--"}
          </span>
          <span className="_sig-hero-lbl">偏多</span>
        </div>
        <div className="_sig-hero-cell">
          <span className="_sig-hero-val" style={{ color: countsAvailable && bearCount > 0 ? "#4adb88" : "#566276" }}>
            {countsAvailable ? bearCount : "--"}
          </span>
          <span className="_sig-hero-lbl">偏空</span>
        </div>
        <div className="_sig-hero-cell">
          <span className="_sig-hero-val" style={{ color: countsAvailable && highConfidenceCount > 0 ? "#e2b85c" : "#566276" }}>
            {countsAvailable ? highConfidenceCount : "--"}
          </span>
          <span className="_sig-hero-lbl">高信心</span>
        </div>
        <div className="_sig-hero-cell">
          <span className="_sig-hero-val" style={{ color: countsAvailable ? "#e7ecf3" : "#566276" }}>
            {countsAvailable ? categories.size : "--"}
          </span>
          <span className="_sig-hero-lbl">分類數</span>
        </div>
      </div>

      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "總數", value: countsAvailable ? displaySignals.length : "--" },
          { label: "偏多", value: countsAvailable ? bullCount : "--", tone: "up" },
          { label: "偏空", value: countsAvailable ? bearCount : "--", tone: "down" },
          { label: "中性", value: countsAvailable ? neutralCount : "--", tone: "muted" },
          { label: "分類", value: countsAvailable ? categories.size : "--" },
          { label: "高信心", value: countsAvailable ? highConfidenceCount : "--", tone: "gold" },
        ]}
        columns={7}
      />

      <Panel
        code="SIG-TAPE"
        title="訊號流"
        sub="時間序訊號流 / 正式資料"
        right={stateLabel(result.state)}
      >
        <SourceLine result={result} />
        {hiddenInternalCount > 0 && (
          <div className="terminal-note compact">
            驗證訊號 {hiddenInternalCount} 筆已收納，不放入正式訊號清單；正式清單只顯示可連結主題或公司的資料列。
          </div>
        )}
        <EmptyOrBlocked result={result} />

        {/* Empty state illustration */}
        {result.state === "EMPTY" && (
          <div className="_sig-empty-state">
            <div className="_sig-empty-icon">
              <span style={{ color: "#e2b85c", fontSize: 24 }}>⊘</span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#c6d0de", marginBottom: 6 }}>目前沒有訊號</div>
              <div style={{ fontSize: 13, color: "#566276", lineHeight: 1.6 }}>
                正式訊號需通過來源審核才會進入此流；等待背景服務掃描後產出。
              </div>
            </div>
          </div>
        )}

        {result.state === "BLOCKED" && (
          <div className="_sig-empty-state">
            <div className="_sig-empty-icon">
              <span style={{ color: "#e63946", fontSize: 24 }}>✕</span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#c6d0de", marginBottom: 6 }}>資料來源暫停</div>
              <div style={{ fontSize: 13, color: "#566276", lineHeight: 1.6 }}>
                訊號資料目前無法讀取。系統持續嘗試重連；請稍候重新整理。
              </div>
            </div>
          </div>
        )}

        {result.state === "LIVE" && displaySignals.length === 0 && (
          <div className="_sig-empty-state">
            <div className="_sig-empty-icon">
              <span style={{ color: "#e2b85c", fontSize: 24 }}>◌</span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#c6d0de", marginBottom: 6 }}>無可判讀訊號</div>
              <div style={{ fontSize: 13, color: "#566276", lineHeight: 1.6 }}>
                驗證資料已收納，不放進交易戰情；等待下一批訊號進場。
              </div>
            </div>
          </div>
        )}

        {result.state === "LIVE" && displaySignals.length > 0 && (
          <div className="_sig-grid">
            {displaySignals.map((signal) => {
              const company = firstCompany(signal, result.data.companies);
              const theme = firstTheme(signal, result.data.themes);
              const accent = directionAccent(signal.direction);
              const borderColor = directionBorder(signal.direction);
              const badgeCls = signal.direction === "bullish" ? "_sig-badge-bull"
                : signal.direction === "bearish" ? "_sig-badge-bear"
                : "_sig-badge-neutral";
              const confColor = signal.confidence >= 4 ? "#e2b85c" : signal.confidence <= 2 ? "#e63946" : "#91a0b5";

              return (
                <div
                  key={signal.id}
                  className="_sig-card"
                  style={{ borderLeftColor: borderColor }}
                >
                  {/* Directional glow */}
                  <div
                    className="_sig-card-glow"
                    style={{ background: `radial-gradient(ellipse at 0% 0%, ${accent}, transparent 60%)` }}
                  />

                  {/* Meta row */}
                  <div className="_sig-meta">
                    <span className={`_sig-badge ${badgeCls}`}>{directionLabel(signal.direction)}</span>
                    <span className="_sig-badge _sig-badge-cat">{categoryLabel(signal.category)}</span>
                    <span className="tg soft" style={{ fontSize: 11, marginLeft: "auto" }}>
                      {formatDateTime(signal.createdAt)}
                    </span>
                  </div>

                  {/* Title */}
                  <div className="_sig-title">{signalTitle(signal)}</div>

                  {/* Confidence bar */}
                  <div className="_sig-conf-bar">
                    <span style={{ fontSize: 10, color: "#566276", fontFamily: "var(--mono, monospace)", letterSpacing: 0.3 }}>
                      信心
                    </span>
                    <div className="_sig-conf-track">
                      <div
                        className="_sig-conf-fill"
                        style={{
                          width: confidenceWidth(signal.confidence),
                          background: confColor,
                          opacity: 0.8,
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 11, color: confColor, fontFamily: "var(--mono, monospace)", fontWeight: 700, minWidth: 12 }}>
                      {signal.confidence}
                    </span>
                  </div>

                  {/* Links */}
                  <div className="_sig-links">
                    {company ? (
                      <Link href={`/companies/${company.ticker}`} className="mini-button">
                        {company.ticker} {company.name}
                      </Link>
                    ) : theme ? (
                      <Link href={`/themes/${theme.slug}`} className="mini-button">{themeLinkLabel(theme)}</Link>
                    ) : (
                      <span className="tg muted" style={{ fontSize: 12 }}>未連結公司或主題</span>
                    )}
                    <span className="tg soft" style={{ fontSize: 11, marginLeft: "auto" }}>來源：{result.source}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </PageFrame>
  );
}
