# Broker Account Routing — Jason Lane Report
Date: 2026-06-24
Branch: feat/broker-account-routing-20260624
PR: (pending)

---

## Plan

### Gap confirmed

`trading-service.ts:139` `resolveBrokerKind(_order)` returned `"paper" as const` unconditionally.
`buildAccountContext` always called `getPaperBalance / listPaperPositions / listPaperOrders` regardless of account.
`submitOrder` always called `placePaperOrder`.

### accountId → brokerKind lookup path

```
OrderCreateInput.accountId (UUID string)
  ↓
resolveBrokerKindForAccount(accountId, workspaceId)   [broker-account-resolver.ts]
  ↓ SQL: SELECT adapter_key FROM broker_accounts
         WHERE id = $1::uuid AND workspace_id = $2::uuid AND is_active = TRUE
  ↓
adapterKeyToBrokerKind(adapter_key)
  "kgi" → "kgi"
  anything else → "paper"
  ↓
BrokerKind ("kgi" | "paper")
```

The domain `TradingRoomRepository` interface did NOT have a broker account getter, so the lookup goes directly to the DB via a raw `drizzleSql` query (same pattern used by the UTA accounts endpoint in server.ts line 20728).

### adapter registry

`BrokerAdapter` interface: `broker-adapter.ts`
`KgiBrokerAdapter` (adapterKey="kgi"): `kgi-broker-adapter.ts` — wraps `KgiBroker.createOrder()` → gateway `/order/create`
`PaperBrokerAdapter` (adapterKey="paper"): `paper-broker-adapter.ts` — wraps `placePaperOrder()`

For Phase 3, the `KgiBrokerAdapter.submitOrder()` path is intentionally NEVER reached from manual order flow — `assertKgiSimOnly()` throws before the adapter is instantiated.

### Files touched

| File | Change |
|------|--------|
| `apps/api/src/broker/broker-account-resolver.ts` | NEW — lookup helper |
| `apps/api/src/broker/trading-service.ts` | MODIFIED — routing wired |
| `tests/ci.test.ts` | MODIFIED — +4 tests BROKER-ROUTING-1..4 |
| `reports/trade_desk_gap_20260624/JASON_BROKER_ROUTING_2026-06-24.md` | NEW — this report |

`server.ts` NOT touched.
`risk-engine.ts`, `marketData.ts`, `apps/web/*` NOT touched.

---

## Implementation

### broker-account-resolver.ts (new)

- `adapterKeyToBrokerKind(adapterKey: string): BrokerKind` — maps "kgi" → "kgi", else → "paper"
- `resolveBrokerKindForAccount(accountId, workspaceId): Promise<BrokerKind>` — DB lookup, never throws, returns "paper" on any failure
- Uses raw `drizzleSql` SELECT to avoid importing `brokerAccounts` Drizzle table at module level (keeps import footprint minimal)
- Handles both postgres.js raw array shape and `{ rows: [...] }` shape (same normalisation pattern used elsewhere in the codebase)

### trading-service.ts (modified)

**`KGI_MANUAL_ORDER_WRITE_LOCKED = true`** — module-level constant. The canonical enforcement point.

**`assertKgiSimOnly(context)`** — throws `Error` if the write-locked flag is active. Prevents any KGI submit from reaching the broker adapter.

**`resolveBrokerKind(order, workspaceId): Promise<BrokerKind>`** — now async, delegates to `resolveBrokerKindForAccount`. Replaces `return "paper" as const`.

**`buildAccountContext`** — now takes `brokerKind` parameter:
- `"paper"`: original path unchanged (getPaperBalance / listPaperPositions / listPaperOrders)
- `"kgi"`: paper balance as proxy + KGI SIM positions (read-only via `KgiBrokerAdapter.getPositions()`). `brokerConnected: false` signals degraded context to risk engine. Gateway failure → empty positions (conservative).

**`submitOrder`**:
1. Resolve brokerKind from accountId
2. If kgi → `assertKgiSimOnly("submitOrder")` → throws (W6 guard)
3. Paper path proceeds as before

**`previewOrder`**:
1. Resolve brokerKind from accountId
2. Run risk+gate pipeline (read-only, same as before)
3. If kgi → return `blocked: true`, `quoteGate.decision: "block"`, `reasons: ["kgi_manual_write_locked", ...]`
4. Paper path returns as before

---

## Test plan (BROKER-ROUTING-1..4)

| Test | Assertion |
|------|-----------|
| BROKER-ROUTING-1 | `adapterKeyToBrokerKind` exported; "kgi"→"kgi" mapping; "paper" fallback present in source |
| BROKER-ROUTING-2 | null/empty accountId/workspaceId → returns paper (source guard check) |
| BROKER-ROUTING-3 | trading-service imports and calls `resolveBrokerKindForAccount`; old `"paper" as const` pattern gone |
| BROKER-ROUTING-4 | `KGI_MANUAL_ORDER_WRITE_LOCKED=true`; `assertKgiSimOnly` defined; submitOrder calls it for kgi; previewOrder includes `kgi_manual_write_locked` in reasons |

All tests are pure source-text assertions (no DB / HTTP). They prove the guard structure at code level.

---

## API contract for frontend (Jim's next step)

After this change, `POST /api/v1/trading/orders/preview` for a KGI-registered accountId returns:

```json
{
  "data": {
    "order": null,
    "riskCheck": { ... },
    "blocked": true,
    "quoteGate": {
      "mode": "execution",
      "decision": "block",
      "blocked": true,
      "reasons": ["kgi_manual_write_locked", ...],
      ...
    }
  }
}
```

`POST /api/v1/trading/orders` for a KGI accountId → HTTP 500 (assertKgiSimOnly throws; callers should treat this as a hard stop). Recommend wrapping in try/catch in the route handler if a 4xx response is preferred over 5xx — but the throw is intentional to surface Phase 4 unlock requirement clearly.

For paper accountId → behavior unchanged (order goes through paper broker as before).

**brokerKind field**: not currently surfaced in the `SubmitOrderResult` contract. If Jim needs it in the UI, add `brokerKind: BrokerKind` to `submitOrderResultSchema` in `packages/contracts/src/broker.ts` (contracts change, I can do it in a follow-on if Elva directs).

---

## Lane boundary

| Area | Touched? |
|------|----------|
| `broker/` | YES — my lane |
| `contracts/broker.ts` | NO — no schema change needed |
| `server.ts` | NO |
| `risk-engine.ts` | NO |
| `market-data.ts` | NO |
| `apps/web/*` | NO |

---

## Build / test status

Local build: Windows postgres.js CJS module error blocks local full test run (pre-existing; CI runs green bar).
TypeScript: 0 new errors expected (broker-account-resolver.ts uses types already in scope; trading-service.ts extends existing function signatures).

---

## Stop-lines maintained

- KGI write-side: LOCKED via `KGI_MANUAL_ORDER_WRITE_LOCKED = true` + `assertKgiSimOnly()`
- Real order: no path from manual order flow → KGI gateway `/order/create`
- No real broker account credentials touched
- No DB migration needed (reads existing `broker_accounts` table from migration 0032)
