# Codex Portfolio Indicator Controls PR — 2026-05-29

## Scope

- Page: `/portfolio`
- Component surface: final-v031 paper trading room iframe
- Root cause: K-line overlay controls were rendered as decorative `<span>` labels. Playwright and user interaction could see the labels, but they were not robust form controls and did not own overlay visibility state.

## Change

- Converted MA20, VWAP, support/resistance, and plan-level labels into real `<button type="button">` controls.
- Added `data-layer` and `aria-pressed` state.
- Added `syncToolLayers()` so each click toggles the matching chart layer on/off.
- Added CSS hide rules for MA20, VWAP, support/resistance, and plan-level overlays.
- Preserved existing final-v031 tactical layout and visual style.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`
  - 18 files / 190 tests passed
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Local browser interaction:
  - URL: `http://127.0.0.1:3109/api/ui-final-v031/paper-trading-room?symbol=2330&rev=indicator-controls-local`
  - Screenshot: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_portfolio_tools_20260529\evidence\w7_paper_sprint\portfolio-local-indicator-controls-20260529.png`
  - JSON: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_portfolio_tools_20260529\evidence\w7_paper_sprint\portfolio-local-indicator-controls-20260529.json`
  - MA20 / VWAP / support-resistance / plan-level all toggled `aria-pressed` true -> false -> true and chart `data-*` on -> off -> on.

## Notes

- Local browser run saw expected local backend proxy 500s because the dev server was not configured with production backend env. The overlay controls themselves verified cleanly. Final production verification should run after deploy.
