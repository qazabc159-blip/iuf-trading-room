"use client";

/**
 * AlertDispatchButton — Owner-only admin button to trigger an immediate alerts engine tick.
 * Calls POST /api/v1/internal/alerts/dispatch (Owner role, 403 for others).
 * Rendered inside /alerts page — hidden from non-Owner roles via server-side check
 * AND the server itself enforces the role gate (defense-in-depth).
 */

import { useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

type DispatchResult =
  | { ok: true; newEvents: number }
  | { ok: false; reason: string };

export function AlertDispatchButton() {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<DispatchResult | null>(null);

  async function handleDispatch() {
    setState("loading");
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/internal/alerts/dispatch`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (res.status === 403) {
        setResult({ ok: false, reason: "權限不足（僅限 Owner）" });
        setState("error");
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "未知錯誤");
        setResult({ ok: false, reason: txt || `HTTP ${res.status}` });
        setState("error");
        return;
      }
      const body = await res.json() as { data?: { newEvents?: number } };
      const newEvents = body?.data?.newEvents ?? 0;
      setResult({ ok: true, newEvents });
      setState("done");
    } catch (e) {
      setResult({ ok: false, reason: e instanceof Error ? e.message : "網路錯誤" });
      setState("error");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button
        className="_alr-dispatch-btn"
        onClick={handleDispatch}
        disabled={state === "loading"}
        style={{
          padding: "7px 18px",
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "var(--mono, monospace)",
          letterSpacing: "0.05em",
          background: state === "loading" ? "rgba(200,148,63,0.08)" : "rgba(200,148,63,0.12)",
          border: "1px solid rgba(200,148,63,0.45)",
          borderRadius: 3,
          color: "#e2b85c",
          cursor: state === "loading" ? "not-allowed" : "pointer",
          transition: "background 0.12s",
        }}
      >
        {state === "loading" ? "巡檢中…" : "立刻 dispatch tick"}
      </button>
      {state === "done" && result?.ok && (
        <span style={{ fontSize: 12, color: "#4adb88", fontFamily: "var(--mono, monospace)" }}>
          Tick 完成 — 新增 {result.newEvents} 筆事件。請重新整理頁面查看結果。
        </span>
      )}
      {state === "error" && result && !result.ok && (
        <span style={{ fontSize: 12, color: "#ff6b77", fontFamily: "var(--mono, monospace)" }}>
          {result.reason}
        </span>
      )}
    </div>
  );
}
