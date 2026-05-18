# CODEX EventLog Empty State PR - 2026-05-18

## Scope

P0-10 EventLog truth-state cleanup. This PR only changes `apps/web/app/admin/events/page.tsx` and adds evidence. It does not modify backend EventLog schema, migrations, broker/risk code, KGI paths, or live-order behavior.

## Root Cause

Production `/event-log` was not blank, but when owner-only endpoints returned 401 it showed only:

- `0` streams
- `資料同步中`
- `請選擇事件流`

That was misleading because the real state is auth/session blocked, not normal syncing.

## Shipped

- Added explicit EventLog blocked and empty state cards.
- Shows the real endpoints:
  - `GET /api/v1/event-streams`
  - `GET /api/v1/admin/event-log/outbox/diag`
- Shows owner: `Elva/Jason + Bruce owner-session verify`.
- Shows next action: owner-session verification first; if still 401/500, inspect Phase A auth, migrations, and outbox worker.
- States that frontend does not fill fake events or present syncing as healthy data.

## Verification

- `pnpm.cmd install --offline --frozen-lockfile`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `git diff --check`
- Local Playwright smoke on `http://localhost:3118/event-log`:
  - desktop 1366x900
  - mobile 390x844
  - endpoint text visible
  - owner text visible
  - next-action text visible
  - no-fake-event copy visible
  - no page errors

## Evidence

- Before production smoke: `prod-event-log-before-smoke.json`
- After local smoke: `local-event-log-after-smoke.json`
- Screenshots: `screens/local-event-log-desktop-after.png`, `screens/local-event-log-mobile-after.png`

## Pending

Production after-merge smoke is required once deployed. Actual owner-session data verification remains Bruce/Elva-owned; this PR makes blocked/empty states honest.
