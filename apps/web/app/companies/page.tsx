"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { BeneficiaryTier, Company } from "@iuf-trading-room/contracts";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getCompaniesLite, type CompanyRegistryRow } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { industryLabel } from "@/lib/industry-i18n";
import { ThemesRadarTab } from "./ThemesRadarTab";
import { SectorTab } from "./SectorTab";
import { CompanyGraphTab } from "./CompanyGraphTab";

const PAGE_SIZE = 50;
type SortField = "ticker" | "name" | "chainPosition" | "beneficiaryTier";
type SortDir = "asc" | "desc";
type RegistryState = "LOADING" | "LIVE" | "EMPTY" | "BLOCKED";

const tierRank: Record<BeneficiaryTier, number> = { Core: 0, Direct: 1, Indirect: 2, Observation: 3 };
const tierLabel: Record<BeneficiaryTier, string> = {
  Core: "核心",
  Direct: "直接",
  Indirect: "間接",
  Observation: "觀察",
};
const tierBadge: Record<BeneficiaryTier, string> = {
  Core: "badge-green",
  Direct: "badge-yellow",
  Indirect: "badge",
  Observation: "badge",
};

function formatTime(value: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function sortArrowChar(field: SortField, sortField: SortField, sortDir: SortDir) {
  if (sortField !== field) return "";
  return sortDir === "asc" ? " ↑" : " ↓";
}

function friendlyError(error: unknown): string {
  return friendlyDataError(error, "公司資料暫時無法讀取。");
}

function registryLabel(state: RegistryState) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  if (state === "LOADING") return "載入中";
  return "暫停";
}

function registryTone(state: RegistryState) {
  if (state === "LIVE") return "status-ok";
  if (state === "BLOCKED") return "status-bad";
  return "gold";
}

function registryBadge(state: RegistryState) {
  if (state === "LIVE") return "badge-green";
  if (state === "EMPTY") return "badge-yellow";
  if (state === "LOADING") return "badge-blue";
  return "badge-red";
}

function marketLabel(value: string) {
  if (value === "TWSE") return "上市";
  if (value === "TPEX" || value === "TPEx" || value === "OTC") return "上櫃";
  return value;
}

type CompanyTab = "companies" | "themes" | "sectors" | "graph";

const TAB_LABELS: Record<CompanyTab, string> = {
  companies: "公司搜尋",
  themes: "主題雷達",
  sectors: "產業鏈",
  graph: "公司圖譜",
};

