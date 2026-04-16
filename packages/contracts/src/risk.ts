import { z } from "zod";

// Default limits baked in per user's Phase 1 directive (2026-04-16):
//   單筆風險上限：       1.0%
//   單日最大損失上限：   3.0%
//   單一標的部位上限：  15.0%
//   同主題/相關曝險：    25.0%
// These are operator-overridable but should never be silently relaxed.
export const DEFAULT_RISK_LIMITS = {
  maxPerTradePct: 1.0,
  maxDailyLossPct: 3.0,
  maxSinglePositionPct: 15.0,
  maxThemeCorrelatedPct: 25.0,
  maxGrossExposurePct: 100.0,
  maxOpenOrders: 20,
  maxOrdersPerMinute: 10,
  staleQuoteMs: 3000,
  tradingHoursStart: "09:00",
  tradingHoursEnd: "13:30"
} as const;

export const riskGuardKindSchema = z.enum([
  "max_per_trade",
  "max_daily_loss",
  "max_single_position",
  "max_theme_correlated",
  "max_gross_exposure",
  "max_open_orders",
  "max_orders_per_minute",
  "symbol_whitelist",
  "symbol_blacklist",
  "duplicate_order",
  "stale_quote",
  "trading_hours",
  "broker_disconnected",
  "reconcile_mismatch",
  "kill_switch",
  "manual_disable"
]);

export const riskLimitSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string(),
  maxPerTradePct: z
    .number()
    .min(0)
    .max(100)
    .default(DEFAULT_RISK_LIMITS.maxPerTradePct),
  maxDailyLossPct: z
    .number()
    .min(0)
    .max(100)
    .default(DEFAULT_RISK_LIMITS.maxDailyLossPct),
  maxSinglePositionPct: z
    .number()
    .min(0)
    .max(100)
    .default(DEFAULT_RISK_LIMITS.maxSinglePositionPct),
  maxThemeCorrelatedPct: z
    .number()
    .min(0)
    .max(100)
    .default(DEFAULT_RISK_LIMITS.maxThemeCorrelatedPct),
  maxGrossExposurePct: z
    .number()
    .min(0)
    .max(500)
    .default(DEFAULT_RISK_LIMITS.maxGrossExposurePct),
  maxOpenOrders: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_RISK_LIMITS.maxOpenOrders),
  maxOrdersPerMinute: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_RISK_LIMITS.maxOrdersPerMinute),
  staleQuoteMs: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_RISK_LIMITS.staleQuoteMs),
  tradingHoursStart: z.string().default(DEFAULT_RISK_LIMITS.tradingHoursStart),
  tradingHoursEnd: z.string().default(DEFAULT_RISK_LIMITS.tradingHoursEnd),
  symbolWhitelist: z.array(z.string()).default([]),
  symbolBlacklist: z.array(z.string()).default([]),
  // Empty whitelist means "no whitelist enforcement". Flip this to require
  // explicit opt-in per symbol before auto-trading.
  whitelistOnly: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const riskLimitUpsertInputSchema = riskLimitSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial()
  .extend({ accountId: z.string() });

export const killSwitchStateSchema = z.object({
  accountId: z.string(),
  // "trading" = normal. "halted" = kill switch engaged, no new orders.
  // "liquidate_only" = only closing orders allowed. "paper_only" = demote to
  // paper account without halting strategy logic.
  mode: z.enum(["trading", "halted", "liquidate_only", "paper_only"]),
  engaged: z.boolean().default(false),
  engagedBy: z.string().nullable().default(null),
  engagedAt: z.string().nullable().default(null),
  reason: z.string().default(""),
  autoTriggerReason: z.string().nullable().default(null),
  updatedAt: z.string()
});

export const killSwitchInputSchema = z.object({
  accountId: z.string(),
  mode: killSwitchStateSchema.shape.mode,
  reason: z.string().default(""),
  engagedBy: z.string().default("operator")
});

export const riskCheckDecisionSchema = z.enum(["allow", "warn", "block"]);

export const riskGuardResultSchema = z.object({
  guard: riskGuardKindSchema,
  decision: riskCheckDecisionSchema,
  message: z.string(),
  observedValue: z.number().nullable().default(null),
  limitValue: z.number().nullable().default(null)
});

export const riskCheckResultSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string(),
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  decision: riskCheckDecisionSchema,
  guards: z.array(riskGuardResultSchema),
  summary: z.string(),
  overridden: z.boolean().default(false),
  overrideReason: z.string().default(""),
  createdAt: z.string()
});

export type RiskGuardKind = z.infer<typeof riskGuardKindSchema>;
export type RiskLimit = z.infer<typeof riskLimitSchema>;
export type RiskLimitUpsertInput = z.infer<typeof riskLimitUpsertInputSchema>;
export type KillSwitchState = z.infer<typeof killSwitchStateSchema>;
export type KillSwitchInput = z.infer<typeof killSwitchInputSchema>;
export type RiskCheckDecision = z.infer<typeof riskCheckDecisionSchema>;
export type RiskGuardResult = z.infer<typeof riskGuardResultSchema>;
export type RiskCheckResult = z.infer<typeof riskCheckResultSchema>;
