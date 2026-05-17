# HeaderDock notification text aliases - PR evidence

## Scope
- Frontend-owned proxy compatibility fix for `apps/web/app/api/header-dock/notifications/route.ts`.
- Normalizes additional notification text aliases so live/audit/event payloads can render useful drawer copy without backend contract changes.

## Change
- Added `firstStringField(...)` helper.
- `title` now accepts `title`, `headline`, `summary`, `event`, and `action`.
- `message` now accepts `message`, `body`, `description`, `text`, `content`, `summary`, and `subtitle`.
- Existing severity, href, timestamp, snake_case, envelope, unread-query, and empty-body behavior remains unchanged.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Mock API + Next dev + Playwright browser smoke:
  - API payload returned `summary` + `description`, `event` + `text`, and `content`/`subtitle` variants.
  - Proxy preserved `unread_count=2`.
  - Proxy normalized `warn` to `warning` and uppercase `ERROR` to `critical`.
  - Proxy normalized `/risk` action alias to `/alerts`.
  - Screenshot: `evidence/w7_paper_sprint/headerdock-text-aliases-proxy-1366x900.png`

## Hardline check
- No backend, broker, risk, contracts, KGI, execution mode, or order-path changes.
- No paper/live wording changes.
- No secrets or identity-bearing values added.
