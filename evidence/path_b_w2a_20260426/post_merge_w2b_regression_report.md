---
name: Post-merge W2b + F Regression Report
description: Full regression verify after F (0ae5665) + W2b (f4d5b47) merged to main — 2026-04-27 parallel sprint
type: evidence
date: 2026-04-27T05:07Z
verifier: Bruce
---

# Post-Merge W2b Regression Report

**Date:** 2026-04-27 ~13:07 TST  
**Verifier:** Bruce (verifier-release-bruce)  
**Scope:** Tasks 1–7 of Parallel Sprint Mode Lane 2  
**Gateway state:** 127.0.0.1:8787, 14 routes, KGI_GATEWAY_POSITION_DISABLED=true, KGI_GATEWAY_QUOTE_DISABLED=false, kgi_logged_in=true

---

## PASS/FAIL Summary Table

| Task | Description | Result | Notes |
|---|---|---|---|
| T1 | Main HEAD = f4d5b47 | **PASS** | HEAD confirmed; prior = 0ae5665 |
| T1 | Prior commit = 0ae5665 | **PASS** | Exact match confirmed |
| T2.1 | /position #1 → 503 POSITION_DISABLED | **PASS** | ErrorEnvelope code=POSITION_DISABLED |
| T2.2 | /health between → 200 kgi_logged_in=true | **PASS** | {"status":"ok","kgi_logged_in":true} |
| T2.3 | /position #2 → 503 POSITION_DISABLED | **PASS** | Identical to T2.1 |
| T2.4 | /health between → 200 | **PASS** | Gateway alive, 0 crash |
| T2.5 | /position #3 → 503 POSITION_DISABLED | **PASS** | Identical to T2.1 |
| T2.6 | /health final → 200 kgi_logged_in=true | **PASS** | 0 crash throughout 3x /position |
| T3.1 | /quote/status → 200 + required fields | **PASS** | subscribed_symbols+buffer+kgi_logged_in+quote_disabled_flag=false |
| T3.2 | POST /quote/subscribe/tick 2330 → 200 + label | **PASS** | {"ok":true,"label":"tick_2330"} |
| T3.3 | GET /quote/ticks?symbol=2330&limit=5 → 200 + ticks | **PASS** | 5 live ticks returned (buffer_used=200, live market) |
| T3.4 | POST /quote/subscribe/bidask 2330 → 501 BIDASK_NOT_IMPLEMENTED | **PASS** | Still 501, NOT silently 200 (regression risk clear) |
| T3.5 | GET /quote/bidask?symbol=2330 → 404 BIDASK_NOT_AVAILABLE | **PASS** | Correct fallback, no fake 200 |
| T4 | POST /order/create TEST000 qty=0 → 409 NOT_ENABLED_IN_W1 | **PASS** | No real symbol used; stub correctly blocked |
| T5 | apps/api auth smoke | **PARTIAL** | See T5 section below |
| T6.1 | Secret audit: evidence/ — <REDACTED:KGI_ACCOUNT> raw | **FLAG** | See T6 section — context-in-log, not credential |
| T6.2 | Secret audit: evidence/ — pfx=/password= | **PASS** | 0 hits |
| T6.3 | Secret audit: gateway source — account values | **FLAG** | See T6 section — README/schemas use as example values |
| T6.4 | Secret audit: B12* pattern | **PASS** | 0 hits |
| T6.5 | Secret audit: F1 raw person_id | **FLAG** | See T6 section — appears in note (masked in body) |
| T7.1 | README bidask language — deferred/stub correctly stated | **PASS** | README line 157 states 501 NOT_IMPLEMENTED clearly |
| T7.2 | README Step 3a language — no false completion claim | **PASS** | No "Step 3a complete" language found |
| T7.3 | INDEX.md §10 bidask language — correct | **PASS** | Explicit "501 stub" + "W2b 不能標記為完整 Step 3a" |
| T7.4 | handoff.md bidask/step3a language — correct | **PASS** | Line 44-45 explicit guards; "不准標成 bidask 完成" |
| T8 | Boundaries: 0 merge/deploy/restart/order/secret | **PASS** | All hard lines enforced throughout sprint |

**Route count:** 14/14 (W2b code confirmed loaded)  
**Gateway crash during sprint:** 0

---

## T5 — apps/api Auth Smoke (PARTIAL / DEFERRED)

Local apps/api is not running (curl exit 7 on localhost:3001).  
Prod api.eycvector.com is live:

| Check | Result |
|---|---|
| Anonymous GET /api/v1/me → 401 | **PASS** — {"error":"unauthenticated"} HTTP:401 |
| Anonymous GET /api/v1/content-drafts → 401 | **PASS** — {"error":"unauthenticated"} HTTP:401 |
| Owner-role GET /api/v1/me → 200 | **DEFERRED** — no auth token available in this sprint context |

Note: anonymous content-drafts returning 401 (not 403) is acceptable — unauthenticated hits auth wall before role check.  
The backlog item "viewer read content-drafts tighten to 403" is a separate concern from regression. Auth layer is not broken.

---

## T6 — Secret Audit Detail

### Findings — CLASSIFIED AS CONTEXT, NOT CREDENTIAL LEAK

