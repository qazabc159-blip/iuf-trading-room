"use client";

/**
 * OhlcvCandlestickChart — D1 company detail chart (Client Component)
 *
 * Consumes OhlcvBar[] (passed from Server Component as props) and renders
 * a candlestick chart via lightweight-charts. No fetch inside this component —
 * data is fetched server-side and passed in. Falls back gracefully to empty state.
 *
 * Source badge logic:
 *   - "kgi"  → badge-green  (live KGI data)
 *   - "mock" → badge-yellow (deterministic mock)
 *   - "tej"  → badge        (TEJ data)
 *   - stale  → badge-red when last bar dt > STALE_DAYS trading days ago
 */

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import type { OhlcvBar } from "@/lib/api";

const STALE_DAYS = 5;

function daysSince(dt: string): number {
  const ms = Date.now() - new Date(dt).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function isStale(bars: OhlcvBar[]): boolean {
  if (bars.length === 0) return false;
  const last = bars[bars.length - 1];
  return daysSince(last.dt) > STALE_DAYS;
}

function sourceBadgeClass(bars: OhlcvBar[]): string {
  if (bars.length === 0) return "badge";
  if (isStale(bars)) return "badge-red";
  const src = bars[bars.length - 1].source;
  if (src === "kgi") return "badge-green";
  if (src === "mock") return "badge-yellow";
  return "badge";
}

function sourceBadgeLabel(bars: OhlcvBar[]): string {
  if (bars.length === 0) return "NO DATA";
  if (isStale(bars)) return "STALE";
  const src = bars[bars.length - 1].source;
  if (src === "kgi") return "KGI-ORIGIN";
  if (src === "mock") return "MOCK";
  if (src === "tej") return "TEJ";
  return "UNKNOWN";
}

function cssVar(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export function OhlcvCandlestickChart({ bars }: { bars: OhlcvBar[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeRef = useRef<ISeriesApi<SeriesType> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: cssVar("--night") || "#0a0a0f" },
        textColor: cssVar("--night-mid") || "#888",
        fontFamily: cssVar("--font-mono") || "monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: cssVar("--night-rule") || "#1e1e2e", style: 1 },
        horzLines: { color: cssVar("--night-rule") || "#1e1e2e", style: 1 },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: cssVar("--night-rule-strong") || "#2a2a3e",
      },
      timeScale: {
        borderColor: cssVar("--night-rule-strong") || "#2a2a3e",
        timeVisible: false,
      },
      height: 320,
    });

    // Volume pane — slim histogram behind candlesticks
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: cssVar("--night-rule-strong") || "#2a2a3e",
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.80, bottom: 0 },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: cssVar("--tw-up") || "#e63946",
      downColor: cssVar("--tw-dn") || "#2ecc71",
      borderUpColor: cssVar("--tw-up") || "#e63946",
      borderDownColor: cssVar("--tw-dn") || "#2ecc71",
      wickUpColor: cssVar("--tw-up") || "#e63946",
      wickDownColor: cssVar("--tw-dn") || "#2ecc71",
    });

    if (bars.length > 0) {
      const candleData = bars.map((b) => ({
        time: b.dt as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
      const volumeData = bars.map((b) => ({
        time: b.dt as Time,
        value: b.volume,
        color: b.close >= b.open
          ? (cssVar("--tw-up-faint") || "rgba(230,57,70,0.2)")
          : (cssVar("--tw-dn-faint") || "rgba(46,204,113,0.2)"),
      }));
      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);
      chart.timeScale().fitContent();
    }

    chartRef.current = chart;
    candleRef.current = candleSeries;
    volumeRef.current = volumeSeries;

    const observer = new ResizeObserver(() => {
      if (el) {
        chart.applyOptions({ width: el.clientWidth });
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, [bars]);

  const badgeClass = sourceBadgeClass(bars);
  const badgeLabel = sourceBadgeLabel(bars);
  const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span className={badgeClass}>{badgeLabel}</span>
        {lastBar && (
          <span className="dim" style={{ fontSize: 11 }}>
            last bar · {lastBar.dt}
          </span>
        )}
        {bars.length === 0 && (
          <span className="dim" style={{ fontSize: 11 }}>no OHLCV data available</span>
        )}
      </div>
      <div
        ref={containerRef}
        style={{ width: "100%", height: 320, background: "var(--night, #0a0a0f)" }}
      />
    </div>
  );
}