export default function CompaniesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get("tab");
  const activeTab: CompanyTab =
    rawTab === "themes" || rawTab === "sectors" || rawTab === "graph"
      ? rawTab
      : "companies";

  const setTab = (tab: CompanyTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "companies") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    router.push(`/companies?${params.toString()}`);
  };

  const [companies, setCompanies] = useState<CompanyRegistryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterChain, setFilterChain] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [sortField, setSortField] = useState<SortField>("ticker");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [rawTotal, setRawTotal] = useState(0);

  useEffect(() => {
    getCompaniesLite({ limit: 2500 })
      .then((response) => {
        setFetchedAt(new Date().toISOString());
        const raw = response.data;
        setRawTotal(raw.length);
        const unique = Array.from(new Map(raw.map((company) => [company.ticker, company])).values());
        setCompanies(unique);
      })
      .catch((caught) => {
        setFetchedAt(new Date().toISOString());
        setError(friendlyError(caught));
      })
      .finally(() => setLoading(false));
  }, []);

  const chainPositions = useMemo(
    () => [...new Set(companies.map((company) => company.chainPosition).filter(Boolean))].sort(),
    [companies]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies
      .filter((company) => {
        if (q) {
          const matchTicker = company.ticker.toLowerCase().includes(q);
          const matchName = company.name.toLowerCase().includes(q);
          const matchChain = company.chainPosition.toLowerCase().includes(q);
          const matchChainLabel = industryLabel(company.chainPosition).toLowerCase().includes(q);
          if (!matchTicker && !matchName && !matchChain && !matchChainLabel) return false;
        }
        if (filterChain && company.chainPosition !== filterChain) return false;
        if (filterTier && company.beneficiaryTier !== filterTier) return false;
        return true;
      })
      .sort((a, b) => {
        let cmp: number;
        if (sortField === "beneficiaryTier") {
          cmp = tierRank[a.beneficiaryTier] - tierRank[b.beneficiaryTier];
        } else if (sortField === "chainPosition") {
          cmp = industryLabel(a.chainPosition).localeCompare(industryLabel(b.chainPosition), "zh-TW");
        } else {
          cmp = (a[sortField] ?? "").localeCompare(b[sortField] ?? "");
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [companies, filterChain, filterTier, search, sortDir, sortField]);

  useEffect(() => { setPage(0); }, [search, filterChain, filterTier, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortDir((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortField(field);
      setSortDir("asc");
    }
  }, [sortField]);

  const twseCount = companies.filter((company) => company.market === "TWSE").length;
  const tpexCount = companies.filter((company) => company.market === "TPEX" || company.market === "TPEx").length;
  const coreCount = companies.filter((company) => company.beneficiaryTier === "Core").length;
  const state: RegistryState = loading ? "LOADING" : error ? "BLOCKED" : companies.length === 0 ? "EMPTY" : "LIVE";
  const metric = (value: number) => loading ? "--" : error ? "--" : value.toLocaleString("zh-TW");
  const duplicateRows = Math.max(0, rawTotal - companies.length);

  return (
    <PageFrame
      code="03"
      title="公司板"
      sub="台股公司池 / 主題 / 產業鏈"
      note="公司板 / 正式公司主檔；前端先以代號去重，正式資料庫去重仍維持審核閘門"
    >
      <style>{`
        ._co-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 0 16px 16px;
        }
        ._co-tab-btn {
          min-height: 34px;
          border-radius: 6px;
          padding: 0 13px;
          font: 800 11px/1 var(--mono);
          cursor: pointer;
          transition: border-color 0.12s ease, background 0.12s ease;
        }
        ._co-tab-btn[data-active="true"] {
          border: 1px solid rgba(200,148,63,0.55);
          background: rgba(200,148,63,0.13);
          color: #e2b85c;
        }
        ._co-tab-btn[data-active="false"] {
          border: 1px solid rgba(220,228,240,0.12);
          background: rgba(255,255,255,0.03);
          color: var(--night-mid);
        }
        ._co-tab-btn[data-active="false"]:hover {
          border-color: rgba(200,148,63,0.35);
          color: var(--night-ink);
        }
        ._co-v2-stub {
          padding: 48px 24px;
          text-align: center;
          color: var(--night-mid);
          font-size: 14px;
        }
        ._co-v2-badge {
          display: inline-block;
          border: 1px solid rgba(220,228,240,0.16);
          border-radius: 999px;
          padding: 4px 12px;
          font-family: var(--mono);
          font-size: 11px;
          margin-top: 10px;
          color: var(--night-soft);
        }
      `}</style>

      {/* Tab bar */}
      <div className="_co-tabs" role="tablist" aria-label="公司板子頁">
        {(["companies", "themes", "sectors", "graph"] as CompanyTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            data-active={activeTab === tab ? "true" : "false"}
            className="_co-tab-btn"
            onClick={() => setTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* KPI bar — always visible */}
      <div className="parity-kpi-bar">
          <div className="parity-kpi-cell">
            <span className="parity-kpi-label">狀態</span>
            <span className={`parity-kpi-value ${state === "LIVE" ? "ok" : state === "LOADING" ? "warn" : state === "BLOCKED" ? "bad" : "dim"}`}>{registryLabel(state)}</span>
            <span className="parity-kpi-sub">公司資料庫</span>
          </div>
          <div className="parity-kpi-cell">
            <span className="parity-kpi-label">總公司數</span>
            <span className="parity-kpi-value">{rawTotal}</span>
            <span className="parity-kpi-sub">台股公司池</span>
          </div>
          <div className="parity-kpi-cell">
            <span className="parity-kpi-label">篩選結果</span>
            <span className="parity-kpi-value ok">{activeTab === "companies" ? filtered.length : companies.length}</span>
            <span className="parity-kpi-sub">符合條件</span>
          </div>
          <div className="parity-kpi-cell">
            <span className="parity-kpi-label">頁次</span>
            <span className="parity-kpi-value">{activeTab === "companies" ? totalPages : "-"}</span>
            <span className="parity-kpi-sub">共 {activeTab === "companies" ? totalPages : "-"} 頁</span>
          </div>
          <div className="parity-kpi-cell">
            <span className="parity-kpi-label">更新</span>
            <span className="parity-kpi-value" style={{ fontSize: 12 }}>{formatTime(fetchedAt)}</span>
            <span className="parity-kpi-sub">資料時間</span>
          </div>
        </div>

      {/* Tab 1: 公司搜尋 */}
      {activeTab === "companies" && (
        <Panel
          code="CO-REG"
          title="公司主檔"
          sub="代號 / 公司名 / 產業鏈位置 / 受惠層級"
          right={state === "LIVE" ? `${companies.length.toLocaleString("zh-TW")} 檔` : registryLabel(state)}
        >
          <div className="source-line">
            <span className={`badge ${registryBadge(state)}`}>{registryLabel(state)}</span>
            <span className="tg soft">來源：公司主檔</span>
            <span className="tg soft">更新 {formatTime(fetchedAt)}</span>
            {error && <span className="tg soft">處理：公司資料管線。細節：{error}</span>}
          </div>

          <div className="company-filter-row">
            <input
              type="text"
              placeholder="搜尋代號、公司名、產業鏈..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={inputStyle}
            />
            <select value={filterChain} onChange={(event) => setFilterChain(event.target.value)} style={selectStyle}>
              <option value="">全部產業鏈</option>
              {chainPositions.map((chainPosition) => (
                <option key={chainPosition} value={chainPosition}>{industryLabel(chainPosition)}</option>
              ))}
            </select>
            <select value={filterTier} onChange={(event) => setFilterTier(event.target.value)} style={{ ...selectStyle, flex: "0 1 140px" }}>
              <option value="">全部層級</option>
              {(["Core", "Direct", "Indirect", "Observation"] as BeneficiaryTier[]).map((tier) => (
                <option key={tier} value={tier}>{tierLabel[tier]}</option>
              ))}
            </select>
            {(search || filterChain || filterTier) && (
              <button
                className="btn-sm"
                onClick={() => { setSearch(""); setFilterChain(""); setFilterTier(""); }}
                type="button"
              >
                清除
              </button>
            )}
          </div>

          {!loading && !error && duplicateRows > 0 && (
            <div className="terminal-note" style={{ marginBottom: 12 }}>
              去重提示：公司主檔目前讀到 {rawTotal.toLocaleString("zh-TW")} 列，前端先以代號顯示 {companies.length.toLocaleString("zh-TW")} 檔。
              已隱藏 {duplicateRows.toLocaleString("zh-TW")} 列重複主檔；正式資料庫去重仍待資料庫稽核與備份閘門。
            </div>
          )}

          {error && (
            <div className="terminal-note">
              暫停：公司主檔暫時無法讀取。{error}
            </div>
          )}

          {loading && !error && (
            <div className="terminal-note">讀取中：正在讀取公司主檔。</div>
          )}

          {!loading && !error && companies.length === 0 && (
            <div className="terminal-note">
              無資料：公司主檔目前回傳 0 筆。
            </div>
          )}

          {!loading && !error && (
            <>
              <div className="row position-row table-head tg" style={tableGridStyle}>
                <button type="button" className="table-sort-button" onClick={() => toggleSort("ticker")}>代號{sortArrowChar("ticker", sortField, sortDir)}</button>
                <button type="button" className="table-sort-button" onClick={() => toggleSort("name")}>公司{sortArrowChar("name", sortField, sortDir)}</button>
                <button type="button" className="table-sort-button" onClick={() => toggleSort("chainPosition")}>產業鏈{sortArrowChar("chainPosition", sortField, sortDir)}</button>
                <button type="button" className="table-sort-button" onClick={() => toggleSort("beneficiaryTier")}>層級{sortArrowChar("beneficiaryTier", sortField, sortDir)}</button>
                <span>市場</span>
              </div>

              {pageSlice.length === 0 && (
                <div className="terminal-note">沒有符合目前篩選條件的公司。</div>
              )}

              {pageSlice.map((company) => (
                <Link
                  key={company.id}
                  href={`/companies/${company.ticker}`}
                  className="row position-row"
                  style={tableGridStyle}
                  title={company.notes ? company.notes.slice(0, 120) : undefined}
                >
                  <span className="tg gold" style={{ fontWeight: 700, fontFamily: "var(--mono)" }}>{company.ticker}</span>
                  <span className="tc">{company.name}</span>
                  <span className="tg muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {industryLabel(company.chainPosition)}
                  </span>
                  <span>
                    <span className={tierBadge[company.beneficiaryTier]} style={{ fontSize: 10, padding: "3px 8px" }}>
                      {tierLabel[company.beneficiaryTier]}
                    </span>
                  </span>
                  <span className="tg muted" style={{ fontSize: 11 }}>{marketLabel(company.market)}</span>
                </Link>
              ))}

              <div className="company-pagination">
                <span className="tg muted" style={{ fontSize: 11 }}>
                  {filtered.length === 0 ? "0 筆" : `${page * PAGE_SIZE + 1} 至 ${Math.min((page + 1) * PAGE_SIZE, filtered.length)} / ${filtered.length} 筆`}
                </span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="btn-sm" disabled={page === 0} onClick={() => setPage((current) => current - 1)} type="button">
                    上一頁
                  </button>
                  <span className="tg muted" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                    {page + 1} / {totalPages}
                  </span>
                  <button className="btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage((current) => current + 1)} type="button">
                    下一頁
                  </button>
                </div>
              </div>
            </>
          )}
        </Panel>
      )}

      {/* Tab 2: 主題雷達 */}
      {activeTab === "themes" && (
        <Panel code="CO-THEMES" title="主題雷達" sub="熱門主題 token cluster — 點選跳轉主題詳頁">
          <ThemesRadarTab />
        </Panel>
      )}

      {/* Tab 3: 產業鏈 */}
      {activeTab === "sectors" && (
        <Panel
          code="CO-SECTOR"
          title="產業鏈"
          sub="依產業鏈分類瀏覽公司"
          right={state === "LIVE" ? `${companies.length.toLocaleString("zh-TW")} 檔` : registryLabel(state)}
        >
          <SectorTab companies={companies as unknown as Company[]} loading={loading} />
        </Panel>
      )}

      {/* Tab 4: 公司圖譜 */}
      {activeTab === "graph" && (
        <Panel code="CO-GRAPH" title="公司圖譜" sub="My-TW-Coverage 關係資料 / 搜尋 / 熱點">
          <CompanyGraphTab />
        </Panel>
      )}
    </PageFrame>
  );
}

const tableGridStyle = {
  gridTemplateColumns: "78px minmax(130px,1fr) minmax(150px,1.35fr) 84px 80px",
} satisfies CSSProperties;

const inputStyle = {
  flex: "1 1 260px",
  minWidth: 210,
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--sans-tc)",
  fontSize: 14,
  padding: "10px 12px",
  letterSpacing: 0,
} satisfies CSSProperties;

const selectStyle = {
  flex: "0 1 220px",
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--sans-tc)",
  fontSize: 13,
  padding: "10px 12px",
} satisfies CSSProperties;
