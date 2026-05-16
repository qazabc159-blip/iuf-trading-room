# CODEX HeaderDock Drawer Scroll PR - 2026-05-17

## Scope
- Frontend-owned HeaderDock drawer layout hardening in `apps/web`.
- Target UI: HeaderDock notification/system drawer.
- Task: keep long notification lists reachable on mobile and short-height desktop viewports without page-level horizontal overflow.
- No backend, broker, risk, contract, or API changes.

## Shipped
- Converted `.header-dock-drawer` into a fixed-height vertical flex container.
- Added `100dvh` support with `100vh` fallback for modern mobile viewport behavior.
- Kept the drawer head fixed-size and made `.header-dock-drawer-body` the internal scroll region.
- Added scroll containment and safe-area bottom padding so the bottom action link remains reachable.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- `git diff --check` passed.
- Browser smoke via Playwright against local Next dev server on `127.0.0.1:3079` passed with a mocked same-origin notification response:
  - Mobile viewport `390x640`, route `/quant-strategies`
    - document/body scroll width: `390 / 390`
    - drawer bounds: `30..390`, height `640 / 640`
    - drawer body scroll: `997 / 551`, `overflow-y: auto`
    - after body scroll, bottom action link visible at `584..624 / 640`
    - console/page/request/HTTP errors: `0`
  - Desktop short viewport `1024x500`, route `/quant-strategies`
    - document/body scroll width: `1024 / 1024`
    - drawer bounds: `634..1024`, height `500 / 500`
    - drawer body scroll: `997 / 411`, `overflow-y: auto`
    - after body scroll, bottom action link visible at `444..484 / 500`
    - console/page/request/HTTP errors: `0`

## Screenshots
- `evidence/w7_paper_sprint/headerdock-drawer-scroll-mobile-390x640.png`
- `evidence/w7_paper_sprint/headerdock-drawer-scroll-desktop-1024x500.png`

## Safety
- No KGI live broker write.
- No real-order path promotion.
- No `PAPER_LIVE` wording or paper/live promotion.
- No default live execution mode.
- No secrets or identity material added.
- No OpenAlice source import or fork.
