import type {
  AppSession,
  Company,
  CompanyCreateInput,
  CompanyDuplicateReport,
  CompanyGraphSearchResult,
  CompanyGraphStats,
  CompanyGraphView,
  DailyBrief,
  DailyBriefCreateInput,
  ReviewEntry,
  ReviewEntryCreateInput,
  Signal,
  SignalCreateInput,
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
