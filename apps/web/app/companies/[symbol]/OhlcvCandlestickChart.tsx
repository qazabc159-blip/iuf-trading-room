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

// ── Indicator toggle state (persisted in localStorage) ─────────────────────
type MaKey = "ma5" | "ma10" | "ma20" | "ma60";
type IndicatorKey = "ma" | "vwap" | "sr" | "plan" | "rsi" | "macd";
type IndicatorPrefs = Record<IndicatorKey, boolean>;
type PlanLevels = {
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
};
type VolumePriceLevels = {
  support: number | null;
  resistance: number | null;
  supportVolume: number | null;
  resistanceVolume: number | null;
  sampleSize: number;
};
type IndicatorSignal = {
  key: string;
  label: string;
  value: string;
  tone: "up" | "down" | "muted";
  detail: string;
};
type ChartLogicalRange = { from: number; to: number };

const MA_CONFIG: ReadonlyArray<{ key: MaKey; period: number; color: string; label: string }> = [
  { key: "ma5",  period: 5,  color: "#FFD600", label: "MA5"  },
  { key: "ma10", period: 10, color: "#FF8C00", label: "MA10" },
  { key: "ma20", period: 20, color: "#00E5FF", label: "MA20" },
  { key: "ma60", period: 60, color: "#B388FF", label: "MA60" },
];

const LS_KEY_INDICATOR = "iuf_kline_indicators_v1";
const LS_KEY_MA        = "iuf_kline_ma_v1";

function loadIndicatorPrefs(): IndicatorPrefs {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(LS_KEY_INDICATOR) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<IndicatorPrefs>;
      return {
        ma: parsed.ma ?? true,
        vwap: parsed.vwap ?? true,
        sr: parsed.sr ?? true,
        plan: parsed.plan ?? true,
        rsi: parsed.rsi ?? false,
        macd: parsed.macd ?? false,
      };
    }
  } catch { /* ignore */ }
  return { ma: true, vwap: true, sr: true, plan: true, rsi: false, macd: false };
}

function saveIndicatorPrefs(prefs: IndicatorPrefs) {
  try { if (typeof window !== "undefined") localStorage.setItem(LS_KEY_INDICATOR, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function loadMaPrefs(): Record<MaKey, boolean> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(LS_KEY_MA) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<MaKey, boolean>>;
      return {
        ma5:  parsed.ma5  ?? true,
        ma10: parsed.ma10 ?? false,
        ma20: parsed.ma20 ?? true,
        ma60: parsed.ma60 ?? false,
      };
    }
  } catch { /* ignore */ }
  return { ma5: true, ma10: false, ma20: true, ma60: false };
}

function saveMaPrefs(prefs: Record<MaKey, boolean>) {
  try { if (typeof window !== "undefined") localStorage.setItem(LS_KEY_MA, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ── Technical Indicator Calculations ────────────────────────────────────────

/** Simple Moving Average — returns array same length as input; leading values = null */
function calcSMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    result[i] = Number((sum / period).toFixed(3));
  }
  return result;
}

function calcVWAP(bars: ChartBar[]): (number | null)[] {
  const result: (number | null)[] = new Array(bars.length).fill(null);
  let cumulativeValue = 0;
  let cumulativeVolume = 0;
  let currentSession = "";

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const session = bar.source === "finmind-kbar" ? bar.dt.slice(0, 10) : "range";
    if (session !== currentSession) {
      currentSession = session;
      cumulativeValue = 0;
      cumulativeVolume = 0;
    }
    if (!Number.isFinite(bar.volume) || bar.volume <= 0) continue;
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumulativeValue += typicalPrice * bar.volume;
    cumulativeVolume += bar.volume;
    if (cumulativeVolume > 0) {
      result[i] = Number((cumulativeValue / cumulativeVolume).toFixed(3));
    }
  }

  return result;
}

/** RSI (14-period) — Wilder smoothing.  Returns array same length as input; leading = null */
function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result[period] = Number((100 - 100 / (1 + rs0)).toFixed(2));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result[i] = Number((100 - 100 / (1 + rs)).toFixed(2));
  }
  return result;
}

/** EMA helper */
function calcEMA(closes: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = Number(ema.toFixed(4));
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result[i] = Number(ema.toFixed(4));
  }
  return result;
}

function calcNullableEMA(values: Array<number | null>, period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(values.length).fill(null);
  let seed: number[] = [];
  let ema: number | null = null;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null || !Number.isFinite(value)) continue;
    if (ema === null) {
      seed.push(value);
      if (seed.length < period) continue;
      ema = seed.reduce((sum, item) => sum + item, 0) / period;
    } else {
      ema = value * k + ema * (1 - k);
    }
    result[i] = Number(ema.toFixed(4));
  }

  return result;
}

/** MACD = DIF (12 - 26 EMA), DEA = 9 EMA of DIF, Hist = DIF - DEA */
function calcMACD(closes: number[]): {
  dif: (number | null)[];
  dea: (number | null)[];
  hist: (number | null)[];
} {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const dif: (number | null)[] = closes.map((_, i) => {
    const e12 = ema12[i]; const e26 = ema26[i];
    return e12 !== null && e26 !== null ? Number((e12 - e26).toFixed(4)) : null;
  });
  // DEA is the 9-period EMA of valid DIF values.  Null warm-up periods must not
  // be treated as zero, otherwise MACD shows a fake early signal.
  const deaRaw = calcNullableEMA(dif, 9);
  const dea: (number | null)[] = dif.map((d, i) => (d !== null && deaRaw[i] !== null ? deaRaw[i] : null));
  const hist: (number | null)[] = dif.map((d, i) => {
    const de = dea[i];
    return d !== null && de !== null ? Number((d - de).toFixed(4)) : null;
  });
  return { dif, dea, hist };
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function chooseVolumePriceLevel(
  points: Array<{ price: number; volume: number }>,
  lastClose: number,
  direction: "support" | "resistance",
) {
  const usable = points.filter((item) => (
    Number.isFinite(item.price)
    && item.price > 0
    && Number.isFinite(item.volume)
    && item.volume > 0
    && (direction === "support" ? item.price <= lastClose : item.price >= lastClose)
  ));
  if (usable.length === 0) return null;

  const binSize = Math.max(lastClose * 0.004, 0.05);
  const clusters = new Map<number, { priceSum: number; volume: number; touches: number }>();
  for (const item of usable) {
    const key = Math.round(item.price / binSize);
    const existing = clusters.get(key) ?? { priceSum: 0, volume: 0, touches: 0 };
    existing.priceSum += item.price * item.volume;
    existing.volume += item.volume;
    existing.touches += 1;
    clusters.set(key, existing);
  }

  let best: { price: number; volume: number; score: number } | null = null;
  for (const cluster of clusters.values()) {
    const price = cluster.priceSum / cluster.volume;
    const distancePct = Math.abs(price - lastClose) / lastClose;
    const score = cluster.volume * (1 + Math.log1p(cluster.touches)) / (1 + distancePct * 7);
    if (!best || score > best.score) best = { price, volume: cluster.volume, score };
  }

  return best ? { price: Number(best.price.toFixed(3)), volume: best.volume } : null;
}

function calcVolumePriceLevels(bars: ChartBar[]): VolumePriceLevels {
  const recent = bars.slice(-Math.min(80, bars.length));
  if (recent.length < 8) {
    return { support: null, resistance: null, supportVolume: null, resistanceVolume: null, sampleSize: recent.length };
  }

  const medianVolume = median(recent.map((bar) => bar.volume));
  const minVolume = Math.max(1, medianVolume * 0.65);
  const pivotLows: Array<{ price: number; volume: number }> = [];
  const pivotHighs: Array<{ price: number; volume: number }> = [];

  for (let i = 1; i < recent.length - 1; i++) {
    const prev = recent[i - 1];
    const bar = recent[i];
    const next = recent[i + 1];
    const volumeOk = Number.isFinite(bar.volume) && bar.volume >= minVolume;
    if (!volumeOk) continue;
    if (bar.low <= prev.low && bar.low <= next.low) pivotLows.push({ price: bar.low, volume: bar.volume });
    if (bar.high >= prev.high && bar.high >= next.high) pivotHighs.push({ price: bar.high, volume: bar.volume });
  }

  const lastClose = recent.at(-1)?.close;
  if (typeof lastClose !== "number" || !Number.isFinite(lastClose) || lastClose <= 0) {
    return { support: null, resistance: null, supportVolume: null, resistanceVolume: null, sampleSize: recent.length };
  }

  const lows = pivotLows.length ? pivotLows : recent.map((bar) => ({ price: bar.low, volume: bar.volume }));
  const highs = pivotHighs.length ? pivotHighs : recent.map((bar) => ({ price: bar.high, volume: bar.volume }));
  const support = chooseVolumePriceLevel(lows, lastClose, "support");
  const resistance = chooseVolumePriceLevel(highs, lastClose, "resistance");

  return {
    support: support?.price ?? null,
    resistance: resistance?.price ?? null,
    supportVolume: support?.volume ?? null,
    resistanceVolume: resistance?.volume ?? null,
    sampleSize: recent.length,
  };
}

// ── SVG sub-chart helpers ───────────────────────────────────────────────────

type SubChartPoint = { idx: number; value: number };

function toPoints(values: (number | null)[]): SubChartPoint[][] {
  // Split at nulls into contiguous segments
  const segments: SubChartPoint[][] = [];
  let seg: SubChartPoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v !== null) {
      seg.push({ idx: i, value: v });
    } else {
      if (seg.length > 1) segments.push(seg);
      seg = [];
    }
  }
  if (seg.length > 1) segments.push(seg);
  return segments;
}

