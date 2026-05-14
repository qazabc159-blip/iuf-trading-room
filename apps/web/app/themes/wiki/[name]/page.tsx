"use client";

/**
 * /themes/wiki/[name] — Wikilink Graph Theme Page
 *
 * Consumes GET /api/v1/themes/:token/companies (PR #479)
 * Displays reverse wikilink: all companies that mention this token,
 * grouped by sector, with relation chips + search filter.
 *
 * URL examples:
 *   /themes/wiki/CoWoS
 *   /themes/wiki/HBM
 *   /themes/wiki/%E5%85%89%E9%98%BB%E6%B6%B2  (光阻液)
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

type Relation = "upstream" | "downstream" | "customer" | "supplier" | "related";

interface WikiMatch {
  ticker: string;
  companyName: string;
  sector: string;
  relation: Relation;
}

interface ThemeWikiResponse {
  token: string;
  count: number;
  matches: WikiMatch[];
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: ThemeWikiResponse };

// ── Relation chip config (canonical colour tint pattern, PR #484) ──────────────

const RELATION_CONFIG: Record<Relation, { label: string; border: string; bg: string; labelColor: string }> = {
  upstream:   { label: "上游",   border: "rgba(32,178,170,0.5)",  bg: "rgba(32,178,170,0.12)",  labelColor: "#20b2aa" },
  downstream: { label: "下游",   border: "rgba(147,51,234,0.5)",  bg: "rgba(147,51,234,0.12)",  labelColor: "#a855f7" },
  customer:   { label: "客戶",   border: "rgba(59,130,246,0.5)",  bg: "rgba(59,130,246,0.12)",  labelColor: "#60a5fa" },
  supplier:   { label: "供應商", border: "rgba(249,115,22,0.5)",  bg: "rgba(249,115,22,0.12)",  labelColor: "#fb923c" },
  related:    { label: "相關",   border: "rgba(148,163,184,0.35)", bg: "rgba(148,163,184,0.08)", labelColor: "#94a3b8" },
};

function RelationChip({ relation }: { relation: Relation }) {
  const cfg = RELATION_CONFIG[relation] ?? RELATION_CONFIG.related;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        fontWeight: 700,
        padding: "1px 7px",
        border: `1px solid ${cfg.border}`,
        borderRadius: 2,
        background: cfg.bg,
        color: cfg.labelColor,
        letterSpacing: "0.04em",
        fontFamily: "var(--mono, monospace)",
        flexShrink: 0,
      }}
    >
      {cfg.label}
    </span>
  );
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchWikiCompanies(token: string): Promise<ThemeWikiResponse | null> {
  try {
    const res = await fetch(`/api/v1/themes/${encodeURIComponent(token)}/companies`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (res.status === 404) return null;
    if (res.status === 403) throw new Error("權限不足 (Owner only)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as unknown;
    // Response shape: { token, count, matches }
    if (json && typeof json === "object" && "matches" in (json as object)) {
      return json as ThemeWikiResponse;
    }
    return null;
  } catch (e) {
    throw e;
  }
}

// ── Helper: group by sector ───────────────────────────────────────────────────

function groupBySector(matches: WikiMatch[]): Map<string, WikiMatch[]> {
  const map = new Map<string, WikiMatch[]>();
  for (const m of matches) {
    const sector = m.sector || "其他";
    if (!map.has(sector)) map.set(sector, []);
    map.get(sector)!.push(m);
  }
  return map;
}

// ── SectorGroup accordion ─────────────────────────────────────────────────────

function SectorGroup({ sector, members, query }: { sector: string; members: WikiMatch[]; query: string }) {
  const [open, setOpen] = useState(members.length <= 10);

  const filtered = useMemo(() => {
    if (!query.trim()) return members;
    const q = query.toLowerCase();
    return members.filter(
      (m) =>
        m.ticker.toLowerCase().includes(q) ||
        m.companyName.toLowerCase().includes(q)
    );
  }, [members, query]);

  if (filtered.length === 0) return null;

  return (
    <div
      style={{
        border: "1px solid rgba(220,228,240,0.09)",
        borderRadius: 4,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      {/* Sector header */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 14px",
          background: "rgba(255,255,255,0.025)",
          border: "none",
          borderBottom: open ? "1px solid rgba(220,228,240,0.07)" : "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "var(--accent, #c8943f)",
            fontFamily: "var(--mono, monospace)",
            minWidth: 10,
          }}
        >
          {open ? "▼" : "▶"}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-1, #ddd)", flex: 1 }}>
          {sector}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--fg-3, #888)",
            fontFamily: "var(--mono, monospace)",
          }}
        >
          {filtered.length} 家
        </span>
      </button>

      {/* Member list */}
      {open && (
        <div style={{ padding: "8px 14px 12px" }}>
          {filtered.map((m) => (
            <div
              key={m.ticker}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 0",
                borderBottom: "1px solid rgba(220,228,240,0.05)",
              }}
            >
              <Link
                href={`/companies/${m.ticker}`}
                style={{
                  fontFamily: "var(--mono, monospace)",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--accent, #c8943f)",
                  textDecoration: "none",
                  minWidth: 48,
                  flexShrink: 0,
                }}
              >
                {m.ticker}
              </Link>
              <span style={{ fontSize: 12, color: "var(--fg-1, #ddd)", flex: 1 }}>
                {m.companyName}
              </span>
              <RelationChip relation={m.relation} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ThemeWikiPage() {
  const params = useParams();
  const rawName = typeof params?.name === "string" ? params.name : Array.isArray(params?.name) ? params.name[0] : "";
  // Decode URL-encoded token (Next.js may or may not pre-decode)
  const token = useMemo(() => {
    try {
      return decodeURIComponent(rawName);
    } catch {
      return rawName;
    }
  }, [rawName]);

  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [query, setQuery] = useState("");

  const doFetch = useCallback(async () => {
    if (!token) return;
    setLoadState({ status: "loading" });
    try {
      const data = await fetchWikiCompanies(token);
      if (data === null) {
        setLoadState({ status: "not_found" });
      } else if (data.matches.length === 0) {
        setLoadState({ status: "not_found" });
      } else {
        setLoadState({ status: "loaded", data });
      }
    } catch (e) {
      setLoadState({ status: "error", message: e instanceof Error ? e.message : "載入失敗" });
    }
  }, [token]);

  useEffect(() => {
    void doFetch();
  }, [doFetch]);

  const sectorGroups = useMemo(() => {
    if (loadState.status !== "loaded") return null;
    return groupBySector(loadState.data.matches);
  }, [loadState]);

  // Filter sectors based on query
  const filteredSectors = useMemo(() => {
    if (!sectorGroups) return null;
    if (!query.trim()) return sectorGroups;
    const filtered = new Map<string, WikiMatch[]>();
    for (const [sector, members] of sectorGroups.entries()) {
      const q = query.toLowerCase();
      const hits = members.filter(
        (m) =>
          m.ticker.toLowerCase().includes(q) ||
          m.companyName.toLowerCase().includes(q)
      );
      if (hits.length > 0) filtered.set(sector, hits);
    }
    return filtered;
  }, [sectorGroups, query]);

  const totalVisible = useMemo(() => {
    if (!filteredSectors) return 0;
    let n = 0;
    for (const members of filteredSectors.values()) n += members.length;
    return n;
  }, [filteredSectors]);

  return (
    <>
      <style>{WIKI_CSS}</style>

      <div className="_wk-page">
        {/* Back breadcrumb */}
        <div style={{ marginBottom: 14 }}>
          <Link href="/themes" className="_wk-back">
            ← 主題板
          </Link>
        </div>

        {/* Hero */}
        <div className="_wk-hero">
          <div className="_wk-hero-label">主題雷達 / 反向 Wikilink 圖譜</div>
          <h1 className="_wk-hero-title">{token || "—"}</h1>
          {loadState.status === "loaded" && (
            <div className="_wk-hero-meta">
              {loadState.data.count} 家公司參與此主題
            </div>
          )}
        </div>

        {/* Status states */}
        {loadState.status === "loading" && (
          <div className="_wk-state-box">
            <span className="_wk-spin" /> 資料載入中...
          </div>
        )}

        {loadState.status === "error" && (
          <div className="_wk-state-box _wk-state-error">
            <span style={{ color: "var(--status-bad, #f87171)" }}>錯誤</span>{" "}
            {loadState.message}
          </div>
        )}

        {loadState.status === "not_found" && (
          <div className="_wk-state-box">
            <span style={{ color: "var(--gold, #c8943f)", fontWeight: 700 }}>無資料</span>{" "}
            此主題尚無收錄資料。{" "}
            <Link href="/themes" style={{ color: "var(--accent, #c8943f)", textDecoration: "underline dotted" }}>
              返回主題板
            </Link>
          </div>
        )}

        {/* Search bar + member list */}
        {loadState.status === "loaded" && filteredSectors && (
          <>
            {/* Search filter */}
            <div className="_wk-search-bar">
              <input
                className="_wk-search-input"
                type="text"
                placeholder="篩選 ticker / 公司名稱..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              {query && (
                <button
                  className="_wk-search-clear"
                  onClick={() => setQuery("")}
                  aria-label="清除搜尋"
                >
                  ✕
                </button>
              )}
              <span className="_wk-search-count">
                {query ? `${totalVisible} / ${loadState.data.count}` : `${loadState.data.count} 家`}
              </span>
            </div>

            {/* Sector accordion list */}
            <div style={{ marginTop: 12 }}>
              {filteredSectors.size === 0 ? (
                <div className="_wk-state-box">
                  <span style={{ color: "var(--fg-3, #888)" }}>無符合的公司</span>
                </div>
              ) : (
                Array.from(filteredSectors.entries())
                  .sort(([, a], [, b]) => b.length - a.length)
                  .map(([sector, members]) => (
                    <SectorGroup
                      key={sector}
                      sector={sector}
                      members={members}
                      query={query}
                    />
                  ))
              )}
            </div>
          </>
        )}

        {/* License footer */}
        <div className="_wk-footer">
          資料來源: My-TW-Coverage (MIT) / Wikilink 反向圖譜
        </div>
      </div>
    </>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const WIKI_CSS = `
  ._wk-page {
    max-width: 820px;
    margin: 0 auto;
    padding: clamp(16px, 3vw, 32px) clamp(14px, 2vw, 24px);
  }
  ._wk-back {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-family: var(--mono, monospace);
    color: var(--fg-3, #888);
    text-decoration: none;
    padding: 4px 10px;
    border: 1px solid rgba(220,228,240,0.1);
    border-radius: 2px;
    background: rgba(255,255,255,0.02);
    transition: color 0.15s, border-color 0.15s;
  }
  ._wk-back:hover {
    color: var(--accent, #c8943f);
    border-color: rgba(200,148,63,0.35);
  }
  ._wk-hero {
    margin-bottom: 22px;
  }
  ._wk-hero-label {
    font-size: 10px;
    font-family: var(--mono, monospace);
    color: var(--fg-3, #888);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  ._wk-hero-title {
    font-size: clamp(22px, 4vw, 30px);
    font-weight: 700;
    color: var(--fg-1, #e0e0e0);
    margin: 0 0 6px;
    font-family: var(--mono, monospace);
    letter-spacing: 0.02em;
  }
  ._wk-hero-meta {
    font-size: 13px;
    color: var(--fg-3, #888);
  }
  ._wk-state-box {
    padding: 18px 16px;
    border: 1px solid rgba(220,228,240,0.08);
    border-radius: 4px;
    background: rgba(255,255,255,0.02);
    font-size: 13px;
    color: var(--fg-2, #bbb);
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }
  ._wk-state-error {
    border-color: rgba(248,113,113,0.2);
    background: rgba(248,113,113,0.04);
  }
  ._wk-search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(220,228,240,0.12);
    border-radius: 4px;
    padding: 6px 12px;
  }
  ._wk-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 13px;
    color: var(--fg-1, #ddd);
    font-family: var(--mono, monospace);
    min-width: 0;
  }
  ._wk-search-input::placeholder {
    color: var(--fg-3, #666);
  }
  ._wk-search-clear {
    background: transparent;
    border: none;
    color: var(--fg-3, #888);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
  }
  ._wk-search-clear:hover { color: var(--fg-1, #ddd); }
  ._wk-search-count {
    font-size: 11px;
    font-family: var(--mono, monospace);
    color: var(--fg-3, #888);
    white-space: nowrap;
  }
  ._wk-footer {
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid rgba(220,228,240,0.06);
    font-size: 10px;
    color: var(--fg-3, #555);
  }
  ._wk-spin {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(200,148,63,0.3);
    border-top-color: var(--accent, #c8943f);
    border-radius: 50%;
    animation: _wk-spin-anim 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes _wk-spin-anim {
    to { transform: rotate(360deg); }
  }
  @media (max-width: 600px) {
    ._wk-hero-title { font-size: 20px; }
  }
  @media (prefers-reduced-motion: reduce) {
    ._wk-spin { animation: none; }
    ._wk-back { transition: none; }
  }
`;
