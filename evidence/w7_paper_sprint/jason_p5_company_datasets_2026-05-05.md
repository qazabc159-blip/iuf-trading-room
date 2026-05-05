# Jason P5 — Company Dataset Endpoints
# Date: 2026-05-05
# Wave: W8 Product Completion

## Summary

P5 adds 6 FinMind-backed company dataset endpoints with full `{ source, asof, data, _meta }` envelope.
All routes are additive — existing H-series routes (`/financials`, `/revenue`, `/chips`, `/dividend`) are untouched.

---

## Endpoint Contracts

### 1. GET /api/v1/companies/:symbol/ohlcv

Query params:
- `from` — start date YYYY-MM-DD (default: 365 days ago)
- `to`   — end date YYYY-MM-DD (default: today)
- `adj`  — "true" (default) | "false" — adjusted-close vs raw

Response shape:
```json
{
  "source": "finmind",
  "asof": "2026-05-05T12:00:00.000Z",
  "data": [
    { "dt": "2026-01-02", "open": 950, "high": 960, "low": 945, "close": 955, "volume": 12345, "source": "tej" }
  ],
  "_meta": {
    "source_tier": "sponsor999",
    "quota_remaining": 99900,
    "cache_ttl_seconds": 600,
    "staleness_seconds": null
  }
}
```

Error (no token): 429 `{ "error": "quota_exhausted", "detail": "FINMIND_API_TOKEN not configured" }`
Error (company not found): 404 `{ "error": "company_not_found" }`

Curl example:
```bash
curl -b "iuf_session=..." "https://api.eycvector.com/api/v1/companies/2330/ohlcv?from=2025-01-01&to=2026-05-05&adj=true"
```

---

### 2. GET /api/v1/companies/:symbol/monthly-revenue

Query params:
- `months` — integer 1-60 (default: 24)

Response shape:
```json
{
  "source": "finmind",
  "asof": "2026-05-05T12:00:00.000Z",
  "data": [
    { "date": "2026-01-01", "stock_id": "2330", "revenue": 276000000000, "revenue_month": 1, "revenue_year": 2026 }
  ],
  "_meta": {
    "source_tier": "sponsor999",
    "quota_remaining": 99899,
    "cache_ttl_seconds": 1800,
    "staleness_seconds": null
  }
}
```

Curl example:
```bash
curl -b "iuf_session=..." "https://api.eycvector.com/api/v1/companies/2330/monthly-revenue?months=24"
```

---

### 3. GET /api/v1/companies/:symbol/financials-v2

RENAME NOTE: Originally registered as `/financials`. Renamed to `/financials-v2` (2026-05-05)
to avoid Hono route shadow with H-series `/api/v1/companies/:id/financials` (line ~3759, uses UUID :id).
Codex frontend must use `/financials-v2` for the P5 FinMind envelope route.

Query params:
- `type` — "income" (default) | "balance" | "cashflow"
- `years` — integer 1-15 (default: 5)

Dataset mapping:
- income   → TaiwanStockFinancialStatements (損益表)
- balance  → TaiwanStockBalanceSheet (資產負債表)
- cashflow → TaiwanStockCashFlowsStatement (現金流量表)

Response shape:
```json
{
  "source": "finmind",
  "asof": "2026-05-05T12:00:00.000Z",
  "data": [
    { "date": "2025-09-30", "stock_id": "2330", "type": "Revenue", "value": 759690000000 }
  ],
  "_meta": {
    "source_tier": "sponsor999",
    "quota_remaining": 99898,
    "cache_ttl_seconds": 3600,
    "staleness_seconds": null
  }
}
```

Error (invalid type): 400 `{ "error": "invalid_type", "valid": ["income", "balance", "cashflow"] }`

Curl examples:
```bash
curl -b "iuf_session=..." "https://api.eycvector.com/api/v1/companies/2330/financials-v2?type=income&years=5"
curl -b "iuf_session=..." "https://api.eycvector.com/api/v1/companies/2330/financials-v2?type=balance&years=5"
curl -b "iuf_session=..." "https://api.eycvector.com/api/v1/companies/2330/financials-v2?type=cashflow&years=5"
```

