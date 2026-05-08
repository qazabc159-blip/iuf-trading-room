/**
 * paper-four-layer-risk-gate.test.ts
 *
 * Unit coverage for evaluateFourLayerRiskGate — L3 daily-loss paths.
 * Gap identified by Pete post-merge review (S2) of PR #296.
 *
 * Coverage:
 *   TL01: L1 kill switch ON → blocked=true, layer=1, auditType=kill_switch_on
 *   TL02: L3 preview mode, negative PnL injected → blocked=true, layer=3,
 *         killSwitchAutoEngaged=false (preview must NOT mutate kill switch state)
 *   TL03: L3 submit mode, negative PnL injected → blocked=true, layer=3,
 *         killSwitchAutoEngaged=true + kill switch side-effect verified
 *
 * Hard lines:
 *   - No HTTP. No DB. No KGI SDK.
 *   - Uses _setPaperBrokerOverride / _resetPaperBrokerOverride injection
 *     (ESM live-binding workaround — see Pete S2 note in PETE_FOLLOWUP_LETTER).
 *   - Kill switch is always reset to false in cleanup.
 *
 * Run:
 *   node --test --import tsx/esm apps/api/src/__tests__/paper-four-layer-risk-gate.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { _setKillSwitchEnabled, isKillSwitchEnabled } from "../domain/trading/execution-mode.js";
import {
  evaluateFourLayerRiskGate,
  _setPaperBrokerOverride,
  _resetPaperBrokerOverride
} from "../paper-four-layer-risk-gate.js";
import type { AppSession } from "@iuf-trading-room/contracts";

// ---------------------------------------------------------------------------
// Shared stubs
// ---------------------------------------------------------------------------

const stubSession = {
  workspace: { slug: "test-ws", id: "ws-test-id" },
  user: { id: "test-user", role: "Owner" }
} as unknown as AppSession;

/** Minimal buy limit order (2330, 1 SHARE @ 100 TWD). */
function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "paper-default",
    symbol: "2330",
    side: "buy",
    type: "limit",
    timeInForce: "rod",
    quantity: 1,
    quantity_unit: "SHARE",
    price: 100,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: [],
    overrideReason: "",
    ...overrides
  } as any;
}

