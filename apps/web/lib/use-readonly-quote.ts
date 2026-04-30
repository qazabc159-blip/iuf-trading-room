"use client";
/**
 * use-readonly-quote.ts — Read-only quote data hook (W2d API skeleton).
 * Ported from sandbox: evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/use-readonly-quote.ts
 *
 * Wraps:
 *   GET /api/v1/kgi/quote/bidask?symbol=   (W2d live, 95466f4)
 *   GET /api/v1/kgi/quote/ticks?symbol=    (W2d live, 95466f4)
 *
 * Hard lines:
 *   - NO order entry, NO /order/create
 *   - NO hardcoded production URL
 *   - NO polling faster than 1 Hz
 *   - Cleanup on unmount (clearInterval)
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const IS_PROD = process.env.NODE_ENV === "production";

/** Polling interval in ms. Clamped to [1000, 30000]. Default 3000. */
const rawPollMs = parseInt(process.env.NEXT_PUBLIC_QUOTE_POLL_MS ?? "3000", 10);
const POLL_MS = Math.max(1000, Math.min(30_000, isNaN(rawPollMs) ? 3000 : rawPollMs));

/** Stale threshold in ms. Data older than this is "stale". Default 10_000. */
const STALE_THRESHOLD_MS = 10_000;

// ── Types ───────────────────────────────────────────────────────

export interface BidAskLevel {
  price: number;
  qty: number;
}

export interface BidAskData {
  symbol: string;
  bids: BidAskLevel[];
  asks: BidAskLevel[];
  asOf: string;
}

export interface TickData {
  symbol: string;
  price: number;
  qty: number;
  ts: string;
}

export type QuoteFreshness = "fresh" | "stale" | "no_data";
export type QuoteDataSource = "live" | "mock";

export interface ReadOnlyQuoteResult {
  bidask: BidAskData | null;
  ticks: TickData[];
  freshness: QuoteFreshness;
  source: QuoteDataSource;
  error?: string;
  endpointUnavailable?: boolean;
}

// ── Mock fallback shapes ─────────────────────────────────────────

function mockBidAsk(symbol: string): BidAskData {
  const mockPx: Record<string, number> = {
    "2330": 1084, "2454": 1420, "2317": 204, "3008": 2540, "6504": 84.2,
  };
  const base = mockPx[symbol] ?? 100;
  const spread = base * 0.001;
  return {
    symbol,
    bids: [
      { price: +(base - spread).toFixed(2),       qty: Math.floor(1000 + Math.random() * 4000) },
      { price: +(base - spread * 2).toFixed(2),   qty: Math.floor(2000 + Math.random() * 6000) },
      { price: +(base - spread * 3).toFixed(2),   qty: Math.floor(3000 + Math.random() * 8000) },
    ],
    asks: [
      { price: +(base + spread).toFixed(2),       qty: Math.floor(1000 + Math.random() * 4000) },
      { price: +(base + spread * 2).toFixed(2),   qty: Math.floor(2000 + Math.random() * 6000) },
      { price: +(base + spread * 3).toFixed(2),   qty: Math.floor(3000 + Math.random() * 8000) },
    ],
    asOf: new Date().toISOString(),
  };
}

function mockTicks(symbol: string): TickData[] {
  const mockPx: Record<string, number> = {
    "2330": 1084, "2454": 1420, "2317": 204, "3008": 2540, "6504": 84.2,
  };
  const base = mockPx[symbol] ?? 100;
  const now = Date.now();
  return Array.from({ length: 5 }, (_, i) => ({
    symbol,
    price: +(base + (Math.random() - 0.5) * base * 0.002).toFixed(2),
    qty: Math.floor(1000 + Math.random() * 3000),
    ts: new Date(now - i * 12_000).toISOString(),
  })).reverse();
}

// ── Fetch helpers ────────────────────────────────────────────────

async function fetchBidAsk(symbol: string): Promise<BidAskData | null> {
  const url = `${API_BASE}/api/v1/kgi/quote/bidask?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`bidask ${res.status}`);
  const json = await res.json() as { data: BidAskData } | BidAskData;
  return ("data" in json && json.data) ? json.data : json as BidAskData;
}

async function fetchTicks(symbol: string): Promise<TickData[]> {
  const url = `${API_BASE}/api/v1/kgi/quote/ticks?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ticks ${res.status}`);
  const json = await res.json() as { data: TickData[] } | TickData[];
  return (Array.isArray(json) ? json : json.data) ?? [];
}

function computeFreshness(asOf: string | undefined): QuoteFreshness {
  if (!asOf) return "no_data";
  const ageMs = Date.now() - new Date(asOf).getTime();
  return ageMs < STALE_THRESHOLD_MS ? "fresh" : "stale";
}

// ── Hook ─────────────────────────────────────────────────────────

export function useReadOnlyQuote(symbol: string): ReadOnlyQuoteResult {
  const [result, setResult] = useState<ReadOnlyQuoteResult>({
    bidask: null,
    ticks: [],
    freshness: "no_data",
    source: API_BASE || IS_PROD ? "live" : "mock",
  });

  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const sym = symbolRef.current;

    if (!API_BASE) {
      if (IS_PROD) {
        setResult({
          bidask: null,
          ticks: [],
          freshness: "no_data",
          source: "live",
          error: "NEXT_PUBLIC_API_BASE_URL is not configured",
          endpointUnavailable: true,
        });
        return;
      }
      setResult({
        bidask: mockBidAsk(sym),
        ticks: mockTicks(sym),
        freshness: "fresh",
        source: "mock",
      });
      return;
    }

    try {
      const [bidask, ticks] = await Promise.all([
        fetchBidAsk(sym),
        fetchTicks(sym),
      ]);
      const freshness: QuoteFreshness = bidask
        ? computeFreshness(bidask.asOf)
        : "no_data";
      setResult({ bidask, ticks, freshness, source: "live" });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (IS_PROD) {
        setResult({
          bidask: null,
          ticks: [],
          freshness: "no_data",
          source: "live",
          error: errMsg,
          endpointUnavailable: true,
        });
        return;
      }
      console.warn("[useReadOnlyQuote] dev fetch error; fallback to mock:", errMsg);
      setResult({
        bidask: mockBidAsk(sym),
        ticks: mockTicks(sym),
        freshness: "stale",
        source: "mock",
        error: errMsg,
        endpointUnavailable: true,
      });
    }
  }, []);

  useEffect(() => {
    void poll();
    timerRef.current = setInterval(() => { void poll(); }, POLL_MS);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, [poll, symbol]);

  return result;
}