function makePolyline(
  segs: SubChartPoint[][],
  n: number,
  w: number,
  h: number,
  minV: number,
  maxV: number,
  pad = 6,
): string[] {
  const range = maxV - minV || 1;
  return segs.map((seg) =>
    seg.map(({ idx, value }) => {
      const x = ((idx / Math.max(n - 1, 1)) * (w - pad * 2) + pad).toFixed(1);
      const y = (h - pad - ((value - minV) / range) * (h - pad * 2)).toFixed(1);
      return `${x},${y}`;
    }).join(" "),
  );
}

// ── Existing helpers (unchanged) ─────────────────────────────────────────────

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
const TRADING_ROOM_PRODUCT_DAILY_BARS = 720;
const TRADING_ROOM_DEEP_BACKFILL_YEARS = 10;
const COMPRESSED_INTRADAY_BASE_TIME = Math.floor(Date.UTC(2026, 0, 5, 1, 0, 0) / 1000);
const TWSE_INTRADAY_MINUTES = 270;

function officialDailyBarCount(items: OhlcvBar[]) {
  return items.filter((bar) => (
    bar.source !== "mock"
    && typeof bar.close === "number"
    && Number.isFinite(bar.close)
    && bar.close > 0
  )).length;
}

function tradingRoomDeepFromDate() {
  const from = new Date();
  from.setFullYear(from.getFullYear() - TRADING_ROOM_DEEP_BACKFILL_YEARS);
  return from.toISOString().slice(0, 10);
}

function tradingRoomDeepOhlcvProxyUrl(symbol: string) {
  const query = new URLSearchParams({
    interval: "1d",
    from: tradingRoomDeepFromDate(),
    iufDeepBackfill: String(Date.now()),
  });
  const path = `/api/v1/companies/${encodeURIComponent(symbol.trim())}/ohlcv?${query.toString()}`;
  return `/api/ui-final-v031/backend?path=${encodeURIComponent(path)}`;
}

async function fetchTradingRoomDeepDailyBars(symbol: string, signal: AbortSignal): Promise<OhlcvBar[]> {
  const response = await fetch(tradingRoomDeepOhlcvProxyUrl(symbol), {
    cache: "no-store",
    credentials: "include",
    signal,
    headers: {
      "x-iuf-kline-depth": "trading-room-deep-refetch",
    },
  });
  if (!response.ok) {
    throw new Error(`deep_ohlcv_${response.status}`);
  }
  const payload = (await response.json()) as { data?: OhlcvBar[] };
  return Array.isArray(payload.data)
    ? payload.data.filter((bar) => bar.source !== "mock")
    : [];
}

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

function intradayTradingDates(rows: FinMindKBarRow[]): string[] {
  return Array.from(new Set(rows.map((row) => row.date).filter(Boolean))).sort();
}

function intradayDatesForRange(rows: FinMindKBarRow[], range: IntradayRangeKey): Set<string> {
  const option = INTRADAY_RANGE_OPTIONS.find((item) => item.value === range);
  const dates = intradayTradingDates(rows);
  if (!option || dates.length === 0) return new Set(dates);
  return new Set(dates.slice(-option.days));
}

function rawRowsInLastTradingDays(rows: FinMindKBarRow[], days: number): number {
  const dates = intradayTradingDates(rows).slice(-days);
  if (dates.length === 0) return 0;
  const keep = new Set(dates);
  return rows.filter((row) => keep.has(row.date)).length;
}

