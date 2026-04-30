"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Company, BeneficiaryTier } from "@iuf-trading-room/contracts";
import { getCompanies } from "@/lib/api";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";

const PAGE_SIZE = 50;
type SortField = "ticker" | "name" | "chainPosition" | "beneficiaryTier";
type SortDir = "asc" | "desc";

const tierRank: Record<BeneficiaryTier, number> = { Core: 0, Direct: 1, Indirect: 2, Observation: 3 };
const tierLabel: Record<BeneficiaryTier, string> = { Core: "核心", Direct: "直接", Indirect: "間接", Observation: "觀察" };
const tierBadge: Record<BeneficiaryTier, string> = { Core: "badge-green", Direct: "badge-yellow", Indirect: "badge", Observation: "badge" };

function sortArrowChar(field: SortField, sortField: SortField, sortDir: SortDir) {
  if (sortField !== field) return "";
  return sortDir === "asc" ? " ↑" : " ↓";
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

  useEffect(() => {
    getCompanies()
      .then((r) => setCompanies(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "無法載入公司"))
      .finally(() => setLoading(false));
  }, []);

  const chainPositions = useMemo(
    () => [...new Set(companies.map((c) => c.chainPosition).filter(Boolean))].sort(),
    [companies]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies
      .filter((c) => {
        if (q) {
          const matchTicker = c.ticker.toLowerCase().includes(q);
          const matchName = c.name.toLowerCase().includes(q);
          const matchChain = c.chainPosition.toLowerCase().includes(q);
          if (!matchTicker && !matchName && !matchChain) return false;
        }
        if (filterChain && c.chainPosition !== filterChain) return false;
        if (filterTier && c.beneficiaryTier !== filterTier) return false;
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
  }, [companies, search, filterChain, filterTier, sortField, sortDir]);

  useEffect(() => { setPage(0); }, [search, filterChain, filterTier, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }, [sortField]);

  const twseCount = companies.filter((c) => c.market === "TWSE").length;
  const tpexCount = companies.filter((c) => c.market === "TPEX").length;
  const coreCount = companies.filter((c) => c.beneficiaryTier === "Core").length;

  return (
    <PageFrame
      code="03"
      title="Companies"
      sub="公司板"
      note="[03] COMPANIES · catalog registry · 3470 symbols · sorted by ticker"
    >
      {/* KPI strip */}
      <MetricStrip
        columns={5}
        cells={[
          { label: "TOTAL",     value: loading ? "—" : companies.length.toLocaleString() },
          { label: "TWSE",      value: loading ? "—" : twseCount.toLocaleString() },
          { label: "TPEX",      value: loading ? "—" : tpexCount.toLocaleString() },
          { label: "CORE TIER", value: loading ? "—" : coreCount.toLocaleString(), tone: "gold" },
          { label: "FILTERED",  value: loading ? "—" : filtered.length.toLocaleString() },
        ]}
      />

      <Panel
        code="CO-REG"
        title="COMPANY REGISTRY"
        sub="ticker · name · chainPosition · beneficiaryTier"
        right={loading ? "LOADING…" : `${companies.length} SYMBOLS`}
      >
        {/* Search + filter bar */}
        <div style={{ display: "flex", gap: 8, padding: "10px 0", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="搜尋 ticker / 名稱 / 產業鏈..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: "1 1 220px", minWidth: 180,
              background: "var(--night-bg, #0a0a08)",
              border: "1px solid var(--night-rule-strong, #333)",
              color: "var(--night-ink, #d8d4c8)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              padding: "6px 10px",
              letterSpacing: "0.06em",
            }}
          />
          <select
            value={filterChain}
            onChange={(e) => setFilterChain(e.target.value)}
            style={{
              flex: "0 1 200px",
              background: "var(--night-bg, #0a0a08)",
              border: "1px solid var(--night-rule-strong, #333)",
              color: "var(--night-ink, #d8d4c8)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 8px",
            }}
          >
            <option value="">全部產業鏈</option>
            {chainPositions.map((cp) => (
              <option key={cp} value={cp}>{cp}</option>
            ))}
          </select>
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value)}
            style={{
              flex: "0 1 140px",
              background: "var(--night-bg, #0a0a08)",
              border: "1px solid var(--night-rule-strong, #333)",
              color: "var(--night-ink, #d8d4c8)",
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 8px",
            }}
          >
            <option value="">全部層級</option>
            {(["Core", "Direct", "Indirect", "Observation"] as BeneficiaryTier[]).map((t) => (
              <option key={t} value={t}>{tierLabel[t]}</option>
            ))}
          </select>
          {(search || filterChain || filterTier) && (
            <button
              className="btn-sm"
              onClick={() => { setSearch(""); setFilterChain(""); setFilterTier(""); }}
            >
              清除
            </button>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div style={{ padding: "12px 0", color: "var(--tw-up-bright, #e63946)", fontFamily: "var(--mono)", fontSize: 12 }}>
            [ERR] {error}
          </div>
        )}

        {/* Loading state */}
        {loading && !error && (
          <div style={{ padding: "16px 0", color: "var(--night-mid, #888)", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.1em" }}>
            LOADING · 3470 SYMBOLS…
          </div>
        )}

        {/* Table */}
        {!loading && !error && (
          <>
            <div className="row position-row table-head tg" style={{ gridTemplateColumns: "70px minmax(120px,1fr) minmax(140px,1.4fr) 80px 80px" }}>
              <span
                style={{ cursor: "pointer" }}
                onClick={() => toggleSort("ticker")}
              >
                SYM{sortArrowChar("ticker", sortField, sortDir)}
              </span>
              <span
                style={{ cursor: "pointer" }}
                onClick={() => toggleSort("name")}
              >
                名稱{sortArrowChar("name", sortField, sortDir)}
              </span>
              <span
                style={{ cursor: "pointer" }}
                onClick={() => toggleSort("chainPosition")}
              >
                產業鏈{sortArrowChar("chainPosition", sortField, sortDir)}
              </span>
              <span
                style={{ cursor: "pointer" }}
                onClick={() => toggleSort("beneficiaryTier")}
              >
                層級{sortArrowChar("beneficiaryTier", sortField, sortDir)}
              </span>
              <span>MKT</span>
            </div>

            {pageSlice.length === 0 && (
              <div style={{ padding: "16px 0", color: "var(--night-mid, #888)", fontFamily: "var(--mono)", fontSize: 12 }}>
                — 無符合條件的公司 —
              </div>
            )}

            {pageSlice.map((company) => (
              <Link
                key={company.id}
                href={`/companies/${company.ticker}`}
                className="row position-row"
                style={{ gridTemplateColumns: "70px minmax(120px,1fr) minmax(140px,1.4fr) 80px 80px" }}
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

            {/* Pagination */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--night-rule, #222)" }}>
              <span className="tg muted" style={{ fontSize: 11 }}>
                {filtered.length === 0 ? "0 筆" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} / ${filtered.length} 筆`}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn-sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ← 上頁
                </button>
                <span className="tg muted" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                  {page + 1} / {totalPages}
                </span>
                <button
                  className="btn-sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下頁 →
                </button>
              </div>
            </div>
          </>
        )}
      </Panel>
    </PageFrame>
  );
}
