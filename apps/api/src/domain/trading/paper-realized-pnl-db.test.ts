// paper-realized-pnl-db.test.ts — 2026-07-15 (Mike audit blocker #3)
//
// The RPNL-* unit tests in paper-ledger-db.test.ts all exercise a Map-based
// RealizedPnlAdapter test double — none of them ever call
// drizzleRealizedPnlAdapter() (the real SQL path). Mike's audit on PR #1276
// independently confirmed via `gh run view <run> --log` that the DB-mode CI
// job's only interaction with paper_realized_pnl was the migration step
// itself (`Applying 0058_paper_realized_pnl.sql`) — no test had ever run a
// real INSERT/SELECT against the table. A silent drizzle type-conversion bug
// would only surface in prod on the very first sell fill, and be swallowed by
// order-driver.ts's fail-open try/catch.
//
// This is a genuine DB-mode regression lock, same lane as
// scheduler-cursor-persistence.test.ts / twse-openapi-client-index-history.test.ts:
// it proves recordRealizedPnlForSell() / listRealizedPnlForUser() work against
// the real paper_realized_pnl table (migration 0058), including the
// UNIQUE(sell_order_id, buy_order_id) constraint actually preventing a
// duplicate row at the DB layer — not merely the application's
// check-then-act pre-check, which cannot defend against a genuine race.
//
// Wired into `pnpm run test:db` (package.json), same lane as the files above.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { eq } from "drizzle-orm";
import { getDb, paperOrders, paperRealizedPnl } from "@iuf-trading-room/db";

import { createOrderIntent } from "./order-intent.js";
import {
  drizzleAdapter,
  upsertOrder,
  recordFill,
  drizzleRealizedPnlAdapter,
  recordRealizedPnlForSell,
  listRealizedPnlForUser,
  matchFifoSellAgainstPriorOrders,
  PAPER_COST_RATES,
  type OrderState,
  type LedgerAdapter
} from "./paper-ledger-db.js";

const TEST_USER_ID = randomUUID();
const createdOrderIds: string[] = [];

after(async () => {
  const db = getDb();
  if (!db) return;
  // paper_realized_pnl rows RESTRICT-block deletion of their referenced
  // orders — delete ledger rows first, then the orders.
  for (const orderId of createdOrderIds) {
    await db.delete(paperRealizedPnl).where(eq(paperRealizedPnl.sellOrderId, orderId)).catch(() => {});
  }
  for (const orderId of createdOrderIds) {
    await db.delete(paperOrders).where(eq(paperOrders.id, orderId)).catch(() => {});
  }
});

async function makeFilledDbOrder(
  ledgerAdapter: LedgerAdapter,
  overrides: Partial<Parameters<typeof createOrderIntent>[0]>,
  fillQty: number,
  fillPrice: number,
  fillTimeIso: string
): Promise<OrderState> {
  const intent = createOrderIntent({
    idempotencyKey: `db-rpnl-${randomUUID()}`,
    symbol: "2330",
    side: "buy",
    orderType: "market",
    qty: 1000,
    quantity_unit: "LOT",
    userId: TEST_USER_ID,
    ...overrides
  });
  await upsertOrder({ intent, fill: null }, ledgerAdapter);
  createdOrderIds.push(intent.id);

  const fill = { fillQty, fillPrice, fillTime: new Date(fillTimeIso) };
  await recordFill(intent.id, fill, ledgerAdapter);

  const filledIntent = { ...intent, status: "FILLED" as const };
  await upsertOrder({ intent: filledIntent, fill }, ledgerAdapter);
  return { intent: filledIntent, fill };
}

