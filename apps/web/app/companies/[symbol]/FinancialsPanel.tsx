"use client";

// FinancialsPanel.tsx — Client Component
// Tab shell for quarterly/annual/monthly-revenue/dividend financials.
// Fetches /api/v1/companies/:id/financials?period=Q&limit=8
// — 404 → FinMind integration placeholder
// — 500 → Data source error (non-crashing)
// — 200 empty → no data placeholder

import { useCallback, useEffect, useRef, useState } from "react";

type TabKey = "quarterly" | "annual" | "monthly" | "dividend";

const TAB_LABELS: Record<TabKey, string> = {
  quarterly: "季報",
  annual:    "年報",
  monthly:   "月營收",
  dividend:  "股利",
};

type FinState =
  | { status: "loading" }
  | { status: "not_integrated" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ok"; rows: FinancialRow[] };

interface FinancialRow {
  period: string;
  revenue: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  epsAfterTax: number | null;
  yoyPct: number | null;
}

const API_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001")
    : "http://localhost:3001";

async function fetchFinancials(companyId: string, period: string): Promise<FinState> {
  try {
    const res = await fetch(
      `${API_BASE}/api/v1/companies/${companyId}/financials?period=${period}&limit=8`,
      { credentials: "include" }
    );
    if (res.status === 404) return { status: "not_integrated" };
    if (!res.ok) return { status: "error", message: `HTTP ${res.status}` };
    const json = await res.json() as { data: FinancialRow[] };
    if (!json.data || json.data.length === 0) return { status: "empty" };
    return { status: "ok", rows: json.data };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "fetch error" };
  }
}

function fmt(v: number | null, digits = 2, suffix = "") {
  if (v === null || v === undefined) return <span className="dim">—</span>;
  return <>{v.toFixed(digits)}{suffix}</>;
}

function QuarterlyTable({ rows }: { rows: FinancialRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        fontFamily: "var(--mono, monospace)",
        fontSize: 11,
      }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--night-rule-strong, #333)" }}>
            {["期間", "營收(億)", "毛利率", "營益率", "稅後EPS", "年增%"].map((h) => (
              <th key={h} className="tg" style={{ padding: "4px 10px", textAlign: "right", fontSize: 10, color: "var(--night-mid, #888)", fontWeight: 400 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period} style={{ borderBottom: "1px solid var(--night-rule, #222)" }}>
              <td style={{ padding: "6px 10px", fontWeight: 700, color: "var(--gold, #b8960c)" }}>{r.period}</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmt(r.revenue !== null && r.revenue !== undefined ? r.revenue / 1e8 : null)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmt(r.grossMarginPct, 1, "%")}</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmt(r.operatingMarginPct, 1, "%")}</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmt(r.epsAfterTax)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>
                {r.yoyPct !== null && r.yoyPct !== undefined ? (
                  <span style={{ color: r.yoyPct >= 0 ? "var(--tw-up-bright, #e63946)" : "var(--tw-dn-bright, #2ecc71)" }}>
                    {r.yoyPct >= 0 ? "+" : ""}{r.yoyPct.toFixed(1)}%
                  </span>
                ) : <span className="dim">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlaceholderContent({ tab, state }: { tab: TabKey; state: FinState }) {
  if (state.status === "loading") {
    return <div className="dim" style={{ padding: "20px 0", fontFamily: "var(--mono)", fontSize: 11 }}>LOADING…</div>;
  }
  if (state.status === "not_integrated") {
    return (
      <div style={{ padding: "20px 0" }}>
        <span className="badge-yellow" style={{ fontSize: 11 }}>FinMind 資料源整合中（預計 W7 D5）</span>
        <div className="dim" style={{ marginTop: 8, fontFamily: "var(--mono)", fontSize: 11 }}>
          {tab === "quarterly" && "季報資料待接通 /api/v1/companies/:id/financials?period=Q"}
          {tab === "annual"    && "年報資料待接通 /api/v1/companies/:id/financials?period=A"}
          {tab === "monthly"   && "月營收資料待接通 /api/v1/companies/:id/financials?period=M"}
          {tab === "dividend"  && "股利資料待接通 /api/v1/companies/:id/financials?period=DIV"}
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div style={{ padding: "20px 0" }}>
        <span className="badge-red" style={{ fontSize: 11 }}>資料來源異常 - 已記錄</span>
        <div className="dim" style={{ marginTop: 6, fontFamily: "var(--mono)", fontSize: 11 }}>{state.message}</div>
      </div>
    );
  }
  if (state.status === "empty") {
    return <div className="dim" style={{ padding: "20px 0", fontFamily: "var(--mono)", fontSize: 11 }}>尚無財報資料</div>;
  }
  if (state.status === "ok") {
    if (tab === "quarterly" || tab === "annual") {
      return <QuarterlyTable rows={state.rows} />;
    }
    // monthly / dividend: generic row list (FinMind shape TBD)
    return <QuarterlyTable rows={state.rows} />;
  }
  return null;
}

const PERIOD_MAP: Record<TabKey, string> = { quarterly: "Q", annual: "A", monthly: "M", dividend: "DIV" };

export function FinancialsPanel({ companyId }: { companyId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>("quarterly");
  const [states, setStates] = useState<Partial<Record<TabKey, FinState>>>({});

  // Use a ref to track which tabs have been loaded, avoiding infinite dep loop
  const loadedRef = useRef(new Set<TabKey>());

  const loadTab = useCallback(async (tab: TabKey) => {
    if (loadedRef.current.has(tab)) return;
    loadedRef.current.add(tab);

    setStates((prev) => ({ ...prev, [tab]: { status: "loading" } }));
    const result = await fetchFinancials(companyId, PERIOD_MAP[tab]);
    setStates((prev) => ({ ...prev, [tab]: result }));
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadTab("quarterly"); }, [loadTab]);

  const handleTabClick = (tab: TabKey) => {
    setActiveTab(tab);
    loadTab(tab);
  };

  const currentState: FinState = states[activeTab] ?? { status: "loading" };

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[03]</span> 財報資料
      </h3>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--night-rule-strong, #333)", marginBottom: 12 }}>
        {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => (
          <button
            key={tab}
            onClick={() => handleTabClick(tab)}
            style={{
              padding: "6px 16px",
              background: "none",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid var(--gold, #b8960c)" : "2px solid transparent",
              color: activeTab === tab ? "var(--night-ink, #d8d4c8)" : "var(--night-mid, #888)",
              fontFamily: "var(--mono, monospace)",
              fontSize: 12,
              fontWeight: activeTab === tab ? 600 : 400,
              cursor: "pointer",
              letterSpacing: "0.06em",
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <PlaceholderContent tab={activeTab} state={currentState} />
    </section>
  );
}
