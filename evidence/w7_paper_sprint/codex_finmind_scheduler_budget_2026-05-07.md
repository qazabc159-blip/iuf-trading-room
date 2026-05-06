# Codex FinMind Scheduler Budget Fix - 2026-05-07

Status: READY FOR PR

## Why

Production proved that `FINMIND_API_TOKEN` is present and being used. After the workspace slug fix, the API began ingesting real FinMind OHLCV rows, but startup launched the full market sweep:

- OHLCV tried 3,469 tickers immediately.
- Monthly revenue, financials, valuation, and news also started at boot.
- FinMind returned `402 Requests reach the upper limit`.

This means the data lane is live, but the scheduler shape was too aggressive. The fix is to make ingestion budgeted and rotating instead of all-market-at-once.

## Changed

File:

- `apps/api/src/server.ts`

Behavior:

- Adds process-local rotating cursor batches for FinMind scheduler jobs.
- Limits OHLCV default boot/tick batch to 500 tickers.
- Limits monthly revenue / valuation / dividend / market value default batches to 120 tickers.
- Limits financials default batch to 50 tickers because it fans out to financial statements, balance sheet, and cashflow.
- Limits intraday-style datasets such as institutional / margin-short to 80 tickers.
- Limits experimental stock news to 40 tickers.
- Adds env overrides:
  - `FINMIND_SCHEDULER_BATCH_SIZE`
  - `FINMIND_INTRADAY_DATASET_BATCH_SIZE`
  - `FINMIND_OHLCV_BATCH_SIZE`
  - `FINMIND_MONTHLY_REVENUE_BATCH_SIZE`
  - `FINMIND_FINANCIALS_BATCH_SIZE`
  - `FINMIND_INSTITUTIONAL_BATCH_SIZE`
  - `FINMIND_MARGIN_SHORT_BATCH_SIZE`
  - `FINMIND_SHAREHOLDING_BATCH_SIZE`
  - `FINMIND_DIVIDEND_BATCH_SIZE`
  - `FINMIND_MARKET_VALUE_BATCH_SIZE`
  - `FINMIND_VALUATION_BATCH_SIZE`
  - `FINMIND_STOCK_NEWS_BATCH_SIZE`
  - `FINMIND_SCHEDULER_INITIAL_STAGGER_MS`
- Staggers initial FinMind scheduler starts instead of firing every dataset at the same moment.
- Skips scheduler work while the FinMind upstream circuit is open, so an active 402/429 cooldown does not create thousands of fake empty rows or wasted loops.

## Expected Production Effect

- Startup should log smaller batches such as `ohlcv batch size=500/3469`, not full-market sync.
- A full market OHLCV pass should complete over multiple scheduled ticks rather than one boot burst.
- FinMind quota should stop jumping to the upper limit during a deploy.
- UI should gradually move from stale/no-data states to FinMind-backed rows as batches complete.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/api build` PASS
- `git diff --check` PASS with CRLF warnings only

## Stop-Line Proof

- No Railway secret read or write.
- No token value logged or persisted.
- No KGI SDK or broker write-side.
- No live submit or `/order/create`.
- No DB schema or destructive migration.
- No fake live data; empty/degraded states remain truthful.

## Next After Deploy

1. Verify Railway API deploy.
2. Check logs for `batch start=... size=...`.
3. Confirm no new rapid `402 Requests reach the upper limit` burst after boot.
4. Continue OpenAlice brief automation and homepage source-truth work only after data ingestion is stable.
