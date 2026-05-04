"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  getCompanyBalanceSheet,
  getCompanyCashFlow,
  getCompanyDividends,
  getCompanyFinancials,
  getCompanyMarketValue,
  getCompanyRevenue,
  getCompanyValuation,
  type CompanyBalanceSheetSnapshot,
  type CompanyCashFlowSnapshot,
  type CompanyDividendRow,
  type CompanyFinancialRow,
  type CompanyMarketValueRow,
  type CompanyRevenueRow,
  type CompanyValuationRow,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

type TabKey = "financials" | "revenue" | "balance" | "cashFlow" | "valuation" | "marketValue" | "dividend";

type TabRows =
  | CompanyFinancialRow[]
  | CompanyRevenueRow[]
  | CompanyValuationRow[]
  | CompanyMarketValueRow[]
  | CompanyDividendRow[]
  | CompanyBalanceSheetSnapshot[]
  | CompanyCashFlowSnapshot[];

type TabState =
  | { status: "loading" }
  | { status: "blocked"; reason: string; fetchedAt: string }
  | { status: "empty"; reason: string; fetchedAt: string }
  | { status: "live"; rows: TabRows; fetchedAt: string };

const PAGE_SIZE = 10;

const TABS: Array<{ key: TabKey; label: string; source: string }> = [
  { key: "financials", label: "財報", source: "FinMind 財報" },
  { key: "revenue", label: "月營收", source: "FinMind 月營收" },
  { key: "balance", label: "資產負債", source: "FinMind 資產負債表" },
  { key: "cashFlow", label: "現金流", source: "FinMind 現金流量表" },
  { key: "valuation", label: "估值", source: "FinMind PER / PBR" },
  { key: "marketValue", label: "市值", source: "FinMind 股價市值" },
  { key: "dividend", label: "股利", source: "FinMind 股利政策" },
];

