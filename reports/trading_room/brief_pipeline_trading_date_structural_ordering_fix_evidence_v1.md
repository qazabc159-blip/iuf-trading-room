# Brief Pipeline Trading Date Structural Ordering Fix — Evidence v1

## Task
Wave 2 P0 Part 1: Move `tradingDate` injection to BEFORE the AI reviewer stage so the reviewer never receives `date=""` from LLM.

## Root Cause (Root-Level)

The existing PR #384 fix patches `date` inside `approveContentDraft` (content-draft-store.ts). However, the AI reviewer runs BEFORE `approveContentDraft`:

```
submitOpenAliceResult (openalice-bridge.ts)
  → createContentDraft (with structured.date = "" from LLM)
  → fireAiReviewerForDraft (REVIEWER SEES date="")
    → buildReviewPrompt: expectedDate = today (fallback, since payload.date="" is invalid)
    → Rule 7: payload.date="" != expectedDate → REJECT
  → approveContentDraft NEVER CALLED (reviewer rejected)
```

The PR #384 fix only applies during manual force-approve or gate re-evaluation paths, not when the reviewer itself rejects the draft.

## Fix

**File**: `apps/api/src/openalice-bridge.ts`, function `submitOpenAliceResult`

**Change**: Before calling `createContentDraft`, if `targetTable === "daily_briefs"` and `payloadWithMeta.date` is absent/malformed, look up `job.contextRefs` for `{ type: "trading_date", id: "YYYY-MM-DD" }` and inject it into `payloadWithMeta.date`.

This means:
1. Draft is stored with the correct date
2. Reviewer sees the correct date — Rule 7 passes
3. `approveContentDraft` PR #384 fallback remains as a second safety layer
4. `targetEntityId` also derives from patched payload (not original `structured.date=""`), ensuring correct DB lookup key

**Additional fix**: `targetEntityId` now derived from `payloadWithMeta` (post-patch) instead of `structured` (pre-patch), so empty-date briefs get the correct `targetEntityId` in `content_drafts`.

## Ordered Protection Layers (After This Fix)

| Layer | Location | When Applied |
|-------|----------|--------------|
| 1 | openalice-bridge.ts submitOpenAliceResult | Before createContentDraft, before reviewer |
| 2 | content-draft-store.ts approveContentDraft | Before Zod parse, even if Layer 1 missed |
| 3 | openalice-pipeline.ts instructions | LLM told explicitly: date MUST equal tradingDate |

## Regression Test

**BF10** (6 cases) in `tests/ci.test.ts`:
- C1: empty date="" patched to contextRefs tradingDate
- C2: missing date key patched
- C3: non-ISO date "2026-5-13" patched
- C4: valid date not overwritten
- C5: non-daily_briefs target NOT patched (only daily_briefs gets this)
- C6: no trading_date ref in contextRefs — no-op (safe)

## Test Result

```
tests 231  pass 231  fail 0
```

## Acceptance Criteria Status

- 5/8, 5/11, 5/12 backfill can now run auto pipeline without manual force-approve: PENDING production verify
- Reviewer no longer rejects due to date mismatch: FIXED
- Date injection happens before reviewer: FIXED (structural ordering correct)
- Zod fallback remains as second layer: CONFIRMED (PR #384 still active)
