"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FinMindKBarRow, OhlcvBar } from "@/lib/api";

type EnabledInterval = "1d" | "1w" | "1mo" | "1min" | "5min" | "15min" | "60min";
type RangeKey = "3m" | "6m" | "1y" | "2y" | "all";
type IntradayRangeKey = "1d" | "5d" | "10d" | "20d";
type ChartTime = import("lightweight-charts").Time;
type ChartBar = {
  dt: string;
  label: string;
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: "tej" | "kgi" | "finmind-kbar";
};

const ENABLED_INTERVALS: ReadonlyArray<{ value: EnabledInterval; label: string; note: string; kind: "daily" | "intraday"; minutes?: number }> = [
  { value: "1d", label: "日K", note: "正式 OHLCV", kind: "daily" },
  { value: "1w", label: "週K", note: "日 K 彙整週線", kind: "daily" },
  { value: "1mo", label: "月K", note: "日 K 彙整月線", kind: "daily" },
  { value: "1min", label: "1分", note: "FinMind Sponsor 分 K", kind: "intraday", minutes: 1 },
  { value: "5min", label: "5分", note: "1 分 K 彙整", kind: "intraday", minutes: 5 },
  { value: "15min", label: "15分", note: "1 分 K 彙整", kind: "intraday", minutes: 15 },
  { value: "60min", label: "60分", note: "1 分 K 彙整", kind: "intraday", minutes: 60 },
];

const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string; days: number | null }> = [
  { value: "3m", label: "3月", days: 92 },
  { value: "6m", label: "6月", days: 184 },
  { value: "1y", label: "1年", days: 370 },
  { value: "2y", label: "2年", days: 740 },
  { value: "all", label: "全部", days: null },
];

const INTRADAY_RANGE_OPTIONS: ReadonlyArray<{ value: IntradayRangeKey; label: string; days: number }> = [
  { value: "1d", label: "1日", days: 1 },
  { value: "5d", label: "5日", days: 5 },
  { value: "10d", label: "10日", days: 10 },
  { value: "20d", label: "20日", days: 20 },
];

const MIN_TREND_BARS = 12;
const COMPRESSED_INTRADAY_BASE_TIME = Math.floor(Date.UTC(2026, 0, 5, 1, 0, 0) / 1000);

function daysSince(dt: string): number {
  const now = Date.now();
  const then = new Date(`${dt}T13:30:00+08:00`).getTime();
  return Math.floor((now - then) / 86_400_000);
}

function sourceBadgeClass(bars: OhlcvBar[]): string {
  if (!bars.length) return "badge-red";
  const last = bars[bars.length - 1];
  if (daysSince(last.dt) > 5) return "badge-red";
  return "badge-green";
}

function sourceBadgeLabel(bars: OhlcvBar[]): string {
  if (!bars.length) return "無資料";
  const last = bars[bars.length - 1];
  if (daysSince(last.dt) > 5) return `資料偏舊 / ${last.dt}`;
  if (last.source === "tej") return "FinMind / TEJ";
  if (last.source === "kgi") return "KGI";
  return "正式資料";
}

function stateLabel(state: "LIVE" | "EMPTY" | "BLOCKED") {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "無法顯示";
}

function stateToneClass(state: "LIVE" | "EMPTY" | "BLOCKED") {
  if (state === "LIVE") return "state-ok";
  if (state === "BLOCKED") return "state-bad";
  return "gold";
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

function toDailyChartBar(bar: OhlcvBar): ChartBar {
  return {
    ...bar,
    label: bar.dt,
    time: bar.dt as ChartTime,
    source: bar.source === "kgi" ? "kgi" : "tej",
  };
}

function aggregateDailyBars(bars: OhlcvBar[], interval: EnabledInterval): ChartBar[] {
  const orderedBars = bars.slice().sort((a, b) => a.dt.localeCompare(b.dt));
  if (interval === "1d") return orderedBars.map(toDailyChartBar);

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
      source: last.source === "kgi" ? "kgi" : "tej",
      label: last.dt,
      time: last.dt as ChartTime,
    };
  });
}

