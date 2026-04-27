---
name: W3 K-bar Phase 2 Verify Checklist
description: Lane B2 接通後可跑的 verify checklist；unit + integration mock；含 interval matrix 驗證 / KBar shape 驗證 / subscribe skeleton 驗證 / no-order callback proof；live 部分仍 DEFERRED
type: verify_checklist
date: 2026-04-27
sprint: W3
lane: B2
runner: Bruce (verifier-release-bruce)
depends_on: Lane B2 DRAFT PR (feat/w3-kbar-phase2) opened by Jason
---

# W3 K-bar Phase 2 Verify Checklist

## §0. Pre-conditions

- [ ] Lane B2 DRAFT PR opened (branch `feat/w3-kbar-phase2`)
- [ ] Implementation note exists: `evidence/path_b_w3_read_only_2026-04-27/jason_w3_kbar_phase2_impl_note.md`
- [ ] Interval matrix exists: `evidence/path_b_w3_read_only_2026-04-27/jason_w3_kbar_interval_matrix.md`
- [ ] New test file exists: `apps/api/src/__tests__/kbar.test.ts`
- [ ] New Python files: `services/kgi-gateway/kgi_kbar.py` + `services/kgi-gateway/tests/test_kbar.py`

All items must be present before running this checklist.

---

## §1. KBar Shape Verification

**Success criterion**: KBar shape = `{ time: number, open: number, high: number, low: number, close: number, volume: number }` — matches Jim sandbox `mock-kbar.ts` shape and Lane B2 spec.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| K1.1 | KBar type/interface defined in B2 impl | `grep -n "KBar\|KBarData\|kbar_shape\|time.*open.*high.*low.*close.*volume" apps/api/src/lib/kgi-quote-client.ts` | Interface or type with `time, open, high, low, close, volume` fields | |
| K1.2 | Jim sandbox mock shape alignment | `grep -n "time\|open\|high\|low\|close\|volume" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/mock-kbar.ts \| head -20` | Same 6-field shape as B2 impl | |
| K1.3 | K-bar adapter in Jim sandbox references same shape | `grep -n "KBar\|kbar\|open.*high.*low.*close" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/kbar-adapter.ts \| head -15` | Shape fields match B2 definition | |

**K1 gate**: All 3 match → PASS. Any mismatch → FLAG to Jason + Jim to align before Lane C wires B2.

---

## §2. Route Existence Verification (static)

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| K2.1 | GET /kbar/recover route registered | `grep -n "kbar/recover\|quote/kbar" apps/api/src/server.ts` | Route handler for GET /api/v1/kgi/quote/kbar/recover registered | |
| K2.2 | POST /subscribe/kbar route registered | `grep -n "subscribe/kbar\|subscribe.*kbar" apps/api/src/server.ts` | Route handler for POST /api/v1/kgi/quote/subscribe/kbar registered | |
| K2.3 | Python gateway kbar endpoint present | `grep -n "kbar\|recover_kbar\|subscribe_kbar" services/kgi-gateway/app.py` | Route and handler for kbar in app.py | |
| K2.4 | kgi_kbar.py exists with recover_kbar function | `grep -n "def recover_kbar\|def subscribe_kbar" services/kgi-gateway/kgi_kbar.py` | Both functions present | |

---

## §3. Interval Matrix Verification

**Success criterion**: Jason's interval matrix file lists each interval with SDK support status; NO interval is marked "supported" via hard-transcoding.

| # | Check | Method | Expected | Result |
|---|---|---|---|---|
| K3.1 | Interval matrix file present | Read `jason_w3_kbar_interval_matrix.md` | File exists with rows for: 1m, 5m, 15m, 1d at minimum | |
| K3.2 | All 4 minimum intervals have explicit SDK status | Read interval matrix | Each of {1m, 5m, 15m, 1d} has: supported / unsupported / unsupported_reason column | |
| K3.3 | No unsupported interval is marked supported via workaround | Read interval matrix | If interval is unsupported — status = "UNSUPPORTED"; no "mapped_to" or "converted_to" columns | |
| K3.4 | Unsupported intervals return correct error code | `grep -n "INTERVAL_NOT_SUPPORTED\|422\|unsupported.*interval\|interval.*unsupported" services/kgi-gateway/kgi_kbar.py services/kgi-gateway/app.py` | 422 or named error for unsupported intervals | |

---

## §4. Mock Fallback Verification

**Success criterion**: When SDK/gateway is unavailable, route returns `{ data: [] }` or 422 — not 500.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| K4.1 | Mock fallback present in TS layer | `grep -n "catch\|fallback\|data.*\[\]\|empty.*kbar\|mock.*kbar" apps/api/src/lib/kgi-quote-client.ts` (K-bar method body) | try/catch with fallback to `{ data: [] }` or 422 | |
| K4.2 | Python layer has exception handling | `grep -n "except\|try\|Exception\|HTTPException" services/kgi-gateway/kgi_kbar.py` | Exception block that returns 422 or empty response (not 500) | |
| K4.3 | Unit test covers fallback path | `grep -n "fallback\|empty\|422\|catches\|exception" apps/api/src/__tests__/kbar.test.ts` | At least one test for error/fallback path | |

