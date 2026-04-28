"use client";
/**
 * BidAskLadder — Bid/Ask 5-Level Ladder (Phase 2 wire-up)
 * Ported from sandbox v0.7.0-w3
 * W5b visual overhaul: depth bars, v2 CSS classes, improved header.
 * 5 fixed rows, null levels show "——"
 * No order entry button.
 */

import { useReadOnlyQuote } from "@/lib/use-readonly-quote";
import type { BidAskData } from "@/lib/use-readonly-quote";
import { FreshnessBadge } from "./FreshnessBadge";

const LADDER_LEVELS = 5;

interface LadderRow {
  askPx:  number | null;
  askQty: number | null;
  bidPx:  number | null;
  bidQty: number | null;
}

interface BidAskLadderProps {
  symbol:   string;
  lastPx:   number;
}

function buildLadderFromLive(data: BidAskData): LadderRow[] {
  const rows: LadderRow[] = [];
  for (let i = 0; i < LADDER_LEVELS; i++) {
    const ask = data.asks[i];
    const bid = data.bids[i];
    rows.push({
      askPx:  ask?.price ?? null,
      askQty: ask?.qty   ?? null,
      bidPx:  bid?.price ?? null,
      bidQty: bid?.qty   ?? null,
    });
  }
  return rows;
}

function buildLadder(symbol: string, last: number): LadderRow[] {
  const tick  = last >= 500 ? 1 : last >= 100 ? 0.5 : 0.1;
  const rows: LadderRow[] = [];
  const seed  = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const qty   = (offset: number) => 100 * ((seed * (offset + 3)) % 20 + 1);
  for (let i = LADDER_LEVELS; i >= 1; i--) {
    rows.push({
      askPx:  parseFloat((last + tick * i).toFixed(2)),
      askQty: qty(i + 10),
      bidPx:  parseFloat((last - tick * i).toFixed(2)),
      bidQty: qty(i),
    });
  }
  return rows;
}

const T = {
  up:    "#e63946",
  dn:    "#2ecc71",
  gold:  "#b88a3e",
  mid:   "#9a937e",
  soft:  "#6b6553",
  ink:   "#e8dfc8",
  rule:  "rgba(232,223,200,0.08)",
  ruleS: "rgba(232,223,200,0.22)",
  d1:    "#14150E",
  d2:    "#1C1E15",
  mono:  '"JetBrains Mono", ui-monospace, monospace',
} as const;

function fmtPx(v: number | null): string {
  return v === null ? "——" : v.toFixed(2);
}
function fmtQty(v: number | null): string {
  return v === null ? "——" : v.toLocaleString();
}

/** Compute max qty across all rows for proportional depth bars */
function maxQty(rows: LadderRow[]): number {
  let m = 1;
  for (const r of rows) {
    if (r.askQty !== null && r.askQty > m) m = r.askQty;
    if (r.bidQty !== null && r.bidQty > m) m = r.bidQty;
  }
  return m;
}

export function BidAskLadder({ symbol, lastPx }: BidAskLadderProps) {
  const { bidask, freshness, source, endpointUnavailable } = useReadOnlyQuote(symbol);

  const rows: LadderRow[] = bidask
    ? buildLadderFromLive(bidask)
    : buildLadder(symbol, lastPx);

  const maxQ = maxQty(rows);

  const sourceTooltip = source === "live"
    ? `Live bid/ask from GET /api/v1/kgi/quote/bidask?symbol=${symbol} (W2d HEAD 95466f4)`
    : endpointUnavailable
      ? `Endpoint unreachable — showing deterministic mock data`
      : `Mock data (NEXT_PUBLIC_API_BASE not set)`;

  return (
    <div style={{ fontFamily: T.mono, fontSize: 11, background: T.d1 }}>
      {/* Header row */}
      <div className="ladder-header-v2">
        <span>ASK·QTY</span>
        <span style={{ textAlign: "right" }}>ASK·PX</span>
        <span>BID·PX</span>
        <span style={{ textAlign: "right" }}>BID·QTY</span>
      </div>

      {/* Depth rows with proportional background bars */}
      {rows.map((r, i) => {
        const askDepthPct = r.askQty !== null ? Math.round((r.askQty / maxQ) * 50) : 0;
        const bidDepthPct = r.bidQty !== null ? Math.round((r.bidQty / maxQ) * 50) : 0;

        return (
          <div
            key={`row-${i}`}
            style={{
              position:           "relative",
              display:            "grid",
              gridTemplateColumns:"1fr 1fr 1fr 1fr",
              padding:            "3px 10px",
              borderBottom:       `1px solid ${T.rule}`,
              overflow:           "hidden",
            }}
          >
            {/* Ask depth bar (left-aligned) */}
            {askDepthPct > 0 && (
              <span style={{
                position:    "absolute",
                top: 0, bottom: 0,
                left: 0,
                width:       `${askDepthPct}%`,
                background:  "rgba(230,57,70,0.07)",
                pointerEvents: "none",
              }} />
            )}
            {/* Bid depth bar (right-aligned) */}
            {bidDepthPct > 0 && (
              <span style={{
                position:    "absolute",
                top: 0, bottom: 0,
                right: 0,
                width:       `${bidDepthPct}%`,
                background:  "rgba(46,204,113,0.07)",
                pointerEvents: "none",
              }} />
            )}
            <span style={{ color: T.mid, position: "relative", zIndex: 1 }}>{fmtQty(r.askQty)}</span>
            <span style={{ color: r.askPx === null ? T.soft : T.up, textAlign: "right", fontVariantNumeric: "tabular-nums", position: "relative", zIndex: 1 }}>
              {fmtPx(r.askPx)}
            </span>
            <span style={{ color: r.bidPx === null ? T.soft : T.dn, fontVariantNumeric: "tabular-nums", position: "relative", zIndex: 1 }}>
              {fmtPx(r.bidPx)}
            </span>
            <span style={{ color: T.mid, textAlign: "right", position: "relative", zIndex: 1 }}>{fmtQty(r.bidQty)}</span>
          </div>
        );
      })}

      {/* Last price row */}
      <div className="ladder-last-row">
        <span style={{ color: T.soft, fontSize: 9, letterSpacing: "0.14em", fontFamily: T.mono }}>LAST</span>
        <span className="ladder-last-px">
          {lastPx.toFixed(2)}
        </span>
        <span style={{ color: T.soft, fontSize: 9, letterSpacing: "0.14em", fontFamily: T.mono }}>{symbol}</span>
      </div>

      {/* Freshness footer */}
      <div style={{ padding: "4px 10px", borderTop: `1px solid ${T.rule}`, display: "flex", alignItems: "center", gap: 8 }}>
        <FreshnessBadge
          freshness={freshness}
          tooltip={sourceTooltip}
          endpointUnavailable={endpointUnavailable}
        />
        {source === "mock" && !endpointUnavailable && (
          <span title={sourceTooltip} style={{ color: T.soft, fontSize: 9, letterSpacing: "0.12em", cursor: "help" }}>
            MOCK · set NEXT_PUBLIC_API_BASE for live
          </span>
        )}
      </div>
    </div>
  );
}
