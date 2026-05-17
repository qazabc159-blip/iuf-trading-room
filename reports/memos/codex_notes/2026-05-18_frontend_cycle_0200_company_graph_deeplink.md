# 2026-05-18 Frontend cycle 0200 - Company graph deep link

Owner: Codex frontend (`apps/web`)
Scope: `/companies?tab=graph` and company detail My-TW-Coverage visibility

## Latest merged state

- `origin/main` is at `7bea36e` (`fix(web): localize market heatmap industries`, PR #648).
- Recent relevant merged work:
  - `#648` fixed `/market-intel` heatmap industry label localization and client refresh heatmap shape handling.
  - `#647` added migration fail-fast verification; deploy is blocked because GitHub Actions lacks owner seed credentials.
  - `#642` activated `/companies?tab=graph`.
  - `d76e680` fixed the company page left-column blank gap.
  - `40db79e` added company detail Coverage knowledge and industry graph panels.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest deploys for `650cd77` and `7bea36e` failed in the API post-deploy migration verification step.
- Failure is not frontend build: deploy log says `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` are not set in GitHub Actions.

## Blocked items and owners

- Production deploy verification is blocked by Jason / repo admin until Actions secrets or an approved migration verification path are fixed.
- Heatmap stock universe and KGI/TWSE fallback semantics remain Elva/Jason/API-owned.
- Frontend can safely keep improving visible My-TW-Coverage navigation and URL state without touching API or broker paths.

## Chosen frontend-safe task

Make the company graph usable as a deep-link target:

- `/companies?tab=graph&q=2330` should prefill the graph search box and run the existing search endpoint.
- Company detail's My-TW-Coverage knowledge panel should expose a clear link to the full graph search for the current ticker.
- Company detail Coverage/Industry mini-graph client fetches should use the configured API base instead of the frontend origin, so existing backend coverage endpoints can actually hydrate the panels.
- Keep all behavior honest: no fake graph data, no backend changes, no vendor homepage rewrite.
