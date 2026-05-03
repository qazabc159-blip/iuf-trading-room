"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getCompanyDividends,
  getCompanyFinancials,
  getCompanyRevenue,
  getCompanyValuation,
  type CompanyDividendRow,
  type CompanyFinancialRow,
  type CompanyRevenueRow,
  type CompanyValuationRow,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

type TabKey = "financials" | "revenue" | "valuation" | "dividend";

type TabState =
  | { status: "loading" }
  | { status: "blocked"; reason: string; fetchedAt: string }
  | { status: "empty"; reason: string; fetchedAt: string }
  | { status: "live"; rows: CompanyFinancialRow[] | CompanyRevenueRow[] | CompanyValuationRow[] | CompanyDividendRow[]; fetchedAt: string };

const TABS: Array<{ key: TabKey; label: string; source: string }> = [
  { key: "financials", label: "財報", source: "FinMind 財報" },
  { key: "revenue", label: "月營收", source: "FinMind 月營收" },
  { key: "valuation", label: "估值", source: "FinMind PER/PBR" },
  { key: "dividend", label: "股利", source: "FinMind 股利" },
];

function tabCopy(tab: TabKey) {
  return TABS.find((item) => item.key === tab) ?? TABS[0];
}

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

function tabStateSummary(tab: TabKey, state: TabState | undefined) {
  if (!state || state.status === "loading") return "讀取中";
  if (state.status === "blocked") return "暫停";
  if (state.status === "empty") return "無資料";

  if (tab === "financials") {
    const row = (state.rows as CompanyFinancialRow[])[0];
    return row ? `${row.period} / EPS ${numberText(row.epsAfterTax)}` : "無資料";
  }
  if (tab === "revenue") {
    const row = (state.rows as CompanyRevenueRow[])[0];
    return row ? `${row.revenue_year}/${String(row.revenue_month).padStart(2, "0")} / ${money(row.revenue)} 十億` : "無資料";
  }
  if (tab === "valuation") {
    const row = (state.rows as CompanyValuationRow[])[0];
    return row ? `${row.date} / PER ${numberText(row.PER)}` : "無資料";
  }

  const row = (state.rows as CompanyDividendRow[])[0];
  return row ? `${row.year} / ${numberText(row.TotalDividend)} 元` : "無資料";
}

