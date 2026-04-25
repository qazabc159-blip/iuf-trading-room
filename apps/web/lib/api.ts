import type {
  AppSession,
  AutopilotExecuteInput,
  AutopilotExecuteResult,
  Balance,
  CompanyNote,
  ThemeSummary,
  BrokerAccount,
  BrokerConnectionStatus,
  Company,
  CompanyCreateInput,
  CompanyDuplicateReport,
  CompanyGraphSearchResult,
  CompanyGraphStats,
  CompanyGraphView,
  DailyBrief,
  DailyBriefCreateInput,
  ExecutionGateDecision,
  ExecutionGateMode,
  ExecutionQuoteContext,
  ExecutionQuoteGateResult,
  ExecutionEvent,
  KillSwitchInput,
  KillSwitchState,
  MarketDataConsumerItem,
  MarketDataConsumerMode,
  MarketDataConsumerSummary,
  MarketDataDecisionSummary,
  MarketDataDecisionSummaryItem,
  Order,
  OrderCancelInput,
  OrderCreateInput,
  Position,
  Quote,
  QuoteProviderStatus,
  QuoteSource,
  EffectiveRiskLimit,
  RiskCheckResult,
  RiskLimit,
  RiskLimitUpsertInput,
  StrategyRiskLimit,
  StrategyRiskLimitUpsertInput,
  SymbolRiskLimit,
  SymbolRiskLimitUpsertInput,
  ReviewEntry,
  ReviewEntryCreateInput,
  Signal,
  SignalCreateInput,
  StrategyIdeasDecisionFilter,
  StrategyIdeasDecisionMode,
  StrategyIdeasQualityFilter,
  StrategyIdeasSort,
  StrategyIdeasView,
  StrategyRunCreateInput,
  StrategyRunListQuery,
  StrategyRunListSort,
  StrategyRunListView,
  StrategyRunRecord,
  SubmitOrderResult,
  Theme,
  ThemeCreateInput,
  ThemeGraphRankingView,
  ThemeGraphSearchView,
  ThemeGraphStatsView,
  ThemeGraphView,
  TradePlan,
  TradePlanCreateInput
} from "@iuf-trading-room/contracts";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

type Envelope<T> = {
  data: T;
};

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as Envelope<T>;
}

export async function getThemes() {
  return request<Theme[]>("/api/v1/themes");
}

export async function getSession() {
  return request<AppSession>("/api/v1/session");
}

