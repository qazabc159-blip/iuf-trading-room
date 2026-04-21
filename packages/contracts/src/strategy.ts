import { z } from "zod";

import { marketDataQualityGradeSchema } from "./marketData.js";
import { orderSideSchema, submitOrderResultSchema } from "./broker.js";

// Phase 1 強制走 rule-based + 結構化 setup。AI/discretionary 之後才上。
export const strategyKindSchema = z.enum([
  "rule_based",
  "structured_setup",
  "signal_follow",
  "ai_assisted",
  "discretionary"
]);

export const strategyStatusSchema = z.enum([
  "draft",
  "paper",
  "live",
  "paused",
  "retired"
]);

export const ruleOperatorSchema = z.enum([
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "crosses_above",
  "crosses_below",
  "between",
  "contains"
]);

export const ruleDefSchema = z.object({
  id: z.string(),
  // e.g. "price", "sma(20)", "rsi(14)", "signal.direction", "theme.heat"
  left: z.string().min(1),
  operator: ruleOperatorSchema,
  right: z.union([z.number(), z.string(), z.array(z.number())]),
  description: z.string().default("")
});

export const strategyConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: strategyKindSchema,
  status: strategyStatusSchema,
  description: z.string().default(""),
  // Entry / exit rules — all must evaluate true for action to fire.
  entryRules: z.array(ruleDefSchema).default([]),
  exitRules: z.array(ruleDefSchema).default([]),
  invalidationRules: z.array(ruleDefSchema).default([]),
  // Universe the strategy is allowed to act on. Empty = no symbols (safe
  // default; must opt in).
  symbolWhitelist: z.array(z.string()).default([]),
  themeIds: z.array(z.string().uuid()).default([]),
  // Sizing rule. "fixed_pct" respects risk.maxPerTradePct by default.
  sizing: z
    .object({
      mode: z
        .enum(["fixed_pct", "fixed_qty", "kelly", "risk_per_trade"])
        .default("risk_per_trade"),
      pct: z.number().min(0).max(100).default(1.0),
      qty: z.number().positive().nullable().default(null),
      maxPositionPct: z.number().min(0).max(100).default(15.0)
    })
    .default({
      mode: "risk_per_trade",
      pct: 1.0,
      qty: null,
      maxPositionPct: 15.0
    }),
  // Auto-trade is OFF by default. Promotion requires explicit operator flip.
  autoTrade: z.boolean().default(false),
  requiresHumanApproval: z.boolean().default(true),
  accountId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const strategyConfigCreateInputSchema = strategyConfigSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .partial({
    description: true,
    entryRules: true,
    exitRules: true,
    invalidationRules: true,
    symbolWhitelist: true,
    themeIds: true,
    sizing: true,
    autoTrade: true,
    requiresHumanApproval: true,
    accountId: true
  });

export const strategyConfigUpdateInputSchema =
  strategyConfigCreateInputSchema.partial();

export const strategyRunStateSchema = z.enum([
  "idle",
  "running",
  "paused",
  "errored",
  "stopped"
]);

export const strategyRunSchema = z.object({
  id: z.string().uuid(),
  strategyId: z.string().uuid(),
  state: strategyRunStateSchema,
  startedAt: z.string(),
  stoppedAt: z.string().nullable().default(null),
  lastTickAt: z.string().nullable().default(null),
  evaluations: z.number().int().nonnegative().default(0),
  signalsEmitted: z.number().int().nonnegative().default(0),
  ordersSubmitted: z.number().int().nonnegative().default(0),
  pnlRealized: z.number().default(0),
  pnlUnrealized: z.number().default(0),
  errorMessage: z.string().nullable().default(null),
  mode: z.enum(["paper", "live", "shadow"]).default("paper")
});

export const scoreOutputSchema = z.object({
  strategyId: z.string().uuid(),
  symbol: z.string(),
  direction: z.enum(["long", "short", "flat"]),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  evaluatedAt: z.string(),
  features: z.record(z.string(), z.number()).default({}),
  ruleTrace: z
    .array(
      z.object({
        ruleId: z.string(),
        passed: z.boolean(),
        observed: z.unknown()
      })
    )
    .default([])
});

export const strategyIdeaDirectionSchema = z.enum(["bullish", "bearish", "neutral"]);

export const strategyIdeaMarketDecisionSchema = z.enum(["allow", "review", "block"]);
export const strategyIdeasDecisionModeSchema = z.enum(["strategy", "paper", "execution"]);
export const strategyIdeasDecisionFilterSchema = z.enum(["allow", "review", "block", "usable_only"]);
export const strategyIdeasQualityFilterSchema = z.enum(["strategy_ready", "exclude_insufficient"]);
export const strategyIdeasSortSchema = z.enum([
  "score",
  "signal_strength",
  "signal_recency",
  "theme_rank",
  "symbol"
]);

