# Codex evidence - Admin UTA SIM safety wording

Date: 2026-05-18
Owner: Codex frontend
Branch: `fix/web-admin-uta-sim-safety-20260518`

## Scope

Frontend-only safety wording fix for `/admin/uta/accounts`.

The UTA admin dashboard is read-only, but its order table displayed `LIVE` when `simOnly=false`. That can look like a formal-order path is available. This change relabels the table column to `安全模式` and renders non-SIM records as `正式封鎖`.

## Changed

- `apps/web/app/admin/uta/accounts/page.tsx`
  - Replaced visible `LIVE` badge with `正式封鎖`.
  - Renamed the order table column from `SIM` to `安全模式`.
  - Kept SIM rows as `SIM`.
  - Clarified the page note: Phase A is read-only and has no formal-order operation entrypoint.
  - Added `white-space: nowrap` on UTA badges so safety labels do not wrap awkwardly.
  - Added horizontal overflow handling for UTA tables so narrow mobile viewports keep right-side safety columns reachable.

- `reports/memos/codex_notes/2026-05-18_frontend_cycle_0910_admin_uta_sim_safety.md`
  - Frontend sync note for Elva/Jason/Bruce before editing.

## Verification

- `pnpm.cmd install --offline --frozen-lockfile`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke with mock API and owner-session cookie:
  - Desktop: `1366x900`
  - Mobile: `390x844`
  - Mobile scrolled to right side of the orders table: `390x844`
  - `/admin/uta/accounts` loads without login redirect.
  - No browser console errors.
  - No page errors.
  - Body text contains `安全模式`, `正式封鎖`, and `SIM`.
  - Body text does not contain visible `LIVE`.
  - Mobile orders table reports horizontal overflow (`clientWidth=308`, `scrollWidth=860`), keeping the right-side safety column reachable instead of squeezed or clipped.

## Artifacts

- `evidence/w7_paper_sprint/admin-uta-sim-safety-desktop-1366x900.png`
- `evidence/w7_paper_sprint/admin-uta-sim-safety-mobile-390x844.png`
- `evidence/w7_paper_sprint/admin-uta-sim-safety-mobile-orders-right-390x844.png`
- `evidence/w7_paper_sprint/admin-uta-sim-safety-smoke-results.json`
