/**
 * paper-ledger-db.test.ts — W6 Day 4 unit tests
 *
 * Coverage (7 tests, requirement = 5+):
 *   T1: upsertOrder + getOrder round-trip
 *   T2: listOrders — userId isolation (cross-user)
 *   T3: listOrders — status filter
 *   T4: recordFill once → idempotent second call no-op
 *   T5: deleteOrder removes row + getOrder returns undefined
 *   T6: upsertOrder ON CONFLICT — re-upsert with same idempotencyKey updates status
 *   T7: recordFill returns false for unknown orderId
 *
 * Test DB strategy: Map-backed LedgerAdapter injected via optional `adapter`
 * parameter.  No native DB binary required.
 * The adapter implements the same LedgerAdapter interface that DrizzleAdapter
 * implements, so tests cover the full public contract of paper-ledger-db.ts.
 *
 * D5 integration note:
 *   Bruce's D5 gate requires running these same 5 scenarios against a real
 *   Postgres DB using drizzleAdapter() with PERSISTENCE_MODE=database.
 *
 * Run:
 *   node --test --import tsx/esm \
 *     apps/api/src/domain/trading/paper-ledger-db.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createOrderIntent } from "./order-intent.js";
import type { LedgerAdapter, OrderState, SimulatedFill } from "./paper-ledger-db.js";
import {
  upsertOrder,
  getOrder,
  listOrders,
  recordFill,
  deleteOrder
} from "./paper-ledger-db.js";
import type { OrderIntentStatus } from "./order-intent.js";

// ---------------------------------------------------------------------------
// Map-backed LedgerAdapter (test double)
// ---------------------------------------------------------------------------

/**
 * In-process adapter for unit tests.
 * Implements the identical LedgerAdapter interface that DrizzleAdapter
 * implements, so swapping adapters in D5 is a one-liner change.
 */
