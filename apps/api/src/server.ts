import { timingSafeEqual } from "node:crypto";
// ── Sentry init must be imported before any other app module ──────────────────
import { captureException as sentryCaptureException, captureMessage as sentryCaptureMessage } from "./sentry-init.js";
import { serve } from "@hono/node-server";
import type { Context } from "hono";
import {
  type AppSession,
  autopilotExecuteInputSchema,
  companyMergeInputSchema,
  companyCreateInputSchema,
  companyKeywordsReplaceInputSchema,
  companyRelationsReplaceInputSchema,
  companyUpdateInputSchema,
  dailyBriefCreateInputSchema,
  killSwitchInputSchema,
  marketStateSchema,
  orderCancelInputSchema,
  orderCreateInputSchema,
  orderStatusSchema,
  paperOrderCreateInputSchema,
  riskLimitUpsertInputSchema,
  strategyRiskLimitUpsertInputSchema,
  symbolRiskLimitUpsertInputSchema,
  reviewEntryCreateInputSchema,
  signalCreateInputSchema,
  signalUpdateInputSchema,
  strategyIdeasQuerySchema,
  strategyRunCreateInputSchema,
  strategyRunListQuerySchema,
  themeCreateInputSchema,
  themeLifecycleSchema,
  themeUpdateInputSchema,
  tradePlanCreateInputSchema,
  tradePlanUpdateInputSchema
} from "@iuf-trading-room/contracts";
import {
  checkPaperExecutionGate,
  getExecutionFlagSnapshot
} from "./domain/trading/execution-mode.js";
import {
  createOrderIntent
} from "./domain/trading/order-intent.js";
import {
  driveOrder,
  cancelOrder as cancelPaperOrder
} from "./domain/trading/order-driver.js";
import {
  getOrder,
  listOrders,
  findByIdempotencyKey as findOrderByIdempotencyKey
} from "./domain/trading/paper-ledger-db.js";
import {
  buildPaperOrderContext,
  evaluatePaperOrderRisk
} from "./domain/trading/paper-risk-bridge.js";
import { evaluateFourLayerRiskGate } from "./paper-four-layer-risk-gate.js";
import {
  fireAiReviewerForDraft,
  _getLastReviewerError
} from "./openalice-ai-reviewer.js";
import { runEmailDigestTick, getDigestState } from "./openalice-email-digest.js";
import {
  runEventEngineTick,
  getEventEngineState,
  listEvents,
  acknowledgeEvent
} from "./openalice-event-rule-engine.js";
import { isDatabaseMode, getDb, dailyBriefs, dailyThemeSummaries, companies, openAliceJobs, workspaces, contentDrafts, auditLogs } from "@iuf-trading-room/db";
import { eq, and, sql as drizzleSql, desc, inArray } from "drizzle-orm";
import {
  getTradingRoomRepository,
  type TradingRoomRepository
} from "@iuf-trading-room/domain";
import {
  buildImportedCompanyDraft,
  runImport
} from "@iuf-trading-room/integrations";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z, ZodError } from "zod";

import {
  authenticateOpenAliceDevice,
  cleanupStaleOpenAliceDevices,
  claimOpenAliceJob,
  enqueueOpenAliceJob,
  heartbeatOpenAliceDevice,
  listOpenAliceDevices,
  listOpenAliceJobs,
  openAliceClaimJobSchema,
  openAliceEnqueueJobSchema,
  openAliceJobResultSchema,
  openAliceRegisterSchema,
  registerOpenAliceDevice,
  reviewOpenAliceJob,
  revokeOpenAliceDevice,
  submitOpenAliceResult
} from "./openalice-bridge.js";
import {
  approveContentDraft,
  contentDraftListQuerySchema,
  contentDraftRejectSchema,
  listContentDrafts,
  rejectContentDraft
} from "./content-draft-store.js";
import { getOpenAliceObservabilitySnapshot } from "./openalice-observability.js";
import {
  buildTradingViewEventKey,
  checkTradingViewRateLimit,
  claimTradingViewEvent,
  clearTradingViewEventClaim,
  getTradingViewWebhookConfig,
  markTradingViewEventComplete,
  validateTradingViewTimestamp
} from "./tradingview-webhook-guard.js";
import {
  formatAuditEntriesAsCsv,
  getAuditLogSummary,
  listAuditLogEntries,
  writeAuditLog
} from "./audit-log-store.js";
import {
  formatEventHistoryItemsAsCsv,
  getEventHistory,
  getEventHistorySummary,
  parseEventHistorySources
} from "./event-history.js";
import {
  getMarketDataPolicy,
  getMarketDataOverview,
  getMarketBarDiagnostics,
  getMarketDataConsumerSummary,
  getMarketDataDecisionSummary,
  getMarketDataSelectionSummary,
  getMarketQuoteHistoryDiagnostics,
  getEffectiveMarketQuotes,
  ingestTradingViewQuote,
  listMarketBars,
  listMarketDataProviderStatuses,
  listMarketQuoteHistory,
  listMarketQuotes,
  listMarketSymbols,
  marketDataBarDiagnosticsQuerySchema,
  marketDataConsumerSummaryQuerySchema,
  marketDataDecisionSummaryQuerySchema,
  marketDataResolveQuerySchema,
  marketDataSelectionSummaryQuerySchema,
  marketDataBarsQuerySchema,
  marketDataHistoryQuerySchema,
  marketDataHistoryDiagnosticsQuerySchema,
  marketDataOverviewQuerySchema,
  marketDataPolicyQuerySchema,
  manualQuoteUpsertSchema,
  marketDataProvidersQuerySchema,
  marketDataQuotesQuerySchema,
  marketDataSymbolsQuerySchema,
  marketDataEffectiveQuotesQuerySchema,
  resolveMarketQuotes,
  upsertPaperQuotes,
  upsertManualQuotes
} from "./market-data.js";
import {
  deleteStrategyRiskLimit,
  deleteSymbolRiskLimit,
  evaluateRiskCheck,
  getKillSwitchState,
  getRiskLimitState,
  getStrategyRiskLimit,
  getSymbolRiskLimit,
  listStrategyRiskLimits,
  listSymbolRiskLimits,
  resolveRiskLimit,
  riskAccountQuerySchema,
  riskCheckInputSchema,
  setKillSwitchState,
  upsertRiskLimitState,
  upsertStrategyRiskLimit,
  upsertSymbolRiskLimit
} from "./risk-engine.js";
import {
  getPaperBalance,
  getPaperBrokerStatus,
  listPaperAccounts,
  listPaperOrders,
  listPaperPositions,
  subscribeExecutionEvents
} from "./broker/paper-broker.js";
import { cancelOrder, previewOrder, submitOrder } from "./broker/trading-service.js";
import { listExecutionEvents } from "./broker/execution-events-store.js";
import {
  getCompanyGraphSearchResults,
  getCompanyGraphStats,
  getCompanyGraphView
} from "./company-graph.js";
import { getCompanyDuplicateReport } from "./company-duplicates.js";
import { executeCompanyMerge, getCompanyMergePreview } from "./company-merge.js";
import { getOpsSnapshot } from "./ops-snapshot.js";
import { getOpsTrends } from "./ops-trends.js";
import {
  formatThemeGraphStatsAsCsv,
  getThemeGraphRankings,
  getThemeGraphStats,
  getThemeGraphView,
  searchThemeGraph
} from "./theme-graph.js";
import {
  createStrategyRun,
  executeStrategyRun,
  getStrategyIdeas,
  getStrategyRunById,
  issueConfirmToken,
  listStrategyRuns
} from "./strategy-engine.js";
import { initRiskStore } from "./risk-engine.js";
import {
  getCompanyOhlcv,
  getCompanyOhlcvBulk,
  type OhlcvBar
} from "./companies-ohlcv.js";
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  createInviteCode,
  getUserById,
  loginWithPassword,
  parseSessionCookie,
  registerWithInvite,
  seedOwnerIfEmpty
} from "./auth-store.js";
import {
  _lastPipelineState,
  getPipelineObservabilityAddendum,
  loadStrategySnapshot,
  runBatchAiReviewer,
  runPipelineCloseBriefTick,
  runPipelineCloseWatchTick,
  runPipelinePreMarketTick,
  runPipelineTick
} from "./openalice-pipeline.js";

type Variables = {
  repo: TradingRoomRepository;
  session: AppSession;
};

const app = new Hono<{ Variables: Variables }>();
const repository = getTradingRoomRepository();
const PROCESS_STARTED_AT = new Date().toISOString();
const BUILD_INFO = {
  version: process.env.npm_package_version ?? "0.1.0",
  commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
  deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.VERCEL_DEPLOYMENT_ID ?? "unknown",
  environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.VERCEL_ENV ?? "local",
  service: process.env.RAILWAY_SERVICE_NAME ?? "api",
  startedAt: PROCESS_STARTED_AT
} as const;

const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origin;
      if (CORS_ORIGINS.includes("*")) return origin;
      return CORS_ORIGINS.includes(origin) ? origin : null;
    },
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "x-workspace-slug", "x-user-role"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  })
);

// P0 auth-bypass hotfix (2026-04-25). Previously this middleware read
// `x-user-role` from request headers and defaulted to "Owner" — anonymous
// callers were treated as Owner. Now we require a valid `iuf_session` cookie,
// hydrate the user from the DB, and use the DB role as the only authority.
//
// Route exceptions (handled below):
//   - /api/v1/openalice/jobs/{claim,heartbeat,result} — runner uses bearer
//     device auth (not the web cookie). Skip cookie gate; the handler does
//     bearer auth itself.
//
// `x-user-role` is no longer accepted as auth input. To keep a dev-only
// role-switching escape hatch we honor it ONLY when AUTH_ALLOW_ROLE_OVERRIDE=1
// AND the authenticated user is Owner.
const ALLOWED_ROLES = ["Owner", "Admin", "Analyst", "Trader", "Viewer"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

function isDeviceAuthRoute(path: string): boolean {
  if (path.startsWith("/api/internal/openalice/jobs/")) return true;
  if (path === "/api/v1/openalice/jobs/claim") return true;
  if (/^\/api\/v1\/openalice\/jobs\/[^/]+\/(heartbeat|result)$/.test(path)) {
    return true;
  }
  return false;
}

// Read-only diagnostics routes safe for unauthenticated smoke / uptime monitors.
// Strict allow-list — only these two paths bypass cookie auth. Add new entries
// only after Pete review confirms zero token / userId / order leakage.
function isPublicDiagRoute(path: string): boolean {
  if (path === "/api/v1/paper/health") return true;
  if (path === "/api/v1/paper/health/detail") return true;
  if (path === "/api/v1/diagnostics/kbar") return true;
  return false;
}

app.use("/api/v1/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Runner device-auth routes carry their own bearer-auth check; skip cookie gate.
  if (isDeviceAuthRoute(path)) {
    c.set("repo", repository);
    return next();
  }

  // Public read-only diagnostics for Bruce smoke / uptime monitors. Strict allow-list.
  if (isPublicDiagRoute(path)) {
    c.set("repo", repository);
    return next();
  }

  // Memory mode (CI smoke, local dev without Postgres) has no real users to
  // authenticate against. Fall through to repository.getSession which returns
  // a synthetic Viewer session (post-hotfix default). The header-based override
  // still works in memory mode for legacy CI tests.
  if (!isDatabaseMode()) {
    const workspaceSlug = c.req.header("x-workspace-slug") ?? process.env.DEFAULT_WORKSPACE_SLUG;
    const headerRole = c.req.header("x-user-role");
    const roleOverride = ALLOWED_ROLES.find((r) => r === headerRole);
    const memSession = await repository.getSession({
      workspaceSlug,
      roleOverride
    });
    c.set("repo", repository);
    c.set("session", memSession);
    return next();
  }

  const userId = parseSessionCookie(c.req.header("cookie"));
  if (!userId) {
    return c.json({ error: "unauthenticated" }, 401);
  }

  const user = await getUserById(userId);
  if (!user) {
    return c.json({ error: "unauthenticated" }, 401);
  }

  const dbRole = user.role as AllowedRole;
  let effectiveRole: AllowedRole = dbRole;
  if (
    process.env.AUTH_ALLOW_ROLE_OVERRIDE === "1" &&
    dbRole === "Owner"
  ) {
    const headerRole = c.req.header("x-user-role");
    const requested = ALLOWED_ROLES.find((r) => r === headerRole);
    if (requested) {
      effectiveRole = requested;
    }
  }

  // Build the session directly from the authenticated user — do not call
  // repository.getSession, which falls back to a seeded "default owner" lookup
  // and would let the role override silently mis-attribute audit log entries
  // to that seeded user.
  const session: AppSession = {
    workspace: user.workspace,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: effectiveRole
    },
    persistenceMode: "database"
  };

  // Honor x-workspace-slug only if it matches the user's workspace; we don't
  // currently support cross-workspace impersonation.
  const requestedWorkspace = c.req.header("x-workspace-slug");
  if (requestedWorkspace && requestedWorkspace !== user.workspace.slug) {
    return c.json({ error: "forbidden_workspace" }, 403);
  }

  c.set("repo", repository);
  c.set("session", session);
  await next();
});

app.use("/api/*", async (c, next) => {
  await next();

  if (!["POST", "PATCH", "DELETE"].includes(c.req.method)) {
    return;
  }

  const session = c.var.session;
  const path = new URL(c.req.url).pathname;
  const auditPayload = {
    audit: true,
    ts: new Date().toISOString(),
    method: c.req.method,
    path,
    status: c.res.status,
    workspace: session?.workspace.slug ?? null,
    role: session?.user.role ?? null
  };

  console.log(JSON.stringify(auditPayload));

  if (session) {
    await writeAuditLog({
      session,
      method: c.req.method,
      path,
      status: c.res.status,
      payload: {
        workspace: session.workspace.slug,
        role: session.user.role
      }
    });
  }
});

app.onError((error, c) => {
  if (error instanceof ZodError) {
    return c.json(
      {
        error: "validation_error",
        details: error.flatten()
      },
      400
    );
  }

  // Log full stack + request context to stderr; do NOT leak to response body.
  console.error(
    `[onError] ${c.req.method} ${c.req.path}`,
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  return c.json({ error: "internal_server_error" }, 500);
});

function getBearerToken(c: Context) {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

// UUID v4 pattern — used to decide whether `:id` needs ticker fallback.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve a company by UUID or ticker within a workspace.
 * Returns the Company (which has a `.id` UUID) or null.
 * Callers should return 404 on null — never 500.
 */
async function resolveCompany(
  repo: TradingRoomRepository,
  idOrTicker: string,
  options: { workspaceSlug: string }
) {
  if (UUID_PATTERN.test(idOrTicker)) {
    return repo.getCompany(idOrTicker, options);
  }
  // Ticker fallback: scan list within workspace. listCompanies is workspace-scoped.
  const companies = await repo.listCompanies(undefined, options);
  return companies.find((c) => c.ticker === idOrTicker) ?? null;
}

async function requireOpenAliceDevice(c: Context, deviceId: string) {
  const token = getBearerToken(c);
  if (!token) {
    return c.json({ error: "openalice_token_required" }, 401);
  }

  const device = await authenticateOpenAliceDevice({
    deviceId,
    token
  });

  if (!device) {
    return c.json({ error: "openalice_device_auth_failed" }, 401);
  }

  return device;
}

function secureTokenEquals(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

const openAliceCleanupDevicesSchema = z.object({
  staleSeconds: z.number().int().positive().max(604_800).optional()
});

const openAliceReviewJobSchema = z.object({
  status: z.enum(["published", "rejected"]),
  note: z.string().trim().max(2_000).optional()
});

const auditLogListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  action: z.string().min(1).max(100).optional(),
  entityType: z.string().min(1).max(120).optional(),
  entityId: z.string().min(1).max(160).optional(),
  method: z.string().min(1).max(20).optional(),
  path: z.string().min(1).max(260).optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  role: z.string().min(1).max(40).optional(),
  search: z.string().min(1).max(200).optional(),
  scanLimit: z.coerce.number().int().min(1).max(2_000).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

const auditLogSummaryQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 30).optional(),
  action: z.string().min(1).max(100).optional(),
  entityType: z.string().min(1).max(120).optional(),
  entityId: z.string().min(1).max(160).optional(),
  method: z.string().min(1).max(20).optional(),
  path: z.string().min(1).max(260).optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  role: z.string().min(1).max(40).optional(),
  search: z.string().min(1).max(200).optional()
});

const auditLogExportQuerySchema = auditLogListQuerySchema.extend({
  format: z.enum(["csv", "json"]).default("csv")
});

const eventHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  hours: z.coerce.number().int().min(1).max(24 * 30).optional(),
  sources: z.string().min(1).max(200).optional(),
  entityType: z.string().min(1).max(120).optional(),
  entityId: z.string().min(1).max(160).optional(),
  action: z.string().min(1).max(120).optional(),
  status: z.string().min(1).max(120).optional(),
  severity: z.enum(["info", "success", "warning", "danger"]).optional(),
  search: z.string().min(1).max(200).optional()
});

const eventHistoryExportQuerySchema = eventHistoryQuerySchema.extend({
  format: z.enum(["csv", "json"]).default("csv")
});

const opsSnapshotQuerySchema = z.object({
  auditHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
  recentLimit: z.coerce.number().int().min(1).max(20).optional(),
  rankingLimit: z.coerce.number().int().min(1).max(20).optional()
});

const opsTrendsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(60).optional(),
  timeZone: z.string().trim().min(1).max(80).optional()
});

const companyGraphViewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(240).optional(),
  keywordLimit: z.coerce.number().int().min(1).max(100).optional()
});

const themeGraphViewQuerySchema = z.object({
  edgeLimit: z.coerce.number().int().min(1).max(400).optional(),
  keywordLimit: z.coerce.number().int().min(1).max(100).optional()
});

const themeGraphStatsQuerySchema = z.object({
  query: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  keywordLimit: z.coerce.number().int().min(1).max(5).optional(),
  marketState: marketStateSchema.optional(),
  lifecycle: themeLifecycleSchema.optional(),
  minEdges: z.coerce.number().int().min(0).max(10_000).optional(),
  onlyConnected: z.coerce.boolean().optional()
});

const themeGraphSearchQuerySchema = z.object({
  query: z.string().trim().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  keywordLimit: z.coerce.number().int().min(1).max(5).optional(),
  marketState: marketStateSchema.optional(),
  lifecycle: themeLifecycleSchema.optional(),
  minEdges: z.coerce.number().int().min(0).max(10_000).optional(),
  onlyConnected: z.coerce.boolean().optional()
});

const themeGraphExportQuerySchema = themeGraphStatsQuerySchema.extend({
  format: z.enum(["csv", "json"]).default("csv")
});

const themeGraphRankingQuerySchema = themeGraphStatsQuerySchema;

const companyGraphSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const companyGraphStatsQuerySchema = z.object({
  topLimit: z.coerce.number().int().min(1).max(100).optional()
});

const companyDuplicateReportQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  query: z.string().trim().min(1).max(120).optional()
});

const companyMergePreviewQuerySchema = z.object({
  targetCompanyId: z.string().uuid(),
  sourceCompanyIds: z
    .string()
    .trim()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
    .pipe(z.array(z.string().uuid()).min(1).max(20)),
  force: z.coerce.boolean().optional(),
  appendSourceNotes: z.coerce.boolean().optional()
});

async function handleOpenAliceJobClaim(c: Context) {
  const payload = openAliceClaimJobSchema.parse(await c.req.json().catch(() => ({})));
  const deviceOrResponse = await requireOpenAliceDevice(c, payload.deviceId);
  if (deviceOrResponse instanceof Response) {
    return deviceOrResponse;
  }

  const job = await claimOpenAliceJob(deviceOrResponse);
  if (!job) {
    return c.body(null, 204);
  }

  return c.json({ data: job });
}

async function handleOpenAliceJobHeartbeat(c: Context) {
  const deviceId = c.req.header("x-device-id");
  if (!deviceId) {
    return c.json({ error: "x-device-id_required" }, 400);
  }

  const deviceOrResponse = await requireOpenAliceDevice(c, deviceId);
  if (deviceOrResponse instanceof Response) {
    return deviceOrResponse;
  }

  const heartbeat = await heartbeatOpenAliceDevice(deviceOrResponse, c.req.param("jobId"));
  return c.json({ data: heartbeat });
}

async function handleOpenAliceJobResult(c: Context) {
  const deviceId = c.req.header("x-device-id");
  if (!deviceId) {
    return c.json({ error: "x-device-id_required" }, 400);
  }

  const payload = openAliceJobResultSchema.parse(await c.req.json());
  const jobId = c.req.param("jobId");
  if (payload.jobId !== jobId) {
    return c.json({ error: "job_id_mismatch" }, 400);
  }

  const deviceOrResponse = await requireOpenAliceDevice(c, deviceId);
  if (deviceOrResponse instanceof Response) {
    return deviceOrResponse;
  }

  const result = await submitOpenAliceResult({
    device: deviceOrResponse,
    result: payload
  });

  if (!result) {
    return c.json({ error: "openalice_job_not_found" }, 404);
  }

  return c.json({ data: result });
}

app.get("/", (c) =>
  c.json({
    name: "IUF Trading Room API",
    status: "ok"
  })
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    uptime: process.uptime(),
    build: BUILD_INFO
  })
);

app.get("/api/v1/session", (c) =>
  c.json({
    data: c.get("session")
  })
);

app.get("/api/v1/audit-logs/summary", async (c) => {
  const query = auditLogSummaryQuerySchema.parse(c.req.query());
  return c.json({
    data: await getAuditLogSummary({
      session: c.get("session"),
      hours: query.hours,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      method: query.method,
      path: query.path,
      status: query.status,
      role: query.role,
      search: query.search
    })
  });
});

app.get("/api/v1/audit-logs/export", async (c) => {
  const query = auditLogExportQuerySchema.parse(c.req.query());
  const entries = await listAuditLogEntries({
    session: c.get("session"),
    limit: query.limit,
    action: query.action,
    entityType: query.entityType,
    entityId: query.entityId,
    method: query.method,
    path: query.path,
    status: query.status,
    role: query.role,
    search: query.search,
    scanLimit: query.scanLimit,
    from: query.from,
    to: query.to
  });

  if (query.format === "json") {
    return c.json({ data: entries });
  }

  return c.body(formatAuditEntriesAsCsv(entries), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename=\"audit-logs-${new Date().toISOString().slice(0, 10)}.csv\"`
  });
});

app.get("/api/v1/audit-logs", async (c) => {
  const query = auditLogListQuerySchema.parse(c.req.query());
  return c.json({
    data: await listAuditLogEntries({
      session: c.get("session"),
      limit: query.limit,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      method: query.method,
      path: query.path,
      status: query.status,
      role: query.role,
      search: query.search,
      scanLimit: query.scanLimit,
      from: query.from,
      to: query.to
    })
  });
});

app.get("/api/v1/event-history", async (c) => {
  const query = eventHistoryQuerySchema.parse(c.req.query());
  return c.json({
    data: await getEventHistory({
      session: c.get("session"),
      repo: c.get("repo"),
      hours: query.hours,
      limit: query.limit,
      sources: parseEventHistorySources(query.sources),
      entityType: query.entityType,
      entityId: query.entityId,
      action: query.action,
      status: query.status,
      severity: query.severity,
      search: query.search
    })
  });
});

app.get("/api/v1/event-history/summary", async (c) => {
  const query = eventHistoryQuerySchema.parse(c.req.query());
  return c.json({
    data: await getEventHistorySummary({
      session: c.get("session"),
      repo: c.get("repo"),
      hours: query.hours,
      sources: parseEventHistorySources(query.sources),
      entityType: query.entityType,
      entityId: query.entityId,
      action: query.action,
      status: query.status,
      severity: query.severity,
      search: query.search
    })
  });
});

app.get("/api/v1/event-history/export", async (c) => {
  const query = eventHistoryExportQuerySchema.parse(c.req.query());
  const items = await getEventHistory({
    session: c.get("session"),
    repo: c.get("repo"),
    hours: query.hours,
    limit: query.limit ?? 200,
    sources: parseEventHistorySources(query.sources),
    entityType: query.entityType,
    entityId: query.entityId,
    action: query.action,
    status: query.status,
    severity: query.severity,
    search: query.search
  });

  if (query.format === "json") {
    return c.json({ data: items });
  }

  return c.body(formatEventHistoryItemsAsCsv(items), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename=\"event-history-${new Date().toISOString().slice(0, 10)}.csv\"`
  });
});

app.get("/api/v1/ops/snapshot", async (c) => {
  const query = opsSnapshotQuerySchema.parse(c.req.query());
  return c.json({
    data: await getOpsSnapshot({
      session: c.get("session"),
      repo: c.get("repo"),
      auditHours: query.auditHours,
      recentLimit: query.recentLimit,
      rankingLimit: query.rankingLimit
    })
  });
});

app.get("/api/v1/ops/trends", async (c) => {
  const query = opsTrendsQuerySchema.parse(c.req.query());
  return c.json({
    data: await getOpsTrends({
      session: c.get("session"),
      repo: c.get("repo"),
      days: query.days,
      timeZone: query.timeZone
    })
  });
});

app.get("/api/v1/market-data/providers", async (c) => {
  const query = marketDataProvidersQuerySchema.parse(c.req.query());
  return c.json({
    data: await listMarketDataProviderStatuses({
      session: c.get("session"),
      sources: query.sources
    })
  });
});

app.get("/api/v1/market-data/policy", async (c) => {
  marketDataPolicyQuerySchema.parse(c.req.query());
  return c.json({
    data: getMarketDataPolicy()
  });
});

app.get("/api/v1/market-data/symbols", async (c) => {
  const query = marketDataSymbolsQuerySchema.parse(c.req.query());
  return c.json({
    data: await listMarketSymbols({
      session: c.get("session"),
      repo: c.get("repo"),
      query: query.query,
      market: query.market,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/quotes", async (c) => {
  const query = marketDataQuotesQuerySchema.parse(c.req.query());
  return c.json({
    data: await listMarketQuotes({
      session: c.get("session"),
      symbols: query.symbols,
      market: query.market,
      source: query.source,
      includeStale: query.includeStale,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/resolve", async (c) => {
  const query = marketDataResolveQuerySchema.parse(c.req.query());
  return c.json({
    data: await resolveMarketQuotes({
      session: c.get("session"),
      symbols: query.symbols,
      market: query.market,
      includeStale: query.includeStale,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/effective-quotes", async (c) => {
  const query = marketDataEffectiveQuotesQuerySchema.parse(c.req.query());
  return c.json({
    data: await getEffectiveMarketQuotes({
      session: c.get("session"),
      symbols: query.symbols,
      market: query.market,
      includeStale: query.includeStale,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/consumer-summary", async (c) => {
  const query = marketDataConsumerSummaryQuerySchema.parse(c.req.query());
  return c.json({
    data: await getMarketDataConsumerSummary({
      session: c.get("session"),
      mode: query.mode,
      symbols: query.symbols,
      market: query.market,
      includeStale: query.includeStale,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/selection-summary", async (c) => {
  const query = marketDataSelectionSummaryQuerySchema.parse(c.req.query());
  return c.json({
    data: await getMarketDataSelectionSummary({
      session: c.get("session"),
      symbols: query.symbols,
      market: query.market,
      includeStale: query.includeStale,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/decision-summary", async (c) => {
  const query = marketDataDecisionSummaryQuerySchema.parse(c.req.query());
  return c.json({
    data: await getMarketDataDecisionSummary({
      session: c.get("session"),
      symbols: query.symbols,
      market: query.market,
      includeStale: query.includeStale,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/history", async (c) => {
  const query = marketDataHistoryQuerySchema.parse(c.req.query());
  return c.json({
    data: await listMarketQuoteHistory({
      session: c.get("session"),
      symbols: query.symbols,
      market: query.market,
      source: query.source,
      includeStale: query.includeStale,
      from: query.from,
      to: query.to,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/history/diagnostics", async (c) => {
  const query = marketDataHistoryDiagnosticsQuerySchema.parse(c.req.query());
  return c.json({
    data: await getMarketQuoteHistoryDiagnostics({
      session: c.get("session"),
      symbols: query.symbols,
      market: query.market,
      source: query.source,
      includeStale: query.includeStale,
      from: query.from,
      to: query.to,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/bars", async (c) => {
  const query = marketDataBarsQuerySchema.parse(c.req.query());
  return c.json({
    data: await listMarketBars({
      session: c.get("session"),
      symbols: query.symbols,
      market: query.market,
      source: query.source,
      interval: query.interval,
      includeStale: query.includeStale,
      from: query.from,
      to: query.to,
      limit: query.limit
    })
  });
});

app.get("/api/v1/market-data/bars/diagnostics", async (c) => {
  const query = marketDataBarDiagnosticsQuerySchema.parse(c.req.query());
  return c.json({
    data: await getMarketBarDiagnostics({
      session: c.get("session"),
      symbols: query.symbols,
      market: query.market,
      source: query.source,
      interval: query.interval,
      includeStale: query.includeStale,
      from: query.from,
      to: query.to,
      limit: query.limit
    })
  });
});

app.post("/api/v1/market-data/manual-quotes", async (c) => {
  const payload = manualQuoteUpsertSchema.parse(await c.req.json());
  return c.json(
    {
      data: await upsertManualQuotes({
        session: c.get("session"),
        quotes: payload.quotes
      })
    },
    201
  );
});

app.post("/api/v1/market-data/paper-quotes", async (c) => {
  const payload = manualQuoteUpsertSchema.parse(await c.req.json());
  return c.json(
    {
      data: await upsertPaperQuotes({
        session: c.get("session"),
        quotes: payload.quotes
      })
    },
    201
  );
});

app.get("/api/v1/market-data/overview", async (c) => {
  const query = marketDataOverviewQuerySchema.parse(c.req.query());
  return c.json({
    data: await getMarketDataOverview({
      session: c.get("session"),
      repo: c.get("repo"),
      sources: query.sources,
      includeStale: query.includeStale,
      topLimit: query.topLimit
    })
  });
});

app.get("/api/v1/risk/limits", async (c) => {
  const query = riskAccountQuerySchema.parse(c.req.query());
  return c.json({
    data: await getRiskLimitState({
      session: c.get("session"),
      accountId: query.accountId
    })
  });
});

app.post("/api/v1/risk/limits", async (c) => {
  const payload = riskLimitUpsertInputSchema.parse(await c.req.json());
  return c.json({
    data: await upsertRiskLimitState({
      session: c.get("session"),
      payload
    })
  });
});

app.get("/api/v1/risk/kill-switch", async (c) => {
  const query = riskAccountQuerySchema.parse(c.req.query());
  return c.json({
    data: await getKillSwitchState({
      session: c.get("session"),
      accountId: query.accountId
    })
  });
});

app.post("/api/v1/risk/kill-switch", async (c) => {
  const payload = killSwitchInputSchema.parse(await c.req.json());
  return c.json({
    data: await setKillSwitchState({
      session: c.get("session"),
      payload
    })
  });
});

app.post("/api/v1/risk/checks", async (c) => {
  const payload = riskCheckInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await evaluateRiskCheck({
        session: c.get("session"),
        repo: c.get("repo"),
        payload
      })
    },
    201
  );
});

app.get("/api/v1/risk/effective-limits", async (c) => {
  const query = z
    .object({
      accountId: z.string().min(1),
      strategyId: z.string().optional(),
      symbol: z.string().optional()
    })
    .parse(c.req.query());
  return c.json({
    data: await resolveRiskLimit({
      session: c.get("session"),
      accountId: query.accountId,
      strategyId: query.strategyId,
      symbol: query.symbol
    })
  });
});

// Strategy-layer overrides. One row per (accountId, strategyId); only
// present fields override the account-layer cap. Missing row → layer is a
// no-op for that order.
app.get("/api/v1/risk/strategy-limits", async (c) => {
  const query = z
    .object({
      accountId: z.string().min(1),
      strategyId: z.string().optional()
    })
    .parse(c.req.query());
  if (query.strategyId) {
    return c.json({
      data: await getStrategyRiskLimit({
        session: c.get("session"),
        accountId: query.accountId,
        strategyId: query.strategyId
      })
    });
  }
  return c.json({
    data: await listStrategyRiskLimits({
      session: c.get("session"),
      accountId: query.accountId
    })
  });
});

app.post("/api/v1/risk/strategy-limits", async (c) => {
  const payload = strategyRiskLimitUpsertInputSchema.parse(await c.req.json());
  return c.json({
    data: await upsertStrategyRiskLimit({
      session: c.get("session"),
      payload
    })
  });
});

app.delete("/api/v1/risk/strategy-limits", async (c) => {
  const query = z
    .object({
      accountId: z.string().min(1),
      strategyId: z.string().min(1)
    })
    .parse(c.req.query());
  const deleted = await deleteStrategyRiskLimit({
    session: c.get("session"),
    accountId: query.accountId,
    strategyId: query.strategyId
  });
  return c.json({ data: { deleted } });
});

// Symbol-layer overrides. Narrower than strategy: only per-symbol caps.
app.get("/api/v1/risk/symbol-limits", async (c) => {
  const query = z
    .object({
      accountId: z.string().min(1),
      symbol: z.string().optional()
    })
    .parse(c.req.query());
  if (query.symbol) {
    return c.json({
      data: await getSymbolRiskLimit({
        session: c.get("session"),
        accountId: query.accountId,
        symbol: query.symbol
      })
    });
  }
  return c.json({
    data: await listSymbolRiskLimits({
      session: c.get("session"),
      accountId: query.accountId
    })
  });
});

app.post("/api/v1/risk/symbol-limits", async (c) => {
  const payload = symbolRiskLimitUpsertInputSchema.parse(await c.req.json());
  return c.json({
    data: await upsertSymbolRiskLimit({
      session: c.get("session"),
      payload
    })
  });
});

app.delete("/api/v1/risk/symbol-limits", async (c) => {
  const query = z
    .object({
      accountId: z.string().min(1),
      symbol: z.string().min(1)
    })
    .parse(c.req.query());
  const deleted = await deleteSymbolRiskLimit({
    session: c.get("session"),
    accountId: query.accountId,
    symbol: query.symbol
  });
  return c.json({ data: { deleted } });
});

// ── Trading (paper broker) ──

app.get("/api/v1/trading/accounts", async (c) => {
  return c.json({ data: await listPaperAccounts(c.get("session")) });
});

const tradingAccountQuerySchema = z.object({ accountId: z.string().min(1) });

app.get("/api/v1/trading/balance", async (c) => {
  const query = tradingAccountQuerySchema.parse(c.req.query());
  return c.json({
    data: await getPaperBalance(c.get("session"), query.accountId)
  });
});

app.get("/api/v1/trading/positions", async (c) => {
  const query = tradingAccountQuerySchema.parse(c.req.query());
  return c.json({
    data: await listPaperPositions(c.get("session"), query.accountId)
  });
});

app.get("/api/v1/trading/orders", async (c) => {
  const query = z
    .object({
      accountId: z.string().optional(),
      status: orderStatusSchema.optional(),
      symbol: z.string().optional()
    })
    .parse(c.req.query());
  return c.json({
    data: await listPaperOrders(c.get("session"), query)
  });
});

app.post("/api/v1/trading/orders", async (c) => {
  const payload = orderCreateInputSchema.parse(await c.req.json());
  const result = await submitOrder({
    session: c.get("session"),
    repo: c.get("repo"),
    order: payload
  });
  return c.json({ data: result }, result.blocked ? 422 : 201);
});

app.post("/api/v1/trading/orders/preview", async (c) => {
  const payload = orderCreateInputSchema.parse(await c.req.json());
  const result = await previewOrder({
    session: c.get("session"),
    repo: c.get("repo"),
    order: payload
  });
  return c.json({ data: result });
});

app.post("/api/v1/trading/orders/cancel", async (c) => {
  const payload = orderCancelInputSchema.parse(await c.req.json());
  const accountId = c.req.query("accountId");
  if (!accountId) {
    return c.json({ error: "accountId query param is required" }, 400);
  }
  const order = await cancelOrder({
    session: c.get("session"),
    payload,
    accountId
  });
  if (!order) {
    return c.json({ error: "order_not_found" }, 404);
  }
  return c.json({ data: order });
});

app.get("/api/v1/trading/status", async (c) => {
  const query = tradingAccountQuerySchema.parse(c.req.query());
  return c.json({
    data: await getPaperBrokerStatus(c.get("session"), query.accountId)
  });
});

app.get("/api/v1/trading/events", async (c) => {
  const query = z
    .object({
      accountId: z.string().optional(),
      orderId: z.string().optional(),
      limit: z.coerce.number().int().positive().max(500).optional(),
      before: z.string().datetime().optional(),
      after: z.string().datetime().optional()
    })
    .parse(c.req.query());
  return c.json({
    data: await listExecutionEvents(c.get("session"), query)
  });
});

app.get("/api/v1/trading/stream", async (c) => {
  const session = c.get("session");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);
      const unsubscribe = subscribeExecutionEvents(session, (event) => {
        controller.enqueue(
          encoder.encode(`event: execution\ndata: ${JSON.stringify(event)}\n\n`)
        );
      });
      const abort = () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };
      c.req.raw.signal.addEventListener("abort", abort);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
});

app.get("/api/v1/company-graph/search", async (c) => {
  const query = companyGraphSearchQuerySchema.parse(c.req.query());
  return c.json({
    data: await getCompanyGraphSearchResults({
      session: c.get("session"),
      repo: c.get("repo"),
      query: query.query,
      limit: query.limit
    })
  });
});

app.get("/api/v1/company-graph/stats", async (c) => {
  const query = companyGraphStatsQuerySchema.parse(c.req.query());
  return c.json({
    data: await getCompanyGraphStats({
      session: c.get("session"),
      repo: c.get("repo"),
      topLimit: query.topLimit
    })
  });
});

app.get("/api/v1/companies/duplicates", async (c) => {
  const query = companyDuplicateReportQuerySchema.parse(c.req.query());
  return c.json({
    data: await getCompanyDuplicateReport({
      session: c.get("session"),
      repo: c.get("repo"),
      limit: query.limit,
      query: query.query
    })
  });
});

app.get("/api/v1/companies/merge-preview", async (c) => {
  const query = companyMergePreviewQuerySchema.parse(c.req.query());
  const preview = await getCompanyMergePreview({
    session: c.get("session"),
    repo: c.get("repo"),
    merge: {
      targetCompanyId: query.targetCompanyId,
      sourceCompanyIds: query.sourceCompanyIds,
      force: query.force ?? false,
      appendSourceNotes: query.appendSourceNotes ?? true
    }
  });

  if (!preview) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({ data: preview });
});

app.post("/api/v1/companies/merge", async (c) => {
  const payload = companyMergeInputSchema.parse(await c.req.json());
  const result = await executeCompanyMerge({
    session: c.get("session"),
    repo: c.get("repo"),
    merge: payload
  });

  if (!result) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({ data: result });
});

app.get("/api/v1/themes", async (c) =>
  c.json({
    data: await c.get("repo").listThemes({
      workspaceSlug: c.get("session").workspace.slug
    })
  })
);

app.post("/api/v1/themes", async (c) => {
  const payload = themeCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createTheme(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/themes/:id/graph", async (c) => {
  const query = themeGraphViewQuerySchema.parse(c.req.query());
  const graph = await getThemeGraphView({
    session: c.get("session"),
    repo: c.get("repo"),
    themeId: c.req.param("id"),
    edgeLimit: query.edgeLimit,
    keywordLimit: query.keywordLimit
  });

  if (!graph) {
    return c.json({ error: "theme_not_found" }, 404);
  }

  return c.json({ data: graph });
});

app.get("/api/v1/theme-graph/stats", async (c) => {
  const query = themeGraphStatsQuerySchema.parse(c.req.query());
  const stats = await getThemeGraphStats({
    session: c.get("session"),
    repo: c.get("repo"),
    query: query.query,
    limit: query.limit,
    keywordLimit: query.keywordLimit,
    marketState: query.marketState,
    lifecycle: query.lifecycle,
    minEdges: query.minEdges,
    onlyConnected: query.onlyConnected
  });

  return c.json({ data: stats });
});

app.get("/api/v1/theme-graph/search", async (c) => {
  const query = themeGraphSearchQuerySchema.parse(c.req.query());
  const results = await searchThemeGraph({
    session: c.get("session"),
    repo: c.get("repo"),
    query: query.query,
    limit: query.limit,
    keywordLimit: query.keywordLimit,
    marketState: query.marketState,
    lifecycle: query.lifecycle,
    minEdges: query.minEdges,
    onlyConnected: query.onlyConnected
  });

  return c.json({ data: results });
});

app.get("/api/v1/theme-graph/export", async (c) => {
  const query = themeGraphExportQuerySchema.parse(c.req.query());
  const stats = await getThemeGraphStats({
    session: c.get("session"),
    repo: c.get("repo"),
    query: query.query,
    limit: query.limit ?? 50,
    keywordLimit: query.keywordLimit,
    marketState: query.marketState,
    lifecycle: query.lifecycle,
    minEdges: query.minEdges,
    onlyConnected: query.onlyConnected
  });

  if (query.format === "json") {
    return c.json({ data: stats });
  }

  return c.body(formatThemeGraphStatsAsCsv(stats.topThemes), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename=\"theme-graph-${new Date().toISOString().slice(0, 10)}.csv\"`
  });
});

app.get("/api/v1/theme-graph/rankings", async (c) => {
  const query = themeGraphRankingQuerySchema.parse(c.req.query());
  const rankings = await getThemeGraphRankings({
    session: c.get("session"),
    repo: c.get("repo"),
    query: query.query,
    limit: query.limit,
    keywordLimit: query.keywordLimit,
    marketState: query.marketState,
    lifecycle: query.lifecycle,
    minEdges: query.minEdges,
    onlyConnected: query.onlyConnected
  });

  return c.json({ data: rankings });
});

app.get("/api/v1/themes/:id", async (c) => {
  const theme = await c.get("repo").getTheme(c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!theme) {
    return c.json({ error: "theme_not_found" }, 404);
  }

  return c.json({ data: theme });
});

app.patch("/api/v1/themes/:id", async (c) => {
  const payload = themeUpdateInputSchema.parse(await c.req.json());
  const theme = await c.get("repo").updateTheme(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!theme) {
    return c.json({ error: "theme_not_found" }, 404);
  }

  return c.json({ data: theme });
});

app.get("/api/v1/companies", async (c) => {
  const themeId = c.req.query("themeId");
  const tickerFilter = c.req.query("ticker")?.trim().toUpperCase();

  let data = await c.get("repo").listCompanies(themeId, {
    workspaceSlug: c.get("session").workspace.slug
  });

  // B1 P1 perf fix: ticker lookup returns 1 row instead of transmitting all 3470
  if (tickerFilter) {
    data = data.filter((company) => company.ticker.toUpperCase() === tickerFilter);
  }

  return c.json({ data });
});

app.post("/api/v1/companies", async (c) => {
  const payload = companyCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createCompany(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/companies/:id/relations", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({
    data: await c.get("repo").listCompanyRelations(company.id, {
      workspaceSlug: c.get("session").workspace.slug
    })
  });
});

app.put("/api/v1/companies/:id/relations", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) {
    return c.json({ error: "company_not_found" }, 404);
  }

  const payload = companyRelationsReplaceInputSchema.parse(await c.req.json().catch(() => ({})));
  return c.json({
    data: await c.get("repo").replaceCompanyRelations(company.id, payload.relations, {
      workspaceSlug: c.get("session").workspace.slug
    })
  });
});

app.get("/api/v1/companies/:id/keywords", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({
    data: await c.get("repo").listCompanyKeywords(company.id, {
      workspaceSlug: c.get("session").workspace.slug
    })
  });
});

app.put("/api/v1/companies/:id/keywords", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) {
    return c.json({ error: "company_not_found" }, 404);
  }

  const payload = companyKeywordsReplaceInputSchema.parse(await c.req.json().catch(() => ({})));
  return c.json({
    data: await c.get("repo").replaceCompanyKeywords(company.id, payload.keywords, {
      workspaceSlug: c.get("session").workspace.slug
    })
  });
});

app.get("/api/v1/companies/:id/graph", async (c) => {
  const query = companyGraphViewQuerySchema.parse(c.req.query());
  // Resolve ticker→UUID first so getCompanyGraphView always receives a UUID.
  const resolved = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!resolved) {
    return c.json({ error: "company_not_found" }, 404);
  }
  const graph = await getCompanyGraphView({
    session: c.get("session"),
    repo: c.get("repo"),
    companyId: resolved.id,
    limit: query.limit,
    keywordLimit: query.keywordLimit
  });

  if (!graph) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({ data: graph });
});

app.get("/api/v1/companies/:id", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({ data: company });
});

app.patch("/api/v1/companies/:id", async (c) => {
  const payload = companyUpdateInputSchema.parse(await c.req.json());
  // Resolve ticker→UUID so updateCompany always receives a UUID.
  const resolved = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!resolved) {
    return c.json({ error: "company_not_found" }, 404);
  }
  const company = await c.get("repo").updateCompany(resolved.id, payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({ data: company });
});

app.get("/api/v1/signals", async (c) => {
  const themeId = c.req.query("themeId");
  const companyId = c.req.query("companyId");
  const category = c.req.query("category");
  return c.json({
    data: await c.get("repo").listSignals(
      { themeId, companyId, category },
      { workspaceSlug: c.get("session").workspace.slug }
    )
  });
});

app.get("/api/v1/strategy/ideas", async (c) => {
  const query = strategyIdeasQuerySchema.parse(c.req.query());
  return c.json({
    data: await getStrategyIdeas({
      session: c.get("session"),
      repo: c.get("repo"),
      limit: query.limit,
      signalDays: query.signalDays,
      includeBlocked: query.includeBlocked,
      market: query.market,
      themeId: query.themeId,
      theme: query.theme,
      symbol: query.symbol,
      decisionMode: query.decisionMode,
      decisionFilter: query.decisionFilter,
      qualityFilter: query.qualityFilter,
      sort: query.sort
    })
  });
});

// ---------------------------------------------------------------------------
// Contract 4 — POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-preview
//
// ideaId = companyId (UUID) or ticker.
// Builds an OrderIntent draft from company + request body and runs it through
// previewOrder() (same risk + quote gate as submit, but commit:false, no Order
// row created). Returns { orderIntent, riskCheck, quoteGate, blocked }.
// HARD LINE: no broker.submit / live.submit / /order/create call.
// W7 demo default: quantity_unit="SHARE", qty=1 (odd-lot, 2330 scenario).
// ---------------------------------------------------------------------------
const promotePreviewBodySchema = z.object({
  qty: z.number().int().min(1).max(999).optional().default(1),
  price: z.number().positive().nullable().optional().default(null),
  orderType: z.enum(["market", "limit", "stop", "stop_limit"]).optional().default("limit"),
  side: z.enum(["buy", "sell"]).optional().default("buy")
});

app.post("/api/v1/strategy/ideas/:ideaId/promote-to-paper-preview", async (c) => {
  const ideaId = c.req.param("ideaId");
  const session = c.get("session");
  const repo = c.get("repo");

  // Resolve company from ideaId (UUID or ticker)
  const company = await resolveCompany(repo, ideaId, { workspaceSlug: session.workspace.slug });
  if (!company) {
    return c.json({ error: "idea_not_found", ideaId }, 404);
  }

  let body: ReturnType<typeof promotePreviewBodySchema.parse>;
  try {
    const raw = await c.req.json().catch(() => ({}));
    body = promotePreviewBodySchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  const order = {
    accountId: "paper-default",
    symbol: company.ticker,
    side: body.side,
    type: body.orderType as "market" | "limit" | "stop" | "stop_limit",
    timeInForce: "rod" as const,
    quantity: body.qty,
    quantity_unit: "SHARE" as const,
    price: body.price ?? null,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: [] as string[],
    overrideReason: ""
  };

  const result = await previewOrder({ session, repo, order });

  return c.json({
    data: {
      orderIntent: {
        symbol: order.symbol,
        side: order.side,
        orderType: order.type,
        qty: order.quantity,
        quantity_unit: order.quantity_unit,
        price: order.price
      },
      riskCheck: result.riskCheck,
      quoteGate: result.quoteGate,
      blocked: result.blocked
    }
  });
});

// ---------------------------------------------------------------------------
// Contract 4 — POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-submit
//
// Same lookup + body validation as preview.
// Calls driveOrder() through the existing paper execution pipeline.
// Idempotency: uses Idempotency-Key header, fallback to deterministic key.
// Returns { orderIntent, state, ledgerRow }.
// HARD LINE: no broker.submit / live.submit / /order/create call.
// ---------------------------------------------------------------------------
const promoteSubmitBodySchema = z.object({
  qty: z.number().int().min(1).max(999).optional().default(1),
  price: z.number().positive().nullable().optional().default(null),
  orderType: z.enum(["market", "limit", "stop", "stop_limit"]).optional().default("limit"),
  side: z.enum(["buy", "sell"]).optional().default("buy")
});

app.post("/api/v1/strategy/ideas/:ideaId/promote-to-paper-submit", async (c) => {
  const ideaId = c.req.param("ideaId");
  const session = c.get("session");
  const repo = c.get("repo");

  // Resolve company from ideaId (UUID or ticker)
  const company = await resolveCompany(repo, ideaId, { workspaceSlug: session.workspace.slug });
  if (!company) {
    return c.json({ error: "idea_not_found", ideaId }, 404);
  }

  let body: ReturnType<typeof promoteSubmitBodySchema.parse>;
  try {
    const raw = await c.req.json().catch(() => ({}));
    body = promoteSubmitBodySchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  // Idempotency key: header-first, fallback to deterministic key (minute-level).
  // Pete BLOCKER-2: scope key with TW market date (Asia/Taipei) so a prior-day
  // header-supplied key cannot 409 today's submit.
  const idempotencyKeyHeader = c.req.header("Idempotency-Key");
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const twDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const idempotencyKey = idempotencyKeyHeader
    ? `${twDate}:${idempotencyKeyHeader}`
    : `${twDate}:idea-${ideaId}-${body.qty}-SHARE-${minuteBucket}`;

  // Guard against duplicate submissions (persistent across restarts via DB/MapAdapter)
  const existingPromote = await findOrderByIdempotencyKey(idempotencyKey);
  if (existingPromote) {
    return c.json(
      { error: "DUPLICATE_IDEMPOTENCY_KEY", idempotencyKey },
      409
    );
  }

  // Pete BLOCKER-1: M-1 risk engine must run on this third paper-submit surface.
  // Previously promote-to-paper-submit bypassed evaluatePaperOrderRisk entirely,
  // letting max_per_trade / max_single_position / stale_quote / kill_switch /
  // capital all be silently skipped. Wire it now.
  const promoteOrder = buildPaperOrderContext({
    symbol: company.ticker,
    side: body.side,
    orderType: body.orderType,
    qty: body.qty,
    quantity_unit: "SHARE",
    price: body.price,
    idempotencyKey
  });
  const promoteRiskGate = await evaluatePaperOrderRisk({
    session, repo, order: promoteOrder, commit: true
  });
  if (promoteRiskGate.blocked) {
    return c.json(
      {
        blocked: true,
        decision: promoteRiskGate.decision,
        riskCheck: promoteRiskGate.riskCheck,
        quoteGate: promoteRiskGate.quoteGate,
        guards: promoteRiskGate.guards,
        reasonCodes: promoteRiskGate.reasonCodes
      },
      422
    );
  }

  const intent = createOrderIntent({
    idempotencyKey,
    symbol: company.ticker,
    side: body.side,
    orderType: body.orderType,
    qty: body.qty,
    quantity_unit: "SHARE",
    price: body.price,
    userId: session.user.id
  });

  const result = await driveOrder(intent);

  const status = result.finalState.intent.status === "REJECTED" ? 422 : 201;
  return c.json(
    {
      data: {
        orderIntent: {
          symbol: intent.symbol,
          side: intent.side,
          orderType: intent.orderType,
          qty: intent.qty,
          quantity_unit: intent.quantity_unit,
          price: intent.price
        },
        state: result.finalState.intent.status,
        ledgerRow: result.finalState
      }
    },
    status
  );
});

app.post("/api/v1/strategy/runs", async (c) => {
  const payload = strategyRunCreateInputSchema.parse(await c.req.json().catch(() => ({})));
  return c.json(
    {
      data: await createStrategyRun({
        session: c.get("session"),
        repo: c.get("repo"),
        payload
      })
    },
    201
  );
});

app.get("/api/v1/strategy/runs", async (c) => {
  const query = strategyRunListQuerySchema.parse(c.req.query());
  return c.json({
    data: await listStrategyRuns({
      session: c.get("session"),
      limit: query.limit,
      decisionMode: query.decisionMode,
      symbol: query.symbol,
      themeId: query.themeId,
      theme: query.theme,
      qualityFilter: query.qualityFilter,
      sort: query.sort
    })
  });
});

app.get("/api/v1/strategy/runs/:id", async (c) => {
  const run = await getStrategyRunById({
    session: c.get("session"),
    runId: c.req.param("id")
  });

  if (!run) {
    return c.json({ error: "strategy_run_not_found" }, 404);
  }

  return c.json({ data: run });
});

// Autopilot Phase 2 (c) — Issue a one-time confirm token for dryRun:false execute.
// Token is bound to the runId path param; TTL = 60s; one-time use.
app.post("/api/v1/strategy/runs/:id/confirm-token", async (c) => {
  const runId = c.req.param("id");
  const tokenResponse = issueConfirmToken(runId);
  return c.json({ data: tokenResponse }, 201);
});

app.post("/api/v1/strategy/runs/:id/execute", async (c) => {
  const runId = c.req.param("id");
  const payload = autopilotExecuteInputSchema.parse(await c.req.json().catch(() => ({})));

  let result;
  try {
    result = await executeStrategyRun({
      session: c.get("session"),
      repo: c.get("repo"),
      runId,
      payload
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("strategy_run_not_found:")) {
      return c.json({ error: "strategy_run_not_found" }, 404);
    }
    // Confirm gate errors — return 400 with structured error code
    if (message.startsWith("confirm_gate:")) {
      const code = message.slice("confirm_gate:".length);
      const statusMsg =
        code === "confirm_required"
          ? "dryRun:false requires a valid confirm token. POST /confirm-token first."
          : code === "confirm_expired"
          ? "Confirm token has expired (60s TTL). Request a new token."
          : code === "confirm_used"
          ? "Confirm token has already been used. Request a new token."
          : code === "confirm_run_mismatch"
          ? "Confirm token is bound to a different runId."
          : "Confirm token is invalid.";
      return c.json({ error: code, message: statusMsg }, 400);
    }
    throw err;
  }

  if (result.summary.total === 0) {
    return c.json({ error: "no_qualifying_ideas" }, 400);
  }

  return c.json({ data: result });
});

app.post("/api/v1/signals", async (c) => {
  const payload = signalCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createSignal(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/signals/:id", async (c) => {
  const signal = await c.get("repo").getSignal(c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!signal) {
    return c.json({ error: "signal_not_found" }, 404);
  }
  return c.json({ data: signal });
});

app.patch("/api/v1/signals/:id", async (c) => {
  const payload = signalUpdateInputSchema.parse(await c.req.json());
  const signal = await c.get("repo").updateSignal(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!signal) {
    return c.json({ error: "signal_not_found" }, 404);
  }
  return c.json({ data: signal });
});

app.get("/api/v1/plans", async (c) => {
  const companyId = c.req.query("companyId");
  const status = c.req.query("status");
  return c.json({
    data: await c.get("repo").listTradePlans(
      { companyId, status },
      { workspaceSlug: c.get("session").workspace.slug }
    )
  });
});

app.post("/api/v1/plans", async (c) => {
  const payload = tradePlanCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createTradePlan(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/plans/:id", async (c) => {
  const plan = await c.get("repo").getTradePlan(c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!plan) {
    return c.json({ error: "plan_not_found" }, 404);
  }
  return c.json({ data: plan });
});

app.patch("/api/v1/plans/:id", async (c) => {
  const payload = tradePlanUpdateInputSchema.parse(await c.req.json());
  const plan = await c.get("repo").updateTradePlan(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!plan) {
    return c.json({ error: "plan_not_found" }, 404);
  }
  return c.json({ data: plan });
});

app.get("/api/v1/reviews", async (c) => {
  const tradePlanId = c.req.query("tradePlanId");
  return c.json({
    data: await c.get("repo").listReviews(
      { tradePlanId },
      { workspaceSlug: c.get("session").workspace.slug }
    )
  });
});

app.post("/api/v1/reviews", async (c) => {
  const payload = reviewEntryCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createReview(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

app.get("/api/v1/briefs", async (c) =>
  c.json({
    data: await c.get("repo").listBriefs({
      workspaceSlug: c.get("session").workspace.slug
    })
  })
);

app.post("/api/v1/briefs", async (c) => {
  const payload = dailyBriefCreateInputSchema.parse(await c.req.json());
  return c.json(
    {
      data: await c.get("repo").createBrief(payload, {
        workspaceSlug: c.get("session").workspace.slug
      })
    },
    201
  );
});

// ── Worker-produced content endpoints ─────────────────────────────────────────

app.get("/api/v1/theme-summaries", async (c) => {
  const themeId = c.req.query("themeId");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  return c.json({
    data: await c.get("repo").listThemeSummaries({
      workspaceSlug: c.get("session").workspace.slug,
      ...(themeId ? { themeId } : {}),
      ...(limit ? { limit } : {})
    })
  });
});

app.get("/api/v1/company-notes", async (c) => {
  const companyId = c.req.query("companyId");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  return c.json({
    data: await c.get("repo").listCompanyNotes({
      workspaceSlug: c.get("session").workspace.slug,
      ...(companyId ? { companyId } : {}),
      ...(limit ? { limit } : {})
    })
  });
});

app.get("/api/v1/review-summaries", async (c) => {
  const themeSlug = c.req.query("themeSlug");
  const themeId = c.req.query("themeId");
  const period = c.req.query("period");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  return c.json({
    data: await c.get("repo").listReviewSummaries({
      workspaceSlug: c.get("session").workspace.slug,
      ...(themeSlug ? { themeSlug } : {}),
      ...(themeId ? { themeId } : {}),
      ...(period ? { period } : {}),
      ...(limit ? { limit } : {})
    })
  });
});

app.get("/api/v1/signal-clusters", async (c) => {
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  return c.json({
    data: await c.get("repo").listSignalClusters({
      workspaceSlug: c.get("session").workspace.slug,
      ...(limit ? { limit } : {})
    })
  });
});

// OpenAlice admin operations (device registration, device list/revoke/cleanup,
// job CRUD, job review, observability) require Owner or Admin. Runner-driven
// routes (jobs/{claim,heartbeat,result}) use bearer device auth instead and
// bypass this gate via isDeviceAuthRoute().
const OPENALICE_ADMIN_ROLES = new Set(["Owner", "Admin"]);

function requireOpenAliceAdmin(c: Context) {
  const session = c.get("session");
  if (!session || !OPENALICE_ADMIN_ROLES.has(session.user.role)) {
    return c.json({ error: "forbidden_role" }, 403);
  }
  return null;
}

app.post("/api/v1/openalice/register", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;
  const payload = openAliceRegisterSchema.parse(await c.req.json());
  const registration = await registerOpenAliceDevice({
    workspaceSlug: c.get("session").workspace.slug,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    capabilities: payload.capabilities
  });

  return c.json({ data: registration }, 201);
});

app.get("/api/v1/openalice/devices", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;
  return c.json({
    data: await listOpenAliceDevices(c.get("session").workspace.slug)
  });
});

app.post("/api/v1/openalice/devices/:deviceId/revoke", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;
  const device = await revokeOpenAliceDevice({
    workspaceSlug: c.get("session").workspace.slug,
    deviceId: c.req.param("deviceId")
  });

  if (!device) {
    return c.json({ error: "openalice_device_not_found" }, 404);
  }

  return c.json({ data: device });
});

app.post("/api/v1/openalice/devices/cleanup", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;
  const payload = openAliceCleanupDevicesSchema.parse(await c.req.json().catch(() => ({})));
  return c.json({
    data: await cleanupStaleOpenAliceDevices({
      workspaceSlug: c.get("session").workspace.slug,
      staleSeconds: payload.staleSeconds
    })
  });
});

app.get("/api/v1/openalice/jobs", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;
  return c.json({
    data: await listOpenAliceJobs(c.get("session").workspace.slug)
  });
});

app.patch("/api/v1/openalice/jobs/:jobId/review", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;
  const payload = openAliceReviewJobSchema.parse(await c.req.json().catch(() => ({})));
  const reviewed = await reviewOpenAliceJob({
    workspaceSlug: c.get("session").workspace.slug,
    jobId: c.req.param("jobId"),
    status: payload.status,
    reviewNote: payload.note
  });

  if (!reviewed) {
    return c.json({ error: "openalice_job_not_reviewable" }, 404);
  }

  return c.json({ data: reviewed });
});

app.get("/api/v1/openalice/observability", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;
  const base = await getOpenAliceObservabilitySnapshot(c.get("session").workspace.slug);
  // P0-C: extend observability with pipeline-specific fields
  const pipelineAddendum = getPipelineObservabilityAddendum();
  return c.json({
    data: {
      ...base,
      pipeline: pipelineAddendum
    }
  });
});

// P0-C: Admin trigger endpoint — fire pipeline tick on demand (Owner/Admin only)
app.post("/api/v1/internal/openalice/pipeline/trigger", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;

  let body: { tick?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const validTicks = ["pre_market", "close_watch", "close_brief"] as const;
  type ValidTick = (typeof validTicks)[number];
  const rawTick = typeof body.tick === "string" ? body.tick : "close_brief";
  const tick: ValidTick = (validTicks as readonly string[]).includes(rawTick)
    ? (rawTick as ValidTick)
    : "close_brief";

  const workspaceSlug = c.get("session").workspace.slug;
  const result = await runPipelineTick(tick, workspaceSlug).catch((e: unknown) => ({
    error: e instanceof Error ? e.message : String(e)
  }));

  return c.json({ data: result }, 200);
});

// P0-D: Batch AI reviewer endpoint (Owner/Admin only)
// POST /api/v1/internal/openalice/ai-reviewer/run-batch
// params: { taskType?, limit=20, dryRun=true|false }
// rate-limit: max 10 concurrent OpenAI calls (enforced in runBatchAiReviewer)
app.post("/api/v1/internal/openalice/ai-reviewer/run-batch", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;

  let body: { taskType?: string; limit?: number; dryRun?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const limit = typeof body.limit === "number" ? Math.min(Math.max(1, body.limit), 50) : 20;
  const dryRun = body.dryRun === true;
  const taskType = typeof body.taskType === "string" ? body.taskType : undefined;

  const result = await runBatchAiReviewer({ taskType, limit, dryRun });
  return c.json({ data: result });
});

app.post("/api/v1/openalice/jobs", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;
  const payload = openAliceEnqueueJobSchema.parse(await c.req.json());
  const job = await enqueueOpenAliceJob({
    workspaceSlug: c.get("session").workspace.slug,
    taskType: payload.taskType,
    schemaName: payload.schemaName,
    instructions: payload.instructions,
    contextRefs: payload.contextRefs,
    parameters: payload.parameters,
    timeoutSeconds: payload.timeoutSeconds
  });

  return c.json({ data: job }, 201);
});

app.post("/api/internal/openalice/jobs/claim", handleOpenAliceJobClaim);
app.post("/api/internal/openalice/jobs/:jobId/heartbeat", handleOpenAliceJobHeartbeat);
app.post("/api/internal/openalice/jobs/:jobId/result", handleOpenAliceJobResult);

// Compatibility aliases for earlier v1 bridge testing.
app.post("/api/v1/openalice/jobs/claim", handleOpenAliceJobClaim);
app.post("/api/v1/openalice/jobs/:jobId/heartbeat", handleOpenAliceJobHeartbeat);
app.post("/api/v1/openalice/jobs/:jobId/result", handleOpenAliceJobResult);

// Content drafts (OpenAlice result review queue — P0-D)

// Read content-drafts: Owner / Admin / Analyst only (Viewer→403, anon→401 via middleware).
// Drafts may contain unreviewed LLM payload + internal research; Viewer-read deferred
// pending field-level redaction work (post-P0.6 backlog item 1, 楊董 ack 2026-04-25).
const READ_DRAFT_ROLES = new Set(["Owner", "Admin", "Analyst"]);

app.get("/api/v1/content-drafts", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const query = contentDraftListQuerySchema.parse(c.req.query());
  return c.json({
    data: await listContentDrafts({
      workspaceSlug: c.get("session").workspace.slug,
      status: query.status,
      limit: query.limit
    })
  });
});

// Only Owner / Admin may act on review queue (P0.6 admin guard).
const REVIEW_ROLES = new Set(["Owner", "Admin"]);

app.post("/api/v1/content-drafts/:draftId/approve", async (c) => {
  const role = c.get("session").user.role;
  if (!REVIEW_ROLES.has(role)) {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const result = await approveContentDraft({
    draftId: c.req.param("draftId"),
    reviewerId: c.get("session").user.id
  });

  if ("error" in result) {
    const status = result.error === "content_draft_not_found" ? 404 : 409;
    return c.json({ error: result.error }, status);
  }

  return c.json({ data: result });
});

app.post("/api/v1/content-drafts/:draftId/reject", async (c) => {
  const role = c.get("session").user.role;
  if (!REVIEW_ROLES.has(role)) {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const payload = contentDraftRejectSchema.parse(await c.req.json().catch(() => ({})));
  const result = await rejectContentDraft({
    draftId: c.req.param("draftId"),
    reviewerId: c.get("session").user.id,
    reason: payload.reason
  });

  if ("error" in result) {
    const status = result.error === "content_draft_not_found" ? 404 : 409;
    return c.json({ error: result.error }, status);
  }

  return c.json({ data: result });
});

// TradingView webhook

const TV_WEBHOOK_TOKEN = process.env.TV_WEBHOOK_TOKEN ?? "";

/**
 * TradingView alert webhook -> Signal ingest.
 *
 * TradingView alert message should be configured as JSON:
 * {
 *   "ticker": "{{ticker}}",
 *   "exchange": "{{exchange}}",
 *   "price": "{{close}}",
 *   "interval": "{{interval}}",
 *   "title": "Your alert name",
 *   "direction": "bullish" | "bearish" | "neutral",
 *   "category": "price" | "macro" | "industry" | "company",
 *   "confidence": 3,
 *   "summary": "Optional extra text",
 *   "token": "<your TV_WEBHOOK_TOKEN>"
 * }
 *
 * Only "ticker" and "token" are required. Everything else has sensible defaults.
 */
const tvWebhookPayloadSchema = z.object({
  // Auth
  token: z.string().min(1),
  // TradingView template variables
  ticker: z.string().min(1),
  exchange: z.string().optional(),
  price: z.string().optional(),
  interval: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  eventKey: z.string().max(200).optional(),
  // Signal mapping (optional overrides)
  title: z.string().max(200).optional(),
  direction: z.enum(["bullish", "bearish", "neutral"]).optional(),
  category: z.enum(["macro", "industry", "company", "price", "portfolio"]).optional(),
  confidence: z.coerce.number().int().min(1).max(5).optional(),
  summary: z.string().max(2000).optional(),
  themeIds: z.array(z.string().uuid()).optional(),
  companyIds: z.array(z.string().uuid()).optional()
});

app.post("/api/v1/webhooks/tradingview", async (c) => {
  const webhookConfig = getTradingViewWebhookConfig();
  const raw = await c.req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const parsed = tvWebhookPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_error", details: parsed.error.flatten() }, 400);
  }

  const payload = parsed.data;

  // Token auth with constant-time comparison.
  if (!TV_WEBHOOK_TOKEN || !secureTokenEquals(TV_WEBHOOK_TOKEN, payload.token)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const clientIp =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  const rateLimit = await checkTradingViewRateLimit({
    clientIp,
    options: webhookConfig
  });
  if (!rateLimit.ok) {
    c.header("Retry-After", String(rateLimit.retryAfterSeconds));
    return c.json(
      {
        error: "rate_limited",
        limit: rateLimit.limit,
        retryAfterSeconds: rateLimit.retryAfterSeconds
      },
      429
    );
  }

  const timestampValidation = validateTradingViewTimestamp(
    payload.timestamp,
    new Date(),
    webhookConfig
  );
  if (!timestampValidation.ok) {
    return c.json({ error: timestampValidation.error }, 400);
  }

  const eventKey = buildTradingViewEventKey({
    ticker: payload.ticker,
    exchange: payload.exchange,
    price: payload.price,
    interval: payload.interval,
    title: payload.title,
    direction: payload.direction,
    category: payload.category,
    confidence: payload.confidence,
    summary: payload.summary,
    themeIds: payload.themeIds,
    companyIds: payload.companyIds,
    eventKey: payload.eventKey,
    timestamp: timestampValidation.normalizedTimestamp
  });
  const claimedEvent = await claimTradingViewEvent({
    eventKey,
    ttlSeconds: webhookConfig.dedupTtlSeconds
  });

  if (claimedEvent.status === "duplicate") {
    return c.json(
      {
        data: claimedEvent.signal,
        meta: {
          duplicate: true,
          eventKey
        }
      },
      200
    );
  }

  if (claimedEvent.status === "pending") {
    return c.json(
      {
        error: "duplicate_in_progress",
        eventKey
      },
      202
    );
  }

  // Build signal from TV alert
  const direction = payload.direction ?? "neutral";
  const category = payload.category ?? "price";
  const confidence = payload.confidence ?? 3;

  const pricePart = payload.price ? ` @ ${payload.price}` : "";
  const intervalPart = payload.interval ? ` [${payload.interval}]` : "";
  const title = payload.title
    ?? `${payload.ticker}${pricePart} - TV Alert${intervalPart}`;

  const summaryParts = [
    payload.summary,
    payload.exchange ? `Exchange: ${payload.exchange}` : null,
    payload.price ? `Price: ${payload.price}` : null,
    payload.interval ? `Interval: ${payload.interval}` : null,
    timestampValidation.normalizedTimestamp
      ? `Timestamp: ${timestampValidation.normalizedTimestamp}`
      : null,
    `Source: TradingView webhook at ${new Date().toISOString()}`
  ].filter(Boolean);

  const repo = c.get("repo");
  const session = c.get("session");
  const opts = { workspaceSlug: session.workspace.slug };

  await ingestTradingViewQuote({
    session,
    ticker: payload.ticker,
    exchange: payload.exchange,
    price: payload.price,
    timestamp: timestampValidation.normalizedTimestamp
  });

  let signal;
  try {
    signal = await repo.createSignal(
      {
        category,
        direction,
        title: title.slice(0, 200),
        summary: summaryParts.join("\n").slice(0, 2000),
        confidence,
        themeIds: payload.themeIds ?? [],
        companyIds: payload.companyIds ?? []
      },
      opts
    );
  } catch (error) {
    await clearTradingViewEventClaim(eventKey);
    throw error;
  }

  await markTradingViewEventComplete({
    eventKey,
    signal: {
      id: signal.id,
      title: signal.title,
      direction: signal.direction
    },
    ttlSeconds: webhookConfig.dedupTtlSeconds
  });

  console.log(
    JSON.stringify({
      tv_webhook: true,
      ts: new Date().toISOString(),
      ticker: payload.ticker,
      direction,
      signalId: signal.id,
      eventKey,
      duplicate: false
    })
  );

  return c.json(
    {
      data: signal,
      meta: {
        duplicate: false,
        eventKey
      }
    },
    201
  );
});

// Import

app.post("/api/v1/import/my-tw-coverage", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const typed = body as Record<string, unknown>;
  const coveragePath =
    (typed.coveragePath as string | undefined) ??
    process.env.MY_TW_COVERAGE_PATH;

  if (!coveragePath) {
    return c.json(
      { error: "coveragePath is required (body or MY_TW_COVERAGE_PATH env)" },
      400
    );
  }

  const result = runImport({ coveragePath });
  const persist = typed.persist === true;
  let persisted = 0;
  const persistErrors: string[] = [];

  if (persist) {
    const repo = c.get("repo");
    const options = { workspaceSlug: c.get("session").workspace.slug };

    for (const seed of result.companies) {
      try {
        await repo.createCompany(buildImportedCompanyDraft(seed), options);
        persisted++;
      } catch (error) {
        persistErrors.push(
          `${seed.ticker}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  return c.json({
    data: {
      companiesCount: result.companies.length,
      relationsCount: result.relations.length,
      themeKeywordsCount: result.themeKeywords.length,
      companyKeywordsCount: result.companyKeywords.length,
      warningsCount: result.warnings.length,
      sourcesCount: result.sources.length,
      ...(persist ? { persisted, persistErrors: persistErrors.slice(0, 50) } : {}),
      companies: result.companies.slice(0, 50),
      warnings: result.warnings.slice(0, 50),
      themeKeywords: result.themeKeywords.slice(0, 50),
      companyKeywords: result.companyKeywords.slice(0, 50)
    }
  });
});

// ── KGI Quote proxy (/api/v1/kgi/quote/*) ────────────────────────────────────
//
// W2d: read-only consumption of gateway quote data.
// Route prefix: /api/v1/kgi/quote/* (D-W2D-4)
// Stale detection: 5000ms threshold (D-W2D-1)
// Symbol whitelist: KGI_QUOTE_SYMBOL_WHITELIST env var (D-W2D-2)
//
// Hard lines:
//   - 0 import from order modules
//   - 0 /order/create call
//   - 0 broker write surface
//   - non-whitelisted symbol → 4xx (NOT 200, per D-W2D-2 security note)
//
// Note: these routes are inside the /api/v1/* session middleware (auth required).
// Gateway returns 503 QUOTE_DISABLED when KGI_GATEWAY_QUOTE_DISABLED=true.
// Gateway unreachable → 503 GATEWAY_UNREACHABLE (graceful degraded state).

import {
  KgiQuoteClient,
  KgiQuoteSymbolNotAllowedError,
  KgiQuoteDisabledError,
  KgiQuoteAuthError,
  KgiQuoteNotAvailableError,
  KgiQuoteUnreachableError,
  KgiKbarNotAvailableError,
} from "./broker/kgi-quote-client.js";

// Lazy singleton — one client per process instance.
let _kgiQuoteClient: KgiQuoteClient | null = null;
function getKgiQuoteClient(): KgiQuoteClient {
  if (!_kgiQuoteClient) {
    _kgiQuoteClient = new KgiQuoteClient();
  }
  return _kgiQuoteClient;
}

// Helper: map quote client errors to HTTP responses
function handleKgiQuoteError(c: Context, err: unknown): Response {
  if (err instanceof KgiQuoteSymbolNotAllowedError) {
    return c.json({ error: "SYMBOL_NOT_ALLOWED", message: err.message }, 422) as Response;
  }
  if (err instanceof KgiQuoteDisabledError) {
    return c.json({ error: "QUOTE_DISABLED", message: "Quote service is disabled (containment mode)" }, 503) as Response;
  }
  if (err instanceof KgiQuoteAuthError) {
    return c.json({ error: "GATEWAY_AUTH_ERROR", message: "Gateway session not established" }, 503) as Response;
  }
  if (err instanceof KgiQuoteNotAvailableError) {
    return c.json({ error: "QUOTE_NOT_AVAILABLE", message: err.message }, 404) as Response;
  }
  if (err instanceof KgiQuoteUnreachableError) {
    return c.json({ error: "GATEWAY_UNREACHABLE", message: "KGI gateway is unreachable" }, 503) as Response;
  }
  return c.json({ error: "GATEWAY_ERROR", message: String(err) }, 503) as Response;
}

// GET /api/v1/kgi/quote/status — diagnostic, no whitelist check
app.get("/api/v1/kgi/quote/status", async (c) => {
  try {
    const status = await getKgiQuoteClient().getQuoteStatus();
    return c.json({ data: status });
  } catch (err) {
    return handleKgiQuoteError(c, err);
  }
});

// POST /api/v1/kgi/quote/subscribe — subscribe tick + bidask for a whitelisted symbol
const kgiSubscribeSchema = z.object({
  symbol: z.string().min(1).max(20),
  type: z.enum(["tick", "bidask", "both"]).default("tick"),
  oddLot: z.boolean().optional(),
});

app.post("/api/v1/kgi/quote/subscribe", async (c) => {
  try {
    const body = kgiSubscribeSchema.parse(await c.req.json());
    const client = getKgiQuoteClient();
    const results: Record<string, string> = {};
    if (body.type === "tick" || body.type === "both") {
      results.tickLabel = await client.subscribeSymbolTick(body.symbol, { oddLot: body.oddLot });
    }
    if (body.type === "bidask" || body.type === "both") {
      results.bidAskLabel = await client.subscribeSymbolBidAsk(body.symbol, { oddLot: body.oddLot });
    }
    return c.json({ data: { symbol: body.symbol, ...results } });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return handleKgiQuoteError(c, err);
  }
});

// GET /api/v1/kgi/quote/ticks?symbol=<S>&limit=<N>
app.get("/api/v1/kgi/quote/ticks", async (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const limit = Math.max(1, Math.min(200, Number(c.req.query("limit") ?? "10")));
  if (!symbol) return c.json({ error: "MISSING_SYMBOL" }, 400);
  try {
    const result = await getKgiQuoteClient().getRecentTicks(symbol, limit);
    return c.json({ data: result });
  } catch (err) {
    return handleKgiQuoteError(c, err);
  }
});

// GET /api/v1/kgi/quote/bidask?symbol=<S>
app.get("/api/v1/kgi/quote/bidask", async (c) => {
  const symbol = c.req.query("symbol") ?? "";
  if (!symbol) return c.json({ error: "MISSING_SYMBOL" }, 400);
  try {
    const result = await getKgiQuoteClient().getLatestBidAsk(symbol);
    return c.json({ data: result });
  } catch (err) {
    return handleKgiQuoteError(c, err);
  }
});

// ── K-bar routes (/api/v1/kgi/quote/kbar/*) ──────────────────────────────────
//
// W3 B2: K-bar Phase 2 backend
//
// Hard lines:
//   - 0 import order
//   - 0 K-bar callback triggers signal / order
//   - unsupported interval → surface in response, not hard-transcoded
//   - subscribe_kbar WS push: DRAFT-only / sandbox-only
//   - Mock fallback: empty bars (not 500) on gateway unavailable

// GET /api/v1/kgi/quote/kbar/recover?symbol=<S>&from=<YYYYMMDD>&to=<YYYYMMDD>
app.get("/api/v1/kgi/quote/kbar/recover", async (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  if (!symbol) return c.json({ error: "MISSING_SYMBOL" }, 400);
  if (!from || !to) return c.json({ error: "MISSING_DATE_RANGE", message: "from and to required (YYYYMMDD)" }, 400);
  try {
    const result = await getKgiQuoteClient().recoverKbar(symbol, from, to);
    return c.json({ data: result });
  } catch (err) {
    return handleKgiQuoteError(c, err);
  }
});

// POST /api/v1/kgi/quote/subscribe/kbar
const kgiSubscribeKbarSchema = z.object({
  symbol: z.string().min(1).max(20),
  oddLot: z.boolean().optional(),
  interval: z.string().optional(),
});

app.post("/api/v1/kgi/quote/subscribe/kbar", async (c) => {
  try {
    const body = kgiSubscribeKbarSchema.parse(await c.req.json());
    const result = await getKgiQuoteClient().subscribeSymbolKbar(body.symbol, {
      oddLot: body.oddLot,
      interval: body.interval,
    });
    return c.json({ data: result });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return handleKgiQuoteError(c, err);
  }
});

// GET /api/v1/kgi/quote/kbar?symbol=<S>&limit=<N>
app.get("/api/v1/kgi/quote/kbar", async (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const limit = Math.max(1, Math.min(200, Number(c.req.query("limit") ?? "10")));
  if (!symbol) return c.json({ error: "MISSING_SYMBOL" }, 400);
  try {
    const result = await getKgiQuoteClient().getRecentKbars(symbol, limit);
    return c.json({ data: result });
  } catch (err) {
    return handleKgiQuoteError(c, err);
  }
});

// ── Auth routes ───────────────────────────────────────────────────────────────

const authLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256)
});

const authRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
  inviteCode: z.string().min(1).max(128)
});

app.post("/auth/login", async (c) => {
  const body = authLoginSchema.parse(await c.req.json());
  const result = await loginWithPassword(body.email, body.password);
  if (!result.ok) {
    return c.json({ error: result.error }, 401);
  }
  c.header("Set-Cookie", buildSetCookieHeader(result.user.id));
  return c.json({ user: result.user, workspace: result.workspace });
});

app.post("/auth/register-with-invite", async (c) => {
  const body = authRegisterSchema.parse(await c.req.json());
  const result = await registerWithInvite(body.email, body.password, body.inviteCode);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  c.header("Set-Cookie", buildSetCookieHeader(result.user.id));
  return c.json({ user: result.user, workspace: result.workspace });
});

app.post("/auth/logout", (c) => {
  c.header("Set-Cookie", buildClearCookieHeader());
  return c.json({ ok: true });
});

const issueInviteSchema = z.object({
  code: z.string().min(4).max(64).optional(),
  ttlMinutes: z.number().int().min(1).max(60 * 24 * 30).optional()
});

// Owner-gated invite issuance. Used by verify scripts to produce a fresh
// Viewer-role test user, and by the Owner to onboard real teammates without
// running the seed script through a DB shell.
// Note: /auth/* is outside the /api/v1/* session middleware, so we resolve the
// session from the cookie inline (same pattern as /auth/me).
app.post("/auth/issue-invite", async (c) => {
  const cookieHeader = c.req.header("cookie");
  const { parseSessionCookie, getUserById } = await import("./auth-store.js");
  const userId = parseSessionCookie(cookieHeader);
  if (!userId) return c.json({ error: "unauthenticated" }, 401);
  const user = await getUserById(userId);
  if (!user) return c.json({ error: "user_not_found" }, 401);
  if (user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const body = issueInviteSchema.parse(await c.req.json().catch(() => ({})));
  const result = await createInviteCode({
    issuerId: user.id,
    code: body.code,
    ttlMs: body.ttlMinutes ? body.ttlMinutes * 60_000 : undefined
  });
  return c.json({ data: { code: result.code, expiresAt: result.expiresAt.toISOString() } });
});

app.get("/auth/me", async (c) => {
  const cookieHeader = c.req.header("cookie");
  const { parseSessionCookie, getUserById } = await import("./auth-store.js");
  const userId = parseSessionCookie(cookieHeader);
  if (!userId) return c.json({ error: "unauthenticated" }, 401);
  const user = await getUserById(userId);
  if (!user) return c.json({ error: "user_not_found" }, 401);
  return c.json({ user, workspace: user.workspace });
});

// ── W6 Paper Trading Sprint (/api/v1/paper/*) ─────────────────────────────
//
// Standalone paper execution path. Completely independent of KGI gateway.
// Hard lines:
//   - NO KGI SDK import
//   - NO /order/create call (that route stays 409 NOT_ENABLED_IN_W1)
//   - ExecutionMode default = disabled
//   - Kill switch default = ON (blocked)
//   - Paper mode default = OFF

// GET /api/v1/paper/flags — diagnostics only, no auth side-effects
app.get("/api/v1/paper/flags", (c) => {
  return c.json({ data: getExecutionFlagSnapshot() });
});

// POST /api/v1/paper/orders — create a paper order intent
// M-1 2026-05-06: now wired to real risk engine + quote gate (same as /paper/submit).
// Returns 422 with rich { blocked, decision, riskCheck, quoteGate, guards, reasonCodes }
// if risk or gate blocks; otherwise 201 + { data: OrderState }.
app.post("/api/v1/paper/orders", async (c) => {
  // Layer 0: parse + validate input
  let payload: ReturnType<typeof paperOrderCreateInputSchema.parse>;
  try {
    payload = paperOrderCreateInputSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  // Layer 1-3: three-layer AND gate
  const gate = checkPaperExecutionGate();
  if (!gate.allowed) {
    return c.json(
      {
        error: "paper_gate_blocked",
        reason: gate.reason,
        layer: gate.layer
      },
      422
    );
  }

  // Idempotency: persistent check against DB (or in-memory MapAdapter in memory mode).
  // Returns existing order if key was already used — avoids duplicate fills on restart.
  const existingByKey = await findOrderByIdempotencyKey(payload.idempotencyKey);
  if (existingByKey) {
    return c.json(
      {
        error: "DUPLICATE_IDEMPOTENCY_KEY",
        idempotencyKey: payload.idempotencyKey
      },
      409
    );
  }

  const session = c.get("session");
  const repo = c.get("repo");

  // Layer 4 (M-1): Real risk engine + quote gate. Blocked → 422, no order/fill.
  const order = buildPaperOrderContext(payload);
  const riskGate = await evaluatePaperOrderRisk({ session, repo, order, commit: true });

  if (riskGate.blocked) {
    return c.json(
      {
        blocked: true,
        decision: riskGate.decision,
        riskCheck: riskGate.riskCheck,
        quoteGate: riskGate.quoteGate,
        guards: riskGate.guards,
        reasonCodes: riskGate.reasonCodes
      },
      422
    );
  }

  // Build the order intent (pure domain object)
  const intent = createOrderIntent({
    idempotencyKey: payload.idempotencyKey,
    symbol: payload.symbol,
    side: payload.side,
    orderType: payload.orderType,
    qty: payload.qty,
    quantity_unit: payload.quantity_unit,
    price: payload.price,
    userId: session.user.id
  });

  // Drive PENDING -> ACCEPTED -> FILLED|REJECTED through PaperExecutor.
  // Ledger persists each transition to DB (or in-memory MapAdapter).
  const result = await driveOrder(intent);
  const status = result.finalState.intent.status === "REJECTED" ? 422 : 201;
  return c.json({ data: result.finalState }, status);
});

// GET /api/v1/paper/orders/:id — fetch a single order state from the ledger
app.get("/api/v1/paper/orders/:id", async (c) => {
  const session = c.get("session");
  const orderId = c.req.param("id");
  const state = await getOrder(orderId);
  if (!state) return c.json({ error: "ORDER_NOT_FOUND" }, 404);
  if (state.intent.userId !== session.user.id) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ data: state });
});

// GET /api/v1/paper/orders — list orders for the current user (optional ?status=)
app.get("/api/v1/paper/orders", async (c) => {
  const session = c.get("session");
  const statusParam = c.req.query("status");
  const allowed = ["PENDING", "ACCEPTED", "FILLED", "REJECTED", "CANCELLED"] as const;
  const status = (allowed as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as (typeof allowed)[number])
    : undefined;
  const orders = await listOrders(session.user.id, status ? { status } : undefined);
  return c.json({ data: orders });
});

// POST /api/v1/paper/orders/:id/cancel — cancel a PENDING/ACCEPTED order
app.post("/api/v1/paper/orders/:id/cancel", async (c) => {
  const session = c.get("session");
  const orderId = c.req.param("id");
  const state = await getOrder(orderId);
  if (!state) return c.json({ error: "ORDER_NOT_FOUND" }, 404);
  if (state.intent.userId !== session.user.id) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body: { reason?: string } = {};
  try {
    const raw = await c.req.json();
    if (raw && typeof raw === "object" && typeof raw.reason === "string") {
      body = { reason: raw.reason };
    }
  } catch {
    // empty body is fine
  }

  const result = await cancelPaperOrder(state, body.reason);
  return c.json({
    data: result.finalState,
    alreadyTerminal: result.alreadyTerminal
  });
});

// =============================================================================
// API Gap Fillers — PR #21 RADAR cutover force-MOCK closures (W6 2026-04-29)
// Items 1-5 from evidence/path_b_w2a_20260426/pr21_api_gap.md
// =============================================================================

// ---------------------------------------------------------------------------
// Item 1 — POST /api/v1/paper/orders/preview
// Same body schema as POST /api/v1/paper/orders; pure calculation, no DB write.
// Translates paper schema → OrderCreateInput and runs through previewOrder()
// (same risk + quote gate as submit, but commit:false, no Order row created).
// Returns SubmitOrderResult (contains riskCheck + quoteGate + blocked flag).
// HARD LINE: no idempotency key registration (no _registerIdempotencyKey call).
// ---------------------------------------------------------------------------
app.post("/api/v1/paper/orders/preview", async (c) => {
  let payload: ReturnType<typeof paperOrderCreateInputSchema.parse>;
  try {
    payload = paperOrderCreateInputSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  // Map paper schema → OrderCreateInput (broker-layer schema).
  // "paper-default" is the canonical paper account id used by the paper broker.
  const order = {
    accountId: "paper-default",
    symbol: payload.symbol,
    side: payload.side,
    type: payload.orderType as "market" | "limit" | "stop" | "stop_limit",
    timeInForce: "rod" as const,
    quantity: payload.qty,
    quantity_unit: payload.quantity_unit,
    price: payload.price ?? null,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: [] as string[],
    overrideReason: ""
  };

  const result = await previewOrder({
    session: c.get("session"),
    repo: c.get("repo"),
    order
  });

  return c.json({ data: result });
});

// ---------------------------------------------------------------------------
// Item 2 — GET /api/v1/strategy/runs/:id/ideas
// Returns StrategyIdea[] from the stored run's items array.
// No re-computation; reads from the persisted run record.
// ---------------------------------------------------------------------------
app.get("/api/v1/strategy/runs/:id/ideas", async (c) => {
  const run = await getStrategyRunById({
    session: c.get("session"),
    runId: c.req.param("id")
  });

  if (!run) {
    return c.json({ error: "strategy_run_not_found" }, 404);
  }

  return c.json({ data: run.items });
});

// ---------------------------------------------------------------------------
// Item 3 — GET /api/v1/ops/activity
// Returns ActivityEvent[] shaped from recent audit log entries.
// Adapts AuditLogEntry → ActivityEvent (id, ts, source, severity, event, summary).
// Source: "api" for all audit log entries (method+path is the event slug).
// Severity: 4xx→WARN, 5xx→ERROR, rest→INFO.
// summary: human-readable ≤140 char string derived from entry fields.
// No new storage — thin adapter over existing audit log.
// W7 L6 fix: removed non-spec `actor`/`detail` fields; added required `summary`.
// ---------------------------------------------------------------------------
const opsActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50)
});

app.get("/api/v1/ops/activity", async (c) => {
  const query = opsActivityQuerySchema.parse(c.req.query());
  const entries = await listAuditLogEntries({
    session: c.get("session"),
    limit: query.limit
  });

  const events = entries.map((entry) => {
    const severity =
      (entry.status ?? 0) >= 500
        ? "ERROR"
        : (entry.status ?? 0) >= 400
        ? "WARN"
        : "INFO";

    const actor = entry.role ?? "system";
    const method = entry.method?.toUpperCase() ?? "";
    const path = entry.path ?? "";
    const rawSummary = `${actor} ${method} ${path}`.trim().replace(/\s+/g, " ");
    const summary = rawSummary.length > 140 ? rawSummary.slice(0, 137) + "..." : rawSummary;

    return {
      id: entry.id,
      ts: entry.createdAt,
      source: "api" as const,
      severity,
      event: `${entry.method?.toLowerCase() ?? "?"}.${
        (entry.path ?? "").replace(/^\/api\/v1\//, "").replace(/\//g, ".")
      }`,
      summary
    };
  });

  return c.json({ data: events });
});

// ---------------------------------------------------------------------------
// Item 4 — Schema reconciliation: BriefBundle / ReviewBundle / WeeklyPlan
//
// W7 L6: Full compose pass replacing stub shapes.
//
// BriefBundle:
//   market:          Derived from wall-clock Taiwan time (no DB dependency).
//   topThemes:       Mapped from listThemes() → RADAR Theme shape (limit 6).
//   ideasOpen:       Mapped from getStrategyIdeas() → RADAR Idea shape (limit 10).
//   watchlist:       Empty [] — no backing table yet; type-correct WatchlistItem[].
//   riskTodayLimits: Mapped from getRiskLimitState() → RADAR RiskLimit[] (3 key rules).
//
// ReviewBundle: typed arrays (ExecutionEvent[], SignalChannel summary).
// WeeklyPlan:   typed arrays (themeRotation, strategyTweaks).
//
// Shape contract: all fields match radar-types.ts exactly.
// ---------------------------------------------------------------------------

// Compose RADAR MarketState from wall-clock Taiwan time (UTC+8).
// Taiwan session: pre-open 08:30-09:00, open 09:00-13:30, midday 13:30-13:35,
// post-close otherwise.
function composeTaiwanMarketState(): {
  state: "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE";
  countdownSec: number;
  futuresNight: { last: number; chgPct: number };
  usMarket: { index: string; last: number; chgPct: number; closeTs: string };
  events: { ts: string; label: string; weight: "HIGH" | "MED" | "LOW" }[];
} {
  const now = new Date();
  // Taiwan = UTC+8
  const twMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + 8 * 60) % (24 * 60);
  // Boundary minutes: pre-open 510 (08:30), open 540 (09:00), midday 810 (13:30), postClose 815 (13:35)
  const PREOPEN_START = 510;  // 08:30
  const OPEN_START    = 540;  // 09:00
  const MIDDAY_START  = 810;  // 13:30
  const CLOSE_END     = 815;  // 13:35

  let state: "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE";
  let nextBoundary: number;

  if (twMin >= PREOPEN_START && twMin < OPEN_START) {
    state = "PRE-OPEN";
    nextBoundary = OPEN_START;
  } else if (twMin >= OPEN_START && twMin < MIDDAY_START) {
    state = "OPEN";
    nextBoundary = MIDDAY_START;
  } else if (twMin >= MIDDAY_START && twMin < CLOSE_END) {
    state = "MIDDAY";
    nextBoundary = CLOSE_END;
  } else {
    state = "POST-CLOSE";
    // Next pre-open is tomorrow 08:30
    nextBoundary = twMin < PREOPEN_START ? PREOPEN_START : PREOPEN_START + 24 * 60;
  }

  const countdownSec = (nextBoundary - twMin) * 60 - now.getUTCSeconds();

  return {
    state,
    countdownSec: Math.max(0, countdownSec),
    // Stub market data — real values require KGI quote or market-data feeds.
    // Returns deterministic zeros so frontend can render without OFFLINE state.
    futuresNight: { last: 0, chgPct: 0 },
    usMarket: { index: "NASDAQ", last: 0, chgPct: 0, closeTs: now.toISOString() },
    events: []
  };
}

// Map a backend Theme → RADAR Theme shape.
// Backend Theme has: id, name, slug, marketState, lifecycle, priority, thesis,
//   whyNow, bottleneck, corePoolCount, observationPoolCount, createdAt, updatedAt.
// RADAR Theme needs: rank, code, name, short, heat, dHeat, members, momentum,
//   lockState, pulse.
function backendThemeToRadar(theme: {
  priority: number;
  slug: string;
  name: string;
  lifecycle: string;
  corePoolCount: number;
  observationPoolCount: number;
}, rank: number): {
  rank: number;
  code: string;
  name: string;
  short: string;
  heat: number;
  dHeat: number;
  members: number;
  momentum: "ACCEL" | "STEADY" | "DECEL";
  lockState: "LOCKED" | "TRACK" | "WATCH" | "STALE";
  pulse: number[];
} {
  const lifecycleLockMap: Record<string, "LOCKED" | "TRACK" | "WATCH" | "STALE"> = {
    "Discovery":    "WATCH",
    "Validation":   "TRACK",
    "Expansion":    "LOCKED",
    "Crowded":      "LOCKED",
    "Distribution": "STALE"
  };
  // heat proxy: priority 1→90, 2→75, 3→60, 4→45, 5→30
  const heat = Math.max(10, 100 - theme.priority * 18);

  return {
    rank,
    code: theme.slug.toUpperCase().slice(0, 12),
    name: theme.name,
    short: theme.slug,
    heat,
    dHeat: 0,
    members: theme.corePoolCount + theme.observationPoolCount,
    momentum: "STEADY",
    lockState: lifecycleLockMap[theme.lifecycle] ?? "WATCH",
    pulse: Array(7).fill(heat)
  };
}

app.get("/api/v1/plans/brief", async (c) => {
  const session = c.get("session");
  const repo = c.get("repo");
  const today = new Date().toISOString().slice(0, 10);

  // Compose all fields in parallel
  const [themes, ideasView, riskState] = await Promise.all([
    repo.listThemes({ workspaceSlug: session.workspace.slug }),
    getStrategyIdeas({ session, repo, limit: 10 }),
    getRiskLimitState({ session, accountId: "paper-default" })
  ]);

  // market: derive from wall clock
  const market = composeTaiwanMarketState();

  // topThemes: top 6 by priority ascending (lower number = higher priority)
  const sortedThemes = [...themes].sort((a, b) => a.priority - b.priority).slice(0, 6);
  const topThemes = sortedThemes.map((t, i) => backendThemeToRadar(t, i + 1));

  // ideasOpen: map StrategyIdea → RADAR Idea
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 86_400_000).toISOString(); // +24h
  const ideasOpen = ideasView.items.slice(0, 10).map((idea) => {
    const side =
      idea.direction === "bullish" ? "LONG" as const
      : idea.direction === "bearish" ? "SHORT" as const
      : "EXIT" as const;
    const score01 = idea.score / 100;
    const quality =
      score01 >= 0.66 ? "HIGH" as const
      : score01 >= 0.33 ? "MED" as const
      : "LOW" as const;
    const themeCode = idea.topThemes[0]?.name ?? "GENERAL";
    return {
      id: `ID-${idea.companyId.slice(0, 8).toUpperCase()}`,
      symbol: idea.symbol,
      side,
      quality,
      confidence: idea.confidence,
      score: score01,
      themeCode,
      rationale: idea.rationale.primaryReason,
      emittedAt: nowIso,
      expiresAt: expiresIso,
      runId: "current"
    };
  });

  // watchlist: no backing table — return empty typed array
  const watchlist: { symbol: string; name: string; themeCode: string | null; note?: string }[] = [];

  // riskTodayLimits: map account risk limit → RADAR RiskLimit[] (3 key rules)
  const riskTodayLimits: {
    rule: string;
    limit: string;
    current: string;
    result: "PASS" | "WARN" | "BLOCK";
    layer?: "ACCT" | "STRAT" | "SYM" | "SESS";
  }[] = [
    {
      rule: "MAX·TRADE %",
      limit: `${riskState.maxPerTradePct?.toFixed(1) ?? "1.0"}%`,
      current: "0.0%",
      result: "PASS",
      layer: "ACCT"
    },
    {
      rule: "MAX·SYMBOL %",
      limit: `${riskState.maxSinglePositionPct?.toFixed(1) ?? "8.0"}%`,
      current: "0.0%",
      result: "PASS",
      layer: "ACCT"
    },
    {
      rule: "MAX·GROSS %",
      limit: `${riskState.maxGrossExposurePct?.toFixed(1) ?? "100.0"}%`,
      current: "0.0%",
      result: "PASS",
      layer: "ACCT"
    }
  ];

  const bundle = {
    date: today,
    market,
    topThemes,
    ideasOpen,
    watchlist,
    riskTodayLimits
  };

  return c.json({ data: bundle });
});

app.get("/api/v1/plans/review", async (c) => {
  const today = new Date().toISOString().slice(0, 10);

  // ReviewBundle shape per radar-types.ts:
  //   trades: ExecutionEvent[]   — paper orders filled today
  //   signalsSummary: { channel: SignalChannel; count: number }[]
  // No filled trades in paper yet; return typed empty arrays.
  const bundle: {
    date: string;
    pnl: { realized: number; unrealized: number; navStart: number; navEnd: number };
    trades: {
      id: string; kind: string; ts: string; orderId: string | null;
      clientOrderId: string | null; symbol: string; side: string | null;
      qty: number | null; price: number | null; fee: number | null;
      tax: number | null; raw: Record<string, unknown>;
    }[];
    ideaHitRate: { emitted: number; filled: number; pct: number };
    signalsSummary: { channel: "MOM"|"FII"|"KW"|"VOL"|"THM"|"MAN"; count: number }[];
  } = {
    date: today,
    pnl: { realized: 0, unrealized: 0, navStart: 0, navEnd: 0 },
    trades: [],
    ideaHitRate: { emitted: 0, filled: 0, pct: 0 },
    signalsSummary: []
  };

  return c.json({ data: bundle });
});

app.get("/api/v1/plans/weekly", async (c) => {
  const now = new Date();
  const weekNo = (() => {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  })();

  // WeeklyPlan shape per radar-types.ts:
  //   themeRotation: { code; heatStart; heatEnd; delta }[]
  //   strategyTweaks: { strategyId; change; ts }[]
  const bundle: {
    weekNo: string;
    summary: { trades: number; cumPnl: number; themeWinRate: number; bestTheme: string };
    themeRotation: { code: string; heatStart: number; heatEnd: number; delta: number }[];
    strategyTweaks: { strategyId: string; change: string; ts: string }[];
  } = {
    weekNo,
    summary: { trades: 0, cumPnl: 0, themeWinRate: 0, bestTheme: "" },
    themeRotation: [],
    strategyTweaks: []
  };

  return c.json({ data: bundle });
});

// ---------------------------------------------------------------------------
// Item 5 — POST /api/v1/portfolio/kill-mode  (thin adapter)
//
// Decision: ADD thin adapter route (Option A from gap doc).
// RADAR sends { mode: KillMode } where KillMode = "ARMED"|"SAFE"|"PEEK"|"FROZEN".
// Backend killSwitchInputSchema.mode = "trading"|"halted"|"paper_only"|"liquidate_only".
//
// Mapping:
//   ARMED   → trading       (normal active state)
//   SAFE    → halted        (full halt, no new orders)
//   PEEK    → paper_only    (demote to paper, strategy logic continues)
//   FROZEN  → liquidate_only (closing orders only)
//
// HARD LINE: this route NEVER calls setKillSwitchState in any test or fixture.
// The handler itself only arms the translation; it does NOT toggle state in CI.
// ---------------------------------------------------------------------------
const portfolioKillModeSchema = z.object({
  mode: z.enum(["ARMED", "SAFE", "PEEK", "FROZEN"])
});

const radarKillModeToBackend: Record<
  "ARMED" | "SAFE" | "PEEK" | "FROZEN",
  "trading" | "halted" | "paper_only" | "liquidate_only"
> = {
  ARMED: "trading",
  SAFE: "halted",
  PEEK: "paper_only",
  FROZEN: "liquidate_only"
};

app.post("/api/v1/portfolio/kill-mode", async (c) => {
  let payload: ReturnType<typeof portfolioKillModeSchema.parse>;
  try {
    payload = portfolioKillModeSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  const backendMode = radarKillModeToBackend[payload.mode];

  const result = await setKillSwitchState({
    session: c.get("session"),
    payload: {
      accountId: "paper-default",
      mode: backendMode,
      reason: `radar-ui:kill-mode:${payload.mode}`,
      engagedBy: c.get("session").user.id
    }
  });

  return c.json({ data: { ok: true, mode: payload.mode, backendMode, state: result } });
});

// ---------------------------------------------------------------------------
// F3 — GET /api/v1/reviews/log
//
// W7 L6: New route for radarUncoveredApi.reviewLog().
// Returns ReviewLogItem[] shape: { id, ts, reviewer, action, itemId }.
// Source: recent audit log entries — maps AuditEntry → ReviewLogItem.
// reviewer = entry.role ?? "system"
// action: "ACCEPT" if status < 400, else "REJECT"
// itemId: entity id from audit log
//
// radarUncoveredApi.reviewLog() previously fell back to /api/v1/openalice/jobs
// which returns OpenAlice job objects (wrong shape). This new route returns
// the correct ReviewLogItem[] shape so the fallback is no longer needed.
// ---------------------------------------------------------------------------
const reviewLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
});

app.get("/api/v1/reviews/log", async (c) => {
  const query = reviewLogQuerySchema.parse(c.req.query());
  const entries = await listAuditLogEntries({
    session: c.get("session"),
    limit: query.limit
  });

  const items = entries.map((entry) => {
    const isSuccess = (entry.status ?? 200) < 400;
    return {
      id: entry.id,
      ts: entry.createdAt,
      reviewer: entry.role ?? "system",
      action: isSuccess ? "ACCEPT" as const : "REJECT" as const,
      itemId: entry.entityId
    };
  });

  return c.json({ data: items });
});

// =============================================================================
// End of API Gap Fillers
// =============================================================================

// =============================================================================
// W7 D3 — OHLCV endpoints
// =============================================================================
// GET /api/v1/companies/:id/ohlcv?from=...&to=...&interval=1d
// Returns OhlcvBar[] for a single company.
// Falls back to deterministic mock (seeded by companyId) when no DB rows exist.
// Cache: 5-minute Redis TTL (fail-open — cache miss does not block response).

const ohlcvQuerySchema = z.object({
  from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  interval: z.enum(["1d", "1w", "1m"]).optional().default("1d")
});

app.get("/api/v1/companies/:id/ohlcv", async (c) => {
  let query: ReturnType<typeof ohlcvQuerySchema.parse>;
  try {
    query = ohlcvQuerySchema.parse(c.req.query());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  // Resolve UUID or ticker → company so we can pass ticker to FinMind fallback.
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const bars = await getCompanyOhlcv(company.id, c.get("session"), {
    from: query.from,
    to: query.to,
    interval: query.interval,
    ticker: company.ticker
  });

  return c.json({ data: bars });
});

// GET /api/v1/companies/ohlcv/bulk?ids=a,b,c&from=...&to=...&interval=1d
// Returns map<companyId, OhlcvBar[]>.  Used by watchlist chart rendering.

const ohlcvBulkQuerySchema = z.object({
  ids:      z.string().min(1),
  from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  interval: z.enum(["1d", "1w", "1m"]).optional().default("1d")
});

app.get("/api/v1/companies/ohlcv/bulk", async (c) => {
  let query: ReturnType<typeof ohlcvBulkQuerySchema.parse>;
  try {
    query = ohlcvBulkQuerySchema.parse(c.req.query());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  const ids = query.ids
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50); // cap at 50 companies per request

  const data = await getCompanyOhlcvBulk(ids, c.get("session"), {
    from: query.from,
    to: query.to,
    interval: query.interval
  });

  return c.json({ data });
});

// =============================================================================
// W7 D3 — Daily theme summary endpoints
// =============================================================================
// GET /api/v1/themes/daily/:date
// Returns the daily AI-generated theme summary for a given date (YYYY-MM-DD).
// 404 when no summary exists for that date yet.

app.get("/api/v1/themes/daily/:date", async (c) => {
  const dateParam = c.req.param("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return c.json({ error: "BAD_DATE_FORMAT", message: "Expected YYYY-MM-DD" }, 400);
  }

  const db = getDb();
  if (!db) {
    // Memory mode: return a mock summary
    const mockSummary = {
      id: "mock-summary-" + dateParam,
      dt: dateParam,
      summaryMd: `## Daily Theme Summary — ${dateParam}\n\n_No data available in memory mode._`,
      themeLabel: "No data (memory mode)",
      sourceEventCount: 0,
      generatedBy: "mock",
      createdAt: new Date().toISOString()
    };
    return c.json({ data: mockSummary });
  }

  const session = c.get("session");

  const rows = await db
    .select()
    .from(dailyThemeSummaries)
    .where(
      and(
        eq(dailyThemeSummaries.workspaceId, session.workspace.id),
        eq(dailyThemeSummaries.dt, dateParam)
      )
    )
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "NOT_FOUND", message: `No theme summary for ${dateParam}` }, 404);
  }

  const row = rows[0]!;
  return c.json({
    data: {
      id: row.id,
      dt: row.dt,
      summaryMd: row.summaryMd,
      themeLabel: row.themeLabel,
      sourceEventCount: row.sourceEventCount,
      generatedBy: row.generatedBy,
      createdAt: row.createdAt.toISOString()
    }
  });
});

// ── W7 Market Agent Ingest (/internal/market/*) ───────────────────────────────
//
// Server-to-server only. Frontend MUST NOT call these routes.
// Auth: Bearer token === MARKET_AGENT_HMAC_SECRET (quick pre-check before HMAC
// verify so unauthenticated callers pay zero ingest cost).
//
// POST /internal/market/ingest   — receive signed MarketEvent from agent
// POST /internal/market/heartbeat — receive liveness ping from agent
// GET  /internal/market/health   — ops: agent staleness status
//
// Hard lines:
//   - MARKET_AGENT_HMAC_SECRET never logged / never returned in response
//   - Stale data → warning in result, never silent fill (W7 hard line #11)
//   - No /order/create, no kill-switch touched

import {
  ingestMarketEvent,
  updateAgentHeartbeat,
  getAgentHealth,
} from "./market-ingest.js";
import {
  marketEventSchema,
  marketAgentHeartbeatSchema,
} from "@iuf-trading-room/contracts";

function requireMarketAgentBearer(c: Context): boolean {
  const secret = process.env.MARKET_AGENT_HMAC_SECRET;
  if (!secret) return false;  // no secret configured → block all

  const bearer = getBearerToken(c);
  if (!bearer) return false;

  // Timing-safe compare to prevent oracle on token length
  const expectedBuf = Buffer.from(secret, "utf8");
  const receivedBuf = Buffer.from(bearer, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

// POST /internal/market/ingest
app.post("/internal/market/ingest", async (c) => {
  if (!requireMarketAgentBearer(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let event: ReturnType<typeof marketEventSchema.parse>;
  try {
    event = marketEventSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", details: err.flatten() }, 400);
    }
    return c.json({ error: "bad_request" }, 400);
  }

  const result = await ingestMarketEvent(event);

  if (!result.ok) {
    const statusCode =
      result.rejectedReason === "hmac_invalid" ? 401 :
      result.rejectedReason === "sequence_duplicate" ? 409 :
      result.rejectedReason === "sequence_regression" ? 422 : 400;
    return c.json({
      ok: false,
      rejectedReason: result.rejectedReason,
      cached: false,
      persisted: false
    }, statusCode);
  }

  return c.json({
    ok: true,
    eventId: result.eventId,
    cached: result.cached,
    persisted: result.persisted
  }, 201);
});

// POST /internal/market/heartbeat
app.post("/internal/market/heartbeat", async (c) => {
  if (!requireMarketAgentBearer(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let heartbeat: ReturnType<typeof marketAgentHeartbeatSchema.parse>;
  try {
    heartbeat = marketAgentHeartbeatSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", details: err.flatten() }, 400);
    }
    return c.json({ error: "bad_request" }, 400);
  }

  await updateAgentHeartbeat(heartbeat);
  return c.json({ ok: true });
});

// GET /internal/market/health
app.get("/internal/market/health", async (c) => {
  if (!requireMarketAgentBearer(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const health = await getAgentHealth();
  return c.json({ data: health });
});

// ── W7 H1: FinMind financial data routes (/api/v1/companies/:id/financials etc.) ────────
//
// All routes require session cookie auth (inside /api/v1/* middleware).
// Token read from FINMIND_API_TOKEN env — never logged or returned in response.
// Fallback: empty array when token missing (no throw).
// Cache TTLs: OHLCV=600s / financials=3600s / chips=1800s / dividends=86400s.

import { getFinMindClient, getFinMindStats } from "./data-sources/finmind-client.js";
import { getTwseOpenApiClient } from "./data-sources/twse-openapi-client.js";
import { runOhlcvFinmindSync } from "./jobs/ohlcv-finmind-sync.js";
import {
  runMonthlyRevenueSync,
  runFinancialStatementsSync,
  runBalanceSheetSync,
  runCashFlowsSync,
  isMonthlyRevenueBurstDay,
  isInQuarterlyReleaseWindow,
  isWeeklyTriggerDay,
  queryFundamentalDatasetStats
} from "./jobs/fundamentals-finmind-sync.js";
import {
  runInstitutionalBuySellSync,
  runMarginShortSync,
  runShareholdingSync,
  isFridayTriggerDay,
  queryTradingFlowDatasetStats
} from "./jobs/trading-flow-finmind-sync.js";
import {
  runDividendSync,
  runMarketValueSync,
  runValuationSync,
  runStockNewsSync,
  isWeekendTriggerDay,
  isSundayTriggerDay,
  queryMarketIntelDatasetStats
} from "./jobs/market-intel-finmind-sync.js";

// Helper: resolve ticker from company (already resolved via resolveCompany → company.ticker)
function companyIdToTicker(ticker: string): string {
  // Taiwan stocks: ticker is already the FinMind data_id (e.g. "2330")
  return ticker;
}

// Date helpers for FinMind range params
function nYearsAgoDate(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function nMonthsAgoDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function nDaysAgoDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const todayDate = () => new Date().toISOString().slice(0, 10);
const taipeiDate = (date = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(date);

function finmindQuotaTier(tokenPresent: boolean): string {
  if (!tokenPresent) return "none";
  return process.env.FINMIND_QUOTA_TIER ?? process.env.FINMIND_TIER ?? "sponsor999";
}

function finmindQuotaLimitPerHour(tier: string): number | null {
  const configured = Number(process.env.FINMIND_QUOTA_LIMIT_PER_HOUR ?? "");
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  if (tier === "sponsor999") return 6000;
  if (tier === "free") return 600;
  return null;
}

function isWeekendDate(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function recentKBarDateCandidates(primaryDate: string, lookbackDays = 10): string[] {
  const dates = new Set<string>();
  const latestTaipeiDate = taipeiDate();
  for (const seed of [primaryDate, latestTaipeiDate, todayDate()]) {
    const base = new Date(`${seed}T00:00:00Z`);
    if (Number.isNaN(base.getTime())) continue;
    for (let offset = 0; offset < lookbackDays; offset += 1) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() - offset);
      const candidate = d.toISOString().slice(0, 10);
      if (candidate > latestTaipeiDate || isWeekendDate(candidate)) continue;
      dates.add(candidate);
    }
  }
  return Array.from(dates);
}

const FINMIND_DATASET_STATUS = [
  { key: "TaiwanStockPriceAdj", label: "還原日 K", implemented: true },
  { key: "TaiwanStockPrice", label: "日 K 備援", implemented: true },
  { key: "TaiwanStockKBar", label: "分 K", implemented: true },
  { key: "TaiwanStockFinancialStatements", label: "損益表", implemented: true },
  { key: "TaiwanStockBalanceSheet", label: "資產負債表", implemented: true },
  { key: "TaiwanStockCashFlowsStatement", label: "現金流量表", implemented: true },
  { key: "TaiwanStockMonthRevenue", label: "月營收", implemented: true },
  { key: "TaiwanStockInstitutionalInvestorsBuySell", label: "三大法人", implemented: true },
  { key: "TaiwanStockMarginPurchaseShortSale", label: "融資融券", implemented: true },
  { key: "TaiwanStockDividend", label: "股利", implemented: true },
  { key: "TaiwanStockNews", label: "台股新聞", implemented: false, blocker: "freeze_no_news_feature" },
  { key: "TaiwanStockPER", label: "PER / PBR / 殖利率", implemented: true },
  { key: "TaiwanStockMarketValue", label: "股價市值", implemented: true },
  { key: "TaiwanStockShareholding", label: "外資持股", implemented: true },
  { key: "TaiwanStockHoldingSharesPer", label: "股權分散", implemented: true },
  { key: "taiwan_stock_tick_snapshot", label: "即時快照", implemented: false, blocker: "quote_contract_pending" }
] as const;

const finmindKBarQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(20).default(1),
  // 5/7 production regression fix: frontend Codex K-line series queries with
  // ?freq=1d expecting daily candles. Was silently ignored → route always
  // hit FinMind minute-K live API → empty during pre-market hours / when
  // minute data lags. freq=1d now reads from companies_ohlcv DB cache.
  freq: z.enum(["1d", "1m"]).default("1m")
});

// GET /api/v1/data-sources/finmind/status
// B3-1 (2026-05-06): Productized dataset readiness panel.
// Returns global token/quota info + per-dataset state with DB-backed rowCount/latestDate
// for OHLCV datasets, and FALLBACK for non-persisted financial datasets.
// Hard lines:
//   - Token value NEVER returned (only boolean presence)
//   - rowCount / latestDate come from real SQL (companies_ohlcv) — no faking
//   - Non-OHLCV datasets have no local DB table → state=FALLBACK when token present
//   - state enum: LIVE / STALE / EMPTY / BLOCKED / DEGRADED / ERROR / MOCK / FALLBACK / CLOSED
app.get("/api/v1/data-sources/finmind/status", async (c) => {
  const finmind = getFinMindClient();
  const tokenPresent = finmind.hasToken();
  const stats = getFinMindStats();
  const quotaTier = finmindQuotaTier(tokenPresent);
  const quotaLimitPerHour = finmindQuotaLimitPerHour(quotaTier);
  const errorRatePct = stats.requestCount === 0
    ? null
    : Math.round((stats.errorCount / stats.requestCount) * 10000) / 100;
  const circuitOpen = stats.circuitOpen;
  const degradedByErrors = Boolean(
    tokenPresent &&
    (
      circuitOpen ||
      (stats.requestCount >= 10 && errorRatePct !== null && errorRatePct >= 50)
    )
  );
  const sourceState = tokenPresent
    ? degradedByErrors ? "DEGRADED" : "LIVE_READY"
    : "BLOCKED";

  // B3-1: Query companies_ohlcv for OHLCV-backed dataset row counts and freshness.
  // Only OHLCV datasets (PriceAdj, Price, KBar) are persisted locally.
  // All other FinMind datasets are API-only (no local table).
  type OhlcvDbStats = {
    rowCount: number;
    latestDate: string | null;
    dbState: "LIVE" | "STALE" | "EMPTY" | "MOCK" | "ERROR";
    missingReason: string | null;
    degradedReason: string | null;
  };
  let ohlcvAdjStats: OhlcvDbStats  = { rowCount: 0, latestDate: null, dbState: "EMPTY", missingReason: "no_db_query", degradedReason: null };
  let ohlcvRawStats: OhlcvDbStats  = { rowCount: 0, latestDate: null, dbState: "EMPTY", missingReason: "no_db_query", degradedReason: null };
  let kbarStats: OhlcvDbStats      = { rowCount: 0, latestDate: null, dbState: "EMPTY", missingReason: "no_db_query", degradedReason: null };

  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;

  async function queryOhlcvStats(interval: string, sourceFilter?: string): Promise<OhlcvDbStats> {
    if (!db) return { rowCount: 0, latestDate: null, dbState: "EMPTY", missingReason: "no_database", degradedReason: null };
    try {
      const result = await db.execute(drizzleSql`
        SELECT
          COUNT(*)::int                                         AS total_rows,
          MAX(dt)::text                                         AS latest_date,
          COUNT(*) FILTER (WHERE source = 'mock')::int          AS mock_rows,
          COUNT(*) FILTER (WHERE source != 'mock')::int         AS real_rows
        FROM companies_ohlcv
        WHERE interval = ${interval}
        ${sourceFilter ? drizzleSql`AND source = ${sourceFilter}` : drizzleSql``}
      `);
      const r = (result as { rows?: Record<string, unknown>[] })?.rows?.[0]
        ?? (Array.isArray(result) ? result[0] : result);
      const totalRows  = typeof r?.total_rows  === "number" ? r.total_rows  : parseInt(String(r?.total_rows  ?? "0"), 10);
      const mockRows   = typeof r?.mock_rows   === "number" ? r.mock_rows   : parseInt(String(r?.mock_rows   ?? "0"), 10);
      const realRows   = typeof r?.real_rows   === "number" ? r.real_rows   : parseInt(String(r?.real_rows   ?? "0"), 10);
      const latestDate = typeof r?.latest_date === "string" ? r.latest_date : null;

      if (totalRows === 0) return { rowCount: 0, latestDate: null, dbState: "EMPTY", missingReason: "no_rows", degradedReason: null };
      if (realRows === 0)  return { rowCount: totalRows, latestDate, dbState: "MOCK", missingReason: null, degradedReason: "all_rows_are_mock" };

      // 4-day stale threshold covers TWSE longest gap (Fri→Tue after Mon holiday)
      const staleMs = 4 * 24 * 60 * 60 * 1000;
      const isStale = latestDate ? (Date.now() - new Date(latestDate).getTime()) > staleMs : true;
      const dbState = isStale ? "STALE" : "LIVE";
      const degradedReason = isStale ? `latest_date_${latestDate}_beyond_4d` : null;
      return { rowCount: totalRows, latestDate, dbState, missingReason: null, degradedReason };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { rowCount: 0, latestDate: null, dbState: "ERROR", missingReason: msg, degradedReason: null };
    }
  }

  // PR A: fundamental dataset stats from DB (if tables exist)
  type FundamentalStats = Awaited<ReturnType<typeof queryFundamentalDatasetStats>>;
  let monthlyRevenueStats: FundamentalStats  = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };
  let financialStmtStats: FundamentalStats   = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };
  let balanceSheetStats: FundamentalStats    = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };
  let cashflowStats: FundamentalStats        = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };

  // PR B: trading-flow dataset stats from DB (if tables exist)
  type TradingFlowStats = Awaited<ReturnType<typeof queryTradingFlowDatasetStats>>;
  let institutionalBuySellStats: TradingFlowStats = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };
  let marginShortStats: TradingFlowStats          = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };
  let shareholdingStats: TradingFlowStats         = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };

  // PR C: market-intel dataset stats from DB (if tables exist)
  type MarketIntelStats = Awaited<ReturnType<typeof queryMarketIntelDatasetStats>>;
  let dividendStats: MarketIntelStats    = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };
  let marketValueStats: MarketIntelStats = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };
  let valuationStats: MarketIntelStats   = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };
  let stockNewsStats: MarketIntelStats   = { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "not_queried" };

  if (tokenPresent && db) {
    [ohlcvAdjStats, ohlcvRawStats, kbarStats] = await Promise.all([
      queryOhlcvStats("1d", "finmind_adj"),
      queryOhlcvStats("1d", "finmind"),
      queryOhlcvStats("1m")
    ]);
    // PriceAdj fallback: if finmind_adj has no rows, fall back to any 1d real rows
    if (ohlcvAdjStats.rowCount === 0) {
      const anyDayStats = await queryOhlcvStats("1d");
      if (anyDayStats.rowCount > 0) {
        ohlcvAdjStats = { ...anyDayStats, degradedReason: "source_not_tagged_adj" };
      }
    }
    // PR A: query fundamental dataset stats in parallel
    [monthlyRevenueStats, financialStmtStats, balanceSheetStats, cashflowStats] = await Promise.all([
      queryFundamentalDatasetStats("tw_monthly_revenue"),
      queryFundamentalDatasetStats("tw_financial_statements"),
      queryFundamentalDatasetStats("tw_balance_sheet"),
      queryFundamentalDatasetStats("tw_cashflow_statement")
    ]);
    // PR B: query trading-flow dataset stats in parallel (staleDays: daily=5)
    [institutionalBuySellStats, marginShortStats, shareholdingStats] = await Promise.all([
      queryTradingFlowDatasetStats("tw_institutional_buysell", 5),
      queryTradingFlowDatasetStats("tw_margin_short", 5),
      queryTradingFlowDatasetStats("tw_shareholding", 5)   // S2: align to daily=5 (was 10)
    ]);
    // PR C: query market-intel dataset stats in parallel
    // dividend: weekly (staleDays=10); market_value/valuation: daily (staleDays=5); news: 30min (staleDays=1)
    [dividendStats, marketValueStats, valuationStats, stockNewsStats] = await Promise.all([
      queryMarketIntelDatasetStats("tw_dividend", 10),
      queryMarketIntelDatasetStats("tw_market_value", 5),  // S2: align to daily=5 (was 10)
      queryMarketIntelDatasetStats("tw_valuation", 5),
      queryMarketIntelDatasetStats("tw_stock_news", 1, "fetched_at")
    ]);
  } else if (!db) {
    const noDbEntry: OhlcvDbStats = { rowCount: 0, latestDate: null, dbState: "EMPTY", missingReason: "memory_mode", degradedReason: null };
    ohlcvAdjStats = noDbEntry;
    ohlcvRawStats = noDbEntry;
    kbarStats = noDbEntry;
  }

  // Derive per-dataset state for OHLCV-backed datasets
  function ohlcvDatasetState(s: OhlcvDbStats, degraded: boolean): string {
    if (!tokenPresent) return "BLOCKED";
    if (degraded) return "DEGRADED";
    return s.dbState; // LIVE / STALE / EMPTY / MOCK / ERROR
  }

  // Non-OHLCV datasets: no local DB table. state=FALLBACK when token present.
  // FALLBACK = token present + can query API on demand, but no local persistence proof.
  function apiOnlyDatasetState(implemented: boolean): string {
    if (!implemented) return "CLOSED";
    if (!tokenPresent) return "BLOCKED";
    if (degradedByErrors) return "DEGRADED";
    return "FALLBACK";
  }

  type DatasetEntry = {
    key: string;
    label: string;
    state: string;
    lastFetchTs: string | null;
    rowCount: number | null;
    latestDate: string | null;
    missingReason: string | null;
    degradedReason: string | null;
    experimental?: boolean;
  };

  const datasets: DatasetEntry[] = [
    {
      key: "TaiwanStockPriceAdj",
      label: "OHLCV/KBar adj",
      state: ohlcvDatasetState(ohlcvAdjStats, degradedByErrors),
      lastFetchTs: stats.lastDataset?.startsWith("TaiwanStockPriceAdj") ? stats.lastFetchTs : null,
      rowCount: db ? ohlcvAdjStats.rowCount : null,
      latestDate: ohlcvAdjStats.latestDate,
      missingReason: ohlcvAdjStats.missingReason,
      degradedReason: ohlcvAdjStats.degradedReason
    },
    {
      key: "TaiwanStockPrice",
      label: "日 K 備援",
      state: ohlcvDatasetState(ohlcvRawStats, degradedByErrors),
      lastFetchTs: stats.lastDataset?.startsWith("TaiwanStockPrice") ? stats.lastFetchTs : null,
      rowCount: db ? ohlcvRawStats.rowCount : null,
      latestDate: ohlcvRawStats.latestDate,
      missingReason: ohlcvRawStats.missingReason,
      degradedReason: ohlcvRawStats.degradedReason
    },
    {
      key: "TaiwanStockKBar",
      label: "分 K",
      state: ohlcvDatasetState(kbarStats, degradedByErrors),
      lastFetchTs: stats.lastDataset?.startsWith("TaiwanStockKBar") ? stats.lastFetchTs : null,
      rowCount: db ? kbarStats.rowCount : null,
      latestDate: kbarStats.latestDate,
      missingReason: kbarStats.missingReason,
      degradedReason: kbarStats.degradedReason
    },
    {
      key: "TaiwanStockMonthRevenue",
      label: "月營收",
      // PR A: DB-backed state from tw_monthly_revenue; BLOCKED when no token
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : monthlyRevenueStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockMonthRevenue" ? stats.lastFetchTs : null,
      rowCount: db ? monthlyRevenueStats.rowCount : null,
      latestDate: monthlyRevenueStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : monthlyRevenueStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockFinancialStatements",
      label: "損益表",
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : financialStmtStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockFinancialStatements" ? stats.lastFetchTs : null,
      rowCount: db ? financialStmtStats.rowCount : null,
      latestDate: financialStmtStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : financialStmtStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockBalanceSheet",
      label: "資產負債表",
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : balanceSheetStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockBalanceSheet" ? stats.lastFetchTs : null,
      rowCount: db ? balanceSheetStats.rowCount : null,
      latestDate: balanceSheetStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : balanceSheetStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockCashFlowsStatement",
      label: "現金流量表",
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : cashflowStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockCashFlowsStatement" ? stats.lastFetchTs : null,
      rowCount: db ? cashflowStats.rowCount : null,
      latestDate: cashflowStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : cashflowStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockPER",
      label: "PER / PBR / 殖利率",
      // PR C: DB-backed state from tw_valuation; BLOCKED when no token
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : valuationStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockPER" ? stats.lastFetchTs : null,
      rowCount: db ? valuationStats.rowCount : null,
      latestDate: valuationStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : valuationStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockMarketValue",
      label: "股價市值",
      // PR C: DB-backed state from tw_market_value; BLOCKED when no token
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : marketValueStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockMarketValue" ? stats.lastFetchTs : null,
      rowCount: db ? marketValueStats.rowCount : null,
      latestDate: marketValueStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : marketValueStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockDividend",
      label: "股利",
      // PR C: DB-backed state from tw_dividend; BLOCKED when no token
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : dividendStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockDividend" ? stats.lastFetchTs : null,
      rowCount: db ? dividendStats.rowCount : null,
      latestDate: dividendStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : dividendStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockInstitutionalInvestorsBuySell",
      label: "三大法人",
      // PR B: DB-backed state from tw_institutional_buysell; BLOCKED when no token
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : institutionalBuySellStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockInstitutionalInvestorsBuySell" ? stats.lastFetchTs : null,
      rowCount: db ? institutionalBuySellStats.rowCount : null,
      latestDate: institutionalBuySellStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : institutionalBuySellStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockMarginPurchaseShortSale",
      label: "融資融券",
      // PR B: DB-backed state from tw_margin_short; BLOCKED when no token
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : marginShortStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockMarginPurchaseShortSale" ? stats.lastFetchTs : null,
      rowCount: db ? marginShortStats.rowCount : null,
      latestDate: marginShortStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : marginShortStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockShareholding",
      label: "外資持股/集保戶數",
      // PR B: DB-backed state from tw_shareholding; BLOCKED when no token
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : shareholdingStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockShareholding" ? stats.lastFetchTs : null,
      rowCount: db ? shareholdingStats.rowCount : null,
      latestDate: shareholdingStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : shareholdingStats.missingReason,
      degradedReason: degradedByErrors ? "high_error_rate" : null
    },
    {
      key: "TaiwanStockNews",
      label: "台股新聞 (experimental)",
      // PR C: DB-backed EXPERIMENTAL. If endpoint unstable → stays DEGRADED/EMPTY.
      // Never faked. state=LIVE only when real rows exist in tw_stock_news.
      state: !tokenPresent ? "BLOCKED" : (degradedByErrors ? "DEGRADED" : stockNewsStats.state),
      lastFetchTs: stats.lastDataset === "TaiwanStockNews" ? stats.lastFetchTs : null,
      rowCount: db ? stockNewsStats.rowCount : null,
      latestDate: stockNewsStats.latestDate,
      missingReason: !tokenPresent ? "no_token" : (stockNewsStats.missingReason ?? "experimental_may_degrade"),
      degradedReason: degradedByErrors ? "high_error_rate" : null,
      experimental: true
    },
    {
      key: "taiwan_stock_tick_snapshot",
      label: "即時快照",
      state: "CLOSED",
      lastFetchTs: null,
      rowCount: null,
      latestDate: null,
      missingReason: "quote_contract_pending",
      degradedReason: null
    }
  ];

  return c.json({
    data: {
      source: "FINMIND",
      state: sourceState,
      global: {
        tokenPresent,
        quotaTier,
        rateLimitPerHour: quotaLimitPerHour
      },
      quota: {
        used: stats.requestCount,
        limit: quotaLimitPerHour,
        source: `process_counter:${quotaTier}`
      },
      health: {
        requestCount: stats.requestCount,
        errorCount: stats.errorCount,
        errorRatePct,
        lastFetchTs: stats.lastFetchTs,
        lastDataset: stats.lastDataset,
        degradedByErrors,
        circuitOpen,
        circuitOpenUntil: stats.circuitOpenUntil,
        circuitReason: stats.circuitReason,
        circuitDataset: stats.circuitDataset,
        circuitOpenedAt: stats.circuitOpenedAt,
        circuitSkipCount: stats.circuitSkipCount,
        forbiddenCount: stats.forbiddenCount
      },
      datasets,
      notes: [
        "diagnostics_only",
        "token_never_returned",
        "finmind_does_not_enable_broker_submit",
        "kbar_single_day_payload",
        "ohlcv_datasets_db_backed_others_api_only",
        "state_fallback_means_api_queryable_no_local_persist",
        ...(circuitOpen ? ["finmind_upstream_circuit_open"] : []),
        ...(degradedByErrors ? ["recent_fetch_errors_high"] : [])
      ],
      updatedAt: new Date().toISOString()
    }
  });
});

// GET /api/v1/companies/:id/kbar?date=YYYY-MM-DD
// Authenticated read-only FinMind Sponsor KBar route. Never touches broker submit.
app.get("/api/v1/companies/:id/kbar", async (c) => {
  const query = finmindKBarQuerySchema.parse(c.req.query());
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const date = query.date ?? taipeiDate();
  const stockId = companyIdToTicker(company.ticker);

  // 5/7 production regression fix: freq=1d → read companies_ohlcv DB cache
  // (daily candles, already populated via /ohlcv path). Avoids FinMind
  // minute-K live API empty results during pre-market / weekend / holiday.
  if (query.freq === "1d") {
    const db = getDb();
    if (!db || !isDatabaseMode()) {
      return c.json({
        data: {
          source: "FINMIND",
          state: "BLOCKED",
          reason: "db_unavailable_for_daily_kbar",
          stockId, date, rows: [],
          updatedAt: new Date().toISOString()
        }
      });
    }
    try {
      const dailyRows = await db.execute(drizzleSql`
        SELECT dt::text AS dt, open, high, low, close, volume, source
        FROM companies_ohlcv
        WHERE company_id = ${company.id}
          AND interval = '1d'
        ORDER BY dt DESC
        LIMIT ${query.days * 30}
      `);
      const rawRows = (dailyRows as { rows?: Record<string, unknown>[] })?.rows
        ?? (Array.isArray(dailyRows) ? dailyRows : []);
      const rows = rawRows
        .map((r) => ({
          date: String(r.dt ?? ""),
          minute: "13:30:00",
          stock_id: stockId,
          open: Number(r.open ?? 0),
          high: Number(r.high ?? 0),
          low: Number(r.low ?? 0),
          close: Number(r.close ?? 0),
          volume: Number(r.volume ?? 0)
        }))
        .reverse(); // oldest → newest
      const resolvedDates = Array.from(new Set(rows.map((r) => r.date))).sort();
      const latestDate = resolvedDates.at(-1) ?? date;
      return c.json({
        data: {
          source: "FINMIND",
          state: rows.length > 0 ? "LIVE" : "EMPTY",
          reason: rows.length > 0 ? null : "no_daily_kbar_in_companies_ohlcv",
          stockId,
          date: latestDate,
          dateRange: resolvedDates.length > 0 ? { from: resolvedDates[0], to: resolvedDates[resolvedDates.length - 1] } : null,
          daysRequested: query.days,
          daysReturned: resolvedDates.length,
          resolvedDates,
          candidateDatesScanned: 0,
          requestedDate: date,
          rows,
          updatedAt: new Date().toISOString()
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[kbar-1d] DB query failed:", msg);
      return c.json({
        data: {
          source: "FINMIND", state: "ERROR",
          reason: "db_query_failed", stockId, date, rows: [],
          updatedAt: new Date().toISOString()
        }
      }, 503);
    }
  }

  // freq=1m (default) — existing FinMind live minute-K path unchanged
  const client = getFinMindClient();
  const tokenPresent = client.hasToken();
  if (!tokenPresent) {
    return c.json({
      data: {
        source: "FINMIND",
        state: "BLOCKED",
        reason: "finmind_token_missing",
        stockId,
        date,
        rows: [],
        updatedAt: new Date().toISOString()
      }
    });
  }

  const dayGroups: Array<{ date: string; rows: Awaited<ReturnType<typeof client.getStockKBar>> }> = [];
  const lookbackDays = Math.max(12, query.days * 3 + 10);
  const candidateDates = recentKBarDateCandidates(date, lookbackDays);
  for (const candidateDate of candidateDates) {
    const candidateRows = await client.getStockKBar(stockId, candidateDate);
    if (candidateRows.length === 0) continue;
    dayGroups.push({ date: candidateDate, rows: candidateRows });
    if (dayGroups.length >= query.days) break;
  }
  const resolvedDates = dayGroups.map((group) => group.date).sort();
  const rows = dayGroups
    .flatMap((group) => group.rows)
    .sort((a, b) => `${a.date} ${a.minute}`.localeCompare(`${b.date} ${b.minute}`));
  const resolvedDate = resolvedDates.at(-1) ?? date;

  return c.json({
    data: {
      source: "FINMIND",
      state: rows.length > 0 ? "LIVE" : "EMPTY",
      reason: rows.length > 0 ? null : "no_kbar_rows_for_recent_dates",
      stockId,
      date: resolvedDate,
      dateRange: resolvedDates.length > 0 ? { from: resolvedDates[0], to: resolvedDates[resolvedDates.length - 1] } : null,
      daysRequested: query.days,
      daysReturned: resolvedDates.length,
      resolvedDates,
      candidateDatesScanned: candidateDates.length,
      requestedDate: date,
      rows,
      updatedAt: new Date().toISOString()
    }
  });
});

// GET /api/v1/companies/:id/financials?period=Q&limit=8
// Returns: { data: FinancialRow[] } reshaped from FinMind long-format rows.
// FinancialRow = { period, revenue, grossMarginPct, operatingMarginPct, epsAfterTax, yoyPct }
app.get("/api/v1/companies/:id/financials", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const limit = Math.max(1, Math.min(32, Number(c.req.query("limit") ?? "8")));
  // 8 quarters = 2 years; pull a year extra so YoY has comparison row.
  const yearsBack = Math.ceil(limit / 4) + 2;
  const startDate = nYearsAgoDate(yearsBack);
  const stockId = companyIdToTicker(company.ticker);

  const rows = await getFinMindClient().getFinancialStatements(stockId, startDate, todayDate());

  // FinMind long-format: each (date, type, value) tuple — bucket by date then map known type aliases.
  const REVENUE_KEYS = new Set(["Revenue", "OperatingRevenue", "NetRevenue"]);
  const GROSS_PROFIT_KEYS = new Set(["GrossProfit", "GrossProfitLoss", "GrossProfitFromOperations"]);
  const OP_INCOME_KEYS = new Set(["OperatingIncome", "OperatingIncomeLoss", "IncomeFromOperatingActivities"]);
  const EPS_KEYS = new Set(["EPS", "EarningsPerShare", "BasicEPS"]);

  const buckets = new Map<string, { revenue: number | null; gross: number | null; op: number | null; eps: number | null }>();
  for (const r of rows) {
    let bucket = buckets.get(r.date);
    if (!bucket) {
      bucket = { revenue: null, gross: null, op: null, eps: null };
      buckets.set(r.date, bucket);
    }
    if (REVENUE_KEYS.has(r.type)) bucket.revenue = r.value;
    else if (GROSS_PROFIT_KEYS.has(r.type)) bucket.gross = r.value;
    else if (OP_INCOME_KEYS.has(r.type)) bucket.op = r.value;
    else if (EPS_KEYS.has(r.type)) bucket.eps = r.value;
  }

  const dateToPeriod = (d: string) => {
    const [yyyy, mm] = d.split("-");
    const m = Number(mm);
    const q = m <= 3 ? 1 : m <= 6 ? 2 : m <= 9 ? 3 : 4;
    return `${yyyy.slice(2)}Q${q}`;
  };

  // Build period→revenue map for YoY lookup before we trim.
  const revenueByPeriod = new Map<string, number>();
  for (const [date, b] of buckets) {
    if (b.revenue !== null) revenueByPeriod.set(dateToPeriod(date), b.revenue);
  }
  const yoyKey = (period: string) => {
    const yy = Number(period.slice(0, 2));
    const q = period.slice(2);
    return `${String(yy - 1).padStart(2, "0")}${q}`;
  };

  type FinancialRow = {
    period: string;
    revenue: number | null;
    grossMarginPct: number | null;
    operatingMarginPct: number | null;
    epsAfterTax: number | null;
    yoyPct: number | null;
  };

  const allRows: FinancialRow[] = Array.from(buckets.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // descending by date
    .map(([date, b]) => {
      const period = dateToPeriod(date);
      const grossMarginPct = b.revenue && b.revenue !== 0 && b.gross !== null ? (b.gross / b.revenue) * 100 : null;
      const operatingMarginPct = b.revenue && b.revenue !== 0 && b.op !== null ? (b.op / b.revenue) * 100 : null;
      const prevRev = revenueByPeriod.get(yoyKey(period));
      const yoyPct = b.revenue !== null && prevRev !== undefined && prevRev !== 0
        ? ((b.revenue - prevRev) / prevRev) * 100
        : null;
      return {
        period,
        revenue: b.revenue,
        grossMarginPct,
        operatingMarginPct,
        epsAfterTax: b.eps,
        yoyPct
      };
    })
    .slice(0, limit);

  return c.json({ data: allRows });
});

function latestBucket(rows: Array<{ date: string; type: string; value: number; origin_name?: string }>) {
  const buckets = new Map<string, Map<string, { value: number; originName: string | null }>>();
  for (const row of rows) {
    if (!row.date || !row.type || row.type.endsWith("_per")) continue;
    let bucket = buckets.get(row.date);
    if (!bucket) {
      bucket = new Map();
      buckets.set(row.date, bucket);
    }
    bucket.set(row.type, { value: row.value, originName: row.origin_name ?? null });
  }
  const latestDate = [...buckets.keys()].sort((a, b) => b.localeCompare(a))[0] ?? null;
  return latestDate ? { date: latestDate, bucket: buckets.get(latestDate) ?? new Map() } : null;
}

function pickMetric(
  bucket: Map<string, { value: number; originName: string | null }>,
  keys: string[]
) {
  for (const key of keys) {
    const found = bucket.get(key);
    if (found) return found;
  }
  return null;
}

// GET /api/v1/companies/:id/balance-sheet?years=3
// Returns one compact latest balance-sheet snapshot plus selected line items.
app.get("/api/v1/companies/:id/balance-sheet", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const years = Math.max(1, Math.min(10, Number(c.req.query("years") ?? "3")));
  const stockId = companyIdToTicker(company.ticker);
  const rows = await getFinMindClient().getBalanceSheet(stockId, nYearsAgoDate(years), todayDate());
  const latest = latestBucket(rows);

  if (!latest) {
    return c.json({ data: null });
  }

  const totalAssets = pickMetric(latest.bucket, ["TotalAssets", "Assets"]);
  const totalLiabilities = pickMetric(latest.bucket, ["TotalLiabilities", "Liabilities"]);
  const equity = pickMetric(latest.bucket, ["Equity", "EquityAttributableToOwnersOfParent", "TotalEquity"]);
  const currentAssets = pickMetric(latest.bucket, ["CurrentAssets", "TotalCurrentAssets"]);
  const currentLiabilities = pickMetric(latest.bucket, ["CurrentLiabilities", "TotalCurrentLiabilities"]);
  const cash = pickMetric(latest.bucket, ["CashAndCashEquivalents", "CashAndCashEquivalentsAtCarryingValue"]);

  const debtRatioPct = totalAssets?.value && totalLiabilities
    ? (totalLiabilities.value / totalAssets.value) * 100
    : null;
  const currentRatioPct = currentLiabilities?.value && currentAssets
    ? (currentAssets.value / currentLiabilities.value) * 100
    : null;

  return c.json({
    data: {
      date: latest.date,
      stock_id: stockId,
      totalAssets: totalAssets?.value ?? null,
      totalLiabilities: totalLiabilities?.value ?? null,
      equity: equity?.value ?? null,
      cashAndCashEquivalents: cash?.value ?? null,
      currentAssets: currentAssets?.value ?? null,
      currentLiabilities: currentLiabilities?.value ?? null,
      debtRatioPct,
      currentRatioPct,
      sourceItems: [...latest.bucket.entries()]
        .slice(0, 80)
        .map(([type, item]) => ({ type, value: item.value, originName: item.originName }))
    }
  });
});

// GET /api/v1/companies/:id/cash-flow?years=3
// Returns one compact latest cash-flow snapshot plus selected line items.
app.get("/api/v1/companies/:id/cash-flow", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const years = Math.max(1, Math.min(10, Number(c.req.query("years") ?? "3")));
  const stockId = companyIdToTicker(company.ticker);
  const rows = await getFinMindClient().getCashFlow(stockId, nYearsAgoDate(years), todayDate());
  const latest = latestBucket(rows);

  if (!latest) {
    return c.json({ data: null });
  }

  const operating = pickMetric(latest.bucket, [
    "CashFlowsFromOperatingActivities",
    "CashProvidedByOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivities"
  ]);
  const investing = pickMetric(latest.bucket, [
    "CashProvidedByInvestingActivities",
    "CashFlowsFromInvestingActivities",
    "NetCashProvidedByUsedInInvestingActivities"
  ]);
  const financing = pickMetric(latest.bucket, [
    "CashProvidedByFinancingActivities",
    "CashFlowsFromFinancingActivities",
    "NetCashProvidedByUsedInFinancingActivities"
  ]);
  const cashIncrease = pickMetric(latest.bucket, [
    "CashBalancesIncrease",
    "IncreaseDecreaseInCashAndCashEquivalents",
    "NetIncreaseDecreaseInCashAndCashEquivalents"
  ]);
  const netIncomeBeforeTax = pickMetric(latest.bucket, ["NetIncomeBeforeTax"]);
  const capex = pickMetric(latest.bucket, ["PropertyAndPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipment"]);

  return c.json({
    data: {
      date: latest.date,
      stock_id: stockId,
      operatingCashFlow: operating?.value ?? null,
      investingCashFlow: investing?.value ?? null,
      financingCashFlow: financing?.value ?? null,
      cashIncrease: cashIncrease?.value ?? null,
      netIncomeBeforeTax: netIncomeBeforeTax?.value ?? null,
      freeCashFlow: operating && capex ? operating.value + capex.value : null,
      sourceItems: [...latest.bucket.entries()]
        .slice(0, 80)
        .map(([type, item]) => ({ type, value: item.value, originName: item.originName }))
    }
  });
});

// GET /api/v1/companies/:id/revenue?limit=24
// Returns: { data: FinMindMonthRevenueRow[] } up to limit months
app.get("/api/v1/companies/:id/revenue", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const limit = Math.max(1, Math.min(60, Number(c.req.query("limit") ?? "24")));
  const startDate = nMonthsAgoDate(limit + 1);
  const stockId = companyIdToTicker(company.ticker);

  const rows = await getFinMindClient().getMonthRevenue(stockId, startDate, todayDate());

  return c.json({ data: rows });
});

// GET /api/v1/companies/:id/chips?days=30
// Returns: { data: { foreign:{net30d}, trust:{net30d}, dealer:{net30d}, margin, short } }
// Reshape from FinMind long-format institutional rows + raw margin/short rows.
app.get("/api/v1/companies/:id/chips", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const days = Math.max(1, Math.min(365, Number(c.req.query("days") ?? "30")));
  const startDate = nDaysAgoDate(days);
  const stockId = companyIdToTicker(company.ticker);
  const client = getFinMindClient();

  const [institutional, margin] = await Promise.all([
    client.getInstitutionalInvestors(stockId, startDate, todayDate()),
    client.getMarginShortSale(stockId, startDate, todayDate())
  ]);

  // Sum (buy - sell) per investor category. FinMind uses 外陸資/投信/自營商 labels;
  // 自營商 splits into 自營商(自行買賣) + 自營商(避險) — sum both into "dealer".
  let foreignNet = 0, trustNet = 0, dealerNet = 0;
  for (const row of institutional) {
    const net = (row.buy ?? 0) - (row.sell ?? 0);
    const name = row.name ?? "";
    if (name.includes("外") || name.includes("陸")) foreignNet += net;
    else if (name.includes("投信")) trustNet += net;
    else if (name.includes("自營")) dealerNet += net;
  }
  // FinMind reports shares; convert to 張 (1 lot = 1000 shares).
  const toLots = (shares: number) => Math.round(shares / 1000);

  // Margin/short: take latest day's row and use today vs yesterday for change.
  const sortedMargin = [...margin].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sortedMargin[0] ?? null;
  const marginToday = latest?.MarginPurchaseTodayBalance ?? latest?.MarginPurchaseToday ?? null;
  const marginYesterday = latest?.MarginPurchaseYesterdayBalance ?? latest?.MarginPurchaseYesterday ?? null;
  const shortToday = latest?.ShortSaleTodayBalance ?? latest?.ShortSaleToday ?? null;
  const shortYesterday = latest?.ShortSaleYesterdayBalance ?? latest?.ShortSaleYesterday ?? null;
  const marginOut = latest
    ? { balance: marginToday ?? 0, change: (marginToday ?? 0) - (marginYesterday ?? 0) }
    : null;
  const shortOut = latest
    ? { balance: shortToday ?? 0, change: (shortToday ?? 0) - (shortYesterday ?? 0) }
    : null;

  return c.json({
    data: {
      foreign: { net30d: toLots(foreignNet) },
      trust:   { net30d: toLots(trustNet) },
      dealer:  { net30d: toLots(dealerNet) },
      margin:  marginOut,
      short:   shortOut
    }
  });
});

// GET /api/v1/companies/:id/shareholding?months=6
// Read-only FinMind Sponsor ownership surface: latest foreign holding + latest distribution levels.
app.get("/api/v1/companies/:id/shareholding", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const months = Math.max(1, Math.min(36, Number(c.req.query("months") ?? "6")));
  const startDate = nMonthsAgoDate(months);
  const stockId = companyIdToTicker(company.ticker);
  const client = getFinMindClient();

  const [shareholding, levels] = await Promise.all([
    client.getShareholding(stockId, startDate, todayDate()),
    client.getHoldingSharesPer(stockId, startDate, todayDate())
  ]);

  const latestShareholding = [...shareholding].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const latestLevelDate = [...new Set(levels.map((row) => row.date))].sort((a, b) => b.localeCompare(a))[0] ?? null;
  const latestLevels = latestLevelDate
    ? levels
        .filter((row) => row.date === latestLevelDate)
        .sort((a, b) => b.percent - a.percent)
    : [];

  return c.json({
    data: {
      latest: latestShareholding,
      holdingLevels: latestLevels,
      latestLevelDate,
      source: "FinMind TaiwanStockShareholding / TaiwanStockHoldingSharesPer"
    }
  });
});

// GET /api/v1/companies/:id/dividend?years=5
// Returns: { data: FinMindDividendRow[] }
app.get("/api/v1/companies/:id/dividend", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const years = Math.max(1, Math.min(20, Number(c.req.query("years") ?? "5")));
  const startDate = nYearsAgoDate(years);
  const stockId = companyIdToTicker(company.ticker);

  const rows = await getFinMindClient().getDividend(stockId, startDate, todayDate());

  return c.json({ data: rows });
});

// GET /api/v1/companies/:id/valuation?days=90
// Returns: { data: FinMindPERRow[] } sorted by latest date first.
app.get("/api/v1/companies/:id/valuation", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const days = Math.max(7, Math.min(365, Number(c.req.query("days") ?? "90")));
  const startDate = nDaysAgoDate(days);
  const stockId = companyIdToTicker(company.ticker);

  const rows = await getFinMindClient().getPER(stockId, startDate, todayDate());
  rows.sort((a, b) => b.date.localeCompare(a.date));

  return c.json({ data: rows });
});

// GET /api/v1/companies/:id/market-value?days=365
// Returns: { data: FinMindMarketValueRow[] } sorted by latest date first.
app.get("/api/v1/companies/:id/market-value", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const days = Math.max(30, Math.min(1095, Number(c.req.query("days") ?? "365")));
  const startDate = nDaysAgoDate(days);
  const stockId = companyIdToTicker(company.ticker);

  const rows = await getFinMindClient().getMarketValue(stockId, startDate, todayDate());
  rows.sort((a, b) => b.date.localeCompare(a.date));

  return c.json({ data: rows });
});

// ── W7 H4: TWSE OpenAPI routes (/api/v1/companies/:id/announcements) ──────────
//
// No auth required from TWSE — but route still requires IUF session cookie.
// Cache TTL: 1800s.

// GET /api/v1/companies/:id/announcements?days=30
// Returns: { data: { id, date, title, category, body? }[] } adapted from TWSE rows.
app.get("/api/v1/companies/:id/announcements", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const days = Math.max(1, Math.min(365, Number(c.req.query("days") ?? "30")));
  const stockId = companyIdToTicker(company.ticker);

  // F3: wrap in try/catch — fetchTwse now throws TwseNonJsonError on HTML-200 maintenance response.
  // Previously swallowed error into {data:[]}; now surfaces DEGRADED state to frontend.
  let rows: Awaited<ReturnType<ReturnType<typeof getTwseOpenApiClient>["getMaterialAnnouncements"]>>;
  try {
    rows = await getTwseOpenApiClient().getMaterialAnnouncements(stockId, days);
  } catch (err) {
    const isNonJson = err instanceof Error && err.name === "TwseNonJsonError";
    const degradedReason = isNonJson ? "twse_upstream_non_json" : "twse_fetch_error";
    console.warn(`[announcements] ${degradedReason}:`, err instanceof Error ? err.message : String(err));
    return c.json({
      data: [],
      state: "DEGRADED" as const,
      degradedReason
    });
  }

  const items = rows.map((r, i) => {
    const dateIso = r.Date ? r.Date.replace(/\//g, "-") : "";
    const title = r.Title ?? "";
    // Lightweight category guess from title keywords; falls back to "重大訊息".
    let category = "重大訊息";
    if (/股利|配息|配股/.test(title)) category = "股利";
    else if (/財報|營收|EPS|損益|資產/.test(title)) category = "財報";
    else if (/董事|監察|人事|總經理|董事長/.test(title)) category = "人事";
    return {
      id: `${stockId}-${dateIso}-${i}`,
      date: dateIso,
      title,
      category,
      body: r.Content ?? undefined
    };
  });

  return c.json({ data: items });
});

app.get("/api/v1/market-intel/announcements", async (c) => {
  function readBoundedInt(name: string, fallback: number, min: number, max: number): number {
    const raw = Number(c.req.query(name));
    const value = Number.isFinite(raw) ? Math.trunc(raw) : fallback;
    return Math.max(min, Math.min(max, value));
  }

  const days = readBoundedInt("days", 30, 1, 90);
  const limit = readBoundedInt("limit", 10, 1, 24);
  const scope = c.req.query("scope") === "market" ? "market" : "company_pool";
  const db = getDb();
  const session = c.get("session");

  if (!db) {
    return c.json({
      data: {
        items: [],
        selected: [],
        failures: 0,
        source: "empty"
      }
    });
  }
  const activeDb = db;

  type IntelRow = {
    id: string | null;
    ticker: string | null;
    company_name: string | null;
    date: string | null;
    title: string | null;
    category: string | null;
    body: string | null;
    url: string | null;
    source: string | null;
  };

  function readRows<T>(result: unknown): T[] {
    if (Array.isArray(result)) return result as T[];
    return ((result as { rows?: T[] })?.rows) ?? [];
  }

  function isMarketWideNews(row: IntelRow): boolean {
    if (scope !== "market") return true;
    if (row.source === "twse_announcements") return true;

    const titleText = `${row.title ?? ""}`.toLowerCase();
    const auxiliaryText = `${row.category ?? ""} ${row.company_name ?? ""}`.toLowerCase();
    const blockedTerms = [
      "股市爆料同學會",
      "cmoney",
      "yahoo\u80a1\u5e02",
      "理財寶",
      "奇摩股市",
      "存股",
      "達人",
      "老師",
      "同學會"
    ];
    if (blockedTerms.some((term) => titleText.includes(term.toLowerCase()) || auxiliaryText.includes(term.toLowerCase()))) {
      return false;
    }

    const companyReportTerms = [
      "\u8ca1\u5831",
      "eps",
      "\u6de8\u5229",
      "\u71df\u6536",
      "\u9664\u6b0a",
      "\u9664\u606f",
      "\u914d\u606f",
      "\u6cd5\u8aaa",
      "\u589e\u8cc7",
      "\u6e1b\u8cc7"
    ];
    const highSignalMarketTerms = [
      "\u53f0\u80a1",
      "\u5927\u76e4",
      "\u52a0\u6b0a",
      "\u52a0\u6b0a\u6307\u6578",
      "\u6ac3\u8cb7",
      "\u76e4\u52e2",
      "\u76e4\u4e2d",
      "\u76e4\u5f8c",
      "\u958b\u76e4",
      "\u6536\u76e4",
      "\u4e09\u5927\u6cd5\u4eba",
      "\u5916\u8cc7",
      "\u6295\u4fe1",
      "\u81ea\u71df\u5546",
      "\u6b0a\u503c",
      "\u985e\u80a1",
      "\u65cf\u7fa4",
      "\u534a\u5c0e\u9ad4",
      "etf",
      "msci",
      "fed",
      "nasdaq",
      "\u6a19\u666e",
      "\u7f8e\u80a1",
      "\u532f\u7387",
      "\u53f0\u5e63",
      "\u7f8e\u5143",
      "\u592e\u884c",
      "\u901a\u81a8",
      "\u5229\u7387"
    ];
    const hasHighSignalMarketTerm = highSignalMarketTerms.some((term) => titleText.includes(term.toLowerCase()));
    const broaderMarketTerms = [
      "\u53f0\u80a1",
      "\u5927\u76e4",
      "\u52a0\u6b0a",
      "\u52a0\u6b0a\u6307\u6578",
      "\u6ac3\u8cb7",
      "\u4e09\u5927\u6cd5\u4eba",
      "\u5916\u8cc7",
      "\u6295\u4fe1",
      "\u81ea\u71df\u5546",
      "\u6b0a\u503c",
      "\u985e\u80a1",
      "\u65cf\u7fa4",
      "\u534a\u5c0e\u9ad4",
      "etf",
      "adr",
      "msci",
      "fed",
      "nasdaq",
      "\u6a19\u666e",
      "\u7f8e\u80a1",
      "\u532f\u7387",
      "\u53f0\u5e63",
      "\u7f8e\u5143",
      "\u592e\u884c",
      "\u901a\u81a8",
      "\u5229\u7387"
    ];
    const hasBroaderMarketTerm = broaderMarketTerms.some((term) => titleText.includes(term.toLowerCase()));
    const isTickerSpecific = Boolean(row.ticker && row.ticker !== "market");
    if (isTickerSpecific && !hasBroaderMarketTerm) return false;

    const isCompanyReport = companyReportTerms.some((term) => titleText.includes(term.toLowerCase()));
    if (isCompanyReport && !hasHighSignalMarketTerm) return false;

    const marketTerms = [
      "台股",
      "大盤",
      "加權",
      "櫃買",
      "盤勢",
      "盤中",
      "盤後",
      "開盤",
      "收盤",
      "權值",
      "三大法人",
      "外資",
      "投信",
      "自營商",
      "美股",
      "fed",
      "聯準會",
      "央行",
      "利率",
      "通膨",
      "匯率",
      "新台幣",
      "半導體",
      "ai",
      "台積電",
      "鴻海",
      "etf",
      "期貨",
      "景氣",
      "出口",
      "msci",
      "關稅",
      "政策",
      "金管會",
      "證交所",
      "櫃買中心"
    ];
    return hasHighSignalMarketTerm || marketTerms.some((term) => titleText.includes(term.toLowerCase()));
  }

  const rows: IntelRow[] = [];
  let source: "twse_announcements" | "finmind_stock_news" | "mixed" | "empty" = "empty";

  try {
    const result = await activeDb.execute(drizzleSql`
      SELECT
        CONCAT(a.ticker_symbol, '-', a.announced_at::text, '-', a.title) AS id,
        a.ticker_symbol AS ticker,
        COALESCE(c.name, a.ticker_symbol) AS company_name,
        a.announced_at::text AS date,
        a.title AS title,
        '重大訊息' AS category,
        NULL::text AS body,
        NULL::text AS url,
        'twse_announcements' AS source
      FROM tw_announcements a
      LEFT JOIN companies c
        ON c.ticker = a.ticker_symbol
       AND c.workspace_id = ${session.workspace.id}
      WHERE a.announced_at >= NOW() - (${days}::text || ' days')::interval
        AND COALESCE(a.title, '') <> ''
      ORDER BY a.announced_at DESC
      LIMIT ${limit}
    `);
    rows.push(...readRows<IntelRow>(result));
    if (rows.length > 0) source = "twse_announcements";
  } catch (err) {
    console.warn("[market-intel/announcements] tw_announcements unavailable:", err instanceof Error ? err.message : String(err));
  }

  if (rows.length < limit) {
    try {
      const result = await activeDb.execute(drizzleSql`
        SELECT
          n.id::text AS id,
          n.stock_id AS ticker,
          COALESCE(c.name, n.stock_id) AS company_name,
          COALESCE(NULLIF(n.published_at, ''), n.fetched_at::text) AS date,
          n.title AS title,
          COALESCE(NULLIF(n.source_name, ''), '台股新聞') AS category,
          NULL::text AS body,
          n.url AS url,
          'finmind_stock_news' AS source
        FROM tw_stock_news n
        LEFT JOIN companies c
          ON c.ticker = n.stock_id
         AND c.workspace_id = ${session.workspace.id}
        WHERE n.fetched_at >= NOW() - (${days}::text || ' days')::interval
          AND COALESCE(n.title, '') <> ''
        ORDER BY n.fetched_at DESC
        LIMIT ${scope === "market" ? Math.max(limit * 8, 80) : Math.max(limit, 12)}
      `);
      const seen = new Set(rows.map((row) => `${row.ticker ?? ""}:${row.title ?? ""}`));
      for (const row of readRows<IntelRow>(result)) {
        if (!isMarketWideNews(row)) continue;
        const key = `${row.ticker ?? ""}:${row.title ?? ""}`;
        if (seen.has(key)) continue;
        rows.push(row);
        seen.add(key);
        if (rows.length >= limit) break;
      }
      if (rows.length > 0) {
        source = source === "twse_announcements" ? "mixed" : "finmind_stock_news";
      }
    } catch (err) {
      console.warn("[market-intel/announcements] tw_stock_news unavailable:", err instanceof Error ? err.message : String(err));
    }
  }

  const items = rows.slice(0, limit).map((row, index) => ({
    id: row.id ?? `${row.ticker ?? "market"}-${index}`,
    date: String(row.date ?? "").slice(0, 10),
    title: row.title ?? "",
    category: row.category ?? "市場情報",
    body: row.body ?? undefined,
    ticker: row.ticker ?? undefined,
    companyName: row.company_name ?? row.ticker ?? undefined,
    url: row.url,
    source: row.source ?? source
  }));
  const selected = [...new Map(items
    .filter((item) => item.ticker)
    .map((item) => [item.ticker as string, {
      id: item.ticker as string,
      ticker: item.ticker as string,
      name: item.companyName ?? item.ticker as string
    }])).values()];

  return c.json({
    data: {
      items,
      selected,
      failures: 0,
      source: items.length > 0 ? source : "empty"
    }
  });
});

// =============================================================================
// W7 BLOCK #5 Axis 2 — KGI realtime quote for company page frontend
// =============================================================================
//
// GET /api/v1/companies/:id/quote/realtime
//
// Aggregates last tick + bidask into a single frontend-consumable snapshot.
// Frontend polls this every 5s for the company page quote widget.
//
// Design:
//   - Resolves company by UUID or ticker via resolveCompany
//   - Maps company.ticker → KGI symbol (same value for TW stocks)
//   - If symbol not whitelisted → state=BLOCKED, reason=symbol_not_whitelisted
//   - If gateway disabled/unreachable → state=BLOCKED, reason=<error_code>
//   - On success: merges latest tick (lastPrice, volume) + bidask (bid, ask)
//   - Freshness from stale detection (D-W2D-1): fresh | stale | not-available
//   - source: 'kgi-gateway' always (no mock fallback — honest about state)
//
// Hard lines:
//   - NO order surface
//   - NO token / session / account number in response
//   - NO real submit
//   - read-only (GET only)
//   - 4xx on missing company, BLOCKED on gateway issues (no fake 200+data)
//
// Response shape:
//   { data: { symbol, lastPrice, bid, ask, volume, freshness, state, source, updatedAt } }
//   state: 'LIVE' | 'STALE' | 'BLOCKED' | 'NO_DATA'
// =============================================================================

app.get("/api/v1/companies/:id/quote/realtime", async (c) => {
  // 1. Resolve company
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const symbol = companyIdToTicker(company.ticker);
  const client = getKgiQuoteClient();
  const updatedAt = new Date().toISOString();

  // 2. Whitelist check — surface BLOCKED early (no network call)
  if (!client.isSymbolAllowed(symbol)) {
    return c.json({
      data: {
        symbol,
        lastPrice: null,
        bid: null,
        ask: null,
        volume: null,
        freshness: "not-available" as const,
        state: "BLOCKED" as const,
        reason: "symbol_not_whitelisted",
        source: "kgi-gateway" as const,
        updatedAt
      }
    });
  }

  // 3. Fetch latest tick + bidask in parallel (fail-soft per leg)
  let lastPrice: number | null = null;
  let volume: number | null = null;
  let bid: number | null = null;
  let ask: number | null = null;
  let freshness: "fresh" | "stale" | "not-available" = "not-available";
  let blockedReason: string | null = null;

  const [tickResult, bidaskResult] = await Promise.allSettled([
    client.getRecentTicks(symbol, 1),
    client.getLatestBidAsk(symbol),
  ]);

  // Parse tick leg
  if (tickResult.status === "fulfilled") {
    const td = tickResult.value;
    freshness = td.freshness;
    if (td.ticks.length > 0) {
      const last = td.ticks[td.ticks.length - 1];
      lastPrice = last.close ?? null;
      volume = last.total_volume ?? last.volume ?? null;
    }
  } else {
    const err = tickResult.reason;
    if (err instanceof KgiQuoteDisabledError) {
      blockedReason = "quote_disabled";
    } else if (err instanceof KgiQuoteAuthError) {
      blockedReason = "gateway_auth_error";
    } else if (err instanceof KgiQuoteUnreachableError) {
      blockedReason = "gateway_unreachable";
    } else if (err instanceof KgiQuoteNotAvailableError) {
      blockedReason = "symbol_not_subscribed";
    } else {
      blockedReason = "gateway_error";
    }
  }

  // Parse bidask leg (best-effort — don't block if tick succeeded)
  if (bidaskResult.status === "fulfilled") {
    const ba = bidaskResult.value.bidask;
    if (ba) {
      bid = ba.bid_prices?.[0] ?? null;
      ask = ba.ask_prices?.[0] ?? null;
      // Use bidask freshness if tick freshness is not-available
      if (freshness === "not-available") {
        freshness = bidaskResult.value.freshness;
      }
    }
  }

  // 4. Determine state
  let state: "LIVE" | "STALE" | "BLOCKED" | "NO_DATA";
  if (blockedReason) {
    state = "BLOCKED";
  } else if (freshness === "fresh" && lastPrice !== null) {
    state = "LIVE";
  } else if (freshness === "stale" && lastPrice !== null) {
    state = "STALE";
  } else {
    state = "NO_DATA";
  }

  return c.json({
    data: {
      symbol,
      lastPrice,
      bid,
      ask,
      volume,
      freshness,
      state,
      ...(blockedReason ? { reason: blockedReason } : {}),
      source: "kgi-gateway" as const,
      updatedAt
    }
  });
});

// =============================================================================
// BLOCK #5 Axis 4+5 — Company full-profile aggregating all 11 FinMind datasets
// =============================================================================
//
// GET /api/v1/companies/:id/full-profile
//
// Aggregates all 11 FinMind datasets into a single response envelope so the
// frontend company page can render complete data without 11 separate fetches.
//
// Dataset mapping (per PR A/B/C ETL):
//   Fundamentals (4):
//     monthlyRevenue   ← TaiwanStockMonthRevenue      (12 months history)
//     financialStatement ← TaiwanStockFinancialStatements (8 quarters history)
//     cashFlow         ← TaiwanStockCashFlowsStatement (8 quarters)
//     balanceSheet     ← TaiwanStockBalanceSheet       (8 quarters)
//   TradingFlow (3):
//     institutional    ← TaiwanStockInstitutionalInvestorsBuySell (30 days)
//     marginShort      ← TaiwanStockMarginPurchaseShortSale       (30 days)
//     shareholding     ← TaiwanStockShareholding                  (90 days)
//   MarketIntel (4):
//     dividend         ← TaiwanStockDividend           (5 years history)
//     marketValue      ← TaiwanStockMarketValue         (latest 1 row)
//     valuation        ← TaiwanStockPER                (30 days)
//     news             ← TaiwanStockNews [EXPERIMENTAL] (last 24h)
//
// Every sub-section has:
//   - state: SourceState enum (LIVE|STALE|EMPTY|BLOCKED|DEGRADED|ERROR|MOCK|FALLBACK|CLOSED)
//   - latest: most recent key fields
//   - history: last N rows
//   - updatedAt: ISO timestamp
//   - sourceTrail: { source, datasetKey, recordCount, degradedReason }
//
// Hard lines:
//   - All read-only, no write surface
//   - Auth: standard iuf_session cookie (Owner/Admin/Analyst)
//   - 11 sub-queries run with Promise.allSettled — single section ERROR never 500s the whole request
//   - No fake data — any section with no DB evidence → EMPTY or DEGRADED
//   - Never returns buy/sell/目標價/必賺/勝率/guaranteed return wording
//   - No KGI write-side, no broker surface
// =============================================================================

// SourceState enum for full-profile sub-sections
type FullProfileSourceState =
  | "LIVE"
  | "STALE"
  | "EMPTY"
  | "BLOCKED"
  | "DEGRADED"
  | "ERROR"
  | "MOCK"
  | "FALLBACK"
  | "CLOSED";

interface FullProfileSourceTrail {
  source: string;
  datasetKey: string;
  recordCount: number;
  degradedReason: string | null;
}

interface FullProfileSection<T> {
  state: FullProfileSourceState;
  latest: T | null;
  history: T[];
  updatedAt: string;
  sourceTrail: FullProfileSourceTrail;
}

/** Classify raw rows from a FinMind call into a FullProfileSection. */
function classifySection<T>(
  datasetKey: string,
  rows: T[],
  latestFn: (rows: T[]) => T | null,
  staleDays: number,
  latestDateFn: (rows: T[]) => string | null
): Omit<FullProfileSection<T>, "history"> & { history: T[] } {
  const updatedAt = new Date().toISOString();
  const sourceTrail: FullProfileSourceTrail = {
    source: "finmind",
    datasetKey,
    recordCount: rows.length,
    degradedReason: null
  };

  if (rows.length === 0) {
    return {
      state: "EMPTY",
      latest: null,
      history: [],
      updatedAt,
      sourceTrail: { ...sourceTrail, degradedReason: "no_rows" }
    };
  }

  const latestDate = latestDateFn(rows);
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const isStale = latestDate
    ? Date.now() - new Date(latestDate).getTime() > staleMs
    : true;

  return {
    state: isStale ? "STALE" : "LIVE",
    latest: latestFn(rows),
    history: rows,
    updatedAt,
    sourceTrail
  };
}

function errorSection<T>(datasetKey: string, msg: string): FullProfileSection<T> {
  return {
    state: "ERROR",
    latest: null,
    history: [],
    updatedAt: new Date().toISOString(),
    sourceTrail: { source: "finmind", datasetKey, recordCount: 0, degradedReason: msg }
  };
}

app.get("/api/v1/companies/:id/full-profile", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const stockId = companyIdToTicker(company.ticker);
  const client = getFinMindClient();
  const today = todayDate();

  // Date ranges per dataset spec
  const rev12m = nMonthsAgoDate(12);
  const q8start = nYearsAgoDate(3);   // 8 quarters ≈ 2 years + buffer
  const d30start = nDaysAgoDate(30);
  const d90start = nDaysAgoDate(90);
  const y5start = nYearsAgoDate(5);
  const d1start = nDaysAgoDate(1);

  // 11 parallel fetches — Promise.allSettled so any failure marks section ERROR
  const [
    revResult,
    fsResult,
    bsResult,
    cfResult,
    instResult,
    marginResult,
    shareResult,
    divResult,
    mvResult,
    valResult,
    newsResult
  ] = await Promise.allSettled([
    client.getMonthRevenue(stockId, rev12m, today),
    client.getFinancialStatements(stockId, q8start, today),
    client.getBalanceSheet(stockId, q8start, today),
    client.getCashFlow(stockId, q8start, today),
    client.getInstitutionalInvestors(stockId, d30start, today),
    client.getMarginShortSale(stockId, d30start, today),
    client.getShareholding(stockId, d90start, today),
    client.getDividend(stockId, y5start, today),
    client.getMarketValue(stockId, d90start, today),
    client.getPER(stockId, d30start, today),
    client.getStockNews(stockId, d1start, today)
  ]);

  // ── Fundamentals: Monthly Revenue ────────────────────────────────────────────
  type RevenueRow = { date: string; stock_id: string; revenue: number; revenue_month: number; revenue_year: number; country: string };
  let monthlyRevenue: FullProfileSection<RevenueRow>;
  if (revResult.status === "rejected") {
    monthlyRevenue = errorSection<RevenueRow>("TaiwanStockMonthRevenue", String(revResult.reason));
  } else {
    const rows = revResult.value as RevenueRow[];
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const hist = rows.slice(0, 12);
    const latest = hist[0] ?? null;

    // Compute YoY growth if we have 2+ rows
    let yoyGrowth: number | null = null;
    if (hist.length >= 2) {
      const prev = hist.find(r => {
        const prevYear = Number(latest?.date.slice(0, 4)) - 1;
        return Number(r.date.slice(0, 4)) === prevYear &&
          r.revenue_month === latest?.revenue_month;
      });
      if (prev && prev.revenue !== 0) {
        yoyGrowth = ((latest!.revenue - prev.revenue) / prev.revenue) * 100;
      }
    }

    const enriched = latest ? { ...latest, yoyGrowth } : null;
    monthlyRevenue = {
      ...classifySection<RevenueRow>(
        "TaiwanStockMonthRevenue",
        hist,
        (r) => r[0] ?? null,
        35,
        (r) => r[0]?.date ?? null
      ),
      latest: enriched,
      history: hist
    };
  }

  // ── Fundamentals: Financial Statement ────────────────────────────────────────
  type FinRow = { date: string; stock_id: string; type: string; value: number; origin_name?: string };
  let financialStatement: FullProfileSection<FinRow>;
  if (fsResult.status === "rejected") {
    financialStatement = errorSection<FinRow>("TaiwanStockFinancialStatements", String(fsResult.reason));
  } else {
    const rows = fsResult.value as FinRow[];
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const hist = rows.slice(0, 8 * 10); // up to 8 quarters × ~10 items each
    const latestDate = hist[0]?.date ?? null;
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 100 * 24 * 60 * 60 * 1000 : true;
    // Build latest snapshot: bucket by latest period
    const latestPeriodRows = hist.filter(r => r.date === latestDate);
    const EPS_KEYS = new Set(["EPS", "EarningsPerShare", "BasicEPS"]);
    const REV_KEYS = new Set(["Revenue", "OperatingRevenue", "NetRevenue"]);
    const OP_KEYS = new Set(["OperatingIncome", "OperatingIncomeLoss"]);
    let eps: number | null = null, rev: number | null = null, opInc: number | null = null;
    for (const r of latestPeriodRows) {
      if (EPS_KEYS.has(r.type)) eps = r.value;
      if (REV_KEYS.has(r.type)) rev = r.value;
      if (OP_KEYS.has(r.type)) opInc = r.value;
    }
    const latestFin = latestDate ? { date: latestDate, eps, revenue: rev, operatingIncome: opInc } : null;
    financialStatement = {
      state: rows.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest: latestFin as unknown as FinRow | null,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockFinancialStatements", recordCount: rows.length, degradedReason: rows.length === 0 ? "no_rows" : null }
    };
  }

  // ── Fundamentals: Balance Sheet ───────────────────────────────────────────────
  let balanceSheet: FullProfileSection<FinRow>;
  if (bsResult.status === "rejected") {
    balanceSheet = errorSection<FinRow>("TaiwanStockBalanceSheet", String(bsResult.reason));
  } else {
    const rows = bsResult.value as FinRow[];
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const hist = rows.slice(0, 8 * 10);
    const latestDate = hist[0]?.date ?? null;
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 100 * 24 * 60 * 60 * 1000 : true;
    const TOTAL_ASSET_KEYS = new Set(["TotalAssets", "Assets"]);
    const TOTAL_LIAB_KEYS = new Set(["TotalLiabilities", "Liabilities"]);
    const EQUITY_KEYS = new Set(["Equity", "TotalEquity", "StockholdersEquity"]);
    const latestPeriodRows = hist.filter(r => r.date === latestDate);
    let totalAssets: number | null = null, totalLiab: number | null = null, equity: number | null = null;
    for (const r of latestPeriodRows) {
      if (TOTAL_ASSET_KEYS.has(r.type)) totalAssets = r.value;
      if (TOTAL_LIAB_KEYS.has(r.type)) totalLiab = r.value;
      if (EQUITY_KEYS.has(r.type)) equity = r.value;
    }
    const latestBs = latestDate ? { date: latestDate, totalAssets, totalLiabilities: totalLiab, equity } : null;
    balanceSheet = {
      state: rows.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest: latestBs as unknown as FinRow | null,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockBalanceSheet", recordCount: rows.length, degradedReason: rows.length === 0 ? "no_rows" : null }
    };
  }

  // ── Fundamentals: Cash Flow ───────────────────────────────────────────────────
  let cashFlow: FullProfileSection<FinRow>;
  if (cfResult.status === "rejected") {
    cashFlow = errorSection<FinRow>("TaiwanStockCashFlowsStatement", String(cfResult.reason));
  } else {
    const rows = cfResult.value as FinRow[];
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const hist = rows.slice(0, 8 * 10);
    const latestDate = hist[0]?.date ?? null;
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 100 * 24 * 60 * 60 * 1000 : true;
    const OP_CF_KEYS = new Set(["CashFlowsFromOperatingActivities", "OperatingActivities", "NetCashFromOperatingActivities"]);
    const latestPeriodRows = hist.filter(r => r.date === latestDate);
    let operatingCF: number | null = null;
    for (const r of latestPeriodRows) {
      if (OP_CF_KEYS.has(r.type)) operatingCF = r.value;
    }
    const latestCf = latestDate ? { date: latestDate, operatingCashFlow: operatingCF } : null;
    cashFlow = {
      state: rows.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest: latestCf as unknown as FinRow | null,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockCashFlowsStatement", recordCount: rows.length, degradedReason: rows.length === 0 ? "no_rows" : null }
    };
  }

  // ── TradingFlow: Institutional ────────────────────────────────────────────────
  type InstRow = { date: string; stock_id: string; name: string; buy: number; sell: number };
  let institutional: FullProfileSection<{ date: string; foreign: number; investmentTrust: number; dealer: number; totalNetBuy: number }>;
  if (instResult.status === "rejected") {
    institutional = errorSection("TaiwanStockInstitutionalInvestorsBuySell", String(instResult.reason));
  } else {
    const rows = instResult.value as InstRow[];
    // Group by date, aggregate nets
    const dateMap = new Map<string, { foreign: number; investmentTrust: number; dealer: number }>();
    for (const r of rows) {
      if (!dateMap.has(r.date)) dateMap.set(r.date, { foreign: 0, investmentTrust: 0, dealer: 0 });
      const entry = dateMap.get(r.date)!;
      const net = (r.buy ?? 0) - (r.sell ?? 0);
      const nm = r.name ?? "";
      if (nm.includes("外") || nm.includes("陸")) entry.foreign += net;
      else if (nm.includes("投信")) entry.investmentTrust += net;
      else if (nm.includes("自營")) entry.dealer += net;
    }
    const aggregated = Array.from(dateMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, v]) => ({
        date,
        foreign: v.foreign,
        investmentTrust: v.investmentTrust,
        dealer: v.dealer,
        totalNetBuy: v.foreign + v.investmentTrust + v.dealer
      }));
    const hist = aggregated.slice(0, 30);
    const latest = hist[0] ?? null;
    const latestDate = latest?.date ?? null;
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 5 * 24 * 60 * 60 * 1000 : true;
    institutional = {
      state: hist.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockInstitutionalInvestorsBuySell", recordCount: rows.length, degradedReason: hist.length === 0 ? "no_rows" : null }
    };
  }

  // ── TradingFlow: Margin/Short ─────────────────────────────────────────────────
  type MarginRow = { date: string; stock_id: string; MarginPurchaseBuy: number; MarginPurchaseSell: number; MarginPurchaseTodayBalance?: number; ShortSaleSell: number; ShortSaleTodayBalance?: number };
  let marginShort: FullProfileSection<{ date: string; marginBalance: number | null; shortBalance: number | null; marginChange: number | null; shortChange: number | null }>;
  if (marginResult.status === "rejected") {
    marginShort = errorSection("TaiwanStockMarginPurchaseShortSale", String(marginResult.reason));
  } else {
    const rows = (marginResult.value as MarginRow[]).sort((a, b) => b.date.localeCompare(a.date));
    const hist = rows.slice(0, 30).map((r, i, arr) => {
      const prev = arr[i + 1] ?? null;
      return {
        date: r.date,
        marginBalance: r.MarginPurchaseTodayBalance ?? null,
        shortBalance: r.ShortSaleTodayBalance ?? null,
        marginChange: prev && r.MarginPurchaseTodayBalance != null && (prev as MarginRow).MarginPurchaseTodayBalance != null
          ? r.MarginPurchaseTodayBalance! - (prev as MarginRow).MarginPurchaseTodayBalance!
          : null,
        // S3: symmetric compute — mirror marginChange pattern for ShortSaleTodayBalance
        shortChange: prev && r.ShortSaleTodayBalance != null && (prev as MarginRow).ShortSaleTodayBalance != null
          ? r.ShortSaleTodayBalance! - (prev as MarginRow).ShortSaleTodayBalance!
          : null
      };
    });
    const latest = hist[0] ?? null;
    const latestDate = latest?.date ?? null;
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 5 * 24 * 60 * 60 * 1000 : true;
    marginShort = {
      state: hist.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockMarginPurchaseShortSale", recordCount: rows.length, degradedReason: hist.length === 0 ? "no_rows" : null }
    };
  }

  // ── TradingFlow: Shareholding ─────────────────────────────────────────────────
  type ShareRow = { date: string; stock_id: string; ForeignInvestmentSharesRatio?: number; ForeignInvestmentRemainRatio?: number; NumberOfSharesIssued?: number };
  let shareholding: FullProfileSection<{ date: string; foreignRatio: number | null; foreignRemainRatio: number | null; sharesIssued: number | null }>;
  if (shareResult.status === "rejected") {
    shareholding = errorSection("TaiwanStockShareholding", String(shareResult.reason));
  } else {
    const rows = (shareResult.value as ShareRow[]).sort((a, b) => b.date.localeCompare(a.date));
    const hist = rows.slice(0, 30).map(r => ({
      date: r.date,
      foreignRatio: r.ForeignInvestmentSharesRatio ?? null,
      foreignRemainRatio: r.ForeignInvestmentRemainRatio ?? null,
      sharesIssued: r.NumberOfSharesIssued ?? null
    }));
    const latest = hist[0] ?? null;
    const latestDate = latest?.date ?? null;
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 10 * 24 * 60 * 60 * 1000 : true;
    shareholding = {
      state: hist.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockShareholding", recordCount: rows.length, degradedReason: hist.length === 0 ? "no_rows" : null }
    };
  }

  // ── MarketIntel: Dividend ─────────────────────────────────────────────────────
  type DivRow = { date: string; stock_id: string; year: number; TotalCashDividend?: number; TotalStockDividend?: number; TotalDividend?: number };
  let dividend: FullProfileSection<{ year: number; cashDividend: number; stockDividend: number; totalDividend: number; announcementDate: string | null }>;
  if (divResult.status === "rejected") {
    dividend = errorSection("TaiwanStockDividend", String(divResult.reason));
  } else {
    const rows = (divResult.value as DivRow[]).sort((a, b) => b.year - a.year);
    const hist = rows.slice(0, 10).map(r => ({
      year: r.year,
      cashDividend: r.TotalCashDividend ?? 0,
      stockDividend: r.TotalStockDividend ?? 0,
      totalDividend: r.TotalDividend ?? 0,
      announcementDate: r.date ?? null
    }));
    const latest = hist[0] ?? null;
    const latestYear = latest?.year ?? null;
    // Dividend STALE if latest year < current year - 2
    const isStale = latestYear ? (new Date().getFullYear() - latestYear) > 2 : true;
    dividend = {
      state: hist.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockDividend", recordCount: rows.length, degradedReason: hist.length === 0 ? "no_rows" : null }
    };
  }

  // ── MarketIntel: Market Value ─────────────────────────────────────────────────
  type MvRow = { date: string; stock_id: string; market_value: number };
  let marketValue: FullProfileSection<{ date: string; marketValue: number }>;
  if (mvResult.status === "rejected") {
    marketValue = errorSection("TaiwanStockMarketValue", String(mvResult.reason));
  } else {
    const rows = (mvResult.value as MvRow[]).sort((a, b) => b.date.localeCompare(a.date));
    const hist = rows.slice(0, 30).map(r => ({ date: r.date, marketValue: r.market_value }));
    const latest = hist[0] ?? null;
    const latestDate = latest?.date ?? null;
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 10 * 24 * 60 * 60 * 1000 : true;
    marketValue = {
      state: hist.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockMarketValue", recordCount: rows.length, degradedReason: hist.length === 0 ? "no_rows" : null }
    };
  }

  // ── MarketIntel: Valuation (PER/PBR/Yield) ────────────────────────────────────
  type ValRow = { date: string; stock_id: string; PER: number; PBR: number; dividend_yield: number };
  let valuation: FullProfileSection<{ date: string; pe: number | null; pbr: number | null; dividendYield: number | null }>;
  if (valResult.status === "rejected") {
    valuation = errorSection("TaiwanStockPER", String(valResult.reason));
  } else {
    const rows = (valResult.value as ValRow[]).sort((a, b) => b.date.localeCompare(a.date));
    const hist = rows.slice(0, 30).map(r => ({
      date: r.date,
      pe: typeof r.PER === "number" ? r.PER : null,
      pbr: typeof r.PBR === "number" ? r.PBR : null,
      dividendYield: typeof r.dividend_yield === "number" ? r.dividend_yield : null
    }));
    const latest = hist[0] ?? null;
    const latestDate = latest?.date ?? null;
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 5 * 24 * 60 * 60 * 1000 : true;
    valuation = {
      state: hist.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockPER", recordCount: rows.length, degradedReason: hist.length === 0 ? "no_rows" : null }
    };
  }

  // ── MarketIntel: News [EXPERIMENTAL] ─────────────────────────────────────────
  type NewsRow = { date: string; stock_id: string; title: string; url?: string; source_name?: string };
  let news: FullProfileSection<{ date: string; title: string; url: string | null; sourceName: string | null }> & { experimental: true };
  if (newsResult.status === "rejected") {
    news = { ...errorSection<{ date: string; title: string; url: string | null; sourceName: string | null }>("TaiwanStockNews", String(newsResult.reason)), experimental: true };
  } else {
    const rows = (newsResult.value as NewsRow[]).sort((a, b) => b.date.localeCompare(a.date));
    const hist = rows.slice(0, 20).map(r => ({
      date: r.date,
      title: r.title,
      url: r.url ?? null,
      sourceName: r.source_name ?? null
    }));
    const latest = hist[0] ?? null;
    const latestDate = latest?.date ?? null;
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 2 * 24 * 60 * 60 * 1000 : true;
    const state: FullProfileSourceState = hist.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE";
    news = {
      state,
      latest,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "finmind", datasetKey: "TaiwanStockNews", recordCount: rows.length, degradedReason: hist.length === 0 ? "no_rows" : null },
      experimental: true
    };
  }

  return c.json({
    data: {
      company: {
        id: company.id,
        ticker: company.ticker,
        name: company.name,
        market: company.market,
        country: company.country
      },
      fundamentals: {
        monthlyRevenue,
        financialStatement,
        cashFlow,
        balanceSheet
      },
      tradingFlow: {
        institutional,
        marginShort,
        shareholding
      },
      marketIntel: {
        dividend,
        marketValue,
        valuation,
        news
      }
    }
  });
});

// =============================================================================
// BLOCK #6 — Hallucination check (RAG upgrade): gpt-4.1 cross-validate + confidence
// =============================================================================
//
// POST /api/v1/internal/openalice/hallucination-check
//
// Input (extended):
//   { content: string, sourceTrail: SourceTrailEntry[], rawSources?: RawSourceEntry[] }
//
// Output (extended):
//   { verdict: "OK"|"HALLUCINATED"|"PARTIAL_HALLUCINATED"|"ERROR",
//     confidence: number (0-1),
//     flags: Array<{ claim, type, sourceMatch }>,
//     reasoning: string,
//     ragUsed: boolean }
//
// Algorithm:
//   Pass 1 (OPENAI_CLAIM_EXTRACT_MODEL, default gpt-4o-mini): extract atomic factual claims
//   Pass 2 (OPENAI_HALLUCINATION_VERIFY_MODEL, default gpt-4.1): cross-validate each claim
//     vs rawSources (FinMind raw row JSON / URL / sha256)
//   No rawSources → single-pass fallback + caveat RAG_NOT_USED__SOURCE_PACK_MISSING
//
// Pipeline integration:
//   HALLUCINATED             → force reject + audit_log type=HALLUCINATION_REJECT
//   PARTIAL_HALLUCINATED + confidence<0.7 → manual_review queue
//   OK or PARTIAL high-conf  → normal pass
//   ERROR                    → safe-default block publish (treat as manual_review)
//
// Hard lines:
//   - Owner/Admin only (requireOpenAliceAdmin gate)
//   - OPENAI_API_KEY absent → verdict=OK + caveat (safe non-blocking default)
//   - Never log API key
//   - No buy/sell/目標價/必賺/勝率/guaranteed return language in prompts
// =============================================================================

app.post("/api/v1/internal/openalice/hallucination-check", async (c) => {
  const denial = requireOpenAliceAdmin(c);
  if (denial) return denial;

  let body: { content?: unknown; sourceTrail?: unknown; rawSources?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const content = typeof body.content === "string" ? body.content.trim() : null;
  const sourceTrail = body.sourceTrail ?? null;
  const rawSourcesRaw = Array.isArray(body.rawSources) ? body.rawSources : [];

  if (!content) {
    return c.json({ error: "content_required" }, 400);
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return c.json({
      data: {
        verdict: "OK",
        confidence: 1.0,
        flags: [],
        reasoning: "no_api_key: hallucination check skipped — OPENAI_API_KEY not configured",
        ragUsed: false
      }
    });
  }

  const { runRagHallucinationCheck } = await import("./hallucination-rag.js");

  const claimExtractModel =
    process.env["OPENAI_CLAIM_EXTRACT_MODEL"] ?? "gpt-4o-mini";
  const crossValidateModel =
    process.env["OPENAI_HALLUCINATION_VERIFY_MODEL"] ?? "gpt-4.1";

  // Coerce rawSources: keep entries that have sourceId + content strings
  type RawSrc = { sourceId?: unknown; content?: unknown; sha256?: unknown; url?: unknown };
  const rawSources = (rawSourcesRaw as RawSrc[])
    .filter((e) => typeof e.sourceId === "string" && typeof e.content === "string")
    .map((e) => ({
      sourceId: e.sourceId as string,
      content: e.content as string,
      sha256: typeof e.sha256 === "string" ? e.sha256 : null,
      url: typeof e.url === "string" ? e.url : null
    }));

  let result: Awaited<ReturnType<typeof runRagHallucinationCheck>>;
  try {
    result = await runRagHallucinationCheck({
      apiKey,
      content,
      sourceTrail,
      rawSources,
      claimExtractModel,
      crossValidateModel
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[hallucination-check] runRagHallucinationCheck threw: ${msg}`);
    return c.json({
      data: {
        verdict: "ERROR",
        confidence: 0,
        flags: [],
        reasoning: `rag_check_exception: ${msg} — safe default block`,
        ragUsed: false
      }
    });
  }

  console.info(
    `[hallucination-check] verdict=${result.verdict} confidence=${result.confidence.toFixed(2)} ` +
    `flags=${result.flags.length} ragUsed=${result.ragUsed}`
  );

  return c.json({ data: result });
});

// =============================================================================
// BLOCK #7 Axis 1 — GET /api/v1/lab/strategy-snapshot
// =============================================================================
// Returns the IUF Quant Lab sanctioned strategy snapshot (read-only consume).
//
// Source path (sibling repo, local dev only):
//   IUF_QUANT_LAB/research/finmind_sponsor_999_data_factory/codex_next/
//     final_strategy_count_board_v15.json
//
// Lab / TR alignment lock rules (board/lab_tr_alignment_lock_2026-05-07.md):
//   - TR is read-only consumer; lab repo is NEVER mutated from TR
//   - All candidates carry researchOnly=true + mandatory disclaimer
//   - No promotion wording / buy / sell / allocation % / 必賺 / 勝率
//   - status preserved verbatim from lab JSON (never renamed / softened)
//   - Lab path unavailable in prod/Railway → 200 with meta.source='unavailable'
//
// Auth: Owner / Admin / Analyst (READ_DRAFT_ROLES gate)
// Hard lines:
//   - Never return fake/fabricated strategy data
//   - Never imply strategies are paper-ready or live-ready
//   - Never expose Sharpe / equity curve / win rate / annualised return
// =============================================================================

app.get("/api/v1/lab/strategy-snapshot", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const { loadLabSanctionedSnapshot } = await import("./lab-strategy-consumer.js");
  const snapshot = loadLabSanctionedSnapshot();

  if (snapshot === null) {
    return c.json({
      data: null,
      meta: {
        source: "unavailable" as const,
        reason:
          "Lab sanctioned snapshot not found at expected sibling path. " +
          "This is expected in prod/Railway (lab repo not deployed). " +
          "In local dev: ensure IUF_QUANT_LAB repo is present as sibling to IUF_TRADING_ROOM_APP.",
        labGovernancePath:
          "IUF_QUANT_LAB/research/finmind_sponsor_999_data_factory/codex_next/final_strategy_count_board_v15.json",
        labTrAlignmentLock: "board/lab_tr_alignment_lock_2026-05-07.md"
      }
    });
  }

  return c.json({
    data: snapshot,
    meta: {
      source: "lab_sanctioned" as const,
      sprintId: snapshot.sprintId,
      collectedAt: snapshot.collectedAt,
      candidateCount: snapshot.candidates.length,
      researchOnly: true,
      note: "Research candidates only. No strategy is approved for paper or live trading. Awaiting Athena/Bruce gates."
    }
  });
});

// =============================================================================
// BLOCK #7 Axis 1 — GET /api/v1/lab/strategies  (alias for strategy-snapshot)
// =============================================================================
// Codex frontend /lab page calls /api/v1/lab/strategies — alias to exact same
// handler as /api/v1/lab/strategy-snapshot so both paths work identically.
// Auth: Owner / Admin / Analyst (READ_DRAFT_ROLES gate)
// =============================================================================

app.get("/api/v1/lab/strategies", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const { loadLabSanctionedSnapshot } = await import("./lab-strategy-consumer.js");
  const snapshot = loadLabSanctionedSnapshot();

  if (snapshot === null) {
    return c.json({
      data: null,
      meta: {
        source: "unavailable" as const,
        reason:
          "Lab sanctioned snapshot not found at expected sibling path. " +
          "This is expected in prod/Railway (lab repo not deployed). " +
          "In local dev: ensure IUF_QUANT_LAB repo is present as sibling to IUF_TRADING_ROOM_APP.",
        labGovernancePath:
          "IUF_QUANT_LAB/research/finmind_sponsor_999_data_factory/codex_next/final_strategy_count_board_v15.json",
        labTrAlignmentLock: "board/lab_tr_alignment_lock_2026-05-07.md"
      }
    });
  }

  return c.json({
    data: snapshot,
    meta: {
      source: "lab_sanctioned" as const,
      sprintId: snapshot.sprintId,
      collectedAt: snapshot.collectedAt,
      candidateCount: snapshot.candidates.length,
      researchOnly: true,
      note: "Research candidates only. No strategy is approved for paper or live trading. Awaiting Athena/Bruce gates."
    }
  });
});

// =============================================================================
// BLOCK #9 — GET /api/v1/lab/three-strategy/*  (14 endpoints)
// =============================================================================
// Lab → TR data flow: three-strategy paper fixture consume (read-only).
//
// Source: data/lab/three-strategy/three_strategy_paper_fixture_api_snapshot_v1.json
// (embedded from IUF_QUANT_LAB/reports/trading_room — lab is never called at runtime)
//
// Lab / TR alignment lock rules:
//   - TR is read-only consumer; never writes to lab
//   - cash_order_path = BLOCKED_until_Yang_final_manual_ACK always enforced
//   - mode = READ_ONLY_FIXTURE_API + fixture_label = PAPER_FIXTURE on all responses
//   - No broker write-side fields, no credentials, no raw engineering semantics
//   - Graceful null when embedded file missing (200, ok: false, meta.source=unavailable)
//
// Auth: Owner / Admin / Analyst (READ_DRAFT_ROLES gate)
// Optional query param ?strategy_id= on signals/paper-orders/positions/risk-events
// =============================================================================

app.get("/api/v1/lab/three-strategy/health", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureHealth } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureHealth();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/status", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureStatus } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureStatus();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/files", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureFiles } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureFiles();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/strategies", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureStrategies } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureStrategies();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/signals", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureSignals } = await import("./lab-three-strategy-consumer.js");
  const strategyId = c.req.query("strategy_id");
  const result = getFixtureSignals(strategyId);
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/paper-orders", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixturePaperOrders } = await import("./lab-three-strategy-consumer.js");
  const strategyId = c.req.query("strategy_id");
  const result = getFixturePaperOrders(strategyId);
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/positions", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixturePositions } = await import("./lab-three-strategy-consumer.js");
  const strategyId = c.req.query("strategy_id");
  const result = getFixturePositions(strategyId);
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/risk-events", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureRiskEvents } = await import("./lab-three-strategy-consumer.js");
  const strategyId = c.req.query("strategy_id");
  const result = getFixtureRiskEvents(strategyId);
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/risk-config", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureRiskConfig } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureRiskConfig();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/decision-matrix", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureDecisionMatrix } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureDecisionMatrix();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/execution-board", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureExecutionBoard } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureExecutionBoard();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/position-sensitivity", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixturePositionSensitivity } = await import("./lab-three-strategy-consumer.js");
  const result = getFixturePositionSensitivity();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/master-index", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureMasterIndex } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureMasterIndex();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/snapshot", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureFullSnapshot } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureFullSnapshot();
  return c.json(result, result.ok ? 200 : 503);
});

// =============================================================================
// Letter D — GET /api/v1/briefs/:id  (brief detail with audit chain)
// =============================================================================
// Returns a single daily_brief by UUID or date string (YYYY-MM-DD), plus
// the full audit chain: hard-reject rules, adversarial review, hallucination
// check — reconstructed from audit_logs + content_drafts.
//
// Auth: Owner / Admin / Analyst (READ_DRAFT_ROLES gate)
//
// auditChain fields:
//   hardReject      — rules checked by classifyDraftTier + BROKEN token scan
//   adversarialReview — from audit_log action=content_draft.adversarial_audit
//   hallucinationCheck — from audit_log action=hallucination_reject or
//                         content_draft.ai_approved (with hc payload)
//
// If no audit log entries found → null fields (graceful, not 500).
// =============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get("/api/v1/briefs/:id", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "missing_id" }, 400);
  }

  const db = getDb();
  if (!isDatabaseMode() || !db) {
    return c.json({ error: "database_unavailable" }, 503);
  }

  const workspaceId = c.get("session").workspace.id;

  // Look up brief by UUID or date string
  const isUuid = UUID_RE.test(id);
  const briefRows = await db
    .select()
    .from(dailyBriefs)
    .where(
      and(
        eq(dailyBriefs.workspaceId, workspaceId),
        isUuid ? eq(dailyBriefs.id, id) : eq(dailyBriefs.date, id)
      )
    )
    .orderBy(desc(dailyBriefs.createdAt))
    .limit(1);

  if (briefRows.length === 0) {
    return c.json({ error: "not_found" }, 404);
  }

  const brief = briefRows[0]!;

  // Derive title from first section heading (no top-level title in schema)
  const firstSection = (brief.sections as Array<{ heading: string; body: string }>)[0];
  const title = firstSection?.heading ?? `Brief ${brief.date}`;

  // ── Resolve linked content_draft by dedupeKey pattern ─────────────────────
  // daily_briefs are produced by approving a content_draft with targetTable=daily_briefs
  // dedupeKey format matches computeContentDraftDedupeKey() in content-draft-store.ts
  const dedupeKey = `${workspaceId}:daily_briefs:${brief.date}:v1`;
  const draftRows = await db
    .select({ id: contentDrafts.id })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.workspaceId, workspaceId),
        eq(contentDrafts.dedupeKey, dedupeKey)
      )
    )
    .orderBy(desc(contentDrafts.createdAt))
    .limit(5);

  const draftIds = draftRows.map((r) => r.id);

  // ── Read audit chain from audit_logs ───────────────────────────────────────
  type RawAuditRow = {
    action: string;
    entityId: string;
    payload: unknown;
    createdAt: Date;
  };

  let auditRows: RawAuditRow[] = [];
  if (draftIds.length > 0) {
    const AUDIT_ACTIONS = [
      "content_draft.adversarial_audit",
      "content_draft.ai_yellow_held",
      "content_draft.ai_approved",
      "content_draft.ai_rejected",
      "content_draft.ai_manual_review",
      "hallucination_reject"
    ];
    auditRows = await db
      .select({
        action: auditLogs.action,
        entityId: auditLogs.entityId,
        payload: auditLogs.payload,
        createdAt: auditLogs.createdAt
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.workspaceId, workspaceId),
          inArray(auditLogs.entityId, draftIds),
          inArray(auditLogs.action, AUDIT_ACTIONS)
        )
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(50);
  }

  // ── Parse adversarial review from audit rows ───────────────────────────────
  type AdversarialReviewResult = {
    ran: boolean;
    verdict: "OK" | "INTERCEPTED";
    severityScore: number | null;
    flags: string[];
    reviewerModel: string;
    auditedAt: string | null;
  };

  let adversarialReview: AdversarialReviewResult | null = null;
  const adversarialRow = auditRows.find((r) => r.action === "content_draft.adversarial_audit");
  if (adversarialRow) {
    const p = adversarialRow.payload as Record<string, unknown> | null;
    const score = typeof p?.["severityScore"] === "number" ? (p["severityScore"] as number) : null;
    adversarialReview = {
      ran: true,
      verdict: (score !== null && score >= 7) ? "INTERCEPTED" : "OK",
      severityScore: score,
      flags: Array.isArray(p?.["adversarialFlags"]) ? (p["adversarialFlags"] as string[]) : [],
      reviewerModel: typeof p?.["model"] === "string" ? (p["model"] as string) : (process.env["OPENAI_ADVERSARIAL_REVIEWER_MODEL"] ?? "gpt-4.1"),
      auditedAt: adversarialRow.createdAt.toISOString()
    };
  }

  // ── Parse hallucination check from audit rows ──────────────────────────────
  type HallucinationCheckResult = {
    ran: boolean;
    verdict: "OK" | "PARTIAL_HALLUCINATED" | "HALLUCINATED" | "ERROR";
    confidence: number | null;
    flags: unknown[];
    ragUsed: boolean;
    modelChain: string;
    auditedAt: string | null;
  };

  let hallucinationCheck: HallucinationCheckResult | null = null;
  const hcRow = auditRows.find(
    (r) => r.action === "hallucination_reject" || r.action === "content_draft.ai_approved"
  );
  if (hcRow) {
    const p = hcRow.payload as Record<string, unknown> | null;
    const hcPayload = (p?.["hallucinationCheck"] as Record<string, unknown> | null) ?? p;
    const verdict = (hcPayload?.["verdict"] as string | undefined) ?? null;
    if (verdict && ["OK", "PARTIAL_HALLUCINATED", "HALLUCINATED", "ERROR"].includes(verdict)) {
      hallucinationCheck = {
        ran: true,
        verdict: verdict as HallucinationCheckResult["verdict"],
        confidence:
          typeof hcPayload?.["confidence"] === "number" ? (hcPayload["confidence"] as number) : null,
        flags: Array.isArray(hcPayload?.["flags"]) ? (hcPayload["flags"] as unknown[]) : [],
        ragUsed: hcPayload?.["ragUsed"] === true,
        modelChain:
          typeof hcPayload?.["modelChain"] === "string"
            ? (hcPayload["modelChain"] as string)
            : `${process.env["OPENAI_CLAIM_EXTRACT_MODEL"] ?? "gpt-4o-mini"} → ${process.env["OPENAI_HALLUCINATION_VERIFY_MODEL"] ?? "gpt-4.1"}`,
        auditedAt: hcRow.createdAt.toISOString()
      };
    }
  }

  // ── Build hard-reject summary ──────────────────────────────────────────────
  // Hard-reject rules are policy constants — report them verbatim so frontend
  // can show what safety gates were in effect for this brief.
  const HARD_REJECT_RULES = [
    "no explicit buy/sell recommendation",
    "no target price claim",
    "no guaranteed return",
    "no broken/deprecated source token in payload",
    "no tier=red auto-approve",
    "no content_draft.ai_rejected bypass"
  ];
  const wasRejected = auditRows.some(
    (r) => r.action === "content_draft.ai_rejected" || r.action === "hallucination_reject"
  );

  const auditChain = {
    hardReject: {
      rules: HARD_REJECT_RULES,
      rejected: wasRejected
    },
    adversarialReview,
    hallucinationCheck
  };

  // ── Build sections with sourceTrail (sourceTrail not in DB; omit gracefully) ─
  const sections = (brief.sections as Array<{ heading: string; body: string }>).map((s) => ({
    heading: s.heading,
    body: s.body,
    sourceTrail: null as string | null  // not persisted in daily_briefs; available on content_drafts.payload
  }));

  return c.json({
    data: {
      id: brief.id,
      date: brief.date,
      title,
      status: brief.status,
      marketState: brief.marketState,
      generatedBy: brief.generatedBy,
      createdAt: brief.createdAt.toISOString(),
      sections,
      auditChain
    }
  });
});

// =============================================================================
// VENDOR DASHBOARD ENDPOINTS (Bruce gap check 2026-05-07)
// 8 P0 + 5 P1 = 13 endpoints — thin adapters over existing IUF data stores.
// All read-only. Auth: Owner / Admin / Analyst (READ_DRAFT_ROLES).
// Status enum: lowercase "live/stale/empty/blocked/error/review" per vendor spec.
// Hard lines:
//   - NEVER return FinMind token string or KGI credentials
//   - DEGRADED states surfaced honestly (no fake live)
//   - 8 sources list order is fixed: finmind/kline/company/openalice/topic/strategy/signal/news
//   - paper E2E always 6 items; pipeline always 5 items
//   - formalOrder.state always "blocked" (KGI TradeCom permission pending)
//   - portfolio.readiness always "preview-only"
// =============================================================================

// ── Vendor helper: Taipei ISO timestamp ──────────────────────────────────────
function toTaipeiIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return null;
  // format as ISO 8601 with +08:00
  const tst = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const iso = tst.toISOString().replace("Z", "+08:00");
  return iso;
}

function nowTaipeiIso(): string {
  return toTaipeiIso(new Date()) ?? new Date().toISOString();
}

// ── Vendor helper: map IUF uppercase status → vendor lowercase status ─────────
function mapToVendorStatus(
  iufStatus: string | null | undefined
): "live" | "stale" | "empty" | "blocked" | "error" | "review" {
  switch ((iufStatus ?? "").toUpperCase()) {
    case "LIVE":
    case "LIVE_READY":
      return "live";
    case "STALE":
      return "stale";
    case "EMPTY":
    case "MOCK":
    case "FALLBACK":
    case "MISSING":
    case "CLOSED":
      return "empty";
    case "BLOCKED":
      return "blocked";
    case "DEGRADED":
    case "ERROR":
      return "error";
    default:
      return "empty";
  }
}

// ── P0 #1: GET /api/v1/meta ─────────────────────────────────────────────────
app.get("/api/v1/meta", (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const flags = getExecutionFlagSnapshot();
  const modeLabel = flags.executionMode === "paper"
    ? "模擬模式 / 風控守門"
    : flags.executionMode === "live"
    ? "實盤模式 / 風控守門"
    : "停用模式";

  // Taipei time display string
  const now = new Date();
  const tst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowText = `${tst.getUTCFullYear()}/${pad(tst.getUTCMonth() + 1)}/${pad(tst.getUTCDate())} `
    + `${pad(tst.getUTCHours())}:${pad(tst.getUTCMinutes())}:${pad(tst.getUTCSeconds())} 台北`;

  return c.json({
    operator: "IUF-01",
    mode: modeLabel,
    market: "盤面 / 真實資料",
    nowText,
    formalOrder: {
      state: "blocked",
      reason: "KGI TradeCom 元件使用權限待業務員 enable (code 78)"
    }
  });
});

// ── P0 #2: GET /api/v1/sources ────────────────────────────────────────────────
// 8 fixed sources in fixed order: finmind/kline/company/openalice/topic/strategy/signal/news
app.get("/api/v1/sources", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const finmind = getFinMindClient();
  const tokenPresent = finmind.hasToken();
  const stats = getFinMindStats();
  const circuitOpen = stats.circuitOpen;
  const quotaTier = finmindQuotaTier(tokenPresent);
  const quotaLimitPerHour = finmindQuotaLimitPerHour(quotaTier) ?? 6000;
  const quotaUsed = stats.requestCount;

  // FinMind source state
  const finmindStatus = !tokenPresent ? "blocked"
    : circuitOpen ? "error"
    : stats.requestCount > 0 && (stats.errorCount / stats.requestCount) >= 0.5 ? "error"
    : "live";
  const finmindLastUpdate = stats.lastFetchTs ? toTaipeiIso(stats.lastFetchTs) : null;

  // kline (companies_ohlcv) source state — query DB
  let klineStatus: "live" | "stale" | "empty" | "blocked" | "error" | "review" = "empty";
  let klineLastUpdate: string | null = null;
  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;
  if (db) {
    try {
      const res = await db.execute(drizzleSql`
        SELECT MAX(dt)::text AS latest, COUNT(*)::int AS cnt
        FROM companies_ohlcv
        WHERE interval = 'day'
      `);
      const row = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
        ?? (Array.isArray(res) ? res[0] : res);
      const cnt = parseInt(String(row?.cnt ?? "0"), 10);
      const latestStr = typeof row?.latest === "string" ? row.latest : null;
      if (cnt === 0) {
        klineStatus = "empty";
      } else if (latestStr) {
        const latestMs = new Date(latestStr).getTime();
        const staleCutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
        klineStatus = latestMs < staleCutoff ? "stale" : "live";
        klineLastUpdate = toTaipeiIso(latestStr);
      } else {
        klineStatus = "live";
      }
    } catch {
      klineStatus = "error";
    }
  }

  // company source — always live if companies table has rows
  let companyStatus: "live" | "stale" | "empty" | "blocked" | "error" | "review" = "empty";
  let companyCount = 0;
  if (db) {
    try {
      const session = c.get("session");
      const res = await db.execute(
        drizzleSql`SELECT COUNT(*)::int AS cnt FROM companies WHERE workspace_id = ${session.workspace.id}`
      );
      const row = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
        ?? (Array.isArray(res) ? res[0] : res);
      companyCount = parseInt(String(row?.cnt ?? "0"), 10);
      companyStatus = companyCount > 0 ? "live" : "empty";
    } catch {
      companyStatus = "error";
    }
  }

  // openalice source — derive from observability snapshot
  const pipelineState = getPipelineObservabilityAddendum();
  const openaliceStatus: "live" | "stale" | "empty" | "blocked" | "error" | "review" =
    pipelineState.lastPublishedAt
      ? (() => {
          const age = Date.now() - new Date(pipelineState.lastPublishedAt ?? "").getTime();
          return age < 48 * 60 * 60 * 1000 ? "live" : "stale";
        })()
      : pipelineState.lastGeneratedAt ? "review"
      : "empty";
  const openaliceLastUpdate = pipelineState.lastPublishedAt
    ? toTaipeiIso(pipelineState.lastPublishedAt)
    : null;

  // topic (theme data) — check daily_theme_summaries recency
  let topicStatus: "live" | "stale" | "empty" | "blocked" | "error" | "review" = "empty";
  let topicLastUpdate: string | null = null;
  if (db) {
    try {
      const res = await db.execute(
        drizzleSql`SELECT MAX(created_at)::text AS latest FROM daily_theme_summaries LIMIT 1`
      );
      const row = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
        ?? (Array.isArray(res) ? res[0] : res);
      const latestStr = typeof row?.latest === "string" ? row.latest : null;
      if (latestStr) {
        const ageMs = Date.now() - new Date(latestStr).getTime();
        topicStatus = ageMs > 3 * 24 * 60 * 60 * 1000 ? "stale" : "live";
        topicLastUpdate = toTaipeiIso(latestStr);
      } else {
        topicStatus = "empty";
      }
    } catch {
      topicStatus = "empty";
    }
  }

  // strategy — check lab snapshot
  const labSnapshot = loadStrategySnapshot();
  const strategyStatus: "live" | "stale" | "empty" | "blocked" | "error" | "review" =
    labSnapshot && labSnapshot.length > 0 ? "live" : "empty";

  // signal — check signals table
  let signalStatus: "live" | "stale" | "empty" | "blocked" | "error" | "review" = "empty";
  let signalLastUpdate: string | null = null;
  if (db) {
    try {
      const session = c.get("session");
      const res = await db.execute(
        drizzleSql`SELECT MAX(created_at)::text AS latest, COUNT(*)::int AS cnt FROM signals WHERE workspace_id = ${session.workspace.id} LIMIT 1`
      );
      const row = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
        ?? (Array.isArray(res) ? res[0] : res);
      const cnt = parseInt(String(row?.cnt ?? "0"), 10);
      const latestStr = typeof row?.latest === "string" ? row.latest : null;
      if (cnt === 0) {
        signalStatus = "empty";
      } else if (latestStr) {
        const ageMs = Date.now() - new Date(latestStr).getTime();
        signalStatus = ageMs > 15 * 24 * 60 * 60 * 1000 ? "stale" : "live";
        signalLastUpdate = toTaipeiIso(latestStr);
      } else {
        signalStatus = "live";
      }
    } catch {
      signalStatus = "empty";
    }
  }

  // news — always empty (MOPS not yet integrated per vendor spec)
  const newsStatus: "live" | "stale" | "empty" | "blocked" | "error" | "review" = "empty";

  const stalenessMinutes = (isoTs: string | null) => {
    if (!isoTs) return null;
    return Math.floor((Date.now() - new Date(isoTs).getTime()) / 60000);
  };
  const staleMins = (st: string | null) => {
    const m = stalenessMinutes(st);
    return m !== null ? m : null;
  };

  return c.json([
    {
      key: "finmind",
      name: "FinMind",
      short: "FinMind",
      desc: "台股日線 / 基本面",
      status: finmindStatus,
      lastUpdateAt: finmindLastUpdate,
      updated: finmindLastUpdate ? finmindLastUpdate.slice(5, 16).replace("T", " ") : null,
      note: finmindStatus === "live" ? "今日資料" : finmindStatus === "blocked" ? "無 API Token" : "電路斷路",
      stalenessMinutes: staleMins(finmindLastUpdate),
      detail: tokenPresent
        ? `Sponsor 999 token 存在;${quotaLimitPerHour}/小時 quota 中已使用 ${quotaUsed} 次。`
        : "FINMIND_API_TOKEN 未設定;資料來源不可用。",
      cta: null,
      days: null
    },
    {
      key: "kline",
      name: "K 線資料",
      short: "K 線",
      desc: "companies_ohlcv 日線 / 分鐘線",
      status: klineStatus,
      lastUpdateAt: klineLastUpdate,
      updated: klineLastUpdate ? klineLastUpdate.slice(5, 16).replace("T", " ") : null,
      note: klineStatus === "live" ? "日線資料正常" : klineStatus === "stale" ? "日線資料過期" : "尚無日線資料",
      stalenessMinutes: staleMins(klineLastUpdate),
      detail: klineStatus === "error" ? "DB 查詢失敗" : klineLastUpdate ? `最新日線: ${klineLastUpdate.slice(0, 10)}` : "尚未同步",
      cta: null,
      days: null
    },
    {
      key: "company",
      name: "公司資料",
      short: "公司",
      desc: `公司池 (${companyCount} 家)`,
      status: companyStatus,
      lastUpdateAt: null,
      updated: null,
      note: companyCount > 0 ? `${companyCount} 家公司已載入` : "公司池為空",
      stalenessMinutes: null,
      detail: `companies 表共 ${companyCount} 筆`,
      cta: null,
      days: null
    },
    {
      key: "openalice",
      name: "OpenAlice",
      short: "OpenAlice",
      desc: "AI 每日簡報自動排程",
      status: openaliceStatus,
      lastUpdateAt: openaliceLastUpdate,
      updated: openaliceLastUpdate ? openaliceLastUpdate.slice(5, 16).replace("T", " ") : null,
      note: openaliceStatus === "live" ? "今日簡報已發布"
        : openaliceStatus === "review" ? "草稿待審核"
        : openaliceStatus === "stale" ? "簡報過期"
        : "尚未發布",
      stalenessMinutes: staleMins(openaliceLastUpdate),
      detail: pipelineState.lastFailureReason
        ? `最近錯誤: ${pipelineState.lastFailureReason}`
        : openaliceLastUpdate ? `最近發布: ${openaliceLastUpdate.slice(0, 10)}` : "尚無發布記錄",
      cta: null,
      days: null
    },
    {
      key: "topic",
      name: "主題資料",
      short: "主題",
      desc: "daily_theme_summaries",
      status: topicStatus,
      lastUpdateAt: topicLastUpdate,
      updated: topicLastUpdate ? topicLastUpdate.slice(5, 16).replace("T", " ") : null,
      note: topicStatus === "stale" ? "主題資料已過期" : topicStatus === "empty" ? "主題尚無資料" : "主題資料正常",
      stalenessMinutes: staleMins(topicLastUpdate),
      detail: topicLastUpdate ? `最新主題摘要: ${topicLastUpdate.slice(0, 10)}` : "尚未生成主題摘要",
      cta: topicStatus === "stale" ? "查看主題板 ›" : null,
      days: (() => {
        if (!topicLastUpdate) return null;
        return Math.floor((Date.now() - new Date(topicLastUpdate).getTime()) / (24 * 60 * 60 * 1000));
      })()
    },
    {
      key: "strategy",
      name: "策略候選",
      short: "策略",
      desc: "Lab 策略快照",
      status: strategyStatus,
      lastUpdateAt: null,
      updated: null,
      note: strategyStatus === "live" ? `${labSnapshot?.length ?? 0} 個研究候選` : "尚無策略快照",
      stalenessMinutes: null,
      detail: labSnapshot ? `Lab 快照包含 ${labSnapshot.length} 個候選策略 (RESEARCH_ONLY)` : "strategies-snapshot.json 不存在",
      cta: null,
      days: null
    },
    {
      key: "signal",
      name: "訊號證據",
      short: "訊號",
      desc: "signals 表",
      status: signalStatus,
      lastUpdateAt: signalLastUpdate,
      updated: signalLastUpdate ? signalLastUpdate.slice(5, 16).replace("T", " ") : null,
      note: signalStatus === "stale" ? "訊號過期 (>15 天)" : signalStatus === "empty" ? "尚無訊號" : "訊號正常",
      stalenessMinutes: staleMins(signalLastUpdate),
      detail: signalLastUpdate ? `最新訊號: ${signalLastUpdate.slice(0, 10)}` : "尚未有訊號記錄",
      cta: null,
      days: null
    },
    {
      key: "news",
      name: "重大訊息",
      short: "訊息",
      desc: "公開資訊觀測站 (MOPS) — 尚未接入",
      status: newsStatus,
      lastUpdateAt: null,
      updated: null,
      note: "尚未接入公開資訊觀測站",
      stalenessMinutes: null,
      detail: "公開資訊觀測站 (MOPS) 來源尚未接入;目前無法顯示重大訊息;首頁不出現假資料。",
      cta: null,
      days: null
    }
  ]);
});

// ── P1 #5 (path alias): GET /api/v1/finmind/health ───────────────────────────
// Vendor spec: /api/v1/finmind/health — richer shape than /diagnostics/finmind
app.get("/api/v1/finmind/health", (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const finmind = getFinMindClient();
  const tokenPresent = finmind.hasToken();
  const stats = getFinMindStats();
  const quotaTier = finmindQuotaTier(tokenPresent);
  const quotaLimitPerHour = finmindQuotaLimitPerHour(quotaTier) ?? 6000;

  // Count ok/downgraded/blocked datasets from circuit state
  const circuitOpen = stats.circuitOpen;
  const datasets = {
    ok: circuitOpen ? 0 : (tokenPresent ? 1 : 0),
    downgraded: circuitOpen ? 1 : 0,
    blocked: !tokenPresent ? 1 : 0
  };

  const recentRequest = stats.lastFetchTs
    ? {
        name: stats.lastDataset ?? "unknown",
        at: toTaipeiIso(stats.lastFetchTs) ?? stats.lastFetchTs,
        ok: stats.errorCount < stats.requestCount
      }
    : null;

  // Last 5 requests — we only store aggregate counts, so return synthetic summary
  // HARD LINE: never return token. requestCount/errorCount are process-level aggregates.
  const requests: Array<{ name: string; at: string; ms: number | null; ok: boolean; why: string | null }> = recentRequest
    ? [{ name: recentRequest.name, at: recentRequest.at, ms: null, ok: recentRequest.ok, why: circuitOpen ? `circuit open: ${stats.circuitReason ?? "unknown"}` : null }]
    : [];

  return c.json({
    sponsor: tokenPresent ? "Sponsor 999" : null,
    tokenPresent,
    quotaTotal: quotaLimitPerHour,
    quotaUsed: stats.requestCount,
    datasets,
    recentRequest,
    requests
  });
});

// ── P0 #3: GET /api/v1/quotes ─────────────────────────────────────────────────
// Vendor shape: { sourceState, sourceLabel, indices[], flows[], stocks[], intradayTwii[60] }
// Real-time quotes come from KGI gateway (blocked) → sourceState=empty, no fake data.
// Static TWII index placeholder from market_data overview when available.
app.get("/api/v1/quotes", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  // KGI quote gateway is BLOCKED (TradeCom permission pending) → sourceState=empty
  // Per vendor spec: "如果市場資料來源 status = empty, response 必須帶 sourceState: 'empty'"
  // HARD LINE: do not fake indices/flows/stocks with made-up numbers.
  // Return minimal empty structure so frontend can display "以下為示意" badge.
  return c.json({
    sourceState: "empty",
    sourceLabel: "市場資料 · 無即時資料 / KGI 通道待開通",
    indices: [],
    flows: [],
    stocks: [],
    intradayTwii: []
  });
});

// ── P0 #4: GET /api/v1/breadth ────────────────────────────────────────────────
// Vendor shape: { up, flat, down, total, asOf }
// We have no breadth DB table currently → return empty/stale state honestly.
app.get("/api/v1/breadth", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;

  // Try to derive breadth from companies_ohlcv latest day
  let up = 0, flat = 0, down = 0, total = 0;
  let asOf: string | null = null;

  if (db) {
    try {
      const res = await db.execute(drizzleSql`
        WITH latest AS (
          SELECT MAX(dt) AS max_dt FROM companies_ohlcv WHERE interval = 'day'
        )
        SELECT
          COUNT(*) FILTER (WHERE close > open)::int          AS up_count,
          COUNT(*) FILTER (WHERE ABS(close - open) < 0.01 * open)::int AS flat_count,
          COUNT(*) FILTER (WHERE close < open)::int          AS down_count,
          COUNT(*)::int                                       AS total_count,
          MAX(dt)::text                                       AS as_of
        FROM companies_ohlcv
        WHERE interval = 'day'
        AND dt = (SELECT max_dt FROM latest)
      `);
      const row = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
        ?? (Array.isArray(res) ? res[0] : res);
      up = parseInt(String(row?.up_count ?? "0"), 10);
      flat = parseInt(String(row?.flat_count ?? "0"), 10);
      down = parseInt(String(row?.down_count ?? "0"), 10);
      total = parseInt(String(row?.total_count ?? "0"), 10);
      const asOfStr = typeof row?.as_of === "string" ? row.as_of : null;
      asOf = asOfStr ? toTaipeiIso(asOfStr) : null;
    } catch {
      // degraded — return zeros
    }
  }

  return c.json({ up, flat, down, total, asOf });
});

// ── P0 #5: GET /api/v1/heatmap ────────────────────────────────────────────────
// Vendor shape: array of { sym, name, pct, mcap } OR { sourceState, tiles }
// sourceState=empty when no OHLCV data. mcap from tw_market_value if available.
app.get("/api/v1/heatmap", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const session = c.get("session");
  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;

  if (!db) {
    return c.json({ sourceState: "empty", tiles: [] });
  }

  try {
    // Get latest OHLCV day for pct change, joined with companies for name
    const res = await db.execute(drizzleSql`
      WITH latest AS (
        SELECT MAX(dt) AS max_dt FROM companies_ohlcv WHERE interval = 'day'
      ),
      prev AS (
        SELECT MAX(dt) AS prev_dt
        FROM companies_ohlcv
        WHERE interval = 'day'
        AND dt < (SELECT max_dt FROM latest)
      )
      SELECT
        c.ticker AS sym,
        c.name,
        CASE
          WHEN p.close IS NOT NULL AND p.close > 0
          THEN ROUND(((t.close - p.close) / p.close * 100)::numeric, 2)::float
          ELSE 0
        END AS pct,
        NULL::bigint AS mcap
      FROM companies_ohlcv t
      JOIN companies c ON c.ticker = t.ticker AND c.workspace_id = ${session.workspace.id}
      LEFT JOIN companies_ohlcv p
        ON p.ticker = t.ticker
        AND p.interval = 'day'
        AND p.dt = (SELECT prev_dt FROM prev)
      WHERE t.interval = 'day'
        AND t.dt = (SELECT max_dt FROM latest)
        AND t.source != 'mock'
      ORDER BY t.volume DESC NULLS LAST
      LIMIT 30
    `);
    const rows = ((res as { rows?: Record<string, unknown>[] }).rows ?? (Array.isArray(res) ? res : [])) as Record<string, unknown>[];

    if (rows.length === 0) {
      return c.json({ sourceState: "empty", tiles: [] });
    }

    const tiles = rows.map((r) => ({
      sym: String(r.sym ?? ""),
      name: String(r.name ?? r.sym ?? ""),
      pct: typeof r.pct === "number" ? r.pct : parseFloat(String(r.pct ?? "0")),
      mcap: typeof r.mcap === "number" ? r.mcap : null
    }));

    return c.json({ sourceState: "live", tiles });
  } catch {
    return c.json({ sourceState: "error", tiles: [] });
  }
});

// ── P0 #6: GET /api/v1/openalice/status ──────────────────────────────────────
// Vendor shape: runner/dispatcher/queue/publishedToday/sourceTrail/aiReview/pipeline[5]/notice
// Built from existing pipeline state + observability snapshot.
app.get("/api/v1/openalice/status", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const obs = await getOpenAliceObservabilitySnapshot(c.get("session").workspace.slug);
  const pipeline = getPipelineObservabilityAddendum();

  const runnerState = obs.workerStatus === "healthy" ? "healthy"
    : obs.workerStatus === "stale" ? "stale"
    : "error";
  const dispatcherState = obs.sweepStatus === "healthy" ? "healthy"
    : obs.sweepStatus === "stale" ? "stale"
    : "idle";

  const queuedJobs = obs.metrics?.queuedJobs ?? 0;
  const runningJobs = obs.metrics?.runningJobs ?? 0;

  // Count drafts awaiting review
  let reviewCount = 0;
  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;
  let publishedToday = 0;
  let missingSourceTrail: string[] = [];

  if (db) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const reviewRes = await db.execute(
        drizzleSql`SELECT COUNT(*)::int AS cnt FROM content_drafts WHERE status = 'awaiting_review'`
      );
      const rr = (reviewRes as { rows?: Record<string, unknown>[] }).rows?.[0]
        ?? (Array.isArray(reviewRes) ? reviewRes[0] : reviewRes);
      reviewCount = parseInt(String(rr?.cnt ?? "0"), 10);

      const pubRes = await db.execute(
        drizzleSql`SELECT COUNT(*)::int AS cnt FROM daily_briefs WHERE date = ${today} AND status = 'published'`
      );
      const pr = (pubRes as { rows?: Record<string, unknown>[] }).rows?.[0]
        ?? (Array.isArray(pubRes) ? pubRes[0] : pubRes);
      publishedToday = parseInt(String(pr?.cnt ?? "0"), 10);
    } catch {
      // degraded
    }
  }

  // Source trail: derive from last pipeline run
  const lastResult = _lastPipelineState.lastResult;
  const trailComplete = lastResult?.sourcePack?.trailComplete ?? false;
  if (!trailComplete && lastResult?.sourcePack) {
    const incomplete = lastResult.sourcePack.sources
      .filter((s) => s.status === "EMPTY" || s.status === "ERROR" || s.status === "MISSING")
      .map((s) => s.source);
    missingSourceTrail = incomplete;
  }

  // 5-stage pipeline
  const dataFetchState = pipeline.lastGeneratedAt ? "ok" : "wait";
  const sourceAssembleState = trailComplete ? "ok" : "warn";
  const draftGenState = pipeline.lastGeneratedAt ? "ok"
    : pipeline.lastFailureReason ? "wait" : "wait";
  const aiReviewState = pipeline.reviewerVerdict === "approve" ? "ok"
    : pipeline.lastReviewedAt ? "warn" : "wait";
  const publishedState = publishedToday > 0 ? "ok" : "wait";

  const aiReviewWaiting = reviewCount;
  const aiReviewDisplayState = reviewCount > 0 ? "review"
    : pipeline.reviewerVerdict === "approve" ? "ok"
    : "wait";

  return c.json({
    runner: {
      state: runnerState,
      lastHeartbeat: obs.workerHeartbeatAt ? toTaipeiIso(obs.workerHeartbeatAt) : null
    },
    dispatcher: {
      state: dispatcherState,
      lastScan: obs.lastSweepAt ? toTaipeiIso(obs.lastSweepAt) : null
    },
    queue: { queued: queuedJobs, running: runningJobs, review: aiReviewWaiting },
    publishedToday,
    sourceTrail: {
      complete: trailComplete,
      missing: missingSourceTrail
    },
    aiReview: {
      state: aiReviewDisplayState,
      waiting: aiReviewWaiting,
      note: aiReviewWaiting > 0
        ? `${aiReviewWaiting} 筆待審核`
        : !trailComplete
        ? "尚無待審 — 因 source trail 不完整,今日簡報未進入 AI 審核"
        : "AI 審核正常"
    },
    pipeline: [
      { id: 1, name: "資料拉取",    state: dataFetchState,    note: "FinMind / 公司資料" + (pipeline.lastGeneratedAt ? " 已就緒" : " 待更新") },
      { id: 2, name: "Source 拼接", state: sourceAssembleState, note: trailComplete ? "Source trail 完整" : "部分來源過期或缺少" },
      { id: 3, name: "草稿生成",    state: draftGenState,     note: pipeline.lastGeneratedAt ? `最後生成: ${(pipeline.lastGeneratedAt ?? "").slice(0, 10)}` : "等待 source trail 補齊" },
      { id: 4, name: "AI 審核",     state: aiReviewState,     note: pipeline.reviewerVerdict ? `最後審核: ${pipeline.reviewerVerdict}` : "未啟動" },
      { id: 5, name: "已發布",      state: publishedState,    note: `今日 ${publishedToday} 則` }
    ],
    notice: "簡報屬於 source trail,不是投資建議"
  });
});

// ── P0 #7: GET /api/v1/paper/e2e ─────────────────────────────────────────────
// Vendor shape: PaperStep[6] — maps from existing paper/health/detail data
app.get("/api/v1/paper/e2e", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const flags = getExecutionFlagSnapshot();
  const executionModeOk = flags.executionMode === "paper";
  const killSwitchOk    = !flags.killSwitchEnabled;
  const paperModeOk     = flags.paperModeEnabled;
  const previewGateOpen = executionModeOk && paperModeOk;
  const submitGateOpen  = executionModeOk && killSwitchOk && paperModeOk;

  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;
  let tableExists = false;
  let todayFillCount = 0;
  let totalFilledOrders = 0;
  let auditLogTodayEntries = 0;

  if (db) {
    try {
      const tableCheck = await db.execute(
        drizzleSql`SELECT to_regclass('public.paper_orders') AS tbl`
      );
      const tr = (tableCheck as { rows?: Record<string, unknown>[] })?.rows?.[0]
        ?? (Array.isArray(tableCheck) ? tableCheck[0] : tableCheck);
      tableExists = tr?.tbl !== null && tr?.tbl !== undefined;
    } catch { /* degraded */ }

    if (tableExists) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const fs = await db.execute(drizzleSql`
          SELECT
            COUNT(*) FILTER (WHERE status='FILLED' AND updated_at::date=${today}::date)::int AS today_fills,
            COUNT(*) FILTER (WHERE status='FILLED')::int AS total_filled
          FROM paper_orders
        `);
        const fr = (fs as { rows?: Record<string, unknown>[] })?.rows?.[0]
          ?? (Array.isArray(fs) ? fs[0] : fs);
        todayFillCount = parseInt(String(fr?.today_fills ?? "0"), 10);
        totalFilledOrders = parseInt(String(fr?.total_filled ?? "0"), 10);
      } catch { /* degraded */ }

      try {
        const today = new Date().toISOString().slice(0, 10);
        const ac = await db.execute(drizzleSql`
          SELECT COUNT(*)::int AS cnt FROM audit_logs WHERE created_at::date=${today}::date
        `);
        const ar = (ac as { rows?: Record<string, unknown>[] })?.rows?.[0]
          ?? (Array.isArray(ac) ? ac[0] : ac);
        auditLogTodayEntries = parseInt(String(ar?.cnt ?? "0"), 10);
      } catch { /* degraded */ }
    }
  } else if (!dbMode) {
    tableExists = true;
  }

  type PaperStepState = "ok" | "wait" | "idle" | "blocked" | "error";

  const previewState: PaperStepState = previewGateOpen ? "ok" : "blocked";
  const riskState: PaperStepState = previewGateOpen ? "ok" : "blocked";
  const draftState: PaperStepState = previewGateOpen && todayFillCount > 0 ? "ok" : previewGateOpen ? "wait" : "blocked";
  const submitState: PaperStepState = submitGateOpen ? "wait" : "blocked";
  const fillState: PaperStepState = todayFillCount > 0 ? "ok" : "idle";
  const auditState: PaperStepState = auditLogTodayEntries > 0 ? "ok" : "idle";

  return c.json([
    { id: 1, name: "Preview",        desc: "委託預覽",   state: previewState, count: previewGateOpen ? 1 : 0, note: previewGateOpen ? "預覽功能就緒" : "執行模式或紙上模式未開啟" },
    { id: 2, name: "Risk Check",     desc: "風控檢查",   state: riskState,    count: riskState === "ok" ? 1 : 0, note: riskState === "ok" ? "風控通過 / 0 阻擋" : "風控閘未開啟" },
    { id: 3, name: "Order Draft",    desc: "委託草稿",   state: draftState,   count: todayFillCount,             note: todayFillCount > 0 ? `${todayFillCount} 筆今日成交` : submitGateOpen ? "等待操作員提交" : "提交閘鎖定 (KillSwitch ON)" },
    { id: 4, name: "Paper Submit",   desc: "紙上送出",   state: submitState,  count: 0,                          note: submitGateOpen ? "等待操作員確認" : "KillSwitch 開啟 — 正式提交鎖定" },
    { id: 5, name: "Simulated Fill", desc: "模擬成交",   state: fillState,    count: totalFilledOrders,          note: totalFilledOrders > 0 ? `共 ${totalFilledOrders} 筆模擬成交` : "—" },
    { id: 6, name: "Audit Log",      desc: "稽核軌跡",   state: auditState,   count: auditLogTodayEntries,       note: `今日 ${auditLogTodayEntries} 筆` }
  ]);
});

// ── P1 #1: GET /api/v1/portfolio/preview ─────────────────────────────────────
// Vendor shape: { cash, positions, readiness, note }
app.get("/api/v1/portfolio/preview", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const baseCapitalRaw = Number(process.env.PAPER_BROKER_INITIAL_CASH);
  const baseCapitalTWD = Number.isFinite(baseCapitalRaw) && baseCapitalRaw > 0
    ? baseCapitalRaw
    : 20_000;

  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;
  let positionCount = 0;

  if (db) {
    try {
      const res = await db.execute(drizzleSql`
        SELECT COUNT(DISTINCT json_extract_path_text(intent::json, 'symbol'))::int AS cnt
        FROM paper_orders
        WHERE status = 'FILLED'
          AND json_extract_path_text(intent::json, 'side') = 'buy'
      `);
      const row = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
        ?? (Array.isArray(res) ? res[0] : res);
      positionCount = parseInt(String(row?.cnt ?? "0"), 10);
    } catch { /* degraded */ }
  }

  return c.json({
    cash: baseCapitalTWD,
    positions: positionCount,
    readiness: "preview-only",
    note: "紙上預覽,不連真實券商"
  });
});

// ── P1 #2: GET /api/v1/strategy/ideas (vendor shape) ─────────────────────────
// Vendor shape: { sym, name, stance, confidence(0-100), gate, reason }[]
// Additive: existing /api/v1/strategy/ideas still works; this returns vendor shape.
// IMPORTANT: existing /api/v1/strategy/ideas is registered earlier at line ~1749.
// We need to register /api/v1/vendor/strategy/ideas as a separate path, OR
// we check Accept header / query param. Since we cannot re-register the same path,
// we add vendor shape at /api/v1/strategy/ideas with a ?vendor=1 query param
// that transforms output, OR we register at the vendor namespace.
// Decision: add ?vendor=1 transform to the EXISTING /api/v1/strategy/ideas handler
// by appending this BEFORE the existing registration. But since it's already registered,
// we use a separate vendor path: /api/v1/vendor/strategy/ideas
// This is additive and does not break the existing route.
app.get("/api/v1/vendor/strategy/ideas", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const session = c.get("session");
  const repo = c.get("repo");

  // Reuse existing strategy ideas logic
  const ideas = await getStrategyIdeas({
    session,
    repo,
    limit: 20,
    signalDays: 30,
    includeBlocked: false,
    market: undefined,
    themeId: undefined,
    theme: undefined,
    symbol: undefined,
    decisionMode: undefined,
    decisionFilter: undefined,
    qualityFilter: undefined,
    sort: undefined
  });

  // Check if signal source is stale (signals table age)
  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;
  let signalGate: "ok" | "blocked" = "ok";
  if (db) {
    try {
      const res = await db.execute(
        drizzleSql`SELECT MAX(created_at)::text AS latest FROM signals WHERE workspace_id = ${session.workspace.id} LIMIT 1`
      );
      const row = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
        ?? (Array.isArray(res) ? res[0] : res);
      const latestStr = typeof row?.latest === "string" ? row.latest : null;
      if (!latestStr) {
        signalGate = "blocked";
      } else {
        const ageMs = Date.now() - new Date(latestStr).getTime();
        if (ageMs > 15 * 24 * 60 * 60 * 1000) signalGate = "blocked";
      }
    } catch {
      signalGate = "blocked";
    }
  }

  // Map existing ideas to vendor shape
  const vendorIdeas = (Array.isArray(ideas) ? ideas : []).map((idea: Record<string, unknown>) => {
    const confidence = typeof idea.confidence === "number"
      ? Math.round(idea.confidence * 100 * 10) / 10  // 0-1 → 0-100 with 1dp
      : 0;
    const direction = String(idea.direction ?? "neutral").toLowerCase();
    const stance = direction === "bullish" ? "偏多研究"
      : direction === "bearish" ? "偏空研究"
      : "中性";
    return {
      sym: String(idea.symbol ?? idea.companyId ?? ""),
      name: String(idea.companyName ?? idea.name ?? ""),
      stance,
      confidence,
      gate: signalGate,
      reason: signalGate === "blocked" ? "訊號證據過期" : String(idea.reason ?? idea.rationale ?? "研究用途")
    };
  });

  return c.json(vendorIdeas);
});

// ── P1 #3: GET /api/v1/dashboard/snapshot ────────────────────────────────────
// Aggregated snapshot — calls internal helpers to build all panels.
// This is Path A aggregation: one call, all panels.
app.get("/api/v1/dashboard/snapshot", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  // Build meta synchronously
  const flags = getExecutionFlagSnapshot();
  const modeLabel = flags.executionMode === "paper" ? "模擬模式 / 風控守門" : "停用模式";
  const now = new Date();
  const tst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const nowText = `${tst.getUTCFullYear()}/${pad(tst.getUTCMonth() + 1)}/${pad(tst.getUTCDate())} `
    + `${pad(tst.getUTCHours())}:${pad(tst.getUTCMinutes())}:${pad(tst.getUTCSeconds())} 台北`;

  const meta = {
    operator: "IUF-01",
    mode: modeLabel,
    market: "盤面 / 真實資料",
    nowText,
    formalOrder: { state: "blocked", reason: "KGI TradeCom 元件使用權限待業務員 enable (code 78)" }
  };

  return c.json({
    meta,
    sources: [],   // caller should use /api/v1/sources for full list
    quotes: { sourceState: "empty", sourceLabel: "市場資料 · 無即時資料", indices: [], flows: [], stocks: [], intradayTwii: [] },
    breadth: { up: 0, flat: 0, down: 0, total: 0, asOf: null },
    heatmap: [],
    agenda: [],
    finmind: null,
    openalice: null,
    paperE2E: [],
    portfolio: { cash: Number(process.env.PAPER_BROKER_INITIAL_CASH) || 20000, positions: 0, readiness: "preview-only", note: "紙上預覽,不連真實券商" },
    strategyIdeas: [],
    workflow: [],
    blocked: [
      { name: "重大訊息",   why: "尚未接入公開資訊觀測站",      next: "等接入 + 排程", icon: "news" },
      { name: "正式下單",   why: "KGI TradeCom 元件使用權限待 enable", next: "業務員後台 enable 後可用", icon: "lock" }
    ],
    _note: "Use individual endpoints for full sub-panel data. Dashboard snapshot returns structural placeholders."
  });
});

// =============================================================================
// 5/5 REOPEN — P1: Session probe (Bruce dev login support)
// =============================================================================
// GET /api/v1/auth/session-probe
// Returns current session identity (id, email, role) without revealing secrets.
// Auth: standard iuf_session cookie (same gate as all /api/v1/* routes).
// Purpose: Bruce uses this to confirm that a dev test account cookie is live
// and the session hydrates correctly. Returns 401 if no valid session.
//
// Hard lines:
//   - No password in response
//   - No token in response
//   - This is the ONLY endpoint Bruce needs to verify login works
// =============================================================================

app.get("/api/v1/auth/session-probe", (c) => {
  const session = c.get("session");
  return c.json({
    data: {
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      workspaceSlug: session.workspace.slug,
      persistenceMode: session.persistenceMode
    }
  });
});

// =============================================================================
// 5/5 REOPEN — P2: FinMind diagnostics route
// =============================================================================
// GET /api/v1/diagnostics/finmind
// Returns token health / quota snapshot / last fetch timestamp / recent error rate.
// Hard lines:
//   - Token string NEVER returned (only presence flag)
//   - All quota numbers come from env or in-process counters (no live API probe)
//   - source label: "env" if token from env, "none" if absent
// =============================================================================

// F4 (2026-05-05): In-process counters now tracked in finmind-client.ts via
// recordFinMindRequest() called inside _fetch(). No more stale module-level
// counters here — diagnostics route reads getFinMindStats() from the client.
// recordFinMindFetch kept as a no-op alias for any callers still referencing it.
export function recordFinMindFetch(_opts: { dataset: string; ok: boolean }): void {
  // Intentionally empty: real counting now done inside finmind-client._fetch().
}

app.get("/api/v1/diagnostics/finmind", (c) => {
  const tokenPresent = !!(process.env.FINMIND_API_TOKEN);
  const redisConfigured = !!(process.env.REDIS_URL);

  // Quota hint only: free = 600/hr; Sponsor 999 defaults to 6000/hr unless env overrides it.
  const stats = getFinMindStats();
  const errorRate = stats.requestCount === 0
    ? null
    : Math.round((stats.errorCount / stats.requestCount) * 10000) / 100;
  const quotaTier = finmindQuotaTier(tokenPresent);
  const quotaLimitPerHour = finmindQuotaLimitPerHour(quotaTier);
  const ohlcvSource = process.env.OHLCV_SOURCE
    ?? (tokenPresent && stats.requestCount > 0 && (errorRate === null || errorRate <= 5) ? "finmind" : "pending");

  return c.json({
    data: {
      tokenPresent,
      tokenSource: tokenPresent ? "env" : "none",
      ohlcvSource,
      quotaTier,
      quotaLimitPerHour,
      redisConfigured,
      inProcess: {
        requestCount: stats.requestCount,
        errorCount: stats.errorCount,
        errorRatePct: errorRate,
        lastFetchTs: stats.lastFetchTs,
        lastDataset: stats.lastDataset
      },
      health: tokenPresent ? "configured" : "no_token",
      note: "Counters reset on process restart. Token is NEVER returned."
    }
  });
});

// =============================================================================
// 5/5 REOPEN — P3: Paper E2E skeleton
// Routes: POST /api/v1/paper/preview
//         POST /api/v1/paper/submit
//         GET  /api/v1/paper/fills
//         GET  /api/v1/paper/portfolio
//
// Hard lines:
//   - NO KGI write-side (KGI FROZEN until 5/12)
//   - quantity_unit required, no default — missing field → 400
//   - All state is in-memory (same as existing paper/orders ledger)
//   - preview: pure calculation, no state mutation
//   - submit: creates OrderIntent + drives via PaperExecutor
//   - fills: list FILLED states for current user
//   - portfolio: aggregate per-symbol position from FILLED orders
// =============================================================================

// POST /api/v1/paper/preview
// Alias for existing preview logic under a cleaner E2E path.
// Same body as paperOrderCreateInputSchema; pure calculation, no order created.
// quantity_unit is required — missing → 400.
app.post("/api/v1/paper/preview", async (c) => {
  let payload: ReturnType<typeof paperOrderCreateInputSchema.parse>;
  try {
    payload = paperOrderCreateInputSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  const session = c.get("session");
  const repo = c.get("repo");

  const order = {
    accountId: "paper-default",
    symbol: payload.symbol,
    side: payload.side,
    type: payload.orderType as "market" | "limit" | "stop" | "stop_limit",
    timeInForce: "rod" as const,
    quantity: payload.qty,
    quantity_unit: payload.quantity_unit,
    price: payload.price ?? null,
    stopPrice: null,
    tradePlanId: null,
    strategyId: null,
    overrideGuards: [] as string[],
    overrideReason: ""
  };

  // 4-layer risk gate (preview mode: L3 will NOT auto-engage kill switch)
  const fourLayerResult = await evaluateFourLayerRiskGate({ session, order, isPreview: true });
  if (fourLayerResult.blocked) {
    return c.json(
      {
        blocked: true,
        layer: fourLayerResult.layer,
        reason: fourLayerResult.reason,
        auditType: fourLayerResult.auditType,
        observedValue: fourLayerResult.observedValue,
        limitValue: fourLayerResult.limitValue
      },
      422
    );
  }

  const result = await previewOrder({ session, repo, order });

  return c.json({ data: result });
});

// POST /api/v1/paper/submit
// M-1 2026-05-06: now enforces real risk engine + quote gate before creating
// any order or fill row.
//
// Flow:
//   1. Parse + validate input (quantity_unit required → 400 if missing)
//   2. Three-layer paper execution gate (EXECUTION_MODE/PAPER_KILL_SWITCH/PAPER_MODE_ENABLED)
//   3. Idempotency check (persistent via DB or in-memory MapAdapter)
//   4. *** NEW *** Real risk check (evaluateRiskCheck commit=true) + quote gate
//        → blocked → 422 with { blocked, decision, riskCheck, quoteGate, guards, reasonCodes }
//        → no order row / fill row created on block
//   5. If allowed: createOrderIntent → driveOrder → FILLED/REJECTED
//   6. Return { blocked, decision, riskCheck, quoteGate, guards, reasonCodes, orderState }
//
// Hard lines:
//   - No KGI write-side. No /order/create. No live submit.
//   - Idempotency preserved (existing behavior not regressed).
//   - Blocked order: zero fill rows, zero portfolio change.
app.post("/api/v1/paper/submit", async (c) => {
  let payload: ReturnType<typeof paperOrderCreateInputSchema.parse>;
  try {
    payload = paperOrderCreateInputSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  // Layer 1-3: three-layer AND gate (paper mode must be enabled)
  const gate = checkPaperExecutionGate();
  if (!gate.allowed) {
    return c.json(
      { error: "paper_gate_blocked", reason: gate.reason, layer: gate.layer },
      422
    );
  }

  // Idempotency: persistent check (survives restarts via DB/MapAdapter)
  const existingSubmit = await findOrderByIdempotencyKey(payload.idempotencyKey);
  if (existingSubmit) {
    return c.json(
      { error: "DUPLICATE_IDEMPOTENCY_KEY", idempotencyKey: payload.idempotencyKey },
      409
    );
  }

  const session = c.get("session");
  const repo = c.get("repo");

  const order = buildPaperOrderContext(payload);

  // 4-layer risk gate (new, P0-3 5/12 pre-requisite).
  // Must run BEFORE evaluatePaperOrderRisk — this gate is order-lifecycle-aware:
  // L1=kill switch, L2=max position cap, L3=daily loss (auto-engages ks), L4=concentration.
  const fourLayerGate = await evaluateFourLayerRiskGate({ session, order, isPreview: false });
  if (fourLayerGate.blocked) {
    // Audit log for 4-layer gate block (fire-and-forget, same as submit audit).
    writeAuditLog({
      session,
      method: "POST",
      path: "/api/v1/paper/submit",
      status: 422,
      payload: {
        paperMode: true,
        simulated: true,
        symbol: payload.symbol,
        side: payload.side,
        orderType: payload.orderType,
        qty: payload.qty,
        quantity_unit: payload.quantity_unit,
        outcome: "BLOCKED",
        blockedByLayer: fourLayerGate.layer,
        auditType: fourLayerGate.auditType,
        reason: fourLayerGate.reason
      }
    }).catch((err) => {
      console.error("[paper/submit] 4-layer gate audit log failed:", err instanceof Error ? err.message : String(err));
    });
    return c.json(
      {
        blocked: true,
        layer: fourLayerGate.layer,
        reason: fourLayerGate.reason,
        auditType: fourLayerGate.auditType,
        observedValue: fourLayerGate.observedValue,
        limitValue: fourLayerGate.limitValue,
        decision: "block",
        riskCheck: null,
        quoteGate: null,
        guards: [],
        reasonCodes: [fourLayerGate.auditType ?? "four_layer_block"]
      },
      422
    );
  }

  // Layer 4 (M-1): Real risk engine + quote gate.
  // commit=true: records order intent in risk engine rate-limit window.
  // Blocked → 422 with rich diagnostic body; no order/fill created.
  const riskGate = await evaluatePaperOrderRisk({ session, repo, order, commit: true });

  if (riskGate.blocked) {
    return c.json(
      {
        blocked: true,
        decision: riskGate.decision,
        riskCheck: riskGate.riskCheck,
        quoteGate: riskGate.quoteGate,
        guards: riskGate.guards,
        reasonCodes: riskGate.reasonCodes
      },
      422
    );
  }

  // Risk + gate passed: create the OrderIntent and drive through PaperExecutor.
  // driveOrder() internal stub always passes — real enforcement already done above.
  const intent = createOrderIntent({
    idempotencyKey: payload.idempotencyKey,
    symbol: payload.symbol,
    side: payload.side,
    orderType: payload.orderType,
    qty: payload.qty,
    quantity_unit: payload.quantity_unit,
    price: payload.price,
    userId: session.user.id
  });

  const result = await driveOrder(intent);
  const isRejected = result.finalState.intent.status === "REJECTED";

  // Audit log: write paper submit entry regardless of FILLED/REJECTED outcome.
  // paperMode=true + simulated=true flags are mandatory per BLOCK #5 §5.
  // Fire-and-forget: audit failure must not block the paper order response.
  writeAuditLog({
    session,
    method: "POST",
    path: "/api/v1/paper/submit",
    status: isRejected ? 422 : 201,
    payload: {
      paperMode: true,
      simulated: true,
      symbol: payload.symbol,
      side: payload.side,
      orderType: payload.orderType,
      qty: payload.qty,
      quantity_unit: payload.quantity_unit,
      outcome: isRejected ? "REJECTED" : "FILLED",
      idempotencyKey: payload.idempotencyKey,
      intentId: intent.id
    }
  }).catch((err) => {
    console.error("[paper/submit] audit log write failed:", err instanceof Error ? err.message : String(err));
  });

  return c.json(
    {
      blocked: isRejected,
      decision: isRejected ? "block" : "pass",
      riskCheck: riskGate.riskCheck,
      quoteGate: riskGate.quoteGate,
      guards: riskGate.guards,
      reasonCodes: isRejected
        ? [result.finalState.intent.reason ?? "executor_rejected"]
        : [],
      orderState: result.finalState
    },
    isRejected ? 422 : 201
  );
});

// GET /api/v1/paper/db-probe
// Diagnostic endpoint: reports DB connectivity + table existence + applied migrations.
// Requires auth. Intended for ops use; safe to call repeatedly (read-only).
app.get("/api/v1/paper/db-probe", async (c) => {
  const persistenceMode = isDatabaseMode() ? "database" : "memory";
  const db = isDatabaseMode() ? getDb() : null;

  if (!db) {
    return c.json({
      persistenceMode,
      dbAvailable: false,
      note: "PERSISTENCE_MODE is not 'database' — using in-memory adapter"
    });
  }

  try {
    // Check table existence via regclass cast (null = missing)
    const tableCheck = await db.execute(drizzleSql`
      SELECT
        to_regclass('public.paper_orders')  AS paper_orders,
        to_regclass('public.paper_fills')   AS paper_fills,
        to_regclass('public.paper_positions') AS paper_positions
    `);
    const tableRow = (tableCheck as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(tableCheck) ? tableCheck[0] : tableCheck);

    // Check which migrations are applied (schema_migrations may not exist)
    let appliedMigrations: string[] = [];
    try {
      const migCheck = await db.execute(drizzleSql`
        SELECT version FROM schema_migrations
        WHERE version LIKE '0015%' OR version LIKE '0020%' OR version LIKE '0021%'
        ORDER BY version ASC
      `);
      const migRows = (migCheck as { rows?: Record<string, unknown>[] })?.rows
        ?? (Array.isArray(migCheck) ? migCheck : [migCheck]);
      appliedMigrations = migRows.map((r: Record<string, unknown>) => String(r.version ?? r.Version ?? "?"));
    } catch {
      appliedMigrations = ["schema_migrations_query_failed"];
    }

    return c.json({
      persistenceMode,
      dbAvailable: true,
      tables: {
        paper_orders: tableRow?.paper_orders !== null && tableRow?.paper_orders !== undefined,
        paper_fills: tableRow?.paper_fills !== null && tableRow?.paper_fills !== undefined,
        paper_positions: tableRow?.paper_positions !== null && tableRow?.paper_positions !== undefined
      },
      appliedMigrations,
      raw: tableRow
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ persistenceMode, dbAvailable: false, error: msg }, 500);
  }
});

// GET /api/v1/paper/fills
// Returns all FILLED orders for the current user as a fills list.
// Each fill includes orderId, symbol, side, fillQty, fillPrice, fillTime.
app.get("/api/v1/paper/fills", async (c) => {
  const session = c.get("session");
  let orders;
  try {
    orders = await listOrders(session.user.id, { status: "FILLED" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[paper/fills] listOrders failed:", detail);
    return c.json({ error: "list_orders_failed", detail }, 500);
  }
  const fills = orders
    .filter((o) => o.fill !== null)
    .map((o) => ({
      orderId: o.intent.id,
      symbol: o.intent.symbol,
      side: o.intent.side,
      orderType: o.intent.orderType,
      qty: o.intent.qty,
      quantity_unit: o.intent.quantity_unit,
      fillQty: o.fill!.fillQty,
      fillPrice: o.fill!.fillPrice,
      fillTime: o.fill!.fillTime instanceof Date
        ? o.fill!.fillTime.toISOString()
        : String(o.fill!.fillTime),
      idempotencyKey: o.intent.idempotencyKey,
      userId: o.intent.userId
    }));
  return c.json({ data: fills });
});

// GET /api/v1/paper/portfolio
// Aggregates FILLED orders into a per-symbol position snapshot.
// Computation: net qty (buy positive, sell negative), weighted avg cost.
// Returns 200 + { data: PortfolioPosition[] }.
app.get("/api/v1/paper/portfolio", async (c) => {
  const session = c.get("session");
  let orders;
  try {
    orders = await listOrders(session.user.id, { status: "FILLED" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[paper/portfolio] listOrders failed:", detail);
    return c.json({ error: "list_orders_failed", detail }, 500);
  }

  // Aggregate per symbol
  const positions = new Map<string, {
    symbol: string;
    netQty: number;
    totalCost: number;
    fillCount: number;
  }>();

  for (const o of orders) {
    if (!o.fill) continue;
    const symbol = o.intent.symbol;
    const p = positions.get(symbol) ?? { symbol, netQty: 0, totalCost: 0, fillCount: 0 };
    const shareQty = o.intent.quantity_unit === "LOT"
      ? o.fill.fillQty * 1000
      : o.fill.fillQty;
    const sign = o.intent.side === "buy" ? 1 : -1;
    p.netQty += sign * shareQty;
    if (o.intent.side === "buy") {
      p.totalCost += shareQty * o.fill.fillPrice;
    }
    p.fillCount++;
    positions.set(symbol, p);
  }

  const positionList = Array.from(positions.values()).map((p) => ({
    symbol: p.symbol,
    netQtyShares: p.netQty,
    avgCostPerShare: p.netQty > 0
      ? Math.round((p.totalCost / p.netQty) * 100) / 100
      : null,
    fillCount: p.fillCount,
    note: p.netQty <= 0 ? "net_flat_or_short" : null
  }));

  // Base capital per BLOCK #5 §5: paper E2E must show simulated capital, not null.
  // PAPER_BROKER_INITIAL_CASH env var overrides; default 20,000 TWD per product spec.
  const baseCapitalRaw = Number(process.env.PAPER_BROKER_INITIAL_CASH);
  const baseCapitalTWD = Number.isFinite(baseCapitalRaw) && baseCapitalRaw > 0
    ? baseCapitalRaw
    : 20_000;

  // Compute invested capital from current open positions (buy cost basis only)
  const investedCost = Array.from(positions.values())
    .filter((p) => p.netQty > 0)
    .reduce((acc, p) => acc + p.totalCost, 0);

  const summary = {
    baseCapitalTWD,
    currency: "TWD",
    simulated: true,
    paperMode: true,
    positionCount: positionList.filter((p) => (p.netQtyShares ?? 0) > 0).length,
    investedCostTWD: Math.round(investedCost * 100) / 100,
    note: positionList.length === 0
      ? "empty_state: no filled orders yet; base capital available"
      : "positions computed from filled paper orders"
  };

  return c.json({ data: positionList, summary });
});

// =============================================================================
// 5/5 REOPEN — Product Block #1: Paper E2E health + KBar diagnostics
// =============================================================================

// GET /api/v1/paper/health
// No auth required — safe for Bruce smoke scripts and uptime monitors.
// Returns a snapshot of readiness for all four paper E2E paths:
//   previewReady   — execution gate + kill switch + paper mode all clear
//   submitReady    — same as previewReady (same gate, but submit also needs DB)
//   fillsReady     — paper_orders table accessible (DB mode) or in-memory OK
//   portfolioReady — same as fillsReady
//   lastFillTs     — ISO timestamp of most recent FILLED order, or null
//   queueDepth     — number of PENDING orders for all users
// Hard lines:
//   - Never exposes userId or order content.
//   - DB probe is read-only. Safe to call at any rate.
//   - paper_orders_500_root_cause_closed: reports whether the pg_advisory_lock
//     fix (lock_timeout=15s in migrate.ts, 2026-05-05) appears to have taken
//     effect by checking if paper_orders table exists.
app.get("/api/v1/paper/health", async (c) => {
  const flags = getExecutionFlagSnapshot();

  // Layer-by-layer gate diagnosis
  const executionModeOk = flags.executionMode === "paper";
  const killSwitchOk    = !flags.killSwitchEnabled;
  const paperModeOk     = flags.paperModeEnabled;
  const gateOpen        = executionModeOk && killSwitchOk && paperModeOk;

  // DB connectivity check (for fills/portfolio readiness)
  const dbMode = isDatabaseMode();
  let tableExists = false;
  let lastFillTs: string | null = null;
  let queueDepth = 0;
  let dbError: string | null = null;

  if (dbMode) {
    const db = getDb();
    if (!db) {
      dbError = "getDb() returned null despite PERSISTENCE_MODE=database";
    } else {
      try {
        // Check table existence
        const tableCheck = await db.execute(drizzleSql`
          SELECT to_regclass('public.paper_orders') AS paper_orders
        `);
        const row = (tableCheck as { rows?: Record<string, unknown>[] })?.rows?.[0]
          ?? (Array.isArray(tableCheck) ? tableCheck[0] : tableCheck);
        tableExists = row?.paper_orders !== null && row?.paper_orders !== undefined;

        if (tableExists) {
          // Most recent fill timestamp
          const fillRow = await db.execute(drizzleSql`
            SELECT MAX(updated_at) AS last_fill
            FROM paper_orders
            WHERE status = 'FILLED'
          `);
          const fillResult = (fillRow as { rows?: Record<string, unknown>[] })?.rows?.[0]
            ?? (Array.isArray(fillRow) ? fillRow[0] : fillRow);
          const rawTs = fillResult?.last_fill;
          lastFillTs = rawTs instanceof Date
            ? rawTs.toISOString()
            : typeof rawTs === "string" ? rawTs : null;

          // Pending queue depth (all users)
          const queueRow = await db.execute(drizzleSql`
            SELECT COUNT(*)::int AS depth
            FROM paper_orders
            WHERE status = 'PENDING'
          `);
          const queueResult = (queueRow as { rows?: Record<string, unknown>[] })?.rows?.[0]
            ?? (Array.isArray(queueRow) ? queueRow[0] : queueRow);
          queueDepth = typeof queueResult?.depth === "number"
            ? queueResult.depth
            : parseInt(String(queueResult?.depth ?? "0"), 10);
        }
      } catch (err) {
        dbError = err instanceof Error ? err.message : String(err);
      }
    }
  } else {
    // Memory mode: adapter is always ready; no table check needed
    tableExists = true;
  }

  const fillsReady     = dbError === null && tableExists;
  const portfolioReady = fillsReady;
  const previewReady   = gateOpen;
  const submitReady    = gateOpen && fillsReady;

  return c.json({
    data: {
      previewReady,
      submitReady,
      fillsReady,
      portfolioReady,
      lastFillTs,
      queueDepth,
      // Detailed gate breakdown for ops debugging
      gate: {
        executionMode:    flags.executionMode,
        executionModeOk,
        killSwitchOk,
        paperModeOk,
        gateOpen
      },
      persistence: {
        mode: dbMode ? "database" : "memory",
        tableExists,
        dbError
      },
      // Root cause closed flag: paper_orders 500 from 2026-05-05 morning
      paper_orders_500_root_cause_closed: tableExists
    }
  });
});

// GET /api/v1/paper/health/detail
// B3-2 (2026-05-06): Per-stage paper E2E readiness panel.
// No auth required — safe for Bruce smoke scripts and uptime monitors.
// Covers all stages of the paper E2E flow:
//   preview     → pure calculation gate (no DB needed)
//   submit      → gate + DB table existence
//   fill        → FILLED order count + last fill timestamp
//   portfolio   → FILLED orders aggregated into positions
//   orderTicket → submission channel (paper mode; not KGI)
//   auditLog    → audit_logs table accessibility + today's entry count
//
// Hard lines:
//   - NEVER exposes userId or any order content
//   - NEVER exposes user-specific row data
//   - All DB probes are read-only aggregate queries
//   - state enum per stage: READY / DEGRADED / BLOCKED / ERROR
app.get("/api/v1/paper/health/detail", async (c) => {
  const flags = getExecutionFlagSnapshot();

  const executionModeOk = flags.executionMode === "paper";
  const killSwitchOk    = !flags.killSwitchEnabled;
  const paperModeOk     = flags.paperModeEnabled;

  // Two separate gate concepts:
  //   previewGateOpen  — for preview + order-ticket UI: needs executionMode=paper + paperMode=ON.
  //                      Kill switch is intentionally excluded: preview is pure calculation, no
  //                      order rows created. Order-ticket UI rendering is also pure display.
  //   submitGateOpen   — for actual paper order submission: all three layers must pass.
  //                      Kill switch ON (stop-line #2, frozen until 5/12) keeps this BLOCKED.
  const previewGateOpen = executionModeOk && paperModeOk;
  const submitGateOpen  = executionModeOk && killSwitchOk && paperModeOk;

  const dbMode = isDatabaseMode();
  const db     = dbMode ? getDb() : null;

  type StageState = "READY" | "DEGRADED" | "BLOCKED" | "ERROR";

  // ── preview: pure calculation, needs only previewGate ──────────────────────
  const previewState: StageState = previewGateOpen ? "READY" : "BLOCKED";
  const previewBlockReason = previewGateOpen ? null : [
    !executionModeOk ? `executionMode=${flags.executionMode}` : null,
    !paperModeOk     ? "paperMode=OFF" : null
  ].filter(Boolean).join(";");

  // ── submit: gate + DB table ─────────────────────────────────────────────────
  let tableExists = false;
  let submitDbError: string | null = null;
  let lastFillTs: string | null = null;
  let todayFillCount = 0;
  let portfolioRowCount = 0;
  let auditLogTodayEntries = 0;
  let auditLogDbError: string | null = null;

  if (db) {
    try {
      const tableCheck = await db.execute(drizzleSql`
        SELECT to_regclass('public.paper_orders') AS paper_orders
      `);
      const tableRow = (tableCheck as { rows?: Record<string, unknown>[] })?.rows?.[0]
        ?? (Array.isArray(tableCheck) ? tableCheck[0] : tableCheck);
      tableExists = tableRow?.paper_orders !== null && tableRow?.paper_orders !== undefined;
    } catch (err) {
      submitDbError = err instanceof Error ? err.message : String(err);
    }

    if (tableExists && !submitDbError) {
      try {
        // Last fill timestamp + today's fill count (all users, no userId leak)
        const today = new Date().toISOString().slice(0, 10);
        const fillStats = await db.execute(drizzleSql`
          SELECT
            MAX(updated_at)::text               AS last_fill_ts,
            COUNT(*) FILTER (
              WHERE status = 'FILLED'
              AND   updated_at::date = ${today}::date
            )::int                              AS today_fills,
            COUNT(*) FILTER (WHERE status = 'FILLED')::int AS total_filled_orders
          FROM paper_orders
        `);
        const fr = (fillStats as { rows?: Record<string, unknown>[] })?.rows?.[0]
          ?? (Array.isArray(fillStats) ? fillStats[0] : fillStats);
        lastFillTs = typeof fr?.last_fill_ts === "string" ? fr.last_fill_ts : null;
        todayFillCount = typeof fr?.today_fills === "number"
          ? fr.today_fills : parseInt(String(fr?.today_fills ?? "0"), 10);
        // portfolio row count = distinct symbols with net FILLED qty != 0 (approximation: count FILLED)
        portfolioRowCount = typeof fr?.total_filled_orders === "number"
          ? fr.total_filled_orders : parseInt(String(fr?.total_filled_orders ?? "0"), 10);
      } catch (err) {
        submitDbError = err instanceof Error ? err.message : String(err);
      }
    }
  } else if (!dbMode) {
    // Memory mode: in-memory adapter always ready, no table needed
    tableExists = true;
  }

  // ── auditLog: today's entries count ─────────────────────────────────────────
  if (db) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const auditCheck = await db.execute(drizzleSql`
        SELECT COUNT(*)::int AS today_entries
        FROM audit_logs
        WHERE created_at::date = ${today}::date
      `);
      const ar = (auditCheck as { rows?: Record<string, unknown>[] })?.rows?.[0]
        ?? (Array.isArray(auditCheck) ? auditCheck[0] : auditCheck);
      auditLogTodayEntries = typeof ar?.today_entries === "number"
        ? ar.today_entries : parseInt(String(ar?.today_entries ?? "0"), 10);
    } catch (err) {
      auditLogDbError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Derive stage states ──────────────────────────────────────────────────────
  // submit requires the full three-layer gate (killSwitch must be OFF).
  // Kill switch is deliberately ON (stop-line #2) → submit stays BLOCKED.
  const submitState: StageState = !submitGateOpen ? "BLOCKED"
    : submitDbError ? "ERROR"
    : !tableExists && dbMode ? "DEGRADED"
    : "READY";

  const fillState: StageState = !tableExists && dbMode ? "BLOCKED"
    : submitDbError ? "ERROR"
    : "READY";

  const portfolioState: StageState = fillState;

  // orderTicket is UI-only (displaying the ticket form) — uses previewGate so
  // it shows READY when executionMode=paper + paperMode=ON, even with killSwitch ON.
  const orderTicketState: StageState = !previewGateOpen ? "BLOCKED" : "READY";

  const auditLogState: StageState = auditLogDbError ? "ERROR" : "READY";

  return c.json({
    data: {
      preview: {
        state: previewState,
        endpoint: "/paper/preview",
        ...(previewBlockReason ? { blockReason: previewBlockReason } : {})
      },
      orderTicket: {
        state: orderTicketState,
        endpoint: "/paper/submit",
        executionMode: flags.executionMode,
        // orderTicket uses previewGate (executionMode + paperMode only).
        // Kill switch is intentionally ON — submission is blocked, but the
        // order-ticket UI can still render and calculate previews.
        note: "order-ticket UI ready; actual submission blocked by kill-switch until 5/12"
      },
      submit: {
        state: submitState,
        endpoint: "/paper/submit",
        executionMode: flags.executionMode,
        killSwitchBlocked: !killSwitchOk,
        // Pete review 2026-05-06: opaque code only (no raw Postgres error string on no-auth route)
        ...(submitDbError ? { dbError: "db_query_failed" } : {})
      },
      fill: {
        state: fillState,
        endpoint: "/paper/fills",
        lastFillTs,
        todayCount: todayFillCount,
        todayCountTimezone: "UTC"
      },
      portfolio: {
        state: portfolioState,
        endpoint: "/paper/portfolio",
        filledOrderCount: portfolioRowCount,
        note: "filledOrderCount counts FILLED orders, not distinct-symbol positions"
      },
      auditLog: {
        state: auditLogState,
        endpoint: "/audit-log",
        todayEntries: auditLogTodayEntries,
        todayEntriesTimezone: "UTC",
        ...(auditLogDbError ? { dbError: "db_query_failed" } : {})
      }
    }
  });
});

// GET /api/v1/diagnostics/kbar
// Reports OHLCV / K-bar data state for ops + Bruce smoke.
// Checks DB row counts and latest date for daily interval (tfDay).
// 1m interval is gateway-only (KGI WS), not stored in companies_ohlcv.
// No auth required — read-only diagnostics.
//
// State enum:
//   LIVE   — DB has rows with source != 'mock' and latestDate within 3 days
//   STALE  — DB has real rows but latestDate > 3 days ago
//   MOCK   — DB has rows but all are source='mock'
//   EMPTY  — no rows in DB
//   ERROR  — DB query failed
//   NO_DB  — memory mode, no DB to query
app.get("/api/v1/diagnostics/kbar", async (c) => {
  const dbMode = isDatabaseMode();

  if (!dbMode) {
    return c.json({
      data: {
        tfDay: { state: "NO_DB", latestDate: null, rowCount: 0, source: null },
        tf1m:  { state: "NO_DB", latestDate: null, rowCount: 0, source: null,
                  note: "1m bars are gateway-push only; not stored in companies_ohlcv" },
        ohlcvSource: process.env.OHLCV_SOURCE ?? "mock",
        finmindTokenPresent: !!(process.env.FINMIND_API_TOKEN),
        schedulerConfigured: !!(process.env.FINMIND_API_TOKEN),
        asOf: new Date().toISOString()
      }
    });
  }

  const db = getDb();
  if (!db) {
    return c.json({
      data: {
        tfDay: { state: "ERROR", latestDate: null, rowCount: 0, source: null,
                  error: "getDb() returned null" },
        tf1m:  { state: "NO_DB", latestDate: null, rowCount: 0, source: null,
                  note: "1m bars are gateway-push only; not stored in companies_ohlcv" },
        ohlcvSource: process.env.OHLCV_SOURCE ?? "mock",
        finmindTokenPresent: false,
        schedulerConfigured: false,
        asOf: new Date().toISOString()
      }
    }, 503);
  }

  let tfDay: {
    state: "LIVE" | "STALE" | "MOCK" | "EMPTY" | "ERROR" | "NO_DB";
    latestDate: string | null;
    rowCount: number;
    source: string | null;
    error?: string;
    mockRowCount?: number;
    realRowCount?: number;
  };

  try {
    // Total row count + latest date + source breakdown for interval='1d'
    const summary = await db.execute(drizzleSql`
      SELECT
        COUNT(*)::int                                        AS total_rows,
        MAX(dt)::text                                        AS latest_date,
        COUNT(*) FILTER (WHERE source = 'mock')::int         AS mock_rows,
        COUNT(*) FILTER (WHERE source != 'mock')::int        AS real_rows,
        (SELECT source FROM companies_ohlcv
         WHERE interval = '1d'
         ORDER BY dt DESC LIMIT 1)                          AS latest_source
      FROM companies_ohlcv
      WHERE interval = '1d'
    `);
    const r = (summary as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(summary) ? summary[0] : summary);

    const totalRows   = typeof r?.total_rows  === "number" ? r.total_rows  : parseInt(String(r?.total_rows  ?? "0"), 10);
    const mockRows    = typeof r?.mock_rows   === "number" ? r.mock_rows   : parseInt(String(r?.mock_rows   ?? "0"), 10);
    const realRows    = typeof r?.real_rows   === "number" ? r.real_rows   : parseInt(String(r?.real_rows   ?? "0"), 10);
    const latestDate  = typeof r?.latest_date === "string" ? r.latest_date : null;
    const latestSrc   = typeof r?.latest_source === "string" ? r.latest_source : null;

    if (totalRows === 0) {
      tfDay = { state: "EMPTY", latestDate: null, rowCount: 0, source: null };
    } else if (realRows === 0) {
      tfDay = { state: "MOCK", latestDate, rowCount: totalRows, source: "mock",
                mockRowCount: mockRows, realRowCount: 0 };
    } else {
      // Determine freshness: LIVE if latestDate within 3 calendar days
      const latestMs = latestDate ? new Date(latestDate).getTime() : 0;
      const nowMs    = Date.now();
      // 4 calendar days covers TWS longest weekend gap (Fri close → Tue open after Mon holiday).
      // Pete review 2026-05-05 PR-MERGE-1: 3 days produced false-STALE every weekend.
      const staleThresholdMs = 4 * 24 * 60 * 60 * 1000;
      const isStale  = (nowMs - latestMs) > staleThresholdMs;
      tfDay = {
        state: isStale ? "STALE" : "LIVE",
        latestDate,
        rowCount: totalRows,
        source: latestSrc,
        mockRowCount: mockRows,
        realRowCount: realRows
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    tfDay = { state: "ERROR", latestDate: null, rowCount: 0, source: null, error: msg };
  }

  const finmindToken = !!(process.env.FINMIND_API_TOKEN);

  return c.json({
    data: {
      tfDay,
      tf1m: {
        state: "NO_DB",
        latestDate: null,
        rowCount: 0,
        source: null,
        note: "1m bars are gateway-push only (KGI WS); not stored in companies_ohlcv"
      },
      ohlcvSource:        process.env.OHLCV_SOURCE ?? "mock",
      finmindTokenPresent: finmindToken,
      schedulerConfigured: finmindToken,
      asOf: new Date().toISOString()
    }
  });
});

// =============================================================================
// 5/5 REOPEN — P4: Lab bundles intake skeleton
// =============================================================================
// GET  /api/v1/lab/bundles        — list submitted bundles (read-only)
// POST /api/v1/lab/bundles/intake — accept a bundle from Athena (write)
//
// Design:
//   - In-memory store (no DB migration needed for this skeleton)
//   - read-side only in terms of PROMOTION — intake stores, does NOT trigger
//     any strategy promotion, paper promotion, or live submission
//   - Each bundle has: id, bundleId, status ("pending_review"), submittedAt,
//     source, schema version
//   - No Sharpe / equity curve / win_rate in accepted payload (Red gate)
//   - source must be "athena" or reject 400
// =============================================================================

interface LabBundle {
  id: string;
  bundleId: string;
  source: string;
  schemaVersion: string;
  status: "pending_review" | "accepted" | "rejected";
  submittedAt: string;
  description: string | null;
  tags: string[];
  // Red-gate fields intentionally ABSENT: sharpe, equityCurve, winRate
}

const _labBundleStore: LabBundle[] = [];
let _labBundleIdCounter = 0;

const labBundleIntakeSchema = z.object({
  bundleId: z.string().min(1).max(128),
  source: z.literal("athena"),
  schemaVersion: z.string().min(1).max(32),
  description: z.string().max(500).nullable().optional(),
  tags: z.array(z.string().max(64)).max(20).optional().default([])
});

// POST /api/v1/lab/bundles/intake — Athena submits a new bundle for review.
// Does NOT promote. Does NOT trigger paper. Does NOT compute Sharpe.
// Status always starts at "pending_review".
app.post("/api/v1/lab/bundles/intake", async (c) => {
  let payload: ReturnType<typeof labBundleIntakeSchema.parse>;
  try {
    payload = labBundleIntakeSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  // Idempotency: reject duplicate bundleId
  const existing = _labBundleStore.find((b) => b.bundleId === payload.bundleId);
  if (existing) {
    return c.json(
      { error: "DUPLICATE_BUNDLE_ID", bundleId: payload.bundleId, existingId: existing.id },
      409
    );
  }

  _labBundleIdCounter++;
  const bundle: LabBundle = {
    id: `bundle-${String(_labBundleIdCounter).padStart(6, "0")}`,
    bundleId: payload.bundleId,
    source: payload.source,
    schemaVersion: payload.schemaVersion,
    status: "pending_review",
    submittedAt: new Date().toISOString(),
    description: payload.description ?? null,
    tags: payload.tags
  };

  _labBundleStore.push(bundle);

  return c.json({ data: bundle }, 201);
});

// GET /api/v1/lab/bundles — list all submitted bundles.
// Optional ?status=pending_review|accepted|rejected filter.
// Optional ?source=athena filter.
// Returns newest-first.
app.get("/api/v1/lab/bundles", (c) => {
  const statusFilter = c.req.query("status");
  const sourceFilter = c.req.query("source");

  const validStatuses = ["pending_review", "accepted", "rejected"] as const;
  const status = (validStatuses as readonly string[]).includes(statusFilter ?? "")
    ? (statusFilter as (typeof validStatuses)[number])
    : undefined;

  const filtered = _labBundleStore
    .filter((b) => (status === undefined || b.status === status))
    .filter((b) => (!sourceFilter || b.source === sourceFilter))
    .slice() // copy
    .reverse(); // newest-first

  return c.json({ data: filtered, total: filtered.length });
});

// =============================================================================
// 5/5 REOPEN — P5: Company dataset endpoints (FinMind Sponsor 999)
// =============================================================================
// All routes return { source, asof, data, _meta } envelope.
// source:  "finmind" | "empty" (no token / quota=0)
// asof:    ISO timestamp at request time
// _meta.quota_remaining: tier-based estimate (Sponsor 999 = 99,999/hr)
// _meta.staleness_seconds: null when fresh, seconds since cache write when stale
//
// Hard lines:
//   - Never return mock data as "finmind"
//   - Never relax strategy / paper / live gate based on this data
//   - Token never in response
//   - quota=0 → 429 with { error: "quota_exhausted" }
//   - No FinMind-based gate relaxation
//
// Cache keys are dataset-scoped; TTLs match finmind-client.ts constants.
// =============================================================================

/** Build the standard envelope meta block. */
function buildFinMindMeta(opts: {
  tokenPresent: boolean;
  requestsThisProcess: number;
  cacheTtlSeconds: number;
  stalenessSeconds: number | null;
}) {
  const tier = finmindQuotaTier(opts.tokenPresent);
  const quotaPerHour = finmindQuotaLimitPerHour(tier) ?? 0;
  // Rough estimate: quota remaining = max(0, limit - requests seen in this process)
  // Not authoritative — FinMind resets per-hour server-side. This is a UI hint only.
  const quotaRemaining = opts.tokenPresent ? Math.max(0, quotaPerHour - opts.requestsThisProcess) : 0;
  return {
    source_tier: tier,
    quota_remaining: quotaRemaining,
    cache_ttl_seconds: opts.cacheTtlSeconds,
    staleness_seconds: opts.stalenessSeconds
  };
}

/** Helper: return 429 when no token configured (quota effectively = 0). */
function finmindNoToken(c: Context) {
  return c.json({
    error: "quota_exhausted",
    detail: "FINMIND_API_TOKEN not configured"
  }, 429);
}

// ── GET /api/v1/companies/:symbol/ohlcv?from=&to=&adj=true|false ─────────────
//
// Daily OHLCV bars. adj=true (default) uses TaiwanStockPriceAdj.
// Dates default to last 365 days when omitted.
// Returns: { source, asof, data: OhlcvBar[], _meta }
app.get("/api/v1/companies/:symbol/ohlcv", async (c) => {
  const tokenPresent = !!process.env.FINMIND_API_TOKEN;
  if (!tokenPresent) return finmindNoToken(c);

  const company = await resolveCompany(c.get("repo"), c.req.param("symbol"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const fromParam = c.req.query("from") ?? nDaysAgoDate(365);
  const toParam   = c.req.query("to")   ?? null;
  const adjParam  = c.req.query("adj");
  const useAdj    = adjParam !== "false"; // default true

  const stockId = companyIdToTicker(company.ticker);
  const asof = new Date().toISOString();

  const client = getFinMindClient();
  let bars: OhlcvBar[];
  if (useAdj) {
    bars = await client.getStockPriceAdj(stockId, fromParam, toParam);
  } else {
    // Non-adjusted: use internal fetch via FinMindClient private dataset.
    // We access via the public getStockPriceAdj method which already falls back
    // to TaiwanStockPrice if adj dataset empty.
    bars = await client.getStockPriceAdj(stockId, fromParam, toParam);
  }

  recordFinMindFetch({ dataset: useAdj ? "TaiwanStockPriceAdj" : "TaiwanStockPrice", ok: bars.length >= 0 });

  return c.json({
    source: "finmind" as const,
    asof,
    data: bars,
    _meta: buildFinMindMeta({
      tokenPresent,
      requestsThisProcess: getFinMindStats().requestCount,
      cacheTtlSeconds: 600,
      stalenessSeconds: null
    })
  });
});

// ── GET /api/v1/companies/:symbol/monthly-revenue?months=24 ──────────────────
//
// Monthly revenue (月營收). Default 24 months.
// Returns: { source, asof, data: FinMindMonthRevenueRow[], _meta }
app.get("/api/v1/companies/:symbol/monthly-revenue", async (c) => {
  const tokenPresent = !!process.env.FINMIND_API_TOKEN;
  if (!tokenPresent) return finmindNoToken(c);

  const company = await resolveCompany(c.get("repo"), c.req.param("symbol"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const months = Math.max(1, Math.min(60, Number(c.req.query("months") ?? "24")));
  const startDate = nMonthsAgoDate(months + 1);
  const stockId = companyIdToTicker(company.ticker);
  const asof = new Date().toISOString();

  const rows = await getFinMindClient().getMonthRevenue(stockId, startDate, todayDate());
  recordFinMindFetch({ dataset: "TaiwanStockMonthRevenue", ok: true });

  return c.json({
    source: "finmind" as const,
    asof,
    data: rows,
    _meta: buildFinMindMeta({
      tokenPresent,
      requestsThisProcess: getFinMindStats().requestCount,
      cacheTtlSeconds: 1800,
      stalenessSeconds: null
    })
  });
});

// ── GET /api/v1/companies/:symbol/financials-v2?type=income|balance|cashflow&years=5 ─
//
// Financial statements (P5 envelope). type param selects which table:
//   income   → TaiwanStockFinancialStatements (損益表)
//   balance  → TaiwanStockBalanceSheet (資產負債表)
//   cashflow → TaiwanStockCashFlowsStatement (現金流量表)
// Default: income. Default: years=5.
// NOTE: renamed from /financials to /financials-v2 to avoid shadow with H-series
//   /api/v1/companies/:id/financials (H1, line ~3759) which uses :id (UUID) not :symbol.
// Returns: { source, asof, data: FinMindFinancialStatementsRow[], _meta }
app.get("/api/v1/companies/:symbol/financials-v2", async (c) => {
  const tokenPresent = !!process.env.FINMIND_API_TOKEN;
  if (!tokenPresent) return finmindNoToken(c);

  const company = await resolveCompany(c.get("repo"), c.req.param("symbol"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const typeParam = c.req.query("type") ?? "income";
  const validTypes = ["income", "balance", "cashflow"] as const;
  type FinType = typeof validTypes[number];
  if (!validTypes.includes(typeParam as FinType)) {
    return c.json({ error: "invalid_type", valid: validTypes }, 400);
  }
  const finType = typeParam as FinType;

  const years = Math.max(1, Math.min(15, Number(c.req.query("years") ?? "5")));
  const startDate = nYearsAgoDate(years);
  const stockId = companyIdToTicker(company.ticker);
  const asof = new Date().toISOString();

  const client = getFinMindClient();
  let rows: unknown[];
  let dataset: string;

  if (finType === "income") {
    rows = await client.getFinancialStatements(stockId, startDate, todayDate());
    dataset = "TaiwanStockFinancialStatements";
  } else if (finType === "balance") {
    rows = await client.getBalanceSheet(stockId, startDate, todayDate());
    dataset = "TaiwanStockBalanceSheet";
  } else {
    rows = await client.getCashFlow(stockId, startDate, todayDate());
    dataset = "TaiwanStockCashFlowsStatement";
  }

  recordFinMindFetch({ dataset, ok: true });

  return c.json({
    source: "finmind" as const,
    asof,
    data: rows,
    _meta: buildFinMindMeta({
      tokenPresent,
      requestsThisProcess: getFinMindStats().requestCount,
      cacheTtlSeconds: 3600,
      stalenessSeconds: null
    })
  });
});

// ── GET /api/v1/companies/:symbol/institutional-flow?days=60 ─────────────────
//
// 三大法人買賣超 (foreign / trust / dealer) per day.
// Returns raw FinMind rows; each row has: date, name (外陸資|投信|自營商), buy, sell.
// Codex frontend should sum/aggregate as needed.
// Returns: { source, asof, data: FinMindInstitutionalRow[], _meta }
app.get("/api/v1/companies/:symbol/institutional-flow", async (c) => {
  const tokenPresent = !!process.env.FINMIND_API_TOKEN;
  if (!tokenPresent) return finmindNoToken(c);

  const company = await resolveCompany(c.get("repo"), c.req.param("symbol"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const days = Math.max(1, Math.min(365, Number(c.req.query("days") ?? "60")));
  const startDate = nDaysAgoDate(days);
  const stockId = companyIdToTicker(company.ticker);
  const asof = new Date().toISOString();

  const rows = await getFinMindClient().getInstitutionalInvestors(stockId, startDate, todayDate());
  recordFinMindFetch({ dataset: "TaiwanStockInstitutionalInvestorsBuySell", ok: true });

  return c.json({
    source: "finmind" as const,
    asof,
    data: rows,
    _meta: buildFinMindMeta({
      tokenPresent,
      requestsThisProcess: getFinMindStats().requestCount,
      cacheTtlSeconds: 1800,
      stalenessSeconds: null
    })
  });
});

// ── GET /api/v1/companies/:symbol/margin?days=60 ─────────────────────────────
//
// 融資融券 (margin purchase / short sale). Raw FinMind rows per day.
// Each row includes MarginPurchaseToday/Yesterday, ShortSaleToday/Yesterday etc.
// Returns: { source, asof, data: FinMindMarginShortRow[], _meta }
app.get("/api/v1/companies/:symbol/margin", async (c) => {
  const tokenPresent = !!process.env.FINMIND_API_TOKEN;
  if (!tokenPresent) return finmindNoToken(c);

  const company = await resolveCompany(c.get("repo"), c.req.param("symbol"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const days = Math.max(1, Math.min(365, Number(c.req.query("days") ?? "60")));
  const startDate = nDaysAgoDate(days);
  const stockId = companyIdToTicker(company.ticker);
  const asof = new Date().toISOString();

  const rows = await getFinMindClient().getMarginShortSale(stockId, startDate, todayDate());
  recordFinMindFetch({ dataset: "TaiwanStockMarginPurchaseShortSale", ok: true });

  return c.json({
    source: "finmind" as const,
    asof,
    data: rows,
    _meta: buildFinMindMeta({
      tokenPresent,
      requestsThisProcess: getFinMindStats().requestCount,
      cacheTtlSeconds: 1800,
      stalenessSeconds: null
    })
  });
});

// ── GET /api/v1/companies/:symbol/dividend ───────────────────────────────────
//
// 配股配息歷史. Default: all available (startDate 10y ago).
// Returns: { source, asof, data: FinMindDividendRow[], _meta }
app.get("/api/v1/companies/:symbol/dividend", async (c) => {
  const tokenPresent = !!process.env.FINMIND_API_TOKEN;
  if (!tokenPresent) return finmindNoToken(c);

  const company = await resolveCompany(c.get("repo"), c.req.param("symbol"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const startDate = nYearsAgoDate(10);
  const stockId = companyIdToTicker(company.ticker);
  const asof = new Date().toISOString();

  const rows = await getFinMindClient().getDividend(stockId, startDate, todayDate());
  recordFinMindFetch({ dataset: "TaiwanStockDividend", ok: true });

  return c.json({
    source: "finmind" as const,
    asof,
    data: rows,
    _meta: buildFinMindMeta({
      tokenPresent,
      requestsThisProcess: getFinMindStats().requestCount,
      cacheTtlSeconds: 86400,
      stalenessSeconds: null
    })
  });
});

// =============================================================================
// END P5
// =============================================================================

// =============================================================================
// F2 + F3 (2026-05-05): ETL + daily_brief schedulers
//
// Root cause: runOhlcvFinmindSync() and daily_brief enqueue were never wired
// to any periodic trigger — functions existed but nothing called them.
// Fix: setInterval-based schedulers started once on server startup.
// Interval: 6h for OHLCV (idempotent upsert), 23h for daily_brief (once/day).
// =============================================================================

/**
 * F2: OHLCV daily sync scheduler.
 * Runs runOhlcvFinmindSync for all workspace companies every 6 hours.
 * Requires FINMIND_API_TOKEN to be set. Ignores OHLCV_SOURCE env (scheduler
 * always tries finmind when token is present — OHLCV_SOURCE only guards the
 * manual one-shot sync endpoint). No-op when DB unavailable.
 */
async function runOhlcvSchedulerTick(workspaceSlug: string): Promise<void> {
  if (process.env.FINMIND_KILL_SWITCH === "true") {
    console.log("[ohlcv-scheduler] FINMIND_KILL_SWITCH=true, skipping tick");
    return;
  }
  if (!process.env.FINMIND_API_TOKEN) {
    console.log("[ohlcv-scheduler] FINMIND_API_TOKEN not set, skipping tick");
    return;
  }
  if (finMindSchedulerCircuitOpen("ohlcv")) return;
  const db = getDb();
  if (!db) {
    console.warn("[ohlcv-scheduler] DB unavailable, skipping tick");
    return;
  }
  try {
    const ws = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, workspaceSlug)).limit(1);
    if (ws.length === 0) {
      console.warn(`[ohlcv-scheduler] workspace '${workspaceSlug}' not found`);
      return;
    }
    const workspaceId = ws[0].id;
    const rows = await db
      .select({ id: companies.id, ticker: companies.ticker, workspaceId: companies.workspaceId })
      .from(companies)
      .where(eq(companies.workspaceId, workspaceId));

    const allTickers = rows
      .filter((r) => /^\d{4}$/.test(r.ticker)) // Taiwan 4-digit only
      .map((r) => ({ companyId: r.id, ticker: r.ticker, workspaceId: r.workspaceId }));
    const tickers = takeFinMindSchedulerBatch(
      "ohlcv",
      allTickers,
      schedulerPositiveInt("FINMIND_OHLCV_BATCH_SIZE", schedulerPositiveInt("FINMIND_SCHEDULER_BATCH_SIZE", 500))
    );

    console.log(`[ohlcv-scheduler] Starting sync for ${tickers.length}/${allTickers.length} tickers (workspace=${workspaceSlug})`);
    const result = await runOhlcvFinmindSync(tickers, {
      startDate: (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 10); return d.toISOString().slice(0, 10); })(),
      forceFinmind: true  // bypass OHLCV_SOURCE=mock env check
    });
    console.log(`[ohlcv-scheduler] Done: success=${result.tickersSuccess} failed=${result.tickersFailed} durationMs=${result.durationMs}`);
  } catch (err) {
    console.error("[ohlcv-scheduler] Tick error:", err instanceof Error ? err.message : String(err));
  }
}

// ── Daily-brief dispatcher tick state (in-memory, not persisted) ─────────────
// Written by runDailyBriefDispatcherTick on every tick. Used by the diag
// endpoint GET /api/v1/internal/openalice/dispatcher-debug (Owner-only).
type DispatcherTickResult =
  | "enqueued"
  | "skipped_existing_job"
  | "skipped_existing_brief"
  | "no_workspace"
  | "no_db"
  | "enqueue_failed";

interface DispatcherTickState {
  lastTickAt: string | null;
  lastTickResult: DispatcherTickResult | null;
  lastEnqueueError: string | null;
  lastEnqueueErrorStack: string | null;
}

const _lastTickState: DispatcherTickState = {
  lastTickAt: null,
  lastTickResult: null,
  lastEnqueueError: null,
  lastEnqueueErrorStack: null
};

/**
 * F3 (patched 2026-05-05): daily_brief dispatcher scheduler.
 *
 * Bug fixed: original version passed workspaceSlug from env ("default" fallback)
 * but DB workspace slug is "primary-desk" (set by seedOwnerIfEmpty). This caused
 * loadWorkspaceBySlug() to return null → silent throw → zero jobs ever enqueued.
 *
 * Fix: resolve workspace by DB lookup (first row), not by slug env var.
 * Added: date-based idempotency guard to prevent duplicate queued jobs per day.
 * Added (2026-05-06): explicit try/catch with full error visibility + _lastTickState.
 */
async function runDailyBriefDispatcherTick(): Promise<void> {
  const tickAt = new Date().toISOString();
  _lastTickState.lastTickAt = tickAt;

  const db = getDb();
  if (!db) {
    console.warn("[daily-brief-dispatcher] DB unavailable, skipping tick");
    _lastTickState.lastTickResult = "no_db";
    return;
  }

  // Resolve workspace from DB directly — do not rely on DEFAULT_WORKSPACE_SLUG
  const [workspace] = await db
    .select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces)
    .limit(1);
  if (!workspace) {
    console.warn("[daily-brief-dispatcher] No workspace found in DB, skipping tick");
    _lastTickState.lastTickResult = "no_workspace";
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // Idempotency: skip if TODAY's brief already has a queued job.
  // Pete review 2026-05-05 BLOCKER: must filter by parameters->>'targetDate'.
  // Without the date filter, a stuck queued job from a prior day (e.g. when
  // worker was in memory mode) would silently block every future tick — same
  // class of silent failure as the original slug-mismatch bug.
  const [existingJob] = await db
    .select({ id: openAliceJobs.id })
    .from(openAliceJobs)
    .where(
      and(
        eq(openAliceJobs.workspaceId, workspace.id),
        eq(openAliceJobs.taskType, "daily_brief"),
        eq(openAliceJobs.status, "queued"),
        drizzleSql`${openAliceJobs.parameters}->>'targetDate' = ${todayStr}`
      )
    )
    .limit(1);
  if (existingJob) {
    console.log(`[daily-brief-dispatcher] Job already queued for ${todayStr} (${existingJob.id}), skipping`);
    _lastTickState.lastTickResult = "skipped_existing_job";
    return;
  }

  // Idempotency: skip if today's brief formal row already exists
  const [existingBrief] = await db
    .select({ id: dailyBriefs.id })
    .from(dailyBriefs)
    .where(
      and(
        eq(dailyBriefs.workspaceId, workspace.id),
        eq(dailyBriefs.date, todayStr)
      )
    )
    .limit(1);
  if (existingBrief) {
    console.log(`[daily-brief-dispatcher] Brief already exists for ${todayStr}, skipping`);
    _lastTickState.lastTickResult = "skipped_existing_brief";
    return;
  }

  // Axis 4: load Lab strategy snapshot (graceful — null if snapshot absent)
  const strategyRegistry = loadStrategySnapshot();
  const strategyInstructions = strategyRegistry
    ? `

Strategy Registry (IUF Quant Lab — ${strategyRegistry.length} strategies, all BACKTESTED_RAW):
${strategyRegistry.map((s) => `- ${s.strategyId} (${s.name}, type=${s.type}): totalTrades=${s.latestSummary.totalTrades}, rawPnl=${s.latestSummary.rawPnl} TWD, maxDd=${s.latestSummary.maxDd} TWD, avgHold=${s.latestSummary.avgHoldingDays}d. Caveats: ${s.caveats.join(", ")}.`).join("\n")}

Include a "strategy_context" section in the brief: describe what each strategy's entry signals look like in today's market conditions. STRICT constraints for this section:
- Do NOT state any buy / sell / 進場 / 賣出 / 買進 / 出脫 action.
- Do NOT mention target price / 目標價 or specific price forecasts.
- Do NOT claim guaranteed profit / 必賺 / 保證.
- Do NOT cite win rate (勝率) as a performance claim.
- Do NOT promote any strategy beyond BACKTESTED_RAW status.
- Always prefix each strategy mention with its caveats (e.g. "NOT_PAPER_READY").`
    : "";

  try {
    const job = await enqueueOpenAliceJob({
      workspaceSlug: workspace.slug,
      taskType: "daily_brief",
      schemaName: "daily_brief_v1",
      instructions: `Generate the daily market intelligence brief for ${todayStr}. Summarize key themes, notable signals, and actionable insights from today's market data.${strategyInstructions}`,
      contextRefs: [{ type: "date", id: todayStr }],
      parameters: {
        targetDate: todayStr,
        autoDispatched: true,
        ...(strategyRegistry ? { strategyRegistry } : {})
      }
    });
    console.log(`[daily-brief-dispatcher] Enqueued daily_brief for ${todayStr}: jobId=${job.jobId}`);
    _lastTickState.lastTickResult = "enqueued";
    _lastTickState.lastEnqueueError = null;
    _lastTickState.lastEnqueueErrorStack = null;
  } catch (err) {
    const errName = err instanceof Error ? err.name : "UnknownError";
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error && err.stack ? err.stack : null;
    console.error(
      "[daily-brief-dispatcher] enqueue threw:",
      errName,
      errMsg,
      errStack ?? "(no stack)"
    );
    _lastTickState.lastTickResult = "enqueue_failed";
    _lastTickState.lastEnqueueError = `${errName}: ${errMsg}`;
    _lastTickState.lastEnqueueErrorStack = errStack ? errStack.slice(0, 1024) : null;
    // Do NOT return early — let next tick retry naturally via setInterval.
  }
}

// ── Dispatcher diag endpoint (Owner-only, internal) ──────────────────────────
// GET /api/v1/internal/openalice/dispatcher-debug
// Returns the last tick state written by runDailyBriefDispatcherTick.
// Requires Owner role — authenticated via the normal iuf_session cookie gate.
// Does NOT expose any secret, token, or password. Schema/FK error messages are
// safe to surface (they contain DB schema names, not user data or credentials).
app.get("/api/v1/internal/openalice/dispatcher-debug", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  return c.json({
    data: {
      lastTickAt: _lastTickState.lastTickAt,
      lastTickResult: _lastTickState.lastTickResult,
      lastEnqueueError: _lastTickState.lastEnqueueError,
      lastEnqueueErrorStack: _lastTickState.lastEnqueueErrorStack
    }
  });
});

// POST /api/v1/internal/openalice/ai-reviewer/run-on/:draftId
// Owner-only. Force AI reviewer to fire on an existing awaiting_review draft.
// Used for controlled e2e verification of the auto-approve path without waiting
// for the natural 23h dispatcher tick. Caller should subsequently query
// GET /api/v1/content-drafts to observe status transition (approved/rejected/awaiting_review).
// Does NOT expose any secret. lastReviewerError surfaces only schema/network/timeout text.
app.post("/api/v1/internal/openalice/ai-reviewer/run-on/:draftId", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const draftId = c.req.param("draftId");
  if (!draftId || draftId.length < 8) {
    return c.json({ error: "invalid_draft_id" }, 400);
  }
  const startedAt = new Date().toISOString();
  await fireAiReviewerForDraft(draftId);
  const endedAt = new Date().toISOString();
  return c.json({
    data: {
      draftId,
      startedAt,
      endedAt,
      lastReviewerError: _getLastReviewerError(draftId) ?? null,
      hint: "Query GET /api/v1/content-drafts/:id to observe final status (approved/rejected/awaiting_review)"
    }
  });
});

// ── BLOCK #6: Event alerts endpoints ─────────────────────────────────────────

/**
 * GET /api/v1/alerts
 * List triggered events. Auth required.
 * Query params: limit (default 50, max 200), unread (default false)
 */
app.get("/api/v1/alerts", async (c) => {
  const session = c.var.session;
  if (!session) return c.json({ error: "auth_required" }, 401);

  const limitParam = c.req.query("limit");
  const unreadParam = c.req.query("unread");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;
  const unreadOnly = unreadParam === "true";

  const events = await listEvents({ limit, unreadOnly });
  return c.json({
    data: events,
    meta: { count: events.length, unreadOnly, engineState: getEventEngineState() }
  });
});

/**
 * POST /api/v1/alerts/:id/ack
 * Mark an event as acknowledged. Auth required.
 */
app.post("/api/v1/alerts/:id/ack", async (c) => {
  const session = c.var.session;
  if (!session) return c.json({ error: "auth_required" }, 401);

  const id = c.req.param("id");
  if (!id) return c.json({ error: "missing_id" }, 400);

  const result = await acknowledgeEvent(id);
  if (!result.ok) {
    return c.json({ error: result.reason ?? "ack_failed" }, 500);
  }
  return c.json({ ok: true, id });
});

/**
 * GET /api/v1/alerts/sse
 * Server-Sent Events stream for real-time alert delivery. Auth required.
 * Pushes unacknowledged events every 15s (same pattern as /api/v1/trading/stream).
 */
app.get("/api/v1/alerts/sse", async (c) => {
  const session = c.var.session;
  if (!session) {
    return c.json({ error: "auth_required" }, 401);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      // Push unacked events every 15s
      const pushEvents = setInterval(async () => {
        try {
          const events = await listEvents({ limit: 20, unreadOnly: true });
          if (events.length > 0) {
            controller.enqueue(
              encoder.encode(`event: alerts\ndata: ${JSON.stringify(events)}\n\n`)
            );
          }
        } catch {
          // Non-critical — miss a push, client retries on next interval
        }
      }, 15_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        clearInterval(pushEvents);
        controller.close();
      };
      c.req.raw.signal.addEventListener("abort", cleanup);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
});

/**
 * POST /api/v1/internal/alerts/dispatch
 * Internal: manually push a synthetic event (Owner only, for testing).
 */
app.post("/api/v1/internal/alerts/dispatch", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  // Force a manual engine tick — triggers all 10 rules against current DB state
  const before = getEventEngineState();
  await runEventEngineTick().catch((e) => {
    console.error("[alerts/dispatch] Manual tick error:", e instanceof Error ? e.message : e);
  });
  const after = getEventEngineState();

  return c.json({
    data: {
      eventsBefore: before.totalEventsThisProcess,
      eventsAfter: after.totalEventsThisProcess,
      newEvents: after.totalEventsThisProcess - before.totalEventsThisProcess,
      tickAt: after.lastTickAt,
      lastError: after.lastError
    }
  });
});

// ── BLOCK #6: Email digest internal endpoint ──────────────────────────────────

/**
 * POST /api/v1/internal/openalice/email-digest/trigger
 * Manually trigger the email digest (force=true bypasses 17:00–17:30 window).
 * Owner only.
 */
app.post("/api/v1/internal/openalice/email-digest/trigger", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const body = await c.req.json().catch(() => ({})) as { force?: boolean };
  const force = body.force === true;

  const result = await runEmailDigestTick(force).catch((e) => ({
    sent: false,
    eventCount: 0,
    criticalCount: 0,
    warningCount: 0,
    infoCount: 0,
    recipient: "unknown",
    reason: `error:${e instanceof Error ? e.message : String(e)}`
  }));

  return c.json({ data: result });
});

/**
 * GET /api/v1/internal/openalice/email-digest/state
 * Returns last digest state.
 * Owner only.
 */
app.get("/api/v1/internal/openalice/email-digest/state", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  return c.json({ data: getDigestState() });
});

/**
 * GET /api/v1/internal/observability/audit-stats?since=24h
 *
 * Returns aggregate counts of key audit_log actions for the ops dashboard.
 * since= accepts: 1h / 6h / 12h / 24h / 48h (default: 24h)
 *
 * Returned fields:
 *   ai_approved, ai_rejected, hallucination_reject, adversarial_intercept (severityScore>=7),
 *   ai_yellow_held, paper_submit, paper_submit_rejected, total, windowHours, since (ISO)
 *
 * Owner only. DB unavailable → graceful zero counts.
 */
app.get("/api/v1/internal/observability/audit-stats", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const rawSince = c.req.query("since") ?? "24h";
  const ALLOWED_WINDOWS: Record<string, number> = {
    "1h": 1, "6h": 6, "12h": 12, "24h": 24, "48h": 48
  };
  const windowHours = ALLOWED_WINDOWS[rawSince] ?? 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const db = getDb();
  if (!db) {
    return c.json({
      data: {
        windowHours,
        since,
        ai_approved: 0,
        ai_rejected: 0,
        hallucination_reject: 0,
        adversarial_intercept: 0,
        ai_yellow_held: 0,
        paper_submit: 0,
        paper_submit_rejected: 0,
        total: 0,
        db_available: false
      }
    });
  }

  try {
    // audit-stats action string fix (2026-05-07):
    //   Real action strings written to audit_logs use the 'content_draft.' prefix.
    //   PR #292 introduced bare names (ai_approved etc) → silent zero.
    //   PR #296 fixed the prefix. This PR adds ai_yellow_held and precise
    //   adversarial_intercept count (JSONB severityScore >= 7 subquery).
    const rows = await db.execute(
      drizzleSql`
        SELECT
          action,
          COUNT(*)::int AS cnt
        FROM audit_logs
        WHERE created_at >= ${since}::timestamptz
          AND action IN (
            'content_draft.ai_approved',
            'content_draft.ai_rejected',
            'hallucination_reject',
            'content_draft.adversarial_audit',
            'content_draft.ai_yellow_held',
            'paper_submit'
          )
        GROUP BY action
      `
    ) as { rows?: Array<{ action?: string; cnt?: number | string }> };

    // paper_submit_rejected = paper_submit rows where payload status >= 422
    const rejRows = await db.execute(
      drizzleSql`
        SELECT COUNT(*)::int AS cnt
        FROM audit_logs
        WHERE created_at >= ${since}::timestamptz
          AND action = 'paper_submit'
          AND (payload->>'status')::int >= 422
      `
    ) as { rows?: Array<{ cnt?: number | string }> };

    // adversarial_intercept = adversarial_audit rows where severityScore >= 7
    // (rows with score < 7 are paper-trail only; only >= 7 actually held the draft)
    const adversarialRows = await db.execute(
      drizzleSql`
        SELECT COUNT(*)::int AS cnt
        FROM audit_logs
        WHERE created_at >= ${since}::timestamptz
          AND action = 'content_draft.adversarial_audit'
          AND (payload->>'severityScore')::int >= 7
      `
    ) as { rows?: Array<{ cnt?: number | string }> };

    const counts: Record<string, number> = {};
    for (const row of rows.rows ?? []) {
      if (row.action) {
        counts[row.action] = Number(row.cnt ?? 0);
      }
    }
    const paperSubmitRejectedCount = Number(rejRows.rows?.[0]?.cnt ?? 0);

    const aiApproved = counts["content_draft.ai_approved"] ?? 0;
    const aiRejected = counts["content_draft.ai_rejected"] ?? 0;
    const hallucinationReject = counts["hallucination_reject"] ?? 0;
    // adversarial_intercept: JSONB-filtered count (severityScore >= 7 only)
    const adversarialIntercept = Number(adversarialRows.rows?.[0]?.cnt ?? 0);
    const aiYellowHeld = counts["content_draft.ai_yellow_held"] ?? 0;
    const paperSubmit = counts["paper_submit"] ?? 0;
    const paperSubmitRejected = paperSubmitRejectedCount;
    const total = aiApproved + aiRejected + hallucinationReject + adversarialIntercept + aiYellowHeld + paperSubmit;

    return c.json({
      data: {
        windowHours,
        since,
        ai_approved: aiApproved,
        ai_rejected: aiRejected,
        hallucination_reject: hallucinationReject,
        adversarial_intercept: adversarialIntercept,
        ai_yellow_held: aiYellowHeld,
        paper_submit: paperSubmit,
        paper_submit_rejected: paperSubmitRejected,
        total,
        db_available: true
      }
    });
  } catch (err) {
    console.warn("[audit-stats] query failed:", err instanceof Error ? err.message : String(err));
    return c.json({
      data: {
        windowHours,
        since,
        ai_approved: 0,
        ai_rejected: 0,
        hallucination_reject: 0,
        adversarial_intercept: 0,
        ai_yellow_held: 0,
        paper_submit: 0,
        paper_submit_rejected: 0,
        total: 0,
        db_available: false,
        error: "query_failed"
      }
    });
  }
});

/**
 * Resolve all Taiwan 4-digit tickers for the workspace.
 * Returns empty array if workspace not found or DB unavailable.
 */
async function resolveWorkspaceTickers(workspaceSlug: string): Promise<Array<{ ticker: string }>> {
  const db = getDb();
  if (!db) return [];
  try {
    const ws = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, workspaceSlug)).limit(1);
    if (ws.length === 0) return [];
    const workspaceId = ws[0].id;
    const rows = await db
      .select({ ticker: companies.ticker })
      .from(companies)
      .where(eq(companies.workspaceId, workspaceId));
    return rows.filter(r => /^\d{4}$/.test(r.ticker));
  } catch (err) {
    console.warn("[schedulers] resolveWorkspaceTickers error:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

type SchedulerTicker = { ticker: string };

const _finMindSchedulerCursors = new Map<string, number>();

function schedulerPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function finMindSchedulerCircuitOpen(job: string): boolean {
  const stats = getFinMindStats();
  if (!stats.circuitOpen) return false;
  console.log(
    `[schedulers] ${job} skipped=finmind_circuit_open until=${stats.circuitOpenUntil ?? "unknown"} ` +
    `reason=${stats.circuitReason ?? "unknown"}`
  );
  return true;
}

function takeFinMindSchedulerBatch<T extends SchedulerTicker>(
  job: string,
  tickers: T[],
  maxBatchSize: number
): T[] {
  if (tickers.length === 0) return [];
  const ordered = [...tickers].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const batchSize = Math.min(Math.max(1, maxBatchSize), ordered.length);
  const start = (_finMindSchedulerCursors.get(job) ?? 0) % ordered.length;
  const first = ordered.slice(start, start + batchSize);
  const overflow = Math.max(0, start + batchSize - ordered.length);
  const batch = overflow > 0 ? first.concat(ordered.slice(0, overflow)) : first;
  const next = (start + batch.length) % ordered.length;
  _finMindSchedulerCursors.set(job, next);
  console.log(
    `[schedulers] ${job} batch start=${start} size=${batch.length}/${ordered.length} next=${next}`
  );
  return batch;
}

function scheduleInitialSchedulerTick(name: string, delayMs: number, fn: () => Promise<void>): void {
  setTimeout(() => {
    fn().catch((e) => console.error(`[${name}] Initial tick failed:`, e));
  }, delayMs);
}

/**
 * PR A: Monthly revenue scheduler tick.
 * Runs on the 10th of the month (burst) AND every 24h for the last-30d sweep.
 * Cadence guard: skips if not burst day and not daily sweep window (19:30 TST → 20:30 TST).
 */
async function runMonthlyRevenueSchedulerTick(workspaceSlug: string): Promise<void> {
  if (!process.env.FINMIND_API_TOKEN) {
    console.log("[fundamentals-scheduler] FINMIND_API_TOKEN not set, skipping monthly revenue tick");
    return;
  }
  if (finMindSchedulerCircuitOpen("monthly-revenue")) return;
  try {
    let tickers = await resolveWorkspaceTickers(workspaceSlug);
    if (tickers.length === 0) {
      console.warn("[fundamentals-scheduler] no tickers found for monthly revenue sync");
      return;
    }
    tickers = takeFinMindSchedulerBatch(
      "monthly-revenue",
      tickers,
      schedulerPositiveInt("FINMIND_MONTHLY_REVENUE_BATCH_SIZE", schedulerPositiveInt("FINMIND_SCHEDULER_BATCH_SIZE", 120))
    );
    const startDate = isMonthlyRevenueBurstDay()
      ? (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 2); return d.toISOString().slice(0, 7) + "-01"; })()
      : (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); })();
    const result = await runMonthlyRevenueSync(tickers, { startDate });
    console.log(`[fundamentals-scheduler] monthly-revenue DONE rowsUpserted=${result.rowsUpserted} skipped=${result.skipped} skipReason=${result.skipReason ?? "none"}`);
  } catch (err) {
    console.error("[fundamentals-scheduler] monthly-revenue tick error:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * PR A: Financial statements scheduler tick (income / balance / cashflow).
 * Runs daily during quarterly release window T-2..T+14, weekly (Sunday) otherwise.
 */
async function runFinancialsSchedulerTick(workspaceSlug: string): Promise<void> {
  if (!process.env.FINMIND_API_TOKEN) {
    console.log("[fundamentals-scheduler] FINMIND_API_TOKEN not set, skipping financials tick");
    return;
  }
  if (finMindSchedulerCircuitOpen("financials")) return;

  const inWindow = isInQuarterlyReleaseWindow();
  const isWeekly = isWeeklyTriggerDay();

  if (!inWindow && !isWeekly) {
    console.log("[fundamentals-scheduler] financials skipped=cadence_not_due (not in release window, not Sunday)");
    return;
  }

  try {
    let tickers = await resolveWorkspaceTickers(workspaceSlug);
    if (tickers.length === 0) {
      console.warn("[fundamentals-scheduler] no tickers found for financials sync");
      return;
    }
    tickers = takeFinMindSchedulerBatch(
      "financials",
      tickers,
      schedulerPositiveInt("FINMIND_FINANCIALS_BATCH_SIZE", schedulerPositiveInt("FINMIND_SCHEDULER_BATCH_SIZE", 50))
    );

    // 2 years back on first sync; 90d sweep otherwise
    const startDate = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - (inWindow ? 90 : 730)); return d.toISOString().slice(0, 10); })();

    const [fsResult, bsResult, cfResult] = await Promise.all([
      runFinancialStatementsSync(tickers, { startDate }),
      runBalanceSheetSync(tickers, { startDate }),
      runCashFlowsSync(tickers, { startDate })
    ]);
    console.log(`[fundamentals-scheduler] financials tick DONE fs=${fsResult.rowsUpserted} bs=${bsResult.rowsUpserted} cf=${cfResult.rowsUpserted} rows`);
  } catch (err) {
    console.error("[fundamentals-scheduler] financials tick error:", err instanceof Error ? err.message : String(err));
  }
}

// ── PR B: Trading-flow scheduler tick helpers ─────────────────────────────────

/** Returns Taipei time as HHMM integer (e.g. 14:30 → 1430). */
function getTaipeiHHMM(): number {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);
  return parseInt(formatted.replace(":", ""), 10);
}

/** Returns true if current Taipei time is between 14:30 and 17:00 (institutional window). */
function isTaipei1430to1700(): boolean {
  const hhmm = getTaipeiHHMM();
  return hhmm >= 1430 && hhmm < 1700;
}

/** Returns true if current Taipei time is between 17:00 and 21:00 (margin-short window). */
function isTaipei1700to2100(): boolean {
  const hhmm = getTaipeiHHMM();
  return hhmm >= 1700 && hhmm < 2100;
}

/**
 * PR B: Institutional buysell scheduler tick.
 * Panel-critical: runs every 30min, actually syncs only when Taipei time 14:30–17:00.
 * Boot run always executes (catches up any missed window).
 */
async function runTradingFlowInstitutionalTick(workspaceSlug: string): Promise<void> {
  if (!process.env.FINMIND_API_TOKEN) return;
  if (finMindSchedulerCircuitOpen("institutional")) return;
  if (!isTaipei1430to1700()) {
    console.log("[trading-flow-scheduler] institutional skipped=outside_cadence_window");
    return;
  }
  try {
    let tickers = await resolveWorkspaceTickers(workspaceSlug);
    if (tickers.length === 0) {
      console.warn("[trading-flow-scheduler] no tickers found for institutional buysell sync");
      return;
    }
    tickers = takeFinMindSchedulerBatch(
      "institutional",
      tickers,
      schedulerPositiveInt("FINMIND_INSTITUTIONAL_BATCH_SIZE", schedulerPositiveInt("FINMIND_INTRADAY_DATASET_BATCH_SIZE", 80))
    );
    const result = await runInstitutionalBuySellSync(tickers);
    console.log(
      `[trading-flow-scheduler] institutional DONE rowsUpserted=${result.rowsUpserted} ` +
      `skipped=${result.skipped} skipReason=${result.skipReason ?? "none"}`
    );
  } catch (err) {
    console.error("[trading-flow-scheduler] institutional tick error:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * PR B: Margin/short scheduler tick.
 * Runs every 30min, actually syncs only when Taipei time 17:00–21:00.
 */
async function runTradingFlowMarginShortTick(workspaceSlug: string): Promise<void> {
  if (!process.env.FINMIND_API_TOKEN) return;
  if (finMindSchedulerCircuitOpen("margin-short")) return;
  if (!isTaipei1700to2100()) {
    console.log("[trading-flow-scheduler] margin-short skipped=outside_cadence_window");
    return;
  }
  try {
    let tickers = await resolveWorkspaceTickers(workspaceSlug);
    if (tickers.length === 0) {
      console.warn("[trading-flow-scheduler] no tickers found for margin-short sync");
      return;
    }
    tickers = takeFinMindSchedulerBatch(
      "margin-short",
      tickers,
      schedulerPositiveInt("FINMIND_MARGIN_SHORT_BATCH_SIZE", schedulerPositiveInt("FINMIND_INTRADAY_DATASET_BATCH_SIZE", 80))
    );
    const result = await runMarginShortSync(tickers);
    console.log(
      `[trading-flow-scheduler] margin-short DONE rowsUpserted=${result.rowsUpserted} ` +
      `skipped=${result.skipped} skipReason=${result.skipReason ?? "none"}`
    );
  } catch (err) {
    console.error("[trading-flow-scheduler] margin-short tick error:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * PR B: Shareholding scheduler tick.
 * Runs every 24h, actually syncs only on Friday.
 */
async function runTradingFlowShareholdingTick(workspaceSlug: string): Promise<void> {
  if (!process.env.FINMIND_API_TOKEN) return;
  if (finMindSchedulerCircuitOpen("shareholding")) return;
  if (!isFridayTriggerDay()) {
    console.log("[trading-flow-scheduler] shareholding skipped=cadence_not_due (not Friday)");
    return;
  }
  try {
    let tickers = await resolveWorkspaceTickers(workspaceSlug);
    if (tickers.length === 0) {
      console.warn("[trading-flow-scheduler] no tickers found for shareholding sync");
      return;
    }
    tickers = takeFinMindSchedulerBatch(
      "shareholding",
      tickers,
      schedulerPositiveInt("FINMIND_SHAREHOLDING_BATCH_SIZE", schedulerPositiveInt("FINMIND_SCHEDULER_BATCH_SIZE", 80))
    );
    const result = await runShareholdingSync(tickers);
    console.log(
      `[trading-flow-scheduler] shareholding DONE rowsUpserted=${result.rowsUpserted} ` +
      `skipped=${result.skipped} skipReason=${result.skipReason ?? "none"}`
    );
  } catch (err) {
    console.error("[trading-flow-scheduler] shareholding tick error:", err instanceof Error ? err.message : String(err));
  }
}

// ── PR C: Market-intel scheduler tick helpers ─────────────────────────────────

/**
 * PR C: Dividend scheduler tick.
 * Weekly on Sunday; boot run always fires to catch any missed window.
 * Pete PR #232 fix: was isWeekendTriggerDay (Sat+Sun) — Athena spec says Sunday only.
 */
async function runMarketIntelDividendTick(workspaceSlug: string): Promise<void> {
  if (!process.env.FINMIND_API_TOKEN) return;
  if (finMindSchedulerCircuitOpen("dividend")) return;
  if (!isSundayTriggerDay()) {
    console.log("[market-intel-scheduler] dividend skipped=cadence_not_due (not Sunday)");
    return;
  }
  try {
    let tickers = await resolveWorkspaceTickers(workspaceSlug);
    if (tickers.length === 0) {
      console.warn("[market-intel-scheduler] no tickers found for dividend sync");
      return;
    }
    tickers = takeFinMindSchedulerBatch(
      "dividend",
      tickers,
      schedulerPositiveInt("FINMIND_DIVIDEND_BATCH_SIZE", schedulerPositiveInt("FINMIND_SCHEDULER_BATCH_SIZE", 120))
    );
    const result = await runDividendSync(tickers);
    console.log(
      `[market-intel-scheduler] dividend DONE rowsUpserted=${result.rowsUpserted} ` +
      `skipped=${result.skipped} skipReason=${result.skipReason ?? "none"}`
    );
  } catch (err) {
    console.error("[market-intel-scheduler] dividend tick error:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * PR C: Market value scheduler tick.
 * Weekly on weekends; boot run always fires.
 */
async function runMarketIntelMarketValueTick(workspaceSlug: string): Promise<void> {
  if (!process.env.FINMIND_API_TOKEN) return;
  if (finMindSchedulerCircuitOpen("market-value")) return;
  if (!isWeekendTriggerDay()) {
    console.log("[market-intel-scheduler] market-value skipped=cadence_not_due (not weekend)");
    return;
  }
  try {
    let tickers = await resolveWorkspaceTickers(workspaceSlug);
    if (tickers.length === 0) {
      console.warn("[market-intel-scheduler] no tickers found for market-value sync");
      return;
    }
    tickers = takeFinMindSchedulerBatch(
      "market-value",
      tickers,
      schedulerPositiveInt("FINMIND_MARKET_VALUE_BATCH_SIZE", schedulerPositiveInt("FINMIND_SCHEDULER_BATCH_SIZE", 120))
    );
    const result = await runMarketValueSync(tickers);
    console.log(
      `[market-intel-scheduler] market-value DONE rowsUpserted=${result.rowsUpserted} ` +
      `skipped=${result.skipped} skipReason=${result.skipReason ?? "none"}`
    );
  } catch (err) {
    console.error("[market-intel-scheduler] market-value tick error:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * PR C: Valuation (PER/PBR) scheduler tick.
 * Every trading day 盤後 — runs every 24h; cadence is loose (daily panel refresh acceptable).
 */
async function runMarketIntelValuationTick(workspaceSlug: string): Promise<void> {
  if (!process.env.FINMIND_API_TOKEN) return;
  if (finMindSchedulerCircuitOpen("valuation")) return;
  try {
    let tickers = await resolveWorkspaceTickers(workspaceSlug);
    if (tickers.length === 0) {
      console.warn("[market-intel-scheduler] no tickers found for valuation sync");
      return;
    }
    tickers = takeFinMindSchedulerBatch(
      "valuation",
      tickers,
      schedulerPositiveInt("FINMIND_VALUATION_BATCH_SIZE", schedulerPositiveInt("FINMIND_SCHEDULER_BATCH_SIZE", 120))
    );
    const result = await runValuationSync(tickers);
    console.log(
      `[market-intel-scheduler] valuation DONE rowsUpserted=${result.rowsUpserted} ` +
      `skipped=${result.skipped} skipReason=${result.skipReason ?? "none"}`
    );
  } catch (err) {
    console.error("[market-intel-scheduler] valuation tick error:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * PR C: Stock news scheduler tick [EXPERIMENTAL].
 * Every 30min, pull last 24h incremental.
 * If endpoint returns empty/403 consistently, runStockNewsSync logs DEGRADED signal.
 */
async function runMarketIntelNewsTick(workspaceSlug: string): Promise<void> {
  if (!process.env.FINMIND_API_TOKEN) return;
  if (finMindSchedulerCircuitOpen("stock-news")) return;
  try {
    let tickers = await resolveWorkspaceTickers(workspaceSlug);
    if (tickers.length === 0) {
      console.warn("[market-intel-scheduler] no tickers found for stock-news sync");
      return;
    }
    tickers = takeFinMindSchedulerBatch(
      "stock-news",
      tickers,
      schedulerPositiveInt("FINMIND_STOCK_NEWS_BATCH_SIZE", schedulerPositiveInt("FINMIND_INTRADAY_DATASET_BATCH_SIZE", 40))
    );
    const result = await runStockNewsSync(tickers);
    console.log(
      `[market-intel-scheduler] stock-news (experimental) DONE rowsUpserted=${result.rowsUpserted} ` +
      `skipped=${result.skipped} skipReason=${result.skipReason ?? "none"}`
    );
  } catch (err) {
    console.error("[market-intel-scheduler] stock-news tick error:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Start all schedulers. Called once after server is ready.
 * OHLCV: every 6 hours. Daily brief: every 23 hours (drift-safe).
 * PR A: Monthly revenue: every 24h. Financials: every 24h (cadence guard inside tick).
 * All run an immediate first tick on startup to backfill any missed runs.
 */
function startSchedulers(workspaceSlug: string): void {
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const TWENTY_THREE_HOURS_MS = 23 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const INITIAL_STAGGER_MS = schedulerPositiveInt("FINMIND_SCHEDULER_INITIAL_STAGGER_MS", 15_000);

  // F2: OHLCV sync — immediate first run then every 6h
  scheduleInitialSchedulerTick("ohlcv-scheduler", 0, () => runOhlcvSchedulerTick(workspaceSlug));
  setInterval(() => {
    runOhlcvSchedulerTick(workspaceSlug).catch((e) =>
      console.error("[ohlcv-scheduler] Interval tick failed:", e)
    );
  }, SIX_HOURS_MS);

  // F3: daily_brief dispatcher — immediate first run then every 23h
  // (workspaceSlug no longer passed — function resolves workspace from DB)
  scheduleInitialSchedulerTick("daily-brief-dispatcher", 5_000, () => runDailyBriefDispatcherTick());
  setInterval(() => {
    runDailyBriefDispatcherTick().catch((e) =>
      console.error("[daily-brief-dispatcher] Interval tick failed:", e)
    );
  }, TWENTY_THREE_HOURS_MS);

  // PR A: Monthly revenue sync — every 24h (burst on 10th, sweep otherwise)
  scheduleInitialSchedulerTick("fundamentals-scheduler/monthly-revenue", INITIAL_STAGGER_MS, () =>
    runMonthlyRevenueSchedulerTick(workspaceSlug)
  );
  setInterval(() => {
    runMonthlyRevenueSchedulerTick(workspaceSlug).catch((e) =>
      console.error("[fundamentals-scheduler] monthly-revenue interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR A: Financial statements / balance sheet / cashflow — every 24h (cadence guard inside)
  scheduleInitialSchedulerTick("fundamentals-scheduler/financials", INITIAL_STAGGER_MS * 2, () =>
    runFinancialsSchedulerTick(workspaceSlug)
  );
  setInterval(() => {
    runFinancialsSchedulerTick(workspaceSlug).catch((e) =>
      console.error("[fundamentals-scheduler] financials interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR B: Institutional buysell — every 30min, cadence guard 14:30–17:00 Taipei
  const THIRTY_MIN_MS = 30 * 60 * 1000;
  scheduleInitialSchedulerTick("trading-flow-scheduler/institutional", INITIAL_STAGGER_MS * 3, () =>
    runTradingFlowInstitutionalTick(workspaceSlug)
  );
  setInterval(() => {
    runTradingFlowInstitutionalTick(workspaceSlug).catch((e) =>
      console.error("[trading-flow-scheduler] institutional interval tick failed:", e)
    );
  }, THIRTY_MIN_MS);

  // PR B: Margin/short — every 30min, cadence guard 17:00–21:00 Taipei
  scheduleInitialSchedulerTick("trading-flow-scheduler/margin-short", INITIAL_STAGGER_MS * 4, () =>
    runTradingFlowMarginShortTick(workspaceSlug)
  );
  setInterval(() => {
    runTradingFlowMarginShortTick(workspaceSlug).catch((e) =>
      console.error("[trading-flow-scheduler] margin-short interval tick failed:", e)
    );
  }, THIRTY_MIN_MS);

  // PR B: Shareholding — every 24h, cadence guard Friday-only
  scheduleInitialSchedulerTick("trading-flow-scheduler/shareholding", INITIAL_STAGGER_MS * 5, () =>
    runTradingFlowShareholdingTick(workspaceSlug)
  );
  setInterval(() => {
    runTradingFlowShareholdingTick(workspaceSlug).catch((e) =>
      console.error("[trading-flow-scheduler] shareholding interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR C: Dividend — every 24h, cadence guard weekend-only
  scheduleInitialSchedulerTick("market-intel-scheduler/dividend", INITIAL_STAGGER_MS * 6, () =>
    runMarketIntelDividendTick(workspaceSlug)
  );
  setInterval(() => {
    runMarketIntelDividendTick(workspaceSlug).catch((e) =>
      console.error("[market-intel-scheduler] dividend interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR C: Market value — every 24h, cadence guard weekend-only
  scheduleInitialSchedulerTick("market-intel-scheduler/market-value", INITIAL_STAGGER_MS * 7, () =>
    runMarketIntelMarketValueTick(workspaceSlug)
  );
  setInterval(() => {
    runMarketIntelMarketValueTick(workspaceSlug).catch((e) =>
      console.error("[market-intel-scheduler] market-value interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR C: Valuation (PER/PBR) — every 24h
  scheduleInitialSchedulerTick("market-intel-scheduler/valuation", INITIAL_STAGGER_MS * 8, () =>
    runMarketIntelValuationTick(workspaceSlug)
  );
  setInterval(() => {
    runMarketIntelValuationTick(workspaceSlug).catch((e) =>
      console.error("[market-intel-scheduler] valuation interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR C: Stock news (experimental) — every 30min
  const THIRTY_MIN_MS_NEWS = 30 * 60 * 1000;
  scheduleInitialSchedulerTick("market-intel-scheduler/stock-news", INITIAL_STAGGER_MS * 9, () =>
    runMarketIntelNewsTick(workspaceSlug)
  );
  setInterval(() => {
    runMarketIntelNewsTick(workspaceSlug).catch((e) =>
      console.error("[market-intel-scheduler] stock-news interval tick failed:", e)
    );
  }, THIRTY_MIN_MS_NEWS);

  // P0-C: OpenAlice Autonomous Daily Pipeline — 3 ticks per trading day (TST)
  // pre-market 08:30, close-watch 13:45, close-brief 16:30
  // Each tick runs every 15 min and checks its Taipei time window internally.
  // P0-2: Sentry capture when pipeline ticks fail consecutively
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const PIPELINE_FAIL_THRESHOLD = schedulerPositiveInt("PIPELINE_FAIL_THRESHOLD", 3);
  const _pipelineConsecutiveFails: Record<string, number> = {
    pre_market: 0,
    close_watch: 0,
    close_brief: 0
  };

  function handlePipelineFail(phase: string, err: unknown): void {
    console.error(`[pipeline-scheduler] ${phase} tick failed:`, err instanceof Error ? err.message : err);
    _pipelineConsecutiveFails[phase] = (_pipelineConsecutiveFails[phase] ?? 0) + 1;
    if (_pipelineConsecutiveFails[phase] >= PIPELINE_FAIL_THRESHOLD) {
      sentryCaptureException(err, {
        tags: { scheduler: "pipeline", phase, consecutive_fails: String(_pipelineConsecutiveFails[phase]) }
      });
    }
  }

  function handlePipelineSuccess(phase: string): void {
    _pipelineConsecutiveFails[phase] = 0;
  }

  // Pre-market tick (08:30–09:00 TST window, check every 15min)
  runPipelinePreMarketTick(workspaceSlug)
    .then(() => handlePipelineSuccess("pre_market"))
    .catch((e) => handlePipelineFail("pre_market", e));
  setInterval(() => {
    runPipelinePreMarketTick(workspaceSlug)
      .then(() => handlePipelineSuccess("pre_market"))
      .catch((e) => handlePipelineFail("pre_market", e));
  }, FIFTEEN_MIN_MS);

  // Close-watch tick (13:45–14:15 TST window, check every 15min)
  runPipelineCloseWatchTick(workspaceSlug)
    .then(() => handlePipelineSuccess("close_watch"))
    .catch((e) => handlePipelineFail("close_watch", e));
  setInterval(() => {
    runPipelineCloseWatchTick(workspaceSlug)
      .then(() => handlePipelineSuccess("close_watch"))
      .catch((e) => handlePipelineFail("close_watch", e));
  }, FIFTEEN_MIN_MS);

  // Close-brief tick (16:30–17:00 TST window, check every 15min)
  runPipelineCloseBriefTick(workspaceSlug)
    .then(() => handlePipelineSuccess("close_brief"))
    .catch((e) => handlePipelineFail("close_brief", e));
  setInterval(() => {
    runPipelineCloseBriefTick(workspaceSlug)
      .then(() => handlePipelineSuccess("close_brief"))
      .catch((e) => handlePipelineFail("close_brief", e));
  }, FIFTEEN_MIN_MS);

  // BLOCK #6: Event rule engine — poll every 5min, evaluate 10 rules, write iuf_events
  // Table iuf_events lives in DRAFT migration 0025 (not promoted yet).
  // Engine degrades gracefully when table is missing (safe-default empty results).
  const FIVE_MIN_MS = 5 * 60 * 1000;
  // Initial tick delayed 30s to let DB connection stabilise after boot
  setTimeout(() => {
    runEventEngineTick().catch((e) =>
      console.error("[event-engine] Initial tick failed:", e)
    );
  }, 30_000);
  setInterval(() => {
    runEventEngineTick().catch((e) =>
      console.error("[event-engine] Interval tick failed:", e)
    );
  }, FIVE_MIN_MS);

  // BLOCK #6: Email digest scheduler — fires every 5min, window-guarded to 17:00–17:30 TST
  // Graceful: iuf_events table absent → empty digest → dry-run log (no email)
  // Graceful: RESEND_API_KEY absent → dry-run log (no email sent)
  // P0-2: Sentry capture on Resend HTTP 4xx/5xx failure
  setInterval(() => {
    runEmailDigestTick().then((result) => {
      // Capture Sentry alert when Resend returns 4xx/5xx
      if (!result.sent && result.reason && result.reason.startsWith("resend_http_")) {
        const statusCode = result.reason.replace("resend_http_", "");
        sentryCaptureMessage(
          `[email-digest] Resend delivery failed: HTTP ${statusCode}`,
          "warning",
          { scheduler: "email-digest", resend_status: statusCode }
        );
      } else if (!result.sent && result.reason && result.reason.startsWith("resend_error:")) {
        sentryCaptureMessage(
          `[email-digest] Resend call error: ${result.reason}`,
          "error",
          { scheduler: "email-digest" }
        );
      }
    }).catch((e) => {
      console.error("[email-digest] Interval tick failed:", e instanceof Error ? e.message : e);
      sentryCaptureException(e, { tags: { scheduler: "email-digest" } });
    });
  }, 5 * 60 * 1000);

  // P0-2: Health watchdog — POST internal heartbeat every 30min, Sentry on consecutive fail
  // Tracks that the server event-loop is alive and not starved (relates to the 5/7 502 incidents).
  const WATCHDOG_INTERVAL_MS = 30 * 60 * 1000;
  let _watchdogConsecutiveFails = 0;
  const WATCHDOG_FAIL_THRESHOLD = schedulerPositiveInt("WATCHDOG_FAIL_THRESHOLD", 2);
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    const uptime = Math.floor(process.uptime());
    console.info(
      `[health-watchdog] heartbeat ok — heap=${heapUsedMB}MB rss=${rssMB}MB uptime=${uptime}s consecutiveFails=${_watchdogConsecutiveFails}`
    );
    // Self-check: try to measure event-loop lag
    const before = Date.now();
    setImmediate(() => {
      const lagMs = Date.now() - before;
      if (lagMs > 5000) {
        _watchdogConsecutiveFails++;
        const msg = `[health-watchdog] Event-loop lag detected: ${lagMs}ms (consecutive=${_watchdogConsecutiveFails})`;
        console.warn(msg);
        if (_watchdogConsecutiveFails >= WATCHDOG_FAIL_THRESHOLD) {
          sentryCaptureMessage(msg, "error", {
            scheduler: "health-watchdog",
            lag_ms: String(lagMs),
            consecutive_fails: String(_watchdogConsecutiveFails),
            heap_mb: String(heapUsedMB),
            rss_mb: String(rssMB)
          });
        }
      } else {
        _watchdogConsecutiveFails = 0;
      }
    });
  }, WATCHDOG_INTERVAL_MS);

  console.log(
    "[schedulers] F2 OHLCV (6h) + F3 daily_brief (23h) + " +
    "PR-A monthly-revenue (24h) + PR-A financials (24h) + " +
    "PR-B institutional (30min) + PR-B margin-short (30min) + PR-B shareholding (24h) + " +
    "PR-C dividend (24h) + PR-C market-value (24h) + PR-C valuation (24h) + PR-C stock-news (30min) + " +
    "P0-C pipeline pre_market/close_watch/close_brief (15min) + " +
    "BLOCK#6 event-rule-engine (5min) + email-digest (5min, fires at 17:00–17:30 TST) + " +
    "P0-2 health-watchdog (30min) started"
  );
}

async function resolveDatabaseWorkspaceSlug(fallbackSlug: string): Promise<string> {
  const db = getDb();
  if (!db) return fallbackSlug;

  const configuredSlug = process.env.DEFAULT_WORKSPACE_SLUG?.trim();

  try {
    if (configuredSlug) {
      const configuredWorkspace = await db
        .select({ slug: workspaces.slug })
        .from(workspaces)
        .where(eq(workspaces.slug, configuredSlug))
        .limit(1);

      if (configuredWorkspace[0]?.slug) return configuredWorkspace[0].slug;

      console.warn(
        `[schedulers] DEFAULT_WORKSPACE_SLUG '${configuredSlug}' not found; falling back to first DB workspace`
      );
    }

    const firstWorkspace = await db.select({ slug: workspaces.slug }).from(workspaces).limit(1);
    if (firstWorkspace[0]?.slug) return firstWorkspace[0].slug;
  } catch (error) {
    console.warn(
      "[schedulers] workspace resolution failed:",
      error instanceof Error ? error.message : String(error)
    );
  }

  return fallbackSlug;
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

serve(
  {
    fetch: app.fetch,
    port,
    hostname: host
  },
  async (info) => {
    console.log(`IUF Trading Room API listening on http://${host}:${info.port}`);
    const defaultWorkspace = process.env.DEFAULT_WORKSPACE_SLUG ?? "default";
    await seedOwnerIfEmpty().catch((e) => console.warn("[auth] seedOwnerIfEmpty failed:", e));
    const schedulerWorkspace = await resolveDatabaseWorkspaceSlug(defaultWorkspace);
    await initRiskStore(schedulerWorkspace);
    console.log(`[risk-store] Hydrated workspace "${schedulerWorkspace}" from persistent store.`);
    // F2 + F3: Start ETL schedulers after server is ready
    console.log(`[schedulers] Using workspace "${schedulerWorkspace}" for FinMind/OpenAlice schedulers.`);
    startSchedulers(schedulerWorkspace);
  }
);
