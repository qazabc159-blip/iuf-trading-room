# Paper E2E Idempotency Live Verify Checklist (P1-9)

**Author:** Elva (orchestrator)
**Date:** 2026-05-01 17:43 TST
**Sprint:** W7 paper sprint, day 2 of 4 (5/1 → 5/4 09:00 TWSE open)
**Target demo date:** 2026-05-04 09:00 TST first paper E2E live submit
**Linked:** Paper E2E demo runbook (P1-8) `paper_e2e_live_demo_runbook_2026-05-04.md`
**Scope:** Verify the paper-order pipeline is **safe under retry, double-click, network glitch, and operator-replayed PROMOTE click** before 5/4 09:00. This is the operational safety net for §3.1 Step B (submit) of the runbook.

---

## §1 Why this matters

Idempotency is the *one rule* that lets paper E2E demo not turn into "1 click → 3 orders" on stage. Every layer the click traverses (frontend ticket → API route → state machine → ledger row) must independently survive a duplicate input and produce **exactly one paper order**, **exactly one OrderIntent row**, **exactly one ledger row**, and **exactly one state-machine transition history**.

This checklist runs against **paper, not live KGI**. The whole `kgi-broker.submit` / `/order/create` path stays gated by `PAPER_GATE_ENGAGED` and is not touched. If any test in this checklist requires live KGI, mark FAIL and stop — we do not execute on KGI to satisfy a verify run.

---

## §2 Idempotency surface map

The submit chain has **5 idempotency layers**. Each must be tested independently:

| # | Layer | Idempotency key | Owner |
|---|---|---|---|
| L1 | Frontend `PaperOrderPanel` submit button | client-side `submitInFlight` ref | Codex |
| L2 | API route `POST /api/orders/paper` | header `Idempotency-Key` (UUID v4) | Jason |
| L3 | OrderIntent table | `(workspace_id, idempotency_key)` unique index | Jason |
| L4 | PaperExecutor state machine | `OrderIntent.id` deduped before transition emit | Jason |
| L5 | Paper ledger row | `(order_intent_id, lifecycle_event)` unique index | Jason |

Demo path = L1 → L2 → L3 → L4 → L5. If any single layer is non-idempotent, a duplicate click anywhere in the chain creates a duplicate downstream record.

---

## §3 Test matrix — 12 cases (T01-T12)

### T01 — L1 same-tab double-click (50ms apart)

**Setup:** `PaperOrderPanel` open, ticket pre-filled `2330 BUY 1 LMT 800`. Operator double-clicks SUBMIT within 50ms.

**Expected:** 1 fetch fired. Second click ignored by `submitInFlight` ref.

**Verify:**
- DevTools → Network: `POST /api/orders/paper` count = 1
- DB: `SELECT COUNT(*) FROM order_intents WHERE workspace_id=? AND created_at > now() - interval '5s'` = 1
- DB: `SELECT COUNT(*) FROM paper_orders WHERE intent_id IN (SELECT id FROM order_intents WHERE created_at > now() - interval '5s')` = 1

**FAIL action:** Stop demo. File hotfix on `apps/web/components/orders/PaperOrderPanel.tsx`.

---

### T02 — L1 cross-tab (same browser session, two tabs)

**Setup:** Operator has two dashboard tabs open. Ticket open in both with same draft. Operator clicks SUBMIT in tab A, then in tab B within 200ms.

**Expected:** Both tabs fire `POST /api/orders/paper` → L2 dedup catches the second by Idempotency-Key match. Only 1 OrderIntent created.

**This requires** the frontend to send the **same** Idempotency-Key for the same draft — i.e. UUID generated **at draft creation**, not at submit time. Otherwise tabs get different UUIDs and L2 sees them as distinct.

**Verify:**
- Network panel both tabs: 2 requests with **identical** `Idempotency-Key` header
- API logs: tab A returns `201 Created`, tab B returns `200 OK` with same `order_intent_id`
- DB: `SELECT COUNT(*) FROM order_intents WHERE idempotency_key=?` = 1
- DB: `SELECT COUNT(*) FROM paper_orders WHERE intent_id=?` = 1

