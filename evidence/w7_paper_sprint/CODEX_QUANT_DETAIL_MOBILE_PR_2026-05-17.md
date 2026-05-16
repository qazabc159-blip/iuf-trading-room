# CODEX Quant Detail Mobile Layout PR - 2026-05-17

## Scope
- Frontend-owned fix for `apps/web` only.
- Target route: `/quant-strategies/[strategyId]`.
- Task: keep the quant strategy detail charts, holdings table, and SIM subscription launcher readable on mobile without page-level horizontal overflow.
- No backend, broker, risk, contract, or API changes.

## Shipped
- Added `min-width: 0` guards to the quant detail grid, content bands, and chart panel so grid min-content no longer stretches mobile layout.
- Kept chart SVGs constrained to the available chart box width.
- Wrapped the holdings table in a keyboard-focusable internal horizontal scroll region.
- Added scoped table headers for the holdings table.
- Kept SIM-only subscription copy and behavior unchanged.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed before browser smoke.
- Browser smoke via Playwright against local Next dev server on `127.0.0.1:3078` passed:
  - Mobile viewport `390x844`, route `/quant-strategies/class5_revenue_momentum`
    - document/body scroll width: `390 / 390`
    - holdings rows: `20`
    - holdings scroller: internal scroll `520 / 326`, `tabIndex=0`
    - chart widths: `306px`, heights `230px` and `220px`
    - SIM launcher right edge: `390 / 390`
    - console/page/request/HTTP errors: `0`
  - Desktop viewport `1366x900`, route `/quant-strategies/cont_liq_v36`
    - document/body scroll width: `1366 / 1366`
    - holdings rows present: `4`
    - charts present: `2`
    - console/page/request/HTTP errors: `0`

## Screenshots
- `evidence/w7_paper_sprint/quant-detail-mobile-390x844.png`
- `evidence/w7_paper_sprint/quant-detail-desktop-1366x900.png`

## Safety
- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE` wording or paper/live promotion.
- No default live execution mode.
- No secrets or identity material added.
- No OpenAlice source import or fork.
