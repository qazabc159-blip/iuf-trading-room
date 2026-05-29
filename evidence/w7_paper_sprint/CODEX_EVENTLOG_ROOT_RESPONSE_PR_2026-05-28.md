# Codex EventLog Root Response Fix - 2026-05-28

## Scope

- Route: `/admin/events`
- Frontend-owned fix only.
- No KGI, SIM, broker, Lab, migration, or Market Intel changes.

## Finding

Production browser QA showed `/admin/events` rendering `0` streams and the owner-session failure state even though the same owner session could read `/api/v1/event-streams`.

API evidence:

- `GET /api/v1/event-streams` returned HTTP 200 with 3 streams at the response root: `{ streams: [...] }`.
- `GET /api/v1/admin/event-log/outbox/diag` returned HTTP 200 with `{ data: ... }`.

Frontend root cause:

- The page-local `apiFetch` assumed every endpoint response was `{ data: T }`.
- EventLog stream endpoints return root-level payloads, so the UI treated a valid response as unreadable.

## Fix

- Added `unwrapEventLogApiPayload` to accept both root-level and `data`-wrapped responses.
- Updated `/admin/events` to use the adapter.
- Added unit coverage for both response shapes.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test -- eventlog-api-payload` PASS, 186 tests.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.

## Pre-Fix Screenshot

- `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\packages\qa-playwright\test-results\codex-admin-surfaces-1779972271696\eventlog.png`

## Pending

- After merge/deploy, re-run production browser QA and confirm `/admin/events` shows the 3 real streams instead of the false owner-session failure state.
