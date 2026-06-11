# Trading Room K-line Deep Refetch Guard — 2026-06-05

## Shipped

- Added a client-side production guard in `OhlcvCandlestickChart` for compact trading-room mode.
- If the embedded trading-room K-line receives shallow daily props, it now refetches 10 years of official daily OHLCV through the same-origin backend proxy with `cache: "no-store"`.
- Mock rows are filtered out; shallow rows are not promoted into a product chart.
- Trading-room chart rendering now requires the product daily depth gate of 720 official daily bars before drawing the formal trend chart.

## Production Data Check

Owner-cookie API check against production:

- `2330`: 2,437 daily bars, first `2016-06-06`, latest `2026-06-05`, source `tej`
- `1514`: 2,437 daily bars, first `2016-06-06`, latest `2026-06-05`, source `tej`
- `6202`: 2,436 daily bars, first `2016-06-06`, latest `2026-06-04`, source `tej`

## Verification

- `apps\web\node_modules\.bin\vitest.CMD run apps/web/lib/final-v031-paper-ticket.test.ts`
  - 44 tests passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - Passed.
- `pnpm.cmd --filter @iuf-trading-room/web build`
  - Passed. Existing OpenTelemetry/Sentry warning only.

## Notes

- This does not fake or synthesize candles.
- If production ever returns shallow official daily K again, the trading-room iframe tries a no-store deep refetch first; if that still fails, it shows an explicit insufficient-depth state instead of drawing a misleading three-bar chart.
