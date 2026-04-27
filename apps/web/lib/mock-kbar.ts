/**
 * IUF · v0.7.0 — Mock K-bar data source + Phase 2 real-data gate.
 * Ported from sandbox: evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/mock-kbar.ts
 *
 * Phase 1 (NOW):  client-side random-walk mock, 100–300 bars (default)
 * Phase 2 (NEXT): set NEXT_PUBLIC_USE_REAL_KBAR_API=true to attempt
 *                 real fetch via kbar-adapter.ts → fetchKBars()
 *                 On any failure, fallback to mock silently (UX intact).
 *
 * Hard lines:
 *   - No import from contracts / broker paths
 *   - No order entry logic
 *   - No paper/live/production-ready labeling
 */

import { fetchKBars } from "./kbar-adapter";

/**
 * Toggle: when true, getKBarsAsync attempts real API before falling back.
 * Default false — safe until Jason lands /api/v1/kgi/quote/kbar.
 */
export const USE_REAL_KBAR_API =
  process.env.NEXT_PUBLIC_USE_REAL_KBAR_API === "true";

export interface OHLCV {
  time: number;      // unix timestamp seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Base prices for common TWSE symbols; fallback 100 for unknowns. */
const BASE_PRICE: Record<string, number> = {
  "2330": 920,
  "2454": 680,
  "2317": 130,
  "2412": 115,
  "2882": 52,
  "0050": 195,
};

/**
 * Interval → seconds between bars.
 * Only 1m / 5m / 1h / D are wired in v0.7.0; others use fallback.
 */
const INTERVAL_SEC: Record<string, number> = {
  "1m":  60,
  "5m":  300,
  "15m": 900,
  "30m": 1800,
  "1h":  3600,
  "4h":  14400,
  "D":   86400,
  "W":   604800,
  "M":   2592000,
};

/** Volatility scalar per interval — tighter intraday, wider daily/weekly. */
const VOL_SCALE: Record<string, number> = {
  "1m":  0.0008,
  "5m":  0.0015,
  "15m": 0.0022,
  "30m": 0.0030,
  "1h":  0.004,
  "4h":  0.006,
  "D":   0.012,
  "W":   0.025,
  "M":   0.04,
};

/** Seeded pseudo-random (deterministic per symbol — same chart every load). */
function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/** Compute a seed from symbol string. */
function symbolSeed(symbol: string): number {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) {
    h = (Math.imul(31, h) + symbol.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(h);
}

/**
 * Generate mock OHLCV bars.
 *
 * @param symbol   TWSE code, e.g. "2330"
 * @param interval Interval string: "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "D" | "W" | "M"
 * @param limit    Number of bars (default 100)
 * @returns        Array of OHLCV sorted ascending by time
 */
export function getKBars(
  symbol: string,
  interval: string = "D",
  limit: number = 100,
): OHLCV[] {
  const base    = BASE_PRICE[symbol] ?? 100;
  const stepSec = INTERVAL_SEC[interval] ?? INTERVAL_SEC["D"];
  const vol     = VOL_SCALE[interval]    ?? VOL_SCALE["D"];
  const rand    = seededRand(symbolSeed(symbol + interval));

  // Anchor end time to now (floored to interval boundary)
  const nowSec  = Math.floor(Date.now() / 1000);
  const endSec  = Math.floor(nowSec / stepSec) * stepSec;
  const startSec = endSec - stepSec * (limit - 1);

  const bars: OHLCV[] = [];
  let price = base;

  for (let i = 0; i < limit; i++) {
    const t = startSec + i * stepSec;

    // Random-walk open
    const drift   = (rand() - 0.495) * vol;   // slight upward bias
    const open    = price * (1 + drift);

    // Intrabar high/low/close
    const range   = open * vol * (0.5 + rand() * 1.5);
    const high    = open + range * rand();
    const low     = open - range * rand();
    const close   = low + (high - low) * rand();

    const volume  = Math.round((500000 + rand() * 2000000) * (base / 100));

    bars.push({
      time:   t,
      open:   parseFloat(open.toFixed(2)),
      high:   parseFloat(Math.max(open, close, high).toFixed(2)),
      low:    parseFloat(Math.min(open, close, low).toFixed(2)),
      close:  parseFloat(close.toFixed(2)),
      volume,
    });

    price = close;
  }

  return bars;
}

/**
 * getKBarsAsync — async wrapper for Phase 2 real-data gate.
 *
 * When USE_REAL_KBAR_API=true: tries fetchKBars() first.
 * On network/API error or empty result: silently falls back to sync mock.
 * When USE_REAL_KBAR_API=false (default): goes straight to mock.
 */
export async function getKBarsAsync(
  symbol: string,
  interval: string = "D",
  limit: number = 100,
): Promise<OHLCV[]> {
  if (USE_REAL_KBAR_API) {
    try {
      const real = await fetchKBars(symbol, interval, limit);
      if (real.length > 0) {
        return real as unknown as OHLCV[];
      }
      console.warn("[mock-kbar] real API returned 0 bars — using mock");
    } catch (e) {
      console.warn("[mock-kbar] real API error — using mock:", e);
    }
  }
  return getKBars(symbol, interval, limit);
}
