# CODEX_NOTIFICATION_EMPTY_UNREAD_COPY_2026-05-15

Cycle: 2026-05-15 20:18 TST
Branch: `fix/web-notification-empty-unread-copy-2026-05-15`
Worktree: `IUF_TRADING_ROOM_APP_notification_empty_unread_worktree`

## Scope

Frontend-only polish for HeaderDock notification drawer empty/live state.

## Problem

HeaderDock can receive a backend payload with:

```json
{ "notifications": [], "unread_count": 3 }
```

The dock badge correctly shows unread count, but the drawer previously displayed:

```text
最近 7 天沒有未處理警示。
```

That is contradictory to the red unread badge and makes the notification center feel unreliable.

## Shipped locally

Updated `apps/web/components/header-dock.tsx`:

- If `visibleNotifications.length === 0` and `unreadCount > 0`, show:
  - `尚有 X 則未讀警示，請開啟警示頁確認完整紀錄。`
- If unread count is zero, keep:
  - `最近 7 天沒有未處理警示。`

No backend or notification contract changes.

## Verification

Dependency setup in the clean worktree:

```powershell
pnpm.cmd install --frozen-lockfile --prefer-offline
pnpm.cmd --filter @iuf-trading-room/contracts build
```

Typecheck:

```powershell
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: PASS.

Same-origin notification proxy smoke:

- Fake backend: `http://127.0.0.1:3049`
- Web dev: `http://127.0.0.1:3050`
- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3049`

Request:

```powershell
GET http://127.0.0.1:3050/api/header-dock/notifications?limit=50
```

Result:

```json
{"notifications":[],"unread_count":3,"meta":{"source":"api"}}
```

This verifies the exact empty-list + unread-count state the copy change targets.

## Safety

- No `apps/api` changes.
- No broker/risk/contracts changes.
- No KGI live write path.
- No real-order or `PAPER_LIVE` promotion.
- HeaderDock routing and mark-read behavior unchanged.

## Release status

Patch was prepared locally on the 2026-05-15 cycle.

2026-05-16 follow-up: promoted onto latest `origin/main` on branch
`fix/web-notification-empty-unread-copy-2026-05-16`; see
`CODEX_NOTIFICATION_EMPTY_UNREAD_COPY_PR_2026-05-16.md` for the current
PR verification and browser smoke.
