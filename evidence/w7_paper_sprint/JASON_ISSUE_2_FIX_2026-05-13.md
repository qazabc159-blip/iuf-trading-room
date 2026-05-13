# JASON_ISSUE_2_FIX — FinMind Backfill + tw_dividend Support
**Date**: 2026-05-13
**PR**: #436 `fix/api-finmind-backfill-extend-issue2-2026-05-13`
**Commit**: 50115ca
**Status**: OPEN — awaiting CI + Bruce merge

## Root Cause
5/13: `TaiwanStockDividend` rowCount=0 (token refreshed, ingest cron not rescheduled).
`TaiwanStockPrice`/`TaiwanStockKBar` empty = `companies_ohlcv` zero rows today.
Manual backfill endpoint did NOT support `tw_dividend` — only 3 datasets.

## Changes
### `apps/api/src/jobs/finmind-full-ingest.ts`
- `BackfillDataset` type: `"companies_ohlcv" | "tw_institutional_buysell" | "tw_margin_short" | "tw_dividend"` (added tw_dividend)
- `tableMap`: added `tw_dividend: "tw_dividend"` entry
- `runDatasetBackfill()`: added `tw_dividend` dispatch branch → `runDividendSync(tickerBatch, { startDate, endDate })`

### `apps/api/src/server.ts`
- `finmindBackfillBodySchema`: Zod enum extended with `"tw_dividend"`
- Comment updated: 3→4 datasets

## Operator Actions After Deploy
```bash
# 1. Trigger companies_ohlcv backfill (covers TaiwanStockPrice + KBar)
POST /api/v1/internal/finmind/backfill
{ "dataset": "companies_ohlcv", "from": "2026-05-13", "to": "2026-05-13", "batch_size": 200 }

# 2. Trigger tw_dividend backfill (TaiwanStockDividend)
POST /api/v1/internal/finmind/backfill
{ "dataset": "tw_dividend", "from": "2026-05-01", "to": "2026-05-13", "batch_size": 50 }

# 3. Alternatively, full 11-dataset sync
POST /api/v1/internal/finmind/sync-now
{}
```

## Verify
```
GET /api/v1/data-sources/finmind/status
```
- `TaiwanStockPrice` / `TaiwanStockKBar`: rowCount > 0
- `TaiwanStockDividend`: rowCount > 0, state=LIVE

## Build
- tsc: 0 errors (apps/api)
- Lane: 2 files changed (finmind-full-ingest.ts + server.ts backfill section only)
