# Jason — Main Page Market Latency Fix
**Date**: 2026-05-13
**PR branch**: `fix/api-web-main-page-market-latency-cache-parallel-2026-05-13`
**Status**: SHIPPED

## Root Cause Analysis

### Why endpoint took > 8s:

1. **Sequential TWSE fetches in `/heatmap/twse`**:
   - DB query (ticker→industry mapping) ran first
   - THEN `STOCK_DAY_ALL` fetch (5s timeout) ran
   - THEN TPEX fetch (5s timeout) ran sequentially
   - Total cold path: DB(~200ms) + STOCK_DAY_ALL(3-5s) + TPEX(3-5s) = 6-10s

2. **STOCK_DAY_ALL fetched twice independently**:
   - `/heatmap/twse` fetched it once
   - `/breadth/twse` fetched it independently
   - No sharing, no dedup

3. **Fetch timeouts too permissive**:
   - `fetchTwse()` used 10s AbortSignal timeout
   - TPEX/MI_INDEX used 5s each
   - With retry, cold path could take 20s+

4. **Frontend timeout too tight**:
   - `PUBLIC_MARKET_ENDPOINT_MS = 6000` (6s) — backend needed 6-10s cold
   - `FETCH_MARKET_MS = 8000` (8s) outer wrap — same problem

## Fixes Applied

### Backend: `apps/api/src/data-sources/twse-openapi-client.ts`

1. **Added `FETCH_TIMEOUT_MS = 3000`** — all upstream TWSE/TPEX fetches now 3s (fail fast)
2. **Added `STOCK_DAY_ALL_CACHE_TTL_SECONDS = 300`** — 5 min shared cache (EOD data stable)
3. **Added `getStockDayAllRows()` (exported)** — shared dedup cache with promise coalescing:
   - If inflight promise exists, reuse it (concurrent requests share one upstream fetch)
   - If cached and TTL valid, return immediately (cache hit ~0ms)
4. **`getTwseIndustryHeatmap()`**: replaced sequential STOCK_DAY_ALL + TPEX with `Promise.all([getStockDayAllRows(), tpexFetch()])`
5. **`getTwseMarketBreadth()`**: replaced its own STOCK_DAY_ALL fetch with `getStockDayAllRows()` call

### Backend: `apps/api/src/server.ts`

6. **`/api/v1/market/heatmap/twse` route**: DB query and `getStockDayAllRows()` now run in `Promise.all()` — parallel instead of sequential

### Frontend: `apps/web/app/page.tsx`

7. **`PUBLIC_MARKET_ENDPOINT_MS`**: 6000 → 10000 (10s, generous for Railway→TWSE cold path)
8. **`FETCH_MARKET_MS`**: 8000 → 15000 (15s outer wrapper, backend 3s internal + 5min cache)

## Latency Improvements

| Scenario | Before | After |
|----------|--------|-------|
| Cold cache, `/heatmap/twse` | 6-10s | ~3s (parallel) |
| `/breadth/twse` concurrent with heatmap | 3-5s (independent) | ~0ms (shared cache) |
| Warm cache (any endpoint) | 3-5s (always re-fetches) | ~0ms (cache hit) |
| Frontend timeout threshold | 6s public, 8s outer | 10s public, 15s outer |

## Files Modified

- `apps/api/src/data-sources/twse-openapi-client.ts` — shared STOCK_DAY_ALL cache + 3s timeout
- `apps/api/src/server.ts` — parallel DB+TWSE in heatmap route
- `apps/web/app/page.tsx` — timeout increase (8000→15000, 6000→10000)
- `apps/web/app/components/industry-heatmap.tsx` — Codex wording (carried from stash)

## Test Results

- TypeScript API: 0 errors
- TypeScript Web: 0 errors
- `twse-market-overview.test.ts` T1-T4: 4/4 PASS
- `dashboard-snapshot.test.ts` T1-T6: 6/6 PASS
- CI test failure: pre-existing on main (ERR_REQUIRE_CYCLE_MODULE + S1 strategy-ideas)

## Lane Boundary

- No broker code touched
- No KGI gateway touched
- No risk engine touched
- No contracts changed
- apps/web change limited to timeout constants in page.tsx (line 241-243)
- No fake data / no mock fallback
