# P0 Route Alias Evidence - 2026-05-19

## Scope

Frontend-only PR-E route rescue.

## Production finding before fix

- `https://app.eycvector.com/event-log` redirects to `/admin/events`.
- `https://app.eycvector.com/portfolio-snapshot` redirects to `/admin/portfolio/snapshots`.
- `https://app.eycvector.com/tool-center` redirects to `/admin/tools`.
- `https://app.eycvector.com/uta` redirects to `/admin/uta/accounts`.
- `https://app.eycvector.com/portfolio-snapshots` returned `404`.

## Fix

- Add `/portfolio-snapshots` -> `/admin/portfolio/snapshots` to `apps/web/next.config.ts`.
- Add redirect test coverage for the product/admin alias set.

## Local verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- next-config-redirects.test.ts`
  - Result: 13 test files / 177 tests passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

## Production verification

Pending PR merge and web deploy.
