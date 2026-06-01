# Trading Room UX Stability Fix - 2026-05-31

## Scope

- Page: `/portfolio` / `/api/ui-final-v031/paper-trading-room`
- Owned surface: frontend `apps/web`
- Non-goals: no KGI live broker writes, no real-order promotion, no backend KGI SIM or F-AUTO changes.

## Fixed

- Removed the `rev=Date.now()` cache-buster from the real K-line iframe URL.
- Added iframe `src` comparison so the chart is only reloaded when the selected symbol or handoff levels actually change.
- Converted the trading room shell to a single-viewport layout with fixed left / center / right columns.
- Removed native white horizontal scrollbars from the right ticket panel and iframe shell.
- Preserved the bottom tape / ledger as compact fixed sections instead of hiding core trading functions.
- Moved the K-line readout ribbon out of chart overlay mode for trading-room compact mode so it does not block candles or price labels.
- Reduced trading-room iframe K-bar prefetch from 20 trading days to 5 trading days to reduce initial frame load pressure.
- Hid RSI/MACD subpanels only in the compact trading-room frame; the full company-page chart still keeps oscillator panels.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web test` - PASS, 229 tests
- `git diff --check` - PASS

## Browser Evidence

- Local direct route screenshot:
  `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_ux_stability_20260531\evidence\w7_paper_sprint\trading-room-ux-stability-local-direct-20260531.png`
- Local direct route report:
  `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_trading_room_ux_stability_20260531\evidence\w7_paper_sprint\trading-room-ux-stability-local-direct-20260531.json`

Local direct route is not owner-authenticated, so backend company / chart data can return `fetch failed`; this browser pass verifies layout mechanics and iframe stability:

- `loadedAtMs`: 411
- `iframeSrcStable`: true over 25 seconds
- right ticket `overflow-x`: hidden
- right ticket `scrollWidth == clientWidth`: true
- main document `scrollHeight == clientHeight`: true
- K-line iframe body overflow: hidden

Production owner-session verification is required after PR deploy.