export const strategyIdeaThemeSchema = z.object({
  themeId: z.string().uuid(),
  name: z.string().min(1).max(120),
  marketState: z.string().min(1).max(40),
  lifecycle: z.string().min(1).max(40),
  priority: z.number().int().min(1).max(5),
  score: z.number().min(0).max(100)
});

export const strategyIdeasQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(12),
  signalDays: z.coerce.number().int().min(1).max(90).default(14),
  includeBlocked: z.coerce.boolean().default(false),
  market: z.string().min(1).optional(),
  themeId: z.string().uuid().optional(),
  theme: z.string().trim().min(1).max(120).optional(),
  symbol: z.string().trim().min(1).max(32).optional(),
  decisionMode: strategyIdeasDecisionModeSchema.default("strategy"),
  decisionFilter: strategyIdeasDecisionFilterSchema.optional(),
  qualityFilter: strategyIdeasQualityFilterSchema.optional(),
  sort: strategyIdeasSortSchema.default("score")
});

export const strategyIdeaQualityDimensionSchema = z.object({
  grade: marketDataQualityGradeSchema,
  strategyUsable: z.boolean(),
  primaryReason: z.string().min(1).max(120)
});

export const strategyIdeaQualitySchema = z.object({
  grade: marketDataQualityGradeSchema,
  strategyUsable: z.boolean(),
  primaryReason: z.string().min(1).max(120),
  history: strategyIdeaQualityDimensionSchema,
  bars: strategyIdeaQualityDimensionSchema
});

export const strategyIdeaRationaleSchema = z.object({
  primaryReason: z.string().min(1).max(120),
  theme: z.object({
    topThemeId: z.string().uuid().nullable(),
    topThemeName: z.string().min(1).max(120).nullable(),
    score: z.number().min(0).max(100),
    relevance: z.enum(["high", "medium", "low", "none"]),
    marketState: z.string().min(1).max(40).nullable(),
    lifecycle: z.string().min(1).max(40).nullable()
  }),
  signals: z.object({
    recentCount: z.number().int().nonnegative(),
    bullishCount: z.number().int().nonnegative(),
    bearishCount: z.number().int().nonnegative(),
    latestSignalAt: z.string().nullable(),
    signalScore: z.number().min(0).max(100),
    hasRecentSignals: z.boolean(),
    primaryReason: z.string().min(1).max(120)
  }),
  marketData: z.object({
    mode: strategyIdeasDecisionModeSchema,
    decision: strategyIdeaMarketDecisionSchema,
    selectedSource: z.string().nullable(),
    readiness: z.enum(["ready", "degraded", "blocked"]),
    freshnessStatus: z.enum(["fresh", "stale", "missing"]),
    usable: z.boolean(),
    safe: z.boolean(),
    primaryReason: z.string().min(1).max(120),
    fallbackReason: z.string().min(1).max(120),
    staleReason: z.string().min(1).max(120)
  }),
  quality: z.object({
    grade: marketDataQualityGradeSchema,
    primaryReason: z.string().min(1).max(120)
  })
});

export const strategyIdeaSchema = z.object({
  companyId: z.string().uuid(),
  symbol: z.string().min(1),
  companyName: z.string().min(1).max(160),
  market: z.string().min(1).max(32),
  beneficiaryTier: z.string().min(1).max(40),
  direction: strategyIdeaDirectionSchema,
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  signalCount: z.number().int().nonnegative(),
  bullishSignalCount: z.number().int().nonnegative(),
  bearishSignalCount: z.number().int().nonnegative(),
  latestSignalAt: z.string().nullable(),
  topThemes: z.array(strategyIdeaThemeSchema).max(3),
  marketData: z.object({
    decisionMode: strategyIdeasDecisionModeSchema,
    selectedSource: z.string().nullable(),
    readiness: z.enum(["ready", "degraded", "blocked"]),
    freshnessStatus: z.enum(["fresh", "stale", "missing"]),
    decision: strategyIdeaMarketDecisionSchema,
    usable: z.boolean(),
    safe: z.boolean(),
    primaryReason: z.string(),
    fallbackReason: z.string(),
    staleReason: z.string()
  }),
  quality: strategyIdeaQualitySchema,
  rationale: strategyIdeaRationaleSchema
});

