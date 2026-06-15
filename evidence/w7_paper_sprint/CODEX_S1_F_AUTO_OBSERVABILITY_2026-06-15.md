# S1 F-AUTO product observability - 2026-06-15

## Production truth before the fix

- `/api/v1/portfolio/f-auto` returned eight persisted S1 positions.
- `/api/v1/internal/s1-sim/eod-report` returned configured capital, cash residual, market value, and unrealized P&L.
- `/api/v1/kgi/sim/orders` returned eight accepted audit rows with `shares` and `submitted_at_tst`.
- The page still showed empty positions/funds above the valid EOD section because it prioritized an off-hours gateway reconstruction.
- The order parser ignored `shares` and `submitted_at_tst`, producing zero-share and missing-time rows.
- The observation page was hidden under the collapsed Owner-only internal menu.

## Product fix

- Use `/api/v1/portfolio/f-auto` as the durable position and funds source.
- Show configured capital, deployed market value, cash, equity, unrealized P&L, position count, data date, and data source in one summary.
- Keep accepted orders honest as submitted with settlement still awaiting confirmation.
- Parse persisted share counts and Taipei timestamps.
- Load the latest persisted S1 basket date rather than assuming only today/yesterday/D-2.
- Put F-AUTO in the Owner primary navigation and add a direct link from `/quant-strategies`.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web exec vitest run app/ops/f-auto/f-auto-observability.test.ts app/quant-strategies/quant-strategies-page.test.ts components/sidebar-owner-boundary.test.ts`
- Production owner-session browser evidence will be appended after deployment.

## Safety

Read-only UI and data mapping only. KGI live writes, real orders, S1 scheduling, broker risk, and strategy logic are unchanged.
