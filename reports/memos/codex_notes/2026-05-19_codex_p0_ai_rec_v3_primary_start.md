# 2026-05-19 03:05 TST - Codex P0 AI recommendations v3 primary sync

## Latest merged state
- `origin/main` is at `1951849` after PR #716 clarified Strategy Lanes truth states.
- PR #716 CI passed, web deploy completed, and production `/admin/strategies` desktop/mobile smoke passed after deploy.
- Production API `/health` is 200.

## Open PRs / team progress
- GitHub open PR list was empty at cycle start.
- Bruce/Jason earlier unblocked production migrations; owner cookie verification now shows `/api/v1/ai-recommendations/v3` returns 5 items.

## Blocked items / owners
- `/api/v1/recommendations/today` still returns 4 legacy/research-style items. Owner: Elva/Jason if they want the legacy endpoint to become the final AI recommendations contract.
- The frontend can safely consume the live v3 endpoint without inventing data.

## Chosen frontend-safe task
- Promote the existing live v3 5-item recommendation result into the primary `/ai-recommendations` product surface and remove English fallback wording from the visible v3 cards.
- Scope is `apps/web` only.
- Acceptance:
  - `/ai-recommendations` visibly surfaces at least 5 v3-backed cards when v3 is live.
  - Entry, stop, TP1/TP2, reason/risk/data quality remain source-backed; missing narrative is labeled as degraded research context, not hidden or faked.
  - No strategy ideas are invented or promoted as final AI recommendations.

## Hardlines
- No fake fifth stock.
- No backend migration/API changes.
- No real-order path promotion.
- SIM-only and research-candidate caveats remain visible.
