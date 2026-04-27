---
name: W3 B1 Quote Hardening Implementation Note
description: Jason W3 Lane B1 — H-6 structured logging + H-9 ring buffer eviction warning + observability; DRAFT PR impl note
type: impl_note
date: 2026-04-27
sprint: W3 Read-Only Expansion Sprint
lane: B1
author: Jason (backend-strategy-jason)
pr_branch: feat/w3-quote-hardening
status: DRAFT PR
---

# W3 B1 — Quote Hardening Implementation Note

## §1. Scope Summary

Lane B1 implements H-6 (structured logging) and H-9 (ring buffer eviction warning) from the quote API hardening plan, plus quote status observability. This is a pure observability increment — zero behavior change to any quote route.

## §2. New Files Created

| File | Purpose |
|---|---|
| `apps/api/src/lib/logger.ts` | Structured JSON logger with mandatory redaction of sensitive fields |
| `apps/api/src/lib/ring-buffer.ts` | Ring buffer utilisation check + eviction warning helper |
| `apps/api/src/__tests__/quote-hardening.test.ts` | 15 TS unit tests (redaction + buffer + logging + no-order guarantee) |
| `services/kgi-gateway/tests/test_logging_redaction.py` | 5 Python tests verifying no raw credential in gateway logs |

## §3. Modified Files

| File | Change |
|---|---|
| `apps/api/src/broker/kgi-quote-client.ts` | Added structured logging (`withLatency` wrapper) to all 5 methods; added H-9 ring buffer warning to `getRecentTicks` |

## §4. H-6 Structured Logging Design

### Fields logged (per spec — allowed fields only)

| Field | Allowed | Present in log |
|---|---|---|
| `route` | YES | YES — `/api/v1/kgi/quote/*` |
| `symbol` | YES | YES — for symbol-scoped calls |
| `status` | YES | YES — HTTP status code from gateway |
| `latency_ms` | YES | YES — via `withLatency` wrapper |
| `freshness` | YES | YES — `"fresh"` / `"stale"` / `"not-available"` |
| `error_code` | YES | YES — class name on error path |
| `account` | **NEVER** | Absent — enforced by `redactSensitiveFields()` |
| `person_id` | **NEVER** | Absent — enforced by `redactSensitiveFields()` |
| `token` | **NEVER** | Absent — enforced by `redactSensitiveFields()` |
| `password` | **NEVER** | Absent — enforced by `redactSensitiveFields()` |
| `pfx` | **NEVER** | Absent — enforced by `redactSensitiveFields()` |
| `kgi_password` | **NEVER** | Absent — enforced by `redactSensitiveFields()` |
| `secret` | **NEVER** | Absent — enforced by `redactSensitiveFields()` |

### Sample log output (from test run)

```json
{"ts":"2026-04-27T12:04:27.932Z","level":"info","msg":"quote_status_ok","route":"/api/v1/kgi/quote/status","status":200,"latency_ms":14}
{"ts":"2026-04-27T12:04:27.933Z","level":"info","msg":"get_recent_ticks_ok","route":"/api/v1/kgi/quote/ticks","symbol":"2330","status":200,"latency_ms":0,"freshness":"fresh"}
{"ts":"2026-04-27T12:04:27.934Z","level":"warn","msg":"quote_ring_buffer_near_capacity","route":"/api/v1/kgi/quote/ticks","symbol":"2330","freshness":"fresh","buffer_used":181,"buffer_max":200,"utilization_pct":91,"at_capacity":false}
```

## §5. H-9 Ring Buffer Eviction Warning Design

- **Threshold**: 90% of `buffer_max` (configurable via `BUFFER_EVICTION_WARN_THRESHOLD` constant)
- **Trigger**: `getRecentTicks()` → on result → calls `checkBufferStatus()` → if `nearCapacity=true` → `logger.warn(...)`
- **Warning payload**: `buffer_used`, `buffer_max`, `utilization_pct`, `at_capacity`
- **Behavior**: warning only — no exception thrown, no route behavior change
- **Performance impact**: negligible (one arithmetic check per tick request)

## §6. `redactSensitiveFields()` — Redaction Proof

