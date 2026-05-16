# HeaderDock Bell A11y PR Evidence - 2026-05-16 23:28 Cycle

## Scope
- Frontend-only polish for `apps/web/components/header-dock.tsx`.
- HeaderDock bell now exposes a screen-reader status string for notification loading/error/unread/empty state.
- Unread badge is visual-only after the bell describes unread count.
- Notification drawer items now expose an `aria-label` with read state, severity, title, category/time, and summary.

## Safety
- No API contract, broker/risk, Lab, shared-contract, or backend code touched.
- No KGI live broker write, real-order path promotion, `PAPER_LIVE` promotion, secrets, or OpenAlice source.
- Existing tactical ASCII/CRT/amber homepage layout preserved.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

## Browser Smoke
- Local mock notifications API on `127.0.0.1:3114`.
- Next dev server on `127.0.0.1:3052`.
- Authenticated `/briefs` smoke with `iuf_session=local-smoke-session`.
- Checks:
  - HeaderDock visible.
  - Bell described unread state: `警示通知，1 則未讀`.
  - Bell `aria-busy` clears after ready state.
  - Badge has `aria-hidden="true"`.
  - First notification `aria-label`: `未讀 warning 風控警示 RISK 05/16 23:28 SIM preview risk check needs review.`
  - Console errors: 0.
  - Page errors: 0.
  - Failed non-favicon responses: 0.
- Screenshot: `evidence/w7_paper_sprint/headerdock-bell-a11y-1366x900.png`

## Residual Notes
- Dev server still emits the existing Sentry/OpenTelemetry critical-dependency warning during instrumentation compile; it did not surface as a browser console/page error and is not introduced by this change.
- Production owner-session QA still requires the deployed authenticated environment.
