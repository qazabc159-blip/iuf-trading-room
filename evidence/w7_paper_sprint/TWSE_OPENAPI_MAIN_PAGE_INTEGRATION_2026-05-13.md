# TWSE OpenAPI Main Page Real-Time Market Overview + Heatmap

**Date**: 2026-05-13
**Owner**: Jason (backend-strategy lane)
**Branch**: feat/api-twse-openapi-market-overview-2026-05-13
**Status**: SHIPPED — pending CI + Elva merge

---

## 1. What Was Built

### New Functions in `apps/api/src/data-sources/twse-openapi-client.ts`

| Function | Endpoint | Cache TTL | Description |
|---|---|---|---|
| `getTwseMarketOverview()` | TWSE `/exchangeReport/MI_INDEX` | 60s in-memory | TAIEX value + change + changePct |
| `getTwseIndustryHeatmap(tickerToIndustry)` | TWSE `/exchangeReport/STOCK_DAY_ALL` + TPEX `/tpex_mainboard_daily_close_quotes` | 60s in-memory | Industry tiles aggregated from ticker changePct |

### New Endpoints in `apps/api/src/server.ts`

| Route | Auth | Response Shape |
|---|---|---|
| `GET /api/v1/market/overview/twse` | session (Owner/Admin/Analyst) | `{ taiex: { value, change, changePct, ts }, otc: null, source, staleAfterSec, sourceState }` |
| `GET /api/v1/market/heatmap/twse` | session (Owner/Admin/Analyst) | `{ data: [{ industry, avgChangePct, gainerCount, loserCount, flatCount, stockCount, source }], industryCount, mappedTickers }` |

### Updated `apps/api/src/dashboard-snapshot-aggregator.ts`

`fetchHeatmapPanel()` now tries TWSE OpenAPI first (real-time T+0), falls back to OHLCV (FinMind T+0/T+1). Neither path requires KGI.

---

## 2. Live Test Evidence (real TWSE hit, not mock)

```
[LIVE] Calling getTwseMarketOverview...
[LIVE] TAIEX value: 41898.32 change: 108.26 changePct: 0.26%
[LIVE] ts: 2026-05-12T13:30:00+08:00 source: twse_openapi latency: 118ms

[LIVE] Calling getTwseIndustryHeatmap...
[LIVE] heatmap tiles: 2 latency: 843ms
 - 半導體 avg: -1.87% stocks: 2 gainers: 1 losers: 1
 - 電子組裝 avg: -0.79% stocks: 1 gainers: 0 losers: 1
```

**TWSE endpoint verified**: `GET https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX` → 267 rows, 118ms
**TPEX endpoint verified**: `GET https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes` → 10,393 rows, 843ms

---

## 3. Test Results

```
T1: getTwseMarketOverview shape — PASS
T2: getTwseIndustryHeatmap aggregation — PASS
T3: getTwseMarketOverview timeout → null (fail-open) — PASS
T4: cache hit — second call returns cached — PASS

Total: 4/4 PASS
Dashboard snapshot regression: 6/6 PASS
Build: tsc --noEmit PASS
```

Pre-existing failures on main (not regression):
- `finmind-client.test.ts` T3/T9/T10 — unchanged from main baseline
- `ci.test.ts` — ERR_REQUIRE_CYCLE_MODULE pre-existing Node.js 24 issue

---

## 4. Files Modified

| File | Change |
|---|---|
| `apps/api/src/data-sources/twse-openapi-client.ts` | Added `getTwseMarketOverview`, `getTwseIndustryHeatmap`, helper types, 60s in-memory caches |
| `apps/api/src/server.ts` | Added `GET /api/v1/market/overview/twse` + `GET /api/v1/market/heatmap/twse` |
| `apps/api/src/dashboard-snapshot-aggregator.ts` | `fetchHeatmapPanel` now tries TWSE first → OHLCV fallback |
| `apps/api/src/__tests__/twse-market-overview.test.ts` | 4 new tests (new file) |

---

## 5. Hard-Line Status

| Check | Status |
|---|---|
| No KGI SDK import | PASS |
| No TradingView scraping | PASS |
| No contracts/schema change | PASS |
| No DB migration | PASS |
| No lane crossover (no risk/broker/web) | PASS |
| No commit of /ideas pipeline changes | PASS |

---

## 6. Handoff Notes for Elva / Codex

- `/api/v1/market/overview/twse` replaces the empty `/api/v1/quotes` fallback for the main page TAIEX index display
- `/api/v1/market/heatmap/twse` gives industry-grouped changePct tiles; Codex frontend should prefer this over `/api/v1/heatmap` for the main page heatmap
- OTC composite index: TPEX has no public composite index API endpoint — `otc: null` for now; can be derived from average of TPEX daily quotes if needed later
- Industry mapping: uses `chainPosition` column from companies table (no `industry` column exists in schema); Codex should display `industry` field as-is (it's the chainPosition value from FinMind)
- Cache TTL 60s: TWSE data is end-of-day on market close; during market hours it updates ~15s, so 60s is safe
