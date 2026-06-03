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
  const summary = getConnectionSummary(state.data);

  return (
    <div className="_fauto-conn-status-stack">
      <div className="_fauto-conn-lights">
        <ConnDot label="登入" active={kgi_logged_in} />
        <ConnDot label="下單" active={trade_connected} />
        <ConnDot label="報價" active={quote_connected} />
        <span className={`_fauto-conn-badge ${summary.badgeClass}`}>
          {summary.badgeText}
        </span>
      </div>
      <span className="_fauto-conn-detail">{summary.detail}</span>
    </div>
  );
}

function getConnectionSummary(data: KgiStatus): {
  badgeText: string;
  badgeClass: "_fauto-conn-badge-green" | "_fauto-conn-badge-amber" | "_fauto-conn-badge-red";
  detail: string;
} {
  const auth = data.gateway_quote_auth;
  const quoteAuthUnavailable =
    auth?.available === false ||
    auth?.state === "unavailable" ||
    auth?.errorCode === "KGI_QUOTE_AUTH_UNAVAILABLE";

  if (data.kgi_logged_in && data.trade_connected && data.quote_connected) {
    return {
      badgeText: "全通",
      badgeClass: "_fauto-conn-badge-green",
      detail: "gateway 已登入；KGI SIM 下單與即時報價都可用。",
    };
  }

  if (data.kgi_logged_in && data.trade_connected && quoteAuthUnavailable) {
    return {
      badgeText: "下單已連／報價授權未開",
      badgeClass: "_fauto-conn-badge-amber",
      detail: "SIM gateway 已登入且下單線可用；即時報價因凱基 SIM 行情權限或 token 未開而暫停，不補假報價。",
    };
  }

  if (data.kgi_logged_in && data.trade_connected && !data.quote_connected) {
    return {
      badgeText: "下單已連／報價暫停",
      badgeClass: "_fauto-conn-badge-amber",
      detail: "KGI SIM 下單線可用；報價線暫無可用 tick，畫面會改用明確降級狀態。",
    };
  }

  if (data.kgi_logged_in || data.trade_connected || data.quote_connected) {
    return {
      badgeText: "部分可用",
      badgeClass: "_fauto-conn-badge-amber",
      detail: "至少一條 KGI SIM 線路有回應；請看登入、下單、報價三顆燈判斷可用範圍。",
    };
  }

  return {
    badgeText: "未連線",
    badgeClass: "_fauto-conn-badge-red",
    detail: "目前沒有可用的 KGI SIM gateway 狀態；Paper 模式仍不受影響。",
  };
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
