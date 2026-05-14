# JASON_BRIEF_BACKFILL_FORCE_2026-05-14

**Time**: 23:18 TST 2026-05-14  
**PR**: #474 — `feat/api-brief-backfill-force-flag-2026-05-14`  
**Commit**: a6c40ef  
**Branch**: `feat/api-brief-backfill-force-flag-2026-05-14`

## Problem

PR #471 sanitizer merged at 22:54 TST. Brief id=29defd06 (2026-05-14, published 08:16 TST)
still contains ~70 U+FFFD replacement chars. Backfill without `force=true` hits dedup gate
`brief_already_exists_for_date` → skips → brief not regenerated → still dirty tomorrow morning.

## Fix

Added `force?: boolean` to `runPipelineBackfillRange` in `openalice-pipeline.ts`.

When `force=true`:
1. Resolves workspace by slug
2. Finds all existing `daily_briefs` rows for that date (any status)
3. DELETEs them via Drizzle ORM (`db.delete(dailyBriefs).where(...)`)
4. Audit log: `[admin/brief/backfill] force=true, deleted brief_id={ids} for date={date}`
5. Falls through to `runPipelineForDate` → full pipeline runs with sanitizer applied

`force=false` (default) → behaviour unchanged (existing dedup gate still applies).

## Files Changed

- `apps/api/src/openalice-pipeline.ts` — `runPipelineBackfillRange` +force param, DELETE logic, audit log, `deleted[]` in return
- `apps/api/src/server.ts` — parse `force` from body/query, pass to `runPipelineBackfillRange`, include `deleted[]` in response JSON

## Typecheck Result

`pnpm --filter api exec tsc --noEmit` → 0 errors

## Trigger Command (Owner session required)

```
POST https://api.eycvector.com/api/v1/admin/brief/backfill
Body: {"from":"2026-05-14","to":"2026-05-14","force":true}
Cookie: <Owner session>
```

Expected response:
```json
{
  "data": {
    "from": "2026-05-14",
    "to": "2026-05-14",
    "force": true,
    "fired": ["2026-05-14"],
    "skipped": [],
    "errors": [],
    "deleted": ["2026-05-14:29defd06"]
  }
}
```

## Verification

After backfill fires:
- GET /api/v1/brief/latest → new brief_id (not 29defd06)
- Body text: U+FFFD count = 0
- `低軌衛星` section: no replacement chars, no template residue phrases

## Lane Boundary

- Only modified: `apps/api/src/openalice-pipeline.ts`, `apps/api/src/server.ts`
- Did not touch: sanitizer logic, cron schedule, risk/broker/frontend
- DELETE scope: single table `daily_briefs`, scoped to `workspace_id` + `date`, Owner-only at HTTP layer
