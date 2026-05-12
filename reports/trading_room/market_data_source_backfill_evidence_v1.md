# Market Data Source Backfill — Evidence v1

**Branch**: `feat/api-market-data-source-backfill-wave2-2026-05-13`
**Date**: 2026-05-13
**Author**: Jason (backend strategy lane)
**Codex trigger**: Bruce 5/12 EOD verify — three tables missing row data

---

## Problem Statement

Bruce 5/12 EOD verified that `companies_ohlcv`, `tw_institutional_buysell`, and `tw_margin_short` had zero rows in production. The OpenAlice pipeline source pack marked all three as EMPTY. The LLM received empty data and produced hallucinated or date-empty briefs (root cause of PR #384 fix).

---

## Pre-fix Status (estimated)

| Table | State | Row Count | Min Date | Latest Date |
|---|---|---|---|---|
| companies_ohlcv | EMPTY | 0 | null | null |
| tw_institutional_buysell | EMPTY | 0 | null | null |
| tw_margin_short | EMPTY | 0 | null | null |

*Note: Production DB query required for real counts. See verification steps below.*

---

## Changes Delivered

### 1. `apps/api/src/jobs/finmind-full-ingest.ts`
- `DatasetStatusRow` now includes `minDate`, `lastIngestedAt`, `source` fields
- `queryAllDatasetStatus()` enhanced: queries `MIN(date)`, `MAX(fetched_at)` for each table
- `companies_ohlcv` added to dataset status (was missing — it is not in the 11-dataset DATASET_REGISTRY)
- `queryTableDateExtents()` helper: queries `MIN(date)`, `MAX(date)`, `MAX(fetched_at)` for trading-flow tables
- `queryOhlcvDateExtents()` helper: queries `MIN(dt)`, `MAX(dt)` for companies_ohlcv (uses `dt` column)
- `runDatasetBackfill()` new export: targeted date-range backfill for the 3 core tables
  - Accepts `dataset: "companies_ohlcv" | "tw_institutional_buysell" | "tw_margin_short"`
  - Accepts `from: YYYY-MM-DD`, `to: YYYY-MM-DD`, `batchSize?: number`
  - Respects `FINMIND_KILL_SWITCH` and requires `FINMIND_API_TOKEN`
  - Delegates to existing sync functions with explicit date range

### 2. `apps/api/src/server.ts`
- Added `POST /api/v1/internal/finmind/backfill` (Owner-only)
  - Body: `{ dataset, from, to, batch_size? }`
  - Validates from <= to, ISO date format
  - Writes audit log action `finmind.backfill` per run
  - Returns `DatasetBackfillResult` with rowsUpserted, state, error
- Imported `runDatasetBackfill` and `BackfillDataset` type
- `GET /api/v1/internal/finmind/ingest-status` now surfaces `minDate`, `lastIngestedAt`, `source` per dataset (auto-included via `queryAllDatasetStatus` changes)

### 3. `apps/api/src/openalice-pipeline.ts`
- Added all-sources-empty guard (step 3b) BEFORE LLM enqueue
- If every source has status EMPTY/ERROR/MOCK/MISSING/BLOCKED → skip enqueue
- `skippedReason: "all_sources_empty_no_data_for_llm: [source1=EMPTY, ...]"`
- Audit log written on skip
- Prevents hallucinated LLM content when tables are unfilled

### 4. `tests/ci.test.ts`
- BF10: `runDatasetBackfill` skips with `no_finmind_token` when token absent
- BF11: `runDatasetBackfill` skips with `kill_switch_active` when FINMIND_KILL_SWITCH=true
- BF12: `runDatasetBackfill` skips with memory-mode indicator when DB unavailable

---

## Build / Test Results

- contracts build: GREEN (tsc exit 0)
- api build: GREEN (tsc exit 0)
- tests: 239/239 PASS (3 new: BF10, BF11, BF12)

---

## Production Backfill Instructions (Bruce)

After PR merge and deploy, run these backfill calls with Owner credentials:

### Step 1: Verify current status
```
GET /api/v1/internal/finmind/ingest-status
```
Check `datasetStatus` for `companies_ohlcv`, `tw_institutional_buysell`, `tw_margin_short`.
Expect: `state=EMPTY`, `rowCount=0`.

### Step 2: Backfill companies_ohlcv (30 trading days ~ 2026-04-01 to 2026-05-13)
```
POST /api/v1/internal/finmind/backfill
{ "dataset": "companies_ohlcv", "from": "2026-04-01", "to": "2026-05-13", "batch_size": 50 }
```
Expected response: `state=synced`, `rowsUpserted > 0`

Note: 1700+ stocks × 30 days = large call. batch_size=50 means ~50 tickers per run.
For full coverage, run multiple times (the sync is idempotent — onConflictDoUpdate).
Or set batch_size=200 for faster coverage (quota: 6000/hr sponsor).

### Step 3: Backfill tw_institutional_buysell
```
POST /api/v1/internal/finmind/backfill
{ "dataset": "tw_institutional_buysell", "from": "2026-04-01", "to": "2026-05-13", "batch_size": 50 }
```

### Step 4: Backfill tw_margin_short
```
POST /api/v1/internal/finmind/backfill
{ "dataset": "tw_margin_short", "from": "2026-04-01", "to": "2026-05-13", "batch_size": 50 }
```

### Step 5: Verify row counts
```
GET /api/v1/internal/finmind/ingest-status
```
Expected:
- `companies_ohlcv`: `state=LIVE`, `rowCount > 0`, `latestDate >= 2026-05-09`
- `tw_institutional_buysell`: `state=LIVE`, `rowCount > 0`, `latestDate >= 2026-05-09`
- `tw_margin_short`: `state=LIVE`, `rowCount > 0`, `latestDate >= 2026-05-09`

### Step 6: Verify brief source pack
Fire a pipeline run or check the next scheduled tick.
Source pack should show all three sources as LIVE (not EMPTY).
5/12 and 5/13 briefs should generate without LLM hallucination.

---

## Stop-Line Status

- Three tables row_count > 0: PENDING (requires production backfill + verify)
- All code changes built and tested: DONE
- PR creation: NEXT step

---

## Quota Note

FinMind sponsor = 6000 req/hr.
With batch_size=50 and 3 datasets = 150 API calls per backfill set.
For 30 days × 1700 tickers: recommend batch_size=50 and run multiple times,
or batch_size=200 for a single pass (~600 calls per dataset, well under 6000/hr).

---

## Mike Audit Notes

No new DB migrations in this PR. All tables (`companies_ohlcv`, `tw_institutional_buysell`, `tw_margin_short`) were already created by migrations 0017 and 0023 respectively. This PR is code-only. No schema changes.

Migration 0023 filename: `0023_finmind_trading_flow.sql` — no `.DRAFT.` in filename → already applied in production.

---

## Lane Boundary Check

Modified files:
- `apps/api/src/jobs/finmind-full-ingest.ts` — backend job (Jason lane) OK
- `apps/api/src/server.ts` — only finmind backfill route block added (Jason lane) OK
- `apps/api/src/openalice-pipeline.ts` — pipeline source pack guard (Jason lane, consumes market data) OK
- `tests/ci.test.ts` — BF10-BF12 strategy/backfill tests only

NOT modified: broker/*, risk-engine.ts, marketData.ts, apps/web/*
