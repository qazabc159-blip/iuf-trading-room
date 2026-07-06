import { redirect } from "next/navigation";

import { PageFrame } from "@/components/PageFrame";
import {
  AlertsAuthError,
  getAlerts,
  type AlertEntry,
  type AlertSeverity,
  type AlertsEngineState,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { AlertDispatchButton } from "./AlertDispatchButton";
import { apiGetMe } from "@/lib/auth-client";

export const dynamic = "force-dynamic";

const ALERTS_LIMIT = 50;

type AlertsSurface =
  | { state: "LIVE"; alerts: AlertEntry[]; engineState: AlertsEngineState; updatedAt: string }
  | { state: "EMPTY"; engineState: AlertsEngineState; updatedAt: string }
  | { state: "BLOCKED"; reason: string; updatedAt: string };

// ── Rule catalogue (mirrors openalice-event-rule-engine.ts) ──────────────────
// These are static UI descriptions — NOT synthesised events.
// "最近觸發" is derived from fetched AlertEntry[] by ruleId match.
const RULE_CATALOGUE = [
  {
    id: "R01_REVENUE_SURGE_YOY50",
    label: "月營收大幅成長",
    desc: "月營收 YoY > 50%（近 35 天）",
    dep: "FinMind tw_monthly_revenue",
    severity: "warning" as AlertSeverity,
  },
  {
    id: "R02_INSTITUTIONAL_CONSECUTIVE_BUY_5D",
    label: "三大法人連5日同向買進",
    desc: "外資 + 投信 + 自營商 5 日均淨買（近 7 日）",
    dep: "FinMind tw_institutional_buysell",
    severity: "info" as AlertSeverity,
  },
  {
    id: "R03_INSTITUTIONAL_CONSECUTIVE_SELL_5D",
    label: "三大法人連5日同向賣出",
    desc: "外資 + 投信 + 自營商 5 日均淨賣（近 7 日）",
    dep: "FinMind tw_institutional_buysell",
    severity: "warning" as AlertSeverity,
  },
  {
    id: "R04_SHAREHOLDING_HHI_BREAKOUT",
    label: "籌碼集中度突破 N 日高",
    desc: "大股東持股 HHI 突破近期高點（集中度異常）",
    dep: "FinMind tw_shareholding",
    severity: "info" as AlertSeverity,
  },
  {
    id: "R05_REVENUE_DECLINE_YOY30",
    label: "月營收大幅衰退",
    desc: "月營收 YoY < -30%（近 35 天）",
    dep: "FinMind tw_monthly_revenue",
    severity: "warning" as AlertSeverity,
  },
  {
    id: "R06_MAJOR_SHAREHOLDER_THRESHOLD",
    label: "大股東持股異動",
    desc: "主要股東持股比例觸及門檻（異常集中或分散）",
    dep: "FinMind tw_shareholding",
    severity: "info" as AlertSeverity,
  },
  {
    id: "R07_ANNOUNCEMENT_NEW",
    label: "公開資訊觀測站重大公告",
    desc: "重大公告事件（每輪巡檢後新增）",
    dep: "FinMind tw_company_announcement",
    severity: "warning" as AlertSeverity,
  },
  {
    id: "R08_BRIEF_PUBLISHED",
    label: "AI 每日簡報發布",
    desc: "Pipeline 自動發布 AI 簡報",
    dep: "audit_log (brief publish)",
    severity: "info" as AlertSeverity,
  },
  {
    id: "R09_HALLUCINATION_REJECTED",
    label: "AI hallucination reject",
    desc: "簡報因幻覺比率超標被退件（Layer 5 factual reviewer）",
    dep: "audit_log (hallucination reject)",
    severity: "warning" as AlertSeverity,
  },
  {
    id: "R10_KGI_GATEWAY_STATE",
    label: "KGI gateway 連線狀態",
    desc: "KGI 下單閘道連線狀態變更（斷線 / 恢復）",
    dep: "EC2 gateway /health",
    severity: "critical" as AlertSeverity,
  },
] as const;

type RuleId = typeof RULE_CATALOGUE[number]["id"];

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTimeShort(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function severityLabel(severity: AlertSeverity) {
  if (severity === "critical") return "緊急";
  if (severity === "warning") return "注意";
  return "提醒";
}

function severityColors(severity: AlertSeverity) {
  if (severity === "critical") return {
    border: "rgba(230,57,70,0.7)",
    bg: "rgba(230,57,70,0.06)",
    glow: "rgba(230,57,70,0.18)",
    text: "#ff6b77",
    badge: "rgba(230,57,70,0.18)",
    badgeBorder: "rgba(230,57,70,0.55)",
    ruleDot: "#ff6b77",
  };
  if (severity === "warning") return {
    border: "rgba(200,148,63,0.7)",
    bg: "rgba(200,148,63,0.05)",
    glow: "rgba(200,148,63,0.15)",
    text: "#e2b85c",
    badge: "rgba(200,148,63,0.15)",
    badgeBorder: "rgba(200,148,63,0.5)",
    ruleDot: "#e2b85c",
  };
  return {
    border: "rgba(145,160,181,0.28)",
    bg: "rgba(145,160,181,0.04)",
    glow: "rgba(145,160,181,0.10)",
    text: "#91a0b5",
    badge: "rgba(145,160,181,0.10)",
    badgeBorder: "rgba(145,160,181,0.28)",
    ruleDot: "#566276",
  };
}

function statusColors(ack: boolean) {
  return ack
    ? { badge: "rgba(46,204,113,0.12)", border: "rgba(46,204,113,0.4)", text: "#4adb88", label: "已確認" }
    : { badge: "rgba(200,148,63,0.12)", border: "rgba(200,148,63,0.4)", text: "#e2b85c", label: "待處理" };
}

function userFacingReason(error: unknown) {
  return friendlyDataError(error, "警示資料讀取失敗")
    .replace(/token|secret|session|cookie|authorization|bearer|api[-_]?key|env|database|redis/gi, "資料來源");
}

function payloadSummary(payload: Record<string, unknown>): string {
  const pairs = [
    ["message", "訊息"],
    ["title", "訊息"],
    ["symbol", "標的"],
    ["ticker", "標的"],
    ["price", "價格"],
    ["last", "價格"],
    ["changePct", "漲跌幅"],
    ["threshold", "門檻"],
  ];
  const parts: string[] = [];
  for (const [key, label] of pairs) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) parts.push(`${label} ${value.trim()}`);
    if (typeof value === "number" && Number.isFinite(value)) parts.push(`${label} ${value.toLocaleString("zh-TW")}`);
    if (parts.length >= 3) break;
  }
  return parts.length > 0 ? parts.join(" / ") : "條件已觸發，請依規則確認。";
}

