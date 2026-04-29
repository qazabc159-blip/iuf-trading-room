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
  RiskLimit, SessionMeta, OrderTicket, OrderPreview, OrderAck,
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
  previewOrder as mockPreviewOrder,
  submitOrder as mockSubmitOrder,
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
  if (!BASE) return fallback;
  if (IS_BUILD) return fallback;
  try {
    const r = await fetch(`${BASE}${path}`, { next: { revalidate: 30 } });
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
async function mockOnly<T>(fallback: T | (() => T | Promise<T>)): Promise<T> {
  if (typeof fallback === "function") return await (fallback as () => T | Promise<T>)();
  return fallback;
}

async function post<TIn, TOut>(path: string, body: TIn, fallback: () => TOut | Promise<TOut>): Promise<TOut> {
  if (!BASE) return await fallback();
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    publish("LIVE");
    return (await r.json()) as TOut;
  } catch (e) {
    publish("OFFLINE");
    if (IS_PROD) throw e instanceof Error ? e : new Error(String(e));
    console.warn("[api · dev] mock-fallback POST:", path, e);
    return await fallback();
  }
}

export const api = {
  // GETs — backend-matched paths (apps/api/src/server.ts)
  session:    () => get<SessionMeta>("/api/v1/session", mockSessionMeta),
  themes:     () => get<Theme[]>("/api/v1/themes", mockThemes),
  companies:  () => get<Company[]>("/api/v1/companies", mockCompanies),
  // company(s): RADAR uses :symbol, backend uses :id (uuid). Force MOCK until symbol-resolver wired.
  company:    (s: string) => mockOnly<Company | null>(mockCompanies.find(c => c.symbol === s) ?? null),
  ideas:      () => get<Idea[]>("/api/v1/strategy/ideas", mockIdeas),
  runs:       () => get<Run[]>("/api/v1/strategy/runs", mockRuns),
  run:        (id: string) => get<Run | null>(`/api/v1/strategy/runs/${encodeURIComponent(id)}`,
                  mockRuns.find(r => r.id === id) ?? null),
  // ideasByRun: no /strategy/runs/:id/ideas endpoint. Force MOCK; tracked for backend.
  ideasByRun: (id: string) => mockOnly<Idea[]>(mockIdeas.filter(i => i.runId === id)),
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
  // opsActivity: no /api/v1/ops/activity endpoint. Force MOCK; tracked for backend.
  opsActivity:  () => mockOnly<ActivityEvent[]>(mockActivityEvents),
  opsAudit:     () => get<AuditEvent[]>("/api/v1/audit-logs", mockAuditEvents),
  opsAuditSum:  () => get<AuditSummary>("/api/v1/audit-logs/summary", mockAuditSummary),

  // Plans — backend has /api/v1/briefs + /api/v1/reviews but bundle shapes differ. Force MOCK.
  brief:        () => mockOnly<BriefBundle>(mockBrief),
  review:       () => mockOnly<ReviewBundle>(mockReview),
  weeklyPlan:   () => mockOnly<WeeklyPlan>(mockWeekly),

  // POSTs
  // killMode: backend is /api/v1/risk/kill-switch with different body shape (killSwitchInputSchema).
  // Force MOCK to preserve UI state machine; W6 hard line: kill-switch ARMED state untouched in this PR.
  killMode: (mode: KillMode) =>
    mockOnly<{ ok: true; mode: KillMode }>({ ok: true, mode }),

  // previewOrder: no /api/v1/paper/orders/preview backend route. Force MOCK; tracked for Jason.
  previewOrder: (t: OrderTicket) => mockOnly<OrderPreview>(() => mockPreviewOrder(t)),

  // submitOrder: /api/v1/paper/orders is W6 paper sprint live route (apps/api line 2679).
  submitOrder: (t: OrderTicket) =>
    post<OrderTicket, OrderAck>("/api/v1/paper/orders", t, () => mockSubmitOrder(t)),
};

/** SSE URL for execution-event stream. Component reconnects with exp backoff. */
export function executionStreamUrl(): string | null {
  return BASE ? `${BASE}/api/v1/trading/stream` : null;
}
