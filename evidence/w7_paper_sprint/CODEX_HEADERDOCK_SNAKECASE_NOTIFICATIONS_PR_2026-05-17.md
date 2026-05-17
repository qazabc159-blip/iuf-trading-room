# HeaderDock snake_case notification fields PR evidence - 2026-05-17

## Scope

- Frontend-owned change under `apps/web`.
- Hardened `app/api/header-dock/notifications` normalization for common live/backend notification field aliases:
  - `created_at` and `occurred_at` now normalize into `createdAt` / `occurredAt`.
  - `read_at` now normalizes into `readAt`.
  - `is_read: true` now synthesizes `readAt` from the notification timestamp.
  - `action_url` now normalizes into the safe `href` mapping.
- This prevents already-read live rows from rendering as unread and keeps notification handoff links aligned across payload variants.
- No backend, broker, risk, KGI, contract, OpenAlice source, or homepage layout changes.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser/proxy smoke with Next dev + mock API:
  - Mock upstream returned envelope `data.notifications` using `created_at`, `occurred_at`, `read_at`, `is_read`, and `action_url`.
  - Same-origin proxy returned normalized notifications with `createdAt`, `occurredAt`, `readAt`, and safe `href` values.
  - Computed `unread_count` was `0` for two read rows.
  - Verified unread alias forwarding remains intact for `unread=true`.

## Artifact

- Screenshot: `evidence/w7_paper_sprint/headerdock-snakecase-notifications-proxy-1366x900.png`
