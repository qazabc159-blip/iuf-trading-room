"use client";
/**
 * ExecutionTimeline — SSE-first stream of execution events with polling fallback.
 *
 * Behavior:
 *   1. On mount: hydrate via GET /api/trading/events?since=...
 *   2. Subscribe SSE to /api/trading/events/stream (if backend present).
 *   3. SSE error → exp backoff reconnect (1s, 2s, 4s, 8s, max 30s).
 *   4. If no backend (mock mode): 30s polling on api.executionEvents().
 *   5. Each event row expandable to show raw payload.
 */
import { useEffect, useRef, useState } from "react";
import { api, executionStreamUrl } from "@/lib/radar-api";
import type { ExecutionEvent } from "@/lib/radar-types";

const KIND_TONE: Record<ExecutionEvent["kind"], string> = {
  order_placed:    "var(--exec-ink)",
  order_filled:    "var(--gold-bright)",
  order_cancelled: "var(--exec-mid)",
  order_rejected:  "var(--tw-up-bright)",
  risk_blocked:    "var(--tw-up-bright)",
};

export function ExecutionTimeline() {
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "connecting" | "live" | "stale" | "error">("idle");
  const seenIds = useRef<Set<string>>(new Set());

  /* ── 1) initial hydrate ── */
  useEffect(() => {
    let live = true;
    (async () => {
      const list = await api.executionEvents();
      if (!live) return;
      list.forEach(e => seenIds.current.add(e.id));
      setEvents(list);
    })();
    return () => { live = false; };
  }, []);

  /* ── 2) SSE w/ backoff · 3) polling fallback ── */
  useEffect(() => {
    const sseUrl = executionStreamUrl();
    let cancelled = false;
    let es: EventSource | null = null;
    let backoff = 1000;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const insert = (ev: ExecutionEvent) => {
      if (seenIds.current.has(ev.id)) return;
      seenIds.current.add(ev.id);
      setEvents(prev => [ev, ...prev].slice(0, 100));
    };

    function connectSSE() {
      if (cancelled || !sseUrl) return;
      setStreamState("connecting");
      try {
        es = new EventSource(sseUrl);
        es.onopen = () => { setStreamState("live"); backoff = 1000; };
        es.onmessage = (m) => {
          try { insert(JSON.parse(m.data) as ExecutionEvent); } catch {}
        };
        es.onerror = () => {
          es?.close();
          setStreamState("error");
          if (!cancelled) {
            setTimeout(connectSSE, backoff);
            backoff = Math.min(backoff * 2, 30_000);
          }
        };
      } catch {
        setStreamState("error");
      }
    }

    function startPolling() {
      setStreamState("stale"); // mock-mode label
      pollTimer = setInterval(async () => {
        const list = await api.executionEvents();
        list.forEach(insert);
      }, 30_000);
    }

    if (sseUrl) connectSSE();
    else startPolling();

    return () => {
      cancelled = true;
      es?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <span className="tg" style={{ color: "var(--gold)", fontWeight: 700 }}>● STREAM</span>
        <span className="tg" style={{ color: streamState === "live" ? "var(--gold-bright)" : streamState === "error" ? "var(--tw-up-bright)" : "var(--exec-mid)" }}>
          {streamState.toUpperCase()}
        </span>
        <span className="tg" style={{ color: "var(--exec-soft)", marginLeft: "auto" }}>
          {events.length} EVENTS
        </span>
      </div>
      <div style={{ borderTop: "1px solid var(--exec-rule-strong)", fontFamily: "var(--mono)", fontSize: 11.5 }}>
        {events.map(e => {
          const isOpen = open === e.id;
          const tone = KIND_TONE[e.kind];
          return (
            <div key={e.id} style={{ borderBottom: "1px solid var(--exec-rule)" }}>
              <button onClick={() => setOpen(isOpen ? null : e.id)} style={{
                display: "grid", gridTemplateColumns: "150px 130px 70px 60px 80px 1fr 18px",
                gap: 8, width: "100%", padding: "9px 4px",
                background: "transparent", border: "none", textAlign: "left",
                color: "var(--exec-ink)", cursor: "pointer", fontFamily: "var(--mono)", fontSize: 11.5,
              }}>
                <span style={{ color: "var(--exec-mid)" }}>{new Date(e.ts).toISOString().replace("T", " ").slice(0, 19)}Z</span>
                <span style={{ color: tone, fontWeight: 700, letterSpacing: "0.16em" }}>● {e.kind.replace("_", "·").toUpperCase()}</span>
                <span style={{ color: "var(--gold)" }}>{e.symbol}</span>
                <span>{e.side ?? "—"}</span>
                <span style={{ color: "var(--exec-mid)" }}>{e.qty?.toLocaleString() ?? "—"}</span>
                <span style={{ color: "var(--exec-mid)" }}>
                  {e.price !== null ? `@ ${e.price}` : "—"}
                  {e.fee !== null && <span style={{ color: "var(--exec-soft)", marginLeft: 8 }}>fee {e.fee} · tax {e.tax}</span>}
                  <span style={{ color: "var(--exec-soft)", marginLeft: 8 }}>{e.orderId ?? "no-order"} · {e.clientOrderId ?? "—"}</span>
                </span>
                <span style={{ color: "var(--exec-soft)", textAlign: "right" }}>{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && (
                <pre style={{
                  margin: 0, padding: "10px 14px",
                  background: "var(--exec-bg)", color: "var(--exec-mid)",
                  fontFamily: "var(--mono)", fontSize: 10.5, lineHeight: 1.6,
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                  borderTop: "1px solid var(--exec-rule)",
                }}>{JSON.stringify(e.raw, null, 2)}</pre>
              )}
            </div>
          );
        })}
        {!events.length && (
          <div style={{ padding: "20px 4px", color: "var(--exec-soft)", fontFamily: "var(--mono)", fontSize: 11 }}>
            尚無事件 · waiting for stream …
          </div>
        )}
      </div>
    </div>
  );
}
