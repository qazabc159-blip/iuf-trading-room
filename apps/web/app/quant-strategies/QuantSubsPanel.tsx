"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function fetchAllSubscriptions(): Promise<SubscriptionRecord[]> {
  const results = await Promise.allSettled(
    VALID_STRATEGY_IDS.map((id) =>
      fetch(`/api/quant-strategies/${id}/subscriptions/my`, {
        cache: "no-store",
        credentials: "include",
      }).then(async (res) => {
        if (!res.ok) return [] as SubscriptionRecord[];
        const json = (await res.json()) as { subscriptions?: SubscriptionRecord[] };
        return json.subscriptions ?? [];
      })
    )
  );

  const all: SubscriptionRecord[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      all.push(...result.value);
    }
  }
  // Sort newest first
  return all.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuantSubsPanel() {
  const [state, setState] = useState<LoadState>("idle");
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setState("loading");
    fetchAllSubscriptions()
      .then((items) => {
        setSubscriptions(items);
        setState("loaded");
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : "讀取失敗，請稍後再試。");
        setState("error");
      });
  }, []);

  if (state === "idle" || state === "loading") {
    return (
      <div style={wrapStyle}>
        <p style={mutedStyle}>讀取中…</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={wrapStyle}>
        <p style={{ ...mutedStyle, color: "#e05c72" }}>
          讀取訂閱資料時發生錯誤：{errorMsg}
        </p>
      </div>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <div style={{ ...wrapStyle, textAlign: "center", padding: "48px 24px" }}>
        <p style={{ color: "var(--night-mid, #8899aa)", fontSize: 15, marginBottom: 16 }}>
          尚未訂閱任何策略
        </p>
        <Link
          href="/quant-strategies"
          style={{
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
          }}
        >
          前往策略商店 →
        </Link>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={{ marginBottom: 10, fontSize: 11, color: "var(--night-soft)", fontFamily: "var(--mono)" }}>
        共 {subscriptions.length} 筆訂閱紀錄（由 audit_logs 查詢，SIM-only）
      </div>
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

const tableStyle: React.CSSProperties = {
  width: "100%",
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
};

const trStyle: React.CSSProperties = {};
