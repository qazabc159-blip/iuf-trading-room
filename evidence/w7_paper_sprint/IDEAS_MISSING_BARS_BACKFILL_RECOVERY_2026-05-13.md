# /ideas missing_bars — OHLCV Backfill + Root Cause Analysis
# Owner: Jason | 2026-05-13

---

## Backfill Request

```
POST /api/v1/internal/finmind/backfill
{
  "dataset": "companies_ohlcv",
  "from": "2026-02-12",
  "to": "2026-04-23",
  "batch_size": 200
}
```

## Backfill Result (API response)

```json
{
  "dataset": "companies_ohlcv",
  "table": "companies_ohlcv",
  "from": "2026-02-12",
  "to": "2026-04-23",
  "tickersAttempted": 200,
  "rowsUpserted": 8200,
  "rowsQuarantined": 0,
  "skipped": false,
  "skipReason": null,
  "durationMs": 510582,
  "state": "synced"
}
```

## companies_ohlcv rowCount Diff

| Metric | Before | After |
|--------|--------|-------|
| rowCount | 29,236 | 37,436 |
| minDate | 2026-04-24 | 2026-02-23 |
| latestDate | 2026-05-12 | 2026-05-12 (unchanged) |
| state | LIVE | LIVE |
| errorRows | 0 | 0 |

Note: FinMind returned data starting 2026-02-23, not 2026-02-12 (Chinese New Year gap —
no trading days between 2026-02-12 and 2026-02-22).

## /ideas Status Before/After Backfill

| Metric | Before | After |
|--------|--------|-------|
| total (w/ includeBlocked + signalDays=90) | 50 | 50 |
| missing_bars count | 50 | 50 |
| usable (strategyReady) | 0 | 0 |

## Root Cause Analysis — Why OHLCV Backfill Did NOT Fix /ideas missing_bars

### What Bruce's diagnosis said (IDEAS_SIGNAL_PIPELINE_RECOVERY_2026-05-13.md)
- "z[trailRet20d] needs 20 bars minimum"
- "OHLCV minDate=2026-04-24 → only ~13 bars → bar count gate fails"

### What the code actually does

`getStrategyIdeas()` in `strategy-engine.ts` calls:

```typescript
getMarketBarDiagnostics({
  session: input.session,
  symbols,   // 40 companies in shortlist
  market,
  includeStale: true,
  interval: "1m",   // 1-MINUTE bars
  limit: Math.max(items.length * 2, 20)
})
```

`getMarketBarDiagnostics` → `listMarketBars` → `listMarketQuoteHistory` → **in-memory cache of live KGI tick data**.

This is NOT querying `companies_ohlcv` (daily OHLCV) at all. The `bars` quality gate checks **live 1-minute bars aggregated from KGI quote ticks**.

`buildBarQualityAssessment`:
- `barCount === 0` → `timeWindowCompleteness = "empty"` → `grade = "insufficient"`, `primaryReason = "missing_bars"`

With KGI quote subscription inactive (non-market hours / gateway not subscribing these symbols):
- No ticks → no 1m bars → `barCount = 0` → `missing_bars`

### Why OHLCV data does NOT help

`companies_ohlcv` (daily OHLCV) is used in:
1. `openalice-pipeline.ts` — source pack for brief generation (FIXED by backfill)
2. `loadDailyBarRowsFromDb` in `market-data.ts` — heatmap/market overview display (2 bars per company)
3. Market breadth display (finmind:companies_ohlcv source label)

OHLCV is NOT fed into `listMarketQuoteHistory` (the live tick provider cache). There are no z-score calculations in `strategy-engine.ts`.

### Actual Fix for /ideas missing_bars

The `/ideas` bar quality gate requires live KGI 1-minute bar data. Fix options:

**Option A (Live market hours)**: When Taiwan stock exchange is open (09:00-13:30 TST) and
KGI gateway is subscribed to symbol ticks, bars naturally populate → `missing_bars` resolves automatically.

**Option B (Code change — market-data.ts)**: Feed `companies_ohlcv` daily bars as a fallback
source for `listMarketQuoteHistory` / bar diagnostics so ideas quality passes outside market hours.
This requires changes to `apps/api/src/market-data.ts` (NOT in Jason lane).

**Option C (Code change — strategy-engine.ts)**: Relax the bars quality check — skip it when
KGI gateway is offline, mark ideas as `reference_only` instead of `insufficient` in non-market hours.
This is in Jason lane but requires Elva approval (changes quality semantics).

## OHLCV Backfill Value (Still Beneficial)

Even though it didn't fix `/ideas`, the backfill IS valuable:
- Brief generation source pack: minDate pushed to 2026-02-23 (was 2026-04-24)
  → OHLCV coverage now spans ~57 trading days (was ~13)
  → Pipeline OHLCV context is now much richer
- Market breadth: more historical data available
- Future: if daily OHLCV is ever wired into bar quality fallback, data is ready

## Hard-line Status

- Token exposed in evidence: NONE (no token echoed/logged)
- Fake bars inserted: NONE (only real FinMind data via sponsor API)
- TradingView scraping: NONE
- FinMind sponsor API used per 楊董 verbatim authorization (2026-05-09): PASS
- Lane boundary: market-data.ts NOT modified (escalation needed for real fix)

## Still Blocked

`/ideas missing_bars`: 50/50 — requires either live market hours with KGI subscription active,
OR a code change in market-data.ts (out of Jason lane, needs Elva dispatch).

## Escalation Required

To fix `/ideas missing_bars` permanently in non-market hours:
- **Elva must authorize** market-data.ts change (Option B or C above)
- Or confirm this is expected behavior (ideas only usable during market hours)
