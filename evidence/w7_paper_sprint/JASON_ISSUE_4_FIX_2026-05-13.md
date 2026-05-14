# JASON_ISSUE_4_FIX — Companies Dedup + Unique Index
**Date**: 2026-05-13
**PR**: #437 `fix/db-companies-dedup-unique-index-issue4-2026-05-13`
**Commit**: 7d60ed1
**Status**: OPEN — **Mike audit required before merge**

## Root Cause
`companies` table has no UNIQUE constraint on `(workspace_id, ticker)`.
Seed/import scripts run multiple times → 3470 rows ≈ 2× expected 1734.
`listCompanies()` returns duplicates → UI shows double companies.

## Changes
### `packages/db/migrations/0030_companies_unique_ticker.sql`
```sql
-- Step 1: Delete dups, keep MIN(id) per (workspace_id, ticker)
DELETE FROM companies
WHERE id NOT IN (
  SELECT MIN(id)::uuid
  FROM companies
  GROUP BY workspace_id, ticker
);

-- Step 2: Prevent future dups
CREATE UNIQUE INDEX IF NOT EXISTS companies_workspace_ticker_uidx
  ON companies (workspace_id, ticker);
```

### `packages/db/migrations/0030_companies_unique_ticker.down.sql`
- `DROP INDEX IF EXISTS companies_workspace_ticker_uidx` (dedup DELETE irreversible by design)

### `packages/db/src/schema.ts`
- `companies` table definition: added `uniqueIndex("companies_workspace_ticker_uidx")` on `(workspaceId, ticker)`

### `scripts/dedup-companies.ts`
- Standalone dry-run / live dedup script
- `DRY_RUN=true` (default): reports row count + top duplicates, no DELETE
- `DRY_RUN=false`: executes DELETE, reports delta

## Operator Dry-Run (REQUIRED before merge)
```bash
DATABASE_URL=<prod-url> DRY_RUN=true node --import tsx/esm scripts/dedup-companies.ts
```
Expected: ~1736 excess rows identified.

## Mike Audit Checklist
- [ ] Migration additive-safe (no column mutations)
- [ ] MIN(id) survivor logic correct (UUID lexicographic = oldest row)
- [ ] FK constraint behavior: dup row with FK reference fails DELETE (safe, not silent loss)
- [ ] `IF NOT EXISTS` makes index creation idempotent
- [ ] Down migration correctly drops only index
- [ ] Dry-run script logic verified

## Verify (after dry-run + live dedup + migration)
```
SELECT COUNT(*) FROM companies;  -- should be ~1734
```

## Build
- tsc: 0 errors (db + domain + api packages)
- Lane: schema.ts (db package), migration files, scripts/dedup-companies.ts
- No server.ts changes
