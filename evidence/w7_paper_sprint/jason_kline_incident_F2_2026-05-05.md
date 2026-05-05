# F2 Evidence — kbar/OHLCV ETL Scheduler Fix

**Date:** 2026-05-05
**Status:** DONE (code fix, pending deploy)
**Files changed:** `apps/api/src/server.ts`, `apps/api/src/jobs/ohlcv-finmind-sync.ts`

## Root Cause

`runOhlcvFinmindSync()` existed in `apps/api/src/jobs/ohlcv-finmind-sync.ts`
but was NEVER called by anything. No cron, no setInterval, no scheduler.
The function was written but not wired. Companies_ohlcv DB table therefore
stopped receiving new rows after mock seed (4/29 was when last manual sync
or seed ran).

Evidence:
- `requestCount=0` in diagnostics — no FinMind fetch since process start
- DB ohlcv rows all have `source="mock"`
- `ohlcv-finmind-sync.ts` has no callers: grep `runOhlcvFinmindSync` returns
  only its own definition file

Note: `/kbar` route (minute bars) is NOT DB-backed — it calls FinMind API
on-demand per request. Empty kbar = holiday or FinMind no data for date.
That's correct behavior and not a bug.

## Fix Applied

### `apps/api/src/jobs/ohlcv-finmind-sync.ts`
- Added `forceFinmind?: boolean` option to `runOhlcvFinmindSync()`
- When `forceFinmind=true`, bypasses `OHLCV_SOURCE=mock` env check
- Allows scheduler to run sync even if env var not flipped

### `apps/api/src/server.ts`
- Added `runOhlcvFinmindSync` import from `./jobs/ohlcv-finmind-sync.js`
- Added `companies`, `workspaces` to `@iuf-trading-room/db` import
- Added `runOhlcvSchedulerTick(workspaceSlug)` function:
  - Skips if FINMIND_API_TOKEN not set
  - Queries all Taiwan-ticker (4-digit) companies in workspace
  - Calls `runOhlcvFinmindSync` with startDate=today-10, forceFinmind=true
- Added `startSchedulers(workspaceSlug)` function
- Wired `startSchedulers(defaultWorkspace)` in `serve()` startup callback

## Schedule

- First tick: immediately on process startup (backfills last 10 days)
- Recurring: every 6 hours (idempotent upsert via ON CONFLICT DO UPDATE)
- No-op guards: token missing → skip; DB unavailable → skip

## Expected Result After Deploy

Within 5 minutes of Railway deploy:
- `[ohlcv-scheduler]` logs appear in Railway log stream
- companies_ohlcv rows with `source="tej"` appear for 2026-04-30 through 2026-05-05
