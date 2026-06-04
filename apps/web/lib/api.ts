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
  MyEntitlements,
  Order,
  OrderCancelInput,
  OrderCreateInput,
  Position,
  Quote,
  QuoteProviderStatus,
  QuoteSource,
  RecommendationFeedback,
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
  StockRecommendation,
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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

function requestMethod(init?: RequestInit) {
  return (init?.method ?? "GET").toUpperCase();
}

const SAME_ORIGIN_GET_PROXY_PATHS = [
  /^\/api\/v1\/companies(?:\?|$|\/)/,
  /^\/api\/v1\/kgi\/quote\/(?:bidask|ticks)(?:\?|$)/,
];

function shouldUseSameOriginBackendProxy(path: string, init?: RequestInit) {
  return typeof window !== "undefined"
    && requestMethod(init) === "GET"
    && SAME_ORIGIN_GET_PROXY_PATHS.some((pattern) => pattern.test(path));
}

function apiRequestUrl(path: string, init?: RequestInit) {
  if (shouldUseSameOriginBackendProxy(path, init)) {
    return `/api/ui-final-v031/backend?path=${encodeURIComponent(path)}`;
  }
  return API_BASE ? `${API_BASE}${path}` : null;
}

type Envelope<T> = {
  data: T;
};

async function request<T>(path: string, init?: RequestInit) {
  const url = apiRequestUrl(path, init);
  if (!url) {
    throw new Error("資料服務位置尚未設定");
  }

  // SSR (server component) calls don't get the browser's cookie automatically.
  // Forward the incoming request's Cookie header so authenticated endpoints (e.g. /companies) work.
  let ssrCookie: string | null = null;
  if (typeof window === "undefined") {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      ssrCookie = h.get("cookie");
    } catch {
      // Outside a request context (e.g. build time) — leave cookie unset.
    }
  }

  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(ssrCookie ? { Cookie: ssrCookie } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as Envelope<T>;
}

async function requestRaw<T>(path: string, init?: RequestInit) {
  const url = apiRequestUrl(path, init);
  if (!url) {
    throw new Error("資料服務尚未設定");
  }

  let ssrCookie: string | null = null;
  if (typeof window === "undefined") {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      ssrCookie = h.get("cookie");
    } catch {
      // Outside a request context, leave cookie unset.
    }
  }

  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(ssrCookie ? { Cookie: ssrCookie } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function getThemes() {
  return request<Theme[]>("/api/v1/themes");
}

export async function getSession() {
  return request<AppSession>("/api/v1/session");
}

export async function getMyEntitlements() {
  return request<MyEntitlements>("/api/v1/entitlements/me");
}

export type RecommendationListResponse = {
  date: string;
  generatedAt: string;
  count: number;
  items: StockRecommendation[];
  _mock?: boolean;
};

export type AiRecommendationV3Status =
  | "complete"
  | "empty"
  | "failed"
  | "budget_exceeded"
  | "synthesis_format_error"
  | "running"
  | "pending";

export type AiRecommendationV3Item = {
  id?: string;
  ticker: string;
  companyName?: string | null;
  company_name?: string | null;
  confidence?: number | null;
  marketState?: "risk_off" | "event" | "trend" | "range" | null;
  marketScores?: {
    trend?: number | null;
    range?: number | null;
    risk_off?: number | null;
    riskOff?: number | null;
    event_label?: string | null;
    eventLabel?: string | null;
  } | null;
  subScores?: {
    theme?: number | null;
    revenue?: number | null;
    institutional?: number | null;
    margin?: number | null;
    rs?: number | null;
    technical?: number | null;
    valuation?: number | null;
  } | null;
  sub_scores?: {
    theme_position?: number | null;
    revenue_earnings?: number | null;
    institutional_etf?: number | null;
    margin_short?: number | null;
    rs_volume?: number | null;
    technical_structure?: number | null;
    valuation_event?: number | null;
    total?: number | null;
  } | null;
  totalScore?: number | null;
  bucket?: "A+" | "A" | "B" | "C" | null;
  action?: string | null;
  entryZone?: {
    low?: number | null;
    high?: number | null;
    reason?: string | null;
  } | null;
  entryPriceRange?: {
    low?: number | null;
    high?: number | null;
  } | null;
  tp1?: number | null;
  tp2?: number | null;
  stopLoss?: number | null;
  tp1Structured?: {
    price?: number | null;
    reason?: string | null;
  } | null;
  tp2Structured?: {
    price?: number | null;
    reason?: string | null;
  } | null;
  stopLossStructured?: {
    price?: number | null;
    atr_multiple?: number | null;
  } | null;
  r_ratio?: number | null;
  position_sizing?: {
    nav_pct?: number | null;
    market_multiplier?: number | null;
  } | null;
  why_buy?: string[] | string | null;
  why_not_buy?: string[] | string | null;
  risk?: string[] | string | null;
  risks?: string[] | string | null;
  riskFactors?: string[] | string | null;
  rationale?: string | null;
  source?: string | null;
  sourceTrail?: unknown;
  sourceState?: AiRecommendationV3SourceState | null;
  fullAiReportParsed?: boolean | null;
  synthesisRetryUsed?: boolean | null;
  synthesisFallbackUsed?: boolean | null;
  usedFallback?: boolean | null;
};

export type AiRecommendationV3SourceState = {
  state?: "live" | "empty" | "degraded" | "pending" | string;
  source?: string | null;
  count?: number | null;
  lastUpdated?: string | null;
  owner?: string | null;
  nextAction?: string | null;
  reason?: string | null;
};

export type AiRecommendationV3Response = {
  runId?: string | null;
  status?: AiRecommendationV3Status | string | null;
  generatedAt?: string | null;
  itemCount?: number | null;
  items?: AiRecommendationV3Item[];
  reactTrace?: unknown[];
  finalReportMarkdown?: string | null;
  totalCostUsd?: number | null;
  totalTokens?: number | null;
  sourceState?: AiRecommendationV3SourceState | null;
  sourceStates?: Record<string, AiRecommendationV3SourceState | null | undefined> | null;
  officialAnnouncementSourceState?: AiRecommendationV3SourceState | null;
  officialAnnouncementsSourceState?: AiRecommendationV3SourceState | null;
  announcementSourceState?: AiRecommendationV3SourceState | null;
  fullAiReportParsed?: boolean | null;
  synthesisRetryUsed?: boolean | null;
  synthesisFallbackUsed?: boolean | null;
  usedFallback?: boolean | null;
  parserDiagnostic?: unknown;
};

export type RecommendationDetailResponse = {
  data: StockRecommendation;
  _mock?: boolean;
};

export async function getRecommendationsToday() {
  return requestRaw<RecommendationListResponse>("/api/v1/recommendations/today", {
    cache: "no-store",
  });
}

export async function getAiRecommendationsV3() {
  return requestRaw<AiRecommendationV3Response>("/api/v1/ai-recommendations/v3", {
    cache: "no-store",
  });
}

export async function getRecommendationDetail(id: string) {
  return requestRaw<RecommendationDetailResponse>(`/api/v1/recommendations/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
}

export async function sendRecommendationFeedback(id: string, input: RecommendationFeedback) {
  return requestRaw<{ ok: true }>(`/api/v1/recommendations/${encodeURIComponent(id)}/feedback`, {
    method: "POST",
    body: JSON.stringify(input),
  });
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

// BLOCK #8 Lane B — brief detail with audit chain
export type BriefDetailAuditChain = {
  hardReject: {
    rules: string[];
    rejected: boolean;
  };
  adversarialReview: {
    ran: boolean;
    verdict: "OK" | "INTERCEPTED";
    severityScore: number | null;
    flags: string[];
    reviewerModel: string;
    auditedAt: string | null;
  } | null;
  hallucinationCheck: {
    ran: boolean;
    verdict: "OK" | "PARTIAL_HALLUCINATED" | "HALLUCINATED" | "ERROR";
    confidence: number | null;
    flags: unknown[];
    ragUsed: boolean;
    modelChain: string;
    auditedAt: string | null;
  } | null;
  sourceOnlyGate?: {
    ran: boolean;
    verdict: "OK" | "HELD";
    confidence: number | null;
    reason: string | null;
    sourcePackId: string | null;
    auditedAt: string | null;
  } | null;
};

export type BriefDetail = {
  id: string;
  date: string;
  title: string;
  status: string;
  marketState: string;
  generatedBy: string;
  createdAt: string;
  sections: Array<{ heading: string; body: string; sourceTrail: string | null }>;
  auditChain: BriefDetailAuditChain;
};

export async function getBriefDetail(id: string) {
  return request<BriefDetail>(`/api/v1/briefs/${encodeURIComponent(id)}`);
}

export async function createBrief(input: DailyBriefCreateInput) {
  return request<DailyBrief>("/api/v1/briefs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// Event Alerts (BLOCK #6 / #8 — event-engine triggered events)

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertEntry = {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  ticker: string | null;
  payload: Record<string, unknown>;
  triggeredAt: string;
  acknowledged: boolean;
};

export type AlertsEngineState = {
  lastTickAt: string | null;
  lastTickEvents: number;
  totalEventsThisProcess: number;
  lastError: string | null;
};

export type AlertsListResponse = {
  data: AlertEntry[];
  meta: {
    count: number;
    unreadOnly: boolean;
    engineState: AlertsEngineState;
  };
};

export class AlertsAuthError extends Error {
  constructor(message = "auth_required") {
    super(message);
    this.name = "AlertsAuthError";
  }
}

export async function getAlerts(params?: { limit?: number; unreadOnly?: boolean }): Promise<AlertsListResponse> {
  if (!API_BASE) {
    throw new Error("資料服務位置尚未設定");
  }

  const query = new URLSearchParams();
  if (typeof params?.limit === "number") query.set("limit", String(params.limit));
  if (params?.unreadOnly) query.set("unread", "true");
  const qs = query.toString();

  // SSR cookie forwarding (same pattern as request())
  let ssrCookie: string | null = null;
  if (typeof window === "undefined") {
    try {
      const { headers } = await import("next/headers");
      const h = await headers();
      ssrCookie = h.get("cookie");
    } catch {
      // outside request context — leave cookie unset
    }
  }

  const response = await fetch(`${API_BASE}/api/v1/alerts${qs ? `?${qs}` : ""}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": WORKSPACE_SLUG,
      ...(ssrCookie ? { Cookie: ssrCookie } : {}),
    },
  });

  if (response.status === 401) {
    throw new AlertsAuthError("auth_required");
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const json = (await response.json()) as Partial<AlertsListResponse>;
  const data = Array.isArray(json.data) ? json.data : [];
  const meta = json.meta ?? {
    count: data.length,
    unreadOnly: Boolean(params?.unreadOnly),
    engineState: { lastTickAt: null, lastTickEvents: 0, totalEventsThisProcess: 0, lastError: null },
  };
  return { data, meta };
}

