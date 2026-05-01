/**
 * idempotency-race.test.ts — T05 Concurrent Idempotency Race
 *
 * Purpose: Prove that N concurrent paper-order submissions with the same
 * idempotencyKey produce exactly 1 persisted order (1 created + N-1 deduped).
 *
 * Approach: Drives the in-memory domain layer directly (no HTTP, no DB).
 * Simulates the route handler logic:
 *   - _registerIdempotencyKey() = in-memory pre-check (same as server.ts line ~2749)
 *   - driveOrder()              = full PENDING→FILLED pipeline
 *   - listOrders()              = ledger read to count persisted entries
 *
 * Stop-line guarantee: NO kgi import / broker.submit / live.submit / order/create.
 * This file is pure domain-layer harness.
 *
 * Run:
 *   node --import tsx/esm apps/api/src/__tests__/idempotency-race.test.ts
 *
 * Or via root:
 *   node --import tsx --test apps/api/src/__tests__/idempotency-race.test.ts
 *
 * Expected output on PASS:
 *   RESULT: PASS  created=1 deduped=4 persisted=1  (for n=5)
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createOrderIntent,
  _registerIdempotencyKey,
  _clearIdempotencyKeys
} from "../domain/trading/order-intent.js";

import { driveOrder } from "../domain/trading/order-driver.js";

import {
  listOrders,
  _clearLedger
} from "../domain/trading/paper-ledger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-0000-0000-000000000099";
const TEST_SYMBOL  = "2330";
const IDEM_KEY     = "t05-race-fixed-key-2026-05-01";

/**
 * Simulate what the route handler does for a single submission attempt:
 *   1. Check idempotency key (in-memory Set)
 *   2. If duplicate → return { outcome: "deduped" }
 *   3. If new → createOrderIntent + driveOrder → return { outcome: "created", id }
 *
 * This mirrors server.ts POST /api/v1/paper/orders logic (idempotency block ~line 2749).
 */
async function simulateSubmit(idempotencyKey: string): Promise<
  | { outcome: "created"; orderId: string }
  | { outcome: "deduped" }
  | { outcome: "rejected"; reason: string }
  | { outcome: "error"; message: string }
> {
  // Step 1: idempotency pre-check (mirrors _registerIdempotencyKey call in route)
  const registered = _registerIdempotencyKey(idempotencyKey);
  if (!registered) {
    return { outcome: "deduped" };
  }

  // Step 2: build intent (mirrors createOrderIntent call in route)
  const intent = createOrderIntent({
    idempotencyKey,
    symbol: TEST_SYMBOL,
    side: "buy",
    orderType: "limit",
    qty: 1,
    quantity_unit: "SHARE",
    price: 800,
    userId: TEST_USER_ID
  });

  // Step 3: drive order through pipeline (mirrors driveOrder call in route)
  try {
    const result = await driveOrder(intent);
    if (result.finalState.intent.status === "FILLED") {
      return { outcome: "created", orderId: intent.id };
    }
    return {
      outcome: "rejected",
      reason: result.rejectionReason ?? result.finalState.intent.status
    };
  } catch (err) {
    return { outcome: "error", message: String(err) };
  }
}

// ---------------------------------------------------------------------------
// T05-A: Sequential baseline (n=5, same key) — proves logic before concurrency
// ---------------------------------------------------------------------------

test("T05-A: sequential n=5 same idempotencyKey → 1 created + 4 deduped", async () => {
  _clearLedger();
  _clearIdempotencyKeys();

  const n = 5;
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(await simulateSubmit(IDEM_KEY));
  }

  const created = results.filter(r => r.outcome === "created").length;
  const deduped  = results.filter(r => r.outcome === "deduped").length;
  const rejected = results.filter(r => r.outcome === "rejected").length;
  const errors   = results.filter(r => r.outcome === "error").length;

  console.log(`  T05-A sequential: created=${created} deduped=${deduped} rejected=${rejected} errors=${errors}`);

  assert.equal(created,  1,    `expected 1 created, got ${created}`);
  assert.equal(deduped,  n-1,  `expected ${n-1} deduped, got ${deduped}`);
  assert.equal(rejected, 0,    `expected 0 rejected, got ${rejected}`);
  assert.equal(errors,   0,    `expected 0 errors, got ${errors}`);

  // Verify ledger count
  const persisted = listOrders(TEST_USER_ID);
  assert.equal(persisted.length, 1, `expected 1 persisted order, got ${persisted.length}`);
  assert.equal(persisted[0]!.intent.idempotencyKey, IDEM_KEY);
  assert.equal(persisted[0]!.intent.status, "FILLED");

  console.log(`  T05-A persisted=1 (${persisted[0]!.intent.status}) PASS`);
});

