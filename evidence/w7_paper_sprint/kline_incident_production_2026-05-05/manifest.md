# K-line Incident Production Verification - 2026-05-05

Checked: 2026-05-05T14:00:01.521Z

## Verdict

BROKEN

## Route

- https://app.eycvector.com/companies/2330?codexKlineIncident=2026-05-05T14%3A00%3A01.521Z
- HTTP status: 200

## Endpoint Evidence

- Company: 2330 / 906c9073-d458-4fd9-8ed8-7dfcb745851c
- OHLCV endpoint: GET /api/v1/companies/{id}/ohlcv?interval=1d&from=2023-05-05
- OHLCV rows: 200
- Non-mock rows: 0
- Last OHLCV: {"dt":"2026-05-04","close":115.73,"source":"mock"}
- KBar state: EMPTY / rows 0 / reason no_kbar_rows_for_recent_dates
- FinMind diagnostics: tokenPresent=true, ohlcvSource=mock, requestCount=357, errorCount=357

## DOM Evidence

- K-line panel exists: true
- Chart shell exists: false
- Canvas count in K-line: 0
- SVG count in K-line: 0
- Terminal texts: 無資料 正式日 K 目前沒有可用資料。

## Screenshots

- Full page: C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_demo_ui_repair\evidence\w7_paper_sprint\kline_incident_production_2026-05-05\companies-2330-production-1365.png
- K-line panel: C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_demo_ui_repair\evidence\w7_paper_sprint\kline_incident_production_2026-05-05\companies-2330-kline-panel-1365.png

## Stop-line Proof

- Token leak in DOM evidence: not detected by script output.
- Order submit path touched: no.
- Broker/KGI write-side touched: no.
- Mock presented as live: frontend did not render mock rows as a chart; it hid them and showed no-data state.

## Fix Branch Notes

- Branch: codex/kline-incident-verify-20260505
- Root cause class: FINMIND_LATEST_DATE_QUERY + MOCK_CACHE_POISONING
- Production logs showed FinMind OHLCV calls using `end_date=2026-05-05` and returning HTTP 400. Because the app clock is ahead of FinMind's latest Taiwan trading calendar, latest-data queries must omit `end_date` unless a caller explicitly supplies `to`.
- `companies-ohlcv` also returned cached all-mock OHLCV rows before attempting FinMind. That kept `/companies/2330` in `EMPTY` even after the token and scheduler were fixed.
- Fix: omit `end_date` for implicit latest OHLCV queries, preserve explicit `to`, ignore all-mock cache when FinMind daily retry is available, and stop caching generated mock rows for token-backed Taiwan daily requests.
- Post-deploy smoke after PR #193 showed Railway services deployed despite GitHub Actions reporting a Railway CLI timeout, but OHLCV remained all mock. Fresh API logs changed from HTTP 400 to HTTP 403, so the next fix adds the official FinMind `Authorization: Bearer <token>` header while keeping the token query parameter for compatibility and redacted logs.
- Post-deploy smoke after PR #194 showed API deploy success and authenticated `/api/v1/companies/{id}/ohlcv` still returned `rows=200`, `nonMockRows=0`, `source=mock`. API logs still showed redacted FinMind HTTP 403/400, so the remaining K-line blocker is FinMind token/account/API acceptance rather than chart CSS or frontend rendering. Follow-up: diagnostics state must surface DEGRADED when recent FinMind fetch errors are high; do not show fake green while OHLCV is all mock.
- Files: `apps/api/src/data-sources/finmind-client.ts`, `apps/api/src/companies-ohlcv.ts`, `apps/api/src/jobs/ohlcv-finmind-sync.ts`, `apps/api/src/server.ts`.
- Local checks: `pnpm --filter @iuf-trading-room/api typecheck` PASS; `pnpm --filter @iuf-trading-room/api exec node --test --import tsx src/data-sources/finmind-client.test.ts` PASS 11/11; inline FinMind latest URL probe PASS (`end_date` omitted, rows mapped).
