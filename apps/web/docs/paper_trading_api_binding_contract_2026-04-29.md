# Paper Trading API Binding Contract

**Author**: Jim (frontend-consume lane)  
**Date**: 2026-04-29  
**Sprint**: W6 Paper Trading Sprint — Day 1  
**Status**: DESIGN-ONLY — No implementation this round  
**Wire target**: Day 5 (2026-05-03)  

---

## Purpose

This document defines the frontend API binding contract for paper trading.  
It gives Jason (backend) and Codex (UI components) a shared reference so Day 5 wiring has zero ambiguity.

> Path alignment note: Jason Day 1 PR routes TBD at time of writing.  
> Primary assumption: `POST /api/v1/paper/orders` (per W6 sprint rules §3).  
> Alternate: `/api/v1/trading/orders` (if Jason unifies paper+live under `/trading`).  
> **Jim will re-align paths on Day 5 before writing any fetch function.**

---

## Section 1 — Endpoint Contract

### 1.1 `POST /api/v1/paper/orders` — Submit paper order

**Request body**

```typescript
interface PaperOrderCreateInput {
  symbol:        string;           // e.g. "2330"
  side:          "BUY" | "SELL";
  orderType:     "MARKET" | "LIMIT";
  quantity:      number;           // integer, shares
  price?:        number;           // required when orderType = "LIMIT"
  timeInForce:   "ROD" | "IOC" | "FOK";
  idempotencyKey: string;          // UUID v4, generated client-side
}
```

**Success response — 201**

```typescript
interface PaperOrderCreateResult {
  orderId:   string;
  status:    PaperOrderStatus;   // "PENDING" on creation
  createdAt: string;             // ISO 8601
}
```

**Error codes**

| HTTP | Code | Meaning | UI handling |
|------|------|---------|------------|
| 422 | `RISK_REJECTED` | Risk gate blocked the order | Show `reason` text below submit button in OrderTicket |
| 409 | `IDEMPOTENCY_CONFLICT` | Same idempotencyKey already processed | Silent — client retries with new UUID |
| 503 | `MODE_DISABLED` | Paper mode not enabled server-side | Disable form + banner "模式已關閉，請聯繫 admin" |
| 400 | `VALIDATION_ERROR` | Bad field values | Show field-level validation message |
| 5xx | — | Server error | Toast + Sentry capture |

---

### 1.2 `GET /api/v1/paper/orders` — List paper orders (paginated)

**Query params**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `status` | `PaperOrderStatus` | No | Filter by order status |
| `symbol` | string | No | Filter by symbol |
| `limit` | number | No | Default 20, max 100 |
| `cursor` | string | No | Opaque cursor from previous response |

**Success response — 200**

```typescript
interface PaperOrdersListResult {
  orders:      PaperOrder[];
  nextCursor?: string;        // undefined = no more pages
  total?:      number;        // optional server hint
}
```

---

### 1.3 `GET /api/v1/paper/orders/:id` — Order detail with fills

**Success response — 200**

```typescript
interface PaperOrderDetailResult extends PaperOrder {
  fills: PaperFill[];
}

interface PaperFill {
  fillId:    string;
  quantity:  number;
  price:     number;
  filledAt:  string;   // ISO 8601
}
```

---

### 1.4 `GET /api/v1/paper/portfolio` — Paper portfolio snapshot

**Success response — 200**

```typescript
interface PaperPortfolioSnapshot {
  cash:            number;
  equityValue:     number;
  pnlToday:        number;   // unrealized + realized delta vs prev close
  pnlCumulative:   number;   // since paper account inception
  positions:       PaperPosition[];
  asOf:            string;   // ISO 8601, snapshot timestamp
}

interface PaperPosition {
  symbol:        string;
  quantity:      number;
  averageCost:   number;
  currentPrice:  number;
  marketValue:   number;
  unrealizedPnl: number;
  side:          "LONG" | "SHORT";
}
```

---

### 1.5 `POST /api/v1/paper/orders/:id/cancel` — Cancel pending order

**Request body**: empty `{}`

**Success response — 200**

```typescript
interface PaperOrderCancelResult {
  orderId: string;
  status:  "CANCELLED";
}
```

**Error codes**

| HTTP | Code | Meaning |
|------|------|---------|
| 409 | `NOT_CANCELLABLE` | Order already filled or cancelled |
| 404 | `ORDER_NOT_FOUND` | ID not found |

---

### 1.6 Shared types

```typescript
type PaperOrderStatus =
  | "PENDING"       // queued, not yet simulated
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED";     // risk gate or validation at sim time

interface PaperOrder {
  orderId:        string;
  symbol:         string;
  side:           "BUY" | "SELL";
  orderType:      "MARKET" | "LIMIT";
  quantity:       number;
  filledQuantity: number;
  price?:         number;
  timeInForce:    "ROD" | "IOC" | "FOK";
  status:         PaperOrderStatus;
  idempotencyKey: string;
  createdAt:      string;
  updatedAt:      string;
}
```

