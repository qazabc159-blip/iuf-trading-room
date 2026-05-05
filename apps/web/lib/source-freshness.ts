const TAIPEI_TIME_ZONE = "Asia/Taipei";

export type SourceFreshnessTone = "status-ok" | "gold" | "status-bad";

export function latestIso(values: Array<string | null | undefined>) {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isFinite(time) && time > latestTime) {
      latest = value;
      latestTime = time;
    }
  }
  return latest;
}

export function formatSourceTimestamp(value: string | null | undefined) {
  if (!value) return "--";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replace(/-/g, "/");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function taipeiDateKey(value?: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: TAIPEI_TIME_ZONE });
}

function todayTaipeiKey() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TAIPEI_TIME_ZONE });
}

function daysBetweenDateKeys(left: string, right: string) {
  const [ly, lm, ld] = left.split("-").map(Number);
  const [ry, rm, rd] = right.split("-").map(Number);
  if (!ly || !lm || !ld || !ry || !rm || !rd) return null;
  return Math.floor((Date.UTC(ry, rm - 1, rd) - Date.UTC(ly, lm - 1, ld)) / 86_400_000);
}

export function sourceFreshnessLabel(value: string | null | undefined):
  | { label: string; tone: SourceFreshnessTone }
  | null {
  const updatedKey = taipeiDateKey(value);
  if (!updatedKey) return { label: "時間未知", tone: "gold" };
  const age = daysBetweenDateKeys(updatedKey, todayTaipeiKey());
  if (age === null) return { label: "時間未知", tone: "gold" };
  if (age <= 0) return { label: "今日資料", tone: "status-ok" };
  if (age === 1) return { label: "昨日資料", tone: "status-ok" };
  if (age <= 7) return { label: `偏舊 ${age} 天`, tone: "gold" };
  return { label: `過期 ${age} 天`, tone: "status-bad" };
}