**FAIL action:** If tabs have different keys → fix `PaperOrderPanel` to embed key in draft. Stop demo.

---

### T03 — L2 retry after timeout (same Idempotency-Key)

**Setup:** Curl simulation. Send `POST /api/orders/paper` with key `K1`. Simulate timeout: client doesn't read response. Resend same request with same key `K1` 2s later.

**Expected:** Second request returns same `order_intent_id`, **HTTP 200** (not 201). Underlying state machine NOT re-driven.

**Verify:**
- API logs: 2 requests, 1 with `INSERT` log line, 1 with `dedup hit` log line
- DB: `SELECT COUNT(*) FROM order_intents WHERE idempotency_key='K1'` = 1
- DB: `SELECT COUNT(*) FROM paper_state_transitions WHERE intent_id=?` = transitions for one submit, not two

---

### T04 — L2 different Idempotency-Key, same payload

**Setup:** Send `POST /api/orders/paper` with payload P, key `K1`. Then same payload P with key `K2`.

**Expected:** **Two distinct** OrderIntent rows. The system does NOT dedup by payload — only by explicit key. (This is the expected design — operator may legitimately want to submit two identical orders.)

**Verify:**
- DB: `SELECT COUNT(*) FROM order_intents WHERE workspace_id=? AND symbol='2330'` = 2
- Both have distinct `idempotency_key`

**Note:** This is a *negative idempotency* test — confirms we don't over-dedup.

---

### T05 — L3 unique-index race (concurrent inserts, same key)

**Setup:** Use Bruce harness `concurrent_idempotency_race.ts` (to be written if absent). Fire 5 parallel `POST /api/orders/paper` with the **same** Idempotency-Key from 5 connections.

**Expected:** Postgres `(workspace_id, idempotency_key)` unique index causes 4 to fail with `23505 unique_violation`. Application catches and returns the existing row. **Net result:** 1 OrderIntent, 5 HTTP 200/201 responses all pointing to same id.

**Verify:**
- DB: `SELECT COUNT(*) FROM order_intents WHERE idempotency_key=?` = 1
- All 5 HTTP responses have identical `order_intent_id` body field
- API logs show 1 INSERT success + 4 `unique_violation` retries → fetch existing → return

**FAIL action:** If 5 rows created → unique index missing. Check migration.

---

### T06 — L4 state machine re-drive guard

**Setup:** Manually trigger `paperExecutor.driveOrder(intentId)` twice in succession (via test endpoint or worker re-fire).

**Expected:** Second invocation is a no-op if state already advanced past driving. State machine reads current state first, exits early.

**Verify:**
- DB: `SELECT COUNT(*) FROM paper_state_transitions WHERE intent_id=?` = expected count for one drive (typically ACCEPTED → WORKING → FILLED = 3 transitions, NOT 6)
- No duplicate FILLED row in `paper_orders`

---

### T07 — L5 ledger event uniqueness

**Setup:** Try to insert two ledger rows with same `(order_intent_id, lifecycle_event='FILLED')`.

**Expected:** Postgres rejects with unique violation. State machine catches and skips.

**Verify:**
- Migration `0015_paper.sql` (or successor) has `UNIQUE(order_intent_id, lifecycle_event)` on the events table
- Manual SQL `INSERT INTO paper_ledger_events ... ON CONFLICT DO NOTHING` returns 0 affected rows

---

### T08 — Cancel idempotency (cancel applied twice)

**Setup:** Operator submits, order is WORKING. Operator clicks CANCEL twice in quick succession.

**Expected:** Order moves WORKING → CANCELLED once. Second cancel is no-op. UI shows single timeline event.

**Verify:**
- DB: `SELECT COUNT(*) FROM paper_state_transitions WHERE intent_id=? AND to_state='CANCELLED'` = 1
- HTTP: first DELETE/PATCH returns 200 with new state, second returns 200 with same state (NOT 409)

