"use client";

/**
 * CoverageSection.tsx — 深度研究 section (My-TW-Coverage integration)
 *
 * Default: collapsed accordion. Click header to expand.
 * Fetches /api/v1/companies/:ticker/coverage (Jason's endpoint, PR feat/api-coverage-endpoints-2026-05-15).
 * Graceful 404: shows "尚無深度研究資料" without hiding the section.
 * Wikilink radar: on click fetches /api/v1/themes/:token/companies for peer list.
 *
 * License compliance: displays "資料來源: My-TW-Coverage (MIT)" footer.
 */

import React, { useState, useCallback } from "react";
import Link from "next/link";

// ── Types aligned with tw-coverage-loader.ts exports ─────────────────────────

interface SupplyChainGroup {
  category: string;
  companies: string[];
}

interface CoverageBrief {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: string;
  enterpriseValue: string;
  businessOverview: string;
  supplyChain: {
    upstream: SupplyChainGroup[];
    midstream: SupplyChainGroup[];
    downstream: SupplyChainGroup[];
  };
  majorCustomers: string[];
  majorSuppliers: string[];
  wikilinks?: string[];
}

interface ThemePeerCompany {
  ticker: string;
  companyName: string;
}

// ── Fetch helpers (client-side, relative URL) ─────────────────────────────────

