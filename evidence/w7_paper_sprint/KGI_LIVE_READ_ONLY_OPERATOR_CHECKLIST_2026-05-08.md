---
name: KGI Live Read-Only Operator Checklist
description: Formal login success (simulation=False / broker_id=9204 / account=***0732); read-only path readiness + e2e dry-run sequence
type: checklist
date: 2026-05-08
status: READ_ONLY_FORMAL
gate: BRUCE_HL2_DUAL_SIGNATURE_PENDING_E2E
---

# KGI Live Read-Only Operator Checklist — 2026-05-08

## §1 — Status Confirmed

| Item | Value | Status |
|------|-------|--------|
| Login mode | simulation=False (LIVE) | CONFIRMED |
| broker_id | 9204 | CONFIRMED |
| account | ***0732 | CONFIRMED |
| account_flag | 證券 | CONFIRMED |
| sim env auth | NOT_AUTHORIZED (per spec) | EXPECTED |
| TradeCom component permission | business-side enable required (live env only) | CONFIRMED — 楊董 5/8 business contact complete |

Live API authority: OPEN for read-only access.
Write-side authority: NOT granted. No order path exists.

---

## §2 — Permitted Endpoints (Read-Only ONLY)

These 6 endpoints are the ONLY permitted calls during this session:

| # | Gateway Endpoint | IUF API Proxy | Safe Reason |
|---|---|---|---|
| 1 | `GET /health` | direct | no auth, pure metric |
| 2 | `GET /quote/status` | `/api/v1/kgi/quote/status` | ring buffer count, no mutation |
| 3 | `GET /quote/<symbol>` | `/api/v1/kgi/quote/ticks?symbol=<S>` | poll-only, no subscribe |
| 4 | `GET /bidask/<symbol>` | `/api/v1/kgi/quote/bidask?symbol=<S>` | read ring buffer latest |
| 5 | `GET /kbar/<symbol>` | `/api/v1/kgi/quote/kbar?symbol=<S>` | read ring buffer, no SDK mutation |
| 6 | `GET /account/list` | `/session/show-account` (gateway-direct) | reads cached login state |

All 6 are GET-only. None has a write-side import or mutation path.

---

## §3 — Forbidden (5 Hard Lines)

1. **Real order submission** — any order placed on live account. Zero tolerance.
2. **`/order/create` any path** — gateway returns 409 NOT_ENABLED permanently; IUF server also blocks. Still forbidden to call.
3. **Cancel / place order** — any POST to gateway `/order/*`, `/cancel/*`, `/place/*`.
4. **`/position` native path without containment** — per Candidate G spec, `/position` must return 503 POSITION_DISABLED. If it returns 200, that is a STOP condition.
5. **Write-side any endpoint** — `POST /session/login` (would kick live session) / `POST /session/set-account` / `POST /quote/subscribe/*` (mutates SDK buffer state).

---

## §4 — Live Read-Only E2E Dry-Run Sequence

Operator runs on Windows host. IUF API side verifies proxy layer matches.

### Windows Gateway Side (10 steps)

