# Trading Room K-line depth guard — 2026-06-06

## Scope

- Fix the trading room product issue where sparse derived intervals (weekly/monthly) could briefly render as a 3-bar chart.
- Keep company announcement detail panels expandable when TWSE provides URL/source metadata but no body text.
- Keep company tick detail panels product-readable by falling back to labeled FinMind K-bar aggregate rows instead of a static blocked shell.

## Product change

- `OhlcvCandlestickChart` now treats sparse non-1d derived intervals in compact trading-room mode as insufficient and auto-returns to `1d/all`.
- The UI no longer allows a 3-bar monthly/weekly chart to appear as if it were a meaningful product chart.
- Company announcements now expose formal-announcement detail states for URL/source-only records.
- Company tick panels label fallback data as `FinMind 分K成交摘要` and explicitly say it is not raw tick data.

## Production data observation

Earlier in this cycle, production OHLCV depth was verified with owner cookie:

- `2330` daily bars: `2437`, latest `2026-06-05`, source `tej`
- `1514` daily bars: `2437`, latest `2026-06-05`, source `tej`
- `6202` daily bars: `2436`, latest `2026-06-04`, source `tej`

Interpretation: the product issue is not that backend only has 3 bars. Backend has deep daily history; the frontend allowed sparse derived intervals to render before returning to a usable daily view.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- `apps/web/node_modules/.bin/vitest.CMD run lib/final-v031-paper-ticket.test.ts lib/company-page-panels.test.ts` — PASS, 48/48
- `pnpm.cmd test` — PASS, 544/544

## Not run locally

- `pnpm.cmd --filter @iuf-trading-room/web build` could not be completed locally because the sandbox blocked Google Fonts network access and the escalation request was rejected by environment quota. GitHub CI must provide the production build verification.
- A fresh production API recheck was attempted after the final patch, but local sandbox network to `api.eycvector.com` was blocked. No fake browser/API pass is claimed here.

## Guardrail

This PR does not touch:

- KGI live broker write paths
- real-order promotion
- F-AUTO / S1 / Quant Lab
- contracts, migrations, or broker/risk backend code

