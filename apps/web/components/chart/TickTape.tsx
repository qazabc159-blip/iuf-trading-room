"use client";

import { useEffect, useRef } from "react";
import { useReadOnlyQuote } from "@/lib/use-readonly-quote";

interface Tick {
  ts: number;
  px: number;
  qty: number;
  side: "B" | "S" | "U";
}

interface TickTapeProps {
  symbol: string;
  lastPx: number;
}

function buildDevTicks(symbol: string, lastPx: number, count = 30): Tick[] {
  const seed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const ticks: Tick[] = [];
  let px = lastPx;
  const now = Date.now();

  for (let i = count; i >= 0; i--) {
    const r = ((seed * (i + 7) * 1664525 + 1013904223) & 0xffffffff) >>> 0;
    const pct = (r % 100) / 10000;
    px = Number((px * (1 + (r % 2 === 0 ? pct : -pct))).toFixed(2));
    const qty = 1000 * ((r % 50) + 1);
    const side = r % 3 === 0 ? "B" : r % 3 === 1 ? "S" : "U";
    ticks.push({ ts: now - i * 3000, px, qty, side });
  }
  return ticks.reverse();
}

const T = {
  up: "#e63946",
  dn: "#2ecc71",
  mid: "#9a937e",
  soft: "#6b6553",
  rule: "rgba(232,223,200,0.08)",
  ruleS: "rgba(232,223,200,0.22)",
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

  const displayTicks: Tick[] = liveTicks.length > 0
    ? liveTicks.map((t) => ({
        ts: new Date(t.ts).getTime(),
        px: t.price,
        qty: t.qty,
        side: "U" as const,
      }))
    : source === "mock" && !endpointUnavailable
    ? buildDevTicks(symbol, lastPx)
    : [];

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [displayTicks]);

  const sourceLabel = endpointUnavailable
    ? "BLOCKED"
    : source === "live"
    ? "LIVE"
    : "MOCK";
  const sourceLabelColor = endpointUnavailable
    ? "#e63946"
    : source === "live"
    ? "#00c96a"
    : "rgba(184,138,62,0.5)";
  const sourceTooltip = endpointUnavailable
    ? "KGI tick endpoint is blocked or unreachable; no synthetic tick tape is rendered."
    : source === "live"
    ? `Live ticks from GET /api/v1/kgi/quote/ticks?symbol=${symbol}`
    : "Development mock ticks because NEXT_PUBLIC_API_BASE_URL is not set.";

  return (
    <div style={{ fontFamily: T.mono }}>
      <div style={{
        padding: "5px 10px",
        borderBottom: `1px solid ${T.ruleS}`,
        color: T.soft,
        letterSpacing: "0.14em",
        fontSize: 9,
        textTransform: "uppercase",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span>RECENT / TICKS</span>
        <span
          title={sourceTooltip}
          style={{ color: sourceLabelColor, cursor: "help", transition: "color 100ms ease-out" }}
        >
          [{sourceLabel}]
        </span>
      </div>

      <div
        ref={listRef}
        style={{
          maxHeight: 240,
          overflowY: "auto",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(184,138,62,0.3) transparent",
        }}
      >
        {displayTicks.length > 0 ? (
          displayTicks.map((t, i) => {
            const color = t.side === "B" ? T.up : t.side === "S" ? T.dn : T.mid;
            return (
              <div key={i} style={{
                display: "grid",
                gridTemplateColumns: "60px 1fr 1fr 16px",
                padding: "2px 10px",
                borderBottom: `1px solid ${T.rule}`,
                alignItems: "center",
              }}>
                <span style={{ color: T.soft, fontSize: 9 }}>{fmtTime(t.ts)}</span>
                <span style={{ color, fontVariantNumeric: "tabular-nums", fontSize: 11, textAlign: "right" }}>
                  {t.px.toFixed(2)}
                </span>
                <span style={{ color: T.mid, textAlign: "right", fontSize: 10 }}>
                  {t.qty.toLocaleString()}
                </span>
                <span style={{ color, fontSize: 9, textAlign: "right", letterSpacing: "0.1em" }}>
                  {t.side}
                </span>
              </div>
            );
          })
        ) : (
          <div style={{ padding: "12px 10px", color: T.soft, fontSize: 9, letterSpacing: "0.10em" }}>
            KGI ticks are blocked or unavailable; synthetic tick rows are hidden.
          </div>
        )}
      </div>

      {endpointUnavailable && (
        <div style={{
          padding: "3px 10px",
          borderTop: `1px solid ${T.rule}`,
          color: T.soft,
          fontSize: 8,
          letterSpacing: "0.10em",
        }}>
          endpoint unavailable / no synthetic ticks
        </div>
      )}
    </div>
  );
}
