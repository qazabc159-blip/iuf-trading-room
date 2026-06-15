export type FreshnessMode = "live" | "intraday" | "stale" | "eod" | "close";

export type RealtimeFreshnessInput = {
  symbol?: string;
  lastPrice?: number | null;
  bid?: number | null;
  ask?: number | null;
  volume?: number | null;
  state?: string;
  source?: string;
  freshness?: string;
  updatedAt?: string;
  marketSession?: string;
  referenceReason?: string;
};

function isTradingSessionEodFallback(quote: RealtimeFreshnessInput): boolean {
  if (
    quote.source === "twse_openapi_eod" &&
    quote.state === "STALE" &&
    quote.freshness === "stale" &&
    quote.marketSession === undefined &&
    quote.referenceReason === undefined
  ) {
    return true;
  }

  return (
    quote.source === "twse_openapi_eod" &&
    quote.state === "STALE" &&
    (
      quote.marketSession === "OPEN" ||
      quote.marketSession === "MIDDAY" ||
      quote.referenceReason === "kgi_unavailable_eod_fallback"
    )
  );
}

export function realtimeFreshnessMode(
  quote: RealtimeFreshnessInput,
  nowMs = Date.now(),
): FreshnessMode {
  if (isTradingSessionEodFallback(quote)) return "stale";
  if (quote.source === "twse_openapi_eod") return "eod";
  if (quote.state === "BLOCKED" || quote.state === "NO_DATA") return "eod";
  // Post-close (6/15): MIS keeps today's final snapshot off-hours (state=CLOSE,
  // source twse_intraday). It is today's real close — not yesterday's EOD, not
  // a stale live tick — so it gets its own badge rather than "盤中".
  if (quote.state === "CLOSE") return "close";
  if (quote.source === "twse_intraday") return "intraday";

  if (quote.source === "kgi-gateway") {
    const ageMs = quote.updatedAt ? nowMs - Date.parse(quote.updatedAt) : Number.POSITIVE_INFINITY;
    return quote.freshness === "fresh" && ageMs <= 2000 ? "live" : "stale";
  }

  if (quote.state === "LIVE") return "live";
  if (quote.state === "STALE") return "stale";
  if (quote.lastPrice !== null && quote.lastPrice !== undefined) return "stale";
  return "eod";
}
