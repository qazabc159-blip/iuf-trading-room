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
  if (severity === "critical") return "嚴重";
  if (severity === "warning") return "警示";
  return "通知";
}

function severityBadgeClass(severity: AlertSeverity) {
  // INFO grey (neutral default badge) / WARNING amber (badge-yellow) / CRITICAL red (badge-red)
  if (severity === "critical") return "badge badge-red";
  if (severity === "warning") return "badge badge-yellow";
  return "badge";
}

function statusFromAcknowledged(ack: boolean) {
  // ACTIVE (未 ack) / ACKED (已 ack)。
  // 後端 schema 目前無單獨 RESOLVED 欄位，acknowledged=true 即為已處理。
  return ack ? "ACKED" : "ACTIVE";
}

function statusBadgeClass(ack: boolean) {
  return ack ? "badge badge-green" : "badge badge-yellow";
}

function statusLabel(ack: boolean) {
  return ack ? "已處理 (ACKED)" : "未處理 (ACTIVE)";
}

function eventTypeFromPayload(payload: Record<string, unknown>): string | null {
  const value =
    payload["eventType"] ??
    payload["event_type"] ??
    payload["type"] ??
    null;
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/**
 * Keys that must never be surfaced in UI — Lane-A security fix (Y2).
 * Covers: token/session/cookie/auth-header patterns.
 * Any key matching this pattern → value replaced with [REDACTED].
 */
const SENSITIVE_KEY_PATTERN = /token|session|cookie|auth[-_]?header|authorization|bearer|api[-_]?key|secret|password|passwd|credential/i;

/** Redact sensitive string values (e.g. JWT, session ID, API key). */
function redactValue(key: string, v: unknown): string {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof v === "string") {
    // Redact anything that looks like a JWT (three base64url segments separated by dots)
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) return "[REDACTED]";
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "…";
}

function payloadSummary(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) return "—";
  const parts: string[] = [];
  for (const key of keys.slice(0, 4)) {
    const v = payload[key];
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      parts.push(`${key}=${redactValue(key, v)}`);
    } else {
      parts.push(`${key}=…`);
    }
  }
  return parts.length > 0 ? parts.join(" / ") : "—";
}

function severityCounts(alerts: AlertEntry[]) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const a of alerts) {
    if (a.severity === "critical") counts.critical += 1;
    else if (a.severity === "warning") counts.warning += 1;
    else counts.info += 1;
  }
  return counts;
}

function activeCount(alerts: AlertEntry[]) {
  return alerts.filter((a) => !a.acknowledged).length;
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
    if (error instanceof AlertsAuthError) {
      // bubble up — page handles redirect
      throw error;
    }
    return {
      state: "BLOCKED",
      reason: friendlyDataError(error, "事件警示資料暫時無法讀取。"),
      updatedAt,
    };
  }
}

function EngineStateLine({ engineState }: { engineState: AlertsEngineState }) {
  const tickLabel = formatDateTime(engineState.lastTickAt);
  const tickBadge = engineState.lastTickAt ? "badge badge-green" : "badge badge-yellow";
  const tickWord = engineState.lastTickAt ? "正常" : "尚未執行";
  return (
    <div className="source-line">
      <span className={tickBadge}>{tickWord}</span>
      <span>來源：iuf_events / event-engine 5min poll</span>
      <span>最後 tick：{tickLabel}</span>
      <span>本程序累計事件：{engineState.totalEventsThisProcess}</span>
      {engineState.lastError && <span className="status-bad">最近錯誤：{engineState.lastError}</span>}
    </div>
  );
}

