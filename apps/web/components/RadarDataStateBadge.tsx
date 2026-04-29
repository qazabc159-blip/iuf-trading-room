"use client";

export type RadarDataState = "LIVE" | "STALE" | "OFFLINE";

function fmtTime(value?: string | number | Date) {
  if (!value) return "尚未收到";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未收到";
  return date.toLocaleString("zh-TW", { hour12: false });
}

const LABEL: Record<RadarDataState, string> = {
  LIVE: "即時",
  STALE: "延遲",
  OFFLINE: "離線",
};

export function RadarDataStateBadge({
  state,
  lastTickAt,
  agentHeartbeatAt,
  compact = false,
}: {
  state: RadarDataState;
  lastTickAt?: string | number | Date;
  agentHeartbeatAt?: string | number | Date;
  compact?: boolean;
}) {
  const title = [
    `狀態：${LABEL[state]}`,
    `上次 tick：${fmtTime(lastTickAt)}`,
    `agent heartbeat：${fmtTime(agentHeartbeatAt)}`,
  ].join("\n");

  return (
    <span className={`radar-state-badge ${state.toLowerCase()}`} title={title}>
      <span className="radar-state-dot" aria-hidden />
      {compact ? state : `${state} · ${LABEL[state]}`}
    </span>
  );
}
