import {
  type AppSession,
  barIntervalSchema,
  barSchema,
  type Company,
  marketDataBarDiagnosticsResponseSchema,
  marketDataConsumerDecisionSchema,
  marketDataConsumerModeSchema,
  marketDataConsumerSummarySchema,
  marketDataDecisionSummarySchema,
  marketDataHistoryDiagnosticsResponseSchema,
  marketDataSelectionSummarySchema,
  marketDataSurfaceMetadataSchema,
  type Market,
  marketSchema,
  quoteProviderStatusSchema,
  quoteSchema,
  quoteSourceSchema,
  symbolMasterSchema,
  type BarInterval,
  type Quote,
  type QuoteProviderStatus,
  type QuoteSource,
  type SymbolMaster
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";
import { z } from "zod";

import {
  appendPersistedQuoteEntries,
  loadPersistedQuoteEntries
} from "./market-data-store.js";

type QuoteCacheEntry = Quote & {
  updatedAt: string;
};

type QuoteProviderAdapter = {
  source: QuoteSource;
  listQuotes: (workspaceSlug: string) => Promise<Quote[]>;
  getStatus: (workspaceSlug: string) => Promise<QuoteProviderStatus>;
};

type QuoteResolutionFreshnessStatus = "fresh" | "stale" | "missing";
type QuoteResolutionFallbackReason =
  | "none"
  | "higher_priority_stale"
  | "higher_priority_missing"
  | "higher_priority_unavailable"
  | "no_fresh_quote"
  | "no_quote";
type QuoteResolutionStaleReason =
  | "none"
  | "age_exceeded"
  | "missing_last"
  | "no_quote"
  | "provider_unavailable";
type TimeWindowCompleteness = "unbounded" | "empty" | "partial" | "complete";
type EffectiveQuoteReadiness = "ready" | "degraded" | "blocked";
type MarketDataQualityGrade = "strategy_ready" | "reference_only" | "insufficient";
type MarketDataConsumerMode = z.infer<typeof marketDataConsumerModeSchema>;
type MarketDataSurfaceMetadata = z.infer<typeof marketDataSurfaceMetadataSchema>;

const quoteResolutionFreshnessStatusSchema = z.enum(["fresh", "stale", "missing"]);
const quoteResolutionFallbackReasonSchema = z.enum([
  "none",
  "higher_priority_stale",
  "higher_priority_missing",
  "higher_priority_unavailable",
  "no_fresh_quote",
  "no_quote"
]);
const quoteResolutionStaleReasonSchema = z.enum([
  "none",
  "age_exceeded",
  "missing_last",
  "no_quote",
  "provider_unavailable"
]);
const timeWindowCompletenessSchema = z.enum(["unbounded", "empty", "partial", "complete"]);
const effectiveQuoteReadinessSchema = z.enum(["ready", "degraded", "blocked"]);
const quoteResolutionCandidateSchema = z.object({
  source: quoteSourceSchema,
  priority: z.number().int().nonnegative(),
  providerConnected: z.boolean(),
  subscribed: z.boolean(),
  eligible: z.boolean(),
  freshnessStatus: quoteResolutionFreshnessStatusSchema,
  staleReason: quoteResolutionStaleReasonSchema,
  quote: quoteSchema.nullable()
});
const quoteResolutionSchema = z.object({
  symbol: z.string(),
  market: marketSchema,
  selectedSource: quoteSourceSchema.nullable(),
  selectedQuote: quoteSchema.nullable(),
  preferredSource: quoteSourceSchema.nullable(),
  preferredQuote: quoteSchema.nullable(),
  freshnessStatus: quoteResolutionFreshnessStatusSchema,
  fallbackReason: quoteResolutionFallbackReasonSchema,
  staleReason: quoteResolutionStaleReasonSchema,
  candidates: z.array(quoteResolutionCandidateSchema)
});
const effectiveMarketQuoteSchema = z.object({
  symbol: z.string(),
  market: marketSchema,
  selectedSource: quoteSourceSchema.nullable(),
  selectedQuote: quoteSchema.nullable(),
  freshnessStatus: quoteResolutionFreshnessStatusSchema,
  fallbackReason: quoteResolutionFallbackReasonSchema,
  staleReason: quoteResolutionStaleReasonSchema,
  readiness: effectiveQuoteReadinessSchema,
  strategyUsable: z.boolean(),
  paperUsable: z.boolean(),
  liveUsable: z.boolean(),
  synthetic: z.boolean(),
  providerConnected: z.boolean(),
  staleAfterMs: z.number().int().positive().nullable(),
  sourcePriority: z.number().int().nonnegative().nullable(),
  reasons: z.array(z.string()),
  candidates: z.array(quoteResolutionCandidateSchema)
});

const manualQuoteUpsertItemSchema = z.object({
  symbol: z.string().min(1).max(32),
  market: marketSchema,
  source: quoteSourceSchema.default("manual"),
  last: z.number().nullable(),
  bid: z.number().nullable().default(null),
  ask: z.number().nullable().default(null),
  open: z.number().nullable().default(null),
  high: z.number().nullable().default(null),
  low: z.number().nullable().default(null),
  prevClose: z.number().nullable().default(null),
  volume: z.number().nonnegative().nullable().default(null),
  changePct: z.number().nullable().default(null),
  timestamp: z.string().datetime().optional()
});

export const manualQuoteUpsertSchema = z.object({
  quotes: z.array(manualQuoteUpsertItemSchema).min(1).max(200)
});

export const marketDataProvidersQuerySchema = z.object({
  sources: z
    .string()
    .trim()
    .min(1)
    .optional()
});

export const marketDataSymbolsQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  market: marketSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

export const marketDataQuotesQuerySchema = z.object({
  symbols: z.string().trim().min(1).optional(),
  market: marketSchema.optional(),
  source: quoteSourceSchema.optional(),
  includeStale: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

export const marketDataOverviewQuerySchema = z.object({
  sources: z
    .string()
    .trim()
    .min(1)
    .optional(),
  includeStale: z.coerce.boolean().optional(),
  topLimit: z.coerce.number().int().min(1).max(20).optional()
});

export const marketDataPolicyQuerySchema = z.object({});

export const marketDataHistoryQuerySchema = z.object({
  symbols: z.string().trim().min(1).optional(),
  market: marketSchema.optional(),
  source: quoteSourceSchema.optional(),
  includeStale: z.coerce.boolean().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional()
});

export const marketDataBarsQuerySchema = z.object({
  symbols: z.string().trim().min(1),
  market: marketSchema.optional(),
  source: quoteSourceSchema.optional(),
  interval: barIntervalSchema.default("1m"),
  includeStale: z.coerce.boolean().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

export const marketDataHistoryDiagnosticsQuerySchema = marketDataHistoryQuerySchema;
export const marketDataBarDiagnosticsQuerySchema = marketDataBarsQuerySchema;

export const marketDataResolveQuerySchema = z.object({
  symbols: z.string().trim().min(1),
  market: marketSchema.optional(),
  includeStale: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

export const marketDataEffectiveQuotesQuerySchema = marketDataResolveQuerySchema;
export const marketDataConsumerSummaryQuerySchema = marketDataEffectiveQuotesQuerySchema.extend({
  mode: marketDataConsumerModeSchema.default("strategy")
});
export const marketDataSelectionSummaryQuerySchema = marketDataEffectiveQuotesQuerySchema;
export const marketDataDecisionSummaryQuerySchema = marketDataEffectiveQuotesQuerySchema;

const providerQuoteCache = new Map<string, Map<string, QuoteCacheEntry>>();
const providerQuoteHistoryCache = new Map<string, Map<string, QuoteCacheEntry[]>>();
const persistedQuoteHistoryLoaded = new Set<string>();
const quoteProviderSources: QuoteSource[] = ["manual", "paper", "tradingview", "kgi"];
const defaultSourcePriorityOrder: QuoteSource[] = ["kgi", "tradingview", "paper", "manual"];
const MARKET_DATA_SURFACE_VERSION = "market-data-v1.11-overview-quality-rollup";
const historyQualityReasonBuckets = [
  "history_strategy_ready",
  "missing_history",
  "stale_history",
  "insufficient_points",
  "partial_time_window",
  "synthetic_history"
] as const;
const barQualityReasonBuckets = [
  "bar_series_strategy_ready",
  "missing_bars",
  "stale_bars",
  "insufficient_bars",
  "partial_time_window",
  "synthetic_bars",
  "approximate_bars"
] as const;

function getSourcePriorityOrder() {
  const configured = (process.env.QUOTE_SOURCE_PRIORITY ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is QuoteSource => quoteProviderSources.includes(value as QuoteSource));

  const seen = new Set<QuoteSource>();
  const ordered = [...configured, ...defaultSourcePriorityOrder].filter((source): source is QuoteSource => {
    if (seen.has(source)) {
      return false;
    }
    seen.add(source);
    return true;
  });

  return ordered;
}

function getSourcePriorityMap() {
  const order = getSourcePriorityOrder();
  return order.reduce<Record<QuoteSource, number>>(
    (accumulator, source, index) => {
      accumulator[source] = order.length - index;
      return accumulator;
    },
    {
      manual: 1,
      paper: 1,
      tradingview: 1,
      kgi: 1
    }
  );
}

function getSourcePriority(source: QuoteSource) {
  return getSourcePriorityMap()[source];
}

function getQuoteStaleMs(source: QuoteSource) {
  const envKey =
    source === "manual"
      ? "MANUAL_QUOTE_STALE_MS"
      : source === "paper"
        ? "PAPER_QUOTE_STALE_MS"
        : source === "tradingview"
          ? "TRADINGVIEW_QUOTE_STALE_MS"
          : "KGI_QUOTE_STALE_MS";
  const fallback =
    source === "manual"
      ? 60_000
      : source === "paper"
        ? 15_000
        : 5_000;
  const raw = Number(process.env[envKey]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function getQuoteCacheForWorkspace(workspaceSlug: string) {
  let workspaceCache = providerQuoteCache.get(workspaceSlug);
  if (!workspaceCache) {
    workspaceCache = new Map<string, QuoteCacheEntry>();
    providerQuoteCache.set(workspaceSlug, workspaceCache);
  }

  return workspaceCache;
}

function getQuoteHistoryCacheForWorkspace(workspaceSlug: string) {
  let workspaceHistory = providerQuoteHistoryCache.get(workspaceSlug);
  if (!workspaceHistory) {
    workspaceHistory = new Map<string, QuoteCacheEntry[]>();
    providerQuoteHistoryCache.set(workspaceSlug, workspaceHistory);
  }

  return workspaceHistory;
}

function normalizePersistedEntry(entry: Awaited<ReturnType<typeof loadPersistedQuoteEntries>>[number]): QuoteCacheEntry {
  return {
    ...entry,
    ageMs: 0,
    isStale: false,
    updatedAt: entry.updatedAt ?? entry.timestamp
  };
}

function pushQuoteEntry(
  workspaceCache: Map<string, QuoteCacheEntry>,
  workspaceHistory: Map<string, QuoteCacheEntry[]>,
  entry: QuoteCacheEntry
) {
  const cacheKey = buildQuoteCacheKey(entry.symbol, entry.market, entry.source);
  const currentCacheEntry = workspaceCache.get(cacheKey);
  if (!currentCacheEntry || currentCacheEntry.timestamp.localeCompare(entry.timestamp) <= 0) {
    workspaceCache.set(cacheKey, entry);
  }

  const history = workspaceHistory.get(cacheKey) ?? [];
  const lastHistoryEntry = history.at(-1);
  const isDuplicateHistoryEntry =
    lastHistoryEntry?.timestamp === entry.timestamp
    && lastHistoryEntry?.last === entry.last
    && lastHistoryEntry?.bid === entry.bid
    && lastHistoryEntry?.ask === entry.ask
    && lastHistoryEntry?.volume === entry.volume;

  if (!isDuplicateHistoryEntry) {
    history.push(entry);
    const historyLimit = getQuoteHistoryLimit(entry.source);
    if (history.length > historyLimit) {
      history.splice(0, history.length - historyLimit);
    }
    workspaceHistory.set(cacheKey, history);
    return true;
  }

  return false;
}

async function ensurePersistedQuoteHistoryLoaded(workspaceSlug: string) {
  if (persistedQuoteHistoryLoaded.has(workspaceSlug)) {
    return;
  }

  const persistedEntries = await loadPersistedQuoteEntries(workspaceSlug);
  const workspaceCache = getQuoteCacheForWorkspace(workspaceSlug);
  const workspaceHistory = getQuoteHistoryCacheForWorkspace(workspaceSlug);

  for (const persistedEntry of persistedEntries) {
    pushQuoteEntry(workspaceCache, workspaceHistory, normalizePersistedEntry(persistedEntry));
  }

  persistedQuoteHistoryLoaded.add(workspaceSlug);
}

function listCachedProviderQuotes(workspaceSlug: string, source: QuoteSource) {
  const cache = getQuoteCacheForWorkspace(workspaceSlug);
  return [...cache.values()]
    .filter((entry) => entry.source === source)
    .map(withFreshness)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function listCachedProviderQuoteHistory(workspaceSlug: string, source: QuoteSource) {
  const historyCache = getQuoteHistoryCacheForWorkspace(workspaceSlug);
  return [...historyCache.entries()]
    .filter(([key]) => key.startsWith(`${source}:`))
    .flatMap(([, entries]) => entries.map(withFreshness))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function buildQuoteCacheKey(symbol: string, market: Market, source: QuoteSource) {
  return `${source}:${market}:${symbol.toUpperCase()}`;
}

function buildQuoteIdentityKey(symbol: string, market: Market) {
  return `${market}:${symbol.toUpperCase()}`;
}

function toIso(value?: string) {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function withFreshness(entry: QuoteCacheEntry): Quote {
  const ageMs = Math.max(0, Date.now() - new Date(entry.timestamp).getTime());
  const isStale = ageMs > getQuoteStaleMs(entry.source);

  return quoteSchema.parse({
    ...entry,
    ageMs,
    isStale
  });
}

function getQuoteHistoryLimit(source: QuoteSource) {
  const envKey =
    source === "manual"
      ? "MANUAL_QUOTE_HISTORY_LIMIT"
      : source === "paper"
        ? "PAPER_QUOTE_HISTORY_LIMIT"
        : source === "tradingview"
          ? "TRADINGVIEW_QUOTE_HISTORY_LIMIT"
          : "KGI_QUOTE_HISTORY_LIMIT";
  const raw = Number(process.env[envKey]);
  return Number.isFinite(raw) && raw > 0 ? raw : 512;
}

function isSyntheticSource(source: QuoteSource) {
  return source === "manual" || source === "paper";
}

function getTimeWindowCompleteness(input: {
  count: number;
  firstTimestamp?: string | null;
  lastTimestamp?: string | null;
  from?: string;
  to?: string;
}): TimeWindowCompleteness {
  if (!input.from && !input.to) {
    return "unbounded";
  }

  if (input.count === 0 || !input.firstTimestamp || !input.lastTimestamp) {
    return "empty";
  }

  const hasFromCoverage = !input.from || input.firstTimestamp <= input.from;
  const hasToCoverage = !input.to || input.lastTimestamp >= input.to;
  return hasFromCoverage && hasToCoverage ? "complete" : "partial";
}

function getTimestampAgeMs(timestamp?: string | null) {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.max(0, Date.now() - parsed);
}

function buildHistoryQualityAssessment(input: {
  pointCount: number;
  freshnessStatus: QuoteResolutionFreshnessStatus;
  timeWindowCompleteness: TimeWindowCompleteness;
  synthetic: boolean;
}) {
  const reasons: string[] = [];
  let grade: MarketDataQualityGrade = "strategy_ready";
  let primaryReason = "history_strategy_ready";

  if (input.pointCount === 0 || input.timeWindowCompleteness === "empty") {
    grade = "insufficient";
    primaryReason = "missing_history";
  } else if (input.freshnessStatus !== "fresh") {
    grade = "insufficient";
    primaryReason = "stale_history";
  } else if (input.pointCount < 2) {
    grade = "insufficient";
    primaryReason = "insufficient_points";
  } else if (input.synthetic) {
    grade = "reference_only";
    primaryReason = "synthetic_history";
  } else if (input.timeWindowCompleteness === "partial") {
    grade = "reference_only";
    primaryReason = "partial_time_window";
  }

  reasons.push(primaryReason);

  return {
    grade,
    strategyUsable: grade === "strategy_ready",
    referenceOnly: grade === "reference_only",
    primaryReason,
    reasons
  };
}

function buildBarQualityAssessment(input: {
  barCount: number;
  freshnessStatus: QuoteResolutionFreshnessStatus;
  timeWindowCompleteness: TimeWindowCompleteness;
  synthetic: boolean;
  approximate: boolean;
}) {
  const reasons: string[] = [];
  let grade: MarketDataQualityGrade = "strategy_ready";
  let primaryReason = "bar_series_strategy_ready";

  if (input.barCount === 0 || input.timeWindowCompleteness === "empty") {
    grade = "insufficient";
    primaryReason = "missing_bars";
  } else if (input.freshnessStatus !== "fresh") {
    grade = "insufficient";
    primaryReason = "stale_bars";
  } else if (input.barCount < 2) {
    grade = "insufficient";
    primaryReason = "insufficient_bars";
  } else if (input.synthetic) {
    grade = "reference_only";
    primaryReason = "synthetic_bars";
  } else if (input.approximate) {
    grade = "reference_only";
    primaryReason = "approximate_bars";
  } else if (input.timeWindowCompleteness === "partial") {
    grade = "reference_only";
    primaryReason = "partial_time_window";
  }

  reasons.push(primaryReason);

  return {
    grade,
    strategyUsable: grade === "strategy_ready",
    referenceOnly: grade === "reference_only",
    primaryReason,
    reasons
  };
}

function summarizeQualityAssessments<T extends { source: QuoteSource | null; quality: { grade: MarketDataQualityGrade; primaryReason: string } }>(
  items: T[],
  primaryReasonBuckets: readonly string[]
) {
  return {
    total: items.length,
    strategyReady: items.filter((item) => item.quality.grade === "strategy_ready").length,
    referenceOnly: items.filter((item) => item.quality.grade === "reference_only").length,
    insufficient: items.filter((item) => item.quality.grade === "insufficient").length,
    primaryReasons: summarizeReasonCounts(
      [...primaryReasonBuckets],
      items.map((item) => ({ reasons: [item.quality.primaryReason] }))
    ),
    sources: quoteProviderSources.map((source) => ({
      source,
      total: items.filter((item) => item.source === source).length
    }))
  };
}

function compareQuotes(left: Quote, right: Quote) {
  if (left.isStale !== right.isStale) {
    return left.isStale ? 1 : -1;
  }

  const sourcePriority = getSourcePriorityMap();
  const priorityDiff = sourcePriority[right.source] - sourcePriority[left.source];
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const timestampDiff = right.timestamp.localeCompare(left.timestamp);
  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  return right.symbol.localeCompare(left.symbol);
}

function dedupePreferredQuotes(quotes: Quote[]) {
  const preferredBySymbol = new Map<string, Quote>();

  for (const quote of quotes) {
    const key = buildQuoteIdentityKey(quote.symbol, quote.market);
    const current = preferredBySymbol.get(key);
    if (!current || compareQuotes(current, quote) > 0) {
      preferredBySymbol.set(key, quote);
    }
  }

  return [...preferredBySymbol.values()].sort(compareQuotes);
}

function getPreferredSourceBySymbol(quotes: Quote[]) {
  const preferred = new Map<string, QuoteSource>();
  for (const quote of dedupePreferredQuotes(quotes)) {
    preferred.set(buildQuoteIdentityKey(quote.symbol, quote.market), quote.source);
  }
  return preferred;
}

function getQuoteFreshnessStatus(quote: Quote | null): QuoteResolutionFreshnessStatus {
  if (!quote) {
    return "missing";
  }

  if (quote.last === null || quote.isStale) {
    return "stale";
  }

  return "fresh";
}

function getQuoteStaleReason(quote: Quote | null): QuoteResolutionStaleReason {
  if (!quote) {
    return "no_quote";
  }

  if (quote.last === null) {
    return "missing_last";
  }

  if (quote.isStale) {
    return "age_exceeded";
  }

  return "none";
}

function buildEffectiveQuoteReasons(input: {
  selectedSource: QuoteSource | null;
  fallbackReason: QuoteResolutionFallbackReason;
  staleReason: QuoteResolutionStaleReason;
  synthetic: boolean;
  providerConnected: boolean;
}) {
  const reasons: string[] = [];
  if (input.selectedSource === null) {
    reasons.push("missing_quote");
  }
  if (input.fallbackReason !== "none") {
    reasons.push(`fallback:${input.fallbackReason}`);
  }
  if (input.staleReason !== "none") {
    reasons.push(`stale:${input.staleReason}`);
  }
  if (input.synthetic) {
    reasons.push("synthetic_source");
  }
  if (input.selectedSource !== null && input.selectedSource !== "kgi") {
    reasons.push("non_live_source");
  }
  if (input.selectedSource !== null && !input.providerConnected) {
    reasons.push("provider_disconnected");
  }
  return reasons;
}

function buildConsumerDecision(input: {
  mode: MarketDataConsumerMode;
  selectedSource: QuoteSource | null;
  providerConnected: boolean;
  freshnessStatus: QuoteResolutionFreshnessStatus;
  strategyUsable: boolean;
  paperUsable: boolean;
  liveUsable: boolean;
  readiness: EffectiveQuoteReadiness;
}) {
  if (input.mode === "execution") {
    if (input.liveUsable && input.readiness === "ready") {
      return marketDataConsumerDecisionSchema.parse("allow");
    }

    if (input.selectedSource !== null && input.providerConnected && input.freshnessStatus === "fresh") {
      return marketDataConsumerDecisionSchema.parse("review");
    }

    return marketDataConsumerDecisionSchema.parse("block");
  }

  const usable =
    input.mode === "strategy"
      ? input.strategyUsable
      : input.mode === "paper"
        ? input.paperUsable
        : input.liveUsable;
  const safe = usable && input.readiness === "ready";
  const decision = !usable
    ? "block"
    : safe
      ? "allow"
      : "review";

  return marketDataConsumerDecisionSchema.parse(decision);
}

function summarizeReasonCounts(reasonBuckets: string[], items: Array<{ reasons: string[] }>) {
  const counts = new Map<string, number>(reasonBuckets.map((reason) => [reason, 0]));

  for (const item of items) {
    for (const reason of item.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([reason, total]) => ({ reason, total }))
    .filter((entry) => entry.total > 0);
}

function buildProviderReadiness(input: {
  source: QuoteSource;
  connected: boolean;
  latestQuote: Quote | null;
}) {
  const freshnessStatus = getQuoteFreshnessStatus(input.latestQuote);
  const synthetic = isSyntheticSource(input.source);
  const strategyUsable = input.connected && freshnessStatus === "fresh";
  const paperUsable = input.connected && freshnessStatus === "fresh";
  const liveUsable = input.connected && freshnessStatus === "fresh" && input.source === "kgi";
  const readiness: EffectiveQuoteReadiness =
    !input.connected || freshnessStatus !== "fresh"
      ? "blocked"
      : synthetic || input.source === "tradingview"
        ? "degraded"
        : "ready";
  const reasons: string[] = [];

  if (!input.connected) {
    reasons.push("provider_disconnected");
  }
  if (freshnessStatus === "missing") {
    reasons.push("missing_quote");
  } else if (freshnessStatus === "stale") {
    reasons.push(`stale:${getQuoteStaleReason(input.latestQuote)}`);
  }
  if (synthetic) {
    reasons.push("synthetic_source");
  }
  if (input.source !== "kgi") {
    reasons.push("non_live_source");
  }

  return {
    latestQuoteAgeMs: input.latestQuote?.ageMs ?? null,
    freshnessStatus,
    readiness,
    strategyUsable,
    paperUsable,
    liveUsable,
    staleAfterMs: getQuoteStaleMs(input.source),
    reasons
  };
}

function mapCompanyMarket(rawMarket: string): Market {
  const normalized = rawMarket.trim().toUpperCase();
  switch (normalized) {
    case "TWSE":
      return "TWSE";
    case "TPEX":
      return "TPEX";
    case "TWO":
      return "TWO";
    case "TW_EMERGING":
    case "EMERGING":
    case "TIB":
      return "TW_EMERGING";
    case "TW_INDEX":
    case "INDEX":
      return "TW_INDEX";
    default:
      return "OTHER";
  }
}

function mapExchangeMarket(rawExchange?: string): Market {
  if (!rawExchange) {
    return "OTHER";
  }

  const normalized = rawExchange.trim().toUpperCase();
  switch (normalized) {
    case "TWSE":
    case "TSE":
      return "TWSE";
    case "TPEX":
    case "OTC":
      return "TPEX";
    case "TWO":
      return "TWO";
    case "EMERGING":
    case "TW_EMERGING":
    case "TIB":
      return "TW_EMERGING";
    case "INDEX":
    case "TW_INDEX":
      return "TW_INDEX";
    default:
      return "OTHER";
  }
}

function parseNullableNumber(raw?: string | number | null) {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinTimeRange(timestamp: string, from?: string, to?: string) {
  if (from && timestamp < from) {
    return false;
  }

  if (to && timestamp > to) {
    return false;
  }

  return true;
}

function lotSizeForMarket(market: Market) {
  return market === "TWSE" || market === "TPEX" || market === "TWO" || market === "TW_EMERGING"
    ? 1000
    : 1;
}

function dedupeSymbolMasters(companies: Company[]) {
  const bestByKey = new Map<string, SymbolMaster>();

  for (const company of companies) {
    const market = mapCompanyMarket(company.market);
    const symbol = company.ticker.trim().toUpperCase();
    const key = `${market}:${symbol}`;
    const candidate = symbolMasterSchema.parse({
      symbol,
      market,
      name: company.name,
      nameEn: "",
      lotSize: lotSizeForMarket(market),
      tickSize: 0.01,
      currency: market === "OTHER" ? "USD" : "TWD",
      isActive: true,
      industry: company.chainPosition,
      companyId: company.id
    });

    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, candidate);
      continue;
    }

    if (candidate.name.length > existing.name.length) {
      bestByKey.set(key, candidate);
    }
  }

  return [...bestByKey.values()];
}

function buildCachedProvider(
  source: QuoteSource,
  errorMessage: string
): QuoteProviderAdapter {
  return {
    source,
    async listQuotes(workspaceSlug) {
      await ensurePersistedQuoteHistoryLoaded(workspaceSlug);
      return listCachedProviderQuotes(workspaceSlug, source);
    },
    async getStatus(workspaceSlug) {
      await ensurePersistedQuoteHistoryLoaded(workspaceSlug);
      const quotes = await listCachedProviderQuotes(workspaceSlug, source);
      const freshQuotes = quotes.filter((quote) => !quote.isStale);
      const lastMessageAt = quotes[0]?.timestamp ?? null;
      const connected = source === "manual" ? true : freshQuotes.length > 0;
      const readiness = buildProviderReadiness({
        source,
        connected,
        latestQuote: quotes[0] ?? null
      });

      return quoteProviderStatusSchema.parse({
        source,
        connected,
        lastMessageAt,
        latencyMs: null,
        latestQuoteAgeMs: readiness.latestQuoteAgeMs,
        freshnessStatus: readiness.freshnessStatus,
        readiness: readiness.readiness,
        strategyUsable: readiness.strategyUsable,
        paperUsable: readiness.paperUsable,
        liveUsable: readiness.liveUsable,
        staleAfterMs: readiness.staleAfterMs,
        subscribedSymbols: [...new Set(quotes.map((quote) => quote.symbol))],
        reasons: readiness.reasons,
        errorMessage: connected || source === "manual" ? null : errorMessage
      });
    }
  };
}

const quoteProviders: Record<QuoteSource, QuoteProviderAdapter> = {
  manual: buildCachedProvider("manual", "Manual quote provider not configured."),
  paper: buildCachedProvider("paper", "Paper quote provider not configured."),
  tradingview: buildCachedProvider("tradingview", "TradingView quote provider not configured."),
  kgi: buildCachedProvider("kgi", "KGI quote provider not configured.")
};

function parseSourceFilter(raw?: string) {
  if (!raw?.trim()) {
    return [...quoteProviderSources];
  }

  const allowed = new Set<QuoteSource>(quoteProviderSources);
  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is QuoteSource => allowed.has(value as QuoteSource));

  return parsed.length > 0 ? parsed : [...quoteProviderSources];
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

export async function listMarketDataProviderStatuses(input: {
  session: AppSession;
  sources?: string;
}) {
  const requestedSources = parseSourceFilter(input.sources);
  return Promise.all(
    requestedSources.map((source) =>
      quoteProviders[source].getStatus(input.session.workspace.slug)
    )
  );
}

export function getMarketDataPolicy() {
  const sourcePriorityOrder = getSourcePriorityOrder();
  return {
    generatedAt: new Date().toISOString(),
    surface: getMarketDataSurfaceMetadata(),
    sourcePriority: sourcePriorityOrder.map((source) => ({
      source,
      priority: getSourcePriority(source)
    })),
    freshnessMs: quoteProviderSources.map((source) => ({
      source,
      staleAfterMs: getQuoteStaleMs(source)
    })),
    historyLimit: quoteProviderSources.map((source) => ({
      source,
      limit: getQuoteHistoryLimit(source)
    })),
    syntheticSources: quoteProviderSources.filter(isSyntheticSource)
  };
}

export function getMarketDataSurfaceMetadata(): MarketDataSurfaceMetadata {
  return marketDataSurfaceMetadataSchema.parse({
    version: MARKET_DATA_SURFACE_VERSION,
    capabilities: {
      providers: true,
      policy: true,
      symbols: true,
      quotes: true,
      resolve: true,
      effectiveQuotes: true,
      consumerSummary: true,
      selectionSummary: true,
      decisionSummary: true,
      history: true,
      historyDiagnostics: true,
      historyQualitySummary: true,
      bars: true,
      barDiagnostics: true,
      barQualitySummary: true,
      overview: true,
      overviewQualityRollup: true
    },
    preferredEntryPoints: {
      strategy: "/api/v1/market-data/decision-summary",
      paper: "/api/v1/market-data/decision-summary",
      execution: "/api/v1/market-data/decision-summary",
      ops: "/api/v1/market-data/overview",
      historyQuality: "/api/v1/market-data/history/diagnostics",
      barQuality: "/api/v1/market-data/bars/diagnostics"
    }
  });
}

export async function listMarketSymbols(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  query?: string;
  market?: Market;
  limit?: number;
}) {
  const companies = await input.repo.listCompanies(undefined, {
    workspaceSlug: input.session.workspace.slug
  });
  const masters = dedupeSymbolMasters(companies);
  const queryNeedle = input.query?.trim().toLowerCase();
  const filtered = masters.filter((item) => !input.market || item.market === input.market).filter((item) => {
    if (!queryNeedle) {
      return true;
    }

    return [item.symbol, item.name, item.industry]
      .join(" ")
      .toLowerCase()
      .includes(queryNeedle);
  });

  return filtered
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .slice(0, input.limit ?? 100);
}

async function upsertProviderQuotes(input: {
  session: AppSession;
  sourceOverride?: QuoteSource;
  quotes: z.infer<typeof manualQuoteUpsertItemSchema>[];
}) {
  const workspaceSlug = input.session.workspace.slug;
  await ensurePersistedQuoteHistoryLoaded(workspaceSlug);
  const workspaceCache = getQuoteCacheForWorkspace(workspaceSlug);
  const workspaceHistory = getQuoteHistoryCacheForWorkspace(workspaceSlug);
  const upserted: Quote[] = [];
  const appendedEntries: QuoteCacheEntry[] = [];

  for (const item of input.quotes) {
    const timestamp = toIso(item.timestamp);
    const source = input.sourceOverride ?? item.source;
    const entry: QuoteCacheEntry = {
      symbol: item.symbol.trim().toUpperCase(),
      market: item.market,
      source,
      last: item.last,
      bid: item.bid,
      ask: item.ask,
      open: item.open,
      high: item.high,
      low: item.low,
      prevClose: item.prevClose,
      volume: item.volume,
      changePct: item.changePct,
      timestamp,
      ageMs: 0,
      isStale: false,
      updatedAt: new Date().toISOString()
    };

    if (pushQuoteEntry(workspaceCache, workspaceHistory, entry)) {
      appendedEntries.push(entry);
    }

    upserted.push(withFreshness(entry));
  }

  await appendPersistedQuoteEntries(
    workspaceSlug,
    appendedEntries.map((entry) => ({
      symbol: entry.symbol,
      market: entry.market,
      source: entry.source,
      last: entry.last,
      bid: entry.bid,
      ask: entry.ask,
      open: entry.open,
      high: entry.high,
      low: entry.low,
      prevClose: entry.prevClose,
      volume: entry.volume,
      changePct: entry.changePct,
      timestamp: entry.timestamp,
      updatedAt: entry.updatedAt
    }))
  );

  return upserted;
}

export async function upsertManualQuotes(input: {
  session: AppSession;
  quotes: z.infer<typeof manualQuoteUpsertItemSchema>[];
}) {
  return upsertProviderQuotes(input);
}

export async function upsertPaperQuotes(input: {
  session: AppSession;
  quotes: z.infer<typeof manualQuoteUpsertItemSchema>[];
}) {
  return upsertProviderQuotes({
    ...input,
    sourceOverride: "paper"
  });
}

export async function ingestTradingViewQuote(input: {
  session: AppSession;
  ticker: string;
  exchange?: string;
  price?: string;
  timestamp?: string | null;
}) {
  const symbol = input.ticker.trim().toUpperCase();
  if (!symbol) {
    return null;
  }

  const parsedPrice = parseNullableNumber(input.price);
  return upsertManualQuotes({
    session: input.session,
    quotes: [
      {
        symbol,
        market: mapExchangeMarket(input.exchange),
        source: "tradingview",
        last: parsedPrice,
        bid: null,
        ask: null,
        open: null,
        high: parsedPrice,
        low: parsedPrice,
        prevClose: null,
        volume: null,
        changePct: null,
        timestamp: input.timestamp ?? undefined
      }
    ]
  }).then((quotes) => quotes[0] ?? null);
}

export async function listMarketQuotes(input: {
  session: AppSession;
  symbols?: string;
  market?: Market;
  source?: QuoteSource;
  includeStale?: boolean;
  limit?: number;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const sources = input.source ? [input.source] : [...quoteProviderSources];
  const symbolSet = new Set(
    (input.symbols ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );

  const quotes = (
    await Promise.all(sources.map((source) => quoteProviders[source].listQuotes(workspaceSlug)))
  )
    .flat()
    .filter((quote) => !input.market || quote.market === input.market)
    .filter((quote) => symbolSet.size === 0 || symbolSet.has(quote.symbol))
    .filter((quote) => input.includeStale || !quote.isStale);

  const resolvedQuotes = input.source
    ? quotes.sort(compareQuotes)
    : dedupePreferredQuotes(quotes);

  return resolvedQuotes.slice(0, input.limit ?? 200);
}

export async function listMarketQuoteHistory(input: {
  session: AppSession;
  symbols?: string;
  market?: Market;
  source?: QuoteSource;
  includeStale?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const workspaceSlug = input.session.workspace.slug;
  await ensurePersistedQuoteHistoryLoaded(workspaceSlug);
  const sources = input.source ? [input.source] : [...quoteProviderSources];
  const symbolSet = new Set(
    (input.symbols ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );

  const currentQuotes = (
    await Promise.all(sources.map((source) => quoteProviders[source].listQuotes(workspaceSlug)))
  )
    .flat()
    .filter((quote) => !input.market || quote.market === input.market)
    .filter((quote) => symbolSet.size === 0 || symbolSet.has(quote.symbol));

  const preferredSourceBySymbol = input.source ? null : getPreferredSourceBySymbol(currentQuotes);

  const history = (
    await Promise.all(
      sources.map((source) => Promise.resolve(listCachedProviderQuoteHistory(workspaceSlug, source)))
    )
  )
    .flat()
    .filter((quote) => !input.market || quote.market === input.market)
    .filter((quote) => symbolSet.size === 0 || symbolSet.has(quote.symbol))
    .filter((quote) => input.includeStale || !quote.isStale)
    .filter((quote) => isWithinTimeRange(quote.timestamp, input.from, input.to))
    .filter((quote) => {
      if (input.source || !preferredSourceBySymbol) {
        return true;
      }

      return (
        preferredSourceBySymbol.get(buildQuoteIdentityKey(quote.symbol, quote.market))
        === quote.source
      );
    })
    .sort((left, right) => {
      const timestampDiff = right.timestamp.localeCompare(left.timestamp);
      if (timestampDiff !== 0) {
        return timestampDiff;
      }

      return compareQuotes(left, right);
    })
    .slice(0, input.limit ?? 1000);

  return history;
}

export async function getMarketQuoteHistoryDiagnostics(input: {
  session: AppSession;
  symbols?: string;
  market?: Market;
  source?: QuoteSource;
  includeStale?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const history = await listMarketQuoteHistory({
    ...input,
    includeStale: input.includeStale ?? true
  });
  const symbols = [...new Set(history.map((quote) => quote.symbol))];
  const resolutions = symbols.length > 0
    ? await resolveMarketQuotes({
      session: input.session,
      symbols: symbols.join(","),
      market: input.market,
      includeStale: true,
      limit: input.limit ?? 200
    })
    : [];
  const resolutionByKey = new Map(
    resolutions.map((resolution) => [
      buildQuoteIdentityKey(resolution.symbol, resolution.market),
      resolution
    ])
  );

  const grouped = new Map<string, Quote[]>();
  for (const quote of history) {
    const key = buildQuoteIdentityKey(quote.symbol, quote.market);
    const current = grouped.get(key) ?? [];
    current.push(quote);
    grouped.set(key, current);
  }

  const items = [...grouped.entries()].map(([key, quotes]) => {
    const [market, symbol] = key.split(":");
    const ordered = [...quotes].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const resolution = resolutionByKey.get(key);
    const firstTimestamp = ordered[0]?.timestamp ?? null;
    const lastTimestamp = ordered.at(-1)?.timestamp ?? null;
    const source = input.source ?? resolution?.selectedSource ?? ordered.at(-1)?.source ?? null;
    const timeWindowCompleteness = getTimeWindowCompleteness({
      count: ordered.length,
      firstTimestamp,
      lastTimestamp,
      from: input.from,
      to: input.to
    });
    const synthetic = source ? isSyntheticSource(source) : false;
    const quality = buildHistoryQualityAssessment({
      pointCount: ordered.length,
      freshnessStatus: resolution?.freshnessStatus ?? "missing",
      timeWindowCompleteness,
      synthetic
    });

    return {
      symbol,
      market,
      source,
      selectedSource: resolution?.selectedSource ?? null,
      fallbackReason: resolution?.fallbackReason ?? "none",
      freshnessStatus: resolution?.freshnessStatus ?? "missing",
      staleReason: resolution?.staleReason ?? "no_quote",
      pointCount: ordered.length,
      firstTimestamp,
      lastTimestamp,
      lastPointAgeMs: getTimestampAgeMs(lastTimestamp),
      timeWindowCompleteness,
      synthetic,
      generatedFrom: "provider_quote_history",
      quality
    };
  });

  return marketDataHistoryDiagnosticsResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    summary: summarizeQualityAssessments(items, historyQualityReasonBuckets),
    items
  });
}

export async function resolveMarketQuotes(input: {
  session: AppSession;
  symbols: string;
  market?: Market;
  includeStale?: boolean;
  limit?: number;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const includeStale = input.includeStale ?? false;
  const symbolSet = new Set(
    input.symbols
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );

  const [quotesBySource, providerStatuses] = await Promise.all([
    Promise.all(
      quoteProviderSources.map((source) => quoteProviders[source].listQuotes(workspaceSlug))
    ),
    Promise.all(
      quoteProviderSources.map((source) => quoteProviders[source].getStatus(workspaceSlug))
    )
  ]);

  const statusBySource = new Map<QuoteSource, QuoteProviderStatus>(
    providerStatuses.map((status) => [status.source, status])
  );

  const allQuotes = quotesBySource
    .flat()
    .filter((quote) => !input.market || quote.market === input.market)
    .filter((quote) => symbolSet.size === 0 || symbolSet.has(quote.symbol));

  const grouped = new Map<string, Quote[]>();
  for (const quote of allQuotes) {
    const key = buildQuoteIdentityKey(quote.symbol, quote.market);
    const current = grouped.get(key) ?? [];
    current.push(quote);
    grouped.set(key, current);
  }

  return [...grouped.entries()]
    .map(([key, quotes]) => {
      const [market, symbol] = key.split(":");
      const bestQuoteBySource = new Map<QuoteSource, Quote>();
      for (const quote of [...quotes].sort(compareQuotes)) {
        if (!bestQuoteBySource.has(quote.source)) {
          bestQuoteBySource.set(quote.source, quote);
        }
      }

      const candidates = quoteProviderSources
        .slice()
        .sort((left, right) => getSourcePriority(right) - getSourcePriority(left))
        .map((source) => {
          const quote = bestQuoteBySource.get(source) ?? null;
          const providerStatus = statusBySource.get(source);
          const freshnessStatus = getQuoteFreshnessStatus(quote);
          const staleReason = getQuoteStaleReason(quote);
          const providerConnected = providerStatus?.connected ?? false;
          const subscribed = quote
            ? true
            : (providerStatus?.subscribedSymbols ?? []).includes(symbol);
          const eligible = quote !== null && (includeStale || freshnessStatus === "fresh");

          return quoteResolutionCandidateSchema.parse({
            source,
            priority: getSourcePriority(source),
            providerConnected,
            subscribed,
            eligible,
            freshnessStatus,
            staleReason,
            quote
          });
        });

      const selected = candidates.find((candidate) => candidate.eligible) ?? null;
      const selectedQuote = selected?.quote ?? null;
      const freshnessStatus = selected?.freshnessStatus ?? "missing";
      const staleReason: QuoteResolutionStaleReason = selected?.staleReason
        ?? (candidates.some((candidate) => candidate.quote !== null)
          ? "age_exceeded"
          : "no_quote");

      let fallbackReason: QuoteResolutionFallbackReason = "none";
      if (!selected) {
        fallbackReason = candidates.some((candidate) => candidate.quote !== null)
          ? "no_fresh_quote"
          : "no_quote";
      } else if (selected.source !== quoteProviderSources.at(-1)) {
        const higherPriorityCandidates = candidates.filter(
          (candidate) => getSourcePriority(candidate.source) > getSourcePriority(selected.source)
        );
        if (higherPriorityCandidates.some((candidate) => candidate.quote && candidate.freshnessStatus === "stale")) {
          fallbackReason = "higher_priority_stale";
        } else if (higherPriorityCandidates.some((candidate) => candidate.providerConnected || candidate.subscribed)) {
          fallbackReason = "higher_priority_missing";
        } else if (higherPriorityCandidates.length > 0) {
          fallbackReason = "higher_priority_unavailable";
        }
      }

      return quoteResolutionSchema.parse({
        symbol,
        market,
        selectedSource: selected?.source ?? null,
        selectedQuote,
        preferredSource: selected?.source ?? null,
        preferredQuote: selectedQuote,
        freshnessStatus,
        fallbackReason,
        staleReason,
        candidates
      });
    })
    .sort((left, right) => {
      const leftTimestamp = left.selectedQuote?.timestamp ?? "";
      const rightTimestamp = right.selectedQuote?.timestamp ?? "";
      return rightTimestamp.localeCompare(leftTimestamp) || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, input.limit ?? 100);
}

export async function getEffectiveMarketQuotes(input: {
  session: AppSession;
  symbols: string;
  market?: Market;
  includeStale?: boolean;
  limit?: number;
}) {
  const resolutions = await resolveMarketQuotes(input);
  const items = resolutions.map((resolution) => {
    const selectedSource = resolution.selectedSource;
    const synthetic = selectedSource ? isSyntheticSource(selectedSource) : false;
    const selectedCandidate = selectedSource
      ? resolution.candidates.find((candidate) => candidate.source === selectedSource) ?? null
      : null;
    const providerConnected = selectedCandidate?.providerConnected ?? false;
    const staleAfterMs = selectedSource ? getQuoteStaleMs(selectedSource) : null;
    const sourcePriority = selectedSource ? getSourcePriority(selectedSource) : null;
    const liveUsable = resolution.freshnessStatus === "fresh" && selectedSource === "kgi";
    const paperUsable = resolution.freshnessStatus === "fresh";
    const strategyUsable = resolution.freshnessStatus === "fresh";
    const nonLiveSource = selectedSource !== null && selectedSource !== "kgi";
    const readiness: EffectiveQuoteReadiness =
      resolution.freshnessStatus !== "fresh"
        ? "blocked"
        : synthetic
          || nonLiveSource
          || resolution.fallbackReason === "higher_priority_stale"
          || resolution.fallbackReason === "higher_priority_missing"
          || resolution.fallbackReason === "no_fresh_quote"
          ? "degraded"
          : "ready";

    return effectiveMarketQuoteSchema.parse({
      symbol: resolution.symbol,
      market: resolution.market,
      selectedSource,
      selectedQuote: resolution.selectedQuote,
      freshnessStatus: resolution.freshnessStatus,
      fallbackReason: resolution.fallbackReason,
      staleReason: resolution.staleReason,
      readiness,
      strategyUsable,
      paperUsable,
      liveUsable,
      synthetic,
      providerConnected,
      staleAfterMs,
      sourcePriority,
      reasons: buildEffectiveQuoteReasons({
        selectedSource,
        fallbackReason: resolution.fallbackReason,
        staleReason: resolution.staleReason,
        synthetic,
        providerConnected
      }),
      candidates: resolution.candidates
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    policy: getMarketDataPolicy(),
    summary: {
      total: items.length,
      ready: items.filter((item) => item.readiness === "ready").length,
      degraded: items.filter((item) => item.readiness === "degraded").length,
      blocked: items.filter((item) => item.readiness === "blocked").length,
      strategyUsable: items.filter((item) => item.strategyUsable).length,
      paperUsable: items.filter((item) => item.paperUsable).length,
      liveUsable: items.filter((item) => item.liveUsable).length,
      bySource: quoteProviderSources.map((source) => ({
        source,
        total: items.filter((item) => item.selectedSource === source).length
      })),
      fallbackReasons: [
        "higher_priority_stale",
        "higher_priority_missing",
        "higher_priority_unavailable",
        "no_fresh_quote",
        "no_quote"
      ].map((reason) => ({
        reason,
        total: items.filter((item) => item.fallbackReason === reason).length
      })),
      staleReasons: [
        "age_exceeded",
        "missing_last",
        "no_quote",
        "provider_unavailable"
      ].map((reason) => ({
        reason,
        total: items.filter((item) => item.staleReason === reason).length
      }))
    },
    items
  };
}

export async function getMarketDataConsumerSummary(input: {
  session: AppSession;
  mode: MarketDataConsumerMode;
  symbols: string;
  market?: Market;
  includeStale?: boolean;
  limit?: number;
}) {
  const effective = await getEffectiveMarketQuotes({
    session: input.session,
    symbols: input.symbols,
    market: input.market,
    includeStale: input.includeStale,
    limit: input.limit
  });

  const items = effective.items.map((item) => {
    const usable =
      input.mode === "strategy"
        ? item.strategyUsable
        : input.mode === "paper"
          ? item.paperUsable
          : item.liveUsable;
    const safe = usable && item.readiness === "ready";
    const decision = buildConsumerDecision({
      mode: input.mode,
      selectedSource: item.selectedSource,
      providerConnected: item.providerConnected,
      freshnessStatus: item.freshnessStatus,
      strategyUsable: item.strategyUsable,
      paperUsable: item.paperUsable,
      liveUsable: item.liveUsable,
      readiness: item.readiness
    });

    return {
      symbol: item.symbol,
      market: item.market,
      mode: input.mode,
      selectedSource: item.selectedSource,
      selectedQuote: item.selectedQuote,
      readiness: item.readiness,
      decision,
      usable,
      safe,
      freshnessStatus: item.freshnessStatus,
      fallbackReason: item.fallbackReason,
      staleReason: item.staleReason,
      reasons: item.reasons,
      candidates: item.candidates
    };
  });

  return marketDataConsumerSummarySchema.parse({
    generatedAt: effective.generatedAt,
    mode: input.mode,
    summary: {
      total: items.length,
      allow: items.filter((item) => item.decision === "allow").length,
      review: items.filter((item) => item.decision === "review").length,
      block: items.filter((item) => item.decision === "block").length,
      usable: items.filter((item) => item.usable).length,
      safe: items.filter((item) => item.safe).length,
      selectedSources: quoteProviderSources.map((source) => ({
        source,
        total: items.filter((item) => item.selectedSource === source).length
      })),
      fallbackReasons: [
        "higher_priority_stale",
        "higher_priority_missing",
        "higher_priority_unavailable",
        "no_fresh_quote",
        "no_quote"
      ].map((reason) => ({
        reason,
        total: items.filter((item) => item.fallbackReason === reason).length
      })),
      staleReasons: [
        "age_exceeded",
        "missing_last",
        "no_quote",
        "provider_unavailable"
      ].map((reason) => ({
        reason,
        total: items.filter((item) => item.staleReason === reason).length
      })),
      reasons: summarizeReasonCounts(
        [
          "fallback:higher_priority_stale",
          "fallback:higher_priority_missing",
          "fallback:higher_priority_unavailable",
          "fallback:no_fresh_quote",
          "fallback:no_quote",
          "stale:age_exceeded",
          "stale:missing_last",
          "stale:no_quote",
          "stale:provider_unavailable",
          "synthetic_source",
          "non_live_source",
          "provider_disconnected",
          "missing_quote"
        ],
        items
      )
    },
    items
  });
}

function summarizeMode(items: Array<{ decision: "allow" | "review" | "block"; usable: boolean; safe: boolean }>) {
  return {
    allow: items.filter((item) => item.decision === "allow").length,
    review: items.filter((item) => item.decision === "review").length,
    block: items.filter((item) => item.decision === "block").length,
    usable: items.filter((item) => item.usable).length,
    safe: items.filter((item) => item.safe).length
  };
}

function getPrimaryReason(input: {
  decision: "allow" | "review" | "block";
  readiness: EffectiveQuoteReadiness;
  fallbackReason: QuoteResolutionFallbackReason;
  staleReason: QuoteResolutionStaleReason;
  reasons: string[];
}) {
  if (input.decision === "allow") {
    return "ready";
  }

  if (input.staleReason !== "none") {
    return `stale:${input.staleReason}`;
  }

  if (input.fallbackReason !== "none") {
    return `fallback:${input.fallbackReason}`;
  }

  if (input.readiness === "degraded") {
    return "readiness:degraded";
  }

  return input.reasons[0] ?? (input.decision === "review" ? "review_required" : "blocked");
}

export async function getMarketDataSelectionSummary(input: {
  session: AppSession;
  symbols: string;
  market?: Market;
  includeStale?: boolean;
  limit?: number;
}) {
  const effective = await getEffectiveMarketQuotes({
    session: input.session,
    symbols: input.symbols,
    market: input.market,
    includeStale: input.includeStale,
    limit: input.limit
  });

  const strategySummary = await getMarketDataConsumerSummary({
    session: input.session,
    mode: "strategy",
    symbols: input.symbols,
    market: input.market,
    includeStale: input.includeStale,
    limit: input.limit
  });
  const paperSummary = await getMarketDataConsumerSummary({
    session: input.session,
    mode: "paper",
    symbols: input.symbols,
    market: input.market,
    includeStale: input.includeStale,
    limit: input.limit
  });
  const executionSummary = await getMarketDataConsumerSummary({
    session: input.session,
    mode: "execution",
    symbols: input.symbols,
    market: input.market,
    includeStale: input.includeStale,
    limit: input.limit
  });

  const strategyBySymbol = new Map(strategySummary.items.map((item) => [buildQuoteIdentityKey(item.symbol, item.market), item]));
  const paperBySymbol = new Map(paperSummary.items.map((item) => [buildQuoteIdentityKey(item.symbol, item.market), item]));
  const executionBySymbol = new Map(executionSummary.items.map((item) => [buildQuoteIdentityKey(item.symbol, item.market), item]));

  const items = effective.items.map((item) => {
    const identityKey = buildQuoteIdentityKey(item.symbol, item.market);
    const strategy = strategyBySymbol.get(identityKey);
    const paper = paperBySymbol.get(identityKey);
    const execution = executionBySymbol.get(identityKey);

    return {
      symbol: item.symbol,
      market: item.market,
      selectedSource: item.selectedSource,
      selectedQuote: item.selectedQuote,
      readiness: item.readiness,
      freshnessStatus: item.freshnessStatus,
      fallbackReason: item.fallbackReason,
      staleReason: item.staleReason,
      reasons: item.reasons,
      strategy: {
        decision: strategy?.decision ?? "block",
        usable: strategy?.usable ?? false,
        safe: strategy?.safe ?? false
      },
      paper: {
        decision: paper?.decision ?? "block",
        usable: paper?.usable ?? false,
        safe: paper?.safe ?? false
      },
      execution: {
        decision: execution?.decision ?? "block",
        usable: execution?.usable ?? false,
        safe: execution?.safe ?? false
      }
    };
  });

  return marketDataSelectionSummarySchema.parse({
    generatedAt: effective.generatedAt,
    summary: {
      total: items.length,
      selectedSources: quoteProviderSources.map((source) => ({
        source,
        total: items.filter((item) => item.selectedSource === source).length
      })),
      readiness: {
        ready: items.filter((item) => item.readiness === "ready").length,
        degraded: items.filter((item) => item.readiness === "degraded").length,
        blocked: items.filter((item) => item.readiness === "blocked").length
      },
      strategy: summarizeMode(items.map((item) => item.strategy)),
      paper: summarizeMode(items.map((item) => item.paper)),
      execution: summarizeMode(items.map((item) => item.execution)),
      fallbackReasons: [
        "higher_priority_stale",
        "higher_priority_missing",
        "higher_priority_unavailable",
        "no_fresh_quote",
        "no_quote"
      ].map((reason) => ({
        reason,
        total: items.filter((item) => item.fallbackReason === reason).length
      })),
      staleReasons: [
        "age_exceeded",
        "missing_last",
        "no_quote",
        "provider_unavailable"
      ].map((reason) => ({
        reason,
        total: items.filter((item) => item.staleReason === reason).length
      }))
    },
    items
  });
}

export async function getMarketDataDecisionSummary(input: {
  session: AppSession;
  symbols: string;
  market?: Market;
  includeStale?: boolean;
  limit?: number;
}) {
  const selection = await getMarketDataSelectionSummary(input);
  const items = selection.items.map((item) => {
    const strategy = {
      ...item.strategy,
      primaryReason: getPrimaryReason({
        decision: item.strategy.decision,
        readiness: item.readiness,
        fallbackReason: item.fallbackReason as QuoteResolutionFallbackReason,
        staleReason: item.staleReason as QuoteResolutionStaleReason,
        reasons: item.reasons
      })
    };
    const paper = {
      ...item.paper,
      primaryReason: getPrimaryReason({
        decision: item.paper.decision,
        readiness: item.readiness,
        fallbackReason: item.fallbackReason as QuoteResolutionFallbackReason,
        staleReason: item.staleReason as QuoteResolutionStaleReason,
        reasons: item.reasons
      })
    };
    const execution = {
      ...item.execution,
      primaryReason: getPrimaryReason({
        decision: item.execution.decision,
        readiness: item.readiness,
        fallbackReason: item.fallbackReason as QuoteResolutionFallbackReason,
        staleReason: item.staleReason as QuoteResolutionStaleReason,
        reasons: item.reasons
      })
    };

    return {
      symbol: item.symbol,
      market: item.market,
      selectedSource: item.selectedSource,
      quote: item.selectedQuote
        ? {
            source: item.selectedQuote.source,
            last: item.selectedQuote.last,
            bid: item.selectedQuote.bid,
            ask: item.selectedQuote.ask,
            timestamp: item.selectedQuote.timestamp,
            ageMs: item.selectedQuote.ageMs,
            isStale: item.selectedQuote.isStale
          }
        : null,
      readiness: item.readiness,
      freshnessStatus: item.freshnessStatus,
      fallbackReason: item.fallbackReason,
      staleReason: item.staleReason,
      primaryReason: getPrimaryReason({
        decision:
          execution.decision === "block"
            ? paper.decision === "block"
              ? strategy.decision
              : paper.decision
            : execution.decision,
        readiness: item.readiness,
        fallbackReason: item.fallbackReason as QuoteResolutionFallbackReason,
        staleReason: item.staleReason as QuoteResolutionStaleReason,
        reasons: item.reasons
      }),
      reasons: item.reasons,
      strategy,
      paper,
      execution
    };
  });

  return marketDataDecisionSummarySchema.parse({
    generatedAt: selection.generatedAt,
    summary: {
      total: items.length,
      selectedSources: selection.summary.selectedSources,
      readiness: selection.summary.readiness,
      strategy: selection.summary.strategy,
      paper: selection.summary.paper,
      execution: selection.summary.execution,
      primaryReasons: summarizeReasonCounts(
        [...new Set(items.map((item) => item.primaryReason).filter(Boolean))],
        items.map((item) => ({ reasons: [item.primaryReason] }))
      ),
      fallbackReasons: selection.summary.fallbackReasons,
      staleReasons: selection.summary.staleReasons
    },
    items
  });
}

function getBarIntervalMs(interval: BarInterval) {
  switch (interval) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "30m":
      return 30 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "1d":
      return 24 * 60 * 60_000;
    case "1w":
      return 7 * 24 * 60 * 60_000;
  }
}

export async function listMarketBars(input: {
  session: AppSession;
  symbols: string;
  market?: Market;
  source?: QuoteSource;
  interval?: BarInterval;
  includeStale?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const interval = input.interval ?? "1m";
  const intervalMs = getBarIntervalMs(interval);
  const history = await listMarketQuoteHistory({
    session: input.session,
    symbols: input.symbols,
    market: input.market,
    source: input.source,
    includeStale: input.includeStale,
    from: input.from,
    to: input.to,
    limit: Math.max((input.limit ?? 100) * 8, 200)
  });
  const groupedQuotes = new Map<string, Quote[]>();

  for (const quote of history) {
    if (quote.last === null) {
      continue;
    }

    const quoteTimestamp = new Date(quote.timestamp).getTime();
    const bucketStart = Math.floor(quoteTimestamp / intervalMs) * intervalMs;
    const barKey = `${quote.source}:${quote.symbol}:${bucketStart}`;
    const current = groupedQuotes.get(barKey) ?? [];
    current.push(quote);
    groupedQuotes.set(barKey, current);
  }

  const bars = [...groupedQuotes.entries()].map(([key, quotes]) => {
    const [source, symbol, bucketStartRaw] = key.split(":");
    const bucketStart = Number(bucketStartRaw);
    const bucketEnd = bucketStart + intervalMs;
    const ordered = [...quotes].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    const prices = ordered.map((quote) => quote.last ?? 0);
    const closeQuote = ordered.at(-1);

    return barSchema.parse({
      symbol,
      interval,
      source,
      openTime: new Date(bucketStart).toISOString(),
      closeTime: new Date(bucketEnd).toISOString(),
      open: prices[0] ?? 0,
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: closeQuote?.last ?? prices[0] ?? 0,
      volume: Math.max(...ordered.map((quote) => quote.volume ?? 0)),
      turnover: 0
    });
  });

  return bars
    .sort((left, right) => right.openTime.localeCompare(left.openTime))
    .slice(0, input.limit ?? 100);
}

export async function getMarketBarDiagnostics(input: {
  session: AppSession;
  symbols: string;
  market?: Market;
  source?: QuoteSource;
  interval?: BarInterval;
  includeStale?: boolean;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const bars = await listMarketBars({
    ...input,
    includeStale: input.includeStale ?? true
  });
  const grouped = new Map<string, z.infer<typeof barSchema>[]>();
  for (const bar of bars) {
    const key = `${bar.source}:${bar.symbol}`;
    const current = grouped.get(key) ?? [];
    current.push(bar);
    grouped.set(key, current);
  }

  const items = [...grouped.entries()].map(([key, entries]) => {
    const [source, symbol] = key.split(":");
    const ordered = [...entries].sort((left, right) => left.openTime.localeCompare(right.openTime));
    const firstOpenTime = ordered[0]?.openTime ?? null;
    const lastCloseTime = ordered.at(-1)?.closeTime ?? null;
    const sourceKey = source as QuoteSource;
    const timeWindowCompleteness = getTimeWindowCompleteness({
      count: ordered.length,
      firstTimestamp: firstOpenTime,
      lastTimestamp: lastCloseTime,
      from: input.from,
      to: input.to
    });
    const lastBarAgeMs = getTimestampAgeMs(lastCloseTime);
    const freshnessStatus: QuoteResolutionFreshnessStatus = !lastCloseTime
      ? "missing"
      : lastBarAgeMs !== null && lastBarAgeMs <= getQuoteStaleMs(sourceKey)
        ? "fresh"
        : "stale";
    const approximate = true;
    const synthetic = true;
    const quality = buildBarQualityAssessment({
      barCount: ordered.length,
      freshnessStatus,
      timeWindowCompleteness,
      synthetic,
      approximate
    });

    return {
      symbol,
      source: sourceKey,
      interval: input.interval ?? "1m",
      barCount: ordered.length,
      firstOpenTime,
      lastCloseTime,
      lastBarAgeMs,
      timeWindowCompleteness,
      synthetic,
      approximate,
      generatedFrom: "quote_history",
      quality
    };
  });

  return marketDataBarDiagnosticsResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    summary: summarizeQualityAssessments(items, barQualityReasonBuckets),
    items
  });
}

export async function getMarketDataOverview(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  sources?: string;
  includeStale?: boolean;
  topLimit?: number;
}) {
  const topLimit = input.topLimit ?? 5;
  const [providers, companies, quotes] = await Promise.all([
    listMarketDataProviderStatuses({
      session: input.session,
      sources: input.sources
    }),
    input.repo.listCompanies(undefined, {
      workspaceSlug: input.session.workspace.slug
    }),
    listMarketQuotes({
      session: input.session,
      includeStale: input.includeStale,
      limit: 1000
    })
  ]);
  const symbols = dedupeSymbolMasters(companies);
  const qualitySymbols = [...new Set(quotes.map((quote) => quote.symbol))].join(",");
  const effectiveSelection = quotes.length > 0
    ? await getEffectiveMarketQuotes({
      session: input.session,
      symbols: qualitySymbols,
      includeStale: true,
      limit: Math.max(quotes.length, 50)
    })
    : {
      generatedAt: new Date().toISOString(),
      policy: getMarketDataPolicy(),
      summary: {
        total: 0,
        ready: 0,
        degraded: 0,
        blocked: 0,
        strategyUsable: 0,
        paperUsable: 0,
        liveUsable: 0,
        bySource: quoteProviderSources.map((source) => ({ source, total: 0 })),
        fallbackReasons: [
          "higher_priority_stale",
          "higher_priority_missing",
          "higher_priority_unavailable",
          "no_fresh_quote",
          "no_quote"
        ].map((reason) => ({ reason, total: 0 })),
        staleReasons: ["age_exceeded", "missing_last", "no_quote", "provider_unavailable"].map((reason) => ({
          reason,
          total: 0
        }))
      },
      items: []
    };
  const [historyQuality, barQuality] = qualitySymbols
    ? await Promise.all([
      getMarketQuoteHistoryDiagnostics({
        session: input.session,
        symbols: qualitySymbols,
        includeStale: true,
        limit: Math.max(quotes.length * 4, 100)
      }),
      getMarketBarDiagnostics({
        session: input.session,
        symbols: qualitySymbols,
        includeStale: true,
        interval: "1m",
        limit: Math.max(quotes.length * 2, 50)
      })
    ])
    : [
      {
        generatedAt: new Date().toISOString(),
        summary: summarizeQualityAssessments([], historyQualityReasonBuckets),
        items: []
      },
      {
        generatedAt: new Date().toISOString(),
        summary: summarizeQualityAssessments([], barQualityReasonBuckets),
        items: []
      }
    ];

  const quotesBySource = [...new Set(quoteProviderSources)]
    .map((source) => ({
      source,
      total: quotes.filter((quote) => quote.source === source).length,
      stale: quotes.filter((quote) => quote.source === source && quote.isStale).length
    }))
    .filter((entry) => entry.total > 0 || providers.some((provider) => provider.source === entry.source));

  const symbolsByMarket = [...new Set(symbols.map((symbol) => symbol.market))]
    .map((market) => ({
      market,
      total: symbols.filter((symbol) => symbol.market === market).length
    }))
    .sort((left, right) => right.total - left.total || left.market.localeCompare(right.market));

  const quotesByMarket = [...new Set(quotes.map((quote) => quote.market))]
    .map((market) => ({
      market,
      total: quotes.filter((quote) => quote.market === market).length,
      stale: quotes.filter((quote) => quote.market === market && quote.isStale).length
    }))
    .sort((left, right) => right.total - left.total || left.market.localeCompare(right.market));

  const quotesWithChange = quotes.filter((quote) => quote.changePct !== null);
  const topGainers = [...quotesWithChange]
    .sort((left, right) => (right.changePct ?? -Infinity) - (left.changePct ?? -Infinity))
    .slice(0, topLimit)
    .map((quote) => ({
      symbol: quote.symbol,
      market: quote.market,
      source: quote.source,
      last: quote.last,
      changePct: round(quote.changePct ?? 0),
      volume: quote.volume,
      timestamp: quote.timestamp
    }));

  const topLosers = [...quotesWithChange]
    .sort((left, right) => (left.changePct ?? Infinity) - (right.changePct ?? Infinity))
    .slice(0, topLimit)
    .map((quote) => ({
      symbol: quote.symbol,
      market: quote.market,
      source: quote.source,
      last: quote.last,
      changePct: round(quote.changePct ?? 0),
      volume: quote.volume,
      timestamp: quote.timestamp
    }));

  const mostActive = [...quotes]
    .filter((quote) => quote.volume !== null)
    .sort((left, right) => (right.volume ?? -Infinity) - (left.volume ?? -Infinity))
    .slice(0, topLimit)
    .map((quote) => ({
      symbol: quote.symbol,
      market: quote.market,
      source: quote.source,
      last: quote.last,
      volume: quote.volume,
      changePct: quote.changePct !== null ? round(quote.changePct) : null,
      timestamp: quote.timestamp
    }));

  const latestQuoteTimestamp = quotes
    .map((quote) => quote.timestamp)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    policy: getMarketDataPolicy(),
    surface: getMarketDataSurfaceMetadata(),
    providers,
    symbols: {
      total: symbols.length,
      byMarket: symbolsByMarket
    },
    quotes: {
      total: quotes.length,
      fresh: quotes.filter((quote) => !quote.isStale).length,
      stale: quotes.filter((quote) => quote.isStale).length,
      latestQuoteTimestamp,
      readiness: {
        connectedSources: providers.filter((provider) => provider.connected).map((provider) => provider.source),
        disconnectedSources: providers.filter((provider) => !provider.connected).map((provider) => provider.source),
        preferredSourceOrder: getSourcePriorityOrder(),
        effectiveSelection: effectiveSelection.summary
      },
      bySource: quotesBySource,
      byMarket: quotesByMarket
    },
    quality: {
      evaluatedSymbols: qualitySymbols ? qualitySymbols.split(",").length : 0,
      history: historyQuality.summary,
      bars: barQuality.summary
    },
    leaders: {
      topGainers,
      topLosers,
      mostActive
    }
  };
}

export function resetMarketDataWorkspaceState(workspaceSlug?: string) {
  if (workspaceSlug) {
    providerQuoteCache.delete(workspaceSlug);
    providerQuoteHistoryCache.delete(workspaceSlug);
    persistedQuoteHistoryLoaded.delete(workspaceSlug);
    return;
  }

  providerQuoteCache.clear();
  providerQuoteHistoryCache.clear();
  persistedQuoteHistoryLoaded.clear();
}
