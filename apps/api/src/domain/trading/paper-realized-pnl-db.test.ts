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
