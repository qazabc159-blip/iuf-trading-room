"use client";

// Client candlestick chart for pre-fetched OHLCV bars.
// Receives pre-fetched OhlcvBar[] from Server Component parent.
// Uses lightweight-charts v5 for candlestick + volume chart.
// TW market convention: up=red (tw-up), down=green (tw-dn).

import { useEffect, useMemo, useRef, useState } from "react";
import type { OhlcvBar } from "@/lib/api";

type EnabledInterval = "1d" | "1w" | "1m";

const ENABLED_INTERVALS: ReadonlyArray<{ value: EnabledInterval; label: string; note: string }> = [
  { value: "1d", label: "日K", note: "正式日線" },
  { value: "1w", label: "週K", note: "由日線彙整" },
  { value: "1m", label: "月K", note: "由日線彙整" },
];

const PENDING_INTERVALS = ["分K", "5分", "15分", "60分"];

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
  return "badge-yellow";
}

function sourceBadgeLabel(bars: OhlcvBar[]): string {
  if (!bars.length) return "無資料";
  const last = bars[bars.length - 1];
  if (daysSince(last.dt) > 5) return `過期 / ${last.dt}`;
  if (last.source === "tej") return "FinMind/TEJ";
  if (last.source === "kgi") return "KGI";
  return "正式資料";
}

