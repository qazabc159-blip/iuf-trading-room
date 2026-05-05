export type BriefFreshness = "LIVE" | "STALE" | "EMPTY" | "BLOCKED";

export function taipeiTodayString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function briefAgeDays(date: string | null | undefined) {
  if (!date) return null;
  const today = Date.parse(`${taipeiTodayString()}T00:00:00+08:00`);
  const target = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(today) || !Number.isFinite(target)) return null;
  return Math.round((today - target) / 86_400_000);
}

export function briefFreshnessForDate(date: string | null | undefined): BriefFreshness {
  if (!date) return "EMPTY";
  return briefAgeDays(date) === 0 ? "LIVE" : "STALE";
}

export function briefFreshnessLabel(state: BriefFreshness) {
  if (state === "LIVE") return "今日資料";
  if (state === "STALE") return "資料過期";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

export function briefFreshnessTone(state: BriefFreshness) {
  if (state === "LIVE") return "status-ok";
  if (state === "BLOCKED") return "status-bad";
  return "gold";
}

export function briefFreshnessBadge(state: BriefFreshness) {
  if (state === "LIVE") return "badge-green";
  if (state === "BLOCKED") return "badge-red";
  return "badge-yellow";
}

export function briefAgeCopy(days: number | null) {
  if (days === null) return "無法判斷資料日";
  if (days === 0) return "台北今日";
  if (days > 0) return `落後 ${days} 天`;
  return `日期超前 ${Math.abs(days)} 天`;
}
