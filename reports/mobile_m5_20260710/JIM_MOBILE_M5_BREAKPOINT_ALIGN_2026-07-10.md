# Mobile M5 — /portfolio 981-1000px breakpoint alignment (2026-07-10)

## Root cause (per Bruce final acceptance, 2026-07-10)
`FinalOnlyFrame.tsx` disables the sidebar-overlay-fix at `@media (max-width: 1000px)`,
but the shared `Sidebar.tsx` component's own compact-bar collapse
(`.app-tactical-sidebar.tac-sidebar` + bare `.tac-sidebar`/`.tac-brand`/`.tac-nav`/
`.tac-sidebar-radar`/`.tac-sidebar-clock` in `globals.css`) only fired at
`@media (max-width: 980px)`. In the 981-1000px band the overlay was correctly
disabled (in-flow, no click interception — M4's own fix held) but the sidebar's
*content* never collapsed, rendering at its natural ~718px list height and
squeezing the `/portfolio` trading iframe down to ~182px of a 900px-tall viewport.

## Fix
Picked **1000px** as the single sidebar-collapse breakpoint (matching
`FinalOnlyFrame.tsx` and the pre-existing `.app-sidebar` `@media (max-width: 1000px)`
block, which already handled the outer shell layout correctly). Moved every
sidebar-collapse-specific selector in `globals.css` from 980px to 1000px:

- `.app-tactical-sidebar.tac-sidebar` / `.app-tactical-sidebar .tac-nav` /
  `.app-tactical-sidebar .tac-nav a` / `.app-tactical-sidebar .tac-sidebar-logout`
  (was its own dedicated 980px block — moved wholesale, block is 100% sidebar-only)
- `.tactical-dashboard { grid-template-columns: 1fr }` / `.tac-sidebar` /
  `.tac-brand` / `.tac-nav` / `.tac-nav a` / `.tac-nav a.active` /
  `.tac-sidebar-radar, .tac-sidebar-clock` (extracted out of a larger 980px block
  that also contains unrelated homepage-only selectors — `.tac-content`,
  `.tac-topbar`, `.tac-agenda*`, `.tac-hero-status`, `.tac-index-card`,
  `.tac-source-table`, `.tac-heatmap*` — which stayed at 980px unchanged)

No selectors outside the sidebar-collapse concern were touched. `FinalOnlyFrame.tsx`
was not modified (its 1000px breakpoint was already correct — see history in
`reports/unified_order_frontend_20260709/PR4_VERIFICATION.md` and #1197).

## Verification

### Build-time
- Caught and fixed a self-inflicted bug during the edit: an inserted CSS comment
  accidentally contained a literal `*/` sequence (`.tac-agenda*/`), which
  prematurely closed the comment and broke `next build`'s CSS minifier
  (`Unexpected '/'` in cssnano). Reworded the comment, rebuild succeeded.

### Playwright (against prod API + a local `next start` build with
`NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com`, real SEED_OWNER session —
prod itself is pre-fix until this PR deploys, so the local build was used to
prove the fix works end-to-end before merge)

New spec: `packages/qa-playwright/tests/jim_mobile_m5_breakpoint_align_20260710.spec.ts`

| Check | Result |
|---|---|
| `/portfolio` width sweep 975/980/981/995/1000px — sidebar <200px, iframe >400px | 5/5 PASS |
| `/portfolio` at 1001px — desktop fixed-column layout, iframe >400px | PASS |
| `/` at 995px — cross-page regression check (`.tac-sidebar` <200px) | PASS |
| `/track-record` at 995px — cross-page regression check | PASS |
| `/portfolio` at 1280px — desktop 3-column layout unchanged (sidebar narrow fixed column, iframe full height) | PASS |
| `jim_mobile_m4_portfolio_shell_20260709.spec.ts` (390px, real click + no-overlay) | 2/2 PASS, zero regression |
| `mobile-390.spec.ts` (11 routes, 390px, no horizontal overflow) | 11/11 PASS, zero regression |

Total: 24/24 non-skipped assertions PASS. Screenshots in this directory
(`m5_portfolio_*px_*.png`, `m5_other_route_995px_*.png`) plus a fresh
`mobile-390.spec.ts` re-run set for the record.

### Before/after evidence
`m5_portfolio_995px_desktop-chromium.png` (this PR, post-fix) shows the sidebar
fully collapsed into the horizontal compact bar at the top and the trading iframe
filling the remaining viewport — compare against Bruce's
`reports/mobile_final_acceptance_20260710/bruce_995_portfolio_sidebar_check_desktop-chromium.png`
(pre-fix, sidebar ate ~80% of the viewport height).

### Local checks
- `pnpm typecheck` — 15/15 tasks green (including `web` and `qa-playwright`)
- `pnpm --filter @iuf-trading-room/web test` — 498/498 green (zero regression)
- `pnpm run build:web` — green (after the CSS-comment fix above)

## Files changed
- `apps/web/app/globals.css` — sidebar-collapse breakpoints unified to 1000px (surgical, sidebar-only selectors)
- `packages/qa-playwright/tests/jim_mobile_m5_breakpoint_align_20260710.spec.ts` — new spec (width sweep + cross-page + desktop regression)
- `reports/mobile_m5_20260710/` — this report + screenshots

## Not touched
- `apps/web/components/FinalOnlyFrame.tsx` — its 1000px breakpoint was already correct, no change needed
- `apps/api/*`, real-money lock files — out of scope, not touched
