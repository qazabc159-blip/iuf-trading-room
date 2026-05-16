# HeaderDock Mark-Read Readiness PR Evidence - 2026-05-17

## Scope
- Frontend-owned HeaderDock Notification Center polish in `apps/web`.
- Kept the existing same-origin notification proxy contract:
  - `GET /api/header-dock/notifications`
  - `POST /api/header-dock/notifications/[id]/mark-read`
- No broker, risk, contracts, KGI, live-order, or backend source changes.

## Shipped
- HeaderDock now tracks notification mark-read pending ids.
- Added an aria live status for mark-read success/failure announcements.
- Notification list items now expose:
  - `data-read-state="read|unread"`
  - `data-mark-read-state="idle|pending"`
  - `aria-busy="true"` while pending
- Added restrained read/pending styling for the existing tactical notification cards.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke against local Next `http://127.0.0.1:3074` and local stub API `http://127.0.0.1:3994`:
  - Owner-session cookie on `/briefs`.
  - Bell drawer opened with `unread=1`, `read=1`, `bellCount=1`.
  - Clicked unread notification.
  - Same-origin proxy then returned `unread_count=0`.
  - Reopened drawer with `unread=0`, `read=2`, no bell count.
  - Console errors: `0`.

## Screenshots
- `evidence/w7_paper_sprint/headerdock-markread-open-1366x900.png`
- `evidence/w7_paper_sprint/headerdock-markread-read-1366x900.png`

## Notes
- A clean worktree was used because the primary requested worktree still contains older unrelated local changes.
- The first raw `web typecheck` in this clean worktree failed only because `@iuf-trading-room/contracts` artifacts were not built yet; after building contracts, web typecheck passed.
