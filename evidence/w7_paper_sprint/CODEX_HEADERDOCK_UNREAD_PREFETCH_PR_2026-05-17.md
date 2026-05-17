# Codex Evidence - HeaderDock Unread Prefetch

## Scope
- Frontend-only HeaderDock notification drawer follow-up.
- Make the bell unread badge accurate before the drawer is opened, then keep mark-read navigation reliable.

## Change
- HeaderDock now synchronizes notifications once on mount, so the bell badge and accessible label reflect unread count before user interaction.
- Bell accessible idle state now says `尚未同步` instead of implying there are no unread notifications.
- Notification item clicks now mark unread entries before closing/navigating, avoiding aborted mark-read requests during route changes.
- The same-origin mark-read proxy normalizes upstream `204` success into browser-facing `200 {"ok":true}`.

## Verification
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke with local mock `GET /api/v1/notifications` and `POST /api/v1/notifications/:id/mark-read` fixture:
  - Desktop `1366x900`: badge shows `3` before opening drawer; clicking first unread notification returns mark-read `200` and badge decreases to `2`.
  - Mobile `390x844`: fresh page load shows persisted unread badge `2` before opening drawer.
  - No console errors, failed requests, HTTP >= 400 responses, or horizontal overflow during smoke.

## Screenshots
- `evidence/w7_paper_sprint/headerdock-unread-prefetch-desktop-1366x900.png`
- `evidence/w7_paper_sprint/headerdock-unread-prefetch-mobile-390x844.png`

## Safety
- No backend service, broker, risk, contract, or order path changes.
- No live execution wording or `PAPER_LIVE` promotion.
- No secrets or account identifiers added.
