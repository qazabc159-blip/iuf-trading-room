"use client";

/**
 * B3 — KGI SIM 連線指示燈
 * Consumes GET /api/v1/kgi/status (Owner-only)
 * Shows: kgi_logged_in / trade_connected / quote_connected / last smoke
 */

import { useEffect, useState } from "react";
import { getKgiStatus, type KgiStatus, fmtDatetime } from "@/lib/fauto-sim-api";

type LoadState =
  | { phase: "loading" }
  | { phase: "forbidden" }
  | { phase: "error"; message: string }
  | { phase: "live"; data: KgiStatus };

export function KgiConnectionLight() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;

    getKgiStatus().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 403) {
          setState({ phase: "forbidden" });
        } else {
          setState({ phase: "error", message: `HTTP ${result.status}` });
        }
        return;
      }
      setState({ phase: "live", data: result.data });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="_fauto-conn-block">
      <div className="_fauto-conn-row">
        <span className="_fauto-conn-label">KGI SIM 連線</span>
        <ConnStatusGroup state={state} />
      </div>
      {state.phase === "live" && state.data.smoke_results && (
        <div className="_fauto-conn-smoke">
          <span className="_fauto-conn-smoke-label">每日健診</span>
          <SmokeBadge label="報價" result={state.data.smoke_results.quote_smoke} />
          <SmokeBadge label="下單" result={state.data.smoke_results.trade_smoke} />
          {state.data.smoke_results.last_smoke_at && (
            <span className="_fauto-conn-smoke-ts">
              {fmtDatetime(state.data.smoke_results.last_smoke_at)}
            </span>
          )}
        </div>
      )}
      {state.phase === "live" && state.data.last_sim_order_status && (
        <div className="_fauto-conn-last-order">
          <span className="_fauto-conn-smoke-label">最近委託狀態</span>
          <span className="_fauto-conn-last-order-val">{state.data.last_sim_order_status}</span>
        </div>
      )}
    </div>
  );
}

function ConnStatusGroup({ state }: { state: LoadState }) {
  if (state.phase === "loading") {
    return <span className="_fauto-conn-loading">連線中…</span>;
  }
  if (state.phase === "forbidden") {
    return <span className="_fauto-conn-forbidden">Owner 限定</span>;
  }
  if (state.phase === "error") {
    return <span className="_fauto-conn-err">無法連線</span>;
  }

  const { kgi_logged_in, trade_connected, quote_connected } = state.data;
  const allGreen = kgi_logged_in && trade_connected && quote_connected;

  return (
    <div className="_fauto-conn-lights">
      <ConnDot label="登入" active={kgi_logged_in} />
      <ConnDot label="下單" active={trade_connected} />
      <ConnDot label="報價" active={quote_connected} />
      <span
        className={`_fauto-conn-badge ${allGreen ? "_fauto-conn-badge-green" : "_fauto-conn-badge-amber"}`}
      >
        {allGreen ? "全通" : "部分斷線"}
      </span>
    </div>
  );
}

function ConnDot({ label, active }: { label: string; active: boolean }) {
  return (
    <span className="_fauto-conn-dot-wrap">
      <span
        className={`_fauto-conn-dot ${active ? "_fauto-dot-green" : "_fauto-dot-red"}`}
        aria-hidden="true"
      />
      <span className="_fauto-conn-dot-lbl">{label}</span>
    </span>
  );
}

function SmokeBadge({
  label,
  result,
}: {
  label: string;
  result?: "pass" | "fail" | "skip" | null;
}) {
  const cls =
    result === "pass"
      ? "_fauto-smoke-pass"
      : result === "fail"
        ? "_fauto-smoke-fail"
        : "_fauto-smoke-skip";
  const txt =
    result === "pass" ? "通過" : result === "fail" ? "失敗" : result === "skip" ? "跳過" : "--";
  return (
    <span className={`_fauto-smoke-badge ${cls}`}>
      {label} {txt}
    </span>
  );
}
