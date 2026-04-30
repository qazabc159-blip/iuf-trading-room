"use client";

// OhlcvCandlestickChart.tsx — Client Component
// Receives pre-fetched OhlcvBar[] from Server Component parent.
// Uses lightweight-charts v5 for candlestick + volume chart.
// TW market convention: up=red (tw-up), down=green (tw-dn).

import { useEffect, useRef, useState } from "react";
import type { OhlcvBar } from "@/lib/api";

// Source badge helpers
function daysSince(dt: string): number {
  const now = Date.now();
  const then = new Date(dt).getTime();
  return Math.floor((now - then) / 86_400_000);
}

function sourceBadgeClass(bars: OhlcvBar[]): string {
  if (!bars.length) return "badge-red";
  const last = bars[bars.length - 1];
  if (daysSince(last.dt) > 5) return "badge-red";
  if (last.source === "kgi") return "badge-green";
  if (last.source === "tej") return "badge";
  return "badge-yellow"; // mock
}

function sourceBadgeLabel(bars: OhlcvBar[]): string {
  if (!bars.length) return "NO DATA";
  const last = bars[bars.length - 1];
  if (daysSince(last.dt) > 5) return `STALE · ${last.dt}`;
  return last.source.toUpperCase();
}

export function OhlcvCandlestickChart({ bars, symbol }: { bars: OhlcvBar[]; symbol: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<import("lightweight-charts").IChartApi | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !bars.length) return;

    let chart: import("lightweight-charts").IChartApi | null = null;

    (async () => {
      try {
        const lc = await import("lightweight-charts");

        const el = containerRef.current!;
        const width = el.clientWidth || 800;

        chart = lc.createChart(el, {
          width,
          height: 320,
          layout: {
            background: { color: "transparent" },
            textColor: "var(--night-mid, #888)",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.04)" },
          },
          crosshair: { mode: 1 },
          rightPriceScale: { borderColor: "var(--night-rule-strong, #333)" },
          timeScale: { borderColor: "var(--night-rule-strong, #333)", timeVisible: true },
        });

        chartRef.current = chart;

        // Candlestick — TW convention: up=red (tw-up), down=green (tw-dn)
        const candleSeries = chart.addSeries(lc.CandlestickSeries, {
          upColor:          "#e63946",
          downColor:        "#2ecc71",
          borderUpColor:   "#e63946",
          borderDownColor: "#2ecc71",
          wickUpColor:     "#e63946",
          wickDownColor:   "#2ecc71",
        });

        // Volume — separate price scale
        const volSeries = chart.addSeries(lc.HistogramSeries, {
          color: "rgba(184,150,12,0.25)",
          priceFormat: { type: "volume" },
          priceScaleId: "vol",
        });
        chart.priceScale("vol").applyOptions({
          scaleMargins: { top: 0.80, bottom: 0 },
        });

        const candleData = bars.map((b) => ({
          time: b.dt as import("lightweight-charts").Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }));

        const volData = bars.map((b) => ({
          time: b.dt as import("lightweight-charts").Time,
          value: b.volume,
          color: b.close >= b.open ? "rgba(230,57,70,0.35)" : "rgba(46,204,113,0.35)",
        }));

        candleSeries.setData(candleData);
        volSeries.setData(volData);
        chart.timeScale().fitContent();

        // Responsive resize
        const ro = new ResizeObserver((entries) => {
          const w = entries[0]?.contentRect.width;
          if (w && chart) chart.applyOptions({ width: w });
        });
        ro.observe(el);

        return () => {
          ro.disconnect();
          chart?.remove();
          chartRef.current = null;
        };
      } catch (e) {
        setError(e instanceof Error ? e.message : "Chart error");
      }
    })();

    return () => {
      chart?.remove();
      chartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars]);

  const badgeClass = sourceBadgeClass(bars);
  const badgeLabel = sourceBadgeLabel(bars);

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[02]</span> K 線圖
        <span style={{ marginLeft: 12 }}>
          <span className={badgeClass} style={{ fontSize: 10, padding: "1px 6px" }}>
            {badgeLabel}
          </span>
        </span>
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>{symbol}</span>
      </h3>

      {error ? (
        <div className="dim" style={{ padding: "24px 0", fontFamily: "var(--mono)", fontSize: 11 }}>
          [CHART ERROR] {error}
        </div>
      ) : bars.length === 0 ? (
        <div className="dim" style={{ padding: "24px 0", fontFamily: "var(--mono)", fontSize: 11 }}>
          NO DATA — K 線資料尚未載入
        </div>
      ) : (
        <div ref={containerRef} style={{ width: "100%", minHeight: 320 }} />
      )}
    </section>
  );
}
