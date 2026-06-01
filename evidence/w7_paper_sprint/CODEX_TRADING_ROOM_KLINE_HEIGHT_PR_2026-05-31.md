# Trading Room K-line Height Follow-up - 2026-05-31

## Scope

- Follow-up after the K-line width fix.
- Fixes the remaining compact-frame issue where the chart filled the width but the bottom readout could be clipped by the trading-room iframe height.
- Frontend only. No backend, KGI, contracts, migrations, broker/risk, or live-order paths touched.

## Changes

- Sets compact trading-room K-line chart height to 430px so the real chart, volume bars, and non-overlay readout fit inside the iframe viewport.
- Keeps the company page K-line height unchanged.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

