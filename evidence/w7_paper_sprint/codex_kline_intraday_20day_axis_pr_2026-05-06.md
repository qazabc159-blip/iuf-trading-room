# Codex K-line intraday 20-day axis PR — 2026-05-06

Status: READY FOR PR

Trade Capability Score: +1

## Workflow Improved

`/companies/:symbol` minute K-line is now a more credible Taiwan-stock chart surface:

- FinMind Sponsor KBar route can return up to 20 recent trading days instead of 5.
- Backend candidate scan skips weekends and uses Taipei date as the default KBar anchor.
- Frontend requests 20 days for the company page so 5/15/60-minute views have enough history.
- Intraday range buttons now expose 1日 / 5日 / 10日 / 20日.
- Compressed intraday axis no longer falls back to synthetic dates when the chart library asks for non-exact tick labels; it maps to the nearest real FinMind KBar label.

## Endpoint / Source

- `GET /api/v1/companies/:id/kbar?date=YYYY-MM-DD&days=20`
- Source: FinMind `TaiwanStockKBar` only.
- Display use only. Not a paper fill source, not a risk source, not a recommendation source.

## State Semantics

- `LIVE`: real token-backed FinMind KBar rows are present.
- `EMPTY`: no FinMind KBar rows returned for recent trading dates.
- `BLOCKED`: token/API/backend read path unavailable.
- UI continues to show raw 1-minute row count and displayed trading-day count instead of implying synthetic continuous minutes.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/api exec node --test --import tsx src/data-sources/finmind-client.test.ts` PASS 11/11
- `pnpm.cmd --filter @iuf-trading-room/api build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check -- apps/api/src/server.ts apps/web/lib/api.ts apps/web/app/companies/[symbol]/page.tsx apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx` PASS with CRLF warnings only

## Stop-Line Proof

- No token value displayed or logged.
- No live submit.
- No KGI SDK / broker write-side.
- No migration/schema/destructive DB action.
- No fake-live chart.
- No paper fill or risk source change.
- No buy/sell recommendation wording.

## Next

Open PR, wait for CI/deploy, then production-smoke `/companies/2330` at desktop width:

- API `days=20` returns `source=FINMIND`, `state=LIVE`, `daysRequested=20`.
- Page has chart canvas and 1分 / 5分 / 15分 / 60分 controls.
- 10日 / 20日 controls render.
- Tick labels do not show synthetic 2026-01 base date.
