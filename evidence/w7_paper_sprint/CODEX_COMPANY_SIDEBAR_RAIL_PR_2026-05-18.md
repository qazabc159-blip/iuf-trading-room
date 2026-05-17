# Codex Evidence - Company Sidebar Rail

Date: 2026-05-18
Branch: fix/web-company-sidebar-rail-2026-05-18
Scope: company detail right sidebar scanability in `apps/web/app/companies/[symbol]`

## Shipped

- Added a compact desktop-only `頁面索引` panel to the company detail right rail.
- Added section anchors for:
  - `#company-knowledge`
  - `#company-data-dock`
  - `#company-full-profile`
  - `#company-source-status`
- Made the desktop right sidebar sticky so the right rail stays useful while the main company workbench is scanned.
- Hid the side index on mobile to avoid adding clutter to the narrow stacked layout.

## Safety

- Frontend-only change under `apps/web/app/companies/[symbol]`.
- No API implementation, heatmap universe, data source selection, broker/risk/contracts, live-order path, execution-mode default, secrets, or vendor tactical homepage changes.
- Browser smoke used a local mock API only.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke with local mock API and owner-session cookie:
  - `/companies/2330` desktop 1366x900 rendered successfully.
  - Required visible content found: `台積電`, `頁面索引`, `My-TW-Coverage`, `資料艙`, `完整資料區`, `資料來源`, `CoWoS`.
  - `.company-side-nav-link` count is 4.
  - `.company-side-column` computed CSS position is `sticky`.
  - Clicking `#company-full-profile` updated `location.hash` and placed the section near the top of the viewport.
  - `/companies/2330` mobile 390x844 rendered successfully.
  - `.company-side-nav-panel` is hidden on mobile.
  - Page errors, failed requests, and >=400 responses: none.

## Screenshots

- `evidence/w7_paper_sprint/company-sidebar-rail-1366x900.png`
- `evidence/w7_paper_sprint/company-sidebar-rail-scrolled-1366x900.png`
- `evidence/w7_paper_sprint/company-sidebar-rail-mobile-390x844.png`

## Known External Blocker

- Deploy to Railway remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
