export type SubscriptionRecord = {
  subscription_id: string;
  strategy_id: string;
  capital_twd: number;
  sim_only: boolean;
  created_at: string;
  audit_log_id: string;
};

export type SubscriptionSummary = {
  strategyId: string;
  label: string;
  latest: SubscriptionRecord | null;
  count: number;
  totalCapitalTwd: number;
};

export const VALID_STRATEGY_IDS = ["cont_liq_v36"] as const;

export const STRATEGY_DISPLAY_NAMES: Record<string, string> = {
  cont_liq_v36: "S1 連續動能流動性策略",
};

export function summarizeSubscriptions(subscriptions: SubscriptionRecord[]): SubscriptionSummary[] {
  return VALID_STRATEGY_IDS.map((strategyId) => {
    const records = subscriptions
      .filter((sub) => sub.strategy_id === strategyId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return {
      strategyId,
      label: STRATEGY_DISPLAY_NAMES[strategyId] ?? strategyId,
      latest: records[0] ?? null,
      count: records.length,
      totalCapitalTwd: records.reduce((sum, sub) => sum + sub.capital_twd, 0),
    };
  });
}
