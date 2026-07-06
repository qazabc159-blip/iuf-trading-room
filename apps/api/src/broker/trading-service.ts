import {
  type AppSession,
  type BrokerKind,
  type ExecutionQuoteContext,
  type KgiChannelUnavailableReason,
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
import { resolveKgiEnv } from "./kgi-sim-env.js";
import type { UnifiedOrderInput } from "./broker-adapter.js";
import type { UnifiedOrderRecord } from "./unified-order-store.js";

// Re-export so existing callers (routes, tests) keep the stable import path.
export type { SubmitOrderResult };

// ---------------------------------------------------------------------------
// KGI SIM channel guard (統一下單流 D2, 2026-07-04)
//
// Replaces the Phase 3 unconditional write-lock guard function. The KGI
// write path is now open ONLY when KGI_ENV=sim; every other case throws
// KgiChannelUnavailableError, which the /trading/orders route turns into a
// structured 409 { error: "kgi_channel_unavailable", reason }. Gateway-side
// session verification (login/account-set) is NOT re-implemented here — that
// stays the gateway's job (L4 Gate2 in app.py, W6-audited, untouched).
// ---------------------------------------------------------------------------

export class KgiChannelUnavailableError extends Error {
  readonly reason: KgiChannelUnavailableReason;
  constructor(reason: KgiChannelUnavailableReason, message?: string) {
    super(message ?? `KGI SIM channel unavailable: ${reason}`);
    this.name = "KgiChannelUnavailableError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Fubon channel guard (統一下單流 D2 — fubon branch, fixed 2026-07-06)
//
// UTA-C3 (#1172) self-reported a correctness gap: adapterKeyToBrokerKind
// temporarily mapped "fubon" → "paper" because BrokerKind had no "fubon"
// literal yet. Now that the contract has the literal (broker.ts), a fubon-
// routed order must never fall through to the paper channel — D2 says it
// must be rejected with a structured channel_coming_soon response before
// touching risk/gate/unified-orders/paper matching. FubonBrokerAdapter's own
// write path is separately hard-locked (FUBON_ORDER_WRITE_LOCKED=true); this
// guard is the trading-service-level equivalent for the unified pipeline.
// ---------------------------------------------------------------------------

export class FubonChannelComingSoonError extends Error {
  readonly broker = "fubon" as const;
  constructor(message?: string) {
    super(message ?? "Fubon channel is not yet available (channel_coming_soon).");
    this.name = "FubonChannelComingSoonError";
  }
}

/**
 * assertFubonChannelAvailable — always throws. The fubon adapter has no live
 * channel yet (Stage 2, per FUBON_ADAPTER_INTERFACE_FREEZE_v1.md §4); every
 * fubon-routed order must be rejected with channel_coming_soon.
 */
export function assertFubonChannelAvailable(): void {
  throw new FubonChannelComingSoonError();
}

/**
 * assertKgiSimChannel — pre-flight checks ported from the standalone
 * POST /api/v1/kgi/sim/order route (server.ts), minus the Owner-role gate
 * (the unified pipeline already enforces account ownership via
 * resolveBrokerKindForAccount's workspace-scoped lookup).
 *
 *   ① resolveKgiEnv() === "sim" (kgi-sim-env.ts — existing function, not
 *      re-implemented)
 *   ② order-shape checks the old route's body schema enforced implicitly
 *      (market/limit only; limit requires a price)
 *   ③ gateway-side sim session verification is intentionally NOT done here
 */
export function assertKgiSimChannel(order: OrderCreateInput): void {
  const env = resolveKgiEnv();
  if (env !== "sim") {
    throw new KgiChannelUnavailableError(
      "not_sim_env",
      `KGI_ENV=${env}. Unified order flow only submits to KGI when KGI_ENV=sim.`
    );
  }
  if (order.type === "stop" || order.type === "stop_limit") {
    throw new KgiChannelUnavailableError(
      "unsupported_order_type",
      `KGI SIM channel does not support order type "${order.type}".`
    );
  }
  if (order.type === "limit" && (order.price == null || order.price <= 0)) {
    throw new KgiChannelUnavailableError(
      "missing_limit_price",
      "限價單需要填入有效的委託價格。"
    );
  }
}

/** Maps a KgiGatewayClient error (thrown by KgiBrokerAdapter.submitOrder) to a reason code. */
async function mapKgiSubmitError(err: unknown): Promise<KgiChannelUnavailableError> {
  const {
    KgiGatewayAuthError,
    KgiGatewayUnreachableError,
    KgiGatewayNotEnabledError,
    KgiGatewayValidationError,
    KgiGatewayUpstreamError
  } = await import("./kgi-gateway-client.js");

  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof KgiGatewayUnreachableError) {
    return new KgiChannelUnavailableError("gateway_unreachable", message);
  }
  if (err instanceof KgiGatewayAuthError) {
    return new KgiChannelUnavailableError("gateway_auth_error", message);
  }
  if (err instanceof KgiGatewayNotEnabledError) {
    if (message.includes("[NOT_LOGGED_IN]")) {
      return new KgiChannelUnavailableError("gateway_not_logged_in", message);
    }
    if (message.includes("[LIVE_ORDER_BLOCKED]")) {
      return new KgiChannelUnavailableError("live_order_blocked", message);
    }
    return new KgiChannelUnavailableError("order_not_enabled", message);
  }
  if (err instanceof KgiGatewayValidationError) {
    return new KgiChannelUnavailableError("order_validation_rejected", message);
  }
  if (err instanceof KgiGatewayUpstreamError) {
    return new KgiChannelUnavailableError("order_upstream_error", message);
  }
  return new KgiChannelUnavailableError("unknown_error", message);
}

// ---------------------------------------------------------------------------
// unified_orders dual-write (統一下單流 D3, 2026-07-04)
//
// Every submitted order (paper AND kgi) gets one unified_orders row, written
// pending-first — BEFORE the channel call — so there is never a state where
// an order reached the broker but has no audit row. If the update-after-
// submit call fails, the row is left "pending" on purpose (never auto-
// resubmitted); that is a reconciliation-sweep concern, not this function's.
// ---------------------------------------------------------------------------

function toUnifiedOrderInput(order: OrderCreateInput): UnifiedOrderInput {
  return {
    symbol: order.symbol,
    action: order.side === "buy" ? "Buy" : "Sell",
    qty: order.quantity,
    quantityUnit: order.quantity_unit,
    priceType: order.type === "market" ? "Market" : "Limit",
    limitPrice: order.price ?? undefined,
    orderCond: "Cash",
    oddLot: order.quantity_unit === "SHARE",
    idempotencyKey: order.clientOrderId
  };
}

async function recordUnifiedOrder(params: {
  workspaceId: string;
  adapterKey: "kgi" | "paper";
  input: UnifiedOrderInput;
  actorId: string | null;
}): Promise<UnifiedOrderRecord> {
  const { createUnifiedOrder } = await import("./unified-order-store.js");
  // Insert failure propagates to the caller — the whole submit is aborted,
  // no channel call is made. This is the "insert 失敗=整筆中止不送單" invariant.
  return createUnifiedOrder(params.workspaceId, params.adapterKey, params.input, params.actorId);
}

async function markUnifiedOrderSubmitted(
  recordId: string,
  externalOrderId: string,
  response: unknown
): Promise<void> {
  try {
    const { updateUnifiedOrderSubmitted } = await import("./unified-order-store.js");
    await updateUnifiedOrderSubmitted(recordId, externalOrderId, response);
  } catch (err) {
    console.error(
      `[trading-service] unified_orders update-to-submitted failed for ${recordId}; ` +
      `row remains pending — requires reconciliation sweep.`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function markUnifiedOrderRejected(recordId: string, response: unknown): Promise<void> {
  try {
    const { updateUnifiedOrderRejected } = await import("./unified-order-store.js");
    await updateUnifiedOrderRejected(recordId, response);
  } catch (err) {
    console.error(
      `[trading-service] unified_orders update-to-rejected failed for ${recordId}; ` +
      `row remains pending — requires reconciliation sweep.`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** Builds the SubmitOrderResult.order for the KGI channel from the unified_orders record. */
function unifiedRecordToOrder(params: {
  record: UnifiedOrderRecord;
  order: OrderCreateInput;
  riskCheckId: string;
  quoteContext: ExecutionQuoteContext | null;
  externalOrderId: string;
}): Order {
  const now = new Date().toISOString();
  return {
    id: params.record.id,
    clientOrderId: params.order.clientOrderId ?? params.record.id,
    brokerOrderId: params.externalOrderId,
    accountId: params.order.accountId,
    broker: "kgi",
    symbol: params.order.symbol,
    side: params.order.side,
    type: params.order.type,
    timeInForce: params.order.timeInForce,
    quantity: params.order.quantity,
    filledQuantity: 0,
    price: params.order.price,
    stopPrice: params.order.stopPrice,
    avgFillPrice: null,
    status: "submitted",
    reason: null,
    tradePlanId: params.order.tradePlanId,
    strategyId: params.order.strategyId,
    riskCheckId: params.riskCheckId,
    submittedAt: now,
    acknowledgedAt: null,
    filledAt: null,
    canceledAt: null,
    quoteContext: params.quoteContext,
    createdAt: params.record.createdAt,
    updatedAt: now
  };
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
      // brokerConnected feeds risk-engine's non-overridable "broker_disconnected"
      // guard (統一下單流 D2, 2026-07-04). Before D2, this value was moot — the
      // Phase-3 write-lock guard hard-blocked every kgi submit before
      // buildAccountContext could gate anything. Now that the SIM channel can
      // actually submit,
      // "connected" must mean "the write channel resolveKgiEnv() will actually
      // route through" — mirrors the same check assertKgiSimChannel() runs, so
      // the risk engine and the channel guard never disagree. Balance itself is
      // still a paper-balance proxy (KGI SIM has no balance endpoint); that is
      // a separate, orthogonal degradation already reflected by equity being 1
      // when balance.equity is unset.
      brokerConnected: resolveKgiEnv() === "sim"
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
  /**
   * TEST ONLY — bypasses resolveBrokerKindForAccount's DB lookup.
   * CI (`node --test`) runs in memory persistence mode with no Postgres
   * service, so resolveBrokerKindForAccount() always returns "paper"
   * (see broker-account-resolver.ts's isDatabaseMode() guard). This override
   * is the only way to exercise the "kgi" branch end-to-end in this
   * environment. Named _test-prefixed to match the codebase's existing
   * test-hook convention (_resetKgiSimState, _resetUnifiedOrderStoreForTests,
   * _resetDailySmokeHistory). No HTTP route reads or forwards this field.
   */
  _testBrokerKindOverride?: BrokerKind;
}): Promise<SubmitOrderResult> {
  const workspaceId = (input.session.workspace as { id?: string } | undefined)?.id ?? null;
  const brokerKind = input._testBrokerKindOverride ?? await resolveBrokerKind(input.order, workspaceId);

  // KGI SIM channel guard (統一下單流 D2) — throws KgiChannelUnavailableError
  // when KGI_ENV != sim or the order shape is unsupported by the SIM channel.
  // Runs before risk/gate so an unavailable channel fails fast.
  if (brokerKind === "kgi") {
    assertKgiSimChannel(input.order);
  }

  // Fubon channel guard (統一下單流 D2 fubon branch, fixed 2026-07-06) — always
  // throws FubonChannelComingSoonError. Runs before risk/gate/unified-orders so
  // a fubon-routed order never writes a pending row and never reaches the
  // paper matching path below (no risk check, no dual-write, no broker call).
  if (brokerKind === "fubon") {
    assertFubonChannelAvailable();
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

  // D3 pending-first dual-write — unified_orders row exists BEFORE the
  // channel call, for both paper and kgi. Insert failure aborts the submit;
  // no channel call happens without an audit row first.
  if (!workspaceId) {
    throw new Error(
      "[trading-service] workspace not resolved — cannot record unified order (pending-first invariant)"
    );
  }
  const actorId = (input.session.user as { id?: string } | undefined)?.id ?? null;
  const unifiedInput = toUnifiedOrderInput(input.order);
  const record = await recordUnifiedOrder({
    workspaceId,
    adapterKey: brokerKind === "kgi" ? "kgi" : "paper",
    input: unifiedInput,
    actorId
  });

  if (brokerKind === "kgi") {
    try {
      const { KgiBrokerAdapter } = await import("./kgi-broker-adapter.js");
      const adapter = new KgiBrokerAdapter({
        gatewayBaseUrl: process.env["KGI_GATEWAY_URL"] ?? "http://127.0.0.1:8787"
      });
      const submitResult = await adapter.submitOrder(unifiedInput);
      await markUnifiedOrderSubmitted(record.id, submitResult.externalOrderId, submitResult);
      const order = unifiedRecordToOrder({
        record,
        order: input.order,
        riskCheckId: riskCheck.id,
        quoteContext: quoteGate.quoteContext,
        externalOrderId: submitResult.externalOrderId
      });
      return { order, riskCheck, blocked: false, quoteGate };
    } catch (err) {
      await markUnifiedOrderRejected(record.id, { error: err instanceof Error ? err.message : String(err) });
      throw await mapKgiSubmitError(err);
    }
  }

  // Paper path. Mirrors the kgi branch's dual-write failure handling: if
  // placePaperOrder throws, the pending-first unified_orders row must not be
  // left stuck at "pending" forever — mark it rejected and rethrow so the
  // caller still sees the original error (Pete review, PR #1164).
  try {
    const order = await placePaperOrder({
      session: input.session,
      order: input.order,
      riskCheckId: riskCheck.id,
      quoteGate
    });
    await markUnifiedOrderSubmitted(record.id, order.brokerOrderId ?? order.id, order);
    return { order, riskCheck, blocked: false, quoteGate };
  } catch (err) {
    await markUnifiedOrderRejected(record.id, { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// Dry-run: runs the same risk gate as submitOrder but skips broker.place.
// Uses commit:false so the duplicate-intent guard doesn't see the preview.
// For KGI accounts: runs risk+gate pipeline (read-only) and additionally
// runs the same assertKgiSimChannel pre-flight submitOrder would run, so
// preview and submit never disagree about channel availability. This never
// calls the broker adapter — no side effects, no gateway session touched.
export async function previewOrder(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  order: OrderCreateInput;
  _testBrokerKindOverride?: BrokerKind; // TEST ONLY — see submitOrder() jsdoc.
}): Promise<SubmitOrderResult> {
  const workspaceId = (input.session.workspace as { id?: string } | undefined)?.id ?? null;
  const brokerKind = input._testBrokerKindOverride ?? await resolveBrokerKind(input.order, workspaceId);

  const riskCheck = await runRiskCheck({ ...input, commit: false, brokerKind });
  // Preview always runs the gate so the UI can see exactly why a submit
  // would have been blocked — but we don't short-circuit on gate.blocked
  // here, because preview *is* the diagnostic.
  const quoteGate = await evaluateExecutionGate({
    session: input.session,
    order: input.order,
    mode: modeForBroker(brokerKind)
  });

  if (brokerKind === "kgi") {
    try {
      assertKgiSimChannel(input.order);
    } catch (err) {
      const reason = err instanceof KgiChannelUnavailableError ? err.reason : "unknown_error";
      return {
        order: null,
        riskCheck,
        blocked: true,
        quoteGate: {
          ...quoteGate,
          blocked: true,
          decision: "block",
          reasons: [`kgi_channel_unavailable:${reason}`, ...quoteGate.reasons]
        }
      };
    }
  }

  // Fubon channel guard (統一下單流 D2 fubon branch, fixed 2026-07-06) — preview
  // always reports channel_coming_soon rather than falling through to the
  // paper-context risk/gate result below. Never calls the broker adapter.
  if (brokerKind === "fubon") {
    return {
      order: null,
      riskCheck,
      blocked: true,
      quoteGate: {
        ...quoteGate,
        blocked: true,
        decision: "block",
        reasons: ["channel_coming_soon:fubon", ...quoteGate.reasons]
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