function stateLabel(state: "LIVE" | "EMPTY" | "BLOCKED") {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function monthKey(dt: string) {
  return dt.slice(0, 7);
}

function weekKey(dt: string) {
  const date = new Date(`${dt}T00:00:00+08:00`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function aggregateBars(bars: OhlcvBar[], interval: EnabledInterval): OhlcvBar[] {
  if (interval === "1d") return bars;

  const groups = new Map<string, OhlcvBar[]>();
  for (const bar of bars) {
    const key = interval === "1w" ? weekKey(bar.dt) : monthKey(bar.dt);
    groups.set(key, [...(groups.get(key) ?? []), bar]);
  }

  return Array.from(groups.values()).map((items) => {
    const ordered = items.slice().sort((a, b) => a.dt.localeCompare(b.dt));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    return {
      dt: last.dt,
      open: first.open,
      high: Math.max(...ordered.map((bar) => bar.high)),
      low: Math.min(...ordered.map((bar) => bar.low)),
      close: last.close,
      volume: ordered.reduce((sum, bar) => sum + bar.volume, 0),
      source: last.source,
    };
  });
}

function visibleBarsFor(interval: EnabledInterval) {
  if (interval === "1d") return 120;
  if (interval === "1w") return 104;
  return 60;
}

export function OhlcvCandlestickChart({
  bars,
  symbol,
  sourceState,
  sourceReason,
}: {
  bars: OhlcvBar[];
  symbol: string;
  sourceState: "LIVE" | "EMPTY" | "BLOCKED";
  sourceReason: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<import("lightweight-charts").IChartApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<EnabledInterval>("1d");
  const chartBars = useMemo(() => aggregateBars(bars, interval), [bars, interval]);

  useEffect(() => {
    if (!containerRef.current || !chartBars.length) return;

    let chart: import("lightweight-charts").IChartApi | null = null;
    let ro: ResizeObserver | null = null;
    let disposed = false;

    (async () => {
      try {
        const lc = await import("lightweight-charts");
        if (disposed || !containerRef.current) return;

        const el = containerRef.current!;
        const width = el.clientWidth || 800;

        chart = lc.createChart(el, {
          width,
          height: 420,
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
          timeScale: {
            borderColor: "var(--night-rule-strong, #333)",
            timeVisible: true,
            rightOffset: 8,
            barSpacing: interval === "1d" ? 8 : 10,
          },
        });

        chartRef.current = chart;

        const candleSeries = chart.addSeries(lc.CandlestickSeries, {
          upColor: "#e63946",
          downColor: "#2ecc71",
          borderUpColor: "#e63946",
          borderDownColor: "#2ecc71",
          wickUpColor: "#e63946",
          wickDownColor: "#2ecc71",
        });

        const volSeries = chart.addSeries(lc.HistogramSeries, {
          color: "rgba(184,150,12,0.25)",
          priceFormat: { type: "volume" },
          priceScaleId: "vol",
        });
        chart.priceScale("vol").applyOptions({
          scaleMargins: { top: 0.80, bottom: 0 },
        });

        const candleData = chartBars.map((bar) => ({
          time: bar.dt as import("lightweight-charts").Time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        }));

        const volData = chartBars.map((bar) => ({
          time: bar.dt as import("lightweight-charts").Time,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(230,57,70,0.35)" : "rgba(46,204,113,0.35)",
        }));

        candleSeries.setData(candleData);
        volSeries.setData(volData);
        chart.timeScale().fitContent();
        if (chartBars.length > 20) {
          const count = visibleBarsFor(interval);
          chart.timeScale().setVisibleLogicalRange({
            from: Math.max(0, chartBars.length - count),
            to: chartBars.length + 6,
          });
        }

        ro = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width;
          if (width && chart) chart.applyOptions({ width });
        });
        ro.observe(el);
      } catch (error) {
        setError(error instanceof Error ? error.message : "K 線載入失敗");
      }
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      chart?.remove();
      chartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartBars, interval]);

  const badgeClass = sourceBadgeClass(bars);
  const badgeLabel = sourceBadgeLabel(bars);
  const lastBar = chartBars.at(-1);
  const firstBar = chartBars.at(0);
  const activeMeta = ENABLED_INTERVALS.find((item) => item.value === interval);
  const emptyReason =
    sourceState === "BLOCKED"
      ? "K 線資料暫時無法讀取，請稍後重試。"
      : "此股票目前沒有可用的正式 K 線資料。";

  return (
    <section className="panel hud-frame">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[02]</span> K 線
        <span style={{ marginLeft: 12 }}>
          <span className={badgeClass} style={{ fontSize: 10, padding: "1px 6px" }}>
            {badgeLabel}
          </span>
        </span>
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>{symbol}</span>
      </h3>

      <div style={intervalBarStyle}>
        {ENABLED_INTERVALS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setInterval(item.value)}
            style={{
              ...intervalButtonStyle,
              color: interval === item.value ? "var(--gold-bright)" : "var(--night-mid, #888)",
              background: interval === item.value ? "rgba(184,138,62,0.16)" : "transparent",
            }}
            title={item.note}
          >
            {item.label}
          </button>
        ))}
        {PENDING_INTERVALS.map((label) => (
          <span key={label} style={pendingIntervalStyle} title="待即時或分線資料源接上後啟用">
            {label}
          </span>
        ))}
      </div>

      {chartBars.length > 0 && (
        <div style={metaLineStyle}>
          <span>{activeMeta?.note}</span>
          <span>{chartBars.length.toLocaleString("zh-TW")} 根</span>
          <span>{firstBar?.dt} → {lastBar?.dt}</span>
          <span>最新收盤 {lastBar?.close.toLocaleString("zh-TW")}</span>
        </div>
      )}

      {error ? (
        <div className="dim" style={{ padding: "24px 0", fontFamily: "var(--mono)", fontSize: 11 }}>
          {error}
        </div>
      ) : chartBars.length === 0 ? (
        <div className="dim" style={{ padding: "24px 0", fontFamily: "var(--mono)", fontSize: 11 }}>
          <span className={sourceState === "BLOCKED" ? "down" : "gold"}>{stateLabel(sourceState)}</span>{" "}
          {emptyReason}
        </div>
      ) : (
        <div ref={containerRef} style={{ width: "100%", minHeight: 420 }} />
      )}
    </section>
  );
}

const intervalBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
  margin: "4px 0 10px",
};

const intervalButtonStyle: React.CSSProperties = {
  border: "1px solid var(--night-rule-strong, #333)",
  padding: "6px 10px",
  fontFamily: "var(--mono)",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
};

const pendingIntervalStyle: React.CSSProperties = {
  border: "1px solid var(--night-rule, #222)",
  padding: "6px 10px",
  color: "var(--night-soft, #555)",
  fontFamily: "var(--mono)",
  fontSize: 11,
  letterSpacing: "0.08em",
};

const metaLineStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px 14px",
  color: "var(--night-mid, #888)",
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  marginBottom: 8,
};
