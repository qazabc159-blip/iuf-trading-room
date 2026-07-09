# Mobile M4 — /portfolio app-shell sidebar overlay fix (2026-07-09)

## Bug
At <=980px, `<aside class="app-sidebar">` was force-styled by
`FinalOnlyFrame.tsx`'s desktop-only rule (`position:relative; height:100dvh;
z-index:2147483001` — designed to keep the sidebar visible next to the
252px-reserved-column fixed iframe) with no mobile counterpart. Below the
breakpoint the frame goes full-width (no reserved column), so the sidebar
blew up into a full-viewport opaque overlay that intercepted every tap on
the embedded trading room. See `before_portfolio_390_shell_overlay_bug.png`.

## Fix
`apps/web/components/FinalOnlyFrame.tsx` — added a `@media (max-width:
980px)` block (scoped to `data-final-screen="paper-trading-room"` only, zero
blast radius on `/market-intel` or any other route) that stacks the sidebar
(natural height, in-flow) above the iframe in a flex column instead of
layering it on top with a forced full-viewport height. Reuses the
already-established mobile sidebar pattern (`.app-tactical-sidebar.tac-sidebar`
sticky top bar in `globals.css`) rather than reinventing it.

## Screenshots
- `before_portfolio_390_shell_overlay_bug.png` — pre-fix, 390px, dark overlay blocks everything
- `after_portfolio_390_shell_fixed.png` — post-fix, 390px, iframe fully visible/interactive
- `mobile390_portfolio_shell_before_click_mobile-iphone-13.png` / `..._after_click...` — Playwright screenshots from the regression spec, showing a real (non-force) click on the KGI broker-strip button toggling it active
- `before_portfolio_1280_desktop.png` / `after_portfolio_1280_desktop.png` — pixel-identical, confirms zero desktop regression (fix is entirely inside a <=980px media query)

## Verification
- New regression spec: `packages/qa-playwright/tests/jim_mobile_m4_portfolio_shell_20260709.spec.ts`
  (2 tests, mobile-iphone-13 project only): (1) real click on
  `#broker-strip .bbtn[data-broker="kgi"]` inside the iframe toggles `.active`
  — proves the shell no longer intercepts pointer events; (2) sidebar/iframe
  geometry — sidebar height < 200px and does not vertically overlap the
  iframe, iframe fills the remaining viewport (>400px, not the ~150px
  browser-default intrinsic `<iframe>` height a collapsed flex chain would
  produce).
- Full existing `mobile-390.spec.ts` (13 routes) re-run against the same
  local-dev + real owner session setup — 13/13 still pass, no regression.
- `pnpm typecheck` 15/15 packages green.
- `pnpm --filter @iuf-trading-room/web test` 488/488 green.
- `pnpm run build:web` — all routes compile clean.

## Verification recipe used
Local dev server (`NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com pnpm
exec next dev -p 3417`) + real owner session via `SEED_OWNER_EMAIL/PASSWORD`
(`railway variables --service api --kv`) through the existing
`packages/qa-playwright/tests/auth.setup.ts` flow. Before/after screenshots
captured by temporarily `git stash`-ing the fix, re-screenshotting, then
restoring.
