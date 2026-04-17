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

const manualQuoteCache = new Map<string, Map<string, QuoteCacheEntry>>();
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
  let workspaceCache = manualQuoteCache.get(workspaceSlug);
  if (!workspaceCache) {
    workspaceCache = new Map<string, QuoteCacheEntry>();
    manualQuoteCache.set(workspaceSlug, workspaceCache);
  }

  return workspaceCache;
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

const manualProvider: QuoteProviderAdapter = {
  source: "manual",
  async listQuotes(workspaceSlug) {
    const cache = getQuoteCacheForWorkspace(workspaceSlug);
    return [...cache.values()].map(withFreshness);
  },
  async getStatus(workspaceSlug) {
    const quotes = await manualProvider.listQuotes(workspaceSlug);
    const lastMessageAt = quotes
      .map((quote) => quote.timestamp)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;

    return quoteProviderStatusSchema.parse({
      source: "manual",
      connected: true,
      lastMessageAt,
      latencyMs: null,
      subscribedSymbols: [...new Set(quotes.map((quote) => quote.symbol))],
      errorMessage: null
    });
  }
};

function buildStubProvider(
  source: Exclude<QuoteSource, "manual">,
  errorMessage: string
): QuoteProviderAdapter {
  return {
    source,
    async listQuotes() {
      return [];
    },
    async getStatus() {
      return quoteProviderStatusSchema.parse({
        source,
        connected: false,
        lastMessageAt: null,
        latencyMs: null,
        subscribedSymbols: [],
        errorMessage
      });
    }
  };
}

const quoteProviders: Record<QuoteSource, QuoteProviderAdapter> = {
  manual: manualProvider,
  paper: buildStubProvider("paper", "Paper quote stream not configured."),
  tradingview: buildStubProvider("tradingview", "TradingView quote provider not configured."),
  kgi: buildStubProvider("kgi", "KGI quote provider not configured.")
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