---

### T09 — Cancel after FILLED (terminal state guard)

**Setup:** Order is FILLED (terminal). Operator (somehow) sends cancel.

**Expected:** Cancel is rejected with **409 Conflict** or 4xx with reason `ORDER_TERMINAL_FILLED`. State unchanged.

**Verify:**
- HTTP status 409
- DB: state still FILLED
- Frontend: cancel button should already be disabled — this tests the API as last-line defense

---

### T10 — Network drop mid-submit, replay

**Setup:** Throttle DevTools network to "offline" right after click. Re-enable network. Frontend retries automatically (or operator re-clicks if no auto-retry).

**Expected:** If frontend auto-retries with same key → L2 dedup. If operator re-clicks → frontend reuses same draft → same key → same dedup.

**Verify:**
- DB: 1 OrderIntent row total
- Operator UI shows order in correct state (no duplicate "ghost" entries)

---

### T11 — PROMOTE click idempotency (Contract 4 path)

**Setup:** Operator opens an idea card, clicks "PROMOTE → TICKET". Closes ticket without submitting. Reopens same idea, clicks PROMOTE again.

**Expected:** **Two distinct `IdeaPromotionPreview` rows** (this is correct — preview is intentionally re-creatable; the dedup happens at the OrderIntent layer when the operator finally submits).

**Verify:**
- DB: `SELECT COUNT(*) FROM idea_promotion_log WHERE idea_id=? AND status='draft'` = 2 (or 1 if older one was abandoned)
- Each has distinct `promotion_id`
- Submitting either preview produces 1 OrderIntent (per L3)

**Cross-check:** Contract 4 design `idea_promotion_log` has TTL — abandoned previews older than 24h auto-cleanup. Confirm cleanup job is scheduled.

---

### T12 — Watchlist row PROMOTE → submit, then submit same draft from idea panel

**Setup:** Operator clicks PROMOTE on watchlist row for 2330. Ticket opens. Without submitting, navigates to idea panel for same 2330 idea, clicks PROMOTE there. Now submits.

**Expected:** Two `IdeaPromotionPreview` rows (different `quoteContext.source` — "watchlist-row" vs "idea-card"). On submit, each becomes its own OrderIntent unless operator deduped explicitly.

**This is by design** — cross-surface promotion does NOT auto-merge. Operator is responsible for not double-submitting from two different surfaces.

**However**, the demo runbook §3 should NOT exercise this path on stage. Add as a hard line in §6 below.

---

## §4 Pre-demo verify run (5/3 22:00 TST)

Run **all T01-T12** against staging environment with paper gate ARMED, kill-switch ARMED, KGI gateway in passive (read-only) mode.

| Test | Owner | Expected duration | Pass criterion |
|---|---|---|---|
| T01-T02 | Codex (frontend) + Bruce verify | 5min | Network panel + DB both confirm 1 row |
| T03-T05 | Bruce harness | 10min | curl-based, deterministic |
| T06-T07 | Bruce harness (DB-side) | 5min | SQL queries return expected counts |
| T08-T10 | Codex + Bruce | 8min | Browser + DB |
| T11-T12 | Codex + Bruce | 6min | Cross-surface flow |

**Total estimated time:** ~35min for full run.

**If any FAIL:** stop demo. File hotfix. Re-run failed test only after fix is merged. Demo goes ahead **only if 12/12 PASS**.

---

## §5 Evidence bundle layout

