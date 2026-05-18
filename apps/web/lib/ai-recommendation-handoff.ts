import {
  recommendationDirectionSchema,
  type StockRecommendation,
} from "@iuf-trading-room/contracts";

export const INVALID_AI_HANDOFF_TICKER_MESSAGE = "股票代號格式不完整，暫時不能帶入模擬委託。";

const HANDOFF_PARAM_MAX_LENGTH = {
  recommendationId: 96,
  price: 40,
} as const;

const DIRECTION_VALUES = recommendationDirectionSchema.options as readonly StockRecommendation["direction"][];
const BUY_DIRECTION = DIRECTION_VALUES[0];
const SELL_DIRECTION = DIRECTION_VALUES[1];

function safeHandoffText(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[<>]/g, "").slice(0, maxLength);
}

export function safeRecommendationTicker(value: string | null | undefined) {
  const ticker = value?.trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9._-]{1,16}$/.test(ticker)) return null;
  return ticker;
}

export function handoffSideForDirection(direction: StockRecommendation["direction"]) {
  if (direction === SELL_DIRECTION) return "sell";
  if (direction === BUY_DIRECTION) return "buy";
  return null;
}

export function handoffLabelForDirection(direction: StockRecommendation["direction"]) {
  if (direction === SELL_DIRECTION) return "賣出";
  if (direction === BUY_DIRECTION) return "買進";
  return "中性";
}

export function buildRecommendationPrefillHref(rec: StockRecommendation) {
  const ticker = safeRecommendationTicker(rec.ticker);
  if (!ticker) return null;

  const params = new URLSearchParams({
    ticker,
    prefill: "true",
  });
  const recommendationId = safeHandoffText(rec.recommendationId, HANDOFF_PARAM_MAX_LENGTH.recommendationId);
  const side = handoffSideForDirection(rec.direction);
  const entry = safeHandoffText(rec.entryZone.primary, HANDOFF_PARAM_MAX_LENGTH.price);

  if (recommendationId) params.set("from_rec", recommendationId);
  if (side) params.set("side", side);
  if (entry) params.set("entry", entry);

  if (rec.invalidation.price !== null) {
    const stop = safeHandoffText(String(rec.invalidation.price), HANDOFF_PARAM_MAX_LENGTH.price);
    if (stop) params.set("stop", stop);
  }

  const firstTarget = rec.targets.find((target) => target.price !== null);
  if (firstTarget?.price !== undefined && firstTarget.price !== null) {
    const target = safeHandoffText(String(firstTarget.price), HANDOFF_PARAM_MAX_LENGTH.price);
    if (target) params.set("tp", target);
  }

  return `/portfolio?${params.toString()}`;
}
