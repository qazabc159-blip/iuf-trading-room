# W4 Frontend Cutover — Rollback Runbook

**Date**: 2026-04-28 (overnight augment)
**Branch**: `feat/w4-frontend-cutover`
**PR**: #8 (DRAFT — not merged)

---

## §1 Rollback Condition Triggers

Roll back immediately if any of the following occur **after merge + Railway deploy**:

1. **White screen / crash** on any existing page that was working before (dashboard, `/ideas`, `/runs`, `/portfolio`, `/quote`)
2. **TypeScript build error** in Railway CI — EXIT non-0 from `next build`
3. **New 500 errors** on routes that existed pre-merge (visible in Railway logs)
4. **Auth regression** — login page broken, session lost, JWT not accepted
5. **Order ticket malfunction** — portfolio `[SUBMIT 送單]` button behavior changed unexpectedly (not from W4, but monitor for layout breaks)
6. **Complete page data loss** — ideas/runs lists show empty when backend is healthy
7. **Critical JS error in console** on load of any pre-existing page

Do **NOT** roll back for:
- `[MOCK]` badge showing on K-line (expected when `NEXT_PUBLIC_USE_REAL_KBAR_API` not set)
- `[ERR→MOCK]` on bid/ask (expected when KGI gateway not running)
- `[CONTAINMENT]` notice on `/companies/[symbol]` (expected, hardcoded)
- `[LOCKED]` banner on `/companies/[symbol]` (expected, hardcoded)

---

## §2 Rollback Steps

### Step 1 — Create revert PR (< 5 min)

```bash
# Find the merge commit hash (shown in Railway deploy log / GitHub merge record)
MERGE_SHA=<sha-of-merge-commit>

# Create revert commit on a new branch
git checkout main
git pull origin main
git checkout -b revert/w4-frontend-cutover
git revert --no-edit $MERGE_SHA
git push origin revert/w4-frontend-cutover
gh pr create \
  --title "revert: W4 frontend cutover (emergency rollback)" \
  --body "Emergency revert of PR #8. Reason: [describe the issue]. Auto-revert commit."
```

### Step 2 — Fast-merge revert PR (< 2 min)

Elva or 楊董: `gh pr merge <revert-pr-number> --squash` (no waiting for review in emergency)

### Step 3 — Confirm Railway deploy

Watch Railway deploy log for:
- `next build` EXIT 0
- `Starting...` server up
- `GET /` 200 response

### Step 4 — Smoke test (< 3 min)

- `curl https://app.eycvector.com/` → 200
- `curl https://api.eycvector.com/health` → 200
- Open dashboard in browser — no white screen
- Open `/ideas` — list loads

---

## §3 Database / Contracts Impact

**NONE.**

This PR is frontend-only:
- No database migrations
- No schema changes
- No `packages/contracts` changes (HEAD remains `9957c91`)
- No `apps/api/src` changes

Rollback has zero data risk.

---

## §4 User-Visible Regression During Rollback

If rollback is executed:
- `/companies/[symbol]` disappears (new page removed) → users see 404
- `TopKpiStrip` disappears from dashboard → plain header
- `RightInspector` disappears from companies list → rows not clickable for drawer
- ⌘K ACTION items (timezone/interval) disappear → palette shows only nav items
- All pre-W4 pages continue to work normally

This is acceptable for an emergency rollback. The rollback is **not destructive to any data**.

---

## §5 ETA

| Phase | Time |
|-------|------|
| Detect issue + decision to roll back | 0-5 min (operator monitors Railway logs) |
| Create revert branch + PR | 3 min |
| Merge revert PR | 2 min |
| Railway deploy + health check | 3-5 min |
| **Total** | **< 10 min from decision to live** |

---

## §6 Contact / Decision Authority

- **Rollback decision**: Elva (autonomous if Red zone trigger met) or 楊董 (final authority)
- **Per Mission Command Mode v1.0**: Red zone → immediate rollback, no ACK needed
- **Overnight autonomy**: Rollback is a Red zone operation; Elva may execute autonomously if production is breaking
