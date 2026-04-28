"use client";
/**
 * StockDetailPanel — Stock Detail Panel (Phase 2 wire-up)
 * Ported from sandbox v0.7.0-w4 (Lane C v4 TODO #1: iuf:timezone / iuf:interval event listeners)
 *
 * Integrates: KLineChart, IntervalToggle, TimezoneToggle, BidAskLadder, TickTape,
 *             FreshnessBadge, PositionContainmentBadge, OrderLockedBanner
 *
 * Lane C v4 addition: useEffect wires window "iuf:timezone" + "iuf:interval" custom events
 * so CommandPalette (⌘K) can update chart timezone/interval without prop drilling.
 *
 * Phase 2: getKBarsAsync — tries real API, falls back to mock silently.
 * Layout: chart 60% / right panel 40% on desktop, stacked on mobile.
 */
import { useEffect, useState } from "react";
import { KLineChart } from "./KLineChart";
import { IntervalToggle, type KLineInterval } from "./IntervalToggle";
import { TimezoneToggle, type ChartTimezone } from "./TimezoneToggle";
import { BidAskLadder } from "./BidAskLadder";
import { TickTape } from "./TickTape";
import { FreshnessBadge } from "./FreshnessBadge";
import { PositionContainmentBadge } from "./PositionContainmentBadge";
import { OrderLockedBanner } from "./OrderLockedBanner";
import { getKBarsAsync, USE_REAL_KBAR_API, type OHLCV } from "@/lib/mock-kbar";

interface StockDetailPanelProps {
  symbol:      string;
  lastPx:      number;
  mainVisual?: boolean;
}

const T = {
  ruleS: "rgba(232,223,200,0.22)",
  bg:    "#0d0e0a",
  bg1:   "#15170f",
} as const;

export function StockDetailPanel({ symbol, lastPx, mainVisual = false }: StockDetailPanelProps) {
  const [interval, setInterval] = useState<KLineInterval>("D");
  const [timezone, setTimezone] = useState<ChartTimezone>("Asia/Taipei");
  const [kbarData, setKbarData] = useState<OHLCV[]>([]);
  const [kbarSource, setKbarSource] = useState<"live" | "mock">("mock");
  const [kbarEndpointUnavailable, setKbarEndpointUnavailable] = useState(false);

  // Phase 2: async K-bar load — re-fires when symbol or interval changes
  useEffect(() => {
    let cancelled = false;
    setKbarEndpointUnavailable(false);

    getKBarsAsync(symbol, interval, 100)
      .then((bars) => {
        if (!cancelled) {
          setKbarData(bars);
          setKbarSource(USE_REAL_KBAR_API ? "live" : "mock");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKbarData([]);
          setKbarSource("mock");
          if (USE_REAL_KBAR_API) setKbarEndpointUnavailable(true);
        }
      });

    return () => { cancelled = true; };
  }, [symbol, interval]);

  // Lane C v4 TODO #1: wire iuf:timezone + iuf:interval custom events
  useEffect(() => {
    const onTz = (e: Event) => {
      const detail = (e as CustomEvent<{ tz: string }>).detail;
      if (detail?.tz === "Asia/Taipei" || detail?.tz === "UTC" || detail?.tz === "America/New_York") {
        setTimezone(detail.tz as ChartTimezone);
      }
    };
    const onIv = (e: Event) => {
      const detail = (e as CustomEvent<{ iv: string }>).detail;
      const validIntervals: KLineInterval[] = ["1m", "5m", "15m", "1h", "4h", "D", "W", "M"];
      if (detail?.iv && (validIntervals as string[]).includes(detail.iv)) {
        setInterval(detail.iv as KLineInterval);
      }
    };
    window.addEventListener("iuf:timezone", onTz);
    window.addEventListener("iuf:interval", onIv);
    return () => {
      window.removeEventListener("iuf:timezone", onTz);
      window.removeEventListener("iuf:interval", onIv);
    };
  }, []);

  const kbarFreshness =
    kbarData.length === 0 ? "no_data" as const :
    kbarSource === "live"  ? "fresh"   as const :
                             "stale"   as const;

  const kbarTooltip = kbarSource === "live"
    ? `Live K-bars from GET /api/v1/kgi/quote/kbar?symbol=${symbol}&interval=${interval}`
    : kbarEndpointUnavailable
      ? `K-bar endpoint unreachable — using mock data`
      : USE_REAL_KBAR_API
        ? `K-bar endpoint returned 0 bars — using mock data`
        : `Mock K-bars (NEXT_PUBLIC_USE_REAL_KBAR_API=false)`;

  const chartHeight = mainVisual ? 500 : 420;

  return (
    <div style={{ background: T.bg, border: `1px solid ${T.ruleS}` }}>
      <OrderLockedBanner />

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, background: T.bg1 }}>
        <IntervalToggle value={interval} onChange={setInterval} />
        <TimezoneToggle value={timezone} onChange={setTimezone} />
        <div style={{ marginLeft: "auto", paddingRight: 10 }}>
          <FreshnessBadge
            freshness={kbarFreshness}
            label="K-BAR"
            tooltip={kbarTooltip}
            endpointUnavailable={kbarEndpointUnavailable}
          />
        </div>
      </div>

      <div
        className="sdp-grid"
        style={{
          display:             "grid",
          gridTemplateColumns: mainVisual ? "3fr 2fr" : "minmax(0,1fr) 280px",
          gap:                 0,
        }}
      >
        <div className="sdp-chart" style={{ borderRight: `1px solid ${T.ruleS}`, minWidth: 0 }}>
          <KLineChart
            symbol={symbol}
            interval={interval}
            data={kbarData}
            height={chartHeight}
            timezone={timezone}
          />
        </div>

        <div className="sdp-right" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ borderBottom: `1px solid ${T.ruleS}` }}>
            <BidAskLadder symbol={symbol} lastPx={lastPx} />
          </div>
          <TickTape symbol={symbol} lastPx={lastPx} />
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${T.ruleS}` }}>
        <PositionContainmentBadge />
      </div>

      <style>{`
        @media (max-width: 768px) {
          .sdp-grid { grid-template-columns: 1fr !important; }
          .sdp-chart { border-right: none !important; border-bottom: 1px solid var(--night-rule-strong, rgba(232,223,200,0.22)); }
        }
        @media (max-width: 640px) {
          .sdp-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
