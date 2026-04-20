import { randomUUID } from "node:crypto";
import {
  DEFAULT_RISK_LIMITS,
  type AppSession,
  type EffectiveRiskLimit,
  type KillSwitchInput,
  type KillSwitchState,
  type OrderCreateInput,
  type Quote,
  type QuoteSource,
  type RiskCheckDecision,
  type RiskCheckResult,
  type RiskGuardKind,
  type RiskGuardResult,
  type RiskLimit,
  type RiskLimitLayer,
  type RiskLimitUpsertInput,
  type StrategyRiskLimit,
  type StrategyRiskLimitUpsertInput,
  type SymbolRiskLimit,
  type SymbolRiskLimitUpsertInput,
  marketSchema,
  orderCreateInputSchema,
  quoteSourceSchema
} from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";
import { z } from "zod";

import { listMarketQuotes } from "./market-data.js";

const ORDERS_PER_MINUTE_WINDOW_MS = 60_000;
const DUPLICATE_ORDER_WINDOW_MS = 30_000;
const DEFAULT_ACCOUNT_EQUITY = 1_000_000;
const OVERRIDE_BLOCKED_GUARDS = new Set<RiskGuardKind>([
  "kill_switch",
  "manual_disable",
  "broker_disconnected",
  "symbol_whitelist",
  "symbol_blacklist",
  "duplicate_order",
  "stale_quote",
  "trading_hours"
]);
const EXECUTION_ROLES = new Set(["Owner", "Admin", "Trader"]);

type RecentOrderIntent = {
  symbol: string;
  side: OrderCreateInput["side"];
  type: OrderCreateInput["type"];
  quantity: number;
  price: number | null;
  stopPrice: number | null;
  createdAt: string;
};

const riskLimitsStore = new Map<string, RiskLimit>();
const killSwitchStore = new Map<string, KillSwitchState>();
const recentOrderIntentStore = new Map<string, RecentOrderIntent[]>();
// Strategy/symbol overrides are keyed by (workspaceSlug, accountId, id).
// Scoping per workspace keeps one tenant's caps from bleeding into another
// when the in-memory store is shared across tests / routes.
const strategyRiskLimitsStore = new Map<string, StrategyRiskLimit>();
const symbolRiskLimitsStore = new Map<string, SymbolRiskLimit>();

const inlineQuoteSchema = z.object({
  symbol: z.string().optional(),
  market: marketSchema.optional(),
  source: quoteSourceSchema.optional(),
  last: z.number().nullable().optional(),
  bid: z.number().nullable().optional(),
  ask: z.number().nullable().optional(),
  timestamp: z.string().optional(),
  ageMs: z.number().int().nonnegative().optional(),
  isStale: z.boolean().optional()
});

export const riskAccountQuerySchema = z.object({
  accountId: z.string().min(1)
});

export const riskCheckAccountContextSchema = z
  .object({
    equity: z.number().positive().default(DEFAULT_ACCOUNT_EQUITY),
    availableCash: z.number().nonnegative().default(DEFAULT_ACCOUNT_EQUITY),
    realizedPnlTodayPct: z.number().default(0),
    openOrders: z.number().int().nonnegative().default(0),
    grossExposurePct: z.number().min(0).max(1000).default(0),
    symbolPositionPct: z.number().min(0).max(1000).default(0),
    themeExposurePct: z.number().min(0).max(1000).default(0),
    brokerConnected: z.boolean().default(true)
  })
  .default({
    equity: DEFAULT_ACCOUNT_EQUITY,
    availableCash: DEFAULT_ACCOUNT_EQUITY,
    realizedPnlTodayPct: 0,
    openOrders: 0,
    grossExposurePct: 0,
    symbolPositionPct: 0,
    themeExposurePct: 0,
    brokerConnected: true
  });

export const riskCheckMarketContextSchema = z
  .object({
    source: quoteSourceSchema.default("manual"),
    quote: inlineQuoteSchema.optional(),
    now: z.string().optional(),
    timeZone: z.string().default("Asia/Taipei")
  })
  .default({
    source: "manual",
    timeZone: "Asia/Taipei"
  });