---

## Section 2 — State Design (Zustand)

### 2.1 `executionModeStore`

Thin global slice — holds server-derived execution mode state only.  
No paper orders or portfolio data here (react-query manages cache).

```typescript
interface ExecutionModeState {
  mode:        "disabled" | "paper" | "live";
  killSwitch:  boolean;    // true = ARMED (orders blocked)
  paperMode:   boolean;    // derived: mode === "paper" && !killSwitch
  lastFetched: number | null;  // epoch ms

  refreshFromBackend(): Promise<void>;
}
```

**Invariants (W6 stop-lines)**:
- Default `mode` = `"disabled"` (never initialize to `"paper"` or `"live"`)
- Default `killSwitch` = `true` (ARMED)
- `paperMode` is derived, not set directly

**Store file**: `apps/web/src/store/executionMode.ts`

---

### 2.2 `paperOrdersStore` — NOT in Zustand

Paper orders list and detail are managed by **react-query** for cache + invalidation.  
Do not duplicate into Zustand — single source of truth in react-query cache.

---

### 2.3 `paperPortfolioStore` — NOT in Zustand

Same as orders — react-query manages the portfolio snapshot cache.

---

## Section 3 — React-Query Keys

```typescript
// Canonical query key factory — import from apps/web/src/api/paper-trading.ts

const paperQueryKeys = {
  orders: (filters?: { status?: PaperOrderStatus; symbol?: string }) =>
    ["paper", "orders", filters ?? {}] as const,

  order: (orderId: string) =>
    ["paper", "order", orderId] as const,

  portfolio: () =>
    ["paper", "portfolio"] as const,

  executionMode: () =>
    ["execution", "mode"] as const,
} as const;
```

**Cache behaviour**:
- `orders` list: `staleTime: 10_000` (10s) — not real-time, just recent-ish
- `order` detail: `staleTime: 5_000`
- `portfolio`: `staleTime: 15_000` — updates after fills, not tick-by-tick
- `executionMode`: `staleTime: 30_000` + manual `refreshFromBackend()` on critical actions

**Invalidation triggers**:
- On `submitPaperOrder` success → invalidate `orders()` + `portfolio()`
- On `cancelPaperOrder` success → invalidate `order(id)` + `orders()` + `portfolio()`

---

## Section 4 — Optimistic Update Strategy

### 4.1 Submit order (optimistic add)

1. On form submit: generate `idempotencyKey = crypto.randomUUID()`
2. **Optimistic**: prepend a synthetic `PaperOrder` to orders list cache with:
   - `status: "PENDING"`, `orderId: "LOCAL_" + idempotencyKey`, `filledQuantity: 0`
3. Fire `POST /api/v1/paper/orders`
4. **On success**: react-query invalidates `orders()` → server list replaces optimistic entry
5. **On failure**:
   - Rollback: revert orders cache to pre-mutation snapshot
   - Show error per §5 error display rules
   - On `409 IDEMPOTENCY_CONFLICT`: silent retry once with new UUID (not shown to user)

### 4.2 Cancel order (optimistic status flip)

1. **Optimistic**: set `status: "CANCELLED"` on the specific order in cache
2. Fire `POST /api/v1/paper/orders/:id/cancel`
3. **On success**: invalidate `order(id)` + `orders()` + `portfolio()`
4. **On failure**: rollback order status; show toast

---

## Section 5 — Error Display Rules

| Error | Where displayed | Message |
|-------|----------------|---------|
| 422 RISK_REJECTED | Below submit button in OrderTicket | `response.error.reason` (server provides text) |
| 409 IDEMPOTENCY_CONFLICT | Not shown to user | Retry once silently with new UUID |
| 503 MODE_DISABLED | Disables entire form + top banner | "模式已關閉，請聯繫 admin" |
| 400 VALIDATION_ERROR | Field-level inline | Field `message` from response |
| 5xx | Toast (top-right, 5s auto-dismiss) | "系統錯誤，請稍後再試" + Sentry capture |
| Network timeout | Toast | "連線逾時，請確認網路" |
| 409 NOT_CANCELLABLE (cancel) | Inline below cancel button | "訂單已成交或已取消，無法撤銷" |

---

## Section 6 — PAPER Badge Rules

The PAPER badge is a **global persistent indicator** — not a per-action badge.

**Visibility rule**:
```typescript
const showPaperBadge = executionModeStore.paperMode === true
  || executionModeStore.mode === "paper";
```

**Placement** (Codex owns the component, Jim owns the state binding):
- Header / nav bar: always visible when paper mode active
- OrderTicket: always visible above submit button when paper mode active
- OrderList: column badge on each row

**Badge variant** (per CRT vocabulary):
- `badge-yellow` — paper mode (amber, matches "caution / simulated" semantic)
- NOT `badge-green` (that is for live / healthy)
- NOT `badge-red` (that is for blocked / bear)

