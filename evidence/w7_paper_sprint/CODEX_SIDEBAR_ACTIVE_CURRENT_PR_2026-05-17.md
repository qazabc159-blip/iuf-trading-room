# CODEX Sidebar Active Current PR - 2026-05-17

## Scope
- Frontend-owned sidebar IA accessibility hardening in `apps/web`.
- Target UI: tactical sidebar navigation on desktop and mobile.
- Task: expose the active route semantically and keep the active item visible inside the mobile horizontal nav.
- No backend, broker, risk, contract, or API changes.

## Shipped
- Added `aria-current="page"` to the active tactical sidebar link.
- Added a sidebar nav ref and route-change effect that scrolls the active link into view.
- Kept the existing active class and tactical visual layout unchanged.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- `git diff --check` passed.
- Browser smoke via Playwright against local Next dev server on `127.0.0.1:3080` passed:
  - Desktop viewport `1366x900`, route `/ai-recommendations`
    - document/body scroll width: `1366 / 1366`
    - `aria-current="page"` count: `1`
    - active class count: `1`
    - active href: `/ai-recommendations`
    - active link visible: `2..241 / 1366`
    - console/page/request/HTTP errors: `0`
  - Mobile viewport `390x844`, route `/quant-strategies`
    - document/body scroll width: `390 / 390`
    - `aria-current="page"` count: `1`
    - active class count: `1`
    - active href: `/quant-strategies`
    - nav internal scroll: `scrollLeft 534`, `924 / 390`
    - active link visible after auto-scroll: `238..382 / 390`
    - console/page/request/HTTP errors: `0`

## Screenshots
- `evidence/w7_paper_sprint/sidebar-active-current-desktop-1366x900.png`
- `evidence/w7_paper_sprint/sidebar-active-current-mobile-390x844.png`

## Safety
- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE` wording or paper/live promotion.
- No default live execution mode.
- No secrets or identity material added.
- No OpenAlice source import or fork.
