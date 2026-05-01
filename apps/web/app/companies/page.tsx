"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BeneficiaryTier, Company } from "@iuf-trading-room/contracts";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getCompanies } from "@/lib/api";

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
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|fetch failed|ECONNREFUSED|network/i.test(message)) {
    return "前端暫時無法連到後端 API。";
  }
  if (/401|unauthorized|unauthenticated/i.test(message)) {
    return "登入狀態已失效，請重新登入。";
  }
  if (/404|not found/i.test(message)) {
    return "後端端點尚未提供。";
  }
  return message || "公司資料讀取失敗。";
}

function registryLabel(state: RegistryState) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  if (state === "LOADING") return "讀取中";
  return "暫停";
}

function registryTone(state: RegistryState) {
  if (state === "LIVE") return "up";
  if (state === "BLOCKED") return "down";
  return "gold";
}

function registryBadge(state: RegistryState) {
  if (state === "LIVE") return "badge-green";
  if (state === "EMPTY") return "badge-yellow";
  if (state === "LOADING") return "badge-blue";
  return "badge-red";
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
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
    getCompanies()
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
          if (!matchTicker && !matchName && !matchChain) return false;
        }
        if (filterChain && company.chainPosition !== filterChain) return false;
        if (filterTier && company.beneficiaryTier !== filterTier) return false;
        return true;
      })
      .sort((a, b) => {
        let cmp: number;
        if (sortField === "beneficiaryTier") {
          cmp = tierRank[a.beneficiaryTier] - tierRank[b.beneficiaryTier];
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

  return (
    <PageFrame
      code="03"
      title="公司板"
      sub="台股公司池"
      note="公司板 / 正式公司主檔 / 可搜尋、篩選、排序；重複資料合併仍等 migration audit。"
    >
      <MetricStrip
        columns={6}
        cells={[
          { label: "狀態", value: registryLabel(state), tone: registryTone(state) },
          { label: "總數", value: metric(companies.length) },
          { label: "上市", value: metric(twseCount) },
          { label: "上櫃", value: metric(tpexCount) },
          { label: "核心", value: metric(coreCount), tone: !error && coreCount > 0 ? "gold" : "muted" },
          { label: "篩選", value: metric(filtered.length) },
        ]}
      />

      <Panel
        code="CO-REG"
        title="公司主檔"
        sub="代號 / 名稱 / 產業鏈位置 / 受惠層級"
        right={state === "LIVE" ? `${companies.length.toLocaleString("zh-TW")} 檔` : registryLabel(state)}
      >
        <div className="source-line">
          <span className={`badge ${registryBadge(state)}`}>{registryLabel(state)}</span>
          <span className="tg soft">來源：公司主檔 API</span>
          <span className="tg soft">更新 {formatTime(fetchedAt)}</span>
          {error && <span className="tg soft">負責：Jason / Elva。細節：{error}</span>}
        </div>

        <div style={{ display: "flex", gap: 8, padding: "10px 0", flexWrap: "wrap", alignItems: "center" }}>
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
              <option key={chainPosition} value={chainPosition}>{chainPosition}</option>
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

        {!loading && !error && rawTotal !== companies.length && (
          <div className="terminal-note" style={{ marginBottom: 8 }}>
            公司池：目前顯示 {companies.length.toLocaleString("zh-TW")} 檔台股公司；重複主檔已在前端隱藏，正式資料庫去重仍待 Mike/Jason migration gate。
          </div>
        )}

        {error && (
          <div className="terminal-note">
            暫停：公司主檔讀取失敗。{error}
          </div>
        )}

        {loading && !error && (
          <div className="terminal-note">讀取中：正在讀取公司主檔。</div>
        )}

        {!loading && !error && companies.length === 0 && (
          <div className="terminal-note">
            無資料：公司主檔 API 回傳 0 筆，不顯示假公司列表。
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
              <div className="terminal-note">沒有符合篩選條件的公司。</div>
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
                  {company.chainPosition}
                </span>
                <span>
                  <span className={tierBadge[company.beneficiaryTier]} style={{ fontSize: 10, padding: "2px 6px" }}>
                    {tierLabel[company.beneficiaryTier]}
                  </span>
                </span>
                <span className="tg muted" style={{ fontSize: 11 }}>{company.market}</span>
              </Link>
            ))}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--night-rule, #222)" }}>
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
    </PageFrame>
  );
}

const tableGridStyle = {
  gridTemplateColumns: "70px minmax(120px,1fr) minmax(140px,1.4fr) 80px 80px",
} satisfies React.CSSProperties;

const inputStyle = {
  flex: "1 1 220px",
  minWidth: 180,
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono)",
  fontSize: 12,
  padding: "6px 10px",
  letterSpacing: "0.06em",
} satisfies React.CSSProperties;

const selectStyle = {
  flex: "0 1 200px",
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono)",
  fontSize: 11,
  padding: "6px 8px",
} satisfies React.CSSProperties;