export const strategyIdeasSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  allow: z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
  block: z.number().int().nonnegative(),
  bullish: z.number().int().nonnegative(),
  bearish: z.number().int().nonnegative(),
  neutral: z.number().int().nonnegative(),
  quality: z.object({
    strategyReady: z.number().int().nonnegative(),
    referenceOnly: z.number().int().nonnegative(),
    insufficient: z.number().int().nonnegative(),
    primaryReasons: z.array(
      z.object({
        reason: z.string(),
        total: z.number().int().nonnegative()
      })
    )
  })
});

export const strategyIdeasViewSchema = z.object({
  generatedAt: z.string(),
  summary: strategyIdeasSummarySchema,
  items: z.array(strategyIdeaSchema)
});

export const strategyRunCreateInputSchema = strategyIdeasQuerySchema;

export const strategyRunListSortSchema = z.enum(["created_at", "score", "symbol"]);

export const strategyRunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  decisionMode: strategyIdeasDecisionModeSchema.optional(),
  symbol: z.string().trim().min(1).max(32).optional(),
  themeId: z.string().uuid().optional(),
  theme: z.string().trim().min(1).max(120).optional(),
  qualityFilter: strategyIdeasQualityFilterSchema.optional(),
  sort: strategyRunListSortSchema.default("created_at")
});

export const strategyRunOutputSchema = z.object({
  companyId: z.string().uuid(),
  symbol: z.string().min(1),
  companyName: z.string().min(1).max(160),
  direction: strategyIdeaDirectionSchema,
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  signalCount: z.number().int().nonnegative(),
  latestSignalAt: z.string().nullable(),
  topThemeId: z.string().uuid().nullable(),
  topThemeName: z.string().min(1).max(120).nullable(),
  marketDecision: strategyIdeaMarketDecisionSchema,
  selectedSource: z.string().nullable(),
  qualityGrade: marketDataQualityGradeSchema,
  primaryReason: z.string().min(1).max(120)
});

export const strategyRunRecordSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  generatedAt: z.string(),
  query: strategyRunCreateInputSchema,
  summary: strategyIdeasSummarySchema,
  items: z.array(strategyIdeaSchema).max(50).default([]),
  outputs: z.array(strategyRunOutputSchema).max(50)
});

export const strategyRunCompactIdeaSchema = z.object({
  companyId: z.string().uuid(),
  symbol: z.string().min(1),
  companyName: z.string().min(1).max(160),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  direction: strategyIdeaDirectionSchema,
  latestSignalAt: z.string().nullable(),
  topThemeId: z.string().uuid().nullable(),
  topThemeName: z.string().min(1).max(120).nullable(),
  marketDecision: strategyIdeaMarketDecisionSchema,
  selectedSource: z.string().nullable(),
  qualityGrade: marketDataQualityGradeSchema,
  primaryReason: z.string().min(1).max(120)
});

export const strategyRunListItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  generatedAt: z.string(),
  query: strategyRunCreateInputSchema,
  decisionMode: strategyIdeasDecisionModeSchema,
  summary: strategyIdeasSummarySchema,
  topIdea: strategyRunCompactIdeaSchema.nullable(),
  topSymbols: z.array(z.string().min(1)).max(5),
  quality: z.object({
    strategyReady: z.number().int().nonnegative(),
    referenceOnly: z.number().int().nonnegative(),
    insufficient: z.number().int().nonnegative(),
    primaryReason: z.string().min(1).max(120)
  })
});

export const strategyRunListViewSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(strategyRunListItemSchema)
});

// ---------------------------------------------------------------------------
// Autopilot Phase 1 — manual-trigger execute endpoint
// ---------------------------------------------------------------------------

export const autopilotSidePolicySchema = z.enum([
  "bullish_long",    // bullish ideas → buy only
  "bearish_short",   // bearish ideas → sell only (future use)
  "direction_match"  // map idea.direction to side: bullish→buy, bearish→sell
]);

export const autopilotSizeModeSchema = z.enum([
  "fixed_pct",      // fixed % of equity per order (default 1%)
  "equal_weight"    // divide budget equally across N ideas (future use)
]);

export const autopilotExecuteInputSchema = z.object({
  accountId: z.string().min(1).default("paper-default"),
  sidePolicy: autopilotSidePolicySchema.default("bullish_long"),
  sizeMode: autopilotSizeModeSchema.default("fixed_pct"),
  sizePct: z.number().min(0.1).max(10).default(1.0),
  symbols: z.array(z.string()).optional(),
  maxOrders: z.number().int().min(1).max(10).default(3),
  dryRun: z.boolean().default(false),
  confirmToken: z.string().optional()
});

// ---------------------------------------------------------------------------
// Autopilot Phase 2 (c) — Confirm Gate
// ---------------------------------------------------------------------------

