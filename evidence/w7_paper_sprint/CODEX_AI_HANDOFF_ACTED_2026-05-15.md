# CODEX AI Handoff Acted Feedback - 2026-05-15

Owner: Frontend Codex
Branch: `fix/web-ai-handoff-records-acted-2026-05-15`
Scope: `apps/web`

## Why

After #522, `/ai-recommendations` had feedback controls, including an explicit `已帶單` button. The primary user path, however, is the CTA `一鍵帶到交易室`. Clicking that CTA navigated to `/portfolio` but did not automatically record `reaction: "acted"`.

That made the product funnel lossy: a user could act on a recommendation without the Recommendation Orchestrator receiving the acted feedback event.

## Change

- Added `RecommendationHandoffLink`.
- The CTA still navigates normally to `/portfolio?...`.
- On normal left-click, it fire-and-forget records:
  - `POST /api/recommendations/:id/feedback`
  - body `{ "reaction": "acted" }`
- Uses `navigator.sendBeacon` first, then `fetch(..., keepalive: true)` fallback.
- Does not block handoff navigation if feedback telemetry fails.
- Modified-clicks / new-tab opens are left untouched.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- `git diff --check` — PASS
- Browser smoke with a fake #517/#523-shaped recommendation API — PASS:
  - `/ai-recommendations` rendered 1 card.
  - CTA href: `/portfolio?ticker=2330&prefill=true&from_rec=rec_test_handoff_20260515&entry=920-940&stop=880&tp=980`
  - CTA click issued `POST /api/recommendations/rec_test_handoff_20260515/feedback`.
  - Fallback fetch payload confirmed as `{ "reaction": "acted" }`.
  - Feedback proxy response status 200.
  - Browser navigated to `/portfolio?...`.
  - Final iframe src preserved all handoff params.
  - No page errors.

Screenshot: `evidence/w7_paper_sprint/CODEX_AI_HANDOFF_ACTED_2026-05-15.png`

## Note

The local fake API did not implement paper/portfolio backend endpoints, so the portfolio iframe emitted expected 404 console noise after navigation. This is not caused by the handoff change; it is a limitation of the fake smoke server used to verify the AI recommendation chain.

## Safety

- No KGI live broker write.
- No real-order path promotion.
- No default live execution mode.
- No `PAPER_LIVE` promotion.
- No apps/api broker/risk/contracts edits.
- No OpenAlice import/fork.
