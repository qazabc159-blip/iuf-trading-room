import type { Company } from "@iuf-trading-room/contracts";

import { getCompanies } from "../api";

const TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  symbolToId: Map<string, string>;
  loadedAt: number;
};

let cache: CacheEntry | null = null;

type CompaniesFetcher = () => Promise<{ data: Company[] }>;

let fetcher: CompaniesFetcher = getCompanies as unknown as CompaniesFetcher;

export function __setCompaniesFetcherForTests(fn: CompaniesFetcher | null) {
  fetcher = fn ?? (getCompanies as unknown as CompaniesFetcher);
}

export function __resetCacheForTests() {
  cache = null;
}

export function __seedCacheForTests(entries: Array<[string, string]>, loadedAt = Date.now()) {
  cache = {
    symbolToId: new Map(entries.map(([k, v]) => [k.toUpperCase(), v])),
    loadedAt
  };
}

function buildCache(companies: Company[]): CacheEntry {
  const symbolToId = new Map<string, string>();
  for (const company of companies) {
    if (!company.ticker) continue;
    const key = company.ticker.trim().toUpperCase();
    if (!key) continue;
    symbolToId.set(key, company.id);
  }
  return { symbolToId, loadedAt: Date.now() };
}

function isStale(entry: CacheEntry): boolean {
  return Date.now() - entry.loadedAt > TTL_MS;
}

export async function resolveCompanyId(symbol: string): Promise<string | null> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return null;

  if (!cache || isStale(cache)) {
    try {
      const response = await fetcher();
      cache = buildCache(response.data);
    } catch {
      return null;
    }
  }

  return cache.symbolToId.get(normalized) ?? null;
}