function statusLabel(status: TabState["status"]) {
  if (status === "live") return "正常";
  if (status === "empty") return "無資料";
  if (status === "loading") return "載入中";
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
      <table className="data-table company-data-table-fit">
        <thead>
          <tr>
            <th><span className="table-cell-inner">期別</span></th>
            <th><span className="table-cell-inner">營收（十億）</span></th>
            <th><span className="table-cell-inner">毛利率</span></th>
            <th><span className="table-cell-inner">營益率</span></th>
            <th><span className="table-cell-inner">EPS</span></th>
            <th><span className="table-cell-inner">年增率</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.period}>
              <td><span className="table-cell-inner">{row.period}</span></td>
              <td className="num"><span className="table-cell-inner">{money(row.revenue)}</span></td>
              <td className="num"><span className="table-cell-inner">{percent(row.grossMarginPct)}</span></td>
              <td className="num"><span className="table-cell-inner">{percent(row.operatingMarginPct)}</span></td>
              <td className="num"><span className="table-cell-inner">{numberText(row.epsAfterTax)}</span></td>
              <td className={`num ${row.yoyPct && row.yoyPct > 0 ? "up" : row.yoyPct && row.yoyPct < 0 ? "down" : "muted"}`}>
                <span className="table-cell-inner">{percent(row.yoyPct)}</span>
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
      <table className="data-table company-data-table-fit">
        <thead>
          <tr>
            <th><span className="table-cell-inner">年月</span></th>
            <th><span className="table-cell-inner">營收（十億）</span></th>
            <th><span className="table-cell-inner">代號</span></th>
            <th><span className="table-cell-inner">市場</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.stock_id}-${row.date}`}>
              <td><span className="table-cell-inner">{row.revenue_year}/{String(row.revenue_month).padStart(2, "0")}</span></td>
              <td className="num"><span className="table-cell-inner">{money(row.revenue)}</span></td>
              <td><span className="table-cell-inner">{row.stock_id}</span></td>
              <td><span className="table-cell-inner">{row.country}</span></td>
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
      <table className="data-table company-data-table-fit">
        <thead>
          <tr>
            <th><span className="table-cell-inner">年度</span></th>
            <th><span className="table-cell-inner">總股利</span></th>
            <th><span className="table-cell-inner">現金股利</span></th>
            <th><span className="table-cell-inner">股票股利</span></th>
            <th><span className="table-cell-inner">除權息日</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.stock_id}-${row.year}-${row.date}`}>
              <td><span className="table-cell-inner">{row.year}</span></td>
              <td className="num"><span className="table-cell-inner">{numberText(row.TotalDividend)}</span></td>
              <td className="num"><span className="table-cell-inner">{numberText(row.TotalCashDividend)}</span></td>
              <td className="num"><span className="table-cell-inner">{numberText(row.TotalStockDividend)}</span></td>
              <td><span className="table-cell-inner">{row.date}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ValuationTable({ rows }: { rows: CompanyValuationRow[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table company-data-table-fit">
        <thead>
          <tr>
            <th><span className="table-cell-inner">日期</span></th>
            <th><span className="table-cell-inner">本益比 PER</span></th>
            <th><span className="table-cell-inner">股價淨值比 PBR</span></th>
            <th><span className="table-cell-inner">殖利率</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.stock_id}-${row.date}`}>
              <td><span className="table-cell-inner">{row.date}</span></td>
              <td className="num"><span className="table-cell-inner">{numberText(row.PER)}</span></td>
              <td className="num"><span className="table-cell-inner">{numberText(row.PBR)}</span></td>
              <td className="num"><span className="table-cell-inner">{numberText(row.dividend_yield)}%</span></td>
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
        <span className="badge badge-blue">載入中</span>
        <span className="tg soft">正在讀取 {tabCopy(tab).label} 資料</span>
      </div>
    );
  }

  const source = tabCopy(tab).source;
  if (state.status === "blocked" || state.status === "empty") return <StatePanel state={state} source={source} />;

  if (tab === "financials") return <FinancialTable rows={state.rows as CompanyFinancialRow[]} />;
  if (tab === "revenue") return <RevenueTable rows={state.rows as CompanyRevenueRow[]} />;
  if (tab === "valuation") return <ValuationTable rows={state.rows as CompanyValuationRow[]} />;
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
    const copy = tabCopy(tab);

    try {
      const response = tab === "financials"
        ? await getCompanyFinancials(companyId, { limit: 8 })
        : tab === "revenue"
          ? await getCompanyRevenue(companyId, { limit: 12 })
          : tab === "valuation"
            ? await getCompanyValuation(companyId, { days: 120 })
            : await getCompanyDividends(companyId, { years: 5 });
      const rows = response.data ?? [];
      setStates((prev) => ({
        ...prev,
        [tab]: rows.length > 0
          ? { status: "live", rows, fetchedAt }
          : {
              status: "empty",
              fetchedAt,
              reason: `目前沒有回傳 ${copy.label} 資料。`,
            },
      }));
    } catch (error) {
      setStates((prev) => ({
        ...prev,
        [tab]: {
          status: "blocked",
          fetchedAt,
          reason: friendlyDataError(error, `${copy.label}資料暫時無法讀取`),
        },
      }));
    }
  }, [companyId]);

  useEffect(() => {
    for (const tab of TABS) {
      void loadTab(tab.key);
    }
  }, [loadTab]);

  const currentState: TabState = states[activeTab] ?? { status: "loading" };
  const activeSource = tabCopy(activeTab).source;

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[03]</span> 財報與估值
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>FinMind 財報 / 月營收 / PER / 股利</span>
      </h3>

      <div className="company-data-tabs finmind-tabs">
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
            <span className="company-data-tab-main">{tab.label}</span>
            <span className="company-data-tab-meta">{tabStateSummary(tab.key, states[tab.key])}</span>
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
