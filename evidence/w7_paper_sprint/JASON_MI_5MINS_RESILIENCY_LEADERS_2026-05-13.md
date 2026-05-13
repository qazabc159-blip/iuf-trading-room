# Jason — MI_5MINS_INDEX Fetch Resiliency + /leaders/twse Route

**Date**: 2026-05-13
**Branch**: fix/api-mi5mins-resiliency-leaders-twse-2026-05-13
**Base**: main @ 6753a2c (PR #432 merged)
**PR Title**: fix(api): MI_5MINS_INDEX fetch resiliency + add /leaders/twse route

---

## Root Causes Fixed

### True Cause 1: MI_5MINS_INDEX timeout from Railway

Railway server (Japan region) to TWSE main site has 10-20s+ latency.
`FETCH_TIMEOUT_MS = 3000` caused every attempt to abort → JSON parse fail → fall through to MI_INDEX → stale 5/12 TAIEX 41898.32.

### True Cause 2: /api/v1/market/leaders/twse was 404

Route missing from server.ts. Frontend expected top gainers/losers/active.

---

## Fixes Applied

### Fix 1: `twse-openapi-client.ts` — MI_5MINS_INDEX resiliency

- **New constant**: `MI5MINS_TIMEOUT_MS = 25000` (dedicated 25s timeout for MI_5MINS_INDEX only)
- **Retry**: 3 attempts total (backoff: 0s → 1s → 2s) — covers transient Railway→TWSE flaps
- **User-Agent**: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...` — TWSE may block default Node fetch UA
- **Body logging**: read `resp.text()` → detect non-JSON (HTML/empty) → log body prefix on error
- **Parse error logging**: emit detailed parse error message on JSON parse fail
- Other endpoints unchanged (still use 3s `FETCH_TIMEOUT_MS` for OpenAPI endpoints which are fast)

### Fix 2: `twse-openapi-client.ts` — getTwseLeaders()

New exported function + types:
- `TwseLeaderStock` — { symbol, name, last, changePct, volume, source }
- `TwseLeadersResult` — { topGainers, topLosers, mostActive, source, asOf }
- `getTwseLeaders({ fetchOverride?, topN? })` — derives top-N from STOCK_DAY_ALL (shared cache with breadth/heatmap)
- `_resetTwseLeadersCache()` — for test cleanup
- 60s in-memory cache (same TTL as overview/breadth)

### Fix 3: `server.ts` — GET /api/v1/market/leaders/twse

Source chain:
1. **Primary**: FinMind TaiwanStockPrice (sponsor tier) via `getFinMindLeaders()`
2. **Secondary**: TWSE STOCK_DAY_ALL via `getTwseLeaders()` (shares STOCK_DAY_ALL cache)

Response shape:
```json
{
  "topGainers": [{ "symbol": "2454", "name": "聯發科", "last": 1100, "changePct": 0.92, "volume": 13200000000, "source": "twse_openapi" }, ...],
  "topLosers": [...],
  "mostActive": [...],
  "source": "finmind|twse_openapi",
  "asOf": "2026-05-13"
}
```

Auth: `READ_DRAFT_ROLES` (same as other market routes)

### Fix 4: `__tests__/twse-market-overview.test.ts`

- Updated T1 / T1b mock `Response` objects to include `text: async () => JSON.stringify(body)` (required by new `resp.text()` path)
- Added import for `getTwseLeaders`, `_resetStockDayAllCache`, `_resetTwseLeadersCache`
- Added **T3b**: `getTwseLeaders` — verifies top gainers/losers/mostActive from mock STOCK_DAY_ALL

---

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/data-sources/twse-openapi-client.ts` | MI5MINS_TIMEOUT_MS + retry + User-Agent + text() + getTwseLeaders() |
| `apps/api/src/server.ts` | GET /api/v1/market/leaders/twse route |
| `apps/api/src/__tests__/twse-market-overview.test.ts` | text() in mocks + T3b new test |

---

## Build / Test Results

- `tsc --noEmit`: **0 errors**
- `twse-market-overview.test.ts`: **6/6 PASS** (T1, T1b, T2, T3, T3b, T4)
- Lane boundary: only strategy-permitted files touched

---

## Hard-line Status

| Rule | Status |
|------|--------|
| No fake/mock data in prod routes | CLEAN |
| No token leak (FinMind token in env var only) | CLEAN |
| No broker/* change | CLEAN |
| No contracts change | CLEAN |
| No apps/web/* change | CLEAN |
| No DB migration | CLEAN |
