/**
 * kgi-gateway-schedule.ts — EventBridge uptime guard for KGI gateway calls.
 *
 * The EC2 gateway runs weekdays 08:20–14:10 TST ONLY (EventBridge schedule,
 * confirmed 6/10: stopped ≠ incident). Outside that window every gateway HTTP
 * attempt is guaranteed dead air — yet call sites were still paying their full
 * connect timeouts. Bruce's 6/11 latency profile: /portfolio stacked
 * f-auto 11s ×4 + kgi/positions 6.8s ×4 + quote/realtime 6.5s ×2 in one page
 * load and never reached networkidle (60s timeout). 楊董:「每個頁面都要轉很久」.
 *
 * This guard short-circuits gateway fetches instantly when the gateway is
 * scheduled off, throwing the SAME unreachable error type each client already
 * maps — every existing fallback chain (audit rebuild / MIS / EOD) fires
 * immediately instead of after a timeout.
 *
 * Escape hatches (for ad-hoc off-hours EC2 starts):
 *   1. env KGI_GATEWAY_ALWAYS_ON=true disables the guard entirely.
 *   2. Any successful gateway response within the last 5 minutes keeps the
 *      guard open (a manual /health probe through the API re-enables traffic).
 */

// 5 min margin before the 08:20 boot; 10 min margin after the 14:10 stop —
// generous so cron windows that straddle the edges (EOD 14:00-14:30) keep
// their real attempt where the gateway could plausibly still be up.
const UPTIME_START_HHMM = 815;
const UPTIME_END_HHMM = 1420;
const RECENT_SUCCESS_GRACE_MS = 5 * 60 * 1000;

let _lastGatewaySuccessAtMs = 0;

/** Call when any gateway HTTP response arrives (gateway is demonstrably alive). */
export function noteKgiGatewayAlive(nowMs = Date.now()): void {
  _lastGatewaySuccessAtMs = nowMs;
}

/** For tests. */
export function _resetKgiGatewayScheduleState(): void {
  _lastGatewaySuccessAtMs = 0;
}

/** True when gateway calls should be short-circuited (scheduled off, no recent life sign). */
export function isKgiGatewayScheduledOff(nowMs = Date.now()): boolean {
  if (process.env["KGI_GATEWAY_ALWAYS_ON"] === "true") return false;
  if (nowMs - _lastGatewaySuccessAtMs < RECENT_SUCCESS_GRACE_MS) return false;
  const taipei = new Date(nowMs + 8 * 60 * 60 * 1000);
  const day = taipei.getUTCDay();
  if (day === 0 || day === 6) return true;
  const hhmm = taipei.getUTCHours() * 100 + taipei.getUTCMinutes();
  return hhmm < UPTIME_START_HHMM || hhmm >= UPTIME_END_HHMM;
}

export const KGI_SCHEDULED_OFF_MESSAGE =
  "gateway scheduled off (EventBridge weekday 08:20-14:10 TST uptime) — connect skipped, fallback chain engaged immediately";
