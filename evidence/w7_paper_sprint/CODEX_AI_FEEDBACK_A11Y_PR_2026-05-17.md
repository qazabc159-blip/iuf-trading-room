# CODEX AI Feedback Accessibility PR - 2026-05-17

## Scope
- Branch: `fix/web-ai-feedback-a11y-pr-2026-05-17`
- Base: `origin/main` at `e18df17` (`fix(web): clarify ai detail data quality (#583)`)
- Frontend-owned change only: `apps/web/app/ai-recommendations/RecommendationFeedbackActions.tsx`
- No API, broker, risk, contract, or order-path changes.

## Shipped
- Added `aria-pressed` to AI recommendation feedback buttons so selected reaction state is exposed beyond visual styling.
- Added button `aria-label` values such as `送出推薦回饋：有幫助`.
- Connected the feedback button group to the live status message with `aria-describedby`.
- Added `role="status"`, `aria-atomic="true"`, and root `aria-busy` for feedback save state.
- Added a `data-reaction` attribute for the selected reaction so QA can assert the control state directly.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline` - pass
- `pnpm.cmd --filter @iuf-trading-room/contracts build` - pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - pass

## Browser Smoke
- Dev server: `http://127.0.0.1:3069`
- Target: `/ai-recommendations/REC-FB`
- Backend handling: local smoke stub served `/api/v1/recommendations/REC-FB` and accepted `POST /api/v1/recommendations/REC-FB/feedback`; no backend source changed.
- Viewport: `1366x900`
- Assertions:
  - Feedback group `aria-describedby` points to the status element id.
  - `有幫助` button starts with `aria-pressed="false"`.
  - After click, `有幫助` button has `aria-pressed="true"`.
  - Button aria label is `送出推薦回饋：有幫助`.
  - Feedback root has `data-status="saved"` and `data-reaction="like"`.
  - Feedback root has `aria-busy="false"` after save.
  - Live status text is `已記錄：有幫助`.
  - Handoff title still includes `SIM 預覽` and `不會建立券商委託`.
  - Browser console errors/warnings: `0`.
  - Page errors: `0`.
  - Failed requests: `0`.
  - HTTP 4xx/5xx responses: `0`.

## Artifact
- Screenshot: `evidence/w7_paper_sprint/ai-feedback-a11y-1366x900.png`
