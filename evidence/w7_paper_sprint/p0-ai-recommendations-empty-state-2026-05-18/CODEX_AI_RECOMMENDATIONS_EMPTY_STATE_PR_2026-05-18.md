# CODEX_AI_RECOMMENDATIONS_EMPTY_STATE_PR_2026-05-18

## Scope

- Route: `/ai-recommendations`
- Goal: remove stale blocked-state copy and avoid filling the recommendation page with repeated large empty bucket panels when the current session cannot read recommendation endpoints.

## Shipped

- Replaced stale v3 next-action copy that referenced the already-merged `#703`.
- Kept the v3 state honest:
  - endpoint: `GET /api/v1/ai-recommendations/v3`
  - owner: Elva/Jason + Bruce owner-session verify
  - next action: verify owner-session/API response or trigger v3 refresh
- Added a single product-grade empty state for the primary recommendation list when `GET /api/v1/recommendations/today` returns no visible items or the current session is blocked.
- Removed the repeated five-section "no target" surface for 0-item sessions.
- Explicitly says the frontend does not pad fake stocks and does not treat strategy ideas as AI recommendations.

## Verified

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- app/ai-recommendations/v3-view.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `git diff --check`
- Local browser smoke against `http://localhost:3116/ai-recommendations?codexAiRecSmoke=2`, connected to production API:
  - desktop `1366x900`: status 200, no stale `#703`, no legacy repeated empty bucket phrase, endpoint/no-fake copy present
  - mobile `390x844`: status 200, no stale `#703`, no legacy repeated empty bucket phrase, endpoint/no-fake copy present

## Evidence

- `screens/local-ai-recommendations-desktop-after.png`
- `screens/local-ai-recommendations-mobile-after.png`
- `local-ai-recommendations-after-smoke.json`
- Prior route smoke: `../p0-route-smoke-2026-05-18/prod-p0-route-smoke.json`

## Remaining

- This does not manufacture five recommendations. Real recommendation population still requires owner-session backend verification and/or v3 refresh by Elva/Jason/Bruce.
- No broker/risk/KGI write paths touched.
