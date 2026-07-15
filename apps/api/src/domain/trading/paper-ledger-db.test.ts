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
  deleteOrder,
  computeFifoRealizedPnl,
  PAPER_COST_RATES,
  matchFifoSellAgainstPriorOrders,
  recordRealizedPnlForSell,
  listRealizedPnlForUser
} from "./paper-ledger-db.js";
import type {
  PaperCostRates,
  RealizedPnlAdapter,
  PersistedRealizedTrade
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

    async findByIdempotencyKey(key: string): Promise<OrderState | undefined> {
      const entry = [...orders.values()].find(
        (s) => s.intent.idempotencyKey === key
      );
      if (!entry) return undefined;
      return { ...entry, fill: fills.get(entry.intent.id) ?? null };
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
    quantity_unit:  "LOT",
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

// ---------------------------------------------------------------------------
// FIFO realized P&L — computeFifoRealizedPnl
// (2026-07-12 paper ledger realized-PnL backlog: PR #1222 "Known remaining gap")
// ---------------------------------------------------------------------------

function makeFilledOrder(
  overrides: Partial<Parameters<typeof createOrderIntent>[0]> & { fillTime: string | Date },
  fillQty: number,
  fillPrice: number
): OrderState {
  const { fillTime, ...intentOverrides } = overrides;
  const intent = createOrderIntent({
    idempotencyKey: `idem-${randomUUID()}`,
    symbol:         "2330",
    side:           "buy",
    orderType:      "market",
    qty:            1000,
    quantity_unit:  "LOT",
    userId:         "00000000-0000-0000-0000-000000000001",
    ...intentOverrides
  });
  return {
    intent: { ...intent, status: "FILLED", createdAt: typeof fillTime === "string" ? fillTime : fillTime.toISOString() },
    fill: { fillQty, fillPrice, fillTime: typeof fillTime === "string" ? new Date(fillTime) : fillTime }
  };
}

const ZERO_COST_RATES: PaperCostRates = {
  buyCommissionRate: 0,
  sellCommissionRate: 0,
  securitiesTransactionTaxRate: 0
};

function closeTo(actual: number, expected: number, epsilon = 0.02, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    msg ?? `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

// FIFO-1: full close — buy then fully sell, clean cost-rate math
test("FIFO-1: full close realized P&L nets buy + sell fees exactly", () => {
  const orders: OrderState[] = [
    makeFilledOrder({ side: "buy",  fillTime: "2026-07-01T02:00:00Z" }, 1000, 100),
    makeFilledOrder({ side: "sell", fillTime: "2026-07-02T02:00:00Z" }, 1000, 110)
  ];

  const result = computeFifoRealizedPnl(orders);

  // costPerShareWithFee(buy@100) = 100 * 1.001425 = 100.1425
  // proceedsPerShare(sell@110)   = 110 * (1 - 0.001425 - 0.003) = 109.51325
  // pnl/share = 9.37075 * 1000 shares = 9370.75 (exact — no cent rounding ambiguity)
  assert.equal(result.totalRealizedPnlTwd, 9370.75);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.matchedQtyShares, 1000);
  assert.equal(result.trades[0]?.buyPrice, 100);
  assert.equal(result.trades[0]?.sellPrice, 110);

  const sym = result.bySymbol.find((s) => s.symbol === "2330");
  assert.ok(sym);
  assert.equal(sym.remainingOpenQtyShares, 0, "fully closed — no open lot left");
  assert.equal(sym.costBasisWithFeesTwd, 0);
  assert.equal(sym.closedTradeCount, 1);
  assert.equal(sym.realizedPnlTwd, 9370.75);
});

// FIFO-2: partial close — some shares closed, remainder still open
test("FIFO-2: partial close leaves remaining open lot with correct cost basis", () => {
  const orders: OrderState[] = [
    makeFilledOrder({ side: "buy",  fillTime: "2026-07-01T02:00:00Z" }, 1000, 100),
    makeFilledOrder({ side: "sell", fillTime: "2026-07-02T02:00:00Z" }, 400, 110)
  ];

  const result = computeFifoRealizedPnl(orders);
  const sym = result.bySymbol[0];
  assert.ok(sym);

  // matched 400 shares: 400 * 9.37075 = 3748.30 (clean, no rounding ambiguity)
  assert.equal(sym.realizedPnlTwd, 3748.3);
  assert.equal(sym.remainingOpenQtyShares, 600, "600 shares still open (1000 bought - 400 sold)");
  // remaining lot cost basis: 600 * 100.1425 = 60085.5
  assert.equal(sym.costBasisWithFeesTwd, 60085.5);
  assert.equal(sym.lastPrice, 110, "lastPrice reflects the most recent fill (the sell)");
  assert.equal(sym.marketValueTwd, 600 * 110);
  closeTo(sym.unrealizedPnlTwd, 600 * 110 - 60085.5);
});

// FIFO-3: multiple lots at different prices, multiple partial sells — FIFO order matters
test("FIFO-3: multiple buy lots at different prices are matched oldest-first", () => {
  const orders: OrderState[] = [
    makeFilledOrder({ side: "buy",  fillTime: "2026-07-01T01:00:00Z" }, 500, 100), // lot 1 (oldest)
    makeFilledOrder({ side: "buy",  fillTime: "2026-07-01T03:00:00Z" }, 500, 120), // lot 2 (newer, same day)
    makeFilledOrder({ side: "sell", fillTime: "2026-07-02T02:00:00Z" }, 700, 130)  // closes all of lot 1 + part of lot 2
  ];

  const result = computeFifoRealizedPnl(orders);
  assert.equal(result.trades.length, 2, "FIFO match splits across two lots");

  const [t1, t2] = result.trades;
  assert.equal(t1?.buyPrice, 100, "lot 1 (bought first) is matched before lot 2");
  assert.equal(t1?.matchedQtyShares, 500);
  assert.equal(t2?.buyPrice, 120, "remaining 200 shares come from lot 2");
  assert.equal(t2?.matchedQtyShares, 200);

  const sym = result.bySymbol[0];
  assert.ok(sym);
  assert.equal(sym.remainingOpenQtyShares, 300, "300 shares left over from lot 2 (500 - 200)");
  // remaining lot 2 cost basis: 300 * (120 * 1.001425) = 300 * 120.171 = 36051.3
  closeTo(sym.costBasisWithFeesTwd, 36051.3);
});

// FIFO-4: same-day multiple fills — deterministic ordering by fillTime, then createdAt
test("FIFO-4: same-day multiple fills are ordered by fillTime (not insertion order)", () => {
  // Insert sell BEFORE the buy in array order, but the buy's fillTime is earlier same day —
  // FIFO matching must still succeed (sort by fillTime, not array order).
  const buy  = makeFilledOrder({ side: "buy",  fillTime: "2026-07-01T01:00:00Z" }, 200, 50);
  const sell = makeFilledOrder({ side: "sell", fillTime: "2026-07-01T05:00:00Z" }, 200, 60);

  const result = computeFifoRealizedPnl([sell, buy]); // deliberately reversed input order
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]?.buyPrice, 50);
  assert.equal(result.trades[0]?.sellPrice, 60);
  assert.equal(result.bySymbol[0]?.remainingOpenQtyShares, 0);
});

// FIFO-5: custom cost rates (zero-cost) — verifies the rate parameter is actually applied
test("FIFO-5: zero-cost rates yield raw price-delta realized P&L", () => {
  const orders: OrderState[] = [
    makeFilledOrder({ side: "buy",  fillTime: "2026-07-01T02:00:00Z" }, 1000, 100),
    makeFilledOrder({ side: "sell", fillTime: "2026-07-02T02:00:00Z" }, 1000, 110)
  ];

  const result = computeFifoRealizedPnl(orders, ZERO_COST_RATES);
  assert.equal(result.totalRealizedPnlTwd, 10_000, "no fees — pure (110-100)*1000");
});

// FIFO-6: two symbols are isolated from each other
test("FIFO-6: realized P&L and open lots are isolated per symbol", () => {
  const orders: OrderState[] = [
    makeFilledOrder({ symbol: "2330", side: "buy",  fillTime: "2026-07-01T01:00:00Z" }, 1000, 100),
    makeFilledOrder({ symbol: "2330", side: "sell", fillTime: "2026-07-02T01:00:00Z" }, 1000, 110),
    makeFilledOrder({ symbol: "2454", side: "buy",  fillTime: "2026-07-01T01:00:00Z" }, 500, 500)
  ];

  const result = computeFifoRealizedPnl(orders);
  assert.equal(result.bySymbol.length, 2);

  const s2330 = result.bySymbol.find((s) => s.symbol === "2330");
  const s2454 = result.bySymbol.find((s) => s.symbol === "2454");
  assert.ok(s2330 && s2454);
  assert.equal(s2330.realizedPnlTwd, 9370.75);
  assert.equal(s2330.remainingOpenQtyShares, 0);
  assert.equal(s2454.realizedPnlTwd, 0, "2454 never sold — no realized P&L");
  assert.equal(s2454.remainingOpenQtyShares, 500);
});

// FIFO-7: reconciliation identity — realized + unrealized == marketValue + netCashFlow
// This is the "帳勾稽鐵律" lock: baseCapital cancels out of both sides when
// netCashFlowTwd is added to baseCapital to derive available cash (see server.ts),
// so the identity below must hold independent of baseCapital's actual value.
test("FIFO-7: totalRealized + totalUnrealized === totalMarketValue + netCashFlow", () => {
  const orders: OrderState[] = [
    makeFilledOrder({ symbol: "2330", side: "buy",  fillTime: "2026-07-01T01:00:00Z" }, 500, 100),
    makeFilledOrder({ symbol: "2330", side: "buy",  fillTime: "2026-07-01T03:00:00Z" }, 500, 120),
    makeFilledOrder({ symbol: "2330", side: "sell", fillTime: "2026-07-02T02:00:00Z" }, 700, 130),
    makeFilledOrder({ symbol: "2454", side: "buy",  fillTime: "2026-07-03T01:00:00Z" }, 1000, 50),
    makeFilledOrder({ symbol: "2454", side: "sell", fillTime: "2026-07-04T01:00:00Z" }, 300, 55),
    makeFilledOrder({ symbol: "2454", side: "buy",  fillTime: "2026-07-05T01:00:00Z" }, 200, 48)
  ];

  const result = computeFifoRealizedPnl(orders);
  const lhs = result.totalRealizedPnlTwd + result.totalUnrealizedPnlTwd;
  const rhs = result.totalMarketValueTwd + result.netCashFlowTwd;
  closeTo(lhs, rhs, 0.05, `reconciliation identity broke: LHS=${lhs} RHS=${rhs}`);
});

// FIFO-8: reconciliation identity also holds for a single simple round trip
// (independent, hand-computable sanity check backing FIFO-7's generic assertion)
test("FIFO-8: reconciliation identity holds for a single full round trip", () => {
  const orders: OrderState[] = [
    makeFilledOrder({ side: "buy",  fillTime: "2026-07-01T02:00:00Z" }, 1000, 100),
    makeFilledOrder({ side: "sell", fillTime: "2026-07-02T02:00:00Z" }, 1000, 110)
  ];
  const result = computeFifoRealizedPnl(orders);

  // Fully closed: unrealized=0, marketValue=0. netCashFlow should equal realizedPnl exactly
  // (base capital in, base capital + pnl out, no open position holding cash hostage).
  assert.equal(result.totalUnrealizedPnlTwd, 0);
  assert.equal(result.totalMarketValueTwd, 0);
  closeTo(result.netCashFlowTwd, result.totalRealizedPnlTwd, 0.02);
});

// FIFO-9: default export PAPER_COST_RATES matches the documented buy/sell rates
test("FIFO-9: PAPER_COST_RATES matches buy 0.1425% / sell 0.4425% (incl. STT)", () => {
  assert.equal(PAPER_COST_RATES.buyCommissionRate, 0.001425);
  const sellTotal = PAPER_COST_RATES.sellCommissionRate + PAPER_COST_RATES.securitiesTransactionTaxRate;
  closeTo(sellTotal, 0.004425, 0.0000001);
});

// ---------------------------------------------------------------------------
// Persisted realized-P&L ledger (migration 0058, 2026-07-15)
//   matchFifoSellAgainstPriorOrders / recordRealizedPnlForSell /
//   listRealizedPnlForUser, backed by a Map-based RealizedPnlAdapter test
//   double (same pattern as makeMapAdapter() above).
// ---------------------------------------------------------------------------

function makeMapRealizedPnlAdapter(): RealizedPnlAdapter & {
  _rows: PersistedRealizedTrade[];
} {
  const rows: PersistedRealizedTrade[] = [];
  const bySellOrder = new Map<string, string>();
  return {
    async hasMatchesForSellOrder(sellOrderId: string): Promise<boolean> {
      return bySellOrder.has(sellOrderId);
    },
    async insertMatches(userId, sellOrderId, matches): Promise<void> {
      if (matches.length === 0) return;
      for (const m of matches) {
        rows.push({ id: randomUUID(), sellOrderId, createdAt: new Date().toISOString(), ...m });
      }
      bySellOrder.set(sellOrderId, userId);
    },
    async listForUser(userId, symbol): Promise<PersistedRealizedTrade[]> {
      return rows
        .filter((r) => bySellOrder.get(r.sellOrderId) === userId)
        .filter((r) => (symbol === undefined ? true : r.symbol === symbol))
        .sort((a, b) => b.sellFillTime.localeCompare(a.sellFillTime));
    },
    _rows: rows
  };
}

test("RPNL-1: matchFifoSellAgainstPriorOrders returns exactly the new sell's matches (full close)", () => {
  const buy = makeFilledOrder({ side: "buy", fillTime: "2026-07-01T02:00:00Z" }, 1000, 100);
  const sell = makeFilledOrder({ side: "sell", fillTime: "2026-07-02T02:00:00Z" }, 1000, 110);

  const matches = matchFifoSellAgainstPriorOrders(sell, [buy]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.matchedQtyShares, 1000);
  assert.equal(matches[0]?.buyPrice, 100);
  assert.equal(matches[0]?.sellPrice, 110);
  assert.equal(matches[0]?.realizedPnlTwd, 9370.75);
});

test("RPNL-2: matchFifoSellAgainstPriorOrders splits across multiple prior lots", () => {
  const buy1 = makeFilledOrder({ side: "buy", fillTime: "2026-07-01T01:00:00Z" }, 500, 100);
  const buy2 = makeFilledOrder({ side: "buy", fillTime: "2026-07-01T03:00:00Z" }, 500, 120);
  const sell = makeFilledOrder({ side: "sell", fillTime: "2026-07-02T02:00:00Z" }, 700, 130);

  const matches = matchFifoSellAgainstPriorOrders(sell, [buy1, buy2]);
  assert.equal(matches.length, 2, "one sell can close slices of two different prior buy lots");
  assert.equal(matches[0]?.buyPrice, 100);
  assert.equal(matches[0]?.matchedQtyShares, 500);
  assert.equal(matches[1]?.buyPrice, 120);
  assert.equal(matches[1]?.matchedQtyShares, 200);
});

test("RPNL-3: matchFifoSellAgainstPriorOrders returns [] for a buy order (nothing to realize)", () => {
  const buy = makeFilledOrder({ side: "buy", fillTime: "2026-07-01T02:00:00Z" }, 1000, 100);
  assert.deepEqual(matchFifoSellAgainstPriorOrders(buy, []), []);
});

test("RPNL-4: recordRealizedPnlForSell persists matches and is idempotent on a second call", async () => {
  const adapter = makeMapRealizedPnlAdapter();
  const buy = makeFilledOrder({ side: "buy", fillTime: "2026-07-01T02:00:00Z" }, 1000, 100);
  const sell = makeFilledOrder({ side: "sell", fillTime: "2026-07-02T02:00:00Z" }, 1000, 110);

  const first = await recordRealizedPnlForSell(sell, [buy], PAPER_COST_RATES, adapter);
  assert.equal(first.length, 1);
  assert.equal(adapter._rows.length, 1);
  assert.equal(adapter._rows[0]?.sellOrderId, sell.intent.id);

  // Second call (e.g. a re-invoked driveOrder) must not duplicate the row.
  const second = await recordRealizedPnlForSell(sell, [buy], PAPER_COST_RATES, adapter);
  assert.deepEqual(second, [], "idempotent no-op — hasMatchesForSellOrder short-circuits");
  assert.equal(adapter._rows.length, 1, "no duplicate row inserted");
});

test("RPNL-5: recordRealizedPnlForSell is a no-op for a buy order", async () => {
  const adapter = makeMapRealizedPnlAdapter();
  const buy = makeFilledOrder({ side: "buy", fillTime: "2026-07-01T02:00:00Z" }, 1000, 100);
  const result = await recordRealizedPnlForSell(buy, [], PAPER_COST_RATES, adapter);
  assert.deepEqual(result, []);
  assert.equal(adapter._rows.length, 0);
});

test("RPNL-6: listRealizedPnlForUser isolates rows per user and supports symbol filter", async () => {
  const adapter = makeMapRealizedPnlAdapter();
  const userA = "00000000-0000-0000-0000-0000000000aa";
  const userB = "00000000-0000-0000-0000-0000000000bb";

  const buyA = makeFilledOrder({ userId: userA, symbol: "2330", side: "buy", fillTime: "2026-07-01T01:00:00Z" }, 1000, 100);
  const sellA1 = makeFilledOrder({ userId: userA, symbol: "2330", side: "sell", fillTime: "2026-07-02T01:00:00Z" }, 500, 110);
  const buyB = makeFilledOrder({ userId: userB, symbol: "2330", side: "buy", fillTime: "2026-07-01T01:00:00Z" }, 1000, 100);
  const sellB = makeFilledOrder({ userId: userB, symbol: "2330", side: "sell", fillTime: "2026-07-02T01:00:00Z" }, 1000, 105);

  await recordRealizedPnlForSell(sellA1, [buyA], PAPER_COST_RATES, adapter);
  await recordRealizedPnlForSell(sellB, [buyB], PAPER_COST_RATES, adapter);

  const forA = await listRealizedPnlForUser(userA, undefined, adapter);
  assert.equal(forA.length, 1, "user A's ledger must not include user B's trade");
  assert.equal(forA[0]?.symbol, "2330");

  const forB = await listRealizedPnlForUser(userB, undefined, adapter);
  assert.equal(forB.length, 1);
  assert.equal(forB[0]?.sellPrice, 105);

  const forAFilteredWrongSymbol = await listRealizedPnlForUser(userA, "2317", adapter);
  assert.deepEqual(forAFilteredWrongSymbol, [], "symbol filter excludes non-matching rows");

  const forAFilteredRightSymbol = await listRealizedPnlForUser(userA, "2330", adapter);
  assert.equal(forAFilteredRightSymbol.length, 1);
});
