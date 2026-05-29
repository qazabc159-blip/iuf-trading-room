"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";

import {
  STRATEGY_DISPLAY_NAMES,
  VALID_STRATEGY_IDS,
  summarizeSubscriptions,
  type SubscriptionRecord,
  type SubscriptionSummary,
} from "./quant-subs-summary";

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
  if (status === "network") return { strategyId, label, reason: "網路或代理路由無法讀取訂閱資料。" };
  if (status === 401 || status === 403) return { strategyId, label, reason: "Owner session 未通過授權。" };
  if (status >= 500) return { strategyId, label, reason: `後端訂閱資料讀取失敗，HTTP ${status}。` };
  return { strategyId, label, reason: `訂閱資料讀取回傳 HTTP ${status}。` };
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

async function fetchAllSubscriptions(): Promise<SubscriptionsResult> {
  const results = await Promise.all(VALID_STRATEGY_IDS.map(fetchSubscriptionsForStrategy));

  const all: SubscriptionRecord[] = [];
  const failures: SubscriptionFetchFailure[] = [];
  for (const result of results) {
    all.push(...result.subscriptions);
    if (result.failure) failures.push(result.failure);
  }

  const subscriptions = all.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return { subscriptions, failures };
}

function SummaryCard({ summary }: { summary: SubscriptionSummary }) {
  const latest = summary.latest;
  return (
    <div style={summaryCardStyle}>
      <div style={summaryHeadStyle}>
        <span style={strategyNameStyle}>{summary.label}</span>
        <span style={latest ? statusOkStyle : statusMutedStyle}>
          {latest ? "SIM-only / 執行中" : "尚無訂閱"}
        </span>
      </div>
      <div style={strategyIdStyle}>{summary.strategyId}</div>
      {latest ? (
        <div style={summaryGridStyle}>
          <div>
            <span style={smallLabelStyle}>最新配置資金</span>
            <strong style={monoStrongStyle}>{formatCapital(latest.capital_twd)}</strong>
          </div>
          <div>
            <span style={smallLabelStyle}>最新訂閱時間</span>
            <strong style={monoStrongStyle}>{formatDate(latest.created_at)}</strong>
          </div>
          <div>
            <span style={smallLabelStyle}>歷史建立紀錄</span>
            <strong style={monoStrongStyle}>{summary.count} 筆</strong>
          </div>
        </div>
      ) : (
        <p style={mutedStyle}>尚未找到此策略的 SIM-only 訂閱紀錄。</p>
      )}
    </div>
  );
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
          setErrorMsg("三個策略的訂閱資料都無法讀取。");
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : "讀取訂閱資料時發生未知錯誤。");
        setState("error");
      });
  }, []);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  if (state === "idle" || state === "loading") {
    return (
      <div style={wrapStyle} role="status" aria-live="polite">
        <p style={mutedStyle}>正在讀取 SIM-only 訂閱紀錄...</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={wrapStyle} role="alert" aria-live="assertive">
        <p style={{ ...mutedStyle, color: "#e05c72" }}>
          讀取策略訂閱資料失敗：{errorMsg}
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
              <strong>部分策略訂閱資料無法讀取</strong>
              <span>目前不補假資料，也不把讀不到的策略顯示成已訂閱。</span>
              <span>{failures.map((failure) => `${failure.label}: ${failure.reason}`).join(" / ")}</span>
            </div>
            <button type="button" style={retryButtonStyle} onClick={loadSubscriptions}>
              重新讀取
            </button>
          </>
        ) : (
          <>
            <p style={{ color: "var(--night-mid, #8899aa)", fontSize: 15, marginBottom: 16 }}>
              目前尚無 SIM-only 策略訂閱紀錄。
            </p>
            <Link href="/quant-strategies" style={storeLinkStyle}>
              返回策略列表
            </Link>
          </>
        )}
      </div>
    );
  }

  const summaries = summarizeSubscriptions(subscriptions);

  return (
    <div style={wrapStyle}>
      <div style={truthNoteStyle} role="status" aria-live="polite">
        已讀取 {subscriptions.length} 筆 audit_logs 歷史紀錄。上方顯示每個策略的最新 SIM-only 狀態；
        下方保留完整歷史，重複紀錄代表多次建立訂閱，不代表已送出多筆正式券商委託。
      </div>

      {failures.length > 0 && (
        <div style={{ ...warningBoxStyle, marginBottom: 12 }} role="status" aria-live="polite">
          <strong>部分策略訂閱資料無法讀取</strong>
          <span>{failures.map((failure) => `${failure.label}: ${failure.reason}`).join(" / ")}</span>
        </div>
      )}

      <div style={summaryGridWrapStyle} aria-label="SIM-only latest subscription summary">
        {summaries.map((summary) => (
          <SummaryCard key={summary.strategyId} summary={summary} />
        ))}
      </div>

      <div style={historyHeadStyle}>
        <div>
          <strong>歷史建立紀錄</strong>
          <span>audit_logs 原始紀錄，僅供追蹤，不是正式委託簿。</span>
        </div>
        <span>{subscriptions.length} 筆</span>
      </div>

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
                  <span style={strategyIdStyle}>{sub.strategy_id}</span>
                </td>
                <td style={{ ...tdStyle, fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums" }}>
                  {formatCapital(sub.capital_twd)}
                </td>
                <td style={tdStyle}>
                  <span style={statusOkStyle}>SIM-only / 執行中</span>
                </td>
                <td style={{ ...tdStyle, fontFamily: "var(--mono)", fontSize: 12 }}>
                  {formatDate(sub.created_at)}
                </td>
                <td style={tdStyle}>
                  <button disabled title="取消訂閱 v2 才會開放" style={disabledButtonStyle}>
                    尚未開放取消
                  </button>
                  <span style={actionHintStyle}>目前僅讀，不能在此頁改寫訂閱狀態。</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  padding: "16px",
};

const mutedStyle: CSSProperties = {
  color: "var(--night-mid, #8899aa)",
  fontSize: 13,
};

const storeLinkStyle: CSSProperties = {
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

const retryButtonStyle: CSSProperties = {
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

const warningBoxStyle: CSSProperties = {
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

const truthNoteStyle: CSSProperties = {
  marginBottom: 12,
  border: "1px solid rgba(220,143,55,0.28)",
  borderLeft: "3px solid var(--tac-warn, #dc8f37)",
  borderRadius: 8,
  background: "rgba(220,143,55,0.07)",
  color: "var(--night-ink, #dde6f2)",
  fontSize: 12,
  lineHeight: 1.6,
  padding: "11px 13px",
};

const summaryGridWrapStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 10,
  marginBottom: 16,
};

const summaryCardStyle: CSSProperties = {
  border: "1px solid rgba(220,228,240,0.09)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.025)",
  padding: "12px",
  minWidth: 0,
};

const summaryHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 4,
};

const strategyNameStyle: CSSProperties = {
  color: "var(--night-ink)",
  fontSize: 13,
  fontWeight: 850,
  lineHeight: 1.35,
};

const strategyIdStyle: CSSProperties = {
  display: "block",
  fontFamily: "var(--mono)",
  fontSize: 10,
  color: "var(--night-soft)",
  marginTop: 2,
};

const summaryGridStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  marginTop: 10,
};

const smallLabelStyle: CSSProperties = {
  display: "block",
  color: "var(--night-soft)",
  fontSize: 10,
  marginBottom: 3,
};

const monoStrongStyle: CSSProperties = {
  display: "block",
  color: "var(--night-ink)",
  fontFamily: "var(--mono)",
  fontSize: 12,
};

const statusOkStyle: CSSProperties = {
  display: "inline-flex",
  border: "1px solid rgba(88,214,141,0.4)",
  borderRadius: 999,
  background: "rgba(88,214,141,0.08)",
  color: "#58d68d",
  fontFamily: "var(--mono)",
  fontSize: 10,
  fontWeight: 700,
  padding: "3px 8px",
  whiteSpace: "nowrap",
};

const statusMutedStyle: CSSProperties = {
  ...statusOkStyle,
  border: "1px solid rgba(220,228,240,0.18)",
  background: "rgba(255,255,255,0.04)",
  color: "var(--night-soft)",
};

const historyHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 10,
  margin: "6px 0 8px",
  color: "var(--night-ink)",
  fontSize: 13,
};

const tableScrollStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  overflowX: "auto",
  border: "1px solid rgba(220,228,240,0.07)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.014)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  minWidth: 720,
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: CSSProperties = {
  borderBottom: "1px solid rgba(220,228,240,0.09)",
  padding: "9px 8px",
  textAlign: "left",
  color: "var(--night-soft)",
  fontFamily: "var(--mono)",
  fontSize: 10,
  fontWeight: 700,
};

const tdStyle: CSSProperties = {
  borderBottom: "1px solid rgba(220,228,240,0.06)",
  padding: "10px 8px",
  verticalAlign: "top",
  overflowWrap: "anywhere",
};

const disabledButtonStyle: CSSProperties = {
  border: "1px solid rgba(220,228,240,0.14)",
  borderRadius: 6,
  background: "rgba(255,255,255,0.03)",
  color: "var(--night-soft)",
  fontSize: 11,
  fontWeight: 700,
  padding: "5px 10px",
  cursor: "not-allowed",
  opacity: 0.65,
};

const actionHintStyle: CSSProperties = {
  display: "block",
  fontSize: 10,
  color: "var(--night-soft)",
  fontFamily: "var(--mono)",
  marginTop: 3,
};

const trStyle: CSSProperties = {};
