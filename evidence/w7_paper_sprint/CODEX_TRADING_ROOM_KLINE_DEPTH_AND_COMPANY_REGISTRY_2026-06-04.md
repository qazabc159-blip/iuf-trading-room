# Trading Room K-line Depth + Company Registry Rescue — 2026-06-04

## Scope

- Trading Room / company K-line data service must not render a product chart from a 3-bar long-window response.
- Company registry page must not depend on the heavyweight full company payload when the page only needs registry fields.

## Changes

- `apps/api/src/companies-ohlcv.ts`
  - Added long daily-window detection.
  - Added FinMind daily chunking for long history requests.
  - Requires enough real daily bars for long-window requests before caching/returning.
  - Stops official Taiwan daily requests from falling through to fake/mock output when FinMind/DB cannot provide sufficient depth.

- `apps/api/src/server.ts`
  - Added `GET /api/v1/companies/lite`.
  - Uses the existing DB-backed `getCompaniesLiteCached` path.

- `apps/web/lib/api.ts`
  - Added `getCompaniesLite`.

- `apps/web/app/companies/page.tsx`
  - Company registry now loads from the lightweight real company pool endpoint.

## Product Intent

This is not a visual downgrade. It prevents a professional trading page from showing 3 candles as if that were a valid long-window K-line chart. The preferred path remains full real history backfill; the failure path is explicit instead of fake.

## Verification

- `apps/web`: `.\node_modules\.bin\vitest.CMD run lib\final-v031-paper-ticket.test.ts`
  - 35 tests passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - Passed.
- `pnpm.cmd --filter @iuf-trading-room/api typecheck`
  - Passed.
- `pnpm.cmd --filter @iuf-trading-room/web build`
  - Passed.
- `pnpm.cmd --filter @iuf-trading-room/api build`
  - Passed.

Note: `api build` runs `sync-tw-coverage`; the generated README deletion was restored before commit so the PR stays scoped.
