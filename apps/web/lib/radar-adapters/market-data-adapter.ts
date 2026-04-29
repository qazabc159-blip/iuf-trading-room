/**
 * RADAR → server market-data param adapters.
 *
 * Drift cases from evidence/w7_radar/api_gap_audit.md (Jim, 2026-04-29):
 *   D2 /api/v1/market-data/bars
 *      RADAR sends ?symbol=2330 (singular) → server schema: symbols (plural,
 *      comma-separated string). This adapter normalises to the server name.
 *
 *   D1/D4 /api/v1/market-data/effective-quotes
 *      RADAR sends mode=strategy|paper|execution → server ignores. No
 *      adapter needed (param is harmless), but we strip it here so the URL
 *      is clean and identical between RADAR and apps/web call sites.
 *
 *   D3 /api/v1/kgi/quote/kbar
 *      RADAR sends interval=… → server silently ignores. Backend M lift
 *      tracked post-2026-05-09. Adapter passes interval through verbatim;
 *      surface mismatch is server-side, not adapter-side.
 *
 * Server contract: see apps/api/src/market-data.ts marketDataBarsQuerySchema.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export type BarsQuery = {
  symbol?: string;
  symbols?: string | string[];
  market?: string;
  source?: string;
  interval?: string;
  includeStale?: boolean;
  from?: string;
  to?: string;
  limit?: number;
};

export type EffectiveQuotesQuery = {
  symbol?: string;
  symbols?: string | string[];
  market?: string;
  mode?: string;
  includeStale?: boolean;
  limit?: number;
};

function joinSymbols(input: string | string[] | undefined): string | null {
  if (!input) return null;
  if (Array.isArray(input)) {
    const cleaned = input.map((s) => s.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned.join(",") : null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildQuery(entries: Array<[string, string | undefined]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function buildBarsUrl(query: BarsQuery): string {
  const symbols = joinSymbols(query.symbols ?? query.symbol);
  if (!symbols) {
    throw new Error("buildBarsUrl: symbol or symbols required");
  }
  const qs = buildQuery([
    ["symbols", symbols],
    ["market", query.market],
    ["source", query.source],
    ["interval", query.interval],
    ["includeStale", query.includeStale === undefined ? undefined : String(query.includeStale)],
    ["from", query.from],
    ["to", query.to],
    ["limit", query.limit === undefined ? undefined : String(query.limit)]
  ]);
  return `${API_BASE}/api/v1/market-data/bars${qs}`;
}

export function buildEffectiveQuotesUrl(query: EffectiveQuotesQuery): string {
  const symbols = joinSymbols(query.symbols ?? query.symbol);
  if (!symbols) {
    throw new Error("buildEffectiveQuotesUrl: symbol or symbols required");
  }
  // mode=… deliberately dropped (server ignores; cleaner URLs).
  const qs = buildQuery([
    ["symbols", symbols],
    ["market", query.market],
    ["includeStale", query.includeStale === undefined ? undefined : String(query.includeStale)],
    ["limit", query.limit === undefined ? undefined : String(query.limit)]
  ]);
  return `${API_BASE}/api/v1/market-data/effective-quotes${qs}`;
}

export async function fetchBars(query: BarsQuery, init?: RequestInit) {
  const response = await fetch(buildBarsUrl(query), {
    credentials: "include",
    ...init
  });
  if (!response.ok) {
    throw new Error(`fetchBars: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchEffectiveQuotes(query: EffectiveQuotesQuery, init?: RequestInit) {
  const response = await fetch(buildEffectiveQuotesUrl(query), {
    credentials: "include",
    ...init
  });
  if (!response.ok) {
    throw new Error(`fetchEffectiveQuotes: ${response.status} ${response.statusText}`);
  }
  return response.json();
}
