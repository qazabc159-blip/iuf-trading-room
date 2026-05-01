/**
 * API client — single import surface.
 *
 * Behavior:
 *   • NEXT_PUBLIC_API_BASE_URL empty → use mocks (always).
 *   • NEXT_PUBLIC_API_BASE_URL set + dev → fetch, fallback to mock with console.warn.
 *   • NEXT_PUBLIC_API_BASE_URL set + prod → fetch, THROW on failure.
 *     UI shows the OFFLINE state via DataSourceBadge.
 *
 * The DataSource state machine is published via the `__iuf_data_source` window
 * event so DataSourceBadge can render LIVE / MOCK / OFFLINE.
 */
import type {
  Theme, Company, Idea, Run, Signal, Quote, Position,
  RiskLimit, SessionMeta,
  ExecutionEvent, KillMode, StrategyRiskLimit, SymbolRiskLimit,
  OpsSystem, ActivityEvent, AuditEvent, AuditSummary,
  BriefBundle, ReviewBundle, WeeklyPlan,
} from "./radar-types";
import {
  themes as mockThemes,
  companies as mockCompanies,
  ideas as mockIdeas,
  runs as mockRuns,
  signals as mockSignals,
  quotes as mockQuotes,
  positions as mockPositions,
  riskLimits as mockRiskLimits,
  sessionMeta as mockSessionMeta,
  executionEvents as mockExecutionEvents,
  strategyLimits as mockStrategyLimits,
  symbolLimits as mockSymbolLimits,
  opsSystem as mockOpsSystem,
  activityEvents as mockActivityEvents,
  auditEvents as mockAuditEvents,
  auditSummary as mockAuditSummary,
  briefBundle as mockBrief,
  reviewBundle as mockReview,
  weeklyPlan as mockWeekly,
} from "./radar-mocks";

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const IS_PROD = process.env.NODE_ENV === "production";
// At Next.js production build time there is no auth cookie, so calls to
// authenticated endpoints (e.g. /api/v1/themes for generateStaticParams) get
// 401. Fall through to mocks during the build — runtime browser still hits live.
const IS_BUILD = process.env.NEXT_PHASE === "phase-production-build";

export type DataSourceState = "MOCK" | "LIVE" | "OFFLINE";

/** Track the worst state seen this session. OFFLINE is sticky until a successful fetch resets it. */
let _state: DataSourceState = BASE ? "LIVE" : "MOCK";
function publish(s: DataSourceState) {
  if (s === _state) return;
  _state = s;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("__iuf_data_source", { detail: s }));
  }
}
export function getDataSourceState(): DataSourceState {
  return BASE ? _state : "MOCK";
}

async function get<T>(path: string, fallback: T): Promise<T> {
  if (!BASE) {
    if (IS_PROD && !IS_BUILD) throw new Error(`NEXT_PUBLIC_API_BASE_URL is not configured for ${path}`);
    return fallback;
  }
  if (IS_BUILD) return fallback;

  // SSR (server component) calls don't get the browser's cookie automatically.
  // Forward the incoming request's Cookie header so authenticated endpoints work.
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

  try {
    const init: RequestInit & { next?: { revalidate: number } } = ssrCookie
      ? { headers: { Cookie: ssrCookie }, cache: "no-store" }
      : { next: { revalidate: 30 } };
    const r = await fetch(`${BASE}${path}`, init);
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    publish("LIVE");
    // All apps/api endpoints return { data: T } — unwrap the envelope.
    const json = await r.json();
    return (json && typeof json === "object" && "data" in json ? json.data : json) as T;
  } catch (e) {
    publish("OFFLINE");
    if (IS_PROD) {
      // In production we surface the failure. The component layer must handle it.
      throw e instanceof Error ? e : new Error(String(e));
    }
    console.warn("[api · dev] falling back to mock:", path, e);
    return fallback;
  }
}

/**
 * Force-mock helper — for endpoints that have no backend equivalent yet.
 * Bypasses fetch entirely so prod deploys never see OFFLINE state from these.
 * Tracked for backend coverage in evidence/path_b_w2a_20260426/pr21_api_gap.md.
 */
async function mockOnly<T>(fallback: T | (() => T | Promise<T>), label = "mockOnly"): Promise<T> {
  if (IS_PROD && !IS_BUILD) throw new Error(`${label} cannot use mock-only fallback in production`);
  if (typeof fallback === "function") return await (fallback as () => T | Promise<T>)();
  return fallback;
}

