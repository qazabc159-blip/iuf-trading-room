# F1 Evidence — OHLCV Mock Root Cause Fix

**Date:** 2026-05-05
**Status:** DONE (code fix, pending deploy)
**File changed:** `apps/api/src/companies-ohlcv.ts`

## Root Cause (refined from Elva RCA)

Elva's report identified `OHLCV_SOURCE=mock` as the cause, but the actual
root cause is more specific:

- `/api/v1/companies/:id/ohlcv` route calls `getCompanyOhlcv()` in
  `companies-ohlcv.ts`, NOT the ohlcv-finmind-sync job
- `getCompanyOhlcv()` queries DB → DB has rows with `source="mock"` (seeded
  by the mock seeder at workspace init time)
- Because `rows.length > 0`, the function returned mock rows immediately
  without attempting FinMind
- FinMind fallback only triggered when `rows.length < 220` OR rows=0
- Result: 1734+ companies all served mock data dated 2025-07

`OHLCV_SOURCE` env var only affects `ohlcv-finmind-sync.ts` (the ETL job),
not the read-side route. The env var was a red herring for F1.

## Fix Applied

`apps/api/src/companies-ohlcv.ts` lines ~246-276:

Added `allMock` check: if every DB row has `source === "mock"`, treat as if
DB is empty for FinMind decision. Force FinMind lookup when:
- interval=1d AND
- ticker is Taiwan 4-digit AND
- FINMIND_API_TOKEN set AND
- (allMock=true OR rows < 220)

After FinMind returns bars: cache and return real data.
After FinMind returns 0: fall through to mock generator (non-blocking).
Real DB rows (source=tej/kgi): served normally, no change.

## Net Effect

On next request to `/api/v1/companies/:id/ohlcv`, server will:
1. Read DB → find mock rows → detect allMock=true
2. Call FinMind TaiwanStockPriceAdj for that ticker
3. Return real TEJ-sourced bars
4. Cache them in Redis for 600s

No DB migration needed. No mock rows deleted (stop-line #6 respected).
`source=mock` rows stay in DB but are bypassed by read logic.