async function fetchCoverage(ticker: string): Promise<CoverageBrief | null> {
  try {
    const path = `/api/v1/companies/${encodeURIComponent(ticker)}/coverage`;
    const res = await fetch(`/api/ui-final-v031/backend?path=${encodeURIComponent(path)}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { data?: CoverageBrief } | CoverageBrief;
    // Support both envelope { data: ... } and direct object
    if (json && typeof json === "object" && "data" in json && json.data) {
      return json.data;
    }
    return json as CoverageBrief;
  } catch {
    return null;
  }
}

async function fetchThemePeers(token: string): Promise<ThemePeerCompany[]> {
  try {
    const path = `/api/v1/themes/${encodeURIComponent(token)}/companies`;
    const res = await fetch(`/api/ui-final-v031/backend?path=${encodeURIComponent(path)}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return [];
    const json = await res.json() as { data?: ThemePeerCompany[] } | ThemePeerCompany[];
    if (json && typeof json === "object" && "data" in json && Array.isArray((json as { data: ThemePeerCompany[] }).data)) {
      return (json as { data: ThemePeerCompany[] }).data;
    }
    if (Array.isArray(json)) return json;
    return [];
  } catch {
    return [];
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.08em",
      color: "var(--fg-3, #888)",
      textTransform: "uppercase",
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function SupplyChainBlock({
  label,
  groups,
  currentTicker,
}: {
  label: string;
  groups: SupplyChainGroup[];
  currentTicker: string;
}) {
  if (!groups || groups.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {groups.map((g) => (
          <div key={g.category} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ fontSize: 11, color: "var(--fg-3, #888)", minWidth: 60, flexShrink: 0 }}>
              {g.category}
            </span>
            <span style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {g.companies.map((name) => {
                // If name looks like a ticker (uppercase 4 chars e.g. "2330"), make it a link
                const tickerMatch = name.match(/^(\d{4,6})\s/);
                const ticker = tickerMatch ? tickerMatch[1] : null;
                if (ticker && ticker.toLowerCase() !== currentTicker.toLowerCase()) {
                  return (
                    <Link
                      key={name}
                      href={`/companies/${ticker}`}
                      style={{ color: "var(--accent, #c8943f)", textDecoration: "underline dotted" }}
                    >
                      {name}
                    </Link>
                  );
                }
                return <span key={name} style={{ color: "var(--fg-1, #ddd)" }}>{name}</span>;
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NameList({
  label,
  names,
  currentTicker,
}: {
  label: string;
  names: string[];
  currentTicker: string;
}) {
  if (!names || names.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {names.map((name) => {
          const tickerMatch = name.match(/^(\d{4,6})\s/);
          const ticker = tickerMatch ? tickerMatch[1] : null;
          if (ticker && ticker.toLowerCase() !== currentTicker.toLowerCase()) {
            return (
              <Link
                key={name}
                href={`/companies/${ticker}`}
                style={{
                  fontSize: 12,
                  padding: "2px 8px",
                  border: "1px solid var(--border, #444)",
                  borderRadius: 2,
                  color: "var(--accent, #c8943f)",
                  textDecoration: "none",
                }}
              >
                {name}
              </Link>
            );
          }
          return (
            <span
              key={name}
              style={{
                fontSize: 12,
                padding: "2px 8px",
                border: "1px solid var(--border, #333)",
                borderRadius: 2,
                color: "var(--fg-2, #bbb)",
              }}
            >
              {name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function WikilinkRadar({
  wikilinks,
  currentTicker,
}: {
  wikilinks: string[];
  currentTicker: string;
}) {
  const [expandedToken, setExpandedToken] = useState<string | null>(null);
  const [peers, setPeers] = useState<Record<string, ThemePeerCompany[]>>({});
  const [loading, setLoading] = useState<string | null>(null);

  const handleTokenClick = useCallback(async (token: string) => {
    if (expandedToken === token) {
      setExpandedToken(null);
      return;
    }
    setExpandedToken(token);
    if (!peers[token]) {
      setLoading(token);
      const result = await fetchThemePeers(token);
      setPeers((prev) => ({ ...prev, [token]: result }));
      setLoading(null);
    }
  }, [expandedToken, peers]);

  const top10 = wikilinks.slice(0, 10);

  return (
    <div style={{ marginBottom: 12 }}>
      <SectionLabel>主題雷達（點擊查看同參與公司）</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {top10.map((token) => (
          <button
            key={token}
            onClick={() => void handleTokenClick(token)}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              border: "1px solid var(--accent, #c8943f)",
              borderRadius: 2,
              background: expandedToken === token ? "rgba(200,148,63,0.15)" : "transparent",
              color: "var(--accent, #c8943f)",
              cursor: "pointer",
              fontFamily: "var(--mono, monospace)",
            }}
          >
            {token}
          </button>
        ))}
      </div>
      {expandedToken && (
        <div style={{
          padding: "10px 12px",
          border: "1px solid var(--border, #333)",
          borderRadius: 2,
          background: "rgba(255,255,255,0.02)",
          fontSize: 12,
        }}>
          <div style={{ fontSize: 10, color: "var(--fg-3, #888)", marginBottom: 6 }}>
            同樣參與 <b style={{ color: "var(--accent, #c8943f)" }}>{expandedToken}</b> 的公司
          </div>
          {loading === expandedToken && (
            <span style={{ color: "var(--fg-3, #888)" }}>載入研究資料中...</span>
          )}
          {loading !== expandedToken && peers[expandedToken] && peers[expandedToken].length === 0 && (
            <span style={{ color: "var(--fg-3, #888)" }}>無對應資料</span>
          )}
          {loading !== expandedToken && peers[expandedToken] && peers[expandedToken].length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {peers[expandedToken]
                .filter((p) => p.ticker.toLowerCase() !== currentTicker.toLowerCase())
                .slice(0, 20)
                .map((p) => (
                  <Link
                    key={p.ticker}
                    href={`/companies/${p.ticker}`}
                    style={{
                      padding: "2px 8px",
                      border: "1px solid var(--border, #333)",
                      borderRadius: 2,
                      color: "var(--fg-1, #ddd)",
                      textDecoration: "none",
                      fontSize: 12,
                    }}
                  >
                    {p.ticker} {p.companyName}
                  </Link>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface CoverageSectionProps {
  /** IUF ticker symbol, e.g. "2330" */
  ticker: string;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "loaded"; data: CoverageBrief };

export function CoverageSection({ ticker }: CoverageSectionProps) {
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });

  const handleToggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    // Only fetch on first open
    if (next && loadState.status === "idle") {
      setLoadState({ status: "loading" });
      const data = await fetchCoverage(ticker);
      if (data === null) {
        setLoadState({ status: "not_found" });
      } else {
        setLoadState({ status: "loaded", data });
      }
    }
  }, [open, loadState.status, ticker]);

  return (
    <div
      className="panel hud-frame"
      style={{ marginBottom: 0, padding: 0 }}
    >
      {/* Accordion header */}
      <button
        onClick={() => void handleToggle()}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px clamp(16px,2vw,26px)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          borderBottom: open ? "1px solid var(--border, #333)" : "none",
        }}
      >
        <span style={{
          fontSize: 11,
          color: "var(--accent, #c8943f)",
          fontFamily: "var(--mono, monospace)",
          userSelect: "none",
        }}>
          {open ? "▼" : "▶"}
        </span>
        <h3
          className="ascii-head"
          style={{ margin: 0, flex: 1 }}
        >
          <span className="ascii-head-bracket">深度研究</span>
          <span className="tg soft" style={{ marginLeft: 8, fontSize: 10 }}>
            業務簡介 / 供應鏈 / 客戶 / 主題雷達
          </span>
        </h3>
        <span style={{ fontSize: 10, color: "var(--fg-3, #777)", fontStyle: "italic" }}>
          My-TW-Coverage
        </span>
      </button>

      {/* Accordion body */}
      {open && (
        <div style={{ padding: "16px clamp(16px,2vw,26px) 20px" }}>
          {loadState.status === "loading" && (
            <div style={{ fontSize: 13, color: "var(--fg-3, #888)", padding: "12px 0" }}>
              載入研究資料中...
            </div>
          )}

          {loadState.status === "not_found" && (
            <div className="terminal-note compact" style={{ color: "var(--fg-3, #888)" }}>
              此公司尚無深度研究資料
            </div>
          )}

          {loadState.status === "loaded" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* 1. 業務簡介 */}
              <div>
                <SectionLabel>業務簡介</SectionLabel>
                {/* Metadata strip */}
                <div style={{
                  display: "flex",
                  gap: 16,
                  flexWrap: "wrap",
                  marginBottom: 10,
                  fontSize: 11,
                  color: "var(--fg-3, #888)",
                }}>
                  {loadState.data.sector && (
                    <span>板塊：<b style={{ color: "var(--fg-2, #bbb)" }}>{loadState.data.sector}</b></span>
                  )}
                  {loadState.data.industry && (
                    <span>產業：<b style={{ color: "var(--fg-2, #bbb)" }}>{loadState.data.industry}</b></span>
                  )}
                  {loadState.data.marketCap && (
                    <span>市值：<b style={{ color: "var(--fg-2, #bbb)" }}>{loadState.data.marketCap}</b></span>
                  )}
                  {loadState.data.enterpriseValue && (
                    <span>企業價值：<b style={{ color: "var(--fg-2, #bbb)" }}>{loadState.data.enterpriseValue}</b></span>
                  )}
                </div>
                {loadState.data.businessOverview ? (
                  <p style={{
                    fontSize: 13,
                    lineHeight: 1.8,
                    color: "var(--fg-1, #ddd)",
                    margin: 0,
                    whiteSpace: "pre-wrap",
                  }}>
                    {loadState.data.businessOverview}
                  </p>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--fg-3, #888)" }}>暫無業務說明</span>
                )}
              </div>

              {/* 2. 供應鏈位置 */}
              {(loadState.data.supplyChain.upstream.length > 0 ||
                loadState.data.supplyChain.midstream.length > 0 ||
                loadState.data.supplyChain.downstream.length > 0) && (
                <div>
                  <SectionLabel>供應鏈位置</SectionLabel>
                  <SupplyChainBlock
                    label="上游"
                    groups={loadState.data.supplyChain.upstream}
                    currentTicker={ticker}
                  />
                  <SupplyChainBlock
                    label="中游"
                    groups={loadState.data.supplyChain.midstream}
                    currentTicker={ticker}
                  />
                  <SupplyChainBlock
                    label="下游"
                    groups={loadState.data.supplyChain.downstream}
                    currentTicker={ticker}
                  />
                </div>
              )}

              {/* 3. 主要客戶 + 主要供應商 */}
              {(loadState.data.majorCustomers.length > 0 || loadState.data.majorSuppliers.length > 0) && (
                <div>
                  <NameList
                    label="主要客戶"
                    names={loadState.data.majorCustomers}
                    currentTicker={ticker}
                  />
                  <NameList
                    label="主要供應商"
                    names={loadState.data.majorSuppliers}
                    currentTicker={ticker}
                  />
                </div>
              )}

              {/* 4. 主題雷達 */}
              {loadState.data.wikilinks && loadState.data.wikilinks.length > 0 && (
                <WikilinkRadar
                  wikilinks={loadState.data.wikilinks}
                  currentTicker={ticker}
                />
              )}
            </div>
          )}

          {/* License attribution */}
          <div style={{
            marginTop: 16,
            paddingTop: 10,
            borderTop: "1px solid var(--border, #222)",
            fontSize: 10,
            color: "var(--fg-3, #666)",
          }}>
            資料來源: My-TW-Coverage (MIT)
          </div>
        </div>
      )}
    </div>
  );
}
