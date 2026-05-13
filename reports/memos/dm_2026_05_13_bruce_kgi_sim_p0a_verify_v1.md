# Bruce KGI SIM P0-A Verify Memo v1

**Date**: 2026-05-13  
**Branch**: `feat/gateway-unlock-sim-order-p0a-2026-05-13`  
**PR**: #406  
**Commits audited**: `8277231` (cherry-pick 3-gate from `28aeaeb`) + `f2a6da6` (enum conversion fix)  
**Verifier**: Bruce  
**Method**: Static source audit (Bash/gh CLI ENAMETOOLONG — all evidence from Read/Grep tools)

---

## Verdict Table

| # | Check | Verdict | Byte-cite / Evidence Path |
|---|---|---|---|
| 1 | SIM_ORDER_ACCEPTED | **PARTIAL_NO_LIVE_CURL** | See §1 |
| 2 | CALLBACK_RECEIVED | **PARTIAL_NO_LIVE_WS_TRACE** | See §2 |
| 3 | PRODUCTION_BROKER_WRITE_ZERO | **PASS** | See §3 |
| 4 | AUDIT_LOG_REDACTION_OK | **PASS** | See §4 |

**Total Verdict**: `PARTIAL_LIVE_CURL_UNAVAILABLE`

---

## §1 — SIM_ORDER_ACCEPTED

**Verdict**: PARTIAL_NO_LIVE_CURL

### What static audit confirms

**3-gate architecture present and correct** (`services/kgi-gateway/app.py` line 1125–1227):

```
Gate 1: NOT_LOGGED_IN      → 409 (app.py:1139-1149)
Gate 2: LIVE_ORDER_BLOCKED → 409 when session.is_simulation is False (app.py:1152-1165)
Gate 3: SIM session        → CreateOrderRequest.model_validate → sdk.Order.create_order → 200 sim_only=True (app.py:1192-1216)
```

- Gate 2 wiring: `session.is_simulation` property from `kgi_session.py:218` reads `self._simulation` set at login time — structurally correct.
- Gate 3 response: `OrderCreateResponse(ok=True, sim_only=True, status="accepted", kgi_response_repr=sdk_repr)` (app.py:1210-1215) — `sim_only=True` is a `Literal[True]` in `schemas.py:198`, not a string, enforced by Pydantic.
- `schemas.py:180-189`: `CreateOrderRequest` accepts `action: Literal["Buy", "Sell"]`, `time_in_force: Literal["ROD","IOC","FOK"] = "ROD"`, `order_cond: Literal["Cash",...] = "Cash"` — enum strings match kgisuperpy convention.
- Commit `f2a6da6` (enum conversion fix) addresses the Buy/ROD/Cash string-to-kgisuperpy-enum mapping at SDK call site — structurally sound per schema alignment.
- Commit `8277231` (cherry-pick `28aeaeb`) is the 3-gate implementation itself — both commits present on branch.

**楊董 verbatim evidence** (from task brief):
- Local gateway `localhost:8787` — SIM session
- `POST /order/create {symbol:"0050", qty:1, odd_lot:true}` → `order_id=V000L`, `status="accepted"`
- Operator-reported live execution: `Submitted + NewOrder Success` visible in `/trades`

**Gap**: Bruce cannot run `curl.exe localhost:8787/health` or `curl.exe localhost:8787/trades` because Bash tool is ENAMETOOLONG on this machine. Cannot independently reproduce the `order_id=V000L` / `/trades` payload from Bruce's tooling.

**Confidence**: STRUCTURAL_PASS + OPERATOR_VERBAL_EVIDENCE. Cannot reach live curl confirmation independently.

**Recommended action for full PASS**: 楊董 or Elva paste raw curl output from `localhost:8787/health` and `localhost:8787/trades` showing `order_id=V000L` status. One paste = full PASS upgrade.

---

## §2 — CALLBACK_RECEIVED

**Verdict**: PARTIAL_NO_LIVE_WS_TRACE

### What static audit confirms

WebSocket infrastructure present (`apps/api/src/broker/kgi-gateway-client.ts` line 546–572):

