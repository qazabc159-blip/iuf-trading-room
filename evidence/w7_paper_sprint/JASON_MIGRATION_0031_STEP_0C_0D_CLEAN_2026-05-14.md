# PR #466 — Migration 0031 Step 0c + 0d (Clean Single-Purpose)

**Date**: 2026-05-14 16:10 TST
**Branch**: fix/migration-0031-step-0c-0d-2026-05-14
**Commit**: 2250a63
**PR**: https://github.com/qazabc159-blip/iuf-trading-room/pull/466
**Author**: Jason

## Changes

### SQL: `packages/db/migrations/0031_companies_unique_ticker.sql`

- **Step 0c** (NEW): Pre-dedup `company_theme_links` before rewire.
  - PRIMARY KEY (company_id, theme_id) collision fix.
  - ROW_NUMBER() OVER (PARTITION BY survivor_id, theme_id ORDER BY company_id ASC).
  - DELETE rows where rn > 1 (keeps lowest company_id per survivor+theme pair).

- **Step 0d** (NEW): Pre-dedup `companies_ohlcv` before rewire.
  - UNIQUE INDEX (company_id, dt, interval) collision fix.
  - MIN(id) per (survivor_id, dt, interval) — NULL-safe (id is PK, never NULL).
  - DELETE rows NOT IN (MIN id per group).

- **Step 1g** (NEW): Rewire `companies_ohlcv.company_id` → survivor.
  - Placed after Step 0d dedup — safe to UPDATE now.

- **Step 1a comment** updated: "(pre-deduped in Step 0c — safe to UPDATE now)"

### Tests: `apps/api/src/__tests__/migration-0031-dedup.test.ts`

- Added `CompanyThemeLink` + `CompanyOhlcv` types.
- Added `simulateStep0c()` — ROW_NUMBER partition simulation.
- Added `simulateStep0d()` — MIN(id) per group simulation.
- **MIG08**: company_theme_links PK collision scenario — bbbb|theme-semiconductor deleted, aaaa kept.
- **MIG08b**: unique company + distinct themes both survive — 5 assertions.
- **MIG09**: companies_ohlcv UNIQUE collision — o2 (higher id) deleted, o1 (MIN) kept.
- **MIG09b**: unique company + distinct dt/interval both survive — 5 assertions.

## Test Result

```
11/11 PASS (256ms)
MIG01 - MIG07: all GREEN (existing)
MIG08, MIG08b, MIG09, MIG09b: all GREEN (new)
```

## Branch Hygiene

- Single commit on branch: 2250a63
- Only 2 files staged + committed
- No schedulers / server.ts / contracts / apps/web touched

## Gate Status

- NOT auto-merged (楊董明示)
- Awaiting: Mike round 5 SQL audit + Bruce dry-run
