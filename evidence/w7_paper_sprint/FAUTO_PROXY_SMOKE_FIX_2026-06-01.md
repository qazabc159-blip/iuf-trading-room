# F-AUTO proxy smoke fix - 2026-06-01

## Scope

- Keep `/ops/f-auto` production smoke aligned with the shipped same-origin proxy path.
- No product behavior change.
- No broker write path touched.

## Root cause

`/ops/f-auto` now calls owner-only S1 read endpoints through `/api/ui-final-v031/backend?path=...`.
The smoke test still only counted raw `/api/v1/internal/s1-sim/*` URLs, so production rendered correctly but the test reported zero S1 endpoint calls.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/qa-playwright typecheck`
- `pnpm.cmd --filter @iuf-trading-room/qa-playwright exec playwright test tests/fauto.spec.ts --project=desktop-chromium --no-deps`
- `pnpm.cmd --filter @iuf-trading-room/qa-playwright exec playwright test tests/portfolio.spec.ts --project=desktop-chromium --no-deps`

## Result

- `/ops/f-auto` production smoke passed with owner session.
- `/portfolio` production smoke passed.
- No KGI SIM order submit was clicked.
