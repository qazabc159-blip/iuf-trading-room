"use client";
/**
 * TickTape — Recent Ticks Scrolling Tape (Phase 2 wire-up)
 * Ported from sandbox v0.7.0-w3
 * W5b visual overhaul: flash animation on new ticks, v2 header, better density.
 * Auto-scrolls to bottom whenever displayTicks changes.
 * Source badge: [LIVE] / [MOCK] / [ERR→MOCK]
 * C1.1: empty state row when no live ticks yet.
 */
import { useEffect, useRef, useState } from "react";
import { useReadOnlyQuote } from "@/lib/use-readonly-quote";

interface Tick {
  ts:   number;   // unix ms
  px:   number;
  qty:  number;
  side: "B" | "S" | "U";
}

interface TickTapeProps {
  symbol: string;
  lastPx: number;
}

function buildMockTicks(symbol: string, lastPx: number, count = 30): Tick[] {
  const seed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const ticks: Tick[] = [];
  let px = lastPx;
  const now = Date.now();

  for (let i = count; i >= 0; i--) {
    const r  = ((seed * (i + 7) * 1664525 + 1013904223) & 0xffffffff) >>> 0;
    const pct = (r % 100) / 10000;
    px = parseFloat((px * (1 + (r % 2 === 0 ? pct : -pct))).toFixed(2));
    const qty = 1000 * ((r % 50) + 1);
    const side = r % 3 === 0 ? "B" : r % 3 === 1 ? "S" : "U";
    ticks.push({ ts: now - i * 3000, px, qty, side });
  }
  return ticks.reverse();
}

const T = {
  up:   "#e63946",
  dn:   "#2ecc71",
  mid:  "#9a937e",
  soft: "#6b6553",
  ink:  "#e8dfc8",
  rule: "rgba(232,223,200,0.06)",
  ruleS:"rgba(232,223,200,0.22)",
  d1:   "#14150E",
  d2:   "#1C1E15",
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return [
    d.getHours().toString().padStart(2, "0"),
    d.getMinutes().toString().padStart(2, "0"),
    d.getSeconds().toString().padStart(2, "0"),
  ].join(":");
}

export function TickTape({ symbol, lastPx }: TickTapeProps) {
  const { ticks: liveTicks, source, endpointUnavailable } = useReadOnlyQuote(symbol);
  const listRef = useRef<HTMLDivElement>(null);
  const [flashIdx, setFlashIdx] = useState<number>(-1);
  const prevTickCount = useRef<number>(0);

  const displayTicks: Tick[] = liveTicks.length > 0
    ? liveTicks.map((t) => ({
        ts:   new Date(t.ts).getTime(),
        px:   t.price,
        qty:  t.qty,
        side: "U" as const,
      }))
    : buildMockTicks(symbol, lastPx);

  // C1.1: waiting indicator — shown when source is not live yet and no live ticks
  const showWaiting = source !== "live" && liveTicks.length === 0 && !endpointUnavailable;

  // Flash new ticks when live ticks arrive
  useEffect(() => {
    if (liveTicks.length > prevTickCount.current && liveTicks.length > 0) {
      setFlashIdx(displayTicks.length - 1);
      const timer = setTimeout(() => setFlashIdx(-1), 300);
      prevTickCount.current = liveTicks.length;
      return () => clearTimeout(timer);
    }
    prevTickCount.current = liveTicks.length;
  }, [liveTicks.length, displayTicks.length]);

  // Auto-scroll to bottom on new ticks
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [displayTicks]);

  const sourceLabel = source === "live" ? "LIVE" : endpointUnavailable ? "ERR→MOCK" : "MOCK";
  const sourceLabelColor = source === "live"
    ? "#4ADE80"
    : endpointUnavailable
      ? "#e63946"
      : "rgba(184,138,62,0.45)";
  const sourceTooltip = source === "live"
    ? `Live ticks from GET /api/v1/kgi/quote/ticks?symbol=${symbol} (W2d HEAD 95466f4)`
    : endpointUnavailable
      ? `Endpoint /api/v1/kgi/quote/ticks unreachable — showing deterministic mock ticks`
      : `Mock ticks (NEXT_PUBLIC_API_BASE_URL not set) — set env to connect to live KGI gateway`;

  return (
    <div style={{ fontFamily: T.mono, background: T.d1 }}>
      {/* Header — v2 style */}
      <div className="tape-header-v2">
        <span>RECENT · TICKS</span>
        <span
          title={sourceTooltip}
          style={{ color: sourceLabelColor, cursor: "help", transition: "color 100ms ease-out" }}
          data-testid="ticktape-source-badge"
        >
          [{sourceLabel}]
        </span>
      </div>

      {/* Tick list — scrollable */}
      <div
        ref={listRef}
        style={{
          maxHeight:       240,
          overflowY:       "auto",
          scrollbarWidth:  "thin",
          scrollbarColor:  "rgba(184,138,62,0.25) transparent",
        }}
      >
        {/* C1.1: empty state before live ticks arrive */}
        {showWaiting && (
          <div style={{
            padding:       "8px 10px",
            color:         T.soft,
            fontFamily:    T.mono,
            fontSize:      10,
            letterSpacing: "0.10em",
          }}>
            等待 tick…
          </div>
        )}

        {displayTicks.map((t, i) => {
          const isNewest = i === displayTicks.length - 1 && i === flashIdx;
          const color = t.side === "B" ? T.up : t.side === "S" ? T.dn : T.mid;
          const flashBg = isNewest
            ? (t.side === "B" ? "rgba(230,57,70,0.10)" : t.side === "S" ? "rgba(46,204,113,0.10)" : "transparent")
            : "transparent";

          return (
            <div key={i} style={{
              display:             "grid",
              gridTemplateColumns: "56px 80px 72px 20px",
              padding:             "2px 10px",
              borderBottom:        `1px solid ${T.rule}`,
              alignItems:          "center",
              background:          flashBg,
              transition:          isNewest ? "none" : `background 300ms linear`,
            }}>
              <span style={{ color: T.soft, fontSize: 9, letterSpacing: "0.06em" }}>{fmtTime(t.ts)}</span>
              <span style={{
                color:               isNewest ? (t.side === "B" ? T.up : t.side === "S" ? T.dn : T.ink) : color,
                fontVariantNumeric:  "tabular-nums",
                fontSize:            11,
                textAlign:           "right",
                fontWeight:          isNewest ? 700 : 400,
              }}>
                {t.px.toFixed(2)}
              </span>
              <span style={{ color: T.mid, textAlign: "right", fontSize: 10 }}>
                {t.qty.toLocaleString()}
              </span>
              <span style={{ color: t.side === "B" ? T.up : t.side === "S" ? T.dn : T.soft, fontSize: 9, textAlign: "right", letterSpacing: "0.1em" }}>
                {t.side}
              </span>
            </div>
          );
        })}
      </div>

      {endpointUnavailable && (
        <div style={{
          padding:       "3px 10px",
          borderTop:     `1px solid ${T.rule}`,
          color:         T.soft,
          fontSize:      8,
          letterSpacing: "0.10em",
        }}>
          endpoint unavailable · mock active
        </div>
      )}
    </div>
  );
}
