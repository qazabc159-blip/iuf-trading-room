import { randomUUID } from "node:crypto";
import {
  type AppSession,
  type Balance,
  type BrokerAccount,
  type BrokerConnectionStatus,
  type ExecutionEvent,
  type ExecutionQuoteContext,
  type Fill,
  type MarketDataDecisionQuoteSnapshot,
  type MarketDataDecisionSummaryItem,
  type Order,
  type OrderCancelInput,
  type OrderCreateInput,
  type OrderStatus,
  type Position,
  type Quote
} from "@iuf-trading-room/contracts";

import { getMarketDataDecisionSummary } from "../market-data.js";
import { appendExecutionEvent } from "./execution-events-store.js";
import type { ExecutionGateResult } from "./execution-gate.js";
import {
  loadWorkspaceSnapshots,
  type PaperAccountSnapshot,
  saveAccountSnapshot
} from "./paper-broker-store.js";

// Paper broker keeps state in-memory per workspace for hot-path mutations and
// snapshots the full account state to paper_broker_state after every write
// (when persistenceMode=database) so a process restart can rehydrate without
// losing cash, positions, orders, or fills.

const DEFAULT_ACCOUNT_ID = "paper-default";
const DEFAULT_ACCOUNT_NAME = "Paper Trading";
const DEFAULT_ACCOUNT_NO = "PAPER-000001";
const DEFAULT_INITIAL_CASH = 10_000_000;

// TWSE retail approximation. Paper-only bookkeeping — no enforcement.
const PAPER_FEE_RATE = 0.001425;
const PAPER_SELL_TAX_RATE = 0.003;

type PaperAccountState = {
  account: BrokerAccount;
  cash: number;
  // symbol -> { qty (signed), avgPrice, openedAt }
  positions: Map<string, { quantity: number; avgPrice: number; openedAt: string }>;
  orders: Map<string, Order>;
  fills: Fill[];
  realizedPnlToday: number;
  lastEventAt: string | null;
  createdAt: string;
};

type WorkspaceState = Map<string, PaperAccountState>;

const workspaces = new Map<string, WorkspaceState>();
const subscribers = new Map<string, Set<(event: ExecutionEvent) => void>>();
const hydrationPromises = new Map<string, Promise<void>>();

function workspaceKey(session: AppSession): string {
  return session.workspace.slug;
}

function snapshotToState(snapshot: PaperAccountSnapshot): PaperAccountState {
  const positions = new Map<
    string,
    { quantity: number; avgPrice: number; openedAt: string }
  >();
  for (const p of snapshot.positions) {
    positions.set(p.symbol, {
      quantity: p.quantity,
      avgPrice: p.avgPrice,
      openedAt: p.openedAt
    });
  }
  const orders = new Map<string, Order>();
  for (const o of snapshot.orders) orders.set(o.id, o);
  return {
    account: snapshot.account,
    cash: snapshot.cash,
    positions,
    orders,
    fills: snapshot.fills,
    realizedPnlToday: snapshot.realizedPnlToday,
    lastEventAt: snapshot.lastEventAt,
    createdAt: snapshot.createdAt
  };
}

function stateToSnapshot(state: PaperAccountState): PaperAccountSnapshot {
  return {
    account: state.account,
    cash: state.cash,
    positions: [...state.positions.entries()].map(([symbol, p]) => ({
      symbol,
      quantity: p.quantity,
      avgPrice: p.avgPrice,
      openedAt: p.openedAt
    })),
    orders: [...state.orders.values()],
    fills: state.fills,
    realizedPnlToday: state.realizedPnlToday,
    lastEventAt: state.lastEventAt,
    createdAt: state.createdAt
  };
}

function persistAccountAsync(session: AppSession, state: PaperAccountState): void {
  // Fire-and-forget: persistence shouldn't block the hot path. A failed save
  // is logged but the in-memory state remains authoritative for the process
  // lifetime; the next successful write will catch up.
  saveAccountSnapshot(session, state.account.id, stateToSnapshot(state)).catch(
    (err) => {
      console.error(
        `[paper-broker] failed to persist account ${state.account.id}:`,
        err
      );
    }
  );
}