`evidence/w7_paper_sprint/paper_e2e_demo_2026-05-04/idempotency_verify/`:
- `T01_double_click.json` — network HAR + DB count
- `T02_cross_tab.json` — both tab requests + DB count
- `T03_retry_same_key.json` — curl trace
- `T04_different_keys.json` — curl trace
- `T05_concurrent_race.json` — Bruce harness output
- `T06_state_machine.json` — re-drive guard log
- `T07_ledger_unique.json` — DB constraint test
- `T08_cancel_idempotent.json` — browser + DB
- `T09_cancel_terminal.json` — HTTP 409 capture
- `T10_network_drop.json` — DevTools throttle replay
- `T11_promote_idempotency.json` — DB rows comparison
- `T12_cross_surface.json` — flow trace
- `summary_2026-05-03_22-00.md` — 12/12 PASS or FAIL list with hotfix references

---

## §6 Hard lines for the demo itself (5/4 09:00)

| # | Rule | Reason |
|---|---|---|
| 1 | Single SUBMIT click only — no double-click on stage | T01 covers it but operator must not test it live |
| 2 | One tab open during demo | T02 covers it but operator must not test it live |
| 3 | No PROMOTE from both watchlist AND idea panel for same symbol | T12 is intentionally non-deduped |
| 4 | If first click times out, **wait 5s** before re-click | Lets retry logic settle; T10 path |
| 5 | If demo halts mid-flow, capture state before hotfix | Don't lose the bug |
| 6 | Idempotency-Key visible in DevTools panel during demo | Lets operator (and observers) verify L2 dedup happened |

---

## §7 Open questions for 楊董 (5)

1. **Q1 — L1 frontend retry policy:** auto-retry on network fail, or require operator re-click? (My default: **operator re-click only**, no auto-retry — operator stays in control of the demo.)
2. **Q2 — Idempotency-Key generation timing:** at draft creation (T02 cross-tab works) or at submit click (T02 fails)? (My default: **at draft creation**.)
3. **Q3 — Run T01-T12 on production paper, or only staging?** (My default: **staging only** for full run, then 1 lightweight smoke-test against production paper before 09:00.)
4. **Q4 — If 11/12 PASS but T11 (Contract 4 promote idempotency) FAILS:** demo goes ahead with note, or stop? (My default: **stop and fix** — promote is on the demo path.)
5. **Q5 — Bruce harness `concurrent_idempotency_race.ts` exists, or write fresh?** (Will check — if absent, Bruce drafts in W8 D1.)

---

## §8 Sequencing relative to 5/4 demo

| Date | Task | Owner |
|---|---|---|
| 5/2 Sat | Bruce drafts `concurrent_idempotency_race.ts` if missing | Bruce |
| 5/2 Sat | Jason confirms migrations have all required unique indices (L3, L5) | Jason |
| 5/2 Sat | Codex confirms `submitInFlight` ref + draft-time UUID generation | Codex |
| 5/3 Sun 09:00 | Dry-run T01-T05 (frontend + L2/L3) | Bruce + Codex |
| 5/3 Sun 14:00 | Dry-run T06-T12 (state machine + cross-surface) | Bruce |
| 5/3 Sun 22:00 | Full T01-T12 verify run, 12/12 PASS gate | Bruce + Elva |
| 5/4 06:00 | Smoke 1 lightweight idempotency test on production paper | Bruce |
| 5/4 08:50 | Pre-flight final | Elva |
| 5/4 09:00 | Demo go/no-go decision based on 12/12 + smoke | 楊董 / Elva |

If 12/12 not PASS by 5/3 22:00, demo is **postponed by one trading day** (5/5). No exceptions.

---

## §9 Cross-references

- Demo runbook: `evidence/w7_paper_sprint/paper_e2e_live_demo_runbook_2026-05-04.md`
- Contract 2 (portfolio): `contract_2_portfolio_4layer_risk_ui_design_2026-05-01.md`
- Contract 3 (watchlist): `contract_3_watchlist_ui_design_2026-05-01.md`
- Contract 4 (promote): `contract_4_idea_to_order_promote_design_2026-05-01.md`
- Status board: `frontend_realdata_status_board_2026-05-01.md`

---

**Status:** DRAFT v1. Bruce-actionable starting 5/2 Sat. 5 open Q with defaults applied. Demo go/no-go is **gated** on this checklist.
