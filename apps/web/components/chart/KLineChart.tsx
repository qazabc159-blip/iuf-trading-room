"use client";

import { RadarCandlestickChart, type RadarChartInterval } from "@/components/RadarCandlestickChart";
import type { OHLCV } from "@/lib/mock-kbar";

export interface KLineChartProps {
  symbol: string;
  interval: string;
  data: OHLCV[];
  height?: number;
  timezone?: string;
}

function normalizeInterval(interval: string): RadarChartInterval {
  if (interval === "1m" || interval === "5m" || interval === "15m") return interval;
  return "1d";
}

export function KLineChart({ symbol, interval, data, height = 480 }: KLineChartProps) {
  return (
    <RadarCandlestickChart
      symbol={symbol}
      bars={data}
      interval={normalizeInterval(interval)}
      state={data.length > 0 ? "STALE" : "OFFLINE"}
      height={height}
    />
  );
}
