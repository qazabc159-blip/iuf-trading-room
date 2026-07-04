/**
 * fubon-broker-adapter.ts — Fubon BrokerAdapter implementation (UTA Phase A, UTA-C3)
 *
 * Wraps FubonBroker as a BrokerAdapter, mirroring kgi-broker-adapter.ts's role.
 *
 * §3.3 safety invariant (FUBON_ADAPTER_INTERFACE_FREEZE_v1.md): a hardcoded
 * write-lock constant, independent of and in addition to the gateway-side
 * stage gate (FUBON_READ_ONLY_MODE / FUBON_LIVE_TRADING_ENABLED, enforced in
 * fubon-gateway-client.ts's classifyError + services/fubon-gateway-mock/).
 * submitOrder()/cancelOrder() refuse locally BEFORE any network call is made,
 * so real orders cannot reach the gateway even if its own gates were
 * misconfigured. Unlocking this is a Phase 4 safety-gate decision, not a
 * code change any agent should make unilaterally.
 */

import type { FubonGatewayClientConfig } from "./fubon-gateway-client.js";
import { FubonBroker } from "./fubon-broker.js";
import type {
  BrokerAdapter,
  BrokerCapabilities,
  SubmitOrderResult,
  UnifiedOrderInput,
  UnifiedPosition,
} from "./broker-adapter.js";

/**
 * Hardcoded true. Do NOT make this an env var or config flag — the whole
 * point is that flipping it requires a code change (+ review), not a runtime
 * toggle. See FUBON_ADAPTER_INTERFACE_FREEZE_v1.md §3.3 / §9 stage sequence.
 */
export const FUBON_ORDER_WRITE_LOCKED = true as const;

export class FubonOrderWriteLockedError extends Error {
  constructor(method: string) {
    super(`Fubon ${method}() is write-locked (FUBON_ORDER_WRITE_LOCKED=true) — no live order path exists yet.`);
    this.name = "FubonOrderWriteLockedError";
  }
}

/**
 * LOT -> shares conversion. GAP-v1 §2: qty is always shares on the wire; the
 * unified order flow's quantity_unit (SHARE|LOT) is resolved here, at the
 * adapter layer, per FUBON_ADAPTER_INTERFACE_FREEZE_v1.md §4.
 * 1 LOT = 1000 shares (TWSE/TPEx regular board lot). SHARE passes through
 * unchanged (covers odd-lot orders, e.g. qty=1).
 */
export function toShareQuantity(qty: number, unit: "SHARE" | "LOT" | undefined): number {
  return (unit ?? "LOT") === "LOT" ? qty * 1000 : qty;
}

/**
 * Shares -> lots, for the reverse direction (display / reconciliation).
 * Returns whole lots plus any odd-lot remainder shares.
 */
export function sharesToLots(shares: number): { lots: number; remainderShares: number } {
  return { lots: Math.floor(shares / 1000), remainderShares: shares % 1000 };
}

// Conservative skeleton values — GAP-v1 exposes no quote surface at all, and
// margin/short capability is unconfirmed pending the Neo SDK mapping (§4 TBD
// table). Revise once O-4 documentation is in hand; do not guess further.
const FUBON_CAPABILITIES: BrokerCapabilities = {
  oddLot: true,
  marginTrading: false,
  shortSelling: false,
  afterHoursFixing: false,
  simModeAvailable: true,
  maxSubscriptions: 0,
};

export class FubonBrokerAdapter implements BrokerAdapter {
  readonly adapterKey = "fubon" as const;
  readonly displayName = "富邦證券 (Fubon)";

  private readonly _broker: FubonBroker;

  constructor(config?: FubonGatewayClientConfig) {
    this._broker = new FubonBroker(config ?? {});
  }

  capabilities(): BrokerCapabilities {
    return { ...FUBON_CAPABILITIES };
  }

  async getPositions(): Promise<UnifiedPosition[]> {
    try {
      const positions = await this._broker.getPositions();
      return positions.map((pos) => ({
        symbol: pos.symbol,
        qty: pos.qty,
        avgPrice: pos.avgPrice,
        lastPrice: pos.lastPrice,
        unrealized: pos.unrealized,
        realized: pos.realized,
        broker: this.adapterKey,
      }));
    } catch {
      return [];
    }
  }

  async submitOrder(_input: UnifiedOrderInput): Promise<SubmitOrderResult> {
    if (FUBON_ORDER_WRITE_LOCKED) {
      throw new FubonOrderWriteLockedError("submitOrder");
    }
    // Unreachable while FUBON_ORDER_WRITE_LOCKED is true. Left un-implemented
    // on purpose — wiring the real qty conversion + gateway call is Phase 4
    // work, not this skeleton PR.
    throw new FubonOrderWriteLockedError("submitOrder");
  }

  async cancelOrder(_externalOrderId: string): Promise<void> {
    if (FUBON_ORDER_WRITE_LOCKED) {
      throw new FubonOrderWriteLockedError("cancelOrder");
    }
    throw new FubonOrderWriteLockedError("cancelOrder");
  }

  get brokerPort(): FubonBroker {
    return this._broker;
  }
}
