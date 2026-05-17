# Codex Evidence - HeaderDock Alert Item Layout

## Scope
- Frontend-only HeaderDock notification drawer QA follow-up.
- Fix notification alert card styling so drawer CTA link styles do not override alert item card layout.

## Change
- Added explicit `header-dock-drawer-link` class to the drawer CTA links.
- Narrowed the CTA CSS selectors from generic `.header-dock-drawer-body a` to `.header-dock-drawer-link`.
- Notification items keep their `.header-alert-item` grid/card layout while the footer CTA remains button-like.

## Verification
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke with local mock `GET /api/v1/notifications` fixture:
  - Desktop `1366x900`: bell drawer opens, notification card computed `display:grid`, CTA computed `display:inline-flex`, no horizontal overflow.
  - Mobile `390x844`: same layout assertions pass, no horizontal overflow.
  - No console errors, failed requests, or HTTP >= 400 responses during smoke.

## Screenshots
- `evidence/w7_paper_sprint/headerdock-alert-item-layout-desktop-1366x900.png`
- `evidence/w7_paper_sprint/headerdock-alert-item-layout-mobile-390x844.png`

## Safety
- No backend/API, broker, risk, contract, or order path changes.
- No live execution wording or `PAPER_LIVE` promotion.
- No secrets or account identifiers added.
