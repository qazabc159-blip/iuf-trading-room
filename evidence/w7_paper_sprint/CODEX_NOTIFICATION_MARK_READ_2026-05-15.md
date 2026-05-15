# CODEX_NOTIFICATION_MARK_READ_2026-05-15

## Scope
- Frontend owner lane: `apps/web`.
- Day 6 notification center follow-up after Jason real notifications endpoint.
- Goal: when a user clicks a HeaderDock notification, the frontend should call the existing mark-read contract and update the local unread badge immediately.

## Changes
- Added same-origin web proxy:
  - `POST /api/header-dock/notifications/:id/mark-read`
  - Forwards to `POST /api/v1/notifications/:id/mark-read`
  - Preserves cookie + `x-workspace-slug`
  - Returns upstream `204` cleanly
- Added `markHeaderDockNotificationRead(id)` helper in `apps/web/lib/api.ts`.
- Updated `HeaderDock` notification click:
  - optimistic local `readAt` update
  - unread badge decrements immediately
  - fire-and-forget mark-read call
  - reloads drawer data if mark-read fails

## Verification
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` => PASS
- `git diff --check` => PASS
- Safety scan over touched files:
  - no KGI SIM order endpoint
  - no paper submit endpoint
  - no `PAPER_LIVE`
  - no `executionMode`
  - no secret/token patterns
- Browser smoke with local fake notifications API:
  - bell drawer loaded `GET /api/header-dock/notifications?limit=50`
  - badge before click: `2`
  - clicked first notification
  - frontend called `POST /api/header-dock/notifications/audit-test-1/mark-read`
  - proxy forwarded upstream to `/api/v1/notifications/audit-test-1/mark-read`
  - mark-read response: `204`
  - badge after click: `1`
  - browser console errors: 0
  - no KGI SIM / paper submit requests

## Screenshot
- `evidence/w7_paper_sprint/CODEX_NOTIFICATION_MARK_READ_2026-05-15.png`

## Remaining QA
- Bruce/Elva should run production owner-session QA after deploy. Backend v1 logs mark-read to audit only; persisted read-state remains Jason/Phase 2 unless a user notification table is added later.
