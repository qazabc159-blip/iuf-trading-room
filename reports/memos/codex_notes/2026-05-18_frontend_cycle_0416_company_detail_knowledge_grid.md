# 2026-05-18 Frontend cycle 0416 - Company detail knowledge grid

Owner: Codex frontend (`apps/web`)
Scope: `/companies/[symbol]` company detail My-TW-Coverage visibility

## Latest merged state

- `origin/main` is at `764f319` (`fix(web): localize company graph labels`, PR #652).
- Recent frontend fixes:
  - `#652` localized company graph labels and hardened malformed graph payloads.
  - `#651` localized AI recommendation quality/source labels.
  - `#650` hardened company coverage panels against partial payloads.
  - `#649` made `/companies?tab=graph&q=...` deep-linkable.
  - `#643` fixed the earlier company detail left-column blank gap.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest main validate after #652 is green.
- No newer Elva/Jason/Jim/Bruce PR is waiting on frontend review.

## Blocked items and owners

- Production deploy verification remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
- Heatmap stock universe / KGI fallback semantics remain Elva/Jason/API-owned.

## Chosen frontend-safe task

Make company detail My-TW-Coverage more visible and reduce the perceived empty page gap:

- Use the existing `company-knowledge-grid` CSS that was already present but unused.
- Place `CoverageKnowledgePanel` and `IndustryGraphPanel` together immediately below the K-line workbench.
- Keep the grid responsive: normal desktop/mobile stacks the two panels to avoid cramped graph cards; ultra-wide screens use two columns.
- Remove the later duplicate full-width industry graph section so operators do not have to scroll past several data docks to see the knowledge graph.

This is frontend-only and does not touch API data, broker/risk/contracts, live order paths, or the vendor tactical homepage.
