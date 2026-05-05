# Jason — P3: Paper E2E Skeleton
# Date: 2026-05-05

---

## Delivered

4 new routes added to `apps/api/src/server.ts`:

### POST /api/v1/paper/preview

Pure calculation. No state mutation. No order created.
- Body: same as `paperOrderCreateInputSchema` (quantity_unit required, no default)
- Missing `quantity_unit` → 400 VALIDATION_ERROR
- Returns: `{ data: previewOrderResult }` (risk check + quote gate + blocked flag)

### POST /api/v1/paper/submit

Creates and drives a paper order through PaperExecutor.
- Body: same as `paperOrderCreateInputSchema` (quantity_unit required, no default)
- Missing `quantity_unit` → 400 VALIDATION_ERROR
- Duplicate `idempotencyKey` → 409 DUPLICATE_IDEMPOTENCY_KEY
- Gate blocked → 422 paper_gate_blocked
- REJECTED → 422 + OrderState
- Success → 201 + OrderState

Hard line: NO KGI write-side. This is paper-only. KGI FROZEN until 5/12.

### GET /api/v1/paper/fills

Lists all FILLED orders for the current user as a fills array.
- Auth: iuf_session cookie required
- Returns: `{ data: Fill[] }` where each fill includes symbol, side, fillQty, fillPrice, fillTime

### GET /api/v1/paper/portfolio

Aggregates FILLED orders into a per-symbol position snapshot.
- Auth: iuf_session cookie required
- Computation: net qty (buy=positive, sell=negative), weighted avg cost
- Returns: `{ data: PortfolioPosition[] }` where each position has:
  - `symbol`, `netQtyShares`, `avgCostPerShare`, `fillCount`, `note`

---

## quantity_unit enforcement

All paper routes enforce `quantity_unit` as required with no default.
Callers must explicitly pass `"SHARE"` or `"LOT"`.
Zod schema rejects missing field with 400.

---

## Storage

All state is in-memory (same as existing `paper-ledger.ts` Map).
This is GAP-2 from the Lane B audit (ledger persistence). Not fixed in P3.
P3 scope is skeleton only — E2E flow works, persistence is next sprint.

---

## Relationship to existing routes

| Existing route | New P3 route | Difference |
|---|---|---|
| POST /api/v1/paper/orders/preview | POST /api/v1/paper/preview | Same logic, cleaner E2E path |
| POST /api/v1/paper/orders | POST /api/v1/paper/submit | Same logic, cleaner E2E path |
| GET /api/v1/paper/orders (status=FILLED) | GET /api/v1/paper/fills | Fills-shaped view |
| (none) | GET /api/v1/paper/portfolio | New aggregate |

Old routes preserved for backward compat.

---

## Smoke verification

```bash
# 1. Preview (dry run, gate must allow)
curl -s -b /tmp/bruce_session.jar -X POST https://api.eycvector.com/api/v1/paper/preview \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"test-001","symbol":"2330","side":"buy","orderType":"market","qty":1,"quantity_unit":"SHARE"}' | jq .

# 2. Submit
curl -s -b /tmp/bruce_session.jar -X POST https://api.eycvector.com/api/v1/paper/submit \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"test-001","symbol":"2330","side":"buy","orderType":"market","qty":1,"quantity_unit":"SHARE"}' | jq .

# 3. Fills
curl -s -b /tmp/bruce_session.jar https://api.eycvector.com/api/v1/paper/fills | jq .

# 4. Portfolio
curl -s -b /tmp/bruce_session.jar https://api.eycvector.com/api/v1/paper/portfolio | jq .

# 5. Missing quantity_unit → expect 400
curl -s -b /tmp/bruce_session.jar -X POST https://api.eycvector.com/api/v1/paper/submit \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey":"test-bad","symbol":"2330","side":"buy","orderType":"market","qty":1}' | jq .error
```

---

## Gaps (not fixed in P3 — next sprint)

- GAP-1: idempotency in-memory only (survives process lifetime, not restart)
- GAP-2: ledger in-memory, not DB-backed
- GAP-3: submit uses stub risk check (driveOrder v0), not full risk engine
- GAP-4: preview can show blocked but submit may still go (gate disconnect)

---

## Status: DELIVERED (skeleton). Gaps documented for W8.
