"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SubscriptionRecord = {
  subscription_id: string;
  strategy_id: string;
  capital_twd: number;
  sim_only: true;
  created_at: string;
  audit_log_id: string;
};

type LoadState = "idle" | "loading" | "loaded" | "error";

type SubscriptionFetchFailure = {
  strategyId: string;
  label: string;
  reason: string;
};

type SubscriptionsResult = {
  subscriptions: SubscriptionRecord[];
  failures: SubscriptionFetchFailure[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Backend-valid strategy IDs — matches VALID_QUANT_STRATEGY_IDS in quant-strategy-subscribe.ts
const VALID_STRATEGY_IDS = ["cont_liq_v36", "strategy_002", "strategy_003"] as const;

const STRATEGY_DISPLAY_NAMES: Record<string, string> = {
  cont_liq_v36: "Continuous Liquidity RS v36",
  strategy_002: "Class 5 Revenue Momentum",
  strategy_003: "Family C SBL Overlay",
};

function formatCapital(value: number) {
  return value.toLocaleString("zh-TW") + " TWD";
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function subscriptionFetchFailure(strategyId: string, status: number | "network"): SubscriptionFetchFailure {
  const label = STRATEGY_DISPLAY_NAMES[strategyId] ?? strategyId;
  if (status === "network") return { strategyId, label, reason: "網路或資料代理暫時無法連線" };
  if (status === 401 || status === 403) return { strategyId, label, reason: "登入狀態或權限未通過" };
  if (status >= 500) return { strategyId, label, reason: `訂閱資料服務暫時無法讀取（${status}）` };
  return { strategyId, label, reason: `訂閱資料回應狀態 ${status}` };
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchSubscriptionsForStrategy(id: string): Promise<{
  subscriptions: SubscriptionRecord[];
  failure: SubscriptionFetchFailure | null;
}> {
  try {
    const res = await fetch(`/api/quant-strategies/${id}/subscriptions/my`, {
      cache: "no-store",
      credentials: "include",
    });

    if (!res.ok) {
      return { subscriptions: [], failure: subscriptionFetchFailure(id, res.status) };
    }

    const json = (await res.json()) as { subscriptions?: SubscriptionRecord[] };
    return { subscriptions: json.subscriptions ?? [], failure: null };
  } catch {
    return { subscriptions: [], failure: subscriptionFetchFailure(id, "network") };
  }
}

async function fetchAllSubscriptions(): Promise<SubscriptionsResult> {
  const results = await Promise.all(VALID_STRATEGY_IDS.map(fetchSubscriptionsForStrategy));

  const all: SubscriptionRecord[] = [];
  const failures: SubscriptionFetchFailure[] = [];
  for (const result of results) {
    all.push(...result.subscriptions);
    if (result.failure) failures.push(result.failure);
  }

  // Sort newest first
  const subscriptions = all.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return { subscriptions, failures };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuantSubsPanel() {
  const [state, setState] = useState<LoadState>("idle");
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [failures, setFailures] = useState<SubscriptionFetchFailure[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadSubscriptions = useCallback(() => {
    setState("loading");
    setErrorMsg(null);
    setSubscriptions([]);
    setFailures([]);
    fetchAllSubscriptions()
      .then((result) => {
        setSubscriptions(result.subscriptions);
        setFailures(result.failures);
        setState(result.failures.length === VALID_STRATEGY_IDS.length ? "error" : "loaded");
        if (result.failures.length === VALID_STRATEGY_IDS.length) {
          setErrorMsg("所有策略訂閱資料都暫時無法讀取，已避免誤判為空清單。");
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : "讀取失敗，請稍後再試。");
        setState("error");
      });
  }, []);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  if (state === "idle" || state === "loading") {
    return (
      <div style={wrapStyle} role="status" aria-live="polite">
        <p style={mutedStyle}>讀取中…</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={wrapStyle} role="alert" aria-live="assertive">
        <p style={{ ...mutedStyle, color: "#e05c72" }}>
          讀取訂閱資料時發生錯誤：{errorMsg}
        </p>
        {failures.length > 0 && (
          <div style={{ ...warningBoxStyle, margin: "0 0 12px" }}>
            <strong>失敗來源</strong>
            <span>{failures.map((failure) => `${failure.label}: ${failure.reason}`).join(" / ")}</span>
          </div>
        )}
        <button type="button" style={retryButtonStyle} onClick={loadSubscriptions}>
          重新讀取
        </button>
      </div>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <div style={{ ...wrapStyle, textAlign: "center", padding: "48px 24px" }}>
        {failures.length > 0 ? (
          <>
            <div style={warningBoxStyle} role="status" aria-live="polite">
              <strong>訂閱資料暫時無法完整讀取</strong>
              <span>已避免把讀取失敗誤判成空清單；可重新讀取或稍後再看。</span>
              <span>{failures.map((failure) => `${failure.label}: ${failure.reason}`).join(" / ")}</span>
            </div>
            <button type="button" style={retryButtonStyle} onClick={loadSubscriptions}>
              重新讀取
            </button>
          </>
        ) : (
          <>
            <p style={{ color: "var(--night-mid, #8899aa)", fontSize: 15, marginBottom: 16 }}>
              尚未訂閱任何策略
            </p>
            <Link href="/quant-strategies" style={storeLinkStyle}>
              前往策略商店 →
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={{ marginBottom: 10, fontSize: 11, color: "var(--night-soft)", fontFamily: "var(--mono)" }} role="status" aria-live="polite">
        共 {subscriptions.length} 筆訂閱紀錄（由 audit_logs 查詢，SIM-only）
      </div>
      {failures.length > 0 && (
        <div style={{ ...warningBoxStyle, marginBottom: 12 }} role="status" aria-live="polite">
          <strong>部分策略訂閱資料未完成讀取</strong>
          <span>{failures.map((failure) => `${failure.label}: ${failure.reason}`).join(" / ")}</span>
        </div>
      )}
      <div style={tableScrollStyle} tabIndex={0} aria-label="SIM-only subscription records">
        <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>策略</th>
            <th style={thStyle}>配置資金</th>
            <th style={thStyle}>狀態</th>
            <th style={thStyle}>訂閱時間</th>
            <th style={thStyle}>操作</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((sub) => (
            <tr key={sub.subscription_id} style={trStyle}>
              <td style={tdStyle}>
                <span style={{ fontWeight: 800, color: "var(--night-ink)", fontSize: 13 }}>
                  {STRATEGY_DISPLAY_NAMES[sub.strategy_id] ?? sub.strategy_id}
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: "var(--night-soft)",
                    marginTop: 2,
                  }}
                >
                  {sub.strategy_id}
                </span>
              </td>
              <td style={{ ...tdStyle, fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums" }}>
                {formatCapital(sub.capital_twd)}
              </td>
              <td style={tdStyle}>
                <span
                  style={{
                    border: "1px solid rgba(88,214,141,0.4)",
                    borderRadius: 999,
                    background: "rgba(88,214,141,0.08)",
                    color: "#58d68d",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "3px 8px",
                    whiteSpace: "nowrap",
                  }}
                >
                  SIM-only / 執行中
                </span>
              </td>
              <td style={{ ...tdStyle, fontFamily: "var(--mono)", fontSize: 12 }}>
                {formatDate(sub.created_at)}
              </td>
              <td style={tdStyle}>
                <button
                  disabled
                  title="v2 開放取消"
                  style={{
                    border: "1px solid rgba(220,228,240,0.14)",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.03)",
                    color: "var(--night-soft)",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "5px 10px",
                    cursor: "not-allowed",
                    opacity: 0.5,
                  }}
                >
                  取消訂閱
                </button>
                <span
                  style={{
                    display: "block",
                    fontSize: 10,
                    color: "var(--night-soft)",
                    fontFamily: "var(--mono)",
                    marginTop: 3,
                  }}
                >
                  v2 開放取消
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const wrapStyle: React.CSSProperties = {
  padding: "16px",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--night-mid, #8899aa)",
  fontSize: 13,
};

const storeLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid rgba(200,148,63,0.4)",
  borderRadius: 8,
  background: "rgba(200,148,63,0.08)",
  color: "#e2b85c",
  fontWeight: 800,
  fontSize: 13,
  padding: "10px 18px",
  textDecoration: "none",
};

const retryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 36,
  border: "1px solid rgba(200,148,63,0.4)",
  borderRadius: 8,
  background: "rgba(200,148,63,0.08)",
  color: "#e2b85c",
  fontWeight: 800,
  fontSize: 13,
  padding: "0 16px",
  cursor: "pointer",
};

const warningBoxStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  maxWidth: 680,
  margin: "0 auto 16px",
  border: "1px solid rgba(220,143,55,0.34)",
  borderLeft: "3px solid var(--tac-warn, #dc8f37)",
  borderRadius: 8,
  background: "rgba(220,143,55,0.075)",
  color: "var(--night-ink, #dde6f2)",
  fontSize: 12,
  lineHeight: 1.55,
  overflowWrap: "anywhere",
  padding: "12px 14px",
  textAlign: "left",
};

const tableScrollStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  overflowX: "auto",
  border: "1px solid rgba(220,228,240,0.07)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.014)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 720,
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(220,228,240,0.09)",
  padding: "9px 8px",
  textAlign: "left",
  color: "var(--night-soft)",
  fontFamily: "var(--mono)",
  fontSize: 10,
  fontWeight: 700,
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(220,228,240,0.06)",
  padding: "10px 8px",
  verticalAlign: "top",
  overflowWrap: "anywhere",
};

const trStyle: React.CSSProperties = {};