test("RPNL-DB-1: recordRealizedPnlForSell + listRealizedPnlForUser round-trip against the real paper_realized_pnl table", async () => {
  const db = getDb();
  assert.ok(db, "this test requires PERSISTENCE_MODE=database with a live Postgres connection");

  const ledgerAdapter = drizzleAdapter(db);
  const rpnlAdapter = drizzleRealizedPnlAdapter(db);

  const buy = await makeFilledDbOrder(ledgerAdapter, { side: "buy" }, 1000, 100, "2026-07-01T02:00:00Z");
  const sell = await makeFilledDbOrder(ledgerAdapter, { side: "sell" }, 1000, 110, "2026-07-02T02:00:00Z");

  const matches = await recordRealizedPnlForSell(sell, [buy], PAPER_COST_RATES, rpnlAdapter);
  assert.equal(matches.length, 1, "one FIFO match: full close of the single buy lot");

  const rows = await listRealizedPnlForUser(TEST_USER_ID, undefined, rpnlAdapter);
  const row = rows.find((r) => r.sellOrderId === sell.intent.id);
  assert.ok(row, "the persisted row must be readable back via listRealizedPnlForUser");
  assert.equal(row.buyOrderId, buy.intent.id, "buyOrderId must cite the exact source buy order (blocker #1)");
  assert.equal(row.sellOrderId, sell.intent.id);
  assert.equal(row.matchedQtyShares, 1000);
  assert.equal(row.buyPrice, 100);
  assert.equal(row.sellPrice, 110);
  // costPerShareWithFee(buy@100) = 100.1425; proceedsPerShare(sell@110) = 109.51325
  // pnl/share = 9.37075 * 1000 = 9370.75 — same math as FIFO-1 in paper-ledger-db.test.ts
  assert.equal(row.realizedPnlTwd, 9370.75);
  // 2026-07-15 migration 0059 regression lock: a call with no `meta` (this
  // test's exact call shape, unchanged from before 0059) still defaults to
  // the legacy pipeline's provenance.
  assert.equal(row.source, "legacy_paper");
  assert.equal(row.accountId, null);
});

test("RPNL-DB-2: UNIQUE(sell_order_id, buy_order_id) prevents a duplicate row at the DB layer, even calling insertMatches twice directly", async () => {
  const db = getDb();
  assert.ok(db, "this test requires PERSISTENCE_MODE=database with a live Postgres connection");

  const ledgerAdapter = drizzleAdapter(db);
  const rpnlAdapter = drizzleRealizedPnlAdapter(db);

  const buy = await makeFilledDbOrder(ledgerAdapter, { side: "buy" }, 500, 50, "2026-07-03T02:00:00Z");
  const sell = await makeFilledDbOrder(ledgerAdapter, { side: "sell" }, 500, 60, "2026-07-04T02:00:00Z");

  const matches = matchFifoSellAgainstPriorOrders(sell, [buy]);
  assert.equal(matches.length, 1);

  // Direct, back-to-back insertMatches() calls — bypasses recordRealizedPnlForSell()'s
  // hasMatchesForSellOrder() pre-check entirely, simulating the exact race Mike's
  // audit flagged (two concurrent driveOrder() invocations for the same fill).
  await rpnlAdapter.insertMatches(TEST_USER_ID, matches);
  await rpnlAdapter.insertMatches(TEST_USER_ID, matches);

  const rows = await listRealizedPnlForUser(TEST_USER_ID, undefined, rpnlAdapter);
  const forThisSell = rows.filter((r) => r.sellOrderId === sell.intent.id);
  assert.equal(
    forThisSell.length,
    1,
    "ON CONFLICT (sell_order_id, buy_order_id) DO NOTHING must hold at the real DB layer"
  );
});

// ---------------------------------------------------------------------------
// Unified order-flow pipeline (migration 0059, 2026-07-15) — order ids from
// broker/paper-broker.ts's in-memory Order/Fill records, which are NEVER
// written to paper_orders (a completely separate id space from the legacy
// order-driver.ts pipeline exercised by RPNL-DB-1/2 above). Built directly as
// OrderState objects (not via makeFilledDbOrder(), which inserts into
// paper_orders) to prove these ids genuinely don't need a paper_orders row —
// migration 0059 dropped the FK specifically to make this possible.
// ---------------------------------------------------------------------------

