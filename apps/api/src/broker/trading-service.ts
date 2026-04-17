import {
  type AppSession,
  type Order,
  type OrderCancelInput,
  type OrderCreateInput,
  type RiskCheckResult
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

import { evaluateRiskCheck } from "../risk-engine.js";
import { listMarketQuotes } from "../market-data.js";
import {
  cancelPaperOrder,
  getPaperBalance,
  listPaperOrders,
  listPaperPositions,
  placePaperOrder
} from "./paper-broker.js";

export type SubmitOrderResult = {
  order: Order | null;
  riskCheck: RiskCheckResult;
  blocked: boolean;
};

// Build the account context the risk engine reads from, sourced from the paper
// broker's current state. When real brokers land, swap this out per broker.
async function buildAccountContext(input: {
  session: AppSession;
  order: OrderCreateInput;
}): Promise<{
  equity: number;
  availableCash: number;
  realizedPnlTodayPct: number;
  openOrders: number;
  grossExposurePct: number;
  symbolPositionPct: number;
  themeExposurePct: number;
  brokerConnected: boolean;
}> {
  const balance = await getPaperBalance(input.session, input.order.accountId);
  const positions = await listPaperPositions(input.session, input.order.accountId);
  const orders = listPaperOrders(input.session, {
    accountId: input.order.accountId
  });
  const openStatuses = new Set(["pending", "submitted", "acknowledged", "partial"]);
  const openOrders = orders.filter((o) => openStatuses.has(o.status)).length;

  const equity = balance.equity > 0 ? balance.equity : 1;
  const grossExposure = positions.reduce(
    (acc, p) => acc + Math.abs(p.marketValue ?? 0),
    0
  );
  const symbolPos = positions.find((p) => p.symbol === input.order.symbol);
  const symbolPosPct = symbolPos
    ? (Math.abs(symbolPos.marketValue ?? 0) / equity) * 100
    : 0;
  const realizedPnlTodayPct = (balance.realizedPnlToday / equity) * 100;

  return {
    equity,
    availableCash: balance.availableCash,
    realizedPnlTodayPct,
    openOrders,
    grossExposurePct: (grossExposure / equity) * 100,
    symbolPositionPct: symbolPosPct,
    // Theme exposure resolution is deferred until we have a per-symbol theme
    // lookup cached at the broker layer. Defaulting to symbol exposure keeps
    // the guard from silently returning 0 for single-theme concentrations.
    themeExposurePct: symbolPosPct,
    brokerConnected: true
  };
}

async function resolveMarketContext(input: {
  session: AppSession;
  order: OrderCreateInput;
}) {
  const [quote] = await listMarketQuotes({
    session: input.session,
    symbols: input.order.symbol,
    includeStale: true,
    limit: 1
  });
  return {
    source: quote?.source ?? "manual",
    quote: quote
      ? {
          symbol: quote.symbol,
          market: quote.market,
          source: quote.source,
          last: quote.last,
          bid: quote.bid,
          ask: quote.ask,
          timestamp: quote.timestamp,
          ageMs: quote.ageMs,
          isStale: quote.isStale
        }
      : undefined,
    now: new Date().toISOString(),
    timeZone: "Asia/Taipei"
  };
}

export async function submitOrder(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  order: OrderCreateInput;
}): Promise<SubmitOrderResult> {
  const account = await buildAccountContext({
    session: input.session,
    order: input.order
  });
  const market = await resolveMarketContext({
    session: input.session,
    order: input.order
  });

  const riskCheck = await evaluateRiskCheck({
    session: input.session,
    repo: input.repo,
    payload: {
      order: input.order,
      account,
      market,
      commit: true
    }
  });

  if (riskCheck.decision === "block") {
    return { order: null, riskCheck, blocked: true };
  }

  const order = await placePaperOrder({
    session: input.session,
    order: input.order,
    riskCheckId: riskCheck.id
  });

  return { order, riskCheck, blocked: false };
}

export async function cancelOrder(input: {
  session: AppSession;
  payload: OrderCancelInput;
  accountId: string;
}): Promise<Order | null> {
  return cancelPaperOrder(input);
}
