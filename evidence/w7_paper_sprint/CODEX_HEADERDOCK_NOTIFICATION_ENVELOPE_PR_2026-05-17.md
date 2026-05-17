# Codex Evidence - HeaderDock Notification Envelope Parsing

## Scope
- Frontend-only HeaderDock notification proxy follow-up.
- Keep the bell drawer live state working when the notifications API returns an envelope payload under `data`.

## Change
- HeaderDock same-origin notifications proxy now accepts notification arrays from:
  - top-level array payloads
  - top-level `notifications`, `items`, or `alerts`
  - envelope `data.notifications`, `data.items`, or `data.alerts`
- Unread count now accepts `unread_count` / `unreadCount` from top-level, `data`, `meta`, or `data.meta`, then falls back to computed unread rows.

## Verification
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke with local mock `GET /api/v1/notifications` returning `{ data: { notifications, unreadCount } }`:
  - Same-origin proxy returns 2 normalized notifications and `unread_count: 2`.
  - HeaderDock bell badge shows `2` before drawer open.
  - Drawer renders both envelope notifications.
  - No console errors, failed requests, HTTP >= 400 responses, or horizontal overflow during smoke.

## Screenshot
- `evidence/w7_paper_sprint/headerdock-notification-envelope-desktop-1366x900.png`

## Safety
- No backend service, broker, risk, contract, or order path changes.
- No live execution wording or `PAPER_LIVE` promotion.
- No secrets or account identifiers added.
