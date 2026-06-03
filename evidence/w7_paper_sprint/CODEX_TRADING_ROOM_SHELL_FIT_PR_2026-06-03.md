# Codex Trading Room Shell Fit Evidence — 2026-06-03

## Scope

- Product area: Trading Room `/portfolio` and `/api/ui-final-v031/paper-trading-room`
- Goal: remove the ugly nested scrollbars, prevent HeaderDock from floating over the trading room, keep the K-line iframe inside the available viewport, and make the right order ticket fit without horizontal overflow.
- Backend touched: none
- Broker/risk/contracts/KGI live write touched: none

## Changes

- `FinalOnlyFrame` now isolates the full trading-room iframe as a fixed full-viewport product surface and hides global app chrome for the trading-room route.
- `paper-trading-room` route overrides now use a fixed 32px safety rail plus a three-column viewport grid sized for left watchlist, central K-line, and right order ticket.
- Static fallback `paper_trading_room/index.html` now matches the same grid, overflow, and compact order-ticket rules.
- Nested K-line frame route now suppresses native scrollbars and lets the chart host fill the iframe without forcing a tall minimum height that creates a second scrollbar.
- QA Playwright portfolio spec now gates both the direct trading-room iframe and `/portfolio` wrapper for viewport overflow and hidden HeaderDock behavior.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test "lib/final-v031-paper-ticket.test.ts"`: PASS, 32/32
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`: PASS
- `pnpm.cmd --filter @iuf-trading-room/qa-playwright typecheck`: PASS
- `pnpm.cmd --filter @iuf-trading-room/web build`: PASS
- `git diff --check`: PASS except existing Windows LF-to-CRLF warnings

## Browser Evidence

- Local branch screenshot: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_next_20260602\evidence\w7_paper_sprint\screenshots\trading-room-shell-fit-local-20260603.png`

Local Playwright reached the trading-room page on `http://127.0.0.1:3303`, but the live quote proxy returned 503 for KGI ticks/bidask in this local environment because production API/KGI proxy secrets are not available locally. The screenshot still verifies the frontend shell behavior: no floating HeaderDock over the trading room, no native white scrollbar on the right ticket, and the ticket surface stays inside the product viewport.

## Pending Production Gate

- After merge/deploy, run the existing owner-session Playwright P0 smoke against production so quote/ticks/bidask can be verified with production API configuration.
