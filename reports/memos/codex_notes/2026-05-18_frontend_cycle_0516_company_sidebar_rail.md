# 2026-05-18 Frontend cycle 0516 - Company sidebar rail

Owner: Codex frontend (`apps/web`)
Scope: `/companies/[symbol]` company detail long-page scanability

## Latest merged state

- `origin/main` is at `7b49a3b` (`fix(web): clarify industry graph error state`, PR #654).
- Recent frontend fixes:
  - `#654` made the company detail industry graph distinguish coverage fetch failures from coverage-not-found states.
  - `#653` moved My-TW-Coverage knowledge panels into the main company detail work area.
  - `#652` localized company graph labels.
  - `#651` localized AI recommendation quality/source labels.
  - `#650` hardened company coverage panels against partial data.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest `main` validate for `7b49a3b` is green.
- No Elva/Jason/Jim/Bruce PR is currently waiting on frontend review from this worktree.

## Blocked items and owners

- Production deploy verification remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
- Heatmap universe/KGI fallback semantics remain Elva/Jason/API-owned; this cycle does not touch heatmap data code.

## Chosen frontend-safe task

Reduce the company detail page's perceived right-side blank space and improve long-page scanability:

- Make the desktop right sidebar behave as a sticky rail instead of disappearing above the fold while the main column continues.
- Add a small page index panel in the sidebar with anchors to:
  - My-TW-Coverage
  - Data dock
  - Full-profile datasets
  - Data source status
- Add stable section ids to the existing company detail bands.

This is frontend-only and does not touch API implementation, broker/risk/contracts, live order paths, secrets, heatmap data, or the vendor tactical homepage.
