"use client";

import type { ExecutionEvent } from "@iuf-trading-room/contracts";

type Status = "connecting" | "live" | "reconnecting" | "error";

const TYPE_COLOR: Record<ExecutionEvent["type"], string> = {
  submit: "var(--phosphor)",
  acknowledge: "var(--phosphor)",
  fill: "var(--phosphor)",
  cancel: "var(--amber)",
  reject: "var(--danger, #ff4d4d)",
  expire: "var(--dim)",
  reconcile: "var(--dim)"
};

const TYPE_LABEL: Record<ExecutionEvent["type"], string> = {
  submit: "SUBMIT",
  acknowledge: "ACK",
  fill: "FILL",
  cancel: "CANCEL",
  reject: "REJECT",
  expire: "EXPIRE",
  reconcile: "RECON"
};

const STATUS_COLOR: Record<Status, string> = {
  connecting: "var(--dim)",
  live: "var(--phosphor)",
  reconnecting: "var(--amber)",
  error: "var(--danger, #ff4d4d)"
};

const STATUS_LABEL: Record<Status, string> = {
  connecting: "CONNECTING",
  live: "LIVE",
  reconnecting: "RECONNECTING",
  error: "ERROR"
};

export function ExecutionTimeline({
  events,
  status
}: {
  events: ExecutionEvent[];
  status: Status;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.8rem"
        }}
      >
        <span style={{ color: "var(--dim)" }}>
          最近 {events.length} 筆事件
        </span>
        <span style={{ color: STATUS_COLOR[status] }}>
          ● {STATUS_LABEL[status]}
        </span>
      </div>
      {events.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--mono, monospace)",
            color: "var(--dim)",
            fontSize: "0.85rem"
          }}
        >
          [IDLE] 尚未接收到 execution 事件。
        </p>
      ) : (
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: "0.25rem",
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.8rem"
          }}
        >
          {events.map((ev, idx) => (
            <li
              key={`${ev.orderId}-${ev.timestamp}-${idx}`}
              style={{
                display: "grid",
                gridTemplateColumns: "6rem 4rem 7rem 1fr 7rem",
                gap: "0.5rem",
                padding: "0.25rem 0",
                borderTop:
                  idx === 0 ? "none" : "1px solid var(--line, #2a2a2a)"
              }}
            >
              <span style={{ color: "var(--dim)" }}>
                {new Date(ev.timestamp).toLocaleTimeString("zh-TW", {
                  hour12: false
                })}
              </span>
              <span style={{ color: TYPE_COLOR[ev.type] }}>
                {TYPE_LABEL[ev.type]}
              </span>
              <span style={{ color: "var(--fg, #eee)" }}>
                {ev.orderId.slice(0, 8)}
              </span>
              <span style={{ color: "var(--dim)" }}>{ev.message ?? "—"}</span>
              <span style={{ color: "var(--phosphor)", textAlign: "right" }}>
                {ev.status}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
