# Jason — P2: FinMind Diagnostics Route Skeleton
# Date: 2026-05-05

---

## Delivered

### Route: `GET /api/v1/diagnostics/finmind`

Requires valid `iuf_session` cookie (standard auth gate, inside `/api/v1/*` middleware).

### Response shape

```json
{
  "data": {
    "tokenPresent": true,
    "tokenSource": "env",
    "ohlcvSource": "finmind",
    "quotaTier": "sponsor999",
    "quotaLimitPerHour": 99999,
    "redisConfigured": true,
    "inProcess": {
      "requestCount": 42,
      "errorCount": 1,
      "errorRatePct": 2.38,
      "lastFetchTs": "2026-05-05T10:23:00.000Z",
      "lastDataset": "TaiwanStockPriceAdj"
    },
    "health": "configured",
    "note": "Counters reset on process restart. Token is NEVER returned."
  }
}
```

### When no token is configured

```json
{
  "data": {
    "tokenPresent": false,
    "tokenSource": "none",
    "health": "no_token",
    ...
  }
}
```

---

## Hard lines enforced

- `tokenPresent` is a boolean — the token string itself is NEVER in the response
- `tokenSource: "env"` means FINMIND_API_TOKEN is set in Railway env
- Quota numbers come from env (`FINMIND_QUOTA_TIER`) or hardcoded constants — no live API probe
- In-process counters (`requestCount`, `errorCount`) reset on process restart — documented in `note` field

---

## Supporting infra added (server.ts)

- `let _finmindRequestCount`, `_finmindErrorCount`, `_finmindLastFetchTs`, `_finmindLastDataset` — module-level counters
- `export function recordFinMindFetch({ dataset, ok })` — callable from finmind-client.ts to update counters (not yet wired into client; counters start at 0 per-process until wired)

---

## Next step (deferred, not P2 scope)

Wire `recordFinMindFetch()` into `FinMindClient._fetch()` to populate live counters.
That is a FinMind client internal change — safe but deferred so P2 scope stays minimal.

---

## Smoke verification

```bash
curl -s -b /tmp/bruce_session.jar https://api.eycvector.com/api/v1/diagnostics/finmind | jq .
```

Expected: 200 + JSON with `health: "configured"` if `FINMIND_API_TOKEN` is set in Railway.

---

## Status: DELIVERED
