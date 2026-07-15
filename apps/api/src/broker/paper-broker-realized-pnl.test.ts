/**
 * paper-broker-realized-pnl.test.ts — 2026-07-15
 *
 * Bruce's E2E on PR #1276 (reports/sprint_2026_07_15/PAPER_REALIZED_PNL_E2E_2026_07_15.md)
 * found that orders placed through the UNIFIED order-flow pipeline
 * (POST /api/v1/trading/orders -> trading-service.ts -> broker/paper-broker.ts,
 * the path the /desk-exact trading-desk UI actually uses) never reached the
 * migration-0058 realized-P&L ledger — only the legacy POST /api/v1/paper/submit
 * path (order-driver.ts) did.
 *
 * This file tests paper-broker.ts's `recordUnifiedRealizedPnlForSell()` — the
 * exported glue fillOrder() calls on every sell fill — directly, without going
 * through a full placePaperOrder() round trip (which needs live market-data
 * quotes to actually fill an order; out of lane to mock market-data.ts here).
 * The FIFO matching / cost-rate math itself is NOT re-tested here (already
 * covered exhaustively by paper-ledger-db.test.ts's FIFO / RPNL suites) —
 * these tests instead prove the unified-pipeline-specific plumbing:
 *   PB-RPNL-1: buy -> sell in one account persists a ledger row tagged
 *              source='unified_paper' with the correct accountId, hand-calc
 *              PnL identical to the legacy-path formula.
 *   PB-RPNL-2: account boundary — a sell only matches against buy lots the
 *              caller scoped to its own accountId (what fillOrder() does by
 *              construction, since PaperAccountState is per-account).
 *   PB-RPNL-3: dedup — re-invoking with the identical sell/priorFills does not
 *              create a second row.
 *   PB-RPNL-4: a buy order is a no-op (nothing to realize).
 *   PB-RPNL-5: fail-open — an adapter write failure never throws out of
 *              recordUnifiedRealizedPnlForSell() (must not block a fill) and
 *              increments the process-wide write-failure counter (surfaced at
 *              GET /api/v1/paper/health/detail).
 *   PB-RPNL-6: source assertion — fillOrder()'s priorFills is built from this
 *              account's own PaperAccountState maps, not any cross-account or
 *              global list (the actual account-boundary enforcement point;
 *              PB-RPNL-2 tests the isolated function assuming the caller
 *              scopes correctly, this test proves the caller itself does).
 *   PB-RPNL-7: end-to-end reconciliation (Pete review 🔴 #1, 2026-07-15) — a
 *              REAL buy -> sell round trip through placePaperOrder() (the
 *              exact function trading-service.ts calls for /desk-exact
 *              orders), seeded with a real twse_mis quote via market-data.ts's
 *              own public upsertTwseMisQuotes() API (no market-data.ts
 *              internals touched). Proves listUnifiedFillsAsOrderStates()
 *              (the function server.ts's /paper/portfolio + /paper/fills now
 *              merge in) and the persisted /paper/realized ledger produce
 *              IDENTICAL realized-PnL totals for the same trade sequence —
 *              the literal acceptance bar Elva set for this fix.
 *   PB-RPNL-8: zero-prior-fills counter (Pete review 🟡 #1) — a sell with no
 *              prior fills in its account increments a dedicated counter
 *              (surfaced at GET /api/v1/paper/health/detail), distinguishing
 *              "in-memory state was lost" from an ordinary 0-match short sale.
 *
 * Run:
 *   node --import ./tests/setup-test-env.mjs --import tsx --test \
 *     apps/api/src/broker/paper-broker-realized-pnl.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import test, { beforeEach } from "node:test";

import type { AppSession, Fill, Order } from "@iuf-trading-room/contracts";

import {
  recordUnifiedRealizedPnlForSell,
  listUnifiedFillsAsOrderStates,
  placePaperOrder
} from "./paper-broker.js";
import { resetMarketDataWorkspaceState, upsertTwseMisQuotes } from "../market-data.js";
import {
  _setDefaultRealizedPnlAdapterForTest,
  _resetRealizedPnlWriteFailureCountForTest,
  _resetRealizedPnlZeroPriorFillsSellCountForTest,
  getRealizedPnlWriteFailureCount,
  getRealizedPnlZeroPriorFillsSellCount,
  listRealizedPnlForUser,
  computeFifoRealizedPnl,
  type RealizedPnlAdapter,
  type PersistedRealizedTrade
} from "../domain/trading/paper-ledger-db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeSession(userId: string): AppSession {
  return {
    workspace: { id: randomUUID(), name: "test", slug: "test" },
    user: { id: userId, name: "Test User", email: "test@example.com", role: "Owner" },
    persistenceMode: "memory"
  };
}

let orderSeq = 0;

function makeOrder(overrides: Partial<Order> & { accountId: string; side: "buy" | "sell" }): Order {
  orderSeq += 1;
  const now = new Date(2026, 6, 15, 2, 0, 0, orderSeq).toISOString();
  return {
    id: randomUUID(),
    clientOrderId: `po-${orderSeq}`,
    brokerOrderId: `PAPER-${orderSeq}`,
    broker: "paper",
    symbol: "2330",
    type: "limit",
    timeInForce: "rod",
    quantity: 1000,
    filledQuantity: 1000,
    price: null,
    stopPrice: null,
    avgFillPrice: null,
    status: "filled",
    reason: null,
    tradePlanId: null,
    strategyId: null,
    riskCheckId: null,
    submittedAt: now,
    acknowledgedAt: now,
    filledAt: now,
    canceledAt: null,
    quoteContext: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function makeFill(order: Order, price: number, timestamp: string): Fill {
  return {
    id: randomUUID(),
    orderId: order.id,
    clientOrderId: order.clientOrderId,
    accountId: order.accountId,
    symbol: order.symbol,
    side: order.side,
    quantity: order.quantity,
    price,
    fee: 0,
    tax: 0,
    timestamp,
    quoteContext: null
  };
}

beforeEach(() => {
  // Fresh in-memory adapter + counters per test — the module-level
  // singleton (getDefaultRealizedPnlAdapter()) would otherwise leak rows
  // across tests in the same process.
  _setDefaultRealizedPnlAdapterForTest(null);
  _resetRealizedPnlWriteFailureCountForTest();
  _resetRealizedPnlZeroPriorFillsSellCountForTest();
});

test("PB-RPNL-1: buy -> sell in one account persists a source='unified_paper' row with hand-calc-matching PnL", async () => {
  const session = makeSession(randomUUID());
  const buyOrder = makeOrder({ accountId: "primary-desk", side: "buy" });
  const buyFill = makeFill(buyOrder, 100, "2026-07-01T02:00:00Z");
  const sellOrder = makeOrder({ accountId: "primary-desk", side: "sell" });
  const sellFill = makeFill(sellOrder, 110, "2026-07-02T02:00:00Z");

  await recordUnifiedRealizedPnlForSell(session, sellOrder, sellFill, [
    { order: buyOrder, fill: buyFill }
  ]);

  const rows = await listRealizedPnlForUser(session.user.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.source, "unified_paper");
  assert.equal(rows[0]?.accountId, "primary-desk");
  assert.equal(rows[0]?.buyOrderId, buyOrder.id);
  assert.equal(rows[0]?.sellOrderId, sellOrder.id);
  // costPerShareWithFee(buy@100) = 100.1425; proceedsPerShare(sell@110) = 109.51325
  // pnl/share = 9.37075 * 1000 = 9370.75 — same formula as paper-ledger-db.test.ts's FIFO-1/RPNL-1.
  assert.equal(rows[0]?.realizedPnlTwd, 9370.75);
});

test("PB-RPNL-2: a sell only matches buy lots the caller scoped to its own accountId", async () => {
  const userId = randomUUID();
  const sessionA = makeSession(userId);

  // Two different accounts for the same user, same symbol, deliberately
  // different buy prices so a cross-account leak would be detectable.
  const buyA = makeOrder({ accountId: "account-a", side: "buy" });
  const buyFillA = makeFill(buyA, 100, "2026-07-01T02:00:00Z");
  const buyB = makeOrder({ accountId: "account-b", side: "buy" });
  const buyFillB = makeFill(buyB, 9999, "2026-07-01T02:00:00Z"); // never passed in below

  const sellA = makeOrder({ accountId: "account-a", side: "sell" });
  const sellFillA = makeFill(sellA, 110, "2026-07-02T02:00:00Z");

  // Caller (mirroring fillOrder()) passes ONLY account-a's prior fills.
  await recordUnifiedRealizedPnlForSell(sessionA, sellA, sellFillA, [
    { order: buyA, fill: buyFillA }
  ]);

  const rows = await listRealizedPnlForUser(userId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.buyOrderId, buyA.id, "matched buy must be account-a's, never account-b's");
  assert.equal(rows[0]?.buyPrice, 100, "buyPrice must be account-a's 100, not account-b's 9999");
  void buyB;
  void buyFillB;
});

test("PB-RPNL-3: re-invoking with identical sell/priorFills does not create a second row", async () => {
  const session = makeSession(randomUUID());
  const buyOrder = makeOrder({ accountId: "primary-desk", side: "buy" });
  const buyFill = makeFill(buyOrder, 100, "2026-07-01T02:00:00Z");
  const sellOrder = makeOrder({ accountId: "primary-desk", side: "sell" });
  const sellFill = makeFill(sellOrder, 110, "2026-07-02T02:00:00Z");
  const priorFills = [{ order: buyOrder, fill: buyFill }];

  await recordUnifiedRealizedPnlForSell(session, sellOrder, sellFill, priorFills);
  await recordUnifiedRealizedPnlForSell(session, sellOrder, sellFill, priorFills);

  const rows = await listRealizedPnlForUser(session.user.id);
  assert.equal(rows.length, 1, "second call (e.g. a re-invoked fillOrder) must not duplicate the row");
});

test("PB-RPNL-4: a buy order is a no-op", async () => {
  const session = makeSession(randomUUID());
  const buyOrder = makeOrder({ accountId: "primary-desk", side: "buy" });
  const buyFill = makeFill(buyOrder, 100, "2026-07-01T02:00:00Z");

  await recordUnifiedRealizedPnlForSell(session, buyOrder, buyFill, []);

  const rows = await listRealizedPnlForUser(session.user.id);
  assert.equal(rows.length, 0);
});

test("PB-RPNL-5: an adapter write failure is fail-open (never throws) and increments the counter", async () => {
  const throwingAdapter: RealizedPnlAdapter = {
    async hasMatchesForSellOrder(): Promise<boolean> {
      return false;
    },
    async insertMatches(): Promise<void> {
      throw new Error("simulated DB write failure");
    },
    async listForUser(): Promise<PersistedRealizedTrade[]> {
      return [];
    }
  };
  _setDefaultRealizedPnlAdapterForTest(throwingAdapter);

  const session = makeSession(randomUUID());
  const buyOrder = makeOrder({ accountId: "primary-desk", side: "buy" });
  const buyFill = makeFill(buyOrder, 100, "2026-07-01T02:00:00Z");
  const sellOrder = makeOrder({ accountId: "primary-desk", side: "sell" });
  const sellFill = makeFill(sellOrder, 110, "2026-07-02T02:00:00Z");

  assert.equal(getRealizedPnlWriteFailureCount(), 0);

  // Must resolve, not reject — a ledger-write hiccup must never block the fill.
  await recordUnifiedRealizedPnlForSell(session, sellOrder, sellFill, [
    { order: buyOrder, fill: buyFill }
  ]);

  assert.equal(getRealizedPnlWriteFailureCount(), 1);
});

test("PB-RPNL-6 (source assertion): fillOrder()'s priorFills is built from this account's own state.fills/state.orders, not a cross-account or global source", () => {
  const src = readFileSync(path.join(__dirname, "paper-broker.ts"), "utf8");
  const anchor = src.indexOf("if (updated.status === \"filled\" && updated.side === \"sell\")");
  assert.ok(anchor >= 0, "expected the realized-P&L hook inside fillOrder()");
  const window = src.slice(anchor, anchor + 600);
  assert.match(
    window,
    /for \(const f of state\.fills\)/,
    "priorFills must iterate this call's own account-scoped `state.fills` (getOrCreateAccount(session, accountId)), not a cross-account list"
  );
  assert.match(
    window,
    /state\.orders\.get\(f\.orderId\)/,
    "priorFills must resolve orders via this same account's own `state.orders` map"
  );
});

// ---------------------------------------------------------------------------
// PB-RPNL-7/8: 2026-07-15 Pete review follow-ups (real placePaperOrder() round
// trip + zero-prior-fills counter). Needs a temp MARKET_DATA_STORE_DIR + a
// unique workspace slug per test, same pattern as
// __tests__/paper-quotegate-mis-source.test.ts.
// ---------------------------------------------------------------------------

async function withTempMarketDataStore(run: () => Promise<void>): Promise<void> {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-paper-broker-reconcile-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;
  try {
    await run();
  } finally {
    if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
    else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
    await rm(storeDir, { recursive: true, force: true });
  }
}

function makeUniqueSession(slug: string): AppSession {
  return {
    workspace: { id: randomUUID(), name: slug, slug },
    user: { id: randomUUID(), name: "Test User", email: "test@example.com", role: "Owner" },
    persistenceMode: "memory"
  };
}

function freshTwseMisQuote(symbol: string) {
  return {
    symbol,
    market: "TWSE" as const,
    source: "twse_mis" as const,
    last: 100,
    bid: 99.5,
    ask: 100.5,
    open: 100,
    high: 101,
    low: 99,
    prevClose: 99,
    volume: 1000,
    changePct: 1.01,
    timestamp: new Date().toISOString()
  };
}

test("PB-RPNL-7: real placePaperOrder() buy->sell round trip — listUnifiedFillsAsOrderStates() and the persisted /paper/realized ledger reconcile to the same total (Elva's acceptance bar for Pete's 🔴 #1)", async () => {
  await withTempMarketDataStore(async () => {
    const slug = `pb-rpnl-7-${randomUUID()}`;
    const session = makeUniqueSession(slug);
    resetMarketDataWorkspaceState(slug);
    try {
      // Seed a fresh, paper-safe quote via market-data.ts's own public API
      // (upsertTwseMisQuotes) — no market-data.ts internals touched.
      await upsertTwseMisQuotes({ session, quotes: [freshTwseMisQuote("2330")] });

      const accountId = `account-${randomUUID()}`;
      const buyResult = await placePaperOrder({
        session,
        order: {
          accountId,
          symbol: "2330",
          side: "buy",
          type: "limit",
          timeInForce: "rod",
          quantity: 1000,
          quantity_unit: "SHARE",
          price: 101, // >= ask (100.5) so a buy limit fills immediately at markPrice
          stopPrice: null,
          tradePlanId: null,
          strategyId: null,
          clientOrderId: `pb-rpnl-7-buy-${randomUUID()}`,
          overrideGuards: [],
          overrideReason: ""
        },
        riskCheckId: null
      });
      assert.equal(buyResult.status, "filled", "buy must fill immediately against the seeded quote");

      const sellResult = await placePaperOrder({
        session,
        order: {
          accountId,
          symbol: "2330",
          side: "sell",
          type: "limit",
          timeInForce: "rod",
          quantity: 1000,
          quantity_unit: "SHARE",
          price: 90, // <= bid (99.5) so a sell limit fills immediately at markPrice
          stopPrice: null,
          tradePlanId: null,
          strategyId: null,
          clientOrderId: `pb-rpnl-7-sell-${randomUUID()}`,
          overrideGuards: [],
          overrideReason: ""
        },
        riskCheckId: null
      });
      assert.equal(sellResult.status, "filled", "sell must fill immediately against the seeded quote");

      // What server.ts's /paper/portfolio and /paper/fills now read (merged
      // legacy+unified — this test only exercises the unified side).
      const unifiedStates = await listUnifiedFillsAsOrderStates(session);
      assert.equal(unifiedStates.length, 2, "both the buy and sell fill must be present");
      const liveFifo = computeFifoRealizedPnl(unifiedStates);

      // What GET /api/v1/paper/realized reads — the FORMAL persisted ledger
      // row written at fill-time by recordUnifiedRealizedPnlForSell().
      const persistedRows = await listRealizedPnlForUser(session.user.id);
      assert.equal(persistedRows.length, 1, "one FIFO-matched trade");
      assert.equal(persistedRows[0]?.source, "unified_paper");
      assert.equal(persistedRows[0]?.accountId, accountId);

      const persistedTotal = persistedRows.reduce((acc, r) => acc + r.realizedPnlTwd, 0);

      // THE reconciliation identity Elva's acceptance bar demands: the live
      // recompute (what /paper/portfolio shows) and the persisted ledger
      // (what /paper/realized shows) must agree for a single-pipeline trade.
      // (Exact price not hand-derived here — market-data.ts's decision
      // summary is a separate, out-of-lane subsystem whose bid/ask
      // passthrough precision isn't this test's concern; the cost-rate FIFO
      // formula itself is already hand-verified against a real Postgres
      // table by paper-realized-pnl-db.test.ts's RPNL-DB-3/RPNL-DB-1, which
      // use fully synthetic, controlled prices with no market-data
      // dependency. This test's job is proving the two READ PATHS agree with
      // EACH OTHER for whatever price the fill actually executed at.)
      assert.equal(
        liveFifo.totalRealizedPnlTwd,
        persistedTotal,
        "listUnifiedFillsAsOrderStates()-derived live FIFO total must equal the persisted /paper/realized ledger total"
      );
      assert.ok(
        liveFifo.totalRealizedPnlTwd < 0,
        "sanity: selling at bid right after buying at ask must realize a small loss (spread + fees), not a gain"
      );
      assert.equal(persistedRows[0]?.realizedPnlTwd, liveFifo.totalRealizedPnlTwd);
    } finally {
      resetMarketDataWorkspaceState(slug);
    }
  });
});

test("PB-RPNL-8: a sell with zero prior fills in its account increments the zero-prior-fills counter (distinguishes lost state from an ordinary short sale)", async () => {
  assert.equal(getRealizedPnlZeroPriorFillsSellCount(), 0);

  const session = makeSession(randomUUID());
  const sellOrder = makeOrder({ accountId: "primary-desk", side: "sell" });
  const sellFill = makeFill(sellOrder, 110, "2026-07-02T02:00:00Z");

  await recordUnifiedRealizedPnlForSell(session, sellOrder, sellFill, []);

  assert.equal(getRealizedPnlZeroPriorFillsSellCount(), 1);

  // A sell WITH prior fills must NOT increment this counter (regression lock —
  // only the zero-prior-fills case is counted, not every sell).
  const buyOrder = makeOrder({ accountId: "primary-desk", side: "buy" });
  const buyFill = makeFill(buyOrder, 100, "2026-07-01T02:00:00Z");
  const sellOrder2 = makeOrder({ accountId: "primary-desk", side: "sell" });
  const sellFill2 = makeFill(sellOrder2, 110, "2026-07-03T02:00:00Z");
  await recordUnifiedRealizedPnlForSell(session, sellOrder2, sellFill2, [
    { order: buyOrder, fill: buyFill }
  ]);
  assert.equal(getRealizedPnlZeroPriorFillsSellCount(), 1, "unchanged — this sell had a prior fill to match");
});
