# Companies Registry Truth Labels PR - 2026-06-05

## Scope

- Product area: company board.
- Route: `/companies`.
- Panels: company search, theme radar, sector tab, company graph tab.

## Shipped

- Restored product-readable Traditional Chinese labels across the company board.
- Added a real data fallback: if `/api/v1/companies/lite` fails, the page now tries the full `/api/v1/companies` company master endpoint.
- When fallback is used, the page shows `降級可用` and names the fallback source as `完整公司主檔備援`.
- The page no longer collapses directly into a dead `暫停 / 0 公司` state when the lite registry path is temporarily unavailable.
- Added a CI guard that blocks known mojibake fragments from reappearing on this route.

## Why

Yang flagged that `/companies` could show a paused shell with zero companies and broken-looking labels. A paid product cannot make a primary navigation page look like an encoding accident or a dead database panel.

This PR uses only real backend data. It does not add fake companies and does not hide the issue. It gives the product a truthful fallback path and a visible degraded state.

## Files

- `apps/web/app/companies/page.tsx`
- `tests/ci.test.ts`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test --test-name-pattern=COMPANIES-REGISTRY-1 ./tests/ci.test.ts`

## Safety

- No broker write paths touched.
- No KGI live order path touched.
- No fake company data added.
- No company route removed.
- No homepage redesign.
