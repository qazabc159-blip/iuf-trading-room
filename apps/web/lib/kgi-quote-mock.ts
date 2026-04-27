/**
 * KGI Quote mock fetch functions — Lane 2 frontend DRAFT stubs.
 *
 * WIRE-UP NOTE: Replace these stubs with real fetch calls to
 * /api/v1/kgi/quote/* once Jason Lane 1 backend routes land.
 * Shape must match kgi-quote-types.ts exactly.
 *
 * Poll cadence per D-W2D-3: ticks=1000ms, bidask=500ms, status=5000ms.
 * These stubs simulate a live feed with synthetic data for UI development.
 */

import type {
  KgiBidAskResponse,
  KgiQuoteStatus,
  KgiTicksResponse
} from "./kgi-quote-types";

const BASE_PRICE = 1052.0;
let _tickCounter = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function kgiDatetime(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * MOCK: GET /api/v1/kgi/quote/ticks?symbol=2330&limit=5
 * Wire-up: replace with real fetch once Jason Lane 1 is merged.
 */
export async function fetchRecentTicks(
  symbol: string,
  limit = 5
): Promise<KgiTicksResponse> {
  _tickCounter++;
  const priceJitter = (Math.random() - 0.5) * 4;
  const price = Math.round((BASE_PRICE + priceJitter) * 10) / 10;
  const receivedAt = nowIso();

  const mockTick = {
    exchange: "TWSE",
    symbol,
    delayTime: 0,
    oddLot: false,
    datetime: kgiDatetime(),
    open: BASE_PRICE,
    high: BASE_PRICE + 5,
    low: BASE_PRICE - 3,
    close: price,
    volume: Math.round(100 + Math.random() * 400),
    totalVolume: 12000 + _tickCounter * 50,
    chgType: priceJitter >= 0 ? 1 : 2,
    priceChg: Math.round(priceJitter * 10) / 10,
    pctChg: Math.round((priceJitter / BASE_PRICE) * 10000) / 100,
    simtrade: 0,
    suspend: 0,
    amount: price * (100 + Math.round(Math.random() * 400)),
    receivedAt
  };

  // suppress unused parameter warning
  void limit;

  return {
    symbol,
    ticks: [mockTick],
    count: 1,
    bufferSize: 200,
    bufferUsed: Math.min(_tickCounter, 200),
    stale: false,
    staleSince: undefined
  };
}

/**
 * MOCK: GET /api/v1/kgi/quote/bidask?symbol=2330
 * Wire-up: replace with real fetch once Jason Lane 1 is merged.
 */
export async function fetchLatestBidAsk(
  symbol: string
): Promise<KgiBidAskResponse> {
  const base = BASE_PRICE + (Math.random() - 0.5) * 2;
  const receivedAt = nowIso();

  const bidask = {
    exchange: "TWSE",
    symbol,
    delayTime: 0,
    oddLot: false,
    datetime: kgiDatetime(),
    bidPrices: [base - 1, base - 2, base - 3, base - 4, base - 5].map(
      (p) => Math.round(p * 10) / 10
    ),
    bidVolumes: [50, 30, 20, 15, 10],
    askPrices: [base + 1, base + 2, base + 3, base + 4, base + 5].map(
      (p) => Math.round(p * 10) / 10
    ),
    askVolumes: [40, 25, 15, 10, 8],
    diffAskVol: [0, 0, 0, 0, 0],
    diffBidVol: [0, 0, 0, 0, 0],
    simtrade: 0,
    suspend: 0,
    receivedAt
  };

  return {
    symbol,
    bidask,
    stale: false,
    staleSince: undefined
  };
}

/**
 * MOCK: GET /api/v1/kgi/quote/status
 * Wire-up: replace with real fetch once Jason Lane 1 is merged.
 */
export async function fetchQuoteStatus(
  symbol: string
): Promise<KgiQuoteStatus> {
  return {
    subscribedSymbols: { tick: [symbol], bidask: [symbol] },
    buffer: {
      tick: {
        [symbol]: {
          count: Math.min(_tickCounter, 200),
          maxlen: 200,
          lastReceivedAt: nowIso()
        }
      },
      bidask: {
        [symbol]: { present: true, lastReceivedAt: nowIso() }
      }
    },
    kgiLoggedIn: true,
    quoteDisabledFlag: false
  };
}
