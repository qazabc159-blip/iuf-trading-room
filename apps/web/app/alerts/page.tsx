import { redirect } from "next/navigation";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  AlertsAuthError,
  getAlerts,
  type AlertEntry,
  type AlertSeverity,
  type AlertsEngineState,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

export const dynamic = "force-dynamic";

const ALERTS_LIMIT = 50;

type AlertsSurface =
  | { state: "LIVE"; alerts: AlertEntry[]; engineState: AlertsEngineState; updatedAt: string }
  | { state: "EMPTY"; engineState: AlertsEngineState; updatedAt: string }
  | { state: "BLOCKED"; reason: string; updatedAt: string };

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

function severityLabel(severity: AlertSeverity) {
  if (severity === "critical") return "緊急";
  if (severity === "warning") return "注意";
  return "提醒";
}

function severityBadgeClass(severity: AlertSeverity) {
  if (severity === "critical") return "badge badge-red";
  if (severity === "warning") return "badge badge-yellow";
  return "badge";
}

function statusBadgeClass(ack: boolean) {
  return ack ? "badge badge-green" : "badge badge-yellow";
}

function statusLabel(ack: boolean) {
  return ack ? "已確認" : "待處理";
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

async function loadAlertsSurface(): Promise<AlertsSurface> {
  const updatedAt = nowIso();
  try {
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

function EngineStateLine({ engineState }: { engineState: AlertsEngineState }) {
  const hasTick = Boolean(engineState.lastTickAt);
  return (
    <div className="source-line">
      <span className={hasTick ? "badge badge-green" : "badge badge-yellow"}>{hasTick ? "已巡檢" : "等待巡檢"}</span>
      <span>最近巡檢 {formatDateTime(engineState.lastTickAt)}</span>
      <span>本輪觸發 {engineState.lastTickEvents.toLocaleString("zh-TW")} 筆</span>
      {engineState.lastError && <span className="status-bad">警示讀取異常</span>}
    </div>
  );
}

function AlertRow({ alert }: { alert: AlertEntry }) {
  return (
    <article className="alert-row" data-severity={alert.severity}>
      <header className="alert-row-head">
        <span className={severityBadgeClass(alert.severity)}>{severityLabel(alert.severity)}</span>
        <span className={statusBadgeClass(alert.acknowledged)}>{statusLabel(alert.acknowledged)}</span>
        <strong className="alert-rule-name">{alert.ruleName}</strong>
        {alert.ticker && <span className="alert-ticker">{alert.ticker}</span>}
      </header>
      <dl className="alert-row-meta">
        <div>
          <dt>標的</dt>
          <dd>{alert.ticker ?? "全市場"}</dd>
        </div>
        <div>
          <dt>嚴重度</dt>
          <dd>{severityLabel(alert.severity)}</dd>
        </div>
        <div>
          <dt>觸發時間</dt>
          <dd>{formatDateTime(alert.triggeredAt)}</dd>
        </div>
        <div>
          <dt>處理狀態</dt>
          <dd>{statusLabel(alert.acknowledged)}</dd>
        </div>
        <div className="alert-row-payload">
          <dt>摘要</dt>
          <dd>{payloadSummary(alert.payload)}</dd>
        </div>
      </dl>
    </article>
  );
}

function StatePanel({
  variant,
  message,
  updatedAt,
}: {
  variant: "EMPTY" | "BLOCKED";
  message: string;
  updatedAt: string;
}) {
  const label = variant === "EMPTY" ? "目前沒有待處理警示" : "警示資料需要重新整理";
  return (
    <Panel code={`ALR-${variant}`} title={label} right="風控提醒">
      <div className="state-panel">
        <span className={`badge ${variant === "EMPTY" ? "badge-green" : "badge-red"}`}>{variant === "EMPTY" ? "乾淨" : "注意"}</span>
        <span className="tg soft">更新 {formatDateTime(updatedAt)}</span>
        <span className="state-reason">{message}</span>
      </div>
    </Panel>
  );
}

export default async function AlertsPage() {
  let surface: AlertsSurface;
  try {
    surface = await loadAlertsSurface();
  } catch (error) {
    if (error instanceof AlertsAuthError) redirect("/login?next=/alerts");
    throw error;
  }

  const alerts = surface.state === "LIVE" ? surface.alerts : [];
  const counts = severityCounts(alerts);
  const active = activeCount(alerts);
  const engineState = surface.state === "LIVE" || surface.state === "EMPTY" ? surface.engineState : null;

  return (
    <PageFrame
      code="ALR"
      title="警示"
      sub="風控提醒、待處理事項與市場監看"
      note="警示頁只顯示可行動資訊；敏感內容與系統細節不出現在畫面上。"
    >
      <MetricStrip
        columns={4}
        cells={[
          { label: "警示總數", value: alerts.length, tone: alerts.length ? "gold" : "status-ok" },
          { label: "待處理", value: active, tone: active ? "gold" : "status-ok" },
          { label: "緊急", value: counts.critical, tone: counts.critical ? "status-bad" : "muted" },
          { label: "注意", value: counts.warning, tone: counts.warning ? "gold" : "muted" },
          { label: "提醒", value: counts.info, tone: "muted" },
          { label: "最近巡檢", value: engineState?.lastTickAt ? formatDateTime(engineState.lastTickAt) : "--", tone: engineState?.lastTickAt ? "status-ok" : "gold" },
          { label: "本輪觸發", value: engineState?.lastTickEvents ?? "--" },
          { label: "資料狀態", value: surface.state === "BLOCKED" ? "注意" : "可用", tone: surface.state === "BLOCKED" ? "status-bad" : "status-ok" },
        ]}
      />

      {surface.state === "BLOCKED" && (
        <StatePanel
          variant="BLOCKED"
          message={surface.reason}
          updatedAt={surface.updatedAt}
        />
      )}

      {surface.state === "EMPTY" && (
        <StatePanel
          variant="EMPTY"
          message="目前沒有未確認的風控提醒；系統仍會持續巡檢。"
          updatedAt={surface.updatedAt}
        />
      )}

      {surface.state === "LIVE" && (
        <Panel
          code="ALR-LIVE"
          title="待處理警示"
          sub={`${alerts.length} 筆警示，優先看緊急與未確認項目。`}
          right={<span className="tg soft">更新 {formatDateTime(surface.updatedAt)}</span>}
        >
          <EngineStateLine engineState={surface.engineState} />
          <div className="alert-list">
            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        </Panel>
      )}
    </PageFrame>
  );
}
