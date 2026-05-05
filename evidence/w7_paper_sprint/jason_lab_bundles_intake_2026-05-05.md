# Jason — P4: Lab Bundles Intake Skeleton
# Date: 2026-05-05

---

## Delivered

2 routes added to `apps/api/src/server.ts`:

### POST /api/v1/lab/bundles/intake

Accepts a strategy bundle from Athena. Read-side only — does NOT promote.

**Request body:**
```json
{
  "bundleId": "athena-bundle-2026-05-05-001",
  "source": "athena",
  "schemaVersion": "v1",
  "description": "Momentum factor bundle — research only",
  "tags": ["momentum", "experimental"]
}
```

- `source` must be `"athena"` — any other value → 400
- `bundleId` must be unique — duplicate → 409 DUPLICATE_BUNDLE_ID
- Status is always `"pending_review"` on creation — no auto-promotion
- Returns 201 + bundle record

**Intentionally absent fields** (Red gate — not accepted):
- sharpe, equityCurve, winRate, annualizedReturn, maxDrawdown
- Any field implying promotion, approval, or production readiness

### GET /api/v1/lab/bundles

Lists submitted bundles. Optional filters:
- `?status=pending_review|accepted|rejected`
- `?source=athena`

Returns newest-first. Returns `{ data: LabBundle[], total: number }`.

---

## Hard lines

- NO promotion triggered on intake
- NO paper submit triggered on intake
- NO live execution triggered on intake
- `source: "athena"` enforced via Zod `z.literal("athena")`
- Status always starts `"pending_review"` — human review required before any state transition

---

## Storage

In-memory `_labBundleStore: LabBundle[]`. Resets on process restart. Intentional for skeleton phase — DB migration deferred.

---

## Status transitions (not yet implemented — deferred)

Future: `PATCH /api/v1/lab/bundles/:id/status` (Owner/Admin only) to move `pending_review` → `accepted` or `rejected`. NOT implemented in P4.

---

## Smoke verification

```bash
# 1. Submit a bundle
curl -s -b /tmp/bruce_session.jar -X POST https://api.eycvector.com/api/v1/lab/bundles/intake \
  -H "Content-Type: application/json" \
  -d '{
    "bundleId": "athena-test-001",
    "source": "athena",
    "schemaVersion": "v1",
    "description": "Test bundle"
  }' | jq .

# 2. List bundles
curl -s -b /tmp/bruce_session.jar https://api.eycvector.com/api/v1/lab/bundles | jq .

# 3. Duplicate bundleId → expect 409
curl -s -b /tmp/bruce_session.jar -X POST https://api.eycvector.com/api/v1/lab/bundles/intake \
  -H "Content-Type: application/json" \
  -d '{"bundleId":"athena-test-001","source":"athena","schemaVersion":"v1"}' | jq .error

# 4. Wrong source → expect 400
curl -s -b /tmp/bruce_session.jar -X POST https://api.eycvector.com/api/v1/lab/bundles/intake \
  -H "Content-Type: application/json" \
  -d '{"bundleId":"wrong-source-001","source":"jim","schemaVersion":"v1"}' | jq .error
```

---

## Status: DELIVERED (skeleton, in-memory). DB persistence deferred to W8.
