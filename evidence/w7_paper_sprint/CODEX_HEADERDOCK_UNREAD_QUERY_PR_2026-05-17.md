# HeaderDock unread query compatibility PR evidence - 2026-05-17

## Scope

- Frontend-owned change under `apps/web`.
- Hardened `app/api/header-dock/notifications` so unread-only requests support both frontend and backend query naming:
  - Incoming `unread_only=true` forwards upstream as `unread_only=true&unread=true`.
  - Incoming `unread=true` also forwards upstream as `unread_only=true&unread=true`.
- No backend, broker, risk, KGI, contract, OpenAlice source, or homepage layout changes.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser/proxy smoke with Next dev + mock API:
  - Requested `/api/header-dock/notifications?limit=50&unread_only=true`.
  - Mock upstream observed `/api/v1/notifications?limit=50&unread_only=true&unread=true`.
  - Requested `/api/header-dock/notifications?limit=2&unread=true`.
  - Mock upstream observed `/api/v1/notifications?limit=2&unread_only=true&unread=true`.

## Artifact

- Screenshot: `evidence/w7_paper_sprint/headerdock-unread-query-proxy-1366x900.png`
