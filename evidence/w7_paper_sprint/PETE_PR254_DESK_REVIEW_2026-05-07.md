# PR #254 Desk Review — Pete 2026-05-07

## 1. PR Intent
fix(openalice): write `status='published'` instead of `'approved'` when approving a content draft;
backfill legacy `approved`/`draft(worker)` rows via read-side normalize in `listBriefs`.
Sprint: W7 paper sprint. Base: main (30e8989).

## 2. Diff Summary
6 files, +85/-5.
Functional: `content-draft-store.ts` (2 write-paths), `daily-brief-producer.ts` (1 write-path),
`postgres-repository.ts` (read-side normalize).
Non-functional: 3 evidence/status-board md files.

## 3. IUF Blocker Checklist
A. Kill-switch / real-order safety: PASS — zero KILL_SWITCH / EXECUTION_MODE / order writes in diff.
B. Auth / secret hygiene: PASS — no new endpoints, no hardcoded secrets, no person_id leak.
C. State / schema integrity: PASS (with note below).
   - `daily_briefs.status` is `text` (no pgEnum), so `'approved'` values have always been valid DB storage. No migration needed.
   - `DailyBrief` contract (`packages/contracts/src/brief.ts`) exposes `"draft" | "published"` only — normalize is correct shim.
   - `createBrief` at line 1051 in postgres-repository.ts still uses raw `row.status` cast (not normalize). That path is the non-list `createBrief` method — not touched by this PR; acceptable scope.
D. PR hygiene: PASS — conventional commit `fix(openalice)`, evidence path provided in commit.
E. IUF not-cross-line: PASS.

## 4. Findings

### Blockers
None.

### Suggestions
1. **Worker fallback path idempotency gap**: `findRecentFormalRow` for `daily_briefs` queries by
   date with a time window cutoff (`createdAt >= cutoff`). Pre-PR, a `status=draft` fallback row
   written yesterday falls outside today's dedupe window, so the producer would write a second row
   tomorrow. The read-side normalize makes the old row visible as `published`, but the skip gate
   in `decideProducerRoute` uses a time window, not status. The net effect: for a legacy
   `status=draft` fallback row older than `CONTENT_DRAFT_DEDUPE_WINDOW_SECONDS`, the producer will
   silently write a duplicate row the next morning. Recommend owner confirm this edge is already
   impossible in practice (daily_briefs dedupe key is the date string, so same-date skip would
   catch it) — if so, add a comment; otherwise add a `status != 'draft'` gate in
   `findRecentFormalRow` for `daily_briefs`.

2. **`createBrief` path not covered by normalize**: `postgres-repository.ts:1051` still does
   `(row.status ?? "draft") as DailyBrief["status"]`. If a `status=approved` row is ever
   returned through the `createBrief` path (e.g., via upsert), it would bypass the normalize
   and produce an invalid contract value. Suggest adding `normalizeBriefStatus` to that path
   or confirming it can never produce `approved`.

### Nits
1. Normalize function defined inline inside `listBriefs` — extractable to module scope for
   testability. Not urgent.

### Praise
- Clean two-pronged fix: forward-path writes correct value; read-side normalize handles legacy data
  without a migration. No data destructive writes. Contracts package untouched (correct).
- `"approved"` is not in the DB schema enum (it is free-text), so this read-side shim is the
  exactly-right place to absorb the discrepancy.

## 5. Verdict
APPROVED — 0 blockers. 2 suggestions (idempotency edge + createBrief bypass), both bounded risk.

## 6. Suggested Owner for Fixes
- Suggestion #1 → Jason: confirm date-string dedupe makes the time-window moot, or add guard.
- Suggestion #2 → Jason: one-line normalize call at line 1051.

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7
