/**
 * broker-adapter.ts — UTA Phase A: BrokerAdapter interface
 *
 * A broker-agnostic abstraction layer on top of the existing BrokerPort (KGI-coupled).
 * This interface decouples the strategy engine and UTA routes from any specific broker SDK.
 *
 * AGPL compliance: All code is IUF-original. OpenAlice referenced for architecture
 * concepts only (public README/docs layer), not source code.
 */

export interface BrokerCapabilities {
  oddLot: boolean;
  marginTrading: boolean;
  shortSelling: boolean;
  afterHoursFixing: boolean;
  simModeAvailable: boolean;
  maxSubscriptions: number;
}

export interface UnifiedOrderInput {
  symbol: string;
  action: "Buy" | "Sell";
  qty: number;
  priceType: "Market" | "Limit" | "LimitUp" | "LimitDown";
  limitPrice?: number;
  orderCond?: "Cash" | "Margin" | "ShortSelling" | "LendSelling";
  oddLot?: boolean;
}

export interface UnifiedPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  lastPrice: number;
  unrealized: number;
  realized: number;
  broker: string;
}

export interface UnifiedTick {
  symbol: string;
  price: number;
  volume: number;
  datetime: string;
  broker: string;
}

export interface SubmitOrderResult {
  externalOrderId: string;
  status: "pending" | "submitted";
}

export interface BrokerAdapter {
  readonly adapterKey: string;
  readonly displayName: string;
  capabilities(): BrokerCapabilities;
  getPositions(): Promise<UnifiedPosition[]>;
  submitOrder(input: UnifiedOrderInput): Promise<SubmitOrderResult>;
  cancelOrder(externalOrderId: string): Promise<void>;
}
