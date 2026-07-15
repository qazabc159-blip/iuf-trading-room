// W6 Day 4 — DB-backed paper ledger.
// W8 2026-05-05 — wired to order-driver; fallback MapAdapter for memory mode.
//
// Drizzle queries against paper_orders + paper_fills tables (migration 0015).
//
// Public export shape intentionally mirrors paper-ledger.ts:
//   upsertOrder / getOrder / listOrders / recordFill / deleteOrder
//   + findByIdempotencyKey (idempotency persistence, Task B)
//
// Architecture:
//   - Internal `LedgerAdapter` interface abstracts storage operations.
//   - `drizzleAdapter(db)` wraps a DatabaseClient with drizzle queries.
//   - `mapAdapter()` provides in-memory fallback for memory mode (CI/local).
//   - Each public function accepts an optional `adapter?: LedgerAdapter`.
//     In production (PERSISTENCE_MODE=database): omit → DrizzleAdapter.
//     In memory mode (default): omit → MapAdapter (same process, non-persistent).
//     In tests: pass a MapAdapter explicitly.
//
// Hard stops: no KGI SDK import, no broker, no market-data, no server.ts touch.

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import { getDb, isDatabaseMode, paperFills, paperOrders, paperRealizedPnl } from "@iuf-trading-room/db";
import type { DatabaseClient } from "@iuf-trading-room/db";

import type { OrderIntent, OrderIntentStatus } from "./order-intent.js";
import type { SimulatedFill, OrderState, ListOrdersFilter } from "./paper-ledger.js";

// Re-export types for callers
export type { SimulatedFill, OrderState, ListOrdersFilter };

// ---------------------------------------------------------------------------
// LedgerAdapter — internal storage interface
// ---------------------------------------------------------------------------

/**
 * Narrow storage interface used by every public function.
 * Allows swapping between Drizzle (prod) and Map (test) without changing
 * any call-site or public export shape.
 */
