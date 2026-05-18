"use client";

/**
 * MarketStateBanner — top amber/red banner showing market rest state.
 *
 * Derives freshness from local TST time using isKgiTradingHours helper.
 * When Jason's backend adds dataFreshness to API response, wire it as prop override.
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
import { isKgiTradingHours } from "@/lib/kgi-trading-hours";

type DataFreshness = "live" | "eod" | "cache";

type Props = {
  /** Override from backend when available; if omitted, derived from local TST clock */
  dataFreshness?: DataFreshness;
  /** ISO date string of last close (e.g. "2026-05-17") for banner wording */
  lastCloseDate?: string | null;
};

const TAIPEI_TZ = "Asia/Taipei";

function taipeiDate(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: TAIPEI_TZ });
}

function formatTaipeiDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "--";
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${month}/${day}`;
}

function deriveFreshness(now: Date): DataFreshness {
  // During TST trading hours: live
  if (isKgiTradingHours(now)) return "live";
  // Otherwise: show as eod (weekend or after close)
  return "eod";
}

function lastTradingDayLabel(now: Date): string {
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: TAIPEI_TZ, weekday: "short" }).format(now);
  const dateStr = taipeiDate(now);

  // If weekend, last trading day is Friday
  if (dow === "Sat" || dow === "Sun") {
    // Find last Friday by subtracting days
    const friday = new Date(now);
    while (new Intl.DateTimeFormat("en-US", { timeZone: TAIPEI_TZ, weekday: "short" }).format(friday) !== "Fri") {
      friday.setDate(friday.getDate() - 1);
    }
    const fridayStr = friday.toLocaleDateString("en-CA", { timeZone: TAIPEI_TZ });
    const [, m, d] = fridayStr.split("-");
    return `${m}/${d} (五) 收盤 (週末休市)`;
  }

  // Weekday: if before 09:00, show yesterday; if after 14:10, show today
  const [, m, d] = dateStr.split("-");
  const dayLabels: Record<string, string> = {
    Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六", Sun: "日",
  };
  const dayLabel = dayLabels[dow] ?? "";
  return `${m}/${d} (${dayLabel}) 收盤`;
}

export function MarketStateBanner({ dataFreshness: propFreshness, lastCloseDate }: Props) {
  const [freshness, setFreshness] = useState<DataFreshness>("live");
  const [closeLabel, setCloseLabel] = useState<string>("--");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const now = new Date();
    const derived = propFreshness ?? deriveFreshness(now);
    setFreshness(derived);

    if (lastCloseDate) {
      setCloseLabel(formatTaipeiDate(lastCloseDate));
    } else {
      setCloseLabel(lastTradingDayLabel(now));
    }
  }, [propFreshness, lastCloseDate]);

  // SSR: render nothing (avoid hydration mismatch; banner is cosmetic)
  if (!mounted || freshness === "live") return null;

  if (freshness === "eod") {
    return (
      <div className="tac-market-state-banner is-eod" role="status" aria-label="市場休市說明">
        <span>台股目前盤後或週末休市，顯示 {closeLabel} 收盤資料</span>
        <small>即時行情將於下一交易日 09:00 恢復</small>
      </div>
    );
  }

  if (freshness === "cache") {
    return (
      <div className="tac-market-state-banner is-cache" role="status" aria-label="資料延遲說明">
        <span>資料同步暫時延遲，顯示緩存 {closeLabel}</span>
        <small>自動重試中，請稍候</small>
      </div>
    );
  }

  return null;
}