async function ensureWorkspaceHydrated(session: AppSession): Promise<WorkspaceState> {
  const key = workspaceKey(session);
  let ws = workspaces.get(key);
  if (ws) return ws;

  let pending = hydrationPromises.get(key);
  if (!pending) {
    pending = (async () => {
      const snapshots = await loadWorkspaceSnapshots(session);
      const restored: WorkspaceState = new Map();
      for (const [accountId, snapshot] of snapshots.entries()) {
        restored.set(accountId, snapshotToState(snapshot));
      }
      workspaces.set(key, restored);
    })();
    hydrationPromises.set(key, pending);
  }

  try {
    await pending;
  } finally {
    hydrationPromises.delete(key);
  }

  ws = workspaces.get(key);
  if (!ws) {
    ws = new Map();
    workspaces.set(key, ws);
  }
  return ws;
}

function bootstrapAccount(): PaperAccountState {
  const now = new Date().toISOString();
  const initialCashRaw = Number(process.env.PAPER_BROKER_INITIAL_CASH);
  const initialCash =
    Number.isFinite(initialCashRaw) && initialCashRaw > 0
      ? initialCashRaw
      : DEFAULT_INITIAL_CASH;

  return {
    account: {
      id: DEFAULT_ACCOUNT_ID,
      broker: "paper",
      accountNo: DEFAULT_ACCOUNT_NO,
      accountName: DEFAULT_ACCOUNT_NAME,
      currency: "TWD",
      isActive: true,
      isPaper: true,
      connectedAt: now
    },
    cash: initialCash,
    positions: new Map(),
    orders: new Map(),
    fills: [],
    realizedPnlToday: 0,
    lastEventAt: null,
    createdAt: now
  };
}

async function getOrCreateAccount(
  session: AppSession,
  accountId: string
): Promise<PaperAccountState> {
  const ws = await ensureWorkspaceHydrated(session);
  let state = ws.get(accountId);
  if (!state) {
    state = bootstrapAccount();
    // If caller asked for a different accountId, rename the bootstrap account
    // so it actually matches what they requested (keeps id/accountNo in sync).
    if (accountId !== DEFAULT_ACCOUNT_ID) {
      state.account = {
        ...state.account,
        id: accountId,
        accountNo: accountId.toUpperCase()
      };
    }
    ws.set(accountId, state);
    persistAccountAsync(session, state);
  }
  return state;
}

export async function listPaperAccounts(session: AppSession): Promise<BrokerAccount[]> {
  const ws = await ensureWorkspaceHydrated(session);
  if (ws.size === 0) {
    // Always surface the default so the UI has something to bind to.
    const state = await getOrCreateAccount(session, DEFAULT_ACCOUNT_ID);
    return [state.account];
  }
  return [...ws.values()].map((s) => s.account);
}

// Valuation path: marks positions with whatever the source-policy selects,
// even when readiness is degraded. The UI banner already surfaces the feed
// state separately, so we still want a price here for P/L display.
async function getLatestQuote(
  session: AppSession,
  symbol: string
): Promise<Quote | null> {
  const result = await getMarketDataDecisionSummary({
    session,
    symbols: symbol,
    includeStale: true,
    limit: 1
  });
  const item = result.items[0];
  const quote = item?.quote ?? null;
  if (!quote) return null;
  return {
    symbol,
    market: item?.market ?? "TWSE",
    source: quote.source,
    last: quote.last,
    bid: quote.bid,
    ask: quote.ask,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: null,
    changePct: null,
    timestamp: quote.timestamp,
    ageMs: quote.ageMs,
    isStale: quote.isStale
  };
}

// Execution path: extra info so placePaperOrder can reject unsafe fills
// instead of silently filling against a stale or synthetic quote. The full
// item is returned so callers can both (a) gate on paperUsable and (b)
// annotate execution events with quote context for the timeline.
type ExecutionQuote = {
  item: MarketDataDecisionSummaryItem | null;
  quote: MarketDataDecisionQuoteSnapshot | null;
  primaryReason: string;
  paperUsable: boolean;
  paperSafe: boolean;
  executionUsable: boolean;
  executionSafe: boolean;
  reasons: string[];
  source: string | null;
  readiness: string;
  freshnessStatus: string;
  fallbackReason: string;
  staleReason: string;
  providerConnected: boolean;
};

