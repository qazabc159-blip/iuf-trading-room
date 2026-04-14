import type {
  AppSession,
  Company,
  CompanyCreateInput,
  DailyBrief,
  DailyBriefCreateInput,
  ReviewEntry,
  ReviewEntryCreateInput,
  Signal,
  SignalCreateInput,
  Theme,
  ThemeCreateInput,
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
