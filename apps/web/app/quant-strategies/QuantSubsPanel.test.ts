import { describe, expect, it } from "vitest";

import { summarizeSubscriptions } from "./quant-subs-summary";

describe("QuantSubsPanel", () => {
  it("summarizes S1 audit-log subscription rows into the latest runnable capital", () => {
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
        capital_twd: 10_000_000,
        sim_only: true,
        created_at: "2026-06-01T09:44:00Z",
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

    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      strategyId: "cont_liq_v36",
      count: 2,
      totalCapitalTwd: 10_100_000,
      latest: { subscription_id: "new", capital_twd: 10_000_000 },
    });
  });
});
