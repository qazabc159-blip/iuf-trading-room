# Trading Room Real K-Line PR Evidence — 2026-05-31

## Scope
- Route: `/api/ui-final-v031/paper-trading-room`
- Fix: replace the visible legacy SVG K-line surface with an embedded company-page chart frame.
- New frame route: `/final-v031/portfolio/kline-frame?symbol=XXXX`

## Root Cause
- The trading room had a separate legacy SVG chart implementation.
- It could show stale or synthetic-looking candles when backend K-bar/OHLCV requests failed.
- Company pages already had the more complete `OhlcvCandlestickChart` chart core with range controls, MA/RSI/MACD, daily OHLCV, FinMind K-bar state, and clear empty/degraded states.

## Shipped
- Trading room now mounts the company-page chart core inside a same-origin iframe.
- Stock selection calls `updateRealChartFrame(symbol)` so changing stocks refreshes the real chart frame.
- The legacy SVG chart is hidden from users; it no longer appears as the visible K-line product surface.
- The iframe route is a public read-only embed path, so the trading-room API page does not briefly show `/login` in the chart area.
- If the data source is unavailable, the frame shows a formal blocked state instead of drawing fake bars.

## Local Browser Evidence
- Screenshot: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_chart_real_20260531\evidence\w7_paper_sprint\trading-room-real-chart-local-20260531.png`
- Report: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_chart_real_20260531\evidence\w7_paper_sprint\trading-room-real-chart-local-20260531.json`
- Local note: backend API was not running with authenticated data locally, so the frame correctly rendered a blocked state rather than fake candles. Production verification must confirm live candles after deploy.

## Tests
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web test -- lib/final-v031-paper-ticket.test.ts`
- `pnpm.cmd --dir packages/qa-playwright exec node scripts/verify-trading-room-real-chart-20260531.mjs`

## Hardlines
- No KGI live broker writes.
- No real-order promotion.
- No API/server/KGI SIM/F-AUTO files touched.
- No fake K-line fallback added.

## 2026-05-31 Follow-up: Indicators and Symbol Sync
- Added real volume/price support and resistance lines to the shared company/trading-room chart core.
- Added real plan-level price lines for AI/plan handoff entry, stop, and target values.
- Propagated `entry`, `stop`, and `tp` from `/api/ui-final-v031/paper-trading-room` into `/final-v031/portfolio/kline-frame`.
- Exposed symbol selection to the final-v031 hydration layer so the chart frame, outer header, and paper-ticket symbol field stay aligned.
- Local browser smoke screenshot: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_indicators_20260531\evidence\w7_paper_sprint\trading-room-real-chart-local-20260531.png`
- Local browser smoke report: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_indicators_20260531\evidence\w7_paper_sprint\trading-room-real-chart-local-20260531.json`
- Local limitation: owner session is not available on `127.0.0.1`, so local smoke verifies formal blocked state, symbol/header/ticket sync, and no fake chart. Production browser verification after deploy must confirm live canvas plus indicator readout.
