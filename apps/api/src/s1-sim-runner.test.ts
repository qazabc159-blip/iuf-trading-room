/**
 * s1-sim-runner.test.ts
 *
 * New test file (s1-sim-runner.ts previously had no dedicated coverage).
 * Scope, kept minimal per this PR's task (2026-07-23 P0 qty-unit +
 * confirmation-reconciliation fix) — not a full backfill of coverage for
 * the whole module:
 *
 *   - reconcileUnconfirmedS1Orders() — the P0 reconciliation cron wrapper's
 *     fail-safe no-op contract (test env has no DB, so this exercises the
 *     early-return path: never throws, always returns a well-formed zeroed
 *     summary, makes no gateway call).
 *
 * The qty-unit conversion itself (S1 always sends oddLot=false, target_shares
 * always a board-lot multiple of 1000 by construction — see roundDownBoardLot
 * usage in the signal-tick sizing loop) is covered by
 * broker/kgi-contract-rules.test.ts's toKgiOrderQty() tests, which is the
 * actual conversion S1 now routes through.
 *
 * No DB. No broker. No HTTP.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { reconcileUnconfirmedS1Orders } from "./s1-sim-runner.js";

test("reconcileUnconfirmedS1Orders: no-ops safely (returns zeroed summary, no throw) when not in database mode", async () => {
  const summary = await reconcileUnconfirmedS1Orders();
  assert.equal(summary.auditRowFound, false);
  assert.equal(summary.ordersUnconfirmed, 0);
  assert.equal(summary.ordersNewlyConfirmed, 0);
  assert.equal(summary.gatewayUnreachable, false);
  assert.equal(summary.skippedGatewayScheduledOff, false);
});
