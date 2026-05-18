export function formatRecommendationSourceMode({
  hasData,
  isMock,
}: {
  hasData: boolean;
  isMock?: boolean;
}) {
  if (!hasData) return "尚無資料";
  return isMock ? "示範資料" : "正式推薦";
}
