# AI Recommendation v2/v3 tenancy hardening — migration 0056

Date: 2026-07-13
Scope: `ai_recommendations_runs`, v2/v3 latest-read cache/query paths, cron writes, stale cleanup, same-day guard, and OpenAlice R11.

## Boundary result

| Boundary | Before | After |
|---|---|---|
| Durable run ownership | `workspace_id` nullable | `workspace_id` required |
| Legacy NULL ownership | Implicit system/global row | Backfill only when exactly one workspace exists; otherwise migration aborts |
| Latest DB read | Global newest v3 row | `workspace_id = session.workspace.id` |
| In-memory latest cache | One process-global value | Map keyed by workspace ID |
| Legacy v2 read/write path | Global latest row and nullable cron writes | Workspace-filtered reads; DB cron fans out over durable workspace IDs |
| Public v3 route | Shared auth required login but the handler read the global latest row | Shared auth still requires login; authenticated reads use the session workspace |
| Admin status/snapshot | Owner role but global latest row | Owner role plus session-workspace filter |
| Cron persistence | Could write NULL workspace | DB-mode null input fans out over durable workspace IDs |
| Stale-row sweep | Updated every workspace | Per-workspace update; null caller fans out safely |
| Same-day boot guard | Any tenant's run satisfied guard | Every durable workspace must have a run |
| R11 event | Global latest run could suppress/trigger another tenant | Missing workspace fails closed; latest run is tenant-local |

## Migration audit checklist

- [x] Forward and down files are paired.
- [x] Existing `workspace_id` foreign key to `workspaces` remains intact with `ON DELETE RESTRICT`.
- [x] Existing NULL rows are counted before schema tightening.
- [x] Backfill succeeds only with exactly one workspace and uses that durable ID.
- [x] Zero-workspace or multi-workspace legacy ownership aborts instead of guessing.
- [x] `workspace_id` becomes `NOT NULL`.
- [x] Latest-read index is `(workspace_id, generated_at DESC)`.
- [x] Existing `(workspace_id, status, generated_at DESC)` index remains available.
- [x] Drizzle schema has `.notNull()` and `.desc()` parity.
- [x] Down restores the pre-0056 nullable column and global DESC index; it does not drop the pre-existing column.
- [x] `down → down → forward → forward` succeeds.
- [x] Failed ambiguous backfill is atomic; cleanup followed by forward succeeds.

## Local evidence

- `pnpm test`: 1,699 passed, 0 failed, 1 skipped.
- `pnpm test:db`: 50 passed, 0 failed; includes v2/v3 real HTTP sessions for two workspaces.
- Migration idempotency: final `workspace_id is_nullable=NO`; index definition contains `(workspace_id, generated_at DESC)`.
- Ambiguous legacy fixture: forward exited 3 with `expected exactly one workspace, found 2`.
- Single-workspace legacy fixture: NULL row backfilled to `00000000-0000-0000-0000-000000005600`; final column is non-nullable.
- `apps/api/src/server.ts`: 5 added + 5 removed lines (10 total), within the 10-line limit.

## Deferred boundary

`ai_rec_pick_snapshots` remains a global table and is not migrated here. In a process known to have multiple workspaces, the compatibility no-argument cache read fails closed, so the cron cannot feed a tenant-ambiguous cached run into that global snapshot path. Full per-workspace performance snapshots require their own one-table migration and query audit.

Unexpected: the first DB rerun assumed an unauthenticated v3 read would reach the handler's empty state; the shared auth middleware correctly returned 401, and the assertion was corrected before the green rerun.

Unresolved: `ai_rec_pick_snapshots` still needs a separate one-table workspace migration before multi-tenant performance tracking can be enabled.
