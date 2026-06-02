# Codex Trading Room Embedded Width Evidence - 2026-06-02

## Scope

Second-pass Trading Room QA after PR #900.

This patch fixes the actual `/portfolio` embedded width case: the app sidebar leaves the Trading Room iframe about 1200px wide, while the previous three-column grid required about 1248px minimum width and clipped the right order ticket.

## Fixed

- Trading Room grid now fits a 1200px embedded viewport.
- Right order ticket no longer clips the Paper / KGI SIM submit buttons.
- Same grid is applied in both the static final-v031 HTML and the Next route CSS override.

## Files Changed

- `apps/web/public/ui-final-v031/paper_trading_room/index.html`
- `apps/web/app/api/ui-final-v031/[screen]/route.ts`
- `apps/web/lib/final-v031-paper-ticket.test.ts`

## Production QA Findings Before This Patch

Owner-session `/portfolio` loaded without console or network errors, but the embedded Trading Room iframe had only 1200px width after the sidebar. The previous grid columns were too wide for that embedded viewport.

Production owner-session screenshot:

`C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_next_20260602\evidence\w7_paper_sprint\screenshots\trading-room-prod-owner-portfolio-20260602.png`

Production frame screenshots:

- `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_next_20260602\evidence\w7_paper_sprint\screenshots\trading-room-frame-1-20260602.png`
- `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_next_20260602\evidence\w7_paper_sprint\screenshots\trading-room-frame-2-20260602.png`

## Local Verification After Patch

Local verified URL:

`http://127.0.0.1:3032/api/ui-final-v031/paper-trading-room`

Viewport:

- `1200x900`

Layout metrics:

- body horizontal overflow: false
- `.troom` horizontal overflow: false
- `.rpane` width: 320px
- `.rpane` horizontal overflow: false
- `.tform` horizontal overflow: false
- `#submit-btn` visible width: 270px
- `#submit-kgi-sim-btn` visible width: 270px
- `#real-kline-frame` width/height: `632x471`

Screenshot:

`C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_next_20260602\evidence\w7_paper_sprint\screenshots\trading-room-local-1200-grid-20260602.png`

Known limitation:

- Local dev screenshot is unauthenticated, so the K-line data area shows a local fetch-failed state. This patch is specifically for embedded grid width and right-panel clipping. Production owner-session already verified that `/portfolio` loads without console/network errors.

## Tests

- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket` - PASS, 246 tests
- `pnpm.cmd --filter @iuf-trading-room/contracts build` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `git diff --check` - PASS except Windows CRLF warnings

