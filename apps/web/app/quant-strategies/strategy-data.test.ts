import { describe, expect, it } from "vitest";

import type { LabStrategySnapshot } from "@/lib/api";
import type { S1Basket, S1SimStatus } from "@/lib/fauto-sim-api";
import { QUANT_STRATEGIES, hydrateQuantStrategy } from "./strategy-data";

const snapshot = {
  strategyId: "cont_liq_v36",
  status: "RESEARCH_FORWARD_OBSERVATION",
  commonWindowStart: "2025-04-10",
  commonWindowEnd: "2026-03-06",
  panelWindow: { rebalancePeriods: 13 },
  spec: {},
  headlineMetrics: {
    strategyNetAbsoluteReturnPct: 400.89,
    benchmark0050ReturnPct: 95.25,
    excessVs0050Pp: 305.64,
    sharpeAnnualized: 3.027,
    sortinoAnnualized: 3.912,
    maxDrawdown: -0.1051,
    maxDrawdownNetPct: -0.1051,
    winRate: 0.8462,
    hitRate: 0.9231,
    hitRatePct: 0.9231,
    averageHoldingDays: 20,
    totalRebalances: 13,
    robustness: {
      horizonSweep: "PASS",
      regimeBandSweep: "PASS",
      costStressSweep: "PASS",
      universeShrinkage: "PASS",
    },
  },
  equityCurve: {
    points: [{ date: "2026-03-26", cumReturn: 2.2202, drawdown: 0 }],
  },
  monthlyReturns: {
    bars: [{ yearMonth: "2026-03", monthReturn: 0.1278, tradeCount: 1 }],
  },
  sampleTrades: { entries: [] },
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

describe("hydrateQuantStrategy", () => {
  it("maps sanctioned research and the latest S1 basket without placeholder values", () => {
    const strategy = hydrateQuantStrategy(QUANT_STRATEGIES[0]!, {
      snapshot,
      status,
      basket,
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
    expect(strategy.curve[0]?.value).toBeCloseTo(222.02);
    expect(strategy.bars[0]?.value).toBeCloseTo(12.78);
    expect(strategy.holdings).toEqual([
      expect.objectContaining({
        symbol: "5701",
        weight: 0.061913,
        price: 6.13,
      }),
    ]);
    expect(strategy.holdings[0]?.note).toContain("101,000 股");
  });

  it("shows an honest unavailable state instead of restoring static metrics", () => {
    const strategy = hydrateQuantStrategy(QUANT_STRATEGIES[0]!, {
      snapshot: null,
      status: null,
      basket: null,
    });

    expect(strategy.current.dataState).toBe("UNAVAILABLE");
    expect(strategy.metrics.netReturnPct).toBeNull();
    expect(strategy.holdings).toEqual([]);
    expect(strategy.curve).toEqual([]);
  });
});
