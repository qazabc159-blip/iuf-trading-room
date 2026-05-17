# 2026-05-18 Frontend cycle 0246 - Coverage partial data hardening

Owner: Codex frontend (`apps/web`)

## Latest merged state

- `origin/main` is at `e880c54` (`fix(web): deeplink company graph search`, PR #649).
- Recent frontend fixes:
  - `#649` made `/companies?tab=graph&q=...` deeplinkable and added company-detail graph CTA.
  - `#648` localized market heatmap industry labels.
  - `#643` fixed the company page left-column blank gap.
  - `#642` activated the company graph tab.
  - `#640` added CoverageKnowledgePanel and IndustryGraphPanel.

## Open PRs / team progress

- `gh pr list` currently shows no open PRs.
- Latest PR #649 CI is green and merged.
- Latest deploy attempts are still blocked before production verification by missing `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` in GitHub Actions.
- Elva's explicitly referenced `reports/codex_notes/2026-05-17_elva_to_codex_unblock_and_priorities.md` still is not present in this worktree; I am using merged PRs and recent `reports/memos/codex_notes/` as source of truth.

## Blocked items and owners

- Production deploy verification: Jason / repo admin must provide the owner seed secrets or approved non-secret verification path.
- Heatmap stock universe and KGI/TWSE fallback semantics remain Elva/Jason/API-owned.
- Frontend can safely harden company detail panels against partial My-TW-Coverage payloads.

## Chosen frontend-safe task

Make company detail My-TW-Coverage panels fail-soft when the coverage payload is partial:

- Normalize missing `supplyChain`, `majorCustomers`, `majorSuppliers`, `wikilinks`, and text fields before rendering.
- Reuse the same normalized helper for CoverageKnowledgePanel and IndustryGraphPanel.
- Add focused tests so partial coverage data cannot crash the company page or mini graph.
- Keep this frontend-only; no backend, broker, risk, contract, or homepage layout changes.
