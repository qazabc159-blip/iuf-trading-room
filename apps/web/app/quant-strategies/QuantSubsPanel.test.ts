import { describe, expect, it } from "vitest";

import { summarizeSubscriptions } from "./quant-subs-summary";

describe("QuantSubsPanel", () => {
  it("summarizes duplicate audit-log subscription rows into latest state per strategy", () => {
    const summary = summarizeSubscriptions([
      {
        subscription_id: "old",
        strategy_id: "cont_liq_v36",
        capital_twd: 100_000,
        sim_only: true,
        created_at: "2026-05-15T08:03:00Z",
        audit_log_id: "audit-old",
      },
      {
        subscription_id: "new",
        strategy_id: "cont_liq_v36",
        capital_twd: 1_000_000,
        sim_only: true,
        created_at: "2026-05-15T11:44:00Z",
        audit_log_id: "audit-new",
      },
      {
        subscription_id: "class5",
        strategy_id: "strategy_002",
        capital_twd: 100_000,
        sim_only: true,
        created_at: "2026-05-15T08:04:00Z",
        audit_log_id: "audit-class5",
      },
    ]);

    expect(summary).toHaveLength(3);
    expect(summary[0]).toMatchObject({
      strategyId: "cont_liq_v36",
      count: 2,
      totalCapitalTwd: 1_100_000,
      latest: { subscription_id: "new", capital_twd: 1_000_000 },
    });
    expect(summary[1]).toMatchObject({
      strategyId: "strategy_002",
      count: 1,
      latest: { subscription_id: "class5" },
    });
    expect(summary[2]).toMatchObject({
      strategyId: "strategy_003",
      count: 0,
      latest: null,
    });
  });
});
