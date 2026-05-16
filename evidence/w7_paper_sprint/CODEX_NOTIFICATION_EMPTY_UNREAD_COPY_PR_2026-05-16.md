# CODEX_NOTIFICATION_EMPTY_UNREAD_COPY_PR_2026-05-16

## Scope
- Branch: `fix/web-notification-empty-unread-copy-2026-05-16`
- Component: `apps/web/components/header-dock.tsx`
- Purpose: make HeaderDock notification drawer honest when the backend reports unread count but the recent visible list is empty.

## Change
- If `visibleNotifications.length === 0` and `unreadCount > 0`, the drawer now shows:
  - `尚有 X 則未讀警示，請開啟警示頁確認完整紀錄。`
- If unread count is zero, the drawer keeps:
  - `最近 7 天沒有未處理警示。`
- Notification routing, mark-read behavior, and backend contract are unchanged.

## Verification
- `git diff --check origin/main..HEAD` PASS
- `pnpm.cmd install --frozen-lockfile --prefer-offline` PASS
- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- Python Playwright browser smoke PASS:
  - fake notification backend on `http://127.0.0.1:3060`
  - local web on `http://127.0.0.1:3061`
  - `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3060`
  - fake backend returned `{"notifications":[],"unread_count":3}`
  - added local-only `iuf_session=codex-local-smoke` cookie to pass middleware routing without real credentials
  - opened `/`
  - clicked HeaderDock bell
  - verified badge text: `3`
  - verified drawer empty text: `尚有 3 則未讀警示，請開啟警示頁確認完整紀錄。`
  - screenshot: `evidence/w7_paper_sprint/CODEX_NOTIFICATION_EMPTY_UNREAD_COPY_PR_2026-05-16.png`

## Safety
- Frontend-only HeaderDock display logic.
- No `apps/api` broker/risk/contracts edits.
- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE` or default live execution mode.
