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
  { key: "financials", label: "季報財務", source: "FinMind 財報" },
  { key: "revenue", label: "月營收", source: "FinMind 月營收" },
  { key: "dividend", label: "股利", source: "FinMind 股利" },
];

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function money(value: number | null | undefined, divisor = 1_000_000_000) {
  if (value === null || value === undefined) return "--";
  return (value / divisor).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function numberText(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function statusLabel(status: TabState["status"]) {
  if (status === "live") return "正常";
  if (status === "empty") return "無資料";
  if (status === "loading") return "讀取中";
  return "暫停";
}

function StatePanel({ state, source }: { state: Extract<TabState, { status: "blocked" | "empty" }>; source: string }) {
  const badge = state.status === "blocked" ? "badge-red" : "badge-yellow";
  return (
    <div className="state-panel">
      <span className={`badge ${badge}`}>{statusLabel(state.status)}</span>
      <span className="tg soft">來源：{source}</span>
      <span className="tg soft">更新 {formatTime(state.fetchedAt)}</span>
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
            <th>期別</th>
            <th>營收（十億）</th>
            <th>毛利率</th>
            <th>營益率</th>
            <th>EPS</th>
            <th>年增率</th>
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
            <th>年月</th>
            <th>營收（十億）</th>
            <th>代號</th>
            <th>市場</th>
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
            <th>年度</th>
            <th>股利合計</th>
            <th>現金股利</th>
            <th>股票股利</th>
            <th>日期</th>
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
        <span className="badge badge-blue">讀取中</span>
        <span className="tg soft">正在讀取 {TABS.find((item) => item.key === tab)?.label ?? "財務"} 資料。</span>
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
              reason: `這檔股票目前沒有 ${TABS.find((item) => item.key === tab)?.label ?? "財務"} 資料列。`,
            },
      }));
    } catch (error) {
      setStates((prev) => ({
        ...prev,
        [tab]: {
          status: "blocked",
          fetchedAt,
          reason: error instanceof Error ? error.message : `${tab} 資料讀取失敗`,
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
        <span className="ascii-head-bracket">[03]</span> 財報與營收
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>FinMind 正式基本面</span>
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
          <span className="badge badge-green">正常</span>
          <span className="tg soft">來源：{activeSource}</span>
          <span className="tg soft">更新 {formatTime(currentState.fetchedAt)}</span>
        </div>
      )}
      <Rows tab={activeTab} state={currentState} />
    </section>
  );
}
