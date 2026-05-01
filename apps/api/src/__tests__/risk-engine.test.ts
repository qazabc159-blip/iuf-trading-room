/**
 * risk-engine.test.ts — W7 P0 Demo: absolute notional cap (max_absolute_notional)
 *
 * Coverage:
 *   R1: SHARE qty=300 price=800 → notional=240,000 TWD → BLOCK max_absolute_notional
 *   R2: SHARE qty=1 price=800 → notional=800 TWD → NOT blocked by max_absolute_notional
 *   R3: LOT qty=1 price=800 → notional treated as 800,000 TWD (×1000) → NOT blocked by
 *       max_absolute_notional (LOT orders are not subject to the 20k TWD demo cap)
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/risk-engine.test.ts
 *
 * Hard lines:
 *   - NO /order/create URL
 *   - NO KGI SDK import
 *   - NO network calls (market quote is provided inline via market.quote)
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { AppSession } from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";

import { evaluateRiskCheck } from "../risk-engine.js";

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

/** Minimal AppSession for paper account tests — Trader role, paper workspace. */
function makeSession(): AppSession {
  return {
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "test@paper.local",
      name: "Paper Test",
      role: "Trader"
    },
    workspace: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Paper Test Workspace",
      slug: "risk-test-workspace"
    },
    persistenceMode: "memory"
  } as unknown as AppSession;
}

/** Minimal TradingRoomRepository — only listCompanies is called by risk engine. */
function makeRepo(): TradingRoomRepository {
  return {
    listCompanies: async () => []
  } as unknown as TradingRoomRepository;
}

// Fixed "now" during TWSE trading hours: 2026-05-05 09:30 TST = 01:30 UTC
const TRADING_NOW = "2026-05-05T01:30:00.000Z";

/** Inline quote context so we don't need live market data. */
function makeMarketContext(price: number) {
  return {
    source: "manual",
    // Provide the price inline so resolveQuoteForRiskCheck uses it directly.
    // Use the same timestamp as TRADING_NOW to avoid stale_quote guard.
    quote: {
      symbol: "2330",
      market: "TWSE",
      source: "manual",
      last: price,
      bid: price,
      ask: price,
      timestamp: TRADING_NOW,
      ageMs: 0,
      isStale: false
    },
    now: TRADING_NOW,
    timeZone: "Asia/Taipei"
  } as const;
}

// ---------------------------------------------------------------------------
// R1: SHARE qty=300 price=800 → 240,000 TWD > 20,000 TWD cap → BLOCK
// ---------------------------------------------------------------------------

test("R1: SHARE qty=300 price=800 → notional=240000 > 20000 TWD cap → BLOCK max_absolute_notional", async () => {
  const result = await evaluateRiskCheck({
    session: makeSession(),
    repo: makeRepo(),
    payload: {
      order: {
        accountId: "paper-default",
        symbol: "2330",
        side: "buy",
        type: "limit",
        timeInForce: "rod",
        quantity: 300,
        quantity_unit: "SHARE",
        price: 800,
        stopPrice: null,
        tradePlanId: null,
        strategyId: null,
        overrideGuards: [],
        overrideReason: ""
      },
      account: {
        equity: 1_000_000,
        availableCash: 1_000_000,
        realizedPnlTodayPct: 0,
        openOrders: 0,
        grossExposurePct: 0,
        symbolPositionPct: 0,
        themeExposurePct: 0,
        brokerConnected: true
      },
      market: makeMarketContext(800),
      commit: false
    }
  });

  assert.equal(result.decision, "block", "expected decision=block");
  const notionalGuard = result.guards.find((g) => g.guard === "max_absolute_notional");
  assert.ok(notionalGuard !== undefined, "expected max_absolute_notional guard to be present");
  assert.equal(notionalGuard!.decision, "block");
  // observedValue should be the notional (300 × 800 = 240,000)
  assert.equal(notionalGuard!.observedValue, 240_000);
  // limitValue should be 20,000 TWD
  assert.equal(notionalGuard!.limitValue, 20_000);
});

// ---------------------------------------------------------------------------
// R2: SHARE qty=1 price=800 → 800 TWD < 20,000 TWD cap → NOT blocked
// ---------------------------------------------------------------------------

test("R2: SHARE qty=1 price=800 → notional=800 TWD < 20000 TWD cap → no max_absolute_notional guard", async () => {
  const result = await evaluateRiskCheck({
    session: makeSession(),
    repo: makeRepo(),
    payload: {
      order: {
        accountId: "paper-default",
        symbol: "2330",
        side: "buy",
        type: "limit",
        timeInForce: "rod",
        quantity: 1,
        quantity_unit: "SHARE",
        price: 800,
        stopPrice: null,
        tradePlanId: null,
        strategyId: null,
        overrideGuards: [],
        overrideReason: ""
      },
      account: {
        equity: 1_000_000,
        availableCash: 1_000_000,
        realizedPnlTodayPct: 0,
        openOrders: 0,
        grossExposurePct: 0,
        symbolPositionPct: 0,
        themeExposurePct: 0,
        brokerConnected: true
      },
      market: makeMarketContext(800),
      commit: false
    }
  });

  const notionalGuard = result.guards.find((g) => g.guard === "max_absolute_notional");
  assert.equal(notionalGuard, undefined, "max_absolute_notional should NOT fire for 800 TWD notional");
});

// ---------------------------------------------------------------------------
// R3: LOT qty=1 price=800 → LOT unit is not subject to 20k cap guard
// ---------------------------------------------------------------------------

test("R3: LOT qty=1 price=800 → effectiveShares=1000 but LOT not subject to 20k TWD demo cap guard", async () => {
  const result = await evaluateRiskCheck({
    session: makeSession(),
    repo: makeRepo(),
    payload: {
      order: {
        accountId: "paper-default",
        symbol: "2330",
        side: "buy",
        type: "limit",
        timeInForce: "rod",
        quantity: 1,
        quantity_unit: "LOT",
        price: 800,
        stopPrice: null,
        tradePlanId: null,
        strategyId: null,
        overrideGuards: [],
        overrideReason: ""
      },
      account: {
        equity: 1_000_000,
        availableCash: 1_000_000,
        realizedPnlTodayPct: 0,
        openOrders: 0,
        grossExposurePct: 0,
        symbolPositionPct: 0,
        themeExposurePct: 0,
        brokerConnected: true
      },
      market: makeMarketContext(800),
      commit: false
    }
  });

  const notionalGuard = result.guards.find((g) => g.guard === "max_absolute_notional");
  assert.equal(notionalGuard, undefined, "max_absolute_notional should NOT fire for LOT unit orders");
});
