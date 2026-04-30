"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { RadarDataStateBadge, type RadarDataState } from "@/components/RadarDataStateBadge";

export type RadarChartInterval = "1m" | "5m" | "15m" | "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y";

export type RadarChartBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type ChartToken = {
  night: string;
  night1: string;
  night2: string;
  rule: string;
  ruleStrong: string;
  ink: string;
  mid: string;
  soft: string;
  gold: string;
  goldBright: string;
  up: string;
  down: string;
  upFaint: string;
  downFaint: string;
  mono: string;
};

const DEFAULT_INTERVALS: RadarChartInterval[] = ["1m", "5m", "15m", "1d"];
const INTERVAL_LABELS: Record<RadarChartInterval, string> = {
  "1m": "1分",
  "5m": "5分",
  "15m": "15分",
  "1d": "1日",
  "5d": "5日",
  "1mo": "1月",
  "3mo": "3月",
  "6mo": "6月",
  "1y": "1年",
};
const DAILY_LIKE = new Set<RadarChartInterval>(["1d", "5d", "1mo", "3mo", "6mo", "1y"]);

function cssToken(name: string) {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readTokens(): ChartToken {
  return {
    night: cssToken("--night"),
    night1: cssToken("--night-1"),
    night2: cssToken("--night-2"),
    rule: cssToken("--night-rule"),
    ruleStrong: cssToken("--night-rule-strong"),
    ink: cssToken("--night-ink"),
    mid: cssToken("--night-mid"),
    soft: cssToken("--night-soft"),
    gold: cssToken("--gold"),
    goldBright: cssToken("--gold-bright"),
    up: cssToken("--tw-up-bright"),
    down: cssToken("--tw-dn-bright"),
    upFaint: cssToken("--tw-up-faint"),
    downFaint: cssToken("--tw-dn-faint"),
    mono: cssToken("--mono"),
  };
}

function formatBarTime(unixSec: number, interval: RadarChartInterval) {
  const date = new Date(unixSec * 1000);
  if (DAILY_LIKE.has(interval)) {
    return date.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" });
  }
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatVolume(value?: number) {
  if (!value) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

function CrosshairCard({
  bar,
  interval,
}: {
  bar: RadarChartBar | null;
  interval: RadarChartInterval;
}) {
  if (!bar) return null;
  const up = bar.close >= bar.open;
  const delta = bar.close - bar.open;
  const deltaPct = bar.open ? (delta / bar.open) * 100 : 0;

  return (
    <div className="radar-crosshair-card">
      <div className="tg soft">TPE - {formatBarTime(bar.time, interval)}</div>
      <div className="radar-crosshair-grid">
        <span>開</span><b>{bar.open.toFixed(2)}</b>
        <span>高</span><b>{bar.high.toFixed(2)}</b>
        <span>低</span><b>{bar.low.toFixed(2)}</b>
        <span>收</span><b className={up ? "up" : "down"}>{bar.close.toFixed(2)}</b>
        <span>量</span><b>{formatVolume(bar.volume)}</b>
        <span>變動</span><b className={up ? "up" : "down"}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)} / {deltaPct >= 0 ? "+" : ""}{deltaPct.toFixed(2)}%</b>
      </div>
    </div>
  );
}

export function RadarCandlestickChart({
  symbol,
  bars,
  interval,
  onIntervalChange,
  state = "STALE",
  lastTickAt,
  agentHeartbeatAt,
  height = 520,
  intervalOptions,
  sourceLabel,
}: {
  symbol: string;
  bars: RadarChartBar[];
  interval: RadarChartInterval;
  onIntervalChange?: (interval: RadarChartInterval) => void;
  state?: RadarDataState;
  lastTickAt?: string | number | Date;
  agentHeartbeatAt?: string | number | Date;
  height?: number;
  intervalOptions?: RadarChartInterval[];
  sourceLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volumeRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const tokenRef = useRef<ChartToken | null>(null);
  const lastSetRef = useRef<{ length: number; time: number | null }>({ length: 0, time: null });
  const barsRef = useRef<RadarChartBar[]>([]);
  const [crosshairBar, setCrosshairBar] = useState<RadarChartBar | null>(null);
  const showSeconds = interval === "1m";
  const showTime = !DAILY_LIKE.has(interval);
  const options = intervalOptions ?? DEFAULT_INTERVALS;

  barsRef.current = bars;

  const initChart = useCallback(() => {
    if (!containerRef.current) return undefined;
    const tokens = readTokens();
    tokenRef.current = tokens;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: tokens.night },
        textColor: tokens.mid,
        fontFamily: tokens.mono,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: tokens.rule, style: LineStyle.Solid },
        horzLines: { color: tokens.rule, style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: tokens.gold, width: 1, style: LineStyle.Solid, labelBackgroundColor: tokens.night2 },
        horzLine: { color: tokens.gold, width: 1, style: LineStyle.Solid, labelBackgroundColor: tokens.night2 },
      },
      rightPriceScale: { borderColor: tokens.ruleStrong },
      timeScale: {
        borderColor: tokens.ruleStrong,
        timeVisible: showTime,
        secondsVisible: showSeconds,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: tokens.up,
      downColor: tokens.down,
      borderUpColor: tokens.up,
      borderDownColor: tokens.down,
      wickUpColor: tokens.up,
      wickDownColor: tokens.down,
    });

    const volume = chart.addSeries(HistogramSeries, {
      color: tokens.mid,
      priceFormat: { type: "volume", precision: 0, minMove: 1 },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setCrosshairBar(null);
        return;
      }
      const time = param.time as number;
      setCrosshairBar(barsRef.current.find((bar) => bar.time === time) ?? null);
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      lastSetRef.current = { length: 0, time: null };
    };
  }, [height, showSeconds, showTime]);

  useEffect(() => {
    const cleanup = initChart();
    return cleanup;
  }, [initChart]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: { timeVisible: showTime, secondsVisible: showSeconds },
    });
  }, [showSeconds, showTime]);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || bars.length === 0) return;
    const tokens = tokenRef.current ?? readTokens();
    const last = bars[bars.length - 1];
    const candleData = bars.map((bar) => ({
      time: bar.time as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));
    const volumeData = bars.map((bar) => ({
      time: bar.time as UTCTimestamp,
      value: bar.volume ?? 0,
      color: bar.close >= bar.open ? tokens.upFaint : tokens.downFaint,
    }));

    const previous = lastSetRef.current;
    const canUpdateLast = previous.length === bars.length && previous.time === last.time;
    if (canUpdateLast) {
      const lastVolume = volumeData[volumeData.length - 1];
      // lightweight-charts v5 narrows series APIs by runtime series type; this wrapper owns both series.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (candleRef.current as any).update(candleData[candleData.length - 1]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (volumeRef.current as any).update(lastVolume);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (candleRef.current as any).setData(candleData);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (volumeRef.current as any).setData(volumeData);
      chartRef.current?.timeScale().fitContent();
    }

    lastSetRef.current = { length: bars.length, time: last.time };
  }, [bars]);

  return (
    <div className="radar-chart-shell">
      <div className="radar-chart-bracket top-left" aria-hidden />
      <div className="radar-chart-bracket top-right" aria-hidden />
      <div className="radar-chart-head">
        <div>
          <span className="tg panel-code">K-LINE</span>
          <span className="tg muted"> - </span>
          <span className="tg gold">{symbol}</span>
          <span className="tg soft"> - {bars.length} bars</span>
          {sourceLabel && <span className="tg badge badge-blue radar-chart-source">{sourceLabel}</span>}
        </div>
        <div className="radar-chart-actions">
          <div className="radar-intervals" aria-label="K 線區間">
            {options.map((item) => (
              <button
                className={item === interval ? "mini-button" : "outline-button"}
                key={item}
                onClick={() => onIntervalChange?.(item)}
                type="button"
              >
                {INTERVAL_LABELS[item]}
              </button>
            ))}
          </div>
          <RadarDataStateBadge state={state} lastTickAt={lastTickAt} agentHeartbeatAt={agentHeartbeatAt} compact />
        </div>
      </div>
      <div className="radar-chart-body">
        <div ref={containerRef} style={{ width: "100%", height }} />
        <CrosshairCard bar={crosshairBar} interval={interval} />
      </div>
      <div className="radar-chart-bracket bottom-left" aria-hidden />
      <div className="radar-chart-bracket bottom-right" aria-hidden />
    </div>
  );
}