function suggestIntradayRange(rows: FinMindKBarRow[], minutes: number): IntradayRangeKey {
  const oneDayRawRows = rawRowsInLastTradingDays(rows, 1);
  const fiveDayRawRows = rawRowsInLastTradingDays(rows, 5);
  const oneDayBuckets = Math.ceil(oneDayRawRows / Math.max(1, minutes));
  const fiveDayBuckets = Math.ceil(fiveDayRawRows / Math.max(1, minutes));
  const targetBuckets = minutes === 1 ? 160 : minutes === 5 ? 48 : minutes === 15 ? 20 : 6;

  if (oneDayBuckets >= targetBuckets) return "1d";
  if (fiveDayBuckets >= targetBuckets) return "5d";
  return "20d";
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

function formatPercent(value: number | null | undefined, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toLocaleString("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })}%`;
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

function latestFinite(values: Array<number | null | undefined>) {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function relationSignal(label: string, price: number | null | undefined, base: number | null | undefined, key: string): IndicatorSignal | null {
  if (typeof price !== "number" || !Number.isFinite(price) || typeof base !== "number" || !Number.isFinite(base) || base <= 0) return null;
  const diffPct = ((price - base) / base) * 100;
  return {
    key,
    label,
    value: `${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%`,
    tone: diffPct > 0 ? "up" : diffPct < 0 ? "down" : "muted",
    detail: price >= base ? `收盤高於 ${label} ${formatNumber(base)}` : `收盤低於 ${label} ${formatNumber(base)}`,
  };
}

function buildIndicatorSignals(input: {
  lastClose: number | null | undefined;
  ma20: number | null | undefined;
  ma60: number | null | undefined;
  vwap: number | null | undefined;
  rsi: number | null | undefined;
  macdHist: number | null | undefined;
  support: number | null | undefined;
  resistance: number | null | undefined;
}): IndicatorSignal[] {
  const signals: IndicatorSignal[] = [];
  const ma20 = relationSignal("MA20", input.lastClose, input.ma20, "ma20");
  const ma60 = relationSignal("MA60", input.lastClose, input.ma60, "ma60");
  const vwap = relationSignal("VWAP", input.lastClose, input.vwap, "vwap");
  if (ma20) signals.push(ma20);
  if (ma60) signals.push(ma60);
  if (vwap) signals.push(vwap);
  if (typeof input.rsi === "number" && Number.isFinite(input.rsi)) {
    signals.push({
      key: "rsi",
      label: "RSI14",
      value: input.rsi.toFixed(1),
      tone: input.rsi >= 70 ? "up" : input.rsi <= 30 ? "down" : "muted",
      detail: input.rsi >= 70 ? "偏熱" : input.rsi <= 30 ? "偏冷" : "中性",
    });
  }
  if (typeof input.macdHist === "number" && Number.isFinite(input.macdHist)) {
    signals.push({
      key: "macd",
      label: "MACD",
      value: input.macdHist >= 0 ? "多方" : "空方",
      tone: input.macdHist > 0 ? "up" : input.macdHist < 0 ? "down" : "muted",
      detail: `柱狀 ${input.macdHist.toFixed(3)}`,
    });
  }
  if (typeof input.lastClose === "number" && typeof input.support === "number" && Number.isFinite(input.support) && input.support > 0) {
    const gap = ((input.lastClose - input.support) / input.support) * 100;
    signals.push({
      key: "support-gap",
      label: "量價支撐",
      value: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`,
      tone: gap >= 0 ? "up" : "down",
      detail: `支撐 ${formatNumber(input.support)}`,
    });
  }
  if (typeof input.lastClose === "number" && typeof input.resistance === "number" && Number.isFinite(input.resistance) && input.resistance > 0) {
    const gap = ((input.resistance - input.lastClose) / input.lastClose) * 100;
    signals.push({
      key: "resistance-gap",
      label: "量價壓力",
      value: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`,
      tone: gap > 0 ? "muted" : "up",
      detail: `壓力 ${formatNumber(input.resistance)}`,
    });
  }
  return signals.slice(0, 6);
}

// ── RSI Sub-chart SVG ────────────────────────────────────────────────────────

function RsiSubChart({ rsiValues, n }: { rsiValues: (number | null)[]; n: number }) {
  const W = 600; // SVG viewBox width (scales via 100% width)
  const H = 72;
  const PAD = 6;
  const segs = toPoints(rsiValues);
  const polylines = makePolyline(segs, n, W, H, 0, 100, PAD);
  const y30 = (H - PAD - (30 / 100) * (H - PAD * 2)).toFixed(1);
  const y70 = (H - PAD - (70 / 100) * (H - PAD * 2)).toFixed(1);
  const lastRsi = [...rsiValues].reverse().find((v) => v !== null);

  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px 2px 4px", fontFamily: "var(--mono)", fontSize: 10, color: "rgba(203,213,225,0.55)" }}>
        <span style={{ color: "#a78bfa", fontWeight: 700 }}>RSI(14)</span>
        {lastRsi !== null && lastRsi !== undefined && (
          <span style={{ color: lastRsi > 70 ? "#e63946" : lastRsi < 30 ? "#4ade80" : "rgba(203,213,225,0.75)" }}>
            {lastRsi.toFixed(2)}
            {lastRsi > 70 ? " 超買" : lastRsi < 30 ? " 超賣" : ""}
          </span>
        )}
        <span style={{ marginLeft: "auto" }}>30 / 70</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: "block", overflow: "visible" }}
        aria-label="RSI 指標子圖"
      >
        {/* Background */}
        <rect x={0} y={0} width={W} height={H} fill="rgba(0,0,0,0.18)" />
        {/* Overbought zone */}
        <rect
          x={PAD} y={Number(y70)}
          width={W - PAD * 2}
          height={Number(y30) - Number(y70)}
          fill="rgba(166,139,250,0.06)"
        />
        {/* 70 line */}
        <line x1={PAD} y1={y70} x2={W - PAD} y2={y70} stroke="rgba(230,57,70,0.45)" strokeWidth={1} strokeDasharray="3 3" />
        {/* 30 line */}
        <line x1={PAD} y1={y30} x2={W - PAD} y2={y30} stroke="rgba(74,222,128,0.45)" strokeWidth={1} strokeDasharray="3 3" />
        {/* 50 midline */}
        {(() => {
          const y50 = (H - PAD - (50 / 100) * (H - PAD * 2)).toFixed(1);
          return <line x1={PAD} y1={y50} x2={W - PAD} y2={y50} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />;
        })()}
        {/* RSI line segments */}
        {polylines.map((pts, i) => (
          <polyline key={i} points={pts} fill="none" stroke="#a78bfa" strokeWidth={1.5} />
        ))}
        {/* Labels */}
        <text x={W - PAD - 2} y={Number(y70) - 2} textAnchor="end" fontSize={8} fill="rgba(230,57,70,0.7)">70</text>
        <text x={W - PAD - 2} y={Number(y30) + 9} textAnchor="end" fontSize={8} fill="rgba(74,222,128,0.7)">30</text>
      </svg>
    </div>
  );
}

// ── MACD Sub-chart SVG ───────────────────────────────────────────────────────

function MacdSubChart({
  difValues,
  deaValues,
  histValues,
  n,
}: {
  difValues: (number | null)[];
  deaValues: (number | null)[];
  histValues: (number | null)[];
  n: number;
}) {
  const W = 600;
  const H = 80;
  const PAD = 6;

  // Compute range across all non-null values
  const allVals = [...difValues, ...deaValues, ...histValues].filter((v): v is number => v !== null);
  const minV = allVals.length ? Math.min(...allVals) : -1;
  const maxV = allVals.length ? Math.max(...allVals) : 1;

  const difSegs = toPoints(difValues);
  const deaSegs = toPoints(deaValues);
  const difLines = makePolyline(difSegs, n, W, H, minV, maxV, PAD);
  const deaLines = makePolyline(deaSegs, n, W, H, minV, maxV, PAD);

  // Zero line
  const range = maxV - minV || 1;
  const y0 = (H - PAD - ((0 - minV) / range) * (H - PAD * 2)).toFixed(1);

  // Histogram bars
  const barW = Math.max(1, Math.floor((W - PAD * 2) / Math.max(n, 1)) - 1);
  const histBars: { x: number; y: number; h: number; positive: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const v = histValues[i];
    if (v === null) continue;
    const x = ((i / Math.max(n - 1, 1)) * (W - PAD * 2) + PAD);
    const yVal = H - PAD - ((v - minV) / range) * (H - PAD * 2);
    const yZero = Number(y0);
    const positive = v >= 0;
    const top = positive ? yVal : yZero;
    const bot = positive ? yZero : yVal;
    histBars.push({ x: x - barW / 2, y: top, h: Math.max(1, bot - top), positive });
  }

  const lastDif = [...difValues].reverse().find((v) => v !== null);
  const lastDea = [...deaValues].reverse().find((v) => v !== null);

  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px 2px 4px", fontFamily: "var(--mono)", fontSize: 10, color: "rgba(203,213,225,0.55)" }}>
        <span style={{ color: "#fb923c", fontWeight: 700 }}>MACD(12,26,9)</span>
        {lastDif !== null && lastDif !== undefined && (
          <span>DIF <span style={{ color: "#60a5fa" }}>{lastDif.toFixed(3)}</span></span>
        )}
        {lastDea !== null && lastDea !== undefined && (
          <span>DEA <span style={{ color: "#f97316" }}>{lastDea.toFixed(3)}</span></span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: "block", overflow: "visible" }}
        aria-label="MACD 指標子圖"
      >
        <rect x={0} y={0} width={W} height={H} fill="rgba(0,0,0,0.18)" />
        {/* Zero line */}
        <line x1={PAD} y1={y0} x2={W - PAD} y2={y0} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
        {/* Histogram */}
        {histBars.map((bar, i) => (
          <rect
            key={i}
            x={bar.x}
            y={bar.y}
            width={barW}
            height={bar.h}
            fill={bar.positive ? "rgba(230,57,70,0.52)" : "rgba(74,222,128,0.52)"}
          />
        ))}
        {/* DIF line */}
        {difLines.map((pts, i) => (
          <polyline key={`dif-${i}`} points={pts} fill="none" stroke="#60a5fa" strokeWidth={1.5} />
        ))}
        {/* DEA line */}
        {deaLines.map((pts, i) => (
          <polyline key={`dea-${i}`} points={pts} fill="none" stroke="#f97316" strokeWidth={1.5} />
        ))}
      </svg>
    </div>
  );
}

