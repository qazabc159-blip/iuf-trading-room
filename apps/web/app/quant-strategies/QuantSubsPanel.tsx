"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";

import {
  STRATEGY_DISPLAY_NAMES,
  VALID_STRATEGY_IDS,
  summarizeSubscriptions,
  type SubscriptionRecord,
} from "./quant-subs-summary";

type LoadState = "idle" | "loading" | "loaded" | "error";

type SubscriptionFetchFailure = {
  strategyId: string;
  label: string;
  reason: string;
};

function formatCapital(value: number) {
  return `${value.toLocaleString("zh-TW")} TWD`;
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
  if (status === "network") return { strategyId, label, reason: "網路或同源代理無回應" };
  if (status === 401 || status === 403) return { strategyId, label, reason: "Owner session 不足" };
  if (status >= 500) return { strategyId, label, reason: `後端讀取失敗 HTTP ${status}` };
  return { strategyId, label, reason: `讀取失敗 HTTP ${status}` };
}

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

async function fetchAllSubscriptions() {
  const results = await Promise.all(VALID_STRATEGY_IDS.map(fetchSubscriptionsForStrategy));
  const subscriptions: SubscriptionRecord[] = [];
  const failures: SubscriptionFetchFailure[] = [];
  for (const result of results) {
    subscriptions.push(...result.subscriptions);
    if (result.failure) failures.push(result.failure);
  }
  return {
    subscriptions: subscriptions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    failures,
  };
}

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
          setErrorMsg("所有 S1 資金配置紀錄都讀取失敗。");
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : "讀取 S1 資金配置紀錄失敗。");
        setState("error");
      });
  }, []);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  if (state === "idle" || state === "loading") {
    return <p style={mutedStyle}>讀取 S1 SIM 資金配置紀錄中...</p>;
  }

  if (state === "error") {
    return (
      <div role="alert" aria-live="assertive" style={wrapStyle}>
        <p style={{ ...mutedStyle, color: "#ff9aa9" }}>{errorMsg}</p>
        {failures.map((failure) => (
          <div key={failure.strategyId} style={warningBoxStyle}>
            <strong>{failure.label}</strong>
            <span>{failure.reason}</span>
          </div>
        ))}
        <button type="button" style={retryButtonStyle} onClick={loadSubscriptions}>重新讀取</button>
      </div>
    );
  }

  const summaries = summarizeSubscriptions(subscriptions);

  if (subscriptions.length === 0) {
    return (
      <div style={{ ...wrapStyle, textAlign: "center", padding: "48px 24px" }}>
        <p style={{ color: "var(--night-mid, #8899aa)", fontSize: 15, marginBottom: 16 }}>
          尚未有 S1 SIM 資金配置紀錄。到 S1 策略頁輸入資金後，下一次 S1 runner 會讀取最新配置。
        </p>
        <Link href="/quant-strategies/cont_liq_v36" style={storeLinkStyle}>前往設定 S1</Link>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={truthNoteStyle} role="status" aria-live="polite">
        已讀取 {subscriptions.length} 筆後端設定紀錄。系統只會套用最新一筆 S1 策略配置，不會把舊研究策略混入正式產品。
      </div>

      {failures.map((failure) => (
        <div key={failure.strategyId} style={warningBoxStyle}>
          <strong>{failure.label}</strong>
          <span>{failure.reason}</span>
        </div>
      ))}

      <div style={gridStyle}>
        {summaries.map((summary) => {
          const latest = summary.latest;
          return (
            <div key={summary.strategyId} style={summaryCardStyle}>
              <div style={summaryHeadStyle}>
                <span style={strategyNameStyle}>{summary.label}</span>
                <span style={latest ? statusOkStyle : statusMutedStyle}>
                  {latest ? "已配置" : "尚未配置"}
                </span>
              </div>
              <div style={strategyIdStyle}>{summary.strategyId}</div>
              {latest ? (
                <div style={summaryGridStyle}>
                  <div>
                    <span style={smallLabelStyle}>最新資金</span>
                    <strong style={monoStrongStyle}>{formatCapital(latest.capital_twd)}</strong>
                  </div>
                  <div>
                    <span style={smallLabelStyle}>寫入時間</span>
                    <strong style={monoStrongStyle}>{formatDate(latest.created_at)}</strong>
                  </div>
                  <div>
                    <span style={smallLabelStyle}>紀錄數</span>
                    <strong style={monoStrongStyle}>{summary.count}</strong>
                  </div>
                </div>
              ) : (
                <p style={mutedStyle}>尚未寫入 S1 SIM 資金。</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  color: "var(--night-ink, #dfe7f2)",
};

const mutedStyle: CSSProperties = {
  color: "var(--night-mid, #8899aa)",
  lineHeight: 1.6,
};

const truthNoteStyle: CSSProperties = {
  border: "1px solid rgba(226,184,92,.28)",
  borderLeft: "3px solid #e2b85c",
  borderRadius: 8,
  padding: "12px 14px",
  marginBottom: 14,
  background: "rgba(226,184,92,.07)",
  color: "#edd3a0",
  fontSize: 13,
  lineHeight: 1.65,
};

const warningBoxStyle: CSSProperties = {
  display: "grid",
  gap: 4,
  border: "1px solid rgba(255,154,169,.28)",
  borderRadius: 8,
  padding: "10px 12px",
  marginBottom: 12,
  background: "rgba(230,57,70,.06)",
  color: "#ffb3bb",
  fontSize: 13,
};

const retryButtonStyle: CSSProperties = {
  minHeight: 40,
  border: "1px solid rgba(226,184,92,.45)",
  borderRadius: 8,
  background: "rgba(226,184,92,.12)",
  color: "#edd3a0",
  fontWeight: 800,
  padding: "0 14px",
  cursor: "pointer",
};

const storeLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 42,
  border: "1px solid rgba(226,184,92,.45)",
  borderRadius: 8,
  background: "rgba(226,184,92,.12)",
  color: "#edd3a0",
  fontWeight: 900,
  padding: "0 16px",
  textDecoration: "none",
};

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 12,
};

const summaryCardStyle: CSSProperties = {
  border: "1px solid rgba(220,228,240,.1)",
  borderRadius: 8,
  background: "rgba(255,255,255,.025)",
  padding: 14,
};

const summaryHeadStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
};

const strategyNameStyle: CSSProperties = {
  color: "var(--night-ink, #dfe7f2)",
  fontWeight: 900,
};

const strategyIdStyle: CSSProperties = {
  marginTop: 4,
  color: "var(--night-soft, #6e7d90)",
  fontFamily: "var(--mono)",
  fontSize: 11,
};

const statusOkStyle: CSSProperties = {
  color: "#58d68d",
  fontFamily: "var(--mono)",
  fontSize: 11,
  fontWeight: 900,
};

const statusMutedStyle: CSSProperties = {
  color: "var(--night-soft, #6e7d90)",
  fontFamily: "var(--mono)",
  fontSize: 11,
  fontWeight: 900,
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 10,
  marginTop: 12,
};

const smallLabelStyle: CSSProperties = {
  display: "block",
  color: "var(--night-soft, #6e7d90)",
  fontFamily: "var(--mono)",
  fontSize: 11,
};

const monoStrongStyle: CSSProperties = {
  display: "block",
  marginTop: 3,
  color: "var(--night-ink, #dfe7f2)",
  fontFamily: "var(--mono)",
  fontSize: 15,
};
