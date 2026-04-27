---
name: W3 Quote Hardening Verify Checklist
description: Lane B1 接通後可跑的 verify checklist；含 redaction unit test / log 內容 grep / observability endpoint / no quote latency regression；H-6 + H-9
type: verify_checklist
date: 2026-04-27
sprint: W3
lane: B1
runner: Bruce (verifier-release-bruce)
depends_on: Lane B1 DRAFT PR (feat/w3-quote-hardening) opened by Jason
---

# W3 Quote Hardening Verify Checklist

## §0. Pre-conditions

- [ ] Lane B1 DRAFT PR opened (branch `feat/w3-quote-hardening`)
- [ ] Implementation note: `evidence/path_b_w3_read_only_2026-04-27/jason_w3_quote_hardening_impl_note.md`
- [ ] New logger: `apps/api/src/lib/logger.ts`
- [ ] New test file: `apps/api/src/__tests__/quote-hardening.test.ts`
- [ ] Optionally: `apps/api/src/lib/ring-buffer.ts`, `services/kgi-gateway/tests/test_logging_redaction.py`

---

## §1. Redaction Unit Test Verification (H-6)

**Success criterion**: Structured logs MUST NOT contain raw `account`, `person_id`, or `token` values. Redaction unit test must PASS.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| H1.1 | Redaction unit test present | `grep -n "redact\|REDACTED\|account.*log\|person_id.*log\|token.*log" apps/api/src/__tests__/quote-hardening.test.ts` | Test(s) asserting logs do not contain raw account/person_id/token | |
| H1.2 | TS redaction test PASS | `pnpm --filter api test -- --testPathPattern quote-hardening` | All hardening tests PASS; 0 failures | |
| H1.3 | Python redaction test present (if gateway logging touched) | `ls services/kgi-gateway/tests/test_logging_redaction.py` | File exists (if Python side hardened; else skip this row) | |
| H1.4 | Python redaction test PASS | `python -m pytest services/kgi-gateway/tests/test_logging_redaction.py -v` | All tests PASS (if file exists) | |
| H1.5 | logger.ts redaction function exists | `grep -n "redact\|mask\|sanitize\|REDACTED" apps/api/src/lib/logger.ts` | Redaction function or field masking present | |

---

## §2. Log Content Grep (H-6 — no raw secrets in logs)

**Success criterion**: No raw account/person_id/token/KGI_PASSWORD in any new code added by B1.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| H2.1 | No raw account in logger.ts | `grep -n "account\s*=\s*['\"][^$\{]" apps/api/src/lib/logger.ts` | Zero matches (account may appear as template var `${account}` in tests only) | |
| H2.2 | No raw person_id value in new TS files | `grep -rn "person_id\s*=\s*['\"][A-Z0-9]" apps/api/src/lib/ apps/api/src/__tests__/quote-hardening.test.ts` | Zero matches (only env var references acceptable) | |
| H2.3 | No raw token value in logger | `grep -n "token\s*=\s*['\"][a-zA-Z0-9]" apps/api/src/lib/logger.ts` | Zero matches | |
| H2.4 | No KGI_PASSWORD literal in new files | `grep -rn "KGI_PASSWORD\s*=\s*['\"][^'\"{}$]" apps/api/src/lib/ services/kgi-gateway/` | Zero matches | |
| H2.5 | H-6 log fields correctly limited | Read impl note — log fields must be: route, symbol, status, latency_ms, freshness, error_code only | Fields list does not include: account, person_id, token, raw payload | |

---

## §3. H-9 Ring Buffer Eviction Warning Verification

**Success criterion**: Ring buffer full → warning emitted (log + counter). Does NOT affect quote or order path behavior.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| H3.1 | Ring buffer eviction warning logic present | `grep -n "eviction\|buffer.*full\|warn.*evict\|EVICTION_WARNING\|ring.*warn" apps/api/src/lib/ring-buffer.ts apps/api/src/lib/logger.ts` (whichever has it) | Eviction warning code present | |
| H3.2 | Unit test covers eviction warning | `grep -n "evict\|buffer.*full\|ring.*full\|H-9" apps/api/src/__tests__/quote-hardening.test.ts` | Test exercising full-buffer eviction path | |
| H3.3 | Eviction warning does NOT alter quote path | `grep -n "evict\|ring" apps/api/src/lib/kgi-quote-client.ts` | Ring buffer / eviction only in logger / ring-buffer helper — not in quote client hot path | |
| H3.4 | Eviction counter is non-blocking | Read impl note or grep ring-buffer.ts | Warning is fire-and-forget (no await / no throw on eviction) | |

---

## §4. Observability Endpoint Verification

