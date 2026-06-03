# Codex Trading Room K-line Product Quality PR - 2026-06-03

## Scope

- Tightened the final-v031 trading room desktop layout so the left watchlist, center K-line area, and right order ticket occupy the viewport without native white scrollbars.
- Moved the K-line latest-price readout out of the chart canvas so it no longer blocks candles, MA/VWAP/volume labels, or the right price scale.
- Kept K-line iframe sizing stable and constrained inside the center panel to prevent the visual "jumping" caused by frame/parent overflow changes.
- Made compact trading-room indicator controls honest: RSI and MACD buttons are available in the trading room, and the compact signal strip only shows active math-backed indicators.
- Added a compact data-basis chip showing the number of OHLCV/intraday bars backing the chart, so the user can see whether the indicator view is based on real K-line data.

## Files Changed

- `apps/web/app/api/ui-final-v031/[screen]/route.ts`
- `apps/web/public/ui-final-v031/paper_trading_room/index.html`
- `apps/web/app/final-v031/portfolio/kline-frame/page.tsx`
- `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`
- `apps/web/lib/final-v031-paper-ticket.test.ts`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`
  - 28 files passed
  - 248 tests passed
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - passed
- `pnpm.cmd --filter @iuf-trading-room/web build`
  - passed
  - existing Sentry/OpenTelemetry dynamic import warning remains unrelated

## Browser Evidence

- Local branch route verified with Chromium at:
  - `http://127.0.0.1:3000/api/ui-final-v031/paper-trading-room?symbol=2330&rev=qa-local-layout-20260603`
- Screenshot:
  - `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_next_20260602\evidence\w7_paper_sprint\screenshots\trading-room-local-kline-quality-20260603.png`

Measured DOM result at 1920x1080:

- `body.scrollWidth === body.clientWidth` (`1920 === 1920`)
- `.troom` overflow hidden, no page-level horizontal scroll
- `.cpane` `scrollWidth === clientWidth` (`1216 === 1216`)
- `.rpane` `scrollWidth <= clientWidth` (`418 <= 418`)
- `.tform` `scrollWidth === clientWidth` (`418 === 418`)
- `#real-kline-frame` size stable after 6.5 seconds (`1214x708`)
- `#real-kline-frame` `src` stable after 6.5 seconds

## Owner Session Note

The local no-owner session cannot fetch protected paper/KGI endpoints, so the local screenshot shows degraded data instead of live quote/K-line data. The branch-level layout and iframe stability were still verified. Full live quote/KGI owner data should be verified by the existing owner-session Playwright smoke after PR deployment.

## Hardlines

- No KGI live write path changed.
- No real-order promotion.
- No backend broker/risk/contract changes.
- No fake K-line data added.
- No homepage tactical layout rewrite.
