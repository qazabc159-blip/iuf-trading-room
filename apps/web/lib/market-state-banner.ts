/**
 * market-state-banner.ts — pure data-transform helpers for MarketStateBanner.
 *
 * P0-5 fix (`reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md`):
 * the banner used to derive its displayed date from `lastTradingDayLabel()`,
 * a WALL-CLOCK weekday guess ("if today is Sat/Sun show last Friday, else
 * show today"). That guess has no concept of ad-hoc holiday closures (e.g.
 * typhoon days) — on 2026-07-10 (Fri, typhoon holiday) it showed "07/10 (五)
 * 收盤" even though there was no 07/10 close at all (real last close: 07/09).
 * It also duplicated the word "收盤" (closeLabel already ended in "收盤",
 * then the outer template appended "收盤資料" again).
 *
 * Fix: the displayed date must come from the DATA's own trade date (an API
 * `asOf`/timestamp field), matching the pattern already used correctly by
 * `lib/ticker-tape.ts` (asOf from `marketContext.index.timestamp`) and
 * `lib/data-state-copy.ts` (`formatAsOfDate`, close-mode spec: "用資料自身
 * 日期，禁止「今日收盤」配舊資料"). When no asOf is available, we show no
 * date at all — never fall back to a calendar guess.
 *
 * No React / DOM imports — testable in isolation with Vitest (mirrors the
 * `lib/ticker-tape.ts` convention).
 */

import { isKgiTradingHours } from "./kgi-trading-hours";
import { formatAsOfDate } from "./data-state-copy";

export type DataFreshness = "live" | "eod" | "cache";

const TAIPEI_TZ = "Asia/Taipei";

const WEEKDAY_LABELS: Record<string, string> = {
  Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六", Sun: "日",
};

/** live/eod derivation is unchanged — purely about "is it trading hours right now",
 * not about which date to display (that's the part that was buggy). */
export function deriveFreshness(now: Date): DataFreshness {
  if (isKgiTradingHours(now)) return "live";
  return "eod";
}

/**
 * Formats an ISO date/timestamp as "MM/DD (weekday)" using the date's OWN
 * calendar day. The weekday is derived from the SAME date being labeled,
 * never from "now" — this is what makes the label correct on ad-hoc holiday
 * closures (a typhoon Friday's data is still correctly labeled "(五)").
 *
 * Returns null when the input is missing/unparseable — callers must NOT
 * invent a fallback date (see P0-5 fix note above).
 */
export function formatTradeDateWithWeekday(isoDate: string | null | undefined): string | null {
  const mmdd = formatAsOfDate(isoDate);
  if (!mmdd || !isoDate) return null;
  const datePart = isoDate.length >= 10 ? isoDate.slice(0, 10) : isoDate;
  const parsed = new Date(`${datePart}T12:00:00+08:00`); // noon Taipei avoids UTC day-shift
  if (Number.isNaN(parsed.getTime())) return mmdd;
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: TAIPEI_TZ, weekday: "short" }).format(parsed);
  const label = WEEKDAY_LABELS[dow];
  return label ? `${mmdd} (${label})` : mmdd;
}

/**
 * Builds the banner's display sentence for a given freshness state and
 * (already resolved, may be null) trade-date label. Single source of truth
 * for the wording so `MarketStateBanner.tsx` and its tests can't drift apart
 * again (the original bug shipped because the test file kept its own stale
 * inline copy of this logic instead of importing the real thing).
 */
export function buildBannerText(freshness: DataFreshness, closeLabel: string | null): string | null {
  const suffix = closeLabel ? `${closeLabel} 收盤資料` : "收盤資料";
  if (freshness === "eod") {
    return `台股目前盤後或週末休市，顯示 ${suffix}`;
  }
  if (freshness === "cache") {
    return `資料同步暫時延遲，顯示緩存 ${suffix}`;
  }
  return null;
}
