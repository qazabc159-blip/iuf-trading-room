// W6 Paper Sprint — PaperExecutor: simulated order matching.
//
// v0 matching strategy (hardcoded — no partial fills, no latency simulation):
//   MARKET: immediate full fill at "best available" price.
//           Priority: (1) intent.price if set, (2) fallback constant 100.0.
//           Day 5+: pull from quote cache.
//   LIMIT:  immediate full fill at intent.price.
//           If intent.price is null, reject (limit order must have a price).
//   STOP / STOP_LIMIT: not yet supported — REJECTED with reason.
//
// Partial fills: Day 7+.
// Latency simulation: Day 7+.
// Quote cache integration: Day 5.
//
// No KGI SDK import. No broker dependency. No DB access (Day 3).
// No HTTP route. No live order.

import type { OrderIntent } from "./order-intent.js";
import type { SimulatedFill } from "./paper-ledger.js";

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export type ExecuteOrderResult =
  | { status: "FILLED"; fill: SimulatedFill; quantity_unit: import("./order-intent.js").QuantityUnit }
  | { status: "REJECTED"; reason: string };

// ---------------------------------------------------------------------------
// PaperExecutor
// ---------------------------------------------------------------------------

/**
 * Simulate matching an accepted OrderIntent against paper "market".
 *
 * Preconditions:
 *   - intent.status === "ACCEPTED" (caller is order-driver; not enforced here)
 *   - intent.qty > 0 (guaranteed by createOrderIntent)
 *
 * Returns:
 *   FILLED  — with fill details (qty, price, time)
 *   REJECTED — with human-readable reason
 */
export async function executeOrder(
  intent: OrderIntent
): Promise<ExecuteOrderResult> {
  const fillTime = new Date();

  switch (intent.orderType) {
    case "market": {
      // v0: fill at intent.price if provided, else fallback 100.0
      // Day 5: replace with quote cache lookup for intent.symbol
      const fillPrice = intent.price != null ? intent.price : 100.0;
      return {
        status: "FILLED",
        fill: {
          fillQty: intent.qty,
          fillPrice,
          fillTime
        },
        quantity_unit: intent.quantity_unit
      };
    }

    case "limit": {
      // v0 simplified: assume immediate full fill at limit price
      // Real limit matching (order book, price improvement) is Day 7+
      if (intent.price == null) {
        return {
          status: "REJECTED",
          reason: "limit order must have a price (price is null)"
        };
      }
      return {
        status: "FILLED",
        fill: {
          fillQty: intent.qty,
          fillPrice: intent.price,
          fillTime
        },
        quantity_unit: intent.quantity_unit
      };
    }

    case "stop":
    case "stop_limit": {
      // v0: not implemented; Day 7+
      return {
        status: "REJECTED",
        reason: `order type '${intent.orderType}' is not supported in v0 paper executor (Day 7+)`
      };
    }

    default: {
      // TypeScript exhaustiveness guard
      const _exhaustive: never = intent.orderType;
      return {
        status: "REJECTED",
        reason: `unknown order type: ${String(_exhaustive)}`
      };
    }
  }
}
