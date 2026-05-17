import type { StockRecommendation } from "@iuf-trading-room/contracts";

export const INVALID_AI_HANDOFF_TICKER_MESSAGE = "標的代碼異常，未帶入交易室 SIM 預覽。";

export function safeRecommendationTicker(value: string | null | undefined) {
  const ticker = value?.trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9._-]{1,16}$/.test(ticker)) return null;
  return ticker;
}

export function handoffSideForDirection(direction: StockRecommendation["direction"]) {
  if (direction === "偏空") return "sell";
  if (direction === "偏多") return "buy";
  return null;
}

export function handoffLabelForDirection(direction: StockRecommendation["direction"]) {
  if (direction === "偏空") return "賣出";
  if (direction === "偏多") return "買進";
  return "中性";
}

export function buildRecommendationPrefillHref(rec: StockRecommendation) {
  const ticker = safeRecommendationTicker(rec.ticker);
  if (!ticker) return null;

  const params = new URLSearchParams({
    ticker,
    prefill: "true",
    from_rec: rec.recommendationId,
  });
  const side = handoffSideForDirection(rec.direction);

  if (side) {
    params.set("side", side);
  }

  if (rec.entryZone.primary) {
    params.set("entry", rec.entryZone.primary);
  }

  if (rec.invalidation.price !== null) {
    params.set("stop", String(rec.invalidation.price));
  }

  const firstTarget = rec.targets.find((target) => target.price !== null);
  if (firstTarget?.price !== undefined && firstTarget.price !== null) {
    params.set("tp", String(firstTarget.price));
  }

  return `/portfolio?${params.toString()}`;
}
