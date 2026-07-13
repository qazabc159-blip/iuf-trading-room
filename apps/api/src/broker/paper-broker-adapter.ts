/**
 * paper-broker-adapter.ts — PaperBroker BrokerAdapter wrapper (UTA Phase A)
 *
 * Wraps PaperBroker module functions as a BrokerAdapter.
 * Additive wrapper — PaperBroker functions are NOT modified.
 */

import { randomUUID } from "node:crypto";

import type { AppSession } from "@iuf-trading-room/contracts";

import {
  cancelPaperOrder,
  listPaperAccounts,
  listPaperPositions,
  placePaperOrder,
} from "./paper-broker.js";
import type {
  BrokerAdapter,
  BrokerCapabilities,
  SubmitOrderResult,
  UnifiedOrderInput,
  UnifiedPosition,
} from "./broker-adapter.js";

const PAPER_CAPABILITIES: BrokerCapabilities = {
  oddLot: true,
  marginTrading: true,
  shortSelling: true,
  afterHoursFixing: false,
  simModeAvailable: true,
  maxSubscriptions: 9999,
};

export class PaperBrokerAdapter implements BrokerAdapter {
  readonly adapterKey = "paper" as const;
  readonly displayName = "Paper Trading";

  private readonly _session: AppSession;
  private _accountId: string | null = null;

  constructor(session: AppSession) {
    this._session = session;
  }

  capabilities(): BrokerCapabilities {
    return { ...PAPER_CAPABILITIES };
  }

  private async resolveAccountId(): Promise<string> {
    if (this._accountId) return this._accountId;
    const accounts = await listPaperAccounts(this._session);
    this._accountId = accounts[0]?.id ?? "paper-default";
    return this._accountId;
  }

  async getPositions(): Promise<UnifiedPosition[]> {
    const accountId = await this.resolveAccountId();
    const positions = await listPaperPositions(this._session, accountId);
    return positions.map((pos) => ({
      symbol: pos.symbol,
      qty: pos.quantity,
      avgPrice: pos.avgPrice,
      lastPrice: pos.marketPrice ?? pos.avgPrice,
      unrealized: pos.unrealizedPnl ?? 0,
      realized: 0,
      broker: this.adapterKey,
    }));
  }

  async submitOrder(input: UnifiedOrderInput): Promise<SubmitOrderResult> {
    const accountId = await this.resolveAccountId();

    const orderType: "market" | "limit" =
      input.priceType === "Market" ? "market" : "limit";

    // Taiwan order-type-matrix (T-1, 2026-07-13): market orders only accept
    // IOC/FOK; a fixed "rod" here would make every UTA market order fail the
    // new order-rules.ts validation. Limit orders keep ROD as before.
    const timeInForce = orderType === "market" ? "ioc" : "rod";

    // Map UTA's orderCond vocabulary (Cash/Margin/ShortSelling/LendSelling)
    // to the order-type-matrix's orderCond (cash/margin/short/daytrade).
    // LendSelling (借券賣出) has no daytrade equivalent in the UTA layer
    // today, so it maps to "short" — both are borrow-based sells.
    const orderCond: "cash" | "margin" | "short" | "daytrade" =
      input.orderCond === "Margin"
        ? "margin"
        : input.orderCond === "ShortSelling" || input.orderCond === "LendSelling"
          ? "short"
          : "cash";
    // UTA's oddLot is a plain boolean (no session distinction yet) — map to
    // the intraday session; afterhours variants aren't representable here.
    const session: "regular" | "intraday_odd" = input.oddLot ? "intraday_odd" : "regular";

    const order = await placePaperOrder({
      session: this._session,
      order: {
        accountId,
        symbol: input.symbol,
        side: input.action === "Buy" ? "buy" : "sell",
        type: orderType,
        quantity: input.qty,
        quantity_unit: "SHARE",
        price: input.priceType === "Limit" ? (input.limitPrice ?? null) : null,
        stopPrice: null,
        tradePlanId: null,
        strategyId: null,
        timeInForce,
        orderCond,
        session,
        clientOrderId: "uta-paper-" + randomUUID(),
        overrideGuards: [],
        overrideReason: "",
      },
      riskCheckId: null,
    });

    return { externalOrderId: order.id, status: "submitted" };
  }

  async cancelOrder(externalOrderId: string): Promise<void> {
    const accountId = await this.resolveAccountId();
    await cancelPaperOrder({
      session: this._session,
      accountId,
      payload: { orderId: externalOrderId, reason: "uta_cancel" },
    });
  }
}