export interface LedgerAdapter {
  /** Save or overwrite an order row. Idempotent on idempotencyKey conflict. */
  saveOrder(state: OrderState): Promise<void>;
  /** Find a single order by its id. */
  findOrder(orderId: string): Promise<OrderState | undefined>;
  /** Find an order by idempotency key. Returns undefined if not found. */
  findByIdempotencyKey(key: string): Promise<OrderState | undefined>;
  /** List orders for a userId, optionally filtered by status. Sorted createdAt ASC. */
  listOrders(userId: string, statusFilter?: OrderIntentStatus): Promise<OrderState[]>;
  /** Save a fill row. Returns false if orderId unknown. Idempotent if fill exists. */
  saveFill(orderId: string, fill: SimulatedFill): Promise<boolean>;
  /** Remove an order (and cascade fills). Returns false if unknown. */
  removeOrder(orderId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Row types (drizzle schema inference)
// ---------------------------------------------------------------------------

type PaperOrderRow = typeof paperOrders.$inferSelect;
type PaperFillRow  = typeof paperFills.$inferSelect;

function rowToOrderState(row: PaperOrderRow, fillRow: PaperFillRow | null): OrderState {
  const intent: OrderIntent = {
    id:             row.id,
    idempotencyKey: row.idempotencyKey,
    symbol:         row.symbol,
    side:           row.side as OrderIntent["side"],
    orderType:      row.orderType as OrderIntent["orderType"],
    qty:            row.qty,
    quantity_unit:  (row.quantityUnit ?? "LOT") as OrderIntent["quantity_unit"],
    price:          row.price !== null ? parseFloat(row.price) : null,
    userId:         row.userId,
    status:         row.status as OrderIntentStatus,
    reason:         row.reason ?? null,
    createdAt:      row.createdAt.toISOString(),
    updatedAt:      row.updatedAt.toISOString()
  };
  const fill: SimulatedFill | null = fillRow
    ? { fillQty: fillRow.fillQty, fillPrice: parseFloat(fillRow.fillPrice), fillTime: fillRow.fillTime }
    : null;
  return { intent, fill };
}

// ---------------------------------------------------------------------------
// DrizzleAdapter — production adapter
// ---------------------------------------------------------------------------

function resolveDrizzleDb(injected?: DatabaseClient | null): DatabaseClient {
  if (injected != null) return injected;
  const db = getDb();
  if (!db) {
    throw new Error(
      "paper-ledger-db: DB not available. " +
      "Set PERSISTENCE_MODE=database and DATABASE_URL."
    );
  }
  return db;
}

/**
 * Create a LedgerAdapter backed by Drizzle + PostgreSQL.
 * Pass a DatabaseClient to override the default singleton (useful for
 * connection-scoped transactions in the future).
 */
export function drizzleAdapter(injectedDb?: DatabaseClient | null): LedgerAdapter {
  const db = resolveDrizzleDb(injectedDb);

  return {
    async saveOrder(state: OrderState): Promise<void> {
      const { intent } = state;
      await db
        .insert(paperOrders)
        .values({
          id:             intent.id,
          idempotencyKey: intent.idempotencyKey,
          symbol:         intent.symbol,
          side:           intent.side,
          orderType:      intent.orderType,
          qty:            intent.qty,
          quantityUnit:   intent.quantity_unit,
          price:          intent.price !== null ? String(intent.price) : null,
          status:         intent.status,
          reason:         intent.reason ?? null,
          userId:         intent.userId,
          intentId:       intent.id,
          createdAt:      new Date(intent.createdAt),
          updatedAt:      new Date(intent.updatedAt)
        })
        .onConflictDoUpdate({
          target: paperOrders.idempotencyKey,
          set: {
            status:    intent.status,
            reason:    intent.reason ?? null,
            updatedAt: new Date(intent.updatedAt)
          }
        });
    },

    async findOrder(orderId: string): Promise<OrderState | undefined> {
      const [orderRow] = await db
        .select()
        .from(paperOrders)
        .where(eq(paperOrders.id, orderId));
      if (!orderRow) return undefined;
      const [fillRow] = await db
        .select()
        .from(paperFills)
        .where(eq(paperFills.orderId, orderId));
      return rowToOrderState(orderRow, fillRow ?? null);
    },

    async findByIdempotencyKey(key: string): Promise<OrderState | undefined> {
      const [orderRow] = await db
        .select()
        .from(paperOrders)
        .where(eq(paperOrders.idempotencyKey, key));
      if (!orderRow) return undefined;
      const [fillRow] = await db
        .select()
        .from(paperFills)
        .where(eq(paperFills.orderId, orderRow.id));
      return rowToOrderState(orderRow, fillRow ?? null);
    },

    async listOrders(
      userId: string,
      statusFilter?: OrderIntentStatus
    ): Promise<OrderState[]> {
      const conditions = [eq(paperOrders.userId, userId)];
      if (statusFilter !== undefined) {
        conditions.push(eq(paperOrders.status, statusFilter));
      }
      const orderRows = await db
        .select()
        .from(paperOrders)
        .where(and(...conditions))
        .orderBy(asc(paperOrders.createdAt));

      const results: OrderState[] = [];
      for (const row of orderRows) {
        const [fillRow] = await db
          .select()
          .from(paperFills)
          .where(eq(paperFills.orderId, row.id));
        results.push(rowToOrderState(row, fillRow ?? null));
      }
      return results;
    },

    async saveFill(orderId: string, fill: SimulatedFill): Promise<boolean> {
      const [orderRow] = await db
        .select({ id: paperOrders.id })
        .from(paperOrders)
        .where(eq(paperOrders.id, orderId));
      if (!orderRow) return false;

      const [existingFill] = await db
        .select({ id: paperFills.id })
        .from(paperFills)
        .where(eq(paperFills.orderId, orderId));
      if (existingFill) return true; // idempotent no-op

      await db.insert(paperFills).values({
        orderId:     orderId,
        fillQty:     fill.fillQty,
        fillPrice:   String(fill.fillPrice),
        fillTime:    fill.fillTime,
        simulatedAt: new Date()
      });
      return true;
    },

    async removeOrder(orderId: string): Promise<boolean> {
      const [existing] = await db
        .select({ id: paperOrders.id })
        .from(paperOrders)
        .where(eq(paperOrders.id, orderId));
      if (!existing) return false;
      await db.delete(paperOrders).where(eq(paperOrders.id, orderId));
      return true;
    }
  };
}

// ---------------------------------------------------------------------------
// MapAdapter — in-memory fallback for memory mode (CI / local without DB)
// ---------------------------------------------------------------------------

/**
 * In-memory LedgerAdapter backed by a Map + Set.
 * Used when PERSISTENCE_MODE != "database".
 * Same semantics as the old paper-ledger.ts but async and unified under
 * the LedgerAdapter interface.
 */
export function mapAdapter(): LedgerAdapter {
  const orders = new Map<string, OrderState>();
  // idempotency_key → orderId index
  const idempotencyIndex = new Map<string, string>();

  return {
    async saveOrder(state: OrderState): Promise<void> {
      const existing = idempotencyIndex.get(state.intent.idempotencyKey);
      if (existing && existing !== state.intent.id) {
        // Key already registered to a different orderId — idempotent no-op
        return;
      }
      orders.set(state.intent.id, state);
      idempotencyIndex.set(state.intent.idempotencyKey, state.intent.id);
    },

    async findOrder(orderId: string): Promise<OrderState | undefined> {
      return orders.get(orderId);
    },

    async findByIdempotencyKey(key: string): Promise<OrderState | undefined> {
      const orderId = idempotencyIndex.get(key);
      if (!orderId) return undefined;
      return orders.get(orderId);
    },

    async listOrders(
      userId: string,
      statusFilter?: OrderIntentStatus
    ): Promise<OrderState[]> {
      const results: OrderState[] = [];
      for (const state of orders.values()) {
        if (state.intent.userId !== userId) continue;
        if (statusFilter !== undefined && state.intent.status !== statusFilter) continue;
        results.push(state);
      }
      results.sort((a, b) => a.intent.createdAt.localeCompare(b.intent.createdAt));
      return results;
    },

    async saveFill(orderId: string, fill: SimulatedFill): Promise<boolean> {
      const existing = orders.get(orderId);
      if (!existing) return false;
      if (existing.fill !== null) return true; // idempotent
      orders.set(orderId, { ...existing, fill });
      return true;
    },

    async removeOrder(orderId: string): Promise<boolean> {
      const existing = orders.get(orderId);
      if (!existing) return false;
      idempotencyIndex.delete(existing.intent.idempotencyKey);
      orders.delete(orderId);
      return true;
    }
  };
}

// ---------------------------------------------------------------------------
// Module-level default adapter (lazy, picks DB or memory based on env)
// ---------------------------------------------------------------------------

let _defaultAdapter: LedgerAdapter | null = null;

/** Exposed for test injection only. */
export function _setDefaultAdapterForTest(adapter: LedgerAdapter | null): void {
  _defaultAdapter = adapter;
}

function getDefaultAdapter(): LedgerAdapter {
  if (!_defaultAdapter) {
    _defaultAdapter = isDatabaseMode() ? drizzleAdapter() : mapAdapter();
  }
  return _defaultAdapter;
}

// ---------------------------------------------------------------------------
// Public API — same shape as paper-ledger.ts
// ---------------------------------------------------------------------------

/**
 * Persist (or update) an OrderState.
 * Pass `adapter` for test injection; omit for production.
 */
export async function upsertOrder(
  state: OrderState,
  adapter?: LedgerAdapter | null
): Promise<void> {
  return (adapter ?? getDefaultAdapter()).saveOrder(state);
}

/**
 * Retrieve an order by orderId.
 * Returns undefined if not found.
 */
export async function getOrder(
  orderId: string,
  adapter?: LedgerAdapter | null
): Promise<OrderState | undefined> {
  return (adapter ?? getDefaultAdapter()).findOrder(orderId);
}

/**
 * List orders for a userId with optional status filter.
 * Ordered by createdAt ASC.
 */
export async function listOrders(
  userId: string,
  filters?: ListOrdersFilter,
  adapter?: LedgerAdapter | null
): Promise<OrderState[]> {
  return (adapter ?? getDefaultAdapter()).listOrders(userId, filters?.status);
}

/**
 * Record a fill for an order.
 * Idempotent: second call with same orderId is a no-op.
 * Returns false if orderId does not exist.
 */
export async function recordFill(
  orderId: string,
  fill: SimulatedFill,
  adapter?: LedgerAdapter | null
): Promise<boolean> {
  return (adapter ?? getDefaultAdapter()).saveFill(orderId, fill);
}

/**
 * Delete an order (fills cascade via FK).
 * Returns true if it existed; false if not found.
 */
export async function deleteOrder(
  orderId: string,
  adapter?: LedgerAdapter | null
): Promise<boolean> {
  return (adapter ?? getDefaultAdapter()).removeOrder(orderId);
}

/**
 * Find an order by its idempotency key.
 * Returns undefined if not found.
 * Used by submit routes for persistent duplicate detection across restarts.
 */
export async function findByIdempotencyKey(
  key: string,
  adapter?: LedgerAdapter | null
): Promise<OrderState | undefined> {
  return (adapter ?? getDefaultAdapter()).findByIdempotencyKey(key);
}

// ---------------------------------------------------------------------------
// FIFO realized P&L (2026-07-12 — paper ledger realized-PnL backlog item)
//
// Closes the gap flagged in PR #1222: `/paper/portfolio` only ever showed
// unrealized state and a fixed baseCapitalTWD constant — round-tripped
// (bought-then-sold) positions left no trace of what they actually earned.
//
// Design:
//   - FIFO lot matching (台股慣例 — earliest-bought shares are sold first).
//   - Cost is fee-inclusive at the point of purchase: costPerShareWithFee =
//     price * (1 + buyCommissionRate). This mirrors how a real cash account
//     works (commission leaves cash immediately, whether or not the position
//     is later closed) and keeps the reconciliation identity below exact,
//     not just directionally close.
//   - realizedPnlTwd per matched trade = matchedQty * (sellProceedsPerShare
//     - lot.costPerShareWithFee), where sellProceedsPerShare already nets
//     out sell commission + securities transaction tax.
//   - Pure function over an already-fetched OrderState[] — no DB access, so
//     callers control exactly which orders (userId / status) feed it.
//
// Reconciliation identity (locked by paper-ledger-db.test.ts):
//   totalRealizedPnlTwd + totalUnrealizedPnlTwd === totalMarketValueTwd + netCashFlowTwd
//   (equivalently: baseCapital + realized + unrealized === marketValue + cash,
//   since baseCapital cancels out of both sides when netCashFlowTwd is added
//   to baseCapital to get available cash — see server.ts /paper/portfolio).
//
// Known limitation (documented, not solved here — matches the pre-existing
// weighted-avg computePaperPortfolioPositions() limitation in server.ts):
//   Selling more shares than currently held (short sale) has no cost basis
//   to match against. The unmatched quantity's sale proceeds still land in
//   netCashFlowTwd (money really arrives), but contribute 0 to realizedPnlTwd
//   and are excluded from remainingOpenQtyShares. The reconciliation identity
//   above is only proven exact for long-only order sequences; short-sale
//   paths are intentionally out of scope for this pass.
// ---------------------------------------------------------------------------

/** Taiwan stock transaction cost rates used by the paper ledger's realized-PnL FIFO matcher.
 *
 * Numerically identical to STANDARD_COST_RATES in ../../sim-ledger-backfill.ts
 * (the F-AUTO SIM ledger's cost model) — copied here rather than imported so the
 * paper-ledger domain module has zero coupling to the F-AUTO ledger family (a
 * separate, out-of-lane bounded context). Keep these two rate sets numerically
 * in sync if the underlying broker cost model ever changes.
 */
export interface PaperCostRates {
  buyCommissionRate: number;            // fraction of buy notional, e.g. 0.001425 (0.1425%)
  sellCommissionRate: number;           // fraction of sell notional, e.g. 0.001425 (0.1425%)
  securitiesTransactionTaxRate: number; // fraction of sell notional only, e.g. 0.003 (0.3%)
}

export const PAPER_COST_RATES: PaperCostRates = {
  buyCommissionRate: 0.001425,
  sellCommissionRate: 0.001425,
  securitiesTransactionTaxRate: 0.003
};

/** One FIFO-matched (partial or full) close: a slice of a buy lot paired with a sell fill. */
export interface RealizedTradeMatch {
  symbol: string;
  matchedQtyShares: number;
  buyPrice: number;
  sellPrice: number;
  buyFillTime: string;
  sellFillTime: string;
  /** Net of buy-side commission and sell-side commission + securities transaction tax. */
  realizedPnlTwd: number;
  /** The order.id of the FILLED buy order this matched lot slice came from — the source
   * document a persisted ledger row must be able to cite exactly (2026-07-15 Mike audit
   * blocker #1: buyPrice/buyFillTime alone are a soft, non-verifiable link). */
  buyOrderId: string;
  /** The order.id of the FILLED sell order that triggered this match. */
  sellOrderId: string;
}

export interface SymbolFifoSummary {
  symbol: string;
  /** Cumulative net-of-fee realized P&L for this symbol, across all closed FIFO matches. */
  realizedPnlTwd: number;
  closedTradeCount: number;
  /** Shares still held (FIFO lots not yet matched against a sell). */
  remainingOpenQtyShares: number;
  /** Fee-inclusive cost basis of remainingOpenQtyShares (what actually left cash to buy them). */
  costBasisWithFeesTwd: number;
  /** Most recent fill price for this symbol (buy or sell), or null if never traded. */
  lastPrice: number | null;
  marketValueTwd: number;
  unrealizedPnlTwd: number;
}

export interface FifoRealizedPnlResult {
  bySymbol: SymbolFifoSummary[];
  trades: RealizedTradeMatch[];
  totalRealizedPnlTwd: number;
  totalUnrealizedPnlTwd: number;
  totalCostBasisWithFeesTwd: number;
  totalMarketValueTwd: number;
  /** Signed cash impact of every FILLED buy/sell (fee-inclusive). Add to base capital for available cash. */
  netCashFlowTwd: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fillTimeMillis(o: OrderState): number {
  const t = o.fill?.fillTime;
  if (t === undefined || t === null) return 0;
  const parsed = t instanceof Date ? t.getTime() : Date.parse(String(t));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fillTimeIso(o: OrderState): string {
  const t = o.fill?.fillTime;
  if (t instanceof Date) return t.toISOString();
  return String(t ?? "");
}

/**
 * FIFO-match every FILLED order's fill (buys open lots, sells close the
 * earliest-bought open lots first) and derive realized/unrealized P&L.
 *
 * Pure function: no DB access, no side effects. Callers pass in whatever
 * order set they want reconciled (typically listOrders(userId, {status:"FILLED"})).
 */
export function computeFifoRealizedPnl(
  orders: readonly OrderState[],
  costRates: PaperCostRates = PAPER_COST_RATES
): FifoRealizedPnlResult {
  const filled = orders.filter((o) => o.fill !== null && o.intent.status === "FILLED");

  const sorted = [...filled].sort((a, b) => {
    const dt = fillTimeMillis(a) - fillTimeMillis(b);
    if (dt !== 0) return dt;
    const ct = a.intent.createdAt.localeCompare(b.intent.createdAt);
    if (ct !== 0) return ct;
    return a.intent.id.localeCompare(b.intent.id);
  });

  interface Lot {
    qtyShares: number;
    price: number;
    costPerShareWithFee: number;
    fillTime: string;
    orderId: string;
  }

  const lotsBySymbol = new Map<string, Lot[]>();
  const trades: RealizedTradeMatch[] = [];
  const realizedBySymbol = new Map<string, { realizedPnlTwd: number; closedTradeCount: number }>();
  const lastPriceBySymbol = new Map<string, number>();
  let netCashFlowTwd = 0;

  const ensureLots = (symbol: string): Lot[] => {
    let lots = lotsBySymbol.get(symbol);
    if (!lots) {
      lots = [];
      lotsBySymbol.set(symbol, lots);
    }
    return lots;
  };
  const ensureRealized = (symbol: string) => {
    let r = realizedBySymbol.get(symbol);
    if (!r) {
      r = { realizedPnlTwd: 0, closedTradeCount: 0 };
      realizedBySymbol.set(symbol, r);
    }
    return r;
  };

  for (const o of sorted) {
    const symbol = o.intent.symbol;
    const fill = o.fill!;
    const qtyShares = Math.max(0, Number(fill.fillQty) || 0);
    if (qtyShares <= 0) continue;
    const price = fill.fillPrice;
    const timeIso = fillTimeIso(o);
    lastPriceBySymbol.set(symbol, price);

    if (o.intent.side === "buy") {
      const costPerShareWithFee = price * (1 + costRates.buyCommissionRate);
      ensureLots(symbol).push({ qtyShares, price, costPerShareWithFee, fillTime: timeIso, orderId: o.intent.id });
      netCashFlowTwd -= qtyShares * costPerShareWithFee;
      continue;
    }

    // sell: FIFO-match against oldest open lots first
    const proceedsPerShare = price * (1 - costRates.sellCommissionRate - costRates.securitiesTransactionTaxRate);
    const lots = ensureLots(symbol);
    let remaining = qtyShares;

    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matchedQty = Math.min(remaining, lot.qtyShares);
      const realizedPnlTwd = round2(matchedQty * (proceedsPerShare - lot.costPerShareWithFee));

      trades.push({
        symbol,
        matchedQtyShares: matchedQty,
        buyPrice: lot.price,
        sellPrice: price,
        buyFillTime: lot.fillTime,
        sellFillTime: timeIso,
        realizedPnlTwd,
        buyOrderId: lot.orderId,
        sellOrderId: o.intent.id
      });

      const r = ensureRealized(symbol);
      r.realizedPnlTwd += realizedPnlTwd;
      r.closedTradeCount += 1;

      netCashFlowTwd += matchedQty * proceedsPerShare;

      lot.qtyShares -= matchedQty;
      remaining -= matchedQty;
      if (lot.qtyShares <= 0) lots.shift();
    }

    // Known limitation: excess sell beyond available FIFO lots (short sale).
    // Proceeds still land in cash (real money), but no cost basis exists so
    // this quantity contributes 0 realized P&L and is not tracked as an open
    // lot. See module doc comment above.
    if (remaining > 0) {
      netCashFlowTwd += remaining * proceedsPerShare;
    }
  }

  const symbols = new Set<string>([...lotsBySymbol.keys(), ...realizedBySymbol.keys()]);
  const bySymbol: SymbolFifoSummary[] = [];
  let totalUnrealizedPnlTwd = 0;
  let totalCostBasisWithFeesTwd = 0;
  let totalMarketValueTwd = 0;

  for (const symbol of symbols) {
    const lots = lotsBySymbol.get(symbol) ?? [];
    const remainingOpenQtyShares = lots.reduce((acc, l) => acc + l.qtyShares, 0);
    const costBasisWithFeesTwd = round2(lots.reduce((acc, l) => acc + l.qtyShares * l.costPerShareWithFee, 0));
    const lastPrice = lastPriceBySymbol.get(symbol) ?? null;
    const marketValueTwd = lastPrice !== null ? round2(remainingOpenQtyShares * lastPrice) : 0;
    const unrealizedPnlTwd = round2(marketValueTwd - costBasisWithFeesTwd);
    const realized = realizedBySymbol.get(symbol) ?? { realizedPnlTwd: 0, closedTradeCount: 0 };

    bySymbol.push({
      symbol,
      realizedPnlTwd: round2(realized.realizedPnlTwd),
      closedTradeCount: realized.closedTradeCount,
      remainingOpenQtyShares,
      costBasisWithFeesTwd,
      lastPrice,
      marketValueTwd,
      unrealizedPnlTwd
    });

    totalUnrealizedPnlTwd += unrealizedPnlTwd;
    totalCostBasisWithFeesTwd += costBasisWithFeesTwd;
    totalMarketValueTwd += marketValueTwd;
  }

  bySymbol.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const totalRealizedPnlTwd = round2(
    [...realizedBySymbol.values()].reduce((acc, r) => acc + r.realizedPnlTwd, 0)
  );

  return {
    bySymbol,
    trades,
    totalRealizedPnlTwd,
    totalUnrealizedPnlTwd: round2(totalUnrealizedPnlTwd),
    totalCostBasisWithFeesTwd: round2(totalCostBasisWithFeesTwd),
    totalMarketValueTwd: round2(totalMarketValueTwd),
    netCashFlowTwd: round2(netCashFlowTwd)
  };
}

// ---------------------------------------------------------------------------
// Persisted realized-P&L ledger (migration 0058) — 2026-07-15
//
// computeFifoRealizedPnl() above is a pure, on-the-fly view: it re-derives
// every FIFO match by re-scanning ALL filled orders on every call. That's
// fine for the live /paper/positions summary, but it means "realized P&L"
// had no formal, immutable record — historical trades would silently
// re-interpret themselves if PAPER_COST_RATES or the matching algorithm ever
// changes. This section persists one row per FIFO match at the moment a
// sell fills (called from order-driver.ts driveOrder()), so a dedicated
// ledger/endpoint can list actual realized trades without re-deriving them.
// ---------------------------------------------------------------------------

/** Which pipeline (and therefore which order-id space) a ledger row's
 * buyOrderId/sellOrderId resolve against. "legacy_paper" = order-driver.ts +
 * paper_orders table (POST /api/v1/paper/submit). "unified_paper" =
 * broker/paper-broker.ts's in-memory Order/Fill records (POST
 * /api/v1/trading/orders, the path the /desk-exact UI actually uses) — see
 * migration 0059. */
export type RealizedPnlSource = "legacy_paper" | "unified_paper";

/** A realized-P&L ledger row as read back from storage (id + persistence metadata added). */
export interface PersistedRealizedTrade extends RealizedTradeMatch {
  id: string;
  createdAt: string;
  source: RealizedPnlSource;
  /** Unified-pipeline account id (e.g. "primary-desk"), null for legacy rows
   * (legacy has no account concept) — see migration 0059. */
  accountId: string | null;
}

/** Optional per-call metadata for insertMatches()/recordRealizedPnlForSell() —
 * defaults to the legacy pipeline's provenance when omitted, so every
 * pre-existing call site (order-driver.ts, tests) keeps writing
 * source='legacy_paper', accountId=null with zero changes required. */
export interface RealizedPnlWriteMeta {
  source?: RealizedPnlSource;
  accountId?: string | null;
}

/**
 * Determine which FIFO matches a given sell fill produced, without
 * duplicating any of computeFifoRealizedPnl()'s matching logic: run it over
 * (priorFilledOrders + this sell) and keep only the matches whose
 * sellOrderId equals this sell's own order id (2026-07-15 Mike audit: matching
 * on the order id, now that every RealizedTradeMatch carries one, rather than
 * the earlier fillTime-string comparison — exact, no "assume no timestamp
 * collision" caveat needed).
 *
 * Pure function: no DB access, no side effects.
 */
export function matchFifoSellAgainstPriorOrders(
  sellOrder: OrderState,
  priorFilledOrders: readonly OrderState[],
  costRates: PaperCostRates = PAPER_COST_RATES
): RealizedTradeMatch[] {
  if (sellOrder.intent.side !== "sell" || !sellOrder.fill) return [];
  const combined = computeFifoRealizedPnl([...priorFilledOrders, sellOrder], costRates);
  return combined.trades.filter((t) => t.sellOrderId === sellOrder.intent.id);
}

/** Narrow storage interface for the realized-P&L ledger, mirroring LedgerAdapter's pattern. */
export interface RealizedPnlAdapter {
  /** True if any ledger rows already exist for this sellOrderId (app-level fast-path
   * pre-check only — NOT the safety net against duplicates; see insertMatches doc). */
  hasMatchesForSellOrder(sellOrderId: string): Promise<boolean>;
  /** Persist a batch of FIFO matches produced by one sell fill. No-op on an empty array.
   * Must be safe to call twice with the same matches (DB-level dedup, not app-level).
   * `meta` is omitted by legacy call sites (defaults to source='legacy_paper',
   * accountId=null); the unified pipeline passes it explicitly. */
  insertMatches(userId: string, matches: RealizedTradeMatch[], meta?: RealizedPnlWriteMeta): Promise<void>;
  /** List all persisted realized trades for a user, newest sell-fill first. */
  listForUser(userId: string, symbol?: string): Promise<PersistedRealizedTrade[]>;
}

/** Exported for the real-Postgres DB-mode integration test (see
 * paper-realized-pnl-db.test.ts) — mirrors drizzleAdapter() being exported above. */
export function drizzleRealizedPnlAdapter(injectedDb?: DatabaseClient | null): RealizedPnlAdapter {
  const db = resolveDrizzleDb(injectedDb);

  return {
    async hasMatchesForSellOrder(sellOrderId: string): Promise<boolean> {
      const [row] = await db
        .select({ id: paperRealizedPnl.id })
        .from(paperRealizedPnl)
        .where(eq(paperRealizedPnl.sellOrderId, sellOrderId))
        .limit(1);
      return row !== undefined;
    },

    // 2026-07-15 Mike audit blocker #2: the app-level hasMatchesForSellOrder()
    // check-then-act pattern alone cannot prevent a duplicate insert under
    // concurrent/re-invoked driveOrder() calls (classic TOCTOU race). The real
    // guard is the DB: migration 0058's UNIQUE(sell_order_id, buy_order_id)
    // constraint + ON CONFLICT DO NOTHING here makes a duplicate insert a
    // guaranteed no-op at the database layer, not just "unlikely". Wrapped in
    // an explicit transaction per Mike's request (a single multi-row INSERT is
    // already atomic as one statement, but this keeps the write path explicit
    // and gives future additions to this write a shared transaction to join).
    async insertMatches(
      userId: string,
      matches: RealizedTradeMatch[],
      meta?: RealizedPnlWriteMeta
    ): Promise<void> {
      if (matches.length === 0) return;
      const source: RealizedPnlSource = meta?.source ?? "legacy_paper";
      const accountId = meta?.accountId ?? null;
      await db.transaction(async (tx) => {
        await tx
          .insert(paperRealizedPnl)
          .values(
            matches.map((m) => ({
              userId,
              symbol: m.symbol,
              matchedQtyShares: m.matchedQtyShares,
              buyPrice: String(m.buyPrice),
              sellPrice: String(m.sellPrice),
              buyFillTime: new Date(m.buyFillTime),
              sellFillTime: new Date(m.sellFillTime),
              realizedPnlTwd: String(m.realizedPnlTwd),
              buyOrderId: m.buyOrderId,
              sellOrderId: m.sellOrderId,
              source,
              accountId
            }))
          )
          .onConflictDoNothing({
            target: [paperRealizedPnl.sellOrderId, paperRealizedPnl.buyOrderId]
          });
      });
    },

    async listForUser(userId: string, symbol?: string): Promise<PersistedRealizedTrade[]> {
      const conditions = [eq(paperRealizedPnl.userId, userId)];
      if (symbol !== undefined) conditions.push(eq(paperRealizedPnl.symbol, symbol));
      const rows = await db
        .select()
        .from(paperRealizedPnl)
        .where(and(...conditions))
        .orderBy(desc(paperRealizedPnl.sellFillTime));
      return rows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        matchedQtyShares: row.matchedQtyShares,
        buyPrice: parseFloat(row.buyPrice),
        sellPrice: parseFloat(row.sellPrice),
        buyFillTime: row.buyFillTime.toISOString(),
        sellFillTime: row.sellFillTime.toISOString(),
        realizedPnlTwd: parseFloat(row.realizedPnlTwd),
        buyOrderId: row.buyOrderId,
        sellOrderId: row.sellOrderId,
        source: row.source as RealizedPnlSource,
        accountId: row.accountId ?? null,
        createdAt: row.createdAt.toISOString()
      }));
    }
  };
}

