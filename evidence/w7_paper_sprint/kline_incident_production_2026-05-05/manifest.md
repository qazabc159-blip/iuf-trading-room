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

## 2026-05-05 23:36 Taipei - Codex K-line production recheck after PR #195

- Verdict update: `VERIFIED HEALTHY` for the checked production API + page path. The earlier `BROKEN` state was real at 22:00-23:10, but current production no longer matches that state.
- Railway deploy state: web latest deployment is `SUCCESS` for `831a4b044f934c48e8bff6c28c4ef7bd1d6edc97`; api latest deployment is also on PR #195 code.
- Authenticated API evidence, token-safe:
  - `/api/v1/data-sources/finmind/status`: `state=LIVE_READY`, `tokenPresent=true`, `requestCount=1351`, `errorCount=0`, `errorRatePct=0`.
  - `/api/v1/companies/1104/ohlcv?from=2026-04-25&interval=1d`: `rows=5`, `nonMock=5`, `firstSource=tej`, latest bar `2026-05-04`.
  - `/api/v1/companies/1104/kbar?date=2026-04-29`: `state=LIVE`, `rows=49`, resolved date `2026-04-29`.
  - `/api/v1/companies/2330/ohlcv?from=2026-04-25&interval=1d`: `rows=6`, `nonMock=6`, `firstSource=tej`, latest bar `2026-05-05`.
  - `/api/v1/companies/2330/kbar?date=2026-04-29`: `state=LIVE`, `rows=266`, resolved date `2026-04-29`.
- Railway log evidence: `ohlcv-finmind-sync` is actively fetching FinMind rows and upserting them, with recent lines such as `barsFromApi=5/6`, `barsUpserted=5/6`, `error=none`.
- Browser evidence: Playwright authenticated production QA on `https://app.eycvector.com/companies/1104?codexQa=2` at 1365px saved:
  - `evidence/w7_paper_sprint/kline_incident_production_2026-05-05/company1104_prod_1365.png`
  - `evidence/w7_paper_sprint/kline_incident_production_2026-05-05/company1104_prod_1365.json`
  The page text includes `FinMind / TEJ`, latest close `28.25`, latest date `2026-05-04`, daily `726 根K 線`, and minute K state `正常 / FinMind Sponsor 2026-05-04 已回傳 119 根 1 分 K，可彙整 1 / 5 / 15 / 60 分`.
- Current user-visible discrepancy class: likely stale browser view, stale screenshot timing, or front-end diagnostics copy lag rather than missing Railway token or missing production FinMind requests.
- Stop-line proof: no token displayed/logged; no order route changed; no KGI/broker write-side; no migration/schema/destructive DB; no fake-live chart.

## 2026-05-05 23:55 Taipei - Diagnostics truth patch

- Root-cause update: production FinMind requests are active and healthy, but diagnostics could still show misleading `free` / `600` / `mock` defaults when the optional quota/source env vars were not set.
- Fix: `/api/v1/data-sources/finmind/status`, `/api/v1/diagnostics/finmind`, and shared FinMind metadata now derive tier/limit from token presence plus `FINMIND_QUOTA_TIER`, `FINMIND_TIER`, or `FINMIND_QUOTA_LIMIT_PER_HOUR`. Sponsor 999 defaults to the operator-declared 6000/hour.
- Fix: diagnostics no longer defaults OHLCV source to `mock` when the token exists and recent in-process FinMind fetches are healthy; it reports `finmind` for a healthy active fetch path and `pending` if no successful path has been observed.
- Stop-line proof: no token value is returned; only token presence, process counters, tier label, and quota limit are exposed. No order, broker/KGI, migration, schema, or destructive DB path changed.
