const SOURCE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatSourceTimestamp(value: string) {
  const raw = value.trim();
  if (!raw) return "-";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return SOURCE_TIME_FORMATTER.format(date);
}

export function formatRecommendationTimestamp(value: string | null | undefined) {
  return formatSourceTimestamp(value ?? "");
}
