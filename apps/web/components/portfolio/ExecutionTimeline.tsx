"use client";

import { useEffect, useRef, useState } from "react";

import { getExecutionEvents, streamExecutionEvents } from "@/lib/api";
import type { ExecutionEvent } from "@iuf-trading-room/contracts";

const ACCOUNT_ID = "paper-default";

const TYPE_TONE: Record<ExecutionEvent["type"], string> = {
  submit: "var(--exec-ink)",
  acknowledge: "var(--gold-bright)",
  fill: "var(--gold-bright)",
  cancel: "var(--exec-mid)",
  reject: "var(--tw-up-bright)",
  expire: "var(--tw-up-bright)",
  reconcile: "var(--exec-mid)"
};

function streamLabel(state: "loading" | "live" | "stale" | "blocked" | "empty") {
  if (state === "loading") return "讀取中";
  if (state === "live") return "正常";
  if (state === "stale") return "輪詢中";
  if (state === "empty") return "無資料";
  return "暫停";
}

function eventTypeLabel(type: ExecutionEvent["type"]) {
  if (type === "submit") return "送出";
  if (type === "acknowledge") return "回報";
  if (type === "fill") return "成交";
  if (type === "cancel") return "撤單";
  if (type === "reject") return "拒絕";
  if (type === "expire") return "逾時";
  if (type === "reconcile") return "對帳";
  return type;
}

function eventKey(event: ExecutionEvent) {
  return `${event.timestamp}:${event.type}:${event.orderId}:${event.status}`;
}

export function ExecutionTimeline() {
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"loading" | "live" | "stale" | "blocked" | "empty">("loading");
  const [blocker, setBlocker] = useState<string | null>(null);
  const seenKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const list = await getExecutionEvents({ accountId: ACCOUNT_ID, limit: 50 });
        if (cancelled) return;
        const rows = list.data;
        rows.forEach((event) => seenKeys.current.add(eventKey(event)));
        setEvents(rows);
        setStreamState(rows.length ? "live" : "empty");
        setBlocker(null);
      } catch (error) {
        if (cancelled) return;
        setStreamState("blocked");
        setBlocker(error instanceof Error ? error.message : "execution events endpoint unavailable");
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let pollTimer: number | null = null;

    const insert = (event: ExecutionEvent) => {
      const key = eventKey(event);
      if (seenKeys.current.has(key)) return;
      seenKeys.current.add(key);
      setEvents((current) => [event, ...current].slice(0, 100));
      setStreamState("live");
      setBlocker(null);
    };

    async function startPolling() {
      pollTimer = window.setInterval(async () => {
        try {
          const list = await getExecutionEvents({ accountId: ACCOUNT_ID, limit: 50 });
          if (cancelled) return;
          list.data.forEach(insert);
          setStreamState(list.data.length ? "stale" : "empty");
          setBlocker(null);
        } catch (error) {
          if (cancelled) return;
          setStreamState("blocked");
          setBlocker(error instanceof Error ? error.message : "execution events polling failed");
        }
      }, 30_000);
    }

    streamExecutionEvents(insert, controller.signal)
      .then(() => {
        if (!cancelled) void startPolling();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStreamState("stale");
        setBlocker(error instanceof Error ? error.message : "execution stream unavailable; polling fallback active");
        void startPolling();
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, []);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <span className="tg" style={{ color: "var(--gold)", fontWeight: 700 }}>紙上交易事件</span>
        <span
          className="tg"
          style={{
            color:
              streamState === "live"
                ? "var(--gold-bright)"
                : streamState === "blocked"
                  ? "var(--tw-up-bright)"
                  : "var(--exec-mid)"
          }}
        >
          {streamLabel(streamState)}
        </span>
        <span className="tg" style={{ color: "var(--exec-soft)", marginLeft: "auto" }}>
          {events.length} 筆 | 紙上帳戶
        </span>
      </div>

      {blocker && (
        <div
          style={{
            marginBottom: 8,
            padding: "8px 10px",
            border: "1px solid var(--exec-rule-strong)",
            color: streamState === "blocked" ? "var(--tw-up-bright)" : "var(--exec-mid)",
            fontFamily: "var(--mono)",
            fontSize: 10.5
          }}
        >
          {streamState === "blocked" ? "暫停" : "降級輪詢"} | {blocker}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--exec-rule-strong)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
        {events.map((event) => {
          const key = eventKey(event);
          const isOpen = open === key;
          const tone = TYPE_TONE[event.type];
          return (
            <div key={key} style={{ borderBottom: "1px solid var(--exec-rule)" }}>
              <button
                onClick={() => setOpen(isOpen ? null : key)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "156px 114px 120px 118px 1fr 18px",
                  gap: 8,
                  width: "100%",
                  minHeight: 42,
                  padding: "9px 4px",
                  background: "transparent",
                  border: "none",
                  textAlign: "left",
                  color: "var(--exec-ink)",
                  cursor: "pointer",
                  fontFamily: "var(--mono)",
                  fontSize: 11.5
                }}
              >
                <span style={{ color: "var(--exec-mid)" }}>
                  {new Date(event.timestamp).toISOString().replace("T", " ").slice(0, 19)}Z
                </span>
                <span style={{ color: tone, fontWeight: 700, letterSpacing: "0.12em" }}>
                  {eventTypeLabel(event.type)}
                </span>
                <span>{event.status}</span>
                <span style={{ color: "var(--gold)" }}>{event.orderId.slice(0, 12)}</span>
                <span style={{ color: "var(--exec-mid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {event.message ?? event.clientOrderId}
                </span>
                <span style={{ color: "var(--exec-soft)", textAlign: "right" }}>{isOpen ? "-" : "+"}</span>
              </button>
              {isOpen && (
                <pre
                  style={{
                    margin: 0,
                    padding: "10px 14px",
                    background: "var(--exec-bg)",
                    color: "var(--exec-mid)",
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    borderTop: "1px solid var(--exec-rule)"
                  }}
                >
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
        {!events.length && (
          <div style={{ padding: "20px 4px", color: "var(--exec-soft)", fontFamily: "var(--mono)", fontSize: 11 }}>
            {streamState === "blocked"
              ? "暫停 | 紙上交易事件端點暫時無法讀取"
              : "無資料 | 紙上帳戶目前沒有交易事件"}
          </div>
        )}
      </div>
    </div>
  );
}
