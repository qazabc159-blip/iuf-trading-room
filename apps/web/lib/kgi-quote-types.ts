/**
 * KGI Gateway quote types — frontend shapes.
 *
 * These mirror the draft types in w2d_quote_consumption_plan.md §3.
 * Camel-cased from snake_case gateway responses.
 *
 * IMPORTANT: This is Lane 2 frontend DRAFT.
 * Wire-up to real /api/v1/kgi/quote/* routes is Jason Lane 1.
 * Until that PR merges, fetchQuoteStatus / fetchRecentTicks / fetchLatestBidAsk
 * are mock stubs in kgi-quote-mock.ts.
 */

/** A single tick event from the KGI gateway ring buffer. */
export interface KgiGatewayTick {
  exchange: string;
  symbol: string;
  delayTime: number;
  oddLot: boolean;
  /** KGI datetime string — NOT ISO 8601 (e.g. "2026-04-27 13:15:00") */
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  totalVolume: number;
  /** 0=flat, 1=up, 2=down (KGI enum) */
  chgType: number;
  priceChg: number;
  pctChg: number;
  /** 0=real, 1=simulated */
  simtrade: number;
  /** 0=normal, 1=suspended */
  suspend: number;
  amount: number;
  /** ISO 8601 UTC — added by gateway (_received_at) */
  receivedAt: string;
}

/** Latest bid/ask 5-level snapshot from the KGI gateway ring buffer. */
export interface KgiGatewayBidAsk {
  exchange: string;
  symbol: string;
  delayTime: number;
  oddLot: boolean;
  datetime: string;
  bidPrices: number[];
  bidVolumes: number[];
  askPrices: number[];
  askVolumes: number[];
  diffAskVol: number[];
  diffBidVol: number[];
  simtrade: number;
  suspend: number;
  receivedAt: string;
}

/** Response from GET /api/v1/kgi/quote/ticks */
export interface KgiTicksResponse {
  symbol: string;
  ticks: KgiGatewayTick[];
  count: number;
  bufferSize: number;
  bufferUsed: number;
  /** Added by apps/api layer per D-W2D-1 */
  stale?: boolean;
  /** ISO 8601 UTC of last received tick */
  staleSince?: string;
}

/** Response from GET /api/v1/kgi/quote/bidask */
export interface KgiBidAskResponse {
  symbol: string;
  bidask: KgiGatewayBidAsk | null;
  stale?: boolean;
  staleSince?: string;
}

/** Response from GET /api/v1/kgi/quote/status */
export interface KgiQuoteStatus {
  subscribedSymbols: { tick: string[]; bidask: string[] };
  buffer: {
    tick: Record<string, { count: number; maxlen: number; lastReceivedAt: string | null }>;
    bidask: Record<string, { present: boolean; lastReceivedAt: string | null }>;
  };
  kgiLoggedIn: boolean;
  quoteDisabledFlag: boolean;
}

/**
 * Derived freshness state — computed from receivedAt vs now() using D-W2D-1 threshold (5000ms).
 * - "fresh"        : data received within 5000ms
 * - "stale"        : data older than 5000ms (was received at some point)
 * - "not-available": no data received at all (never subscribed or empty buffer)
 */
export type QuoteFreshnessState = "fresh" | "stale" | "not-available";

/**
 * Derived broker connection state — maps to §3.3 four states.
 * - "connected-quote-available"            : Connected & Quote Available
 * - "connected-quote-available-pos-disabled": Connected & Quote Available, Position Disabled (containment)
 * - "connected-order-locked"               : Connected, Order Locked (NOT_ENABLED_IN_W1)
 * - "disconnected"                         : Disconnected
 */
export type BrokerConnectionState =
  | "connected-quote-available"
  | "connected-quote-available-pos-disabled"
  | "connected-order-locked"
  | "disconnected";

/** Stale threshold per D-W2D-1: 5000ms */
export const QUOTE_STALE_THRESHOLD_MS = 5_000;

/**
 * Compute freshness from a receivedAt ISO 8601 string.
 * Returns "not-available" if receivedAt is null/undefined.
 */
export function computeFreshness(receivedAt: string | null | undefined): QuoteFreshnessState {
  if (!receivedAt) return "not-available";
  const ageMs = Date.now() - new Date(receivedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "not-available";
  return ageMs <= QUOTE_STALE_THRESHOLD_MS ? "fresh" : "stale";
}

/** Format age in human-readable relative time */
export function formatQuoteAge(receivedAt: string | null | undefined): string {
  if (!receivedAt) return "—";
  const ageMs = Date.now() - new Date(receivedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "—";
  if (ageMs < 1_000) return "剛剛";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1_000)}s 前`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m 前`;
  return `${Math.round(ageMs / 3_600_000)}h 前`;
}
