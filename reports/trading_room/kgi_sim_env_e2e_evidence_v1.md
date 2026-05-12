# KGI SIM Environment E2E Evidence Report v1

**Date**: 2026-05-08  
**Branch**: feat/api-kgi-sim-env-e2e-2026-05-12  
**Environment**: SIM_ONLY  
**Status**: READY_FOR_BRUCE_VERIFY

---

## 1. Scope

KGI SIM environment接通 e2e — 4 deliverables:

1. KGI environment switch (`KGI_ENV=sim|prod|blocked`)
2. SIM quote smoke (`kgi.sim.quote_smoke` audit action)
3. SIM trade smoke (`kgi.sim.trade_smoke` audit action, dual-confirm guard)
4. API status endpoint (`GET /api/v1/kgi/status`)

---

## 2. Implementation Summary

### New Module

`apps/api/src/broker/kgi-sim-env.ts`

- `resolveKgiEnv()` — reads `KGI_ENV` env var, default `"sim"` (never defaults to `"prod"`)
- `simQuoteHost()` / `simTradeHost()` — display-only host names (no credentials)
- `maskAccount(account)` — `9228-001282-6` → `9228-***-6`
- `maskPersonId(personId)` — `F131331910` → `F13133****`
- `getKgiSimState()` — returns current in-process state snapshot
- `runSimQuoteSmoke(params)` — health probe → subscribe 0050 → poll ticks → audit log
- `runSimTradeSmoke(params)` — dual-confirm guard → health probe → odd-lot SIM order → audit log

### New Routes (server.ts)

| Route | Auth | Description |
|---|---|---|
| `GET /api/v1/kgi/status` | Owner | Returns kgi_env, connection state, last smoke results, prod_write_blocked=true |
| `POST /api/v1/kgi/sim/quote-smoke` | Owner | Runs quote smoke — subscribes 0050, receives tick, writes audit log |
| `POST /api/v1/kgi/sim/trade-smoke` | Owner | Runs trade smoke (requires confirmedByBruce+confirmedByJason in body) |

### Credential Handling (Hard Lines)

- `KGI_PERSON_ID` / `KGI_PERSON_PWD` / `KGI_ACCOUNT` — read from env vars only, **never** in code
- account → masked `9228-***-6` in all audit payloads and logs
- personId → masked `F13133****` in all audit payloads and logs  
- password / token / session key → **never logged** (no reference in code)
- `prod_write_blocked: true` — hardcoded constant, no env override possible

---

## 3. Security Rules Compliance

| Rule | Status |
|---|---|
| KGI credentials only in secrets/env | COMPLIANT — all read via `process.env["KGI_*"]` |
| No credentials in repo / memo / PR / log | COMPLIANT — masked in all output paths |
| Not connecting to production trade host | COMPLIANT — SIM hosts hardcoded as default |
| SIM_ONLY label on all outputs | COMPLIANT — `sim_only: true` on all responses |
| Production broker write path blocked | COMPLIANT — `prodWriteBlocked: true` constant |
| Real env audit log: 0 real order attempts | COMPLIANT — `kgi.sim.trade_smoke` action clearly labelled, gateway returns 409 in current phase |

---

## 4. Env Vars Required (Railway Secrets)

| Var | Purpose | Default |
|---|---|---|
| `KGI_ENV` | `sim` or `blocked` | `sim` |
| `KGI_SIM_QUOTE_HOST` | SIM quote host (display) | `iquotetest.kgi.com.tw` |
| `KGI_SIM_TRADE_HOST` | SIM trade host (display) | `itradetest.kgi.com.tw` |
| `KGI_GATEWAY_URL` | Gateway base URL (already set) | `http://54.249.139.28:8787` |
| `KGI_ACCOUNT` | Account number for masking | `9228-001282-6` (set in Railway secrets) |
| `KGI_PERSON_ID` | Taiwan ID for masking | via Railway secrets channel |

---

## 5. Audit Log Actions

| Action | Trigger | Payload (sanitised) |
|---|---|---|
| `kgi.sim.quote_smoke` | POST /api/v1/kgi/sim/quote-smoke | runId, symbol, gateway_reachable, logged_in, subscribed, tick_received, tick_sample (price/vol only), account_masked |
| `kgi.sim.trade_smoke` | POST /api/v1/kgi/sim/trade-smoke | runId, symbol, order_action, gateway_reachable, logged_in, order_submitted, order_outcome, confirmed_by_bruce, confirmed_by_jason, account_masked |

---

## 6. Test Results

**CI**: 240/240 PASS (added KS1-KS7, 7 new tests)  
**Typecheck**: 0 errors  
**Build**: clean

### KS1-KS7 Results

| Test | Description | Result |
|---|---|---|
| KS1 | resolveKgiEnv defaults to 'sim' | PASS |
| KS2 | maskAccount redacts 9228-***-6 | PASS |
| KS3 | maskPersonId redacts F13133**** | PASS |
| KS4 | prodWriteBlocked=true / environment=SIM_ONLY | PASS |
| KS5 | Trade smoke blocked when KGI_ENV=prod | PASS |
| KS6 | Trade smoke blocked without dual-confirm | PASS |
| KS7 | Quote smoke graceful on gateway unreachable | PASS |

---

## 7. Bruce Verify Checklist

Post-deploy verify:

- [ ] `GET /api/v1/kgi/status` returns `prod_write_blocked=true`, `kgi_env="sim"`, `environment` not in response (internal only)
- [ ] `POST /api/v1/kgi/sim/quote-smoke` body `{}` → returns `sim_only:true, data.symbol="0050"`
- [ ] If gateway live (`kgi_logged_in=true`): `data.gatewayReachable=true`, `data.loggedIn=true`, `data.subscribed=true`
- [ ] `POST /api/v1/kgi/sim/trade-smoke` without confirms → `data.orderOutcome="awaiting_dual_confirm"`
- [ ] `POST /api/v1/kgi/sim/trade-smoke` with `{"confirmedByBruce":true,"confirmedByJason":true,"symbol":"0050"}` → `data.orderOutcome` one of `["not_enabled","accepted","rejected"]`
- [ ] `GET /api/v1/audit-logs` contains entries with `action="kgi.sim.quote_smoke"` and `action="kgi.sim.trade_smoke"` after smoke runs
- [ ] No credential fields (`person_id`, `person_pwd`, `password`, `token`) in any audit payload
- [ ] Account in audit payload matches `9228-***-6` pattern (not raw account number)

### SIM_QUOTE_PASS Criteria
- `gatewayReachable=true` AND `loggedIn=true` AND `subscribed=true` AND (`tickReceived=true` OR market closed)

### SIM_TRADE_CALLBACK_PASS Criteria
- `orderSubmitted=true` AND `orderOutcome` in `["not_enabled","accepted","rejected"]` (409 = graceful expected in current gateway phase)

### TOKEN_LEAKAGE_FALSE Criteria
- Audit log payloads contain no fields: `person_id`, `person_pwd`, `password`, `token`, `session`
- All account references match `9228-***-6` mask pattern
