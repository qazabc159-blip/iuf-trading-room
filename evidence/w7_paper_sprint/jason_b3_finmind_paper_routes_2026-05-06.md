---
sprint: B3
author: jason
date: 2026-05-06
branch: feat/finmind-status-expansion-paper-e2e-health-2026-05-06
---

# B3 Evidence: FinMind Status Expansion + Paper E2E Health Detail

## Routes Added / Modified

| Path | Method | Auth | Change |
|------|--------|------|--------|
| `/api/v1/data-sources/finmind/status` | GET | required | EXPANDED — added `global` block + per-dataset `rowCount/latestDate/lastFetchTs/missingReason/degradedReason` |
| `/api/v1/paper/health/detail` | GET | none (isPublicDiagRoute) | NEW — per-stage paper E2E readiness panel |

## isPublicDiagRoute allow-list additions

```
/api/v1/paper/health          (existing)
/api/v1/paper/health/detail   (NEW — B3-2)
/api/v1/diagnostics/kbar      (existing)
```

## Trade Capability Score: +1

New `/paper/health/detail` enables Bruce smoke scripts to validate paper E2E
path readiness at each stage without auth, reducing ops friction.

## Axis A — FinMind Status Sample Response (memory mode / no token)

```json
{
  "data": {
    "source": "FINMIND",
    "state": "BLOCKED",
    "global": { "tokenPresent": false, "quotaTier": "none", "rateLimitPerHour": null },
    "datasets": [
      { "key": "TaiwanStockPriceAdj", "label": "OHLCV/KBar adj", "state": "BLOCKED",
        "lastFetchTs": null, "rowCount": null, "latestDate": null,
        "missingReason": "no_token", "degradedReason": null },
      { "key": "TaiwanStockNews", "label": "台股新聞", "state": "CLOSED",
        "lastFetchTs": null, "rowCount": null, "latestDate": null,
        "missingReason": "freeze_no_news_feature", "degradedReason": null }
    ]
  }
}
```

With token + DB (expected prod shape):

```json
{
  "data": {
    "global": { "tokenPresent": true, "quotaTier": "sponsor999", "rateLimitPerHour": 6000 },
    "datasets": [
      { "key": "TaiwanStockPriceAdj", "state": "LIVE",
        "rowCount": 19948, "latestDate": "2026-05-05",
        "lastFetchTs": "2026-05-05T10:32:00Z",
        "missingReason": null, "degradedReason": null },
      { "key": "TaiwanStockMonthRevenue", "state": "FALLBACK",
        "rowCount": null, "latestDate": null,
        "missingReason": null, "degradedReason": null,
        "note": "api-only, no local persistence" }
    ]
  }
}
```

## Axis B — Paper Health Detail Sample Response

```json
{
  "data": {
    "preview":     { "state": "READY", "endpoint": "/paper/preview" },
    "orderTicket": { "state": "READY", "endpoint": "/paper/submit",
                     "executionMode": "paper", "note": "paper mode only; KGI write-side is frozen" },
    "submit":      { "state": "READY", "endpoint": "/paper/submit", "executionMode": "paper" },
    "fill":        { "state": "READY", "endpoint": "/paper/fills",
                     "lastFillTs": "2026-05-05T09:12:44Z", "todayCount": 3 },
    "portfolio":   { "state": "READY", "endpoint": "/paper/portfolio", "rowCount": 3 },
    "auditLog":    { "state": "READY", "endpoint": "/audit-log", "todayEntries": 12 }
  }
}
```

## No-Token / No-Fake / No-Order Proof

- No token value in any response field — only `tokenPresent: boolean`
- `state=LIVE` for OHLCV datasets requires real SQL evidence from `companies_ohlcv`
- Non-OHLCV datasets without local DB table return `state=FALLBACK` (not LIVE)
- `/paper/health/detail` returns aggregate counts only — no userId, no order content
- No order placement in either route (both are read-only diagnostic probes)

## Build / Test Results

- typecheck: PASS (0 errors)
- build: PASS (tsc clean)
- tests: 118/118 PASS (no regressions)

## Files Modified

- `apps/api/src/server.ts` — isPublicDiagRoute (+1 entry), finmind/status expanded, paper/health/detail new route
