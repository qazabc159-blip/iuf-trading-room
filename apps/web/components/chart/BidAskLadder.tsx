"use client";

import { useReadOnlyQuote } from "@/lib/use-readonly-quote";
import type { BidAskData } from "@/lib/use-readonly-quote";
import { FreshnessBadge } from "./FreshnessBadge";

const LADDER_LEVELS = 5;

interface LadderRow {
  askPx: number | null;
  askQty: number | null;
  bidPx: number | null;
  bidQty: number | null;
}

interface BidAskLadderProps {
  symbol: string;
  lastPx: number;
}

function buildLadderFromLive(data: BidAskData): LadderRow[] {
  return Array.from({ length: LADDER_LEVELS }, (_, i) => {
    const ask = data.asks[i];
    const bid = data.bids[i];
    return {
      askPx: ask?.price ?? null,
      askQty: ask?.qty ?? null,
      bidPx: bid?.price ?? null,
      bidQty: bid?.qty ?? null,
    };
  });
}

function buildDevLadder(symbol: string, last: number): LadderRow[] {
  const tick = last >= 500 ? 1 : last >= 100 ? 0.5 : 0.1;
  const seed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const qty = (offset: number) => 100 * ((seed * (offset + 3)) % 20 + 1);
  return Array.from({ length: LADDER_LEVELS }, (_, idx) => {
    const i = LADDER_LEVELS - idx;
    return {
      askPx: Number((last + tick * i).toFixed(2)),
      askQty: qty(i + 10),
      bidPx: Number((last - tick * i).toFixed(2)),
      bidQty: qty(i),
    };
  });
}

function emptyLadder(): LadderRow[] {
  return Array.from({ length: LADDER_LEVELS }, () => ({
    askPx: null,
    askQty: null,
    bidPx: null,
    bidQty: null,
  }));
}

const T = {
  up: "#e63946",
  dn: "#2ecc71",
  gold: "#b88a3e",
  mid: "#9a937e",
  soft: "#6b6553",
  ink: "#e8dfc8",
  rule: "rgba(232,223,200,0.08)",
  ruleS: "rgba(232,223,200,0.22)",
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

function fmtPx(v: number | null): string {
  return v === null ? "--" : v.toFixed(2);
}

function fmtQty(v: number | null): string {
  return v === null ? "--" : v.toLocaleString();
}

export function BidAskLadder({ symbol, lastPx }: BidAskLadderProps) {
  const { bidask, freshness, source, endpointUnavailable } = useReadOnlyQuote(symbol);

  const rows: LadderRow[] = bidask
    ? buildLadderFromLive(bidask)
    : source === "mock" && !endpointUnavailable
    ? buildDevLadder(symbol, lastPx)
    : emptyLadder();

  const sourceTooltip = endpointUnavailable
    ? "KGI bid/ask endpoint is blocked or unreachable; no synthetic ladder is rendered."
    : source === "live"
    ? `Live bid/ask from GET /api/v1/kgi/quote/bidask?symbol=${symbol}`
    : "Development mock data because NEXT_PUBLIC_API_BASE_URL is not set.";

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
        <span>ASK / QTY</span>
        <span style={{ textAlign: "right" }}>ASK / PX</span>
        <span>BID / PX</span>
        <span style={{ textAlign: "right" }}>BID / QTY</span>
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
          source={source}
          tooltip={sourceTooltip}
          endpointUnavailable={endpointUnavailable}
        />
        {source === "mock" && !endpointUnavailable && (
          <span title={sourceTooltip} style={{ color: T.soft, fontSize: 9, letterSpacing: "0.12em", cursor: "help" }}>
            MOCK / set NEXT_PUBLIC_API_BASE_URL for live
          </span>
        )}
      </div>

      {!bidask && source !== "mock" && (
        <div style={{ padding: "5px 10px", color: T.soft, fontSize: 9, letterSpacing: "0.10em" }}>
          KGI depth is blocked or unavailable; synthetic bid/ask levels are hidden.
        </div>
      )}
    </div>
  );
}
