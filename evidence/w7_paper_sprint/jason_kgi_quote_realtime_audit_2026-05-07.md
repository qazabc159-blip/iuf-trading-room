# Jason — KGI Quote Realtime Audit 2026-05-07

## §1 Existing KGI Quote Routes Audit

| Route | Method | Auth | Purpose | Frontend-consumable? |
|---|---|---|---|---|
| `/api/v1/kgi/quote/status` | GET | session | Diagnostic: subscription status + buffer stats | No — ops/debug only |
| `/api/v1/kgi/quote/subscribe` | POST | session | Subscribe tick + bidask for symbol | No — admin action |
| `/api/v1/kgi/quote/ticks?symbol=&limit=` | GET | session | Raw tick ring buffer (N ticks) | Partial — raw, no aggregation |
| `/api/v1/kgi/quote/bidask?symbol=` | GET | session | Latest bid/ask snapshot | Partial — no tick data |
| `/api/v1/kgi/quote/kbar/recover?symbol=&from=&to=` | GET | session | Historical K-bars | No — batch, not realtime |
| `/api/v1/kgi/quote/subscribe/kbar` | POST | session | Subscribe K-bar stream | No — admin action |
| `/api/v1/kgi/quote/kbar?symbol=&limit=` | GET | session | Latest K-bars from ring buffer | No — K-bar not price quote |

All routes require iuf_session cookie (inside /api/v1/* middleware).

## §2 Missing Piece Conclusion

- No existing route accepts `:companyId` (UUID or ticker) — existing routes use `?symbol=` query param (raw KGI symbol)
- No aggregated endpoint combining lastPrice + bid + ask + volume + freshness in one call
- No `state` field (LIVE / STALE / BLOCKED) for frontend to render gracefully
- Frontend needs to call 2 separate routes + resolve symbol mapping = too much coupling
- Conclusion: need a single aggregated endpoint scoped to company context

## §3 Fix Path Selected

**HTTP poll endpoint** (MVP): `GET /api/v1/companies/:id/quote/realtime`

Rationale:
- Simplest frontend integration — one fetch() per 5s tick
- Matches existing companies/:id pattern (frontend already resolves by UUID or ticker)
- No new infra (no SSE / websocket complexity)
- Graceful BLOCKED state when gateway not reachable or symbol not whitelisted
- SSE deferred to next iteration (§6)

## §4 Endpoint Shape

```
GET /api/v1/companies/2330/quote/realtime
Authorization: iuf_session cookie

200 OK — LIVE case (KGI gateway up, symbol whitelisted + subscribed)
{
  "data": {
    "symbol": "2330",
    "lastPrice": 905.0,
    "bid": 904.0,
    "ask": 906.0,
    "volume": 12480,
    "freshness": "fresh",
    "state": "LIVE",
    "source": "kgi-gateway",
    "updatedAt": "2026-05-07T03:12:45.000Z"
  }
}

200 OK — BLOCKED case (symbol not on KGI_QUOTE_SYMBOL_WHITELIST)
{
  "data": {
    "symbol": "0050",
    "lastPrice": null,
    "bid": null,
    "ask": null,
    "volume": null,
    "freshness": "not-available",
    "state": "BLOCKED",
    "reason": "symbol_not_whitelisted",
    "source": "kgi-gateway",
    "updatedAt": "2026-05-07T03:12:45.000Z"
  }
}

200 OK — STALE case (data present but age > 5000ms threshold)
{ "data": { ..., "freshness": "stale", "state": "STALE", ... } }

200 OK — NO_DATA case (subscribed but no ticks yet / empty buffer)
{ "data": { ..., "lastPrice": null, "state": "NO_DATA", ... } }

404 — company not found
{ "error": "company_not_found" }
```

state enum: `LIVE | STALE | BLOCKED | NO_DATA`

## §5 Stop-Line Proof

- NO import from kgi-gateway-client.ts or any order module
- NO /order/create reference
- NO broker write surface
- NO token / session / account number in response body
- NO real submit path
- Response contains only: symbol, price data, state, source, timestamp
- Symbol is company.ticker (public ticker, e.g. "2330") — not internal account ID
- read-only GET endpoint, no side effects
- Both tick + bidask legs use Promise.allSettled (fail-soft: partial data > no data)
- BLOCKED state returned honestly when gateway not available (no fake LIVE)

## §6 Next Iteration TODO (SSE / latency)

1. SSE stream: `GET /api/v1/companies/:id/quote/stream` — push on each tick event from KGI gateway instead of 5s poll; reduces latency from ~5s to <200ms
2. Batch endpoint: `GET /api/v1/kgi/quote/realtime/batch?symbols=2330,2317` for portfolio page (multiple symbols in one call)
3. Cache layer: in-memory TTL cache (500ms) to absorb burst from multiple frontend tabs
4. Odd-lot flag: expose `oddLot` boolean in response when tick is odd-lot market data
