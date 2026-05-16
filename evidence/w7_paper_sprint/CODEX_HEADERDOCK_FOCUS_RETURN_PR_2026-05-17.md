# HeaderDock Focus Return PR Evidence - 2026-05-17 00:00 Cycle

## Scope
- Frontend-only polish for `apps/web/components/header-dock.tsx`.
- HeaderDock drawer now focuses the close button when the notification or system drawer opens.
- Escape, scrim click, and close button close the drawer through one path and return focus to the bell/system trigger.

## Safety
- No API contract, broker/risk, Lab, shared-contract, or backend code touched.
- No KGI live broker write, real-order path promotion, `PAPER_LIVE` promotion, secrets, or OpenAlice source.
- Existing tactical ASCII/CRT/amber homepage layout preserved.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

## Browser Smoke
- Local mock notifications API on `127.0.0.1:3115`.
- Next dev server on `127.0.0.1:3053`.
- Authenticated `/briefs` smoke with `iuf_session=local-smoke-session`.
- Checks:
  - Notification drawer opens and focuses the `關閉` button.
  - Escape closes notification drawer and returns focus to the bell trigger.
  - System drawer opens and focuses the `關閉` button.
  - Escape closes system drawer and returns focus to the system trigger.
  - Notification drawer still loads mock data; bell status: `警示通知，1 則未讀`.
  - First notification `aria-label`: `未讀 warning 風控警示 RISK 05/17 00:00 SIM preview risk check needs review.`
  - Console errors: 0.
  - Page errors: 0.
  - Failed non-favicon responses: 0.
- Screenshot: `evidence/w7_paper_sprint/headerdock-focus-return-1366x900.png`

## Residual Notes
- Dev server still emits the existing Sentry/OpenTelemetry critical-dependency warning during instrumentation compile; it did not surface as a browser console/page error and is not introduced by this change.
- Production owner-session QA still requires the deployed authenticated environment.
