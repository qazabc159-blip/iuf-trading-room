import { describe, expect, it } from "vitest";

import type { LabStrategySnapshot } from "@/lib/api";
import type { S1Basket, S1SimStatus, TrackRecordNavResponse } from "@/lib/fauto-sim-api";
import { QUANT_STRATEGIES, hydrateQuantStrategy } from "./strategy-data";

// Mirrors the real `snapshot` field returned by
// GET /api/v1/lab/strategy/cont_liq_v36/snapshot (tr_strategy_snapshot_api_contract_v47),
// trimmed to the fields hydrateQuantStrategy reads. Captured 2026-06-11 from prod.
const snapshot = {
  schema: "lab_tr_strategy_snapshot_v0",
  strategyId: "cont_liq_v36",
  displayName: "Continuous Liquidity Relative Strength",
  displayName_zh: "持續流動性 + 相對強弱",
  status: "RESEARCH_FORWARD_OBSERVATION",
  asOfDateTaipei: "2026-05-13T16:30:00+08:00",
  returnConventionVersion: "v47",
  displayReturnMode: "common_window_excess",
  sourceWindowType: "common_window_11mo",
  commonWindowStart: "2025-04-10",
  commonWindowEnd: "2026-03-06",
  commonWindowTradingDays: 223,
  caveatTextZh: "歷史研究數字 — 不可外推為未來表現預期。",
  // P0-3 fix (#1216, 2026-07-10): mirrors mapSnapshotToV47's derived honesty
  // fields. All three known snapshots carry false as of 2026-07-10 (no
  // status in the live-verified allowlist).
  isLiveVerifiedTrackRecord: false,
  trackRecordType: "research_backtest_unverified" as const,
  headlineDisclosureZh:
    "歷史回測（未經驗證），非策略現況，研究窗 2025-04-10 ~ 2026-03-06。歷史研究數字 — 不可外推為未來表現預期。",
  panelWindow: { start: "2024-05-30", end: "2026-03-26", distinctDates: 487, rebalancePeriods: 13 },
  spec: {
    horizonDays: 20,
    topN: 4,
    regimeThreshold: 0.06,
    scoreFormula: "z[volumeRatio5To20] + z[trailRet20d]",
    specVersion: "v36_canonical",
  },
  headlineMetrics: {
    strategyNetAbsoluteReturnPct: 400.89,
    benchmark0050ReturnPct: 95.25,
    excessVs0050Pp: 305.64,
    hitRatePct: 0.9231,
    maxDrawdownNetPct: -0.1051,
    netAbsoluteReturnAfterCost: 7.5987,
    netAbsoluteReturnAfterCostAnnualized: 2.1064,
    sharpeAnnualized: 3.027,
    sortinoAnnualized: 3.912,
    maxDrawdown: -0.1051,
    maxDrawdownDate: "2025-05-29",
    winRate: 0.8462,
    hitRate: 0.9231,
    averageHoldingDays: 20,
    averagePositions: 4,
    totalRebalances: 13,
    costBpsApplied: 120,
    strictOosLast: 0.5027,
    robustness: {
      horizonSweep: "NEAR_PASS_v37",
      regimeBandSweep: "FULL_PASS_v38",
      costStressSweep: "PASS_AT_60_120_BPS_v39",
      universeShrinkage: "PARTIAL_K_GE_50_REQUIRED_v40",
    },
  },
  equityCurve: {
    frequency: "rebalance",
    points: [
      { date: "2024-05-30", cumReturn: 0.0138, drawdown: 0 },
      { date: "2026-03-26", cumReturn: 2.2202, drawdown: 0 },
    ],
  },
  monthlyReturns: {
    frequency: "calendar_month",
    bars: [
      { yearMonth: "2024-05", monthReturn: 0.0138, tradeCount: 1 },
      { yearMonth: "2026-03", monthReturn: 0.1278, tradeCount: 1 },
    ],
  },
  sampleTrades: { entries: [] },
  displayMode: "research_only",
  orderState: "blocked",
  brokerWriteAllowed: false,
  realOrderAllowed: false,
  registryChangeAllowed: false,
} as unknown as LabStrategySnapshot;

const status: S1SimStatus = {
  simOnly: true,
  prodWriteBlocked: true,
  asOf: "2026-06-11T06:45:58.894Z",
  todayTst: "2026-06-11",
  automaticScheduler: {
    enabled: true,
    mode: "weekly_tuesday_kgi_sim",
    signalWindowTst: "Tuesday 08:30-08:55",
    orderSubmitWindowTst: "Tuesday 09:00-09:20",
    eodWindowTst: "Weekdays 14:00-14:30",
    pollIntervalMs: 900000,
    signalCatchupBeforeOrder: true,
    manualTriggerRole: "owner_backup_only",
  },
  lastSignalDate: "2026-06-09",
  lastOrderDate: null,
  lastEodDate: null,
  regime: "sideways",
  exposureWeight: 0.5,
  basketSymbols: [],
  latestBasketSize: 8,
  latestBasketGeneratedAt: "2026-06-09T08:38:03+08:00",
  ordersAttempted: null,
  ordersAccepted: null,
  ordersRejected: null,
  signalWindowOpen: false,
  orderSubmitWindowOpen: false,
  eodWindowOpen: false,
  gatewayUrlConfigured: true,
  configuredCapitalTwd: 10_000_000,
  capitalSource: "latest_subscription",
  capitalSubscriptionId: "subscription-1",
  capitalSubscriptionCreatedAt: "2026-06-01T10:48:08.748Z",
  eodPositionCount: 8,
  eodDataSource: "audit_log_fallback",
  eodMarketValueTwd: null,
  eodUnrealizedPnlTwd: null,
  failsafeNotes: null,
};

