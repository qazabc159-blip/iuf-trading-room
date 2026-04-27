---
name: W3 No-Order Guarantee Test Matrix
description: W3 sprint-wide no-order guarantee grep/audit matrix; applies to Lane B1 (quote hardening), Lane B2 (K-bar Phase 2), Lane C (Jim sandbox); run at sprint open, before every PR, after every merge touching apps/api or services/kgi-gateway
type: verify_matrix
date: 2026-04-27
sprint: W3
runner: Bruce (verifier-release-bruce)
---

# W3 No-Order Guarantee Test Matrix

## §0. When to Run

| Trigger | Required rows |
|---|---|
| Sprint open (before any W3 implementation begins) | G1, G2, G4, G6, G9, G10 |
| Before opening Lane B1 DRAFT PR | G1-G10 (full) |
| Before opening Lane B2 DRAFT PR | G1-G10 (full) |
| Before opening Lane C sandbox closeout | G1, G3, G5, G7, G8 |
| After any git squash / rebase touching server.ts or app.py | G1, G2, G4, G6, G9, G10 |

## §1. Matrix

Run all grep commands from repo root:
`C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP`

| Row | Subject | Grep Command | Expected | Fail Action |
|---|---|---|---|---|
| G1 | /order/create still 409 in gateway app.py | `grep -n "NOT_ENABLED_IN_W1\|409" services/kgi-gateway/app.py` | Matches at app.py:674 area showing 409 + NOT_ENABLED_IN_W1 handler intact | STOP. /order/create no longer returns 409. Hard-line #4 triggered. Report to Elva. Do not proceed. |
| G2 | /order/create stub in server.ts comment | `grep -n "order/create" apps/api/src/server.ts` | Comment-only lines (e.g., "0 /order/create call"); zero live route handler for /order/create | STOP if a live route handler for /order/create exists with non-409 response. Report to Elva. |
| G3 | Sandbox has no live /order/create call | `grep -rn "/order/create" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` | Zero matches (sandbox uses /api/orders mock path only) | Flag for Jim. Sandbox must not wire to /order/create. |
| G4 | kgi-quote-client.ts has no order methods | `grep -n "createOrder\|cancelOrder\|updateOrder\|submitOrder\|placeOrder\|orderCreate\|order_create" apps/api/src/broker/kgi-quote-client.ts` | Zero matches | STOP if order method found. kgi-quote-client is read-only. Report to Elva. Block PR. |
| G5 | Jim sandbox OrderTicket.tsx does not call /order/create | `grep -n "/order/create" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/components/portfolio/OrderTicket.tsx` | Zero matches (it calls /api/orders via mock) | Flag. Sandbox calls must NOT reach /order/create on any real backend. |
| G6 | kgi-quote-client.ts does not import kgi-gateway-client | `grep -n "kgi-gateway-client\|from.*gateway-client" apps/api/src/broker/kgi-quote-client.ts` | Zero matches | STOP. Cross-import leaks order surface. Report to Elva. |
| G7 | W3 new files do not add order routes | `git diff main HEAD -- apps/api/src/server.ts \| grep "^+" \| grep -E "app\.(get\|post\|put\|patch\|delete).*/(order\|position)"` | Zero new route registrations for /order/* or /position | STOP if new order route registration found. Hard-line #4 triggered. |
| G8 | Jim sandbox src has no order button or /order/* link | `grep -rn "href.*order\|to.*order\|/order/" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` | Zero link/href matches to /order/* paths | Flag for Jim. Sandbox must not navigate to /order/* |
| G9 | QUOTE_DISABLED breaker symmetry (all 4 quote endpoints) | `grep -n "QUOTE_DISABLED" services/kgi-gateway/app.py \| grep -v "^#\|import\|settings\s*="` | 4 endpoints present: /quote/subscribe/tick, /quote/ticks, /quote/subscribe/bidask, /quote/bidask | If any endpoint is missing QUOTE_DISABLED check — W2d subscribe-gap fix regressed. STOP + report to Elva. |
| G10 | W2d-T9 no-order test still present and not skipped | `grep -n "W2d-T9\|no-order guarantee" tests/ci.test.ts` | At least one match at tests/ci.test.ts:7474 (or equivalent); not marked skip | STOP if test is removed or skipped. Restore before merging. |

## §2. W3 New-Route Safety Check (run against each Lane B1 / B2 DRAFT PR diff)

| Row | Subject | Grep Command | Expected | Fail Action |
|---|---|---|---|---|
| G11 | K-bar route does not import order | `grep -n "import.*order\|from.*order" apps/api/src/lib/kgi-quote-client.ts` (after B2 changes) | Zero import of anything named "order" | STOP. K-bar sub-hard-line: no order import. Hard-line #5 triggered. |
| G12 | K-bar callback does not write to signal/order queue | grep kbar handler body for `signal\|order\|queue\|emit.*order\|push.*order` in new kbar route code | Zero matches in callback body | STOP. K-bar callback must be pure read. Hard-line #13 triggered. |
| G13 | kgi-broker.ts does not exist (forbidden file) | `ls apps/api/src/broker/kgi-broker.ts 2>&1` or glob check | File does not exist | STOP if kgi-broker.ts created. Hard-line #23 (broker write-side) triggered. |

## §3. Baseline State (at W3 sprint open, 2026-04-27)

| Item | Status | Evidence |
|---|---|---|
| G1 baseline | HELD | app.py:669-674: NOT_ENABLED_IN_W1 handler confirmed; W2d squash 0 order path changes |
| G2 baseline | HELD | server.ts:2397: comment-only "0 /order/create call"; no live handler |
| G4 baseline | HELD | kgi-quote-client.ts: 0 order method names (W2d-T9 in ci.test.ts confirms) |
| G6 baseline | HELD | kgi-quote-client.ts: 0 gateway-client import (W2d regression confirmed) |
| G9 baseline | HELD | app.py: 4/4 QUOTE_DISABLED guards at subscribe/tick, /ticks, subscribe/bidask, /bidask |
| G10 baseline | HELD | tests/ci.test.ts:7474: W2d-T9 present, not skipped; 116/116 TS tests PASS as of W2d |

## §4. Fail Severity

| Severity | Definition |
|---|---|
| CRITICAL | G1, G2, G7, G11, G12, G13 — immediate STOP + surface Elva; no PR may proceed |
| HIGH | G4, G6, G9 — block PR; investigate + restore before merge |
| FLAG | G3, G5, G8, G10 — report to relevant lane owner (Jim / Jason); do not block sprint |

— Bruce, 2026-04-27 (W3 sprint open baseline)
