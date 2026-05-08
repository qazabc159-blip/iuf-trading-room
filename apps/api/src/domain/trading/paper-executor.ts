// W6 Paper Sprint — PaperExecutor: simulated order matching.
//
// Matching strategy (no partial fills, no latency simulation):
//   MARKET: immediate full fill at "best available" price.
//           Priority: (1) intent.price if explicitly set,
//                     (2) DB last close from companies_ohlcv (source != 'mock'),
//                     (3) REJECTED with reason=no_price_available.
//           HARD LINE: never fill at a hardcoded fake price (was 100.0).
//   LIMIT:  immediate full fill at intent.price.
//           If intent.price is null, reject (limit order must have a price).
//   STOP / STOP_LIMIT: not yet supported — REJECTED with reason.
//
// Partial fills: Day 7+.
// Latency simulation: Day 7+.
//
// No KGI SDK import. No broker dependency.
// No HTTP route. No live order.

import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "@iuf-trading-room/db";
import type { OrderIntent } from "./order-intent.js";
import type { SimulatedFill } from "./paper-ledger.js";
import { toTaiwanStockShareCount } from "@iuf-trading-room/contracts";

// ── Last-close price lookup ───────────────────────────────────────────────────

/**
 * Fetch the most recent daily close price for a ticker from companies_ohlcv.
 * Only real data rows (source != 'mock') are considered.
 * Returns null when DB unavailable or no rows found (never throws).
 */
async function fetchLastClosePrice(symbol: string): Promise<number | null> {
  try {
    const db = getDb();
    if (!db) return null;
    const res = await db.execute(drizzleSql`
      SELECT close FROM companies_ohlcv
      WHERE ticker = ${symbol} AND interval = 'day' AND source != 'mock'
      ORDER BY dt DESC
      LIMIT 1
    `);
    const row = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
      ?? (Array.isArray(res) ? (res as Record<string, unknown>[])[0] : null);
    if (!row) return null;
    const close = typeof row["close"] === "number" ? row["close"]
      : parseFloat(String(row["close"] ?? ""));
    return Number.isFinite(close) && close > 0 ? close : null;
  } catch {
    return null;
  }
}

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
  const fillQty = toTaiwanStockShareCount(intent.qty, intent.quantity_unit);

  switch (intent.orderType) {
    case "market": {
      // Priority: (1) intent.price if explicitly set, (2) DB last close.
      // If neither available → REJECTED (never fill at a fabricated price).
      let fillPrice: number | null = intent.price ?? null;
      if (fillPrice == null) {
        fillPrice = await fetchLastClosePrice(intent.symbol);
      }
      if (fillPrice == null) {
        return {
          status: "REJECTED",
          reason: `no_price_available: market order for ${intent.symbol} requires either ` +
            `an explicit price or a real DB close price; none found`
        };
      }
      return {
        status: "FILLED",
        fill: {
          fillQty,
          fillPrice,
          fillTime
        },
        quantity_unit: intent.quantity_unit
      };
    }

    case "limit": {
      // Simplified: assume immediate full fill at limit price.
      // Real limit matching (order book, price improvement) is Day 7+.
      if (intent.price == null) {
        return {
          status: "REJECTED",
          reason: "limit order must have a price (price is null)"
        };
      }
      return {
        status: "FILLED",
        fill: {
          fillQty,
          fillPrice: intent.price,
          fillTime
        },
        quantity_unit: intent.quantity_unit
      };
    }

    case "stop":
    case "stop_limit": {
      // Not yet implemented; Day 7+.
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