function kbarTimestamp(row: FinMindKBarRow): number {
  return Math.floor(new Date(`${row.date}T${row.minute}+08:00`).getTime() / 1000);
}

function kbarBucketKey(row: FinMindKBarRow, minutes: number): string {
  const [hour = "0", minute = "0"] = row.minute.split(":");
  const rawMinute = Number(hour) * 60 + Number(minute);
  const bucketMinute = Math.floor(rawMinute / minutes) * minutes;
  const hh = String(Math.floor(bucketMinute / 60)).padStart(2, "0");
  const mm = String(bucketMinute % 60).padStart(2, "0");
  return `${row.date}T${hh}:${mm}:00+08:00`;
}

function aggregateKBarRows(rows: FinMindKBarRow[], minutes: number): ChartBar[] {
  const orderedRows = rows
    .filter((row) => row.date && row.minute)
    .slice()
    .sort((a, b) => kbarTimestamp(a) - kbarTimestamp(b));

  const groups = new Map<string, FinMindKBarRow[]>();
  for (const row of orderedRows) {
    const key = kbarBucketKey(row, minutes);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const ordered = items.slice().sort((a, b) => kbarTimestamp(a) - kbarTimestamp(b));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    return {
      dt: key.slice(0, 16).replace("T", " "),
      label: key.slice(5, 16).replace("T", " "),
      time: Math.floor(new Date(key).getTime() / 1000) as ChartTime,
      open: first.open,
      high: Math.max(...ordered.map((row) => row.high)),
      low: Math.min(...ordered.map((row) => row.low)),
      close: last.close,
      volume: ordered.reduce((sum, row) => sum + row.volume, 0),
      source: "finmind-kbar",
    };
  });
}

function filterIntradayTradingDays(bars: ChartBar[], range: IntradayRangeKey): ChartBar[] {
  const option = INTRADAY_RANGE_OPTIONS.find((item) => item.value === range);
  if (!option || bars.length === 0) return bars;

  const tradingDates = Array.from(new Set(bars.map((bar) => bar.dt.slice(0, 10)))).sort();
  const keepDates = new Set(tradingDates.slice(-option.days));
  return bars.filter((bar) => keepDates.has(bar.dt.slice(0, 10)));
}

function compressIntradayTimeline(bars: ChartBar[], minutes: number): ChartBar[] {
  return bars.map((bar, index) => ({
    ...bar,
    // Lightweight Charts treats real timestamps as wall-clock time, so multi-day minute K gets
    // squeezed by overnight/weekend gaps. This synthetic axis keeps real OHLC + labels but removes
    // non-trading empty time from the visible spacing.
    time: (COMPRESSED_INTRADAY_BASE_TIME + index * minutes * 60) as ChartTime,
  }));
}

function filterRange(bars: ChartBar[], range: RangeKey) {
  const option = RANGE_OPTIONS.find((item) => item.value === range);
  if (!option?.days || bars.length === 0) return bars;
  const last = bars[bars.length - 1];
  const lastTime = typeof last.time === "number"
    ? last.time * 1000
    : new Date(`${last.dt.slice(0, 10)}T00:00:00+08:00`).getTime();
  const cutoff = lastTime - option.days * 86_400_000;
  return bars.filter((bar) => {
    const time = typeof bar.time === "number"
      ? bar.time * 1000
      : new Date(`${bar.dt.slice(0, 10)}T00:00:00+08:00`).getTime();
    return time >= cutoff;
  });
}

function visibleBarsFor(interval: EnabledInterval, range: RangeKey) {
  if (interval.endsWith("min")) return interval === "1min" ? 320 : interval === "5min" ? 280 : interval === "15min" ? 150 : 90;
  if (range === "all") return interval === "1d" ? 720 : interval === "1w" ? 260 : 160;
  if (interval === "1d") return range === "3m" ? 92 : range === "6m" ? 184 : range === "1y" ? 320 : 560;
  if (interval === "1w") return range === "3m" ? 24 : range === "6m" ? 44 : range === "1y" ? 72 : 132;
  return range === "3m" ? 8 : range === "6m" ? 14 : range === "1y" ? 24 : 42;
}