function executionQuoteFromDecisionItem(
  item: MarketDataDecisionSummaryItem
): ExecutionQuote {
  return {
    item,
    quote: item.quote,
    primaryReason: item.primaryReason,
    paperUsable: item.paper.usable,
    paperSafe: item.paper.safe,
    executionUsable: item.execution.usable,
    executionSafe: item.execution.safe,
    reasons:
      item.primaryReason && !item.reasons.includes(item.primaryReason)
        ? [item.primaryReason, ...item.reasons]
        : item.reasons,
    source: item.selectedSource,
    readiness: item.readiness,
    freshnessStatus: item.freshnessStatus,
    fallbackReason: item.fallbackReason,
    staleReason: item.staleReason,
    providerConnected: item.selectedSource !== null && item.quote !== null
  };
}

async function getExecutionQuote(
  session: AppSession,
  symbol: string
): Promise<ExecutionQuote> {
  const result = await getMarketDataDecisionSummary({
    session,
    symbols: symbol,
    includeStale: true,
    limit: 1
  });
  const item = result.items[0];
  if (!item) {
    return {
      item: null,
      quote: null,
      primaryReason: "no_quote",
      paperUsable: false,
      paperSafe: false,
      executionUsable: false,
      executionSafe: false,
      reasons: ["no_quote"],
      source: null,
      readiness: "blocked",
      freshnessStatus: "missing",
      fallbackReason: "no_quote",
      staleReason: "no_quote",
      providerConnected: false
    };
  }
  return executionQuoteFromDecisionItem(item);
}

// Serializable quote-context blob we attach to execution event payloads so the
// UI timeline can reconstruct what the quote feed looked like at order time.
// When the caller already resolved the consumer-summary verdict (via the
// execution-gate helper), we prefer that exact snapshot so the event, the
// Order row, and the server-side gate match byte-for-byte.
function quoteContextFor(
  execQuote: ExecutionQuote,
  mode: "paper" | "execution",
  now: string
): ExecutionQuoteContext {
  const decision =
    mode === "paper"
      ? execQuote.paperSafe
        ? execQuote.paperUsable
          ? "allow"
          : "review"
        : "block"
      : execQuote.executionSafe
        ? execQuote.executionUsable
          ? "allow"
          : "review"
        : "block";
  return {
    mode,
    decision,
    source: execQuote.source,
    readiness: execQuote.readiness as ExecutionQuoteContext["readiness"],
    freshnessStatus: execQuote.freshnessStatus as ExecutionQuoteContext["freshnessStatus"],
    paperUsable: execQuote.paperUsable,
    // Paper broker never issues live-eligible quotes; the mode selector in
    // front of us already decided this path.
    liveUsable: false,
    providerConnected: execQuote.providerConnected,
    fallbackReason: execQuote.fallbackReason,
    staleReason: execQuote.staleReason,
    reasons: execQuote.primaryReason && !execQuote.reasons.includes(execQuote.primaryReason)
      ? [execQuote.primaryReason, ...execQuote.reasons]
      : execQuote.reasons,
    last: execQuote.quote?.last ?? null,
    bid: execQuote.quote?.bid ?? null,
    ask: execQuote.quote?.ask ?? null,
    capturedAt: execQuote.quote?.timestamp ?? now
  };
}

