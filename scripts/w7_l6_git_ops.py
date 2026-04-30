"""
W7 L6 — Git ops script for Bruce
Run from repo root: python scripts/w7_l6_git_ops.py

Actions:
1. git fetch origin
2. git checkout main && git pull
3. git checkout -b feat/w7-l6-radar-live-wire
4. git rm apps/web/components/content-drafts-queue.tsx   (F4)
5. git add all changed files
6. git commit
7. git push -u origin feat/w7-l6-radar-live-wire
8. gh pr create --draft

Bash tool is broken in Jason's agent; Bruce must run this.
"""
import subprocess
import sys
import os

REPO = r"C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP"

def run(cmd, **kwargs):
    print(f"\n$ {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=REPO, capture_output=True, text=True, **kwargs)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    if result.returncode != 0:
        print(f"ERROR: exit code {result.returncode}", file=sys.stderr)
        sys.exit(result.returncode)
    return result

def run_ok(cmd):
    """Run but don't fail on non-zero (for checks)."""
    result = subprocess.run(cmd, shell=True, cwd=REPO, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    return result

print("=== W7 L6 Git Ops ===")

# Step 1: fetch + checkout main + pull
run("git fetch origin")
run("git checkout main")
run("git pull origin main")

# Verify on 7a473ec or later
log = run("git log --oneline -1")
print(f"HEAD: {log.stdout.strip()}")

# Step 2: create branch
run("git checkout -b feat/w7-l6-radar-live-wire")

# Step 3: F4 — delete orphan component
run(r"git rm apps\web\components\content-drafts-queue.tsx")

# Step 4: stage all changed/new files
files = [
    r"apps\api\src\server.ts",
    r"apps\web\lib\radar-api.ts",
    r"apps\web\lib\radar-uncovered.ts",
    r"apps\api\src\__tests__\radar-live-wire.test.ts",
    r"evidence\w7_paper_sprint\l6_radar_live_wire_jason.md",
    r"scripts\w7_l6_git_ops.py",
]
for f in files:
    run(f"git add {f}")

# Step 5: commit
commit_msg = """feat(w7-l6): radar live-wire bundle (F1+F2+F3+F4)

F1: replace 7 mockOnly() calls in radar-api.ts with real fetch
    - company: fetch all companies, filter by symbol client-side
    - ideasByRun: GET /api/v1/strategy/runs/:id/ideas
    - opsActivity: GET /api/v1/ops/activity
    - brief/review/weeklyPlan: GET /api/v1/plans/{brief,review,weekly}
    - previewOrder: POST /api/v1/paper/orders/preview
    - killMode: KEPT mockOnly (HARD LINE - kill-switch ARMED state machine)

F2: server.ts plans handlers compose pass
    - BriefBundle.market: composeTaiwanMarketState() from UTC wall-clock
    - BriefBundle.topThemes: listThemes() + backendThemeToRadar() mapper
    - BriefBundle.ideasOpen: getStrategyIdeas(limit=10) + RADAR Idea mapper
    - BriefBundle.watchlist: typed empty [] (no backing table)
    - BriefBundle.riskTodayLimits: getRiskLimitState() → 3 RADAR RiskLimit rows
    - ActivityEvent: removed non-spec actor/detail; added required summary field
    - ReviewBundle/WeeklyPlan: typed arrays (ExecutionEvent[], SignalChannel, etc)

F3: GET /api/v1/reviews/log (new route)
    - Returns ReviewLogItem[] from listAuditLogEntries adapter
    - radar-uncovered.ts reviewLog() now calls correct endpoint

F4: deleted apps/web/components/content-drafts-queue.tsx (0 importers)

Tests: 8 new unit tests T1-T8 in radar-live-wire.test.ts

Hard lines: /order/create 409 untouched | kill-switch ARMED untouched |
            no KGI SDK import | no mutation in GET handlers |
            no migration 0017 | no secret_inventory changes

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"""

# Write commit msg to temp file to avoid shell escaping issues
msg_file = os.path.join(REPO, "scripts", "_w7l6_commit_msg.txt")
with open(msg_file, "w", encoding="utf-8") as f:
    f.write(commit_msg)

run(f'git commit -F scripts/_w7l6_commit_msg.txt')

# Clean up temp file
os.remove(msg_file)

# Step 6: push
run("git push -u origin feat/w7-l6-radar-live-wire")

# Step 7: create DRAFT PR
pr_body = """## Summary

- **F1**: Replaced 7 `mockOnly()` wrappers in `radar-api.ts` with real `get<T>()`/`post<T>()` fetch calls; `killMode` kept `mockOnly` per hard line (kill-switch ARMED state machine)
- **F2**: `/api/v1/plans/brief` now composes a full `BriefBundle` with `MarketState` (wall-clock derived), `topThemes` (mapped from DB themes), `ideasOpen` (mapped from strategy ideas), typed `watchlist`/`riskTodayLimits`; `ActivityEvent.summary` field added, `actor`/`detail` removed; `ReviewBundle`/`WeeklyPlan` typed arrays
- **F3**: New `GET /api/v1/reviews/log` route returning `ReviewLogItem[]`; `radar-uncovered.ts` `reviewLog()` re-pointed from wrong `/openalice/jobs` path
- **F4**: Deleted orphan `content-drafts-queue.tsx` (0 importers confirmed by monorepo grep)

## Hard Line Audit

| Line | Status |
|------|--------|
| `/order/create` 409 not touched | PASS |
| kill-switch ARMED state machine not touched | PASS — `killMode` kept `mockOnly` |
| no KGI SDK import in apps/api | PASS |
| all handlers read-only (no mutation) | PASS |
| no migration 0017 | PASS |
| no `secret_inventory.md` / Cat-D changes | PASS |

## Test plan

- [ ] `node --test --import tsx/esm apps/api/src/__tests__/radar-live-wire.test.ts` — 8 tests T1-T8
- [ ] `pnpm --filter @iuf-trading-room/api typecheck` GREEN
- [ ] `pnpm --filter @iuf-trading-room/web typecheck` GREEN
- [ ] `pnpm --filter @iuf-trading-room/api build` GREEN
- [ ] Smoke: `GET /api/v1/plans/brief` returns object with `market.state` string and `topThemes` array
- [ ] Smoke: `GET /api/v1/reviews/log` returns `{ data: [] }` (empty if no audit logs)
- [ ] Smoke: `GET /api/v1/ops/activity` returns `{ data: [{...summary: string}] }` (no actor/detail)

## Follow-up (not in this PR)

- `watchlist` is empty `[]` — no backing table; needs future migration
- `futuresNight.last` / `usMarket.last` are `0` — need KGI futures quote integration
- `previewOrder` backend shape (`SubmitOrderResult`) differs from RADAR `OrderPreview` — shape adapter tracked
- `killMode` wiring to backend needs operator-gate design review

Evidence: `evidence/w7_paper_sprint/l6_radar_live_wire_jason.md`

Generated by Jason (backend-strategy agent) — DRAFT, awaiting Bruce/Pete review.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"""

pr_body_file = os.path.join(REPO, "scripts", "_w7l6_pr_body.txt")
with open(pr_body_file, "w", encoding="utf-8") as f:
    f.write(pr_body)

run(f'gh pr create --draft --base main --title "feat(w7-l6): radar live-wire bundle (F1+F2+F3+F4)" --body-file scripts/_w7l6_pr_body.txt')

os.remove(pr_body_file)

print("\n=== W7 L6 Git Ops COMPLETE ===")
print("PR created as DRAFT. Bruce/Pete review next.")
print("Run typecheck + tests before marking ready.")
