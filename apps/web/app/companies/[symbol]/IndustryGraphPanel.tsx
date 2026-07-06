"use client";

/**
 * IndustryGraphPanel.tsx — 同業比較 + 上下游圖譜 mini-graph
 *
 * 從 CoverageBrief 解 entity（同業 / 上游 / 下游 / 主題 wikilinks），
 * 用 simple SVG 畫 radial mini-graph：中心是當前公司，周圍 6-8 個關聯實體。
 * 點擊實體導航到對應公司頁（若有 ticker）。
 * 無 entity data → 顯示「圖譜資料整理中」，不留空白。
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCoverage } from "./CoverageKnowledgePanel";
import type { CoverageBrief } from "./coverageData";

// ── Fetch helper (client-side) ────────────────────────────────────────────────

async function fetchCoverageForGraph(ticker: string): Promise<CoverageBrief | null> {
  return fetchCoverage(ticker);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeKind = "center" | "peer" | "upstream" | "downstream" | "theme";

interface GraphNode {
  id: string;
  label: string;
  ticker: string | null;
  kind: NodeKind;
  angle: number; // radians
  r: number;     // radial distance from center
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractTicker(name: string): string | null {
  const m = name.match(/^(\d{4,6})\s/);
  return m ? m[1] : null;
}

function shortLabel(name: string, maxLen = 10): string {
  if (name.length <= maxLen) return name;
  return `${name.slice(0, maxLen)}…`;
}

const KIND_COLOR: Record<NodeKind, string> = {
  center: "#e2b85c",
  peer: "#6ab0de",
  upstream: "#58d68d",
  downstream: "#ff8c66",
  theme: "#c8943f",
};

const KIND_LABEL: Record<NodeKind, string> = {
  center: "本公司",
  peer: "同業",
  upstream: "上游",
  downstream: "下游",
  theme: "主題",
};

// ── Build graph nodes from CoverageBrief ──────────────────────────────────────

function buildNodes(brief: CoverageBrief, currentTicker: string): GraphNode[] {
  const items: Array<{ label: string; ticker: string | null; kind: NodeKind }> = [];

  // upstream (max 2)
  for (const g of brief.supplyChain.upstream.slice(0, 1)) {
    for (const c of g.companies.slice(0, 2)) {
      const t = extractTicker(c);
      if (t && t.toLowerCase() === currentTicker.toLowerCase()) continue;
      items.push({ label: c, ticker: t, kind: "upstream" });
    }
  }

  // downstream (max 2)
  for (const g of brief.supplyChain.downstream.slice(0, 1)) {
    for (const c of g.companies.slice(0, 2)) {
      const t = extractTicker(c);
      if (t && t.toLowerCase() === currentTicker.toLowerCase()) continue;
      items.push({ label: c, ticker: t, kind: "downstream" });
    }
  }

  // major customers (max 2)
  for (const c of brief.majorCustomers.slice(0, 2)) {
    const t = extractTicker(c);
    if (t && t.toLowerCase() === currentTicker.toLowerCase()) continue;
    items.push({ label: c, ticker: t, kind: "downstream" });
  }

  // major suppliers (max 2)
  for (const c of brief.majorSuppliers.slice(0, 2)) {
    const t = extractTicker(c);
    if (t && t.toLowerCase() === currentTicker.toLowerCase()) continue;
    items.push({ label: c, ticker: t, kind: "upstream" });
  }

  // wikilinks/themes (max 3)
  for (const token of (brief.wikilinks ?? []).slice(0, 3)) {
    items.push({ label: token, ticker: null, kind: "theme" });
  }

  // Deduplicate by label
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (seen.has(i.label)) return false;
    seen.add(i.label);
    return true;
  });

  // Cap at 8 outer nodes
  const outer = unique.slice(0, 8);

  const nodes: GraphNode[] = outer.map((item, idx) => ({
    id: `node-${idx}`,
    label: item.label,
    ticker: item.ticker,
    kind: item.kind,
    angle: (2 * Math.PI * idx) / outer.length - Math.PI / 2,
    r: 110,
  }));

  return nodes;
}

// ── SVG graph ─────────────────────────────────────────────────────────────────

const CX = 180;
const CY = 150;
const CENTER_R = 28;
const NODE_R = 18;

interface GraphProps {
  nodes: GraphNode[];
  centerLabel: string;
  centerTicker: string;
}

function MiniGraph({ nodes, centerLabel, centerTicker }: GraphProps) {
  const width = 360;
  const height = 300;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ maxWidth: 400, display: "block", margin: "0 auto" }}
      aria-label={`${centerLabel} 供應鏈關係圖`}
    >
      {/* Lines from center to nodes */}
      {nodes.map((node) => {
        const nx = CX + node.r * Math.cos(node.angle);
        const ny = CY + node.r * Math.sin(node.angle);
        return (
          <line
            key={`line-${node.id}`}
            x1={CX}
            y1={CY}
            x2={nx}
            y2={ny}
            stroke="rgba(220,228,240,0.12)"
            strokeWidth={1}
          />
        );
      })}

      {/* Outer nodes */}
      {nodes.map((node) => {
        const nx = CX + node.r * Math.cos(node.angle);
        const ny = CY + node.r * Math.sin(node.angle);
        const color = KIND_COLOR[node.kind];
        const label = shortLabel(node.label, 9);
        // Label positioning — push label outward from node
        const lx = nx + (nx - CX) * 0.22;
        const ly = ny + (ny - CY) * 0.22;

        const inner = (
          <>
            <circle
              cx={nx}
              cy={ny}
              r={NODE_R}
              fill="rgba(5,8,12,0.72)"
              stroke={color}
              strokeWidth={1.5}
              opacity={0.9}
            />
            <text
              x={nx}
              y={ny + 4}
              textAnchor="middle"
              fontSize={8}
              fill={color}
              fontFamily="var(--mono,monospace)"
            >
              {node.ticker ?? label.slice(0, 6)}
            </text>
            {/* Outer text label */}
            <text
              x={lx}
              y={ly}
              textAnchor={nx < CX ? "end" : nx > CX ? "start" : "middle"}
              fontSize={8}
              fill="rgba(200,210,220,0.7)"
              fontFamily="var(--mono,monospace)"
            >
              {label}
            </text>
          </>
        );

        if (node.ticker) {
          return (
            <Link key={node.id} href={`/companies/${node.ticker}`}>
              <g style={{ cursor: "pointer" }}>
                {inner}
              </g>
            </Link>
          );
        }
        return <g key={node.id}>{inner}</g>;
      })}

      {/* Center node */}
      <circle
        cx={CX}
        cy={CY}
        r={CENTER_R}
        fill="rgba(226,184,92,0.16)"
        stroke="#e2b85c"
        strokeWidth={2}
      />
      <text
        x={CX}
        y={CY - 4}
        textAnchor="middle"
        fontSize={10}
        fill="#e2b85c"
        fontFamily="var(--mono,monospace)"
        fontWeight={700}
      >
        {centerTicker}
      </text>
      <text
        x={CX}
        y={CY + 9}
        textAnchor="middle"
        fontSize={7}
        fill="rgba(226,184,92,0.7)"
        fontFamily="var(--sans-tc,sans-serif)"
      >
        {shortLabel(centerLabel, 8)}
      </text>
    </svg>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

