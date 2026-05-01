import type {
  OrderCreateInput,
  TradePlan,
  TradePlanExecution
} from "@iuf-trading-room/contracts";

import { computeSizedQuantity, type SizingResult } from "./sizing";

// Single source of truth for TradePlan → OrderCreateInput. OrderTicket uses
// this for manual prefill; a future strategy engine / auto-submit flow can
// call the same helper so the two surfaces stay in sync.

export type PlanToOrderInput = {
  plan: TradePlan;
  accountId: string;
  equity: number | null;
  timeInForce?: "rod" | "ioc" | "fok";
  lotSize?: number;
};

export type PlanToOrderResult = {
  // Derived OrderCreateInput. quantity may be 0 when sizing can't resolve —
  // callers should gate submit on sizing.blocker / blockers instead of assuming
  // the payload is submit-ready.
  order: OrderCreateInput;
  sizing: SizingResult;
  // Entry price used to seed order.price. Mid of entryRange when entryPrice is
  // null; null when the plan has neither.
  derivedEntryPrice: number | null;
  // Aggregate reasons the resulting order is not yet execution-ready.
  blockers: string[];
};

export function deriveEntryPrice(execution: TradePlanExecution): number | null {
  if (execution.entryPrice !== null) return execution.entryPrice;
  if (execution.entryRange) {
    return (execution.entryRange.low + execution.entryRange.high) / 2;
  }
  return null;
}

export function buildOrderInputFromPlan(input: PlanToOrderInput): PlanToOrderResult {
  const { plan, accountId, equity, lotSize } = input;
  const timeInForce = input.timeInForce ?? "rod";
  const blockers: string[] = [];

  if (!plan.execution) {
    blockers.push("計畫尚未填寫 execution 區塊");
    return {
      order: {
        accountId,
        symbol: "",
        side: "buy",
        type: "limit",
        timeInForce,
        quantity: 0,
        quantity_unit: "SHARE",
        price: null,
        stopPrice: null,
        tradePlanId: plan.id,
        strategyId: null,
        overrideGuards: [],
        overrideReason: ""
      },
      sizing: {
        qty: null,
        rawQty: null,
        cappedByMaxPosition: false,
        reason: "",
        blocker: "計畫尚未填寫 execution 區塊"
      },
      derivedEntryPrice: null,
      blockers
    };
  }

  const ex = plan.execution;

  // Plans close/canceled are historical records — we still populate the form
  // so users can inspect, but mark it as a blocker so SUBMIT gate warns.
  if (plan.status === "closed" || plan.status === "canceled") {
    blockers.push(`計畫狀態 ${plan.status}，不建議據此下單`);
  }

  // validUntil expired → the plan is stale; surface as blocker so caller can
  // warn or refuse to reuse.
  if (ex.validUntil) {
    const expiry = new Date(ex.validUntil).getTime();
    if (Number.isFinite(expiry) && expiry < Date.now()) {
      blockers.push(`計畫已於 ${ex.validUntil} 過期`);
    }
  }

  // If the plan pinned a specific accountId, flag a mismatch as a blocker —
  // same symbol but wrong account can silently lose a trader's entry on the
  // intended book.
  if (ex.accountId && ex.accountId !== accountId) {
    blockers.push(`計畫指定帳戶 ${ex.accountId}，與目前帳戶 ${accountId} 不符`);
  }

  const derivedEntryPrice = deriveEntryPrice(ex);
  const sizing = computeSizedQuantity({
    equity,
    sizing: ex.positionSizing,
    entryPrice: derivedEntryPrice,
    stopLoss: ex.stopLoss,
    lotSize
  });
  if (sizing.blocker) blockers.push(sizing.blocker);

  // Only surface stopPrice on stop/stop_limit orders — TWSE brokers reject it
  // on plain limit/market and we don't want to poison a market order payload
  // just because the plan had a protective stop.
  const needsStopPrice = ex.orderType === "stop" || ex.orderType === "stop_limit";
  const stopPrice = needsStopPrice ? ex.stopLoss : null;
  if (needsStopPrice && stopPrice === null) {
    blockers.push("停損觸發價未設定");
  }

  // Market orders ride without a limit price; limit/stop_limit use entry. For
  // plain stop orders (stop-market) there is no limit price either.
  const priceForOrder =
    ex.orderType === "market" || ex.orderType === "stop"
      ? null
      : derivedEntryPrice;
  if (ex.orderType === "limit" && priceForOrder === null) {
    blockers.push("限價單缺少進場價");
  }

  const order: OrderCreateInput = {
    accountId,
    symbol: ex.symbol,
    side: ex.side,
    type: ex.orderType,
    timeInForce,
    quantity: sizing.qty ?? 0,
    quantity_unit: "SHARE",
    price: priceForOrder,
    stopPrice,
    tradePlanId: plan.id,
    strategyId: ex.strategyId,
    overrideGuards: [],
    overrideReason: ""
  };

  return { order, sizing, derivedEntryPrice, blockers };
}
