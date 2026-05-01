"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getCompanyDividends,
  getCompanyFinancials,
  getCompanyRevenue,
  type CompanyDividendRow,
  type CompanyFinancialRow,
  type CompanyRevenueRow,
} from "@/lib/api";

type TabKey = "financials" | "revenue" | "dividend";

type TabState =
  | { status: "loading" }
  | { status: "blocked"; reason: string; fetchedAt: string }
  | { status: "empty"; reason: string; fetchedAt: string }
  | { status: "live"; rows: CompanyFinancialRow[] | CompanyRevenueRow[] | CompanyDividendRow[]; fetchedAt: string };

const TABS: Array<{ key: TabKey; label: string; source: string }> = [
  { key: "financials", label: "Financials", source: "GET /api/v1/companies/:id/financials?limit=8" },
  { key: "revenue", label: "Monthly revenue", source: "GET /api/v1/companies/:id/revenue?limit=12" },
  { key: "dividend", label: "Dividend", source: "GET /api/v1/companies/:id/dividend?years=5" },
];

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function money(value: number | null | undefined, divisor = 1_000_000_000) {
  if (value === null || value === undefined) return "--";
  return (value / divisor).toFixed(2);
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function numberText(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined) return "--";
  return value.toFixed(digits);
}

function StatePanel({ state, source }: { state: Extract<TabState, { status: "blocked" | "empty" }>; source: string }) {
  const badge = state.status === "blocked" ? "badge-red" : "badge-yellow";
  return (
    <div className="state-panel">
      <span className={`badge ${badge}`}>{state.status.toUpperCase()}</span>
      <span className="tg soft">Source: {source}</span>
      <span className="tg soft">Updated {formatTime(state.fetchedAt)}</span>
      <span className="state-reason">{state.reason}</span>
    </div>
  );
}

function FinancialTable({ rows }: { rows: CompanyFinancialRow[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Revenue (bn)</th>
            <th>Gross margin</th>
            <th>Operating margin</th>
            <th>EPS</th>
            <th>YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.period}>
              <td>{row.period}</td>
              <td className="num">{money(row.revenue)}</td>
              <td className="num">{percent(row.grossMarginPct)}</td>
              <td className="num">{percent(row.operatingMarginPct)}</td>
              <td className="num">{numberText(row.epsAfterTax)}</td>
              <td className={`num ${row.yoyPct && row.yoyPct > 0 ? "up" : row.yoyPct && row.yoyPct < 0 ? "down" : "muted"}`}>
                {percent(row.yoyPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevenueTable({ rows }: { rows: CompanyRevenueRow[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Month</th>
            <th>Revenue (bn)</th>
            <th>Stock</th>
            <th>Country</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.stock_id}-${row.date}`}>
              <td>{row.revenue_year}/{String(row.revenue_month).padStart(2, "0")}</td>
              <td className="num">{money(row.revenue)}</td>
              <td>{row.stock_id}</td>
              <td>{row.country}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DividendTable({ rows }: { rows: CompanyDividendRow[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Year</th>
            <th>Total dividend</th>
            <th>Cash dividend</th>
            <th>Stock dividend</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.stock_id}-${row.year}-${row.date}`}>
              <td>{row.year}</td>
              <td className="num">{numberText(row.TotalDividend)}</td>
              <td className="num">{numberText(row.TotalCashDividend)}</td>
              <td className="num">{numberText(row.TotalStockDividend)}</td>
              <td>{row.date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rows({ tab, state }: { tab: TabKey; state: TabState }) {
  if (state.status === "loading") {
    return (
      <div className="state-panel">
        <span className="badge badge-blue">LOADING</span>
        <span className="tg soft">Fetching FinMind {tab} data.</span>
      </div>
    );
  }

  const source = TABS.find((item) => item.key === tab)?.source ?? "FinMind";
  if (state.status === "blocked" || state.status === "empty") return <StatePanel state={state} source={source} />;

  if (tab === "financials") return <FinancialTable rows={state.rows as CompanyFinancialRow[]} />;
  if (tab === "revenue") return <RevenueTable rows={state.rows as CompanyRevenueRow[]} />;
  return <DividendTable rows={state.rows as CompanyDividendRow[]} />;
}

export function FinancialsPanel({ companyId }: { companyId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>("financials");
  const [states, setStates] = useState<Partial<Record<TabKey, TabState>>>({});
  const loadedRef = useRef(new Set<TabKey>());

  const loadTab = useCallback(async (tab: TabKey) => {
    if (loadedRef.current.has(tab)) return;
    loadedRef.current.add(tab);

    setStates((prev) => ({ ...prev, [tab]: { status: "loading" } }));
    const fetchedAt = new Date().toISOString();

    try {
      const response = tab === "financials"
        ? await getCompanyFinancials(companyId, { limit: 8 })
        : tab === "revenue"
          ? await getCompanyRevenue(companyId, { limit: 12 })
          : await getCompanyDividends(companyId, { years: 5 });
      const rows = response.data ?? [];
      setStates((prev) => ({
        ...prev,
        [tab]: rows.length > 0
          ? { status: "live", rows, fetchedAt }
          : {
              status: "empty",
              fetchedAt,
              reason: `FinMind returned zero ${tab} rows for this company.`,
            },
      }));
    } catch (error) {
      setStates((prev) => ({
        ...prev,
        [tab]: {
          status: "blocked",
          fetchedAt,
          reason: error instanceof Error ? error.message : `${tab} request failed`,
        },
      }));
    }
  }, [companyId]);

  useEffect(() => {
    void loadTab("financials");
  }, [loadTab]);

  const currentState: TabState = states[activeTab] ?? { status: "loading" };
  const activeSource = TABS.find((item) => item.key === activeTab)?.source ?? "FinMind";

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[03]</span> FINANCIALS
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>FinMind live fundamentals</span>
      </h3>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--night-rule-strong, #333)", marginBottom: 12, paddingBottom: 10 }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? "mini-button" : "outline-button"}
            onClick={() => {
              setActiveTab(tab.key);
              void loadTab(tab.key);
            }}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {currentState.status === "live" && (
        <div className="source-line">
          <span className="badge badge-green">LIVE</span>
          <span className="tg soft">Source: {activeSource}</span>
          <span className="tg soft">Updated {formatTime(currentState.fetchedAt)}</span>
        </div>
      )}
      <Rows tab={activeTab} state={currentState} />
    </section>
  );
}
