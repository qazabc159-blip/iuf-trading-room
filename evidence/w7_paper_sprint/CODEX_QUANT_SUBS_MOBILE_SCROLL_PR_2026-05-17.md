# CODEX Quant Subscriptions Mobile Scroll PR - 2026-05-17

## Scope

- Branch: `fix/web-quant-subs-mobile-scroll-2026-05-17`
- Frontend-owned surface: `apps/web/app/quant-strategies/QuantSubsPanel.tsx`
- Target route: `/quant-strategies?tab=subscriptions`
- Task: keep the SIM-only subscriptions table readable on mobile without page-level horizontal overflow.
- Out of scope: backend broker/risk/contracts, subscription endpoint behavior, order execution, homepage layout, and vendor source rewrites.

## Change

- Wrapped the subscriptions table in an internal horizontal scroller.
- Made the scroller keyboard-focusable with an `aria-label`.
- Added a stable `720px` table minimum width so columns stay legible while mobile uses the internal scroll region.
- Added `overflowWrap: anywhere` to warning/table cells so long strategy or failure text cannot stretch the page.
- Kept SIM-only copy and disabled v2 cancellation behavior unchanged.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke against local Next dev on `127.0.0.1:3142` with a temporary mock API on `127.0.0.1:3141` passed:
  - authenticated smoke cookie set only for local middleware routing.
  - mobile `390x844`: document/body width stayed `390 / 390`.
  - mobile subscription scroller: `274 / 720`, `overflow-x: auto`, `tabIndex=0`, keyboard focus confirmed.
  - desktop `1366x900`: document/body width stayed `1366 / 1366`, table fit without page overflow.
  - subscription rows: `3`.
  - browser console errors: none.
  - failed requests / HTTP 4xx-5xx responses: none.

## Screenshots

- `evidence/w7_paper_sprint/quant-subs-mobile-scroll-390x844.png`
- `evidence/w7_paper_sprint/quant-subs-desktop-scroll-1366x900.png`

## Safety

- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE` wording or paper/live promotion.
- No default live execution mode.
- No secrets, tokens, database URL, KGI password, or identity material added.
- No OpenAlice source import or fork.
- Did not touch `apps/api`, `IUF_QUANT_LAB`, or `IUF_SHARED_CONTRACTS`.