```typescript
connectOrderEventStream(): void {
  const wsEndpoint = `${this.wsUrl}/events/order/attach`;   // line 549
  ws.addEventListener("message", (evt) => {
    const msg = JSON.parse(evt.data) as { type: string; data: unknown };
    if (msg.type === "order_event" && this.orderEventCallback) {
      this.orderEventCallback(msg.data as KgiOrderEventRaw);   // line 558
    }
  });
}
```

- `/events/order/attach` WS route present in `app.py` line 17 (route table comment) and line 1114 (WebSocketDisconnect handler).
- audit log writer `writeKgiAuditLog` in `kgi-sim-env.ts:146` can write `kgi.sim.order_submitted` (line 496) and `kgi.sim.order_report_received` (line 541) — both fired after a real `/order/create` 200 response.
- Task brief states: callback data `Task.NewOrder / Status.Success / order_id=V000L` received — this aligns with KGI SDK event shape.

**Gap**: Bruce cannot attach a WS client to `localhost:8787/events/order/attach` from current tooling. Cannot independently trace the 2-event sequence. The audit log entry for `kgi.sim.order_report_received` is in DB (Railway prod), not on localhost gateway — so the Railway audit log probe is required post-deploy of PR #406.

**Recommended action for full PASS**: After PR #406 deploy to Railway + SIM smoke run, `GET /api/v1/audit-logs?action=kgi.sim.order_submitted&limit=5` and `GET /api/v1/audit-logs?action=kgi.sim.order_report_received&limit=5` should both return entries. Or paste WS event log from local gateway session.

---

## §3 — PRODUCTION_BROKER_WRITE_ZERO

**Verdict**: PASS

### Evidence

**Check A — EC2 LIVE gateway `/order/create` = 409 LIVE_ORDER_BLOCKED**

Source-code proof that Gate 2 is unconditional (`services/kgi-gateway/app.py:1151-1165`):

```python
# Gate 2: LIVE_ORDER_BLOCKED — permanent
if session.is_simulation is False:              # app.py:1152
    logger.info("POST /order/create rejected: LIVE_ORDER_BLOCKED (simulation=False)")
    return JSONResponse(
        status_code=409,
        content=ErrorEnvelope(
            error=ErrorDetail(
                code="LIVE_ORDER_BLOCKED",      # app.py:1158
                ...
            )
        ).model_dump(),
    )
```

EC2 production gateway (`54.249.139.28:8787`) runs with LIVE session (`simulation=False`). Gate 2 fires before Gate 3 unconditionally. No bypass path exists in the code.

**Check B — Railway API `/api/v1/order/create` = 404**

Grep confirms zero `app.post("/api/v1/order/create"` matches in `apps/api/src/server.ts` — the route does not exist. Any POST to this path returns 404 from the Hono catch-all. Bruce memory pattern `memory_kgi_sim_env_verify_pattern.md`: "/order/create route absent from server.ts (404 stronger than 409)". CONFIRMED still absent.

**Check C — `broker.*` action count in audit_log = 0**

`apps/api/src/server.ts` grep for `action.*broker\.` returns zero matches in write paths — no code writes `broker.*` audit actions. The daily smoke scheduler at `kgi-sim-env.ts:728` reads `action LIKE 'broker.%'` to detect prod writes — and the expected result is 0, which is the pass criterion per spec.

**All 3 sub-checks PASS from static audit.**

---

## §4 — AUDIT_LOG_REDACTION_OK

**Verdict**: PASS

### Evidence

`apps/api/src/broker/kgi-sim-env.ts` redaction evidence:

| Credential | Handling | Cite |
|---|---|---|
| `KGI_PERSON_ID` | `maskPersonId()` → `F13133****` before any log/audit write | kgi-sim-env.ts:55-58, 377 |
| `KGI_PERSON_PWD` | Never read in TS code; Python gateway masks at login layer | kgi-sim-env.ts:13 (comment), kgi_session.py:246-247 |
| `KGI_ACCOUNT` | `maskAccount()` → `9228-***-6` pattern in all 3 audit payloads | kgi-sim-env.ts:49-51, 376, 505, 591 |
| `token` / `session key` | Zero occurrences in audit payload builders | kgi-sim-env.ts:358-379, 494-506, 570-592 |

