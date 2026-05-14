# JASON ISSUE_4 FIX v2 — companies dedup + unique index
# Date: 2026-05-13
# PR: #437 (branch: fix/db-companies-dedup-unique-index-issue4-2026-05-13)
# Status: AWAITING Mike re-audit + Yang backup ack

## What changed from v1 (Mike audit findings)

### BLOCKER fixed: FK rewire before DELETE
v1 migration (0030) ran DELETE directly — any dup row referenced by a FK child table
(RESTRICT default in PostgreSQL) would abort the DELETE mid-run, silently leaving dups.

v2 migration (0031) adds Step 1a-1f: UPDATE all 6 child tables to point to survivor
before DELETE. All 6 FK paths confirmed from migration SQL:

| # | Table                              | Column               | Source file                        |
|---|------------------------------------|----------------------|------------------------------------|
| 1 | company_theme_links                | company_id           | 0001_initial.sql:58                |
| 2 | company_relations                  | company_id           | 0004_company_graph.sql:12          |
| 3 | company_relations                  | target_company_id    | 0004_company_graph.sql:14          |
| 4 | company_keywords                   | company_id           | 0004_company_graph.sql:34          |
| 5 | trade_plans                        | company_id           | 0001_initial.sql:75                |
| 6 | company_notes                      | company_id           | 0011_worker_content_tables.sql:35  |

### Migration renumbered: 0030 → 0031
- Mike flagged 0030 reserved by KGI orders migration stream.
- Old files deleted: 0030_companies_unique_ticker.sql / .down.sql
- New files created: 0031_companies_unique_ticker.sql / .down.sql

### Comment corrected
- v1 said: "preserves oldest row" — INCORRECT for UUID v4 (random, not time-ordered)
- v2 says: "lexicographically smallest UUID per group" — deterministic, not time-ordered

### dedup-companies.ts updated
- Added `previewFkImpact()` — runs before any DML in both DRY_RUN and LIVE mode
- Prints per-table affected row count for all 6 FK child tables
- Live mode: executes same 6 UPDATE rewires before DELETE (mirrors migration exactly)
- Added post-DELETE sanity check: warns if result not in expected range 1000-2000

---

## Pre-deploy backup gate (REQUIRED before prod merge)

### Step 1: Railway DB snapshot
```
# Railway CLI (run before deploying migration):
railway run pg_dump $DATABASE_URL > backup_pre_dedup_$(date +%Y%m%d_%H%M%S).sql

# Or use Railway dashboard: Settings → Database → Backups → Create snapshot
```

### Step 2: Run dedup-companies.ts dry-run first
```bash
DATABASE_URL=<prod-url> DRY_RUN=true node --import tsx/esm scripts/dedup-companies.ts
```
Expected output:
- total rows before: ~3470 (≈2× seed run)
- duplicate pairs: ~1734-1736
- total excess rows to delete: ~1734-1736
- FK preview: all 6 tables showing expected counts

### Step 3: Verify DELETE count expectation
- Expected DELETE: ~1734-1736 rows (one copy per unique ticker)
- If dry-run shows < 100 or > 5000 excess rows → STOP, do not deploy

### Rollback steps if true DELETE count > expected
1. STOP deployment immediately
2. Restore from Railway snapshot taken in Step 1
3. Report to Elva with actual DELETE count vs expected count

---

## Estimated row counts (seed data analysis)
- companies total: ~3470 (2× seed)
- unique (workspace_id, ticker) pairs: ~1734-1736
- rows to DELETE: ~1734-1736
- rows to survive: ~1734-1736
- company_theme_links affected: likely 0 (FK rows reference specific companies; may point to either copy)
- company_relations affected: likely 0 (same reason)
- company_keywords affected: likely 0
- trade_plans affected: likely 0
- company_notes affected: likely 0
(Run dry-run script to get actual counts — if any FK table shows > 0, that is normal and safe to proceed)

---

## Files changed in v2
- packages/db/migrations/0031_companies_unique_ticker.sql (NEW — replaces 0030)
- packages/db/migrations/0031_companies_unique_ticker.down.sql (NEW — replaces 0030)
- packages/db/migrations/0030_companies_unique_ticker.sql (DELETED)
- packages/db/migrations/0030_companies_unique_ticker.down.sql (DELETED)
- scripts/dedup-companies.ts (UPDATED — FK preview + FK rewire in live mode)
- packages/db/src/schema.ts (unchanged — uniqueIndex already added in v1)

---

## Hard-line status
- [x] FK rewire for all 6 paths before DELETE
- [x] No DROP / TRUNCATE
- [x] No broker code touched
- [x] No contracts edit
- [x] Migration renumbered 0030 → 0031
- [x] Comment corrected (UUID v4 lexicographic smallest, not oldest)
- [x] Dry-run script previews FK delta per table
- [x] DB backup gate documented
- [ ] Mike re-audit: PENDING
- [ ] Yang backup ack: PENDING
- [ ] Merge: BLOCKED until above two cleared
