# Core K-line Backfill Priority - 2026-06-04

## Root Cause

FinMind Sponsor entitlement had expired, so production OHLCV deep backfill was blocked by FinMind `register` tier errors. After Sponsor renewal, API redeploy `26948792327` restarted the scheduler and production began writing real daily OHLCV rows again.

## Production Diagnostic After Sponsor Renewal

Endpoint:

`GET https://api.eycvector.com/api/v1/diagnostics/kline-depth?symbols=0050,2330,6202,2317,2454`

Observed at `2026-06-04T11:38:20Z`:

- `0050` READY: 2431 real 1d bars, first `2016-06-06`, latest `2026-06-04`
- `2330` READY: 2437 real 1d bars, first `2016-06-04`, latest `2026-06-04`
- `6202` SHALLOW: 21 real 1d bars
- `2317` SHALLOW: 28 real 1d bars
- `2454` SHALLOW: 28 real 1d bars

## Fix

- Prioritize product-visible symbols during owned daily K-line deep backfill:
  - trading-room defaults: `2330`, `6202`, `2317`, `2454`
  - fixed heatmap representative pools: semiconductor, AI server, financials, shipping, steel, telecom
- Increase default deep backfill batch from `12` to `48` so the customer-visible pool is repaired first.
- Keep the existing FinMind sponsor quota guard via `FINMIND_OHLCV_DEEP_BACKFILL_BATCH_SIZE`.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `cd apps/web; .\node_modules\.bin\vitest.CMD run lib\final-v031-paper-ticket.test.ts` PASS, 38/38

## Remaining Prod Follow-Up

After this PR deploys, trigger/restart API once more and verify:

- `6202` >= 720 real 1d bars
- `2317` >= 720 real 1d bars
- `2454` >= 720 real 1d bars
- Trading-room chart renders hundreds/thousands of owned candles instead of 3-28 candles.

## Follow-Up Fix: Preserve Priority Order

After PR #974 deployed, Railway logs still showed the first deep-backfill tickers as low-code symbols (`1295`, `1313`) instead of `6202` / `2317` / `2454`.

Second root cause:

- `resolveOhlcvDeepBackfillCandidates()` correctly sorted customer-visible priority tickers first.
- `takeFinMindSchedulerBatch()` then re-sorted every job alphabetically by ticker, wiping out the priority order.

Fix:

- Add `preserveOrder=false` to `takeFinMindSchedulerBatch()`.
- Call deep OHLCV backfill with `preserveOrder=true`.
- Leave other FinMind schedulers unchanged.

## Follow-Up Fix: Owner Targeted OHLCV Backfill

After PR #976 deployed, production confirmed the priority path works (`6202`, `2317`, `2454`, `2308` moved to READY), but recovery still depended on the scheduler working through the remaining core tickers one by one.

Third root cause:

- Existing Owner backfill endpoint could only backfill `companies_ohlcv` by workspace batch.
- It did not accept target symbols, so a product-visible ticker such as `2412` or `2603` could not be backfilled directly.

Fix:

- Add optional `symbols` to `POST /api/v1/internal/finmind/backfill` for `dataset=companies_ohlcv`.
- Preserve the requested symbol order and write only real FinMind OHLCV rows.
- Reject `symbols` for non-OHLCV datasets so the endpoint remains narrow.

## PR #983: All-TW-Ticker K-line Read-Through + DB Boot Gate

Yang clarified the product requirement: trading-room/company pages must support all legal Taiwan tickers, not only the fixed 10-15 stock heatmap representative pools.

Fixes in branch `fix/derive-week-month-kline-from-daily-20260604`:

- `apps/api/src/companies-ohlcv.ts`
  - Rejects shallow 3-bar weekly/monthly caches.
  - Derives weekly/monthly K-lines from real official daily OHLCV, so chart period changes do not collapse to 3 candles.
- `apps/api/src/server.ts`
  - `resolveCompany()` now read-throughs missing legal 4-6 digit tickers from official TWSE + TPEx company master lists.
  - Missing official companies are inserted as minimal official rows, then regular OHLCV/quote paths can backfill them.
  - This is the product boundary: heatmap representative pools stay fixed for aesthetics; trading-room/company pages are not limited to those pools.
- `packages/db/src/client.ts`
  - Production DB pool/connect timeout increased to reduce auth/company/K-line starvation during data backfill.
- `scripts/start-api-railway.mjs`
  - Railway API migration gate is now unconditional fail-closed.
  - If Postgres/migrations cannot complete, API refuses to start instead of serving `/health` while company/K-line panels are broken.
- `apps/api/src/server.ts`
  - DB-heavy schedulers/outbox/seeds delay 180s in production database mode so owner login, company lookup, and K-line reads warm first.

Local verification:

- `node --import ./tests/setup-test-env.mjs --import tsx --test ./apps/api/src/companies-ohlcv.test.ts` PASS, 10/10
- `pnpm.cmd --filter @iuf-trading-room/db build` PASS
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `node --import ./tests/setup-test-env.mjs --import tsx --test ./tests/ci.test.ts` PASS, 512/512
- Targeted `RAILWAY-BOOT-1` guard PASS after unconditional fail-closed patch.

Production deploy status:

- API-only deploy attempts on PR #983 reached Railway but failed because Railway API container still cannot connect to Postgres private host:
  - `write CONNECT_TIMEOUT pg.railway.internal:5432`
  - `migrate` advisory lock attempts time out before any product DB read can succeed.
- Latest tested deploy `26967841324` correctly shows:
  - `migrationRequired=true`
  - `migrationTimeoutMs=120000`
  - API refuses to start after migration timeout.
- This is now a platform/DB connectivity blocker, not a K-line feature-code blocker.

Updated production blocker at `2026-06-04 17:38Z`:

- Railway `pg (Postgres)` service is `Crashed`.
- `pg-volume` is only `500MB`; Railway metrics show current usage around `508.7MB`.
- Postgres restart fails during automatic recovery:
  - `Could not write to file "pg_xact/0012" ... No space left on device`
  - API logs then show `write CONNECT_TIMEOUT pg.railway.internal:5432`
- PR #983 Playwright P0 Smoke fails at owner login with `HTTP 502`, consistent with DB being unavailable.
- This means company-page blanks and K-line read failures are currently blocked by production Postgres capacity/recovery, not by a frontend decision to hide/delete panels.

Product boundary re-confirmed:

- Fixed 10-15 stock pools are only for the heatmap visual product.
- Trading-room and company pages must support all legal Taiwan tickers via official TWSE/TPEx company master read-through and OHLCV backfill.

Required platform action before merge/deploy:

- Expand/recover Railway `pg-volume` for the production Postgres service. The current `500MB` volume is full and cannot complete crash recovery.
- After DB connectivity is restored, rerun PR #983 API deploy and verify:
  - arbitrary legal ticker company read-through works (examples: `2002`, `2412`, `2603`, `9958`, `0050`)
  - `1d` K-line returns hundreds/thousands of bars where FinMind has history
  - `1w`/`1mo` derive from daily bars, not shallow 3-bar caches
  - company page panels stop showing DB-backed blanks caused by `CONNECT_TIMEOUT`.
