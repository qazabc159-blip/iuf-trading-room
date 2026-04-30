# Jason PR-H1: FinMind Adapter Evidence
**Branch**: `jason/finmind-adapter-2026-04-30`
**Date**: 2026-04-30
**Status**: DRAFT — awaiting Bruce verify + Elva ACK

## Commit Summary
- `apps/api/src/data-sources/finmind-client.ts` (NEW) — FinMindClient: 8 dataset methods, Redis cache, retry+backoff
- `apps/api/src/data-sources/finmind-client.test.ts` (NEW) — 8 tests (T1-T8)
- `apps/api/src/jobs/ohlcv-finmind-sync.ts` (NEW) — EOD sync job, dry-run support
- `apps/api/src/server.ts` (MODIFIED) — 4 new routes + TWSE routes
- `apps/api/src/data-sources/twse-openapi-client.ts` (NEW) — TWSE announcements adapter
- `.env.example` (MODIFIED) — added FINMIND_API_TOKEN / OHLCV_SOURCE / OHLCV_SYNC_DRY_RUN

## Test Count
8 tests in finmind-client.test.ts (T1-T8)

## Stop-line Check
| Line | Status |
|---|---|
| FINMIND_API_TOKEN not in repo/code/log | PASS — env only |
| No KGI SDK import | PASS |
| No broker surface | PASS |
| No /order/create | PASS |
| Auth required on all new routes | PASS — inside /api/v1/* session middleware |
| Token missing → fallback empty array, not throw | PASS |
| Cache failure → fail-open | PASS |
| OPENAI_MODEL unchanged (gpt-5.4-mini) | PASS — not touched |

## New Routes (all require session cookie)
- `GET /api/v1/companies/:id/financials?period=Q&limit=8`
- `GET /api/v1/companies/:id/revenue?limit=24`
- `GET /api/v1/companies/:id/chips?days=30`
- `GET /api/v1/companies/:id/dividend?years=5`
- `GET /api/v1/companies/:id/announcements?days=30` (PR-H4)

## Outstanding TODOs
- FINMIND_API_TOKEN needs to be set in Railway env by operator (楊董 or admin)
- ohlcv-finmind-sync.ts job needs a cron trigger or manual invocation path wired
- Live smoke test against real FinMind API deferred (requires token)

## Railway Env Runbook (operator only)
1. Go to Railway → api service → Variables
2. Add `FINMIND_API_TOKEN` = (value from FinMind account dashboard)
3. Add `OHLCV_SOURCE` = `finmind` (to enable live sync)
4. Redeploy api service
5. Verify: `GET /api/v1/companies/2330/financials` returns real data (not empty)
   - Token MUST NOT appear in logs, Railway dashboard screenshots, or PR comments