---

## §5. No-Order Callback Proof (K-bar specific)

**Success criterion**: K-bar route handler and callback do NOT import or call anything order-related.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| K5.1 | kgi_kbar.py has no order imports | `grep -n "import.*order\|from.*order\|createOrder\|submitOrder\|place_order" services/kgi-gateway/kgi_kbar.py` | Zero matches | |
| K5.2 | kgi_kbar.py subscribe callback has no signal/queue writes | `grep -n "signal\|queue\|emit\|order\|trade" services/kgi-gateway/kgi_kbar.py` | Zero matches (callbacks are pure read/push to WS) | |
| K5.3 | TS K-bar method has no order calls | `grep -n "order\|submit\|create\|place\|execute" apps/api/src/lib/kgi-quote-client.ts` (K-bar method section only) | Zero matches in K-bar method bodies | |
| K5.4 | No-order guarantee test covers K-bar | `grep -n "kbar\|K.bar\|kBar" tests/ci.test.ts` | Either existing W2d-T9 test covers kbar or new kbar no-order test present | |

---

## §6. Unit Test Suite Verification

**Success criterion**: Both TS and Python test suites PASS with K-bar tests included.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| K6.1 | TS suite PASS (includes kbar tests) | `pnpm --filter api test` | All tests PASS; kbar.test.ts included; 0 failures | |
| K6.2 | Python suite PASS (includes test_kbar.py) | `python -m pytest services/kgi-gateway/tests/ -v` | All tests PASS; test_kbar.py included; 0 failures | |
| K6.3 | Typecheck EXIT 0 with B2 changes | `pnpm typecheck` | EXIT 0; 0 TS errors | |
| K6.4 | Build EXIT 0 with B2 changes | `pnpm build` or `pnpm --filter api build` | EXIT 0 | |

**Baseline (W2d)**: TS 116/116, Python 21/21. K-bar tests expected to increase counts.

---

## §7. Subscribe Skeleton Verification

**Success criterion**: subscribe_kbar is a skeleton — WS push only, no production-side activation.

| # | Check | Method | Expected | Result |
|---|---|---|---|---|
| K7.1 | Subscribe route is DRAFT / sandbox only | Read Lane B2 PR description + impl note | PR marked DRAFT; subscribe_kbar documented as sandbox-only in impl note | |
| K7.2 | Subscribe does not open production KGI WS on startup | `grep -n "startup\|lifespan\|on_startup\|subscribe_kbar" services/kgi-gateway/app.py` | subscribe_kbar NOT called in startup/lifespan hooks | |
| K7.3 | WS push type field matches expected shape | `grep -n "type.*kbar\|kbar.*type\|WS.*push" services/kgi-gateway/kgi_kbar.py apps/api/src/lib/kgi-quote-client.ts` | Push shape `{ type: "kbar", data: KBar }` present in implementation | |

---

## §8. Live HTTP (DEFERRED — not run in W3)

The following items require gateway up + KGI session. They are deferred per W3 hard-line.

| # | Item | State |
|---|---|---|
| K8.1 | GET /api/v1/kgi/quote/kbar/recover live call | POST_W3_DEFERRED_OPERATOR_GATEWAY_CHECK |
| K8.2 | subscribe/kbar WS live push live test | POST_W3_DEFERRED_OPERATOR_GATEWAY_CHECK |
| K8.3 | Interval unsupported → 422 live | POST_W3_DEFERRED_OPERATOR_GATEWAY_CHECK |
| K8.4 | Mock fallback → empty data live | POST_W3_DEFERRED_OPERATOR_GATEWAY_CHECK |

**Hard rule**: None of K8.x to be run in W3 sprint. Do not mark PASS.

---

## §9. Overall K-bar Verify Verdict Template

```
K-bar Phase 2 Verify Verdict
===
Date: <ISO>
Runner: Bruce
Branch: feat/w3-kbar-phase2

§1 KBar shape alignment:  <PASS/FAIL/PARTIAL>
§2 Route existence:       <PASS/FAIL/PARTIAL>
§3 Interval matrix:       <PASS/FAIL/PARTIAL>
§4 Mock fallback:         <PASS/FAIL/PARTIAL>
§5 No-order callback:     <PASS/FAIL/PARTIAL>
§6 Test suite:            <PASS/FAIL — counts: TS X/X Python X/X>
§7 Subscribe skeleton:    <PASS/FAIL/PARTIAL>
§8 Live HTTP:             DEFERRED (4/4 POST_W3_DEFERRED_OPERATOR_GATEWAY_CHECK)

Overall: <PASS_WITH_DEFERRED / PARTIAL_DEFERRED / BLOCKED>
Stop-line triggered: <Y/N + which>
Surface to: Elva
```

— Bruce, 2026-04-27 (W3 K-bar verify harness)