export const autopilotExecuteErrorCodeSchema = z.enum([
  "confirm_required",  // dryRun:false without any confirmToken
  "confirm_invalid",   // token present but not found in store (wrong token)
  "confirm_expired",   // token was valid but TTL has elapsed
  "confirm_used",      // token already consumed (replay attempt)
  "confirm_run_mismatch" // token exists but bound to a different runId
]);

export const autopilotConfirmTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string() // ISO 8601
});

export const autopilotOrderResultSchema = z.object({
  symbol: z.string(),
  side: orderSideSchema,
  quantity: z.number(),
  price: z.number().nullable(),
  submitResult: submitOrderResultSchema.nullable(),
  blocked: z.boolean(),
  blockedReason: z.string().nullable()
});

export const autopilotExecuteResultSchema = z.object({
  runId: z.string().uuid(),
  dryRun: z.boolean(),
  executedAt: z.string(),
  submitted: z.array(autopilotOrderResultSchema),
  blocked: z.array(autopilotOrderResultSchema),
  errors: z.array(z.object({ symbol: z.string(), message: z.string() })),
  summary: z.object({
    total: z.number().int(),
    submittedCount: z.number().int(),
    blockedCount: z.number().int(),
    errorCount: z.number().int()
  })
});

export type AutopilotSidePolicy = z.infer<typeof autopilotSidePolicySchema>;
export type AutopilotSizeMode = z.infer<typeof autopilotSizeModeSchema>;
export type AutopilotExecuteInput = z.infer<typeof autopilotExecuteInputSchema>;
export type AutopilotOrderResult = z.infer<typeof autopilotOrderResultSchema>;
export type AutopilotExecuteResult = z.infer<typeof autopilotExecuteResultSchema>;
export type AutopilotExecuteErrorCode = z.infer<typeof autopilotExecuteErrorCodeSchema>;
export type AutopilotConfirmTokenResponse = z.infer<typeof autopilotConfirmTokenResponseSchema>;

export type StrategyKind = z.infer<typeof strategyKindSchema>;
export type StrategyStatus = z.infer<typeof strategyStatusSchema>;
export type RuleOperator = z.infer<typeof ruleOperatorSchema>;
export type RuleDef = z.infer<typeof ruleDefSchema>;
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;
export type StrategyConfigCreateInput = z.infer<
  typeof strategyConfigCreateInputSchema
>;
export type StrategyConfigUpdateInput = z.infer<
  typeof strategyConfigUpdateInputSchema
>;
export type StrategyRunState = z.infer<typeof strategyRunStateSchema>;
export type StrategyRun = z.infer<typeof strategyRunSchema>;
export type ScoreOutput = z.infer<typeof scoreOutputSchema>;
export type StrategyIdeaDirection = z.infer<typeof strategyIdeaDirectionSchema>;
export type StrategyIdeaMarketDecision = z.infer<typeof strategyIdeaMarketDecisionSchema>;
export type StrategyIdeasDecisionMode = z.infer<typeof strategyIdeasDecisionModeSchema>;
export type StrategyIdeasDecisionFilter = z.infer<typeof strategyIdeasDecisionFilterSchema>;
export type StrategyIdeasQualityFilter = z.infer<typeof strategyIdeasQualityFilterSchema>;
export type StrategyIdeasSort = z.infer<typeof strategyIdeasSortSchema>;
export type StrategyIdeaTheme = z.infer<typeof strategyIdeaThemeSchema>;
export type StrategyIdeaRationale = z.infer<typeof strategyIdeaRationaleSchema>;
export type StrategyIdea = z.infer<typeof strategyIdeaSchema>;
export type StrategyIdeasQuery = z.infer<typeof strategyIdeasQuerySchema>;
export type StrategyIdeasSummary = z.infer<typeof strategyIdeasSummarySchema>;
export type StrategyIdeasView = z.infer<typeof strategyIdeasViewSchema>;
export type StrategyRunCreateInput = z.infer<typeof strategyRunCreateInputSchema>;
export type StrategyRunListSort = z.infer<typeof strategyRunListSortSchema>;
export type StrategyRunListQuery = z.infer<typeof strategyRunListQuerySchema>;
export type StrategyRunOutput = z.infer<typeof strategyRunOutputSchema>;
export type StrategyRunRecord = z.infer<typeof strategyRunRecordSchema>;
export type StrategyRunCompactIdea = z.infer<typeof strategyRunCompactIdeaSchema>;
export type StrategyRunListItem = z.infer<typeof strategyRunListItemSchema>;
export type StrategyRunListView = z.infer<typeof strategyRunListViewSchema>;
