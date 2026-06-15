# Homepage product-data rescue - 2026-06-15

## Root cause

Production had a published daily brief, eight recommendation rows, and a valid S1 strategy snapshot. The homepage still rendered blocked/empty states because it launched many expensive requests together and killed brief/recommendation requests after three seconds. Under normal Railway contention those requests completed in roughly four to seven seconds.

The homepage strategy panel also queried obsolete strategy-idea and run surfaces even though the formal product currently exposes only S1.

## Change

- Give operational and product data realistic bounded deadlines without bypassing timeout/error honesty.
- Read the published brief first; only query draft review data when no published brief exists.
- Remove obsolete strategy-idea/run homepage requests.
- Render the approved `cont_liq_v36` S1 snapshot as the formal strategy surface and link to the F-AUTO observation page.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web exec vitest run app/page-p0-visual-copy.test.ts`
- Production browser verification will be appended after merge and deploy.

## Scope

Frontend homepage only. No broker write, KGI live path, migration, contract, Lab, or real-order behavior changed.