function quoteDecisionPayload(
  execQuote: ExecutionQuote,
  mode: "paper" | "execution"
) {
  const modeSummary =
    mode === "paper"
      ? {
          decision: execQuote.paperSafe
            ? execQuote.paperUsable
              ? "allow"
              : "review"
            : "block",
          usable: execQuote.paperUsable,
          safe: execQuote.paperSafe
        }
      : {
          decision: execQuote.executionSafe
            ? execQuote.executionUsable
              ? "allow"
              : "review"
            : "block",
          usable: execQuote.executionUsable,
          safe: execQuote.executionSafe
        };

  return {
    selectedSource: execQuote.source,
    readiness: execQuote.readiness,
    freshnessStatus: execQuote.freshnessStatus,
    fallbackReason: execQuote.fallbackReason,
    staleReason: execQuote.staleReason,
    primaryReason: execQuote.primaryReason,
    reasons: execQuote.reasons,
    quoteTimestamp: execQuote.quote?.timestamp ?? null,
    quoteAgeMs: execQuote.quote?.ageMs ?? null,
    quote: execQuote.quote
      ? {
          source: execQuote.quote.source,
          last: execQuote.quote.last,
          bid: execQuote.quote.bid,
          ask: execQuote.quote.ask,
          timestamp: execQuote.quote.timestamp,
          ageMs: execQuote.quote.ageMs,
          isStale: execQuote.quote.isStale
        }
      : null,
    [mode]: modeSummary
  };
}

function refPriceForFill(
  order: OrderCreateInput,
  quote:
    | Pick<
        Quote,
        "last" | "bid" | "ask"
      >
    | MarketDataDecisionQuoteSnapshot
    | null
): number | null {
  if (quote) {
    if (order.side === "buy") {
      return quote.ask ?? quote.last ?? quote.bid ?? null;
    }
    return quote.bid ?? quote.last ?? quote.ask ?? null;
  }
  // Fallback: use the submitted limit/stop price so paper order placement
  // stays functional in dev environments with no quotes at all.
  return order.price ?? order.stopPrice ?? null;
}

function shouldLimitFill(
  order: OrderCreateInput,
  markPrice: number | null
): boolean {
  if (!markPrice || !order.price) return false;
  if (order.side === "buy") return markPrice <= order.price;
  return markPrice >= order.price;
}

function applyFillToPosition(
  state: PaperAccountState,
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  timestamp: string
): number {
  const existing = state.positions.get(symbol);
  const signedQty = side === "buy" ? quantity : -quantity;

  if (!existing) {
    if (signedQty === 0) return 0;
    state.positions.set(symbol, {
      quantity: signedQty,
      avgPrice: price,
      openedAt: timestamp
    });
    return 0;
  }

  const sameDirection = Math.sign(existing.quantity) === Math.sign(signedQty);
  if (sameDirection || existing.quantity === 0) {
    const newQty = existing.quantity + signedQty;
    const newAvg =
      newQty === 0
        ? 0
        : (existing.avgPrice * existing.quantity + price * signedQty) / newQty;
    state.positions.set(symbol, {
      quantity: newQty,
      avgPrice: Math.abs(newAvg),
      openedAt: existing.openedAt
    });
    return 0;
  }

  // Closing or flipping. Realize PnL on the closed portion.
  const closingQty = Math.min(Math.abs(signedQty), Math.abs(existing.quantity));
  const direction = Math.sign(existing.quantity);
  const realized = (price - existing.avgPrice) * direction * closingQty;

  const remaining = existing.quantity + signedQty;
  if (remaining === 0) {
    state.positions.delete(symbol);
  } else if (Math.sign(remaining) === Math.sign(existing.quantity)) {
    state.positions.set(symbol, {
      ...existing,
      quantity: remaining
    });
  } else {
    // Flipped. Fresh position at fill price.
    state.positions.set(symbol, {
      quantity: remaining,
      avgPrice: price,
      openedAt: timestamp
    });
  }

  return realized;
}

function emit(session: AppSession, accountId: string, event: ExecutionEvent): void {
  // Persist before broadcasting so a subscriber that immediately re-fetches
  // history will see this event. Fire-and-forget keeps broker hot path sync;
  // a failed write is logged but the in-memory subscribers still receive it.
  appendExecutionEvent(session, accountId, event).catch((err) => {
    console.error(
      `[paper-broker] failed to persist execution event for order ${event.orderId}:`,
      err
    );
  });

  const key = workspaceKey(session);
  const listeners = subscribers.get(key);
  if (!listeners) return;
  for (const cb of listeners) {
    try {
      cb(event);
    } catch (err) {
      console.error("[paper-broker] subscriber threw:", err);
    }
  }
}