export const riskCheckInputSchema = z.object({
  order: orderCreateInputSchema,
  account: riskCheckAccountContextSchema.optional(),
  market: riskCheckMarketContextSchema.optional(),
  commit: z.boolean().default(false)
});

type RiskCheckAccountContext = z.infer<typeof riskCheckAccountContextSchema>;
type RiskCheckMarketContext = z.infer<typeof riskCheckMarketContextSchema>;

function buildAccountKey(session: AppSession, accountId: string) {
  return `${session.workspace.slug}:${accountId}`;
}

function defaultRiskLimit(accountId: string): RiskLimit {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    accountId,
    maxPerTradePct: DEFAULT_RISK_LIMITS.maxPerTradePct,
    maxDailyLossPct: DEFAULT_RISK_LIMITS.maxDailyLossPct,
    maxSinglePositionPct: DEFAULT_RISK_LIMITS.maxSinglePositionPct,
    maxThemeCorrelatedPct: DEFAULT_RISK_LIMITS.maxThemeCorrelatedPct,
    maxGrossExposurePct: DEFAULT_RISK_LIMITS.maxGrossExposurePct,
    maxOpenOrders: DEFAULT_RISK_LIMITS.maxOpenOrders,
    maxOrdersPerMinute: DEFAULT_RISK_LIMITS.maxOrdersPerMinute,
    staleQuoteMs: DEFAULT_RISK_LIMITS.staleQuoteMs,
    tradingHoursStart: DEFAULT_RISK_LIMITS.tradingHoursStart,
    tradingHoursEnd: DEFAULT_RISK_LIMITS.tradingHoursEnd,
    symbolWhitelist: [],
    symbolBlacklist: [],
    whitelistOnly: false,
    createdAt: now,
    updatedAt: now
  };
}

function defaultKillSwitch(accountId: string): KillSwitchState {
  return {
    accountId,
    mode: "trading",
    engaged: false,
    engagedBy: null,
    engagedAt: null,
    reason: "",
    autoTriggerReason: null,
    updatedAt: new Date().toISOString()
  };
}

function normalizeQuote(
  input: z.infer<typeof inlineQuoteSchema> | Quote | undefined,
  order: OrderCreateInput,
  source: QuoteSource,
  fallbackTimestamp: string
): Quote | null {
  if (!input) {
    return null;
  }

  return {
    symbol: input.symbol ?? order.symbol,
    market: "market" in input && input.market ? input.market : "OTHER",
    source: input.source ?? source,
    last: input.last ?? null,
    bid: input.bid ?? null,
    ask: input.ask ?? null,
    open: "open" in input ? (input.open ?? null) : null,
    high: "high" in input ? (input.high ?? null) : null,
    low: "low" in input ? (input.low ?? null) : null,
    prevClose: "prevClose" in input ? (input.prevClose ?? null) : null,
    volume: "volume" in input ? (input.volume ?? null) : null,
    changePct: "changePct" in input ? (input.changePct ?? null) : null,
    timestamp: input.timestamp ?? fallbackTimestamp,
    ageMs: input.ageMs ?? 0,
    isStale: input.isStale ?? false
  };
}

function getMinutesSinceMidnight(value: string) {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }

  return hour * 60 + minute;
}

function getZonedMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function isWithinTradingHours(date: Date, timeZone: string, start: string, end: string) {
  const currentMinutes = getZonedMinutes(date, timeZone);
  const startMinutes = getMinutesSinceMidnight(start);
  const endMinutes = getMinutesSinceMidnight(end);

  if (endMinutes >= startMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

function cleanRecentIntents(session: AppSession, accountId: string, nowMs: number) {
  const key = buildAccountKey(session, accountId);
  const intents = recentOrderIntentStore.get(key) ?? [];
  const retained = intents.filter((intent) => nowMs - Date.parse(intent.createdAt) <= 24 * 60 * 60 * 1000);
  recentOrderIntentStore.set(key, retained);
  return retained;
}

function countOrdersLastMinute(session: AppSession, accountId: string, nowMs: number) {
  return cleanRecentIntents(session, accountId, nowMs).filter(
    (intent) => nowMs - Date.parse(intent.createdAt) <= ORDERS_PER_MINUTE_WINDOW_MS
  ).length;
}

function hasDuplicateIntent(
  session: AppSession,
  order: OrderCreateInput,
  nowMs: number
) {
  return cleanRecentIntents(session, order.accountId, nowMs).some((intent) => {
    if (nowMs - Date.parse(intent.createdAt) > DUPLICATE_ORDER_WINDOW_MS) {
      return false;
    }

    return (
      intent.symbol === order.symbol &&
      intent.side === order.side &&
      intent.type === order.type &&
      intent.quantity === order.quantity &&
      intent.price === (order.price ?? null) &&
      intent.stopPrice === (order.stopPrice ?? null)
    );
  });
}

function recordOrderIntent(session: AppSession, order: OrderCreateInput, createdAt: string) {
  const key = buildAccountKey(session, order.accountId);
  const intents = recentOrderIntentStore.get(key) ?? [];
  intents.unshift({
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    quantity: order.quantity,
    price: order.price ?? null,
    stopPrice: order.stopPrice ?? null,
    createdAt
  });
  recentOrderIntentStore.set(
    key,
    intents.filter((intent) => Date.parse(createdAt) - Date.parse(intent.createdAt) <= 24 * 60 * 60 * 1000)
  );
}

function resolveReferencePrice(order: OrderCreateInput, quote: Quote | null) {
  if (order.price) {
    return order.price;
  }
  if (order.stopPrice) {
    return order.stopPrice;
  }
  if (!quote) {
    return null;
  }
  if (order.side === "buy") {
    return quote.ask ?? quote.last ?? quote.bid;
  }
  return quote.bid ?? quote.last ?? quote.ask;
}

function applyGuardOverrides(
  order: OrderCreateInput,
  guards: RiskGuardResult[]
): { guards: RiskGuardResult[]; overridden: boolean } {
  const requested = new Set(order.overrideGuards as RiskGuardKind[]);
  const canOverride = order.overrideReason.trim().length > 0;

  let overridden = false;
  const normalized = guards.map((guard) => {
    if (!requested.has(guard.guard) || OVERRIDE_BLOCKED_GUARDS.has(guard.guard) || !canOverride) {
      return guard;
    }

    overridden = true;
    return {
      ...guard,
      decision: "warn" as const,
      message: `${guard.message} (override requested)`
    };
  });

  return { guards: normalized, overridden };
}

function buildSummary(guards: RiskGuardResult[]) {
  const blocked = guards.filter((guard) => guard.decision === "block");
  const warned = guards.filter((guard) => guard.decision === "warn");

  if (blocked.length > 0) {
    return `Blocked by ${blocked.map((guard) => guard.guard).join(", ")}.`;
  }

  if (warned.length > 0) {
    return `Allowed with warnings: ${warned.map((guard) => guard.guard).join(", ")}.`;
  }

  return "Risk checks passed.";
}

async function resolveCompanyThemeMeta(
  repo: TradingRoomRepository,
  session: AppSession,
  symbol: string
) {
  const companies = await repo.listCompanies(undefined, {
    workspaceSlug: session.workspace.slug
  });
  const company = companies.find((item) => item.ticker.toUpperCase() === symbol.toUpperCase()) ?? null;
  return {
    companyId: company?.id ?? null,
    themeIds: company?.themeIds ?? []
  };
}

async function resolveQuoteForRiskCheck(input: {
  session: AppSession;
  order: OrderCreateInput;
  market: RiskCheckMarketContext;
  nowIso: string;
}) {
  const inline = normalizeQuote(input.market.quote, input.order, input.market.source, input.nowIso);
  if (inline) {
    return inline;
  }

  const [quote] = await listMarketQuotes({
    session: input.session,
    symbols: input.order.symbol,
    source: input.market.source,
    includeStale: true,
    limit: 1
  });

  return quote ?? null;
}

export async function getRiskLimitState(input: {
  session: AppSession;
  accountId: string;
}) {
  const key = buildAccountKey(input.session, input.accountId);
  const existing = riskLimitsStore.get(key);
  if (existing) {
    return existing;
  }

  const created = defaultRiskLimit(input.accountId);
  riskLimitsStore.set(key, created);
  return created;
}

// 4-layer resolver: account → strategy → symbol → session override.
// The layers store only the fields they want to override; a `null` on a
// numeric override means "no opinion, fall through" — it does NOT force 0.
type RiskLimitOverrideLayer = Partial<
  Omit<RiskLimit, "id" | "accountId" | "createdAt" | "updatedAt">
>;

function strategyKey(session: AppSession, accountId: string, strategyId: string) {
  return `${session.workspace.slug}:${accountId}:${strategyId}`;
}

function symbolKey(session: AppSession, accountId: string, symbol: string) {
  return `${session.workspace.slug}:${accountId}:${symbol.toUpperCase()}`;
}

// Translate a strategy or symbol override row into a shallow patch suitable
// for the resolver's object spread. Disabled rows contribute nothing so they
// can be toggled off without losing the stored values.
function strategyOverridesAsPatch(
  row: StrategyRiskLimit | null
): RiskLimitOverrideLayer {
  if (!row || !row.enabled) return {};
  const patch: RiskLimitOverrideLayer = {};
  if (row.maxPerTradePct !== null) patch.maxPerTradePct = row.maxPerTradePct;
  if (row.maxSinglePositionPct !== null)
    patch.maxSinglePositionPct = row.maxSinglePositionPct;
  if (row.maxThemeCorrelatedPct !== null)
    patch.maxThemeCorrelatedPct = row.maxThemeCorrelatedPct;
  if (row.maxGrossExposurePct !== null)
    patch.maxGrossExposurePct = row.maxGrossExposurePct;
  if (row.maxOpenOrders !== null) patch.maxOpenOrders = row.maxOpenOrders;
  if (row.maxOrdersPerMinute !== null)
    patch.maxOrdersPerMinute = row.maxOrdersPerMinute;
  if (row.symbolWhitelist !== null) patch.symbolWhitelist = row.symbolWhitelist;
  if (row.symbolBlacklist !== null) patch.symbolBlacklist = row.symbolBlacklist;
  if (row.whitelistOnly !== null) patch.whitelistOnly = row.whitelistOnly;
  return patch;
}

function symbolOverridesAsPatch(
  row: SymbolRiskLimit | null
): RiskLimitOverrideLayer {
  if (!row || !row.enabled) return {};
  const patch: RiskLimitOverrideLayer = {};
  if (row.maxPerTradePct !== null) patch.maxPerTradePct = row.maxPerTradePct;
  if (row.maxSinglePositionPct !== null)
    patch.maxSinglePositionPct = row.maxSinglePositionPct;
  return patch;
}

async function resolveStrategyLayer(input: {
  session: AppSession;
  accountId: string;
  strategyId: string;
}): Promise<StrategyRiskLimit | null> {
  return (
    strategyRiskLimitsStore.get(
      strategyKey(input.session, input.accountId, input.strategyId)
    ) ?? null
  );
}

async function resolveSymbolLayer(input: {
  session: AppSession;
  accountId: string;
  symbol: string;
}): Promise<SymbolRiskLimit | null> {
  return (
    symbolRiskLimitsStore.get(
      symbolKey(input.session, input.accountId, input.symbol)
    ) ?? null
  );
}

// Resolve effective limits + annotate which layer contributed each field.
// The sources map is what lets the UI and guards explain *why* a cap is
// what it is ("0.5% ← strategy" vs "15% ← account default").
export async function resolveRiskLimit(input: {
  session: AppSession;
  accountId: string;
  strategyId?: string | null;
  symbol?: string | null;
  sessionOverride?: RiskLimitOverrideLayer;
}): Promise<EffectiveRiskLimit> {
  const base = await getRiskLimitState({
    session: input.session,
    accountId: input.accountId
  });
  const strategyRow = input.strategyId
    ? await resolveStrategyLayer({
        session: input.session,
        accountId: input.accountId,
        strategyId: input.strategyId
      })
    : null;
  const symbolRow = input.symbol
    ? await resolveSymbolLayer({
        session: input.session,
        accountId: input.accountId,
        symbol: input.symbol
      })
    : null;
  const strategyPatch = strategyOverridesAsPatch(strategyRow);
  const symbolPatch = symbolOverridesAsPatch(symbolRow);
  const sessionPatch = input.sessionOverride ?? {};

  const merged: RiskLimit = {
    ...base,
    ...strategyPatch,
    ...symbolPatch,
    ...sessionPatch,
    id: base.id,
    accountId: base.accountId,
    createdAt: base.createdAt,
    updatedAt: new Date().toISOString()
  };

  // Attribute every top-level field to the highest-priority layer that set
  // it. Iterate in layer order (account → strategy → symbol → session) so
  // the last writer wins naturally.
  const sources: Record<string, RiskLimitLayer> = {};
  for (const key of Object.keys(base) as (keyof RiskLimit)[]) {
    sources[key] = "account";
  }
  for (const key of Object.keys(strategyPatch)) sources[key] = "strategy";
  for (const key of Object.keys(symbolPatch)) sources[key] = "symbol";
  for (const key of Object.keys(sessionPatch)) sources[key] = "session";

  return {
    limit: merged,
    sources,
    layers: {
      account: base,
      strategy: strategyRow,
      symbol: symbolRow
    }
  };
}

// ── Strategy layer CRUD ────────────────────────────────────────────────

export async function listStrategyRiskLimits(input: {
  session: AppSession;
  accountId: string;
}): Promise<StrategyRiskLimit[]> {
  const prefix = `${input.session.workspace.slug}:${input.accountId}:`;
  const rows: StrategyRiskLimit[] = [];
  for (const [key, value] of strategyRiskLimitsStore) {
    if (key.startsWith(prefix)) rows.push(value);
  }
  // Stable ordering keeps the UI list from shuffling on every refresh.
  return rows.sort((a, b) => a.strategyId.localeCompare(b.strategyId));
}

export async function getStrategyRiskLimit(input: {
  session: AppSession;
  accountId: string;
  strategyId: string;
}): Promise<StrategyRiskLimit | null> {
  return (
    strategyRiskLimitsStore.get(
      strategyKey(input.session, input.accountId, input.strategyId)
    ) ?? null
  );
}

export async function upsertStrategyRiskLimit(input: {
  session: AppSession;
  payload: StrategyRiskLimitUpsertInput;
}): Promise<StrategyRiskLimit> {
  const key = strategyKey(
    input.session,
    input.payload.accountId,
    input.payload.strategyId
  );
  const now = new Date().toISOString();
  const existing = strategyRiskLimitsStore.get(key);
  const next: StrategyRiskLimit = {
    id: existing?.id ?? randomUUID(),
    accountId: input.payload.accountId,
    strategyId: input.payload.strategyId,
    enabled: input.payload.enabled ?? existing?.enabled ?? true,
    maxPerTradePct:
      input.payload.maxPerTradePct ?? existing?.maxPerTradePct ?? null,
    maxSinglePositionPct:
      input.payload.maxSinglePositionPct ??
      existing?.maxSinglePositionPct ??
      null,
    maxThemeCorrelatedPct:
      input.payload.maxThemeCorrelatedPct ??
      existing?.maxThemeCorrelatedPct ??
      null,
    maxGrossExposurePct:
      input.payload.maxGrossExposurePct ??
      existing?.maxGrossExposurePct ??
      null,
    maxOpenOrders:
      input.payload.maxOpenOrders ?? existing?.maxOpenOrders ?? null,
    maxOrdersPerMinute:
      input.payload.maxOrdersPerMinute ??
      existing?.maxOrdersPerMinute ??
      null,
    symbolWhitelist:
      input.payload.symbolWhitelist ?? existing?.symbolWhitelist ?? null,
    symbolBlacklist:
      input.payload.symbolBlacklist ?? existing?.symbolBlacklist ?? null,
    whitelistOnly:
      input.payload.whitelistOnly ?? existing?.whitelistOnly ?? null,
    notes: input.payload.notes ?? existing?.notes ?? "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  strategyRiskLimitsStore.set(key, next);
  return next;
}

export async function deleteStrategyRiskLimit(input: {
  session: AppSession;
  accountId: string;
  strategyId: string;
}): Promise<boolean> {
  return strategyRiskLimitsStore.delete(
    strategyKey(input.session, input.accountId, input.strategyId)
  );
}

// ── Symbol layer CRUD ──────────────────────────────────────────────────

export async function listSymbolRiskLimits(input: {
  session: AppSession;
  accountId: string;
}): Promise<SymbolRiskLimit[]> {
  const prefix = `${input.session.workspace.slug}:${input.accountId}:`;
  const rows: SymbolRiskLimit[] = [];
  for (const [key, value] of symbolRiskLimitsStore) {
    if (key.startsWith(prefix)) rows.push(value);
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function getSymbolRiskLimit(input: {
  session: AppSession;
  accountId: string;
  symbol: string;
}): Promise<SymbolRiskLimit | null> {
  return (
    symbolRiskLimitsStore.get(
      symbolKey(input.session, input.accountId, input.symbol)
    ) ?? null
  );
}

export async function upsertSymbolRiskLimit(input: {
  session: AppSession;
  payload: SymbolRiskLimitUpsertInput;
}): Promise<SymbolRiskLimit> {
  const normalizedSymbol = input.payload.symbol.toUpperCase();
  const key = symbolKey(
    input.session,
    input.payload.accountId,
    normalizedSymbol
  );
  const now = new Date().toISOString();
  const existing = symbolRiskLimitsStore.get(key);
  const next: SymbolRiskLimit = {
    id: existing?.id ?? randomUUID(),
    accountId: input.payload.accountId,
    symbol: normalizedSymbol,
    enabled: input.payload.enabled ?? existing?.enabled ?? true,
    maxPerTradePct:
      input.payload.maxPerTradePct ?? existing?.maxPerTradePct ?? null,
    maxSinglePositionPct:
      input.payload.maxSinglePositionPct ??
      existing?.maxSinglePositionPct ??
      null,
    notes: input.payload.notes ?? existing?.notes ?? "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  symbolRiskLimitsStore.set(key, next);
  return next;
}

export async function deleteSymbolRiskLimit(input: {
  session: AppSession;
  accountId: string;
  symbol: string;
}): Promise<boolean> {
  return symbolRiskLimitsStore.delete(
    symbolKey(input.session, input.accountId, input.symbol)
  );
}

export async function upsertRiskLimitState(input: {
  session: AppSession;
  payload: RiskLimitUpsertInput;
}) {
  const current = await getRiskLimitState({
    session: input.session,
    accountId: input.payload.accountId
  });
  const next: RiskLimit = {
    ...current,
    ...input.payload,
    accountId: input.payload.accountId,
    updatedAt: new Date().toISOString()
  };
  riskLimitsStore.set(buildAccountKey(input.session, input.payload.accountId), next);
  return next;
}

export async function getKillSwitchState(input: {
  session: AppSession;
  accountId: string;
}) {
  const key = buildAccountKey(input.session, input.accountId);
  const existing = killSwitchStore.get(key);
  if (existing) {
    return existing;
  }

  const created = defaultKillSwitch(input.accountId);
  killSwitchStore.set(key, created);
  return created;
}

export async function setKillSwitchState(input: {
  session: AppSession;
  payload: KillSwitchInput;
}) {
  const engaged = input.payload.mode !== "trading";
  const next: KillSwitchState = {
    accountId: input.payload.accountId,
    mode: input.payload.mode,
    engaged,
    engagedBy: engaged ? input.payload.engagedBy : null,
    engagedAt: engaged ? new Date().toISOString() : null,
    reason: input.payload.reason,
    autoTriggerReason: null,
    updatedAt: new Date().toISOString()
  };

  killSwitchStore.set(buildAccountKey(input.session, input.payload.accountId), next);
  return next;
}

export async function evaluateRiskCheck(input: {
  session: AppSession;
  repo: TradingRoomRepository;
  payload: z.infer<typeof riskCheckInputSchema>;
}): Promise<RiskCheckResult> {
  const order = input.payload.order;
  const account = riskCheckAccountContextSchema.parse(input.payload.account ?? {});
  const market = riskCheckMarketContextSchema.parse(input.payload.market ?? {});
  const nowIso = market.now ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const nowDate = new Date(nowIso);
  // Resolve the effective limits with strategy + symbol overrides merged in.
  // The sources map lets us attribute each guard to the layer that actually
  // set the cap — so a blocked order can tell the user "this was a symbol
  // cap", not just "blocked by max_per_trade".
  const effective = await resolveRiskLimit({
    session: input.session,
    accountId: order.accountId,
    strategyId: order.strategyId ?? null,
    symbol: order.symbol
  });
  const limits = effective.limit;
  const limitSources = effective.sources;
  const sourceFor = (field: keyof RiskLimit): RiskLimitLayer =>
    limitSources[field] ?? "account";
  const killSwitch = await getKillSwitchState({
    session: input.session,
    accountId: order.accountId
  });
  const companyMeta = await resolveCompanyThemeMeta(input.repo, input.session, order.symbol);
  const quote = await resolveQuoteForRiskCheck({
    session: input.session,
    order,
    market,
    nowIso
  });

  const guards: RiskGuardResult[] = [];
  const pushGuard = (
    guard: RiskGuardKind,
    decision: RiskCheckDecision,
    message: string,
    observedValue: number | null = null,
    limitValue: number | null = null,
    sourceLayer: RiskLimitLayer = "account"
  ) => {
    guards.push({
      guard,
      decision,
      message,
      observedValue,
      limitValue,
      sourceLayer
    });
  };

  if (!EXECUTION_ROLES.has(input.session.user.role)) {
    pushGuard(
      "manual_disable",
      "block",
      `Role ${input.session.user.role} is not allowed to submit order intents.`
    );
  }

  if (killSwitch.engaged) {
    if (killSwitch.mode === "halted") {
      pushGuard("kill_switch", "block", `Kill switch engaged: ${killSwitch.reason || "trading halted"}.`);
    } else if (killSwitch.mode === "liquidate_only") {
      if (order.side === "buy") {
        pushGuard(
          "kill_switch",
          "block",
          `Kill switch is in liquidate_only mode; buy orders are blocked.`
        );
      } else {
        pushGuard("kill_switch", "warn", "Kill switch is in liquidate_only mode; sell order allowed.");
      }
    } else if (killSwitch.mode === "paper_only" && !order.accountId.toLowerCase().startsWith("paper")) {
      pushGuard(
        "kill_switch",
        "warn",
        "Kill switch is in paper_only mode; route this order to a paper account before execution."
      );
    }
  }

  if (!account.brokerConnected) {
    pushGuard("broker_disconnected", "block", "Broker connection is unavailable.");
  }

  if (limits.whitelistOnly && limits.symbolWhitelist.length > 0 && !limits.symbolWhitelist.includes(order.symbol)) {
    pushGuard(
      "symbol_whitelist",
      "block",
      `${order.symbol} is not in the account whitelist.`,
      null,
      null,
      sourceFor("symbolWhitelist")
    );
  }

  if (limits.symbolBlacklist.includes(order.symbol)) {
    pushGuard(
      "symbol_blacklist",
      "block",
      `${order.symbol} is blacklisted for this account.`,
      null,
      null,
      sourceFor("symbolBlacklist")
    );
  }

  if (!isWithinTradingHours(nowDate, market.timeZone, limits.tradingHoursStart, limits.tradingHoursEnd)) {
    pushGuard(
      "trading_hours",
      "block",
      `Current time is outside allowed trading hours (${limits.tradingHoursStart}-${limits.tradingHoursEnd} ${market.timeZone}).`,
      null,
      null,
      sourceFor("tradingHoursStart")
    );
  }

  const quoteAgeMs =
    quote?.timestamp
      ? Math.max(0, nowMs - Date.parse(quote.timestamp))
      : quote?.ageMs ?? Number.POSITIVE_INFINITY;
  const quoteIsStale = !quote
    ? true
    : quote.timestamp
      ? quoteAgeMs > limits.staleQuoteMs
      : quote.isStale || quoteAgeMs > limits.staleQuoteMs;
  const orderNeedsLiveQuote = order.type === "market" || (!order.price && !order.stopPrice);
  if (quoteIsStale) {
    pushGuard(
      "stale_quote",
      orderNeedsLiveQuote ? "block" : "warn",
      quote
        ? `Latest quote for ${order.symbol} is stale (${Math.round(quoteAgeMs)}ms old).`
        : `No quote available for ${order.symbol}.`,
      Number.isFinite(quoteAgeMs) ? Math.round(quoteAgeMs) : null,
      limits.staleQuoteMs,
      sourceFor("staleQuoteMs")
    );
  }

  if (account.realizedPnlTodayPct <= -Math.abs(limits.maxDailyLossPct)) {
    pushGuard(
      "max_daily_loss",
      "block",
      `Daily realized PnL is below the allowed threshold.`,
      Math.abs(account.realizedPnlTodayPct),
      limits.maxDailyLossPct,
      sourceFor("maxDailyLossPct")
    );
  }

  if (account.openOrders >= limits.maxOpenOrders) {
    pushGuard(
      "max_open_orders",
      "block",
      `Open order count has reached the configured ceiling.`,
      account.openOrders,
      limits.maxOpenOrders,
      sourceFor("maxOpenOrders")
    );
  }

  const recentOrders = countOrdersLastMinute(input.session, order.accountId, nowMs);
  if (recentOrders >= limits.maxOrdersPerMinute) {
    pushGuard(
      "max_orders_per_minute",
      "block",
      `Orders per minute threshold reached for this account.`,
      recentOrders,
      limits.maxOrdersPerMinute,
      sourceFor("maxOrdersPerMinute")
    );
  }

  if (hasDuplicateIntent(input.session, order, nowMs)) {
    pushGuard("duplicate_order", "block", "An identical order intent was seen recently.");
  }

  const referencePrice = resolveReferencePrice(order, quote);
  const orderNotional = referencePrice ? referencePrice * order.quantity : null;
  const orderPct =
    orderNotional && account.equity > 0 ? (orderNotional / account.equity) * 100 : null;
  const exposureDeltaPct =
    order.side === "buy"
      ? orderPct ?? 0
      : -Math.min(account.symbolPositionPct, orderPct ?? 0);

  if (orderPct !== null && (order.side === "buy" || account.symbolPositionPct <= 0)) {
    if (orderPct > limits.maxPerTradePct) {
      pushGuard(
        "max_per_trade",
        "block",
        "Order size exceeds the per-trade risk budget.",
        Number(orderPct.toFixed(4)),
        limits.maxPerTradePct,
        sourceFor("maxPerTradePct")
      );
    }
  }

  const nextPositionPct = Math.max(0, account.symbolPositionPct + exposureDeltaPct);
  if (nextPositionPct > limits.maxSinglePositionPct) {
    pushGuard(
      "max_single_position",
      "block",
      "Resulting symbol exposure would exceed the single-position limit.",
      Number(nextPositionPct.toFixed(4)),
      limits.maxSinglePositionPct,
      sourceFor("maxSinglePositionPct")
    );
  }

  const nextGrossExposurePct = Math.max(0, account.grossExposurePct + exposureDeltaPct);
  if (nextGrossExposurePct > limits.maxGrossExposurePct) {
    pushGuard(
      "max_gross_exposure",
      "block",
      "Resulting gross exposure would exceed the account limit.",
      Number(nextGrossExposurePct.toFixed(4)),
      limits.maxGrossExposurePct,
      sourceFor("maxGrossExposurePct")
    );
  }

  if (companyMeta.themeIds.length > 0) {
    const nextThemeExposurePct = Math.max(0, account.themeExposurePct + exposureDeltaPct);
    if (nextThemeExposurePct > limits.maxThemeCorrelatedPct) {
      pushGuard(
        "max_theme_correlated",
        "block",
        "Theme-correlated exposure would exceed the configured cap.",
        Number(nextThemeExposurePct.toFixed(4)),
        limits.maxThemeCorrelatedPct,
        sourceFor("maxThemeCorrelatedPct")
      );
    }
  }

  const { guards: normalizedGuards, overridden } = applyGuardOverrides(order, guards);
  const decision: RiskCheckDecision = normalizedGuards.some((guard) => guard.decision === "block")
    ? "block"
    : normalizedGuards.some((guard) => guard.decision === "warn") || overridden
      ? "warn"
      : "allow";

  const result: RiskCheckResult = {
    id: randomUUID(),
    accountId: order.accountId,
    symbol: order.symbol,
    side: order.side,
    quantity: order.quantity,
    decision,
    guards: normalizedGuards,
    summary: buildSummary(normalizedGuards),
    overridden,
    overrideReason: overridden ? order.overrideReason : "",
    createdAt: nowIso
  };

  if (input.payload.commit && decision !== "block") {
    recordOrderIntent(input.session, order, nowIso);
  }

  return result;
}