// Header Dock Notifications (Day 6 v1)

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationEntry = {
  id: string;
  type?: string;
  category?: string;
  title?: string;
  message?: string;
  severity?: NotificationSeverity;
  createdAt?: string;
  occurredAt?: string;
  href?: string;
  readAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type NotificationListResponse = {
  notifications: NotificationEntry[];
  unread_count: number;
  meta?: {
    source?: string;
    reason?: string;
    status?: number;
  };
};

export async function getHeaderDockNotifications(params?: { limit?: number; unreadOnly?: boolean }) {
  const query = new URLSearchParams();
  if (typeof params?.limit === "number") query.set("limit", String(params.limit));
  if (params?.unreadOnly) query.set("unread_only", "true");
  const response = await fetch(`/api/header-dock/notifications${query.toString() ? `?${query.toString()}` : ""}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Notification proxy failed: ${response.status}`);
  }
  return (await response.json()) as NotificationListResponse;
}

export async function markHeaderDockNotificationRead(id: string): Promise<void> {
  const response = await fetch(`/api/header-dock/notifications/${encodeURIComponent(id)}/mark-read`, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Notification mark-read failed: ${response.status}`);
  }
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
  pipeline?: {
    lastGeneratedAt: string | null;
    lastReviewedAt: string | null;
    lastPublishedAt: string | null;
    nextRunAt: string | null;
    lastFailureReason: string | null;
    sourcePackCount: number;
    reviewerVerdict: "approve" | "reject" | "manual_review" | null;
  };
};

export type OpenAliceDispatcherTickResult =
  | "enqueued"
  | "pipeline_triggered"
  | "pipeline_skipped"
  | "skipped_existing_job"
  | "skipped_existing_brief"
  | "no_workspace"
  | "no_db"
  | "enqueue_failed";

export type OpenAliceDispatcherDebug = {
  lastTickAt: string | null;
  lastTickResult: OpenAliceDispatcherTickResult | null;
  lastEnqueueError: string | null;
  lastEnqueueErrorStack: string | null;
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

export async function getOpenAliceDispatcherDebug() {
  return request<OpenAliceDispatcherDebug>("/api/v1/internal/openalice/dispatcher-debug");
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

// ── Data source diagnostics ──

export type FinMindDatasetStatus = {
  key: string;
  label: string;
  implemented: boolean;
  blocker?: string;
  state:
    | "READY"
    | "LIVE"
    | "STALE"
    | "EMPTY"
    | "FALLBACK"
    | "DEGRADED"
    | "BLOCKED"
    | "ERROR"
    | "MOCK"
    | "CLOSED";
  lastFetchTs?: string | null;
  rowCount?: number | null;
  latestDate?: string | null;
  missingReason?: string | null;
  degradedReason?: string | null;
};

export type FinMindSourceStatus = {
  source: "FINMIND";
  state: "LIVE_READY" | "DEGRADED" | "BLOCKED";
  tokenPresent: boolean;
  global?: {
    tokenPresent: boolean;
    quotaTier: "sponsor999" | "free" | "none" | string;
    rateLimitPerHour: number | null;
  };
  quota: {
    used: number | null;
    limit: number | null;
    source: string;
  };
  health?: {
    requestCount: number;
    errorCount: number;
    errorRatePct: number | null;
    lastFetchTs: string | null;
    lastDataset: string | null;
    degradedByErrors: boolean;
  };
  datasets: FinMindDatasetStatus[];
  notes: string[];
  updatedAt: string;
};

export type FinMindDiagnosticsStatus = {
  tokenPresent: boolean;
  tokenSource: "env" | "none" | string;
  ohlcvSource: string;
  quotaTier: "sponsor999" | "free" | "none" | string;
  quotaLimitPerHour: number | null;
  redisConfigured: boolean;
  inProcess: {
    requestCount: number;
    errorCount: number;
    errorRatePct: number | null;
    lastFetchTs: string | null;
    lastDataset: string | null;
  };
  health: "configured" | "no_token" | string;
  note: string;
};

export type FinMindKBarRow = {
  date: string;
  minute: string;
  stock_id: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type FinMindKBarView = {
  source: "FINMIND";
  state: "LIVE" | "EMPTY" | "BLOCKED";
  reason: string | null;
  stockId: string;
  date: string;
  dateRange?: { from: string; to: string } | null;
  daysRequested?: number;
  daysReturned?: number;
  resolvedDates?: string[];
  candidateDatesScanned?: number;
  requestedDate?: string;
  rows: FinMindKBarRow[];
  updatedAt: string;
};

export async function getFinMindStatus() {
  return request<FinMindSourceStatus>("/api/v1/data-sources/finmind/status");
}

export async function getFinMindDiagnostics() {
  return request<FinMindDiagnosticsStatus>("/api/v1/diagnostics/finmind");
}

export async function getCompanyKBar(id: string, date?: string, options?: { days?: number }) {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  if (options?.days) query.set("days", String(options.days));
  const qs = query.toString();
  return request<FinMindKBarView>(`/api/v1/companies/${id}/kbar${qs ? `?${qs}` : ""}`);
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

export type KgiQuoteStatus = {
  subscribed_symbols: {
    tick: string[];
    bidask: string[];
  };
  buffer: {
    tick: Record<string, { count: number; maxlen: number; last_received_at: string | null }>;
    bidask: Record<string, { present: boolean; last_received_at: string | null }>;
  };
  kgi_logged_in: boolean;
  quote_disabled_flag: boolean;
};

export async function getKgiQuoteStatus() {
  const response = await request<KgiQuoteStatus>("/api/v1/kgi/quote/status");
  return response.data;
}

// ── Realtime quote for company detail page (PR #306 + EC2 KGI gateway) ────────
// GET /api/v1/companies/:id/quote/realtime
// :id may be UUID or ticker symbol.
// state: 'LIVE' | 'STALE' | 'BLOCKED' | 'NO_DATA'
// source: KGI when quote gateway is live, TWSE intraday/EOD when KGI is unavailable.
export type CompanyRealtimeQuote = {
  symbol: string;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  freshness: "fresh" | "stale" | "not-available";
  state: "LIVE" | "STALE" | "BLOCKED" | "NO_DATA";
  reason?: string;
  source: "kgi-gateway" | "twse_intraday" | "twse_openapi_eod";
  note?: string;
  marketSession?: "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE";
  referenceReason?: "pre_open_reference" | "post_close_reference" | "closed_reference" | "kgi_unavailable_eod_fallback";
  updatedAt: string;
};

export async function getCompanyQuoteRealtime(companyId: string): Promise<CompanyRealtimeQuote | null> {
  try {
    const res = await request<CompanyRealtimeQuote>(`/api/v1/companies/${companyId}/quote/realtime`);
    return res.data;
  } catch {
    return null;
  }
}

// ── Realtime Snapshot Multi (PARTIAL — canonical shape, fan-out stub) ──────────
// PARTIAL: 等 Jason 補 GET /api/v1/realtime/snapshot?symbols=... 後端端點。
// 目前 fan-out 至 /api/v1/companies/:id/quote/realtime（per-symbol），
// 之後後端上線後只需換成 single-call；前端 hook API 不變。
//
// freshness_mode canonical 語義（給 UI 層消費）：
//   live     — KGI 即時 (<= 2s)
//   intraday — TWSE MIS 盤中近即時
//   stale    — age > 2s（風控界線：不可假裝 live）
//   eod      — 昨收 / 盤後 / 資料不可用
export type RealtimeSnapshotItem = {
  symbol: string;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  freshness_mode: "live" | "intraday" | "stale" | "eod";
  freshness_ms: number;
  source: string;
  updatedAt: string;
};

export type RealtimeSnapshotResponse = {
  items: RealtimeSnapshotItem[];
  /** PARTIAL — backend endpoint not yet deployed; fan-out via per-symbol route */
  _stub: true;
};

function _stateToFreshnessMode(quote: CompanyRealtimeQuote): "live" | "intraday" | "stale" | "eod" {
  if (quote.source === "twse_openapi_eod") return "eod";
  if (quote.state === "BLOCKED" || quote.state === "NO_DATA") return "eod";
  if (quote.source === "twse_intraday") return "intraday";
  if (quote.source === "kgi-gateway") {
    const ageMs = Date.now() - Date.parse(quote.updatedAt);
    return quote.freshness === "fresh" && ageMs <= 2000 ? "live" : "stale";
  }
  if (quote.state === "LIVE") return "live";
  if (quote.state === "STALE") return "stale";
  return "eod";
}

/**
 * getRealtimeSnapshotMulti — 批次取得多個 symbol 的 canonical 報價快照。
 *
 * PARTIAL: 此函式目前 fan-out 至 per-symbol realtime endpoint。
 * 後端 GET /api/v1/realtime/snapshot?symbols=... 上線後，切換實作即可。
 * 呼叫方不需改動。
 */
export async function getRealtimeSnapshotMulti(
  symbols: string[],
): Promise<RealtimeSnapshotResponse> {
  const results = await Promise.allSettled(
    symbols.map((sym) => getCompanyQuoteRealtime(sym)),
  );

  const items: RealtimeSnapshotItem[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const r = results[i];
    const sym = symbols[i];
    if (r.status === "fulfilled" && r.value) {
      const q = r.value;
      const nowMs = Date.now();
      items.push({
        symbol: sym,
        lastPrice: q.lastPrice,
        bid: q.bid,
        ask: q.ask,
        volume: q.volume,
        freshness_mode: _stateToFreshnessMode(q),
        freshness_ms: q.updatedAt ? Math.max(0, nowMs - Date.parse(q.updatedAt)) : -1,
        source: q.source,
        updatedAt: q.updatedAt,
      });
    } else {
      // fetch 失敗 → eod fallback（不假裝有資料）
      items.push({
        symbol: sym,
        lastPrice: null,
        bid: null,
        ask: null,
        volume: null,
        freshness_mode: "eod",
        freshness_ms: -1,
        source: "unavailable",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return { items, _stub: true };
}

// ── Dashboard Snapshot (PR #326 — 6-panel aggregation, 30s cache) ─────────────
// GET /api/v1/dashboard/snapshot
// Returns 6 panels in 1 fetch: industry_heatmap, news_recent, brief_today,
// lab_strategies, audit_stats, watchlist_quotes.
// partial-success: stale_panels + errors map let consumers degrade gracefully.
export type DashboardSnapshotPanels = {
  industry_heatmap: unknown;
  news_recent: unknown;
  brief_today: unknown;
  lab_strategies: unknown[];
  audit_stats: unknown;
  watchlist_quotes: unknown;
};

export type DashboardSnapshot = {
  as_of: string;
  panels: DashboardSnapshotPanels;
  stale_panels: string[];
  errors: Record<string, string>;
  _cache_hit: boolean;
};

export async function getDashboardSnapshot(): Promise<DashboardSnapshot | null> {
  try {
    const res = await request<DashboardSnapshot>("/api/v1/dashboard/snapshot");
    return res.data;
  } catch {
    return null;
  }
}

// ── Brief search (PR #325 — FTS / ILIKE fallback) ─────────────────────────────
// GET /api/v1/briefs/search?q=...&from=...&to=...&limit=...&offset=...
export type BriefSearchResult = {
  id: string;
  date: string;
  status: string;
  sections: Array<{ heading: string; body: string }>;
  rank: number;
  matchedIn: string;
  createdAt: string;
};

export type BriefSearchResponse = {
  query: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
  count: number;
  results: BriefSearchResult[];
  fallback: boolean;
};

export async function searchBriefs(params: {
  q: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<BriefSearchResponse | null> {
  const query = new URLSearchParams();
  query.set("q", params.q);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  try {
    const res = await request<BriefSearchResponse>(`/api/v1/briefs/search?${query.toString()}`);
    return res.data;
  } catch {
    return null;
  }
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

export type MarketDataOverviewState = "LIVE" | "STALE" | "EMPTY" | "BLOCKED";

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

export type MarketDataOverviewLeader = {
  symbol: string;
  market: string;
  name?: string;
  source: string;
  last: number | null;
  changePct?: number | null;
  volume?: number | null;
  timestamp: string;
  readiness?: EffectiveQuoteReadiness;
  freshnessStatus?: EffectiveMarketQuote["freshnessStatus"];
};

export type MarketDataOverviewHeatTile = {
  symbol: string;
  market: string;
  name: string;
  sector?: string | null;
  source: string;
  date?: string | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  last: number | null;
  prevClose?: number | null;
  change?: number | null;
  changePct: number | null;
  volume: number | null;
  timestamp: string;
  weight: number;
  readiness: EffectiveQuoteReadiness;
  freshnessStatus: EffectiveMarketQuote["freshnessStatus"];
};

export type MarketDataOverviewContext = {
  state: MarketDataOverviewState;
  source: string;
  index: {
    state: MarketDataOverviewState;
    symbol: string | null;
    market: string;
    name: string;
    source: string | null;
    last: number | null;
    change: number | null;
    changePct: number | null;
    timestamp: string | null;
    freshnessStatus: EffectiveMarketQuote["freshnessStatus"];
    reason: string | null;
    history?: Array<{
      date: string;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
      volume: number | null;
      source: string;
    }>;
  };
  breadth: {
    state: MarketDataOverviewState;
    up: number;
    down: number;
    flat: number;
    total: number;
    updatedAt: string | null;
    source: string;
    reason: string | null;
  };
  heatmap: MarketDataOverviewHeatTile[];
};

export type MarketDataOverview = {
  generatedAt: string;
  providers: QuoteProviderStatus[];
  marketContext: MarketDataOverviewContext;
  symbols: {
    total: number;
    byMarket: Array<{ market: string; total: number }>;
  };
  quotes: {
    total: number;
    fresh: number;
    stale: number;
    latestQuoteTimestamp: string | null;
    readiness: {
      connectedSources: QuoteSource[];
      disconnectedSources: QuoteSource[];
      preferredSourceOrder: QuoteSource[];
      effectiveSelection: {
        total: number;
        ready: number;
        degraded: number;
        blocked: number;
        strategyUsable: number;
        paperUsable: number;
        liveUsable: number;
      };
    };
    bySource: Array<{ source: QuoteSource; total: number; stale: number }>;
    byMarket: Array<{ market: string; total: number; stale: number }>;
  };
  quality: {
    evaluatedSymbols: number;
    history: { ready: number; degraded: number; blocked: number; total: number };
    bars: { ready: number; degraded: number; blocked: number; total: number };
  };
  leaders: {
    topGainers: MarketDataOverviewLeader[];
    topLosers: MarketDataOverviewLeader[];
    mostActive: MarketDataOverviewLeader[];
  };
};

export async function getMarketDataOverview(params: {
  sources?: string;
  includeStale?: boolean;
  topLimit?: number;
} = {}) {
  const query = new URLSearchParams();
  if (params.sources) query.set("sources", params.sources);
  if (params.includeStale !== undefined) query.set("includeStale", String(params.includeStale));
  if (params.topLimit !== undefined) query.set("topLimit", String(params.topLimit));
  const qs = query.toString();
  return request<MarketDataOverview>(`/api/v1/market-data/overview${qs ? `?${qs}` : ""}`);
}

export type TwseMarketIndexSnapshot = {
  value: number;
  change: number;
  changePct: number;
  ts: string;
};

export type TwseMarketOverview = {
  taiex: TwseMarketIndexSnapshot | null;
  otc: TwseMarketIndexSnapshot | null;
  source?: string;
  staleAfterSec?: number;
  sourceState?: string;
};

export type TwseIndustryHeatmapTile = {
  industry: string;
  avgChangePct: number;
  gainerCount: number;
  loserCount: number;
  flatCount: number;
  stockCount: number;
  source?: string;
};

export type TwseIndustryHeatmap = {
  data: TwseIndustryHeatmapTile[];
  source?: string;
  staleAfterSec?: number;
  industryCount?: number;
  mappedTickers?: number;
};

export type KgiMarketOverview = {
  taiex?: TwseMarketIndexSnapshot | null;
  otc?: TwseMarketIndexSnapshot | null;
  breadth?: {
    up?: number | null;
    down?: number | null;
    flat?: number | null;
    total?: number | null;
    amount?: number | null;
    updatedAt?: string | null;
  } | null;
  subscription?: { used?: number | null; limit?: number | null } | null;
  sourceState?: string;
  sessionLabel?: string;
  staleAfterSec?: number;
  updatedAt?: string | null;
};

export type KgiCoreHeatmapTile = {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  last?: number | null;
  price?: number | null;
  close?: number | null;
  prevClose?: number | null;
  change?: number | null;
  changePct?: number | null;
  pct?: number | null;
  volume?: number | null;
  tradingValue?: number | null;
  weight?: number | null;
  date?: string | null;
  updatedAt?: string | null;
  sourceState?: "live" | "twse_eod" | "cache" | "no_data" | string | null;
  sourceLabel?: string | null;
};

export type KgiCoreHeatmap = {
  data?: KgiCoreHeatmapTile[];
  tiles?: KgiCoreHeatmapTile[];
  sourceState?: string;
  staleAfterSec?: number;
  updatedAt?: string | null;
  subscription?: { used?: number | null; limit?: number | null } | null;
};

export async function getTwseMarketOverview() {
  return requestRaw<TwseMarketOverview>("/api/v1/market/overview/twse");
}

export async function getTwseMarketHeatmap() {
  return requestRaw<TwseIndustryHeatmap>("/api/v1/market/heatmap/twse");
}

export async function getKgiMarketOverview() {
  return requestRaw<KgiMarketOverview | { data: KgiMarketOverview }>("/api/v1/market/overview/kgi");
}

export async function getKgiCoreHeatmap() {
  return requestRaw<KgiCoreHeatmap | { data: KgiCoreHeatmap }>("/api/v1/market/heatmap/kgi-core");
}

export type MarketInstitutionalLine = {
  name: string;
  buy: number;
  sell: number;
  net: number;
};

export type MarketInstitutionalSummary = {
  asOf: string | null;
  totalNet: number | null;
  institutions: MarketInstitutionalLine[];
  topNetBuy: Array<{ stockId: string; net: number }>;
  topNetSell: Array<{ stockId: string; net: number }>;
  source: string;
  state: string;
  staleAfterSec?: number;
  reason?: string;
};

export async function getMarketInstitutionalSummary() {
  return requestRaw<MarketInstitutionalSummary>("/api/v1/market/institutional-summary/finmind");
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

export type RiskLayerName = "account" | "strategy" | "symbol" | "session";
export type RiskLayerStatus = "ok" | "warn" | "block" | "no_limit_set" | "blocked_killswitch";

export type RiskLayerCell = {
  layer: RiskLayerName;
  status: RiskLayerStatus;
  limit: { kind: string; value: number; unit: "ntd" | "lots" | "count" };
  current: number;
  utilizationPct: number;
  warnThresholdPct: number;
  blockThresholdPct: number;
  reason: string | null;
  topContributors: Array<{ key: string; value: number }>;
};

export type PositionRiskRow = {
  symbol: string;
  qtyLots: number;
  marketValueNtd: number;
  unrealizedPnlNtd: number;
  hypotheticalBlockingLayer: "none" | RiskLayerName;
  hypotheticalBlockReason: string | null;
};

export type StrategyExposureRow = {
  strategyTag: string;
  exposureNtd: number;
  utilizationPct: number;
  status: Exclude<RiskLayerStatus, "blocked_killswitch">;
};

export type SymbolExposureRow = {
  symbol: string;
  exposureNtd: number;
  utilizationPct: number;
  status: Exclude<RiskLayerStatus, "blocked_killswitch">;
};

export type RiskPortfolioOverview = {
  workspaceSlug: string;
  generatedAt: string;
  killSwitchState: "ARMED" | "DISARMED";
  paperGateState: "ARMED" | "DISARMED";
  layers: Record<RiskLayerName, RiskLayerCell>;
  positionAttribution: PositionRiskRow[];
  strategyBreakdown: StrategyExposureRow[];
  symbolBreakdown: SymbolExposureRow[];
};

export async function getRiskPortfolioOverview() {
  return request<RiskPortfolioOverview>("/api/v1/risk/portfolio-overview");
}

export type WatchlistQuoteCell =
  | { state: "LIVE"; value: number; updatedAt: string }
  | { state: "BLOCKED"; reason: string; lastSeenAt: string | null };

export type WatchlistAdvisoryStatus = "ok" | "warn" | "block" | "no_limit_set";

export type WatchlistRiskAdvisoryPreview = {
  layers: Record<RiskLayerName, WatchlistAdvisoryStatus>;
  worstStatus: RiskLayerStatus;
  badgeCode: string;
  hypotheticalBlockingLayer: RiskLayerName | null;
};

export type WatchlistRow = {
  symbol: string;
  symbolName: string | null;
  last: WatchlistQuoteCell;
  bid: WatchlistQuoteCell;
  ask: WatchlistQuoteCell;
  changePct: WatchlistQuoteCell;
  hypothetical1LotBuyRisk: WatchlistRiskAdvisoryPreview | null;
  canPromote: boolean;
  promoteBlockedReason: string | null;
};

export type WatchlistOverview = {
  generatedAt: string;
  source: "watchlist-store@v1";
  workspaceId: string;
  killSwitchState: "ARMED" | "ENGAGED";
  paperGateState: "ARMED" | "ENGAGED";
  rows: WatchlistRow[];
  warnings: string[];
};

export async function getWatchlistOverview() {
  return request<WatchlistOverview>("/api/watchlist/overview");
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

// ── Company Detail — OHLCV + ticker resolution ───────────────────────────────

export type OhlcvInterval = "1d" | "1w" | "1m";

export interface OhlcvBar {
  dt: string;       // 'YYYY-MM-DD'
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: "mock" | "kgi" | "tej";
}

export interface CompanyAnnouncement {
  id: string;
  date: string;
  title: string;
  category: string;
  body?: string;
  ticker?: string;
  companyName?: string;
  url?: string | null;
  source?: string;
}

export interface MarketIntelAnnouncementsData {
  items: CompanyAnnouncement[];
  selected: Array<{ id: string; ticker: string; name: string }>;
  failures: number;
  source: "twse_announcements" | "finmind_stock_news" | "mixed" | "empty";
}

// ── AI-selected top-10 news (4-window cron) ────────────────────────────────
export interface NewsAiItem {
  id: string;
  headline: string;
  date: string;
  ticker?: string;
  companyName?: string;
  source: "twse_announcements" | "finmind_stock_news" | "mixed";
  url?: string;
  why_matters: string | null;
  impact_tier: "HIGH" | "MID" | "LOW" | null;
  tags: string[];
  rank: number;
}

export interface NewsTop10Data {
  run_id: string | null;
  as_of: string | null;
  next_refresh_at: string | null;
  window_label: "08:00" | "12:00" | "18:00" | "24:00" | null;
  selection_mode: "ai" | "fallback" | null;
  items: NewsAiItem[];
  input_row_count: number;
  ai_call_success: boolean;
  stale_reason: string | null;
}

export async function getNewsTop10(): Promise<{ data: NewsTop10Data }> {
  return request<NewsTop10Data>("/api/v1/market-intel/news-top10");
}

export interface CompanyFinancialRow {
  period: string;
  revenue: number | null;
  grossMarginPct: number | null;
  operatingMarginPct: number | null;
  epsAfterTax: number | null;
  yoyPct: number | null;
}

export interface CompanyRevenueRow {
  date: string;
  stock_id: string;
  country: string;
  revenue: number;
  revenue_month: number;
  revenue_year: number;
}

export interface CompanyDividendRow {
  date: string;
  stock_id: string;
  year: number;
  StockEarningsDistribution: number;
  StockStatutoryReserveTransfer: number;
  StockCapitalReserveTransfer: number;
  StockReward: number;
  TotalStockDividend: number;
  CashEarningsDistribution: number;
  CashStatutoryReserveTransfer: number;
  CashCapitalReserveTransfer: number;
  CashReward: number;
  TotalCashDividend: number;
  TotalDividend: number;
}

export interface CompanyValuationRow {
  date: string;
  stock_id: string;
  dividend_yield: number;
  PER: number;
  PBR: number;
}

export interface CompanyMarketValueRow {
  date: string;
  stock_id: string;
  market_value: number;
}

export interface CompanyBalanceSheetSnapshot {
  date: string;
  stock_id: string;
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  cashAndCashEquivalents: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  debtRatioPct: number | null;
  currentRatioPct: number | null;
  sourceItems: Array<{ type: string; value: number; originName: string | null }>;
}

export interface CompanyCashFlowSnapshot {
  date: string;
  stock_id: string;
  operatingCashFlow: number | null;
  investingCashFlow: number | null;
  financingCashFlow: number | null;
  cashIncrease: number | null;
  netIncomeBeforeTax: number | null;
  freeCashFlow: number | null;
  sourceItems: Array<{ type: string; value: number; originName: string | null }>;
}

export interface CompanyChipsData {
  foreign: { net30d: number };
  trust: { net30d: number };
  dealer: { net30d: number };
  margin: { balance: number; change: number } | null;
  short: { balance: number; change: number } | null;
}

export interface CompanyShareholdingData {
  latest: {
    date: string;
    stock_id: string;
    stock_name: string;
    InternationalCode: string;
    ForeignInvestmentRemainingShares: number;
    ForeignInvestmentShares: number;
    ForeignInvestmentRemainRatio: number;
    ForeignInvestmentSharesRatio: number;
    ForeignInvestmentUpperLimitRatio: number;
    ChineseInvestmentUpperLimitRatio: number;
    NumberOfSharesIssued: number;
    RecentlyDeclareDate: string;
    note?: string;
  } | null;
  holdingLevels: Array<{
    date: string;
    stock_id: string;
    HoldingSharesLevel: string;
    people: number;
    percent: number;
    unit: number;
  }>;
  latestLevelDate: string | null;
  source: string;
}

/**
 * Resolve a Company by UUID.
 * For public ticker routes, prefer getCompanyByTicker() so detail pages do not
 * need to fetch the broad company list first.
 */
export async function getCompanyById(id: string) {
  return request<Company>(`/api/v1/companies/${id}`);
}

/**
 * Resolve a Company by ticker symbol through the backend ticker lookup.
 * This avoids blocking detail pages on the broad company list endpoint.
 * Returns null when not found.
 */
export async function getCompanyByTicker(ticker: string): Promise<Company | null> {
  const query = new URLSearchParams({ ticker });
  const res = await request<Company[]>(`/api/v1/companies?${query.toString()}`);
  const needle = ticker.toLowerCase();
  return res.data.find((c) => c.ticker.toLowerCase() === needle) ?? null;
}

export async function getCompanyOhlcv(
  companyId: string,
  params?: { interval?: OhlcvInterval; from?: string; to?: string }
): Promise<OhlcvBar[]> {
  const query = new URLSearchParams();
  if (params?.interval) query.set("interval", params.interval);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const qs = query.toString();
  const res = await request<OhlcvBar[]>(`/api/v1/companies/${companyId}/ohlcv${qs ? `?${qs}` : ""}`);
  return res.data;
}

export async function getCompanyAnnouncements(companyId: string, params?: { days?: number }) {
  const query = new URLSearchParams();
  if (params?.days) query.set("days", String(params.days));
  const qs = query.toString();
  return request<CompanyAnnouncement[]>(`/api/v1/companies/${companyId}/announcements${qs ? `?${qs}` : ""}`);
}

export async function getMarketIntelAnnouncements(params?: { days?: number; limit?: number; scope?: "market" | "company_pool" }) {
  const query = new URLSearchParams();
  if (params?.days) query.set("days", String(params.days));
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.scope) query.set("scope", params.scope);
  const qs = query.toString();
  return request<MarketIntelAnnouncementsData>(`/api/v1/market-intel/announcements${qs ? `?${qs}` : ""}`);
}

export async function getCompanyFinancials(companyId: string, params?: { limit?: number }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<CompanyFinancialRow[]>(`/api/v1/companies/${companyId}/financials${qs ? `?${qs}` : ""}`);
}

export async function getCompanyBalanceSheet(companyId: string, params?: { years?: number }) {
  const query = new URLSearchParams();
  if (params?.years) query.set("years", String(params.years));
  const qs = query.toString();
  return request<CompanyBalanceSheetSnapshot | null>(`/api/v1/companies/${companyId}/balance-sheet${qs ? `?${qs}` : ""}`);
}

export async function getCompanyCashFlow(companyId: string, params?: { years?: number }) {
  const query = new URLSearchParams();
  if (params?.years) query.set("years", String(params.years));
  const qs = query.toString();
  return request<CompanyCashFlowSnapshot | null>(`/api/v1/companies/${companyId}/cash-flow${qs ? `?${qs}` : ""}`);
}

export async function getCompanyRevenue(companyId: string, params?: { limit?: number }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<CompanyRevenueRow[]>(`/api/v1/companies/${companyId}/revenue${qs ? `?${qs}` : ""}`);
}

export async function getCompanyDividends(companyId: string, params?: { years?: number }) {
  const query = new URLSearchParams();
  if (params?.years) query.set("years", String(params.years));
  const qs = query.toString();
  return request<CompanyDividendRow[]>(`/api/v1/companies/${companyId}/dividend${qs ? `?${qs}` : ""}`);
}

export async function getCompanyValuation(companyId: string, params?: { days?: number }) {
  const query = new URLSearchParams();
  if (params?.days) query.set("days", String(params.days));
  const qs = query.toString();
  return request<CompanyValuationRow[]>(`/api/v1/companies/${companyId}/valuation${qs ? `?${qs}` : ""}`);
}

export async function getCompanyMarketValue(companyId: string, params?: { days?: number }) {
  const query = new URLSearchParams();
  if (params?.days) query.set("days", String(params.days));
  const qs = query.toString();
  return request<CompanyMarketValueRow[]>(`/api/v1/companies/${companyId}/market-value${qs ? `?${qs}` : ""}`);
}

export async function getCompanyChips(companyId: string, params?: { days?: number }) {
  const query = new URLSearchParams();
  if (params?.days) query.set("days", String(params.days));
  const qs = query.toString();
  return request<CompanyChipsData>(`/api/v1/companies/${companyId}/chips${qs ? `?${qs}` : ""}`);
}

export async function getCompanyShareholding(companyId: string, params?: { months?: number }) {
  const query = new URLSearchParams();
  if (params?.months) query.set("months", String(params.months));
  const qs = query.toString();
  return request<CompanyShareholdingData>(`/api/v1/companies/${companyId}/shareholding${qs ? `?${qs}` : ""}`);
}

// =============================================================================
// BLOCK #5 Axis 4+5 — full-profile aggregating envelope (PR #259)
// Mirrors apps/api/src/server.ts FullProfileSection<T>; tolerant of unknown
// state strings (server may add new states without breaking the client).
// =============================================================================

export type FullProfileSourceState =
  | "LIVE"
  | "STALE"
  | "EMPTY"
  | "BLOCKED"
  | "DEGRADED"
  | "ERROR"
  | "MOCK"
  | "FALLBACK"
  | "CLOSED";

export interface FullProfileSourceTrail {
  source: string;
  datasetKey: string;
  recordCount: number;
  degradedReason: string | null;
}

export interface FullProfileSection<T> {
  state: FullProfileSourceState;
  latest: T | null;
  history: T[];
  updatedAt: string;
  sourceTrail: FullProfileSourceTrail;
}

export interface FullProfileMonthlyRevenueLatest {
  date: string;
  stock_id: string;
  revenue: number;
  revenue_month: number;
  revenue_year: number;
  country: string;
  yoyGrowth: number | null;
}

export interface FullProfileMonthlyRevenueRow {
  date: string;
  stock_id: string;
  revenue: number;
  revenue_month: number;
  revenue_year: number;
  country: string;
}

export interface FullProfileFinancialLatest {
  date: string;
  eps: number | null;
  revenue: number | null;
  operatingIncome: number | null;
}

export interface FullProfileFinancialRow {
  date: string;
  stock_id: string;
  type: string;
  value: number;
  origin_name?: string;
}

export interface FullProfileInstitutionalRow {
  date: string;
  foreign: number;
  investmentTrust: number;
  dealer: number;
  totalNetBuy: number;
}

export interface FullProfileMarginShortRow {
  date: string;
  marginBalance: number | null;
  shortBalance: number | null;
  marginChange: number | null;
  shortChange: number | null;
}

export interface FullProfileDividendRow {
  year: number;
  cashDividend: number;
  stockDividend: number;
  totalDividend: number;
  announcementDate: string | null;
}

export interface FullProfileNewsRow {
  date: string;
  title: string;
  url: string | null;
  sourceName: string | null;
}

export interface FullProfileEnvelope {
  company: {
    id: string;
    ticker: string;
    name: string;
    market: string;
    country: string;
  };
  fundamentals: {
    monthlyRevenue: FullProfileSection<FullProfileMonthlyRevenueRow> & { latest: FullProfileMonthlyRevenueLatest | null };
    financialStatement: FullProfileSection<FullProfileFinancialRow> & { latest: FullProfileFinancialLatest | null };
    cashFlow: FullProfileSection<FullProfileFinancialRow>;
    balanceSheet: FullProfileSection<FullProfileFinancialRow>;
  };
  tradingFlow: {
    institutional: FullProfileSection<FullProfileInstitutionalRow>;
    marginShort: FullProfileSection<FullProfileMarginShortRow>;
    shareholding: FullProfileSection<{ date: string; foreignRatio: number | null; foreignRemainRatio: number | null; sharesIssued: number | null }>;
  };
  marketIntel: {
    dividend: FullProfileSection<FullProfileDividendRow>;
    marketValue: FullProfileSection<{ date: string; marketValue: number }>;
    valuation: FullProfileSection<{ date: string; pe: number | null; pbr: number | null; dividendYield: number | null }>;
    news: FullProfileSection<FullProfileNewsRow> & { experimental?: true };
  };
}

export async function getCompanyFullProfile(companyId: string) {
  return request<FullProfileEnvelope>(`/api/v1/companies/${companyId}/full-profile`);
}


// ── Lab three-strategy snapshot ────────────────────────────────────────────────
// GET /api/v1/lab/three-strategy/snapshot
// Returns the full fixture snapshot (strategies, health, meta).
// On error → returns null (never throws). The caller handles fallback display.

export type LabThreeStrategyEntry = {
  strategy_id: string;
  display_name_zh: string;
  pilot_role: string;
  pilot_status: string;
  capital_cap_twd_max: number;
  position_cap: number;
  latest_state: string;
  caveat: string;
  cash_order_path: string;
  broker_route: string;
};

export type LabThreeStrategySnapshotMeta = {
  source: "embedded_lab_fixture" | "unavailable";
  mode: "READ_ONLY_FIXTURE_API";
  cashOrderPath: "BLOCKED_until_Yang_final_manual_ACK";
  fixtureLabel: "PAPER_FIXTURE";
  schemaVersion: string;
  createdAtTaipei: string;
  reason?: string;
};

export type LabThreeStrategySnapshotResult = {
  ok: boolean;
  data: Record<string, unknown> | null;
  meta: LabThreeStrategySnapshotMeta;
};

export type LabThreeStrategySnapshot = {
  strategies: LabThreeStrategyEntry[];
  health: { ok: boolean; endpoint_count: number };
  schema_version: string;
  created_at_taipei: string;
  mode: string;
  cash_order_path: string;
  meta: LabThreeStrategySnapshotMeta;
};

export async function getLabThreeStrategySnapshot(): Promise<LabThreeStrategySnapshot | null> {
  try {
    const res = await request<LabThreeStrategySnapshotResult>("/api/v1/lab/three-strategy/snapshot");
    const payload = res.data;
    if (!payload || !payload.ok || !payload.data) return null;
    const raw = payload.data as Record<string, unknown>;
    const strategies = (raw["strategies"] as LabThreeStrategyEntry[] | undefined) ?? [];
    return {
      strategies,
      health: (raw["health"] as { ok: boolean; endpoint_count: number }) ?? { ok: false, endpoint_count: 0 },
      schema_version: (raw["schema_version"] as string) ?? "",
      created_at_taipei: (raw["created_at_taipei"] as string) ?? "",
      mode: (raw["mode"] as string) ?? "READ_ONLY_FIXTURE_API",
      cash_order_path: (raw["cash_order_path"] as string) ?? "BLOCKED_until_Yang_final_manual_ACK",
      meta: payload.meta,
    };
  } catch {
    return null;
  }
}

// ── Lab per-strategy snapshot (Stage 2 charts) ─────────────────────────────
// GET /api/v1/lab/strategy/:strategyId/snapshot
// Response envelope: { data: { schema, strategyId, snapshot: {...}, cache_hit, stale_reason, fetched_at } }
// snapshot field = Athena snapshot_v0 data. Falls back to null (caller handles).

export type LabStrategySnapshotEquityPoint = {
  date: string;
  cumReturn: number;
  drawdown: number;
};

export type LabStrategySnapshotDrawdownPoint = {
  date: string;
  drawdown: number;
  underwaterDays: number;
};

export type LabStrategySnapshotMonthlyBar = {
  yearMonth: string;
  monthReturn: number;
  tradeCount: number;
};

export type LabStrategySnapshotSampleTrade = {
  rebalanceDate: string;
  exitDateApprox: string;
  holdingDays: number;
  holdingCount: number;
  turnover: number;
  grossReturn: number;
  netReturn120bps: number;
  benchmarkReturn: number;
  excessReturn120bps: number;
  rationale: string;
  source: string;
  uiLabel_zh: string;
};

export type LabStrategySnapshotRobustness = {
  horizonSweep: string;
  regimeBandSweep: string;
  costStressSweep: string;
  universeShrinkage: string;
};

export type LabStrategySnapshotHeadlineMetrics = {
  // v46 canonical fields (Codex 5/12 unified common-window)
  strategyNetAbsoluteReturnPct?: number;
  benchmark0050ReturnPct?: number;
  excessVs0050Pp?: number;
  hitRatePct?: number;
  maxDrawdownNetPct?: number;
  maxDrawdownInternalExcessPct?: number;
  estimatedEntryTicketCount?: number;
  // Existing fields
  sharpeAnnualized: number;
  sortinoAnnualized: number;
  maxDrawdown: number;
  maxDrawdownDate?: string;
  winRate: number;
  hitRate: number;
  averageHoldingDays: number;
  robustness: LabStrategySnapshotRobustness;
};

export type LabStrategySnapshot = {
  schema: string;
  strategyId: string;
  displayName: string;
  displayName_zh: string;
  status: string;
  // v46 operational state
  displayMode?: "paper" | "shadow" | "live" | "research_only";
  orderState?: "blocked" | "paper_allowed" | "live_allowed";
  brokerWriteAllowed?: boolean;
  realOrderAllowed?: boolean;
  registryChangeAllowed?: boolean;
  headlineMetrics: LabStrategySnapshotHeadlineMetrics;
  equityCurve: { points: LabStrategySnapshotEquityPoint[] };
  monthlyReturns: { bars: LabStrategySnapshotMonthlyBar[] };
  drawdownSeries?: { points: LabStrategySnapshotDrawdownPoint[] };
  sampleTrades: { entries: LabStrategySnapshotSampleTrade[] };
  spec: {
    capacityCaveat?: string;
    commonWindowStart?: string;
    commonWindowEnd?: string;
  };
  uiCopyHints?: {
    warningBanner_zh?: string;
    commonWindowCaveat_zh?: string;
  };
};

type LabStrategySnapshotApiResponse = {
  schema: string;
  strategyId: string;
  snapshot: LabStrategySnapshot;
  cache_hit: boolean;
  stale_reason: string | null;
  fetched_at: string;
};

export async function getLabStrategySnapshot(
  strategyId: string,
): Promise<LabStrategySnapshot | null> {
  try {
    const res = await request<LabStrategySnapshotApiResponse>(
      `/api/v1/lab/strategy/${encodeURIComponent(strategyId)}/snapshot`,
    );
    const payload = res.data;
    if (!payload || !payload.snapshot) return null;
    return payload.snapshot;
  } catch {
    return null;
  }
}

// Paper orders live in a dedicated no-mock client so both company and portfolio
// order panels share the Contract 1 shape.
export {
  cancelPaperOrder,
  formatPaperOrderError,
  getPaperOrder,
  isCancellablePaperOrder,
  isTerminalPaperOrder,
  listPaperOrders,
  previewPaperOrder,
  submitPaperOrder,
} from "./paper-orders-api";

// ── KGI quote streaming — bid/ask (5-level) + tick stream ───────────────────
// Consumed by BidAskPanel + LiveTickStreamPanel on /companies/[symbol].
// Both endpoints are proxy routes through our Railway API (auth required).
// Hard line: these are read-only consumer functions. No order surface.

export interface KgiBidAskData {
  exchange?: string;
  symbol?: string;
  bid_prices?: number[];
  bid_volumes?: number[];
  ask_prices?: number[];
  ask_volumes?: number[];
  diff_ask_vol?: number[];
  diff_bid_vol?: number[];
  simtrade?: number;
  suspend?: number;
  delay_time?: number;
  odd_lot?: boolean;
  datetime?: string;
  _received_at?: string;
}

export interface KgiTickEntry {
  exchange?: string;
  symbol?: string;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  total_volume?: number;
  chg_type?: number;
  price_chg?: number;
  pct_chg?: number;
  simtrade?: number;
  suspend?: number;
  amount?: number;
  delay_time?: number;
  odd_lot?: boolean;
  datetime?: string;
  _received_at?: string;
}

export interface KgiTicksResult {
  symbol: string;
  ticks: KgiTickEntry[];
  count: number;
  buffer_size: number;
  buffer_used: number;
}

// GET /api/v1/kgi/quote/bidask?symbol=<S>
// Returns null when not available (not subscribed, gateway offline, etc.)
export async function getKgiBidAsk(symbol: string): Promise<KgiBidAskData | null> {
  const qs = new URLSearchParams({ symbol }).toString();
  const res = await request<KgiBidAskData>(`/api/v1/kgi/quote/bidask?${qs}`);
  return res.data ?? null;
}

// GET /api/v1/kgi/quote/ticks?symbol=<S>&limit=<N>
// Returns null when not available.
export async function getKgiTicks(symbol: string, limit = 20): Promise<KgiTicksResult | null> {
  const qs = new URLSearchParams({ symbol, limit: String(limit) }).toString();
  const res = await request<KgiTicksResult>(`/api/v1/kgi/quote/ticks?${qs}`);
  return res.data ?? null;
}

// ── OpenAlice Admin Dashboards ────────────────────────────────────────────────

// D1 — Brain Cost Dashboard

export type LlmUsageSummary = {
  from: string;
  to: string;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  byModel: Array<{ modelKey: string; calls: number; tokens: number; costUsd: number }>;
  byModule: Array<{ callerModule: string; calls: number; tokens: number; costUsd: number }>;
  daily: Array<{ date: string; calls: number; tokens: number; costUsd: number }>;
  disclaimer: string;
};

export type LlmCallEntry = {
  id: string;
  modelKey: string;
  callerModule: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: string;
  latencyMs: number | null;
  status: string;
  errorCode: string | null;
  createdAt: string;
};

export type LlmModelEntry = {
  modelKey: string;
  provider: string;
  displayName: string;
  inputPricePer1mTokens: string;
  outputPricePer1mTokens: string;
  maxContextTokens: number;
  capabilities: unknown;
  isActive: boolean;
};

export async function getAdminLlmUsage(params?: { from?: string; to?: string }) {
  const query = new URLSearchParams();
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  const qs = query.toString();
  return request<LlmUsageSummary>(`/api/v1/admin/llm/usage${qs ? `?${qs}` : ""}`);
}

export async function getAdminLlmCalls(params?: { limit?: number }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<LlmCallEntry[]>(`/api/v1/admin/llm/calls${qs ? `?${qs}` : ""}`);
}

export async function getAdminLlmModels() {
  return request<LlmModelEntry[]>("/api/v1/admin/llm/models");
}

// D2 — EventLog Time-Travel Viewer

export type EventStreamEntry = {
  streamType: string;
  streamId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  eventCount?: number;
};

export type EventLogEntry = {
  id: string;
  streamId: string;
  seq: number;
  eventType: string;
  schemaVersion: number;
  actorId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  recordedAt: string;
};

export type OutboxDiag = {
  pendingCount: number;
  fatalCount: number;
  oldestPendingAt: string | null;
};

export async function getEventStreams(params?: { streamType?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.streamType) query.set("streamType", params.streamType);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<{ streams: EventStreamEntry[]; total: number }>(`/api/v1/event-streams${qs ? `?${qs}` : ""}`);
}

export async function getStreamEvents(
  streamType: string,
  streamId: string,
  params?: { limit?: number; cursor?: number }
) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", String(params.cursor));
  const qs = query.toString();
  return request<{ events: EventLogEntry[]; nextCursor: number | null }>(
    `/api/v1/event-streams/${encodeURIComponent(streamType)}/${encodeURIComponent(streamId)}/events${qs ? `?${qs}` : ""}`
  );
}

export async function getStreamEventsAt(
  streamType: string,
  streamId: string,
  asOf: string
) {
  const qs = new URLSearchParams({ as_of: asOf }).toString();
  return request<{ events: EventLogEntry[]; asOf: string }>(
    `/api/v1/event-streams/${encodeURIComponent(streamType)}/${encodeURIComponent(streamId)}/events/at?${qs}`
  );
}

export async function getOutboxDiag() {
  return request<OutboxDiag>("/api/v1/admin/event-log/outbox/diag");
}

// D3 — Trading-as-Git Portfolio Snapshots

export type PortfolioSnapshotEntry = {
  id: string;
  workspaceId: string;
  trigger: "manual" | "strategy_run" | "eod_auto" | "rollback" | string;
  note: string | null;
  positions: Array<{
    ticker: string;
    shares: number;
    avgCost: number;
    sector?: string;
    lastPrice?: number;
  }>;
  parentId: string | null;
  createdAt: string;
};

export type PortfolioDiffEntry = {
  fromSnapshotId: string;
  toSnapshotId: string;
  added: Array<{ ticker: string; shares: number; avgCost: number }>;
  removed: Array<{ ticker: string; shares: number; avgCost: number }>;
  changed: Array<{ ticker: string; fromShares: number; toShares: number; fromAvgCost: number; toAvgCost: number }>;
};

export async function getPortfolioSnapshots(params?: { limit?: number }) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<{ snapshots: PortfolioSnapshotEntry[]; nextCursor: string | null }>(
    `/api/v1/portfolio/snapshots${qs ? `?${qs}` : ""}`
  );
}

export async function getPortfolioSnapshotById(id: string) {
  return request<PortfolioSnapshotEntry>(`/api/v1/portfolio/snapshots/${encodeURIComponent(id)}`);
}

export async function getPortfolioSnapshotDiff(from: string, to: string) {
  const qs = new URLSearchParams({ from, to }).toString();
  return request<PortfolioDiffEntry>(`/api/v1/portfolio/snapshots/diff?${qs}`);
}

// D4 — ToolCenter Registry Browser

export type ToolRegistryEntry = {
  toolKey: string;
  toolType: string;
  displayName: string;
  description: string | null;
  inputSchema: unknown;
  outputSchema: unknown;
  isActive: boolean;
  version: string;
  createdAt: string;
  updatedAt: string;
};

export type ToolCallEntry = {
  id: string;
  toolKey: string;
  callerType: string;
  workspaceId: string | null;
  status: string;
  inputSummary: string | null;
  outputSummary: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  createdAt: string;
  completedAt: string | null;
};

export type ToolStatEntry = {
  toolKey: string;
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  timeoutCalls: number;
  errorRate: number;
  avgLatencyMs: number | null;
};

export async function getToolRegistry(params?: { toolType?: string; isActive?: boolean }) {
  const query = new URLSearchParams();
  if (params?.toolType) query.set("toolType", params.toolType);
  if (typeof params?.isActive === "boolean") query.set("isActive", String(params.isActive));
  const qs = query.toString();
  return request<{ tools: ToolRegistryEntry[]; total: number }>(`/api/v1/tools/registry${qs ? `?${qs}` : ""}`);
}

export async function getToolCalls(params?: { toolKey?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.toolKey) query.set("toolKey", params.toolKey);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<{ calls: ToolCallEntry[]; total: number }>(`/api/v1/tools/calls${qs ? `?${qs}` : ""}`);
}

export async function getToolStats(params?: { window?: string }) {
  const query = new URLSearchParams();
  if (params?.window) query.set("window", params.window);
  const qs = query.toString();
  return request<{ stats: ToolStatEntry[]; windowMs: number }>(`/api/v1/tools/stats${qs ? `?${qs}` : ""}`);
}

// D5 — UTA Account Manager

export type BrokerAdapterEntry = {
  adapterKey: string;
  displayName: string;
  capabilities: {
    oddLot?: boolean;
    marginTrading?: boolean;
    shortSelling?: boolean;
    afterHoursFixing?: boolean;
    simModeAvailable?: boolean;
    maxSubscriptions?: number;
  };
  isActive: boolean;
};

export type UnifiedOrderEntry = {
  id: string;
  workspaceId: string;
  adapterKey: string;
  symbol: string;
  side: string;
  quantity: number;
  quantityUnit: string;
  orderType: string;
  limitPrice: number | null;
  status: string;
  simOnly: boolean;
  externalOrderId: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getUtaAdapters() {
  return request<{ adapters: BrokerAdapterEntry[] }>("/api/v1/uta/adapters");
}

export async function getUtaOrders(params?: { accountId?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.accountId) query.set("accountId", params.accountId);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request<{ orders: UnifiedOrderEntry[]; total: number }>(`/api/v1/uta/orders${qs ? `?${qs}` : ""}`);
}
