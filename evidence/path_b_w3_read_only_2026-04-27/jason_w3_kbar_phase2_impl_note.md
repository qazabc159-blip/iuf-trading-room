---
name: W3 B2 K-bar Phase 2 Backend Implementation Note
description: Jason W3 Lane B2 — K-bar Phase 2 backend DRAFT PR impl note; 4 routes + interval matrix + no-order tests
type: impl_note
date: 2026-04-27
sprint: W3 Read-Only Expansion Sprint
lane: B2
author: Jason (backend-strategy-jason)
pr_branch: feat/w3-kbar-phase2
status: DRAFT PR
---

# W3 B2 — K-bar Phase 2 Backend Implementation Note

## §1. Scope Summary

Lane B2 implements the K-bar (OHLCV) backend routes for reading historical and
live K-bar data from the KGI SDK. This is read-only — no order path, no signal
trigger, no production WS activation.

## §2. New Files Created

| File | Purpose |
|---|---|
| `services/kgi-gateway/kgi_kbar.py` | K-bar ring buffer, subscribe manager, recover helper, interval matrix |
| `services/kgi-gateway/tests/test_kbar.py` | 13 Python tests (circuit breaker + interval + empty-safe + no-order audit) |
| `apps/api/src/__tests__/kbar.test.ts` | 15 TS tests (recover + subscribe + ring buffer + interval + no-order) |
| `evidence/path_b_w3_read_only_2026-04-27/jason_w3_kbar_interval_matrix.md` | Interval matrix |

## §3. Modified Files

| File | Change |
|---|---|
| `services/kgi-gateway/app.py` | Added 4 K-bar routes; K-bar pump in lifespan; K-bar imports |
| `services/kgi-gateway/schemas.py` | Added KBarData, SubscribeKbarRequest/Response, KbarRecoverResponse, KbarLatestResponse |
| `apps/api/src/broker/kgi-quote-client.ts` | Added KBarData type, K-bar response types, 3 new methods (recoverKbar / subscribeSymbolKbar / getRecentKbars) |
| `apps/api/src/server.ts` | Added 3 K-bar proxy routes |

## §4. Route Surface (Gateway)

| Method | Path | Description |
|---|---|---|
| GET | `/quote/kbar/recover?symbol=&from_date=&to_date=` | Historical K-bar via recover_kbar SDK |
| POST | `/quote/subscribe/kbar` | Subscribe to K-bar stream; interval validated against matrix |
| GET | `/quote/kbar?symbol=&limit=` | Ring buffer REST poll (last N bars) |
| GET | `/quote/kbar/status` | Diagnostic — buffer state (always 200, no auth) |

## §5. Route Surface (apps/api)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/kgi/quote/kbar/recover?symbol=&from=&to=` | Proxy to gateway recover_kbar |
| POST | `/api/v1/kgi/quote/subscribe/kbar` | Proxy to gateway subscribe/kbar |
| GET | `/api/v1/kgi/quote/kbar?symbol=&limit=` | Proxy to gateway ring buffer poll |

## §6. KBar Shape (locked, aligned with Jim sandbox)

```json
{ "time": 1745728800000, "open": 945.0, "high": 952.0, "low": 942.0, "close": 948.0, "volume": 12345 }
```

- `time`: Unix milliseconds (UTC-normalised in gateway)
- `open/high/low/close`: float (price)
- `volume`: float

## §7. Interval Matrix Summary

| Interval | Status |
|---|---|
| `1m` | SUPPORTED (intended; live confirmation deferred to Phase 3 Q1) |
| `5m` | SUPPORTED (intended) |
| `15m` | SUPPORTED (intended) |
| `1d` | SUPPORTED (intended) |
| `30m` | UNSUPPORTED — surfaced in response, NOT transcoded |
| `1h` | UNSUPPORTED — surfaced in response, NOT transcoded |
| `4h` | UNSUPPORTED — surfaced in response, NOT transcoded |

Full matrix: `evidence/path_b_w3_read_only_2026-04-27/jason_w3_kbar_interval_matrix.md`

## §8. Mock Fallback / Empty-Safe Design

| Scenario | Response |
|---|---|
| `recover_kbar` SDK unavailable | `{ bars: [], count: 0, note: "SDK not available" }` (200) |
| `recover_kbar` SDK error | `{ bars: [], count: 0, note: "error: ClassName" }` (200) |
| GET `/quote/kbar` not subscribed | 404 KBAR_NOT_SUBSCRIBED (apps/api) |
| GET `/quote/kbar` 404 from gateway | Empty-safe response `{ bars: [], count: 0 }` in client (no exception) |
| `session.api is None` | Empty bars with note (200) |