function tabCopy(tab: TabKey) {
  return TABS.find((item) => item.key === tab) ?? TABS[0];
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function numberText(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 兆`;
  }
  if (abs >= 100_000_000) {
    return `${(value / 100_000_000).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 億`;
  }
  if (abs >= 10_000) {
    return `${(value / 10_000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 萬`;
  }
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function tabStateSummary(tab: TabKey, state: TabState | undefined) {
  if (!state || state.status === "loading") return "讀取中";
  if (state.status === "blocked") return "無法顯示";
  if (state.status === "empty") return "無資料";

  if (tab === "financials") {
    const row = (state.rows as CompanyFinancialRow[])[0];
    return row ? `${row.period} / EPS ${numberText(row.epsAfterTax)}` : "無資料";
  }
  if (tab === "revenue") {
    const row = (state.rows as CompanyRevenueRow[])[0];
    return row ? `${row.revenue_year}/${String(row.revenue_month).padStart(2, "0")} / ${money(row.revenue)}` : "無資料";
  }
  if (tab === "balance") {
    const row = (state.rows as CompanyBalanceSheetSnapshot[])[0];
    return row ? `${row.date} / 資產 ${money(row.totalAssets)}` : "無資料";
  }
  if (tab === "cashFlow") {
    const row = (state.rows as CompanyCashFlowSnapshot[])[0];
    return row ? `${row.date} / 營業 ${money(row.operatingCashFlow)}` : "無資料";
  }
  if (tab === "valuation") {
    const row = (state.rows as CompanyValuationRow[])[0];
    return row ? `${row.date} / PER ${numberText(row.PER)}` : "無資料";
  }
  if (tab === "marketValue") {
    const row = (state.rows as CompanyMarketValueRow[])[0];
    return row ? `${row.date} / ${money(row.market_value)}` : "無資料";
  }

  const row = (state.rows as CompanyDividendRow[])[0];
  return row ? `${row.year} / ${numberText(row.TotalDividend)} 元` : "無資料";
}

function statusLabel(status: TabState["status"]) {
  if (status === "live") return "正常";
  if (status === "empty") return "無資料";
  if (status === "loading") return "讀取中";
  return "無法顯示";
}

function paginate<T>(rows: T[], page: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const start = safePage * PAGE_SIZE;
  return {
    page: safePage,
    pageCount,
    rows: rows.slice(start, start + PAGE_SIZE),
    start,
  };
}

function PaginationBar({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (next: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="company-finmind-pagination">
      <span>
        顯示 {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} / {total} 筆
      </span>
      <div>
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0}>
          上一頁
        </button>
        <strong>{page + 1} / {pageCount}</strong>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page + 1 >= pageCount}>
          下一頁
        </button>
      </div>
    </div>
  );
}

function StatePanel({ state, source }: { state: Extract<TabState, { status: "blocked" | "empty" }>; source: string }) {
  const badge = state.status === "blocked" ? "badge-red" : "badge-yellow";
  return (
    <div className="state-panel">
      <span className={`badge ${badge}`}>{statusLabel(state.status)}</span>
      <span className="tg soft">來源：{source}</span>
      <span className="tg soft">更新：{formatTime(state.fetchedAt)}</span>
      <span className="state-reason">{state.reason}</span>
    </div>
  );
}

function DataShell({
  children,
  page,
  pageCount,
  total,
  onPage,
}: {
  children: ReactNode;
  page: number;
  pageCount: number;
  total: number;
  onPage: (next: number) => void;
}) {
  return (
    <div className="company-finmind-table-shell">
      {children}
      <PaginationBar page={page} pageCount={pageCount} total={total} onPage={onPage} />
    </div>
  );
}

function FinancialTable({ rows, page, onPage }: { rows: CompanyFinancialRow[]; page: number; onPage: (next: number) => void }) {
  const view = paginate(rows, page);
  return (
    <DataShell page={view.page} pageCount={view.pageCount} total={rows.length} onPage={onPage}>
      <div className="table-scroll">
        <table className="data-table company-data-table-fit">
          <thead>
            <tr>
              <th><span className="table-cell-inner">期別</span></th>
              <th><span className="table-cell-inner">營收</span></th>
              <th><span className="table-cell-inner">毛利率</span></th>
              <th><span className="table-cell-inner">營益率</span></th>
              <th><span className="table-cell-inner">EPS</span></th>
              <th><span className="table-cell-inner">年增率</span></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
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
    </DataShell>
  );
}

function RevenueTable({ rows, page, onPage }: { rows: CompanyRevenueRow[]; page: number; onPage: (next: number) => void }) {
  const view = paginate(rows, page);
  return (
    <DataShell page={view.page} pageCount={view.pageCount} total={rows.length} onPage={onPage}>
      <div className="table-scroll">
        <table className="data-table company-data-table-fit">
          <thead>
            <tr>
              <th><span className="table-cell-inner">年月</span></th>
              <th><span className="table-cell-inner">營收</span></th>
              <th><span className="table-cell-inner">代號</span></th>
              <th><span className="table-cell-inner">市場</span></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
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
    </DataShell>
  );
}

function MetricTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="metric-tile">
      <span className="tg soft">{label}</span>
      <strong>{value}</strong>
      {unit ? <span className="tg soft">{unit}</span> : null}
    </div>
  );
}

function SourceItemsTable({
  items,
  page,
  onPage,
}: {
  items: Array<{ type: string; originName?: string | null; value: number | null }>;
  page: number;
  onPage: (next: number) => void;
}) {
  const view = paginate(items, page);
  return (
    <DataShell page={view.page} pageCount={view.pageCount} total={items.length} onPage={onPage}>
      <div className="table-scroll">
        <table className="data-table company-data-table-fit">
          <thead>
            <tr>
              <th><span className="table-cell-inner">指標</span></th>
              <th><span className="table-cell-inner">原始項目</span></th>
              <th><span className="table-cell-inner">金額</span></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((item) => (
              <tr key={`${item.type}-${item.originName ?? "source"}`}>
                <td><span className="table-cell-inner">{item.type}</span></td>
                <td><span className="table-cell-inner">{item.originName ?? "未標示"}</span></td>
                <td className="num"><span className="table-cell-inner">{money(item.value)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DataShell>
  );
}

function BalanceSheetTable({
  rows,
  page,
  onPage,
}: {
  rows: CompanyBalanceSheetSnapshot[];
  page: number;
  onPage: (next: number) => void;
}) {
  const row = rows[0];
  return (
    <div className="company-finmind-snapshot">
      <div className="source-line">
        <span className="badge badge-green">正常</span>
        <span className="tg soft">期別：{row.date}</span>
        <span className="tg soft">來源：FinMind 資產負債表</span>
      </div>
      <div className="metric-grid compact-metric-grid">
        <MetricTile label="總資產" value={money(row.totalAssets)} />
        <MetricTile label="總負債" value={money(row.totalLiabilities)} />
        <MetricTile label="股東權益" value={money(row.equity)} />
        <MetricTile label="現金及約當現金" value={money(row.cashAndCashEquivalents)} />
        <MetricTile label="負債比" value={numberText(row.debtRatioPct, 1)} unit="%" />
        <MetricTile label="流動比" value={numberText(row.currentRatioPct, 1)} unit="%" />
      </div>
      <SourceItemsTable items={row.sourceItems} page={page} onPage={onPage} />
    </div>
  );
}

function CashFlowTable({
  rows,
  page,
  onPage,
}: {
  rows: CompanyCashFlowSnapshot[];
  page: number;
  onPage: (next: number) => void;
}) {
  const row = rows[0];
  return (
    <div className="company-finmind-snapshot">
      <div className="source-line">
        <span className="badge badge-green">正常</span>
        <span className="tg soft">期別：{row.date}</span>
        <span className="tg soft">來源：FinMind 現金流量表</span>
      </div>
      <div className="metric-grid compact-metric-grid">
        <MetricTile label="營業現金流" value={money(row.operatingCashFlow)} />
        <MetricTile label="投資現金流" value={money(row.investingCashFlow)} />
        <MetricTile label="籌資現金流" value={money(row.financingCashFlow)} />
        <MetricTile label="自由現金流" value={money(row.freeCashFlow)} />
        <MetricTile label="現金增加" value={money(row.cashIncrease)} />
        <MetricTile label="稅前淨利" value={money(row.netIncomeBeforeTax)} />
      </div>
      <SourceItemsTable items={row.sourceItems} page={page} onPage={onPage} />
    </div>
  );
}

function DividendTable({ rows, page, onPage }: { rows: CompanyDividendRow[]; page: number; onPage: (next: number) => void }) {
  const view = paginate(rows, page);
  return (
    <DataShell page={view.page} pageCount={view.pageCount} total={rows.length} onPage={onPage}>
      <div className="table-scroll">
        <table className="data-table company-data-table-fit">
          <thead>
            <tr>
              <th><span className="table-cell-inner">年度</span></th>
              <th><span className="table-cell-inner">股利合計</span></th>
              <th><span className="table-cell-inner">現金股利</span></th>
              <th><span className="table-cell-inner">股票股利</span></th>
              <th><span className="table-cell-inner">除權息日</span></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
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
    </DataShell>
  );
}

function ValuationTable({ rows, page, onPage }: { rows: CompanyValuationRow[]; page: number; onPage: (next: number) => void }) {
  const view = paginate(rows, page);
  return (
    <DataShell page={view.page} pageCount={view.pageCount} total={rows.length} onPage={onPage}>
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
            {view.rows.map((row) => (
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
    </DataShell>
  );
}

function MarketValueTable({
  rows,
  page,
  onPage,
}: {
  rows: CompanyMarketValueRow[];
  page: number;
  onPage: (next: number) => void;
}) {
  const view = paginate(rows, page);
  return (
    <DataShell page={view.page} pageCount={view.pageCount} total={rows.length} onPage={onPage}>
      <div className="table-scroll">
        <table className="data-table company-data-table-fit">
          <thead>
            <tr>
              <th><span className="table-cell-inner">日期</span></th>
              <th><span className="table-cell-inner">股價市值</span></th>
              <th><span className="table-cell-inner">代號</span></th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={`${row.stock_id}-${row.date}`}>
                <td><span className="table-cell-inner">{row.date}</span></td>
                <td className="num"><span className="table-cell-inner">{money(row.market_value)}</span></td>
                <td><span className="table-cell-inner">{row.stock_id}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DataShell>
  );
}

function Rows({
  tab,
  state,
  page,
  onPage,
}: {
  tab: TabKey;
  state: TabState;
  page: number;
  onPage: (next: number) => void;
}) {
  if (state.status === "loading") {
    return (
      <div className="state-panel">
        <span className="badge badge-blue">讀取中</span>
        <span className="tg soft">正在讀取 {tabCopy(tab).label} 資料</span>
      </div>
    );
  }

  const source = tabCopy(tab).source;
  if (state.status === "blocked" || state.status === "empty") return <StatePanel state={state} source={source} />;

  if (tab === "financials") return <FinancialTable rows={state.rows as CompanyFinancialRow[]} page={page} onPage={onPage} />;
  if (tab === "revenue") return <RevenueTable rows={state.rows as CompanyRevenueRow[]} page={page} onPage={onPage} />;
  if (tab === "balance") return <BalanceSheetTable rows={state.rows as CompanyBalanceSheetSnapshot[]} page={page} onPage={onPage} />;
  if (tab === "cashFlow") return <CashFlowTable rows={state.rows as CompanyCashFlowSnapshot[]} page={page} onPage={onPage} />;
  if (tab === "valuation") return <ValuationTable rows={state.rows as CompanyValuationRow[]} page={page} onPage={onPage} />;
  if (tab === "marketValue") return <MarketValueTable rows={state.rows as CompanyMarketValueRow[]} page={page} onPage={onPage} />;
  return <DividendTable rows={state.rows as CompanyDividendRow[]} page={page} onPage={onPage} />;
}

export function FinancialsPanel({ companyId }: { companyId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>("financials");
  const [states, setStates] = useState<Partial<Record<TabKey, TabState>>>({});
  const [pageByTab, setPageByTab] = useState<Partial<Record<TabKey, number>>>({});
  const loadedRef = useRef(new Set<TabKey>());

  const loadTab = useCallback(async (tab: TabKey) => {
    if (loadedRef.current.has(tab)) return;
    loadedRef.current.add(tab);

    setStates((prev) => ({ ...prev, [tab]: { status: "loading" } }));
    const fetchedAt = new Date().toISOString();
    const copy = tabCopy(tab);

    try {
      const response = tab === "financials"
        ? await getCompanyFinancials(companyId, { limit: 24 })
        : tab === "revenue"
          ? await getCompanyRevenue(companyId, { limit: 36 })
          : tab === "balance"
            ? await getCompanyBalanceSheet(companyId, { years: 5 })
            : tab === "cashFlow"
              ? await getCompanyCashFlow(companyId, { years: 5 })
              : tab === "valuation"
                ? await getCompanyValuation(companyId, { days: 365 })
                : tab === "marketValue"
                  ? await getCompanyMarketValue(companyId, { days: 365 })
                  : await getCompanyDividends(companyId, { years: 10 });
      const rawRows = response.data;
      const rows = Array.isArray(rawRows) ? rawRows : rawRows ? [rawRows] : [];
      setStates((prev) => ({
        ...prev,
        [tab]: rows.length > 0
          ? { status: "live", rows, fetchedAt }
          : {
              status: "empty",
              fetchedAt,
              reason: `FinMind 目前沒有回傳 ${copy.label} 資料。`,
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
  const activePage = pageByTab[activeTab] ?? 0;

  return (
    <section className="panel hud-frame company-finmind-panel">
      <h3 className="ascii-head company-finmind-head">
        <span className="ascii-head-bracket">[03]</span> 財報與估值
        <span className="dim">FinMind 財報 / 月營收 / 資產負債 / 現金流 / PER / 市值 / 股利</span>
      </h3>

      <div className="company-data-tabs finmind-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={activeTab === tab.key ? "mini-button" : "outline-button"}
            onClick={() => {
              setActiveTab(tab.key);
              setPageByTab((prev) => ({ ...prev, [tab.key]: 0 }));
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
          <span className="tg soft">更新：{formatTime(currentState.fetchedAt)}</span>
        </div>
      )}
      <Rows
        tab={activeTab}
        state={currentState}
        page={activePage}
        onPage={(next) => setPageByTab((prev) => ({ ...prev, [activeTab]: next }))}
      />
    </section>
  );
}