Redaction function signature:
```typescript
export function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown>
```

Redacted field set (case-insensitive match):
```
person_id, personid, person-id, account, token, accesstoken, access_token,
auth_token, authtoken, password, person_pwd, pwd, pfx, kgi_password,
kgipassword, secret, api_key, apikey
```

Test proof (W3-B1-T1 through T5):
- T1: `account` → `"[REDACTED]"`, `symbol` → passes through
- T2: `person_id` → `"[REDACTED]"`, `status` + `freshness` → pass through
- T3: `token`, `password`, `pfx`, `kgi_password` → all `"[REDACTED]"`
- T4: `TOKEN`, `PASSWORD`, `ACCOUNT` (uppercase) → all `"[REDACTED]"` (case-insensitive)
- T5: `route`, `symbol`, `status`, `latency_ms`, `freshness`, `error_code` → all pass through

## §7. No-Order Guarantee Proof

### Static grep

```bash
grep -n "order" apps/api/src/lib/logger.ts      # → 0 matches
grep -n "order" apps/api/src/lib/ring-buffer.ts # → 0 matches
grep -n "/order/create" apps/api/src/broker/kgi-quote-client.ts # → 0 matches
```

### Runtime test (W3-B1-T13)

All 5 quote operations (getQuoteStatus / getRecentTicks / getLatestBidAsk / subscribeSymbolTick / subscribeSymbolBidAsk) intercepted with fetch mock — 0 calls to `/order/*` URLs.

### Method enumeration (W3-B1-T15)

All method names on `KgiQuoteClient` prototype checked against patterns:
`["order", "submit", "place", "cancel", "modify", "create"]` → 0 matches.

## §8. Test Results

### TypeScript (B1-specific)

```
15 pass / 0 fail / 0 skip
W3-B1-T1 through W3-B1-T15
```

### Python gateway (full suite after B1 changes)

```
26 pass / 0 fail
5 new tests in test_logging_redaction.py
21 pre-existing tests all still green
```

### Typecheck

```
EXIT 0 (apps/api pnpm typecheck)
```

## §9. Stop-Line Audit

| Stop-line | Status |
|---|---|
| #4 /order/create touched | CLEAR — not touched |
| #5 order path imported | CLEAR — 0 order imports in new files |
| #6 paper/live wording | CLEAR — 0 paper/live wording |
| #8 secret in new evidence | CLEAR — test values are mock sentinels only |
| #9 contracts mutation | CLEAR — 0 contract files touched |
| #10 deploy | CLEAR |
| #11 merge | CLEAR |
| B1 sub-line: raw account/person_id/token in logs | CLEAR — redaction enforced + tested |
| B1 sub-line: quote contract changed | CLEAR — route behavior unchanged |

## §10. DRAFT PR Description Template

```
feat(w3-b1): H-6 structured logging + H-9 ring buffer eviction warning

W3 B1 quote hardening — read-only observability increment.

## Changes
- apps/api/src/lib/logger.ts (NEW): structured JSON logger with mandatory redaction
- apps/api/src/lib/ring-buffer.ts (NEW): ring buffer utilisation check helper
- apps/api/src/broker/kgi-quote-client.ts: added withLatency logging wrapper to all 5 methods
- apps/api/src/__tests__/quote-hardening.test.ts (NEW): 15 TS unit tests
- services/kgi-gateway/tests/test_logging_redaction.py (NEW): 5 Python redaction tests

## Observability fields logged
route / symbol / status / latency_ms / freshness / error_code

## Never logged
account / person_id / token / password / pfx / secret (runtime + test verified)

## Tests
- TS: 15/15 pass
- Python: 26/26 pass (5 new + 21 baseline)
- typecheck: EXIT 0

## Hard lines
- 0 order method / 0 /order/* URL / 0 contracts mutation / 0 deploy
- Redaction unit test PASS
- No-order guarantee proof: W3-B1-T13, W3-B1-T15

## DRAFT — NOT FOR MERGE
Sprint: W3 Read-Only Expansion Sprint
Lane: B1
```

— Jason, 2026-04-27 W3 sprint
