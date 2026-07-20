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
import { companiesOhlcv, getDb, isDatabaseMode } from "@iuf-trading-room/db";
import type { CompanyLite, TradingRoomRepository } from "@iuf-trading-room/domain";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getFinMindClient, getFinMindStats } from "./data-sources/finmind-client.js";
import { getTaiexDailyCloses } from "./data-sources/twse-openapi-client.js";
import { runOhlcvFinmindSync } from "./jobs/ohlcv-finmind-sync.js";
import { isTwTradingDay } from "./lib/trading-calendar.js";
import {
  appendPersistedQuoteEntries,
  loadPersistedQuoteEntries
} from "./market-data-store.js";
import { getLastCloses, type LastCloseResult } from "./quote-last-close-store.js";

type QuoteCacheEntry = Quote & {
  updatedAt: string;
};

type QuoteProviderAdapter = {
  source: QuoteSource;
  listQuotes: (workspaceSlug: string) => Promise<Quote[]>;
  getStatus: (workspaceSlug: string) => Promise<QuoteProviderStatus>;
};

// "closed_snapshot" (2026-07-19): the official_close DB fallback tier's
// honest freshness label — deliberately NOT "fresh" (it never feeds
// strategyUsable/paperUsable/liveUsable, see
// getEffectiveMarketQuotesWithOfficialCloseFallback) and deliberately NOT
// "stale" either when it is legitimately used off-hours/on a non-trading
// day (a same-day-close snapshot outside trading hours is not "stale
// data", it is the correct value for that moment). Reserved exclusively for
// the official_close augmentation below — resolveMarketQuotes() itself
// never produces this value, so widening this enum does not change any
// existing resolution behavior.
type QuoteResolutionFreshnessStatus = "fresh" | "stale" | "missing" | "closed_snapshot";
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

const quoteResolutionFreshnessStatusSchema = z.enum(["fresh", "stale", "missing", "closed_snapshot"]);
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
  candidates: z.array(quoteResolutionCandidateSchema),
  // 2026-07-19: set only when selectedSource === "official_close" — the
  // quote_last_close DB row's own trade_date, honestly labelled (never
  // relabeled as "today"), so the frontend can render "MM/DD 收盤" the same
  // way it already does elsewhere (e.g. page.tsx's `${formatDate(...)} 收盤`
  // convention) instead of implying a live price.
  closedSnapshotTradeDate: z.string().nullable().default(null)
});

type EffectiveMarketQuote = z.infer<typeof effectiveMarketQuoteSchema>;
type MarketContextState = "LIVE" | "STALE" | "EMPTY" | "BLOCKED";
type EffectiveQuoteRow = {
  item: EffectiveMarketQuote;
  quote: Quote;
};

type IndexOhlcHistoryRow = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  source: string;
};

type DailyBarContextRow = {
  symbol: string;
  market: Market;
  name: string;
  sector: string | null;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  last: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  timestamp: string;
  source: string;
  weight: number;
};

// 5-min in-process cache for listCompaniesLite — avoids 3470-row full SELECT on every page load.
const _companiesLiteCache = new Map<string, { data: CompanyLite[]; expiresAt: number }>();
const COMPANIES_LITE_TTL_MS = 5 * 60 * 1000;

// 10-min in-process cache for daily OHLCV rows — avoids repeated companiesOhlcv DB query on
// every /api/v1/market-data/overview call. OHLCV data is daily-granularity; 10-min TTL is safe.
const _dailyBarRowsCache = new Map<string, { data: DailyBarContextRow[]; expiresAt: number }>();
const DAILY_BAR_ROWS_TTL_MS = 10 * 60 * 1000;

export async function getCompaniesLiteCached(
  repo: TradingRoomRepository,
  workspaceSlug: string
): Promise<CompanyLite[]> {
  const now = Date.now();
  const cached = _companiesLiteCache.get(workspaceSlug);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const data = await repo.listCompaniesLite({ workspaceSlug });
  _companiesLiteCache.set(workspaceSlug, { data, expiresAt: now + COMPANIES_LITE_TTL_MS });
  return data;
}

const MARKET_HEATMAP_LIMIT = 180;
const DAILY_CONTEXT_SELF_HEAL_DEFAULT_LIMIT = 12;
const DAILY_CONTEXT_SELF_HEAL_MAX_LIMIT = 30;
const DAILY_CONTEXT_SELF_HEAL_LOOKBACK_DAYS = 14;
const DAILY_CONTEXT_SELF_HEAL_COOLDOWN_MS = 15 * 60 * 1000;
const DAILY_CONTEXT_PRIORITY_SYMBOLS = [
  "2330",
  "2317",
  "2454",
  "2308",
  "2382",
  "2881",
  "2882",
  "2412",
  "2603",
  "2002",
  "2303",
  "2379",
  "3034",
  "3711",
  "3443",
  "3661",
  "6488",
  "2408",
  "2344",
  "2449",
  "6239",
  "3260",
  "6531",
  "3105",
  "2327",
  "2313",
  "2368",
  "3037",
  "8046",
  "4958",
  "6176",
  "6269",
  "3189",
  "3533",
  "5439",
  "2356",
  "3231",
  "6669",
  "2357",
  "2376",
  "2377",
  "2395",
  "3017",
  "2301",
  "2353",
  "3045",
  "4904",
  "3596",
  "5388",
  "6285",
  "2345",
  "3706",
  "2883",
  "2884",
  "2885",
  "2886",
  "2887",
  "2890",
  "2891",
  "2892",
  "5880",
  "5876",
  "2014",
  "2015",
  "2023",
  "2027",
  "2031",
  "9958",
  "2609",
  "2615",
  "2618",
  "2610",
  "2633",
  "2606",
  "2617"
] as const;
const dailyContextSelfHealCooldown = new Map<string, number>();
const MARKET_HEATMAP_SECTOR_SYMBOLS = {
  "半導體業": [
    "2330", "2454", "2303", "2379", "3034", "3711", "3443", "3661", "6488", "2408", "2344", "2449",
    "6239", "3260", "6531", "3105", "2337", "2409", "3299", "3532", "3653", "3707", "4991", "5347",
    "5483", "6770", "8150"
  ],
  "電子零組件": [
    "2327", "2308", "2313", "2368", "3037", "8046", "4958", "6176", "6269", "3189", "3533", "5439",
    "1560", "1582", "2059", "2317", "2439", "2481", "2492", "3013", "3090", "4915", "5269", "2354"
  ],
  "電腦及週邊設備": [
    "2382", "2356", "3231", "6669", "2357", "2376", "2377", "2395", "3017", "2301", "2353", "2360",
    "2362", "2365", "2385", "2474", "3005", "3042", "3044", "3234", "3481", "3702", "3714", "6182",
    "6147", "3706"
  ],
  "通信網路": [
    "2412", "3045", "4904", "3596", "5388", "6285", "2345", "2314", "2332", "2419", "2450", "2485",
    "3025", "3062", "3380", "3491", "4906", "6152", "6416"
  ],
  "金融保險": [
    "2881", "2882", "2883", "2884", "2885", "2886", "2887", "2890", "2891", "2892", "5880", "5876"
  ],
  "鋼鐵工業": [
    "2002", "2014", "2015", "2023", "2027", "2031", "9958", "2006", "2007", "2008", "2009", "2010",
    "2012", "2013", "2017", "2020", "2022", "2024", "2025", "2028", "2029", "2030", "2032", "2033",
    "2034"
  ],
  "航運業": [
    "2603", "2609", "2615", "2618", "2610", "2633", "2606", "2617", "2607", "2608", "2611", "2612",
    "2613", "2634", "2636", "2637", "2646", "5607", "5608"
  ]
} as const;
const MARKET_HEATMAP_SYMBOL_SECTOR_LABELS = new Map<string, string>(
  Object.entries(MARKET_HEATMAP_SECTOR_SYMBOLS).flatMap(([sector, symbols]) =>
    symbols.map((symbol) => [symbol, sector] as const)
  )
);
const MARKET_HEATMAP_REQUIRED_SYMBOL_RANK = new Map<string, number>(
  [...MARKET_HEATMAP_SYMBOL_SECTOR_LABELS.keys()].map((symbol, index) => [symbol, index])
);