/** In-memory fallback for memory mode (CI/local without DB) — same shape as mapAdapter() above.
 * Dedup mirrors the DB adapter's UNIQUE(sell_order_id, buy_order_id) constraint exactly (a
 * Set keyed on the same composite pair), so test behaviour matches prod behaviour. */
function mapRealizedPnlAdapter(): RealizedPnlAdapter {
  const rows: PersistedRealizedTrade[] = [];
  const bySellOrder = new Map<string, string>(); // sellOrderId -> userId, for hasMatchesForSellOrder
  const seenPairs = new Set<string>(); // `${sellOrderId}::${buyOrderId}` — mirrors the DB UNIQUE constraint

  return {
    async hasMatchesForSellOrder(sellOrderId: string): Promise<boolean> {
      return bySellOrder.has(sellOrderId);
    },
    async insertMatches(
      userId: string,
      matches: RealizedTradeMatch[],
      meta?: RealizedPnlWriteMeta
    ): Promise<void> {
      if (matches.length === 0) return;
      const source: RealizedPnlSource = meta?.source ?? "legacy_paper";
      const accountId = meta?.accountId ?? null;
      for (const m of matches) {
        const pairKey = `${m.sellOrderId}::${m.buyOrderId}`;
        if (seenPairs.has(pairKey)) continue; // DO NOTHING equivalent
        seenPairs.add(pairKey);
        rows.push({ id: randomUUID(), createdAt: new Date().toISOString(), source, accountId, ...m });
      }
      for (const m of matches) bySellOrder.set(m.sellOrderId, userId);
    },
    async listForUser(userId: string, symbol?: string): Promise<PersistedRealizedTrade[]> {
      return rows
        .filter((r) => bySellOrder.get(r.sellOrderId) === userId)
        .filter((r) => (symbol === undefined ? true : r.symbol === symbol))
        .sort((a, b) => b.sellFillTime.localeCompare(a.sellFillTime));
    }
  };
}