function AlertRow({ alert }: { alert: AlertEntry }) {
  const eventType = eventTypeFromPayload(alert.payload);
  return (
    <article className="alert-row" data-severity={alert.severity}>
      <header className="alert-row-head">
        <span className={severityBadgeClass(alert.severity)}>{severityLabel(alert.severity)}</span>
        <span className={statusBadgeClass(alert.acknowledged)}>{statusLabel(alert.acknowledged)}</span>
        <strong className="alert-rule-name">{alert.ruleName}</strong>
        {alert.ticker && <span className="alert-ticker">標的 {alert.ticker}</span>}
      </header>
      <dl className="alert-row-meta">
        <div>
          <dt>規則 ID</dt>
          <dd>{alert.ruleId}</dd>
        </div>
        <div>
          <dt>事件類型</dt>
          <dd>{eventType ?? "—"}</dd>
        </div>
        <div>
          <dt>觸發時間</dt>
          <dd>{formatDateTime(alert.triggeredAt)}</dd>
        </div>
        <div>
          <dt>狀態</dt>
          <dd>{statusFromAcknowledged(alert.acknowledged)}</dd>
        </div>
        <div className="alert-row-payload">
          <dt>內容摘要</dt>
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
  const label = variant === "EMPTY" ? "無事件" : "受阻";
  return (
    <Panel code={`ALR-${variant}`} title={label} right="事件警示資料">
      <div className="state-panel">
        <span className={`badge ${variant === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{label}</span>
        <span className="tg soft">事件警示 / iuf_events</span>
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
    if (error instanceof AlertsAuthError) {
      // session cookie present 但 API 拒絕 → 強制重新登入
      redirect("/login?next=/alerts");
    }
    throw error;
  }

  const alerts = surface.state === "LIVE" ? surface.alerts : [];
  const counts = severityCounts(alerts);
  const active = activeCount(alerts);

  const engineState =
    surface.state === "LIVE" || surface.state === "EMPTY" ? surface.engineState : null;

  return (
    <PageFrame
      code="ALR"
      title="事件警示"
      sub="event-engine 觸發的事件清單"
      note="本頁只顯示 event-engine（5 分鐘 poll）真實寫入 iuf_events 的事件；不提供買賣建議、不模擬假事件。狀態欄 ACTIVE = 未處理，ACKED = 已透過 API 標記處理。"
    >
      <MetricStrip
        columns={4}
        cells={[
          { label: "顯示筆數", value: alerts.length, tone: alerts.length ? "status-ok" : "muted" },
          { label: "未處理 (ACTIVE)", value: active, tone: active ? "gold" : "muted" },
          { label: "嚴重 (CRITICAL)", value: counts.critical, tone: counts.critical ? "status-bad" : "muted" },
          { label: "警示 (WARNING)", value: counts.warning, tone: counts.warning ? "gold" : "muted" },
          { label: "通知 (INFO)", value: counts.info, tone: "muted" },
          {
            label: "最後 tick",
            value: engineState?.lastTickAt ? formatDateTime(engineState.lastTickAt) : "尚未執行",
            tone: engineState?.lastTickAt ? "status-ok" : "gold",
          },
          {
            label: "本程序累計",
            value: engineState?.totalEventsThisProcess ?? "--",
          },
          {
            label: "引擎錯誤",
            value: engineState?.lastError ? "有" : "無",
            tone: engineState?.lastError ? "status-bad" : "status-ok",
          },
        ]}
      />

      {surface.state === "BLOCKED" && (
        <StatePanel
          variant="BLOCKED"
          message={`事件警示資料暫時無法讀取。${surface.reason}`}
          updatedAt={surface.updatedAt}
        />
      )}

      {surface.state === "EMPTY" && (
        <StatePanel
          variant="EMPTY"
          message={`目前無事件，event engine 5 分鐘自動 poll；最後 tick 時間：${formatDateTime(surface.engineState.lastTickAt)}。`}
          updatedAt={surface.updatedAt}
        />
      )}

      {surface.state === "LIVE" && (
        <Panel
          code="ALR-LIVE"
          title="事件清單"
          sub={`最新 ${alerts.length} 筆，依觸發時間倒序`}
          right={
            <span className="source-line" style={{ margin: 0 }}>
              <span className="badge badge-green">正常</span>
              <span>iuf_events</span>
              <span>更新 {formatDateTime(surface.updatedAt)}</span>
              <span>{alerts.length} 筆</span>
            </span>
          }
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
