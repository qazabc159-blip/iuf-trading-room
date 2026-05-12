# KGI SIM Daily Smoke Plan v1

**Status**: IMPLEMENTED — PR `feat/api-kgi-sim-daily-smoke-cron-2026-05-13`
**Date**: 2026-05-13
**Author**: Jason (backend-strategy lane)

---

## 1. Purpose

Single-pass PASS on 2026-05-08 is not a stability guarantee.
This plan establishes a daily automated smoke run that verifies SIM connectivity every morning,
proves prod-write is still blocked, and surfaces 7-day history via a new internal endpoint.

**Hard lines preserved**:
- NEVER submits to production broker (`prodWriteBlocked: true` hardcoded)
- NEVER logs credentials (masked: `9228-***-6`, `F13133****`)
- SIM_ONLY tag present on all payloads and responses

---

## 2. Architecture

### 2a. Cron trigger

- **Scheduler**: `setInterval` polling every 15 minutes (same pattern as all other schedulers)
- **Window guard**: `runKgiSimDailySmokeSchedulerTick({ forceRun: false })` fires only when `UTC hour == 0 && minute < 30` (= 08:00–08:30 TST)
- **Idempotency**: skips if already fired today (compares TST wall-clock date of last ring buffer entry)
- **Registration**: inside `startSchedulers()` in `server.ts` — no separate process, no external cron daemon

### 2b. Daily smoke steps

| Step | Action | Pass condition |
|------|--------|---------------|
| 1 | Quote smoke (`runSimQuoteSmoke`, symbol=0050) | `gatewayReachable && loggedIn` |
| 2 | Prod-write audit probe | `broker.*` audit_log entries in last 24h == 0 |
| 3 | Trade smoke (gated) | skipped by default (dual-confirm not set in cron); only runs if `confirmedByBruce=true && confirmedByJason=true` provided |

**Overall status logic**:
- `pass` — quote pass + trade pass/skipped + audit clean
- `fail` — quote unreachable or not logged in
- `partial` — quote ok but audit dirty or trade reject

### 2c. Result storage

- **Ring buffer**: `_dailySmokeHistory[]` (max 7 entries, in-memory per process, not persisted to DB)
- **Audit log**: `audit_logs` table, `action='kgi.sim.daily_smoke'` — survives restarts

### 2d. New endpoint

```
GET /api/v1/internal/kgi/sim/daily-smoke-status
Authorization: Owner role required
```

Response shape:
```json
{
  "sim_only": true,
  "prod_write_blocked": true,
  "lastRunAt": "2026-05-13T00:08:45.123Z",
  "lastRunStatus": "pass",
  "lastProdBrokerAuditCount": 0,
  "history": [
    {
      "sim_only": true,
      "runId": "...",
      "firedAt": "...",
      "overallStatus": "pass",
      "quoteCheck": { "gatewayReachable": true, "loggedIn": true, "tickReceived": true, "error": null },
      "tradeCheck": null,
      "prodBrokerAuditCount": 0,
      "durationMs": 1234
    }
  ],
  "scheduledWindow": "08:00-08:30 TST (00:00-00:30 UTC) daily",
  "auditAction": "kgi.sim.daily_smoke"
}
```

Returns up to 7 days of history, newest first.

---

## 3. Files Changed

| File | Change |
|------|--------|
| `apps/api/src/broker/kgi-sim-env.ts` | Added `DailySmokeHistoryEntry` interface, `_dailySmokeHistory` ring buffer, `getDailySmokeHistory()`, `_resetDailySmokeHistory()`, `runKgiSimDailySmokeSchedulerTick()`. Added `drizzle-orm` import for `and/eq/gte/like`. Expanded `writeKgiAuditLog` action union to include `kgi.sim.daily_smoke`. |
| `apps/api/src/server.ts` | Expanded kgi-sim-env import. Added `GET /api/v1/internal/kgi/sim/daily-smoke-status` endpoint. Added 15-min polling cron (`KGI_SIM_DAILY_SMOKE_POLL_MS`) in `startSchedulers()`. Updated scheduler startup log string. |
| `tests/ci.test.ts` | Added DS1-DS4: `getDailySmokeHistory` empty start, `forceRun=true` structure validation, ring buffer cap=7 + newest-first ordering, outside-window null return. |

---

## 4. Prod-Write Blocked Proof

Each daily smoke run queries `audit_logs` for `broker.*` action entries in the last 24h and
reports the count as `prodBrokerAuditCount` in both the ring buffer and the audit log entry.

Expected value: **0** in every run (no production broker writes ever).

If `prodBrokerAuditCount > 0`, a `console.warn` ALERT is logged:
```
[kgi-sim-daily-smoke] ALERT: N broker.* audit entries in last 24h — prod write may have occurred.
```

Additionally, the existing `/order/create` 404 guarantee remains: that route is not registered in
`server.ts` (paper orders use `/api/v1/paper/orders` — separate path), so any stray call to
`/api/v1/kgi/order/create` returns 404.

---

## 5. Build + Test Evidence

- `pnpm --filter @iuf-trading-room/contracts build` — GREEN (0 errors)
- `pnpm --filter @iuf-trading-room/api typecheck` — GREEN (0 errors)
- `pnpm --filter @iuf-trading-room/api build` — GREEN (0 errors)
- `pnpm test` — **245/245 PASS** (was 236; added 4 DS tests + 5 counting DS2 sub-assertions)
- DS1: `getDailySmokeHistory` empty on fresh start — PASS
- DS2: `forceRun=true` returns valid entry structure — PASS
- DS3: ring buffer capped at 7, newest-first — PASS
- DS4: outside window returns null — PASS

---

## 6. Bruce Verification Steps (post-deploy)

1. Wait until 08:00–08:30 TST on any trading day, then:
   ```
   GET /api/v1/internal/kgi/sim/daily-smoke-status
   ```
   Expect: `lastRunStatus="pass"`, `lastProdBrokerAuditCount=0`, 1+ entries in `history`.

2. Check audit_logs for action=`kgi.sim.daily_smoke` entries — should appear once per morning.

3. Verify `prod_write_blocked: true` is present in every response.

4. Manual force trigger (no cron window needed):
   - Call `POST /api/v1/kgi/sim/quote-smoke` (Owner auth) to fire a one-off quote smoke
   - Then `GET /api/v1/internal/kgi/sim/daily-smoke-status` to see current state

---

## 7. Lane Boundary

No changes to:
- `risk-engine.ts`, `risk.ts`
- `broker/paper-broker.ts`, `broker/kgi-broker.ts`, `broker/kgi-gateway-client.ts`
- `market-data.ts`, `marketData.ts`
- `apps/web/*`

Only `kgi-sim-env.ts`, `server.ts` (strategy+kgi sim section), and `tests/ci.test.ts` (DS block).
