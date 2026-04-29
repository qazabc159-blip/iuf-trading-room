/**
 * Chart abstraction — the swappable point.
 *
 * Phase 1 (NOW):  TradingViewChart        — embedded widget, instant.
 * Phase 2 (LATER): KgiLightweightChart    — own chart + KGI gateway WS.
 *
 * Components consume <Chart {...props}/>. To swap providers, change
 * NEXT_PUBLIC_CHART_PROVIDER in .env. The component contract (ChartProps)
 * stays identical — that's the whole point of this file.
 */
"use client";

import { useEffect, useRef } from "react";
import type { ChartProps } from "@/lib/radar-types";

const provider =
  (process.env.NEXT_PUBLIC_CHART_PROVIDER as "tradingview" | "kgi-lightweight") ??
  "tradingview";

/* ─── Public API ─────────────────────────────────────────────────────── */
export function Chart(props: ChartProps) {
  if (provider === "kgi-lightweight") return <KgiLightweightChart {...props} />;
  return <TradingViewChart {...props} />;
}

/* ─── Provider 1 · TradingView Advanced Chart widget ─────────────────── */
/* Docs: https://www.tradingview.com/widget/advanced-chart/             */
function TradingViewChart({
  symbol,
  interval = "1d",
  timezone = "Asia/Taipei",
  height = 520,
  onReady,
  onError,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSymbol = toTradingViewSymbol(symbol);
  const tvInterval = toTradingViewInterval(interval);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = ""; // reset on prop change

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    // TV widget is a black box — we can't subscribe to ticks. onReady fires
    // when the embed script loads; onTickStream is a no-op for this provider.
    script.onload = () => onReady?.();
    script.onerror = () => onError?.(new Error("TradingView script failed to load"));
    script.innerHTML = JSON.stringify({
      symbol: tvSymbol,
      interval: tvInterval,
      timezone,
      theme: "dark",
      style: "1",                       // 1 = candles
      locale: "zh_TW",
      enable_publishing: false,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      withdateranges: true,
      details: false,
      autosize: true,
      "backgroundColor": "rgba(10, 12, 16, 1)",
      "gridColor": "rgba(220, 228, 240, 0.06)",
      "support_host": "https://www.tradingview.com",
    });

    containerRef.current.appendChild(script);
  }, [tvSymbol, tvInterval, timezone, onReady, onError]);

  return (
    <div style={{ height, width: "100%", position: "relative" }}>
      <div className="tradingview-widget-container" ref={containerRef} style={{ height: "100%" }}>
        <div className="tradingview-widget-container__widget" style={{ height: "100%", width: "100%" }} />
      </div>
    </div>
  );
}

/** TWSE 2330 → "TWSE:2330" — adjust here if you use other prefixes (TPE: / TPEX:) */
function toTradingViewSymbol(symbol: string): string {
  if (symbol.includes(":")) return symbol;          // pre-formatted
  if (/^\d{4,6}$/.test(symbol)) return `TWSE:${symbol}`;
  return symbol;
}

function toTradingViewInterval(i: NonNullable<ChartProps["interval"]>): string {
  return ({ "1m":"1","5m":"5","15m":"15","1h":"60","1d":"D","1wk":"W" } as const)[i];
}

/* ─── Provider 2 · KGI gateway + lightweight-charts (PLACEHOLDER) ────── */
/*
 * Implementation plan (Path B Phase 2):
 *   1. `npm i lightweight-charts`  (TradingView's open-source chart, no logo)
 *   2. Connect WebSocket to NEXT_PUBLIC_KGI_QUOTE_WS (KGI gateway).
 *   3. On message: append to candle series via series.update().
 *   4. Historical bars via REST: GET /api/quotes/:symbol/bars?interval=&from=&to=
 *   5. Apply tokens.css colors directly — the chart will fully match exec layer.
 */
function KgiLightweightChart({ symbol, height = 520, liveStreamUrl }: ChartProps) {
  return (
    <div style={{
      height, width: "100%", display: "grid", placeItems: "center",
      background: "var(--exec-bg-1)", border: "1px solid var(--exec-rule-strong)",
      color: "var(--exec-mid)", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.18em",
      textAlign: "center", padding: 20,
    }}>
      <div>
        <div style={{ color: "var(--gold-bright)", fontWeight: 700, marginBottom: 8 }}>
          ● KGI · LIGHTWEIGHT CHART · NOT YET IMPLEMENTED
        </div>
        <div style={{ color: "var(--exec-mid)", fontFamily: "var(--mono)", lineHeight: 1.7 }}>
          symbol={symbol} · stream={liveStreamUrl ?? "(unset)"}<br/>
          See src/components/Chart.tsx — Phase 2 plan in comments.
        </div>
      </div>
    </div>
  );
}