| Location | Pattern | Raw value? | Verdict |
|---|---|---|---|
| `read_side_live.json:65` | "account=<REDACTED:KGI_ACCOUNT> broker_id=<REDACTED:KGI_BROKER_ID>" in gateway log quote | Yes — log replay string | REDACTED 2026-04-30 A2. Original: account/broker log replay strings. |
| `read_side_live_crash.json:25` | "set_Account OK: account=<REDACTED:KGI_ACCOUNT> broker_id=<REDACTED:KGI_BROKER_ID>" | Yes — log replay string | REDACTED 2026-04-30 A2. |
| `step3a_blocked_gateway_missing_routes_2026-04-27.md:46` | "broker <REDACTED:KGI_BROKER_ID> / acct <REDACTED:KGI_ACCOUNT>" in table | Yes — in table row | REDACTED 2026-04-30 A2. |
| `services/kgi-gateway/README.md` | account=<REDACTED:KGI_ACCOUNT>, broker_id=<REDACTED:KGI_BROKER_ID> | Yes — as example output | REDACTED 2026-04-30 A2. Source file now uses placeholder values. |
| `services/kgi-gateway/schemas.py` | "<REDACTED:KGI_ACCOUNT>" as example | Yes — code comment | REDACTED 2026-04-30 A2. Source file now uses placeholder values. |
| `services/kgi-gateway/README.md` | <REDACTED:KGI_PERSON_ID> as example person_id | Yes — example value | REDACTED 2026-04-30 A2. Source file now uses placeholder. |
| `bruce_verify_candidate_f_live_20260427T031621.json:85` | <REDACTED:KGI_PERSON_ID> in note string | Partial — note mentions raw form | REDACTED 2026-04-30 A2. |

### Password / PFX / B12 pattern
- 0 hits for `pfx=` anywhere
- 0 hits for `password=` anywhere (README shows `"person_pwd":"YOUR_PWD"` — placeholder only)
- 0 hits for `B12[0-9]` broker_id pattern

### Overall T6 verdict
**No authentication credentials (password, PFX, token) found anywhere.**  
Account number <REDACTED:KGI_ACCOUNT> and broker_id <REDACTED:KGI_BROKER_ID> appear in evidence files as log replay context and README examples — these are identifiers, not secrets. Person_id <REDACTED:KGI_PERSON_ID> appears in README as example only (password NOT present). [Identifiers redacted 2026-04-30 A2]  
Flag severity: **LOW — informational, no immediate action required.**  
Recommendation to Elva: consider redacting account/broker values to `030xxxx/9204x` in future evidence JSON captures, but this is non-blocking.

---

## T7 — Language Audit Detail

### README.md
- bidask: Correctly documents 501 NOT_IMPLEMENTED with note "Endpoint surface always exists (bidask design must not disappear)." — CORRECT
- No "Step 3a complete" language — CORRECT
- GET /quote/bidask shows 404 as expected fallback — CORRECT
- No misleading completion claims

### INDEX.md §10
- Row for `/quote/subscribe/bidask` explicitly states "⚠️ MERGED as 501 stub (BIDASK_NOT_IMPLEMENTED)" — CORRECT
- Row for `/quote/bidask` explicitly states "404 BIDASK_NOT_AVAILABLE 直到 bidask 真實 SDK 接通" — CORRECT
- Explicit note: "W2b 不能標記為「完整 Step 3a tick+bidask 全完成」— bidask 只是 stub" — CORRECT

### handoff/session_handoff.md
- Line 44: "bidask 是 501 stub（BIDASK_NOT_IMPLEMENTED）— 不准標成 bidask 完成" — CORRECT
- Line 45: "不可標成完整 Step 3a tick+bidask 全完成" — CORRECT
- No ambiguous language found

**T7 verdict: PASS — all language correctly describes partial state. No misleading claims.**

---

## Risk List (Severity Ranked)

| Rank | Severity | Risk | Status |
|---|---|---|---|
| 1 | LOW | Account/broker numbers in evidence JSON (log replay context) | Informational only; not auth credentials; no immediate action |
| 2 | LOW | README uses real account number as example response | Acceptable for internal operator README; no password present |
| 3 | INFORMATIONAL | T5 owner-role auth check deferred (no token in sprint context) | Not a regression signal; auth wall confirmed functional |
| 4 | INFORMATIONAL | account_set=false in /health (pre-existing known issue) | Documented in session_handoff; read-side unaffected |

**No CRITICAL or HIGH severity risks found.**

---

## Can Deploy / Can Close

| Question | Answer |
|---|---|
| F containment intact? | YES — /position 503 confirmed 3x consecutive, 0 crash |
| W2b routes loaded and functional? | YES — 14/14, live ticks received |
| bidask correctly stubbed (not fake 200)? | YES — 501 + 404 confirmed |
| Order block intact? | YES — 409 NOT_ENABLED_IN_W1 |
| Secret leak? | NO — no auth credentials found |
| Language misleading? | NO — all docs correctly state partial state |
| Can declare W2b post-merge regression PASS? | **YES** |
| Any blocker for next step (W2c/Step 3a continuation)? | NO — ready for Elva/Jason next dispatch |

---

— Bruce (verifier-release-bruce)  
2026-04-27 ~13:07 TST
