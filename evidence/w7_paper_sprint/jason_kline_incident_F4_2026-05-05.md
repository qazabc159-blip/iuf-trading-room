# F4 Evidence — FinMind Diagnostics Counter Wire-Up

**Date:** 2026-05-05
**Status:** DONE (code fix, pending deploy)
**Files changed:**
- `apps/api/src/data-sources/finmind-client.ts`
- `apps/api/src/server.ts`

## Root Cause

PR #182 "wire FinMind diagnostics dashboard" added the `/api/v1/diagnostics/finmind`
route but left `recordFinMindRequest()` un-wired. server.ts:4347 comment confirmed:
"not wired yet". Module-level counters in server.ts were never incremented.

Consequence: dashboard showed `requestCount=0, lastFetchTs=null` permanently —
staff read this as "no FinMind traffic" instead of "counter broken".
This masked the real issue (OHLCV_SOURCE=mock + no scheduler).

Would-have-been-caught-earlier: if counter had worked, any FinMind fetch via
/financials or /kbar routes would have shown requestCount > 0, proving the client
code path is functional.

## Fix Applied

### `apps/api/src/data-sources/finmind-client.ts`

Added at module level (below singleton):
- `_requestCount`, `_errorCount`, `_lastFetchTs`, `_lastDataset` counters
- `recordFinMindRequest({ dataset, ok })` — called inside `_fetch()` on every
  HTTP attempt outcome (success, 4xx/5xx, fetch error, parse error)
- `getFinMindStats()` — returns snapshot for diagnostics route to read
- `_resetFinMindStats()` — test utility

Wired `recordFinMindRequest()` inside `FinMindClient._fetch()` at 4 points:
- fetch() throws → `ok: false`
- response.ok is false → `ok: false`
- JSON parse fails → `ok: false`
- API status != 200 → `ok: false`
- Success path → `ok: true`

### `apps/api/src/server.ts`

- Added `getFinMindStats` to import from `finmind-client.js`
- Removed 4 module-level counter variables (`_finmindRequestCount` etc.)
- `recordFinMindFetch()` kept as no-op (backward compat for existing callers
  like `/companies/:symbol/ohlcv` at line ~4822)
- Diagnostics route now calls `getFinMindStats()` from client module

## Diff size

finmind-client.ts: +44 lines (counter block + 4 recordFinMindRequest calls)
server.ts: -8 lines net (removed 4 vars + old counter logic, added getFinMindStats import)

## Expected Result After Deploy

`/api/v1/diagnostics/finmind` after any company page load:
- `requestCount >= 1` (from /kbar or /financials route)
- `lastFetchTs` = recent ISO timestamp
- `lastDataset` = "TaiwanStockPriceAdj" or "TaiwanStockKBar"
