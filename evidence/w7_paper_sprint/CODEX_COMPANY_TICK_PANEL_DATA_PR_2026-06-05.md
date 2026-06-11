# Company Tick Panel Data PR - 2026-06-05

## Scope

- Product area: company detail page.
- Route: `/companies/[symbol]`.
- Panel: `成交明細`.

## Shipped

- Replaced the static blocked shell in `TickStreamPanel` with a real data-backed panel.
- Primary data path: KGI read-only tick endpoint via `getKgiTicks(symbol, 20)`.
- Fallback data path: already-fetched FinMind KBar rows from the company page.
- The fallback is explicitly labeled as `FinMind 分K成交摘要`.
- The UI states clearly: `這不是逐筆 tick，不混充`.
- Empty and blocked states now explain the missing source instead of leaving the panel as a dead product card.

## Why

Yang flagged that company pages still had empty or blocked-looking sections. The `成交明細` panel was one of them: it did not receive the current symbol, did not call any data source, and always rendered a static unavailable state.

This PR does not invent fake tick rows. It either shows real KGI ticks, shows labeled FinMind aggregate bars, or explains why neither source is available.

## Files

- `apps/web/app/companies/[symbol]/TickStreamPanel.tsx`
- `apps/web/app/companies/[symbol]/page.tsx`
- `tests/ci.test.ts`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test --test-name-pattern=COMPANY-TICK-PANEL-1 ./tests/ci.test.ts`

## Safety

- No broker write paths touched.
- No KGI live order path touched.
- No real-order promotion.
- No mock data added.
- No company page section removed or hidden.
