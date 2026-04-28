"use client";
/**
 * KLineChart — K-line Chart Widget
 * Ported from sandbox v0.7.0-w3
 * Uses TradingView lightweight-charts v5 (Apache-2.0, ~50KB).
 * Visual: CRT phosphor / amber terminal aesthetic.
 * No AI wording. No order entry. No fade-in animations — direct paint.
 *
 * v5 API: chart.addSeries(CandlestickSeries, opts)  — not addCandlestickSeries()
 * C-β: Custom crosshair OHLCV tooltip overlay.
 * C-δ: timezone prop — passed to timeScale.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import type { OHLCV } from "@/lib/mock-kbar";

const T = {
  bg:         "#0d0e0a",
  bg1:        "#15170f",
  bg2:        "#1d1f16",
  rule:       "rgba(232,223,200,0.08)",
  ruleStrong: "rgba(232,223,200,0.22)",
  ink:        "#e8dfc8",
  mid:        "#9a937e",
  soft:       "#6b6553",
  gold:       "#b88a3e",
  goldBright: "#d4a851",
  up:         "#e63946",
  dn:         "#2ecc71",
  upFaint:    "rgba(230,57,70,0.18)",
  dnFaint:    "rgba(46,204,113,0.18)",
  mono:       '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  serif:      '"Georgia", "Times New Roman", serif',
} as const;

interface CrosshairOHLCV {
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
  time:   string;
  x:      number;
  y:      number;
}

export interface KLineChartProps {
  symbol:    string;
  interval:  string;
  data:      OHLCV[];
  height?:   number;
  timezone?: string;
}

function fmtCrosshairTime(unixSec: number, interval: string, timezone: string): string {
  const d = new Date(unixSec * 1000);
  const opts: Intl.DateTimeFormatOptions = { timeZone: timezone };
  const showDate = interval === "D" || interval === "W" || interval === "M";
  if (showDate) {
    return d.toLocaleDateString("zh-TW", { ...opts, year: "numeric", month: "2-digit", day: "2-digit" });
  }
  return d.toLocaleString("zh-TW", {
    ...opts,
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtPx(v: number): string { return v.toFixed(2); }
function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function CrosshairTooltip({ bar, timezone }: { bar: CrosshairOHLCV | null; timezone: string }) {
  if (!bar) return null;
  const isUp = bar.close >= bar.open;
  const changeAbs = bar.close - bar.open;
  const changePct = bar.open !== 0 ? (changeAbs / bar.open) * 100 : 0;
  const changeColor = isUp ? T.up : T.dn;

  let tzAbbrev = timezone;
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, timeZoneName: "short" }).formatToParts(new Date());
    tzAbbrev = parts.find(p => p.type === "timeZoneName")?.value ?? timezone;
  } catch {
    // ignore
  }

  return (
    <div style={{
      position:      "absolute",
      top:           10,
      right:         8,
      zIndex:        10,
      background:    T.bg2,
      border:        `1px solid ${T.ruleStrong}`,
      padding:       "8px 10px",
      pointerEvents: "none",
      minWidth:      160,
    }}>
      <div style={{ fontFamily: T.mono, fontSize: 9, letterSpacing: "0.12em", color: T.soft, marginBottom: 6, textTransform: "uppercase" }}>
        [·{bar.time}·{tzAbbrev}·]
      </div>
      {([ ["O", bar.open, T.mid], ["H", bar.high, T.ink], ["L", bar.low, T.ink], ["C", bar.close, changeColor] ] as [string, number, string][]).map(([label, value, color]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 16, lineHeight: 1.5 }}>
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.soft, letterSpacing: "0.14em" }}>{label}</span>
          <span style={{ fontFamily: T.serif, fontStyle: "italic", fontVariantNumeric: "tabular-nums", fontSize: 14, fontWeight: 300, color }}>{fmtPx(value)}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 3, borderTop: `1px solid ${T.rule}`, paddingTop: 3 }}>
        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.soft, letterSpacing: "0.14em" }}>Δ</span>
        <span style={{ fontFamily: T.serif, fontStyle: "italic", fontVariantNumeric: "tabular-nums", fontSize: 12, color: changeColor }}>
          {changeAbs >= 0 ? "+" : ""}{fmtPx(changeAbs)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 3 }}>
        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.soft, letterSpacing: "0.14em" }}>VOL</span>
        <span style={{ fontFamily: T.serif, fontStyle: "italic", fontVariantNumeric: "tabular-nums", fontSize: 12, color: T.mid }}>{fmtVol(bar.volume)}</span>
      </div>
    </div>
  );
}

export function KLineChart({ symbol, interval, data, height = 480, timezone = "Asia/Taipei" }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeRef    = useRef<ISeriesApi<SeriesType> | null>(null);

  const showSeconds = interval === "1m";
  const showTime    = interval !== "D" && interval !== "W" && interval !== "M";

  const [crosshairBar, setCrosshairBar] = useState<CrosshairOHLCV | null>(null);
  const dataRef = useRef<OHLCV[]>([]);
  dataRef.current = data;

  const initChart = useCallback(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: T.bg }, textColor: T.mid, fontFamily: T.mono, fontSize: 11 },
      grid: { vertLines: { color: T.rule, style: LineStyle.Solid }, horzLines: { color: T.rule, style: LineStyle.Solid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: T.gold, width: 1, style: LineStyle.Solid, labelBackgroundColor: T.bg2 },
        horzLine: { color: T.gold, width: 1, style: LineStyle.Solid, labelBackgroundColor: T.bg2 },
      },
      rightPriceScale: { borderColor: T.ruleStrong },
      timeScale: { borderColor: T.ruleStrong, timeVisible: showTime, secondsVisible: showSeconds, fixLeftEdge: false, fixRightEdge: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: T.up, downColor: T.dn, borderUpColor: T.up, borderDownColor: T.dn, wickUpColor: T.up, wickDownColor: T.dn,
    });

    const volume = chart.addSeries(HistogramSeries, {
      color: T.mid, priceFormat: { type: "volume", precision: 0, minMove: 1 },
      priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false,
    });

    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.80, bottom: 0 } });

    chartRef.current  = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setCrosshairBar(null);
        return;
      }
      const unixSec = param.time as number;
      const bars = dataRef.current;
      const bar = bars.find(b => b.time === unixSec);
      if (!bar) { setCrosshairBar(null); return; }
      const timeLabel = fmtCrosshairTime(bar.time, interval, timezone);
      setCrosshairBar({ open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, time: timeLabel, x: param.point.x, y: param.point.y });
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      candleRef.current = null;
      volumeRef.current = null;
      setCrosshairBar(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, showTime, showSeconds]);

  useEffect(() => {
    const cleanup = initChart();
    return cleanup;
  }, [initChart]);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || data.length === 0) return;
    const candleData = data.map(b => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close }));
    const volumeData = data.map(b => ({ time: b.time as UTCTimestamp, value: b.volume, color: b.close >= b.open ? T.upFaint : T.dnFaint }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (candleRef.current as any).setData(candleData);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (volumeRef.current as any).setData(volumeData);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({ timeScale: { timeVisible: showTime, secondsVisible: showSeconds } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone]);

  return (
    <div style={{ position: "relative", width: "100%", background: T.bg }}>
      {/* Chart header — v2 styled with symbol pill + interval tag */}
      <div className="kline-header">
        <span className="kline-symbol-tag">{symbol}</span>
        <span className="kline-interval-tag">K-LINE · {interval}</span>
        <span className="kline-bar-count">{data.length} BARS</span>
      </div>
      <div style={{ position: "relative" }}>
        <div ref={containerRef} style={{ width: "100%", height }} />
        <CrosshairTooltip bar={crosshairBar} timezone={timezone} />
      </div>
    </div>
  );
}
