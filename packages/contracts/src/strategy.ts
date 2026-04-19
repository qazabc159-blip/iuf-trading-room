import { z } from "zod";

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
  sort: strategyIdeasSortSchema.default("score")
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
  rationale: strategyIdeaRationaleSchema
});

export const strategyIdeasViewSchema = z.object({
  generatedAt: z.string(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    allow: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    block: z.number().int().nonnegative(),
    bullish: z.number().int().nonnegative(),
    bearish: z.number().int().nonnegative(),
    neutral: z.number().int().nonnegative()
  }),
  items: z.array(strategyIdeaSchema)
});

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
export type StrategyIdeasSort = z.infer<typeof strategyIdeasSortSchema>;
export type StrategyIdeaTheme = z.infer<typeof strategyIdeaThemeSchema>;
export type StrategyIdeaRationale = z.infer<typeof strategyIdeaRationaleSchema>;
export type StrategyIdea = z.infer<typeof strategyIdeaSchema>;
export type StrategyIdeasQuery = z.infer<typeof strategyIdeasQuerySchema>;
export type StrategyIdeasView = z.infer<typeof strategyIdeasViewSchema>;