export function subscribeExecutionEvents(
  session: AppSession,
  listener: (event: ExecutionEvent) => void
): () => void {
  const key = workspaceKey(session);
  let listeners = subscribers.get(key);
  if (!listeners) {
    listeners = new Set();
    subscribers.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
  };
}

export async function placePaperOrder(input: {
  session: AppSession;
  order: OrderCreateInput;
  riskCheckId: string | null;
  // When present, we skip the broker-local quote fetch and reuse the
  // server-side gate's verdict. Keeps the Order.quoteContext, the submit
  // event, and the gate's verdict in lockstep.
  quoteGate?: ExecutionGateResult;
}): Promise<Order> {
  const state = await getOrCreateAccount(input.session, input.order.accountId);
  const now = new Date().toISOString();
  const orderId = randomUUID();
  const clientOrderId = input.order.clientOrderId ?? `po-${randomUUID()}`;
  const execQuote =
    input.quoteGate?.item
      ? executionQuoteFromDecisionItem(input.quoteGate.item)
      : await getExecutionQuote(input.session, input.order.symbol);
  const markPrice = refPriceForFill(input.order, execQuote.quote);
  const quoteDecision = quoteDecisionPayload(execQuote, "paper");

  // Prefer the gate's snapshot when present (server-side path). Fall back to
  // the broker-local synthesis only when the caller bypassed trading-service
  // entirely (e.g. reconciliation / tests).
  const quoteContext: ExecutionQuoteContext =
    input.quoteGate?.quoteContext ?? quoteContextFor(execQuote, "paper", now);

  const order: Order = {
    id: orderId,
    clientOrderId,
    brokerOrderId: `PAPER-${orderId.slice(0, 8).toUpperCase()}`,
    accountId: input.order.accountId,
    broker: "paper",
    symbol: input.order.symbol,
    side: input.order.side,
    type: input.order.type,
    timeInForce: input.order.timeInForce,
    quantity: input.order.quantity,
    filledQuantity: 0,
    price: input.order.price,
    stopPrice: input.order.stopPrice,
    avgFillPrice: null,
    status: "submitted" as OrderStatus,
    reason: null,
    tradePlanId: input.order.tradePlanId,
    strategyId: input.order.strategyId,
    riskCheckId: input.riskCheckId,
    submittedAt: now,
    acknowledgedAt: now,
    filledAt: null,
    canceledAt: null,
    quoteContext,
    createdAt: now,
    updatedAt: now
  };

  state.orders.set(orderId, order);
  state.lastEventAt = now;
  emit(input.session, input.order.accountId, {
    type: "submit",
    orderId,
    clientOrderId,
    status: "submitted",
    message: null,
    payload: { quoteContext, quoteDecision },
    timestamp: now
  });

  // Decide fill behavior.
  const fillsImmediately =
    order.type === "market" ||
    (order.type === "limit" && shouldLimitFill(input.order, markPrice));

  // Block immediate fills against quotes that aren't execution-safe (stale,
  // synthetic, blocked feed, etc.). Resting limit/stop orders are allowed —
  // they'll re-check the quote at trigger time.
  if (fillsImmediately && markPrice && (!execQuote.paperUsable || !execQuote.paperSafe)) {
    order.status = "rejected";
    order.reason = "quote_not_paper_safe";
    order.updatedAt = now;
    const reasonText = execQuote.reasons.length > 0
      ? execQuote.reasons.join(", ")
      : "quote not marked paper-usable";
    emit(input.session, input.order.accountId, {
      type: "reject",
      orderId,
      clientOrderId,
      status: "rejected",
      message: `Quote not paper-safe: ${reasonText}`,
      payload: { reasons: execQuote.reasons, quoteContext, quoteDecision },
      timestamp: now
    });
    persistAccountAsync(input.session, state);
    return order;
  }

  if (fillsImmediately && markPrice) {
    await fillOrder({
      session: input.session,
      order,
      fillPrice: markPrice,
      fillQty: order.quantity,
      now,
      quoteContext,
      quoteDecision
    });
    persistAccountAsync(input.session, state);
    return state.orders.get(orderId)!;
  }

  if (order.type === "market" && !markPrice) {
    order.status = "rejected";
    order.reason = "no_reference_price";
    order.updatedAt = now;
    emit(input.session, input.order.accountId, {
      type: "reject",
      orderId,
      clientOrderId,
      status: "rejected",
      message: "No quote available to mark market order.",
      payload: { quoteContext, quoteDecision },
      timestamp: now
    });
    persistAccountAsync(input.session, state);
    return order;
  }

  // Limit / stop that don't fill yet stay acknowledged.
  order.status = "acknowledged";
  order.updatedAt = now;
  emit(input.session, input.order.accountId, {
    type: "acknowledge",
    orderId,
    clientOrderId,
    status: "acknowledged",
    message: null,
    payload: { quoteContext, quoteDecision },
    timestamp: now
  });

  persistAccountAsync(input.session, state);
  return order;
}