type OverviewLeader = {
  symbol: string;
  market: Market;
  name: string;
  source: string;
  last: number | null;
  changePct: number | null;
  volume: number | null;
  timestamp: string;
  readiness: EffectiveQuoteReadiness;
  freshnessStatus: QuoteResolutionFreshnessStatus;
};

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
const quoteProviderSources: QuoteSource[] = ["manual", "paper", "tradingview", "kgi", "twse_mis"];
const defaultSourcePriorityOrder: QuoteSource[] = ["kgi", "twse_mis", "tradingview", "paper", "manual"];
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
      kgi: 1,
      twse_mis: 1,
      // official_close is deliberately excluded from quoteProviderSources /
      // getSourcePriorityOrder (see quoteProviders below) — 0 here is just
      // the lowest-possible-priority default this map falls back to, used
      // only when getEffectiveMarketQuotesWithOfficialCloseFallback asks for
      // this source's priority to label its synthetic candidate entry.
      official_close: 0
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
          : source === "twse_mis"
            ? "TWSE_MIS_QUOTE_STALE_MS"
            : "KGI_QUOTE_STALE_MS";
  const fallback =
    source === "manual"
      ? 60_000
      : source === "paper"
        ? 15_000
        : source === "twse_mis"
          ? 60_000 // matches the prior effective threshold when this feed was tagged "manual"
          : 5_000;
  const raw = Number(process.env[envKey]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// Bars are aggregated from quote ticks; a derived bar series is "fresh" if the
// most-recent bar's close time is within BARS_STALE_MS of now.  This is
// intentionally much longer than quote freshness so that a 1-minute bar built
// from a burst of ticks does not immediately become stale after the 5 s quote
// window expires.  Default: 10 minutes; override via BARS_STALE_MS env.
function getBarStaleMs() {
  const raw = Number(process.env.BARS_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60_000;
}

// Quote history is a time series of ticks.  The series is "fresh" if the most
// recent tick is within HISTORY_STALE_MS of now.  Like bars, this uses a much
// longer window than the per-provider quote freshness (5 s / 15 s) because
// history accumulates over time and individual ticks do not expire the series.
// Default: 10 minutes; override via HISTORY_STALE_MS env.
function getHistoryStaleMs() {
  const raw = Number(process.env.HISTORY_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60_000;
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

// 2026-07-20 P0 round 4 (real profiling again): keyed per (workspaceSlug,
// source) rather than just workspaceSlug. Live prod logs from round 3 showed
// listCachedProviderQuoteHistory("twse_mis") -- the single most expensive
// scan (~1.6s for ~847K entries even after round 3's Zod-skip fix) -- MISSING
// its memo BOTH times it's read within the same /overview request (once for
// historyQuality, once for barQuality), despite the entry count being
// IDENTICAL both times (847336 == 847336, i.e. twse_mis itself did not
// receive a new tick in that gap). Cause: the generation counter was scoped
// to the whole workspace, so a write landing on ANY of the other 4 sources
// (manual/paper/tradingview/kgi -- all far higher write frequency/lower
// cost, unrelated to twse_mis) between the two calls busted the memo for
// EVERY source, including the one that didn't actually change. Scoping
// generation per (workspaceSlug, source) means a manual-source write no
// longer evicts the twse_mis memo it has nothing to do with.
const workspaceCacheGeneration = new Map<string, number>();
function bumpWorkspaceCacheGeneration(workspaceSlug: string, source: QuoteSource) {
  const key = `${workspaceSlug}:${source}`;
  workspaceCacheGeneration.set(key, (workspaceCacheGeneration.get(key) ?? 0) + 1);
}
function getWorkspaceCacheGeneration(workspaceSlug: string, source: QuoteSource) {
  return workspaceCacheGeneration.get(`${workspaceSlug}:${source}`) ?? 0;
}

function pushQuoteEntry(
  workspaceSlug: string,
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
    bumpWorkspaceCacheGeneration(workspaceSlug, entry.source);
    return true;
  }

  bumpWorkspaceCacheGeneration(workspaceSlug, entry.source);
  return false;
}

async function ensurePersistedQuoteHistoryLoaded(workspaceSlug: string) {
  if (persistedQuoteHistoryLoaded.has(workspaceSlug)) {
    return;
  }

  const _t0 = performance.now();
  const persistedEntries = await loadPersistedQuoteEntries(workspaceSlug);
  const _t1 = performance.now();
  const workspaceCache = getQuoteCacheForWorkspace(workspaceSlug);
  const workspaceHistory = getQuoteHistoryCacheForWorkspace(workspaceSlug);

  for (const persistedEntry of persistedEntries) {
    pushQuoteEntry(workspaceSlug, workspaceCache, workspaceHistory, normalizePersistedEntry(persistedEntry));
  }

  persistedQuoteHistoryLoaded.add(workspaceSlug);
  console.log(
    `[overview-perf] ensurePersistedQuoteHistoryLoaded(${workspaceSlug}) COLD load: `
    + `dbFetch=${Math.round(_t1 - _t0)}ms pushLoop=${Math.round(performance.now() - _t1)}ms entries=${persistedEntries.length}`
  );
}

// 2026-07-20 (overview_latency_20260720 perf regression): getMarketDataOverview
// independently re-derives the full multi-source quote/history snapshot 3x per
// request (once via getEffectiveMarketQuotes, again inside
// getMarketQuoteHistoryDiagnostics, again inside getMarketBarDiagnostics — each
// re-running resolveMarketQuotes/listMarketQuoteHistory from scratch). Both
// functions below do an UNFILTERED full-cache scan + per-entry Zod validation
// (withFreshness -> quoteSchema.parse) + sort — cost scales with total cached
// entries across the whole symbol universe, not with what the caller actually
// requested (measured live: identical latency requesting 50 vs 500 symbols).
// listCachedProviderQuoteHistory in particular can hold up to
// getQuoteHistoryLimit() (default 512) entries per (source, symbol) key across
// the full ~2000-symbol universe, making its Zod-parse+sort pass the dominant
// cost (~4s measured on prod for each of the two callers above).
//
// Memo below is gated on BOTH the write generation counter AND a short TTL:
// - generation alone would let a memo entry outlive its underlying data
//   going genuinely stale over time with no new writes (the exact "computed
//   freshness silently wrong" failure shape #1321 fixed elsewhere today —
//   must not reintroduce it here).
// - TTL alone served a stale read across a write that had just landed
//   (caught live: broke a resolveMarketQuotes source-precedence test that
//   exercises two cache states back-to-back within the same TTL window).
// Together: a memo entry is only reused when NOTHING has been written to
// this workspace since it was computed AND it is under 1s old — 1s is well
// under every source's stale-floor (getQuoteStaleMs() min 5s / getBarStaleMs()
// 10min / getHistoryStaleMs() 10min), so the bounded staleness window this
// adds to ageMs/isStale computation is a no-op in practice.
const CACHED_PROVIDER_MEMO_TTL_MS = 1000;
const cachedProviderQuotesMemo = new Map<string, { generation: number; expiresAt: number; result: Quote[] }>();
const cachedProviderQuoteHistoryMemo = new Map<string, { generation: number; expiresAt: number; result: Quote[] }>();

function listCachedProviderQuotes(workspaceSlug: string, source: QuoteSource) {
  const memoKey = `${workspaceSlug}:${source}`;
  const now = Date.now();
  const generation = getWorkspaceCacheGeneration(workspaceSlug, source);
  const cached = cachedProviderQuotesMemo.get(memoKey);
  if (cached && cached.generation === generation && cached.expiresAt > now) {
    console.log(`[overview-perf] listCachedProviderQuotes(${source}) MEMO_HIT size=${cached.result.length}`);
    return cached.result;
  }

  const _t0 = performance.now();
  const cache = getQuoteCacheForWorkspace(workspaceSlug);
  const result = [...cache.values()]
    .filter((entry) => entry.source === source)
    .map(withFreshness)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  console.log(
    `[overview-perf] listCachedProviderQuotes(${source}) MEMO_MISS rawCacheSize=${cache.size} `
    + `resultSize=${result.length} scanMs=${Math.round(performance.now() - _t0)}`
  );
  cachedProviderQuotesMemo.set(memoKey, { generation, expiresAt: now + CACHED_PROVIDER_MEMO_TTL_MS, result });
  return result;
}

function listCachedProviderQuoteHistory(workspaceSlug: string, source: QuoteSource) {
  const memoKey = `${workspaceSlug}:${source}`;
  const now = Date.now();
  const generation = getWorkspaceCacheGeneration(workspaceSlug, source);
  const cached = cachedProviderQuoteHistoryMemo.get(memoKey);
  if (cached && cached.generation === generation && cached.expiresAt > now) {
    console.log(`[overview-perf] listCachedProviderQuoteHistory(${source}) MEMO_HIT size=${cached.result.length}`);
    return cached.result;
  }

  const _t0 = performance.now();
  const historyCache = getQuoteHistoryCacheForWorkspace(workspaceSlug);
  const rawEntryCount = [...historyCache.entries()].filter(([key]) => key.startsWith(`${source}:`))
    .reduce((sum, [, entries]) => sum + entries.length, 0);
  const result = [...historyCache.entries()]
    .filter(([key]) => key.startsWith(`${source}:`))
    .flatMap(([, entries]) => entries.map(withFreshness))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  console.log(
    `[overview-perf] listCachedProviderQuoteHistory(${source}) MEMO_MISS keysForSource=`
    + `${[...historyCache.entries()].filter(([key]) => key.startsWith(`${source}:`)).length} `
    + `rawEntryCount=${rawEntryCount} resultSize=${result.length} scanMs=${Math.round(performance.now() - _t0)}`
  );
  cachedProviderQuoteHistoryMemo.set(memoKey, { generation, expiresAt: now + CACHED_PROVIDER_MEMO_TTL_MS, result });
  return result;
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

// 2026-07-20 P0 round 2 (real profiling, not theory this time -- see
// reports/overview_latency_20260720/): live Railway logs from prod showed
// listCachedProviderQuoteHistory("twse_mis") alone scanning ~932K cached
// history entries (1826 symbols x up to ~512 ticks each) and taking ~4.5-5s
// EACH of the (at least) two times it's called per /overview request --
// this dwarfs everything else and is the actual ~10s. quoteSchema.parse()
// inside the withFreshness() map over every one of those entries is the
// per-item cost (a full Zod schema walk x ~1M calls). Round 1's memo didn't
// help because it doesn't reduce the cost of a MISS, and on a live server
// with continuous MIS-sweep writes the write-generation gate busts the memo
// before concurrent historyQuality/barQuality calls can share one computation.
//
// `entry` is a QuoteCacheEntry this module already constructed itself --
// either from pushQuoteEntry (built from an upsert-schema-validated input)
// or normalizePersistedEntry (a DB row read back through our own writer) --
// it already satisfies quoteSchema's shape by construction. Every caller
// that ships a Quote back out over the wire re-validates the ASSEMBLED
// response at its own schema boundary anyway (effectiveMarketQuoteSchema,
// marketDataBarDiagnosticsResponseSchema, etc.), so re-validating every
// individual cached entry here on every read is pure redundant cost with no
// additional safety -- the plain construction below is the exact same
// output shape (explicit field list, not a raw `...entry` spread, so
// QuoteCacheEntry's extra `updatedAt` field is NOT leaked into the `Quote`
// shape -- quoteSchema.parse silently stripped it before; this preserves
// that).
function withFreshness(entry: QuoteCacheEntry): Quote {
  const ageMs = Math.max(0, Date.now() - new Date(entry.timestamp).getTime());
  const isStale = ageMs > getQuoteStaleMs(entry.source);

  return {
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
    ageMs,
    isStale
  };
}

function getQuoteHistoryLimit(source: QuoteSource) {
  const envKey =
    source === "manual"
      ? "MANUAL_QUOTE_HISTORY_LIMIT"
      : source === "paper"
        ? "PAPER_QUOTE_HISTORY_LIMIT"
        : source === "tradingview"
          ? "TRADINGVIEW_QUOTE_HISTORY_LIMIT"
          : source === "twse_mis"
            ? "TWSE_MIS_QUOTE_HISTORY_LIMIT"
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

// 2026-07-13 paper-channel quoteGate P1 fix: paper submits have no path to
// pass the `quote_review` guard override (see paper-risk-bridge.ts), so any
// non-"kgi" source permanently sat at decision="review" (blocked in
// practice) once the KGI feed went down. A `twse_mis`-sourced quote is a
// genuine official government real-time feed (not synthetic — just not on
// KGI infra), so it is safe to treat as paper-mode-trustworthy without an
// override. Deliberately scoped to mode==="paper" only: strategy mode keeps
// its existing readiness gate, and execution (real-money) mode is a fully
// separate branch above that never referenced this helper.
function isPaperTrustedNonKgiSource(mode: MarketDataConsumerMode, selectedSource: QuoteSource | null) {
  return mode === "paper" && selectedSource === "twse_mis";
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
  const safe = usable && (input.readiness === "ready" || isPaperTrustedNonKgiSource(input.mode, input.selectedSource));
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
      : synthetic || input.source === "tradingview" || input.source === "twse_mis"
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

function dedupeSymbolMasters(companies: CompanyLite[]) {
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

function buildSymbolNameLookup(companies: CompanyLite[]) {
  const bySymbol = new Map<string, string>();
  const byMarketSymbol = new Map<string, string>();

  for (const company of companies) {
    const symbol = company.ticker.trim().toUpperCase();
    if (!symbol) continue;
    const market = mapCompanyMarket(company.market);
    bySymbol.set(symbol, company.name);
    byMarketSymbol.set(`${market}:${symbol}`, company.name);
  }

  return (symbol: string, market?: Market) => {
    const normalized = symbol.trim().toUpperCase();
    const marketKey = market ? `${market}:${normalized}` : "";
    return (
      (marketKey ? byMarketSymbol.get(marketKey) : null)
      ?? bySymbol.get(normalized)
      ?? indexNameForSymbol(normalized)
      ?? normalized
    );
  };
}

function indexNameForSymbol(symbol: string) {
  const normalized = symbol.replace(/^\^/, "").toUpperCase();
  if (["TWII", "TAIEX", "Y9999"].includes(normalized)) return "加權指數";
  if (["TPEX", "OTC", "TWO"].includes(normalized)) return "櫃買指數";
  return null;
}

function isMarketIndexSymbol(symbol: string, market: Market, name: string) {
  const normalized = symbol.trim().replace(/^\^/, "").toUpperCase();
  return (
    market === "TW_INDEX"
    || ["TWII", "TAIEX", "Y9999", "TPEX", "OTC", "TWO"].includes(normalized)
    || name.includes("加權指數")
    || name.includes("櫃買指數")
  );
}

function quoteChangeValue(quote: Quote) {
  if (quote.last === null) return null;
  if (quote.prevClose !== null && quote.prevClose !== 0) {
    return round(quote.last - quote.prevClose);
  }
  if (quote.changePct !== null && quote.changePct !== -100) {
    return round(quote.last - (quote.last / (1 + quote.changePct / 100)));
  }
  return null;
}

export function resolveMarketDataChangePct(input: {
  last: number | null;
  prevClose: number | null;
  changePct: number | null;
}) {
  if (input.last !== null && input.prevClose !== null && input.prevClose > 0) {
    return round(((input.last - input.prevClose) / input.prevClose) * 100);
  }
  if (input.changePct !== null && input.changePct !== -100) {
    return round(input.changePct);
  }
  return null;
}

function quoteChangePctValue(quote: Quote) {
  return resolveMarketDataChangePct(quote);
}

function dailyRowChangeValue(row: DailyBarContextRow) {
  if (row.prevClose !== null && row.prevClose > 0) {
    return round(row.last - row.prevClose);
  }
  return row.change;
}

function dailyRowChangePctValue(row: DailyBarContextRow) {
  return resolveMarketDataChangePct(row);
}

function stateFromEffectiveQuote(item: EffectiveMarketQuote): MarketContextState {
  if (!item.selectedQuote) return "EMPTY";
  if (item.freshnessStatus === "fresh") return "LIVE";
  if (item.freshnessStatus === "stale") return "STALE";
  return "BLOCKED";
}

function effectiveRows(items: EffectiveMarketQuote[]) {
  return items
    .filter((item): item is EffectiveMarketQuote & { selectedQuote: Quote } => item.selectedQuote !== null)
    .map((item) => ({ item, quote: item.selectedQuote }));
}

function toOverviewLeader(row: EffectiveQuoteRow, resolveName: (symbol: string, market?: Market) => string) {
  return {
    symbol: row.quote.symbol,
    market: row.quote.market,
    name: resolveName(row.quote.symbol, row.quote.market),
    source: row.item.selectedSource ?? row.quote.source,
    last: row.quote.last,
    changePct: quoteChangePctValue(row.quote),
    volume: row.quote.volume,
    timestamp: row.quote.timestamp,
    readiness: row.item.readiness,
    freshnessStatus: row.item.freshnessStatus
  };
}

function buildMarketContext(input: {
  effectiveItems: EffectiveMarketQuote[];
  companies: CompanyLite[];
}) {
  const resolveName = buildSymbolNameLookup(input.companies);
  const rows = effectiveRows(input.effectiveItems);
  const rowWithNames = rows.map((row) => ({
    ...row,
    name: resolveName(row.quote.symbol, row.quote.market)
  }));
  const indexRow = rowWithNames.find((row) => isMarketIndexSymbol(row.quote.symbol, row.quote.market, row.name)) ?? null;
  const stockRows = rowWithNames.filter((row) => !isMarketIndexSymbol(row.quote.symbol, row.quote.market, row.name));
  const breadthRows = stockRows.filter((row) => quoteChangePctValue(row.quote) !== null);
  const up = breadthRows.filter((row) => (quoteChangePctValue(row.quote) ?? 0) > 0).length;
  const down = breadthRows.filter((row) => (quoteChangePctValue(row.quote) ?? 0) < 0).length;
  const flat = breadthRows.length - up - down;
  const freshestBreadthTimestamp = breadthRows
    .map((row) => row.quote.timestamp)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const liveBreadthCount = breadthRows.filter((row) => row.item.freshnessStatus === "fresh").length;
  const heatmap = [...stockRows]
    .filter((row) => row.quote.last !== null || row.quote.changePct !== null || row.quote.volume !== null)
    .sort((left, right) => {
      const volumeDelta = (right.quote.volume ?? -Infinity) - (left.quote.volume ?? -Infinity);
      if (volumeDelta !== 0) return volumeDelta;
      return Math.abs(quoteChangePctValue(right.quote) ?? 0) - Math.abs(quoteChangePctValue(left.quote) ?? 0);
    })
    .slice(0, 24)
    .map((row, index) => ({
      symbol: row.quote.symbol,
      market: row.quote.market,
      name: row.name,
      sector: officialHeatmapSectorForSymbol(row.quote.symbol, null),
      source: row.item.selectedSource ?? row.quote.source,
      last: row.quote.last,
      prevClose: row.quote.prevClose,
      change: quoteChangeValue(row.quote),
      changePct: quoteChangePctValue(row.quote),
      volume: row.quote.volume,
      timestamp: row.quote.timestamp,
      weight: row.quote.volume !== null && row.quote.volume > 0
        ? round(Math.max(1, Math.min(8, Math.log10(row.quote.volume + 10))), 3)
        : round(Math.max(1, 6 - index * 0.18), 3),
      readiness: row.item.readiness,
      freshnessStatus: row.item.freshnessStatus
    }));

  return {
    state: rows.length > 0
      ? rows.some((row) => row.item.freshnessStatus === "fresh")
        ? "LIVE"
        : "STALE"
      : "EMPTY",
    source: "market-data/effective-quotes",
    index: indexRow ? {
      state: stateFromEffectiveQuote(indexRow.item),
      symbol: indexRow.quote.symbol,
      market: indexRow.quote.market,
      name: indexRow.name,
      source: indexRow.item.selectedSource ?? indexRow.quote.source,
      last: indexRow.quote.last,
      change: quoteChangeValue(indexRow.quote),
      changePct: quoteChangePctValue(indexRow.quote),
      timestamp: indexRow.quote.timestamp,
      freshnessStatus: indexRow.item.freshnessStatus,
      reason: indexRow.item.reasons.join(", "),
      history: []
    } : {
      state: "EMPTY" as const,
      symbol: null,
      market: "TW_INDEX" as const,
      name: "加權指數",
      source: null,
      last: null,
      change: null,
      changePct: null,
      timestamp: null,
      freshnessStatus: "missing" as const,
      reason: "market_index_quote_missing",
      history: []
    },
    breadth: {
      state: breadthRows.length > 0
        ? liveBreadthCount > 0
          ? "LIVE"
          : "STALE"
        : "EMPTY",
      up,
      down,
      flat,
      total: breadthRows.length,
      updatedAt: freshestBreadthTimestamp,
      source: "market-data/effective-quotes",
      reason: breadthRows.length > 0 ? null : "quote_change_pct_missing"
    },
    heatmap
  };
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dateToTaipeiIso(date: string): string {
  return new Date(`${date}T00:00:00+08:00`).toISOString();
}

function daysAgoIsoDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boundedPositiveEnvInt(name: string, fallback: number, max: number): number {
  const raw = Number(process.env[name] ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.floor(raw), max);
}

function normalizeTwTicker(value: unknown): string | null {
  const symbol = String(value ?? "").trim().toUpperCase();
  return /^\d{4}$/.test(symbol) ? symbol : null;
}

function officialHeatmapSectorForSymbol(symbol: string, fallback?: string | null): string | null {
  const normalized = normalizeTwTicker(symbol);
  const fallbackSector = fallback?.trim() || null;
  return normalized
    ? MARKET_HEATMAP_SYMBOL_SECTOR_LABELS.get(normalized) ?? fallbackSector
    : fallbackSector;
}

function heatmapRequiredRank(symbol: string): number | null {
  const normalized = normalizeTwTicker(symbol);
  if (!normalized) return null;
  return MARKET_HEATMAP_REQUIRED_SYMBOL_RANK.get(normalized) ?? null;
}

function isDailyRowStale(
  row: { date: string } | undefined,
  targetDate: string
): boolean {
  if (!row) return true;
  const rowDate = dateOnly(row.date);
  return rowDate.length < 10 || rowDate < targetDate;
}

export function selectDailyContextOhlcvSelfHealSymbols(input: {
  companies: Array<{ ticker: string }>;
  rows: Array<{ symbol: string; date: string; volume?: number | null }>;
  targetDate: string | null;
  limit: number;
  prioritySymbols?: readonly string[];
}): string[] {
  const targetDate = input.targetDate ? dateOnly(input.targetDate) : null;
  const limit = Math.max(0, Math.floor(input.limit));
  if (!targetDate || targetDate.length < 10 || limit === 0) return [];

  const eligibleSymbols = new Set<string>();
  for (const company of input.companies) {
    const symbol = normalizeTwTicker(company.ticker);
    if (symbol) eligibleSymbols.add(symbol);
  }

  const rowBySymbol = new Map<string, { symbol: string; date: string; volume?: number | null }>();
  for (const row of input.rows) {
    const symbol = normalizeTwTicker(row.symbol);
    if (!symbol || !eligibleSymbols.has(symbol)) continue;
    const existing = rowBySymbol.get(symbol);
    if (!existing || dateOnly(row.date) > dateOnly(existing.date)) {
      rowBySymbol.set(symbol, row);
    }
  }

  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const addCandidate = (value: unknown) => {
    if (selected.length >= limit) return;
    const symbol = normalizeTwTicker(value);
    if (!symbol || !eligibleSymbols.has(symbol) || selectedSet.has(symbol)) return;
    const row = rowBySymbol.get(symbol);
    if (!isDailyRowStale(row, targetDate)) return;
    selected.push(symbol);
    selectedSet.add(symbol);
  };

  for (const symbol of input.prioritySymbols ?? DAILY_CONTEXT_PRIORITY_SYMBOLS) {
    addCandidate(symbol);
  }

  const staleRowsByVolume = [...rowBySymbol.values()]
    .filter((row) => isDailyRowStale(row, targetDate))
    .sort((left, right) => (right.volume ?? 0) - (left.volume ?? 0));
  for (const row of staleRowsByVolume) {
    addCandidate(row.symbol);
  }

  return selected;
}

function dailyBarToContextRow(input: {
  symbol: string;
  market: Market;
  name: string;
  sector?: string | null;
  latest: { dt: string; open?: unknown; high?: unknown; low?: unknown; close: unknown; volume: unknown };
  previous?: { close: unknown } | null;
  source: string;
  index?: number;
}): DailyBarContextRow | null {
  const last = finiteNumber(input.latest.close);
  if (last === null) return null;
  const open = finiteNumber(input.latest.open);
  const high = finiteNumber(input.latest.high);
  const low = finiteNumber(input.latest.low);
  const prevClose = input.previous ? finiteNumber(input.previous.close) : null;
  const change = prevClose && prevClose !== 0 ? round(last - prevClose) : null;
  const changePct = prevClose && prevClose !== 0 ? round((last - prevClose) / prevClose * 100) : null;
  const volume = finiteNumber(input.latest.volume);
  const index = input.index ?? 0;
  const symbol = input.symbol.trim().toUpperCase();

  return {
    symbol,
    market: input.market,
    name: input.name,
    sector: officialHeatmapSectorForSymbol(symbol, input.sector),
    date: input.latest.dt,
    open,
    high,
    low,
    close: last,
    last,
    prevClose,
    change,
    changePct,
    volume,
    timestamp: dateToTaipeiIso(input.latest.dt),
    source: input.source,
    weight: volume !== null && volume > 0
      ? round(Math.max(1, Math.min(8, Math.log10(volume + 10))), 3)
      : round(Math.max(1, 6 - index * 0.18), 3)
  };
}

async function loadFinMindTaiexIndexContext(): Promise<{ row: DailyBarContextRow | null; history: IndexOhlcHistoryRow[] }> {
  // BUG-09 fix: Build TAIEX OHLCV history from TWSE MI_5MINS_HIST official daily
  // closes (always current, free) instead of relying solely on FinMind which may
  // return stale data when the token is on a free plan or quota-limited.
  // Strategy:
  //   1. Try FinMind for full OHLCV bars (open/high/low/close/volume) — richer.
  //   2. Use TWSE getTaiexDailyCloses for close-only history — always up-to-date.
  //   3. Merge: FinMind bars take precedence for dates they cover; TWSE fills gaps
  //      and extends to the latest trading day.

  const today = daysAgoIsoDate(0);
  const historyStartDate = daysAgoIsoDate(140);

  // Attempt FinMind (best-effort, may be stale or unavailable)
  let finmindBars: { dt: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
  let latestFinmindDate: string | null = null;
  if (process.env.FINMIND_API_TOKEN) {
    try {
      const raw = await getFinMindClient().getStockPriceAdj("TAIEX", historyStartDate, null);
      finmindBars = raw;
      latestFinmindDate = raw.at(-1)?.dt ?? null;
    } catch {
      // FinMind unavailable — fall through to TWSE-only
    }
  }

  // Always fetch TWSE MI_5MINS_HIST for official close history (last 140 days)
  let twseCloses: { date: string; close: number }[] = [];
  try {
    twseCloses = await getTaiexDailyCloses(historyStartDate, today);
  } catch {
    // TWSE unavailable — use FinMind only
  }

  // Build close map from FinMind (richer) and TWSE (authoritative)
  const closeMapByDate = new Map<string, IndexOhlcHistoryRow>();

  // First populate with TWSE closes (close-only bars)
  for (const row of twseCloses) {
    closeMapByDate.set(row.date, {
      date: row.date,
      open: null,
      high: null,
      low: null,
      close: finiteNumber(row.close),
      volume: null,
      source: "twse:MI_5MINS_HIST"
    });
  }

  // Then overlay FinMind bars (with full OHLCV) where available
  for (const bar of finmindBars) {
    closeMapByDate.set(bar.dt, {
      date: bar.dt,
      open: finiteNumber(bar.open),
      high: finiteNumber(bar.high),
      low: finiteNumber(bar.low),
      close: finiteNumber(bar.close),
      volume: finiteNumber(bar.volume),
      source: "finmind:TaiwanStockPrice"
    });
  }

  const history = [...closeMapByDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-70);

  // Build the DailyBarContextRow for the latest bar
  // Prefer FinMind if it has data up to within 7 days; otherwise use TWSE close
  let row: DailyBarContextRow | null = null;
  const latestBar = history.at(-1);
  const previousBar = history.length > 1 ? history.at(-2) : null;

  if (latestBar?.close) {
    const isFinmindFresh = latestFinmindDate != null && latestFinmindDate >= daysAgoIsoDate(7);
    const source = isFinmindFresh ? "finmind:TaiwanStockPrice" : "twse:MI_5MINS_HIST";
    const prevClose = previousBar?.close ?? null;
    const change = prevClose != null && latestBar.close != null ? latestBar.close - prevClose : null;
    const changePct = prevClose != null && prevClose > 0 && latestBar.close != null
      ? ((latestBar.close - prevClose) / prevClose) * 100
      : null;
    row = {
      symbol: "TAIEX",
      market: "TW_INDEX",
      name: "加權指數",
      sector: null,
      date: latestBar.date,
      open: latestBar.open,
      high: latestBar.high,
      low: latestBar.low,
      close: latestBar.close,
      last: latestBar.close,
      prevClose,
      change,
      changePct,
      volume: latestBar.volume,
      timestamp: dateToTaipeiIso(latestBar.date),
      weight: 0,
      source
    };
  }

  if (history.length === 0 && !row) return { row: null, history: [] };
  return { row, history };
}

async function loadDailyBarRowsFromDb(input: {
  session: AppSession;
  companies: CompanyLite[];
}): Promise<DailyBarContextRow[]> {
  const db = getDb();
  if (!db || input.companies.length === 0) return [];

  // Cache key by workspace — OHLCV data is daily-granularity, 10-min TTL is safe.
  const cacheKey = input.session.workspace.id;
  const now = Date.now();
  const cachedResult = _dailyBarRowsCache.get(cacheKey);
  if (cachedResult && cachedResult.expiresAt > now) {
    return cachedResult.data;
  }

  const companyById = new Map(input.companies.map((company) => [company.id, company]));

  // Query by workspaceId + interval + source only (no inArray on 3470 UUIDs).
  // PostgreSQL uses companies_ohlcv_workspace_dt_idx (workspaceId, dt) — no IN-clause scan.
  // Filter to known companyIds in memory after the query.
  const rows = await db
    .select({
      companyId: companiesOhlcv.companyId,
      dt: companiesOhlcv.dt,
      open: companiesOhlcv.open,
      high: companiesOhlcv.high,
      low: companiesOhlcv.low,
      close: companiesOhlcv.close,
      volume: companiesOhlcv.volume
    })
    .from(companiesOhlcv)
    .where(and(
      eq(companiesOhlcv.workspaceId, input.session.workspace.id),
      eq(companiesOhlcv.interval, "1d"),
      ne(companiesOhlcv.source, "mock")
    ))
    .orderBy(desc(companiesOhlcv.dt))
    .limit(5000);

  const byCompany = new Map<string, Array<{
    dt: string;
    open: unknown;
    high: unknown;
    low: unknown;
    close: unknown;
    volume: unknown;
  }>>();
  for (const row of rows) {
    const list = byCompany.get(row.companyId) ?? [];
    if (list.length >= 2) continue;
    const dt = dateOnly(row.dt);
    if (list.some((item) => item.dt === dt)) continue;
    list.push({
      dt,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume
    });
    byCompany.set(row.companyId, list);
  }

  const contextRows: DailyBarContextRow[] = [];
  for (const [companyId, bars] of byCompany.entries()) {
    const company = companyById.get(companyId);
    const latest = bars[0];
    if (!company || !latest) continue;
    const row = dailyBarToContextRow({
      symbol: company.ticker.trim().toUpperCase(),
      market: mapCompanyMarket(company.market),
      name: company.name,
      sector: company.chainPosition,
      latest,
      previous: bars[1] ?? null,
      source: "finmind:companies_ohlcv",
      index: contextRows.length
    });
    if (row) contextRows.push(row);
  }

  const bySymbol = new Map<string, DailyBarContextRow>();
  for (const row of contextRows) {
    const key = `${row.market}:${row.symbol}`;
    const existing = bySymbol.get(key);
    if (!existing) {
      bySymbol.set(key, row);
      continue;
    }

    const rowDate = row.date.localeCompare(existing.date);
    if (
      rowDate > 0
      || (rowDate === 0 && (row.volume ?? -Infinity) > (existing.volume ?? -Infinity))
      || (rowDate === 0 && (row.volume ?? null) === (existing.volume ?? null) && row.name.length > existing.name.length)
    ) {
      bySymbol.set(key, row);
    }
  }

  const result = [...bySymbol.values()];
  _dailyBarRowsCache.set(cacheKey, { data: result, expiresAt: now + DAILY_BAR_ROWS_TTL_MS });
  return result;
}

function getLatestDailyContextDate(
  rows: DailyBarContextRow[],
  indexRow: DailyBarContextRow | null
): string | null {
  const dates = [
    ...rows.map((row) => row.date),
    indexRow?.date ?? null
  ]
    .filter((date): date is string => Boolean(date))
    .map((date) => dateOnly(date))
    .filter((date) => date.length >= 10)
    .sort((left, right) => right.localeCompare(left));

  return dates[0] ?? null;
}

function selectDailyContextOhlcvSelfHealTargets(input: {
  session: AppSession;
  companies: CompanyLite[];
  rows: DailyBarContextRow[];
  indexRow: DailyBarContextRow | null;
}): Array<{ companyId: string; ticker: string; workspaceId: string }> {
  const targetDate = getLatestDailyContextDate(input.rows, input.indexRow);
  if (!targetDate) return [];

  const limit = boundedPositiveEnvInt(
    "FINMIND_DAILY_CONTEXT_SELF_HEAL_LIMIT",
    DAILY_CONTEXT_SELF_HEAL_DEFAULT_LIMIT,
    DAILY_CONTEXT_SELF_HEAL_MAX_LIMIT
  );
  const symbols = selectDailyContextOhlcvSelfHealSymbols({
    companies: input.companies,
    rows: input.rows,
    targetDate,
    limit
  });
  if (symbols.length === 0) return [];

  const companyBySymbol = new Map<string, CompanyLite>();
  for (const company of input.companies) {
    const symbol = normalizeTwTicker(company.ticker);
    if (symbol && !companyBySymbol.has(symbol)) {
      companyBySymbol.set(symbol, company);
    }
  }

  const now = Date.now();
  if (dailyContextSelfHealCooldown.size > 5000) {
    for (const [key, expiresAt] of dailyContextSelfHealCooldown.entries()) {
      if (expiresAt <= now) dailyContextSelfHealCooldown.delete(key);
    }
  }

  const targets: Array<{ companyId: string; ticker: string; workspaceId: string }> = [];
  for (const symbol of symbols) {
    const company = companyBySymbol.get(symbol);
    if (!company) continue;
    const cooldownKey = `${input.session.workspace.id}:${symbol}`;
    const cooldownUntil = dailyContextSelfHealCooldown.get(cooldownKey) ?? 0;
    if (cooldownUntil > now) continue;
    dailyContextSelfHealCooldown.set(cooldownKey, now + DAILY_CONTEXT_SELF_HEAL_COOLDOWN_MS);
    targets.push({
      companyId: company.id,
      ticker: symbol,
      workspaceId: input.session.workspace.id
    });
  }

  return targets;
}

async function maybeSelfHealDailyBarRows(input: {
  session: AppSession;
  companies: CompanyLite[];
  stockRows: DailyBarContextRow[];
  indexRow: DailyBarContextRow | null;
}): Promise<DailyBarContextRow[]> {
  if (process.env.FINMIND_KILL_SWITCH === "true") return input.stockRows;
  if (!getDb()) return input.stockRows;
  if (!getFinMindClient().hasToken()) return input.stockRows;

  const finmindStats = getFinMindStats();
  if (finmindStats.circuitOpen) return input.stockRows;

  const targets = selectDailyContextOhlcvSelfHealTargets({
    session: input.session,
    companies: input.companies,
    rows: input.stockRows,
    indexRow: input.indexRow
  });
  if (targets.length === 0) return input.stockRows;

  const targetDate = getLatestDailyContextDate(input.stockRows, input.indexRow);
  console.log(
    `[market-data] FinMind OHLCV self-heal targetDate=${targetDate ?? "unknown"} tickers=${targets.length}`
  );

  try {
    await runOhlcvFinmindSync(targets, {
      startDate: daysAgoIsoDate(DAILY_CONTEXT_SELF_HEAL_LOOKBACK_DAYS),
      forceFinmind: true
    });
    return await loadDailyBarRowsFromDb({
      session: input.session,
      companies: input.companies
    });
  } catch (err) {
    console.warn(
      "[market-data] FinMind OHLCV self-heal failed:",
      err instanceof Error ? err.message : String(err)
    );
    return input.stockRows;
  }
}

function selectDailyHeatmapRows(rows: DailyBarContextRow[]): DailyBarContextRow[] {
  const usableRows = rows.filter((row) => row.last !== null || dailyRowChangePctValue(row) !== null || row.volume !== null);
  const volumeSorted = [...usableRows].sort((left, right) => {
    const volumeDelta = (right.volume ?? -Infinity) - (left.volume ?? -Infinity);
    if (volumeDelta !== 0) return volumeDelta;
    return Math.abs(dailyRowChangePctValue(right) ?? 0) - Math.abs(dailyRowChangePctValue(left) ?? 0);
  });
  const requiredRows = usableRows
    .filter((row) => heatmapRequiredRank(row.symbol) !== null)
    .sort((left, right) => {
      const rankDelta = (heatmapRequiredRank(left.symbol) ?? 9999) - (heatmapRequiredRank(right.symbol) ?? 9999);
      if (rankDelta !== 0) return rankDelta;
      return (right.volume ?? -Infinity) - (left.volume ?? -Infinity);
    });

  const bySymbol = new Map<string, DailyBarContextRow>();
  for (const row of requiredRows) bySymbol.set(row.symbol, row);
  for (const row of volumeSorted) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row);
  }

  return [...bySymbol.values()].slice(0, MARKET_HEATMAP_LIMIT);
}

async function buildDailyBarMarketContext(input: {
  session: AppSession;
  companies: CompanyLite[];
}) {
  const [indexContext, initialStockRows] = await Promise.all([
    loadFinMindTaiexIndexContext(),
    loadDailyBarRowsFromDb(input)
  ]);
  const indexRow = indexContext.row;
  const stockRows = await maybeSelfHealDailyBarRows({
    session: input.session,
    companies: input.companies,
    stockRows: initialStockRows,
    indexRow
  });

  const breadthRows = stockRows.filter((row) => dailyRowChangePctValue(row) !== null);
  const up = breadthRows.filter((row) => (dailyRowChangePctValue(row) ?? 0) > 0).length;
  const down = breadthRows.filter((row) => (dailyRowChangePctValue(row) ?? 0) < 0).length;
  const flat = breadthRows.length - up - down;
  const freshestBreadthTimestamp = breadthRows
    .map((row) => row.timestamp)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const heatmap = selectDailyHeatmapRows(stockRows)
    .map((row) => ({
      symbol: row.symbol,
      market: row.market,
      name: row.name,
      sector: officialHeatmapSectorForSymbol(row.symbol, row.sector),
      source: row.source,
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      last: row.last,
      prevClose: row.prevClose,
      change: dailyRowChangeValue(row),
      changePct: dailyRowChangePctValue(row),
      volume: row.volume,
      timestamp: row.timestamp,
      weight: row.weight,
      readiness: "degraded" as const,
      freshnessStatus: "stale" as const
    }));

  if (!indexRow && heatmap.length === 0) return null;

  return {
    state: "STALE" as const,
    source: "finmind:official-daily",
    index: indexRow ? {
      state: "STALE" as const,
      symbol: indexRow.symbol,
      market: indexRow.market,
      name: indexRow.name,
      source: indexRow.source,
      last: indexRow.last,
      change: dailyRowChangeValue(indexRow),
      changePct: dailyRowChangePctValue(indexRow),
      timestamp: indexRow.timestamp,
      freshnessStatus: "stale" as const,
      reason: "official_daily_index",
      history: indexContext.history
    } : {
      state: "EMPTY" as const,
      symbol: null,
      market: "TW_INDEX" as const,
      name: "加權指數",
      source: null,
      last: null,
      change: null,
      changePct: null,
      timestamp: null,
      freshnessStatus: "missing" as const,
      reason: "market_index_daily_missing",
      history: indexContext.history
    },
    breadth: {
      state: breadthRows.length > 0 ? "STALE" as const : "EMPTY" as const,
      up,
      down,
      flat,
      total: breadthRows.length,
      updatedAt: freshestBreadthTimestamp,
      source: "finmind:companies_ohlcv",
      reason: breadthRows.length > 0 ? "official_daily_breadth" : "daily_change_pct_missing"
    },
    heatmap
  };
}

function leadersFromHeatmap(heatmap: Array<{
  symbol: string;
  market: Market;
  name: string;
  source: string;
  last: number | null;
  changePct: number | null;
  volume: number | null;
  timestamp: string;
  readiness?: EffectiveQuoteReadiness;
  freshnessStatus?: QuoteResolutionFreshnessStatus;
}>, topLimit: number) {
  const rows = heatmap.map((row) => ({
    symbol: row.symbol,
    market: row.market,
    name: row.name,
    source: row.source,
    last: row.last,
    changePct: row.changePct,
    volume: row.volume,
    timestamp: row.timestamp,
    readiness: row.readiness ?? "degraded",
    freshnessStatus: row.freshnessStatus ?? "stale"
  }));

  const withChange = rows.filter((row) => row.changePct !== null);
  return {
    topGainers: [...withChange]
      .sort((left, right) => (right.changePct ?? -Infinity) - (left.changePct ?? -Infinity))
      .slice(0, topLimit),
    topLosers: [...withChange]
      .sort((left, right) => (left.changePct ?? Infinity) - (right.changePct ?? Infinity))
      .slice(0, topLimit),
    mostActive: [...rows]
      .filter((row) => row.volume !== null)
      .sort((left, right) => (right.volume ?? -Infinity) - (left.volume ?? -Infinity))
      .slice(0, topLimit)
  };
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
  kgi: buildCachedProvider("kgi", "KGI quote provider not configured."),
  twse_mis: buildCachedProvider("twse_mis", "TWSE MIS quote provider not configured."),
  // official_close is intentionally NOT in quoteProviderSources (the array
  // that drives resolveMarketQuotes/getEffectiveMarketQuotes/consumer-
  // summary/selection-summary/decision-summary's candidate race) — it must
  // never compete for strategy/paper/execution usability, only ever appear
  // as an explicit last-resort display fallback (see
  // getEffectiveMarketQuotesWithOfficialCloseFallback). This entry exists
  // solely so `Record<QuoteSource, QuoteProviderAdapter>` type-checks; it is
  // never invoked at runtime.
  official_close: {
    source: "official_close",
    async listQuotes() {
      return [];
    },
    async getStatus() {
      return quoteProviderStatusSchema.parse({
        source: "official_close",
        connected: false,
        lastMessageAt: null,
        latencyMs: null,
        subscribedSymbols: [],
        reasons: ["official_close_not_a_live_provider"],
        errorMessage: null
      });
    }
  }
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

    if (pushQuoteEntry(workspaceSlug, workspaceCache, workspaceHistory, entry)) {
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
  // 2026-07-13 provenance lock (Pete #1246 review, Finding #1): force the tag
  // regardless of what each item's `source` field claims. Without this, an
  // Admin-gated POST /api/v1/market-data/manual-quotes body could set
  // source:"twse_mis" (auto-allows paper orders on a fabricated price) or
  // source:"kgi" (feeds liveUsable for the execution consumer summary) and the
  // stored row would be indistinguishable from real feed data. Every sibling
  // in this family (upsertPaperQuotes/upsertKgiQuotes/upsertTwseMisQuotes)
  // already forces its own override; this was the one gap.
  return upsertProviderQuotes({
    ...input,
    sourceOverride: "manual"
  });
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

/**
 * Canonical write-path entry point for the `quoteProviders.kgi` bucket
 * (2026-07-10 quote-chain outage diagnosis: this bucket previously had zero
 * production writers — `kgi-subscription-manager.ts`'s tick fetch was never
 * bridged here, so `readiness="ready"` — which requires `selectedSource ===
 * "kgi"` — was structurally unreachable even with a healthy KGI feed).
 * Mirrors `upsertPaperQuotes`: forces `sourceOverride: "kgi"` regardless of
 * any `source` field on individual quote items, so callers (the KGI ingest
 * cron, or a future direct gateway push) never need to special-case it.
 * Purely additive — does not touch the readiness formula or any other
 * source bucket.
 */
export async function upsertKgiQuotes(input: {
  session: AppSession;
  quotes: z.infer<typeof manualQuoteUpsertItemSchema>[];
}) {
  return upsertProviderQuotes({
    ...input,
    sourceOverride: "kgi"
  });
}

/**
 * Canonical write-path entry point for the `quoteProviders.twse_mis` bucket
 * (2026-07-13 paper-channel quoteGate P1 fix). The TWSE MIS intraday cron and
 * full-universe sweep previously injected official real-time MIS quotes via
 * `upsertManualQuotes`, tagging them `source: "manual"` — indistinguishable
 * from a genuinely hand-typed Admin value. `isSyntheticSource()` therefore
 * always flagged them synthetic, and `buildConsumerDecision()`'s paper-mode
 * branch could never get past "review" (no override path exists for paper
 * submits) — blocking every paper order whenever the KGI feed was down.
 * Mirrors `upsertKgiQuotes`/`upsertPaperQuotes`: forces `sourceOverride:
 * "twse_mis"` regardless of any `source` field on individual quote items.
 * Purely additive — does not touch any other source bucket. The execution
 * (real-money) channel is unaffected: `liveUsable` still strictly requires
 * `selectedSource === "kgi"`.
 */
export async function upsertTwseMisQuotes(input: {
  session: AppSession;
  quotes: z.infer<typeof manualQuoteUpsertItemSchema>[];
}) {
  return upsertProviderQuotes({
    ...input,
    sourceOverride: "twse_mis"
  });
}

/**
 * Canonical write-path entry point for the `quoteProviders.tradingview` bucket
 * (2026-07-13 provenance lock). Mirrors the rest of the family: forces
 * `sourceOverride: "tradingview"` regardless of any `source` field on
 * individual quote items. Previously the TradingView webhook reached this
 * bucket by passing `source: "tradingview"` through `upsertManualQuotes`'
 * pass-through, which the provenance lock removed.
 */
export async function upsertTradingViewQuotes(input: {
  session: AppSession;
  quotes: z.infer<typeof manualQuoteUpsertItemSchema>[];
}) {
  return upsertProviderQuotes({
    ...input,
    sourceOverride: "tradingview"
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
  return upsertTradingViewQuotes({
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
    // History freshness is derived from the age of the most-recent tick in the
    // series, not from the quote-provider freshness window (which is 5 s for
    // live feeds and expires immediately for a historical series).
    const lastPointAgeMs = getTimestampAgeMs(lastTimestamp);
    const historyFreshnessStatus: QuoteResolutionFreshnessStatus =
      ordered.length === 0 || lastTimestamp === null
        ? "missing"
        : lastPointAgeMs !== null && lastPointAgeMs <= getHistoryStaleMs()
          ? "fresh"
          : "stale";
    const quality = buildHistoryQualityAssessment({
      pointCount: ordered.length,
      freshnessStatus: historyFreshnessStatus,
      timeWindowCompleteness,
      synthetic
    });

    return {
      symbol,
      market,
      source,
      selectedSource: resolution?.selectedSource ?? null,
      fallbackReason: resolution?.fallbackReason ?? "none",
      freshnessStatus: historyFreshnessStatus,
      staleReason: resolution?.staleReason ?? "no_quote",
      pointCount: ordered.length,
      firstTimestamp,
      lastTimestamp,
      lastPointAgeMs,
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

// ── official_close fallback tier (2026-07-19) ──────────────────────────────
//
// Bug this fixes: GET /market-data/effective-quotes on a weekend, or right
// after a deploy restart (which wipes the in-memory quote cache — see
// CLAUDE.md's standing warning), returns every symbol as
// selectedQuote:null/fallbackReason:no_fresh_quote — the desk-exact
// watchlist and quote header go fully blank even though the
// quote_last_close DB table (populated daily by twse-eod-cron) already has
// yesterday's/last trading day's official close for these symbols.
//
// Scope, deliberately narrow: this augmentation is applied ONLY by
// getEffectiveMarketQuotesWithOfficialCloseFallback below (wired to the
// /effective-quotes HTTP route only). getEffectiveMarketQuotes(),
// resolveMarketQuotes(), getMarketDataConsumerSummary()/
// getMarketDataSelectionSummary()/getMarketDataDecisionSummary() — the
// functions strategy/paper/execution order-time risk checks actually call
// (see broker/paper-broker.ts, broker/trading-service.ts,
// broker/execution-gate.ts, domain/trading/paper-risk-bridge.ts, all of
// which use getMarketDataDecisionSummary) — are completely untouched, so
// the stale-quote risk guard's behavior cannot regress.

// Returns true when "now" (Taipei wall clock) is outside the 09:00-13:30
// TWSE trading session OR today is not a TW trading day at all
// (weekend/holiday, via the shared tw_trading_calendar-backed
// isTwTradingDay() — never a bare weekday guess). Mirrors
// _isKgiHeatmapAfterHours() in server.ts (same intent: "is a plain closing
// price honestly today's/last session's value, or would showing it without
// a stale warning be misleading right now"). Duplicated rather than
// imported because server.ts imports FROM market-data.ts already — the
// reverse import would be circular; only the ~4-line wall-clock window
// check is duplicated, the actual trading-calendar authority
// (isTwTradingDay) is reused, not reimplemented.
export async function _isMarketDataOffHours(nowMs: number = Date.now()): Promise<boolean> {
  const nowTaipei = new Date(nowMs + 8 * 60 * 60 * 1000);
  const todayIso = nowTaipei.toISOString().slice(0, 10);
  const tradingDay = await isTwTradingDay(todayIso).catch(() => true);
  if (!tradingDay) return true;
  const minutesOfDay = nowTaipei.getUTCHours() * 60 + nowTaipei.getUTCMinutes();
  return minutesOfDay < 9 * 60 || minutesOfDay >= 13 * 60 + 30;
}

// Pure merge function (exported for direct unit testing, same convention as
// _mapOhlcvRowsToEntries in quote-last-close-store.ts and
// mergeEodFallbackWithPersistedBars in server.ts): for every item that has
// NO fresh selectedQuote, if the quote_last_close DB table has a persisted
// close for that symbol, surface it as an explicit official_close
// candidate — but never silently override an item whose selection is
// already fresh, and never override an already-selected STALE quote unless
// official_close is actually the more recent value (see the 2026-07-20
// recency-arbitration note below).
//
// freshnessStatus semantics (requirement #3 of the 2026-07-19 dispatch):
//   - offHours=true  → "closed_snapshot": an honest closing-price snapshot,
//     not a live quote, but also not "stale" — this IS the correct value to
//     show right now (weekend/holiday/outside session).
//   - offHours=false → "stale": intraday, all live feeds are dead, so a
//     persisted close genuinely IS an outdated price for this moment.
// Either way, freshnessStatus is never "fresh", so strategyUsable/
// paperUsable/liveUsable (all gated on `freshnessStatus === "fresh"` in
// getEffectiveMarketQuotes above) stay false automatically — no separate
// override needed to hold that redline.
export function _applyOfficialCloseFallback(
  items: EffectiveMarketQuote[],
  lastCloseMap: Map<string, LastCloseResult>,
  offHours: boolean
): EffectiveMarketQuote[] {
  return items.map((item) => {
    // A genuinely fresh selection (live feed, this session) always wins —
    // this augmentation only ever competes with a stale or missing
    // selection, never a fresh one.
    if (item.freshnessStatus === "fresh") return item;

    const lastClose = lastCloseMap.get(item.symbol);
    if (!lastClose) return item;

    const closeTimestampIso = new Date(`${lastClose.tradeDate}T13:30:00+08:00`).toISOString();

    // 2026-07-20 (Elva prod finding, /m watchlist): resolveMarketQuotes()
    // called with includeStale=true treats ANY existing quote object as
    // "eligible" regardless of age, then picks purely by source priority
    // (kgi > twse_mis > tradingview > paper > manual) — so a months-old
    // residual manual/tradingview cache entry (source priority 1/3) was
    // winning over yesterday's real official close, because this
    // function's original guard (`selectedQuote !== null` => never touch)
    // let ANY stale selection block the fallback outright, no matter how
    // ancient. Fix: arbitrate the "no fresh source" case by RECENCY, not
    // raw source priority — official_close only replaces an existing stale
    // selection when official_close's own timestamp is at least as recent
    // as the currently-selected stale quote's timestamp. This keeps a
    // near-fresh stale tick (e.g. a KGI tick a few seconds past its 5s
    // threshold, timestamped today) correctly ahead of yesterday's close,
    // while a genuinely ancient stale candidate (the reported bug) still
    // loses to official_close.
    if (item.selectedQuote !== null && item.selectedQuote.timestamp >= closeTimestampIso) {
      return item;
    }
    const freshnessStatus: QuoteResolutionFreshnessStatus = offHours ? "closed_snapshot" : "stale";
    const officialCloseQuote = quoteSchema.parse({
      symbol: item.symbol,
      market: item.market,
      source: "official_close",
      last: lastClose.closePrice,
      bid: null,
      ask: null,
      open: null,
      high: null,
      low: null,
      // Tier 2.5 (quote_last_close) is structurally price-only — no
      // prevClose/change columns exist on this table (same limitation
      // documented in kgi-heatmap-enricher.ts for its own Tier 2.5 read of
      // this identical table). Never fabricate a changePct here.
      prevClose: null,
      changePct: null,
      volume: null,
      timestamp: closeTimestampIso,
      ageMs: Math.max(0, Date.now() - new Date(closeTimestampIso).getTime()),
      isStale: freshnessStatus === "stale"
    });

    return effectiveMarketQuoteSchema.parse({
      ...item,
      selectedSource: "official_close",
      selectedQuote: officialCloseQuote,
      freshnessStatus,
      fallbackReason: item.fallbackReason,
      staleReason: item.staleReason,
      readiness: "degraded",
      strategyUsable: false,
      paperUsable: false,
      liveUsable: false,
      synthetic: false,
      providerConnected: false,
      staleAfterMs: item.staleAfterMs,
      sourcePriority: getSourcePriority("official_close"),
      closedSnapshotTradeDate: lastClose.tradeDate,
      reasons: [
        ...item.reasons,
        offHours ? "official_close_snapshot" : "official_close_stale_intraday_fallback"
      ],
      candidates: [
        ...item.candidates,
        quoteResolutionCandidateSchema.parse({
          source: "official_close",
          priority: getSourcePriority("official_close"),
          providerConnected: false,
          subscribed: false,
          eligible: false,
          freshnessStatus,
          staleReason: "none",
          quote: officialCloseQuote
        })
      ]
    });
  });
}

// ── round 2 (2026-07-19) ────────────────────────────────────────────────────
//
// Prod repro after #1307 merged+deployed: `GET /effective-quotes?symbols=
// 2330,2454` right after the deploy restart returned `items: []` /
// `summary.total: 0` — NOT individual "blocked" items. The "零 quote symbol
// 整個消失" limitation #1307's own test docstring and Pete's review (🟡 #3)
// had flagged as a rare cold-symbol edge case turned out to BE the main
// symptom: a deploy restart wipes providerQuoteCache for every symbol in the
// process, and requested symbols with literally zero cached quotes never get
// a `grouped` entry in resolveMarketQuotes() at all (see docstring on the
// existing test file). Round 1's `_applyOfficialCloseFallback` can only
// augment items that already exist in `effective.items` — it had nothing to
// work with here.
//
// Why loadPersistedQuoteEntries()'s on-restart reload didn't catch this
// (investigated per Elva's round-2 ask, so we fix the right layer): it isn't
// a logic bug in that function. `market-data-store.ts`'s
// getMarketDataStoreDir() falls back to `RAILWAY_VOLUME_MOUNT_PATH` for a
// persistent path, defaulting to `process.cwd()/runtime-data/market-data`
// (ephemeral, wiped every deploy) when that env var is absent. Checked
// directly against prod (`railway variables --service api --kv`,
// `railway volume list`): `RAILWAY_VOLUME_MOUNT_PATH` is NOT set on the `api`
// service, and the `api-volume` (mount path `/data`, ~150MB of real
// historical data already in it) shows as unattached ("Attached to: N/A") —
// an infra config-drift issue, not a code bug in this file. This means
// EVERY deploy currently loses the entire persisted-quote-history JSONL
// (and, separately and more importantly — outside this PR's lane —
// risk-store.ts uses the exact same `RAILWAY_VOLUME_MOUNT_PATH` fallback
// pattern for kill-switch/risk-limit state, so that persistence is likely
// silently ephemeral too; flagged to Elva, not fixed here — reattaching a
// volume is an infra operation outside this backend-lane PR and touches
// risk-store.ts's operating assumptions). Practical upshot for THIS fix:
// quote_last_close is a real Postgres table (not file-backed), so it is
// immune to this specific ephemeral-volume issue — which is exactly why the
// fix below reads from it directly instead of depending on the
// (currently non-functional in prod) JSONL reload path.
//
// Round-2 fix: for every REQUESTED symbol that resolveMarketQuotes() produced
// no item for at all (not just ones present-but-blocked), synthesize a full
// item from quote_last_close. When quote_last_close also has nothing for a
// symbol, synthesize an explicit BLOCKED item rather than silently omitting
// it — see _synthesizeItemForMissingSymbol's docstring for why "always one
// row per requested symbol" was chosen over "stay silent".

// Mirrors resolveMarketQuotes()'s own symbol-list parsing exactly (comma
// split, trim, uppercase, dedupe) — kept as a small separate export so "which
// symbols did the caller actually ask for" is directly testable.
export function _parseRequestedSymbols(symbols: string): string[] {
  return [
    ...new Set(
      symbols
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    )
  ];
}

// Best-effort Market for a symbol we have NEVER cached ANY quote for (so
// there is no cached Quote.market to read, unlike the round-1 augmentation
// case). `market` is a required, non-nullable field on
// effectiveMarketQuoteSchema/quoteSchema — SOME value must be chosen.
// Preference order: (1) the caller's own `?market=` filter, if given — an
// explicit single-market request IS a confident signal the caller believes
// these symbols belong to that market; (2) quote_last_close's own `source`
// column — `"tpex_eod"` is the only value in LastCloseSource that is
// TPEX-specific (see quote-last-close-store.ts); (3) TWSE, the overwhelming
// majority of this desk's symbol universe. This is a documented best-effort
// default, not a claim of certainty — a genuinely unknown symbol with no
// market filter and no quote_last_close row could still be mislabeled.
function _resolveMarketForMissingSymbol(
  requestedMarket: Market | undefined,
  lastClose: LastCloseResult | undefined
): Market {
  if (requestedMarket) return requestedMarket;
  if (lastClose?.source === "tpex_eod") return "TPEX";
  return "TWSE";
}

// Fully synthesizes an EffectiveMarketQuote for a symbol resolveMarketQuotes()
// produced NO item for at all (pure function, exported for direct unit
// testing — same convention as _applyOfficialCloseFallback above).
//
// Candidates are built to look structurally identical to what
// resolveMarketQuotes() would have produced for a symbol that DID get a
// grouped entry but had zero quotes from any of the 5 known providers (same
// "missing"/"no_quote" shape) — using each provider's REAL connected/
// subscribed status (via providerStatuses) rather than a blanket false
// claim, so this candidate list is honest about provider connectivity even
// though it's honest about never having seen a quote for this symbol.
//
// quote_last_close also has nothing for this symbol: returns a genuinely
// BLOCKED item rather than omitting the symbol. Chosen over "stay absent"
// because (a) it gives every requested symbol exactly one row in the
// response — "query N symbols in, N items out" is a materially safer API
// contract than "count of items may silently be less than requested, with
// no way to tell which ones vanished or why" (exactly the confusion this
// round's prod incident caused), and (b) an explicit blocked item with
// reasons:["missing_quote", ...] IS this project's "缺資料顯 EMPTY/STALE
// 真原因，不假綠" rule in its most literal form.
export function _synthesizeItemForMissingSymbol(input: {
  symbol: string;
  market: Market;
  lastClose: LastCloseResult | undefined;
  offHours: boolean;
  providerStatuses: QuoteProviderStatus[];
}): EffectiveMarketQuote {
  const statusBySource = new Map(input.providerStatuses.map((status) => [status.source, status]));
  const baseCandidates = quoteProviderSources.map((source) => {
    const status = statusBySource.get(source);
    return quoteResolutionCandidateSchema.parse({
      source,
      priority: getSourcePriority(source),
      providerConnected: status?.connected ?? false,
      subscribed: (status?.subscribedSymbols ?? []).includes(input.symbol),
      eligible: false,
      freshnessStatus: "missing",
      staleReason: "no_quote",
      quote: null
    });
  });

  if (!input.lastClose) {
    const fallbackReason: QuoteResolutionFallbackReason = "no_quote";
    const staleReason: QuoteResolutionStaleReason = "no_quote";
    return effectiveMarketQuoteSchema.parse({
      symbol: input.symbol,
      market: input.market,
      selectedSource: null,
      selectedQuote: null,
      freshnessStatus: "missing",
      fallbackReason,
      staleReason,
      readiness: "blocked",
      strategyUsable: false,
      paperUsable: false,
      liveUsable: false,
      synthetic: false,
      providerConnected: false,
      staleAfterMs: null,
      sourcePriority: null,
      reasons: buildEffectiveQuoteReasons({
        selectedSource: null,
        fallbackReason,
        staleReason,
        synthetic: false,
        providerConnected: false
      }),
      candidates: baseCandidates,
      closedSnapshotTradeDate: null
    });
  }

  const closeTimestampIso = new Date(`${input.lastClose.tradeDate}T13:30:00+08:00`).toISOString();
  const freshnessStatus: QuoteResolutionFreshnessStatus = input.offHours ? "closed_snapshot" : "stale";
  const officialCloseQuote = quoteSchema.parse({
    symbol: input.symbol,
    market: input.market,
    source: "official_close",
    last: input.lastClose.closePrice,
    bid: null,
    ask: null,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    changePct: null,
    volume: null,
    timestamp: closeTimestampIso,
    ageMs: Math.max(0, Date.now() - new Date(closeTimestampIso).getTime()),
    isStale: freshnessStatus === "stale"
  });
  const fallbackReason: QuoteResolutionFallbackReason = "no_fresh_quote";
  const staleReason: QuoteResolutionStaleReason = "age_exceeded";

  return effectiveMarketQuoteSchema.parse({
    symbol: input.symbol,
    market: input.market,
    selectedSource: "official_close",
    selectedQuote: officialCloseQuote,
    freshnessStatus,
    fallbackReason,
    staleReason,
    readiness: "degraded",
    strategyUsable: false,
    paperUsable: false,
    liveUsable: false,
    synthetic: false,
    providerConnected: false,
    staleAfterMs: null,
    sourcePriority: getSourcePriority("official_close"),
    reasons: [
      ...buildEffectiveQuoteReasons({
        selectedSource: "official_close",
        fallbackReason,
        staleReason,
        synthetic: false,
        providerConnected: false
      }),
      input.offHours ? "official_close_snapshot" : "official_close_stale_intraday_fallback"
    ],
    candidates: [
      ...baseCandidates,
      quoteResolutionCandidateSchema.parse({
        source: "official_close",
        priority: getSourcePriority("official_close"),
        providerConnected: false,
        subscribed: false,
        eligible: false,
        freshnessStatus,
        staleReason: "none",
        quote: officialCloseQuote
      })
    ],
    closedSnapshotTradeDate: input.lastClose.tradeDate
  });
}

// Recomputes the summary block from a final items[] array. Needed because,
// unlike round 1 (which only ever mutated existing items in place, so
// summary counts were unaffected), round 2 can APPEND brand-new items for
// symbols resolveMarketQuotes() never produced at all — leaving
// effective.summary as-is would silently under-count `total`/`blocked`/etc.
// Mirrors getEffectiveMarketQuotes()'s own summary shape exactly (same
// reason-bucket lists), kept as a helper so both call sites stay in sync.
function _recomputeEffectiveQuotesSummary(items: EffectiveMarketQuote[]) {
  return {
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
  };
}

// 2026-07-20 (Elva prod forensic ticket, quote_close_0050_forensics_20260720):
// resolveMarketQuotes() groups quotes by buildQuoteIdentityKey(symbol, market)
// — by design, since (symbol, market) is this project's canonical quote
// identity elsewhere too (risk-engine.ts, strategy-engine.ts). That design
// silently breaks when the SAME real-world symbol gets tagged with two
// different `market` values by different providers — confirmed live for
// 0050 (元大台灣50 ETF): the full-universe MIS sweep cron
// (_runMisFullSweepSlice's _misSwpMapMkt in server.ts) reads market from the
// `companies` table, where 0050's row has `market:"ETF"` (an instrument-type
// value someone put in what should be an exchange-venue column) — an
// unrecognized value that function's OLD default fell through to "OTHER",
// while the TWSE-EOD-QUOTE-CRON's manual/official_close fallback quotes for
// the same symbol are always tagged "TWSE". Two different (symbol, market)
// keys for the one real security → resolveMarketQuotes() legitimately (per
// its own contract) returns TWO separate items for a query that only asked
// for "0050" once — `?symbols=2330,0050,2454` returning 4 items instead of 3
// is that group-key split surfacing at the API boundary.
// server.ts's _misSwpMapMkt default is fixed at the source (same PR) so this
// won't recur going forward, but this function is the belt-and-suspenders
// fix at the API response boundary: even if some OTHER future provider bug
// reintroduces a symbol/market mismatch, `?symbols=X,Y,Z in` must never
// produce more than one item per requested symbol. When a symbol has
// multiple items, keeps the most USEFUL one — ranked by freshness (an
// actually-fresh quote beats a stale/closed-snapshot/missing one — this is
// also what makes 0050 show its real intraday MIS tick instead of the
// stale-manual-fallback duplicate that was masking it), then readiness, then
// source priority, with array order as the final deterministic tiebreak.
const _dedupeFreshnessRank: Record<QuoteResolutionFreshnessStatus, number> = {
  fresh: 3,
  closed_snapshot: 2,
  stale: 1,
  missing: 0
};
const _dedupeReadinessRank: Record<EffectiveQuoteReadiness, number> = {
  ready: 2,
  degraded: 1,
  blocked: 0
};

export function _dedupeItemsBySymbol(items: EffectiveMarketQuote[]): EffectiveMarketQuote[] {
  const bestBySymbol = new Map<string, EffectiveMarketQuote>();
  for (const item of items) {
    const existing = bestBySymbol.get(item.symbol);
    if (!existing) {
      bestBySymbol.set(item.symbol, item);
      continue;
    }
    const freshnessDelta = _dedupeFreshnessRank[item.freshnessStatus] - _dedupeFreshnessRank[existing.freshnessStatus];
    const readinessDelta = _dedupeReadinessRank[item.readiness] - _dedupeReadinessRank[existing.readiness];
    const priorityDelta = (item.sourcePriority ?? -1) - (existing.sourcePriority ?? -1);
    if (freshnessDelta > 0 || (freshnessDelta === 0 && (readinessDelta > 0 || (readinessDelta === 0 && priorityDelta > 0)))) {
      bestBySymbol.set(item.symbol, item);
    }
  }
  // Preserve first-seen order among surviving symbols rather than Map
  // insertion order re-sorting things (a later duplicate winning replaces
  // the value in place, not the position).
  const seen = new Set<string>();
  const result: EffectiveMarketQuote[] = [];
  for (const item of items) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    result.push(bestBySymbol.get(item.symbol)!);
  }
  return result;
}

// Route-level entry point for GET /market-data/effective-quotes only (see
// server.ts wiring). Thin wrapper around getEffectiveMarketQuotes +
// _applyOfficialCloseFallback (existing items) +
// _synthesizeItemForMissingSymbol (requested symbols with no item at all) —
// matches this file's existing convention of leaving thin DB-fetch glue
// untested and unit-testing the pure functions it calls. Fails open on any
// DB error or DATABASE mode being off: existing-but-blocked items and
// entirely-missing requested symbols both still get an honest response
// (official_close-filled when quote_last_close has data, genuinely blocked
// when it doesn't or DB is unavailable) — this guarantee does NOT require
// DB availability, only the "fill in real data" part does.
export async function getEffectiveMarketQuotesWithOfficialCloseFallback(input: {
  session: AppSession;
  symbols: string;
  market?: Market;
  includeStale?: boolean;
  limit?: number;
}) {
  const rawEffective = await getEffectiveMarketQuotes(input);
  // 2026-07-20: dedupe by symbol BEFORE any of the logic below — see
  // _dedupeItemsBySymbol's docstring. Only rebuilds the object (and
  // recomputes summary) when dedup actually removed something, so this is a
  // no-op passthrough in the overwhelmingly common case of clean data.
  const dedupedItems = _dedupeItemsBySymbol(rawEffective.items);
  const effective = dedupedItems.length === rawEffective.items.length
    ? rawEffective
    : { ...rawEffective, items: dedupedItems, summary: _recomputeEffectiveQuotesSummary(dedupedItems) };

  const requestedSymbols = _parseRequestedSymbols(input.symbols);
  const presentSymbols = new Set(effective.items.map((item) => item.symbol));
  const missingSymbols = requestedSymbols.filter((symbol) => !presentSymbols.has(symbol));
  // 2026-07-20: broadened from "selectedQuote === null" to "not fresh" —
  // _applyOfficialCloseFallback now also needs quote_last_close for items
  // that already have a STALE selectedQuote (so it can arbitrate by
  // recency, see that function's docstring), not only items with no
  // selectedQuote at all.
  const nonFreshExistingSymbols = effective.items
    .filter((item) => item.freshnessStatus !== "fresh")
    .map((item) => item.symbol);

  if (missingSymbols.length === 0 && nonFreshExistingSymbols.length === 0) {
    return effective;
  }

  // Only fetched when actually needed (missing symbols exist) — this is an
  // in-memory read (buildCachedProvider.getStatus), not a DB/network call.
  const providerStatuses = missingSymbols.length > 0
    ? await listMarketDataProviderStatuses({ session: input.session })
    : [];

  const lookupSymbols = [...new Set([...nonFreshExistingSymbols, ...missingSymbols])];
  let lastCloseMap: Map<string, LastCloseResult> = new Map();
  if (isDatabaseMode() && lookupSymbols.length > 0) {
    const db = getDb();
    if (db) {
      try {
        lastCloseMap = await getLastCloses(db, lookupSymbols);
      } catch (err) {
        console.warn(
          "[market-data/effective-quotes] official_close fallback query failed (non-fatal):",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }

  if (lastCloseMap.size === 0 && missingSymbols.length === 0) {
    // Round-1 shape: nothing to add (no DB data, no missing symbols) — same
    // fail-open passthrough as before.
    return effective;
  }

  const offHours = await _isMarketDataOffHours();
  const augmentedExisting = _applyOfficialCloseFallback(effective.items, lastCloseMap, offHours);
  const missingItems = missingSymbols.map((symbol) =>
    _synthesizeItemForMissingSymbol({
      symbol,
      market: _resolveMarketForMissingSymbol(input.market, lastCloseMap.get(symbol)),
      lastClose: lastCloseMap.get(symbol),
      offHours,
      providerStatuses
    })
  );

  const items = [...augmentedExisting, ...missingItems].slice(0, input.limit ?? 100);
  return {
    ...effective,
    summary: _recomputeEffectiveQuotesSummary(items),
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
    const safe = usable && (item.readiness === "ready" || isPaperTrustedNonKgiSource(input.mode, item.selectedSource));
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
      : lastBarAgeMs !== null && lastBarAgeMs <= getBarStaleMs()
        ? "fresh"
        : "stale";
    // Bars are derived from quote history tick aggregation (not native OHLCV bars),
    // so they are always approximate. However, synthetic flag follows the source:
    // manual/paper are synthetic (user-entered); tradingview/kgi are non-synthetic live feeds.
    const approximate = true;
    const synthetic = isSyntheticSource(sourceKey);
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
  // 2026-07-20 round 2 (Elva: memo didn't help, need real per-segment
  // timing, not more theory). Temporary diagnostic instrumentation --
  // console.log with [overview-perf] prefix so it's easy to grep out of
  // Railway logs. Remove once the real bottleneck is identified and fixed.
  const _perfT0 = performance.now();
  const _perfMark = (label: string, from: number) => {
    console.log(`[overview-perf] ${label}=${Math.round(performance.now() - from)}ms`);
    return performance.now();
  };
  const [providers, companies, quotes] = await Promise.all([
    listMarketDataProviderStatuses({
      session: input.session,
      sources: input.sources
    }),
    getCompaniesLiteCached(input.repo, input.session.workspace.slug),
    listMarketQuotes({
      session: input.session,
      includeStale: input.includeStale,
      limit: 1000
    })
  ]);
  let _perfT = _perfMark("providers_companies_quotes", _perfT0);
  console.log(`[overview-perf] quotes.length=${quotes.length} companies.length=${companies.length}`);
  const symbols = dedupeSymbolMasters(companies);
  const qualitySymbols = [...new Set(quotes.map((quote) => quote.symbol))].join(",");
  console.log(`[overview-perf] qualitySymbols.count=${qualitySymbols ? qualitySymbols.split(",").length : 0}`);
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
  _perfT = _perfMark("effectiveSelection", _perfT);
  const [historyQuality, barQuality] = qualitySymbols
    ? await Promise.all([
      (async () => {
        const t = performance.now();
        const r = await getMarketQuoteHistoryDiagnostics({
          session: input.session,
          symbols: qualitySymbols,
          includeStale: true,
          limit: Math.max(quotes.length * 4, 100)
        });
        console.log(`[overview-perf] historyQuality_inner=${Math.round(performance.now() - t)}ms`);
        return r;
      })(),
      (async () => {
        const t = performance.now();
        const r = await getMarketBarDiagnostics({
          session: input.session,
          symbols: qualitySymbols,
          includeStale: true,
          interval: "1m",
          limit: Math.max(quotes.length * 2, 50)
        });
        console.log(`[overview-perf] barQuality_inner=${Math.round(performance.now() - t)}ms`);
        return r;
      })()
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
  _perfT = _perfMark("historyQuality_barQuality_promiseall", _perfT);

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

  const effectiveItems = effectiveSelection.items as EffectiveMarketQuote[];
  const resolveName = buildSymbolNameLookup(companies);
  const effectiveQuoteRows = effectiveRows(effectiveItems)
    .filter((row) => !isMarketIndexSymbol(row.quote.symbol, row.quote.market, resolveName(row.quote.symbol, row.quote.market)));
  const quotesWithChange = effectiveQuoteRows.filter((row) => quoteChangePctValue(row.quote) !== null);
  let topGainers: OverviewLeader[] = [...quotesWithChange]
    .sort((left, right) => (quoteChangePctValue(right.quote) ?? -Infinity) - (quoteChangePctValue(left.quote) ?? -Infinity))
    .slice(0, topLimit)
    .map((row) => toOverviewLeader(row, resolveName));

  let topLosers: OverviewLeader[] = [...quotesWithChange]
    .sort((left, right) => (quoteChangePctValue(left.quote) ?? Infinity) - (quoteChangePctValue(right.quote) ?? Infinity))
    .slice(0, topLimit)
    .map((row) => toOverviewLeader(row, resolveName));

  let mostActive: OverviewLeader[] = [...effectiveQuoteRows]
    .filter((row) => row.quote.volume !== null)
    .sort((left, right) => (right.quote.volume ?? -Infinity) - (left.quote.volume ?? -Infinity))
    .slice(0, topLimit)
    .map((row) => toOverviewLeader(row, resolveName));

  _perfT = _perfMark("sync_compute_gainers_losers_active", _perfT);

  const quoteMarketContext = buildMarketContext({
    effectiveItems,
    companies
  });
  _perfT = _perfMark("buildMarketContext", _perfT);
  const shouldLoadDailyMarketContext = quoteMarketContext.state === "EMPTY" || quoteMarketContext.heatmap.length < MARKET_HEATMAP_LIMIT / 2;
  console.log(`[overview-perf] shouldLoadDailyMarketContext=${shouldLoadDailyMarketContext} quoteMarketContext.state=${quoteMarketContext.state} heatmap.length=${quoteMarketContext.heatmap.length}`);
  const dailyMarketContext = shouldLoadDailyMarketContext
    ? await buildDailyBarMarketContext({
      session: input.session,
      companies
    })
    : null;
  _perfT = _perfMark("buildDailyBarMarketContext", _perfT);
  const marketContext = dailyMarketContext && (
    quoteMarketContext.state === "EMPTY" || dailyMarketContext.heatmap.length > quoteMarketContext.heatmap.length
  )
    ? dailyMarketContext
    : quoteMarketContext;

  if (
    topGainers.length === 0 &&
    topLosers.length === 0 &&
    mostActive.length === 0 &&
    marketContext.heatmap.length > 0
  ) {
    const fallbackLeaders = leadersFromHeatmap(marketContext.heatmap, topLimit);
    topGainers = fallbackLeaders.topGainers;
    topLosers = fallbackLeaders.topLosers;
    mostActive = fallbackLeaders.mostActive;
  }

  const latestQuoteTimestamp = quotes
    .map((quote) => quote.timestamp)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  console.log(`[overview-perf] TOTAL=${Math.round(performance.now() - _perfT0)}ms`);

  return {
    generatedAt: new Date().toISOString(),
    policy: getMarketDataPolicy(),
    surface: getMarketDataSurfaceMetadata(),
    providers,
    marketContext,
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
    // _dailyBarRowsCache is keyed by workspaceId (UUID), not slug — clear all on slug reset.
    _dailyBarRowsCache.clear();
    // 2026-07-20: bump generation (now per-source, round 4) so the
    // listCachedProviderQuotes/listCachedProviderQuoteHistory memo can't
    // serve a pre-reset snapshot after the underlying caches above were just
    // wiped.
    for (const source of quoteProviderSources) {
      bumpWorkspaceCacheGeneration(workspaceSlug, source);
    }
    return;
  }

  providerQuoteCache.clear();
  providerQuoteHistoryCache.clear();
  persistedQuoteHistoryLoaded.clear();
  _dailyBarRowsCache.clear();
  workspaceCacheGeneration.clear();
  cachedProviderQuotesMemo.clear();
  cachedProviderQuoteHistoryMemo.clear();
}
