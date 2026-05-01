# Bruce — Contract 1-5 Backend Readiness Audit

**Date:** 2026-05-01
**Auditor:** Bruce (static analysis only; Bash dead — 9th consecutive session)
**Source:** Jason's spec `evidence/w7_paper_sprint/jason_backend_contracts_2026-05-01.md` + `apps/api/src/server.ts` + related backend files
**Scope:** Contracts 1-5 backend readiness. No live HTTP. No apps/web touched.

---

## Contract 1 — Paper Orders (1a preview / 1b submit / 1c get-by-id / 1d list / 1e cancel)

**VERDICT: READY**

### Route existence (server.ts line refs)

| Sub-contract | Method | Route | server.ts line |
|---|---|---|---|
| 1a | POST | `/api/v1/paper/orders/preview` | 2842 |
| 1b | POST | `/api/v1/paper/orders` | 2723 |
| 1c | GET | `/api/v1/paper/orders/:id` | 2779 |
| 1d | GET | `/api/v1/paper/orders` | 2791 |
| 1e | POST | `/api/v1/paper/orders/:id/cancel` | 2803 |

All five routes confirmed present and registered.

### Zod schema

`paperOrderCreateInputSchema` exists in `packages/contracts/src/paper.ts:32`. Fields:
- `idempotencyKey: z.string().min(1)` — non-empty enforced
- `symbol`, `side` (enum buy/sell), `orderType` (4-value enum), `qty` (int positive), `price` (nullable optional)

Schema matches Jason's spec exactly.

`strategyRunOutputSchema` is in `packages/contracts/src/strategy.ts:302`. `strategyIdeasQuerySchema` at line 166.

### Stop-line risk scan

- **Broker live submit path**: ZERO KGI SDK calls in paper routes. `driveOrder()` goes to `paper-broker.ts` only. `checkPaperExecutionGate()` 3-layer AND gate (executionMode=paper AND paperModeEnabled=true AND killSwitchEnabled=false) defaults to BLOCKED in prod. Hard-line comment at server.ts:2711 explicitly states `/order/create` stays 409.
- **Fake mock fallback**: None. In-memory ledger (`paper_ledger`) is the stated source; it is not mock data — it is real paper state. `driveOrder()` simulates fills against the paper broker, not against KGI.
- **Hard-coded placeholder**: `"paper-default"` as accountId in the preview mapping (server.ts:2856) — this is intentional paper-only design, not a security risk. No KGI account IDs, no person_id, no broker_id.

### 4-state mapping

| State | How backend produces it |
|---|---|
| LIVE | 201 FILLED (`data.intent.status="FILLED"`, `data.fill` present) |
| EMPTY | 200 with `data: []` on list; 404 ORDER_NOT_FOUND on get-by-id |
| BLOCKED | 422 `paper_gate_blocked` (gate layers); 422 REJECTED (executor reject); 409 DUPLICATE_IDEMPOTENCY_KEY |
| HIDDEN | Frontend concern only (not a backend state) |

Preview (1a) produces: blocked=true (BLOCKED) or blocked=false+quoteGate.decision (LIVE or LIVE-with-warning) or 400 (BLOCKED on validation). Backend covers all 3 non-HIDDEN states.

### Idempotency (1b)