// ── Indicator Toggle Bar ─────────────────────────────────────────────────────

const INDICATOR_CSS = `
._ind-toggle-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 8px;
  background: rgba(5,8,12,0.52);
  border-bottom: 1px solid rgba(220,228,240,0.07);
  font-family: var(--mono, monospace);
  font-size: 10px;
}
._ind-toggle-bar-label {
  color: rgba(203,213,225,0.38);
  letter-spacing: 0.06em;
  margin-right: 2px;
}
._ind-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border: 1px solid rgba(220,228,240,0.14);
  background: transparent;
  color: rgba(203,213,225,0.5);
  font-family: var(--mono, monospace);
  font-size: 10px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
  white-space: nowrap;
}
._ind-toggle-btn:hover {
  border-color: rgba(220,228,240,0.32);
  color: rgba(203,213,225,0.85);
}
._ind-toggle-btn.is-on {
  border-color: rgba(226,184,92,0.42);
  color: #e2b85c;
  background: rgba(226,184,92,0.06);
}
._ind-toggle-btn._ma5.is-on  { border-color: rgba(255,214,0,0.52); color: #FFD600; background: rgba(255,214,0,0.06); }
._ind-toggle-btn._ma10.is-on { border-color: rgba(255,140,0,0.52); color: #FF8C00; background: rgba(255,140,0,0.06); }
._ind-toggle-btn._ma20.is-on { border-color: rgba(0,229,255,0.52); color: #00E5FF; background: rgba(0,229,255,0.06); }
._ind-toggle-btn._ma60.is-on { border-color: rgba(179,136,255,0.52); color: #B388FF; background: rgba(179,136,255,0.06); }
._ind-toggle-btn._vwap.is-on { border-color: rgba(143,191,232,0.58); color: #8fbfe8; background: rgba(143,191,232,0.08); }
._ind-toggle-btn._sr.is-on { border-color: rgba(236,201,75,0.58); color: #ecc94b; background: rgba(236,201,75,0.08); }
._ind-toggle-btn._plan.is-on { border-color: rgba(72,187,120,0.58); color: #48bb78; background: rgba(72,187,120,0.08); }
._ind-ma-expand { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
._ind-divider { width: 1px; height: 14px; background: rgba(220,228,240,0.12); margin: 0 2px; }
._ind-sub-section { border-top: 1px solid rgba(220,228,240,0.06); }
._ind-level-readout {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(220,228,240,0.06);
  background: rgba(5,8,12,0.32);
  color: rgba(203,213,225,0.56);
  font: 800 10px/1.45 var(--mono, monospace);
}
._ind-level-readout b { color: rgba(236,201,75,0.94); }
._ind-level-readout ._plan { color: rgba(72,187,120,0.94); }
.kline-signal-strip {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
  padding: 7px 10px;
  border-bottom: 1px solid rgba(220,228,240,0.06);
  background: rgba(3, 7, 12, 0.38);
}
.kline-signal-chip {
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid rgba(148,163,184,0.14);
  border-radius: 6px;
  background: rgba(15,23,34,0.72);
  color: rgba(203,213,225,0.72);
  font: 800 10px/1.35 var(--mono, monospace);
}
.kline-signal-chip span,
.kline-signal-chip small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kline-signal-chip b {
  display: block;
  margin: 2px 0;
  color: #e2e8f0;
  font-size: 12px;
}
.kline-signal-chip.up b { color: #e63946; }
.kline-signal-chip.down b { color: #2ecc71; }
.kline-signal-chip.muted b { color: #f0bd62; }
.kline-viewport-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 5px 10px;
  border-bottom: 1px solid rgba(220,228,240,0.06);
  background: rgba(3, 7, 12, 0.34);
  color: rgba(203,213,225,0.62);
  font: 800 10px/1.4 var(--mono, monospace);
}
.kline-viewport-tools .label {
  color: rgba(203,213,225,0.42);
}
.kline-viewport-tools button {
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid rgba(220,228,240,0.14);
  border-radius: 4px;
  background: rgba(15,23,34,0.54);
  color: rgba(226,232,240,0.78);
  font: inherit;
  cursor: pointer;
}
.kline-viewport-tools button:hover:not(:disabled) {
  border-color: rgba(226,184,92,0.42);
  color: #e2b85c;
}
.kline-viewport-tools button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.kline-viewport-tools .count {
  margin-left: auto;
  color: rgba(226,184,92,0.9);
  white-space: nowrap;
}
@media (max-width: 900px) {
  .kline-signal-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .kline-viewport-tools .count { margin-left: 0; }
}
/* M2 mobile pass (2026-07-06): indicator toggle chips (25px) and viewport
   zoom/reset buttons (24px) measured below the 44px touch minimum at 390px.
   Scoped to <=480px; kept below the full 44px bar deliberately — these are
   dense secondary chart controls (8-9 chips + 5 tools in one toolbar) and a
   literal 44px would force most of them onto their own row, working against
   the chart's already-tight vertical budget on a 390px screen. Bumped to a
   still-meaningfully-larger 34px, which keeps 3-4 chips per row. */
@media (max-width: 480px) {
  ._ind-toggle-btn {
    min-height: 34px;
    padding: 5px 9px;
  }
  .kline-viewport-tools button {
    min-height: 34px;
  }
}
@media (prefers-reduced-motion: reduce) {
  ._ind-toggle-btn { transition: none; }
}
`;

