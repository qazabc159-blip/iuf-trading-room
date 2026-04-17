import {
  type AppSession,
  type Company,
  type Market,
  marketSchema,
  quoteProviderStatusSchema,
  quoteSchema,
  quoteSourceSchema,
  symbolMasterSchema,
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

const providerQuoteCache = new Map<string, Map<string, QuoteCacheEntry>>();
const quoteProviderSources: QuoteSource[] = ["manual", "paper", "tradingview", "kgi"];

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

function listCachedProviderQuotes(workspaceSlug: string, source: QuoteSource) {
  const cache = getQuoteCacheForWorkspace(workspaceSlug);
  return [...cache.values()]
    .filter((entry) => entry.source === source)
    .map(withFreshness)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function buildQuoteCacheKey(symbol: string, market: Market, source: QuoteSource) {
  return `${source}:${market}:${symbol.toUpperCase()}`;
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
        lastMessageAt: null,
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

export async function upsertManualQuotes(input: {
  session: AppSession;
  quotes: z.infer<typeof manualQuoteUpsertItemSchema>[];
}) {
  const workspaceCache = getQuoteCacheForWorkspace(input.session.workspace.slug);
  const upserted: Quote[] = [];

  for (const item of input.quotes) {
    const timestamp = toIso(item.timestamp);
    const entry: QuoteCacheEntry = {
      symbol: item.symbol.trim().toUpperCase(),
      market: item.market,
      source: item.source,
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

    workspaceCache.set(buildQuoteCacheKey(entry.symbol, entry.market, entry.source), entry);
    upserted.push(withFreshness(entry));
  }

  return upserted;
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
    .filter((quote) => input.includeStale || !quote.isStale)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, input.limit ?? 200);

  return quotes;
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