function makeMapAdapter(): LedgerAdapter {
  // Store OrderState directly — no serialisation round-trip needed for tests
  const orders = new Map<string, OrderState>();
  // Track fill existence keyed by orderId (at most 1 fill per order, same as prod)
  const fills = new Map<string, SimulatedFill>();

  return {
    async saveOrder(state: OrderState): Promise<void> {
      // Idempotency: overwrite by id (and update by idempotencyKey conflict)
      // Find existing by same idempotencyKey
      const existingEntry = [...orders.entries()].find(
        ([, s]) => s.intent.idempotencyKey === state.intent.idempotencyKey
      );
      if (existingEntry) {
        // ON CONFLICT DO UPDATE — update status/reason/updatedAt only
        const [existingId, existingState] = existingEntry;
        orders.set(existingId, {
          ...existingState,
          intent: {
            ...existingState.intent,
            status:    state.intent.status,
            reason:    state.intent.reason,
            updatedAt: state.intent.updatedAt
          }
        });
      } else {
        orders.set(state.intent.id, state);
      }
    },

    async findOrder(orderId: string): Promise<OrderState | undefined> {
      const state = orders.get(orderId);
      if (!state) return undefined;
      return { ...state, fill: fills.get(orderId) ?? null };
    },

    async listOrders(
      userId: string,
      statusFilter?: OrderIntentStatus
    ): Promise<OrderState[]> {
      let results = [...orders.values()].filter(
        (s) => s.intent.userId === userId
      );
      if (statusFilter !== undefined) {
        results = results.filter((s) => s.intent.status === statusFilter);
      }
      // Attach fills and sort by createdAt ASC
      results = results
        .map((s) => ({ ...s, fill: fills.get(s.intent.id) ?? null }))
        .sort((a, b) =>
          a.intent.createdAt.localeCompare(b.intent.createdAt)
        );
      return results;
    },

    async saveFill(orderId: string, fill: SimulatedFill): Promise<boolean> {
      if (!orders.has(orderId)) return false;
      if (fills.has(orderId)) return true; // idempotent no-op
      fills.set(orderId, fill);
      return true;
    },

    async removeOrder(orderId: string): Promise<boolean> {
      if (!orders.has(orderId)) return false;
      orders.delete(orderId);
      fills.delete(orderId); // cascade
      return true;
    },

    // Test-only accessors for assertions
    _orders: orders,
    _fills:  fills
  } as LedgerAdapter & {
    _orders: Map<string, OrderState>;
    _fills:  Map<string, SimulatedFill>;
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeIntent(
  overrides: Partial<Parameters<typeof createOrderIntent>[0]> = {}
) {
  return createOrderIntent({
    idempotencyKey: `idem-${randomUUID()}`,
    symbol:         "2330",
    side:           "buy",
    orderType:      "market",
    qty:            1000,
    userId:         "00000000-0000-0000-0000-000000000001",
    ...overrides
  });
}

function makeState(
  overrides: Partial<Parameters<typeof createOrderIntent>[0]> = {},
  fill: SimulatedFill | null = null
): OrderState {
  return { intent: makeIntent(overrides), fill };
}

// ---------------------------------------------------------------------------
// T1: upsertOrder + getOrder round-trip
// ---------------------------------------------------------------------------

test("T1: upsertOrder then getOrder returns same OrderState", async () => {
  const adapter = makeMapAdapter();
  const state = makeState();

  await upsertOrder(state, adapter);
  const fetched = await getOrder(state.intent.id, adapter);

  assert.ok(fetched, "getOrder should return a result");
  assert.equal(fetched.intent.id,     state.intent.id);
  assert.equal(fetched.intent.symbol, "2330");
  assert.equal(fetched.intent.status, "PENDING");
  assert.equal(fetched.fill,          null);
});

// ---------------------------------------------------------------------------
// T2: listOrders — userId isolation
// ---------------------------------------------------------------------------

test("T2: listOrders only returns orders for the given userId", async () => {
  const adapter = makeMapAdapter();

  const userA = "00000000-0000-0000-0000-000000000001";
  const userB = "00000000-0000-0000-0000-000000000002";

  await upsertOrder(makeState({ userId: userA }), adapter);
  await upsertOrder(makeState({ userId: userA }), adapter);
  await upsertOrder(makeState({ userId: userB }), adapter);

  const listA = await listOrders(userA, undefined, adapter);
  const listB = await listOrders(userB, undefined, adapter);

  assert.equal(listA.length, 2, "userA should see 2 orders");
  assert.equal(listB.length, 1, "userB should see 1 order");
  assert.ok(listA.every((s) => s.intent.userId === userA));
  assert.ok(listB.every((s) => s.intent.userId === userB));
});

// ---------------------------------------------------------------------------
// T3: listOrders — status filter
// ---------------------------------------------------------------------------

test("T3: listOrders status filter returns only matching orders", async () => {
  const adapter = makeMapAdapter();
  const userId = "00000000-0000-0000-0000-000000000001";

  // Insert a PENDING order
  const s1 = makeState({ userId });
  await upsertOrder(s1, adapter);

  // Insert an order, then update its status to FILLED
  const s2 = makeState({ userId });
  await upsertOrder(s2, adapter);
  const s2Filled: OrderState = {
    intent: { ...s2.intent, status: "FILLED", updatedAt: new Date().toISOString() },
    fill: null
  };
  await upsertOrder(s2Filled, adapter);

  const pendingList = await listOrders(userId, { status: "PENDING" }, adapter);
  const filledList  = await listOrders(userId, { status: "FILLED" },  adapter);
  const allList     = await listOrders(userId, undefined, adapter);

  assert.equal(pendingList.length, 1, "should see 1 PENDING");
  assert.equal(filledList.length,  1, "should see 1 FILLED");
  assert.equal(allList.length,     2, "should see 2 total");
});

// ---------------------------------------------------------------------------
// T4: recordFill idempotency
// ---------------------------------------------------------------------------

test("T4: recordFill once succeeds; second call is idempotent no-op", async () => {
  const adapter = makeMapAdapter();
  const state = makeState();
  await upsertOrder(state, adapter);

  const fill: SimulatedFill = {
    fillQty:   1000,
    fillPrice: 850.0,
    fillTime:  new Date()
  };

  const first  = await recordFill(state.intent.id, fill, adapter);
  const second = await recordFill(state.intent.id, fill, adapter);

  assert.equal(first,  true, "first recordFill should return true");
  assert.equal(second, true, "second recordFill should be idempotent");

  // Only one fill should exist
  const adapterWithInternal = adapter as LedgerAdapter & {
    _fills: Map<string, SimulatedFill>;
  };
  assert.equal(adapterWithInternal._fills.size, 1, "only 1 fill should be stored");
});

// ---------------------------------------------------------------------------
// T5: deleteOrder removes row + getOrder returns undefined
// ---------------------------------------------------------------------------

test("T5: deleteOrder removes order; getOrder returns undefined after", async () => {
  const adapter = makeMapAdapter();
  const state = makeState();
  await upsertOrder(state, adapter);

  const before = await getOrder(state.intent.id, adapter);
  assert.ok(before, "order should exist before delete");

  const deleted = await deleteOrder(state.intent.id, adapter);
  assert.equal(deleted, true, "deleteOrder should return true");

  const after = await getOrder(state.intent.id, adapter);
  assert.equal(after, undefined, "getOrder should return undefined after delete");
});

// ---------------------------------------------------------------------------
// T6: upsertOrder ON CONFLICT — same idempotencyKey updates status
// ---------------------------------------------------------------------------

test("T6: upsertOrder with same idempotencyKey updates status (no duplicate row)", async () => {
  const adapter = makeMapAdapter();
  const state = makeState();
  await upsertOrder(state, adapter);

  // Transition to ACCEPTED and re-upsert
  const accepted: OrderState = {
    intent: { ...state.intent, status: "ACCEPTED", updatedAt: new Date().toISOString() },
    fill: null
  };
  await upsertOrder(accepted, adapter);

  const fetched = await getOrder(state.intent.id, adapter);
  assert.ok(fetched);
  assert.equal(fetched.intent.status, "ACCEPTED");

  const adapterWithInternal = adapter as LedgerAdapter & {
    _orders: Map<string, OrderState>;
  };
  assert.equal(adapterWithInternal._orders.size, 1, "no duplicate rows after conflict update");
});

// ---------------------------------------------------------------------------
// T7: recordFill returns false for unknown orderId
// ---------------------------------------------------------------------------

test("T7: recordFill returns false for unknown orderId", async () => {
  const adapter = makeMapAdapter();

  const fill: SimulatedFill = {
    fillQty:   500,
    fillPrice: 100.0,
    fillTime:  new Date()
  };

  const result = await recordFill("00000000-0000-0000-0000-000000000000", fill, adapter);
  assert.equal(result, false, "recordFill should return false for unknown orderId");
});
