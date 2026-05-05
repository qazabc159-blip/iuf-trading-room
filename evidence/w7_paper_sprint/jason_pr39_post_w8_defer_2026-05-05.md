# PR #39 Migration 0020 — POST_W8_DEFER Decision

**Date:** 2026-05-05
**Decided by:** Elva (2026-05-05 ack, delegated from 楊董)
**Frame:** PROJECT COMPLETION (demo cancelled; target = working product, not migration polish)

---

## Decision

**Status: POST_W8_DEFER**

PR #39 is closed/blocked. Migration 0020 is NOT promoted to production. The FK CASCADE
concerns documented in the PR are acknowledged but intentionally left unaddressed until
post-W8.

---

## Why

- W8 sprint window closes 2026-05-07 18:00 TST (v2 spec deadline).
- Opportunity cost: 72h product completion sprint has higher ROI than migration audit polish.
- Production is NOT at risk: migration 0020 v1 was already BLOCKED before this decision,
  so prod DB is untouched. No regression introduced by deferral.
- FK CASCADE issue is isolated to the dedup CTE pattern in 0020 — no spread to other tables.

---

## What Stays Frozen Until Reopen

- PR #39 stays closed / blocked. Do not merge.
- Migration 0020 (v1) not promoted. Staging may have it applied; production does not.
- FK CASCADE concerns remain documented in PR #39 comments but unaddressed.
- No v2 of migration 0020 authored during W8.

---

## Reopen Criteria (any one triggers reopen)

1. TR product completion declared done (all 14 BOARD_REOPEN stop-lines green), OR
2. W9 sprint starts, OR
3. 楊董 explicit reopen instruction.

---

## Mike (Migration Auditor) — Directive

**Status: STANDBY, not active.**

Mike should NOT audit, revise, or re-open 0020 work during W8.
On reopen: Mike's first task will be to produce a 0020 v2 that addresses FK CASCADE
with proper dedup strategy and passes staging regression before prod promotion.

---

## Dispatch Handoff Append

This memo supersedes any active migration task referencing PR #39.
If session_handoff.md shows PR #39 as "in-flight", treat it as DEFERRED.
Mike standby until reopen criteria met.