/** Balance stub factory. */
function makeBalance(realizedPnlToday: number, unrealizedPnl: number, equity = 10_000) {
  return {
    accountId: "paper-default",
    currency: "TWD",
    cash: equity,
    availableCash: equity,
    equity,
    marketValue: 0,
    unrealizedPnl,
    realizedPnlToday,
    marginUsed: 0,
    updatedAt: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// TL01: L1 kill switch ON → blocked, layer=1
// ---------------------------------------------------------------------------

test("TL01: L1 kill switch ON → blocked=true, layer=1, auditType=kill_switch_on", async () => {
  // Ensure clean state before
  _setKillSwitchEnabled(false);
  _setPaperBrokerOverride({
    getPaperBalance: async () => makeBalance(0, 0) as any,
    listPaperPositions: async () => []
  });

  try {
    _setKillSwitchEnabled(true);

    const result = await evaluateFourLayerRiskGate({
      session: stubSession,
      order: makeOrder(),
      isPreview: false
    });

    assert.equal(result.blocked, true, "should be blocked");
    if (result.blocked) {
      assert.equal(result.layer, 1, "should be layer 1 (kill switch)");
      assert.equal(result.auditType, "kill_switch_on");
    }
  } finally {
    _setKillSwitchEnabled(false);
    _resetPaperBrokerOverride();
  }
});

// ---------------------------------------------------------------------------
// TL02: L3 preview mode — negative PnL → blocked, NO kill-switch mutation
//
// Setup: equity=10_000, daily loss pct=2% (default), threshold=−200 TWD.
// Inject: realizedPnlToday=−150, unrealizedPnl=−100 → total=−250 ≤ −200 → L3 fires.
// Also inject: RISK_MAX_POSITION_PCT=100% so L2 does NOT fire first
// (order notional=100 TWD; equity=10000; 100/10000=1% < 100% cap → L2 passes).
// ---------------------------------------------------------------------------

test("TL02: L3 preview — negative PnL → blocked=true, layer=3, killSwitchAutoEngaged=false", async () => {
  _setKillSwitchEnabled(false);
  const origMaxPct = process.env["RISK_MAX_POSITION_PCT"];
  const origLossPct = process.env["RISK_DAILY_LOSS_PCT"];

  // L2: set cap to 100% so L2 doesn't fire before L3
  process.env["RISK_MAX_POSITION_PCT"] = "100";
  // L3: default 2% → threshold = -200 TWD on 10000 equity
  process.env["RISK_DAILY_LOSS_PCT"] = "2";

  _setPaperBrokerOverride({
    getPaperBalance: async () => makeBalance(-150, -100, 10_000) as any,
    listPaperPositions: async () => []
  });

  try {
    const result = await evaluateFourLayerRiskGate({
      session: stubSession,
      order: makeOrder({ price: 100, quantity: 1 }),
      isPreview: true  // preview: must NOT auto-engage kill switch
    });

    assert.equal(result.blocked, true, "should be blocked by L3");
    if (result.blocked) {
      assert.equal(result.layer, 3, "should be layer 3 (daily loss limit)");
      assert.equal(result.auditType, "risk_block_daily_loss");
      // KEY: preview mode must NEVER mutate kill switch
      assert.equal(
        result.killSwitchAutoEngaged,
        false,
        "preview mode must not auto-engage kill switch"
      );
      // Verify side-effect: kill switch remains OFF
      assert.equal(
        isKillSwitchEnabled(),
        false,
        "kill switch must still be OFF after preview-mode L3 trigger"
      );
    }
  } finally {
    _setKillSwitchEnabled(false);
    _resetPaperBrokerOverride();
    if (origMaxPct === undefined) delete process.env["RISK_MAX_POSITION_PCT"];
    else process.env["RISK_MAX_POSITION_PCT"] = origMaxPct;
    if (origLossPct === undefined) delete process.env["RISK_DAILY_LOSS_PCT"];
    else process.env["RISK_DAILY_LOSS_PCT"] = origLossPct;
  }
});

// ---------------------------------------------------------------------------
// TL03: L3 submit mode — negative PnL → blocked + kill switch auto-engaged
//
// Same PnL setup as TL02 but isPreview=false (submit path).
// Expects: killSwitchAutoEngaged=true + kill switch is ON as side-effect.
// ---------------------------------------------------------------------------

test("TL03: L3 submit — negative PnL → blocked=true, layer=3, killSwitchAutoEngaged=true", async () => {
  _setKillSwitchEnabled(false);
  const origMaxPct = process.env["RISK_MAX_POSITION_PCT"];
  const origLossPct = process.env["RISK_DAILY_LOSS_PCT"];

  process.env["RISK_MAX_POSITION_PCT"] = "100";
  process.env["RISK_DAILY_LOSS_PCT"] = "2";

  _setPaperBrokerOverride({
    getPaperBalance: async () => makeBalance(-150, -100, 10_000) as any,
    listPaperPositions: async () => []
  });

  try {
    const result = await evaluateFourLayerRiskGate({
      session: stubSession,
      order: makeOrder({ price: 100, quantity: 1 }),
      isPreview: false  // submit: MUST auto-engage kill switch
    });

    assert.equal(result.blocked, true, "should be blocked by L3");
    if (result.blocked) {
      assert.equal(result.layer, 3, "should be layer 3 (daily loss limit)");
      assert.equal(result.auditType, "risk_block_daily_loss");
      // KEY: submit mode must auto-engage kill switch
      assert.equal(
        result.killSwitchAutoEngaged,
        true,
        "submit mode must auto-engage kill switch on L3 trigger"
      );
      // Verify side-effect: kill switch is now ON
      assert.equal(
        isKillSwitchEnabled(),
        true,
        "kill switch must be ON after submit-mode L3 trigger"
      );
    }
  } finally {
    // Always restore kill switch to OFF (never leave it ON between tests)
    _setKillSwitchEnabled(false);
    _resetPaperBrokerOverride();
    if (origMaxPct === undefined) delete process.env["RISK_MAX_POSITION_PCT"];
    else process.env["RISK_MAX_POSITION_PCT"] = origMaxPct;
    if (origLossPct === undefined) delete process.env["RISK_DAILY_LOSS_PCT"];
    else process.env["RISK_DAILY_LOSS_PCT"] = origLossPct;
  }
});