const basket: S1Basket = {
  found: true,
  date: "2026-06-09",
  source: "audit_log",
  capitalTwd: 10_000_000,
  regime: "sideways",
  exposureWeight: 0.5,
  generatedAtTst: "2026-06-09T08:38:03+08:00",
  universeCount: 1931,
  failsafeNotes: null,
  items: [
    {
      symbol: "5701",
      score: 9.0016,
      price: 6.13,
      shares: 101_000,
      targetNotionalTwd: 619_130,
      sizingNote: "SOFT_FLAG_2PCT_ADV",
    },
  ],
};

// Mirrors the whitelisted subset returned by GET /api/v1/track-record/nav
// (#1177) — real F-AUTO SIM performance (含成本), independent of the research
// backtest snapshot above.
const nav: TrackRecordNavResponse = {
  source: "sim_ledger_live",
  navCurve: [
    { date: "2026-07-07", equity: 9_790_150, source: "live" },
    { date: "2026-07-09", equity: 9_814_000, source: "live" },
  ],
  weeks: [],
  summary: {
    initialEquity: 10_000_000,
    currentEquity: 9_814_000,
    cumulativeReturnPct: -1.86,
    totalRealizedPnlTwd: -186_000,
  },
};

describe("hydrateQuantStrategy", () => {
  it("maps sanctioned research and the latest S1 basket without placeholder values", () => {
    const strategy = hydrateQuantStrategy(QUANT_STRATEGIES[0]!, {
      snapshot,
      status,
      basket,
      nav,
    });

    expect(strategy.current.dataState).toBe("LIVE");
    expect(strategy.current.asOf).toBe("2026-06-09");
    expect(strategy.current.status).toContain("50% 曝險");
    expect(strategy.current.primaryReadout).toContain("10,000,000 TWD");
    expect(strategy.current.sourceLabel).toContain("audit_log");
    expect(strategy.metrics.netReturnPct).toBe(400.89);
    expect(strategy.metrics.hitRatePct).toBeCloseTo(92.31);
    expect(strategy.metrics.maxDrawdownPct).toBeCloseTo(-10.51);
    expect(strategy.metrics.sampleCount).toBe(13);
    expect(strategy.curve[0]?.value).toBeCloseTo(1.38);
    expect(strategy.curve[1]?.value).toBeCloseTo(222.02);
    expect(strategy.bars[0]?.value).toBeCloseTo(1.38);
    expect(strategy.bars[1]?.value).toBeCloseTo(12.78);
    expect(strategy.holdings).toEqual([
      expect.objectContaining({
        symbol: "5701",
        weight: 0.061913,
        price: 6.13,
      }),
    ]);
    expect(strategy.holdings[0]?.note).toContain("101,000 股");
    // P0-3 fix (#1216): the backtest headline number above (400.89% /
    // 92.31%) must travel with an explicit "not live-verified" flag and the
    // backend-provided disclosure sentence — never render bare.
    expect(strategy.trackRecord.isLiveVerifiedTrackRecord).toBe(false);
    expect(strategy.trackRecord.headlineDisclosureZh).toContain("歷史回測（未經驗證）");
    // Real F-AUTO SIM performance (含成本) surfaces independently for
    // side-by-side comparison against the backtest number.
    expect(strategy.realSimReturnPct).toBe(-1.86);
  });

  it("flips isLiveVerifiedTrackRecord true and drops the disclosure sentence for a live-verified snapshot", () => {
    const liveVerifiedSnapshot = {
      ...snapshot,
      isLiveVerifiedTrackRecord: true,
      trackRecordType: "live_verified" as const,
      headlineDisclosureZh: "",
    };

    const strategy = hydrateQuantStrategy(QUANT_STRATEGIES[0]!, {
      snapshot: liveVerifiedSnapshot,
      status,
      basket,
      nav,
    });

    expect(strategy.trackRecord.isLiveVerifiedTrackRecord).toBe(true);
    expect(strategy.trackRecord.headlineDisclosureZh).toBe("");
  });

  it("defaults isLiveVerifiedTrackRecord to false when the snapshot predates #1216 (field missing)", () => {
    const preP03Snapshot = { ...snapshot } as Record<string, unknown>;
    delete preP03Snapshot.isLiveVerifiedTrackRecord;
    delete preP03Snapshot.trackRecordType;
    delete preP03Snapshot.headlineDisclosureZh;

    const strategy = hydrateQuantStrategy(QUANT_STRATEGIES[0]!, {
      snapshot: preP03Snapshot as unknown as LabStrategySnapshot,
      status,
      basket,
      nav,
    });

    expect(strategy.trackRecord.isLiveVerifiedTrackRecord).toBe(false);
    expect(strategy.trackRecord.headlineDisclosureZh).toBeNull();
  });

  it("shows an honest unavailable state instead of restoring static metrics", () => {
    const strategy = hydrateQuantStrategy(QUANT_STRATEGIES[0]!, {
      snapshot: null,
      status: null,
      basket: null,
      nav: null,
    });

    expect(strategy.current.dataState).toBe("UNAVAILABLE");
    expect(strategy.metrics.netReturnPct).toBeNull();
    expect(strategy.holdings).toEqual([]);
    expect(strategy.curve).toEqual([]);
    expect(strategy.trackRecord.isLiveVerifiedTrackRecord).toBe(false);
    expect(strategy.realSimReturnPct).toBeNull();
  });
});