let _defaultRealizedPnlAdapter: RealizedPnlAdapter | null = null;

/** Exposed for test injection only. */
export function _setDefaultRealizedPnlAdapterForTest(adapter: RealizedPnlAdapter | null): void {
  _defaultRealizedPnlAdapter = adapter;
}

function getDefaultRealizedPnlAdapter(): RealizedPnlAdapter {
  if (!_defaultRealizedPnlAdapter) {
    _defaultRealizedPnlAdapter = isDatabaseMode() ? drizzleRealizedPnlAdapter() : mapRealizedPnlAdapter();
  }
  return _defaultRealizedPnlAdapter;
}

/**
 * Persist the FIFO matches produced by a sell fill, idempotently.
 * Callers (order-driver.ts) should invoke this right after recordFill() for
 * a sell order that just transitioned to FILLED, passing every OTHER
 * already-filled order for the same user (any order beforehand, symbol
 * filtering happens inside the matcher). Fails open in spirit — callers are
 * expected to catch/log, matching the house style for persistence helpers
 * that must never block the hot order-fill path (see e.g.
 * quote-last-close-store.ts's doc comment).
 *
 * Returns the matches that were (or would have been, if already recorded)
 * produced, for logging/testing convenience.
 *
 * `meta` is optional and additive — omit it (as order-driver.ts's legacy call
 * site does) and rows persist as source='legacy_paper', accountId=null,
 * unchanged from pre-2026-07-15 behaviour. The unified pipeline
 * (broker/paper-broker.ts) passes { source: "unified_paper", accountId }.
 */
