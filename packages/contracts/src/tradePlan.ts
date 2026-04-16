import { z } from "zod";

export const tradePlanStatusSchema = z.enum([
  "draft",
  "ready",
  "active",
  "reduced",
  "closed",
  "canceled"
]);

// Structured execution block — additive to the existing prose fields.
// Strategy engine + risk engine only look here; humans still read entryPlan /
// invalidationPlan / targetPlan for rationale.
export const orderTypeHintSchema = z.enum([
  "market",
  "limit",
  "stop",
  "stop_limit"
]);

export const positionSizingRuleSchema = z.object({
  mode: z
    .enum(["fixed_pct", "fixed_qty", "risk_per_trade"])
    .default("risk_per_trade"),
  // Under "risk_per_trade" this is the % of equity to risk between
  // entryPrice and stopLoss — sits under the risk engine ceiling.
  pct: z.number().min(0).max(100).default(1.0),
  qty: z.number().positive().nullable().default(null),
  maxPositionPct: z.number().min(0).max(100).default(15.0)
});

export const takeProfitLegSchema = z.object({
  price: z.number().positive(),
  // Portion of the position to unload at this leg, 0..1. All portions together
  // should usually sum to 1 but we don't enforce it — remaining lets a trailer
  // run.
  portion: z.number().min(0).max(1),
  note: z.string().default("")
});

export const tradePlanExecutionSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]).default("buy"),
  orderType: orderTypeHintSchema.default("limit"),
  entryPrice: z.number().positive().nullable().default(null),
  entryRange: z
    .object({
      low: z.number().positive(),
      high: z.number().positive()
    })
    .nullable()
    .default(null),
  stopLoss: z.number().positive().nullable().default(null),
  takeProfitLadder: z.array(takeProfitLegSchema).default([]),
  triggerCondition: z.string().default(""),
  validUntil: z.string().nullable().default(null),
  positionSizing: positionSizingRuleSchema.default({
    mode: "risk_per_trade",
    pct: 1.0,
    qty: null,
    maxPositionPct: 15.0
  }),
  strategyId: z.string().uuid().nullable().default(null),
  accountId: z.string().nullable().default(null)
});

export const tradePlanSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  status: tradePlanStatusSchema,
  entryPlan: z.string(),
  invalidationPlan: z.string(),
  targetPlan: z.string(),
  riskReward: z.string(),
  notes: z.string(),
  execution: tradePlanExecutionSchema.nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const tradePlanCreateInputSchema = z.object({
  companyId: z.string().uuid(),
  status: tradePlanStatusSchema.default("draft"),
  entryPlan: z.string().min(1).max(2000),
  invalidationPlan: z.string().min(1).max(2000),
  targetPlan: z.string().min(1).max(2000),
  riskReward: z.string().max(1000).default(""),
  notes: z.string().max(2000).default(""),
  // Optional on input — older UI that doesn't know about the structured
  // execution block continues to work. Strategy engine / new plan form will
  // populate this when relevant.
  execution: tradePlanExecutionSchema.nullable().optional()
});

export const tradePlanUpdateInputSchema = tradePlanCreateInputSchema
  .omit({ companyId: true })
  .partial();

export type TradePlanStatus = z.infer<typeof tradePlanStatusSchema>;
export type OrderTypeHint = z.infer<typeof orderTypeHintSchema>;
export type PositionSizingRule = z.infer<typeof positionSizingRuleSchema>;
export type TakeProfitLeg = z.infer<typeof takeProfitLegSchema>;
export type TradePlanExecution = z.infer<typeof tradePlanExecutionSchema>;
export type TradePlan = z.infer<typeof tradePlanSchema>;
export type TradePlanCreateInput = z.infer<typeof tradePlanCreateInputSchema>;
export type TradePlanUpdateInput = z.infer<typeof tradePlanUpdateInputSchema>;
