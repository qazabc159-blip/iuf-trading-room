# Codex K-line Intraday Density Breakthrough — 2026-05-06

Status: READY FOR PR
Trade Capability Score: +1

## What Changed

- Page: `/companies/[symbol]`
- Component: `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`
- CSS: `apps/web/app/globals.css`
- Source: `/api/v1/companies/:id/kbar?days=20` via FinMind Sponsor minute K.

## Why

Minute K looked broken on low-liquidity Taiwan stocks because the chart only plotted real traded minutes. For symbols like `1104`, the API does return real FinMind 1-minute rows, but many market minutes have no trades. The UI did not explain that sparsity clearly enough.

## New Semantics

- LIVE: FinMind 1-minute rows exist and are rendered.
- Sparse LIVE: rows exist, but traded-minute coverage is low; the UI marks this as sparse market activity, not a data-source failure.
- EMPTY/BLOCKED: unchanged.
- No fake candles: missing minutes are not filled with synthetic OHLC bars.

## Behavior

- When the user switches from daily K to minute K, the component now chooses a practical range:
  - liquid stocks stay on `1日`,
  - sparse stocks auto-expand to `5日` or `20日` if one trading day has too few traded minutes.
- The chart now displays:
  - raw FinMind 1-minute rows in the selected range,
  - expected market minute slots,
  - traded-minute coverage percentage,
  - aggregated bar count,
  - whether the range was auto-expanded.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com pnpm.cmd --filter @iuf-trading-room/web build` PASS

## Stop-line Proof

- No token display.
- No fake-live data.
- No order route touched.
- No KGI write-side touched.
- FinMind remains display/source data only; it is not used as paper fill or risk source.
