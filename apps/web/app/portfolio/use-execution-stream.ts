"use client";

import { useEffect, useRef, useState } from "react";

import type { ExecutionEvent } from "@iuf-trading-room/contracts";

import { streamExecutionEvents } from "@/lib/api";

type StreamStatus = "connecting" | "live" | "reconnecting" | "error";

const MAX_EVENTS = 50;
const RECONNECT_BASE_MS = 1_500;
const RECONNECT_CAP_MS = 15_000;

// Client hook that opens the execution SSE stream, accumulates the most
// recent events, auto-reconnects with exponential backoff, and invokes
// `onEvent` for every event so the parent page can trigger a refresh.
export function useExecutionStream(
  enabled: boolean,
  onEvent: (event: ExecutionEvent) => void
): { events: ExecutionEvent[]; status: StreamStatus } {
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) {
      setStatus("connecting");
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;

    const connect = async () => {
      if (cancelled) return;
      const controller = new AbortController();
      activeController = controller;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");

      try {
        await streamExecutionEvents((event) => {
          attempt = 0;
          setStatus("live");
          setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
          onEventRef.current(event);
        }, controller.signal);

        if (cancelled) return;
        // Stream closed cleanly — treat as a drop and try again.
        scheduleReconnect();
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        console.warn("[execution-stream] connection lost:", err);
        setStatus("error");
        scheduleReconnect();
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      attempt += 1;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_CAP_MS);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect().catch(() => undefined);
      }, delay);
    };

    connect().catch(() => undefined);

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      activeController?.abort();
    };
  }, [enabled]);

  return { events, status };
}
