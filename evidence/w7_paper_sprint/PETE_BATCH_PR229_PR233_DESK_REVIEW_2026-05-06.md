# Batch Desk Review — PR #229 + PR #233 — Pete 2026-05-06

## Common Base Facts
- Fork point: `12735b5` (feat(web): daily brief review state truthfully #220)
- Main HEAD: `d1059ef` (3 commits ahead of fork)
- Both PRs carry M-3 portfolio fills commit `21d3bca` which already landed on main as `8ac36ab`.
  Merge risk: double-apply if merged without rebase onto current main. Elva must rebase both onto
  `d1059ef` before merge (or confirm squash strategy resolves cleanly).
- Bruce audit: APPROVE on both (2026-05-06). Pete concurs with modifications noted below.

---

## PR #229 — feat(web): expose OpenAlice draft source trail (+277 / -8 net new)

### PR Intent
Add source-trail column to content-drafts list + full audit trail panel (DRF-TRAIL, DRF-ACT) to
detail page. Surfaces job lineage, producer version, review actor/note for each draft. Write actions
blocked behind DRF-ACT "受控" gate — no fake approve.

### IUF Blocker Checklist §A-E

| Section | Item | Result |
|---|---|---|
| A | KILL_SWITCH / EXECUTION_MODE toggle | PASS — 0 hits |
| A | place_order / submit_order / kgi.order.create | PASS — 0 hits |
| A | Paper sprint: all order paths via /api/v1/paper/* | PASS — no new order route |
| A | Feature flag default OFF | N/A — display-only |
| B | New endpoints with auth | N/A — no new backend endpoints |
| B | Hardcoded API key / token / password | PASS — 0 hits |
| B | person_id / userId / sessionId leak in DOM | PASS — draft.id sliced to 8 chars; no userId rendered |
| C | DB schema change → migration pair | PASS — 0022/0023 renames are promote-only (similarity 100%), no content change |
| C | enum/status string sync | N/A |
| D | PR title format | PASS — feat(web) conventional commit |
| D | stacked chain base correct | FLAG — see nit below |
| E | No agent lane crossing | PASS |
| E | No KGI write-side | PASS |
| E | No redaction policy violation | PASS |

### Findings — Priority Ranked

**🔴 Blockers**
None.

**🟡 Suggestions**
1. **[Merge hygiene]** Both PR branches carry `21d3bca` (M-3 portfolio fills) which already merged
   to main as `8ac36ab`. Before Elva merges, rebase PR #229 onto `d1059ef` to avoid double-apply
   on portfolio/page.tsx and globals.css.
   - Applies equally to PR #233.

**💭 Nits**
1. **[stateLabel reuse across types]** `stateLabel(fillsResult.state)` shows "無部位" when fills
   state is EMPTY (PortfolioState label reused on FillsState). Body text correctly says "無成交",
   but panel header reads "無部位". Low UX impact, TypeScript won't catch it because state strings
   are identical.
   - File: apps/web/app/portfolio/page.tsx, line ~386.
   - Fix: add `fillsStateLabel` returning "無成交" for EMPTY.

2. **[section key uses index]** `key={\`${section.heading}-${index}\`}` — if two sections have
   the same heading, key collides. Acceptable for now (content controlled by AI output).

**Praise**
- DRF-ACT panel correctly refuses to put fake approve buttons — "不得使用本機假成功" is explicit and enforced.
- `contentDraftReviewNote` handles all three status states cleanly; awaiting_review, approved (with/without ref), rejected.
- `formatDateTime(value: string | null)` in detail page guards null correctly returning "未設定".

### Verdict
NEEDS_FIX (minor) — merge hygiene only (shared with #233). No blocker in PR-specific logic.

---

## PR #233 — feat(web): show OpenAlice pipeline observability (+121 / -10 net new)

### PR Intent
Extend /briefs page with: 3-state daily brief surface (PUBLISHED/AWAITING_REVIEW/MISSING/ERROR),
OpenAlice pipeline metrics grid, job queue panel, draft gate panel. Pipeline fields consumed from
existing backend route (observability addendum confirmed live in server.ts:2307).

### IUF Blocker Checklist §A-E

| Section | Item | Result |
|---|---|---|
| A | KILL_SWITCH / EXECUTION_MODE toggle | PASS — 0 hits |
| A | place_order / submit_order / kgi.order.create | PASS — 0 hits |
| A | All order paths via paper endpoint | N/A — no order path |
| A | Feature flag default OFF | N/A |
| B | New endpoints | N/A — consumes existing /api/v1/openalice/observability |
| B | Hardcoded token / secret | PASS — 0 hits |
| B | person_id / userId / sessionId leak | PASS — no user identifier rendered |
| C | DB schema change | PASS — no migration, no schema touch |
| D | PR title format | PASS — feat(web) |
| E | No KGI write-side | PASS |

### State Semantics Verification (per review focus)

1. **pipeline addendum missing → "待接資料"**
   `pipelineStatusLabel(pipeline | undefined)`: if undefined → returns "未回傳" (yellow badge).
   PASS — not fake-green.

2. **lastReviewedAt=null displayed as stale?**
   `pipelineTime(lastReviewedAt)` returns "--" when null. Not labeled stale.
   PASS — null shows as "--", not as a freshness alarm.

3. **lastPublishedAt=null + today brief approved**
   `buildDailyBriefSurface`: PUBLISHED requires `daily_briefs` row with `status=published` AND
   `date=today`. If lastPublishedAt is null but a today draft is awaiting_review → AWAITING_REVIEW.
   PASS — no fake-published.

4. **lastFailureReason display**
   Rendered at line 674: `{openAlice.data.pipeline?.lastFailureReason ?? "--"}`. If non-null,
   shows the error string. pipelineStatusLabel checks `lastFailureReason` first → "錯誤" red badge.
   PASS — error surfaces correctly.

5. **historyFreshness**
   `latestAgeDays === 0 ? "LIVE" : "STALE"` — correctly marks yesterday's brief as STALE.
   PASS.

### Findings — Priority Ranked

**🔴 Blockers**
None.

**🟡 Suggestions**
1. Same merge hygiene issue as #229 — rebase onto d1059ef before merge.

2. **[pipeline? optional vs backend always-sends]** Backend always returns `pipeline` field (not
   conditional). Frontend types it as `pipeline?` optional. No runtime bug since backend always
   sends it, but the type mismatch is misleading — `pipeline` could be typed as required.
   Low risk for now (guarded everywhere with `?.`), but worth aligning for future contract clarity.

**💭 Nits**
1. **[pipelineStatusLabel priority order]** `lastFailureReason` checked before `lastPublishedAt`.
   Scenario: lastFailureReason="some_old_error" but lastPublishedAt is set (meaning publish
   succeeded after the error). The badge shows "錯誤" even though publish succeeded.
   Should check lastPublishedAt first if it represents the latest terminal state.
   Recommend: swap order (lastPublishedAt check before lastFailureReason).
   - File: apps/web/app/briefs/page.tsx, line ~363.

2. **[ADVICE_PATTERNS regex stateful]** The `hasInvestmentAdvice` function calls `pattern.lastIndex = 0`
   inside the `some()` before `.test()` — correct. But the `maskInvestmentAdvice` uses `reduce`
   with `/g` flags on the same array of regex objects, which mutates `lastIndex`. After masking
   the same text is never re-tested, so no observable bug, but using `new RegExp(pattern.source, "g")`
   per call would be cleaner.

**Praise**
- Three-state DailyBriefSurfaceState union is explicit and exhaustive — compiler enforces all cases.
- AWAITING_REVIEW state correctly links to `/admin/content-drafts` not to a fake publish action.
- `maskInvestmentAdvice` + `hasInvestmentAdvice` is a good defense-in-depth against AI hallucinations
  containing investment advice wording reaching the operator's screen unchecked.
- `friendlyDataError` used consistently — no raw error.message leaking to users.

### Verdict
NEEDS_FIX (minor) — merge hygiene shared with #229. PR-specific logic is sound.

---

## Joint Summary

| PR | Blocker count | Verdict | Dominant risk |
|---|---|---|---|
| #229 | 0 | NEEDS_FIX (minor) | Merge hygiene: rebase onto d1059ef before merge |
| #233 | 0 | NEEDS_FIX (minor) | Same merge hygiene + pipeline? optional/required mismatch |

**Merge hygiene fix (applies to both)**: Elva or owner must rebase feat/web-openalice-*
branches onto d1059ef (current main). The M-3 portfolio fills commit (`21d3bca`) in both
branches is already in main as `8ac36ab` — squash merge without rebase will double-apply portfolio
changes. After rebase, both are clear for ready.

---

Reviewer: Pete
Date: 2026-05-06
Sprint: W7 Paper Sprint
Re-review required: NO (after rebase fix confirmed)
