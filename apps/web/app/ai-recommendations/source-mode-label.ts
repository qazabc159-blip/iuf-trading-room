export function formatRecommendationSourceMode({
  hasData,
  isMock,
}: {
  hasData: boolean;
  isMock?: boolean;
}) {
  if (!hasData) return "同步中";
  return isMock ? "備援資料源" : "推薦引擎";
}
