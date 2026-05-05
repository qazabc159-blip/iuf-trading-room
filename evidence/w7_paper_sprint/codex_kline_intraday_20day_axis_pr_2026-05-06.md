# Codex K-line intraday 20-day axis PR — 2026-05-06

Status: DEPLOYED + PRODUCTION VERIFIED

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

## Production Verification

PR #207 merged to main `2e8a91f`, Railway web/api deploy succeeded, and production smoke is complete.

- One-time authenticated Playwright session succeeded; no credential or cookie value was written to evidence.
- `GET https://api.eycvector.com/api/v1/companies/2330/kbar?days=20` returned HTTP 200, `source=FINMIND`, `state=LIVE`, `rowCount=5320`, `daysRequested=20`, `daysReturned=20`, `candidateDatesScanned=51`, `dateRange=2026-04-07..2026-05-05`.
- `GET https://api.eycvector.com/api/v1/data-sources/finmind/status` returned HTTP 200, `state=LIVE_READY`, `tokenPresent=true`, Sponsor quota `2344 / 6000`, `datasetCount=16`, `readyCount=14`.
- Browser DOM found 7 visible chart canvases on `/companies/2330`.
- Browser click smoke passed for `1分`, `5分`, `15分`, `60分`, `10日`, and `20日`; each state kept a visible chart canvas and did not show `no_kbar_rows` or `分 K 無資料`.
- Screenshot manifest: `evidence/w7_paper_sprint/production_smoke_pass123_kline_autologin_2026-05-06/manifest.json` and `manifest-clicks.json`.

## Next Technical Slice

- The next genuine K-line improvement is intraday interaction quality: make 1-minute default to the latest trading day, keep 5/10/20-day views as explicit range choices, and add pan/zoom/readout behavior so minute charts feel like an analysis tool instead of only a static verification chart.
