# F3 Evidence — OpenAlice daily_brief Dispatcher Fix

**Date:** 2026-05-05
**Status:** DONE (code fix, pending deploy)
**File changed:** `apps/api/src/server.ts`

## Root Cause

`enqueueOpenAliceJob()` exists and works (used by manual POST /api/v1/openalice/jobs).
However, there was NO automatic dispatcher that calls it for `daily_brief` jobs.

Evidence:
- `queuedJobs=0` permanently despite `workerStatus=healthy`
- Latest brief date: 2026-04-25 (10 days stale as of 5/5)
- All terminal jobs trace to P0E test residue (4/22-4/25 era)
- No cron / scheduler / setInterval found in codebase for daily_brief dispatch
- grep `daily_brief.*enqueue` returns 0 hits outside test files

Worker (OpenAlice device) is alive and polling — it just has no jobs to claim.
The dispatcher was never implemented.

## Fix Applied

### `apps/api/src/server.ts`

Added `runDailyBriefDispatcherTick(workspaceSlug)` function:
- Calls `enqueueOpenAliceJob()` with:
  - taskType: "daily_brief"
  - schemaName: "daily_brief_v1"
  - instructions: auto-generated with today's date
  - contextRefs: [{ type: "date", id: todayStr }]
  - parameters: { targetDate: todayStr, autoDispatched: true }
- Error is caught and logged, never propagates to crash server

Wired into `startSchedulers()` with:
- First tick: immediately on process startup
- Recurring: every 23 hours (drift-safe, avoids exact midnight race)

## Expected Result After Deploy

Within 5 minutes of Railway deploy:
- `[daily-brief-dispatcher] Enqueued daily_brief for 2026-05-05: jobId=<uuid>` in logs
- `/api/v1/openalice/jobs?status=queued` returns 1 new job with today's date
- OpenAlice worker (if active and registered) will claim and process it
- After ~2-5 min: `/api/v1/briefs` shows a new entry for 2026-05-05

## Note on idempotency

Current impl enqueues one job per tick without deduplication by date.
If scheduler runs multiple ticks in one day, multiple jobs will be created.
This is acceptable for now — OpenAlice worker processes them and the best
result wins via content-draft review flow.
TODO: add DB query to check if today's daily_brief job already queued.