async function fillOrder(args: {
  session: AppSession;
  order: Order;
  fillPrice: number;
  fillQty: number;
  now: string;
  quoteContext?: ExecutionQuoteContext;
  quoteDecision?: ReturnType<typeof quoteDecisionPayload>;
}): Promise<void> {
  const state = await getOrCreateAccount(args.session, args.order.accountId);
  const fillId = randomUUID();
  const fee = args.fillPrice * args.fillQty * PAPER_FEE_RATE;
  const tax =
    args.order.side === "sell" ? args.fillPrice * args.fillQty * PAPER_SELL_TAX_RATE : 0;

  const fill: Fill = {
    id: fillId,
    orderId: args.order.id,
    clientOrderId: args.order.clientOrderId,
    accountId: args.order.accountId,
    symbol: args.order.symbol,
    side: args.order.side,
    quantity: args.fillQty,
    price: args.fillPrice,
    fee,
    tax,
    timestamp: args.now,
    quoteContext: args.quoteContext ?? null
  };

  const cashDelta =
    args.order.side === "buy"
      ? -(args.fillPrice * args.fillQty + fee)
      : args.fillPrice * args.fillQty - fee - tax;

  state.cash += cashDelta;
  state.fills.unshift(fill);

  const realized = applyFillToPosition(
    state,
    args.order.symbol,
    args.order.side,
    args.fillQty,
    args.fillPrice,
    args.now
  );
  state.realizedPnlToday += realized - (args.order.side === "sell" ? tax : 0) - fee;

  const filledTotal = args.order.filledQuantity + args.fillQty;
  const weightedAvg =
    args.order.avgFillPrice === null
      ? args.fillPrice
      : (args.order.avgFillPrice * args.order.filledQuantity +
          args.fillPrice * args.fillQty) /
        filledTotal;

  const updated: Order = {
    ...args.order,
    filledQuantity: filledTotal,
    avgFillPrice: weightedAvg,
    status: filledTotal >= args.order.quantity ? "filled" : "partial",
    filledAt: filledTotal >= args.order.quantity ? args.now : args.order.filledAt,
    updatedAt: args.now
  };

  state.orders.set(args.order.id, updated);
  state.lastEventAt = args.now;

  // Fill itself already carries quoteContext (persisted on the record). The
  // event payload *is* the fill, so the timeline's asFill narrow picks it up
  // and DetailPanel's asQuoteContext narrow sees the same sibling field.
  emit(args.session, args.order.accountId, {
    type: "fill",
    orderId: args.order.id,
    clientOrderId: args.order.clientOrderId,
    status: updated.status,
    message: null,
    payload: args.quoteDecision ? { ...fill, quoteDecision: args.quoteDecision } : fill,
    timestamp: args.now
  });
}