Audit payload builders (`runSimQuoteSmoke` line 358-379, `runSimTradeSmoke` line 494-506 and 570-592) include ONLY:
- `sim_only`, `run_id`, `symbol`, `gateway_reachable`, `logged_in`, `subscribed`, `tick_received`, `tick_sample` (price/volume/datetime only)
- `order_http_status`, `order_ok`, `order_action`, `order_submitted`, `order_outcome`, `order_detail`, `order_report_received`, `order_report_at`
- `account_masked` (masked string), `person_id_masked` (masked string)
- `confirmed_by_bruce`, `confirmed_by_jason`

Forbidden keys scan: `token`, `person_id` (raw), `person_pwd`, `password`, `session`, `broker_id` (raw) — **ZERO occurrences** in the 3 audit payload builders.

**Per 5/12 Bruce KGI_SIM_ENV_VERIFY standard**: `forbidden_keys=[]` — CONFIRMED.

The `gatewaySummary` field in `QuoteSmokeResult` (kgi-sim-env.ts:204-206) contains only `{ status, kgi_logged_in, account_set }` — no credentials.

---

## Hard Line Attestation

```
HARD_LINE_ATTESTATION — Bruce 2026-05-13

[HL1] Gate 2 LIVE_ORDER_BLOCKED is PERMANENT and UNCONDITIONAL.
      app.py:1152 — `if session.is_simulation is False:` fires BEFORE Gate 3.
      No code path in the audited commits bypasses this gate.
      CONFIRMED.

[HL2] Railway API /api/v1/order/create does NOT EXIST.
      grep on server.ts: 0 matches for app.post(...)order/create.
      Any live order attempt to Railway API → 404.
      CONFIRMED.

[HL3] No credential (token/person_id/person_pwd/password/account_id) appears
      in any audit log payload builder.
      All account references are masked via maskAccount() / maskPersonId().
      CONFIRMED.

[HL4] prodWriteBlocked is a Readonly<true> constant in KgiSimState.
      kgi-sim-env.ts:86 — `readonly prodWriteBlocked: true`
      kgi-sim-env.ts:110 — `prodWriteBlocked: true` in initial state literal.
      No setter exists. Cannot be overridden at runtime.
      CONFIRMED.

[HL5] SIM-session check in Gate 3:
      Order submission only reaches kgisuperpy if `session.is_simulation` is neither
      False nor None (i.e., explicitly SIM session).
      EC2 production gateway uses simulation=False → blocked at Gate 2 always.
      CONFIRMED.
```

---

## Summary

| Check | Verdict | Blocker |
|---|---|---|
| SIM_ORDER_ACCEPTED | PARTIAL_NO_LIVE_CURL | Need raw curl paste from 楊董/operator |
| CALLBACK_RECEIVED | PARTIAL_NO_LIVE_WS_TRACE | Need audit-log probe post-deploy or WS event paste |
| PRODUCTION_BROKER_WRITE_ZERO | **PASS** | None |
| AUDIT_LOG_REDACTION_OK | **PASS** | None |

**Total Verdict**: `PARTIAL_LIVE_CURL_UNAVAILABLE`

Bruce cannot issue `BRUCE_KGI_SIM_P0A_DEPLOY_LIVE_PASS` from static audit alone.

**Upgrade path to full PASS** (2 items, both operator-executable):
1. 楊董 paste `curl localhost:8787/health` output + `curl localhost:8787/trades` output showing `order_id=V000L`
2. After PR #406 merges and deploys: `GET /api/v1/audit-logs?action=kgi.sim.order_submitted` returns ≥1 row

All 5 hard lines structurally CONFIRMED. No stop-line triggered. No forbidden files modified.

---

*Report generated by Bruce (verifier-release) via static source audit. Runtime evidence pending operator curl confirmation.*
