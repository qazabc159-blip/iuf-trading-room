import {
  type AppSession,
  type BrokerKind,
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
import { resolveBrokerKindForAccount } from "./broker-account-resolver.js";

// Re-export so existing callers (routes, tests) keep the stable import path.
export type { SubmitOrderResult };

// ---------------------------------------------------------------------------
// Hard guard — KGI write-side permanently locked for manual orders (Phase 3)
//
// This constant is the canonical enforcement point. When Phase 4 (real order)
// is approved, ONLY this function may be updated after Elva sign-off.
// ---------------------------------------------------------------------------
const KGI_MANUAL_ORDER_WRITE_LOCKED = true;

/**
 * assertKgiSimOnly — throws if a KGI manual order would reach the real write path.
 *
 * W6 No-Real-Order guard: KGI accounts on the manual trading path must NEVER
 * submit a live order. The KGI adapter's submitOrder() calls the real gateway
 * /order/create endpoint; we intercept here before the adapter is reached.
 *
 * To unlock: set KGI_MANUAL_ORDER_WRITE_LOCKED = false AND obtain Elva sign-off.
 */
function assertKgiSimOnly(context: string): void {
  if (KGI_MANUAL_ORDER_WRITE_LOCKED) {
    throw new Error(
      `[trading-service] KGI manual order write is locked (Phase 3 SIM-safe). ` +
      `Context: ${context}. Real KGI order submission requires Phase 4 unlock.`
    );
  }
}

// Build the account context the risk engine reads from.
// Routes by brokerKind:
//   - "paper": reads paper broker balance / positions / orders (original path)
//   - "kgi":   reads paper balance (KGI SIM has no balance endpoint) +
//              KGI SIM positions (read-only, no write). brokerConnected=false
//              indicates degraded context for risk engine awareness.
async function buildAccountContext(input: {
  session: AppSession;
  order: OrderCreateInput;
  brokerKind: BrokerKind;
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
  if (input.brokerKind === "kgi") {
    // KGI path: use paper balance as proxy (KGI SIM has no balance endpoint),
    // and KGI SIM positions for exposure calculation (read-only, safe).
    // brokerConnected=false signals to the risk engine that the context is
    // partially synthesised — risk engine treats this conservatively.
    const balance = await getPaperBalance(input.session, input.order.accountId).catch(() => ({
      equity: 0,
      availableCash: 0,
      realizedPnlToday: 0
    }));
    const equity = (balance.equity ?? 0) > 0 ? balance.equity : 1;
    const realizedPnlTodayPct = ((balance.realizedPnlToday ?? 0) / equity) * 100;

    // Attempt to read KGI SIM positions for live exposure — fail-safe to empty
    let kgiPositions: Array<{ symbol: string; marketValue?: number | null }> = [];
    try {
      const { KgiBrokerAdapter } = await import("./kgi-broker-adapter.js");
      const config = { gatewayBaseUrl: process.env["KGI_GATEWAY_URL"] ?? "http://127.0.0.1:8787" };
      const adapter = new KgiBrokerAdapter(config);
      const raw = await adapter.getPositions();
      kgiPositions = raw.map((p) => ({
        symbol: p.symbol,
        marketValue: p.lastPrice * p.qty
      }));
    } catch {
      // KGI gateway unreachable — proceed with no positions (conservative)
    }

    const grossExposure = kgiPositions.reduce(
      (acc, p) => acc + Math.abs(p.marketValue ?? 0),
      0
    );
    const symbolPos = kgiPositions.find((p) => p.symbol === input.order.symbol);
    const symbolPosPct = symbolPos
      ? (Math.abs(symbolPos.marketValue ?? 0) / equity) * 100
      : 0;

    return {
      equity,
      availableCash: balance.availableCash ?? 0,
      realizedPnlTodayPct,
      openOrders: 0, // KGI SIM open order count not available without live poll
      grossExposurePct: (grossExposure / equity) * 100,
      symbolPositionPct: symbolPosPct,
      themeExposurePct: symbolPosPct,
      brokerConnected: false // degraded — KGI balance not available via gateway
    };
  }

  // Default paper path (original implementation)
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
  brokerKind: BrokerKind;
}): Promise<RiskCheckResult> {
  const account = await buildAccountContext({
    session: input.session,
    order: input.order,
    brokerKind: input.brokerKind
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

/**
 * resolveBrokerKind — maps order.accountId → brokerKind via broker_accounts DB lookup.
 *
 * Replaces the previous hard-coded "paper" return. Falls back to "paper" on any
 * failure so the paper path is never accidentally broken.
 *
 * Lookup: broker_accounts WHERE id = accountId AND workspace_id AND is_active = TRUE
 * → adapterKey → BrokerKind
 */
async function resolveBrokerKind(
  order: OrderCreateInput,
  workspaceId: string | undefined | null
): Promise<BrokerKind> {
  return resolveBrokerKindForAccount(order.accountId, workspaceId);
}

export async function submitOrder(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  order: OrderCreateInput;
}): Promise<SubmitOrderResult> {
  const workspaceId = (input.session.workspace as { id?: string } | undefined)?.id ?? null;
  const brokerKind = await resolveBrokerKind(input.order, workspaceId);

  // W6 No-Real-Order hard guard — KGI manual order write is locked in Phase 3.
  // assertKgiSimOnly throws if the write-locked flag is active, preventing
  // any KGI submit from reaching the broker adapter.
  if (brokerKind === "kgi") {
    assertKgiSimOnly("submitOrder");
    // assertKgiSimOnly throws unconditionally while KGI_MANUAL_ORDER_WRITE_LOCKED=true.
    // The line below is unreachable in Phase 3 but left for Phase 4 clarity.
    return { order: null, riskCheck: null as unknown as RiskCheckResult, blocked: true, quoteGate: null };
  }

  const riskCheck = await runRiskCheck({ ...input, commit: true, brokerKind });

  if (riskCheck.decision === "block") {
    return { order: null, riskCheck, blocked: true, quoteGate: null };
  }

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

  // Paper path — the only write path allowed in Phase 3.
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
// For KGI accounts in Phase 3: runs risk+gate pipeline (read-only) but
// returns blocked=true with reason "kgi_manual_write_locked" instead of
// placing any order. This lets the UI display a meaningful diagnostic.
export async function previewOrder(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  order: OrderCreateInput;
}): Promise<SubmitOrderResult> {
  const workspaceId = (input.session.workspace as { id?: string } | undefined)?.id ?? null;
  const brokerKind = await resolveBrokerKind(input.order, workspaceId);

  const riskCheck = await runRiskCheck({ ...input, commit: false, brokerKind });
  // Preview always runs the gate so the UI can see exactly why a submit
  // would have been blocked — but we don't short-circuit on gate.blocked
  // here, because preview *is* the diagnostic.
  const quoteGate = await evaluateExecutionGate({
    session: input.session,
    order: input.order,
    mode: modeForBroker(brokerKind)
  });

  // KGI accounts: blocked in Phase 3 — real order write permanently locked.
  // Return blocked:true so the UI can display "KGI order not yet available".
  if (brokerKind === "kgi") {
    return {
      order: null,
      riskCheck,
      blocked: true,
      quoteGate: {
        ...quoteGate,
        blocked: true,
        decision: "block",
        reasons: ["kgi_manual_write_locked", ...quoteGate.reasons]
      }
    };
  }

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
