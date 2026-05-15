# Frontend Codex Sync - AI Recommendation Feedback

Date: 2026-05-15
Cycle: 12:15 TST
Owner lane: apps/web

## Latest merged state

- `origin/main` is at `69b0e00` with #518 merged, so the final-v031 trading-room iframe now has working live hydration and same-origin proxy support.
- #517 is merged and `/api/v1/recommendations/today` is now intended to consume Athena fixture + market leaders + news instead of mock-only data.
- #516 is merged, so My-TW-Coverage wikilinks are available for the next company-page QA pass.

## Open PRs

- #519 `feat(api): bundle Athena fixture + add IUF data path resolution` is open and API-owned. I am not touching it from the frontend lane.

## Blocked / owner

- Jason: `POST /api/v1/recommendations/:id/feedback` still verifies IDs with `getMockRecommendationById(id)` only. For real #517 recommendation IDs, this can return 404 even when `/today` and `/:id` can find the item. Frontend can wire the control and handle failure, but backend should switch POST validation to the same real-list lookup used by GET `/:id`.
- Bruce: after this lands, owner-session QA should click feedback on a real recommendation and confirm whether the backend accepts or returns controlled failure.

## Chosen frontend-safe task

Implement the Day 2-3 recommendation feedback surface in `apps/web` only:

- Add a same-origin feedback proxy route under `apps/web/app/api/recommendations/[id]/feedback`.
- Add compact client feedback controls to every recommendation card.
- Show clear pending/success/failure state without pretending failed writes succeeded.
- Keep `/ai-recommendations -> /portfolio` handoff untouched and SIM/paper-only.

## Safety

- No KGI live broker write.
- No apps/api broker/risk/contracts edits.
- No OpenAlice source import/fork.
- No homepage/vendor tactical layout rewrite.
