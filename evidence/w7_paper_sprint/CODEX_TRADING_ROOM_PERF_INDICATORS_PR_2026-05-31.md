# Trading Room Performance + Indicator UX Evidence - 2026-05-31

Scope:
- `/portfolio` / final v031 paper trading room only.
- No API broker/risk/contracts/migration/KGI SIM/F-AUTO changes.

Changes:
- Added an immediate K-line loading state so the embedded frame is never blank while real OHLCV/K-bar data is loading.
- Parallelized the trading-room K-line frame daily OHLCV and FinMind K-bar requests.
- Made the embedded K-line controls usable in the first viewport: compact top toolbar, actionable interval/range buttons, MA/VWAP/support-plan toggles, and mouse-wheel zoom / drag pan enabled in lightweight-charts.
- Added a data-driven indicator summary derived from MA20, MA60, VWAP, RSI, MACD, and volume-price support/resistance.
- Kept company-page K-line behavior unchanged.

Verification:
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Local browser smoke against local web + production API:
  - `IUF_QA_BASE_URL=http://127.0.0.1:3021 pnpm.cmd --dir packages/qa-playwright exec node scripts/verify-trading-room-perf-indicators-20260531.mjs`

Browser evidence:
- Screenshot: `evidence/w7_paper_sprint/trading-room-perf-indicators-local-20260531.png`
- JSON: `evidence/w7_paper_sprint/trading-room-perf-indicators-local-20260531.json`

Smoke result summary:
- `domContentLoadedMs`: ~4.6s
- `firstChartVisibleMs`: ~6.9s
- `klineSrcStable`: true after 12s idle wait
- Console errors: none
- Request failures: none
- 5-minute interval interaction exposed real FinMind K-bar data state.