function formatChartAxisTime(time: ChartTime, labels: Map<number, string>, nearestLabels?: { baseTime: number; stepSeconds: number; labels: string[] }): string {
  if (typeof time === "number") {
    const exact = labels.get(time);
    if (exact) return exact;
    if (nearestLabels && nearestLabels.labels.length > 0) {
      const index = Math.max(
        0,
        Math.min(
          nearestLabels.labels.length - 1,
          Math.round((time - nearestLabels.baseTime) / nearestLabels.stepSeconds),
        ),
      );
      return nearestLabels.labels[index] ?? nearestLabels.labels[nearestLabels.labels.length - 1] ?? "--";
    }
    return new Date(time * 1000).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (typeof time === "string") return time;
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function signedNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })}`;
}

function toneClass(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

export function OhlcvCandlestickChart({
  bars,
  kbarRows = [],
  kbarState = "EMPTY",
  kbarReason = "FinMind 分 K 尚未回傳資料。",
  kbarDate,
  symbol,
  sourceState,
  sourceReason,
}: {
  bars: OhlcvBar[];
  kbarRows?: FinMindKBarRow[];
  kbarState?: "LIVE" | "EMPTY" | "BLOCKED";
  kbarReason?: string;
  kbarDate?: string;
  symbol: string;
  sourceState: "LIVE" | "EMPTY" | "BLOCKED";
  sourceReason: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<import("lightweight-charts").IChartApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<EnabledInterval>("1d");
  const [range, setRange] = useState<RangeKey>("all");
  const [intradayRange, setIntradayRange] = useState<IntradayRangeKey>("1d");
  const [hoverBar, setHoverBar] = useState<ChartBar | null>(null);
  const activeMeta = ENABLED_INTERVALS.find((item) => item.value === interval);
  const isIntraday = activeMeta?.kind === "intraday";
  const chartHeight = isIntraday ? 460 : 440;
  const activeIntradayMinutes = activeMeta?.kind === "intraday" ? activeMeta.minutes ?? 1 : 1;
  const chartBars = useMemo(() => {
    const meta = ENABLED_INTERVALS.find((item) => item.value === interval);
    if (meta?.kind === "intraday") {
      const minutes = meta.minutes ?? 1;
      const aggregated = aggregateKBarRows(kbarRows, minutes);
      const ranged = filterIntradayTradingDays(aggregated, intradayRange);
      return compressIntradayTimeline(ranged, minutes);
    }
    return filterRange(aggregateDailyBars(bars, interval), range);
  }, [bars, interval, intradayRange, kbarRows, range]);
  const insufficientTrend = !isIntraday && chartBars.length > 0 && chartBars.length < MIN_TREND_BARS;

  const selectInterval = (nextInterval: EnabledInterval) => {
    const nextMeta = ENABLED_INTERVALS.find((item) => item.value === nextInterval);
    setInterval(nextInterval);
    setHoverBar(null);
    if (nextMeta?.kind === "intraday" && activeMeta?.kind !== "intraday") {
      setIntradayRange("1d");
    }
  };

  useEffect(() => {
    setHoverBar(null);
  }, [chartBars]);

  useEffect(() => {
    if (!containerRef.current || !chartBars.length || insufficientTrend) return;

    let chart: import("lightweight-charts").IChartApi | null = null;
    let ro: ResizeObserver | null = null;
    let disposed = false;
    const intradayAxisLabels = new Map<number, string>(
      isIntraday
        ? chartBars
            .filter((bar): bar is ChartBar & { time: number } => typeof bar.time === "number")
            .map((bar) => [bar.time, bar.label])
        : [],
    );
    const nearestIntradayLabels = isIntraday
      ? {
          baseTime: COMPRESSED_INTRADAY_BASE_TIME,
          stepSeconds: activeIntradayMinutes * 60,
          labels: chartBars.map((bar) => bar.label),
        }
      : undefined;

    setError(null);

    (async () => {
      try {
        const lc = await import("lightweight-charts");
        if (disposed || !containerRef.current) return;

        const el = containerRef.current;
        const width = el.clientWidth || 860;

        chart = lc.createChart(el, {
          width,
          height: chartHeight,
          layout: {
            background: { color: "transparent" },
            textColor: "rgba(203,213,225,0.68)",
            fontFamily: "var(--mono, monospace)",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.05)" },
          },
          localization: {
            timeFormatter: (time: ChartTime) => formatChartAxisTime(time, intradayAxisLabels, nearestIntradayLabels),
          },
          crosshair: { mode: 1 },
          rightPriceScale: { borderColor: "rgba(255,255,255,0.14)", scaleMargins: { top: 0.08, bottom: 0.22 } },
          timeScale: {
            borderColor: "rgba(255,255,255,0.14)",
            timeVisible: isIntraday || interval === "1d",
            tickMarkFormatter: (time: ChartTime) => formatChartAxisTime(time, intradayAxisLabels, nearestIntradayLabels),
            rightOffset: 10,
            barSpacing: isIntraday ? 5.8 : interval === "1d" ? 3.6 : interval === "1w" ? 6 : 8,
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
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        })));

        volSeries.setData(chartBars.map((bar) => ({
          time: bar.time,
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(230,57,70,0.36)" : "rgba(46,204,113,0.36)",
        })));

        const barsByTime = new Map(chartBars.map((bar) => [String(bar.time), bar]));
        chart.subscribeCrosshairMove((param) => {
          if (disposed) return;
          const nextBar = param.time ? barsByTime.get(String(param.time)) ?? null : null;
          setHoverBar(nextBar);
        });

        const latestBar = chartBars.at(-1);
        if (latestBar) {
          candleSeries.createPriceLine({
            price: latestBar.close,
            color: latestBar.close >= (chartBars.at(-2)?.close ?? latestBar.open) ? "#e63946" : "#2ecc71",
            lineWidth: 1,
            lineStyle: lc.LineStyle.Solid,
            axisLabelVisible: true,
            title: isIntraday ? "分K 最新" : "最新",
          });
        }

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
        setError("K 線圖載入失敗，請稍後重整。");
      }
    })();

    return () => {
      disposed = true;
      ro?.disconnect();
      chart?.remove();
      chartRef.current = null;
    };
  }, [activeIntradayMinutes, chartBars, chartHeight, insufficientTrend, interval, isIntraday, range]);

  const badgeClass = isIntraday
    ? kbarState === "LIVE" ? "badge-green" : kbarState === "BLOCKED" ? "badge-red" : "badge-yellow"
    : sourceBadgeClass(bars);
  const badgeLabel = isIntraday
    ? kbarState === "LIVE" ? "FinMind 分K" : kbarState === "BLOCKED" ? "分K 無法顯示" : "分K 無資料"
    : sourceBadgeLabel(bars);
  const lastBar = chartBars.at(-1);
  const firstBar = chartBars.at(0);
  const previousBar = chartBars.length >= 2 ? chartBars[chartBars.length - 2] : null;
  const readoutBar = hoverBar ?? lastBar;
  const priceChange = lastBar && previousBar ? Number((lastBar.close - previousBar.close).toFixed(2)) : null;
  const readoutChange = readoutBar ? Number((readoutBar.close - readoutBar.open).toFixed(2)) : priceChange;
  const priceChangePct = previousBar && previousBar.close > 0 && priceChange !== null
    ? Number(((priceChange / previousBar.close) * 100).toFixed(2))
    : null;
  const highInView = chartBars.length ? Math.max(...chartBars.map((bar) => bar.high)) : null;
  const lowInView = chartBars.length ? Math.min(...chartBars.map((bar) => bar.low)) : null;
  const kbarTradingDays = new Set(kbarRows.map((row) => row.date).filter(Boolean)).size;
  const displayedIntradayDays = isIntraday
    ? new Set(chartBars.map((bar) => bar.dt.slice(0, 10))).size
    : 0;
  const lastDisplayedIntradayDate = isIntraday ? chartBars.at(-1)?.dt.slice(0, 10) : null;
  const displayedIntradayRawRows = isIntraday && lastDisplayedIntradayDate
    ? kbarRows.filter((row) => new Set(chartBars.map((bar) => bar.dt.slice(0, 10))).has(row.date)).length
    : 0;
  const emptyReason =
    isIntraday
      ? kbarState === "BLOCKED"
        ? `分 K 資料暫時無法讀取：${kbarReason}`
        : `FinMind ${kbarDate ?? ""} 分 K 目前沒有回傳資料。`
      : sourceState === "BLOCKED"
        ? `K 線資料暫時無法讀取：${sourceReason}`
        : "正式日 K 目前沒有可用資料。";
  const activeState = isIntraday ? kbarState : sourceState;
  const dailyIntervals = ENABLED_INTERVALS.filter((item) => item.kind === "daily");
  const intradayIntervals = ENABLED_INTERVALS.filter((item) => item.kind === "intraday");

  return (
    <section className="panel hud-frame kline-panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">K線</span>
          <span className="tg muted"> / </span>
          <span className="tg gold">K 線圖</span>
          <div className="panel-sub">日線、週線、月線與 FinMind 分 K；右側價格軸可直接讀價。</div>
        </div>
        <div className="tg soft">
          <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
          <span className="kline-symbol-chip">{symbol}</span>
        </div>
      </div>

      {lastBar && (
        <div className="kline-snapshot-strip">
          <div>
            <span>最新收盤</span>
            <b className={`num ${toneClass(priceChange)}`}>{formatNumber(lastBar.close)}</b>
            <small>{lastBar.label}</small>
          </div>
          <div>
            <span>漲跌</span>
            <b className={`num ${toneClass(priceChange)}`}>
              {signedNumber(priceChange)} / {signedNumber(priceChangePct)}%
            </b>
            <small>{previousBar ? `前值 ${formatNumber(previousBar.close)}` : "前值不足"}</small>
          </div>
          <div>
            <span>區間高低</span>
            <b className="num">{formatNumber(highInView)} / {formatNumber(lowInView)}</b>
            <small>{activeMeta?.label ?? "K 線"} 顯示範圍</small>
          </div>
          <div>
            <span>成交量</span>
            <b className="num">{formatNumber(lastBar.volume, 0)}</b>
            <small>{chartBars.length.toLocaleString("zh-TW")} 根{isIntraday ? "分 K" : "K 線"}</small>
          </div>
        </div>
      )}

      <div className="kline-toolbar">
        <div className="kline-control-group">
          <span className="kline-toolbar-label">日線</span>
          {dailyIntervals.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => selectInterval(item.value)}
              className={`kline-tab${interval === item.value ? " is-active" : ""}`}
              aria-pressed={interval === item.value}
              title={item.note}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className={`kline-control-group${kbarState === "LIVE" ? "" : " is-muted"}`}>
          <span className="kline-toolbar-label">分K</span>
          {intradayIntervals.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => selectInterval(item.value)}
              className={`kline-tab${interval === item.value ? " is-active" : ""}`}
              aria-pressed={interval === item.value}
              title={kbarState === "LIVE" ? item.note : kbarReason}
            >
              {item.label}
            </button>
          ))}
        </div>
        {!isIntraday && (
          <div className="kline-control-group">
            <span className="kline-toolbar-label">範圍</span>
            {RANGE_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setRange(item.value)}
                className={`kline-tab${range === item.value ? " is-active" : ""}`}
                aria-pressed={range === item.value}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {isIntraday && (
          <div className="kline-control-group">
            <span className="kline-toolbar-label">範圍</span>
            {INTRADAY_RANGE_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setIntradayRange(item.value)}
                className={`kline-tab${intradayRange === item.value ? " is-active" : ""}`}
                aria-pressed={intradayRange === item.value}
                title={`${item.label}真實分 K，排除夜間與週末空窗`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="kline-pending-line">
        <span className={`tg ${stateToneClass(kbarState)}`}>{stateLabel(kbarState)}</span>
        <span className="tg soft">
          {kbarState === "LIVE"
            ? `FinMind Sponsor ${kbarDate ?? ""} 已回傳 ${kbarRows.length.toLocaleString("zh-TW")} 根 1 分 K${kbarTradingDays > 1 ? ` / ${kbarTradingDays} 個交易日` : ""}，分 K 圖已壓縮非交易時段，可彙整 1 / 5 / 15 / 60 分。`
            : kbarState === "BLOCKED"
              ? `分 K 無法顯示：${kbarReason}`
              : `分 K 無資料：${kbarReason}`}
        </span>
      </div>

      {chartBars.length > 0 && (
        <div className="kline-meta-line">
          <span>{activeMeta?.note}</span>
          <span>{chartBars.length.toLocaleString("zh-TW")} 根</span>
          {isIntraday && displayedIntradayDays > 0 && <span>顯示 {displayedIntradayDays} / {kbarTradingDays} 個交易日</span>}
          {isIntraday && displayedIntradayRawRows > 0 && <span>原始 1 分 K {displayedIntradayRawRows.toLocaleString("zh-TW")} 根</span>}
          {isIntraday && <span>非交易時段壓縮，可拖曳回看</span>}
          <span>{firstBar?.label} - {lastBar?.label}</span>
          <span>收 {formatNumber(lastBar?.close)}</span>
          <span>量 {formatNumber(lastBar?.volume, 0)}</span>
        </div>
      )}

      {error ? (
        <div className="terminal-note">
          <span className="tg down">無法顯示</span> {error}
        </div>
      ) : chartBars.length === 0 ? (
        <div className="terminal-note">
          <span className={stateToneClass(activeState)}>{stateLabel(activeState)}</span>{" "}
          {emptyReason}
        </div>
      ) : insufficientTrend ? (
        <KlineInsufficientState
          bars={chartBars}
          intervalLabel={activeMeta?.label ?? "K 線"}
          sourceLabel={badgeLabel}
        />
      ) : (
        <div className="kline-chart-shell">
          <div className="kline-price-ribbon kline-readout-ribbon" aria-live="polite">
            <span>{hoverBar ? (isIntraday ? "游標分 K" : "游標 K") : (isIntraday ? "分 K 最新" : "最新收盤")}</span>
            <b className={`num ${toneClass(readoutChange)}`}>
              {formatNumber(readoutBar?.close)}
            </b>
            <small>{readoutBar?.label ?? "--"}</small>
            {readoutBar && (
              <small className="kline-readout-detail">
                開 {formatNumber(readoutBar.open)} / 高 {formatNumber(readoutBar.high)} / 低 {formatNumber(readoutBar.low)} / 量 {formatNumber(readoutBar.volume, 0)}
              </small>
            )}
          </div>
          <div ref={containerRef} className="kline-chart-canvas" />
        </div>
      )}
    </section>
  );
}

function KlineInsufficientState({
  bars,
  intervalLabel,
  sourceLabel,
}: {
  bars: ChartBar[];
  intervalLabel: string;
  sourceLabel: string;
}) {
  const latest = bars.at(-1);
  return (
    <div className="kline-insufficient">
      <div>
        <span className="badge badge-yellow">資料不足</span>
        <h4>目前只有 {bars.length.toLocaleString("zh-TW")} 根 {intervalLabel}，先顯示最近成交，不畫趨勢圖。</h4>
        <p>
          K 線圖至少需要 {MIN_TREND_BARS} 根資料才會畫完整趨勢，避免用少量資料誤導判讀。資料補齊後會自動切回正式圖表。
        </p>
      </div>
      <div className="kline-insufficient-meta">
        <div><span>週期</span><b>{intervalLabel}</b></div>
        <div><span>來源</span><b>{sourceLabel}</b></div>
        <div><span>最新</span><b>{latest ? `${latest.label} / ${formatNumber(latest.close)}` : "--"}</b></div>
      </div>
      <div className="kline-mini-grid">
        {bars.slice(-8).map((bar) => {
          const up = bar.close >= bar.open;
          return (
            <div className="kline-mini-bar" key={`${bar.dt}-${bar.source}`}>
              <span className="tg soft">{bar.label.slice(0, 11)}</span>
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
