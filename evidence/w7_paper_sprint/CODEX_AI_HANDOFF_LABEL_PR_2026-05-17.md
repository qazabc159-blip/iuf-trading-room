# AI Handoff Label PR Evidence - 2026-05-17 00:32 Cycle

## Scope
- Frontend-only polish for `apps/web/app/ai-recommendations/RecommendationHandoffLink.tsx`.
- AI recommendation handoff links now expose an `aria-label` and `title` that say the action opens a SIM preview, not a formal broker order.
- The label includes ticker, entry, stop, target, and recommendation id when those prefill params are present.

## Safety
- No API contract, broker/risk, Lab, shared-contract, or backend code touched.
- No KGI live broker write, real-order path promotion, `PAPER_LIVE` promotion, secrets, or OpenAlice source.
- Existing tactical ASCII/CRT/amber homepage layout preserved.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

## Browser Smoke
- Local mock recommendations API on `127.0.0.1:3116`.
- Next dev server on `127.0.0.1:3054`.
- Authenticated `/ai-recommendations` smoke with `iuf_session=local-smoke-session`.
- Checks:
  - Handoff link `aria-label` includes `SIM 預覽`.
  - Handoff link `aria-label` includes `不送正式券商委託`.
  - Handoff link label includes ticker `2330`, entry `620`, stop `590`, target `660`, and `rec_2330_20260517`.
  - Handoff link `title` matches `aria-label`.
  - Handoff `href` preserves `/portfolio?ticker=2330&prefill=true&from_rec=rec_2330_20260517&entry=620&stop=590&tp=660`.
  - Console errors: 0.
  - Page errors: 0.
  - Failed non-favicon responses: 0.
- Screenshot: `evidence/w7_paper_sprint/ai-handoff-label-1366x900.png`

## Residual Notes
- Dev server still emits the existing Sentry/OpenTelemetry critical-dependency warning during instrumentation compile; it did not surface as a browser console/page error and is not introduced by this change.
- Production owner-session QA still requires the deployed authenticated environment.
