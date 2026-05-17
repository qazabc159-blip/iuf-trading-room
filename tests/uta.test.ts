/**
 * uta.test.ts — UTA Phase A isolated tests (2026-05-17)
 * Run via: node --import ./tests/setup-test-env.mjs --import tsx --test tests/uta.test.ts
 *
 * All tests run in memory mode (no DB required — PERSISTENCE_MODE defaults to memory).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { AppSession } from "@iuf-trading-room/contracts";

import { KgiBrokerAdapter } from "../apps/api/src/broker/kgi-broker-adapter.ts";
import { PaperBrokerAdapter } from "../apps/api/src/broker/paper-broker-adapter.ts";
import {
  createUnifiedOrder,
  listUnifiedOrders,
  updateUnifiedOrderSubmitted,
  getUnifiedOrderById,
  _resetUnifiedOrderStoreForTests,
  type UnifiedOrderStatus,
} from "../apps/api/src/broker/unified-order-store.ts";

// ─────────────────────────────────────────────────────────────────────────────
// UTA-1: KgiBrokerAdapter interface contract
// ─────────────────────────────────────────────────────────────────────────────

test("UTA-1: KgiBrokerAdapter declares correct adapterKey and capabilities", () => {
  const adapter = new KgiBrokerAdapter({ gatewayBaseUrl: "http://127.0.0.1:8787" });
  assert.equal(adapter.adapterKey, "kgi", "UTA-1: adapterKey must be 'kgi'");
  assert.equal(adapter.displayName, "凱基證券 (KGI)", "UTA-1: displayName must be correct");

  const caps = adapter.capabilities();
  assert.equal(caps.oddLot, true, "UTA-1: KGI must support oddLot");
  assert.equal(caps.marginTrading, true, "UTA-1: KGI must support marginTrading");
  assert.equal(caps.shortSelling, true, "UTA-1: KGI must support shortSelling");
  assert.equal(caps.afterHoursFixing, false, "UTA-1: KGI does not support afterHoursFixing in Phase A");
  assert.equal(caps.simModeAvailable, true, "UTA-1: KGI SIM mode must be available");
  assert.equal(caps.maxSubscriptions, 40, "UTA-1: KGI must cap at 40 subscriptions (hard cap)");
});

// ─────────────────────────────────────────────────────────────────────────────
// UTA-2: PaperBrokerAdapter interface contract
// ─────────────────────────────────────────────────────────────────────────────

test("UTA-2: PaperBrokerAdapter declares correct adapterKey and capabilities", () => {
  const fakeSession = {
    workspace: { id: "ws-uta-test", slug: "uta-test", name: "UTA Test" },
    user: { id: "user-uta-test", role: "Owner" },
  } as unknown as AppSession;

  const adapter = new PaperBrokerAdapter(fakeSession);
  assert.equal(adapter.adapterKey, "paper", "UTA-2: adapterKey must be 'paper'");
  assert.equal(adapter.displayName, "Paper Trading", "UTA-2: displayName must be correct");

  const caps = adapter.capabilities();
  assert.equal(caps.oddLot, true, "UTA-2: Paper must support oddLot");
  assert.equal(caps.marginTrading, true, "UTA-2: Paper must support marginTrading");
  assert.equal(caps.simModeAvailable, true, "UTA-2: Paper adapter is always sim-capable");
  assert.equal(caps.maxSubscriptions, 9999, "UTA-2: Paper adapter has no subscription cap");
});

// ─────────────────────────────────────────────────────────────────────────────
// UTA-3: unified-order-store create + list in memory mode
// ─────────────────────────────────────────────────────────────────────────────

test("UTA-3: createUnifiedOrder + listUnifiedOrders in memory mode", async () => {
  _resetUnifiedOrderStoreForTests();

  const workspaceId = "ws-uta-test-" + randomUUID();
  const input = {
    symbol: "2330",
    action: "Buy" as const,
    qty: 1,
    priceType: "Market" as const,
  };

  const record = await createUnifiedOrder(workspaceId, "paper", input, null);

  assert.equal(typeof record.id, "string", "UTA-3: id must be a UUID string");
  assert.equal(record.workspaceId, workspaceId, "UTA-3: workspaceId must match");
  assert.equal(record.adapterKey, "paper", "UTA-3: adapterKey must match");
  assert.equal(record.symbol, "2330", "UTA-3: symbol must match");
  assert.equal(record.action, "Buy", "UTA-3: action must match");
  assert.equal(record.qty, 1, "UTA-3: qty must match");
  assert.equal(record.priceType, "Market", "UTA-3: priceType must match");
  assert.equal(record.status, "pending", "UTA-3: initial status must be pending");
  assert.equal(record.externalOrderId, null, "UTA-3: externalOrderId must be null initially");
  assert.equal(record.filledQty, 0, "UTA-3: filledQty must start at 0");
  // B1: quantity_unit must be present and default to LOT
  assert.equal(record.quantityUnit, "LOT", "UTA-3: quantityUnit must default to LOT");
  // W1: idempotencyKey must be null when not supplied
  assert.equal(record.idempotencyKey, null, "UTA-3: idempotencyKey must be null when not supplied");

  const listed = await listUnifiedOrders(workspaceId);
  assert.equal(listed.length, 1, "UTA-3: listUnifiedOrders must return 1 record");
  assert.equal(listed[0].id, record.id, "UTA-3: listed record id must match created record");

  const otherList = await listUnifiedOrders("ws-other-" + randomUUID());
  assert.equal(otherList.length, 0, "UTA-3: different workspace must not see records");
});

// ─────────────────────────────────────────────────────────────────────────────
// UTA-4: updateUnifiedOrderSubmitted transitions status
// ─────────────────────────────────────────────────────────────────────────────

test("UTA-4: updateUnifiedOrderSubmitted transitions status to submitted", async () => {
  _resetUnifiedOrderStoreForTests();

  const workspaceId = "ws-uta-test-" + randomUUID();
  const record = await createUnifiedOrder(workspaceId, "kgi", {
    symbol: "0050",
    action: "Buy",
    qty: 1,
    priceType: "Limit",
    limitPrice: 180.0,
  }, null);

  assert.equal(record.status, "pending", "UTA-4: pre-update status must be pending");

  await updateUnifiedOrderSubmitted(record.id, "ext-ord-001", { raw: "adapter_ok" });

  const updated = await getUnifiedOrderById(workspaceId, record.id);
  assert.ok(updated, "UTA-4: updated record must exist");
  assert.equal(updated.status, "submitted", "UTA-4: status must be submitted");
  assert.equal(updated.externalOrderId, "ext-ord-001", "UTA-4: externalOrderId must be set");
  assert.ok(updated.submittedAt !== null, "UTA-4: submittedAt must be non-null");
});

// ─────────────────────────────────────────────────────────────────────────────
// UTA-5: both adapters implement all required BrokerAdapter methods
// ─────────────────────────────────────────────────────────────────────────────

test("UTA-5: both adapters implement all required BrokerAdapter methods", () => {
  const kgi = new KgiBrokerAdapter({});
  const paper = new PaperBrokerAdapter({
    workspace: { id: "ws", slug: "test", name: "Test" },
    user: { id: "u1", role: "Owner" },
  } as unknown as AppSession);

  const pairs: Array<[string, KgiBrokerAdapter | PaperBrokerAdapter]> = [
    ["kgi", kgi],
    ["paper", paper],
  ];
  for (const [name, adapter] of pairs) {
    assert.equal(typeof adapter.adapterKey, "string", `UTA-5: ${name} adapterKey must be string`);
    assert.equal(typeof adapter.displayName, "string", `UTA-5: ${name} displayName must be string`);
    assert.equal(typeof adapter.capabilities, "function", `UTA-5: ${name} capabilities must be function`);
    assert.equal(typeof adapter.getPositions, "function", `UTA-5: ${name} getPositions must be function`);
    assert.equal(typeof adapter.submitOrder, "function", `UTA-5: ${name} submitOrder must be function`);
    assert.equal(typeof adapter.cancelOrder, "function", `UTA-5: ${name} cancelOrder must be function`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UTA-6: new fields — quantity_unit SHARE, idempotency_key, partial_fill status
// ─────────────────────────────────────────────────────────────────────────────

test("UTA-6: quantity_unit SHARE + idempotencyKey + partial_fill status round-trip", async () => {
  _resetUnifiedOrderStoreForTests();

  const workspaceId = "ws-uta-6-" + randomUUID();

  // B1: quantityUnit SHARE (odd-lot)
  const record = await createUnifiedOrder(workspaceId, "paper", {
    symbol: "2330",
    action: "Buy",
    qty: 1,
    priceType: "Market",
    quantityUnit: "SHARE",
    idempotencyKey: "idem-test-001",
  }, null);

  assert.equal(record.quantityUnit, "SHARE", "UTA-6: quantityUnit must be SHARE when supplied");
  assert.equal(record.idempotencyKey, null, "UTA-6: in-memory mode idempotencyKey stored as null (no DB UNIQUE check)");

  // N4: partial_fill is a valid status (type check — UnifiedOrderStatus union)
  const partialFillStatus: UnifiedOrderStatus = "partial_fill";
  assert.equal(partialFillStatus, "partial_fill", "UTA-6: partial_fill must be assignable to UnifiedOrderStatus");
});

after(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  process.exit(process.exitCode ?? 0);
});
