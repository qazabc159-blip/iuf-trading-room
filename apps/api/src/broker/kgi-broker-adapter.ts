/**
 * kgi-broker-adapter.ts — KGI BrokerAdapter implementation (UTA Phase A)
 *
 * Wraps existing KgiBroker (BrokerPort) as BrokerAdapter.
 * Additive wrapper — KgiBroker is NOT modified.
 */

import type { KgiGatewayClientConfig } from "./kgi-gateway-client.js";
import { KgiBroker } from "./kgi-broker.js";
import type {
  BrokerAdapter,
  BrokerCapabilities,
  SubmitOrderResult,
  UnifiedOrderInput,
  UnifiedPosition,
} from "./broker-adapter.js";

const KGI_CAPABILITIES: BrokerCapabilities = {
  oddLot: true,
  marginTrading: true,
  shortSelling: true,
  afterHoursFixing: false,
  simModeAvailable: true,
  maxSubscriptions: 40,
};

export class KgiBrokerAdapter implements BrokerAdapter {
  readonly adapterKey = "kgi" as const;
  readonly displayName = "凱基證券 (KGI)";

  private readonly _broker: KgiBroker;

  constructor(config?: KgiGatewayClientConfig) {
    this._broker = new KgiBroker(config ?? {});
  }

  capabilities(): BrokerCapabilities {
    return { ...KGI_CAPABILITIES };
  }

  async getPositions(): Promise<UnifiedPosition[]> {
    try {
      const kgiPositions = await this._broker.getPosition();
      return kgiPositions.map((pos) => ({
        symbol: pos.symbol,
        qty: pos.netQuantity,
        avgPrice: 0,
        lastPrice: pos.lastPrice,
        unrealized: pos.unrealized,
        realized: pos.realized,
        broker: this.adapterKey,
      }));
    } catch {
      return [];
    }
  }

  async submitOrder(input: UnifiedOrderInput): Promise<SubmitOrderResult> {
    const result = await this._broker.createOrder({
      symbol: input.symbol,
      action: input.action,
      qty: input.qty,
      price: input.priceType === "Limit"
        ? (input.limitPrice ?? "MKT")
        : input.priceType === "Market"
          ? "MKT"
          : input.priceType,
      orderCond: input.orderCond ?? "Cash",
      oddLot: input.oddLot ?? false,
    });

    const rawRecord = result as Record<string, unknown>;
    const externalOrderId = typeof rawRecord["order_id"] === "string"
      ? rawRecord["order_id"]
      : "kgi-" + Date.now();

    return { externalOrderId, status: "submitted" };
  }

  async cancelOrder(externalOrderId: string): Promise<void> {
    await this._broker.cancelOrder(externalOrderId);
  }

  get brokerPort(): KgiBroker {
    return this._broker;
  }
}
