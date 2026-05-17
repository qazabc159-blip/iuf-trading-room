"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  CompanyGraphSearchResult,
  CompanyGraphStats,
  CompanyRelationType
} from "@iuf-trading-room/contracts";

import { getCompanyGraphStats, searchCompanyGraph } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { industryLabel } from "@/lib/industry-i18n";

type GraphState = "LOADING" | "LIVE" | "EMPTY" | "BLOCKED";

const relationLabels: Record<CompanyRelationType, string> = {
  supplier: "供應商",
  customer: "客戶",
  technology: "技術",
  application: "應用",
  co_occurrence: "共同出現",
  unknown: "未分類"
};

const matchLabels: Record<CompanyGraphSearchResult["matchedBy"][number], string> = {
  ticker: "代號",
  name: "公司",
  keyword: "關鍵字",
  relation: "關係"
};

function formatNumber(value: number) {
  return value.toLocaleString("zh-TW");
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function stateLabel(state: GraphState) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "空資料";
  if (state === "LOADING") return "讀取中";
  return "暫停";
}

function stateBadge(state: GraphState) {
  if (state === "LIVE") return "badge-green";
  if (state === "LOADING") return "badge-blue";
  if (state === "EMPTY") return "badge-yellow";
  return "badge-red";
}

function tierLabel(value: CompanyGraphSearchResult["beneficiaryTier"]) {
  if (value === "Core") return "核心";
  if (value === "Direct") return "直接";
  if (value === "Indirect") return "間接";
  return "觀察";
}

function GraphMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="_co-graph-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

