"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { OhlcvBar } from "@/lib/api";

type EnabledInterval = "1d" | "1w" | "1m";
type RangeKey = "3m" | "6m" | "1y" | "2y" | "all";

const ENABLED_INTERVALS: ReadonlyArray<{ value: EnabledInterval; label: string; note: string }> = [
  { value: "1d", label: "日K", note: "正式日 OHLCV" },
  { value: "1w", label: "週K", note: "由正式日 K 彙整" },
  { value: "1m", label: "月K", note: "由正式日 K 彙整" },
];

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string; days: number | null }> = [
  { value: "3m", label: "3月", days: 92 },
  { value: "6m", label: "6月", days: 184 },
  { value: "1y", label: "1年", days: 370 },
  { value: "2y", label: "2年", days: 740 },
  { value: "all", label: "全部", days: null },
];

const PENDING_INTERVALS = ["1分", "5分", "15分", "60分"];
const MIN_TREND_BARS = 12;

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
  if (daysSince(last.dt) > 5) return `資料偏舊 / ${last.dt}`;
  if (last.source === "tej") return "FinMind/TEJ";
  if (last.source === "kgi") return "KGI";
  return "正式資料";
}

function stateLabel(state: "LIVE" | "EMPTY" | "BLOCKED") {
  if (state === "LIVE") return "真實資料";
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
  if (range === "all") return interval === "1d" ? 720 : interval === "1w" ? 260 : 160;
  if (interval === "1d") return range === "3m" ? 82 : range === "6m" ? 156 : range === "1y" ? 300 : 520;
  if (interval === "1w") return range === "3m" ? 20 : range === "6m" ? 38 : range === "1y" ? 64 : 126;
  return range === "3m" ? 6 : range === "6m" ? 12 : range === "1y" ? 18 : 36;
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
  const [range, setRange] = useState<RangeKey>("all");
  const chartBars = useMemo(() => filterRange(aggregateBars(bars, interval), range), [bars, interval, range]);
  const insufficientTrend = chartBars.length > 0 && chartBars.length < MIN_TREND_BARS;

  useEffect(() => {
    if (!containerRef.current || !chartBars.length || insufficientTrend) return;

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
          height: 368,
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
            barSpacing: interval === "1d" ? 3.6 : interval === "1w" ? 6 : 8,
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
            to: chartBars.length + 4,
          });
        }

        ro = new ResizeObserver((entries) => {
          const nextWidth = entries[0]?.contentRect.width;
          if (nextWidth && chart) chart.applyOptions({ width: nextWidth });
        });
        ro.observe(el);
      } catch {
        setError("K 線圖載入失敗，請稍後重試。");
      }
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      chart?.remove();
      chartRef.current = null;
    };
  }, [chartBars, insufficientTrend, interval, range]);

  const badgeClass = sourceBadgeClass(bars);
  const badgeLabel = sourceBadgeLabel(bars);
  const lastBar = chartBars.at(-1);
  const firstBar = chartBars.at(0);
  const activeMeta = ENABLED_INTERVALS.find((item) => item.value === interval);
  const emptyReason =
    sourceState === "BLOCKED"
      ? `K 線資料暫時無法讀取：${sourceReason}`
      : "此股票目前沒有可用的正式 K 線資料。";

  return (
    <section className="panel hud-frame kline-panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">K 線</span>
          <span className="tg muted"> / </span>
          <span className="tg gold">K 線圖</span>
          <div className="panel-sub">日線、週線、月線與成交量</div>
        </div>
        <div className="tg soft">
          <span className={badgeClass}>{badgeLabel}</span>
          <span style={{ marginLeft: 8 }}>{symbol}</span>
        </div>
      </div>

      <div className="kline-toolbar">
        <div className="kline-control-group">
          {ENABLED_INTERVALS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setInterval(item.value)}
              className="kline-tab"
              style={interval === item.value ? activeButtonStyle : undefined}
              title={item.note}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="kline-control-group">
          {RANGE_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setRange(item.value)}
              className="kline-tab"
              style={range === item.value ? activeButtonStyle : undefined}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kline-pending-line">
        <span className="tg gold">分K</span>
        <span className="tg soft">等待 KGI 唯讀分K/逐筆資料接上：{PENDING_INTERVALS.join(" / ")}</span>
      </div>

      {chartBars.length > 0 && (
        <div className="kline-meta-line">
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
      ) : insufficientTrend ? (
        <KlineInsufficientState
          bars={chartBars}
          intervalLabel={activeMeta?.label ?? "K 線"}
          sourceLabel={badgeLabel}
        />
      ) : (
        <div ref={containerRef} style={{ width: "100%", minHeight: 368 }} />
      )}
    </section>
  );
}

function KlineInsufficientState({
  bars,
  intervalLabel,
  sourceLabel,
}: {
  bars: OhlcvBar[];
  intervalLabel: string;
  sourceLabel: string;
}) {
  const latest = bars.at(-1);
  return (
    <div className="kline-insufficient">
      <div>
        <span className="badge badge-yellow">資料不足</span>
        <h4>目前只有 {bars.length.toLocaleString("zh-TW")} 根正式 K 線，先不畫成趨勢圖。</h4>
        <p>
          此區只使用真實 OHLCV。資料少於 {MIN_TREND_BARS} 根時不拉伸成圖，避免看起來像完整趨勢；
          後端補足歷史資料後，日線、週線與月線會自動恢復完整圖表。
        </p>
      </div>
      <div className="kline-insufficient-meta">
        <div><span>週期</span><b>{intervalLabel}</b></div>
        <div><span>來源</span><b>{sourceLabel}</b></div>
        <div><span>最新</span><b>{latest ? `${latest.dt} / ${formatNumber(latest.close)}` : "--"}</b></div>
      </div>
      <div className="kline-mini-grid">
        {bars.slice(-8).map((bar) => {
          const up = bar.close >= bar.open;
          return (
            <div className="kline-mini-bar" key={`${bar.dt}-${bar.source}`}>
              <span className="tg soft">{bar.dt.slice(5)}</span>
              <b className={up ? "up" : "down"}>{formatNumber(bar.close)}</b>
              <small>高 {formatNumber(bar.high)} / 低 {formatNumber(bar.low)}</small>
              <small>量 {formatNumber(bar.volume, 0)}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const activeButtonStyle: CSSProperties = {
  borderColor: "rgba(226,184,92,0.72)",
  color: "var(--gold-bright)",
  background: "rgba(226,184,92,0.14)",
};