function severityCounts(alerts: AlertEntry[]) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const alert of alerts) {
    if (alert.severity === "critical") counts.critical += 1;
    else if (alert.severity === "warning") counts.warning += 1;
    else counts.info += 1;
  }
  return counts;
}

function activeCount(alerts: AlertEntry[]) {
  return alerts.filter((alert) => !alert.acknowledged).length;
}

/** Build map: ruleId → most recent triggeredAt ISO string from fetched events */
function buildLastFiredMap(alerts: AlertEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const alert of alerts) {
    const existing = map.get(alert.ruleId);
    if (!existing || alert.triggeredAt > existing) {
      map.set(alert.ruleId, alert.triggeredAt);
    }
  }
  return map;
}

async function loadAlertsSurface(): Promise<AlertsSurface> {
  const updatedAt = nowIso();
  try {
    // Fetch with higher limit to get better last_fired_at coverage per ruleId
    const response = await getAlerts({ limit: ALERTS_LIMIT });
    if (response.data.length === 0) {
      return { state: "EMPTY", engineState: response.meta.engineState, updatedAt };
    }
    return {
      state: "LIVE",
      alerts: response.data,
      engineState: response.meta.engineState,
      updatedAt,
    };
  } catch (error) {
    if (error instanceof AlertsAuthError) throw error;
    return {
      state: "BLOCKED",
      reason: userFacingReason(error),
      updatedAt,
    };
  }
}

