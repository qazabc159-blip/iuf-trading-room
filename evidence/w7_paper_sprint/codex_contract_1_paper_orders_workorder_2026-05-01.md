# Codex Work Order — Contract 1 Frontend Wiring (Paper Orders)

**Issuer**: Elva
**Issued**: 2026-05-01 ~07:10 Taipei (post overnight closeout, post Codex B12+kill-switch+duplicates landing)
**Consumer**: Codex (frontend lane owner)
**Lane**: `apps/web/**` only
**Backend contract source**: `evidence/w7_paper_sprint/jason_backend_contracts_2026-05-01.md` Contract 1 (1a–1e)
**Status**: STANDBY — pickup right after current B12/kill-switch/duplicates work-stream stabilizes (CI green + deploy green for `f5c41c1`/`7b07573`/`a7c4058`)

---

## Why this is the next step

Today is W7 paper sprint Day 2. 10-day target = paper E2E by 2026-05-09. Contract 1 (Paper Order preview/submit/status/cancel) is the **only** ready+wireable backend contract among the 5; Contracts 2–5 are BLOCKED (Jason ETA Day 4–6 / Operator+Jason). Without Contract 1 wired, paper E2E cannot light up.

---

## Scope

Wire 5 endpoints into the frontend, all under existing Codex lane:

| ID | Endpoint | Method | Frontend purpose |
|---|----------|--------|------------------|
| 1a | `/api/v1/paper/orders/preview` | POST | Pre-submit risk + quote-gate verdict |
| 1b | `/api/v1/paper/orders` | POST | Actual paper order submit |
| 1c | `/api/v1/paper/orders/:id` | GET | Status polling after submit |
| 1d | `/api/v1/paper/orders` | GET | Paper orders list / history |
| 1e | `/api/v1/paper/orders/:id/cancel` | POST | Cancel PENDING/ACCEPTED order |

---

## Out of scope (do NOT touch)

- `/api/v1/portfolio/*` (Contract 2 BLOCKED)
- `/api/v1/watchlist` (Contract 3 BLOCKED)
- `/api/v1/ideas/:id/promote-to-order` (Contract 4 partial BLOCKED — write-side)
- `/api/v1/kgi/quote/*`, `/ws/quote/*` (Contract 5 BLOCKED)
- live submit / KGI broker / migration / Railway secrets / kill-switch real toggle (stop-lines per `feedback_w6_paper_sprint_rules.md` — paper gate is permanent 409 on live submit; this work order does NOT change that)

---

## Stop-lines (hard)

1. **No live submit path** — Contract 1 is the paper gate; live KGI submit returns 409 permanently. Frontend must NOT add any conditional that bypasses this.
2. **No fake mock fallback** — if any of 1a–1e fails, render BLOCKED (with reason from server) or EMPTY (legitimate zero rows). Never render a fake order.
3. **No idempotencyKey reuse across submits** — each submit must generate a fresh UUID. Preview shares no key with submit.
4. **No localStorage of orders** — read state from `GET /paper/orders` and `GET /paper/orders/:id`, not browser state.
5. **No silent retry on 422** — `paper_gate_blocked` and `REJECTED` status must surface to user; do not auto-retry.

---

## 4-state mapping per endpoint (mandatory)

### 1a. Preview modal
- **LIVE** (green submit): `data.blocked=false && data.quoteGate.decision==="allow"`
- **LIVE-amber** (warn submit): `data.blocked=false && data.quoteGate.decision` starts with `review_`
- **BLOCKED**: `data.blocked=true` → list `riskCheck.violatedGuards` as bullets, disable Submit
- **BLOCKED**: HTTP 4xx → show error, disable Submit

### 1b. Submit
- **LIVE** (success FILLED): 201 → show fill confirmation (price/qty/time)
- **BLOCKED** (paper gate disabled): 422 `paper_gate_blocked` → banner "Paper trading is disabled" + reason+layer
- **BLOCKED** (executor rejected): 422 with `data.intent.status="REJECTED"` → show reason
- **BLOCKED** (duplicate): 409 → "Order already submitted"

