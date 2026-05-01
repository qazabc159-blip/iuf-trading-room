import type { KgiAction, KgiCreateOrderInput } from "../../broker/broker-port.js";
import type { OrderIntent } from "./order-intent.js";

/**
 * Translate paper-layer OrderIntent into KGI broker-layer createOrder input.
 *
 * Safety invariant:
 *   SHARE -> oddLot=true  -> qty is raw share count (1 means 1 share)
 *   LOT   -> oddLot=false -> qty is board-lot count (1 means 1 lot = 1,000 shares)
 *
 * This prevents a frontend "1 股零股" order from becoming a live
 * "1 張整股" order when KGI live submit is eventually enabled.
 */
export function mapPaperIntentToKgiOrder(intent: OrderIntent): KgiCreateOrderInput {
  const action: KgiAction = intent.side === "buy" ? "Buy" : "Sell";
  const oddLot = intent.quantity_unit === "SHARE";

  return {
    action,
    symbol: intent.symbol,
    qty: intent.qty,
    price: intent.orderType === "market" ? "MKT" : intent.price ?? undefined,
    oddLot,
  };
}