export async function createTheme(input: ThemeCreateInput) {
  return request<Theme>("/api/v1/themes", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getCompanies() {
  return request<Company[]>("/api/v1/companies");
}

export async function createCompany(input: CompanyCreateInput) {
  return request<Company>("/api/v1/companies", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// Signals

export async function getSignals(params?: { themeId?: string; companyId?: string; category?: string }) {
  const query = new URLSearchParams();
  if (params?.themeId) query.set("themeId", params.themeId);
  if (params?.companyId) query.set("companyId", params.companyId);
  if (params?.category) query.set("category", params.category);
  const qs = query.toString();
  return request<Signal[]>(`/api/v1/signals${qs ? `?${qs}` : ""}`);
}

export async function createSignal(input: SignalCreateInput) {
  return request<Signal>("/api/v1/signals", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// Trade Plans

export async function getPlans(params?: { companyId?: string; status?: string }) {
  const query = new URLSearchParams();
  if (params?.companyId) query.set("companyId", params.companyId);
  if (params?.status) query.set("status", params.status);
  const qs = query.toString();
  return request<TradePlan[]>(`/api/v1/plans${qs ? `?${qs}` : ""}`);
}

export async function createPlan(input: TradePlanCreateInput) {
  return request<TradePlan>("/api/v1/plans", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// Reviews

export async function getReviews(params?: { tradePlanId?: string }) {
  const query = new URLSearchParams();
  if (params?.tradePlanId) query.set("tradePlanId", params.tradePlanId);
  const qs = query.toString();
  return request<ReviewEntry[]>(`/api/v1/reviews${qs ? `?${qs}` : ""}`);
}

export async function createReview(input: ReviewEntryCreateInput) {
  return request<ReviewEntry>("/api/v1/reviews", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// Daily Briefs

export async function getBriefs() {
  return request<DailyBrief[]>("/api/v1/briefs");
}

export async function createBrief(input: DailyBriefCreateInput) {
  return request<DailyBrief>("/api/v1/briefs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// OpenAlice Jobs (Draft Review Queue)

export type OpenAliceJobEntry = {
  id: string;
  workspaceSlug: string;
  deviceId?: string;
  status: string;
  taskType: string;
  instructions: string;
  contextRefs: Array<{ type: string; id?: string; path?: string; url?: string }>;
  result?: {
    jobId: string;
    status: string;
    schemaName: string;
    structured?: unknown;
    rawText?: string;
    warnings?: string[];
    artifacts?: Array<{ label: string; path?: string; mimeType?: string }>;
  };
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  attemptCount?: number;
  maxAttempts?: number;
  error?: string;
};

export async function getOpenAliceJobs() {
  return request<OpenAliceJobEntry[]>("/api/v1/openalice/jobs");
}

export async function reviewOpenAliceJob(
  jobId: string,
  status: "published" | "rejected",
  note?: string
) {
  return request<{ id: string; workspaceSlug: string; status: string; reviewedAt: string; reviewNote?: string }>(
    `/api/v1/openalice/jobs/${jobId}/review`,
    {
      method: "PATCH",
      body: JSON.stringify({ status, note: note || undefined })
    }
  );
}

// OpenAlice Observability + Devices

export type OpenAliceObservability = {
  source: "redis" | "bridge_fallback";
  workerStatus: "healthy" | "stale" | "missing";
  sweepStatus: "healthy" | "stale" | "missing";
  workerHeartbeatAt: string | null;
  workerHeartbeatAgeSeconds: number | null;
  lastSweepAt: string | null;
  lastSweepAgeSeconds: number | null;
  metrics: {
    mode: "memory" | "database";
    queuedJobs: number;
    runningJobs: number;
    staleRunningJobs: number;
    terminalJobs: number;
    activeDevices: number;
    staleDevices: number;
    expiredJobsRequeued: number;
    expiredJobsFailed: number;
  };
};

export type OpenAliceDevice = {
  deviceId: string;
  deviceName: string;
  workspaceSlug: string;
  capabilities: string[];
  status: "active" | "revoked";
  registeredAt: string;
  lastSeenAt: string;
  stale: boolean;
};

export async function getOpenAliceObservability() {
  return request<OpenAliceObservability>("/api/v1/openalice/observability");
}

export async function getOpenAliceDevices() {
  return request<OpenAliceDevice[]>("/api/v1/openalice/devices");
}

// Ops Snapshot (全站戰情總覽)

export type OpsSnapshotData = {
  generatedAt: string;
  workspace: { id: string; name: string; slug: string };
  stats: {
    themes: number;
    companies: number;
    signals: number;
    plans: number;
    reviews: number;
    briefs: number;
    coreCompanies: number;
    directCompanies: number;
    activePlans: number;
    reviewQueue: number;
    publishedBriefs: number;
    bullishSignals: number;
  };
  openAlice: {
    observability: OpenAliceObservability;
    queue: {
      totalJobs: number;
      queued: number;
      running: number;
      reviewable: number;
      failed: number;
    };
  };
  audit: {
    windowHours: number;
    total: number;
    latestCreatedAt: string | null;
    actions: Array<{ action: string; count: number }>;
    entities: Array<{ entityType: string; count: number }>;
    recent: Array<{
      id: string;
      action: string;
      entityType: string;
      entityId: string;
      payload: Record<string, unknown>;
      createdAt: string;
    }>;
  };
  latest: {
    themes: Array<{ id: string; label: string; subtitle?: string; timestamp: string }>;
    companies: Array<{ id: string; label: string; subtitle?: string; timestamp: string }>;
    signals: Array<{ id: string; label: string; subtitle?: string; timestamp: string }>;
    plans: Array<{ id: string; label: string; subtitle?: string; timestamp: string }>;
    reviews: Array<{ id: string; label: string; subtitle?: string; timestamp: string }>;
    briefs: Array<{ id: string; label: string; subtitle?: string; timestamp: string }>;
  };
};

export async function getOpsSnapshot(params?: { auditHours?: number; recentLimit?: number }) {
  const query = new URLSearchParams();
  if (params?.auditHours) query.set("auditHours", String(params.auditHours));
  if (params?.recentLimit) query.set("recentLimit", String(params.recentLimit));
  const qs = query.toString();
  return request<OpsSnapshotData>(`/api/v1/ops/snapshot${qs ? `?${qs}` : ""}`);
}

// Event History (時間軸)

export type EventHistoryItem = {
  id: string;
  source: string;
  action: string;
  entityType: string;
  entityId: string;
  title: string;
  subtitle?: string;
  status?: string;
  severity: "info" | "success" | "warning" | "danger";
  createdAt: string;
  href?: string;
  tags: string[];
};

export async function getEventHistory(params?: {
  hours?: number;
  limit?: number;
  sources?: string;
  entityType?: string;
  search?: string;
}) {
  const query = new URLSearchParams();
  if (params?.hours) query.set("hours", String(params.hours));
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.sources) query.set("sources", params.sources);
  if (params?.entityType) query.set("entityType", params.entityType);
  if (params?.search) query.set("search", params.search);
  const qs = query.toString();
  return request<EventHistoryItem[]>(`/api/v1/event-history${qs ? `?${qs}` : ""}`);
}

// Audit Logs (稽核紀錄)

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  method?: string;
  path?: string;
  status?: number;
  role?: string;
  workspace?: string;
};

export type AuditSummary = {
  windowHours: number;
  total: number;
  latestCreatedAt: string | null;
  actions: Array<{ action: string; count: number }>;
  entities: Array<{ entityType: string; count: number }>;
  recent: AuditEntry[];
};

export async function getAuditLogSummary(params?: {
  hours?: number;
  action?: string;
  entityType?: string;
  search?: string;
}) {
  const query = new URLSearchParams();
  if (params?.hours) query.set("hours", String(params.hours));
  if (params?.action) query.set("action", params.action);
  if (params?.entityType) query.set("entityType", params.entityType);
  if (params?.search) query.set("search", params.search);
  const qs = query.toString();
  return request<AuditSummary>(`/api/v1/audit-logs/summary${qs ? `?${qs}` : ""}`);
}

export async function getAuditLogs(params?: {
  limit?: number;
  action?: string;
  entityType?: string;
  search?: string;
  from?: string;
  to?: string;
}) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.action) query.set("action", params.action);
  if (params?.entityType) query.set("entityType", params.entityType);
  if (params?.search) query.set("search", params.search);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const qs = query.toString();
  return request<AuditEntry[]>(`/api/v1/audit-logs${qs ? `?${qs}` : ""}`);
}

export function getAuditLogsExportUrl(params?: { format?: "csv" | "json"; action?: string; entityType?: string }) {
  const query = new URLSearchParams();
  query.set("format", params?.format ?? "csv");
  if (params?.action) query.set("action", params.action);
  if (params?.entityType) query.set("entityType", params.entityType);
  return `${API_BASE}/api/v1/audit-logs/export?${query.toString()}`;
}

// ── Theme Graph（主題關係圖）────────────────────────────────

export async function getThemeGraphStats(params?: { limit?: number }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<ThemeGraphStatsView>(`/api/v1/theme-graph/stats${qs ? `?${qs}` : ""}`);
}

export async function getThemeGraphRankings(params?: { limit?: number }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<ThemeGraphRankingView>(`/api/v1/theme-graph/rankings${qs ? `?${qs}` : ""}`);
}

export async function searchThemeGraph(params: { query: string; limit?: number }) {
  const query = new URLSearchParams();
  query.set("query", params.query);
  if (params.limit) query.set("limit", String(params.limit));
  return request<ThemeGraphSearchView>(`/api/v1/theme-graph/search?${query.toString()}`);
}

export async function getThemeGraph(themeId: string, params?: { maxEdges?: number }) {
  const query = new URLSearchParams();
  if (params?.maxEdges) query.set("maxEdges", String(params.maxEdges));
  const qs = query.toString();
  return request<ThemeGraphView>(`/api/v1/themes/${themeId}/graph${qs ? `?${qs}` : ""}`);
}

// ── Company Graph（公司關係圖）──────────────────────────────

export async function getCompanyGraphStats() {
  return request<CompanyGraphStats>("/api/v1/company-graph/stats");
}

export async function searchCompanyGraph(params: { query: string; limit?: number }) {
  const query = new URLSearchParams();
  query.set("query", params.query);
  if (params.limit) query.set("limit", String(params.limit));
  return request<CompanyGraphSearchResult[]>(`/api/v1/company-graph/search?${query.toString()}`);
}

export async function getCompanyGraph(companyId: string) {
  return request<CompanyGraphView>(`/api/v1/companies/${companyId}/graph`);
}

export async function getCompanyDuplicates(params?: { limit?: number }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<CompanyDuplicateReport>(`/api/v1/companies/duplicates${qs ? `?${qs}` : ""}`);
}

// ── Ops Trends（活動趨勢）─────────────────────────────────

export type OpsTrendCounts = {
  themesCreated: number;
  signalsCreated: number;
  bullishSignals: number;
  plansCreated: number;
  reviewsCreated: number;
  briefsCreated: number;
  publishedBriefs: number;
  openAliceJobsCreated: number;
  auditEvents: number;
};

export type OpsTrendPoint = {
  date: string;
  label: string;
  counts: OpsTrendCounts;
  totalActivity: number;
};

export type OpsTrendSummary = {
  days: number;
  timeZone: string;
  range: { from: string; to: string };
  totals: OpsTrendCounts;
  busiestDay: { date: string; totalActivity: number } | null;
  latestDay: OpsTrendPoint | null;
};

export type OpsTrendView = {
  summary: OpsTrendSummary;
  series: OpsTrendPoint[];
};

export async function getOpsTrends(params?: { days?: number; timeZone?: string }) {
  const query = new URLSearchParams();
  if (params?.days) query.set("days", String(params.days));
  if (params?.timeZone) query.set("timeZone", params.timeZone);
  const qs = query.toString();
  return request<OpsTrendView>(`/api/v1/ops/trends${qs ? `?${qs}` : ""}`);
}

// ── Trading (paper broker) ──

export async function getTradingAccounts() {
  return request<BrokerAccount[]>("/api/v1/trading/accounts");
}

export async function getTradingBalance(accountId: string) {
  return request<Balance>(`/api/v1/trading/balance?accountId=${encodeURIComponent(accountId)}`);
}

export async function getTradingPositions(accountId: string) {
  return request<Position[]>(`/api/v1/trading/positions?accountId=${encodeURIComponent(accountId)}`);
}

export async function getTradingOrders(params?: {
  accountId?: string;
  status?: string;
  symbol?: string;
}) {
  const query = new URLSearchParams();
  if (params?.accountId) query.set("accountId", params.accountId);
  if (params?.status) query.set("status", params.status);
  if (params?.symbol) query.set("symbol", params.symbol);
  const qs = query.toString();
  return request<Order[]>(`/api/v1/trading/orders${qs ? `?${qs}` : ""}`);
}

// The API response shape for trading/orders and trading/orders/preview is
// the formal SubmitOrderResult contract; re-export here so page components
// don't need to reach into @iuf-trading-room/contracts for this one shape.
export type TradingOrderResult = SubmitOrderResult;
export type {
  ExecutionGateDecision,
  ExecutionGateMode,
  ExecutionQuoteContext,
  ExecutionQuoteGateResult
};

// 422 is a semantically meaningful response here — the body carries the
// blocking RiskCheckResult — so don't treat it as a thrown error.
async function requestOrderOutcome(path: string, body: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG
    },
    body: JSON.stringify(body)
  });
  if (response.status !== 201 && response.status !== 200 && response.status !== 422) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return (await response.json()) as Envelope<TradingOrderResult>;
}

export async function submitTradingOrder(input: OrderCreateInput) {
  return requestOrderOutcome("/api/v1/trading/orders", input);
}

export async function previewTradingOrder(input: OrderCreateInput) {
  return requestOrderOutcome("/api/v1/trading/orders/preview", input);
}

export async function getExecutionEvents(params?: {
  accountId?: string;
  orderId?: string;
  limit?: number;
  before?: string;
  after?: string;
}) {
  const query = new URLSearchParams();
  if (params?.accountId) query.set("accountId", params.accountId);
  if (params?.orderId) query.set("orderId", params.orderId);
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.before) query.set("before", params.before);
  if (params?.after) query.set("after", params.after);
  const qs = query.toString();
  return request<ExecutionEvent[]>(`/api/v1/trading/events${qs ? `?${qs}` : ""}`);
}

// Fetch-based SSE reader. EventSource can't set custom headers in the browser,
// so we parse the stream ourselves using the same x-workspace-slug contract as
// the rest of the client.
export async function streamExecutionEvents(
  onEvent: (event: ExecutionEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/trading/stream`, {
    credentials: "include",
    headers: { "x-workspace-slug": WORKSPACE_SLUG },
    signal
  });
  if (!response.ok || !response.body) {
    throw new Error(`Stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        if (!frame || frame.startsWith(":")) continue;

        let eventName = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data += line.slice(5).trimStart();
          }
        }

        if (eventName === "execution" && data) {
          try {
            onEvent(JSON.parse(data) as ExecutionEvent);
          } catch (err) {
            console.warn("[api] malformed execution event", err);
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

export async function cancelTradingOrder(accountId: string, input: OrderCancelInput) {
  return request<Order>(
    `/api/v1/trading/orders/cancel?accountId=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function getBrokerStatus(accountId: string) {
  return request<BrokerConnectionStatus>(
    `/api/v1/trading/status?accountId=${encodeURIComponent(accountId)}`
  );
}

// ── Market data ──
//
// These types mirror the response of /api/v1/market-data/effective-quotes
// (defined in apps/api/src/market-data.ts). They live here rather than in
// @iuf-trading-room/contracts to avoid forcing the contracts package to
// re-export internal market-data shapes that Codex still iterates on.

export type EffectiveQuoteReadiness = "ready" | "degraded" | "blocked";

export type EffectiveMarketQuote = {
  symbol: string;
  market: string;
  selectedSource: QuoteSource | null;
  selectedQuote: Quote | null;
  freshnessStatus: "fresh" | "stale" | "missing";
  fallbackReason:
    | "none"
    | "higher_priority_stale"
    | "higher_priority_missing"
    | "higher_priority_unavailable"
    | "no_fresh_quote"
    | "no_quote";
  staleReason:
    | "none"
    | "age_exceeded"
    | "missing_last"
    | "no_quote"
    | "provider_unavailable";
  readiness: EffectiveQuoteReadiness;
  strategyUsable: boolean;
  paperUsable: boolean;
  liveUsable: boolean;
  synthetic: boolean;
  providerConnected: boolean;
  staleAfterMs: number | null;
  sourcePriority: number | null;
  reasons: string[];
};

export type EffectiveQuotesResponse = {
  generatedAt: string;
  summary: {
    total: number;
    ready: number;
    degraded: number;
    blocked: number;
    strategyUsable: number;
    paperUsable: number;
    liveUsable: number;
  };
  items: EffectiveMarketQuote[];
};

export async function getEffectiveQuotes(params: {
  symbols: string;
  market?: string;
  includeStale?: boolean;
  limit?: number;
}) {
  const query = new URLSearchParams();
  query.set("symbols", params.symbols);
  if (params.market) query.set("market", params.market);
  if (params.includeStale) query.set("includeStale", "true");
  if (params.limit) query.set("limit", String(params.limit));
  return request<EffectiveQuotesResponse>(
    `/api/v1/market-data/effective-quotes?${query.toString()}`
  );
}

export async function getMarketDataProviders() {
  return request<QuoteProviderStatus[]>("/api/v1/market-data/providers");
}

// Consumer-summary wraps effective-quotes with a usability mode (paper / live /
// strategy) so we get Codex's verdict (decision: allow / review / block) verbatim
// per symbol — keeps the execution gate aligned with what the broker itself
// would accept.
export type { MarketDataConsumerItem, MarketDataConsumerMode, MarketDataConsumerSummary };

export async function getMarketDataConsumerSummary(params: {
  mode: MarketDataConsumerMode;
  symbols: string;
  market?: string;
  includeStale?: boolean;
  limit?: number;
}) {
  const query = new URLSearchParams();
  query.set("mode", params.mode);
  query.set("symbols", params.symbols);
  if (params.market) query.set("market", params.market);
  if (params.includeStale) query.set("includeStale", "true");
  if (params.limit) query.set("limit", String(params.limit));
  return request<MarketDataConsumerSummary>(
    `/api/v1/market-data/consumer-summary?${query.toString()}`
  );
}

export type { MarketDataDecisionSummary, MarketDataDecisionSummaryItem };

export async function getMarketDataDecisionSummary(params: {
  symbols: string;
  market?: string;
  includeStale?: boolean;
  limit?: number;
}) {
  const query = new URLSearchParams();
  query.set("symbols", params.symbols);
  if (params.market) query.set("market", params.market);
  if (params.includeStale) query.set("includeStale", "true");
  if (params.limit) query.set("limit", String(params.limit));
  return request<MarketDataDecisionSummary>(
    `/api/v1/market-data/decision-summary?${query.toString()}`
  );
}

// ── Risk ──

export async function getRiskLimit(accountId: string) {
  return request<RiskLimit>(`/api/v1/risk/limits?accountId=${encodeURIComponent(accountId)}`);
}

export async function upsertRiskLimit(input: RiskLimitUpsertInput) {
  return request<RiskLimit>("/api/v1/risk/limits", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getEffectiveRiskLimit(params: {
  accountId: string;
  strategyId?: string;
  symbol?: string;
}) {
  const query = new URLSearchParams();
  query.set("accountId", params.accountId);
  if (params.strategyId) query.set("strategyId", params.strategyId);
  if (params.symbol) query.set("symbol", params.symbol);
  return request<EffectiveRiskLimit>(
    `/api/v1/risk/effective-limits?${query.toString()}`
  );
}

export async function listStrategyRiskLimits(accountId: string) {
  return request<StrategyRiskLimit[]>(
    `/api/v1/risk/strategy-limits?accountId=${encodeURIComponent(accountId)}`
  );
}

export async function upsertStrategyRiskLimit(input: StrategyRiskLimitUpsertInput) {
  return request<StrategyRiskLimit>("/api/v1/risk/strategy-limits", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function deleteStrategyRiskLimit(params: {
  accountId: string;
  strategyId: string;
}) {
  const query = new URLSearchParams({
    accountId: params.accountId,
    strategyId: params.strategyId
  });
  return request<{ deleted: boolean }>(
    `/api/v1/risk/strategy-limits?${query.toString()}`,
    { method: "DELETE" }
  );
}

export async function listSymbolRiskLimits(accountId: string) {
  return request<SymbolRiskLimit[]>(
    `/api/v1/risk/symbol-limits?accountId=${encodeURIComponent(accountId)}`
  );
}

export async function upsertSymbolRiskLimit(input: SymbolRiskLimitUpsertInput) {
  return request<SymbolRiskLimit>("/api/v1/risk/symbol-limits", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function deleteSymbolRiskLimit(params: {
  accountId: string;
  symbol: string;
}) {
  const query = new URLSearchParams({
    accountId: params.accountId,
    symbol: params.symbol
  });
  return request<{ deleted: boolean }>(
    `/api/v1/risk/symbol-limits?${query.toString()}`,
    { method: "DELETE" }
  );
}

export async function getKillSwitch(accountId: string) {
  return request<KillSwitchState>(
    `/api/v1/risk/kill-switch?accountId=${encodeURIComponent(accountId)}`
  );
}

export async function setKillSwitch(input: KillSwitchInput) {
  return request<KillSwitchState>("/api/v1/risk/kill-switch", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export type StrategyIdeasQueryParams = {
  limit?: number;
  signalDays?: number;
  includeBlocked?: boolean;
  market?: string;
  themeId?: string;
  theme?: string;
  symbol?: string;
  decisionMode?: StrategyIdeasDecisionMode;
  decisionFilter?: StrategyIdeasDecisionFilter;
  qualityFilter?: StrategyIdeasQualityFilter;
  sort?: StrategyIdeasSort;
};

export async function getStrategyIdeas(params: StrategyIdeasQueryParams = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.signalDays !== undefined) query.set("signalDays", String(params.signalDays));
  if (params.includeBlocked !== undefined) query.set("includeBlocked", String(params.includeBlocked));
  if (params.market) query.set("market", params.market);
  if (params.themeId) query.set("themeId", params.themeId);
  if (params.theme) query.set("theme", params.theme);
  if (params.symbol) query.set("symbol", params.symbol);
  if (params.decisionMode) query.set("decisionMode", params.decisionMode);
  if (params.decisionFilter) query.set("decisionFilter", params.decisionFilter);
  if (params.qualityFilter) query.set("qualityFilter", params.qualityFilter);
  if (params.sort) query.set("sort", params.sort);
  const qs = query.toString();
  return request<StrategyIdeasView>(`/api/v1/strategy/ideas${qs ? `?${qs}` : ""}`);
}

export type StrategyRunListParams = Partial<
  Pick<
    StrategyRunListQuery,
    "limit" | "decisionMode" | "symbol" | "themeId" | "theme" | "qualityFilter"
  >
> & {
  sort?: StrategyRunListSort;
};

export async function listStrategyRuns(params: StrategyRunListParams = {}) {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.decisionMode) query.set("decisionMode", params.decisionMode);
  if (params.symbol) query.set("symbol", params.symbol);
  if (params.themeId) query.set("themeId", params.themeId);
  if (params.theme) query.set("theme", params.theme);
  if (params.qualityFilter) query.set("qualityFilter", params.qualityFilter);
  if (params.sort) query.set("sort", params.sort);
  const qs = query.toString();
  return request<StrategyRunListView>(`/api/v1/strategy/runs${qs ? `?${qs}` : ""}`);
}

export async function getStrategyRunById(runId: string) {
  return request<StrategyRunRecord>(
    `/api/v1/strategy/runs/${encodeURIComponent(runId)}`
  );
}

export async function createStrategyRun(payload: StrategyRunCreateInput) {
  return request<StrategyRunRecord>("/api/v1/strategy/runs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

// ── Strategy Autopilot Execute ──
//
// Internal fetch path — NOT reusing requestOrderOutcome.
// Reason: autopilot returns AutopilotExecuteResult on 200 (including when all
// orders are blocked). Only non-200 statuses (400/403/404/500) are thrown
// errors. The 422-tolerant requestOrderOutcome expects SubmitOrderResult and
// would silently mistype the response.
async function requestAutopilotOutcome(
  runId: string,
  input: AutopilotExecuteInput
): Promise<Envelope<AutopilotExecuteResult>> {
  const response = await fetch(
    `${API_BASE}/api/v1/strategy/runs/${encodeURIComponent(runId)}/execute`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": WORKSPACE_SLUG
      },
      body: JSON.stringify(input)
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Autopilot execute failed: ${response.status}`);
  }
  return (await response.json()) as Envelope<AutopilotExecuteResult>;
}

export async function executeStrategyRun(
  runId: string,
  input: AutopilotExecuteInput
): Promise<Envelope<AutopilotExecuteResult>> {
  return requestAutopilotOutcome(runId, input);
}

// ── Strategy Autopilot Confirm Token ──
//
// Step 1 of the 2-step confirm flow for real (dryRun:false) execution.
// POST /api/v1/strategy/runs/:id/confirm-token → 201 { data: { token, expiresAt } }
// Token is single-use, bound to the runId, expires in 60 seconds.
// Must NOT be called for dryRun:true requests — gate is not involved.

export type ConfirmTokenResponse = {
  token: string;
  expiresAt: string; // ISO 8601
};

export async function requestConfirmToken(runId: string): Promise<ConfirmTokenResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/strategy/runs/${encodeURIComponent(runId)}/confirm-token`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": WORKSPACE_SLUG
      }
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Confirm token request failed: ${response.status}`);
  }
  const envelope = (await response.json()) as Envelope<ConfirmTokenResponse>;
  return envelope.data;
}

// ── Worker Content ──────────────────────────────────────────────────────────
//
// theme-summaries and company-notes are produced by the OpenAlice worker.
// Filter by themeId / companyId (UUIDs). The API returns { data: T[] }.

export async function getThemeSummaries(params: { themeId: string; limit?: number }) {
  const query = new URLSearchParams();
  query.set("themeId", params.themeId);
  if (params.limit) query.set("limit", String(params.limit));
  return request<ThemeSummary[]>(`/api/v1/theme-summaries?${query.toString()}`);
}

export async function getCompanyNotes(params: { companyId: string; limit?: number }) {
  const query = new URLSearchParams();
  query.set("companyId", params.companyId);
  if (params.limit) query.set("limit", String(params.limit));
  return request<CompanyNote[]>(`/api/v1/company-notes?${query.toString()}`);
}

// ── Content Drafts (P0-D / P0.5-4 review queue) ─────────────────────────────

export type ContentDraftStatus = "awaiting_review" | "approved" | "rejected";
export type ContentDraftTargetTable = "theme_summaries" | "company_notes" | "daily_briefs";

export type ContentDraftEntry = {
  id: string;
  workspaceId: string;
  sourceJobId: string | null;
  targetTable: ContentDraftTargetTable | string;
  targetEntityId: string | null;
  payload: unknown;
  status: ContentDraftStatus;
  dedupeKey: string;
  producerVersion: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  approvedRefId: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getContentDrafts(params?: { status?: ContentDraftStatus; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<ContentDraftEntry[]>(`/api/v1/content-drafts${qs ? `?${qs}` : ""}`);
}

export async function approveContentDraft(draftId: string) {
  return request<ContentDraftEntry>(`/api/v1/content-drafts/${draftId}/approve`, {
    method: "POST"
  });
}

export async function rejectContentDraft(draftId: string, reason: string) {
  return request<ContentDraftEntry>(`/api/v1/content-drafts/${draftId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}
