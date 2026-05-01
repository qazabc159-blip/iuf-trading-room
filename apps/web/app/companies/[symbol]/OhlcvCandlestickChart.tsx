"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OhlcvBar } from "@/lib/api";

type EnabledInterval = "1d" | "1w" | "1m";
type RangeKey = "3m" | "6m" | "1y" | "2y" | "all";

const ENABLED_INTERVALS: ReadonlyArray<{ value: EnabledInterval; label: string; note: string }> = [
  { value: "1d", label: "日K", note: "每日 OHLCV" },
  { value: "1w", label: "週K", note: "由日K彙整成週線" },
  { value: "1m", label: "月K", note: "由日K彙整成月線" },
];

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string; days: number | null }> = [
  { value: "3m", label: "3月", days: 92 },
  { value: "6m", label: "6月", days: 184 },
  { value: "1y", label: "1年", days: 370 },
  { value: "2y", label: "2年", days: 740 },
  { value: "all", label: "全部", days: null },
];

const PENDING_INTERVALS = ["1分", "5分", "15分", "60分"];

function daysSince(dt: string): number {
  const now = Date.now();
  const then = new Date(`${dt}T13:30:00+08:00`).getTime();
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
  if (daysSince(last.dt) > 5) return `資料過期 / ${last.dt}`;
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
  const orderedBars = bars.slice().sort((a, b) => a.dt.localeCompare(b.dt));
  if (interval === "1d") return orderedBars;

  const groups = new Map<string, OhlcvBar[]>();
  for (const bar of orderedBars) {
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

function filterRange(bars: OhlcvBar[], range: RangeKey) {
  const option = RANGE_OPTIONS.find((item) => item.value === range);
  if (!option?.days || bars.length === 0) return bars;
  const last = bars[bars.length - 1];
  const lastTime = new Date(`${last.dt}T00:00:00+08:00`).getTime();
  const cutoff = lastTime - option.days * 86_400_000;
  return bars.filter((bar) => new Date(`${bar.dt}T00:00:00+08:00`).getTime() >= cutoff);
}

function visibleBarsFor(interval: EnabledInterval, range: RangeKey) {
  if (range === "all") return interval === "1d" ? 260 : interval === "1w" ? 156 : 96;
  if (interval === "1d") return range === "3m" ? 70 : range === "6m" ? 130 : 220;
  if (interval === "1w") return range === "3m" ? 18 : range === "6m" ? 34 : 104;
  return range === "3m" ? 6 : range === "6m" ? 10 : 36;
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
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
  const [range, setRange] = useState<RangeKey>("1y");
  const chartBars = useMemo(() => filterRange(aggregateBars(bars, interval), range), [bars, interval, range]);

  useEffect(() => {
    if (!containerRef.current || !chartBars.length) return;

    let chart: import("lightweight-charts").IChartApi | null = null;
    let ro: ResizeObserver | null = null;
    let disposed = false;

    setError(null);

    (async () => {
      try {
        const lc = await import("lightweight-charts");
        if (disposed || !containerRef.current) return;

        const el = containerRef.current;
        const width = el.clientWidth || 860;

        chart = lc.createChart(el, {
          width,
          height: 480,
          layout: {
            background: { color: "transparent" },
            textColor: "rgba(203,213,225,0.68)",
            fontFamily: "var(--mono, monospace)",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.05)" },
          },
          crosshair: { mode: 1 },
          rightPriceScale: { borderColor: "rgba(255,255,255,0.14)", scaleMargins: { top: 0.08, bottom: 0.22 } },
          timeScale: {
            borderColor: "rgba(255,255,255,0.14)",
            timeVisible: interval === "1d",
            rightOffset: 10,
            barSpacing: interval === "1d" ? 7 : interval === "1w" ? 9 : 12,
            fixLeftEdge: false,
            fixRightEdge: false,
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
          color: "rgba(226,184,92,0.25)",
          priceFormat: { type: "volume" },
          priceScaleId: "vol",
        });
        chart.priceScale("vol").applyOptions({
          scaleMargins: { top: 0.78, bottom: 0 },
        });

        candleSeries.setData(chartBars.map((bar) => ({
          time: bar.dt as import("lightweight-charts").Time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })));

        volSeries.setData(chartBars.map((bar) => ({
          time: bar.dt as import("lightweight-charts").Time,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(230,57,70,0.36)" : "rgba(46,204,113,0.36)",
        })));

        chart.timeScale().fitContent();
        if (chartBars.length > 12) {
          const count = visibleBarsFor(interval, range);
          chart.timeScale().setVisibleLogicalRange({
            from: Math.max(0, chartBars.length - count),
            to: chartBars.length + 8,
          });
        }

        ro = new ResizeObserver((entries) => {
          const nextWidth = entries[0]?.contentRect.width;
          if (nextWidth && chart) chart.applyOptions({ width: nextWidth });
        });
        ro.observe(el);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "K 線圖載入失敗");
      }
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      chart?.remove();
      chartRef.current = null;
    };
  }, [chartBars, interval, range]);

  const badgeClass = sourceBadgeClass(bars);
  const badgeLabel = sourceBadgeLabel(bars);
  const lastBar = chartBars.at(-1);
  const firstBar = chartBars.at(0);
  const activeMeta = ENABLED_INTERVALS.find((item) => item.value === interval);
  const emptyReason =
    sourceState === "BLOCKED"
      ? `K 線資料暫停：${sourceReason}`
      : "此股票目前沒有可用的正式 K 線資料。";

  return (
    <section className="panel hud-frame">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">K-LINE</span>
          <span className="tg muted"> / </span>
          <span className="tg gold">K 線圖</span>
          <div className="panel-sub">日線、週線、月線與成交量</div>
        </div>
        <div className="tg soft">
          <span className={badgeClass} style={{ fontSize: 10, padding: "1px 6px" }}>{badgeLabel}</span>
          <span style={{ marginLeft: 8 }}>{symbol}</span>
        </div>
      </div>

      <div style={toolbarStyle}>
        <div style={controlGroupStyle}>
          {ENABLED_INTERVALS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setInterval(item.value)}
              className="mini-button"
              style={interval === item.value ? activeButtonStyle : undefined}
              title={item.note}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div style={controlGroupStyle}>
          {RANGE_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setRange(item.value)}
              className="mini-button"
              style={range === item.value ? activeButtonStyle : undefined}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div style={pendingLineStyle}>
        <span className="tg gold">分K</span>
        {PENDING_INTERVALS.map((label) => (
          <span key={label} style={pendingIntervalStyle} title="等待 KGI 唯讀分K或逐筆資料來源，不顯示假資料">
            {label}
          </span>
        ))}
        <span className="tg soft">等待 KGI 唯讀分K/逐筆來源；目前不造假。</span>
      </div>

      {chartBars.length > 0 && (
        <div style={metaLineStyle}>
          <span>{activeMeta?.note}</span>
          <span>{chartBars.length.toLocaleString("zh-TW")} 根</span>
          <span>{firstBar?.dt} 至 {lastBar?.dt}</span>
          <span>收盤 {formatNumber(lastBar?.close)}</span>
          <span>量 {formatNumber(lastBar?.volume, 0)}</span>
        </div>
      )}

      {error ? (
        <div className="terminal-note">
          <span className="tg down">暫停</span> {error}
        </div>
      ) : chartBars.length === 0 ? (
        <div className="terminal-note">
          <span className={sourceState === "BLOCKED" ? "down" : "gold"}>{stateLabel(sourceState)}</span>{" "}
          {emptyReason}
        </div>
      ) : (
        <div ref={containerRef} style={{ width: "100%", minHeight: 480 }} />
      )}
    </section>
  );
}

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "space-between",
  gap: 10,
  margin: "4px 0 10px",
};

const controlGroupStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};

const activeButtonStyle: React.CSSProperties = {
  borderColor: "rgba(226,184,92,0.72)",
  color: "var(--gold-bright)",
  background: "rgba(226,184,92,0.14)",
};

const pendingLineStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginBottom: 10,
};

const pendingIntervalStyle: React.CSSProperties = {
  border: "1px solid var(--night-rule, #222)",
  padding: "5px 8px",
  color: "var(--night-soft, #555)",
  fontFamily: "var(--mono)",
  fontSize: 10,
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