function makeUnifiedOrderState(
  overrides: { symbol?: string; side: "buy" | "sell" },
  fillQty: number,
  fillPrice: number,
  fillTimeIso: string
): OrderState {
  const id = randomUUID();
  const now = new Date().toISOString();
  createdOrderIds.push(id); // reuse RPNL-DB-1/2's after() cleanup (paper_orders delete no-ops for these)
  return {
    intent: {
      id,
      idempotencyKey: `db-rpnl-unified-${id}`,
      symbol: overrides.symbol ?? "2330",
      side: overrides.side,
      orderType: "limit",
      qty: fillQty,
      quantity_unit: "SHARE",
      price: null,
      userId: TEST_USER_ID,
      status: "FILLED",
      reason: null,
      createdAt: now,
      updatedAt: now
    },
    fill: { fillQty, fillPrice, fillTime: new Date(fillTimeIso) }
  };
}

test("RPNL-DB-3: unified-pipeline order ids (never written to paper_orders) persist and read back correctly — proves migration 0059's FK removal", async () => {
  const db = getDb();
  assert.ok(db, "this test requires PERSISTENCE_MODE=database with a live Postgres connection");
  const rpnlAdapter = drizzleRealizedPnlAdapter(db);

  const buy = makeUnifiedOrderState({ side: "buy" }, 1000, 100, "2026-07-05T02:00:00Z");
  const sell = makeUnifiedOrderState({ side: "sell" }, 1000, 110, "2026-07-06T02:00:00Z");

  // No paper_orders row exists for buy.intent.id / sell.intent.id — if the FK
  // from migration 0058 were still in place, this insert would fail.
  const matches = await recordRealizedPnlForSell(sell, [buy], PAPER_COST_RATES, rpnlAdapter, {
    source: "unified_paper",
    accountId: "primary-desk"
  });
  assert.equal(matches.length, 1);

  const rows = await listRealizedPnlForUser(TEST_USER_ID, undefined, rpnlAdapter);
  const row = rows.find((r) => r.sellOrderId === sell.intent.id);
  assert.ok(row, "unified-pipeline row must be readable back — no FK violation on insert");
  assert.equal(row.buyOrderId, buy.intent.id);
  assert.equal(row.source, "unified_paper");
  assert.equal(row.accountId, "primary-desk");
  assert.equal(row.realizedPnlTwd, 9370.75, "same cost-rate formula as the legacy pipeline (RPNL-DB-1)");
});

test("RPNL-DB-4: unified-pipeline dedup — a re-invoked recordRealizedPnlForSell for the same sell does not duplicate the row at the real DB layer", async () => {
  const db = getDb();
  assert.ok(db, "this test requires PERSISTENCE_MODE=database with a live Postgres connection");
  const rpnlAdapter = drizzleRealizedPnlAdapter(db);

  const buy = makeUnifiedOrderState({ side: "buy" }, 300, 70, "2026-07-07T02:00:00Z");
  const sell = makeUnifiedOrderState({ side: "sell" }, 300, 80, "2026-07-08T02:00:00Z");
  const meta = { source: "unified_paper" as const, accountId: "primary-desk" };

  const first = await recordRealizedPnlForSell(sell, [buy], PAPER_COST_RATES, rpnlAdapter, meta);
  assert.equal(first.length, 1);
  // Simulates fillOrder() being re-invoked for an already-recorded fill (e.g.
  // a retry) — hasMatchesForSellOrder()'s pre-check must short-circuit before
  // ever reaching the DB insert a second time.
  const second = await recordRealizedPnlForSell(sell, [buy], PAPER_COST_RATES, rpnlAdapter, meta);
  assert.deepEqual(second, [], "idempotent no-op on the real DB layer");

  const rows = await listRealizedPnlForUser(TEST_USER_ID, undefined, rpnlAdapter);
  const forThisSell = rows.filter((r) => r.sellOrderId === sell.intent.id);
  assert.equal(forThisSell.length, 1, "no duplicate row from the re-invoked call");
});
