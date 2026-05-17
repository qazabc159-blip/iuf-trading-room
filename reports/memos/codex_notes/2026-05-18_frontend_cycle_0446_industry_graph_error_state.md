# 2026-05-18 Frontend cycle 0446 - Industry graph error state

Owner: Codex frontend (`apps/web`)
Scope: `/companies/[symbol]` company detail My-TW-Coverage graph error/empty state

## Latest merged state

- `origin/main` is at `8726331` (`fix(web): surface company detail knowledge graph`, PR #653).
- Recent frontend fixes:
  - `#653` moved the company detail My-TW-Coverage knowledge graph into the main company detail work area.
  - `#652` localized company graph labels and hardened malformed graph payloads.
  - `#651` localized AI recommendation quality/source labels.
  - `#650` hardened company coverage panels against partial payloads.
  - `#649` made `/companies?tab=graph&q=...` deep-linkable.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest frontend PRs have merged with green validate checks.
- No Elva/Jason/Jim/Bruce PR is currently waiting on frontend review from this worktree.

## Blocked items and owners

- Production deploy verification remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
- Heatmap universe/KGI fallback semantics remain Elva/Jason/API-owned; this cycle does not touch heatmap data code.

## Chosen frontend-safe task

Make the company detail `IndustryGraphPanel` distinguish a temporary My-TW-Coverage fetch failure from a real "coverage not yet available" state.

Why this task:

- The panel currently catches coverage fetch errors and converts them to `null`.
- That makes an API outage render like "coverage 待補", which is misleading and feels like a data-quality problem.
- The fix is frontend-only: add an explicit error state, show clear Traditional Chinese copy, keep the graph/search CTA visible, and avoid blank space or false "待補" wording.

This cycle will not touch API implementation, broker/risk/contracts, live-order paths, secrets, or the vendor tactical homepage.