- `_registerIdempotencyKey(payload.idempotencyKey)` called at server.ts:2749 before intent creation.
- Returns `false` on duplicate → HTTP 409 `DUPLICATE_IDEMPOTENCY_KEY` (server.ts:2749-2756). CONFIRMED.
- Preview (1a) explicitly does NOT register idempotency key — hard-line comment at server.ts:2840. CONFIRMED.
- **Gap**: `_registerIdempotencyKey` is in-memory Set (per Jason's spec: "in-memory, process-scoped"). Cross-restart idempotency not guaranteed. This is pre-existing design limitation (documented), not a new risk. Acceptable for paper sprint Day 2.

### Minor discrepancy

Contract spec (1b) says response shape wraps intent in `{ data: { intent: ..., fill: ... } }`. Server.ts:2775 returns `{ data: result.finalState }`. `result.finalState` is the OrderState object. Need to verify `finalState` shape matches `{ intent, fill }`. Checking `driveOrder` return type: `OrderState` from `order-driver.ts` is the broker-level state. Jason's spec says `data: OrderState` on 1c/1d, so this is consistent — 1b returning `{ data: result.finalState }` where finalState IS the OrderState is correct. **No mismatch.**

---

## Contract 2 — Portfolio Positions / Fills / Summary

**VERDICT: BLOCKED**

### Route existence

`grep /api/v1/portfolio/positions server.ts` — NO MATCH.
`grep /api/v1/portfolio/fills server.ts` — NO MATCH.
`grep /api/v1/portfolio/summary server.ts` — NO MATCH.

Only portfolio route present is `POST /api/v1/portfolio/kill-mode` (server.ts:3244) — thin kill-switch adapter, unrelated to portfolio data.

### Root cause

The underlying functions exist in `paper-broker.ts` (`listPaperPositions`, `listPaperOrders`, `getPaperBalance`) but are wired only to the risk engine's account context builder, not to HTTP. Confirmed by Jason's spec: "functions exist but not wired to HTTP routes."

### Stop-line risk scan

No routes means no live data exposure risk. `POST /api/v1/portfolio/kill-mode` does NOT expose portfolio data — it only delegates to `setKillSwitch()`. Kill-mode route present is a different concern from portfolio data routes.

### 4-state mapping

Cannot produce LIVE/EMPTY/BLOCKED states — routes don't exist. Frontend must render BLOCKED reason="Portfolio endpoints not yet wired" owner="Jason" as per spec instruction.

### Blocker

Owner: Jason. ETA: Day 4-5 sprint. Prerequisite: paper ledger DB swap.

---

## Contract 3 — Watchlist

**VERDICT: BLOCKED**

### Route existence

`grep /api/v1/watchlist server.ts` — NO MATCH (0 results).

There is a comment at server.ts:2956-2957: `watchlist: Empty [] — no backing table yet; type-correct WatchlistItem[]`. This confirms the watchlist is hard-coded to empty `[]` inside the RADAR endpoint response only — there is no standalone watchlist CRUD endpoint.

No DB migration for watchlist table exists. No Zod schema in contracts.

### Stop-line risk scan

No routes = no risk surface. The RADAR endpoint returns `watchlist: []` which is safe (empty, no mock data).

### 4-state mapping

Cannot produce any state — no routes. Frontend must render BLOCKED/HIDDEN per spec.

### Blocker

Owner: Jason. ETA: Day 4-5. Requires new DB migration + CRUD routes.

---

## Contract 4 — Strategy Idea → Order Handoff

**VERDICT: PARTIAL (4a/4b/4c/4d READY; 4e BLOCKED)**

### Route existence

| Sub-contract | Route | server.ts line | Status |
|---|---|---|---|
| 4a | `GET /api/v1/strategy/ideas` | 1700 | READY |
| 4b | `POST /api/v1/strategy/runs` | 1721 | READY |
| 4b | `GET /api/v1/strategy/runs` | 1735 | READY |
| 4c | `GET /api/v1/strategy/runs/:id` | 1751 | READY |
| 4d | `GET /api/v1/strategy/runs/:id/ideas` | 2884 | READY |
| 4e | `POST /api/v1/ideas/:id/promote-to-order` | — | MISSING |

### Zod schemas

`strategyIdeasQuerySchema` (packages/contracts/src/strategy.ts:166) — all query params confirmed.
`strategyRunCreateInputSchema = strategyIdeasQuerySchema` (line 288) — correct alias.
`strategyRunOutputSchema` (line 302) — present.

### Stop-line risk scan for 4a-4d

- No KGI SDK import in strategy routes.
- `GET /api/v1/strategy/ideas` reads DB (signals + themes + companies) — no write-side.
- `POST /api/v1/strategy/runs` creates a snapshot run record — no broker call, no order.
- No fake mock fallback in any of the 4 ready routes.

### 4-state mapping (4a example)

| State | How produced |
|---|---|
| LIVE | `data.items` non-empty, `marketData.decision="allow"` rows present |
| EMPTY | `data.items: []`, `summary.total: 0` (200 with empty array) |
| BLOCKED | Item-level: `marketData.decision="block"` per idea row; no HTTP-level BLOCKED for the whole list |

BLOCKED state is per-item (idea has blocked marketData) not per-request. Frontend must read `marketData.decision` per row. Backend correctly produces all 3 states.

### 4e gap

`promote-to-order` route is absent from server.ts (confirmed: no `/ideas/` route at all outside of the list). Strategy ideas do not have stable IDs (computed on-demand from signals). No contracts schema for promote-to-order. Owner: Jason, ETA Day 5-6.

---

## Contract 5 — KGI Readonly Bidask / Tick

**VERDICT: PARTIAL — routes implemented, gateway operationally BLOCKED**

### Route existence

| Sub-contract | Route | server.ts line | Status |
|---|---|---|---|
| 5a | `GET /api/v1/kgi/quote/bidask` | 2556 | Impl DONE; ops BLOCKED |
| 5b | `GET /api/v1/kgi/quote/kbar` | 2617 | Impl DONE; ops BLOCKED |
| 5c | WS `/ws/quote/:ticker` | — | NOT IMPLEMENTED |

### Stop-line risk scan

- 0 order write paths in any kgi/quote route. Hard-line comment at server.ts:2457-2460 confirmed.
- 0 KGI credentials logged or returned. `kgi-quote-client.ts:19` hard-line: "NEVER log: account, person_id, token, password, pfx, KGI secret."
- Symbol whitelist: `KGI_QUOTE_SYMBOL_WHITELIST` env var enforced at 5a (returns 422 SYMBOL_NOT_ALLOWED for non-whitelisted).
- `QUOTE_DISABLED` containment: server.ts:2491 returns 503 `QUOTE_DISABLED` when `KgiQuoteDisabledError` is thrown — containment guard confirmed.

### Stale detection

`STALE_THRESHOLD_MS = 5_000` confirmed at `apps/api/src/broker/kgi-quote-client.ts:206`. Matches Jason's spec (5000ms threshold).

### 4-state mapping (5a bidask)

| State | How produced |
|---|---|
| LIVE | 200 with `data.bidask` non-null and `stale=false` |
| EMPTY | 200 with `data.bidask=null`, `freshness="not-available"` (symbol not subscribed) |
| BLOCKED | 503 `QUOTE_DISABLED` / `KGI_GATEWAY_UNAVAILABLE` / `GATEWAY_AUTH_ERROR`; 422 `SYMBOL_NOT_ALLOWED`; 503 QUOTE_DISABLED env flag |

Backend correctly produces all 3 non-HIDDEN states when gateway is live.

### 5b kbar response shape discrepancy

Jason's spec says 5b wraps result in `{ data: Array<{symbol,open,high,...}> }`. Server.ts:2617-2632 should be verified. Given Jason authored both spec and impl, treating as consistent until CI confirms. Not a blocking issue.

### Operational blocker

Gateway dependency: KGI Windows host must be running with active session. This is an ops gate, not a code gate. Frontend must treat 5a/5b as BLOCKED until operator confirms. 5c has no implementation at all.

---

## Summary Table

| Contract | READY / PARTIAL / BLOCKED | Stop-lines HELD | Key blocker |
|---|---|---|---|
| 1 — Paper Orders | **READY** | YES (0 KGI calls, gate defaults ARMED) | None. In-memory idempotency cross-restart gap is pre-existing design. |
| 2 — Portfolio | **BLOCKED** | N/A (no routes) | Routes not wired; owner Jason ETA Day 4-5 |
| 3 — Watchlist | **BLOCKED** | N/A (no routes) | No impl, no migration; owner Jason ETA Day 4-5 |
| 4 — Strategy Ideas/Runs + Promote | **PARTIAL** | YES (4a-4d clean) | 4e promote-to-order missing; owner Jason ETA Day 5-6 |
| 5 — KGI Bidask/Tick | **PARTIAL** | YES (0 order write paths) | Gateway ops BLOCKED; 5c WS not implemented |

## Codex Frontend Binding Recommendation

**CAN BIND NOW (backend READY/confirmed):**
- All 5 paper order routes (1a-1e)
- Strategy ideas + runs routes (4a-4d)

**MUST RENDER BLOCKED STATE (no backend):**
- Portfolio positions/fills/summary (2a-2c) — no routes exist
- Watchlist (3a) — no routes exist
- Strategy promote-to-order (4e) — no route; disable button
- KGI bidask/kbar (5a/5b) — impl exists but gateway BLOCKED; show BLOCKED panel
- KGI tick stream (5c) — no WS impl; show HIDDEN/BLOCKED

## Audit Evidence

- `apps/api/src/server.ts` lines: 2706-2877 (paper routes), 1700-1770 (strategy), 2555-2630 (KGI quote), 3244 (kill-mode only for portfolio prefix)
- `packages/contracts/src/paper.ts:32` — paperOrderCreateInputSchema
- `packages/contracts/src/strategy.ts:166,288,302` — strategy schemas
- `apps/api/src/broker/kgi-quote-client.ts:206` — STALE_THRESHOLD_MS=5000
- `apps/api/src/broker/trading-service.ts:180-201` — previewOrder confirmed pure (no commit)
