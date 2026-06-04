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
