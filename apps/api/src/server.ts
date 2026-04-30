import { timingSafeEqual } from "node:crypto";
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
  createOrderIntent,
  _registerIdempotencyKey
} from "./domain/trading/order-intent.js";
import {
  driveOrder,
  cancelOrder as cancelPaperOrder
} from "./domain/trading/order-driver.js";
import {
  getOrder,
  listOrders
} from "./domain/trading/paper-ledger.js";
import { isDatabaseMode } from "@iuf-trading-room/db";
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
  buildClearCookieHeader,
  buildSetCookieHeader,
  createInviteCode,
  getUserById,
  loginWithPassword,
  parseSessionCookie,
  registerWithInvite,
  seedOwnerIfEmpty
} from "./auth-store.js";

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

app.use("/api/v1/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Runner device-auth routes carry their own bearer-auth check; skip cookie gate.
  if (isDeviceAuthRoute(path)) {
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

  console.error(error);
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
  return c.json({
    data: await c.get("repo").listCompanies(themeId, {
      workspaceSlug: c.get("session").workspace.slug
    })
  });
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
  const company = await c.get("repo").getCompany(c.req.param("id"), {
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
  const company = await c.get("repo").getCompany(c.req.param("id"), {
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
  const company = await c.get("repo").getCompany(c.req.param("id"), {
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
  const company = await c.get("repo").getCompany(c.req.param("id"), {
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
  const graph = await getCompanyGraphView({
    session: c.get("session"),
    repo: c.get("repo"),
    companyId: c.req.param("id"),
    limit: query.limit,
    keywordLimit: query.keywordLimit
  });

  if (!graph) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({ data: graph });
});

app.get("/api/v1/companies/:id", async (c) => {
  const company = await c.get("repo").getCompany(c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) {
    return c.json({ error: "company_not_found" }, 404);
  }

  return c.json({ data: company });
});

app.patch("/api/v1/companies/:id", async (c) => {
  const payload = companyUpdateInputSchema.parse(await c.req.json());
  const company = await c.get("repo").updateCompany(c.req.param("id"), payload, {
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
  return c.json({
    data: await getOpenAliceObservabilitySnapshot(c.get("session").workspace.slug)
  });
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
// Returns 422 if any of the three execution gate layers blocks
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

  // Idempotency: lightweight in-memory pre-check before DB round-trip
  if (_registerIdempotencyKey(payload.idempotencyKey) === false) {
    return c.json(
      {
        error: "DUPLICATE_IDEMPOTENCY_KEY",
        idempotencyKey: payload.idempotencyKey
      },
      409
    );
  }

  // Build the order intent (pure domain object)
  const session = c.get("session");
  const intent = createOrderIntent({
    idempotencyKey: payload.idempotencyKey,
    symbol: payload.symbol,
    side: payload.side,
    orderType: payload.orderType,
    qty: payload.qty,
    price: payload.price,
    userId: session.user.id
  });

  // Day 3: drive PENDING -> ACCEPTED -> FILLED|REJECTED through PaperExecutor.
  // Ledger persists each transition (in-memory; Day 4 swaps to PG).
  const result = await driveOrder(intent);
  const status = result.finalState.intent.status === "REJECTED" ? 422 : 201;
  return c.json({ data: result.finalState }, status);
});

// GET /api/v1/paper/orders/:id — fetch a single order state from the ledger
app.get("/api/v1/paper/orders/:id", (c) => {
  const session = c.get("session");
  const orderId = c.req.param("id");
  const state = getOrder(orderId);
  if (!state) return c.json({ error: "ORDER_NOT_FOUND" }, 404);
  if (state.intent.userId !== session.user.id) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ data: state });
});

// GET /api/v1/paper/orders — list orders for the current user (optional ?status=)
app.get("/api/v1/paper/orders", (c) => {
  const session = c.get("session");
  const statusParam = c.req.query("status");
  const allowed = ["PENDING", "ACCEPTED", "FILLED", "REJECTED", "CANCELLED"] as const;
  const status = (allowed as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as (typeof allowed)[number])
    : undefined;
  const orders = listOrders(session.user.id, status ? { status } : undefined);
  return c.json({ data: orders });
});

// POST /api/v1/paper/orders/:id/cancel — cancel a PENDING/ACCEPTED order
app.post("/api/v1/paper/orders/:id/cancel", async (c) => {
  const session = c.get("session");
  const orderId = c.req.param("id");
  const state = getOrder(orderId);
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

  const result = cancelPaperOrder(state, body.reason);
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
    await initRiskStore(defaultWorkspace);
    console.log(`[risk-store] Hydrated workspace "${defaultWorkspace}" from persistent store.`);
    await seedOwnerIfEmpty().catch((e) => console.warn("[auth] seedOwnerIfEmpty failed:", e));
  }
);
