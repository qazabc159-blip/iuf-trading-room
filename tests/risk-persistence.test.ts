import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { emptyRiskStoreState, loadRiskStore, saveRiskStore } from "../apps/api/src/risk-store.ts";

// Use a temp directory so tests are isolated from any real /data volume
const TMP_DIR = path.join(os.tmpdir(), `iuf-risk-test-${Date.now()}`);
const WORKSPACE = "test-account";

// Override RAILWAY_VOLUME_MOUNT_PATH to point at temp dir for all tests
process.env["RAILWAY_VOLUME_MOUNT_PATH"] = TMP_DIR;

test.after(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

test("loadRiskStore returns empty state when file does not exist", async () => {
  const state = await loadRiskStore(WORKSPACE);
  assert.deepEqual(state, emptyRiskStoreState());
});

test("saveRiskStore then loadRiskStore round-trip — kill switch halted state", async () => {
  const now = new Date().toISOString();
  const killSwitchKey = `${WORKSPACE}:test-account`;
  const saved = emptyRiskStoreState();
  saved.killSwitch[killSwitchKey] = {
    accountId: "test-account",
    mode: "halted",
    engaged: true,
    engagedBy: "bruce",
    engagedAt: now,
    reason: "persistence-test",
    autoTriggerReason: null,
    updatedAt: now
  };

  await saveRiskStore(WORKSPACE, saved);
  const loaded = await loadRiskStore(WORKSPACE);

  assert.equal(loaded.killSwitch[killSwitchKey]?.mode, "halted");
  assert.equal(loaded.killSwitch[killSwitchKey]?.engaged, true);
  assert.equal(loaded.killSwitch[killSwitchKey]?.engagedBy, "bruce");
  assert.equal(loaded.killSwitch[killSwitchKey]?.reason, "persistence-test");
});

test("saveRiskStore then loadRiskStore round-trip — all four store layers preserved", async () => {
  const now = new Date().toISOString();
  const accountKey = `${WORKSPACE}:acc1`;
  const stratKey = `${WORKSPACE}:acc1:strat-x`;
  const symKey = `${WORKSPACE}:acc1:TSLA`;

  const saved = emptyRiskStoreState();

  saved.limits[accountKey] = {
    id: "lim-1",
    accountId: "acc1",
    maxPerTradePct: 2,
    maxDailyLossPct: 5,
    maxSinglePositionPct: 10,
    maxThemeCorrelatedPct: 20,
    maxGrossExposurePct: 100,
    maxOpenOrders: 5,
    maxOrdersPerMinute: 10,
    staleQuoteMs: 60000,
    tradingHoursStart: "09:00",
    tradingHoursEnd: "13:30",
    symbolWhitelist: [],
    symbolBlacklist: [],
    whitelistOnly: false,
    createdAt: now,
    updatedAt: now
  };

  saved.strategyLimits[stratKey] = {
    id: "slim-1",
    accountId: "acc1",
    strategyId: "strat-x",
    enabled: true,
    maxPerTradePct: 1,
    maxSinglePositionPct: 5,
    maxThemeCorrelatedPct: null,
    maxGrossExposurePct: null,
    maxOpenOrders: null,
    maxOrdersPerMinute: null,
    symbolWhitelist: null,
    symbolBlacklist: null,
    whitelistOnly: null,
    notes: "",
    createdAt: now,
    updatedAt: now
  };

  saved.symbolLimits[symKey] = {
    id: "ylim-1",
    accountId: "acc1",
    symbol: "TSLA",
    enabled: true,
    maxPerTradePct: 0.5,
    maxSinglePositionPct: 3,
    notes: "",
    createdAt: now,
    updatedAt: now
  };

  await saveRiskStore(WORKSPACE, saved);
  const loaded = await loadRiskStore(WORKSPACE);

  assert.equal(loaded.limits[accountKey]?.maxPerTradePct, 2);
  assert.equal(loaded.strategyLimits[stratKey]?.strategyId, "strat-x");
  assert.equal(loaded.symbolLimits[symKey]?.symbol, "TSLA");
});

test("loadRiskStore returns empty state on corrupted JSON (fail-open)", async () => {
  const { writeFile, mkdir } = await import("node:fs/promises");
  const storeDir = path.join(TMP_DIR, "risk");
  await mkdir(storeDir, { recursive: true });
  await writeFile(path.join(storeDir, "corrupt.risk.json"), "{ not valid json !!!", "utf8");

  const state = await loadRiskStore("corrupt");
  assert.deepEqual(state, emptyRiskStoreState());
});