**Success criterion**: `/quote/status` endpoint exists (read-only); does NOT new any order method; does NOT become a bottleneck.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| H4.1 | /quote/status route registered | `grep -n "quote/status\|quoteStatus\|quote.*status" apps/api/src/server.ts` | Route handler for GET /api/v1/kgi/quote/status registered | |
| H4.2 | /quote/status returns read-only payload | Read B1 impl or grep handler body | Returns counter/status data; no mutation; no order method call | |
| H4.3 | /quote/status NOT gated by QUOTE_DISABLED | `grep -n "QUOTE_DISABLED" services/kgi-gateway/app.py \| grep -i status` | `/quote/status` has NO QUOTE_DISABLED check (it is the diagnostic surface — must be always-up) | |
| H4.4 | Observability endpoint not order-adjacent | `grep -n "order\|submit\|create\|execute" apps/api/src/server.ts` (quote/status handler section only) | Zero order-method references in status handler | |

---

## §5. No Quote Latency Regression (H-6 logging overhead check)

**Success criterion**: Structured logging does NOT add blocking I/O to the quote hot path. Log write is async or non-blocking.

| # | Check | Method | Expected | Result |
|---|---|---|---|---|
| H5.1 | Logger write is async or fire-and-forget | `grep -n "async\|await.*log\|writeLog\|sync\s*=\s*true" apps/api/src/lib/logger.ts` | Logger does NOT await synchronous log writes in hot path | |
| H5.2 | B1 impl note explicitly states latency strategy | Read `jason_w3_quote_hardening_impl_note.md` | Note addresses H-6 latency concern (async / batched / non-blocking) | |
| H5.3 | No synchronous fs.writeSync in logger | `grep -n "writeSync\|appendFileSync\|fs\.writeFile\b" apps/api/src/lib/logger.ts` | Zero synchronous FS writes in logger (use async append or stdout only) | |

---

## §6. No New Order Surface in B1 Changes

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| H6.1 | B1 PR diff has 0 new /order/* routes | `git diff main HEAD -- apps/api/src/server.ts \| grep "^+" \| grep -E "/order/"` | Zero new order routes | |
| H6.2 | logger.ts has no order imports | `grep -n "import.*order\|from.*order" apps/api/src/lib/logger.ts` | Zero matches | |
| H6.3 | ring-buffer.ts has no order imports | `grep -n "import.*order\|from.*order" apps/api/src/lib/ring-buffer.ts` | Zero matches (if file exists) | |

---

## §7. Full Test Suite Pass (B1 changes)

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| H7.1 | TS suite full PASS | `pnpm --filter api test` | All tests PASS; includes new hardening tests; 0 failures | |
| H7.2 | Python suite full PASS | `python -m pytest services/kgi-gateway/tests/ -v` | All tests PASS; 0 failures | |
| H7.3 | Typecheck EXIT 0 | `pnpm typecheck` | EXIT 0 | |
| H7.4 | Build EXIT 0 | `pnpm build` | EXIT 0 | |

**Baseline (W2d)**: TS 116/116, Python 21/21.

---

## §8. Live HTTP (DEFERRED — not run in W3)

| # | Item | State |
|---|---|---|
| H8.1 | T6 fresh/stale 5000ms threshold live with H-6 logging | POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK |
| H8.2 | T7 symbol whitelist 422 live with H-6 logging | POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK |
| H8.3 | T8 QUOTE_DISABLED toggle live + observability endpoint | POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK |
| H8.4 | T12 /order/create still 409 live (unaffected by B1) | POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK |

**Hard rule**: None of H8.x to be run in W3 sprint. Do not mark PASS.

---

## §9. Overall Quote Hardening Verify Verdict Template

```
Quote Hardening (B1) Verify Verdict
===
Date: <ISO>
Runner: Bruce
Branch: feat/w3-quote-hardening

§1 Redaction unit test:   <PASS/FAIL>
§2 Log content grep:      <PASS/FAIL — findings: N>
§3 H-9 ring buffer:       <PASS/FAIL>
§4 Observability endpt:   <PASS/FAIL>
§5 No latency regression: <PASS/FAIL>
§6 No new order surface:  <PASS/FAIL>
§7 Test suite:            <PASS/FAIL — TS X/X Python X/X>
§8 Live HTTP:             DEFERRED (4/4 POST_MERGE_DEFERRED_OPERATOR_GATEWAY_CHECK)

Overall: <PASS_WITH_DEFERRED / PARTIAL_DEFERRED / BLOCKED>
Stop-line triggered: <Y/N + which>
Redaction audit: <CLEAN / N findings (see redaction_v1_audit.md)>
Surface to: Elva
```

— Bruce, 2026-04-27 (W3 quote hardening verify harness)