---

### 4. GET /api/v1/companies/:symbol/institutional-flow

Query params:
- `days` — integer 1-365 (default: 60)

Returns raw FinMind rows. Each row: `{ date, stock_id, name, buy, sell }`.
`name` values: "外陸資", "投信", "自營商(自行買賣)", "自營商(避險)"
Codex frontend aggregates by name category.

Response shape:
```json
{
  "source": "finmind",
  "asof": "2026-05-05T12:00:00.000Z",
  "data": [
    { "date": "2026-05-02", "stock_id": "2330", "name": "外陸資", "buy": 12340000, "sell": 9876000 }
  ],
  "_meta": {
    "source_tier": "sponsor999",
    "quota_remaining": 99897,
    "cache_ttl_seconds": 1800,
    "staleness_seconds": null
  }
}
```

Curl example:
```bash
curl -b "iuf_session=..." "https://api.eycvector.com/api/v1/companies/2330/institutional-flow?days=60"
```

---

### 5. GET /api/v1/companies/:symbol/margin

Query params:
- `days` — integer 1-365 (default: 60)

Returns raw FinMind margin/short rows. Key fields:
`MarginPurchaseToday`, `MarginPurchaseYesterday`, `ShortSaleToday`, `ShortSaleYesterday`

Response shape:
```json
{
  "source": "finmind",
  "asof": "2026-05-05T12:00:00.000Z",
  "data": [
    { "date": "2026-05-02", "stock_id": "2330", "MarginPurchaseToday": 45678, "ShortSaleToday": 12345 }
  ],
  "_meta": {
    "source_tier": "sponsor999",
    "quota_remaining": 99896,
    "cache_ttl_seconds": 1800,
    "staleness_seconds": null
  }
}
```

Curl example:
```bash
curl -b "iuf_session=..." "https://api.eycvector.com/api/v1/companies/2330/margin?days=60"
```

---

### 6. GET /api/v1/companies/:symbol/dividend

No query params. Returns last 10 years of dividend history.

Key fields: `year`, `TotalCashDividend`, `TotalStockDividend`, `TotalDividend`, `CashEarningsDistribution`

Response shape:
```json
{
  "source": "finmind",
  "asof": "2026-05-05T12:00:00.000Z",
  "data": [
    { "date": "2025-07-15", "stock_id": "2330", "year": 2025, "TotalCashDividend": 13.5, "TotalStockDividend": 0 }
  ],
  "_meta": {
    "source_tier": "sponsor999",
    "quota_remaining": 99895,
    "cache_ttl_seconds": 86400,
    "staleness_seconds": null
  }
}
```

Curl example:
```bash
curl -b "iuf_session=..." "https://api.eycvector.com/api/v1/companies/2330/dividend"
```

---

## Implementation Notes

- All P5 routes are in `apps/api/src/server.ts` (additive block before `serve()` call)
- Envelope helper `buildFinMindMeta()` is a local function in P5 block
- `quota_remaining` is a process-lifetime estimate using `_finmindRequestCount`; not authoritative FinMind API call
- 429 returned when `FINMIND_API_TOKEN` absent (not when quota exhausted in real-time)
- Cache: routes use existing FinMindClient Redis TTL handling; `staleness_seconds` always null (client doesn't expose cache-hit signal without refactor — conservative decision)
- `OhlcvBar` type added to import from `./companies-ohlcv.js`

## Files Modified

- `apps/api/src/server.ts` — added `type OhlcvBar` import + P5 block (~250 lines)

## Stop-Lines Verified

- NO live submit
- NO KGI write
- NO mock data as live
- NO FinMind-based gate relaxation
- Token never in response

## Build Status

- Bash tool non-functional this session; build not executed
- Static type audit: all method calls verified against finmind-client.ts
- All referenced symbols verified in-scope

## Commit SHA

STAGED_NOT_COMMITTED — Bash tool broken, git cannot run. Bruce must commit.
