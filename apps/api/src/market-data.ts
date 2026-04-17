import {
  type AppSession,
  barIntervalSchema,
  barSchema,
  type Company,
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

type QuoteCacheEntry = Quote & {
  updatedAt: string;
};

type QuoteProviderAdapter = {
  source: QuoteSource;
  listQuotes: (workspaceSlug: string) => Promise<Quote[]>;
  getStatus: (workspaceSlug: string) => Promise<QuoteProviderStatus>;
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

export const marketDataResolveQuerySchema = z.object({
  symbols: z.string().trim().min(1),
  market: marketSchema.optional(),
  includeStale: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const providerQuoteCache = new Map<string, Map<string, QuoteCacheEntry>>();
const providerQuoteHistoryCache = new Map<string, Map<string, QuoteCacheEntry[]>>();
const quoteProviderSources: QuoteSource[] = ["manual", "paper", "tradingview", "kgi"];
const sourcePriority: Record<QuoteSource, number> = {
  kgi: 4,
  tradingview: 3,
  paper: 2,
  manual: 1
};

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

function compareQuotes(left: Quote, right: Quote) {
  if (left.isStale !== right.isStale) {
    return left.isStale ? 1 : -1;
  }

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
      return listCachedProviderQuotes(workspaceSlug, source);
    },
    async getStatus(workspaceSlug) {
      const quotes = await listCachedProviderQuotes(workspaceSlug, source);
      const freshQuotes = quotes.filter((quote) => !quote.isStale);
      const lastMessageAt = quotes[0]?.timestamp ?? null;
      const connected = source === "manual" ? true : freshQuotes.length > 0;

      return quoteProviderStatusSchema.parse({
        source,
        connected,
        lastMessageAt,
        latencyMs: null,
        subscribedSymbols: [...new Set(quotes.map((quote) => quote.symbol))],
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
  const workspaceCache = getQuoteCacheForWorkspace(input.session.workspace.slug);
  const workspaceHistory = getQuoteHistoryCacheForWorkspace(input.session.workspace.slug);
  const upserted: Quote[] = [];

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

    const cacheKey = buildQuoteCacheKey(entry.symbol, entry.market, entry.source);
    workspaceCache.set(cacheKey, entry);

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
    }

    upserted.push(withFreshness(entry));
  }

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

export async function resolveMarketQuotes(input: {
  session: AppSession;
  symbols: string;
  market?: Market;
  includeStale?: boolean;
  limit?: number;
}) {
  const workspaceSlug = input.session.workspace.slug;
  const symbolSet = new Set(
    input.symbols
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );

  const allQuotes = (
    await Promise.all(
      quoteProviderSources.map((source) => quoteProviders[source].listQuotes(workspaceSlug))
    )
  )
    .flat()
    .filter((quote) => !input.market || quote.market === input.market)
    .filter((quote) => symbolSet.size === 0 || symbolSet.has(quote.symbol))
    .filter((quote) => input.includeStale || !quote.isStale);

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
      const candidates = [...quotes].sort(compareQuotes);
      return {
        symbol,
        market,
        preferredSource: candidates[0]?.source ?? null,
        preferredQuote: candidates[0] ?? null,
        candidates
      };
    })
    .sort((left, right) => {
      const leftTimestamp = left.preferredQuote?.timestamp ?? "";
      const rightTimestamp = right.preferredQuote?.timestamp ?? "";
      return rightTimestamp.localeCompare(leftTimestamp) || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, input.limit ?? 100);
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
      bySource: quotesBySource,
      byMarket: quotesByMarket
    },
    leaders: {
      topGainers,
      topLosers,
      mostActive
    }
  };
}
