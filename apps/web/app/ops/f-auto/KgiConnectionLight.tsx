"use client";

/**
 * B3 — KGI SIM 連線指示燈
 * Consumes GET /api/v1/kgi/status (Owner-only)
 * Shows: kgi_logged_in / trade_connected / quote_connected / last smoke
 */

import { useEffect, useRef, useState } from "react";
import { getKgiStatus, type KgiStatus, fmtDatetime } from "@/lib/fauto-sim-api";

type LoadState =
  | { phase: "loading" }
  | { phase: "forbidden" }
  | { phase: "error"; message: string }
  | { phase: "live"; data: KgiStatus };

export function KgiConnectionLight({ refreshTick = 0 }: { refreshTick?: number }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const lastGoodRef = useRef<KgiStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const hadGoodData = lastGoodRef.current !== null;

    getKgiStatus().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 403) {
          if (!hadGoodData) setState({ phase: "forbidden" });
        } else {
          if (!hadGoodData) setState({ phase: "error", message: `HTTP ${result.status}` });
          // else: silently keep last known state
        }
        return;
      }
      lastGoodRef.current = result.data;
      setState({ phase: "live", data: result.data });
    });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

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
          <span className="_fauto-conn-last-order-val">{simOrderStatusLabel(state.data.last_sim_order_status)}</span>
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

  // EC2 gateway runs on an EventBridge schedule: weekdays 08:20–14:10 TST.
  // Outside that window "no gateway" is the EXPECTED state — labelling it a red
  // "未連線" made scheduled shutdowns look like incidents (audit 6/10 ops page).
  if (isGatewayScheduledOff()) {
    return {
      badgeText: "排程關機中",
      badgeClass: "_fauto-conn-badge-amber",
      detail: "EC2 gateway 依排程平日 08:20 開機、14:10 關機；目前在關機時段，屬正常狀態，下個交易日早上自動恢復。Paper 模式不受影響。",
    };
  }

  return {
    badgeText: "未連線",
    badgeClass: "_fauto-conn-badge-red",
    detail: "交易時段內沒有可用的 KGI SIM gateway 狀態 — 非排程關機，需檢查 EC2 與 gateway 服務。Paper 模式不受影響。",
  };
}

// P1-1 (product critique 2026-07-10): backend last_sim_order_status is a raw
// pending|pass|fail enum (see GET /api/v1/kgi/status) — was rendered
// verbatim. Never leak an unrecognized value either; fall back to honest
// "狀態同步中" rather than showing raw text.
function simOrderStatusLabel(status: string): string {
  if (status === "pending") return "等待中";
  if (status === "pass") return "成功";
  if (status === "fail") return "失敗";
  return "狀態同步中";
}

/** True when Taipei time is outside the gateway's weekday 08:20–14:10 run window. */
function isGatewayScheduledOff(now = new Date()): boolean {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = taipei.getUTCDay();
  if (day === 0 || day === 6) return true;
  const hhmm = taipei.getUTCHours() * 100 + taipei.getUTCMinutes();
  return hhmm < 820 || hhmm >= 1410;
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
