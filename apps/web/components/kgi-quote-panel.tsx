"use client";

/**
 * KGI Quote Panel — W2d Lane 2 read-only component.
 *
 * Displays: tick (close/chg/pct/volume), bidask 5-level, freshness badge, last update.
 * Hardcoded read-only: no order buttons. §6 4/4 PASS.
 *
 * WIRE-UP: swap fetchRecentTicks / fetchLatestBidAsk imports for real API
 * calls once Jason Lane 1 /api/v1/kgi/quote/* routes land.
 */

import { useEffect, useRef, useState } from "react";

import {
  computeFreshness,
  formatQuoteAge,
  type KgiBidAskResponse,
  type KgiGatewayBidAsk,
  type KgiGatewayTick,
  type KgiTicksResponse,
  type QuoteFreshnessState
} from "@/lib/kgi-quote-types";
import {
  fetchLatestBidAsk,
  fetchRecentTicks
} from "@/lib/kgi-quote-mock";

// D-W2D-3: tick=1000ms, bidask=500ms
const TICK_POLL_MS = 1_000;
const BIDASK_POLL_MS = 500;

// ── Freshness badge ─────────────────────────────────────────────────────────

const FRESHNESS_CONFIG: Record<
  QuoteFreshnessState,
  { label: string; color: string }
> = {
  fresh: { label: "● LIVE", color: "var(--phosphor)" },
  stale: { label: "⚠ STALE", color: "var(--amber)" },
  "not-available": { label: "— 無資料", color: "var(--dim)" }
};

function FreshnessBadge({ state }: { state: QuoteFreshnessState }) {
  const cfg = FRESHNESS_CONFIG[state];
  return (
    <span
      data-testid="kgi-quote-freshness"
      style={{
        fontSize: "0.75rem",
        letterSpacing: "0.08em",
        color: cfg.color,
        fontFamily: "var(--mono, monospace)"
      }}
    >
      {cfg.label}
    </span>
  );
}

// ── Tick row ─────────────────────────────────────────────────────────────────

function TickRow({ tick }: { tick: KgiGatewayTick }) {
  const chgColor =
    tick.chgType === 1
      ? "var(--phosphor)"
      : tick.chgType === 2
        ? "var(--amber)"
        : "var(--dim)";
  const sign = tick.priceChg >= 0 ? "+" : "";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "3fr 2fr 2fr 2fr",
        gap: "0 0.75rem",
        fontFamily: "var(--mono, monospace)",
        fontSize: "0.88rem",
        padding: "0.35rem 0",
        borderBottom: "1px solid var(--line, #2a2a2a)"
      }}
    >
      <span style={{ color: "var(--fg, #eee)", fontSize: "1.1rem", fontWeight: 600 }}>
        {tick.close.toFixed(2)}
      </span>
      <span style={{ color: chgColor }}>
        {sign}
        {tick.priceChg.toFixed(2)}
      </span>
      <span style={{ color: chgColor }}>
        {sign}
        {tick.pctChg.toFixed(2)}%
      </span>
      <span style={{ color: "var(--dim)" }}>vol {formatVol(tick.volume)}</span>
    </div>
  );
}

// ── BidAsk 5-level table ──────────────────────────────────────────────────────

