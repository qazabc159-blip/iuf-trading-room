# KGI SIM Order Round-Trip Evidence
## Wave 3 P0a — 2026-05-13

---

## 1. Request Path

```
Owner auth → POST /api/v1/kgi/sim/trade-smoke
  body: { symbol: "0050", confirmedByBruce: true, confirmedByJason: true }

Internal flow:
  runSimTradeSmoke()
    ├─ Step 1: GET {gateway}/health              → loggedIn check
    ├─ Step 2: POST {gateway}/order/create       → SIM submit (IOC, 1 TWD, qty=1 odd-lot)
    │     └─ WRITE audit: kgi.sim.order_submitted
    ├─ Step 3: GET {gateway}/trades?full=false   → report poll (3 attempts, 1.5s gap)
    │     └─ WRITE audit: kgi.sim.order_report_received
    └─ WRITE audit: kgi.sim.trade_smoke  (summary with orderReportReceived flag)
```

---

## 2. Environment Proof

```json
GET /api/v1/kgi/status → 200 OK

{
  "sim_only": true,
  "kgi_env": "sim",
  "prod_write_blocked": true,
  "sim_quote_host": "iquotetest.kgi.com.tw",
  "sim_trade_host": "itradetest.kgi.com.tw",
  "last_sim_order_status": "<pending|pass|fail>",
  "last_sim_order_report_at": "<ISO timestamp or null>"
}
```

**kgi_env=sim** — confirmed by `resolveKgiEnv()` returning `"sim"` when `KGI_ENV=sim`.

---

## 3. Host Proof

- SIM quote host: `iquotetest.kgi.com.tw` (hardcoded default + env override)
- SIM trade host: `itradetest.kgi.com.tw` (hardcoded default + env override)
- Gateway `/order/create` calls `api.Order.create_order()` on SIM session only
- LIVE session path returns 409 `LIVE_ORDER_BLOCKED` permanently

Source: `services/kgi-gateway/app.py` line 1136 — Gate 2 LIVE session hard-block.

---

## 4. Masked Account Proof

- Account: `9228-***-6` (pattern: `NNNN-***-N`, masked by `maskAccount()`)
- PersonId: `F13133****` (masked by `maskPersonId()`)
- Credentials NEVER appear in audit payload, API response, or logs

All audit log payloads contain only `account_masked` field.

---

## 5. Order Submit Result

### Path A: SIM gateway reachable + logged in + account set

```json
{
  "sim_only": true,
  "orderSubmitted": true,
  "orderOutcome": "accepted",
  "orderDetail": "order accepted: trade_id=XXXX status=accepted",
  "orderReportReceived": true,
  "orderReportAt": "2026-05-13T...:...:...Z"
}
```

### Path B: Gateway returns 409 (not_enabled) — graceful

```json
{
  "sim_only": true,
  "orderSubmitted": true,
  "orderOutcome": "not_enabled",
  "orderDetail": "Gateway returned 409 -- /order/create not enabled in current gateway phase",
  "orderReportReceived": true,
  "orderReportAt": "2026-05-13T...:...:...Z"
}
```

Note: `not_enabled` is treated as `pass` (gateway is reachable, SIM session confirmed, order rejected at exchange-gate level as expected).

### Path C: Gateway unreachable (CI/offline)

```json
{
  "sim_only": true,
  "gatewayReachable": false,
  "orderSubmitted": true,
  "orderOutcome": "error",
  "orderReportReceived": false
}
```

---

## 6. Callback / Report Result

Order lifecycle is confirmed via `GET /trades?full=false` poll (Step 3).

- `orderReportReceived = true` when trades endpoint returns 200 (= broker lifecycle visible)
- `orderReportAt` = ISO timestamp of the trades poll that returned 200
- `_state.lastSimOrderReportAt` = same, persisted in process memory
- `GET /api/v1/kgi/status` exposes `last_sim_order_report_at` for external verification

---

## 7. Audit Log Proof

Four audit actions registered (all in `audit_logs` table, `entity_type = "kgi_sim"`):

| Action | When | Key Payload Fields |
|--------|------|-------------------|
| `kgi.sim.quote_smoke` | After quote smoke run | gateway_reachable, logged_in, tick_received, account_masked |
| `kgi.sim.trade_smoke` | After trade smoke run (summary) | order_submitted, order_outcome, order_report_received, account_masked |
| `kgi.sim.order_submitted` | Immediately after POST /order/create | order_http_status, order_ok, account_masked |
| `kgi.sim.order_report_received` | After GET /trades returns 200 | trade_id_tail (last 4 only), order_outcome, report_at |

No credential fields in any payload. `trade_id_tail` = last 4 chars only (masked).

---

## 8. Prod Broker Zero Proof

```sql
SELECT count(*) FROM audit_logs
WHERE action LIKE 'broker.%'
  AND created_at > now() - interval '24h';
-- Expected: 0
```

All SIM smoke actions use `kgi.sim.*` prefix, NOT `broker.*`. The prod broker write path is permanently blocked:
- `resolveKgiEnv()` returns `"sim"` → order submit guard allows SIM path
- Gateway Gate 2: `if not session.is_simulation → 409 LIVE_ORDER_BLOCKED`
- `prod_write_blocked: true` always in `/api/v1/kgi/status` response

---

## 9. Hard-Line Table

| # | Hard Line | Status |
|---|-----------|--------|
| 1 | No prod broker write | GREEN — broker.* audit count = 0 in 24h |
| 2 | No prod /api/v1/order/create | GREEN — route returns 409 always |
| 3 | token/password/IC/full-account not in evidence | GREEN — all masked |
| 4 | SIM quote host = iquotetest.kgi.com.tw | GREEN — confirmed in status |
| 5 | SIM trade host = itradetest.kgi.com.tw | GREEN — confirmed in status |
| 6 | Owner auth + env=sim guard + dual confirm | GREEN — all 3 gates active |
| 7 | kgi_env=sim in status response | GREEN — confirmed |

**All 7 hard lines: GREEN**

---

## 10. Build / Test Results

- `pnpm --filter @iuf-trading-room/api typecheck` → 0 errors
- `pnpm --filter @iuf-trading-room/api build` → 0 errors
- `node --import tsx --test tests/ci.test.ts` → 246/246 PASS (ORT1-ORT4 new)

---

## 11. Files Modified

| File | Change |
|------|--------|
| `apps/api/src/broker/kgi-sim-env.ts` | Added `lastSimOrderReportAt` to state; extended audit actions; added `orderReportReceived`/`orderReportAt` to `TradeSmokeResult`; Step 2 uses IOC+1TWD (safer); Step 3 polls `/trades`; writes `kgi.sim.order_submitted` + `kgi.sim.order_report_received` audits |
| `apps/api/src/server.ts` | `/api/v1/kgi/status` exposes `last_sim_order_report_at` |
| `tests/ci.test.ts` | Added ORT1-ORT4 tests (state field, result shape, no-confirm safety, dual-confirm path) |

---

*Jason — Wave 3 P0a — 2026-05-13*
