# JASON — TAIEX Stale Root Cause + LKG Fix (2026-05-14)

## Root Cause

`/api/v1/market/overview/twse` served stale 5/12 data because:

1. At 09:02 TST, market is still open — `MI_5MINS_INDEX` returns `stat=N/A` (no close data yet today)
2. `MI_INDEX` (OpenAPI fallback) may lag — could still show 5/12 if TWSE hadn't published 5/13 EOD
3. **No last-known-good (LKG) cache** — when both sources fail, `getTwseMarketOverview` returned `null` → route returned `taiex: null` → frontend showed 5/12 stale from KGI or empty

The `_overviewCache` (60s TTL) doesn't bridge service restarts or extended TWSE downtime.

## Fix

Added LKG cache to `twse-openapi-client.ts`:
- `_lkgOverview: LkgEntry | null` — module-level, no TTL (48h max age gate)
- On every successful `getTwseMarketOverview` call → `setLkgOverview(result)`
- On failure (both `MI_5MINS_INDEX` + `MI_INDEX` return null) → `getLkgOverview()` returns last good value tagged `_isLkg: true`
- Server route strips `_isLkg` and emits `sourceState: "lkg"` (vs `"live"` / `"unavailable"`)

LKG TTL: 48h — bridges weekends (Fri close → Mon morning), holidays, TWSE maintenance.

## Files Modified

- `apps/api/src/data-sources/twse-openapi-client.ts` — LKG cache implementation + `_resetLkgOverviewCache()` export
- `apps/api/src/server.ts` — route strips `_isLkg`, emits correct `sourceState`
- `apps/api/src/__tests__/twse-market-overview.test.ts` — T3 updated to reset LKG; T3c + T3d added (LKG fallback + flag tests)

## Test Results

- `twse-market-overview.test.ts`: 8/8 PASS (T1, T1b, T2, T3, T3b, T3c, T3d, T4)
- `tests/ci.test.ts`: 237 PASS / 29 FAIL (29 pre-existing broker failures, unchanged)
- `tsc --noEmit`: 0 errors

## Lane

`twse-openapi-client.ts` + `server.ts` (market/overview/twse route only) — within Jason lane.
