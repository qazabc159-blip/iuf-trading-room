export function friendlyDataError(error: unknown, fallback = "資料暫時無法讀取。") {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (/failed to fetch|fetch failed|ECONNREFUSED|network/i.test(message)) {
    return "前端暫時無法連到後端。";
  }
  if (/401|unauthorized|unauthenticated/i.test(message)) {
    return "登入狀態已失效，請重新登入。";
  }
  if (/403|forbidden/i.test(message)) {
    return "目前帳號沒有讀取這項資料的權限。";
  }
  if (/404|not found/i.test(message)) {
    return "後端端點尚未提供。";
  }
  if (/timeout|timed out|aborted/i.test(message)) {
    return "後端回應逾時，請稍後再試。";
  }

  return fallback;
}
