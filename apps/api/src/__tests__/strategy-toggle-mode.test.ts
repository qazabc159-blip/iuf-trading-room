// strategy-toggle-mode.test.ts
// Standalone tests for the strategy toggle-mode gate.
// TM1–TM8 (matches ci.test.ts entries)

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  evaluateToggleMode,
  flipPaperObservationsToComplete,
  marketClose1330TodayTST,
  _resetToggleModeStore
} from "../strategy-toggle-mode.ts";
import {
  _setKillSwitchEnabled,
  isKillSwitchEnabled
} from "../domain/trading/execution-mode.ts";

function makeToggleSession(workspaceId: string) {
  return {
    workspace: { id: workspaceId, slug: `ws-${workspaceId.slice(0, 8)}` },
    user: { id: randomUUID(), role: "Owner" }
  } as any;
}

test("TM1: toggle OFF → PAPER starts paper_observing state", async () => {
  _resetToggleModeStore();
  const prevKs = isKillSwitchEnabled();
  _setKillSwitchEnabled(false);
  try {
    const session = makeToggleSession(randomUUID());
    const strategyId = randomUUID();
    const result = await evaluateToggleMode({
      session,
      strategyId,
      mode: "PAPER",
      capital_twd: 100_000
    });
    assert.ok(result.ok, "PAPER toggle must succeed");
    assert.equal(result.result.new_state, "paper_observing");
    assert.equal(result.result.killSwitch_status, "OFF");
    assert.equal(result.result.requires_explicit_ack, false);
  } finally {
    _setKillSwitchEnabled(prevKs);
    _resetToggleModeStore();
  }
});

test("TM2: LIVE transition blocked when paper_observation_status is not paper_complete", async () => {
  _resetToggleModeStore();
  const prevKs = isKillSwitchEnabled();
  _setKillSwitchEnabled(false);
  try {
    const session = makeToggleSession(randomUUID());
    const strategyId = randomUUID();

    const result = await evaluateToggleMode({
      session,
      strategyId,
      mode: "LIVE",
      capital_twd: 100_000,
      yang_explicit_ack: true
    });
    assert.ok(!result.ok, "LIVE from OFF must fail");
    assert.equal(result.error.code, "PAPER_OBSERVATION_NOT_COMPLETE");
  } finally {
    _setKillSwitchEnabled(prevKs);
    _resetToggleModeStore();
  }
});

test("TM3: LIVE transition checks paper_complete before yang_explicit_ack", async () => {
  _resetToggleModeStore();
  const prevKs = isKillSwitchEnabled();
  _setKillSwitchEnabled(false);
  try {
    const session = makeToggleSession(randomUUID());
    const strategyId = randomUUID();

    await evaluateToggleMode({ session, strategyId, mode: "PAPER", capital_twd: 100_000 });

    const liveResult = await evaluateToggleMode({
      session,
      strategyId,
      mode: "LIVE",
      capital_twd: 100_000,
      yang_explicit_ack: false
    });
    assert.ok(!liveResult.ok, "LIVE without paper_complete must fail");
    assert.ok(
      liveResult.error.code === "PAPER_OBSERVATION_NOT_COMPLETE" ||
      liveResult.error.code === "YANG_EXPLICIT_ACK_REQUIRED",
      `must fail with paper or ack error, got: ${liveResult.error.code}`
    );
  } finally {
    _setKillSwitchEnabled(prevKs);
    _resetToggleModeStore();
  }
});

test("TM4: kill switch ON forces toggle to OFF regardless of requested mode", async () => {
  _resetToggleModeStore();
  _setKillSwitchEnabled(true);
  try {
    const session = makeToggleSession(randomUUID());
    const result = await evaluateToggleMode({
      session,
      strategyId: randomUUID(),
      mode: "PAPER",
      capital_twd: 50_000
    });
    assert.ok(!result.ok, "toggle must fail when kill switch is ON");
    assert.equal(result.error.code, "KILL_SWITCH_FORCED_OFF");
  } finally {
    _setKillSwitchEnabled(false);
    _resetToggleModeStore();
  }
});

test("TM5: toggle to OFF always succeeds and returns off state", async () => {
  _resetToggleModeStore();
  const prevKs = isKillSwitchEnabled();
  _setKillSwitchEnabled(false);
  try {
    const session = makeToggleSession(randomUUID());
    const strategyId = randomUUID();

    await evaluateToggleMode({ session, strategyId, mode: "PAPER", capital_twd: 80_000 });

    const result = await evaluateToggleMode({
      session,
      strategyId,
      mode: "OFF",
      capital_twd: 0
    });
    assert.ok(result.ok, "OFF toggle must always succeed");
    assert.equal(result.result.new_state, "off");
  } finally {
    _setKillSwitchEnabled(prevKs);
    _resetToggleModeStore();
  }
});

test("TM6: marketClose1330TodayTST returns 05:30 UTC (13:30 TST)", () => {
  const cutoff = marketClose1330TodayTST();
  assert.ok(cutoff instanceof Date, "must return a Date");
  assert.equal(cutoff.getUTCHours(), 5, "UTC hour must be 5 (13:30 TST)");
  assert.equal(cutoff.getUTCMinutes(), 30, "UTC minutes must be 30");
});

test("TM7: flipPaperObservationsToComplete returns array (possibly empty for fresh starts)", async () => {
  _resetToggleModeStore();
  const prevKs = isKillSwitchEnabled();
  _setKillSwitchEnabled(false);
  try {
    const session = makeToggleSession(randomUUID());
    const strategyId = randomUUID();

    await evaluateToggleMode({ session, strategyId, mode: "PAPER", capital_twd: 100_000 });

    const flipped = await flipPaperObservationsToComplete(session);
    assert.ok(Array.isArray(flipped), "must return an array");
    for (const item of flipped) {
      assert.equal(item.new_state, "paper_complete");
      assert.equal(item.audit_action, "strategy.paper_observation_complete");
    }
  } finally {
    _setKillSwitchEnabled(prevKs);
    _resetToggleModeStore();
  }
});

test("TM8: four_layer_preview is present in successful toggle results", async () => {
  _resetToggleModeStore();
  const prevKs = isKillSwitchEnabled();
  _setKillSwitchEnabled(false);
  try {
    const session = makeToggleSession(randomUUID());
    const result = await evaluateToggleMode({
      session,
      strategyId: randomUUID(),
      mode: "PAPER",
      capital_twd: 100_000
    });
    assert.ok(result.ok, "PAPER toggle must succeed");
    assert.ok(result.result.four_layer_preview !== undefined, "four_layer_preview must be present");
    assert.ok(
      typeof result.result.four_layer_preview.blocked === "boolean",
      "four_layer_preview.blocked must be a boolean"
    );
  } finally {
    _setKillSwitchEnabled(prevKs);
    _resetToggleModeStore();
  }
});
