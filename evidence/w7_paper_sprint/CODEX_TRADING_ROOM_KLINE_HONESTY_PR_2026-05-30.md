# Trading Room K-line Honesty Fix — 2026-05-30

## Scope

Frontend-only fix for the final-v031 paper trading room chart.

## Root Cause

- The trading room used its own SVG K-line renderer, not the company-page chart path.
- `5m` and `15m` controls requested `interval=1m` and then relabeled/aggregated on the client.
- If the request returned no bars or failed, the handler silently kept the previous chart, making a stale daily chart look like intraday data.
- When no bars existed, static support/resistance/plan lines could remain visible and look like real technical levels.

## Shipped

- `5m` now requests `interval=5m`; `15m` now requests `interval=15m`.
- `1m` is explicitly marked `NO_INTRADAY_DATA` until a verified 1m endpoint exists.
- Any no-data/fetch-failed timeframe clears candles, volume, MA20, VWAP, and OHLC legends.
- No-data state hides support/resistance and plan-level overlays so stale technical lines cannot remain on screen.
- Hydration always calls `drawChart()`, allowing the chart component to clear stale candles when a selected symbol has no OHLCV bars.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- lib/final-v031-paper-ticket.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke against local dev:
  - URL: `http://127.0.0.1:3310/api/ui-final-v031/paper-trading-room?symbol=6202`
  - Screenshot: `evidence/w7_paper_sprint/trading-room-kline-honesty-local-20260530.png`
  - JSON: `evidence/w7_paper_sprint/trading-room-kline-honesty-local-20260530.json`

## Browser Result

- `1m` shows explicit `NO_INTRADAY_DATA` and renders `0` candles.
- No timeframe request used `interval=1m`.
- Local backend proxy had no verified OHLCV available, and the UI displayed a formal no-data state instead of keeping a stale chart.

## Out Of Scope

This does not yet migrate the trading room to the company-page `lightweight-charts` renderer. It removes the misleading/stale chart behavior first, so the product no longer presents unavailable chart data as real.
