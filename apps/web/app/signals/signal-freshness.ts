// 訊號誠實度（decision-flow C-2）: 每張訊號卡標「N 分鐘前」，超過合理時效的訊號灰顯不誘導。
// 合理時效 = 同一台北交易日內且不超過 4 小時（涵蓋一般盤中時段）；跨日一律視為過期。

const TAIPEI_TIME_ZONE = "Asia/Taipei";
export const SIGNAL_STALE_MINUTES = 240;

function taipeiDateKey(ms: number) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: TAIPEI_TIME_ZONE });
}

export function minutesAgo(iso: string | null | undefined, nowMs = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 60_000));
}

export function relativeTimeLabel(iso: string | null | undefined, nowMs = Date.now()): string {
  const mins = minutesAgo(iso, nowMs);
  if (mins === null) return "時間未知";
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function isSignalStale(iso: string | null | undefined, nowMs = Date.now()): boolean {
  const mins = minutesAgo(iso, nowMs);
  if (mins === null) return true;
  if (mins >= SIGNAL_STALE_MINUTES) return true;
  const t = Date.parse(iso as string);
  if (!Number.isFinite(t)) return true;
  return taipeiDateKey(t) !== taipeiDateKey(nowMs);
}
