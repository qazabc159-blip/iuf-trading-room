import {
  type AppSession,
  type Order,
  type OrderCancelInput,
  type OrderCreateInput,
  type RiskCheckResult,
  type SubmitOrderResult
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

import { evaluateRiskCheck } from "../risk-engine.js";
import { getMarketDataDecisionSummary } from "../market-data.js";
import {
  evaluateExecutionGate,
  gateDecisionLabel,
  modeForBroker
} from "./execution-gate.js";
import {
  cancelPaperOrder,
  getPaperBalance,
  listPaperOrders,
  listPaperPositions,
  placePaperOrder
} from "./paper-broker.js";

// Re-export so existing callers (routes, tests) keep the stable import path.
export type { SubmitOrderResult };

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
  const orders = await listPaperOrders(input.session, {
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
  const result = await getMarketDataDecisionSummary({
    session: input.session,
    symbols: input.order.symbol,
    includeStale: true,
    limit: 1
  });
  const item = result.items[0];
  const quote = item?.quote ?? null;
  return {
    source: item?.selectedSource ?? "manual",
    quote: quote
      ? {
          symbol: input.order.symbol,
          market: item?.market ?? "TWSE",
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

async function runRiskCheck(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  order: OrderCreateInput;
  commit: boolean;
}): Promise<RiskCheckResult> {
  const account = await buildAccountContext({
    session: input.session,
    order: input.order
  });
  const market = await resolveMarketContext({
    session: input.session,
    order: input.order
  });

  return evaluateRiskCheck({
    session: input.session,
    repo: input.repo,
    payload: {
      order: input.order,
      account,
      market,
      commit: input.commit
    }
  });
}

// Paper is the only broker wired right now. When KGI lands, route by
// input.order.accountId → account.broker lookup. For now everything is paper.
function resolveBrokerKind(_order: OrderCreateInput) {
  return "paper" as const;
}

export async function submitOrder(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  order: OrderCreateInput;
}): Promise<SubmitOrderResult> {
  const riskCheck = await runRiskCheck({ ...input, commit: true });

  if (riskCheck.decision === "block") {
    return { order: null, riskCheck, blocked: true, quoteGate: null };
  }

  const brokerKind = resolveBrokerKind(input.order);
  const quoteGate = await evaluateExecutionGate({
    session: input.session,
    order: input.order,
    mode: modeForBroker(brokerKind)
  });

  if (quoteGate.blocked) {
    // Server-side enforcement of the same matrix the UI shows. We do not
    // reach the broker layer, so there is no Order row created; the
    // riskCheck already persisted though, which is the audit trail.
    return { order: null, riskCheck, blocked: true, quoteGate };
  }

  const order = await placePaperOrder({
    session: input.session,
    order: input.order,
    riskCheckId: riskCheck.id,
    quoteGate
  });

  return { order, riskCheck, blocked: false, quoteGate };
}

// Dry-run: runs the same risk gate as submitOrder but skips broker.place.
// Uses commit:false so the duplicate-intent guard doesn't see the preview.
export async function previewOrder(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  order: OrderCreateInput;
}): Promise<SubmitOrderResult> {
  const riskCheck = await runRiskCheck({ ...input, commit: false });
  // Preview always runs the gate so the UI can see exactly why a submit
  // would have been blocked — but we don't short-circuit on gate.blocked
  // here, because preview *is* the diagnostic.
  const quoteGate = await evaluateExecutionGate({
    session: input.session,
    order: input.order,
    mode: modeForBroker(resolveBrokerKind(input.order))
  });
  const blocked = riskCheck.decision === "block" || quoteGate.blocked;
  return {
    order: null,
    riskCheck,
    blocked,
    quoteGate
  };
}

export async function cancelOrder(input: {
  session: AppSession;
  payload: OrderCancelInput;
  accountId: string;
}): Promise<Order | null> {
  return cancelPaperOrder(input);
}

// Exposed for tests / diagnostics so other modules can reason about the gate
// without importing the paper broker.
export { gateDecisionLabel };
