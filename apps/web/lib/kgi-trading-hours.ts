/**
 * KGI trading hours helper — pure, no React imports, fully testable with Vitest.
 *
 * KGI gateway auto-runs 08:20-14:10 TST weekday only.
 * UI display window (what users understand as "market hours"): 09:00-14:10 TST.
 *
 * This helper detects whether the KGI realtime feed should have live data.
 * Off-hours → graceful fallback to TWSE EOD in RealtimeHeatmapPanel.
 */

const TAIPEI_TIME_ZONE = "Asia/Taipei";

/** Returns the day-of-week in Asia/Taipei. 0 = Sunday, 6 = Saturday. */
function taipeiDow(now: Date): number {
  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone: TAIPEI_TIME_ZONE,
    weekday: "short",
  }).format(now);
  // "Sun" -> 0, "Mon" -> 1, ..., "Sat" -> 6
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[dow] ?? -1;
}

/** Returns { hour, minute } in Asia/Taipei for the given Date. */
function taipeiHourMinute(now: Date): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TAIPEI_TIME_ZONE,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return { hour: Number.isFinite(hour) ? hour : 0, minute: Number.isFinite(minute) ? minute : 0 };
  } catch {
    // Fallback: manual UTC+8
    const utc8ms = now.getTime() + now.getTimezoneOffset() * 60_000 + 8 * 3_600_000;
    const d = new Date(utc8ms);
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }
}

/**
 * Returns true if KGI realtime heatmap data should be available.
 * Window: 09:00–14:10 TST, Monday–Friday only.
 *
 * @param now - Injectable for testing; defaults to current time.
 */
export function isKgiTradingHours(now: Date = new Date()): boolean {
  const dow = taipeiDow(now);
  // Weekend: Saturday (6) or Sunday (0)
  if (dow === 0 || dow === 6) return false;

  const { hour, minute } = taipeiHourMinute(now);
  const totalMinutes = hour * 60 + minute;
  const openMinutes = 9 * 60;       // 09:00
  const closeMinutes = 14 * 60 + 10; // 14:10

  return totalMinutes >= openMinutes && totalMinutes <= closeMinutes;
}

/**
 * Returns true when a KGI core heatmap tile array looks empty/null.
 * This happens off-hours: API returns tiles but price/pct are all null.
 */
export function kgiCoreTilesAreNull(tiles: Array<{ pct: number | null; price: number | null }>): boolean {
  if (tiles.length === 0) return true;
  return tiles.every((tile) => tile.pct === null && tile.price === null);
}

/**
 * True when `now`'s Taipei calendar day is Saturday or Sunday.
 *
 * 2026-07-19 側欄健康 widget 修復：`deriveTickerDisplay()` 曾把 backend 的
 * STALE 狀態無條件譯成「delayed（資料延遲）」，週六/週日（非交易日）也一樣
 * 判「延遲」——但非交易日本來就不會有新資料，架上的末交易日資料是預期中的正
 * 常狀態，不是延遲。這支函式只回答「今天是不是週末」，讓呼叫端決定週末時改用
 * 「收盤」而非「延遲」措辭。
 *
 * 跟 `isKgiTradingHours()`/`isKgiGatewayScheduledOff()` 同樣的已知限制：只看
 * 星期幾，不知道颱風假等臨時休市日（這裡沒有客戶端可查的完整交易日曆來源，
 * `mostRecentTradingDay` 這類權威判斷只存在於 backend，見
 * `apps/api/src/data-sources/twse-openapi-client.ts`，前端不可重寫）。
 */
export function isTaipeiWeekend(now: Date = new Date()): boolean {
  const dow = taipeiDow(now);
  return dow === 0 || dow === 6;
}

/**
 * True when the KGI SIM gateway (EC2, EventBridge-scheduled) is outside its
 * weekday 08:20-14:10 TST run window. Outside this window, gateway-backed
 * endpoints (e.g. /kgi/quote/ticks) return 422/503 by design — this is the
 * expected "排程關機中" state, not an incident.
 */
export function isKgiGatewayScheduledOff(now: Date = new Date()): boolean {
  const dow = taipeiDow(now);
  if (dow === 0 || dow === 6) return true;
  const { hour, minute } = taipeiHourMinute(now);
  const totalMinutes = hour * 60 + minute;
  return totalMinutes < 8 * 60 + 20 || totalMinutes > 14 * 60 + 10;
}

/**
 * Human-readable label for the KGI off-hours banner.
 * Returns the next open time string (weekday logic).
 */
export function kgiNextOpenLabel(now: Date = new Date()): string {
  const dow = taipeiDow(now);
  // If it's Friday 14:10+ or weekend, next open is Monday
  if (dow === 5) {
    const { hour, minute } = taipeiHourMinute(now);
    if (hour * 60 + minute > 14 * 60 + 10) {
      // Next Monday
      const dayLabels = ["一", "二", "三", "四", "五", "六", "日"];
      return `下週一 (一) 09:00`;
    }
  }
  if (dow === 6) return `週一 (一) 09:00`;
  if (dow === 0) return `明日 (一) 09:00`;
  // Regular weekday before open or after close
  const { hour, minute } = taipeiHourMinute(now);
  if (hour * 60 + minute < 9 * 60) return `今日 09:00`;
  return `次日 09:00`;
}
