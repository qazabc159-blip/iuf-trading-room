# CODEX_TRADING_ROOM_KLINE_NAV_REPAIR_2026-06-04

## Scope

Repair trading-room K-line and app navigation regressions after the viewport shell change.

## Root Cause

- The trading-room full-viewport frame started at `left: 0` and hid `.app-sidebar`, so the global left navigation disappeared.
- OHLCV cache returned any non-mock cached rows immediately, even when the cache only held a tiny partial set such as three bars. That prevented FinMind historical backfill from running.
- The embedded trading-room K-line only requested three years of daily history and five days of minute K. That was too shallow for a product K-line.
- `OhlcvCandlestickChart` treated fewer than 12 weekly/monthly bars as a reason to replace the chart with a text card.

## Shipped

- Restored app sidebar visibility while keeping the trading-room frame scroll-free.
- Raised daily OHLCV product floor from 220 to 720 bars and DB query limit to 2500 bars.
- Prevented short real-data caches from blocking FinMind backfill.
- Expanded trading-room K-line requests to 10 years of daily OHLCV and 20 trading days of minute K.
- Stopped sparse weekly/monthly samples from replacing the real chart with a no-chart card.
- Added intraday no-data fallback to daily view when daily bars are available.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/api typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web build`
- `pnpm.cmd --filter @iuf-trading-room/api build`
- `apps/web/node_modules/.bin/vitest.CMD run lib/final-v031-paper-ticket.test.ts`

## Notes

- No fake K-line rows were added.
- No KGI live broker write path was touched.
- No broker/risk/contracts/migrations/F-AUTO/S1 lane was changed.