const ALERTS_CSS = `
._alr-hero-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 1px;
  background: rgba(220,228,240,0.09);
  border: 1px solid rgba(220,228,240,0.13);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 28px;
}
._alr-hero-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 24px 28px;
  background: rgba(8,11,16,0.86);
}
._alr-hero-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 22px;
  background: rgba(8,11,16,0.82);
  transition: background 0.15s;
}
._alr-hero-cell:hover { background: rgba(255,255,255,0.03); }
._alr-hero-big {
  font-size: 52px;
  font-weight: 900;
  letter-spacing: -2px;
  line-height: 1;
  font-family: var(--mono, monospace);
  font-variant-numeric: tabular-nums;
}
._alr-hero-val {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -1px;
  line-height: 1;
  font-family: var(--mono, monospace);
  font-variant-numeric: tabular-nums;
}
._alr-hero-lbl {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.65);
  font-family: var(--mono, monospace);
}
._alr-engine-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  background: rgba(220,228,240,0.03);
  border: 1px solid rgba(220,228,240,0.08);
  border-radius: 4px;
  margin-bottom: 20px;
}
._alr-engine-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
._alr-engine-dot-ok {
  background: #4adb88;
  box-shadow: 0 0 6px rgba(46,204,113,0.6);
  animation: _alr-pulse 2s ease-in-out infinite;
}
._alr-engine-dot-warn {
  background: #e2b85c;
}
@keyframes _alr-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
._alr-rule-panel {
  border: 1px solid rgba(220,228,240,0.10);
  border-radius: 4px;
  background: rgba(8,11,16,0.55);
  margin-bottom: 28px;
  overflow: hidden;
}
._alr-rule-panel-header {
  padding: 14px 20px;
  background: rgba(220,228,240,0.04);
  border-bottom: 1px solid rgba(220,228,240,0.10);
  display: flex;
  align-items: center;
  gap: 10px;
}
._alr-rule-panel-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.75);
}
._alr-rule-panel-sub {
  font-size: 11px;
  color: rgba(145,160,181,0.45);
  font-family: var(--mono, monospace);
}
._alr-rule-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: rgba(220,228,240,0.07);
}
._alr-rule-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 18px;
  background: rgba(8,11,16,0.72);
  transition: background 0.12s;
}
._alr-rule-row:hover { background: rgba(14,18,26,0.88); }
._alr-rule-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
}
._alr-rule-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 0;
  min-width: 0;
}
._alr-rule-label {
  font-size: 12px;
  font-weight: 700;
  color: #c6d0de;
  line-height: 1.3;
}
._alr-rule-desc {
  font-size: 11px;
  color: rgba(145,160,181,0.65);
  line-height: 1.4;
}
._alr-rule-fired {
  font-size: 10px;
  font-family: var(--mono, monospace);
  margin-top: 3px;
}
._alr-rule-fired-yes { color: #e2b85c; }
._alr-rule-fired-no  { color: rgba(145,160,181,0.38); }
._alr-rule-dep {
  font-size: 10px;
  color: rgba(145,160,181,0.32);
  font-family: var(--mono, monospace);
  margin-top: 1px;
}
._alr-list {
  display: grid;
  gap: 12px;
}
._alr-card {
  position: relative;
  padding: 18px 22px;
  border-radius: 4px;
  border: 1px solid rgba(220,228,240,0.08);
  border-left: 3px solid;
  background: rgba(8,11,16,0.58);
  transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s;
  overflow: hidden;
}
._alr-card:hover {
  transform: translateY(-2px);
  background: rgba(14,18,26,0.82);
  box-shadow: 0 8px 28px rgba(0,0,0,0.38);
}
@media (prefers-reduced-motion: reduce) {
  ._alr-card { transition: none; }
  ._alr-card:hover { transform: none; }
  ._alr-rule-row { transition: none; }
  ._alr-engine-dot-ok { animation: none; }
}
._alr-card-glow {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 70px;
  pointer-events: none;
}
._alr-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  position: relative;
  z-index: 1;
}
._alr-sev-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  font-family: var(--mono, monospace);
  border: 1px solid;
}
._alr-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  font-family: var(--mono, monospace);
  border: 1px solid;
}
._alr-rule-name {
  font-size: 13px;
  font-weight: 700;
  color: #e7ecf3;
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
._alr-ticker {
  font-size: 11px;
  font-weight: 700;
  font-family: var(--mono, monospace);
  letter-spacing: 0.04em;
  color: #e2b85c;
  background: rgba(200,148,63,0.10);
  border: 1px solid rgba(200,148,63,0.30);
  padding: 2px 8px;
  border-radius: 3px;
}
._alr-meta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) 2fr;
  gap: 10px 16px;
  position: relative;
  z-index: 1;
}
._alr-meta-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
._alr-meta-dt {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.55);
  font-family: var(--mono, monospace);
}
._alr-meta-dd {
  font-size: 12px;
  color: rgba(220,228,240,0.8);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
._alr-meta-wide {
  grid-column: 1 / -1;
}
._alr-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 64px 32px;
  text-align: center;
}
._alr-empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
._alr-clean-ring {
  border: 2px solid rgba(46,204,113,0.45);
  background: rgba(46,204,113,0.07);
}
._alr-blocked-ring {
  border: 2px solid rgba(230,57,70,0.45);
  background: rgba(230,57,70,0.07);
}
._alr-empty-admin {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
._alr-finmind-note {
  font-size: 11px;
  color: rgba(145,160,181,0.45);
  font-family: var(--mono, monospace);
}
@media (max-width: 768px) {
  ._alr-rule-list { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  ._alr-hero-row { grid-template-columns: 1fr 1fr; }
  ._alr-hero-main { grid-column: 1 / -1; }
  ._alr-meta-grid { grid-template-columns: 1fr 1fr; }
}
/* Mobile M1 (2026-07-05): 390px read-path baseline — presentation only.
   At 640px the hero KPI row is 2 columns, which leaves an odd empty cell
   (4 stat cells don't divide evenly) and cramps the 52px hero number. Below
   480px, stack the KPI cards full-width/single-column instead — same data,
   same order, just one column. Also floors caption/body text that a trader
   actually reads (rule name/desc, alert summary) and gives the admin-only
   dispatch button a real touch target. */
@media (max-width: 480px) {
  ._alr-hero-row { grid-template-columns: 1fr; }
  ._alr-hero-main { grid-column: auto; }
  ._alr-meta-grid { grid-template-columns: 1fr 1fr; }
  ._alr-hero-lbl { font-size: 12px; }
  ._alr-rule-label { font-size: 14px; }
  ._alr-rule-desc { font-size: 13px; }
  ._alr-meta-dd { font-size: 14px; }
  ._alr-dispatch-btn { min-height: 44px; padding: 0 18px !important; }
}
`;