// ── Main Chart Component ─────────────────────────────────────────────────────

export function OhlcvCandlestickChart({
  bars,
  kbarRows = [],
  kbarState = "EMPTY",
  kbarReason = "FinMind 分 K 尚未回傳資料。",
  kbarDate,
  symbol,
  sourceState,
  sourceReason,
  planLevels,
  compactTradingRoom = false,
}: {
  bars: OhlcvBar[];
  kbarRows?: FinMindKBarRow[];
  kbarState?: "LIVE" | "EMPTY" | "BLOCKED";
  kbarReason?: string;
  kbarDate?: string;
  symbol: string;
  sourceState: "LIVE" | "EMPTY" | "BLOCKED";
  sourceReason: string;
  planLevels?: PlanLevels;
  compactTradingRoom?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<import("lightweight-charts").IChartApi | null>(null);
  const viewportRef = useRef<{ key: string; range: ChartLogicalRange | null }>({ key: "", range: null });
  const [error, setError] = useState<string | null>(null);
  const [interval, setInterval] = useState<EnabledInterval>("1d");
  const [range, setRange] = useState<RangeKey>("all");
  const [intradayRange, setIntradayRange] = useState<IntradayRangeKey>("1d");
  const [hoverBar, setHoverBar] = useState<ChartBar | null>(null);
  const [visibleRange, setVisibleRange] = useState<ChartLogicalRange | null>(null);
  const [clientDailyBars, setClientDailyBars] = useState<OhlcvBar[] | null>(null);
  const [deepRefetchState, setDeepRefetchState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [deepRefetchError, setDeepRefetchError] = useState<string | null>(null);

  // Indicator toggles — initialized from localStorage on first render
  const [indicators, setIndicators] = useState<IndicatorPrefs>(() => {
    if (typeof window === "undefined") return { ma: true, vwap: true, sr: true, plan: true, rsi: false, macd: false };
    return loadIndicatorPrefs();
  });
  const [maEnabled, setMaEnabled] = useState<Record<MaKey, boolean>>(() => {
    if (typeof window === "undefined") return { ma5: true, ma10: false, ma20: true, ma60: false };
    return loadMaPrefs();
  });

  const toggleIndicator = (key: IndicatorKey) => {
    setIndicators((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveIndicatorPrefs(next);
      return next;
    });
  };

  const toggleMa = (key: MaKey) => {
    setMaEnabled((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveMaPrefs(next);
      return next;
    });
  };

  const incomingOfficialBars = useMemo(() => officialDailyBarCount(bars), [bars]);
  const clientOfficialBars = useMemo(() => officialDailyBarCount(clientDailyBars ?? []), [clientDailyBars]);
  const effectiveBars = useMemo(() => {
    if (clientDailyBars && clientOfficialBars > incomingOfficialBars) return clientDailyBars;
    return bars;
  }, [bars, clientDailyBars, clientOfficialBars, incomingOfficialBars]);
  const effectiveOfficialBars = useMemo(() => officialDailyBarCount(effectiveBars), [effectiveBars]);

  useEffect(() => {
    if (!compactTradingRoom) {
      setClientDailyBars(null);
      setDeepRefetchState("idle");
      setDeepRefetchError(null);
      return;
    }

    setClientDailyBars(null);
    setDeepRefetchError(null);

    if (incomingOfficialBars >= TRADING_ROOM_PRODUCT_DAILY_BARS) {
      setDeepRefetchState("ready");
      return;
    }

    const controller = new AbortController();
    setDeepRefetchState("loading");

    fetchTradingRoomDeepDailyBars(symbol, controller.signal)
      .then((nextBars) => {
        if (controller.signal.aborted) return;
        const nextCount = officialDailyBarCount(nextBars);
        if (nextCount >= Math.max(incomingOfficialBars, MIN_TREND_BARS)) {
          setClientDailyBars(nextBars);
          setDeepRefetchState(nextCount >= TRADING_ROOM_PRODUCT_DAILY_BARS ? "ready" : "failed");
          setDeepRefetchError(nextCount >= TRADING_ROOM_PRODUCT_DAILY_BARS ? null : `deep_refetch_under_min:${nextCount}`);
        } else {
          setDeepRefetchState("failed");
          setDeepRefetchError(`deep_refetch_empty:${nextCount}`);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setDeepRefetchState("failed");
        setDeepRefetchError(err instanceof Error ? err.message : "deep_refetch_failed");
      });

    return () => controller.abort();
  }, [compactTradingRoom, incomingOfficialBars, symbol]);

  const activeMeta = ENABLED_INTERVALS.find((item) => item.value === interval);
  const isIntraday = activeMeta?.kind === "intraday";
  const chartHeight = compactTradingRoom ? 300 : isIntraday ? 460 : 440;
  const activeIntradayMinutes = activeMeta?.kind === "intraday" ? activeMeta.minutes ?? 1 : 1;
  const chartBars = useMemo(() => {
    const meta = ENABLED_INTERVALS.find((item) => item.value === interval);
    if (meta?.kind === "intraday") {
      const minutes = meta.minutes ?? 1;
      const aggregated = aggregateKBarRows(kbarRows, minutes);
      const ranged = filterIntradayTradingDays(aggregated, intradayRange);
      return compressIntradayTimeline(ranged, minutes);
    }
    return filterRange(aggregateDailyBars(effectiveBars, interval), range);
  }, [effectiveBars, interval, intradayRange, kbarRows, range]);
  const chartViewportKey = useMemo(() => {
    // Keep the viewport key stable while live data appends new bars.
    // Otherwise every refresh changes length/last-dt and resets user pan/zoom.
    return [
      symbol,
      interval,
      isIntraday ? intradayRange : range,
    ].join("|");
  }, [interval, intradayRange, isIntraday, range, symbol]);
  const tradingRoomDailyDepthShort = compactTradingRoom
    && !isIntraday
    && chartBars.length > 0
    && effectiveOfficialBars < TRADING_ROOM_PRODUCT_DAILY_BARS;
  const tradingRoomSparseDerivedInterval = compactTradingRoom
    && !isIntraday
    && interval !== "1d"
    && chartBars.length > 0
    && chartBars.length < MIN_TREND_BARS;
  const insufficientTrend = !isIntraday
    && chartBars.length > 0
    && (chartBars.length < MIN_TREND_BARS || tradingRoomDailyDepthShort);
  useEffect(() => {
    if (isIntraday && chartBars.length === 0 && effectiveBars.length >= MIN_TREND_BARS) {
      setInterval("1d");
      setRange("all");
      setHoverBar(null);
    }
  }, [chartBars.length, effectiveBars.length, isIntraday]);
  useEffect(() => {
    if (
      compactTradingRoom &&
      !isIntraday &&
      interval !== "1d" &&
      chartBars.length > 0 &&
      chartBars.length < MIN_TREND_BARS
    ) {
      setInterval("1d");
      setRange("all");
      setHoverBar(null);
    }
  }, [chartBars.length, compactTradingRoom, effectiveBars.length, interval, isIntraday]);
  const selectedIntradayDates = useMemo(() => intradayDatesForRange(kbarRows, intradayRange), [intradayRange, kbarRows]);
  const intradayCoverage = useMemo(() => {
    if (!isIntraday) return null;
    const tradingDays = selectedIntradayDates.size;
    const rawRows = kbarRows.filter((row) => selectedIntradayDates.has(row.date)).length;
    const expectedRawRows = tradingDays * TWSE_INTRADAY_MINUTES;
    const expectedAggregatedRows = Math.max(1, Math.ceil(expectedRawRows / activeIntradayMinutes));
    const rawCoveragePct = expectedRawRows > 0 ? (rawRows / expectedRawRows) * 100 : 0;
    const aggregatedCoveragePct = expectedAggregatedRows > 0 ? (chartBars.length / expectedAggregatedRows) * 100 : 0;
    const suggestedRange = suggestIntradayRange(kbarRows, activeIntradayMinutes);
    const oneDayRawRows = rawRowsInLastTradingDays(kbarRows, 1);

    return {
      tradingDays,
      rawRows,
      expectedRawRows,
      rawCoveragePct,
      aggregatedCoveragePct,
      suggestedRange,
      oneDayRawRows,
      isSparse: rawCoveragePct > 0 && rawCoveragePct < 45,
    };
  }, [activeIntradayMinutes, chartBars.length, isIntraday, kbarRows, selectedIntradayDates]);

  // ── Derived indicator values from chartBars.closes ────────────────────────
  const closes = useMemo(() => chartBars.map((b) => b.close), [chartBars]);

  const maValues = useMemo(() => ({
    ma5:  calcSMA(closes, 5),
    ma10: calcSMA(closes, 10),
    ma20: calcSMA(closes, 20),
    ma60: calcSMA(closes, 60),
  }), [closes]);

  const vwapValues = useMemo(() => calcVWAP(chartBars), [chartBars]);

  const volumePriceLevels = useMemo(() => calcVolumePriceLevels(chartBars), [chartBars]);

  const rsiValues = useMemo(() => calcRSI(closes, 14), [closes]);

  const macdResult = useMemo(() => calcMACD(closes), [closes]);
  const indicatorSignals = useMemo(() => {
    const lastClose = chartBars.at(-1)?.close ?? null;
    return buildIndicatorSignals({
      lastClose,
      ma20: latestFinite(maValues.ma20),
      ma60: latestFinite(maValues.ma60),
      vwap: latestFinite(vwapValues),
      rsi: latestFinite(rsiValues),
      macdHist: latestFinite(macdResult.hist),
      support: volumePriceLevels.support,
      resistance: volumePriceLevels.resistance,
    });
  }, [chartBars, maValues, macdResult.hist, rsiValues, volumePriceLevels.resistance, volumePriceLevels.support, vwapValues]);

  const selectInterval = (nextInterval: EnabledInterval) => {
    const nextMeta = ENABLED_INTERVALS.find((item) => item.value === nextInterval);
    setInterval(nextInterval);
    setHoverBar(null);
    if (nextMeta?.kind === "intraday" && activeMeta?.kind !== "intraday") {
      setIntradayRange(suggestIntradayRange(kbarRows, nextMeta.minutes ?? 1));
    }
  };

  const applyLogicalRange = (nextRange: ChartLogicalRange) => {
    if (!chartRef.current || chartBars.length === 0) return;
    const width = Math.max(8, nextRange.to - nextRange.from);
    const maxTo = chartBars.length + 6;
    const to = Math.min(maxTo, Math.max(width, nextRange.to));
    const from = Math.max(0, to - width);
    const clamped = { from, to };
    chartRef.current.timeScale().setVisibleLogicalRange(clamped);
    viewportRef.current = { key: chartViewportKey, range: clamped };
    setVisibleRange(clamped);
  };

  const applyDefaultLatestRange = () => {
    if (!chartRef.current || chartBars.length === 0) return;
    const count = visibleBarsFor(interval, range);
    applyLogicalRange({
      from: Math.max(0, chartBars.length - count),
      to: chartBars.length + 4,
    });
  };

  const zoomLogicalRange = (multiplier: number) => {
    if (!chartRef.current || chartBars.length === 0) return;
    const current = chartRef.current.timeScale().getVisibleLogicalRange();
    if (!current || !Number.isFinite(current.from) || !Number.isFinite(current.to) || current.to <= current.from) return;
    const currentWidth = current.to - current.from;
    const minWidth = Math.min(chartBars.length, Math.max(12, isIntraday ? 48 : 36));
    const maxWidth = Math.max(minWidth, chartBars.length + 8);
    const nextWidth = Math.min(maxWidth, Math.max(minWidth, currentWidth * multiplier));
    const center = (current.from + current.to) / 2;
    applyLogicalRange({
      from: center - nextWidth / 2,
      to: center + nextWidth / 2,
    });
  };

  const fitAllBars = () => {
    if (!chartRef.current || chartBars.length === 0) return;
    chartRef.current.timeScale().fitContent();
    viewportRef.current = { key: chartViewportKey, range: null };
    setVisibleRange(null);
  };

  useEffect(() => {
    setHoverBar(null);
    setVisibleRange(null);
  }, [chartViewportKey]);

  // ── Lightweight-charts effect (candlestick + MA overlays) ──────────────────
  useEffect(() => {
    if (!containerRef.current || !chartBars.length) return;

    let chart: import("lightweight-charts").IChartApi | null = null;
    let ro: ResizeObserver | null = null;
    let rememberRange: ((nextRange: import("lightweight-charts").LogicalRange | null) => void) | null = null;
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
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: false,
          },
          handleScale: {
            axisPressedMouseMove: true,
            mouseWheel: true,
            pinch: true,
          },
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

        // ── MA overlays (LineSeries) ───────────────────────────────────────
        if (indicators.ma) {
          for (const cfg of MA_CONFIG) {
            if (!maEnabled[cfg.key]) continue;
            const vals = maValues[cfg.key];
            const data = chartBars
              .map((bar, i) => ({ time: bar.time, value: vals[i] }))
              .filter((d): d is { time: ChartTime; value: number } => d.value !== null);
            if (data.length === 0) continue;
            const maSeries = chart.addSeries(lc.LineSeries, {
              color: cfg.color,
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: true,
              crosshairMarkerVisible: false,
            });
            maSeries.setData(data);
          }
        }

        if (indicators.vwap) {
          const data = chartBars
            .map((bar, i) => ({ time: bar.time, value: vwapValues[i] }))
            .filter((d): d is { time: ChartTime; value: number } => d.value !== null);
          if (data.length > 0) {
            const vwapSeries = chart.addSeries(lc.LineSeries, {
              color: "#8fbfe8",
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: true,
              crosshairMarkerVisible: false,
            });
            vwapSeries.setData(data);
          }
        }

        if (indicators.sr) {
          if (volumePriceLevels.support !== null) {
            candleSeries.createPriceLine({
              price: volumePriceLevels.support,
              color: "#ecc94b",
              lineWidth: 1,
              lineStyle: lc.LineStyle.Dashed,
              axisLabelVisible: true,
              title: "量價支撐",
            });
          }
          if (volumePriceLevels.resistance !== null) {
            candleSeries.createPriceLine({
              price: volumePriceLevels.resistance,
              color: "#f56565",
              lineWidth: 1,
              lineStyle: lc.LineStyle.Dashed,
              axisLabelVisible: true,
              title: "量價壓力",
            });
          }
        }

        if (indicators.plan && planLevels) {
          const planLines = [
            { price: planLevels.entry, color: "#48bb78", title: "計畫進場", style: lc.LineStyle.Dotted },
            { price: planLevels.stop, color: "#f56565", title: "計畫停損", style: lc.LineStyle.Dotted },
            { price: planLevels.target, color: "#63b3ed", title: "計畫目標", style: lc.LineStyle.Dotted },
          ];
          for (const line of planLines) {
            if (typeof line.price !== "number" || !Number.isFinite(line.price) || line.price <= 0) continue;
            candleSeries.createPriceLine({
              price: line.price,
              color: line.color,
              lineWidth: 1,
              lineStyle: line.style,
              axisLabelVisible: true,
              title: line.title,
            });
          }
        }

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

        const setLogicalRange = (nextRange: ChartLogicalRange) => {
          chart?.timeScale().setVisibleLogicalRange(nextRange);
          viewportRef.current = { key: chartViewportKey, range: nextRange };
          setVisibleRange(nextRange);
        };
        const savedViewport = viewportRef.current.key === chartViewportKey ? viewportRef.current.range : null;
        if (
          savedViewport
          && Number.isFinite(savedViewport.from)
          && Number.isFinite(savedViewport.to)
          && savedViewport.to > savedViewport.from
        ) {
          setLogicalRange(savedViewport);
        } else if (chartBars.length > 12) {
          const count = visibleBarsFor(interval, range);
          setLogicalRange({
            from: Math.max(0, chartBars.length - count),
            to: chartBars.length + 4,
          });
        } else {
          chart.timeScale().fitContent();
          viewportRef.current = { key: chartViewportKey, range: null };
          setVisibleRange(null);
        }

        rememberRange = (nextRange: import("lightweight-charts").LogicalRange | null) => {
          if (!nextRange || !Number.isFinite(nextRange.from) || !Number.isFinite(nextRange.to)) return;
          viewportRef.current = {
            key: chartViewportKey,
            range: { from: nextRange.from, to: nextRange.to },
          };
          setVisibleRange({ from: nextRange.from, to: nextRange.to });
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(rememberRange);

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
      if (chart && rememberRange) chart.timeScale().unsubscribeVisibleLogicalRangeChange(rememberRange);
      chart?.remove();
      chartRef.current = null;
    };
  }, [activeIntradayMinutes, chartBars, chartHeight, chartViewportKey, interval, isIntraday, range, indicators.ma, indicators.plan, indicators.sr, indicators.vwap, maEnabled, maValues, planLevels, volumePriceLevels, vwapValues]);

  const badgeClass = isIntraday
    ? kbarState === "LIVE" ? "badge-green" : kbarState === "BLOCKED" ? "badge-red" : "badge-yellow"
    : sourceBadgeClass(effectiveBars);
  const badgeLabel = isIntraday
    ? kbarState === "LIVE" ? "FinMind 分K" : kbarState === "BLOCKED" ? "分K 無法顯示" : "分K 無資料"
    : sourceBadgeLabel(effectiveBars);
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
    ? kbarRows.filter((row) => selectedIntradayDates.has(row.date)).length
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

  const renderInsufficientAsCard = tradingRoomDailyDepthShort || tradingRoomSparseDerivedInterval;
  const showSubCharts = !compactTradingRoom && chartBars.length >= MIN_TREND_BARS;
  const compactIndicatorSignals = indicatorSignals.filter((signal) => {
    if (signal.key === "ma20" || signal.key === "ma60") return indicators.ma;
    if (signal.key === "vwap") return indicators.vwap;
    if (signal.key === "rsi") return indicators.rsi;
    if (signal.key === "macd") return indicators.macd;
    if (signal.key === "support-gap" || signal.key === "resistance-gap") return indicators.sr;
    return true;
  }).slice(0, 5);
  const visibleBarCount = visibleRange
    ? Math.max(1, Math.min(chartBars.length, Math.round(visibleRange.to - visibleRange.from)))
    : Math.min(chartBars.length, visibleBarsFor(interval, range));

  return (
    <section className="panel hud-frame kline-panel">
      <style>{INDICATOR_CSS}</style>
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

      {/* ── Indicator Toggle Bar ─────────────────────────────────────────── */}
      <div className="_ind-toggle-bar">
        <span className="_ind-toggle-bar-label">指標</span>

        {/* MA master toggle */}
        <button
          type="button"
          className={`_ind-toggle-btn${indicators.ma ? " is-on" : ""}`}
          onClick={() => toggleIndicator("ma")}
          aria-pressed={indicators.ma}
          title="均線疊加"
        >
          均線
        </button>

        {/* MA sub-toggles — only show when MA is on */}
        {indicators.ma && (
          <div className="_ind-ma-expand">
            {MA_CONFIG.map((cfg) => (
              <button
                key={cfg.key}
                type="button"
                className={`_ind-toggle-btn _${cfg.key}${maEnabled[cfg.key] ? " is-on" : ""}`}
                onClick={() => toggleMa(cfg.key)}
                aria-pressed={maEnabled[cfg.key]}
                title={`${cfg.label} ${cfg.period} 日均線`}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className={`_ind-toggle-btn _vwap${indicators.vwap ? " is-on" : ""}`}
          onClick={() => toggleIndicator("vwap")}
          aria-pressed={indicators.vwap}
          title="VWAP"
        >
          VWAP
        </button>

        <button
          type="button"
          className={`_ind-toggle-btn _sr${indicators.sr ? " is-on" : ""}`}
          onClick={() => toggleIndicator("sr")}
          aria-pressed={indicators.sr}
          title="用最近量價 pivot 計算支撐與壓力"
        >
          量價支撐/壓力
        </button>

        <button
          type="button"
          className={`_ind-toggle-btn _plan${indicators.plan ? " is-on" : ""}`}
          onClick={() => toggleIndicator("plan")}
          aria-pressed={indicators.plan}
          title="顯示 AI/交易計畫帶入的進場、停損與目標價"
        >
          計畫點位
        </button>

        <div className="_ind-divider" />

        {/* RSI toggle */}
        <button
          type="button"
          className={`_ind-toggle-btn${indicators.rsi ? " is-on" : ""}`}
          onClick={() => toggleIndicator("rsi")}
          aria-pressed={indicators.rsi}
          title="RSI 14 相對強弱"
        >
          RSI
        </button>

        {/* MACD toggle */}
        <button
          type="button"
          className={`_ind-toggle-btn${indicators.macd ? " is-on" : ""}`}
          onClick={() => toggleIndicator("macd")}
          aria-pressed={indicators.macd}
          title="MACD 12/26/9"
        >
          MACD
        </button>
      </div>

      {(volumePriceLevels.support !== null || volumePriceLevels.resistance !== null || planLevels) && (
        <div className="_ind-level-readout" data-indicator-readout="volume-price">
          {volumePriceLevels.support !== null && <span>量價支撐 <b>{formatNumber(volumePriceLevels.support)}</b></span>}
          {volumePriceLevels.resistance !== null && <span>量價壓力 <b>{formatNumber(volumePriceLevels.resistance)}</b></span>}
          {planLevels?.entry ? <span className="_plan">進場 <b>{formatNumber(planLevels.entry)}</b></span> : null}
          {planLevels?.stop ? <span className="_plan">停損 <b>{formatNumber(planLevels.stop)}</b></span> : null}
          {planLevels?.target ? <span className="_plan">目標 <b>{formatNumber(planLevels.target)}</b></span> : null}
        </div>
      )}

      {compactTradingRoom && (compactIndicatorSignals.length > 0 || chartBars.length > 0) && (
        <div className="kline-signal-strip" data-testid="trading-room-kline-signal-strip" aria-label="交易室量價指標摘要">
          <div className="kline-signal-chip source">
            <span>資料基礎</span>
            <b>{chartBars.length.toLocaleString("zh-TW")} 根</b>
            <small>{isIntraday ? `${activeMeta?.label ?? "分K"} 真實成交分鐘` : `${activeMeta?.label ?? "日K"} OHLCV`}</small>
          </div>
          {compactIndicatorSignals.map((signal) => (
            <div key={signal.key} className={`kline-signal-chip ${signal.tone}`}>
              <span>{signal.label}</span>
              <b>{signal.value}</b>
              <small>{signal.detail}</small>
            </div>
          ))}
        </div>
      )}

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

      {chartBars.length > 0 && (
        <div className="kline-viewport-tools" data-testid="kline-viewport-tools" aria-label="K 線視窗控制">
          <span className="label">視窗</span>
          <button type="button" onClick={() => zoomLogicalRange(0.72)} title="放大目前視窗，顯示更少 K 棒">
            放大
          </button>
          <button type="button" onClick={() => zoomLogicalRange(1.38)} title="縮小目前視窗，顯示更多 K 棒">
            縮小
          </button>
          <button type="button" onClick={applyDefaultLatestRange} title="回到最新 K 棒附近，保留目前週期的合理視窗">
            回最新
          </button>
          <button type="button" onClick={fitAllBars} title="顯示目前資料範圍內全部 K 棒">
            全覽
          </button>
          <span className="count">
            顯示 {visibleBarCount.toLocaleString("zh-TW")} / {chartBars.length.toLocaleString("zh-TW")} 根
          </span>
        </div>
      )}

      <div className="kline-pending-line">
        <span className={`tg ${stateToneClass(kbarState)}`}>{stateLabel(kbarState)}</span>
        <span className="tg soft">
          {kbarState === "LIVE"
            ? `FinMind Sponsor ${kbarDate ?? ""} 已回傳 ${kbarRows.length.toLocaleString("zh-TW")} 根 1 分 K${kbarTradingDays > 1 ? ` / ${kbarTradingDays} 個交易日` : ""}，分 K 只畫真實成交分鐘；低流動空窗不補假線。`
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
          {isIntraday && intradayCoverage && <span>成交覆蓋 {formatPercent(intradayCoverage.rawCoveragePct)}</span>}
          {isIntraday && <span>空窗不補假線，可拖曳回看</span>}
          <span>{firstBar?.label} - {lastBar?.label}</span>
          <span>收 {formatNumber(lastBar?.close)}</span>
          <span>量 {formatNumber(lastBar?.volume, 0)}</span>
        </div>
      )}

      {isIntraday && intradayCoverage && (
        <div className={`kline-density-strip${intradayCoverage.isSparse ? " is-sparse" : ""}`}>
          <div>
            <span>成交密度</span>
            <b>{intradayCoverage.isSparse ? "稀疏" : "足夠"}</b>
          </div>
          <div>
            <span>成交分鐘</span>
            <b>
              {intradayCoverage.rawRows.toLocaleString("zh-TW")}
              <small> / 約 {intradayCoverage.expectedRawRows.toLocaleString("zh-TW")}</small>
            </b>
          </div>
          <div>
            <span>彙整後</span>
            <b>
              {chartBars.length.toLocaleString("zh-TW")}
              <small> 根 {activeMeta?.label}</small>
            </b>
          </div>
          <div>
            <span>視窗</span>
            <b>
              {intradayRange !== "1d" && intradayRange === intradayCoverage.suggestedRange ? "自動展開" : "手動"}
              <small>{INTRADAY_RANGE_OPTIONS.find((item) => item.value === intradayRange)?.label}</small>
            </b>
          </div>
          {intradayCoverage.isSparse && (
            <p>
              這檔最近成交分鐘偏少，圖上缺口是市場沒有成交，不是 FinMind 沒接；可改看 15 / 60 分或拉長到 20 日。
            </p>
          )}
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
      ) : renderInsufficientAsCard && insufficientTrend ? (
        <KlineInsufficientState
          bars={chartBars}
          intervalLabel={activeMeta?.label ?? "K 線"}
          sourceLabel={badgeLabel}
          requiredBars={TRADING_ROOM_PRODUCT_DAILY_BARS}
          depthState={deepRefetchState}
          depthError={deepRefetchError}
        />
      ) : (
        <div className="kline-chart-shell">
          {insufficientTrend && (
            <div className="kline-density-strip is-sparse" data-testid="kline-backfill-warning">
              <div>
                <span>資料樣本</span>
                <b>{chartBars.length.toLocaleString("zh-TW")}<small> / 最低 {MIN_TREND_BARS}</small></b>
              </div>
              <div>
                <span>回補策略</span>
                <b>已啟動<small>10 年日線 / 20 日分 K</small></b>
              </div>
              <p>
                目前仍畫出已取得的真實 K 線；後端會略過過短快取並向 FinMind 補足歷史樣本，不用假資料補線。
              </p>
            </div>
          )}
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

          {/* ── RSI sub-chart ─────────────────────────────────────── */}
          {showSubCharts && indicators.rsi && (
            <div className="_ind-sub-section">
              <RsiSubChart rsiValues={rsiValues} n={chartBars.length} />
            </div>
          )}

          {/* ── MACD sub-chart ────────────────────────────────────── */}
          {showSubCharts && indicators.macd && (
            <div className="_ind-sub-section">
              <MacdSubChart
                difValues={macdResult.dif}
                deaValues={macdResult.dea}
                histValues={macdResult.hist}
                n={chartBars.length}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function KlineInsufficientState({
  bars,
  intervalLabel,
  sourceLabel,
  requiredBars,
  depthState,
  depthError,
}: {
  bars: ChartBar[];
  intervalLabel: string;
  sourceLabel: string;
  requiredBars: number;
  depthState: "idle" | "loading" | "ready" | "failed";
  depthError: string | null;
}) {
  const latest = bars.at(-1);
  const statusCopy =
    depthState === "loading"
      ? "正在重新抓取 10 年日 K，完成後會自動切回正式圖表。"
      : depthState === "failed"
        ? `深度回補仍未達產品門檻${depthError ? `（${depthError}）` : ""}，暫停畫趨勢圖避免誤導。`
        : "目前資料深度不足，暫停畫趨勢圖避免誤導。";
  return (
    <div className="kline-insufficient">
      <div>
        <span className="badge badge-yellow">資料不足</span>
        <h4>目前只有 {bars.length.toLocaleString("zh-TW")} 根 {intervalLabel}，先顯示最近成交，不畫趨勢圖。</h4>
        <p className="kline-depth-status">
          產品門檻：至少 {requiredBars.toLocaleString("zh-TW")} 根正式日 K。{statusCopy}
        </p>
        <p>
          交易室會先抓 10 年正式日 K；未達門檻時只列出最近成交，不用少量資料畫趨勢。
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
