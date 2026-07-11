"use client";

/**
 * MarketStateBanner — top amber/red banner showing market rest state.
 *
 * Derives freshness (live vs. eod vs. cache) from local TST time using
 * isKgiTradingHours helper. The DISPLAYED DATE, however, is never derived
 * from the wall clock (see P0-5 fix note in `lib/market-state-banner.ts`):
 * it comes from the caller's `lastCloseDate` prop when supplied, otherwise
 * this component fetches `GET /api/v1/market-data/overview` itself (same
 * endpoint `TickerTape`/`lib/ticker-tape.ts` already call — zero new
 * backend) and reads the data's own trade date from
 * `marketContext.index.timestamp`. If neither source has a date, no date is
 * shown — just "收盤資料", never a calendar guess.
 *
 * Placement: below page header in /, /companies/*, /ai-recommendations, /market-intel.
 * Shows nothing during live trading hours (transparent).
 *
 * dataFreshness prop (optional): override from backend when available:
 *   "live"  → no banner
 *   "eod"   → amber: 休市 / 收盤說明
 *   "cache" → red: 緩存延遲說明
 */

import { useEffect, useState } from "react";
import { getMarketDataOverview } from "@/lib/api";
import {
  buildBannerText,
  deriveFreshness,
  formatTradeDateWithWeekday,
  type DataFreshness,
} from "@/lib/market-state-banner";

type Props = {
  /** Override from backend when available; if omitted, derived from local TST clock */
  dataFreshness?: DataFreshness;
  /** ISO date string of last close (e.g. "2026-05-17") for banner wording */
  lastCloseDate?: string | null;
};

export function MarketStateBanner({ dataFreshness: propFreshness, lastCloseDate }: Props) {
  const [freshness, setFreshness] = useState<DataFreshness>("live");
  const [closeLabel, setCloseLabel] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setFreshness(propFreshness ?? deriveFreshness(new Date()));
  }, [propFreshness]);

  useEffect(() => {
    if (lastCloseDate) {
      setCloseLabel(formatTradeDateWithWeekday(lastCloseDate));
      return;
    }
    // No override supplied by the caller — read the real trade date from the
    // data itself (never guess it from the calendar; see P0-5).
    let cancelled = false;
    getMarketDataOverview({ includeStale: true, topLimit: 1 })
      .then((response) => {
        if (cancelled) return;
        const asOf = response.data?.marketContext?.index?.timestamp ?? null;
        setCloseLabel(formatTradeDateWithWeekday(asOf));
      })
      .catch(() => {
        if (!cancelled) setCloseLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lastCloseDate]);

  // SSR: render nothing (avoid hydration mismatch; banner is cosmetic)
  if (!mounted || freshness === "live") return null;

  const text = buildBannerText(freshness, closeLabel);
  if (!text) return null;

  if (freshness === "eod") {
    return (
      <div className="tac-market-state-banner is-eod" role="status" aria-label="市場休市說明">
        <span>{text}</span>
        <small>即時行情將於下一交易日 09:00 恢復</small>
      </div>
    );
  }

  if (freshness === "cache") {
    return (
      <div className="tac-market-state-banner is-cache" role="status" aria-label="資料延遲說明">
        <span>{text}</span>
        <small>自動重試中，請稍候</small>
      </div>
    );
  }

  return null;
}
