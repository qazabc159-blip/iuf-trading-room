import { z } from "zod";

// Quote sources are swappable: TradingView for prototyping, KGI / others for
// live execution, paper for backtest. Frontend only consumes the unified
// schemas below — it never binds to a single vendor.
export const quoteSourceSchema = z.enum([
  "tradingview",
  "kgi",
  "paper",
  "manual"
]);

export const marketSchema = z.enum([
  "TWSE",
  "TPEX",
  "TWO",
  "TW_EMERGING",
  "TW_INDEX",
  "OTHER"
]);

export const barIntervalSchema = z.enum([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w"
]);

export const symbolMasterSchema = z.object({
  symbol: z.string().min(1),
  market: marketSchema,
  name: z.string(),
  nameEn: z.string().default(""),
  lotSize: z.number().int().positive().default(1000),
  tickSize: z.number().positive().default(0.01),
  currency: z.string().default("TWD"),
  isActive: z.boolean().default(true),
  industry: z.string().default(""),
  companyId: z.string().uuid().nullable().default(null)
});

export const quoteSchema = z.object({
  symbol: z.string(),
  market: marketSchema,
  source: quoteSourceSchema,
  last: z.number().nullable(),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  prevClose: z.number().nullable(),
  volume: z.number().nonnegative().nullable(),
  changePct: z.number().nullable(),
  timestamp: z.string(),
  // Freshness hint: ms since the provider emitted this quote. Risk engine uses
  // it for stale-quote guard; UI uses it to dim / warn.
  ageMs: z.number().int().nonnegative().default(0),
  isStale: z.boolean().default(false)
});

export const tickSchema = z.object({
  symbol: z.string(),
  source: quoteSourceSchema,
  price: z.number(),
  size: z.number().nonnegative(),
  side: z.enum(["buy", "sell", "unknown"]).default("unknown"),
  timestamp: z.string()
});

export const barSchema = z.object({
  symbol: z.string(),
  interval: barIntervalSchema,
  source: quoteSourceSchema,
  openTime: z.string(),
  closeTime: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
  turnover: z.number().nonnegative().default(0)
});

export const subscriptionRequestSchema = z.object({
  symbols: z.array(z.string().min(1)).min(1),
  channels: z
    .array(z.enum(["quote", "tick", "bar"]))
    .default(["quote"]),
  interval: barIntervalSchema.optional(),
  source: quoteSourceSchema.optional()
});

export const quoteProviderStatusSchema = z.object({
  source: quoteSourceSchema,
  connected: z.boolean(),
  lastMessageAt: z.string().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  latestQuoteAgeMs: z.number().int().nonnegative().nullable().default(null),
  freshnessStatus: z.enum(["fresh", "stale", "missing"]).default("missing"),
  readiness: z.enum(["ready", "degraded", "blocked"]).default("blocked"),
  strategyUsable: z.boolean().default(false),
  paperUsable: z.boolean().default(false),
  liveUsable: z.boolean().default(false),
  staleAfterMs: z.number().int().positive().nullable().default(null),
  subscribedSymbols: z.array(z.string()).default([]),
  reasons: z.array(z.string()).default([]),
  errorMessage: z.string().nullable().default(null)
});

export const marketDataConsumerModeSchema = z.enum([
  "strategy",
  "paper",
  "execution"
]);

export const marketDataConsumerDecisionSchema = z.enum([
  "allow",
  "review",
  "block"
]);

export const marketDataConsumerItemSchema = z.object({
  symbol: z.string(),
  market: marketSchema,
  mode: marketDataConsumerModeSchema,
  selectedSource: quoteSourceSchema.nullable(),
  selectedQuote: quoteSchema.nullable(),
  readiness: z.enum(["ready", "degraded", "blocked"]),
  decision: marketDataConsumerDecisionSchema,
  usable: z.boolean(),
  safe: z.boolean(),
  freshnessStatus: z.enum(["fresh", "stale", "missing"]),
  fallbackReason: z.string(),
  staleReason: z.string(),
  reasons: z.array(z.string()),
  candidates: z.array(
    z.object({
      source: quoteSourceSchema,
      priority: z.number().int().nonnegative(),
      providerConnected: z.boolean(),
      subscribed: z.boolean(),
      eligible: z.boolean(),
      freshnessStatus: z.enum(["fresh", "stale", "missing"]),
      staleReason: z.enum(["none", "age_exceeded", "missing_last", "no_quote", "provider_unavailable"]),
      quote: quoteSchema.nullable()
    })
  )
});

export const marketDataConsumerSummarySchema = z.object({
  generatedAt: z.string(),
  mode: marketDataConsumerModeSchema,
  summary: z.object({
    total: z.number().int().nonnegative(),
    allow: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    block: z.number().int().nonnegative(),
    usable: z.number().int().nonnegative(),
    safe: z.number().int().nonnegative(),
    selectedSources: z.array(
      z.object({
        source: quoteSourceSchema,
        total: z.number().int().nonnegative()
      })
    ),
    fallbackReasons: z.array(
      z.object({
        reason: z.string(),
        total: z.number().int().nonnegative()
      })
    ),
    staleReasons: z.array(
      z.object({
        reason: z.string(),
        total: z.number().int().nonnegative()
      })
    ),
    reasons: z.array(
      z.object({
        reason: z.string(),
        total: z.number().int().nonnegative()
      })
    )
  }),
  items: z.array(marketDataConsumerItemSchema)
});

export const marketDataSurfaceMetadataSchema = z.object({
  version: z.string().min(1),
  capabilities: z.object({
    providers: z.boolean(),
    policy: z.boolean(),
    symbols: z.boolean(),
    quotes: z.boolean(),
    resolve: z.boolean(),
    effectiveQuotes: z.boolean(),
    consumerSummary: z.boolean(),
    history: z.boolean(),
    historyDiagnostics: z.boolean(),
    bars: z.boolean(),
    barDiagnostics: z.boolean(),
    overview: z.boolean()
  }),
  preferredEntryPoints: z.object({
    strategy: z.string().min(1),
    paper: z.string().min(1),
    execution: z.string().min(1),
    ops: z.string().min(1)
  })
});

export type QuoteSource = z.infer<typeof quoteSourceSchema>;
export type Market = z.infer<typeof marketSchema>;
export type BarInterval = z.infer<typeof barIntervalSchema>;
export type SymbolMaster = z.infer<typeof symbolMasterSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type Tick = z.infer<typeof tickSchema>;
export type Bar = z.infer<typeof barSchema>;
export type SubscriptionRequest = z.infer<typeof subscriptionRequestSchema>;
export type QuoteProviderStatus = z.infer<typeof quoteProviderStatusSchema>;
export type MarketDataConsumerMode = z.infer<typeof marketDataConsumerModeSchema>;
export type MarketDataConsumerDecision = z.infer<typeof marketDataConsumerDecisionSchema>;
export type MarketDataConsumerItem = z.infer<typeof marketDataConsumerItemSchema>;
export type MarketDataConsumerSummary = z.infer<typeof marketDataConsumerSummarySchema>;
export type MarketDataSurfaceMetadata = z.infer<typeof marketDataSurfaceMetadataSchema>;