export function CompanyGraphTab() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [stats, setStats] = useState<CompanyGraphStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [query, setQuery] = useState(urlQuery);
  const [results, setResults] = useState<CompanyGraphSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStatsLoading(true);
    getCompanyGraphStats()
      .then((response) => {
        if (!active) return;
        setStats(response.data);
        setStatsError(null);
      })
      .catch((caught) => {
        if (!active) return;
        setStatsError(friendlyDataError(caught, "公司圖譜資料暫時無法讀取。"));
      })
      .finally(() => {
        if (active) setStatsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  const setGraphQuery = (value: string) => {
    setQuery(value);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", "graph");
    const normalized = value.trim();
    if (normalized) {
      nextParams.set("q", normalized);
    } else {
      nextParams.delete("q");
    }
    const nextSearch = nextParams.toString();
    router.replace(`${pathname}${nextSearch ? `?${nextSearch}` : ""}`, { scroll: false });
  };

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      searchCompanyGraph({ query: trimmedQuery, limit: 8 })
        .then((response) => {
          if (!active) return;
          setResults(response.data);
          setSearchError(null);
        })
        .catch((caught) => {
          if (!active) return;
          setResults([]);
          setSearchError(friendlyDataError(caught, "公司圖譜搜尋暫時無法讀取。"));
        })
        .finally(() => {
          if (active) setSearchLoading(false);
        });
    }, 260);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const graphState: GraphState = statsLoading
    ? "LOADING"
    : statsError
      ? "BLOCKED"
      : stats && stats.companiesWithGraph > 0
        ? "LIVE"
        : "EMPTY";

  const topKeywords = useMemo(() => (stats?.topKeywords ?? []).slice(0, 14), [stats]);
  const topCompanies = useMemo(() => (stats?.topConnectedCompanies ?? []).slice(0, 8), [stats]);
  const relationTypes = useMemo(() => (stats?.relationTypes ?? []).slice(0, 8), [stats]);

  return (
    <div className="_co-graph-shell">
      <style>{`
        ._co-graph-shell {
          display: grid;
          gap: 14px;
        }
        ._co-graph-source {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          color: var(--night-soft);
          font: 800 11px/1.45 var(--mono);
        }
        ._co-graph-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
          gap: 14px;
        }
        ._co-graph-brief,
        ._co-graph-search,
        ._co-graph-panel {
          border: 1px solid rgba(220,228,240,0.13);
          border-radius: 6px;
          background: rgba(255,255,255,0.025);
        }
        ._co-graph-brief {
          padding: 16px;
          min-height: 238px;
        }
        ._co-graph-eyebrow,
        ._co-graph-section-title {
          color: rgba(226,184,92,0.92);
          font: 900 10px/1.3 var(--mono);
          text-transform: uppercase;
        }
        ._co-graph-title {
          margin: 6px 0 7px;
          color: var(--night-ink);
          font: 900 20px/1.25 var(--mono);
        }
        ._co-graph-copy {
          max-width: 760px;
          margin: 0 0 14px;
          color: var(--night-mid);
          font: 13px/1.75 var(--sans-tc);
          letter-spacing: 0;
        }
        ._co-graph-metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(92px, 1fr));
          gap: 8px;
        }
        ._co-graph-metric {
          min-height: 82px;
          padding: 10px;
          border: 1px solid rgba(220,228,240,0.11);
          border-radius: 6px;
          background: rgba(0,0,0,0.16);
        }
        ._co-graph-metric span,
        ._co-graph-metric small {
          display: block;
          color: var(--night-soft);
          font: 800 9px/1.35 var(--mono);
        }
        ._co-graph-metric strong {
          display: block;
          margin: 7px 0 5px;
          color: var(--gold-bright);
          font: 900 24px/1 var(--mono);
        }
        ._co-graph-panel {
          padding: 14px;
        }
        ._co-graph-chip-list,
        ._co-graph-relation-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        ._co-graph-chip {
          min-height: 30px;
          border: 1px solid rgba(220,228,240,0.13);
          border-radius: 6px;
          background: rgba(0,0,0,0.14);
          color: var(--night-ink);
          padding: 6px 9px;
          font: 800 11px/1.2 var(--mono);
          cursor: pointer;
        }
        ._co-graph-chip:hover,
        ._co-graph-company-link:hover {
          border-color: rgba(226,184,92,0.45);
          color: var(--gold-bright);
        }
        ._co-graph-chip small {
          color: var(--night-soft);
          margin-left: 6px;
          font-size: 10px;
        }
        ._co-graph-rel {
          display: inline-flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          min-width: 124px;
          min-height: 30px;
          padding: 7px 9px;
          border: 1px solid rgba(220,228,240,0.12);
          border-radius: 6px;
          color: var(--night-mid);
          font: 800 11px/1 var(--mono);
        }
        ._co-graph-rel strong {
          color: var(--night-ink);
          font-size: 12px;
        }
        ._co-graph-company-list {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }
        ._co-graph-company-link,
        ._co-graph-result {
          display: grid;
          gap: 5px;
          border: 1px solid rgba(220,228,240,0.12);
          border-radius: 6px;
          background: rgba(0,0,0,0.12);
          color: inherit;
          text-decoration: none;
        }
        ._co-graph-company-link {
          grid-template-columns: 70px minmax(0, 1fr) auto;
          align-items: center;
          padding: 10px;
        }
        ._co-graph-ticker {
          color: var(--gold-bright);
          font: 900 14px/1 var(--mono);
        }
        ._co-graph-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--night-ink);
          font: 800 13px/1.35 var(--sans-tc);
        }
        ._co-graph-count {
          color: var(--night-soft);
          font: 800 10px/1.35 var(--mono);
          text-align: right;
        }
        ._co-graph-search {
          display: grid;
          gap: 12px;
          padding: 14px;
          min-height: 238px;
        }
        ._co-graph-search input {
          width: 100%;
          min-height: 40px;
          border: 1px solid rgba(220,228,240,0.16);
          border-radius: 6px;
          background: rgba(0,0,0,0.22);
          color: var(--night-ink);
          font: 800 14px/1.2 var(--sans-tc);
          padding: 0 12px;
          letter-spacing: 0;
        }
        ._co-graph-results {
          display: grid;
          gap: 8px;
        }
        ._co-graph-result {
          padding: 10px;
        }
        ._co-graph-result-top {
          display: grid;
          grid-template-columns: 64px minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
        }
        ._co-graph-result-meta,
        ._co-graph-match-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
          color: var(--night-soft);
          font: 800 10px/1.35 var(--mono);
        }
        ._co-graph-mini-badge {
          border: 1px solid rgba(220,228,240,0.13);
          border-radius: 6px;
          padding: 3px 6px;
          color: var(--night-mid);
        }
        ._co-graph-empty {
          padding: 14px;
          border: 1px dashed rgba(220,228,240,0.15);
          border-radius: 6px;
          color: var(--night-soft);
          font: 800 11px/1.6 var(--mono);
        }
        @media (max-width: 900px) {
          ._co-graph-hero {
            grid-template-columns: 1fr;
          }
          ._co-graph-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 560px) {
          ._co-graph-company-link,
          ._co-graph-result-top {
            grid-template-columns: 1fr;
          }
          ._co-graph-count {
            text-align: left;
          }
          ._co-graph-metric strong {
            font-size: 20px;
          }
        }
      `}</style>

      <div className="_co-graph-source">
        <span className={`badge ${stateBadge(graphState)}`}>{stateLabel(graphState)}</span>
        <span>My-TW-Coverage 知識圖譜</span>
        <span>更新 {formatTime(stats?.generatedAt)}</span>
        {statsError && <span>{statsError}</span>}
      </div>

      <div className="_co-graph-hero">
        <section className="_co-graph-brief" aria-label="公司圖譜總覽">
          <div className="_co-graph-eyebrow">COMPANY GRAPH</div>
          <h2 className="_co-graph-title">My-TW-Coverage 公司關係圖譜</h2>
          <p className="_co-graph-copy">
            這裡直接讀取現有公司圖譜 API，展示已建立關係資料的台股公司、供應鏈/技術/應用關係與關鍵字覆蓋。
            若後端尚未補齊資料，畫面會明確顯示暫停或空資料，不塞假圖。
          </p>
          <div className="_co-graph-metrics">
            <GraphMetric label="覆蓋公司" value={stats ? formatNumber(stats.companiesWithGraph) : "--"} sub="有圖譜資料" />
            <GraphMetric label="關係數" value={stats ? formatNumber(stats.totalRelations) : "--"} sub="供應鏈/技術" />
            <GraphMetric label="關鍵字" value={stats ? formatNumber(stats.totalKeywords) : "--"} sub="My-TW-Coverage" />
            <GraphMetric label="關係類型" value={stats ? formatNumber(stats.relationTypes.length) : "--"} sub="已分類" />
          </div>
        </section>

        <section className="_co-graph-search" aria-label="公司圖譜搜尋">
          <div>
            <div className="_co-graph-section-title">SEARCH</div>
            <input
              type="search"
              value={query}
              placeholder="搜尋公司、代號、關鍵字或關係..."
              aria-label="搜尋公司圖譜"
              onChange={(event) => setGraphQuery(event.target.value)}
            />
          </div>

          <div className="_co-graph-results" aria-live="polite">
            {trimmedQuery.length < 2 && (
              <div className="_co-graph-empty">輸入至少 2 個字元後搜尋；下方先顯示目前圖譜熱點。</div>
            )}
            {trimmedQuery.length >= 2 && searchLoading && (
              <div className="_co-graph-empty">搜尋中...</div>
            )}
            {searchError && <div className="_co-graph-empty">{searchError}</div>}
            {trimmedQuery.length >= 2 && !searchLoading && !searchError && results.length === 0 && (
              <div className="_co-graph-empty">沒有找到符合的圖譜節點。</div>
            )}
            {!searchLoading && !searchError && results.map((result) => (
              <Link key={result.companyId} href={`/companies/${result.ticker}`} className="_co-graph-result">
                <div className="_co-graph-result-top">
                  <span className="_co-graph-ticker">{result.ticker}</span>
                  <span className="_co-graph-name">{result.name}</span>
                  <span className="_co-graph-count">score {result.score.toFixed(1)}</span>
                </div>
                <div className="_co-graph-result-meta">
                  <span>{industryLabel(result.chainPosition)}</span>
                  <span>{tierLabel(result.beneficiaryTier)}</span>
                  <span>{result.market}</span>
                  <span>關係 {formatNumber(result.relationCount)}</span>
                  <span>關鍵字 {formatNumber(result.keywordCount)}</span>
                </div>
                <div className="_co-graph-match-row">
                  {result.matchedBy.map((item) => (
                    <span key={item} className="_co-graph-mini-badge">{matchLabels[item]}</span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="_co-graph-panel" aria-label="關係類型">
        <div className="_co-graph-section-title">RELATION TYPES</div>
        {relationTypes.length === 0 && !statsLoading ? (
          <div className="_co-graph-empty">目前沒有可顯示的關係分類。</div>
        ) : (
          <div className="_co-graph-relation-list">
            {relationTypes.map((item) => (
              <span key={item.relationType} className="_co-graph-rel">
                {relationLabels[item.relationType]}
                <strong>{formatNumber(item.count)}</strong>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="_co-graph-panel" aria-label="熱門關鍵字">
        <div className="_co-graph-section-title">TOP KEYWORDS</div>
        {topKeywords.length === 0 && !statsLoading ? (
          <div className="_co-graph-empty">目前沒有熱門關鍵字。</div>
        ) : (
          <div className="_co-graph-chip-list">
            {topKeywords.map((item) => (
              <button
                key={item.label}
                type="button"
                className="_co-graph-chip"
                onClick={() => setGraphQuery(item.label)}
              >
                {item.label}
                <small>{formatNumber(item.count)}</small>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="_co-graph-panel" aria-label="高連結公司">
        <div className="_co-graph-section-title">TOP CONNECTED COMPANIES</div>
        {topCompanies.length === 0 && !statsLoading ? (
          <div className="_co-graph-empty">目前沒有高連結公司。</div>
        ) : (
          <div className="_co-graph-company-list">
            {topCompanies.map((company) => (
              <Link key={company.companyId} href={`/companies/${company.ticker}`} className="_co-graph-company-link">
                <span className="_co-graph-ticker">{company.ticker}</span>
                <span className="_co-graph-name">{company.name}</span>
                <span className="_co-graph-count">
                  關係 {formatNumber(company.relationCount)} / 關鍵字 {formatNumber(company.keywordCount)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
