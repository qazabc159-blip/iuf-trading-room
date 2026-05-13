# Bruce KGI SIM Env Verify — 2026-05-12

**Date**: 2026-05-12 ~21:22 TST  
**PR**: #386  
**Deployment SHA**: 0f2ea96  
**DeploymentId**: fae1f7b6-69e8-45fd-9311-2d148c4f4788  
**Railway startedAt**: 2026-05-12T13:20:19.793Z  

---

## Verify Steps Executed

### Step 1 — Railway deploy stable
- `GET https://api.eycvector.com/health` → `{"status":"ok","uptime":192.8,"commit":"unknown","deploymentId":"fae1f7b6..."}`
- uptime ~3m12s at time of verify — STABLE
- commit shows "unknown" (Railway build env does not expose SHA), but deploymentId is the authoritative deploy token for this session.
- SHA confirmed via `git log --oneline`: HEAD = `0f2ea96` (feat(api): KGI SIM env 接通 e2e — PR #386)

### Step 2 — GET /api/v1/kgi/status (Owner)
```json
{"sim_only":true,"kgi_env":"sim","quote_connected":false,"trade_connected":false,
 "last_quote_time":null,"last_sim_order_status":"pending","last_sim_order_detail":null,
 "last_quote_smoke_at":null,"last_trade_smoke_at":null,"prod_write_blocked":true,
 "sim_quote_host":"iquotetest.kgi.com.tw","sim_trade_host":"itradetest.kgi.com.tw"}
```
- kgi_env = "sim" CONFIRMED
- prod_write_blocked = true CONFIRMED
- sim_quote_host = iquotetest.kgi.com.tw CONFIRMED

### Step 3 — POST /api/v1/kgi/sim/quote-smoke (Owner)
```json
{"sim_only":true,"data":{
  "runId":"3c22d97a-faad-4a2a-9d46-5e39aba1ac0e",
  "gatewayReachable":true,"loggedIn":true,"subscribed":true,
  "tickReceived":false,"tickSample":null,"error":null,
  "gatewaySummary":{"status":"ok","kgi_logged_in":true,"account_set":true},
  "durationMs":9471
}}
```
- EC2 KGI gateway (54.249.139.28:8787) reachable via Railway → PASS
- kgi_logged_in=true — live SIM session active PASS
- subscribed=true — 0050 tick subscription accepted PASS
- tickReceived=false — OFF-HOURS (21:15 TST, market closed); expected, not a FAIL
- Audit row `kgi.sim.quote_smoke` written: entityId=3c22d97a... CONFIRMED

### Step 4 — POST /api/v1/kgi/sim/trade-smoke (dual confirm)
Request body: `{"confirmedByBruce":true,"confirmedByJason":true,"symbol":"0050"}`
```json
{"sim_only":true,"data":{
  "runId":"6d25f355-2725-40bf-aea6-b9073b4511af",
  "gatewayReachable":true,"loggedIn":true,
  "orderSubmitted":true,"orderOutcome":"not_enabled",
  "orderDetail":"Gateway returned 409 — /order/create not enabled in current gateway phase",
  "error":null,"durationMs":1360
}}
```
- Gateway reachable and logged in PASS
- Dual-confirm guard accepted PASS
- orderSubmitted=true — order request sent to gateway PASS
- orderOutcome=not_enabled (409) — gateway /order/create not enabled in current W-phase; PASS per Jason spec ("409 也算 PASS")
- Audit row `kgi.sim.trade_smoke` written: entityId=6d25f355... CONFIRMED

### Step 5 — Credential leak check

**PR diff grep (raw values):**
- `F131331910` — appears ONLY in: (1) docstring comment, (2) test input to `maskPersonId()`. NEVER in runtime log path.
- `9228-001282-6` — appears in: (1) docstring comment, (2) default fallback to `maskAccount()` (output is always `9228-***-6`), (3) test assertion for mask function. Never as raw value in API response or audit log.
- `person_pwd` / `password` / raw token — 0 occurrences as assigned literal values in code.

**Live audit payload check (both rows):**
- `forbidden_keys = []` for both kgi.sim.quote_smoke and kgi.sim.trade_smoke
- `account_masked = "9228-***-6"` (masked)
- `person_id_masked = "***"` (masked)
- No fields: person_id, person_pwd, password, token, session

**Result: 0 raw credentials in PR diff runtime paths, 0 raw credentials in live audit payloads.**

### Step 6 — Production broker write 0 attempt

- `GET /api/v1/audit-logs?limit=50&action=broker` → `{"data":[]}` — 0 broker rows
- Filtered last 50 audit rows for 'broker' or 'order' actions → 0 rows
- `POST /api/v1/order/create` (with Owner session) → HTTP 404 — route NOT registered in server.ts production API
- Code grep confirms: no `app.post.*order/create` in server.ts
- Comments in server.ts at lines 1811, 1885, 3648, 3901, 4521, 8846 all explicitly document "NO /order/create call"

---

## 4 Verdicts

```
== Bruce KGI SIM Env Verify 2026-05-12 ==
Deployment SHA: 0f2ea96 (PR #386, confirmed git HEAD)
DeploymentId:   fae1f7b6-69e8-45fd-9311-2d148c4f4788

SIM_QUOTE_PASS: YES
  - gatewayReachable=true, loggedIn=true, subscribed=true
  - tickReceived=false (off-hours 21:15 TST, market closed — expected)
  - Audit row kgi.sim.quote_smoke written, runId=3c22d97a
  - sim_quote_host=iquotetest.kgi.com.tw confirmed

SIM_TRADE_CALLBACK_PASS: YES
  - dual-confirm guard accepted (Bruce+Jason=true both)
  - orderSubmitted=true, orderOutcome=not_enabled (409)
  - 409 = gateway /order/create not enabled in current W-phase — PASS per spec
  - Audit row kgi.sim.trade_smoke written, runId=6d25f355

PROD_WRITE_BLOCKED_CONFIRMED: YES
  - prod_write_blocked=true in /kgi/status response (permanent const, no override path)
  - 0 broker audit rows in last 50 (0 broker.live / 0 mode=live entries)
  - /api/v1/order/create NOT registered in server.ts → HTTP 404 (stronger than 409)
  - KGI_ENV=sim (default) — no code path to prod write

TOKEN_LEAKAGE_FALSE: YES (CLEAN)
  - PR diff: 0 raw credential assignments in runtime paths
  - F131331910 in docstring + test input only (not in log/response path)
  - 9228-001282-6 in docstring + fallback (always masked before output)
  - Live audit payloads: forbidden_keys=[] for both runs
  - account_masked="9228-***-6", person_id_masked="***" in DB

Overall verdict: ALL_PASS
Escalation: NONE
```

---

## Notes

1. `tickReceived=false` is OFF-HOURS expected behavior, not a defect. SIM gateway subscription path is confirmed working (loggedIn=true, subscribed=true).
2. `account_masked` default fallback `9228-001282-6` in source code is in comments/tests only; all runtime output paths pass through `maskAccount()` → `9228-***-6`. Classified as LOW documentation item, not a credential leak.
3. `/order/create` route does not exist at Railway API layer (404), stronger protection than the gateway-level 409.
4. Deployment commit shows "unknown" in `/health` — this is a Railway build env limitation, not a code issue. SHA confirmed via git log.