```
Step 1.  git pull origin main (PR #302+ latest)
         cd services/kgi-gateway && git pull origin main

Step 2.  Start gateway with read-only env:
         set KGI_SIMULATION=false
         set KGI_READ_ONLY_MODE=true
         uvicorn app:app --host 127.0.0.1 --port 8787

Step 3.  Login — confirm broker_id=9204 in response:
         curl http://127.0.0.1:8787/session/show-account
         Expected: {"broker_id":"9204","account":"***0732","account_flag":"證券"}

Step 4.  /health — expect 200:
         curl http://127.0.0.1:8787/health
         Expected: {"status":"ok","kgi_logged_in":true,"account_set":true}

Step 5.  /quote/status — quote SDK status:
         curl http://127.0.0.1:8787/quote/status
         Expected: HTTP 200, ok=true

Step 6.  /quote/2330 — live price (台積電):
         curl "http://127.0.0.1:8787/quote/2330"
         Expected: HTTP 200, last price present (non-null, non-zero)

Step 7.  /bidask/2330 — live bid/ask:
         curl "http://127.0.0.1:8787/bidask/2330"
         Expected: HTTP 200, bid and ask arrays present

Step 8.  /kbar/2330 — live K bars:
         curl "http://127.0.0.1:8787/kbar/2330"
         Expected: HTTP 200, bars array (may be empty if market closed, not a FAIL)

Step 9.  /account/list — account list:
         curl http://127.0.0.1:8787/session/show-account
         Expected: HTTP 200, broker_id=9204 present

Step 10. Mutation attempt — expect READ_ONLY block:
         curl -X POST http://127.0.0.1:8787/order/create \
              -H "Content-Type: application/json" \
              -d "{}"
         Expected: HTTP 403 KGI_READ_ONLY_MODE_BLOCKED (not 200/201)
         Note: KGI_READ_ONLY_MODE=true (default) triggers @require_read_only decorator
         BEFORE the W1 409 hardline. Both guards are active; 403 takes priority.
         Either 403 or 409 = containment HOLDING. Only 200/201 = STOP.
```

### IUF API Proxy Side (production spec verify)

```
# Production API: https://api.eycvector.com (when gateway unreachable, expect BLOCKED state)
curl https://api.eycvector.com/api/v1/kgi/quote/status
Expected when gateway absent: HTTP 200, state=BLOCKED / gateway_unreachable

# When gateway is live and tunneled:
curl https://api.eycvector.com/api/v1/kgi/quote/ticks?symbol=2330
Expected: HTTP 200, data present OR state=BLOCKED (gateway not tunneled yet)
```

Note: IUF API → Gateway tunnel not yet wired for live env (local-only). BLOCKED response from proxy is expected and correct until Path B tunnel is active.

---

## §5 — Stop Conditions

Trigger any one → STOP immediately + escalate to Elva:

| Condition | Action |
|---|---|
| Write-side endpoint NOT blocked by KGI_READ_ONLY_MODE guard | STOP — containment failed |
| `/order/create` returns HTTP 200 or 201 | STOP — critical, absolute violation |
| Account balance shows unexpected change after session | STOP — mutation occurred, notify immediately |
| `broker_route` in IUF API shifts away from `NONE_PAPER_ONLY` without explicit 楊董 ack | STOP — execution mode drift |
| `/position` returns 200 (not 503) | STOP — Candidate G containment failed |
| Native gateway crash during read-only probe | STOP — do not restart; preserve crash log |

---

## §6 — Bruce HL2 Dual-Signature Condition

Condition: read-only e2e ALL PASS + write-side blocked (Step 10 confirms 403) + 0 mutation on account + /position returns 503.

When ALL 4 above hold:

```
BRUCE HL2 DUAL-SIGNATURE: KGI_LIVE_READ_ONLY_FORMAL_ENV
Date: [operator fill]
Steps verified: 10/10
Write-side blocked: YES / NO
Account mutation: NONE confirmed
/position containment: 503 PASS
Signed: Bruce (verifier) + [operator witness]
Status: READ_ONLY_FORMAL_ENV_VERIFIED
```

This signature gates: live quote feed integration into IUF frontend (axis 2).
This signature does NOT gate: order submission (requires separate 楊董 explicit ACK + 5/12 date lock).

---

## Assumptions Recorded

- KGI_READ_ONLY_MODE guard must be implemented in gateway app.py (Step 10 depends on this; if not present, Step 10 will need manual verification that /order/create returns 409 from its existing hardline guard).
- /account/list = /session/show-account gateway endpoint (per 2026-04-30 runbook pattern).
- K-bar empty during market-closed hours is PASS (not a FAIL condition).
- IUF API proxy BLOCKED response is CORRECT when tunnel not active (local-only gateway).

---

Prepared by: Bruce (verifier / release engineer)
Trigger: 楊董 KGI live login confirmed 2026-05-08 (simulation=False / broker_id=9204 / account=***0732)