export async function recordRealizedPnlForSell(
  sellOrder: OrderState,
  priorFilledOrders: readonly OrderState[],
  costRates: PaperCostRates = PAPER_COST_RATES,
  adapter?: RealizedPnlAdapter | null,
  meta?: RealizedPnlWriteMeta
): Promise<RealizedTradeMatch[]> {
  if (sellOrder.intent.side !== "sell" || !sellOrder.fill) return [];
  const a = adapter ?? getDefaultRealizedPnlAdapter();

  const alreadyRecorded = await a.hasMatchesForSellOrder(sellOrder.intent.id);
  if (alreadyRecorded) return [];

  const matches = matchFifoSellAgainstPriorOrders(sellOrder, priorFilledOrders, costRates);
  if (matches.length > 0) {
    await a.insertMatches(sellOrder.intent.userId, matches, meta);
  }
  return matches;
}

/**
 * List a user's persisted realized-P&L ledger, newest sell-fill first.
 * Read path for GET /api/v1/paper/realized.
 */
export async function listRealizedPnlForUser(
  userId: string,
  symbol?: string,
  adapter?: RealizedPnlAdapter | null
): Promise<PersistedRealizedTrade[]> {
  return (adapter ?? getDefaultRealizedPnlAdapter()).listForUser(userId, symbol);
}