export default async function AlertsPage() {
  let surface: AlertsSurface;
  try {
    surface = await loadAlertsSurface();
  } catch (error) {
    if (error instanceof AlertsAuthError) redirect("/login?next=/alerts");
    throw error;
  }

  // Owner check for admin dispatch button (server-side, best-effort)
  let isOwner = false;
  try {
    const me = await apiGetMe();
    if (me.ok && me.user.role === "Owner") isOwner = true;
  } catch {
    // non-critical — dispatch button stays hidden for non-owners
  }

  const alerts = surface.state === "LIVE" ? surface.alerts : [];
  const counts = severityCounts(alerts);
  const active = activeCount(alerts);
  const engineState = surface.state === "LIVE" || surface.state === "EMPTY" ? surface.engineState : null;

  const heroColor = active > 0
    ? (counts.critical > 0 ? "#ff6b77" : "#e2b85c")
    : "#4adb88";

  // Build last-fired map from fetched events
  const lastFiredMap = buildLastFiredMap(alerts);

  return (
    <PageFrame
      code="ALR"
      title="警示"
      sub="風控提醒、待處理事項與市場監看"
      note="警示頁只顯示可行動資訊；敏感內容與系統細節不出現在畫面上。"
    >
      <style>{ALERTS_CSS}</style>

      {/* Hero KPI row */}
      <div className="_alr-hero-row">
        <div className="_alr-hero-main">
          <span className="_alr-hero-big" style={{ color: heroColor }}>
            {surface.state === "BLOCKED" ? "--" : alerts.length}
          </span>
          <span className="_alr-hero-lbl">今日警示</span>
        </div>
        <div className="_alr-hero-cell">
          <span className="_alr-hero-val" style={{ color: active > 0 ? "#e2b85c" : "#566276" }}>
            {surface.state === "BLOCKED" ? "--" : active}
          </span>
          <span className="_alr-hero-lbl">待處理</span>
        </div>
        <div className="_alr-hero-cell">
          <span className="_alr-hero-val" style={{ color: counts.critical > 0 ? "#ff6b77" : "#566276" }}>
            {surface.state === "BLOCKED" ? "--" : counts.critical}
          </span>
          <span className="_alr-hero-lbl">緊急</span>
        </div>
        <div className="_alr-hero-cell">
          <span className="_alr-hero-val" style={{ color: counts.warning > 0 ? "#e2b85c" : "#566276" }}>
            {surface.state === "BLOCKED" ? "--" : counts.warning}
          </span>
          <span className="_alr-hero-lbl">注意</span>
        </div>
      </div>

      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">警示狀態</span>
          <span className={`parity-kpi-value ${surface.state === "LIVE" ? "ok" : surface.state === "EMPTY" ? "warn" : "bad"}`}>
            {surface.state === "LIVE" ? "可用" : surface.state === "EMPTY" ? "無警示" : "需處理"}
          </span>
          <span className="parity-kpi-sub">警示引擎</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">今日警示</span>
          <span className={`parity-kpi-value ${surface.state === "LIVE" && surface.alerts.length > 0 ? "bad" : "dim"}`}>
            {surface.state === "LIVE" ? surface.alerts.length : "--"}
          </span>
          <span className="parity-kpi-sub">待處理</span>
        </div>
        {surface.state !== "BLOCKED" && (
          <div className="parity-kpi-cell">
            <span className="parity-kpi-label">引擎狀態</span>
            <span className={`parity-kpi-value ${surface.engineState.lastTickAt ? "ok" : "warn"}`}>
              {surface.engineState.lastTickAt ? "運行" : "等待巡檢"}
            </span>
            <span className="parity-kpi-sub">風控引擎</span>
          </div>
        )}
      </div>

      {/* Engine status bar */}
      {engineState && (
        <div className="_alr-engine-bar">
          <div
            className={`_alr-engine-dot ${engineState.lastTickAt ? "_alr-engine-dot-ok" : "_alr-engine-dot-warn"}`}
          />
          <span className="tg soft" style={{ fontSize: 12 }}>
            {engineState.lastTickAt ? `最近巡檢 ${formatTimeShort(engineState.lastTickAt)}` : "等待巡檢"}
          </span>
          <span className="tg soft" style={{ fontSize: 12 }}>
            本輪觸發 {engineState.lastTickEvents.toLocaleString("zh-TW")} 筆
          </span>
          {engineState.lastError && (
            <span style={{ fontSize: 12, color: "#ff6b77" }}>警示引擎異常</span>
          )}
        </div>
      )}

      {/* ── 10 Rule Explanation Panel ────────────────────────────────────────── */}
      <div className="_alr-rule-panel">
        <div className="_alr-rule-panel-header">
          <span className="_alr-rule-panel-title">監控規則 — 10 類事件</span>
          <span className="_alr-rule-panel-sub">引擎每 5 分鐘巡檢一次；FinMind 資料同步完成後規則自動啟用</span>
        </div>
        <div className="_alr-rule-list">
          {RULE_CATALOGUE.map((rule, idx) => {
            const sc = severityColors(rule.severity);
            const lastFiredIso = lastFiredMap.get(rule.id) ?? null;
            return (
              <div key={rule.id} className="_alr-rule-row">
                <div
                  className="_alr-rule-dot"
                  style={{ background: sc.ruleDot }}
                  title={severityLabel(rule.severity)}
                />
                <div className="_alr-rule-body">
                  <span className="_alr-rule-label">
                    <span style={{ color: "rgba(145,160,181,0.38)", fontFamily: "var(--mono, monospace)", fontSize: 10, marginRight: 6 }}>
                      R{String(idx + 1).padStart(2, "0")}
                    </span>
                    {rule.label}
                  </span>
                  <span className="_alr-rule-desc">{rule.desc}</span>
                  <span className={`_alr-rule-fired ${lastFiredIso ? "_alr-rule-fired-yes" : "_alr-rule-fired-no"}`}>
                    {lastFiredIso
                      ? `最近觸發 ${formatDateTime(lastFiredIso)}`
                      : "24h 內無觸發記錄"}
                  </span>
                  <span className="_alr-rule-dep">依賴: {rule.dep}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* BLOCKED state */}
      {surface.state === "BLOCKED" && (
        <div className="_alr-empty-state">
          <div className="_alr-empty-icon _alr-blocked-ring">
            <span style={{ color: "#ff6b77", fontSize: 24 }}>✕</span>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#c6d0de", marginBottom: 6 }}>警示資料需要重新整理</div>
            <div style={{ fontSize: 13, color: "#566276", lineHeight: 1.6 }}>
              {surface.reason}
            </div>
          </div>
        </div>
      )}

      {/* EMPTY state — updated copy per task spec */}
      {surface.state === "EMPTY" && (
        <div className="_alr-empty-state">
          <div className="_alr-empty-icon _alr-clean-ring">
            <span style={{ color: "#4adb88", fontSize: 26 }}>✓</span>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#c6d0de", marginBottom: 6 }}>
              目前 24h 無事件觸發
            </div>
            <div style={{ fontSize: 13, color: "#7a8a9e", lineHeight: 1.7, maxWidth: 440 }}>
              引擎正常運行，無資料波動達到觸發門檻。
              <br />
              如預期看到事件未顯示，請告知（可能 FinMind sync 異常）。
            </div>
          </div>
          {isOwner && (
            <div className="_alr-empty-admin">
              <AlertDispatchButton />
              <span className="_alr-finmind-note">Admin only — 強制觸發一輪引擎巡檢</span>
            </div>
          )}
        </div>
      )}

      {/* LIVE alerts */}
      {surface.state === "LIVE" && (
        <>
          {isOwner && (
            <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
              <AlertDispatchButton />
            </div>
          )}
          <div className="_alr-list">
            {alerts.map((alert) => {
              const sc = severityColors(alert.severity);
              const st = statusColors(alert.acknowledged);
              return (
                <div
                  key={alert.id}
                  className="_alr-card"
                  style={{ borderLeftColor: sc.border }}
                >
                  {/* Glow */}
                  <div
                    className="_alr-card-glow"
                    style={{ background: `radial-gradient(ellipse at 0% 0%, ${sc.glow}, transparent 55%)` }}
                  />

                  {/* Head */}
                  <div className="_alr-card-head">
                    <span
                      className="_alr-sev-badge"
                      style={{ background: sc.badge, borderColor: sc.badgeBorder, color: sc.text }}
                    >
                      {severityLabel(alert.severity)}
                    </span>
                    <span
                      className="_alr-status-badge"
                      style={{ background: st.badge, borderColor: st.border, color: st.text }}
                    >
                      {st.label}
                    </span>
                    <span className="_alr-rule-name">{alert.ruleName}</span>
                    {alert.ticker && <span className="_alr-ticker">{alert.ticker}</span>}
                  </div>

                  {/* Meta */}
                  <div className="_alr-meta-grid">
                    <div className="_alr-meta-item">
                      <span className="_alr-meta-dt">標的</span>
                      <span className="_alr-meta-dd">{alert.ticker ?? "全市場"}</span>
                    </div>
                    <div className="_alr-meta-item">
                      <span className="_alr-meta-dt">嚴重度</span>
                      <span className="_alr-meta-dd" style={{ color: sc.text }}>{severityLabel(alert.severity)}</span>
                    </div>
                    <div className="_alr-meta-item">
                      <span className="_alr-meta-dt">觸發時間</span>
                      <span className="_alr-meta-dd">{formatDateTime(alert.triggeredAt)}</span>
                    </div>
                    <div className="_alr-meta-item _alr-meta-wide">
                      <span className="_alr-meta-dt">摘要</span>
                      <span className="_alr-meta-dd">{payloadSummary(alert.payload)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </PageFrame>
  );
}
