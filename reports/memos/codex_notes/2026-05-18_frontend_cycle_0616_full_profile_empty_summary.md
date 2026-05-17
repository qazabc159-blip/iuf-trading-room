# 2026-05-18 Frontend cycle 0616 - Full-profile empty summary

Owner: Codex frontend (`apps/web`)
Scope: `/companies/[symbol]` full-profile empty-state density

## Latest merged state

- `origin/main` is at `0299dbb` (`fix(web): add company sidebar rail`, PR #655).
- Recent frontend fixes:
  - `#655` added a desktop sticky page index rail for company detail.
  - `#654` made the company detail industry graph distinguish coverage fetch failures from coverage-not-found states.
  - `#653` moved My-TW-Coverage knowledge panels into the main company detail work area.
  - `#652` localized company graph labels.
  - `#651` localized AI recommendation quality/source labels.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest `main` validate for `0299dbb` is green.
- No Elva/Jason/Jim/Bruce PR is currently waiting on frontend review from this worktree.

## Blocked items and owners

- Production deploy verification remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
- Heatmap universe/KGI fallback semantics remain Elva/Jason/API-owned; this cycle does not touch heatmap data code.

## Chosen frontend-safe task

Reduce the company detail full-profile section's "long page of empty cards" problem:

- When all full-profile datasets `[06]-[10]` are non-live and non-stale, render one compact status summary instead of five large empty panels.
- Keep announcements `[11]` visible separately because it is fetched independently and may still contain live items.
- Preserve honest source/status wording and do not fabricate data.

This is frontend-only and does not touch API implementation, broker/risk/contracts, live order paths, secrets, heatmap data, or the vendor tactical homepage.
