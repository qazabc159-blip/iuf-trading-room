"use client";

import { useEffect, useMemo, useState } from "react";
import { RadarCandlestickChart, type RadarChartBar, type RadarChartInterval } from "@/components/RadarCandlestickChart";
import type { ChartInterval, ChartProps, ChartStreamState } from "@/lib/radar-types";
import { getKBarsAsync } from "@/lib/mock-kbar";

const CHART_INTERVALS: RadarChartInterval[] = ["1m", "5m", "15m", "1d"];
const RADAR_INTERVALS = new Set<RadarChartInterval>(["1m", "5m", "15m", "1d", "5d", "1mo", "3mo", "6mo", "1y"]);

function normalizeInterval(interval?: ChartInterval): RadarChartInterval {
  if (interval && RADAR_INTERVALS.has(interval as RadarChartInterval)) return interval as RadarChartInterval;
  return "1d";
}

function adapterInterval(interval: RadarChartInterval) {
  if (interval === "1mo" || interval === "3mo" || interval === "6mo") return "D";
  if (interval === "1y") return "D";
  if (interval === "5d") return "D";
  return interval === "1d" ? "D" : interval;
}

function limitForInterval(interval: RadarChartInterval) {
  if (interval === "1m") return 160;
  if (interval === "5m") return 140;
  if (interval === "15m") return 120;
  if (interval === "5d") return 5;
  if (interval === "1mo") return 22;
  if (interval === "3mo") return 66;
  if (interval === "6mo") return 132;
  if (interval === "1y") return 252;
  return 110;
}

function streamStateToRadar(state?: ChartStreamState) {
  if (state === "live") return "LIVE" as const;
  if (state === "error") return "OFFLINE" as const;
  return "STALE" as const;
}

function freshnessFromTick(iso: string | null, fallback?: ChartStreamState) {
  if (!iso) return streamStateToRadar(fallback);
  const ageMs = Date.now() - new Date(iso).getTime();
  if (ageMs < 10_000) return "LIVE" as const;
  if (ageMs < 60_000) return "STALE" as const;
  return "OFFLINE" as const;
}

function tickLastBar(prev: RadarChartBar[], symbol: string) {
  if (prev.length === 0) return prev;
  const last = prev[prev.length - 1];
  const seed = Number(symbol.replace(/\D/g, "").slice(-3) || "17");
  const phase = Date.now() / 1800 + seed;
  const drift = Math.sin(phase) * last.close * 0.0009;
  const close = Number(Math.max(0.01, last.close + drift).toFixed(2));
  const next: RadarChartBar = {
    ...last,
    close,
    high: Number(Math.max(last.high, close).toFixed(2)),
    low: Number(Math.min(last.low, close).toFixed(2)),
    volume: (last.volume ?? 0) + 1 + (seed % 9),
  };
  return [...prev.slice(0, -1), next];
}

export function Chart({
  symbol,
  interval = "1d",
  height = 520,
  onReady,
  onTickStream,
  onError,
  streamState,
  onIntervalChange,
  intervalOptions,
  sourceLabel,
}: ChartProps) {
  const [selectedInterval, setSelectedInterval] = useState<RadarChartInterval>(() => normalizeInterval(interval));
  const [bars, setBars] = useState<RadarChartBar[]>([]);
  const [lastTickAt, setLastTickAt] = useState<string | null>(null);
  const [agentHeartbeatAt, setAgentHeartbeatAt] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<ChartStreamState>(streamState ?? "connecting");

  useEffect(() => {
    setSelectedInterval(normalizeInterval(interval));
  }, [interval]);

  useEffect(() => {
    let alive = true;
    setLoadState("connecting");
    getKBarsAsync(symbol, adapterInterval(selectedInterval), limitForInterval(selectedInterval))
      .then((nextBars) => {
        if (!alive) return;
        setBars(nextBars);
        const now = new Date().toISOString();
        setLastTickAt(now);
        setAgentHeartbeatAt(now);
        setLoadState("live");
        onReady?.();
      })
      .catch((error) => {
        if (!alive) return;
        setLoadState("error");
        onError?.(error instanceof Error ? error : new Error(String(error)));
      });

    return () => {
      alive = false;
    };
  }, [onError, onReady, selectedInterval, symbol]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBars((prev) => {
        const nextBars = tickLastBar(prev, symbol);
        const last = nextBars[nextBars.length - 1];
        if (last) {
          const now = new Date().toISOString();
          setLastTickAt(now);
          setAgentHeartbeatAt(now);
          setLoadState("live");
          onTickStream?.({ symbol, price: last.close, ts: now });
        }
        return nextBars;
      });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [onTickStream, symbol]);

  const radarState = useMemo(
    () => freshnessFromTick(lastTickAt, streamState ?? loadState),
    [lastTickAt, loadState, streamState],
  );

  function changeInterval(next: RadarChartInterval) {
    setSelectedInterval(next);
    onIntervalChange?.(next);
  }

  return (
    <RadarCandlestickChart
      symbol={symbol}
      bars={bars}
      interval={selectedInterval}
      onIntervalChange={changeInterval}
      intervalOptions={intervalOptions?.map(normalizeInterval)}
      sourceLabel={sourceLabel}
      state={radarState}
      lastTickAt={lastTickAt ?? undefined}
      agentHeartbeatAt={agentHeartbeatAt ?? undefined}
      height={height}
    />
  );
}

export { CHART_INTERVALS };
