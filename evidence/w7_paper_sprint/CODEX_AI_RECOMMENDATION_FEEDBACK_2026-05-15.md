# CODEX AI Recommendation Feedback - 2026-05-15

Owner: Frontend Codex
Branch: `feat/web-ai-recommendation-feedback-2026-05-15`
Scope: `apps/web`

## Why

Day 2-3 spec includes `POST /api/v1/recommendations/:id/feedback`, but `/ai-recommendations` cards only displayed recommendation data and the portfolio handoff. Users had no way to mark a recommendation useful, skipped, rejected, or acted.

## Change

- Added a same-origin Next.js proxy route:
  - `POST /api/recommendations/:id/feedback`
  - validates allowed reactions
  - forwards session cookies and workspace slug
  - proxies to `/api/v1/recommendations/:id/feedback`
- Added compact card-level feedback controls:
  - `有幫助`
  - `不採用`
  - `略過`
  - `已帶單`
- Added pending, saved, and failed states with `aria-live`.
- Kept portfolio handoff unchanged.

## Safety

- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE`.
- No apps/api broker/risk/contracts edits.
- No OpenAlice import/fork.

## Known Backend Blocker

Source review found that `POST /api/v1/recommendations/:id/feedback` still validates recommendation existence with `getMockRecommendationById(id)` only. After #517, real recommendation IDs from Athena synthesis may fail feedback POST with 404 even though GET `/today` and GET `/:id` can resolve them.

Owner: Jason

Frontend behavior: the UI does not pretend success. It shows `回饋尚未寫入` when the proxy/upstream does not return 2xx.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- `git diff --check` — PASS
- Static safety scan for live-order/secrets wording in touched web files — PASS
- HTTP smoke:
  - `POST /api/recommendations/rec_test_20260515/feedback` with invalid reaction returns 400 `BAD_REACTION`
  - `POST /api/recommendations/bad%2Fid/feedback` returns 400 `BAD_RECOMMENDATION_ID`
- Browser smoke on `http://127.0.0.1:3021/ai-recommendations` with `iuf_session` cookie — PASS for page render:
  - status 200
  - one `h1`
  - 5 bucket tiles
  - 5 empty-state panels
  - no console errors
  - no page errors

Screenshot: `evidence/w7_paper_sprint/CODEX_AI_RECOMMENDATION_FEEDBACK_2026-05-15.png`

## Residual Risk

The local API path returned an empty/syncing recommendation set during this smoke, so card-level feedback buttons were typechecked but not browser-clicked against a real recommendation. The frontend proxy is bounded and fails closed; live success needs Jason's backend feedback lookup fix for real recommendation IDs.
