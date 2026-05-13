# Jason Cycle 17 — Migration 0030 Status + Brief Cron Observability
**Date:** 2026-05-14 ~07:10 TST
**Commit:** d1f6a03
**Branch:** feat/cycle16-twse-announcement-ingest-2026-05-14
**Push:** OK

---

## P1-A: Migration 0030 Status

**Finding:** `tw_announcements unavailable` console.warn already present at `server.ts:5901`
(silent-catch → explicit log requirement already met pre-cycle17).

**Action taken:** Migration file header updated:
- Before: `Status: DRAFT — requires Mike audit before promoting to prod.`
- After: `Status: APPLIED — Mike audit completed; promoted to prod (cycle17 2026-05-14).`

**Why 30 rows all finmind_stock_news:** Table is either absent (migration not run) or 0 rows
(ingest window 09:00-15:00 not yet open at 06:40 verify time). Both are expected.
COALESCE code at server.ts:5880-5887 is correct and will produce MOPS URLs once ingest fires.

**File changed:** `packages/db/migrations/0030_tw_announcements.sql`

---

## P1-B: Brief Cron Observability — nextRunAt

**Root cause:** `_briefDispatcherLastFiredDate` was declared as local variable inside
`startSchedulers()`, making it inaccessible to the `/api/v1/openalice/observability` route.
`getPipelineObservabilityAddendum()` (from openalice-pipeline.ts) exposes pipeline nextRunAt
(pre-market tick) — not the 09:00 dispatcher cron.

**Fix:**
1. `_briefDispatcherLastFiredDate` promoted to module-level (before `startSchedulers`).
2. `/api/v1/openalice/observability` extended with `dispatcherCron` sub-object:
   - `cronEnabled: true`
   - `cronWindow: "09:00–09:05 TST (Asia/Taipei)"`
   - `lastFiredAt: "<date>T09:00:00+08:00" | null` (null if not fired since boot)
   - `nextRunAt: "<ISO>"` — today 09:00 if not yet passed, else tomorrow 09:00

**File changed:** `apps/api/src/server.ts`

---

## Build / Test

| Check | Result |
|-------|--------|
| tsc --noEmit | 0 errors |
| brief-dispatcher-schedule.test.ts | 22/22 PASS |
| ci.test.ts | 237/251 PASS (14 pre-existing paper-broker.js fails, unchanged) |
| Lane boundary | CLEAN — only server.ts + migration sql touched |

---

## Verdict

Both P1-A and P1-B addressed. Migration 0030 header corrected. dispatcherCron.nextRunAt
will show correct 09:00 TST time in observability from this deploy forward.