// ---------------------------------------------------------------------------
// Fail-open write-failure detection (2026-07-15 Mike audit, tied to blocker #3)
//
// order-driver.ts calls recordRealizedPnlForSell() in a try/catch that must
// never block a sell fill on a ledger-write hiccup (console.error alone). A
// silently-swallowed error means this ledger could be empty from day one with
// nobody noticing. This process-wide counter is the minimal "at least log +
// counter" detection Mike asked for — surfaced additively on
// GET /api/v1/paper/health/detail so ops/Bruce smoke can see it's nonzero.
// A fuller reconciliation job (ledger total vs computeFifoRealizedPnl() live
// recompute, per Mike's 🟡) is a follow-up, not done here.
// ---------------------------------------------------------------------------

let _realizedPnlWriteFailureCount = 0;

/** Called from order-driver.ts's catch block when recordRealizedPnlForSell() throws. */
export function recordRealizedPnlWriteFailure(): void {
  _realizedPnlWriteFailureCount += 1;
}

/** Read path for GET /api/v1/paper/health/detail. */
export function getRealizedPnlWriteFailureCount(): number {
  return _realizedPnlWriteFailureCount;
}

/** Test-only reset. */
export function _resetRealizedPnlWriteFailureCountForTest(): void {
  _realizedPnlWriteFailureCount = 0;
}
