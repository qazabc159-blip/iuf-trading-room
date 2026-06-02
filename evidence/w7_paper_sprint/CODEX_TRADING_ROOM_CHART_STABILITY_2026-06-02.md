# Codex Trading Room Chart Stability Evidence - 2026-06-02

## Scope

Frontend-only rescue for Trading Room layout and K-line stability.

## Fixed

- K-line viewport key no longer includes bar count or latest bar timestamp, so live data refresh/append does not reset user pan/zoom every few seconds.
- Trading room shell and injected route CSS no longer expose the white iframe scrollbars seen in Yang screenshots.
- Right order ticket panel is constrained to the viewport and no longer creates horizontal overflow in the local browser layout check.
- Compact trading-room K-line frame hides RSI/MACD subchart rows inside the embedded frame only, keeping the primary chart and real MA/VWAP/support-resistance/plan-level controls visible without crushing the layout.

## Files Changed

- `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`
- `apps/web/app/final-v031/portfolio/kline-frame/page.tsx`
- `apps/web/app/api/ui-final-v031/[screen]/route.ts`
- `apps/web/public/ui-final-v031/paper_trading_room/index.html`
- `apps/web/lib/final-v031-paper-ticket.test.ts`

## Browser Evidence

Screenshot:

`C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_cleanup_20260602\evidence\w7_paper_sprint\screenshots\trading-room-local-layout-20260602.png`

Local verified URL:

`http://127.0.0.1:3031/api/ui-final-v031/paper-trading-room`

Layout metrics from Playwright:

- viewport: `1440x900`
- document horizontal overflow: `false`
- body horizontal overflow: `false`
- `.troom` horizontal overflow: `false`
- `.rpane` horizontal overflow: `false`
- `.tform` horizontal overflow: `false`
- `real-kline-frame` width/height: `780x490`

Known limitation:

- Local browser run did not have a valid owner session/backend auth, so the embedded K-line frame showed local fetch errors. This evidence validates layout and scroll behavior. Production real-data click verification still needs a valid owner session after deploy.

## Tests

- `pnpm.cmd --filter @iuf-trading-room/contracts build` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket` - PASS, 246 tests
- `pnpm.cmd --filter @iuf-trading-room/db build` - PASS
- `pnpm.cmd --filter @iuf-trading-room/domain build` - PASS
- `pnpm.cmd --filter @iuf-trading-room/integrations build` - PASS
- `pnpm.cmd test` - PASS, 488 tests
- `git diff --check` - PASS except expected Windows CRLF warnings