## §9. QUOTE_DISABLED Breaker — All 3 K-bar Routes

Per W2d subscribe-gap fix pattern:
- `QUOTE_DISABLED=true` fires BEFORE auth on all 3 writable K-bar endpoints
- `GET /quote/kbar/status` has NO QUOTE_DISABLED check (diagnostic surface)

Proof: Python tests T5, T6, T7, T9 in test_kbar.py

## §10. WS Push Architecture (DRAFT-only / Sandbox-only)

`kbar_manager.kbar_broadcast_pump()` runs as asyncio background task (started
in lifespan). It drains `kbar_queue` and would push to WS clients.

**Hard line**: No production-side WS client is attached in W3 B2. The pump
runs but the `_ws_clients` set is empty. Only Jim sandbox can call
`kbar_manager.register_ws_client()` in sandbox testing scope.

## §11. No-Order Guarantee Proof

### Method enumeration (W3-B2-T11)

All method names on `KgiQuoteClient` checked for order patterns
`["order", "submit", "place", "cancel", "modify", "create"]` → 0 matches.

### URL interception (W3-B2-T12)

All K-bar operations (recoverKbar / subscribeSymbolKbar / getRecentKbars)
intercepted → 0 calls to `/order/*` URLs.

### Python static audit (T13)

`kgi_kbar.py` source scanned for `^import.*order` / `^from.*order` /
`order_queue=` / `signal_queue=` patterns → 0 matches.

## §12. Test Results

### TypeScript (B2-specific)

```
15 pass / 0 fail / 0 skip
W3-B2-T1 through W3-B2-T15
```

### Python gateway (full suite after B2 changes)

```
34 pass / 0 fail
13 new tests in test_kbar.py
21 pre-existing tests all still green
```

### Typecheck

```
EXIT 0 (apps/api pnpm typecheck)
```

## §13. Stop-Line Audit

| Stop-line | Status |
|---|---|
| #4 /order/create touched | CLEAR |
| #5 order path imported | CLEAR — 0 order imports in kgi_kbar.py |
| #6 paper/live wording | CLEAR |
| #8 secret in new evidence | CLEAR |
| #9 contracts mutation | CLEAR |
| #10 deploy | CLEAR |
| #11 merge | CLEAR |
| #13 K-bar route tries to generate signal | CLEAR — on_kbar callback writes to ring buffer only |
| B2: subscribe_kbar in production-side WS | CLEAR — DRAFT only, ws_clients set is empty in production |
| B2: unsupported interval hard-transcoded | CLEAR — surfaced as interval_status=unsupported |

## §14. DRAFT PR Description Template

```
feat(w3-b2): K-bar Phase 2 backend — recover + subscribe skeleton + interval matrix (DRAFT)

W3 Lane B2 — read-only K-bar data layer.

## Routes added
- GET /api/v1/kgi/quote/kbar/recover  → SDK recover_kbar (historical)
- POST /api/v1/kgi/quote/subscribe/kbar  → SDK subscribe_kbar skeleton
- GET /api/v1/kgi/quote/kbar  → ring buffer REST poll

## Gateway routes added
- GET /quote/kbar/recover, POST /quote/subscribe/kbar, GET /quote/kbar, GET /quote/kbar/status

## KBar shape (locked, Jim sandbox aligned)
{ time: unix_ms, open, high, low, close, volume }

## Interval support matrix
Supported (intended): 1m, 5m, 15m, 1d
Unsupported (no transcode): 30m, 1h, 4h, 1w, 1M

## Tests
- TS: 15/15 pass (W3-B2-T1 through W3-B2-T15)
- Python: 34/34 pass (13 new + 21 baseline)
- typecheck: EXIT 0

## Hard lines held
- 0 order import / 0 order URL / 0 contracts mutation / 0 deploy
- No-order proof: W3-B2-T11, W3-B2-T12
- No-order static audit: T13
- QUOTE_DISABLED breaker on all endpoints
- Interval unsupported matrix surfaced, not transcoded
- WS push: DRAFT-only / sandbox-only

## DRAFT — NOT FOR MERGE
Sprint: W3 Read-Only Expansion Sprint | Lane: B2
```

— Jason, 2026-04-27 W3 sprint