export async function cancelPaperOrder(input: {
  session: AppSession;
  payload: OrderCancelInput;
  accountId: string;
}): Promise<Order | null> {
  const state = await getOrCreateAccount(input.session, input.accountId);
  const order = state.orders.get(input.payload.orderId);
  if (!order) return null;
  if (order.status === "filled" || order.status === "canceled" || order.status === "rejected") {
    return order;
  }
  const now = new Date().toISOString();
  const updated: Order = {
    ...order,
    status: "canceled",
    reason: input.payload.reason || order.reason,
    canceledAt: now,
    updatedAt: now
  };
  state.orders.set(order.id, updated);
  state.lastEventAt = now;
  emit(input.session, input.accountId, {
    type: "cancel",
    orderId: order.id,
    clientOrderId: order.clientOrderId,
    status: "canceled",
    message: input.payload.reason || null,
    payload: null,
    timestamp: now
  });
  persistAccountAsync(input.session, state);
  return updated;
}

export async function listPaperOrders(
  session: AppSession,
  filters?: { accountId?: string; status?: OrderStatus; symbol?: string }
): Promise<Order[]> {
  const ws = await ensureWorkspaceHydrated(session);
  const accountIds = filters?.accountId ? [filters.accountId] : [...ws.keys()];
  const result: Order[] = [];
  for (const id of accountIds) {
    const state = ws.get(id);
    if (!state) continue;
    for (const order of state.orders.values()) {
      if (filters?.status && order.status !== filters.status) continue;
      if (filters?.symbol && order.symbol !== filters.symbol) continue;
      result.push(order);
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listPaperPositions(
  session: AppSession,
  accountId: string
): Promise<Position[]> {
  const state = await getOrCreateAccount(session, accountId);
  const positions: Position[] = [];
  for (const [symbol, pos] of state.positions.entries()) {
    const quote = await getLatestQuote(session, symbol);
    const markPrice = quote?.last ?? quote?.bid ?? quote?.ask ?? null;
    const marketValue = markPrice ? markPrice * pos.quantity : null;
    const unrealizedPnl =
      markPrice && pos.quantity !== 0
        ? (markPrice - pos.avgPrice) * pos.quantity
        : null;
    const unrealizedPnlPct =
      unrealizedPnl !== null && pos.avgPrice !== 0
        ? (unrealizedPnl / (pos.avgPrice * Math.abs(pos.quantity))) * 100
        : null;
    positions.push({
      accountId,
      symbol,
      market: quote?.market ?? "TWSE",
      quantity: pos.quantity,
      avgPrice: pos.avgPrice,
      marketPrice: markPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      openedAt: pos.openedAt,
      companyId: null
    });
  }
  return positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function getPaperBalance(
  session: AppSession,
  accountId: string
): Promise<Balance> {
  const state = await getOrCreateAccount(session, accountId);
  const positions = await listPaperPositions(session, accountId);
  const marketValue = positions.reduce((acc, p) => acc + (p.marketValue ?? 0), 0);
  const unrealizedPnl = positions.reduce((acc, p) => acc + (p.unrealizedPnl ?? 0), 0);
  return {
    accountId,
    currency: state.account.currency,
    cash: state.cash,
    availableCash: state.cash,
    equity: state.cash + marketValue,
    marketValue,
    unrealizedPnl,
    realizedPnlToday: state.realizedPnlToday,
    marginUsed: 0,
    updatedAt: new Date().toISOString()
  };
}

export async function getPaperBrokerStatus(
  session: AppSession,
  accountId: string
): Promise<BrokerConnectionStatus> {
  const state = await getOrCreateAccount(session, accountId);
  return {
    broker: "paper",
    accountId,
    connected: true,
    heartbeatAt: state.lastEventAt ?? state.createdAt,
    latencyMs: 0,
    lastReconcileAt: null,
    errorMessage: null
  };
}

// Test / ops utility — clears a workspace's paper state. Not wired to any
// public route; callable from scripts.
export async function resetPaperWorkspace(session: AppSession): Promise<void> {
  workspaces.delete(workspaceKey(session));
  const { deleteWorkspaceSnapshots } = await import("./paper-broker-store.js");
  await deleteWorkspaceSnapshots(session);
}