export const api = {
  // GETs — backend-matched paths (apps/api/src/server.ts)
  session:    () => get<SessionMeta>("/api/v1/session", mockSessionMeta),
  themes:     () => get<Theme[]>("/api/v1/themes", mockThemes),
  companies:  () => get<Company[]>("/api/v1/companies", mockCompanies),
  // company(s): RADAR uses :symbol, backend uses :id (uuid).
  // W7 L6: fetch all companies and find by symbol client-side.
  // get<T> returns T (already unwrapped from envelope), so here T=Company[] and we find by symbol.
  company:    (s: string) => get<Company[]>("/api/v1/companies", mockCompanies).then(
    (all) => (Array.isArray(all) ? all.find(c => c.symbol === s) ?? null : null)
  ).catch((error) => {
    if (IS_PROD && !IS_BUILD) throw error;
    return mockCompanies.find(c => c.symbol === s) ?? null;
  }),
  ideas:      () => get<Idea[]>("/api/v1/strategy/ideas", mockIdeas),
  runs:       () => get<Run[]>("/api/v1/strategy/runs", mockRuns),
  run:        (id: string) => get<Run | null>(`/api/v1/strategy/runs/${encodeURIComponent(id)}`,
                  mockRuns.find(r => r.id === id) ?? null),
  // ideasByRun: wired to /strategy/runs/:id/ideas (added PR #22 item 2).
  ideasByRun: (id: string) => get<Idea[]>(`/api/v1/strategy/runs/${encodeURIComponent(id)}/ideas`,
    mockIdeas.filter(i => i.runId === id)),
  signals:    () => get<Signal[]>("/api/v1/signals", mockSignals),
  quotes:     () => get<Quote[]>("/api/v1/market-data/quotes", mockQuotes),
  positions:  () => get<Position[]>("/api/v1/trading/positions", mockPositions),
  riskLimits: () => get<RiskLimit[]>("/api/v1/risk/limits", mockRiskLimits),

  executionEvents: (sinceISO?: string) =>
    get<ExecutionEvent[]>(`/api/v1/trading/events${sinceISO ? `?since=${encodeURIComponent(sinceISO)}` : ""}`,
      mockExecutionEvents),

  strategyLimits: () => get<StrategyRiskLimit[]>("/api/v1/risk/strategy-limits", mockStrategyLimits),
  symbolLimits:   () => get<SymbolRiskLimit[]>("/api/v1/risk/symbol-limits", mockSymbolLimits),

  // Ops
  opsSystem:    () => get<OpsSystem>("/api/v1/ops/snapshot", mockOpsSystem),
  // opsActivity: wired to /api/v1/ops/activity (added PR #22 item 3). W7 L6: remove mockOnly.
  opsActivity:  () => get<ActivityEvent[]>("/api/v1/ops/activity", mockActivityEvents),
  opsAudit:     () => get<AuditEvent[]>("/api/v1/audit-logs", mockAuditEvents),
  opsAuditSum:  () => get<AuditSummary>("/api/v1/audit-logs/summary", mockAuditSummary),

  // Plans — wired to /api/v1/plans/{brief,review,weekly} (PR #22 item 4 + W7 L6 compose pass).
  brief:        () => get<BriefBundle>("/api/v1/plans/brief", mockBrief),
  review:       () => get<ReviewBundle>("/api/v1/plans/review", mockReview),
  weeklyPlan:   () => get<WeeklyPlan>("/api/v1/plans/weekly", mockWeekly),

  // POSTs
  // killMode: HARD LINE — kill-switch ARMED state machine must not be toggled from UI via backend.
  // Remains mockOnly to preserve frontend-only UI state machine semantics.
  // Backend /api/v1/portfolio/kill-mode exists but routes through setKillSwitchState which mutates
  // ARMED state — not safe to wire until operator-gate review is done.
  killMode: (mode: KillMode) =>
    mockOnly<{ ok: true; mode: KillMode }>({ ok: true, mode }, "killMode"),

  // Paper order preview/submit moved to lib/paper-orders-api.ts. Keeping this
  // legacy surface free of order methods prevents mock-shaped payloads from
  // reaching the Contract 1 paper endpoints.
};

/** SSE URL for execution-event stream. Component reconnects with exp backoff. */
export function executionStreamUrl(): string | null {
  return BASE ? `${BASE}/api/v1/trading/stream` : null;
}