### 1c. Status polling
- **LIVE**: status terminal (FILLED with fill object, REJECTED with reason, CANCELLED)
- **EMPTY**: status PENDING/ACCEPTED after 10 polls × 1s (mark "status unknown")
- **BLOCKED**: 404 ORDER_NOT_FOUND or 403 forbidden

### 1d. Orders list
- **LIVE**: `data.length > 0`, sorted by `intent.createdAt` desc
- **EMPTY**: `data.length === 0` → "No paper orders yet" placeholder text (NOT a mock row)
- **BLOCKED**: HTTP 4xx/5xx
- Status badge colors: PENDING=yellow, ACCEPTED=blue, FILLED=green, REJECTED=red, CANCELLED=grey

### 1e. Cancel
- **LIVE**: 200 → update row to CANCELLED badge
- **EDGE**: `alreadyTerminal=true` → toast "Order already completed", refresh row
- **BLOCKED**: 404/403
- Cancel button visible **only** when status PENDING or ACCEPTED

---

## Suggested file layout (Codex judgement, Elva won't dictate)

- `apps/web/lib/paper-orders-api.ts` — typed client wrapping 1a–1e (mirroring existing `radar-api.ts` / `radar-uncovered.ts` IS_PROD + `shouldAllowMockFallback()` pattern from `633d00e`)
- `apps/web/app/orders/page.tsx` (new) OR extend existing trading panel — orders list (1d) + cancel (1e)
- Order preview modal + submit button — likely lives near the existing quote/companies detail surface (Codex pick)
- Idempotency key generator: `crypto.randomUUID()` per submit attempt, reset on dialog close

---

## Acceptance criteria (Bruce will verify)

1. `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
2. `pnpm.cmd --filter @iuf-trading-room/web build` PASS
3. All 5 endpoints have explicit IS_PROD fail-closed (no silent mock fallback)
4. 4-state behavior matches table above for each endpoint
5. Preview→submit roundtrip works in production with test ticker (e.g. 2330 paper buy 1 lot)
6. Cancel button appears/disappears correctly per status
7. Idempotency: rapid double-click submit → second click 409 toast (not duplicate row)
8. Stop-line scan: no broker write reference, no live submit code path, no fake mock

---

## Cadence / handoff

- **Pickup gate**: wait until last Codex commit (currently `a7c4058`) is CI green + deploy green. Bruce parallel smoke (`bruce_morning_smoke_2026-05-01.md`) will baseline this.
- **Heartbeat**: per the 30-min protocol, every 30min push a commit OR write a one-line standby note to the board. Silence ≥60min triggers Elva board checkpoint (today's lesson).
- **Branch / PR**: hybrid flow — small typed-client + binding can direct-commit; if the new `/orders` page is mid-size (>~300 line diff), open DRAFT PR for Pete review before merge.
- **Done definition**: all 8 acceptance criteria green + Bruce regression sweep PASS + board entry "Contract 1 wired LIVE/EMPTY/BLOCKED states".

---

## Reference

- Backend contract spec: `evidence/w7_paper_sprint/jason_backend_contracts_2026-05-01.md` §Contract 1 (lines 36–303)
- Existing fail-closed pattern: `apps/web/lib/radar-uncovered.ts` (commit `633d00e`)
- 4-state harness rules: `evidence/w7_paper_sprint/bruce_4state_harness_v1_2026-05-01.md`
- W7 paper sprint discipline: memory `feedback_w6_paper_sprint_rules.md`

---

**Elva note**: Codex 自選實作節奏 + 檔案布局；本 work order 只鎖契約面與 stop-line。如果 Pete 在 review 階段挑出細節，回流到此 work order 再小 PR 補。