**W6 stop-line check**: UI MUST NOT allow submit unless `showPaperBadge === true` at submit time.

---

## Section 7 — What Jim Will NOT Build (Boundary)

| Forbidden | Reason |
|-----------|--------|
| Component styles / Tailwind classes / CSS | Codex scope |
| KGI gateway wiring | Paper walks separate path — KGI `/order/create` stays 409 |
| Connecting W2d read-only stack to paper | Read-only is read-only; paper is new independent path |
| ExecutionMode toggle UI | Codex builds the toggle; Jim only binds state |
| Live mode UI (badge swap) | Out of W6 scope — paper only |
| Risk engine changes | Backend — Jason scope |
| PaperExecutor simulation logic | Backend — Jason scope |

---

## Section 8 — Day 5 Implementation Plan

On Day 5 (2026-05-03), Jim will wire the following files after Codex delivers Day 2-4 components.

**Pre-wire checklist (Day 5 morning)**:
1. Confirm Jason's actual endpoint paths match §1 above; update if diverged
2. Confirm Codex component prop interfaces (what props does OrderTicket expect?)
3. Confirm `@iuf-trading-room/contracts` exports `PaperOrder`, `PaperOrderStatus`, etc.

**Files to create/modify**:

### `apps/web/src/api/paper-trading.ts` (new)

Fetch functions for all 5 endpoints. Pattern follows `apps/web/lib/api.ts` conventions:
- `Envelope<T>` wrapper (all responses `{ data: T }`)
- `requestPaperOrder(input)` — 422-tolerant (422 is semantically meaningful for risk reject)
- `getPaperOrders(filters?)` — standard request
- `getPaperOrderDetail(orderId)` — standard request
- `getPaperPortfolio()` — standard request
- `cancelPaperOrder(orderId)` — standard request

### `apps/web/src/hooks/usePaperOrders.ts` (new)

```typescript
// useQuery wrapper for orders list
function usePaperOrders(filters?: { status?: PaperOrderStatus; symbol?: string })
  : UseQueryResult<PaperOrdersListResult>
```

### `apps/web/src/hooks/usePaperPortfolio.ts` (new)

```typescript
// useQuery wrapper for portfolio snapshot
function usePaperPortfolio(): UseQueryResult<PaperPortfolioSnapshot>
```

### `apps/web/src/hooks/useSubmitPaperOrder.ts` (new)

```typescript
// useMutation wrapper — includes optimistic update + rollback
function useSubmitPaperOrder(): UseMutationResult<
  PaperOrderCreateResult,
  Error,
  PaperOrderCreateInput
>
```

### `apps/web/src/store/executionMode.ts` (new)

Zustand store implementing `ExecutionModeState` (§2.1).  
Fetches from backend execution mode endpoint on mount + on `refreshFromBackend()`.

### Wire into Codex components

- Pass `executionModeStore.paperMode` → Codex `<PaperBadge>` visibility prop
- Pass `useSubmitPaperOrder()` mutation → Codex `<OrderTicket>` `onSubmit` prop
- Pass `usePaperOrders()` result → Codex `<OrderList>` `orders` prop
- Pass `usePaperPortfolio()` result → Codex `<PortfolioPaperSection>` `portfolio` prop

---

## Appendix A — Assumptions Recorded

| # | Assumption | Impact if wrong |
|---|-----------|----------------|
| A1 | Endpoint base path is `/api/v1/paper/` | Update all fetch URLs in §8 on Day 5 |
| A2 | Response envelope is `{ data: T }` (matches existing `apps/web/lib/api.ts` convention) | Update `request()` call sites |
| A3 | `PaperOrder` + `PaperOrderStatus` types exported from `@iuf-trading-room/contracts` | If not, define locally in `paper-trading.ts` and file request to Jason |
| A4 | 422 risk reject includes a `reason` string in response body | If not, show generic "風控拒絕，無法送出" |
| A5 | `idempotencyKey` is UUID v4 string (client-generated) | If server generates, drop from request body |
| A6 | React-query v5 is already installed in apps/web | Verify in package.json; if not, add with `pnpm add @tanstack/react-query` |
| A7 | Zustand is already installed in apps/web | Verify in package.json; if not, add with `pnpm add zustand` |

---

## Appendix B — W6 Stop-Lines Relevant to Jim

From `feedback_w6_paper_sprint_rules.md` — the ones Jim owns at the UI layer:

| # | Stop-line | Jim's gate |
|---|-----------|-----------|
| 3 | Any commit with `executionMode: 'live'` as default | Zustand store default MUST be `"disabled"` |
| 4 | Kill switch default OFF | Store default `killSwitch: true` |
| 5 | UI missing PAPER badge while submit is enabled | `showPaperBadge` check in submit handler |
| 6 | Risk engine bypass — orders pass without risk gate | Jim does not bypass; 422 path is active |

Stop-lines 1, 2, 7, 8, 9, 10 are backend or infra-owned.
