"use client";
/**
 * DataSourceBadge — bottom-right pill, always visible.
 *
 * Three states (driven by api.ts publish):
 *   LIVE     — real backend responding (gold dot)
 *   MOCK     — NEXT_PUBLIC_API_BASE empty (telegraphic, mid)
 *   OFFLINE  — backend set but failing (red, sticky)
 *
 * In production OFFLINE means the operator is looking at stale or no data;
 * we make it loud on purpose so they don't trade against a phantom feed.
 */
import { useEffect, useState } from "react";
import type { DataSourceState } from "@/lib/radar-api";
import { getDataSourceState } from "@/lib/radar-api";

export function DataSourceBadge() {
  const [state, setState] = useState<DataSourceState>(getDataSourceState());

  useEffect(() => {
    const onChange = (e: Event) => setState((e as CustomEvent<DataSourceState>).detail);
    window.addEventListener("__iuf_data_source", onChange);
    return () => window.removeEventListener("__iuf_data_source", onChange);
  }, []);

  const color = state === "LIVE" ? "var(--gold-bright)"
              : state === "OFFLINE" ? "var(--tw-up-bright)"
              : "var(--night-mid)";
  const bg = state === "OFFLINE" ? "rgba(230,57,70,0.10)" : "rgba(13,14,10,0.92)";
  const label = state === "LIVE" ? "● LIVE · BACKEND"
              : state === "OFFLINE" ? "✕ OFFLINE · CHECK BACKEND"
              : "○ MOCK · NO BACKEND";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", right: 14, bottom: 14, zIndex: 9999,
        fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: "0.18em",
        padding: "6px 10px",
        border: `1px solid ${color}`, color, background: bg,
        textTransform: "uppercase", fontWeight: 700,
        backdropFilter: "blur(4px)",
      }}
    >
      {label}
    </div>
  );
}
