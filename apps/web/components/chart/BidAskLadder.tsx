"use client";
/**
 * BidAskLadder — Bid/Ask 5-Level Ladder (Phase 2 wire-up)
 * Ported from sandbox v0.7.0-w3
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
  mono:  '"JetBrains Mono", ui-monospace, monospace',
} as const;

function fmtPx(v: number | null): string {
  return v === null ? "——" : v.toFixed(2);
}
function fmtQty(v: number | null): string {
  return v === null ? "——" : v.toLocaleString();
}

export function BidAskLadder({ symbol, lastPx }: BidAskLadderProps) {
  const { bidask, freshness, source, endpointUnavailable } = useReadOnlyQuote(symbol);

  const rows: LadderRow[] = bidask
    ? buildLadderFromLive(bidask)
    : buildLadder(symbol, lastPx);

  const sourceTooltip = source === "live"
    ? `Live bid/ask from GET /api/v1/kgi/quote/bidask?symbol=${symbol} (W2d HEAD 95466f4)`
    : endpointUnavailable
      ? `Endpoint unreachable — showing deterministic mock data`
      : `Mock data (NEXT_PUBLIC_API_BASE not set)`;

  return (
    <div style={{ fontFamily: T.mono, fontSize: 11 }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        padding: "5px 10px",
        borderBottom: `1px solid ${T.ruleS}`,
        color: T.soft,
        letterSpacing: "0.14em",
        fontSize: 9,
        textTransform: "uppercase",
      }}>
        <span>ASK·QTY</span>
        <span style={{ textAlign: "right" }}>ASK·PX</span>
        <span>BID·PX</span>
        <span style={{ textAlign: "right" }}>BID·QTY</span>
      </div>

      {rows.map((r, i) => (
        <div key={`row-${i}`} style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          padding: "3px 10px",
          borderBottom: `1px solid ${T.rule}`,
          background: i === 0 ? "rgba(230,57,70,0.04)" : "transparent",
        }}>
          <span style={{ color: T.mid }}>{fmtQty(r.askQty)}</span>
          <span style={{ color: r.askPx === null ? T.soft : T.up, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {fmtPx(r.askPx)}
          </span>
          <span style={{ color: r.bidPx === null ? T.soft : T.dn, fontVariantNumeric: "tabular-nums" }}>
            {fmtPx(r.bidPx)}
          </span>
          <span style={{ color: T.mid, textAlign: "right" }}>{fmtQty(r.bidQty)}</span>
        </div>
      ))}

      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "6px 10px",
        borderTop: `1px solid ${T.gold}`,
        borderBottom: `1px solid ${T.gold}`,
        background: "rgba(184,138,62,0.06)",
        gap: 8,
      }}>
        <span style={{ color: T.soft, fontSize: 9, letterSpacing: "0.14em" }}>LAST</span>
        <span style={{ color: T.ink, fontStyle: "italic", fontVariantNumeric: "tabular-nums", fontSize: 15, fontWeight: 300 }}>
          {lastPx.toFixed(2)}
        </span>
        <span style={{ color: T.soft, fontSize: 9, letterSpacing: "0.14em" }}>{symbol}</span>
      </div>

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
