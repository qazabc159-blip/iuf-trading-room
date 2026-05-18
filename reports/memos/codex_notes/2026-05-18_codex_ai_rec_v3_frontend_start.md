# 2026-05-18 Codex Sync - AI Recommendations v3 Frontend Wiring

Latest merged state:
- `origin/main` includes PR #698 route aliases, #699 portfolio snapshot read routes, #700 heatmap Chinese labels, #701 migration audit cleanup, and #702 portfolio snapshot state copy.
- Prod API health is 200.

Open PRs / team progress:
- #703 is the Elva/Jason/Mike backend gate for `/api/v1/ai-recommendations/v3`; it is mergeable, W6/Secret pass, and validate is queued behind main validation.

Blocked items and owners:
- v3 production availability is owned by Elva/Jason/Mike/Bruce via #703 deploy plus Railway migration count timing.
- Frontend must not fake v3 data while #703 is pending.

Chosen frontend-safe task:
- Wire `/ai-recommendations` SOP v3 panel to attempt `GET /api/v1/ai-recommendations/v3` and render either real v3 cards or a formal endpoint/owner/next-action pending state.
- Keep the existing v1 recommendation list intact and do not mock or pad data.
