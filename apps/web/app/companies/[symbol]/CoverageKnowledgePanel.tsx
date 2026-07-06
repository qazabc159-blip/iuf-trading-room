"use client";

/**
 * CoverageKnowledgePanel.tsx — My-TW-Coverage 知識面板
 *
 * 預設展開（非 accordion）；mount 後自動 fetch。
 * 顯示：業務簡介 / 供應鏈 / 主要客戶 / 主要供應商
 * 404 → 顯示 "本檔 (ticker) coverage 待補，1735 檔已收錄"
 * License: 資料來源 My-TW-Coverage (MIT)
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { industryLabel } from "@/lib/industry-i18n";
import { normalizeCoverageBrief, type CoverageBrief, type SupplyChainGroup } from "./coverageData";

type LoadState =
  | { status: "loading" }
  | { status: "not_found" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: CoverageBrief };

// ── Fetch helper ──────────────────────────────────────────────────────────────

function coverageUrl(ticker: string) {
  const path = `/api/v1/companies/${encodeURIComponent(ticker)}/coverage`;
  return `/api/ui-final-v031/backend?path=${encodeURIComponent(path)}`;
}

export async function fetchCoverage(ticker: string): Promise<CoverageBrief | null> {
  const res = await fetch(coverageUrl(ticker), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: unknown } | unknown;
  if (json && typeof json === "object" && "data" in json && json.data) {
    return normalizeCoverageBrief(json.data, ticker);
  }
  return normalizeCoverageBrief(json, ticker);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: "var(--fg-3,#888)",
        textTransform: "uppercase",
        marginBottom: 6,
      }}
    >
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
    <div style={{ marginBottom: 10 }}>
      <Label>{label}</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {groups.map((g) => (
          <div
            key={g.category}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}
          >
            <span style={{ fontSize: 11, color: "var(--fg-3,#888)", minWidth: 56, flexShrink: 0 }}>
              {g.category}
            </span>
            <span style={{ fontSize: 12, display: "flex", flexWrap: "wrap", gap: 5 }}>
              {g.companies.map((name) => {
                const m = name.match(/^(\d{4,6})\s/);
                const t = m ? m[1] : null;
                if (t && t.toLowerCase() !== currentTicker.toLowerCase()) {
                  return (
                    <Link
                      key={name}
                      href={`/companies/${t}`}
                      style={{ color: "var(--accent,#c8943f)", textDecoration: "underline dotted" }}
                    >
                      {name}
                    </Link>
                  );
                }
                return (
                  <span key={name} style={{ color: "var(--fg-1,#ddd)" }}>
                    {name}
                  </span>
                );
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
    <div style={{ marginBottom: 10 }}>
      <Label>{label}</Label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {names.map((name) => {
          const m = name.match(/^(\d{4,6})\s/);
          const t = m ? m[1] : null;
          if (t && t.toLowerCase() !== currentTicker.toLowerCase()) {
            return (
              <Link
                key={name}
                href={`/companies/${t}`}
                style={{
                  fontSize: 12,
                  padding: "2px 8px",
                  border: "1px solid var(--border,#444)",
                  borderRadius: 2,
                  color: "var(--accent,#c8943f)",
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
                border: "1px solid var(--border,#333)",
                borderRadius: 2,
                color: "var(--fg-2,#bbb)",
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

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  ticker: string;
}

export function CoverageKnowledgePanel({ ticker }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchCoverage(ticker)
      .then((data) => {
        if (cancelled) return;
        if (data === null) {
          setState({ status: "not_found" });
        } else {
          setState({ status: "loaded", data });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err ?? "");
        console.warn("[CoverageKnowledgePanel] fetch error", { ticker, msg });
        setState({ status: "error", message: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return (
    <section className="panel hud-frame company-intel-panel _ck-panel">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">知識圖譜</span>
        <span className="tg soft" style={{ marginLeft: 8, fontSize: 10 }}>
          業務 / 供應鏈 / 客戶
        </span>
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在載入 My-TW-Coverage 研究資料…</span>
        </div>
      )}

      {state.status === "not_found" && (
        <div className="state-panel">
          <span className="badge badge-yellow">待補</span>
          <span className="tg soft">
            本檔 ({ticker}) coverage 待補，1735 檔已收錄
          </span>
        </div>
      )}

      {state.status === "error" && (
        <div className="state-panel">
          <span className="badge badge-red">暫停</span>
          <span className="tg soft">研究資料暫時無法讀取</span>
        </div>
      )}

      {state.status === "loaded" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Metadata strip */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              fontSize: 11,
              color: "var(--fg-3,#888)",
              marginBottom: 2,
            }}
          >
            {state.data.sector && (
              <span>
                板塊：<b style={{ color: "var(--fg-2,#bbb)" }}>{industryLabel(state.data.sector)}</b>
              </span>
            )}
            {state.data.industry && (
              <span>
                產業：<b style={{ color: "var(--fg-2,#bbb)" }}>{industryLabel(state.data.industry)}</b>
              </span>
            )}
            {state.data.marketCap && (
              <span>
                市值：<b style={{ color: "var(--fg-2,#bbb)" }}>{state.data.marketCap}</b>
              </span>
            )}
          </div>

          {/* Business overview */}
          {state.data.businessOverview ? (
            <div>
              <Label>業務簡介</Label>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: "var(--fg-1,#ddd)",
                  margin: 0,
                  whiteSpace: "pre-wrap",
                }}
              >
                {state.data.businessOverview}
              </p>
            </div>
          ) : null}

          {/* Supply chain */}
          {(state.data.supplyChain.upstream.length > 0 ||
            state.data.supplyChain.midstream.length > 0 ||
            state.data.supplyChain.downstream.length > 0) && (
            <div>
              <Label>供應鏈位置</Label>
              <SupplyChainBlock
                label="上游"
                groups={state.data.supplyChain.upstream}
                currentTicker={ticker}
              />
              <SupplyChainBlock
                label="中游"
                groups={state.data.supplyChain.midstream}
                currentTicker={ticker}
              />
              <SupplyChainBlock
                label="下游"
                groups={state.data.supplyChain.downstream}
                currentTicker={ticker}
              />
            </div>
          )}

          {/* Customers + Suppliers */}
          {(state.data.majorCustomers.length > 0 || state.data.majorSuppliers.length > 0) && (
            <div>
              <NameList
                label="主要客戶"
                names={state.data.majorCustomers}
                currentTicker={ticker}
              />
              <NameList
                label="主要供應商"
                names={state.data.majorSuppliers}
                currentTicker={ticker}
              />
            </div>
          )}

          {/* Wikilinks / themes */}
          {state.data.wikilinks && state.data.wikilinks.length > 0 && (
            <div>
              <Label>主題雷達</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {state.data.wikilinks.slice(0, 12).map((token) => (
                  <span
                    key={token}
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      border: "1px solid var(--accent,#c8943f)",
                      borderRadius: 2,
                      color: "var(--accent,#c8943f)",
                      fontFamily: "var(--mono,monospace)",
                    }}
                  >
                    {token}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* License footer */}
      <div
        style={{
          marginTop: 16,
          paddingTop: 10,
          borderTop: "1px solid var(--border,#222)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          fontSize: 10,
          color: "var(--fg-3,#666)",
        }}
      >
        <span>資料來源: My-TW-Coverage (MIT)</span>
        <Link
          href={`/companies?tab=graph&q=${encodeURIComponent(ticker)}`}
          className="_ig-graph-search-link"
          style={{
            border: "1px solid var(--accent,#c8943f)",
            borderRadius: 4,
            color: "var(--accent,#c8943f)",
            padding: "4px 8px",
            textDecoration: "none",
            fontFamily: "var(--mono,monospace)",
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          在公司圖譜搜尋 {ticker}
        </Link>
      </div>
    </section>
  );
}
