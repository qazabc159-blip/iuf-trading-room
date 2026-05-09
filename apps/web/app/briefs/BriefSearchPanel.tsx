"use client";

// BriefSearchPanel — wires to PR #325 /api/v1/briefs/search endpoint.
// Enhanced: keyword highlight + date range filter (from/to date picker).
// Client component so search doesn't require full server roundtrip.
// Fail-soft: shows blocked state if API returns null.

import { useCallback, useState, useRef } from "react";
import Link from "next/link";
import { searchBriefs, type BriefSearchResult } from "@/lib/api";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "live"; results: BriefSearchResult[]; query: string; count: number; fallback: boolean }
  | { status: "empty"; query: string }
  | { status: "blocked"; reason: string };

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
}

function matchedInLabel(value: string) {
  if (value === "heading") return "標題";
  if (value === "body") return "內文";
  return value;
}

/** Highlight all occurrences of `keyword` in `text` (case-insensitive). */
function HighlightText({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword.trim()) return <>{text}</>;
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} style={markStyle}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function BriefSearchPanel() {
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string, from: string, to: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const res = await searchBriefs({
      q: trimmed,
      limit: 10,
      from: from || undefined,
      to: to || undefined,
    });
    if (!res) {
      setState({ status: "blocked", reason: "搜尋端點暫時無法連線。" });
      return;
    }
    if (res.results.length === 0) {
      setState({ status: "empty", query: trimmed });
      return;
    }
    setState({ status: "live", results: res.results, query: trimmed, count: res.count, fallback: res.fallback });
  }, []);

  const triggerSearch = (q: string, from: string, to: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSearch(q, from, to);
    }, 350);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    triggerSearch(value, fromDate, toDate);
  };

  const handleFromChange = (value: string) => {
    setFromDate(value);
    if (query.trim()) triggerSearch(query, value, toDate);
  };

  const handleToChange = (value: string) => {
    setToDate(value);
    if (query.trim()) triggerSearch(query, fromDate, value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void doSearch(query, fromDate, toDate);
  };

  const handleClear = () => {
    setQuery("");
    setFromDate("");
    setToDate("");
    setState({ status: "idle" });
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  const hasFilter = fromDate || toDate;

  return (
    <section className="panel hud-frame" style={{ marginBottom: 16 }}>
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">簡報搜尋</span>
        <span className="tg soft">關鍵字全文搜尋（已發布）</span>
      </h3>

      <form onSubmit={handleSubmit} style={formStyle}>
        <input
          type="search"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="輸入關鍵字 — 例：AI / 輝達 / 科技..."
          style={inputStyle}
          aria-label="簡報關鍵字搜尋"
        />
        <button type="submit" className="btn-sm" disabled={!query.trim() || state.status === "loading"} style={{ minHeight: 38, minWidth: 60 }}>
          {state.status === "loading" ? "搜尋中" : "搜尋"}
        </button>
        {(query || hasFilter) && (
          <button type="button" className="btn-sm" onClick={handleClear} style={{ minHeight: 38, opacity: 0.6 }}>清除</button>
        )}
      </form>

      {/* Date filter row */}
      <div style={dateRowStyle}>
        <label style={dateLabelStyle}>從</label>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => handleFromChange(e.target.value)}
          style={dateInputStyle}
          aria-label="搜尋起始日期"
          max={toDate || undefined}
        />
        <label style={dateLabelStyle}>到</label>
        <input
          type="date"
          value={toDate}
          onChange={(e) => handleToChange(e.target.value)}
          style={dateInputStyle}
          aria-label="搜尋結束日期"
          min={fromDate || undefined}
        />
        {hasFilter && (
          <span style={{ ...dateLabelStyle, color: "var(--gold, #b8960c)", marginLeft: 4 }}>
            篩選中
          </span>
        )}
      </div>

      {state.status === "idle" && (
        <p style={hintStyle}>輸入關鍵字後自動搜尋，或按搜尋鍵。日期篩選為選填。</p>
      )}

      {state.status === "empty" && (
        <p style={hintStyle}>
          <span className="tg gold">無結果</span> 找不到含「{state.query}」的已發布簡報
          {hasFilter ? "（已套用日期篩選）" : "（近 90 日）"}。
        </p>
      )}

      {state.status === "blocked" && (
        <p style={{ ...hintStyle, color: "var(--tw-up-bright, #ff4d5f)" }}>
          {state.reason}
        </p>
      )}

      {state.status === "live" && (
        <div style={resultsStyle}>
          <div style={resultMetaStyle}>
            找到 {state.count} 筆 / 顯示前 {state.results.length} 筆
            {state.fallback && <span style={{ marginLeft: 8, color: "var(--gold, #b8960c)" }}>（ILIKE 模式）</span>}
            {hasFilter && <span style={{ marginLeft: 8, color: "var(--gold, #b8960c)" }}> / 已套用日期篩選</span>}
          </div>
          {state.results.map((result) => (
            <Link
              key={result.id}
              href={`/briefs/${result.id}`}
              style={resultRowStyle}
            >
              <div style={resultHeaderStyle}>
                <span className="tg soft">{formatDate(result.date)}</span>
                <span className={`badge ${result.status === "published" ? "badge-green" : "badge-yellow"}`}>
                  {result.status === "published" ? "已發布" : result.status}
                </span>
                <span style={{ color: "var(--night-dim, #555)", fontSize: 10 }}>
                  命中：{matchedInLabel(result.matchedIn)}
                </span>
              </div>
              {result.sections.slice(0, 1).map((section, i) => (
                <div key={i} style={resultSnippetStyle}>
                  <strong>
                    <HighlightText text={section.heading} keyword={state.query} />
                  </strong>
                  <p style={snippetBodyStyle}>
                    <HighlightText
                      text={section.body.slice(0, 160) + (section.body.length > 160 ? "…" : "")}
                      keyword={state.query}
                    />
                  </p>
                </div>
              ))}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

const formStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  marginBottom: 8,
  flexWrap: "wrap",
};

const inputStyle: React.CSSProperties = {
  flex: "1 1 0",
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 13,
  padding: "9px 12px",
  minHeight: 38,
};

const dateRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 10,
  flexWrap: "wrap",
};

const dateLabelStyle: React.CSSProperties = {
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
};

const dateInputStyle: React.CSSProperties = {
  background: "var(--night-bg, #0a0a08)",
  border: "1px solid var(--night-rule-strong, #333)",
  color: "var(--night-ink, #d8d4c8)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 12,
  padding: "5px 8px",
  height: 32,
  minWidth: 130,
  colorScheme: "dark",
};

const hintStyle: React.CSSProperties = {
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 11,
  margin: 0,
  lineHeight: 1.6,
};

const resultsStyle: React.CSSProperties = {
  display: "grid",
  gap: 0,
  borderTop: "1px solid var(--night-rule, #222)",
  marginTop: 8,
};

const resultMetaStyle: React.CSSProperties = {
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono, monospace)",
  fontSize: 10.5,
  letterSpacing: "0.06em",
  padding: "8px 0",
  borderBottom: "1px solid var(--night-rule, #222)",
};

const resultRowStyle: React.CSSProperties = {
  display: "block",
  padding: "14px 0",
  borderBottom: "1px solid var(--night-rule, #222)",
  textDecoration: "none",
  color: "inherit",
};

const resultHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 8,
  flexWrap: "wrap",
};

const resultSnippetStyle: React.CSSProperties = {
  fontFamily: "var(--sans-tc)",
  fontSize: 12,
  lineHeight: 1.6,
  color: "var(--night-ink, #d8d4c8)",
};

const snippetBodyStyle: React.CSSProperties = {
  margin: "4px 0 0",
  color: "var(--night-mid, #888)",
  fontSize: 11,
  lineHeight: 1.55,
};

const markStyle: React.CSSProperties = {
  background: "rgba(255,184,0,0.28)",
  color: "#ffb800",
  borderRadius: 2,
  padding: "0 2px",
};