const LEGEND_KINDS: NodeKind[] = ["upstream", "downstream", "theme"];

function Legend() {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        marginTop: 8,
        justifyContent: "center",
      }}
    >
      {LEGEND_KINDS.map((k) => (
        <span
          key={k}
          style={{
            fontSize: 10,
            color: KIND_COLOR[k],
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              border: `1.5px solid ${KIND_COLOR[k]}`,
              display: "inline-block",
            }}
          />
          {KIND_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

type GraphState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; nodes: GraphNode[]; brief: CoverageBrief | null };

interface Props {
  ticker: string;
  companyName: string;
  /** Optionally pass a pre-fetched brief to skip the internal fetch. */
  brief?: CoverageBrief | null;
}

export function IndustryGraphPanel({ ticker, companyName, brief: briefProp }: Props) {
  const [graphState, setGraphState] = useState<GraphState>({ status: "loading" });

  useEffect(() => {
    // If brief was passed from parent (e.g. already fetched by sibling), use it directly
    if (briefProp !== undefined) {
      const nodes = briefProp ? buildNodes(briefProp, ticker) : [];
      setGraphState({ status: "ready", nodes, brief: briefProp });
      return;
    }
    // Otherwise self-fetch
    let cancelled = false;
    fetchCoverageForGraph(ticker)
      .then((data) => {
        if (cancelled) return;
        const nodes = data ? buildNodes(data, ticker) : [];
        setGraphState({ status: "ready", nodes, brief: data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err ?? "");
        console.warn("[IndustryGraphPanel] fetch error", { ticker, msg });
        setGraphState({ status: "error", message: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, briefProp]);

  const mounted = graphState.status !== "loading";
  const nodes = graphState.status === "ready" ? graphState.nodes : [];
  const brief = graphState.status === "ready" ? graphState.brief : undefined;
  const hasData = nodes.length > 0;

  return (
    <section className="panel hud-frame company-intel-panel _ig-panel">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">上下游圖譜</span>
        <span className="tg soft" style={{ marginLeft: 8, fontSize: 10 }}>
          同業 / 上游 / 下游 / 主題
        </span>
      </h3>

      {!mounted && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">圖譜初始化中…</span>
        </div>
      )}

      {graphState.status === "error" && (
        <div className="state-panel">
          <span className="badge badge-red">暫停</span>
          <span className="tg soft">圖譜資料暫時無法讀取</span>
          <span className="state-reason" style={{ fontSize: 11 }}>
            My-TW-Coverage coverage endpoint 暫時沒有回應；這不是 coverage 待補，不會用空資料誤判。
          </span>
        </div>
      )}

      {graphState.status === "ready" && !hasData && (
        <div className="state-panel">
          <span className="badge badge-yellow">整理中</span>
          <span className="tg soft">圖譜資料整理中</span>
          <span className="state-reason" style={{ fontSize: 11 }}>
            {brief === null
              ? `本檔 (${ticker}) coverage 待補，圖譜依 My-TW-Coverage 資料生成`
              : "此公司暫無上下游關係資料可繪製"}
          </span>
        </div>
      )}

      {mounted && hasData && (
        <>
          <MiniGraph nodes={nodes} centerLabel={companyName} centerTicker={ticker} />
          <Legend />
          <div
            style={{
              marginTop: 10,
              fontSize: 10,
              color: "var(--fg-3,#777)",
              textAlign: "center",
            }}
          >
            點擊節點跳轉至對應公司頁
          </div>
        </>
      )}

      {/* License footer */}
      <div
        style={{
          marginTop: 14,
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
