/**
 * weekend-state.ts
 * Pure helpers for weekend / off-hours empty state wording.
 * No React imports — safely importable in Vitest unit tests.
 */

const TAIPEI_TZ = "Asia/Taipei";

/** Returns "YYYY-MM-DD" in Taipei time for a given Date (defaults to now). */
export function taipeiDateString(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TAIPEI_TZ });
}

/**
 * Returns 0=Sun, 1=Mon, …, 6=Sat as the day-of-week in Taipei time.
 */
export function taipeiDayOfWeek(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TAIPEI_TZ,
    weekday: "short",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? -1;
}

export interface WeekendState {
  /** true when Taipei calendar day is Saturday or Sunday */
  isWeekend: boolean;
  /**
   * ISO date string (YYYY-MM-DD) of the most recent weekday (Mon–Fri) in Taipei
   * time. Always set regardless of isWeekend.
   */
  lastTradingDay: string;
  /**
   * Human-readable label for the last trading day, e.g. "5/15 (五)".
   * Month and day are 0-padded only when needed.
   */
  lastTradingDayLabel: string;
}

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"] as const;

function prevWeekday(now: Date): Date {
  const dow = taipeiDayOfWeek(now);
  // How many days to subtract to reach the most recent Mon-Fri
  let offset = 0;
  if (dow === 0) offset = 2; // Sun → Fri
  else if (dow === 6) offset = 1; // Sat → Fri
  const d = new Date(now);
  d.setDate(d.getDate() - offset);
  return d;
}

/**
 * Returns weekend detection state for the given `now` (defaults to Date.now()).
 */
export function getWeekendState(now: Date = new Date()): WeekendState {
  const dow = taipeiDayOfWeek(now);
  const isWeekend = dow === 0 || dow === 6;
  const tradingDate = isWeekend ? prevWeekday(now) : now;
  const lastTradingDay = taipeiDateString(tradingDate);
  // Build label like "5/15 (五)"
  const [, mm, dd] = lastTradingDay.split("-"); // ["YYYY", "MM", "DD"]
  const tradingDow = taipeiDayOfWeek(tradingDate);
  const zhDay = WEEKDAY_ZH[tradingDow] ?? "?";
  const month = String(Number(mm));
  const day = String(Number(dd));
  const lastTradingDayLabel = `${month}/${day} (${zhDay})`;
  return { isWeekend, lastTradingDay, lastTradingDayLabel };
}

/**
 * Returns the `emptyReason` string for the heatmap empty state.
 * - marketState "BLOCKED" → use `reason` prop
 * - weekend + layout empty → weekend message
 * - weekday + layout empty → sync message
 */
export function heatmapEmptyReason(
  marketState: string,
  reason: string | undefined,
  layoutLength: number,
  now: Date = new Date()
): string {
  if (marketState === "BLOCKED") {
    return reason ?? "市場資料目前無法更新。";
  }
  if (layoutLength === 0) {
    const { isWeekend, lastTradingDayLabel } = getWeekendState(now);
    if (isWeekend) {
      return `盤後資料・台股週末休市・最新 ${lastTradingDayLabel} 收盤`;
    }
    return "資料同步中・約 30 秒後再試";
  }
  return "此產業目前沒有足夠正式行情，先不顯示熱力圖。";
}

/**
 * Returns a sourceLabel suitable for display in the heatmap footer / empty state.
 * On weekends, avoids "約 N 分鐘前" staleness to prevent misleading freshness cues.
 */
export function heatmapSourceLabel(
  baseLabel: string,
  layoutLength: number,
  now: Date = new Date()
): string {
  const { isWeekend, lastTradingDayLabel } = getWeekendState(now);
  if (isWeekend && layoutLength === 0) {
    return `TWSE 盤後資料・${lastTradingDayLabel} 收盤`;
  }
  return baseLabel;
}

/**
 * Returns true when all items in the announcements list are older than
 * `staleDays` days relative to `now` in Taipei time.
 */
export function announcementsAreStale(
  dates: string[],
  staleDays = 2,
  now: Date = new Date()
): boolean {
  if (dates.length === 0) return true;
  const nowMs = now.getTime();
  const staleCutoffMs = staleDays * 24 * 60 * 60 * 1000;
  return dates.every((d) => {
    const t = Date.parse(d);
    return Number.isFinite(t) && nowMs - t >= staleCutoffMs;
  });
}

/**
 * Returns the footer note for MarketIntelPanel when there are no fresh
 * announcements during a weekend / holiday period.
 */
export function intelStaleFooterNote(
  itemCount: number,
  now: Date = new Date()
): string {
  const { isWeekend, lastTradingDayLabel } = getWeekendState(now);
  if (itemCount === 0 && isWeekend) {
    return `公告資料截至 ${lastTradingDayLabel} 收盤`;
  }
  return "來源路徑可讀";
}
