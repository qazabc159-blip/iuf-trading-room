function extractKgiErrorCode(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; code?: unknown; message?: unknown };
    const value = parsed.error ?? parsed.code ?? parsed.message;
    return typeof value === "string" ? value.toUpperCase() : raw.toUpperCase();
  } catch {
    return raw.toUpperCase();
  }
}

export function formatMobileKgiBlockedReason(status: number, raw: string): string {
  const code = extractKgiErrorCode(raw);
  if (status === 401 || status === 403 || code.includes("GATEWAY_AUTH")) return "需重新登入";
  if (status === 422 || code.includes("SYMBOL_NOT_ALLOWED")) return "未開放";
  if (status >= 500 || code.includes("GATEWAY_UNREACHABLE") || code.includes("TIMEOUT")) return "讀取暫停";
  if (status === 404) return "尚未提供";
  return "暫無報價";
}
