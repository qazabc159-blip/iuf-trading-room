---
owner: Jason
date: 2026-05-14
pr_branch: fix/api-dividend-status-ohlcv-key-mapping-2026-05-14
pr_title: "fix(api+db): tw_dividend status dateCol + TaiwanStockPrice/KBar status key mapping (Bruce backfill gap)"
---

# JASON — Dividend Table + Status Key Mapping Fix

## Root Cause Analysis

### ISSUE A: TaiwanStockDividend status = ERROR

- **Table**: `tw_dividend` was created in migration `0024_finmind_market_intel.sql` — table EXISTS.
- **Bug**: `server.ts` called `queryMarketIntelDatasetStats("tw_dividend", 10)` with default
  `dateCol = "date"`. But `tw_dividend` has **no `date` column** — it has `announcement_date` (nullable TEXT).
- **Consequence**: `MAX(date)` throws a PostgreSQL column-not-found error →
  `catch` block returns `state = "ERROR"` on every status request.
- **Note**: `finmind-full-ingest.ts:604` already passes `dateCol: "announcement_date"` for
  the ingest-status endpoint — only `server.ts` `/finmind/status` was missing it.

### ISSUE B: TaiwanStockPrice / TaiwanStockKBar status = EMPTY (wrong)

- **Table**: `companies_ohlcv` has 38864+ real rows on 2026-05-14 (Bruce confirmed LIVE).
- **Schema**: `source` column enum = `['mock', 'kgi', 'tej']`.
- **Ingest**: `ohlcv-finmind-sync.ts` writes `source = 'tej'`.
- **Bug**: Status endpoint queried:
  - `queryOhlcvStats("1d", "finmind_adj")` → source='finmind_adj' not in enum → 0 rows → EMPTY
  - `queryOhlcvStats("1d", "finmind")` → source='finmind' not in enum → 0 rows → EMPTY
- **`TaiwanStockPriceAdj`** avoided the bug via an existing fallback block
  (`if rowCount === 0 → query without source filter`) → showed LIVE. The dead fallback
  block is now removed (was only needed to paper over the wrong source filter).
- **`TaiwanStockKBar`**: queries `interval = '1m'` with no source filter — 0 rows because
  no 1m data has ever been persisted. This is **correct** — KBar stays EMPTY.

## Fix (2 surgical edits, 1 file)

### File: `apps/api/src/server.ts`

**ISSUE A fix** (line ~4969):
```diff
-      queryMarketIntelDatasetStats("tw_dividend", 10),
+      queryMarketIntelDatasetStats("tw_dividend", 10, "announcement_date"),
```

**ISSUE B fix** (lines ~4942-4950):
```diff
-      queryOhlcvStats("1d", "finmind_adj"),
-      queryOhlcvStats("1d", "finmind"),
+      queryOhlcvStats("1d", "tej"),
+      queryOhlcvStats("1d", "tej"),
-    // PriceAdj fallback: if finmind_adj has no rows...
-    if (ohlcvAdjStats.rowCount === 0) { ... }
```

## Expected Post-Fix Status

| Dataset key          | Before fix | After fix             |
|----------------------|------------|-----------------------|
| TaiwanStockDividend  | ERROR      | EMPTY (no backfill yet) or LIVE (after backfill) |
| TaiwanStockPrice     | EMPTY      | LIVE (38864+ rows, source=tej) |
| TaiwanStockPriceAdj  | LIVE (via fallback) | LIVE (source=tej direct) |
| TaiwanStockKBar      | EMPTY      | EMPTY (correct — no 1m data persisted) |

## Migration Status

- No new migration needed. `tw_dividend` table exists from `0024_finmind_market_intel.sql`.
- No destructive schema change. Mike audit NOT required (additive status endpoint fix only).

## Build / Test

- tsc: 0 errors
- finmind-aggregate-market.test.ts: 15/15 PASS
- finmind-client.test.ts: 8/11 PASS (3 failures are pre-existing on main, not introduced by this fix)
- ci.test.ts: ERR_REQUIRE_CYCLE_MODULE (pre-existing on main)

## Files Modified

- `apps/api/src/server.ts` — 2 targeted edits, ~10 lines net change

## Hard Line Status

| Rule                    | Status |
|-------------------------|--------|
| No broker code          | PASS   |
| No contracts edit       | PASS   |
| No apps/web/*           | PASS   |
| No token leak           | PASS   |
| No destructive DB change | PASS  |
| Mike audit (not needed) | N/A    |
