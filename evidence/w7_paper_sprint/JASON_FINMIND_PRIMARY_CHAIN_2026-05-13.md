# Jason: FinMind Primary Chain — Heatmap / Breadth / Leaders / Institutional
Date: 2026-05-13
Branch: feat/api-finmind-primary-chain-heatmap-breadth-leaders-institutional-2026-05-13
Scope: BG #2 (heatmap / breadth / leaders / institutional)

## Panels Shipped

### Heatmap
- Endpoint: GET /api/v1/market/heatmap/finmind
- Primary: FinMind TaiwanStockPrice whole-market → industry aggregate (chainPosition mapping)
- Secondary: TWSE OpenAPI STOCK_DAY_ALL (when FinMind token absent or empty)
- Response: { data: FinMindHeatmapTile[], source: "finmind"|"twse_openapi_fallback", industryCount, mappedTickers }

### Breadth
- Endpoint: GET /api/v1/market/breadth/finmind
- Primary: FinMind TaiwanStockPrice → up/down/flat counts (whole market)
- Secondary: getTwseMarketBreadth() (TWSE OpenAPI STOCK_DAY_ALL)
- Response: { up, down, flat, total, asOf, source, staleAfterSec }

### Leaders
- Endpoint: GET /api/v1/market/leaders/finmind
- Primary: FinMind TaiwanStockPrice → top 5 gainers / losers / most active (by Trading_money)
- No TWSE fallback (would need to wire topGainers from breadth; deferred)
- Response: { topGainers, topLosers, mostActive, asOf, source, staleAfterSec }

### Institutional (三大法人)
- Endpoint: GET /api/v1/market/institutional-summary/finmind
- Primary: FinMind TaiwanStockInstitutionalInvestorsBuySell whole-market
- No TWSE fallback (TWSE has no open institutional API for all stocks)
- Response: { asOf, totalNet, institutions: [{name, buy, sell, net}], topNetBuy, topNetSell, source }

### Margin (融資融券)
- Endpoint: GET /api/v1/market/margin-summary/finmind
- Primary: FinMind TaiwanStockMarginPurchaseShortSale whole-market
- Response: { asOf, marginBalance, shortBalance, marginNet, source }

### News
- Endpoint: GET /api/v1/market/news/finmind
- Primary: FinMind TaiwanStockNews (whole-market, today, top 10, deduplicated by title)
- Response: { items: [{date, stockId, title, url, sourceName}], asOf, source }

## Files Changed
- NEW: apps/api/src/data-sources/finmind-aggregate-client.ts
- NEW: apps/api/src/__tests__/finmind-aggregate-market.test.ts
- MODIFIED: apps/api/src/server.ts (6 new routes, strategy panel section)

## Hard Lines Status
- no fake data: CONFIRMED (all live FinMind + TWSE fallback)
- no FinMind token leak: CONFIRMED (token stripped from all log URLs, never in response)
- no broker code: CONFIRMED
- no contracts change: CONFIRMED
- no DB migration: CONFIRMED
- no apps/web/* change: CONFIRMED
- not touching index path (BG #1 lane): CONFIRMED (twse-openapi-client.ts index path untouched)

## Build / Test Results
- tsc: 0 errors
- FA1-FA8 tests: 15/15 PASS
- TWSE T1-T4 + dashboard regression: 26/26 PASS total

## Cache Architecture
- 60s in-memory TTL per query key (finmind-agg:<dataset>:<date>:<endDate>)
- Promise coalescing: concurrent callers share one inflight fetch (FA7 verified)
- Fail-open: null return on any error; routes handle null → fallback or empty response

## Source Chain Verified
- FinMind token present → primary path fires
- FinMind token absent → null → TWSE fallback (heatmap/breadth) or unavailable state (institutional/news)
- TWSE unreachable → empty tiles/breadth (never 5xx)