function BidAskTable({ bidask }: { bidask: KgiGatewayBidAsk }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.8rem"
        }}
      >
        <thead>
          <tr style={{ color: "var(--dim)" }}>
            <th style={thBid}>委買量</th>
            <th style={thBid}>委買價</th>
            <th style={thSep}>#</th>
            <th style={thAsk}>委賣價</th>
            <th style={thAsk}>委賣量</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((i) => (
            <tr key={i} style={{ borderTop: "1px solid var(--line, #2a2a2a)" }}>
              <td style={tdBid}>{bidask.bidVolumes[i] ?? "—"}</td>
              <td style={{ ...tdBid, color: "var(--phosphor)", fontWeight: 600 }}>
                {bidask.bidPrices[i]?.toFixed(2) ?? "—"}
              </td>
              <td style={{ textAlign: "center", color: "var(--dim)", padding: "0.25rem 0.4rem" }}>
                {i + 1}
              </td>
              <td style={{ ...tdAsk, color: "var(--amber)", fontWeight: 600 }}>
                {bidask.askPrices[i]?.toFixed(2) ?? "—"}
              </td>
              <td style={tdAsk}>{bidask.askVolumes[i] ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thBid: React.CSSProperties = { textAlign: "right", padding: "0.25rem 0.4rem", fontWeight: "normal" };
const thAsk: React.CSSProperties = { textAlign: "left", padding: "0.25rem 0.4rem", fontWeight: "normal" };
const thSep: React.CSSProperties = { textAlign: "center", padding: "0.25rem 0.4rem", fontWeight: "normal" };
const tdBid: React.CSSProperties = { textAlign: "right", padding: "0.25rem 0.4rem" };
const tdAsk: React.CSSProperties = { textAlign: "left", padding: "0.25rem 0.4rem" };

// ── Main panel ────────────────────────────────────────────────────────────────

export function KgiQuotePanel({ symbol }: { symbol: string }) {
  const [ticksResp, setTicksResp] = useState<KgiTicksResponse | null>(null);
  const [bidAskResp, setBidAskResp] = useState<KgiBidAskResponse | null>(null);
  const [tickError, setTickError] = useState(false);
  const [bidaskError, setBidaskError] = useState(false);

  // Backoff counters for error state — per D-W2D-3 guard
  const tickFailRef = useRef(0);
  const bidaskFailRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function pollTick() {
      if (cancelled) return;
      try {
        const res = await fetchRecentTicks(symbol, 1);
        if (cancelled) return;
        setTicksResp(res);
        setTickError(false);
        tickFailRef.current = 0;
      } catch {
        if (cancelled) return;
        tickFailRef.current++;
        setTickError(true);
      }
      if (cancelled) return;
      // Exponential backoff on failure (max 8s)
      const delay = tickFailRef.current > 0
        ? Math.min(TICK_POLL_MS * Math.pow(2, tickFailRef.current - 1), 8_000)
        : TICK_POLL_MS;
      setTimeout(pollTick, delay);
    }

    async function pollBidAsk() {
      if (cancelled) return;
      try {
        const res = await fetchLatestBidAsk(symbol);
        if (cancelled) return;
        setBidAskResp(res);
        setBidaskError(false);
        bidaskFailRef.current = 0;
      } catch {
        if (cancelled) return;
        bidaskFailRef.current++;
        setBidaskError(true);
      }
      if (cancelled) return;
      const delay = bidaskFailRef.current > 0
        ? Math.min(BIDASK_POLL_MS * Math.pow(2, bidaskFailRef.current - 1), 8_000)
        : BIDASK_POLL_MS;
      setTimeout(pollBidAsk, delay);
    }

    pollTick();
    pollBidAsk();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const latestTick = ticksResp?.ticks?.[0] ?? null;
  const bidask = bidAskResp?.bidask ?? null;

  const tickReceivedAt = latestTick?.receivedAt ?? ticksResp?.staleSince ?? null;
  const bidaskReceivedAt = bidask?.receivedAt ?? bidAskResp?.staleSince ?? null;
  const freshestAt = tickReceivedAt ?? bidaskReceivedAt;

  const freshness = computeFreshness(freshestAt);
  const ageStr = formatQuoteAge(freshestAt);

  return (
    <div>
      {/* Header row: symbol + freshness badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
          gap: "0.5rem"
        }}
      >
        <span
          style={{
            fontFamily: "var(--mono, monospace)",
            fontSize: "1.1rem",
            letterSpacing: "0.1em",
            color: "var(--phosphor)"
          }}
        >
          {symbol}
        </span>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "baseline" }}>
          <FreshnessBadge state={freshness} />
          {freshestAt && (
            <span
              style={{
                fontFamily: "var(--mono, monospace)",
                fontSize: "0.72rem",
                color: "var(--dim)"
              }}
            >
              更新 {ageStr}
            </span>
          )}
          {(tickError || bidaskError) && (
            <span
              style={{
                fontFamily: "var(--mono, monospace)",
                fontSize: "0.72rem",
                color: "var(--amber)"
              }}
            >
              ⚠ 請求失敗，重試中…
            </span>
          )}
        </div>
      </div>

      {/* Tick section */}
      <div style={{ marginBottom: "0.75rem" }}>
        <div
          style={{
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.7rem",
            color: "var(--dim)",
            letterSpacing: "0.1em",
            marginBottom: "0.3rem"
          }}
        >
          [TICK] 最新成交
        </div>
        {latestTick ? (
          <TickRow tick={latestTick} />
        ) : (
          <span style={{ fontFamily: "var(--mono, monospace)", fontSize: "0.82rem", color: "var(--dim)" }}>
            {tickError ? "— 請求失敗" : "— 等待資料…"}
          </span>
        )}
      </div>

      {/* BidAsk section */}
      <div>
        <div
          style={{
            fontFamily: "var(--mono, monospace)",
            fontSize: "0.7rem",
            color: "var(--dim)",
            letterSpacing: "0.1em",
            marginBottom: "0.3rem"
          }}
        >
          [BIDASK] 五檔掛單
        </div>
        {bidask ? (
          <BidAskTable bidask={bidask} />
        ) : (
          <span style={{ fontFamily: "var(--mono, monospace)", fontSize: "0.82rem", color: "var(--dim)" }}>
            {bidaskError ? "— 請求失敗" : "— 等待資料…"}
          </span>
        )}
      </div>

      {/* Read-only notice — always visible per §3 read-only badge requirement */}
      <div
        style={{
          marginTop: "0.75rem",
          fontFamily: "var(--mono, monospace)",
          fontSize: "0.7rem",
          color: "var(--dim)",
          borderTop: "1px solid var(--line, #2a2a2a)",
          paddingTop: "0.5rem"
        }}
      >
        [READ-ONLY] 報價資料 — 僅供觀察，不含下單功能
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatVol(v: number): string {
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}
