# HeaderDock 204 empty notifications PR evidence - 2026-05-17

## Scope

- Frontend-owned change under `apps/web`.
- Hardened `app/api/header-dock/notifications` so successful empty upstream notification responses are treated as normal empty state:
  - `204 No Content` becomes `200` with `notifications: []`, `unread_count: 0`, and `meta.source: "api"`.
  - `200` with an empty body becomes `200` with `notifications: []`, `unread_count: 0`, and `meta.reason: "EMPTY_BODY"`.
- No backend, broker, risk, KGI, contract, OpenAlice source, or homepage layout changes.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser/proxy smoke with Next dev + mock API:
  - Mock upstream `GET /api/v1/notifications` returned `204 No Content`; same-origin proxy returned 200 JSON empty payload with `meta.status: 204`.
  - Mock upstream returned `200` with empty body; same-origin proxy returned 200 JSON empty payload with `meta.reason: "EMPTY_BODY"`.
  - Verified unread alias forwarding remains intact for `unread_only=true`.

## Artifact

- Screenshot: `evidence/w7_paper_sprint/headerdock-204-empty-proxy-1366x900.png`
