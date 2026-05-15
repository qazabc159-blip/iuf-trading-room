# CODEX_HEADER_DOCK_NOTIFICATIONS_PROXY_2026-05-15

Time: 2026-05-15 09:35 TST
Branch: `fix/web-header-dock-notifications-proxy-2026-05-15`

## Scope

Frontend-only Day 6 notification drawer hygiene.

Changes:
- Added `apps/web/app/api/header-dock/notifications/route.ts` as a same-origin web proxy.
- HeaderDock now loads notifications only when the bell drawer opens.
- HeaderDock now consumes the Day 6 `GET /api/v1/notifications` lane through the proxy.
- Empty backend response stays empty; no fake notifications are inserted.
- Existing `/alerts` page and alerts engine API remain untouched.

## Verification

Commands:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` -> PASS
- `curl.exe -s -H "Cookie: iuf_session=dev" http://localhost:3021/api/header-dock/notifications?limit=50` -> 200 JSON fallback payload
- Browser smoke `/quant-strategies`, click bell -> drawer visible

Browser smoke observed:
- Console errors: `[]`
- Network request: `http://localhost:3021/api/header-dock/notifications?limit=50`
- No browser request to `localhost:3001/api/v1/alerts`
- Drawer empty state: `最近 7 天沒有未處理警示。`

Screenshot:
- `evidence/w7_paper_sprint/CODEX_HEADER_DOCK_NOTIFICATIONS_PROXY_2026-05-15.png`

Residual:
- Local API process returned 404 for `/api/v1/notifications`; proxy intentionally degrades to empty JSON so the UI stays clean. Production owner-session QA should confirm live backend stub/source returns `source: api`.