// ---------------------------------------------------------------------------
// T05-B: Concurrent race (n=5, same key) — the actual T05 scenario
// ---------------------------------------------------------------------------

test("T05-B: concurrent n=5 Promise.all same idempotencyKey → 1 created + 4 deduped", async () => {
  _clearLedger();
  _clearIdempotencyKeys();

  const n = 5;
  const idemKey = "t05-race-concurrent-key-2026-05-01";

  // Fire N promises simultaneously — this is the race condition being tested.
  // The in-memory Set is synchronous, so the first to call _registerIdempotencyKey wins.
  const results = await Promise.all(
    Array.from({ length: n }, () => simulateSubmit(idemKey))
  );

  const created = results.filter(r => r.outcome === "created").length;
  const deduped  = results.filter(r => r.outcome === "deduped").length;
  const rejected = results.filter(r => r.outcome === "rejected").length;
  const errors   = results.filter(r => r.outcome === "error").length;

  console.log(`  T05-B concurrent: created=${created} deduped=${deduped} rejected=${rejected} errors=${errors}`);

  assert.equal(created,  1,    `expected 1 created, got ${created} — idempotency race condition broken`);
  assert.equal(deduped,  n-1,  `expected ${n-1} deduped, got ${deduped}`);
  assert.equal(rejected, 0,    `expected 0 rejected, got ${rejected}`);
  assert.equal(errors,   0,    `expected 0 errors, got ${errors}`);

  // Verify exactly 1 order in ledger
  const persisted = listOrders(TEST_USER_ID);
  assert.equal(persisted.length, 1,
    `expected 1 persisted order, got ${persisted.length} — ledger has duplicates`);
  assert.equal(persisted[0]!.intent.idempotencyKey, idemKey);
  assert.equal(persisted[0]!.intent.status, "FILLED");

  console.log(`  T05-B persisted=1 (${persisted[0]!.intent.status}) PASS`);
  console.log(`  RESULT: PASS  created=${created} deduped=${deduped} persisted=${persisted.length}`);
});

// ---------------------------------------------------------------------------
// T05-C: Higher concurrency n=10 — stress test
// ---------------------------------------------------------------------------

test("T05-C: concurrent n=10 Promise.all same idempotencyKey → 1 created + 9 deduped", async () => {
  _clearLedger();
  _clearIdempotencyKeys();

  const n = 10;
  const idemKey = "t05-race-n10-key-2026-05-01";

  const results = await Promise.all(
    Array.from({ length: n }, () => simulateSubmit(idemKey))
  );

  const created = results.filter(r => r.outcome === "created").length;
  const deduped  = results.filter(r => r.outcome === "deduped").length;

  console.log(`  T05-C n=10: created=${created} deduped=${deduped}`);

  assert.equal(created, 1,   `expected 1 created, got ${created}`);
  assert.equal(deduped, n-1, `expected ${n-1} deduped, got ${deduped}`);

  const persisted = listOrders(TEST_USER_ID);
  assert.equal(persisted.length, 1, `expected 1 persisted, got ${persisted.length}`);

  console.log(`  T05-C persisted=1 PASS`);
});

// ---------------------------------------------------------------------------
// T05-D: Different keys produce separate orders (sanity check)
// ---------------------------------------------------------------------------

test("T05-D: n=5 different idempotencyKeys → 5 created + 0 deduped", async () => {
  _clearLedger();
  _clearIdempotencyKeys();

  const n = 5;
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      simulateSubmit(`t05-unique-key-${i}-2026-05-01`)
    )
  );

  const created = results.filter(r => r.outcome === "created").length;
  const deduped  = results.filter(r => r.outcome === "deduped").length;

  console.log(`  T05-D different keys: created=${created} deduped=${deduped}`);

  assert.equal(created, n, `expected ${n} created, got ${created}`);
  assert.equal(deduped, 0, `expected 0 deduped, got ${deduped}`);

  const persisted = listOrders(TEST_USER_ID);
  assert.equal(persisted.length, n, `expected ${n} persisted, got ${persisted.length}`);

  console.log(`  T05-D persisted=${n} PASS`);
});
