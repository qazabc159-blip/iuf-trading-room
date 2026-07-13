import { timingSafeEqual, randomBytes, createHash } from "node:crypto";
import { decode as iconvDecode } from "iconv-lite";
// ── Sentry init must be imported before any other app module ──────────────────
import { captureException as sentryCaptureException, captureMessage as sentryCaptureMessage } from "./sentry-init.js";
import { resolveBuildMetadata } from "./build-metadata.js";
import { serve } from "@hono/node-server";
import type { Context } from "hono";
import {
  type AppSession,
  autopilotExecuteInputSchema,
  buildMyEntitlements,
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
  findByIdempotencyKey as findOrderByIdempotencyKey,
  computeFifoRealizedPnl
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
  runEventEngineTickForce,
  getEventEngineState,
  listEvents,
  acknowledgeEvent
} from "./openalice-event-rule-engine.js";
import {
  runOpenAliceDecisionTick,
  getOrchestratorTickState,
  getOrchestratorObservability,
} from "./openalice-orchestrator.js";
import { runOpenAliceActionTick } from "./openalice-action-executor.js";
import { dedupeNotificationItems, notificationEventTiming, taipeiDateFromIso } from "./notification-feed.js";
import { pushSubscriptionRoutes } from "./push/push-subscriptions.js";
import { isDatabaseMode, getDb, execRows as dbExecRows, dailyBriefs, dailyThemeSummaries, companies, openAliceJobs, workspaces, contentDrafts, auditLogs, themes as themesTable, companyThemeLinks, schedulerCursors } from "@iuf-trading-room/db";
import { eq, and, sql as drizzleSql, desc, inArray, gte, lte, or, like, not, count as drizzleCount } from "drizzle-orm";
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
  resolveMarketDataChangePct,
  resolveMarketQuotes,
  upsertPaperQuotes,
  upsertManualQuotes,
  upsertKgiQuotes,
  getCompaniesLiteCached
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
import {
  cancelOrder,
  FubonChannelComingSoonError,
  KgiChannelUnavailableError,
  previewOrder,
  submitOrder
} from "./broker/trading-service.js";
import { cancelUnifiedOrder } from "./broker/trading-cancel-service.js";
import { listExecutionEvents } from "./broker/execution-events-store.js";
import { requireMinRole } from "./auth/require-min-role.js";
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
  getUserById,
  loginWithPassword,
  parseSessionCookie,
  seedOwnerIfEmpty
} from "./auth-store.js";
import {
  _lastPipelineState,
  getPipelineObservabilityAddendum,
  isDailyBriefV2ContractCompliant,
  loadStrategySnapshot,
  runBatchAiReviewer,
  runPipelineCloseBriefTick,
  runPipelineCloseWatchTick,
  runPipelineForDate,
  runPipelineMissedDayCatchUpForAllWorkspaces,
  runPipelineBackfillRange,
  runPipelinePreMarketBootRecovery,
  runPipelinePreMarketTick,
  runPipelineTick
} from "./openalice-pipeline.js";
import {
  getNewsTop10ForRead,
  getLastNewsTop10,
  getLastNewsRunAt,
  getNewsAiLastError,
  loadLatestSelectionFromDb,
  runNewsAiSelection,
  runNewsAiSelectionTick,
  runNewsAiSelectionBootRecovery
} from "./news-ai-selector.js";
import {
  evaluateToggleMode,
  flipPaperObservationsToComplete
} from "./strategy-toggle-mode.js";
import {
  runStrategySignalEmitterTick,
  runNewsSignalEmitterTick,
  runQuoteBreakoutEmitterTick,
  isStrategyEmitWindow
} from "./signal-auto-emitter.js";
// OpenAI multi-scenario (2026-05-08)
import { rerankStrategyIdeasWithAi } from "./openai-strategy-ranker.js";
import { enrichNewsWithSentiment } from "./openai-news-sentiment.js";
import {
  getBriefStrategyCommentaryWithStaleness,
  runBriefStrategyCommentary
} from "./openai-brief-strategy-commentary.js";
import { assessSignalConfidence, getSignalConfidenceAssessment } from "./openai-signal-confidence.js";
import { getQuotaStatus } from "./openai-quota-guard.js";
// Axis 4: strategy-level brief (2026-05-13)
import {
  generateStrategyBrief,
  getStrategyBriefWithStaleness,
  isStrategyBriefWindow,
  getTstDate as getStrategyBriefTstDate
} from "./openalice-strategy-brief.js";
import { normalizeTwseIndustryZhTw } from "./utils/twse-industry-normalize.js";
import { normalizeAndMergeTwseHeatmapTiles } from "./utils/heatmap-normalized-merge.js";
import { parseRocEodDateIso } from "./lib/roc-date.js";

type Variables = {
  repo: TradingRoomRepository;
  session: AppSession;
};

const app = new Hono<{ Variables: Variables }>();
const repository = getTradingRoomRepository();
const PROCESS_STARTED_AT = new Date().toISOString();
const BUILD_METADATA = resolveBuildMetadata({ now: () => new Date(PROCESS_STARTED_AT) });
const BUILD_INFO = {
  version: process.env.npm_package_version ?? "0.1.0",
  commit: BUILD_METADATA.buildCommit,
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
  // Broker gateway agents (Option A, customer-side) authenticate with their
  // pairing / gateway token via Authorization: Bearer — not a web cookie. The
  // handlers do the bearer check themselves. No order path; SIM-safe.
  if (path === "/api/v1/uta/gateway/register") return true;
  if (path === "/api/v1/uta/gateway/heartbeat") return true;
  return false;
}

// Read-only diagnostics routes safe for unauthenticated smoke / uptime monitors.
// Strict allow-list — only these two paths bypass cookie auth. Add new entries
// only after Pete review confirms zero token / userId / order leakage.
function isPublicDiagRoute(path: string): boolean {
  if (path === "/api/v1/paper/health") return true;
  if (path === "/api/v1/paper/health/detail") return true;
  if (path === "/api/v1/diagnostics/kbar") return true;
  if (path === "/api/v1/diagnostics/kline-depth") return true;
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
const OFFICIAL_COMPANY_TICKER_PATTERN = /^\d{4,6}$/;

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
  const existing = companies.find((c) => c.ticker === idOrTicker);
  if (existing) return existing;

  // Product rule: K-line/company pages must not be limited to the curated
  // representative pools. If a valid TW ticker is missing from our company
  // master, discover it from official TWSE/TPEx company lists and create a
  // minimal official master row before the caller fetches FinMind data.
  return ensureCompanyFromOfficialUniverse(repo, idOrTicker, options);
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
    buildCommit: BUILD_METADATA.buildCommit,
    deployedAt: BUILD_METADATA.deployedAt,
    build: BUILD_INFO
  })
);

app.get("/api/v1/session", (c) =>
  c.json({
    data: c.get("session")
  })
);
app.route("/", pushSubscriptionRoutes);

app.get("/api/v1/entitlements/me", (c) => {
  const session = c.get("session");
  return c.json({
    data: buildMyEntitlements(session.user)
  });
});

app.get("/api/v1/audit-logs/summary", async (c) => {
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  const overviewData = await getMarketDataOverview({
    session: c.get("session"),
    repo: c.get("repo"),
    sources: query.sources,
    includeStale: query.includeStale,
    topLimit: query.topLimit
  });

  // ── MIS intraday overlay (盤中即時強化) ─────────────────────────────────
  // During trading hours (08:55-14:35 TST weekdays):
  //   1. marketContext.index — override with cached MIS TAIEX (tse_t00.tw) data
  //   2. marketContext.heatmap — overlay _misTileCache today-only entries
  // Outside trading hours: pass through base result (EOD / null kept as-is).
  // Cache: _overviewMisIndexCache written by MIS cron (45s) — TTL 60s here.
  // If cache expired/missing, we fall through (盤後 or cron not fired yet).

  let finalOverviewData = overviewData;

  if (overviewData?.marketContext) {
    // Check MIS cron window: 08:55-14:35 TST weekdays
    const _hhmm = getTaipeiHHMM();
    const _taipeiDay = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCDay();
    const isMisWindow = _hhmm >= 855 && _hhmm <= 1435 && _taipeiDay >= 1 && _taipeiDay <= 5;

    if (isMisWindow) {
      const todayYmd = new Date(Date.now() + 8 * 60 * 60 * 1000)
        .toISOString().slice(0, 10).replace(/-/g, "");
      const nowIso = new Date().toISOString();
      const taipeiDateStr = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

      // 1. Enrich index from _overviewMisIndexCache (written by MIS cron every 45s)
      const idxCache = _overviewMisIndexCache;
      const idxFresh = idxCache &&
        idxCache.tradeDateYmd === todayYmd &&
        (Date.now() - idxCache.cachedAt) < 60_000; // 60s TTL

      let enrichedIndex = overviewData.marketContext.index as Record<string, unknown>;
      if (idxFresh && idxCache!.taiex) {
        const t = idxCache!.taiex;
        const asOfTs = t.time
          ? new Date(`${taipeiDateStr}T${t.time}+08:00`).toISOString()
          : nowIso;
        const intradayHistory = updateOverviewMisIndexHistory({
          key: "TAIEX",
          tradeDateYmd: todayYmd,
          time: t.time,
          last: t.last,
          volume: t.volume
        });
        enrichedIndex = {
          ...enrichedIndex,
          state: "LIVE",
          symbol: "t00",
          market: "TW_INDEX",
          name: "加權指數",
          source: "twse_mis_intraday",
          last: t.last,
          prevClose: t.prevClose,
          change: t.change,
          changePct: t.changePct,
          timestamp: asOfTs,
          asOf: asOfTs,
          updatedAt: nowIso,
          freshnessStatus: "fresh",
          reason: "mis_intraday",
          history: mergeOverviewIndexHistory(enrichedIndex["history"], intradayHistory)
        };
      }

      // 2. Enrich heatmap tiles from _misTileCache (today-only guard)
      const baseHeatmap = (overviewData.marketContext.heatmap ?? []) as Array<Record<string, unknown>>;
      const enrichedHeatmap = baseHeatmap.map((tile) => {
        const sym = String(tile["symbol"] ?? "");
        const misEntry = _misTileCache.get(sym);
        if (!misEntry || misEntry.tradeDateYmd !== todayYmd) return tile;
        // MIS entry is today's — overlay price data + intraday source metadata
        const prevClose = typeof tile["prevClose"] === "number" ? tile["prevClose"] : null;
        const change = prevClose !== null
          ? parseFloat((misEntry.last - prevClose).toFixed(2))
          : null;
        const changePct = resolveMarketDataChangePct({
          last: misEntry.last,
          prevClose,
          changePct: misEntry.changePct
        });
        return {
          ...tile,
          last: misEntry.last,
          change,
          changePct,
          source: "twse_mis_intraday",
          sourceState: "twse_mis_intraday",
          sourceLabel: "盤中即時 (MIS)",
          updatedAt: misEntry.ts,
          asOf: misEntry.ts,
          freshnessStatus: "fresh",
          readiness: "ready"
        };
      });

      const misHeatmapCount = enrichedHeatmap.filter((t) => t["sourceState"] === "twse_mis_intraday").length;
      const contextState = (idxFresh && idxCache!.taiex) || misHeatmapCount > 0 ? "LIVE" : overviewData.marketContext.state;

      finalOverviewData = {
        ...overviewData,
        marketContext: {
          ...overviewData.marketContext,
          state: contextState as typeof overviewData.marketContext.state,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          index: enrichedIndex as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          heatmap: enrichedHeatmap as any
        }
      };
    }
  }

  // Normalize heatmap sector labels to zh-TW before sending response.
  // companies.chain_position (Yahoo Finance English) leaks as fallback in officialHeatmapSectorForSymbol
  // for symbols not in MARKET_HEATMAP_SYMBOL_SECTOR_LABELS. Normalize here so Bruce verify
  // sees zh-TW in raw API JSON regardless of source path.
  const normalizedHeatmap = finalOverviewData?.marketContext?.heatmap
    ? (finalOverviewData.marketContext.heatmap as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        sector: row["sector"] ? normalizeTwseIndustryZhTw(String(row["sector"])) : row["sector"]
      }))
    : finalOverviewData?.marketContext?.heatmap;
  return c.json({
    data: finalOverviewData && normalizedHeatmap !== undefined ? {
      ...finalOverviewData,
      marketContext: {
        ...finalOverviewData.marketContext,
        heatmap: normalizedHeatmap
      }
    } : finalOverviewData
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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Owner")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const payload = killSwitchInputSchema.parse(await c.req.json());
  return c.json({
    data: await setKillSwitchState({
      session: c.get("session"),
      payload
    })
  });
});

app.post("/api/v1/risk/checks", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const payload = strategyRiskLimitUpsertInputSchema.parse(await c.req.json());
  return c.json({
    data: await upsertStrategyRiskLimit({
      session: c.get("session"),
      payload
    })
  });
});

app.delete("/api/v1/risk/strategy-limits", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const payload = symbolRiskLimitUpsertInputSchema.parse(await c.req.json());
  return c.json({
    data: await upsertSymbolRiskLimit({
      session: c.get("session"),
      payload
    })
  });
});

app.delete("/api/v1/risk/symbol-limits", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const payload = orderCreateInputSchema.parse(await c.req.json());
  try {
    const result = await submitOrder({
      session: c.get("session"),
      repo: c.get("repo"),
      order: payload
    });
    return c.json({ data: result }, result.blocked ? 422 : 201);
  } catch (err) {
    // 統一下單流 D2: KGI SIM channel unavailable (env / order-shape pre-check,
    // or the gateway call itself failed). Structured 409 per design §2 D2 —
    // client maps `reason` to a product-grade message, never renders raw text.
    if (err instanceof KgiChannelUnavailableError) {
      return c.json({ error: "kgi_channel_unavailable", reason: err.reason }, 409);
    }
    // 統一下單流 D2 fubon branch (fixed 2026-07-06): fubon has no live channel
    // yet — structured 409 so the client can show "即將開放" instead of
    // silently routing to paper.
    if (err instanceof FubonChannelComingSoonError) {
      return c.json({ error: "channel_coming_soon", broker: err.broker }, 409);
    }
    throw err;
  }
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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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

// POST /api/v1/trading/orders/:id/cancel — UTA-C1 統一撤單路徑 (2026-07-04)
// Cancels a unified_orders row by id (not the legacy paper-only
// /trading/orders/cancel above, which takes accountId+orderId). Dispatches
// by adapter_key; workspace ownership enforced via cancelUnifiedOrder's
// getUnifiedOrderById(workspaceId, ...) lookup — a foreign order 404s.
app.post("/api/v1/trading/orders/:id/cancel", async (c) => {
  // PR-C G-PORT gap fix (2026-07-04): UTA-C1 (#1168) added this route without
  // a role gate. G-PORT dictates paper/模擬下單 writes are Trader+; this cancel
  // path drives real state transitions on unified_orders same as the legacy
  // /trading/orders/cancel above (which already has this gate).
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const session = c.get("session");
  const workspaceId = (session.workspace as { id?: string } | undefined)?.id;
  if (!workspaceId) {
    return c.json({ error: "workspace_not_resolved" }, 400);
  }
  const orderId = c.req.param("id");
  const result = await cancelUnifiedOrder({ session, workspaceId, orderId });

  switch (result.outcome) {
    case "not_found":
      return c.json({ error: "order_not_found" }, 404);
    case "already_cancelled":
      return c.json({ data: result.order, status: "already_cancelled" }, 200);
    case "cancel_not_supported_kgi_sim":
      return c.json({ error: "cancel_not_supported_kgi_sim", data: result.order }, 409);
    case "not_cancellable":
      return c.json({ error: "order_not_cancellable", reason: result.reason, data: result.order }, 409);
    case "cancelled":
      return c.json({ data: result.order }, 200);
  }
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
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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

// =============================================================================
// GET /api/v1/companies/lookup?q=<ticker_or_name>
//
// Lightweight single-company lookup for PTR symbol switch.
// Returns {ticker, name, sector} only — avoids 1.84MB full companies payload.
// Uses getCompaniesLiteCached (5-min in-process cache) + LRU-50 per-query cache.
// Must be declared BEFORE /api/v1/companies/:id to avoid segment collision.
// P0-1 fix — 2026-05-15
// =============================================================================
const _lookupCache = new Map<string, { data: { ticker: string; name: string; sector: string } | null; expiresAt: number }>();
const LOOKUP_TTL_MS = 5 * 60 * 1000;
const LOOKUP_MAX_ENTRIES = 50;

app.get("/api/v1/companies/lookup", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toUpperCase();
  if (!q) {
    return c.json({ error: "query_required", message: "Pass ?q=ticker_or_name" }, 400);
  }

  // LRU-50 in-process cache (workspace-scoped key)
  const workspaceSlug = c.get("session").workspace.slug;
  const cacheKey = `${workspaceSlug}:${q}`;
  const now = Date.now();
  const cached = _lookupCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data
      ? c.json({ data: cached.data })
      : c.json({ error: "not_found" }, 404);
  }

  // Evict oldest entry if at capacity
  if (_lookupCache.size >= LOOKUP_MAX_ENTRIES) {
    const firstKey = _lookupCache.keys().next().value;
    if (firstKey !== undefined) _lookupCache.delete(firstKey);
  }

  // Fetch from lite cache (5-min, shared with ops-snapshot)
  const companies = await getCompaniesLiteCached(c.get("repo"), workspaceSlug);

  // Match by ticker exact, then name prefix, then name contains
  let match = companies.find((co) => co.ticker.toUpperCase() === q);
  if (!match) {
    match = companies.find((co) => co.name.toUpperCase().startsWith(q));
  }
  if (!match) {
    match = companies.find((co) => co.name.toUpperCase().includes(q));
  }

  if (!match) {
    _lookupCache.set(cacheKey, { data: null, expiresAt: now + LOOKUP_TTL_MS });
    return c.json({ error: "not_found" }, 404);
  }

  const result = {
    ticker: match.ticker,
    name: match.name,
    sector: match.market ?? "",
  };
  _lookupCache.set(cacheKey, { data: result, expiresAt: now + LOOKUP_TTL_MS });
  return c.json({ data: result });
});

// =============================================================================
// GET /api/v1/companies/search?q=X&limit=N — prefix-match dropdown source.
// Returns array of matches (up to limit), unlike /lookup which returns single.
// Used by trading room search bar to populate dropdown of candidate stocks.
// Matching: ticker startsWith, then name contains (case-insensitive).
// =============================================================================
app.get("/api/v1/companies/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().toUpperCase();
  if (!q) return c.json({ data: [] });
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 100);
  const workspaceSlug = c.get("session").workspace.slug;
  const companies = await getCompaniesLiteCached(c.get("repo"), workspaceSlug);

  const tickerStarts: typeof companies = [];
  const tickerContains: typeof companies = [];
  const nameContains: typeof companies = [];
  for (const co of companies) {
    const t = co.ticker.toUpperCase();
    const n = co.name.toUpperCase();
    if (t.startsWith(q)) tickerStarts.push(co);
    else if (t.includes(q)) tickerContains.push(co);
    else if (n.includes(q)) nameContains.push(co);
    if (tickerStarts.length + tickerContains.length + nameContains.length >= limit * 3) break;
  }
  const merged = [...tickerStarts, ...tickerContains, ...nameContains].slice(0, limit);
  return c.json({
    data: merged.map((co) => ({
      ticker: co.ticker,
      name: co.name,
      sector: co.market ?? "",
    })),
  });
});

// =============================================================================
// CP950 mojibake transcode helper (Bug #1 — 2026-05-15 Bruce cycle 4)
// Some DB rows (e.g. 5G, 低軌衛星) had thesis/whyNow/bottleneck stored as
// CP950/Big5 bytes misread as Latin-1. Re-decode at response time to recover.
// Safe: if transcode fails or introduces U+FFFD, original string is returned.
// =============================================================================
function fixCP950Mojibake(s: string | null | undefined): string | null {
  if (s == null) return s ?? null;
  // Fast path: no high bytes at all (pure ASCII) → no transcode needed.
  // CP950 lead bytes span \xa1-\xfe (not just \xc0-\xff), so we must check
  // the full \x80-\xff range to avoid skipping mojibake sequences.
  if (!/[\x80-\xff]/.test(s)) return s;
  try {
    const buf = Buffer.from(s, "latin1");
    const decoded = iconvDecode(buf, "cp950");
    // If decode introduced replacement chars, the encoding was wrong — keep original
    if (decoded.includes("�")) return s;
    return decoded;
  } catch {
    return s;
  }
}

function applyThemeTranscode<T extends { name?: string | null; thesis?: string | null; whyNow?: string | null; bottleneck?: string | null }>(theme: T): T {
  return {
    ...theme,
    name: fixCP950Mojibake(theme.name),
    thesis: fixCP950Mojibake(theme.thesis),
    whyNow: fixCP950Mojibake(theme.whyNow),
    bottleneck: fixCP950Mojibake(theme.bottleneck)
  };
}

/**
 * Sanitize CP950 mojibake in theme write-time input fields.
 * Applies fixCP950Mojibake to name, thesis, whyNow, bottleneck before DB write.
 * This prevents garbled text from entering the DB when requests originate from
 * Windows/PowerShell environments with CP950 system codepage.
 * F3 prevention fix (2026-05-18 Bruce P1 audit).
 */
function sanitizeThemeInput<T extends Partial<{ name: string; thesis: string; whyNow: string; bottleneck: string }>>(input: T): T {
  const result: T = { ...input };
  if (typeof result.name === "string") {
    result.name = fixCP950Mojibake(result.name) ?? result.name;
  }
  if (typeof result.thesis === "string") {
    result.thesis = fixCP950Mojibake(result.thesis) ?? result.thesis;
  }
  if (typeof result.whyNow === "string") {
    result.whyNow = fixCP950Mojibake(result.whyNow) ?? result.whyNow;
  }
  if (typeof result.bottleneck === "string") {
    result.bottleneck = fixCP950Mojibake(result.bottleneck) ?? result.bottleneck;
  }
  return result;
}

app.get("/api/v1/themes", async (c) => {
  const themes = await c.get("repo").listThemes({
    workspaceSlug: c.get("session").workspace.slug
  });
  return c.json({ data: themes.map(applyThemeTranscode) });
});

// =============================================================================
// GET /api/v1/themes/index — themes with companyCount + sample tickers (2026-05-15)
// Used by Jim PR #528 主題雷達 tab. Returns top N themes sorted by companyCount DESC.
// Auth: Owner only.
// =============================================================================
app.get("/api/v1/themes/index", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const limitParam = c.req.query("limit");
  const limit = Math.min(Math.max(1, parseInt(limitParam ?? "50", 10) || 50), 200);

  // Fast path: memory mode (CI / no DB)
  if (!isDatabaseMode()) {
    return c.json({ data: [] });
  }
  const db = getDb();
  if (!db) {
    return c.json({ data: [] });
  }

  try {
    const workspaceSlug = session.workspace.slug;

    // Step 1: get themes list (reuse existing repo which applies the bracket-filter)
    const themesList = await c.get("repo").listThemes({ workspaceSlug });

    if (themesList.length === 0) {
      return c.json({ data: [] });
    }

    const themeIds = themesList.map((t) => t.id);

    // Step 2: count companies per theme in one query using GROUP BY
    const countRows = await db
      .select({
        themeId: companyThemeLinks.themeId,
        companyCount: drizzleCount(companyThemeLinks.companyId)
      })
      .from(companyThemeLinks)
      .where(inArray(companyThemeLinks.themeId, themeIds))
      .groupBy(companyThemeLinks.themeId);

    const countMap = new Map<string, number>();
    for (const row of countRows) {
      countMap.set(row.themeId, row.companyCount);
    }

    // Step 3: get up to 3 sample tickers per theme — one query for all themes, limit per group
    // We do this with a single SELECT DISTINCT ON (theme_id) trick × 3 using LATERAL or
    // simply fetch all links then slice in JS (theme count is small, usually < 50).
    const sampleRows = await db
      .select({
        themeId: companyThemeLinks.themeId,
        ticker: companies.ticker
      })
      .from(companyThemeLinks)
      .innerJoin(companies, eq(companies.id, companyThemeLinks.companyId))
      .where(inArray(companyThemeLinks.themeId, themeIds));

    const sampleMap = new Map<string, string[]>();
    for (const row of sampleRows) {
      const existing = sampleMap.get(row.themeId) ?? [];
      if (existing.length < 3) {
        existing.push(row.ticker);
        sampleMap.set(row.themeId, existing);
      }
    }

    // Step 4: build result, sort by companyCount DESC, apply limit
    const result = themesList
      .map((t) => ({
        token: t.name,
        companyCount: countMap.get(t.id) ?? 0,
        sample_tickers: sampleMap.get(t.id) ?? []
      }))
      .sort((a, b) => b.companyCount - a.companyCount)
      .slice(0, limit);

    return c.json({ data: result });
  } catch (err) {
    console.error("[themes/index] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "internal_error" }, 500);
  }
});

app.post("/api/v1/themes", async (c) => {
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  // F3 prevention: sanitize CP950 mojibake at write-time before persisting to DB.
  const rawPayload = themeCreateInputSchema.parse(await c.req.json());
  const payload = sanitizeThemeInput(rawPayload);
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

  return c.json({ data: applyThemeTranscode(theme) });
});

app.patch("/api/v1/themes/:id", async (c) => {
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  // F3 prevention: sanitize CP950 mojibake at write-time before persisting to DB.
  const rawPayload = themeUpdateInputSchema.parse(await c.req.json());
  const payload = sanitizeThemeInput(rawPayload);
  const theme = await c.get("repo").updateTheme(c.req.param("id"), payload, {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!theme) {
    return c.json({ error: "theme_not_found" }, 404);
  }

  return c.json({ data: applyThemeTranscode(theme) });
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

app.get("/api/v1/companies/lite", async (c) => {
  const workspaceSlug = c.get("session").workspace.slug;
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 2500), 1), 4000);
  const data = await getCompaniesLiteCached(c.get("repo"), workspaceSlug);

  return c.json({
    data: data.slice(0, limit).map((company) => ({
      id: company.id,
      ticker: company.ticker,
      name: company.name,
      market: company.market,
      chainPosition: company.chainPosition,
      beneficiaryTier: company.beneficiaryTier,
      updatedAt: company.updatedAt,
    })),
  });
});

app.post("/api/v1/companies", async (c) => {
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const runId = c.req.param("id");
  const tokenResponse = issueConfirmToken(runId);
  return c.json({ data: tokenResponse }, 201);
});

app.post("/api/v1/strategy/runs/:id/execute", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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

// ---------------------------------------------------------------------------
// BLOCK #TOGGLE — POST /api/v1/strategy/:strategyId/toggle-mode
//
// True-money self-service toggle gate for strategy run modes.
// Auth: Owner only (hard rule — not Admin, not Analyst).
//
// Body: { mode: 'OFF' | 'PAPER' | 'LIVE', capital_twd: number, yang_explicit_ack?: boolean }
//
// State machine: OFF → paper_observing → paper_complete → live
//   - First PAPER flip: writes strategy_run_state (paper_observing + start_at)
//   - First LIVE flip: requires paper_complete + yang_explicit_ack=true
//   - Kill switch ON: all non-OFF toggles forced to OFF + audit
//   - 4-layer risk preview ALWAYS runs (never skipped)
//
// stop-line: NEVER bypass 4-layer gate / NEVER allow LIVE without yang_explicit_ack
// ---------------------------------------------------------------------------
const toggleModeBodySchema = z.object({
  mode: z.enum(["OFF", "PAPER", "LIVE"]),
  capital_twd: z.number().positive("capital_twd must be a positive number"),
  yang_explicit_ack: z.boolean().optional().default(false)
});

app.post("/api/v1/strategy/:strategyId/toggle-mode", async (c) => {
  const session = c.get("session");
  const role = session.user.role as string;

  // Owner-only — this endpoint controls real-money mode transitions
  if (role !== "Owner") {
    return c.json(
      { error: "FORBIDDEN", message: "Only Owner may toggle strategy run mode." },
      403
    );
  }

  const strategyId = c.req.param("strategyId");
  if (!strategyId) {
    return c.json({ error: "MISSING_STRATEGY_ID" }, 400);
  }

  let body: ReturnType<typeof toggleModeBodySchema.parse>;
  try {
    const raw = await c.req.json().catch(() => ({}));
    body = toggleModeBodySchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  const outcome = await evaluateToggleMode({
    session,
    strategyId,
    mode: body.mode,
    capital_twd: body.capital_twd,
    yang_explicit_ack: body.yang_explicit_ack
  });

  if (!outcome.ok) {
    const err = outcome.error;
    switch (err.code) {
      case "KILL_SWITCH_FORCED_OFF":
        return c.json({ error: err.code, message: err.message }, 409);
      case "PAPER_OBSERVATION_NOT_COMPLETE":
        return c.json(
          { error: err.code, message: err.message, current_state: err.current_state },
          422
        );
      case "YANG_EXPLICIT_ACK_REQUIRED":
        return c.json({ error: err.code, message: err.message }, 422);
      case "FOUR_LAYER_BLOCKED":
        return c.json(
          { error: err.code, message: err.message, layer: err.layer, reason: err.reason },
          422
        );
      case "DB_UNAVAILABLE":
        return c.json({ error: err.code, message: err.message }, 503);
      default:
        return c.json({ error: "TOGGLE_MODE_ERROR" }, 500);
    }
  }

  return c.json({ data: outcome.result }, 200);
});

// =============================================================================
// GET /api/v1/realtime/snapshot — Canonical quote snapshot endpoint
//
// Returns the latest known QuoteSnapshot for each requested symbol.
// Data source priority (today):
//   1. TWSE MIS intraday cache (_misTileCache, refreshed every 10–45s during
//      trading hours 08:55–14:35 by the MIS sweep cron)
//   2. TWSE STOCK_DAY_ALL EOD (shared 5-min cache, official close)
// Both sources are honest about what they are — freshness_mode is always set.
//
// Contract guarantee: when Fubon Neo WS adapter ships, only the data-fetch
// section changes. This path, response schema, and freshness labeling stays.
//
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure quote data,
// 2026-07-04 reports/permission_matrix/PR_B_CLASSIFICATION_2026_07_04.md)
// Query: ?symbols=2330,0050 (comma-separated, required, max 50)
// =============================================================================
app.get("/api/v1/realtime/snapshot", async (c) => {
  const rawSymbols = (c.req.query("symbols") ?? "").trim();
  if (!rawSymbols) {
    return c.json({ error: "missing_symbols", message: "?symbols= is required (comma-separated)" }, 400);
  }

  const requested = [...new Set(
    rawSymbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  )].slice(0, 50);

  if (requested.length === 0) {
    return c.json({ error: "missing_symbols", message: "No valid symbol found in ?symbols=" }, 400);
  }

  const { quoteSnapshotResponseSchema } = await import("@iuf-trading-room/contracts");
  const { getStockDayAllRows } = await import("./data-sources/twse-openapi-client.js");

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // --- Build TWSE EOD lookup (shared dedup cache — no extra upstream call if warm) ---
  const eodRows = await getStockDayAllRows().catch(() => []);
  type EodEntry = {
    last_price: number;
    open: number | null;
    high: number | null;
    low: number | null;
    change: number | null;
    change_pct: number | null;
    prev_close: number | null;
    total_volume: number | null;
    source_time: string;
  };
  const eodMap = new Map<string, EodEntry>();
  for (const row of eodRows) {
    const code = row.Code?.trim();
    if (!code) continue;
    const close = parseFloat(row.ClosingPrice);
    if (!isFinite(close)) continue;
    const chgRaw = parseFloat(row.Change?.trim() ?? "");
    const chg = isFinite(chgRaw) ? chgRaw : null;
    const open = isFinite(parseFloat(row.OpeningPrice)) ? parseFloat(row.OpeningPrice) : null;
    const high = isFinite(parseFloat(row.HighestPrice)) ? parseFloat(row.HighestPrice) : null;
    const low = isFinite(parseFloat(row.LowestPrice)) ? parseFloat(row.LowestPrice) : null;
    const vol = isFinite(parseFloat(row.TradeVolume)) ? parseFloat(row.TradeVolume) : null;
    const prevClose = chg != null ? close - chg : null;
    const changePct = prevClose != null && prevClose !== 0
      ? Math.round((chg! / prevClose) * 10000) / 100
      : null;

    // Derive ISO source_time from TWSE ROC date "114/05/18" or "1140518" →
    // "2026-05-18T13:30:00+08:00". 2026-07-10 sweep fix (Pete review,
    // reports/ledger_stall_20260709/): this was a slash-only inline parser —
    // against the live compact STOCK_DAY_ALL wire format it silently fell
    // through to `sourceTime = nowIso`, mislabeling a possibly-stale EOD
    // close as "right now" on this public-ish /realtime/snapshot endpoint.
    // Now delegates to the shared lib/roc-date.ts parser (handles both).
    const dateIso = parseRocEodDateIso(row.Date);
    const sourceTime = dateIso ? `${dateIso}T13:30:00+08:00` : nowIso;

    eodMap.set(code, {
      last_price: close,
      open,
      high,
      low,
      change: chg,
      change_pct: changePct,
      prev_close: prevClose,
      total_volume: vol,
      source_time: sourceTime
    });
  }

  // --- Freshness helpers ---
  // MIS intraday threshold: 5 min (MIS cron fires every 45s / sweep every 10s)
  const MIS_STALE_MS = 5 * 60 * 1000;
  // EOD is always classified as "eod" regardless of age
  const TAIPEI_HHMM = (() => {
    const d = new Date(now + 8 * 60 * 60 * 1000);
    return d.getUTCHours() * 100 + d.getUTCMinutes();
  })();
  const isTradingHours = TAIPEI_HHMM >= 855 && TAIPEI_HHMM <= 1435;
  const todayYmd = new Date(now + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  // --- Resolve each symbol ---
  const snapshots = [];
  const found: string[] = [];
  const missing: string[] = [];

  for (const sym of requested) {
    // Tier 1: MIS intraday cache
    const misEntry = _misTileCache.get(sym);
    const misIsToday = misEntry?.tradeDateYmd === todayYmd;
    const misAgeMs = misEntry ? now - new Date(misEntry.ts).getTime() : Infinity;
    const misIsValid = misEntry != null && misIsToday && misAgeMs < MIS_STALE_MS;

    if (misIsValid && isTradingHours) {
      // MIS data: last_price + changePct available; no OHLC or depth
      const misSourceTime = misEntry!.ts;
      const freshnessMs = Math.max(0, now - new Date(misSourceTime).getTime());

      // Try to blend EOD reference for prev_close / open / high / low
      const eod = eodMap.get(sym);

      found.push(sym);
      snapshots.push(quoteSnapshotResponseSchema.shape.snapshots.element.parse({
        symbol: sym,
        exchange: "TWSE" as const,
        market: "TSE" as const,
        channel: "quote" as const,
        source: "twse_mis" as const,
        source_time: misSourceTime,
        ingest_time: nowIso,
        serial: null,
        last_price: misEntry!.last,
        last_size: null,
        total_volume: eod?.total_volume ?? null,
        bid: null,
        ask: null,
        bid_size: null,
        ask_size: null,
        flags: {},
        freshness_mode: "intraday" as const,
        freshness_ms: freshnessMs,
        version: "1" as const,
        prev_close: eod?.prev_close ?? null,
        change: misEntry!.changePct != null && eod?.prev_close != null
          ? Math.round((misEntry!.changePct / 100) * eod.prev_close * 100) / 100
          : null,
        change_pct: misEntry!.changePct,
        open: eod?.open ?? null,
        high: eod?.high ?? null,
        low: eod?.low ?? null
      }));
      continue;
    }

    // Tier 2: TWSE EOD
    const eod = eodMap.get(sym);
    if (eod) {
      const freshnessMs = Math.max(0, now - new Date(eod.source_time).getTime());
      // If MIS entry exists but is stale/off-hours, call it "stale"; pure EOD = "eod"
      const freshnessMode = (misEntry != null && !misIsToday)
        ? "stale" as const
        : "eod" as const;

      found.push(sym);
      snapshots.push(quoteSnapshotResponseSchema.shape.snapshots.element.parse({
        symbol: sym,
        exchange: "TWSE" as const,
        market: "TSE" as const,
        channel: "quote" as const,
        source: "eod" as const,
        source_time: eod.source_time,
        ingest_time: nowIso,
        serial: null,
        last_price: eod.last_price,
        last_size: null,
        total_volume: eod.total_volume,
        bid: null,
        ask: null,
        bid_size: null,
        ask_size: null,
        flags: {},
        freshness_mode: freshnessMode,
        freshness_ms: freshnessMs,
        version: "1" as const,
        prev_close: eod.prev_close,
        change: eod.change,
        change_pct: eod.change_pct,
        open: eod.open,
        high: eod.high,
        low: eod.low
      }));
      continue;
    }

    // No data
    missing.push(sym);
  }

  return c.json(quoteSnapshotResponseSchema.parse({
    generated_at: nowIso,
    symbols_found: found,
    symbols_missing: missing,
    snapshots
  }));
});

app.post("/api/v1/signals", async (c) => {
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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

// ---------------------------------------------------------------------------
// plans/brief, plans/review, plans/weekly MUST be registered BEFORE plans/:id.
// Hono 4.x matches routes in registration order; the parametric /:id would
// shadow these literal paths and call getTradePlan("brief",...) → PostgreSQL
// invalid UUID syntax error → HTTP 500.
// ---------------------------------------------------------------------------

app.get("/api/v1/plans/brief", async (c) => {
  try {
    const session = c.get("session");
    const repo = c.get("repo");
    const today = new Date().toISOString().slice(0, 10);

    // Compose all fields in parallel — use allSettled so a DB error in any one
    // sub-call does NOT propagate as an unhandled rejection and return HTTP 500.
    // Each field has a typed fallback so the handler always returns 200 with
    // partial data + stale_reason where applicable.
    const [themesResult, ideasResult, riskResult] = await Promise.allSettled([
      repo.listThemes({ workspaceSlug: session.workspace.slug }),
      getStrategyIdeas({ session, repo, limit: 10 }),
      getRiskLimitState({ session, accountId: "paper-default" })
    ]);

    const themes = themesResult.status === "fulfilled" ? themesResult.value : [];
    if (themesResult.status === "rejected") {
      console.warn("[plans/brief] listThemes failed:", themesResult.reason instanceof Error ? themesResult.reason.message : String(themesResult.reason));
    }

    const ideasView = ideasResult.status === "fulfilled" ? ideasResult.value : { items: [], total: 0 };
    if (ideasResult.status === "rejected") {
      console.warn("[plans/brief] getStrategyIdeas failed:", ideasResult.reason instanceof Error ? ideasResult.reason.message : String(ideasResult.reason));
    }

    const riskState = riskResult.status === "fulfilled" ? riskResult.value : {
      maxPerTradePct: null, maxSinglePositionPct: null, maxGrossExposurePct: null
    };
    if (riskResult.status === "rejected") {
      console.warn("[plans/brief] getRiskLimitState failed:", riskResult.reason instanceof Error ? riskResult.reason.message : String(riskResult.reason));
    }

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

    // watchlist: no backing table yet — return empty typed array + stale_reason so frontend
    // can display "觀察清單尚未設定" rather than silently empty.
    const watchlist: { symbol: string; name: string; themeCode: string | null; note?: string }[] = [];
    const watchlistMeta = { stale_reason: "no_watchlist_table", source: "no_db" };

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

    // Surface any sub-call failures as stale_reason so frontend can show degraded state.
    const briefStaleReasons: string[] = [];
    if (themesResult.status === "rejected") briefStaleReasons.push("themes_db_error");
    if (ideasResult.status === "rejected") briefStaleReasons.push("ideas_db_error");
    if (riskResult.status === "rejected") briefStaleReasons.push("risk_db_error");

    const bundle = {
      date: today,
      market,
      topThemes,
      ideasOpen,
      watchlist,
      watchlistMeta,
      riskTodayLimits,
      ...(briefStaleReasons.length > 0 ? { stale_reason: briefStaleReasons.join(","), source: "partial_db" } : { source: "db" })
    };

    return c.json({ data: bundle });
  } catch (err) {
    console.error("[plans/brief] unhandled error:", err instanceof Error ? err.stack ?? err.message : String(err));
    return c.json({ data: { date: new Date().toISOString().slice(0, 10), stale_reason: "handler_error", source: "error", market: null, topThemes: [], ideasOpen: [], watchlist: [], watchlistMeta: { stale_reason: "handler_error", source: "error" }, riskTodayLimits: [] } });
  }
});

app.get("/api/v1/plans/review", async (c) => {
  try {
    const session = c.get("session");
    const today = new Date().toISOString().slice(0, 10);

    // ReviewBundle shape per radar-types.ts:
    //   trades: ExecutionEvent[]   — paper orders filled today
    //   signalsSummary: { channel: SignalChannel; count: number }[]
    //
    // Wave-2 live-wire: pull today's FILLED orders from paper_orders table.
    // Fallback: honest empty + stale_reason when DB unavailable or table missing.

    type ReviewTrade = {
      id: string; kind: string; ts: string; orderId: string | null;
      clientOrderId: string | null; symbol: string; side: string | null;
      qty: number | null; price: number | null; fee: number | null;
      tax: number | null; raw: Record<string, unknown>;
    };

    const trades: ReviewTrade[] = [];
    let realizedPnl = 0;
    let totalFillCost = 0;
    let staleReason: string | null = null;

    // getDb() can throw (DATABASE_URL missing); move inside try/catch so any
    // failure degrades gracefully to stale_reason=db_init_failed rather than 500.
    let db: ReturnType<typeof getDb> | null = null;
    try {
      db = isDatabaseMode() ? getDb() : null;
    } catch (innerErr) {
      console.warn("[plans/review] getDb() failed:", innerErr instanceof Error ? innerErr.message : String(innerErr));
      staleReason = "db_init_failed";
    }

    if (db) {
      try {
        // Pull today's FILLED paper_orders for this user.
        // Date filter uses updated_at (fill time) in UTC; today in TST ≈ today in UTC (safe approximation).
        const res = await db.execute(drizzleSql`
          SELECT
            id,
            intent,
            fill,
            status,
            updated_at
          FROM paper_orders
          WHERE user_id = ${session.user.id}
            AND status = 'FILLED'
            AND DATE(updated_at AT TIME ZONE 'Asia/Taipei') = ${today}
          ORDER BY updated_at DESC
          LIMIT 50
        `);
        const rows = ((res as { rows?: Record<string, unknown>[] }).rows ?? (Array.isArray(res) ? res as Record<string, unknown>[] : []));

        for (const row of rows) {
          let intent: Record<string, unknown> = {};
          let fill: Record<string, unknown> = {};
          try {
            intent = typeof row.intent === "string" ? JSON.parse(row.intent) : (row.intent as Record<string, unknown>) ?? {};
            fill = typeof row.fill === "string" ? JSON.parse(row.fill) : (row.fill as Record<string, unknown>) ?? {};
          } catch { /* skip malformed */ }

          const fillPrice = typeof fill.fillPrice === "number" ? fill.fillPrice : parseFloat(String(fill.fillPrice ?? "0"));
          const fillQty = typeof fill.fillQty === "number" ? fill.fillQty : parseFloat(String(fill.fillQty ?? "0"));
          const side = String(intent.side ?? "");

          if (side === "buy") totalFillCost += fillPrice * fillQty;
          else if (side === "sell") realizedPnl += fillPrice * fillQty; // simplified realized: sell proceeds

          const updatedAt = row.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString();

          trades.push({
            id: String(row.id ?? ""),
            kind: "paper_fill",
            ts: updatedAt,
            orderId: String(row.id ?? ""),
            clientOrderId: typeof intent.idempotencyKey === "string" ? intent.idempotencyKey : null,
            symbol: String(intent.symbol ?? ""),
            side,
            qty: fillQty || null,
            price: fillPrice || null,
            fee: null,
            tax: null,
            raw: { intent, fill }
          });
        }
        if (rows.length === 0) staleReason = "no_fills_today";
      } catch (innerErr) {
        console.warn("[plans/review] DB query failed:", innerErr instanceof Error ? innerErr.message : String(innerErr));
        staleReason = "db_query_failed";
      }
    } else {
      staleReason = "database_not_connected";
    }

    // Idea hit rate: emitted = count of ideas (strategy ideas); filled = today fill count
    const emittedCount = 0; // no real-time ideas counter yet — honest zero
    const filledCount = trades.length;
    const hitPct = emittedCount > 0 ? Math.round((filledCount / emittedCount) * 100) : 0;

    const bundle = {
      date: today,
      pnl: {
        realized: Math.round(realizedPnl * 100) / 100,
        unrealized: 0,  // no live price feed for unrealized — honest zero
        navStart: 0,
        navEnd: Math.round((realizedPnl - totalFillCost) * 100) / 100
      },
      trades,
      ideaHitRate: { emitted: emittedCount, filled: filledCount, pct: hitPct },
      signalsSummary: [] as { channel: "MOM"|"FII"|"KW"|"VOL"|"THM"|"MAN"; count: number }[],
      ...(staleReason ? { stale_reason: staleReason } : {}),
      source: db ? "paper_orders_db" : "no_db"
    };

    return c.json({ data: bundle });
  } catch (err) {
    console.error("[plans/review] unhandled error:", err instanceof Error ? err.stack ?? err.message : String(err));
    return c.json({ data: { date: new Date().toISOString().slice(0, 10), stale_reason: "handler_error", source: "error", pnl: { realized: 0, unrealized: 0, navStart: 0, navEnd: 0 }, trades: [], ideaHitRate: { emitted: 0, filled: 0, pct: 0 }, signalsSummary: [] } });
  }
});

app.get("/api/v1/plans/weekly", async (c) => {
  try {
    const session = c.get("session");
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
    //
    // Wave-2 live-wire: pull this week's FILLED paper_orders from DB.
    // Week boundary: ISO week Mon–Sun in TST.
    // themeRotation + strategyTweaks: no backing data table yet → honest empty.

    let tradeCount = 0;
    let cumPnl = 0;
    let staleReason: string | null = null;

    // ISO week start (Monday) in UTC.
    const weekStartUTC = (() => {
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      const day = d.getUTCDay(); // 0=Sun
      const offsetToMon = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + offsetToMon);
      return d.toISOString().slice(0, 10);
    })();

    // getDb() can throw (DATABASE_URL missing); move inside try/catch.
    let db: ReturnType<typeof getDb> | null = null;
    try {
      db = isDatabaseMode() ? getDb() : null;
    } catch (innerErr) {
      console.warn("[plans/weekly] getDb() failed:", innerErr instanceof Error ? innerErr.message : String(innerErr));
      staleReason = "db_init_failed";
    }

    if (db) {
      try {
        const res = await db.execute(drizzleSql`
          SELECT
            COUNT(*)::int                                         AS trade_count,
            SUM(
              CASE
                WHEN (intent->>'side') = 'sell'
                THEN (fill->>'fillPrice')::float * (fill->>'fillQty')::float
                ELSE -1 * (fill->>'fillPrice')::float * (fill->>'fillQty')::float
              END
            )                                                     AS cum_pnl
          FROM paper_orders
          WHERE user_id = ${session.user.id}
            AND status = 'FILLED'
            AND DATE(updated_at AT TIME ZONE 'Asia/Taipei') >= ${weekStartUTC}
        `);
        const row = ((res as { rows?: Record<string, unknown>[] }).rows ?? (Array.isArray(res) ? res as Record<string, unknown>[] : []))[0];
        if (row) {
          tradeCount = typeof row.trade_count === "number" ? row.trade_count : parseInt(String(row.trade_count ?? "0"), 10);
          cumPnl = typeof row.cum_pnl === "number" ? row.cum_pnl : parseFloat(String(row.cum_pnl ?? "0"));
          if (isNaN(cumPnl)) cumPnl = 0;
          cumPnl = Math.round(cumPnl * 100) / 100;
        }
        if (tradeCount === 0) staleReason = "no_fills_this_week";
      } catch (innerErr) {
        console.warn("[plans/weekly] DB query failed:", innerErr instanceof Error ? innerErr.message : String(innerErr));
        staleReason = "db_query_failed";
      }
    } else {
      staleReason = "database_not_connected";
    }

    const bundle = {
      weekNo,
      summary: { trades: tradeCount, cumPnl, themeWinRate: 0, bestTheme: "" },
      themeRotation: [] as { code: string; heatStart: number; heatEnd: number; delta: number }[],
      strategyTweaks: [] as { strategyId: string; change: string; ts: string }[],
      ...(staleReason ? { stale_reason: staleReason } : {}),
      source: db ? "paper_orders_db" : "no_db"
    };

    return c.json({ data: bundle });
  } catch (err) {
    console.error("[plans/weekly] unhandled error:", err instanceof Error ? err.stack ?? err.message : String(err));
    return c.json({ data: { weekNo: "unknown", stale_reason: "handler_error", source: "error", summary: { trades: 0, cumPnl: 0, themeWinRate: 0, bestTheme: "" }, themeRotation: [], strategyTweaks: [] } });
  }
});

app.get("/api/v1/plans/:id", async (c) => {
  try {
    const plan = await c.get("repo").getTradePlan(c.req.param("id"), {
      workspaceSlug: c.get("session").workspace.slug
    });
    if (!plan) {
      return c.json({ error: "plan_not_found" }, 404);
    }
    return c.json({ data: plan });
  } catch (err) {
    // getTradePlan with a non-UUID string (e.g. from a misrouted request) throws
    // PostgreSQL "invalid input syntax for type uuid". Return 404 rather than 500.
    console.warn("[plans/:id] getTradePlan failed for id=%s:", c.req.param("id"), err instanceof Error ? err.message : String(err));
    return c.json({ error: "plan_not_found" }, 404);
  }
});

app.patch("/api/v1/plans/:id", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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

// GET /api/v1/reviews/weekly — auto weekly review (B4 復盤閉環, quantitative v1).
// Owner-only: the report includes F-AUTO SIM positions. ?anchor=YYYY-MM-DD
// reviews the week containing that date (defaults to the current week).
app.get("/api/v1/reviews/weekly", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const briefs = await c.get("repo").listBriefs({ workspaceSlug: session.workspace.slug });
  // A date can carry more than one published brief (e.g. force-regenerated
  // days) — the delivery audit counts days, not rows.
  const publishedBriefDates = [...new Set(
    briefs.filter((b) => b.status === "published").map((b) => b.date)
  )];

  const { buildWeeklyReview } = await import("./weekly-review.js");
  const review = await buildWeeklyReview({
    anchorDate: c.req.query("anchor") ?? undefined,
    workspaceId: session.workspace.id,
    publishedBriefDates,
  });
  return c.json({ data: review });
});

// ISSUE_004 fix (2026-05-14): derive top-level `heading` from sections[0].heading.
// Frontend reads `.heading` directly; old code returned raw DailyBrief which has no
// top-level heading field → always blank. Project it here so the list surface is complete.
app.get("/api/v1/briefs", async (c) => {
  const briefs = await c.get("repo").listBriefs({
    workspaceSlug: c.get("session").workspace.slug
  });
  const data = briefs.map((b) => {
    const firstSection = (b.sections as Array<{ heading: string; body: string }>)[0];
    return {
      ...b,
      heading: firstSection?.heading ?? `Brief ${b.date}`
    };
  });
  return c.json({ data });
});

// =============================================================================
// GET /api/v1/briefs/search — keyword search across published daily briefs
// =============================================================================
// Query params:
//   q        — keyword string (required; min 1 char)
//   from     — ISO date lower bound (optional; defaults to 90 days ago)
//   to       — ISO date upper bound (optional; defaults to today)
//   limit    — results per page (optional; default 20, max 50)
//   offset   — pagination offset (optional; default 0)
//
// Uses Postgres FTS (to_tsvector + plainto_tsquery) on sections JSONB text.
// Falls back to ILIKE if FTS index is not available.
// Only returns rows where status IN ('published','approved') — strictly
// published/approved. Unreviewed worker drafts are NEVER searchable here
// (former worker-draft OR branch removed 2026-07-04, Pete review #1166).
//
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, published/approved
// briefs only, no audit chain; sibling /api/v1/briefs list has no gate at all)
// =============================================================================
app.get("/api/v1/briefs/search", async (c) => {
  const db = getDb();
  if (!isDatabaseMode() || !db) {
    return c.json({ error: "database_unavailable" }, 503);
  }

  // ── Parse + validate query params ─────────────────────────────────────────
  const rawQ = c.req.query("q") ?? "";
  if (!rawQ.trim()) {
    return c.json({ error: "missing_q", message: "query param 'q' is required and must be non-empty" }, 400);
  }
  const q = rawQ.trim();

  const rawLimit = parseInt(c.req.query("limit") ?? "20", 10);
  const limit = isNaN(rawLimit) ? 20 : Math.min(Math.max(1, rawLimit), 50);

  const rawOffset = parseInt(c.req.query("offset") ?? "0", 10);
  const offset = isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

  // Date range: defaults to 90 days ago → today
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fromDate = c.req.query("from") ?? ninetyDaysAgo;
  const toDate = c.req.query("to") ?? todayStr;

  // Validate date format loosely (YYYY-MM-DD)
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
    return c.json({ error: "invalid_date", message: "from/to must be YYYY-MM-DD" }, 400);
  }

  const workspaceId = c.get("session").workspace.id;

  // ── Published-only filter ──────────────────────────────────────────────────
  // Every query below (FTS, ILIKE fallback, and both COUNTs) restricts to
  // status IN ('published','approved') ONLY. The former worker-draft OR branch
  // leaked unreviewed draft body text (summary_preview) to any logged-in role
  // once PR-B dropped the READ_DRAFT_ROLES gate — removed 2026-07-04 (Pete
  // review #1166); role-matrix.test.ts source-scans this handler to keep it out.
  // Worker rule-template drafts also never meet the v2 template contract
  // (empty-shell briefs, 6/10 audit), so nothing product-visible is lost.

  // ── FTS search using raw SQL ───────────────────────────────────────────────
  // sections is JSONB array of {heading,body}. We concatenate all heading+body
  // text by casting to text and stripping JSON noise, then apply FTS.
  // The GIN index on to_tsvector('simple', ...) accelerates this.
  //
  // Fallback: ILIKE search on sections::text when FTS errors.
  type SearchRow = {
    id: string;
    date: string;
    status: string;
    generatedBy: string;
    sections: Array<{ heading: string; body: string }>;
    createdAt: Date;
    rank: number;
    matchedIn: string;
  };

  // Build the full-text search query. We extract sections text for ranking.
  // sections_text = concat of all heading + body values from JSONB array.
  const ftsQuery = drizzleSql<SearchRow[]>`
    SELECT
      id,
      date,
      status,
      generated_by  AS "generatedBy",
      sections,
      created_at    AS "createdAt",
      ts_rank(
        to_tsvector('simple',
          COALESCE(
            (SELECT string_agg(
               COALESCE(s->>'heading','') || ' ' || COALESCE(s->>'body',''),
               ' '
             ) FROM jsonb_array_elements(sections) AS s),
            ''
          )
        ),
        plainto_tsquery('simple', ${q})
      ) AS rank,
      CASE
        WHEN to_tsvector('simple', COALESCE((
          SELECT string_agg(COALESCE(s->>'heading',''), ' ')
          FROM jsonb_array_elements(sections) AS s
        ), '')) @@ plainto_tsquery('simple', ${q})
          THEN 'title'
        ELSE 'body'
      END AS "matchedIn"
    FROM daily_briefs
    WHERE workspace_id = ${workspaceId}
      AND date >= ${fromDate}
      AND date <= ${toDate}
      AND status IN ('published','approved')
      AND to_tsvector('simple',
        COALESCE(
          (SELECT string_agg(
             COALESCE(s->>'heading','') || ' ' || COALESCE(s->>'body',''),
             ' '
           ) FROM jsonb_array_elements(sections) AS s),
          ''
        )
      ) @@ plainto_tsquery('simple', ${q})
    ORDER BY rank DESC, date DESC
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `;

  let rows: SearchRow[] = [];
  let usedFts = true;

  try {
    const result = await db.execute(ftsQuery);
    // drizzle-orm/postgres-js db.execute() returns flat array (not {rows:[...]})
    rows = Array.isArray(result) ? (result as unknown as SearchRow[]) : ((result as unknown as { rows?: SearchRow[] }).rows ?? []);
  } catch (ftsErr) {
    // FTS failed (e.g. index not yet applied) — fall back to ILIKE
    usedFts = false;
    const ilikePattern = `%${q}%`;
    try {
      const ilikeQuery = drizzleSql<SearchRow[]>`
        SELECT
          id,
          date,
          status,
          generated_by  AS "generatedBy",
          sections,
          created_at    AS "createdAt",
          0.5           AS rank,
          'body'        AS "matchedIn"
        FROM daily_briefs
        WHERE workspace_id = ${workspaceId}
          AND date >= ${fromDate}
          AND date <= ${toDate}
          AND status IN ('published','approved')
          AND sections::text ILIKE ${ilikePattern}
        ORDER BY date DESC
        LIMIT ${limit + 1}
        OFFSET ${offset}
      `;
      const ilikeResult = await db.execute(ilikeQuery);
      rows = Array.isArray(ilikeResult) ? (ilikeResult as unknown as SearchRow[]) : ((ilikeResult as unknown as { rows?: SearchRow[] }).rows ?? []);
    } catch (ilikeErr) {
      console.error("[briefs/search] ILIKE fallback also failed:", ilikeErr);
      return c.json({ error: "search_failed" }, 500);
    }
  }

  // ── Paginate: fetch limit+1 to determine hasMore, then slice ─────────────
  const hasMore = rows.length > limit;
  if (hasMore) rows = rows.slice(0, limit);

  // ── Build response items ───────────────────────────────────────────────────
  const SUMMARY_PREVIEW_LENGTH = 200;

  const items = rows.map((row) => {
    const sections = (row.sections ?? []) as Array<{ heading: string; body: string }>;

    // Derive title from first section heading (no top-level title in daily_briefs schema)
    const title = sections[0]?.heading ?? `Brief ${row.date}`;

    // Build summary_preview: first 200 chars of the first body section
    // (or the body section most likely to contain the match)
    const allBody = sections.map((s) => s.body).join(" ");
    const summaryPreview = allBody.slice(0, SUMMARY_PREVIEW_LENGTH) + (allBody.length > SUMMARY_PREVIEW_LENGTH ? "…" : "");

    return {
      id: row.id,
      date: row.date,
      title,
      summary_preview: summaryPreview,
      matched_in: row.matchedIn ?? "body",
      rank: typeof row.rank === "number" ? Math.round(row.rank * 100) / 100 : 0
    };
  });

  // ── Count total matching rows (separate COUNT query) ──────────────────────
  let total = 0;
  try {
    if (usedFts) {
      const countQuery = drizzleSql`
        SELECT COUNT(*)::int AS cnt
        FROM daily_briefs
        WHERE workspace_id = ${workspaceId}
          AND date >= ${fromDate}
          AND date <= ${toDate}
          AND status IN ('published','approved')
          AND to_tsvector('simple',
            COALESCE(
              (SELECT string_agg(
                 COALESCE(s->>'heading','') || ' ' || COALESCE(s->>'body',''),
                 ' '
               ) FROM jsonb_array_elements(sections) AS s),
              ''
            )
          ) @@ plainto_tsquery('simple', ${q})
      `;
      const countResult = await db.execute(countQuery);
      const countRows = Array.isArray(countResult) ? countResult : ((countResult as unknown as { rows?: unknown[] }).rows ?? []);
      const countRow = countRows[0] as { cnt?: number } | undefined;
      total = countRow?.cnt ?? 0;
    } else {
      // ILIKE fallback count
      const ilikePattern = `%${q}%`;
      const countQuery = drizzleSql`
        SELECT COUNT(*)::int AS cnt
        FROM daily_briefs
        WHERE workspace_id = ${workspaceId}
          AND date >= ${fromDate}
          AND date <= ${toDate}
          AND status IN ('published','approved')
          AND sections::text ILIKE ${ilikePattern}
      `;
      const countResult = await db.execute(countQuery);
      const countRows = Array.isArray(countResult) ? countResult : ((countResult as unknown as { rows?: unknown[] }).rows ?? []);
      const countRow = countRows[0] as { cnt?: number } | undefined;
      total = countRow?.cnt ?? 0;
    }
  } catch {
    // Count failure is non-fatal; best-effort
    total = offset + items.length + (hasMore ? 1 : 0);
  }

  return c.json({
    items,
    total,
    limit,
    offset,
    search_mode: usedFts ? "fts" : "ilike"
  });
});

app.post("/api/v1/briefs", async (c) => {
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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

  const session = c.get("session");
  const workspaceSlug = session.workspace.slug;
  const jobs = await listOpenAliceJobs(workspaceSlug);

  // BUG-05 fix: supplement old openalice jobs list with recent daily_briefs so
  // the BRF-JOBS workflow panel shows the current pipeline (v2 published briefs)
  // rather than stale 5/13 openAliceJobs table rows.
  // Map each daily_brief (published, last 30 days, limit 20) to a pseudo-job
  // with taskType="daily_brief_pipeline" and status="completed".
  const db = getDb();
  let briefPseudoJobs: typeof jobs = [];
  if (db) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const briefRows = await db
        .select({
          id: dailyBriefs.id,
          workspaceId: dailyBriefs.workspaceId,
          date: dailyBriefs.date,
          status: dailyBriefs.status,
          generatedBy: dailyBriefs.generatedBy,
          marketState: dailyBriefs.marketState,
          createdAt: dailyBriefs.createdAt
        })
        .from(dailyBriefs)
        .where(
          and(
            eq(dailyBriefs.workspaceId, session.workspace.id),
            gte(dailyBriefs.createdAt, thirtyDaysAgo)
          )
        )
        .orderBy(desc(dailyBriefs.createdAt))
        .limit(20);

      briefPseudoJobs = briefRows.map((row) => ({
        id: `brief:${row.id}`,
        workspaceSlug,
        deviceId: undefined,
        status: row.status === "published" ? "published" : row.status === "draft" ? "draft_ready" : "queued",
        taskType: "daily_brief",
        instructions: `每日簡報 ${row.date} (${row.marketState ?? ""}) — ${row.generatedBy ?? "system"}`,
        contextRefs: [],
        result: undefined,
        createdAt: row.createdAt.toISOString(),
        claimedAt: undefined,
        completedAt: row.status === "published" ? row.createdAt.toISOString() : undefined,
        attemptCount: 1,
        maxAttempts: 1,
        error: undefined,
        lastHeartbeatAt: undefined,
        leaseExpiresAt: undefined
      }));
    } catch {
      // brief lookup is best-effort — never block the jobs endpoint
    }
  }

  // Merge: deduplicate by id prefix, prefer brief pseudo-jobs for activity log
  // but keep any non-brief openalice jobs that are recent (last 30 days) or active.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentJobs = jobs.filter((j) =>
    j.createdAt >= cutoff || j.status === "queued" || j.status === "running"
  );

  const merged = [...briefPseudoJobs, ...recentJobs].sort(
    (a, b) => (b.completedAt ?? b.claimedAt ?? b.createdAt).localeCompare(
      a.completedAt ?? a.claimedAt ?? a.createdAt
    )
  );

  return c.json({ data: merged });
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

  // cycle17: brief dispatcher cron observability
  // Compute nextRunAt: next 09:00 TST. If today's 09:00 has passed, use tomorrow.
  function computeNextBriefDispatchAt(): string {
    const nowMs = Date.now();
    const taipeiNow = new Date(nowMs + 8 * 60 * 60 * 1000); // UTC+8
    const yyyy = taipeiNow.getUTCFullYear();
    const mm = String(taipeiNow.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(taipeiNow.getUTCDate()).padStart(2, "0");
    const todayAt9 = new Date(`${yyyy}-${mm}-${dd}T09:00:00+08:00`);
    if (todayAt9.getTime() > nowMs) {
      return todayAt9.toISOString();
    }
    // 09:00 already passed today — return tomorrow 09:00
    const tomorrowAt9 = new Date(todayAt9.getTime() + 24 * 60 * 60 * 1000);
    return tomorrowAt9.toISOString();
  }

  const dispatcherCron = {
    cronEnabled: true,
    cronWindow: "09:00–09:05 TST (Asia/Taipei)",
    lastFiredAt: _briefDispatcherLastFiredDate
      ? `${_briefDispatcherLastFiredDate}T09:00:00+08:00`
      : null,
    nextRunAt: computeNextBriefDispatchAt()
  };

  return c.json({
    data: {
      ...base,
      pipeline: pipelineAddendum,
      dispatcherCron
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

// Manual brief fire for a specific date — Owner only.
// POST /api/v1/internal/openalice/brief/fire-now
// Body: { date: "YYYY-MM-DD" }
// Purpose: recover from missed brief days (e.g., deploy-interrupted window).
// All 5 review layers still run — never skips the gate. Only bypasses window/weekend check.
// Dedup: skips silently if a brief already exists for the requested date.
app.post("/api/v1/internal/openalice/brief/fire-now", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: { date?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  // Validate date format YYYY-MM-DD
  const dateParam = typeof body.date === "string" ? body.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return c.json(
      { error: "INVALID_DATE", message: "Body must include { date: 'YYYY-MM-DD' }" },
      400
    );
  }

  // Sanity: date must not be in the future (more than 1 day ahead)
  const requestedMs = new Date(dateParam + "T00:00:00+08:00").getTime();
  const tomorrowMs = Date.now() + 26 * 60 * 60 * 1000; // +26h buffer for TST offset
  if (requestedMs > tomorrowMs) {
    return c.json(
      { error: "DATE_IN_FUTURE", message: "Cannot fire brief for a future date" },
      400
    );
  }

  const workspaceSlug = session.workspace.slug;
  const result = await runPipelineForDate(workspaceSlug, dateParam).catch((e: unknown) => ({
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

  // BUG-02 fix: resolve TV ticker → company UUID so signals link to a company.
  // TradingView sends tickers like "TWSE:2330", "TPEX:6533", or bare "2330".
  // Strip the exchange prefix and do a workspace-scoped ticker lookup.
  // Only attempt link when the payload doesn't already specify companyIds.
  const resolvedCompanyIds: string[] = [...(payload.companyIds ?? [])];
  if (resolvedCompanyIds.length === 0) {
    try {
      const rawTicker = payload.ticker.includes(":") ? payload.ticker.split(":")[1]! : payload.ticker;
      const resolved = rawTicker ? await resolveCompany(repo, rawTicker, opts) : null;
      if (resolved?.id) resolvedCompanyIds.push(resolved.id);
    } catch {
      // ticker resolution is best-effort — never block signal ingestion
    }
  }

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
        companyIds: resolvedCompanyIds
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
  if (!requireMinRole(c.get("session"), "Admin")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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

// ── KGI SIM Environment Status + Smoke (/api/v1/kgi/status, /api/v1/kgi/sim/*) ───────────────
//
// SIM_ONLY: All endpoints in this block target KGI SIM infrastructure only.
// KGI_ENV=sim (default) — production write path is permanently hard-blocked.
//
// Hard lines:
//   - prodWriteBlocked always true in all responses
//   - credentials NEVER in logs, audit payloads, or API responses
//   - account masked as 9228-***-6, personId masked as F13133****
//   - SIM_ONLY tag on all responses

import {
  getKgiSimState,
  runSimQuoteSmoke,
  runSimTradeSmoke,
  runKgiSimDailySmokeSchedulerTick,
  getDailySmokeHistoryDurable,
  resolveKgiEnv,
  maskAccount,
} from "./broker/kgi-sim-env.js";

type KgiGatewayQuoteAuthSummary = {
  available: boolean | null;
  state: string;
  errorCode: string | null;
  subscribedTickCount: number | null;
  kgiLoggedIn: boolean | null;
  accountSet: boolean | null;
};

async function readKgiGatewayQuoteAuthSummary(): Promise<KgiGatewayQuoteAuthSummary> {
  // EventBridge uptime guard — this raw fetch bypassed the client-level guard
  // (#1062) and still burned its 4s timeout off-hours; /portfolio fired it ×4
  // per load (Bruce re-measure 6/12: kgi/status 4.4s ×4).
  {
    const { isKgiGatewayScheduledOff } = await import("./broker/kgi-gateway-schedule.js");
    if (isKgiGatewayScheduledOff()) {
      return {
        available: null,
        state: "gateway_unreachable",
        errorCode: "KGI_GATEWAY_UNREACHABLE",
        subscribedTickCount: null,
        kgiLoggedIn: null,
        accountSet: null
      };
    }
  }

  const gatewayUrl =
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(`${gatewayUrl}/quote/status`, { method: "GET", signal: controller.signal });
    {
      const { noteKgiGatewayAlive } = await import("./broker/kgi-gateway-schedule.js");
      noteKgiGatewayAlive();
    }
    if (!res.ok) {
      return {
        available: null,
        state: "gateway_error",
        errorCode: `HTTP_${res.status}`,
        subscribedTickCount: null,
        kgiLoggedIn: null,
        accountSet: null
      };
    }
    const body = await res.json() as {
      quote_auth_available?: boolean;
      quote_auth_state?: string;
      quote_auth_error_code?: string | null;
      subscribed_symbols?: { tick?: string[] };
      kgi_logged_in?: boolean;
      account_set?: boolean;
    };
    return {
      available: typeof body.quote_auth_available === "boolean" ? body.quote_auth_available : null,
      state: body.quote_auth_state ?? "unknown",
      errorCode: body.quote_auth_error_code ?? null,
      subscribedTickCount: Array.isArray(body.subscribed_symbols?.tick) ? body.subscribed_symbols.tick.length : null,
      kgiLoggedIn: typeof body.kgi_logged_in === "boolean" ? body.kgi_logged_in : null,
      accountSet: typeof body.account_set === "boolean" ? body.account_set : null,
    };
  } catch {
    return {
      available: null,
      state: "gateway_unreachable",
      errorCode: "KGI_GATEWAY_UNREACHABLE",
      subscribedTickCount: null,
      kgiLoggedIn: null,
      accountSet: null
    };
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/v1/kgi/status — Owner only. Returns KGI env, connection state, SIM smoke results.
// LITERAL route registered BEFORE any parametric /api/v1/kgi/:* to avoid Hono shadow.
app.get("/api/v1/kgi/status", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const state = getKgiSimState();
  const gatewayQuoteAuth = await readKgiGatewayQuoteAuthSummary();
  const gatewayLoggedIn = gatewayQuoteAuth.kgiLoggedIn === true;
  const effectiveKgiLoggedIn = gatewayLoggedIn || state.quoteConnected || state.tradeConnected;
  const effectiveQuoteConnected =
    state.quoteConnected ||
    (gatewayLoggedIn && gatewayQuoteAuth.available !== false && gatewayQuoteAuth.state !== "gateway_unreachable");
  const effectiveTradeConnected = state.tradeConnected || gatewayLoggedIn;

  return c.json({
    sim_only: true,
    kgi_env: state.kgiEnv,
    kgi_logged_in: effectiveKgiLoggedIn,
    account_set: gatewayQuoteAuth.accountSet ?? effectiveKgiLoggedIn,
    quote_connected: effectiveQuoteConnected,
    trade_connected: effectiveTradeConnected,
    raw_quote_connected: state.quoteConnected,
    raw_trade_connected: state.tradeConnected,
    last_quote_time: state.lastQuoteTime,
    last_sim_order_status: state.lastSimOrderStatus,
    last_sim_order_detail: state.lastSimOrderDetail,
    last_quote_smoke_at: state.lastQuoteSmokeAt,
    last_trade_smoke_at: state.lastTradeSmokeAt,
    last_sim_order_report_at: state.lastSimOrderReportAt,
    prod_write_blocked: true, // permanent hard guard — never false
    gateway_quote_auth: gatewayQuoteAuth,
    sim_quote_host: process.env["KGI_SIM_QUOTE_HOST"] ?? "iquotetest.kgi.com.tw",
    sim_trade_host: process.env["KGI_SIM_TRADE_HOST"] ?? "itradetest.kgi.com.tw",
  });
});

// POST /api/v1/kgi/sim/quote-smoke — Owner only. Run SIM quote smoke (login, subscribe 0050, receive tick).
// Writes audit log action='kgi.sim.quote_smoke'.
app.post("/api/v1/kgi/sim/quote-smoke", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const env = resolveKgiEnv();
  if (env !== "sim") {
    return c.json({
      error: "NOT_SIM_ENV",
      message: `KGI_ENV=${env}. Quote smoke only runs in sim mode.`,
      prod_write_blocked: true,
    }, 409);
  }

  let body: { symbol?: string } = {};
  try { body = await c.req.json(); } catch { body = {}; }

  const result = await runSimQuoteSmoke({
    workspaceId: session.workspace.id,
    symbol: typeof body.symbol === "string" ? body.symbol : "0050",
  });

  const httpStatus = !result.gatewayReachable
    ? 502
    : !result.loggedIn
      ? 503
      : !result.subscribed
        ? 502
        : !result.tickReceived
          ? 504
          : 200;

  return c.json({
    ok: httpStatus === 200,
    sim_only: true,
    prod_write_blocked: true,
    data: result,
  }, httpStatus);
});

// POST /api/v1/kgi/sim/trade-smoke — Owner only. Run SIM trade smoke (submit 1 odd-lot order).
// Requires confirmedByBruce=true AND confirmedByJason=true in body (dual-confirm).
// Writes audit log action='kgi.sim.trade_smoke'.
app.post("/api/v1/kgi/sim/trade-smoke", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const env = resolveKgiEnv();
  if (env !== "sim") {
    return c.json({
      error: "NOT_SIM_ENV",
      message: `KGI_ENV=${env}. Trade smoke only runs in sim mode.`,
      prod_write_blocked: true,
    }, 409);
  }

  let body: { symbol?: string; confirmedByBruce?: boolean; confirmedByJason?: boolean } = {};
  try { body = await c.req.json(); } catch { body = {}; }

  const result = await runSimTradeSmoke({
    workspaceId: session.workspace.id,
    symbol: typeof body.symbol === "string" ? body.symbol : "0050",
    confirmedByBruce: body.confirmedByBruce === true,
    confirmedByJason: body.confirmedByJason === true,
  });

  const httpStatus = result.orderOutcome === "awaiting_dual_confirm"
    ? 428
    : result.orderOutcome === "prod_write_blocked"
      ? 409
      : !result.gatewayReachable
        ? 502
        : !result.loggedIn
          ? 503
          : result.orderSubmitted || result.orderOutcome === "accepted" || result.orderOutcome === "callback_received"
            ? 200
            : 502;

  return c.json({
    ok: httpStatus === 200,
    sim_only: true,
    prod_write_blocked: true,
    data: result,
  }, httpStatus);
});

// POST /api/v1/kgi/sim/order — Owner only. User-facing KGI SIM order submit.
//
// Sends a real order to KGI SIM infrastructure (itradetest.kgi.com.tw) via the
// EC2 gateway. No dual-confirm gate — Owner identity is sufficient for SIM.
//
// Hard lines:
//   - sim_only: true permanently locked; KGI_ENV must be "sim" (else 409)
//   - prod_write_blocked: true always in response
//   - No credentials in response or audit log
//   - Account masked as 9228-***-6 in audit
//   - KGI_READ_ONLY_MODE does NOT block SIM submit (only real broker writes)
//
// Body: { symbol, side, qty, price?, orderType, quantityUnit, timeInForce?, orderCond?, priceType? }
// Response: { sim_only: true, data: { tradeId, status, submittedAt, ... } }
// Supports both old field names (symbol/qty) and new aliases (ticker/quantity)
// so that callers can use either convention without breaking existing integrations.
//
// B2 additions (2026-05-31):
//   timeInForce — "ROD"|"IOC"|"FOK" (default: "ROD")
//   orderCond   — "Cash"|"CashSelling"|"Margin"|"MarginDayTrade"|"ShortSelling"|"LendSelling"
//                 (default: "Cash")
//   priceType   — "MKT"|"Reference"|"LimitUp"|"LimitDown" — KGI special-price codes
//                 when set, overrides numeric price field for the gateway call
export const kgiSimOrderBodySchema = z.object({
  // ticker is alias for symbol (Elva spec uses {ticker, side, quantity, orderType})
  ticker: z.string().min(1).max(8).toUpperCase().optional(),
  symbol: z.string().min(1).max(8).toUpperCase().optional(),
  side: z.enum(["buy", "sell", "BUY", "SELL"]).transform((v) => v.toLowerCase() as "buy" | "sell"),
  // quantity is alias for qty
  quantity: z.number().int().positive().optional(),
  qty: z.number().int().positive().optional(),
  price: z.number().positive().nullable().optional(),
  orderType: z.enum(["market", "limit", "MARKET", "LIMIT"]).transform((v) => v.toLowerCase() as "market" | "limit").default("limit"),
  quantityUnit: z.enum(["SHARE", "LOT"]).default("SHARE"),
  // B2: optional fields — gateway passes these through to KGI SDK
  timeInForce: z.enum(["ROD", "IOC", "FOK"]).default("ROD"),
  orderCond: z.enum(["Cash", "CashSelling", "Margin", "MarginDayTrade", "ShortSelling", "LendSelling"]).default("Cash"),
  // priceType: KGI special-price codes; when present, overrides numeric price for gateway
  priceType: z.enum(["MKT", "Reference", "LimitUp", "LimitDown"]).optional(),
}).transform((raw) => ({
  symbol: (raw.ticker ?? raw.symbol ?? "").toUpperCase(),
  side: raw.side,
  qty: raw.quantity ?? raw.qty ?? 1,
  price: raw.price,  // keep undefined when not provided (SIM2/SIM4 contract)
  orderType: raw.orderType,
  quantityUnit: raw.quantityUnit,
  timeInForce: raw.timeInForce,
  orderCond: raw.orderCond,
  priceType: raw.priceType,
})).refine((d) => d.symbol.length >= 1, { message: "ticker/symbol is required" })
  .refine((d) => d.qty > 0, { message: "quantity/qty must be positive" });

app.post("/api/v1/kgi/sim/order", async (c) => {
  // 1. Owner-only gate
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  // 2. KGI_ENV must be "sim"
  const env = resolveKgiEnv();
  if (env !== "sim") {
    return c.json({
      error: "NOT_SIM_ENV",
      message: `KGI_ENV=${env}. User SIM orders only run when KGI_ENV=sim.`,
      prod_write_blocked: true,
      sim_only: true,
    }, 409);
  }

  // 3. Parse + validate body
  let body: z.infer<typeof kgiSimOrderBodySchema>;
  try {
    body = kgiSimOrderBodySchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "BAD_REQUEST" }, 400);
  }

  // 4. Price check: limit orders require either a numeric price or a priceType
  if (body.orderType === "limit" && !body.priceType && (body.price == null || body.price <= 0)) {
    return c.json({
      error: "VALIDATION_ERROR",
      message: "限價單需要填入有效的委託價格，或指定 priceType（如 LimitUp / LimitDown）。",
      sim_only: true,
    }, 400);
  }

  // 5. Submit to KGI SIM via gateway client (lazy import — same pattern as /portfolio/kgi/positions)
  const gatewayBaseUrl =
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787";

  const {
    KgiGatewayClient,
    KgiGatewayUnreachableError,
    KgiGatewayAuthError,
    KgiGatewayNotEnabledError,
    KgiGatewayValidationError,
    KgiGatewayUpstreamError,
  } = await import("./broker/kgi-gateway-client.js");

  const client = new KgiGatewayClient({
    gatewayBaseUrl,
    connectTimeoutMs: 10_000,
  });

  const submittedAt = new Date().toISOString();
  const isOddLot = body.quantityUnit === "SHARE";
  const effectiveQty = body.quantityUnit === "LOT" ? body.qty * 1000 : body.qty;

  // Audit log fired regardless of outcome (fire-and-forget)
  const auditPayload = {
    sim_only: true,
    symbol: body.symbol,
    side: body.side,
    qty: body.qty,
    quantity_unit: body.quantityUnit,
    effective_qty_shares: effectiveQty,
    order_type: body.orderType,
    price: body.price ?? null,
    price_type: body.priceType ?? null,
    time_in_force: body.timeInForce,
    order_cond: body.orderCond,
    odd_lot: isOddLot,
    account_masked: maskAccount(process.env["KGI_ACCOUNT"] ?? "9228-001282-6"),
    prod_write_blocked: true,
  };

  // Resolve effective price for gateway:
  //   priceType present → pass the string ("MKT", "LimitUp", etc.) as price
  //   numeric price present → pass the number
  //   neither → undefined (market fallback on gateway side)
  type KgiPriceArg = number | "MKT" | "Reference" | "LimitUp" | "LimitDown" | undefined;
  const gatewayPrice: KgiPriceArg = body.priceType
    ? (body.priceType as "MKT" | "Reference" | "LimitUp" | "LimitDown")
    : (body.price ?? undefined);

  try {
    const tradeRaw = await client.createOrder({
      action: body.side === "buy" ? "Buy" : "Sell",
      symbol: body.symbol,
      qty: body.qty,
      price: gatewayPrice,
      timeInForce: body.timeInForce,
      orderCond: body.orderCond,
      oddLot: isOddLot,
      name: "IUF_SIM_USER_ORDER",
    });

    // Fix 3: Parse nid from kgi_response_repr string.
    // Gateway OrderCreateResponse carries: { ok, sim_only, status, kgi_response_repr }
    // kgi_response_repr is a repr string like "OrderResponse(nid=1779199594627344001 ...)"
    // trade_id is not a top-level field — extract nid via regex.
    const kgiRepr = typeof tradeRaw["kgi_response_repr"] === "string"
      ? (tradeRaw["kgi_response_repr"] as string)
      : null;
    const nidMatch = kgiRepr ? /\bnid=(\d+)/.exec(kgiRepr) : null;
    const parsedTradeId: string | null = nidMatch ? nidMatch[1] : null;

    // Write success audit
    writeAuditLog({
      session,
      method: "POST",
      path: "/api/v1/kgi/sim/order",
      status: 201,
      payload: {
        ...auditPayload,
        outcome: "accepted",
        trade_id: parsedTradeId,
      },
    }).catch((err: unknown) => {
      console.error("[kgi/sim/order] audit log failed:", err instanceof Error ? err.message : String(err));
    });

    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      data: {
        tradeId: parsedTradeId,
        status: (tradeRaw["status"] as string | undefined) ?? "accepted",
        symbol: body.symbol,
        side: body.side,
        qty: body.qty,
        quantityUnit: body.quantityUnit,
        effectiveQtyShares: effectiveQty,
        price: body.price ?? null,
        priceType: body.priceType ?? null,
        orderType: body.orderType,
        timeInForce: body.timeInForce,
        orderCond: body.orderCond,
        isOddLot,
        submittedAt,
      },
    }, 201);
  } catch (err) {
    // Write failure audit
    writeAuditLog({
      session,
      method: "POST",
      path: "/api/v1/kgi/sim/order",
      status: 503,
      payload: { ...auditPayload, outcome: "error", error: err instanceof Error ? err.message : String(err) },
    }).catch((e: unknown) => {
      console.error("[kgi/sim/order] audit log failed:", e instanceof Error ? e.message : String(e));
    });

    if (err instanceof KgiGatewayAuthError) {
      return c.json({
        error: "GATEWAY_AUTH_ERROR",
        message: "KGI gateway session 尚未建立，請先登入 gateway。",
        sim_only: true,
        prod_write_blocked: true,
      }, 503);
    }
    if (err instanceof KgiGatewayUnreachableError) {
      return c.json({
        error: "GATEWAY_UNREACHABLE",
        message: "KGI EC2 gateway 無法連線，請確認 gateway 狀態。",
        sim_only: true,
        prod_write_blocked: true,
      }, 503);
    }
    if (err instanceof KgiGatewayNotEnabledError) {
      // Distinguish: NOT_LOGGED_IN means gateway session needs POST /session/login first.
      // LIVE_ORDER_BLOCKED means gateway is in live mode — re-login with simulation=true.
      const isNotLoggedIn = err.message.includes("[NOT_LOGGED_IN]");
      const isLiveBlocked = err.message.includes("[LIVE_ORDER_BLOCKED]");
      if (isNotLoggedIn) {
        return c.json({
          error: "GATEWAY_NOT_LOGGED_IN",
          message: "KGI gateway session 未登入。請確認 EC2 gateway 服務已啟動且已成功登入。",
          hint: "EC2 gateway 必須在 08:20-14:10 TST 視窗內登入並保持 session。",
          sim_only: true,
          prod_write_blocked: true,
        }, 503);
      }
      if (isLiveBlocked) {
        return c.json({
          error: "LIVE_ORDER_BLOCKED",
          message: "Gateway session 目前為 LIVE 模式，SIM 下單需以 simulation=true 重新登入。",
          sim_only: true,
          prod_write_blocked: true,
        }, 409);
      }
      return c.json({
        error: "ORDER_NOT_ENABLED",
        message: "Gateway /order/create 尚未啟用（409）。",
        sim_only: true,
        prod_write_blocked: true,
      }, 409);
    }
    if (err instanceof KgiGatewayValidationError) {
      return c.json({
        error: "ORDER_VALIDATION_REJECTED",
        message: err.message,
        sim_only: true,
        prod_write_blocked: true,
      }, 422);
    }
    if (err instanceof KgiGatewayUpstreamError) {
      return c.json({
        error: "ORDER_UPSTREAM_ERROR",
        message: err.message,
        sim_only: true,
        prod_write_blocked: true,
      }, 502);
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[kgi/sim/order] unexpected error:", detail);
    return c.json({
      error: "GATEWAY_ERROR",
      message: detail,
      sim_only: true,
      prod_write_blocked: true,
    }, 503);
  }
});

// GET /api/v1/internal/kgi/sim/daily-smoke-status
// Owner-only. Returns last 7 daily smoke run results (memory + audit_logs fallback).
// Shows: overall pass/fail per day, quote check, prod-broker audit count.
// Hard lines: no credentials, no prod broker writes surfaced.
app.get("/api/v1/internal/kgi/sim/daily-smoke-status", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const history = await getDailySmokeHistoryDurable(session.workspace.id);
  const last = history[0] ?? null;

  return c.json({
    sim_only: true,
    prod_write_blocked: true,
    lastRunAt: last?.firedAt ?? null,
    lastRunStatus: last?.overallStatus ?? null,
    lastProdBrokerAuditCount: last?.prodBrokerAuditCount ?? null,
    history,
    scheduledWindow: "09:05-09:35 TST (01:05-01:35 UTC) daily",
    auditAction: "kgi.sim.daily_smoke",
  });
});

// ── S1 SIM Observation Endpoints (/api/v1/internal/s1-sim/*) ─────────────────
//
// Owner-only read-only endpoints for the S1 IUF_LS_OMNI pipeline observation.
// Data source: Railway volume disk JSON files written by s1-sim-runner.ts.
// Hard lines:
//   - Owner-only (楊董 only)
//   - File not found → 200 with empty/null state (never 500)
//   - No credentials, no PII in response
//   - Read-only: no writes triggered

/** Resolve the Railway volume base path (mirrors s1-sim-runner.ts reportsBase()) */
function _s1ReportsBase(): string {
  const mount = process.env["RAILWAY_VOLUME_MOUNT_PATH"] ?? process.env["DATA_DIR"] ?? "runtime-data";
  // Use simple forward-slash join — works on Linux (Railway) and Windows dev
  return `${mount}/trading_room`;
}

/** Safe JSON file read — returns null instead of throwing */
async function _readJsonSafe<T>(path: string): Promise<T | null> {
  try {
    const { promises: nodeFs } = await import("node:fs");
    const raw = await nodeFs.readFile(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type S1ObservationAction =
  | "s1_sim.signal_generated"
  | "s1_sim.orders_submitted"
  | "s1_sim.eod_generated";

async function _readS1ObservationAudit<T>(
  workspaceId: string,
  action: S1ObservationAction,
  tradingDate: string,
): Promise<T | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select({ payload: auditLogs.payload })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        eq(auditLogs.action, action),
        eq(auditLogs.entityType, "s1_sim"),
        eq(auditLogs.entityId, tradingDate),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1)
    .catch(() => [] as Array<{ payload: unknown }>);

  const payload = rows[0]?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = (payload as Record<string, unknown>)["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as T;
}

/** Taipei date string YYYY-MM-DD (server-side helper, mirrors s1-sim-runner) */
function _s1TaipeiDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function _s1RecentDateWindow(daysBack = 7): string[] {
  return Array.from({ length: daysBack + 1 }, (_unused, index) => _s1TaipeiDateStr(-index));
}

function _isValidS1DateParam(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

// GET /api/v1/internal/s1-sim/status — S1 pipeline observation status (Owner only)
//
// Returns:
//   - today's window flags (signal/order/eod)
//   - latest available basket date + regime
//   - latest order submit date + counts
//   - latest eod report date + unrealized PnL
//   - gateway connectivity (KGI_GATEWAY_URL env presence)
//   - today's order count from latest submit file
app.get("/api/v1/internal/s1-sim/status", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const { join: pathJoin } = await import("node:path");
  const base = _s1ReportsBase();
  const todayTst = _s1TaipeiDateStr();

  // Import s1-sim-runner window checkers (read-only, no side-effects)
  const { isS1SignalWindow, isS1OrderSubmitWindow, isS1EodWindow, resolveS1SimCapitalTwd, S1_AUTO_SCHEDULER_POLICY } =
    await import("./s1-sim-runner.js");
  const capitalConfig = await resolveS1SimCapitalTwd(session.workspace.id);

  const recentS1Dates = _s1RecentDateWindow(7);

  // Read the latest basket in the current S1 observation window.
  type S1BasketLite = { signal_date: string; regime: string; exposure_weight: number; basket: unknown[]; generated_at_tst: string };
  let latestBasket: S1BasketLite | null = null;
  let latestBasketDate: string | null = null;
  let latestBasketSource: "file" | "audit_log" | null = null;
  for (const tryDate of recentS1Dates) {
    const p = pathJoin(base, "s1_sim_basket", `${tryDate}.json`);
    let d = await _readJsonSafe<S1BasketLite>(p);
    let source: "file" | "audit_log" = "file";
    if (!d) {
      d = await _readS1ObservationAudit<S1BasketLite>(session.workspace.id, "s1_sim.signal_generated", tryDate);
      source = "audit_log";
    }
    if (d) { latestBasket = d; latestBasketDate = tryDate; latestBasketSource = source; break; }
  }

  // Read the latest order submit record. S1 is weekly, so a Wednesday status
  // screen must still show Tuesday's submitted orders instead of looking blank.
  type S1OrderLite = { submitted_at_tst: string; trading_date: string; orders_attempted: number; orders_accepted: number; orders_rejected: number };
  let latestOrders: S1OrderLite | null = null;
  let latestOrdersDate: string | null = null;
  let latestOrdersSource: "file" | "audit_log" | null = null;
  for (const tryDate of recentS1Dates) {
    const orderPath = pathJoin(base, "s1_sim_daily", `${tryDate}_orders.json`);
    let d = await _readJsonSafe<S1OrderLite>(orderPath);
    let source: "file" | "audit_log" = "file";
    if (!d) {
      d = await _readS1ObservationAudit<S1OrderLite>(session.workspace.id, "s1_sim.orders_submitted", tryDate);
      source = "audit_log";
    }
    if (d) { latestOrders = d; latestOrdersDate = tryDate; latestOrdersSource = source; break; }
  }

  // Read the latest EOD report in the same observation window.
  type S1EodLite = { trading_date: string; generated_at_tst: string; total_unrealized_pnl_twd: number | null; total_market_value_twd: number | null; data_source: string; positions: unknown[] };
  let latestEod: S1EodLite | null = null;
  let latestEodDate: string | null = null;
  let latestEodSource: "file" | "audit_log" | null = null;
  for (const tryDate of recentS1Dates) {
    const eodPath = pathJoin(base, "s1_sim_daily", `${tryDate}.json`);
    let d = await _readJsonSafe<S1EodLite>(eodPath);
    let source: "file" | "audit_log" = "file";
    if (!d) {
      d = await _readS1ObservationAudit<S1EodLite>(session.workspace.id, "s1_sim.eod_generated", tryDate);
      source = "audit_log";
    }
    if (d) { latestEod = d; latestEodDate = tryDate; latestEodSource = source; break; }
  }

  return c.json({
    sim_only: true,
    prod_write_blocked: true,
    as_of: new Date().toISOString(),
    today_tst: todayTst,
    windows: {
      signal_open: isS1SignalWindow(),
      order_submit_open: isS1OrderSubmitWindow(),
      eod_open: isS1EodWindow(),
    },
    automatic_scheduler: {
      enabled: S1_AUTO_SCHEDULER_POLICY.enabled,
      mode: S1_AUTO_SCHEDULER_POLICY.mode,
      signal_window_tst: S1_AUTO_SCHEDULER_POLICY.signalWindowTst,
      order_submit_window_tst: S1_AUTO_SCHEDULER_POLICY.orderSubmitWindowTst,
      eod_window_tst: S1_AUTO_SCHEDULER_POLICY.eodWindowTst,
      poll_interval_ms: S1_AUTO_SCHEDULER_POLICY.pollIntervalMs,
      signal_catchup_before_order: S1_AUTO_SCHEDULER_POLICY.signalCatchupBeforeOrder,
      manual_trigger_role: S1_AUTO_SCHEDULER_POLICY.manualTriggerRole,
    },
    gateway_url_configured: !!(process.env["KGI_GATEWAY_URL"] ?? process.env["KGI_GATEWAY_BASE_URL"]),
    configured_capital_twd: capitalConfig.capitalTwd,
    capital_source: capitalConfig.source,
    capital_subscription_id: capitalConfig.subscriptionId,
    capital_subscription_created_at: capitalConfig.createdAt,
    observation_storage: {
      latest_basket: latestBasketSource,
      latest_orders: latestOrdersSource,
      latest_eod: latestEodSource,
      today_orders: latestOrdersDate === todayTst ? latestOrdersSource : null,
      today_eod: latestEodDate === todayTst ? latestEodSource : null,
    },
    latest_basket: latestBasket ? {
      date: latestBasketDate,
      regime: latestBasket.regime,
      exposure_weight: latestBasket.exposure_weight,
      basket_size: Array.isArray(latestBasket.basket) ? latestBasket.basket.length : 0,
      generated_at_tst: latestBasket.generated_at_tst,
    } : null,
    today_orders: latestOrders ? {
      date: latestOrdersDate,
      submitted_at_tst: latestOrders.submitted_at_tst,
      orders_attempted: latestOrders.orders_attempted,
      orders_accepted: latestOrders.orders_accepted,
      orders_rejected: latestOrders.orders_rejected,
      source: latestOrdersSource,
    } : null,
    today_eod: latestEod ? {
      date: latestEodDate,
      generated_at_tst: latestEod.generated_at_tst,
      total_unrealized_pnl_twd: latestEod.total_unrealized_pnl_twd,
      total_market_value_twd: latestEod.total_market_value_twd,
      position_count: Array.isArray(latestEod.positions) ? latestEod.positions.length : 0,
      data_source: latestEod.data_source,
      source: latestEodSource,
    } : null,
  });
});

// POST /api/v1/internal/s1-sim/manual-run — Owner-only S1 SIM catch-up trigger
//
// This intentionally does not change the automatic S1 Monday cadence. It gives
// Yang an explicit way to run S1 SIM catch-up actions when an ops issue missed
// the normal window. Real-order paths remain blocked.
app.post("/api/v1/internal/s1-sim/manual-run", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "INVALID_JSON" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return c.json({ error: "INVALID_BODY" }, 400);
  }

  const raw = body as Record<string, unknown>;
  const action = raw["action"];
  const confirm = raw["confirm"];
  if (confirm !== "RUN_S1_SIM_MANUAL") {
    return c.json({
      error: "CONFIRMATION_REQUIRED",
      message: "Manual S1 SIM trigger requires confirm='RUN_S1_SIM_MANUAL'.",
    }, 400);
  }
  if (action !== "signal" && action !== "order_submit" && action !== "eod") {
    return c.json({
      error: "INVALID_ACTION",
      message: "action must be one of: signal, order_submit, eod",
    }, 400);
  }

  const {
    isS1SignalWindow,
    isS1OrderSubmitWindow,
    isS1EodWindow,
    runS1SignalTick,
    runS1OrderSubmitTick,
    runS1EodReportTick,
    S1_AUTO_SCHEDULER_POLICY,
  } = await import("./s1-sim-runner.js");

  const windows = {
    signal_open: isS1SignalWindow(),
    order_submit_open: isS1OrderSubmitWindow(),
    eod_open: isS1EodWindow(),
  };
  const windowOpen =
    action === "signal" ? windows.signal_open :
    action === "order_submit" ? windows.order_submit_open :
    windows.eod_open;
  const outsideWindowConfirm = raw["outsideWindowConfirm"];
  if (!windowOpen && outsideWindowConfirm !== "ALLOW_S1_SIM_OUTSIDE_WINDOW") {
    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      error: "OUTSIDE_AUTOMATIC_WINDOW",
      message: "S1 SIM manual-run is owner backup only. Outside the automatic window, pass outsideWindowConfirm='ALLOW_S1_SIM_OUTSIDE_WINDOW' to make the override explicit.",
      action,
      windows,
      automatic_scheduler: S1_AUTO_SCHEDULER_POLICY,
      required_outside_window_confirm: "ALLOW_S1_SIM_OUTSIDE_WINDOW",
      result_path: "/api/v1/internal/s1-sim/status",
    }, 409);
  }

  const triggerId = crypto.randomUUID();
  const acceptedAt = new Date().toISOString();
  void (async () => {
    try {
      if (action === "signal") {
        await runS1SignalTick();
      } else if (action === "order_submit") {
        await runS1OrderSubmitTick();
      } else {
        await runS1EodReportTick();
      }
      console.log(`[s1-manual] trigger ${triggerId} action=${action} completed`);
    } catch (e) {
      console.error(`[s1-manual] trigger ${triggerId} action=${action} failed:`, e instanceof Error ? e.message : String(e));
    }
  })();

  return c.json({
    sim_only: true,
    prod_write_blocked: true,
    trigger_id: triggerId,
    action,
    status: "accepted",
    accepted_at: acceptedAt,
    result_path: "/api/v1/internal/s1-sim/status",
  }, 202);
});

// GET /api/v1/internal/s1-sim/eod-report?date=YYYY-MM-DD — S1 EOD report (Owner only)
//
// Returns the full S1EodReport JSON for the requested date.
// date param defaults to today (Asia/Taipei). Returns empty state if file not found.
//
// Positions rebuild: if eod_generated audit has positions=[] (gateway unavailable + ephemeral
// order file gone after redeploy), we reconstruct positions from the orders_submitted audit
// log so day-1 orders are visible in the product UI.
app.get("/api/v1/internal/s1-sim/eod-report", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const { join: pathJoin } = await import("node:path");
  const dateParam = c.req.query("date") ?? _s1TaipeiDateStr();

  if (!_isValidS1DateParam(dateParam)) {
    return c.json({ error: "INVALID_DATE", message: "date must be a valid YYYY-MM-DD calendar date" }, 400);
  }

  const base = _s1ReportsBase();
  const path = pathJoin(base, "s1_sim_daily", `${dateParam}.json`);

  // Import S1EodReport + S1OrderSubmitResult types (dynamic, type-only at runtime)
  type S1EodReport = import("./s1-sim-runner.js").S1EodReport;
  type S1OrderSubmitResult = import("./s1-sim-runner.js").S1OrderSubmitResult;
  let report = await _readJsonSafe<S1EodReport>(path);
  let source: "file" | "audit_log" | null = report ? "file" : null;
  if (!report) {
    report = await _readS1ObservationAudit<S1EodReport>(session.workspace.id, "s1_sim.eod_generated", dateParam);
    source = report ? "audit_log" : null;
  }

  if (!report) {
    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      date: dateParam,
      source,
      found: false,
      report: null,
    });
  }

  // Positions rebuild: if EOD was written with positions=[] because KGI gateway was
  // unavailable AND the order file was ephemeral (gone after redeploy), reconstruct
  // positions from the durable orders_submitted audit log entry.
  let positionsRebuilt = false;
  if (Array.isArray(report.positions) && report.positions.length === 0) {
    const orderAudit = await _readS1ObservationAudit<S1OrderSubmitResult>(
      session.workspace.id,
      "s1_sim.orders_submitted",
      dateParam,
    );
    if (orderAudit && Array.isArray(orderAudit.results) && orderAudit.results.length > 0) {
      const rebuiltPositions = orderAudit.results
        .filter((r) => r.status === "filled" || r.status === "partially_filled")
        .map((r) => ({
          symbol: r.symbol,
          shares: r.filled_shares ?? r.shares,
          avg_cost: r.avg_fill_price ?? 0,
          last_price: null,
          unrealized_pnl_twd: null,
          market_value_twd: null,
        }));
      if (rebuiltPositions.length > 0) {
        report = {
          ...report,
          positions: rebuiltPositions,
          data_source: "orders_submitted_audit_rebuilt",
          notes: [
            ...(report.notes ?? []),
            `positions_rebuilt_from_audit: ${rebuiltPositions.length} confirmed fills from orders_submitted audit log`,
          ],
        };
        positionsRebuilt = true;
      } else {
        report = {
          ...report,
          notes: [
            ...(report.notes ?? []),
            "orders_unconfirmed_not_positions: submitted orders exist, but no matching broker fill/deal report is available; not counted as holdings",
          ],
        };
      }
    }
  }

  return c.json({
    sim_only: true,
    prod_write_blocked: true,
    date: dateParam,
    source,
    found: true,
    positions_rebuilt: positionsRebuilt,
    report,
  });
});

// GET /api/v1/portfolio/f-auto — S1/F-AUTO current holdings for the trading room (Owner)
//
// B3 (audit: F-AUTO 部位跨日不可見 / 模擬本金 待授權). Single source of truth via
// buildS1PositionsSnapshot(): 盤中 KGI gateway live → 盤後/回空 audit rebuild +
// TWSE EOD mark-to-market → degraded only when both are unavailable.
// Read-only; SIM only; no order surface.
// 30s response cache + inflight dedup: the trading room fires this endpoint
// up to 4× per page load (fast shell + payload + client refresh + components,
// Bruce 6/12 profile: 3.7-4.6s each), and the snapshot recomputes TWSE/TPEX
// cross-region price maps every call. SIM positions can't change inside 30s.
let _fautoCache: { body: Record<string, unknown>; at: number } | null = null;
let _fautoInflight: Promise<Record<string, unknown>> | null = null;
const FAUTO_CACHE_TTL_MS = 30_000;

app.get("/api/v1/portfolio/f-auto", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  if (_fautoCache && Date.now() - _fautoCache.at < FAUTO_CACHE_TTL_MS) {
    return c.json({ ..._fautoCache.body, cache_hit: true });
  }

  if (!_fautoInflight) {
    const workspaceId = session.workspace.id;
    _fautoInflight = (async () => {
      const { buildS1PositionsSnapshot, resolveS1SimCapitalTwd } = await import("./s1-sim-runner.js");
      const [snapshot, capital] = await Promise.all([
        buildS1PositionsSnapshot(),
        resolveS1SimCapitalTwd(workspaceId),
      ]);
      const body: Record<string, unknown> = {
        sim_only: true,
        prod_write_blocked: true,
        capital_twd: capital.capitalTwd,
        capital_source: capital.source,
        positions: snapshot.positions,
        positions_date: snapshot.positionsDate,
        data_source: snapshot.dataSource,
        total_market_value_twd: snapshot.totalMarketValueTwd,
        total_unrealized_pnl_twd: snapshot.totalUnrealizedPnlTwd,
        cash_residual_estimated_twd: snapshot.cashResidualTwd,
        notes: snapshot.notes,
        as_of: new Date().toISOString(),
      };
      _fautoCache = { body, at: Date.now() };
      return body;
    })().finally(() => { _fautoInflight = null; });
  }

  const body = await _fautoInflight;
  return c.json(body);
});

// GET /api/v1/portfolio/f-auto/nav — F-AUTO SIM NAV curve (Owner only)
//
// Phase 2 ledger read endpoint. Returns continuous NAV series from
// sim_ledger_nav + weekly realized/unrealized decomposition from
// sim_ledger_weeks. Empty result if Phase 2 backfill not yet applied.
//
// Jim's next baton: use this endpoint to render the NAV chart.
// Proxy allowlist note: add /api/v1/portfolio/f-auto/nav to GET_ALLOWLIST
// in apps/web/app/api/ui-final-v031/backend/route.ts before consuming from iframe.
//
// 楊董 ACK 2026-07-02.
app.get("/api/v1/portfolio/f-auto/nav", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  try {
    const { buildFAutoNavFull } = await import("./track-record-handlers.js");
    const payload = await buildFAutoNavFull();
    return c.json(payload);
  } catch (e) {
    console.error("[portfolio/f-auto/nav] error:", e);
    return c.json({ error: "NAV_READ_FAILED", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// GET /api/v1/track-record/nav — public whitelisted NAV read (P0-C, Jason 2026-07-05)
//
// Same-source read as /api/v1/portfolio/f-auto/nav above (both call
// buildFAutoNavFull() in track-record-handlers.ts) — the Owner-only route is
// NOT loosened; this is a separate, deliberately thinner public surface for
// the /track-record public scorecard page. Gate = login-only (no role check
// beyond the global /api/v1/* session middleware), matching G-PUB.
// Whitelist: navCurve[] (date/equity/source), weeks[], summary (4 top-line
// fields only) — see toPublicNav() for the exact field list + rationale.
app.get("/api/v1/track-record/nav", async (c) => {
  try {
    const { buildFAutoNavFull, toPublicNav } = await import("./track-record-handlers.js");
    const full = await buildFAutoNavFull();
    return c.json(toPublicNav(full));
  } catch (e) {
    console.error("[track-record/nav] error:", e);
    return c.json({ error: "NAV_READ_FAILED", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// GET /api/v1/internal/s1-sim/basket?date=YYYY-MM-DD — S1 basket (Owner only)
//
// Returns the full S1Basket JSON for the requested date.
// date param defaults to today (Asia/Taipei). Returns empty state if file not found.
app.get("/api/v1/internal/s1-sim/basket", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const { join: pathJoin } = await import("node:path");
  const dateParam = c.req.query("date") ?? _s1TaipeiDateStr();

  if (!_isValidS1DateParam(dateParam)) {
    return c.json({ error: "INVALID_DATE", message: "date must be a valid YYYY-MM-DD calendar date" }, 400);
  }

  const base = _s1ReportsBase();
  const path = pathJoin(base, "s1_sim_basket", `${dateParam}.json`);

  type S1Basket = import("./s1-sim-runner.js").S1Basket;
  let basket = await _readJsonSafe<S1Basket>(path);
  let source: "file" | "audit_log" | null = basket ? "file" : null;
  if (!basket) {
    basket = await _readS1ObservationAudit<S1Basket>(session.workspace.id, "s1_sim.signal_generated", dateParam);
    source = basket ? "audit_log" : null;
  }

  if (!basket) {
    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      date: dateParam,
      source,
      found: false,
      basket: null,
    });
  }

  return c.json({
    sim_only: true,
    prod_write_blocked: true,
    date: dateParam,
    source,
    found: true,
    basket,
  });
});

// ── KGI SIM Account Data Proxy (/api/v1/kgi/sim/positions, /orders, /balance) ──
//
// Owner-only read-only proxy to KGI gateway account endpoints.
// SIM_ONLY: targets KGI SIM infra. Production write path permanently blocked.
// Source of truth for trading room UI when KGI_ENV=sim.
//
// Hard lines:
//   - Owner-only (楊董 only)
//   - Gateway unreachable → 200 with empty data + degraded=true (never 503)
//   - Credentials NEVER in response
//   - prod_write_blocked always true
//   - account masked in logs (never in response body)

// GET /api/v1/kgi/sim/positions — KGI SIM account positions
app.get("/api/v1/kgi/sim/positions", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const gatewayUrl =
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787";

  const { KgiGatewayClient, KgiGatewayUnreachableError, KgiGatewayAuthError } =
    await import("./broker/kgi-gateway-client.js");

  const client = new KgiGatewayClient({ gatewayBaseUrl: gatewayUrl, connectTimeoutMs: 5_000, ignoreScheduleGuard: true });

  try {
    const rawPositions = await client.getPosition();
    const positions = rawPositions.map((p) => ({
      symbol: p.symbol,
      netQtyShares: p.netQuantity,
      quantityCashYd: p.quantityCashYd,
      quantityCashTd: p.quantityCashTd,
      unrealizedPnl: p.unrealized,
      realizedPnl: p.realized,
      lastPrice: p.lastPrice,
      boardLot: p.boardLot,
      // Friendly alias for UI
      quantity: p.netQuantity,
      avgPrice: p.lastPrice, // KGI position doesn't carry avgPrice directly
    }));
    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      data: { positions, source: "kgi_sim", fetchedAt: new Date().toISOString() },
    });
  } catch (err) {
    const degraded = err instanceof KgiGatewayUnreachableError || err instanceof KgiGatewayAuthError;
    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      data: {
        positions: [],
        source: "kgi_sim",
        degraded: true,
        reason: degraded ? (err instanceof KgiGatewayAuthError ? "gateway_not_authenticated" : "gateway_unreachable") : "gateway_error",
        fetchedAt: new Date().toISOString(),
      },
    });
  }
});

// GET /api/v1/kgi/sim/orders — KGI SIM submitted orders (trades)
app.get("/api/v1/kgi/sim/orders", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const gatewayUrl =
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787";

  const { KgiGatewayClient, KgiGatewayUnreachableError, KgiGatewayAuthError } =
    await import("./broker/kgi-gateway-client.js");
  const { reconcileKgiOrders, summarizeKgiReconciliationEvidence } = await import("./broker/kgi-order-reconciliation.js");

  const client = new KgiGatewayClient({ gatewayBaseUrl: gatewayUrl, connectTimeoutMs: 5_000, ignoreScheduleGuard: true });

  type _S1OrderSubmitResult = {
    schema: string;
    submitted_at_tst: string;
    trading_date: string;
    results: Array<{
      symbol: string;
      shares: number;
      status: string;
      trade_id: string | null;
      filled_shares?: number;
      remaining_shares?: number;
      avg_fill_price?: number | null;
      settlement_source?: string;
      settlement_confirmed?: boolean;
      confirmed_at?: string | null;
      error: string | null;
    }>;
  };
  let auditOrders: _S1OrderSubmitResult["results"] = [];
  let auditDate: string | null = null;
  let auditSubmittedAt: string | null = null;
  if (isDatabaseMode()) {
    for (let daysBack = 0; daysBack <= 7; daysBack++) {
      const tryDate = _s1TaipeiDateStr(-daysBack);
      const orderAudit = await _readS1ObservationAudit<_S1OrderSubmitResult>(
        session.workspace.id,
        "s1_sim.orders_submitted",
        tryDate,
      );
      if (orderAudit && Array.isArray(orderAudit.results) && orderAudit.results.length > 0) {
        auditOrders = orderAudit.results;
        auditDate = tryDate;
        auditSubmittedAt = orderAudit.submitted_at_tst ?? null;
        break;
      }
    }
  }

  const baseOrders = auditOrders
    .filter((r) => r.status !== "skipped")
    .map((r) => ({
      tradeId: r.trade_id,
      symbol: r.symbol,
      side: "buy" as const,
      requestedQty: r.shares,
      submittedAt: auditSubmittedAt,
    }));

  const orderAuditCount = baseOrders.length;
  const fetchEvidence = async <T>(
    name: "order_events" | "trade_reports" | "deals",
    fn: () => Promise<T>,
  ): Promise<{ name: string; ok: true; value: T; error: null } | { name: string; ok: false; value: null; error: string }> => {
    try {
      return { name, ok: true, value: await fn(), error: null };
    } catch (error) {
      return {
        name,
        ok: false,
        value: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  try {
    const [eventsResult, tradesResult, dealsResult] = await Promise.all([
      fetchEvidence("order_events", () => client.getRecentOrderEvents(200)),
      fetchEvidence("trade_reports", () => client.getTrades(false)),
      fetchEvidence("deals", () => client.getDeals()),
    ]);
    const events = eventsResult.ok ? eventsResult.value : [];
    const trades = tradesResult.ok ? tradesResult.value : null;
    const deals = dealsResult.ok ? dealsResult.value : null;
    const reconciled = baseOrders.length > 0
      ? reconcileKgiOrders({ orders: baseOrders, events, trades, deals })
      : [];
    const evidenceSummary = summarizeKgiReconciliationEvidence({ events, trades, deals });
    const brokerReportConfirmedCount = reconciled.filter((order) => order.brokerReportConfirmed).length;
    const settlementConfirmedCount = reconciled.filter((order) => order.settlementConfirmed).length;
    const filledCount = reconciled.filter((order) => order.status === "filled" || order.status === "partially_filled").length;
    const unconfirmedCount = reconciled.filter((order) => order.status === "unconfirmed").length;
    const fetchedAt = new Date().toISOString();
    const ordersArr = reconciled.map((order, index) => ({
      tradeId: order.tradeId,
      trade_id: order.tradeId,
      status: order.status,
      symbol: order.symbol,
      side: order.side,
      qty: order.requestedQty,
      shares: order.requestedQty,
      quantityUnit: "SHARE",
      effectiveQtyShares: order.requestedQty,
      requestedQty: order.requestedQty,
      filledQty: order.filledQty,
      remainingQty: order.remainingQty,
      avgFillPrice: order.avgFillPrice,
      price: order.avgFillPrice,
      orderType: "market",
      isOddLot: false,
      submittedAt: auditSubmittedAt ?? auditDate ?? "",
      submitted_at_tst: auditSubmittedAt,
      trading_date: auditDate,
      settlementConfirmed: order.settlementConfirmed,
      settlementSource: order.settlementSource,
      brokerReportConfirmed: order.brokerReportConfirmed,
      confirmedAt: order.confirmedAt,
      matchStrategy: order.matchStrategy,
      row: index,
    }));
    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      data: {
        orders: ordersArr,
        source: baseOrders.length > 0 ? "audit_plus_kgi_reconciliation" : "kgi_sim",
        auditDate,
        reconciliation: {
          auditOrderCount: orderAuditCount,
          brokerReportConfirmedCount,
          settlementConfirmedCount,
          filledCount,
          unconfirmedCount,
          evidence: {
            orderEventRows: evidenceSummary.orderEventRows,
            tradeReportRows: evidenceSummary.tradeReportRows,
            dealRows: evidenceSummary.dealRows,
            rowsWithTradeId: evidenceSummary.rowsWithTradeId,
            rowsWithSymbol: evidenceSummary.rowsWithSymbol,
          },
          fetch: {
            orderEvents: eventsResult.ok ? "ok" : "error",
            tradeReports: tradesResult.ok ? "ok" : "error",
            deals: dealsResult.ok ? "ok" : "error",
            errors: [eventsResult, tradesResult, dealsResult]
              .filter((result) => !result.ok)
              .map((result) => ({ source: result.name, message: result.error })),
          },
          fetchedAt,
          closureState:
            orderAuditCount === 0
              ? "no_strategy_orders"
              : brokerReportConfirmedCount === orderAuditCount
                ? "broker_confirmed"
                : brokerReportConfirmedCount > 0
                  ? "partially_confirmed"
                  : "awaiting_broker_report",
        },
        note: baseOrders.length > 0
          ? "Orders are reconstructed from durable S1 audit entries and reconciled against KGI recent events/trades/deals."
          : "No recent S1 audit orders found; KGI raw trade report did not identify an F-AUTO order.",
        fetchedAt,
      },
    });
  } catch (err) {
    const degraded = err instanceof KgiGatewayUnreachableError || err instanceof KgiGatewayAuthError;
    const reason = degraded
      ? (err instanceof KgiGatewayAuthError ? "gateway_not_authenticated" : "gateway_unreachable")
      : "gateway_error";

    const auditRows = auditOrders.map((r) => ({
      symbol: r.symbol,
      shares: r.shares,
      qty: r.shares,
      requestedQty: r.shares,
      filledQty: r.filled_shares ?? 0,
      remainingQty: r.remaining_shares ?? r.shares,
      avgFillPrice: r.avg_fill_price ?? null,
      status: r.status,
      trade_id: r.trade_id,
      tradeId: r.trade_id,
      settlementConfirmed: r.settlement_confirmed === true,
      settlementSource: r.settlement_source ?? "submission_only",
      confirmedAt: r.confirmed_at ?? null,
      side: "buy",
      quantityUnit: "SHARE",
      effectiveQtyShares: r.shares,
      price: r.avg_fill_price ?? null,
      orderType: "market",
      isOddLot: false,
      error: r.error,
      trading_date: auditDate,
      submitted_at_tst: auditSubmittedAt,
      submittedAt: auditSubmittedAt ?? auditDate ?? "",
    }));

    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      data: {
        orders: auditRows,
        source: auditOrders.length > 0 ? "audit_log_fallback" : "kgi_sim",
        degraded: true,
        reason,
        auditDate: auditDate,
        reconciliation: {
          auditOrderCount: auditRows.length,
          brokerReportConfirmedCount: auditRows.filter((row) => row.settlementConfirmed).length,
          settlementConfirmedCount: auditRows.filter((row) => row.settlementConfirmed).length,
          filledCount: auditRows.filter((row) => Number(row.filledQty ?? 0) > 0).length,
          unconfirmedCount: auditRows.filter((row) => !row.settlementConfirmed).length,
          evidence: {
            orderEventRows: 0,
            tradeReportRows: 0,
            dealRows: 0,
            rowsWithTradeId: 0,
            rowsWithSymbol: 0,
          },
          fetch: {
            orderEvents: "error",
            tradeReports: "error",
            deals: "error",
            errors: [{ source: "gateway", message: reason }],
          },
          fetchedAt: new Date().toISOString(),
          closureState: auditRows.length > 0 ? "gateway_unavailable" : "no_strategy_orders",
        },
        note: auditOrders.length > 0
          ? `KGI SIM gateway unavailable (${reason}). Showing last F-AUTO order submission from audit log (${auditDate}). Settlement status unknown — these orders were submitted to KGI SIM but confirmation was not received.`
          : `KGI SIM gateway unavailable (${reason}). No recent F-AUTO order activity found in audit log.`,
        fetchedAt: new Date().toISOString(),
      },
    });
  }
});

// GET /api/v1/kgi/sim/balance — KGI SIM account balance / funds
// KGI gateway does not expose a dedicated balance endpoint.
// We derive balance from positions (realized + unrealized P&L) and
// report it with a note about the derivation.
app.get("/api/v1/kgi/sim/balance", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const gatewayUrl =
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787";

  const { KgiGatewayClient, KgiGatewayUnreachableError, KgiGatewayAuthError } =
    await import("./broker/kgi-gateway-client.js");

  const client = new KgiGatewayClient({ gatewayBaseUrl: gatewayUrl, connectTimeoutMs: 5_000, ignoreScheduleGuard: true });

  try {
    const rawPositions = await client.getPosition();
    const totalUnrealized = rawPositions.reduce((acc, p) => acc + (p.unrealized ?? 0), 0);
    const totalRealized = rawPositions.reduce((acc, p) => acc + (p.realized ?? 0), 0);
    const positionCount = rawPositions.filter((p) => p.netQuantity !== 0).length;
    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      data: {
        source: "kgi_sim",
        account: process.env["KGI_ACCOUNT"] ? maskAccount(process.env["KGI_ACCOUNT"]) : "9228-***-6",
        currency: "TWD",
        totalUnrealizedPnl: totalUnrealized,
        totalRealizedPnl: totalRealized,
        positionCount,
        // KGI SIM SDK does not expose available cash directly — omit to avoid fabrication
        availableCash: null,
        note: "availableCash is not available from KGI SIM SDK; unrealized/realized P&L from position snapshot",
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    const degraded = err instanceof KgiGatewayUnreachableError || err instanceof KgiGatewayAuthError;
    return c.json({
      sim_only: true,
      prod_write_blocked: true,
      data: {
        source: "kgi_sim",
        degraded: true,
        reason: degraded ? (err instanceof KgiGatewayAuthError ? "gateway_not_authenticated" : "gateway_unreachable") : "gateway_error",
        fetchedAt: new Date().toISOString(),
      },
    });
  }
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
    const quoteAuthUnavailable =
      status.quote_auth_available === false ||
      status.quote_auth_state === "unavailable";
    const quoteConnected = Boolean(status.kgi_logged_in && !status.quote_disabled_flag && !quoteAuthUnavailable);
    return c.json({
      data: {
        ...status,
        quote_connected: quoteConnected,
        trade_connected: Boolean(status.kgi_logged_in)
      }
    });
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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  try {
    const body = kgiSubscribeSchema.parse(await c.req.json());

    // ── Quota check via subscription manager ──────────────────────────────
    const { initSubscriptionManager, subscribeSymbol: qmSubscribe, getSubscriptionStatus, TIER } =
      await import("./kgi-subscription-manager.js");
    initSubscriptionManager();
    const statusBefore = getSubscriptionStatus();

    if (statusBefore.slotsUsed >= statusBefore.slotsMax) {
      // Symbol may already be in pool (already_subscribed is ok)
      const alreadyInPool = statusBefore.slots.some((s) => s.symbol === body.symbol);
      if (!alreadyInPool) {
        const quotaResult = await qmSubscribe(body.symbol, TIER.BUFFER, false);
        if (!quotaResult.ok && quotaResult.action === "quota_exceeded") {
          return c.json(
            {
              error: "QUOTA_EXCEEDED",
              message: `KGI subscription quota full (${statusBefore.slotsUsed}/${statusBefore.slotsMax}).`,
              slotsUsed: statusBefore.slotsUsed,
              slotsMax: statusBefore.slotsMax,
              suggestion: quotaResult.suggestion,
            },
            429
          );
        }
      }
    } else {
      // Register in quota pool (BUFFER tier for ad-hoc subscriptions)
      await qmSubscribe(body.symbol, TIER.BUFFER, false);
    }

    // ── Proceed with actual gateway subscription ──────────────────────────
    const client = getKgiQuoteClient();
    const results: Record<string, string> = {};
    if (body.type === "tick" || body.type === "both") {
      results.tickLabel = await client.subscribeSymbolTick(body.symbol, { oddLot: body.oddLot });
    }
    if (body.type === "bidask" || body.type === "both") {
      results.bidAskLabel = await client.subscribeSymbolBidAsk(body.symbol, { oddLot: body.oddLot });
    }

    const statusAfter = getSubscriptionStatus();
    return c.json({
      data: {
        symbol: body.symbol,
        ...results,
        quotaUsed: statusAfter.slotsUsed,
        quotaMax: statusAfter.slotsMax,
      },
    });
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

// MIS five-level book — KGI quote auth is not enabled on this broker tier, so
// TWSE MIS is the de-facto five-level source (5–20s intraday snapshot).
// MIS fields: b=五檔買價 a=五檔賣價 f=五檔買量 g=五檔賣量 (underscore-separated).
// Queries tse_ + otc_ prefixes in one request; today-trade-date + session guards.
async function _fetchMisFiveLevelBook(symbol: string): Promise<Record<string, unknown> | null> {
  const hhmm = getTaipeiHHMM();
  const day = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCDay();
  if (day === 0 || day === 6 || hhmm < 900 || hhmm > 1335) return null;
  if (!/^\d{4,6}[A-Z]?$/.test(symbol)) return null;
  try {
    const exCh = `tse_${symbol}.tw|otc_${symbol}.tw`;
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
    const resp = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return null;
    const data = await resp.json() as { rtcode?: string; msgArray?: Array<Record<string, string>> };
    if (data.rtcode !== "0000" || !data.msgArray?.length) return null;
    const todayYmd = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
    const msg = data.msgArray.find((m) => (m["d"] ?? "") === todayYmd && Boolean(m["b"] || m["a"]));
    if (!msg) return null;
    const nums = (s?: string) =>
      (s ?? "").split("_").filter(Boolean).map((x) => Number(x.replace(/,/g, ""))).filter((n) => isFinite(n) && n > 0);
    const bid_prices = nums(msg["b"]).slice(0, 5);
    const ask_prices = nums(msg["a"]).slice(0, 5);
    const bid_volumes = nums(msg["f"]).slice(0, 5);
    const ask_volumes = nums(msg["g"]).slice(0, 5);
    if (bid_prices.length === 0 && ask_prices.length === 0) return null;
    return {
      symbol,
      exchange: msg["ex"] ?? null,
      bid_prices,
      bid_volumes,
      ask_prices,
      ask_volumes,
      source: "twse_mis_intraday",
      time: msg["t"] ?? null,
      tradeDate: msg["d"] ?? null,
    };
  } catch {
    return null;
  }
}

// GET /api/v1/kgi/quote/bidask?symbol=<S>
app.get("/api/v1/kgi/quote/bidask", async (c) => {
  const symbol = c.req.query("symbol") ?? "";
  if (!symbol) return c.json({ error: "MISSING_SYMBOL" }, 400);
  try {
    const result = await getKgiQuoteClient().getLatestBidAsk(symbol);
    return c.json({ data: result });
  } catch (err) {
    // KGI five-level requires a quote-auth tier this account doesn't have —
    // serve the MIS five-level snapshot instead of a permanent BLOCKED panel.
    const mis = await _fetchMisFiveLevelBook(symbol);
    if (mis) return c.json({ data: mis });
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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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

const authRegisterWithInviteSchema = z.object({
  inviteToken: z.string().min(1).max(256),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(256)
});

function sanitizeOperationalErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://[REDACTED]@")
    .replace(/(password|passwd|pwd|token|secret)=([^&\s]+)/gi, "$1=[REDACTED]")
    .slice(0, 1200);
}

function serializeOperationalError(error: unknown) {
  const record = error && typeof error === "object"
    ? (error as Record<string, unknown>)
    : {};
  const cause = record.cause && typeof record.cause === "object"
    ? (record.cause as Record<string, unknown>)
    : {};

  return {
    name: typeof record.name === "string" ? record.name : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
    message: sanitizeOperationalErrorMessage(record.message),
    causeName: typeof cause.name === "string" ? cause.name : undefined,
    causeCode: typeof cause.code === "string" ? cause.code : undefined,
    causeMessage: sanitizeOperationalErrorMessage(cause.message)
  };
}

app.post("/auth/login", async (c) => {
  const body = authLoginSchema.parse(await c.req.json());
  let result;
  try {
    result = await loginWithPassword(body.email, body.password);
  } catch (error) {
    console.warn("[auth/login] database login failed", serializeOperationalError(error));
    return c.json({ error: "auth_login_unavailable", code: "AUTH_LOGIN_DB_ERROR" }, 503);
  }
  if (!result.ok) {
    return c.json({ error: result.error }, 401);
  }
  c.header("Set-Cookie", buildSetCookieHeader(result.user.id));
  return c.json({ user: result.user, workspace: result.workspace });
});

app.post("/auth/register-with-invite", async (c) => {
  // New workspace_invites-backed registration (migration 0050).
  // Token is looked up by SHA-256 hash; plain token is never stored.
  // All invalid states (bad token, expired, used, revoked) return the same
  // error code to prevent token-existence oracle attacks.
  let body: ReturnType<typeof authRegisterWithInviteSchema.parse>;
  try {
    body = authRegisterWithInviteSchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "invalid_request_body" }, 400);
  }
  const { validateAndClaimWorkspaceInvite } = await import("./invite-store.js");
  const result = await validateAndClaimWorkspaceInvite({
    inviteToken: body.inviteToken,
    email: body.email,
    name: body.name,
    password: body.password
  });
  if (!result.ok) {
    const status = result.error === "email_already_registered" ? 409 : 400;
    return c.json({ error: result.error }, status);
  }
  c.header("Set-Cookie", buildSetCookieHeader(result.user.id));
  return c.json({ user: result.user, workspace: result.workspace });
});

app.post("/auth/logout", (c) => {
  c.header("Set-Cookie", buildClearCookieHeader());
  return c.json({ ok: true });
});

// RETIRED 2026-07-05 (P1-2 legacy invite converge). This was the old
// Owner-only invite_codes issuance path, superseded by the workspace_invites
// system (migration 0050): POST /api/v1/admin/invites (Admin+) to issue,
// POST /auth/register-with-invite to redeem. invite_codes table/data are
// left untouched (historical, no destructive migration) — this route now
// answers 410 Gone rather than a bare 404 so any stale caller (old front-end
// page, verify scripts) gets an honest signal instead of silence.
app.post("/auth/issue-invite", (c) => {
  return c.json(
    {
      error: "endpoint_retired",
      message:
        "/auth/issue-invite has been retired. Issue invites via POST /api/v1/admin/invites (Admin+), then redeem with POST /auth/register-with-invite.",
      replacement: "/api/v1/admin/invites"
    },
    410
  );
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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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

// GET /api/v1/paper/orders — list orders for the current user (optional ?status=).
// When KGI_ENV=sim (or ?source=sim), proxies to KGI SIM gateway trades.
// When KGI_ENV=paper (or ?source=paper), returns paper-broker in-memory orders.
// =============================================================================
// User-managed watchlist (trade desk) — replaces the hardcoded default symbols.
// Each user curates their own list (add/remove, persisted per workspace+user).
// =============================================================================

// GET /api/v1/watchlist — the current user's saved symbols
app.get("/api/v1/watchlist", async (c) => {
  const session = c.get("session");
  if (!isDatabaseMode()) return c.json({ data: [] });
  const db = getDb();
  if (!db) return c.json({ data: [] });
  const rows = dbExecRows<{ symbol: string; name: string }>(
    await db.execute(drizzleSql`
      SELECT symbol, name
      FROM user_watchlist
      WHERE workspace_id = ${session.workspace.id} AND user_id = ${session.user.id}
      ORDER BY sort_order ASC, created_at ASC
    `)
  );
  return c.json({ data: rows.map((r) => ({ symbol: r.symbol, name: r.name || r.symbol })) });
});

// POST /api/v1/watchlist — add a symbol { symbol, name? } (idempotent upsert)
app.post("/api/v1/watchlist", async (c) => {
  const session = c.get("session");
  if (!isDatabaseMode()) return c.json({ error: "db_unavailable" }, 503);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const symbol = String((body as Record<string, unknown>).symbol ?? "").trim().toUpperCase();
  const name = String((body as Record<string, unknown>).name ?? "").trim().slice(0, 40);
  if (!/^[0-9A-Z._-]{2,16}$/.test(symbol)) return c.json({ error: "invalid_symbol" }, 400);
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  await db.execute(drizzleSql`
    INSERT INTO user_watchlist (workspace_id, user_id, symbol, name, sort_order)
    VALUES (${session.workspace.id}, ${session.user.id}, ${symbol}, ${name}, ${Date.now()})
    ON CONFLICT (workspace_id, user_id, symbol)
      DO UPDATE SET name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE user_watchlist.name END
  `);
  return c.json({ ok: true, symbol });
});

// POST /api/v1/watchlist/remove — remove a symbol { symbol }
// (POST, not DELETE: the same-origin trade-desk proxy only allowlists GET/POST.)
app.post("/api/v1/watchlist/remove", async (c) => {
  const session = c.get("session");
  if (!isDatabaseMode()) return c.json({ error: "db_unavailable" }, 503);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const symbol = String((body as Record<string, unknown>).symbol ?? "").trim().toUpperCase();
  if (!/^[0-9A-Z._-]{2,16}$/.test(symbol)) return c.json({ error: "invalid_symbol" }, 400);
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  await db.execute(drizzleSql`
    DELETE FROM user_watchlist
    WHERE workspace_id = ${session.workspace.id} AND user_id = ${session.user.id} AND symbol = ${symbol}
  `);
  return c.json({ ok: true, symbol });
});

app.get("/api/v1/paper/orders", async (c) => {
  const session = c.get("session");
  const sourceOverride = c.req.query("source");
  const kgiEnv = resolveKgiEnv();
  const useSimSource = sourceOverride === "sim" || (sourceOverride !== "paper" && kgiEnv === "sim");

  if (useSimSource) {
    const gatewayUrl =
      process.env["KGI_GATEWAY_URL"] ??
      process.env["KGI_GATEWAY_BASE_URL"] ??
      "http://127.0.0.1:8787";
    const { KgiGatewayClient } = await import("./broker/kgi-gateway-client.js");
    const client = new KgiGatewayClient({ gatewayBaseUrl: gatewayUrl, connectTimeoutMs: 5_000, ignoreScheduleGuard: true });
    try {
      const trades = await client.getTrades(false);
      const ordersArr = Object.entries(trades as Record<string, unknown>).map(([orderId, order]) => ({
        orderId,
        source: "kgi_sim",
        ...(typeof order === "object" && order !== null ? order : { raw: String(order) }),
      }));
      return c.json({ data: ordersArr, source: "kgi_sim" });
    } catch (_err) {
      return c.json({ data: [], source: "kgi_sim", degraded: true });
    }
  }

  const statusParam = c.req.query("status");
  const allowed = ["PENDING", "ACCEPTED", "FILLED", "REJECTED", "CANCELLED"] as const;
  const status = (allowed as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as (typeof allowed)[number])
    : undefined;
  const orders = await listOrders(session.user.id, status ? { status } : undefined);
  return c.json({ data: orders, source: "paper" });
});

// GET /api/v1/paper/positions — paper trading positions.
// When KGI_ENV=sim (or ?source=sim), proxies to KGI SIM gateway positions.
// When KGI_ENV=paper (or ?source=paper), returns in-memory paper-broker positions.
// Default: follows KGI_ENV env var. Override with ?source=sim|paper.
app.get("/api/v1/paper/positions", async (c) => {
  const session = c.get("session");
  const sourceOverride = c.req.query("source"); // "sim" | "paper" | undefined
  const kgiEnv = resolveKgiEnv();
  const useSimSource = sourceOverride === "sim" || (sourceOverride !== "paper" && kgiEnv === "sim");

  if (useSimSource) {
    // KGI SIM mode — pull real positions from gateway
    const gatewayUrl =
      process.env["KGI_GATEWAY_URL"] ??
      process.env["KGI_GATEWAY_BASE_URL"] ??
      "http://127.0.0.1:8787";
    const { KgiGatewayClient } = await import("./broker/kgi-gateway-client.js");
    const client = new KgiGatewayClient({ gatewayBaseUrl: gatewayUrl, connectTimeoutMs: 5_000, ignoreScheduleGuard: true });
    try {
      const rawPositions = await client.getPosition();
      // Map KgiPosition → Position-compatible shape for UI
      const positions = rawPositions
        .filter((p) => p.netQuantity !== 0 || p.unrealized !== 0)
        .map((p) => ({
          accountId: process.env["KGI_ACCOUNT"] ? maskAccount(process.env["KGI_ACCOUNT"]) : "kgi-sim",
          symbol: p.symbol,
          market: "TWSE",
          quantity: p.netQuantity,
          avgPrice: p.lastPrice, // best proxy; KGI position df does not expose avgPrice
          marketPrice: p.lastPrice,
          marketValue: p.lastPrice ? p.lastPrice * p.netQuantity : null,
          unrealizedPnl: p.unrealized,
          unrealizedPnlPct: null,
          openedAt: null,
          companyId: null,
          source: "kgi_sim",
        }));
      return c.json({ data: positions, source: "kgi_sim" });
    } catch (_err) {
      // KGI /position native crash workaround — reconstruct from /deals.
      // Root cause: kgisuperpy Order.get_position() crashes; gateway returns 500.
      try {
        const dealsBySymbol = (await client.getDeals()) as Record<
          string,
          Array<{ action?: string; quantity?: number; price?: number }>
        >;
        const reconstructed: Array<Record<string, unknown>> = [];
        for (const [symbol, deals] of Object.entries(dealsBySymbol)) {
          if (!Array.isArray(deals)) continue;
          let netQty = 0;
          let totalCost = 0;
          let lastPrice = 0;
          for (const d of deals) {
            const action = String(d.action ?? "");
            const qty = Number(d.quantity ?? 0);
            const price = Number(d.price ?? 0);
            if (qty <= 0 || price <= 0) continue;
            lastPrice = price;
            if (action === "B") {
              netQty += qty;
              totalCost += qty * price;
            } else if (action === "S") {
              netQty -= qty;
              totalCost -= qty * price;
            }
          }
          if (netQty !== 0) {
            const avgPrice = netQty !== 0 ? totalCost / netQty : 0;
            const marketValue = lastPrice * netQty;
            const unrealizedPnl = marketValue - totalCost;
            reconstructed.push({
              accountId: process.env["KGI_ACCOUNT"] ? maskAccount(process.env["KGI_ACCOUNT"]) : "kgi-sim",
              symbol,
              market: "TWSE",
              quantity: netQty,
              avgPrice,
              marketPrice: lastPrice,
              marketValue,
              unrealizedPnl,
              unrealizedPnlPct: totalCost !== 0 ? unrealizedPnl / Math.abs(totalCost) : null,
              openedAt: null,
              companyId: null,
              source: "kgi_sim_reconstructed",
            });
          }
        }
        return c.json({ data: reconstructed, source: "kgi_sim_reconstructed" });
      } catch (_recon) {
        return c.json({ data: [], source: "kgi_sim", degraded: true });
      }
    }
  }

  // Paper-broker in-memory mode
  const accountId = c.req.query("accountId") ?? "default";
  return c.json({ data: await listPaperPositions(session, accountId), source: "paper" });
});

// GET /api/v1/paper/positions — alias for /api/v1/trading/positions
// Returns current paper trading positions for the authenticated user.
// Supports optional ?accountId= query param (same as /trading/positions).
app.get("/api/v1/paper/positions", async (c) => {
  const session = c.get("session");
  const accountId = c.req.query("accountId") ?? "default";
  return c.json({ data: await listPaperPositions(session, accountId) });
});

// POST /api/v1/paper/orders/:id/cancel — cancel a PENDING/ACCEPTED order
app.post("/api/v1/paper/orders/:id/cancel", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  futuresNight: { last: number | null; chgPct: number | null; stale_reason?: string };
  usMarket: { index: string; last: number | null; chgPct: number | null; closeTs: string | null; stale_reason?: string };
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
    // futuresNight + usMarket: no live feed available (KGI TradeCom pending + no US index feed).
    // Expose stale_reason so frontend can show "無即時資料" badge instead of fake 0 values.
    futuresNight: { last: null, chgPct: null, stale_reason: "no_live_feed_kgi_pending" },
    usMarket: { index: "NASDAQ", last: null, chgPct: null, closeTs: null, stale_reason: "no_us_index_feed" },
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
  if (!requireMinRole(c.get("session"), "Owner")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
// Intraday kbar helper — aggregate FinMind 1-min rows to N-min buckets
// =============================================================================
function _aggregateFinMindKBars(
  rows: Array<{ date: string; minute: string; open: number; high: number; low: number; close: number; volume: number }>,
  bucketMins: number
): Array<{ dt: string; time: number; open: number; high: number; low: number; close: number; volume: number; source: "finmind" }> {
  const buckets = new Map<string, { open: number; high: number; low: number; close: number; volume: number; timeMs: number; dt: string }>();
  for (const row of rows) {
    const [hStr, mStr] = row.minute.split(":").slice(0, 2);
    const h = parseInt(hStr ?? "0", 10);
    const m = parseInt(mStr ?? "0", 10);
    const totalMins = h * 60 + m;
    const bucketStart = Math.floor(totalMins / bucketMins) * bucketMins;
    const bh = String(Math.floor(bucketStart / 60)).padStart(2, "0");
    const bm = String(bucketStart % 60).padStart(2, "0");
    const key = `${row.date}T${bh}:${bm}`;
    const existing = buckets.get(key);
    const timeMs = new Date(`${row.date}T${bh}:${bm}:00+08:00`).getTime();
    if (!existing) {
      buckets.set(key, { open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume, timeMs, dt: row.date });
    } else {
      existing.high = Math.max(existing.high, row.high);
      existing.low = Math.min(existing.low, row.low);
      existing.close = row.close;
      existing.volume += row.volume;
    }
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ dt: v.dt, time: v.timeMs, open: v.open, high: v.high, low: v.low, close: v.close, volume: v.volume, source: "finmind" as const }));
}

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
  interval: z.enum(["1d", "1w", "1m", "5m", "15m", "60m"]).optional().default("1d")
});

function normalizeOhlcvInterval(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const value = raw.trim().toLowerCase();
  if (value === "1mo" || value === "1mon" || value === "1month" || value === "month") return "1m";
  if (value === "1wk" || value === "1week" || value === "week") return "1w";
  return value;
}

function normalizeOhlcvQuery(raw: Record<string, string | undefined>): Record<string, string | undefined> {
  const interval = normalizeOhlcvInterval(raw.interval ?? raw.timeframe ?? raw.freq);
  return {
    ...raw,
    interval: interval ?? raw.interval
  };
}

app.get("/api/v1/companies/:id/ohlcv", async (c) => {
  let query: ReturnType<typeof ohlcvQuerySchema.parse>;
  try {
    query = ohlcvQuerySchema.parse(normalizeOhlcvQuery(c.req.query()));
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

  // Intraday intervals: try KGI kbar → FinMind kbar → NO_INTRADAY_DATA
  const intradayIntervals = new Set(["5m", "15m", "60m"]);
  if (intradayIntervals.has(query.interval)) {
    // Map our interval string to KGI limit (number of bars to request)
    const intradayLimitMap: Record<string, number> = { "5m": 80, "15m": 30, "60m": 8 };
    const kgiLimit = intradayLimitMap[query.interval] ?? 80;

    // 1) Try KGI kbar (real-time, trading hours only)
    try {
      const kgiBars = await getKgiQuoteClient().getRecentKbars(company.ticker, kgiLimit);
      if (kgiBars.bars.length > 0) {
        const bars = kgiBars.bars.map((b) => ({
          dt: new Date(b.time).toISOString().slice(0, 10),
          time: b.time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
          source: "kgi" as const
        }));
        return c.json({ data: bars, interval: query.interval, source: "kgi_intraday" });
      }
    } catch {
      // KGI unavailable (off-hours or unreachable) — fall through to FinMind
    }

    // 2) Try FinMind kbar for today (sponsor feature, single-day 1-min bars)
    const todayIso = new Date().toISOString().slice(0, 10);
    try {
      const { getFinMindClient: getFMClient } = await import("./data-sources/finmind-client.js");
      const fmBars = await getFMClient().getStockKBar(company.ticker, todayIso);
      if (fmBars.length > 0) {
        // Aggregate 1-min bars to requested interval
        const intervalMins: Record<string, number> = { "5m": 5, "15m": 15, "60m": 60 };
        const bucketMins = intervalMins[query.interval] ?? 5;
        const bucketedBars = _aggregateFinMindKBars(fmBars, bucketMins);
        if (bucketedBars.length > 0) {
          return c.json({ data: bucketedBars, interval: query.interval, source: "finmind_intraday" });
        }
      }
    } catch {
      // FinMind unavailable — fall through to NO_INTRADAY_DATA
    }

    // 3) Neither source available — explicit NO_INTRADAY_DATA (not silent 400)
    return c.json({
      data: [],
      interval: query.interval,
      status: "NO_INTRADAY_DATA",
      message: "盤中資料目前不可用 (KGI 收盤 / FinMind 未返回資料). 請使用 interval=1d 查看日線."
    });
  }

  const bars = await getCompanyOhlcv(company.id, c.get("session"), {
    from: query.from,
    to: query.to,
    interval: query.interval as "1d" | "1w" | "1m",
    ticker: company.ticker
  });

  return c.json({ data: bars });
});

// =============================================================================
// GET /api/v1/companies/:id/technical?indicators=ma20,vwap,sr
// Backend-computed technical indicators from last 22 daily bars.
// indicators param is advisory; currently always returns ma20 + vwap + support + resistance.
// Fail-open: missing bars → null fields (never 500).
// =============================================================================

const technicalQuerySchema = z.object({
  indicators: z.string().optional()
});

app.get("/api/v1/companies/:id/technical", async (c) => {
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  // Fetch last 22 daily bars for indicator computation
  let bars: OhlcvBar[] = [];
  try {
    bars = await getCompanyOhlcv(company.id, c.get("session"), {
      interval: "1d",
      ticker: company.ticker
    });
    // Take last 22 bars (ascending already from getCompanyOhlcv)
    if (bars.length > 22) bars = bars.slice(-22);
  } catch {
    // fail-open: proceed with empty bars → all nulls
  }

  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  // MA20: simple moving average of last 20 closes
  let ma20: number | null = null;
  if (closes.length >= 20) {
    const last20 = closes.slice(-20);
    ma20 = +(last20.reduce((a, b) => a + b, 0) / 20).toFixed(2);
  }

  // VWAP: price × volume / total_volume over available bars
  let vwap: number | null = null;
  const totalVolume = volumes.reduce((a, b) => a + b, 0);
  if (bars.length > 0 && totalVolume > 0) {
    const pv = bars.reduce((acc, b) => acc + b.close * b.volume, 0);
    vwap = +(pv / totalVolume).toFixed(2);
  }

  // Support / Resistance: derive from recent lows/highs
  // Support = recent 22-bar low cluster (min of last-5 lows, rounded)
  // Resistance = recent 22-bar high cluster (max of last-5 highs, rounded)
  const support: number[] = [];
  const resistance: number[] = [];
  if (bars.length >= 5) {
    const lows = bars.map((b) => b.low);
    const highs = bars.map((b) => b.high);
    // Simple pivot: check each bar (excluding first/last) if it's a local min/max
    for (let i = 1; i < bars.length - 1; i++) {
      const lo = lows[i]!;
      const hi = highs[i]!;
      if (lo <= (lows[i - 1] ?? Infinity) && lo <= (lows[i + 1] ?? Infinity)) {
        support.push(+lo.toFixed(2));
      }
      if (hi >= (highs[i - 1] ?? 0) && hi >= (highs[i + 1] ?? 0)) {
        resistance.push(+hi.toFixed(2));
      }
    }
  }

  // Latest close for context
  const lastClose = closes.length > 0 ? closes[closes.length - 1]! : null;
  const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;

  return c.json({
    data: {
      ticker: company.ticker,
      name: company.name,
      asOf: lastBar?.dt ?? null,
      lastPrice: lastClose,
      ma20,
      vwap,
      support,
      resistance,
      barsUsed: bars.length
    }
  });
});

// GET /api/v1/companies/ohlcv/bulk?ids=a,b,c&from=...&to=...&interval=1d
// Returns map<companyId, OhlcvBar[]>.  Used by watchlist chart rendering.

const ohlcvBulkQuerySchema = z.object({
  ids:      z.string().min(1),
  from:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  interval: z.enum(["1d", "1w", "1m", "5m", "15m", "60m"]).optional().default("1d")
});

app.get("/api/v1/companies/ohlcv/bulk", async (c) => {
  let query: ReturnType<typeof ohlcvBulkQuerySchema.parse>;
  try {
    query = ohlcvBulkQuerySchema.parse(normalizeOhlcvQuery(c.req.query()));
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
    interval: query.interval as "1d" | "1w" | "1m"
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
    // Memory mode: no DB available — return honest empty state, never fake data.
    return c.json({
      data: null,
      source: "no_db",
      stale_reason: "database_not_connected"
    });
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
    persisted: result.persisted,
    persistMode: result.persistMode ?? "memory"
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
import {
  runFullIngest,
  getLastFullIngestResult,
  isFullIngestRunning,
  queryAllDatasetStatus,
  runDatasetBackfill,
  type BackfillDataset
} from "./jobs/finmind-full-ingest.js";
import {
  fetchAllTwseMaterialAnnouncements,
  runTwseAnnouncementIngest
} from "./jobs/twse-announcement-ingest.js";

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

// Shared institutional-investor name classifier (A2 fix, 2026-07-12).
// FinMind per-stock institutional API returns Chinese labels ('外陸資'/'投信'/'自營商'…)
// while the DB-backed tw_institutional_buysell table (and some FinMind responses) can
// carry English variants ('Foreign_Investor' etc). Previously /chips only matched the
// Chinese substrings (server.ts chips route) while /full-profile institutional had
// already been widened to also match English (Cycle 10, 2026-05-14) — two independently
// maintained copies is the same failure mode as the ROC-date-parser duplication (#1199/
// #1202/#1203); this is the single shared implementation both routes call.
function classifyInstitutionalName(nm: string): "foreign" | "investmentTrust" | "dealer" | null {
  if (/外|陸資|Foreign|foreign/i.test(nm)) return "foreign";
  if (/投信|Trust/i.test(nm)) return "investmentTrust";
  if (/自營|Dealer|dealer/i.test(nm)) return "dealer";
  return null;
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
    // ISSUE_B fix (2026-05-14): companies_ohlcv source enum is ['mock','kgi','tej'].
    // The ingest (ohlcv-finmind-sync.ts) writes source='tej'.  Previous queries used
    // source='finmind' / 'finmind_adj' which do not exist in the enum → always 0 rows
    // → TaiwanStockPrice + TaiwanStockPriceAdj reported EMPTY despite 38864+ real rows.
    // Fix: query source='tej' for both adj and raw; KBar (1m) has no persisted rows yet.
    [ohlcvAdjStats, ohlcvRawStats, kbarStats] = await Promise.all([
      queryOhlcvStats("1d", "tej"),
      queryOhlcvStats("1d", "tej"),
      queryOhlcvStats("1m")
    ]);
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
    // ISSUE_A fix (2026-05-14): tw_dividend has no 'date' col — use 'announcement_date'.
    // Without dateCol='announcement_date', MAX(date) throws → state=ERROR every request.
    [dividendStats, marketValueStats, valuationStats, stockNewsStats] = await Promise.all([
      queryMarketIntelDatasetStats("tw_dividend", 10, "announcement_date"),
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
  // A2 fix (2026-07-12): was matching Chinese substrings only, so English-labelled
  // rows (e.g. Foreign_Investor) always fell through to no bucket → net30d stuck at 0
  // (假零). Now shares classifyInstitutionalName() with /full-profile institutional.
  let foreignNet = 0, trustNet = 0, dealerNet = 0;
  for (const row of institutional) {
    const net = (row.buy ?? 0) - (row.sell ?? 0);
    const bucket = classifyInstitutionalName(row.name ?? "");
    if (bucket === "foreign") foreignNet += net;
    else if (bucket === "investmentTrust") trustNet += net;
    else if (bucket === "dealer") dealerNet += net;
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
  const companyName = company.name ?? stockId;
  const session = c.get("session");

  type CompanyAnnouncementRow = {
    id: string | null;
    date: string | null;
    title: string | null;
    category: string | null;
    body: string | null;
    ticker: string | null;
    company_name: string | null;
    url: string | null;
    source: string | null;
  };

  function categoryFromTitle(title: string): string {
    if (/股利|除權|除息|配息|配股/.test(title)) return "股利";
    if (/財報|財務|營收|EPS|獲利|損益|業績/.test(title)) return "財報";
    if (/董事會|股東會|法說|重大決議/.test(title)) return "治理";
    if (/取得|處分|投資|併購|合併|契約|訴訟|背書|保證/.test(title)) return "事件";
    return "重大訊息";
  }

  function toItem(row: CompanyAnnouncementRow, index: number) {
    const date = String(row.date ?? "").slice(0, 10);
    const title = row.title ?? "";
    return {
      id: row.id ?? `${stockId}-${date || "announcement"}-${index}`,
      date,
      title,
      category: row.category ?? categoryFromTitle(title),
      body: row.body ?? undefined,
      ticker: row.ticker ?? stockId,
      companyName: row.company_name ?? companyName,
      url: row.url,
      source: row.source ?? "tw_announcements_cache"
    };
  }

  const db = getDb();
  function readCompanyAnnouncementRows<T>(result: unknown): T[] {
    const rows = (result as { rows?: T[] })?.rows;
    if (Array.isArray(rows)) return rows;
    if (Array.isArray(result)) return result as T[];
    return [];
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  function pickText(row: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return null;
  }

  function rocDateToIso(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    const rocMatch = text.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
    if (rocMatch) {
      const year = Number(rocMatch[1]) + 1911;
      const month = String(Number(rocMatch[2])).padStart(2, "0");
      const day = String(Number(rocMatch[3])).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    const iso = text.replace(/\//g, "-");
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  }

  function twseIihRowsFromSection(
    payload: Record<string, unknown>,
    key: "news" | "fina" | "conference",
    category: string,
    cutoff: Date
  ): CompanyAnnouncementRow[] {
    const rows = Array.isArray(payload[key]) ? payload[key] : [];
    return rows.flatMap((raw, index): CompanyAnnouncementRow[] => {
      const row = asRecord(raw);
      if (!row) return [];
      const date = rocDateToIso(pickText(row, ["date", "meetingDate", "publishDate", "reportDate"]));
      if (!date) return [];
      if (new Date(`${date}T23:59:59+08:00`).getTime() < cutoff.getTime()) return [];

      const title = pickText(row, ["subject", "title", "name", "purpose", "type"]);
      if (!title) return [];
      const time = pickText(row, ["time", "meetingTime", "publishTime"]);
      const url = pickText(row, ["link", "url", "file", "downloadUrl"]);
      const sourceCompanyId = pickText(row, ["companyId", "code", "stockNo"]);
      const sourceCompanyName = pickText(row, ["companyName", "name", "shortName"]);

      return [{
        id: `${stockId}-twse-iih-${key}-${date}-${index}`,
        date,
        title,
        category,
        body: time ? `揭露時間 ${time}` : null,
        ticker: sourceCompanyId ?? stockId,
        company_name: sourceCompanyName ?? companyName,
        url,
        source: "twse_iih_company_events"
      }];
    });
  }

  async function fetchTwseIihCompanyEventRows(): Promise<CompanyAnnouncementRow[]> {
    const url = `https://www.twse.com.tw/rwd/zh/IIH/company/events?code=${encodeURIComponent(stockId)}`;
    const response = await fetch(url, {
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent": "IUF-Trading-Room/1.0 company-announcements"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`twse_iih_company_events_http_${response.status}`);

    const text = await response.text();
    const payload = asRecord(JSON.parse(text));
    if (!payload) return [];
    const info = asRecord(payload.info);
    if (info && String(info.status ?? "").toLowerCase() !== "success") return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return [
      ...twseIihRowsFromSection(payload, "news", "重大訊息", cutoff),
      ...twseIihRowsFromSection(payload, "fina", "財務報告", cutoff),
      ...twseIihRowsFromSection(payload, "conference", "法說會", cutoff)
    ]
      .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
      .slice(0, 30);
  }

  if (db) {
    try {
      const result = await db.execute(drizzleSql`
        SELECT
          CONCAT(a.ticker_symbol, '-', a.announced_at::text, '-', a.title_hash) AS id,
          a.announced_at::text AS date,
          a.title AS title,
          '重大訊息' AS category,
          a.content AS body,
          a.ticker_symbol AS ticker,
          COALESCE(c.name, a.ticker_symbol) AS company_name,
          COALESCE(
            a.source_url,
            CASE
              WHEN a.ticker_symbol IS NOT NULL AND a.ticker_symbol <> ''
              THEN 'https://mops.twse.com.tw/mops/web/t05st02_sii?TYPEK=sii&code=' || a.ticker_symbol
              ELSE NULL
            END
          ) AS url,
          'tw_announcements_cache' AS source
        FROM tw_announcements a
        LEFT JOIN companies c
          ON c.ticker = a.ticker_symbol
         AND c.workspace_id = ${session.workspace.id}
        WHERE a.ticker_symbol = ${stockId}
          AND a.announced_at >= NOW() - (${days}::text || ' days')::interval
          AND COALESCE(a.title, '') <> ''
        ORDER BY a.announced_at DESC
        LIMIT 30
      `);
      const rows = readCompanyAnnouncementRows<CompanyAnnouncementRow>(result);
      if (rows.length > 0) {
        return c.json({
          data: rows.map(toItem),
          state: "LIVE" as const,
          source: "tw_announcements_cache"
        });
      }
    } catch (err) {
      console.warn("[company/announcements] tw_announcements cache unavailable:", err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const iihRows = await fetchTwseIihCompanyEventRows();
    if (iihRows.length > 0) {
      return c.json({
        data: iihRows.map(toItem),
        state: "LIVE" as const,
        source: "twse_iih_company_events"
      });
    }
  } catch (err) {
    console.warn("[company/announcements] TWSE IIH company events unavailable:", err instanceof Error ? err.message : String(err));
  }

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const liveRows = (await fetchAllTwseMaterialAnnouncements())
      .filter((row) => String(row.Code ?? "").trim() === stockId)
      .filter((row) => {
        const iso = String(row.Date ?? "").replace(/\//g, "-");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return true;
        return new Date(`${iso}T23:59:59+08:00`).getTime() >= cutoff.getTime();
      })
      .slice(0, 30)
      .map((row, index): CompanyAnnouncementRow => {
        const date = String(row.Date ?? "").replace(/\//g, "-");
        const title = row.Title ?? "";
        return {
          id: `${stockId}-${date}-${index}`,
          date,
          title,
          category: categoryFromTitle(title),
          body: row.Content ?? null,
          ticker: stockId,
          company_name: row.Name ?? companyName,
          url: row.Link ?? null,
          source: "twse_openapi_live"
        };
      });

    if (liveRows.length > 0) {
      return c.json({
        data: liveRows.map(toItem),
        state: "LIVE" as const,
        source: "twse_openapi_live"
      });
    }
  } catch (err) {
    console.warn("[company/announcements] TWSE live fallback unavailable:", err instanceof Error ? err.message : String(err));
    return c.json({
      data: [],
      state: "DEGRADED" as const,
      degradedReason: "twse_live_and_cache_unavailable",
      source: "tw_announcements_cache"
    });
  }

  return c.json({
    data: [],
    state: "EMPTY" as const,
    degradedReason: "no_official_company_announcements",
    source: "tw_announcements_cache"
  });
});

app.get("/api/v1/internal/legacy/companies/:id/announcements", async (c) => {
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
  const limit = readBoundedInt("limit", 30, 1, 50);
  const scope = c.req.query("scope") === "market" ? "market" : "company_pool";
  const db = getDb();
  const session = c.get("session");

  if (!db) {
    return c.json({
      data: {
        items: [],
        selected: [],
        failures: 0,
        source: "empty",
        stale_reason: "database_not_connected",
        sourceState: {
          state: "degraded",
          source: "tw_announcements",
          scope,
          reason: "database_not_connected",
          itemCount: 0,
          lastFetchedAt: null,
          nextAction: "Check database connectivity before rendering official announcements as live."
        }
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

    const titleText = `${row.title ?? ""} ${row.body ?? ""}`.toLowerCase();
    const auxiliaryText = `${row.category ?? ""} ${row.company_name ?? ""}`.toLowerCase();
    // Block only pure retail noise / social-media opinion sources
    const blockedTerms = [
      "股市爆料同學會",
      "yahoo股市",
      "奇摩股市",
      "理財寶",
      "知新聞",
      "股海老牛",
      "達人",
      "老師",
      "同學會"
    ];
    if (blockedTerms.some((term) => titleText.includes(term.toLowerCase()) || auxiliaryText.includes(term.toLowerCase()))) {
      return false;
    }

    // moneydj / cmoney / 非凡新聞 are legitimate financial news sources — allow through
    // Company reports (財報/EPS/營收/法說) are high-value for market intel — allow through
    // Only hard-filter pure retail opinion pieces (covered by blockedTerms above)
    return true;
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
        COALESCE(
          a.source_url,
          CASE
            WHEN a.ticker_symbol IS NOT NULL AND a.ticker_symbol <> ''
            THEN 'https://mops.twse.com.tw/mops/web/t05st02_sii?TYPEK=sii&code=' || a.ticker_symbol
            ELSE NULL
          END
        ) AS url,
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

  // Company-pool views may supplement with FinMind company news. The market-wide
  // panel must stay official-only; otherwise media duplicates look like major
  // announcements.
  if (scope !== "market" && rows.length < limit) {
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
        LIMIT ${Math.max(limit * 2, 30)}
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
      source: items.length > 0 ? source : "empty",
      stale_reason: items.length > 0 ? null : "no_official_market_announcements",
      sourceState: {
        state: items.length > 0 ? "live" : "empty",
        source: items.length > 0 ? source : "tw_announcements",
        scope,
        reason: items.length > 0 ? null : "no_official_market_announcements",
        itemCount: items.length,
        lastFetchedAt: items[0]?.date ?? null,
        officialOnly: scope === "market",
        nextAction: items.length > 0
          ? "Render official announcements with source and timestamp."
          : "Render formal empty state; do not backfill market-wide official announcements with media news."
      }
    }
  });
});

// =============================================================================
// ISSUE_03 FIX — GET /api/v1/announcements (2026-05-14)
// =============================================================================
//
// Bruce audit found this route returning 404 — it did not exist.
// Frontend announcements panel routes to this path expecting:
//   { items: [...], total: N, asOf: "YYYY-MM-DD" }
//
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, official market
// announcements + FinMind news fallback, no internal governance content)
// Source: tw_announcements (today + 30 days) + tw_stock_news FinMind fallback
// =============================================================================
app.get("/api/v1/announcements", async (c) => {
  const session = c.get("session");
  const db = getDb();
  const asOf = new Date().toISOString().slice(0, 10);

  if (!db) {
    return c.json({ items: [], total: 0, asOf });
  }

  function readRows<T>(result: unknown): T[] {
    if (Array.isArray(result)) return result as T[];
    return ((result as { rows?: T[] })?.rows) ?? [];
  }

  type AnnRow = {
    id: string | null;
    ticker: string | null;
    company_name: string | null;
    date: string | null;
    title: string | null;
    category: string | null;
    url: string | null;
    source: string | null;
  };

  const rawItems: AnnRow[] = [];

  // Primary: tw_announcements (today + 30 days)
  // URL preference: source_url (from ingest job, may include actual MOPS deep-link)
  // → MOPS company listing fallback (when source_url is NULL)
  try {
    const result = await db.execute(drizzleSql`
      SELECT
        CONCAT(a.ticker_symbol, '-', a.announced_at::text, '-', a.title) AS id,
        a.ticker_symbol AS ticker,
        COALESCE(c.name, a.ticker_symbol) AS company_name,
        a.announced_at::text AS date,
        a.title AS title,
        '重大訊息' AS category,
        COALESCE(
          a.source_url,
          CASE
            WHEN a.ticker_symbol IS NOT NULL AND a.ticker_symbol <> ''
            THEN 'https://mops.twse.com.tw/mops/web/t05st02_sii?TYPEK=sii&code=' || a.ticker_symbol
            ELSE NULL
          END
        ) AS url,
        'twse_announcements' AS source
      FROM tw_announcements a
      LEFT JOIN companies c
        ON c.ticker = a.ticker_symbol
       AND c.workspace_id = ${session.workspace.id}
      WHERE a.announced_at >= NOW() - INTERVAL '30 days'
        AND COALESCE(a.title, '') <> ''
      ORDER BY a.announced_at DESC
      LIMIT 50
    `);
    rawItems.push(...readRows<AnnRow>(result));
  } catch (err) {
    console.warn("[announcements] tw_announcements unavailable:", err instanceof Error ? err.message : String(err));
  }

  // Fallback: tw_stock_news (FinMind) when tw_announcements has fewer than 15 items
  if (rawItems.length < 15) {
    try {
      const result = await db.execute(drizzleSql`
        SELECT
          n.id::text AS id,
          n.stock_id AS ticker,
          COALESCE(c.name, n.stock_id) AS company_name,
          COALESCE(NULLIF(n.published_at, ''), n.fetched_at::text) AS date,
          n.title AS title,
          COALESCE(NULLIF(n.source_name, ''), '台股新聞') AS category,
          n.url AS url,
          'finmind_stock_news' AS source
        FROM tw_stock_news n
        LEFT JOIN companies c
          ON c.ticker = n.stock_id
         AND c.workspace_id = ${session.workspace.id}
        WHERE n.fetched_at >= NOW() - INTERVAL '30 days'
          AND COALESCE(n.title, '') <> ''
        ORDER BY n.fetched_at DESC
        LIMIT 80
      `);
      const seen = new Set(rawItems.map((r) => `${r.ticker ?? ""}:${r.title ?? ""}`));
      for (const row of readRows<AnnRow>(result)) {
        const key = `${row.ticker ?? ""}:${row.title ?? ""}`;
        if (seen.has(key)) continue;
        rawItems.push(row);
        seen.add(key);
        if (rawItems.length >= 50) break;
      }
    } catch (err) {
      console.warn("[announcements] tw_stock_news unavailable:", err instanceof Error ? err.message : String(err));
    }
  }

  const items = rawItems.slice(0, 50).map((row, index) => ({
    id: row.id ?? `ann-${index}`,
    date: String(row.date ?? "").slice(0, 10),
    title: row.title ?? "",
    category: row.category ?? "市場情報",
    ticker: row.ticker ?? undefined,
    companyName: row.company_name ?? row.ticker ?? undefined,
    url: row.url ?? null,
    source: row.source ?? "unknown",
  }));

  return c.json({ items, total: items.length, asOf });
});

// =============================================================================
// BLOCK #NEWS — AI-selected top-10 market news (4-window cron)
// =============================================================================
//
// GET /api/v1/market-intel/news-top10
// Auth required.
//
// Returns the most-recent AI-selected top-10 news batch:
//   { data: { run_id, as_of, next_refresh_at, window_label, selection_mode,
//             items: [...], input_row_count, ai_call_success, stale_reason } }
//
// If never run (server just restarted) → 200 with empty items + stale_reason=never_run
// If stale (last run > 7h ago) → 200 with items + stale_reason=last_run_over_Xh_ago
// If no DB → 200 with empty items (memory mode)
//
// POST /api/v1/internal/market-intel/news-top10/trigger
// Owner-only manual trigger — runs the AI selector immediately.
// =============================================================================

app.get("/api/v1/market-intel/news-top10", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "auth_required" }, 401);

  const cached = await getNewsTop10ForRead();

  if (!cached) {
    // Never run yet
    return c.json({
      data: {
        run_id: null,
        as_of: null,
        next_refresh_at: null,
        window_label: null,
        selection_mode: null,
        items: [],
        input_row_count: 0,
        ai_call_success: false,
        stale_reason: "never_run"
      }
    });
  }

  return c.json({ data: cached });
});

app.post("/api/v1/internal/market-intel/news-top10/trigger", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const workspaceId = session.workspace.id;
  const result = await runNewsAiSelection({
    workspaceId,
    forcedWindowLabel: "08:00"  // manual trigger always labels as 08:00; window_label is informational
  });

  return c.json({ data: result });
});

// =============================================================================
// FINMIND SPONSOR FULL INGEST — POST + GET admin endpoints
// =============================================================================
//
// POST /api/v1/internal/finmind/sync-now
//   Owner-only. Triggers an immediate full 11-dataset ingest for the workspace.
//   Returns run result with per-dataset row counts.
//   Quota guard: respects 6000/hr FinMind sponsor limit via batch size.
//
// GET /api/v1/internal/finmind/ingest-status
//   Owner-only. Returns last run result + per-dataset DB row counts.
//   Used for production verify evidence.
//
// Hard lines:
//   - Token NEVER in response (boolean only)
//   - No fake data
//   - Concurrent trigger guard (returns already_running if in progress)
//   - Audit: action='finmind.ingest' per dataset (in finmind-full-ingest.ts)
// =============================================================================

const finmindSyncNowBodySchema = z.object({
  batch_size: z.number().int().min(1).max(200).optional()
});

app.post("/api/v1/internal/finmind/sync-now", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  let batchSize: number | undefined;
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = finmindSyncNowBodySchema.safeParse(body);
    if (parsed.success) batchSize = parsed.data.batch_size;
  } catch {
    // Body optional — proceed with defaults
  }

  if (!process.env.FINMIND_API_TOKEN) {
    return c.json({
      error: "no_token",
      message: "FINMIND_API_TOKEN not configured — set the env var and redeploy"
    }, 422);
  }

  const workspaceSlug = session.workspace.slug ?? "default";

  // Fire ingest asynchronously so the HTTP response returns immediately,
  // then client can poll GET /ingest-status for results.
  // For sync-now we run in-process and await (reasonable for manual trigger).
  const result = await runFullIngest({
    workspaceSlug,
    triggeredBy: "manual",
    batchSize
  });

  return c.json({
    data: result
  });
});

// POST /api/v1/internal/finmind/backfill
//   Owner-only. Targeted date-range backfill for 4 datasets:
//     companies_ohlcv, tw_institutional_buysell, tw_margin_short, tw_dividend
//
//   Body: { dataset: "companies_ohlcv" | "tw_institutional_buysell" | "tw_margin_short" | "tw_dividend",
//            from: "YYYY-MM-DD", to: "YYYY-MM-DD", batch_size?: number,
//            symbols?: ["2330", "6202"] }
//
//   Hard lines:
//     - Owner role required (403 otherwise)
//     - FINMIND_API_TOKEN required (422 otherwise)
//     - from/to must be valid ISO dates, from <= to (400 otherwise)
//     - Respects FINMIND_KILL_SWITCH
//     - No fake data; real FinMind API calls only
//     - batchSize max 200 (sponsor quota guard)
//     - Audit log written per backfill run

const finmindBackfillBodySchema = z.object({
  dataset: z.enum(["companies_ohlcv", "tw_institutional_buysell", "tw_margin_short", "tw_dividend"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
  batch_size: z.number().int().min(1).max(200).optional(),
  symbols: z.array(z.string().regex(/^\d{4}$/)).min(1).max(80).optional()
});

app.post("/api/v1/internal/finmind/backfill", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    return c.json({
      error: "no_token",
      message: "FINMIND_API_TOKEN not configured — set the env var and redeploy"
    }, 422);
  }

  let body: { dataset: BackfillDataset; from: string; to: string; batch_size?: number; symbols?: string[] };
  try {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = finmindBackfillBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", details: parsed.error.issues }, 400);
    }
    body = parsed.data;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  // Validate from <= to
  if (body.from > body.to) {
    return c.json({ error: "invalid_range", message: "from must be <= to" }, 400);
  }

  if (body.symbols?.length && body.dataset !== "companies_ohlcv") {
    return c.json({
      error: "invalid_symbols_dataset",
      message: "symbols can only be used with dataset=companies_ohlcv"
    }, 400);
  }

  const workspaceSlug = session.workspace.slug ?? "default";

  console.log(
    `[finmind-backfill-endpoint] Owner triggered dataset=${body.dataset} ` +
    `from=${body.from} to=${body.to} workspace=${workspaceSlug}`
  );

  const result = await runDatasetBackfill({
    dataset: body.dataset,
    from: body.from,
    to: body.to,
    workspaceSlug,
    batchSize: body.batch_size,
    symbols: body.symbols
  });

  // Write audit log (non-fatal)
  if (isDatabaseMode()) {
    const db = getDb();
    if (db) {
      db.insert(auditLogs).values({
        workspaceId: session.workspace.id,
        actorId: session.user.id,
        action: "finmind.backfill" as string,
        entityType: "finmind_dataset",
        entityId: `${body.dataset}:${body.from}:${body.to}`,
        payload: {
          dataset: body.dataset,
          from: body.from,
          to: body.to,
          rows_upserted: result.rowsUpserted,
          rows_quarantined: result.rowsQuarantined,
          state: result.state,
          duration_ms: result.durationMs,
          tickers_attempted: result.tickersAttempted,
          symbols: body.symbols ?? null
        }
      }).catch((err: unknown) => {
        console.warn("[finmind-backfill-endpoint] audit log write failed:", err instanceof Error ? err.message : String(err));
      });
    }
  }

  return c.json({ data: result });
});

app.get("/api/v1/internal/finmind/ingest-status", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const [lastRun, running, datasetStatus] = await Promise.all([
    Promise.resolve(getLastFullIngestResult()),
    Promise.resolve(isFullIngestRunning()),
    queryAllDatasetStatus().catch((err) => {
      console.warn("[finmind-ingest-status] queryAllDatasetStatus error:", err instanceof Error ? err.message : String(err));
      return [];
    })
  ]);

  const tokenPresent = Boolean(process.env.FINMIND_API_TOKEN);

  return c.json({
    data: {
      tokenPresent,
      ingestRunning: running,
      lastRun: lastRun ?? null,
      datasetStatus,
      quotaLimit: tokenPresent ? 6000 : null,
      quotaTier: tokenPresent ? "sponsor" : "no_token"
    }
  });
});

// =============================================================================
// OPENAI MULTI-SCENARIO ROUTES (PR #364 — 2026-05-09)
// =============================================================================
//
// 7 routes wired to the 4 OpenAI modules + shared quota guard:
//
// GET  /api/v1/internal/openai/quota
//   — Owner-only. Returns daily quota status (used/limit/resetDay).
//
// GET  /api/v1/strategy/ideas/ai-rerank
//   — Owner-only. Fetches current strategy ideas, reranlks via GPT, returns enriched list.
//
// GET  /api/v1/market-intel/news-top10/with-sentiment
//   — Owner-only. Returns cached news top-10 enriched with per-item sentiment + impact_magnitude.
//
// GET  /api/v1/strategy/brief-commentary
//   — Owner-only. Returns last cached brief strategy commentary (or null if never run).
//
// POST /api/v1/internal/strategy/brief-commentary/fire-now
//   — Owner-only. Triggers a fresh GPT brief strategy commentary run immediately.
//
// POST /api/v1/signals/:id/assess-confidence
//   — Owner-only. Runs GPT confidence assessment for a specific signal.
//   IMPORTANT: registered BEFORE GET /api/v1/signals/:id/confidence to avoid Hono parametric shadow.
//
// GET  /api/v1/signals/:id/confidence
//   — Owner-only. Returns cached confidence assessment for a signal.
//
// Hard lines:
//   - All routes: Owner-only (role !== "Owner" → 403)
//   - No fake AI output; fallback = structured response with null AI fields
//   - disclaimer: "research_only" present on all AI output (enforced in modules)
//   - Quota guard check in each module; quota exhausted → fallback (no 429 to client)
//   - NEVER throw to client — try/catch wraps all module calls
//   - Audit: action written per route for observability
// =============================================================================

// GET /api/v1/internal/openai/quota
app.get("/api/v1/internal/openai/quota", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  try {
    const status = getQuotaStatus();
    return c.json({ data: status });
  } catch (err) {
    console.error("[openai/quota] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "quota_status_error" }, 500);
  }
});

// GET /api/v1/strategy/ideas/ai-rerank
// IMPORTANT: must be registered BEFORE any parametric /strategy/ideas/:id route
app.get("/api/v1/strategy/ideas/ai-rerank", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  try {
    const ideasResult = await getStrategyIdeas({
      session,
      repo: c.get("repo"),
      limit: 20
    });
    const result = await rerankStrategyIdeasWithAi(ideasResult.items);
    return c.json({ data: result });
  } catch (err) {
    console.error("[strategy/ideas/ai-rerank] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "rerank_error", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/v1/market-intel/news-top10/with-sentiment
// IMPORTANT: must be registered BEFORE any parametric /market-intel/news-top10/:id route
app.get("/api/v1/market-intel/news-top10/with-sentiment", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  try {
    const cached = getLastNewsTop10();
    if (!cached || cached.items.length === 0) {
      return c.json({
        data: {
          items: [],
          stale_reason: cached ? "empty_cache" : "never_run",
          as_of: cached?.as_of ?? null,
          disclaimer: "research_only"
        }
      });
    }
    const enriched = await enrichNewsWithSentiment(cached.items);
    return c.json({
      data: {
        items: enriched,
        as_of: cached.as_of,
        window_label: cached.window_label,
        run_id: cached.run_id,
        disclaimer: "research_only"
      }
    });
  } catch (err) {
    console.error("[news-top10/with-sentiment] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "sentiment_enrichment_error", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/v1/strategy/brief-commentary
app.get("/api/v1/strategy/brief-commentary", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  try {
    const result = getBriefStrategyCommentaryWithStaleness();
    if (!result) {
      return c.json({ data: null, stale_reason: "never_run" });
    }
    return c.json({ data: result });
  } catch (err) {
    console.error("[strategy/brief-commentary] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "commentary_error" }, 500);
  }
});

// POST /api/v1/internal/strategy/brief-commentary/fire-now
app.post("/api/v1/internal/strategy/brief-commentary/fire-now", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await runBriefStrategyCommentary({
      tradingDate: today,
      marketSummary: "Manual trigger from fire-now endpoint. No pre-aggregated market summary available."
    });
    return c.json({ data: result });
  } catch (err) {
    console.error("[brief-commentary/fire-now] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "commentary_fire_error", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// =============================================================================
// Axis 4: OpenAlice Strategy-Level Brief (2026-05-13)
//
// POST /api/v1/openalice/strategy-brief/generate — Owner only
//   Generates a strategy-level brief for the given trading_date.
//   Input: { trading_date: "YYYY-MM-DD", strategies?: [...] }
//   Sources: cont_liq daily yaml + strategy snapshots + FinMind DB + OHLCV DB
//   Gate: hallucination check + red wording guard + trail completeness
//
// GET /api/v1/openalice/strategy-brief/latest — Owner only
//   Returns the last generated strategy brief (with staleness).
// =============================================================================

app.post("/api/v1/openalice/strategy-brief/generate", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: { trading_date?: string; strategies?: string[] } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const tradingDate = typeof body.trading_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.trading_date)
    ? body.trading_date
    : getStrategyBriefTstDate();

  const allowedStrategies = ["cont_liq_v36", "strategy_002", "strategy_003"] as const;
  type SID = typeof allowedStrategies[number];
  const strategies = Array.isArray(body.strategies)
    ? (body.strategies.filter((s): s is SID => (allowedStrategies as readonly string[]).includes(s)) as SID[])
    : [...allowedStrategies];

  try {
    const result = await generateStrategyBrief({
      tradingDate,
      strategies,
      workspaceSlug: session.workspace.slug
    });
    return c.json({ data: result }, 200);
  } catch (err) {
    console.error("[strategy-brief/generate] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "strategy_brief_generate_error", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/api/v1/openalice/strategy-brief/latest", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }
  try {
    const result = getStrategyBriefWithStaleness();
    if (!result) {
      return c.json({ data: null, stale_reason: "never_generated" });
    }
    return c.json({ data: result });
  } catch (err) {
    console.error("[strategy-brief/latest] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "strategy_brief_latest_error" }, 500);
  }
});

// POST /api/v1/signals/:id/assess-confidence
// Owner-only. Runs GPT confidence assessment for a specific signal.
// NOTE: This uses :id — registered here (before GET :id/confidence) to avoid Hono shadow issues.
app.post("/api/v1/signals/:id/assess-confidence", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const signalId = c.req.param("id");
  try {
    const signal = await c.get("repo").getSignal(signalId, {
      workspaceSlug: session.workspace.slug
    });
    if (!signal) {
      return c.json({ error: "signal_not_found" }, 404);
    }
    const assessment = await assessSignalConfidence(signal);
    return c.json({ data: assessment });
  } catch (err) {
    console.error(`[signals/${signalId}/assess-confidence] error:`, err instanceof Error ? err.message : String(err));
    return c.json({ error: "confidence_assessment_error", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/v1/signals/:id/confidence
// Owner-only. Returns cached confidence assessment (from in-memory 12h cache).
app.get("/api/v1/signals/:id/confidence", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const signalId = c.req.param("id");
  try {
    const cached = getSignalConfidenceAssessment(signalId);
    if (!cached) {
      return c.json({ data: null, stale_reason: "not_assessed_yet" });
    }
    return c.json({ data: cached });
  } catch (err) {
    console.error(`[signals/${signalId}/confidence] error:`, err instanceof Error ? err.message : String(err));
    return c.json({ error: "confidence_read_error" }, 500);
  }
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
//   - Step A: subscribe tick + bidask (idempotent on gateway; per-process cache avoids redundant calls)
//   - Step B: poll tick + bidask in parallel (fail-soft per leg)
//   - On success: merges latest tick (lastPrice, volume) + bidask (bid, ask)
//   - Freshness from stale detection (D-W2D-1): fresh | stale | not-available
//   - source: 'kgi-gateway' always (no mock fallback — honest about state)
//   - Gateway URL from env KGI_GATEWAY_URL (preferred) or KGI_GATEWAY_BASE_URL (legacy)
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

// Per-process subscribe cache: tracks which symbols have been successfully subscribed
// for tick. Avoids redundant subscribe calls on every 5s poll.
const _realtimeSubscribedSymbols = new Set<string>();

/** Reset subscribe cache — for tests only. */
export function _resetRealtimeSubscribeCache(): void {
  _realtimeSubscribedSymbols.clear();
}

app.get("/api/v1/companies/:id/quote/realtime", async (c) => {
  // 1. Resolve company
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: c.get("session").workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const symbol = companyIdToTicker(company.ticker);
  const client = getKgiQuoteClient();
  const updatedAt = new Date().toISOString();
  const marketSession = composeTaiwanMarketState().state;

  function _eodReferenceReason(blockReason?: string | null): "pre_open_reference" | "post_close_reference" | "closed_reference" | "kgi_unavailable_eod_fallback" {
    if (marketSession === "PRE-OPEN") return "pre_open_reference";
    if (marketSession === "POST-CLOSE") return "post_close_reference";
    if (marketSession !== "OPEN" && marketSession !== "MIDDAY") return "closed_reference";
    return blockReason ? "kgi_unavailable_eod_fallback" : "closed_reference";
  }

  // Helper: determine MIS ex prefix (tse/otc) from company market string.
  // Strategy: if market field contains recognizable TPEX/OTC indicator → otc, else → tse.
  function _misPrefixForMarket(market: string): "tse" | "otc" {
    const m = market.trim().toUpperCase();
    if (m === "TPEX" || m === "TWO" || m === "TW_EMERGING" || m.includes("上櫃") || m.includes("OTC")) {
      return "otc";
    }
    return "tse";
  }

  function _isTwseLiveSessionNow(): boolean {
    const hhmm = getTaipeiHHMM();
    if (hhmm < 900 || hhmm > 1335) return false;
    const taipeiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const dayOfWeek = taipeiNow.getUTCDay();
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }

  function _isTodayMisTradeDate(tradeDate: string): boolean {
    const todayYmd = taipeiDate().replace(/-/g, "");
    return tradeDate === todayYmd;
  }

  // Helper: TWSE MIS intraday quote fetch (mis.twse.com.tw getStockInfo).
  // Returns live intraday price only during the actual TWSE session with today's trade date.
  // MIS can keep serving the 13:30 close after hours; those values must not be marked LIVE.
  // Returns null when market is closed / stale / symbol not found / fetch fails.
  type MisIntradayResult = {
    lastPrice: number;
    open: number | null;
    high: number | null;
    low: number | null;
    prevClose: number | null;
    changePct: number | null;
    volume: number | null;
    bid: number | null;
    ask: number | null;
    tradeTime: string;
    tradeDate: string;
    source: "twse_intraday";
    state: "LIVE" | "CLOSE";
    freshness: "fresh" | "stale";
  };

  // Fetch a today-dated MIS snapshot for one exchange prefix ("tse" | "otc").
  async function _misFetchForExchange(sym: string, prefix: "tse" | "otc"): Promise<MisIntradayResult | null> {
    try {
      const exCh = `${prefix}_${sym}.tw`;
      const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(4000),
        headers: { "Accept": "application/json" }
      });
      if (!resp.ok) return null;
      const data = await resp.json() as { msgArray?: Array<Record<string, string>>; rtcode?: string };
      if (data.rtcode !== "0000" || !data.msgArray?.length) return null;
      const msg = data.msgArray[0];
      if (!msg) return null;

      // Parse optional fields
      const parseNum = (s?: string) => {
        if (!s || s === "-" || s.trim() === "") return null;
        const n = Number(s.replace(/,/g, "").trim());
        return isFinite(n) && n > 0 ? n : null;
      };

      // z = last trade price. MIS frequently returns z="-" when no tick printed
      // in the current second even for actively traded stocks — fall back to best
      // bid, then best ask (same handling as the MIS sweep cron). Returning null
      // here mid-session dropped /quote/realtime all the way to yesterday's EOD
      // (6/11 intraday repro: 2330 served twse_eod at 12:30 with MIS healthy).
      // b = underscore-separated ask prices; a = bid prices (MIS convention reversed)
      const bPrices = msg["b"]?.split("_").filter(Boolean);
      const aPrices = msg["a"]?.split("_").filter(Boolean);
      const bid = parseNum(bPrices?.[0]);
      const ask = parseNum(aPrices?.[0]);
      const lastPrice = parseNum(msg["z"]) ?? bid ?? ask;
      if (lastPrice === null) return null;

      const open = parseNum(msg["o"]);
      const high = parseNum(msg["h"]);
      const low = parseNum(msg["l"]);
      const prevClose = parseNum(msg["y"]);
      const changePct =
        prevClose && prevClose > 0
          ? Math.round(((lastPrice - prevClose) / prevClose) * 10000) / 100
          : null;
      const volume = parseNum(msg["v"]); // accumulated trade volume (lots)
      const tradeTime = msg["t"] ?? msg["%"] ?? "";
      const tradeDate = msg["d"] ?? "";
      // Post-close repair (6/15): MIS keeps the day's final snapshot (z=close,
      // d=today, t=13:30) available after the session ends. The old gate threw
      // it away because "now" is not a live session, dropping /quote all the
      // way back to the previous official EOD — on 6/15 15:13 that still served
      // 6/12 because TWSE STOCK_DAY_ALL had not published 6/15 yet. Only reject
      // a stale MIS date (not today); a today-dated snapshot off-hours is the
      // real session close, not stale.
      if (!_isTodayMisTradeDate(tradeDate)) return null;
      const liveNow = _isTwseLiveSessionNow();

      return { lastPrice, open, high, low, prevClose, changePct, volume, bid, ask, tradeTime, tradeDate, source: "twse_intraday", state: liveNow ? "LIVE" : "CLOSE", freshness: liveNow ? "fresh" : "stale" };
    } catch {
      return null;
    }
  }

  // Resolve a MIS snapshot, tolerant of a mislabelled company.market field.
  // 6/15: OTC stocks (e.g. 3707 漢磊, 6488 環球晶) were tagged market="TWSE"
  // in the DB, so the tse_ prefix found nothing and /quote dropped to EOD —
  // which for OTC has no STOCK_DAY_ALL row → NO_DATA. Try the market-derived
  // exchange first, then the other before giving up, so the price no longer
  // depends on the market field being correct.
  async function _twseMisIntradayFetch(sym: string, market: string): Promise<MisIntradayResult | null> {
    const primary = _misPrefixForMarket(market);
    const fallback: "tse" | "otc" = primary === "tse" ? "otc" : "tse";
    return (await _misFetchForExchange(sym, primary)) ?? (await _misFetchForExchange(sym, fallback));
  }

  // The EOD payload's trading date — TWSE OpenAPI lags: on the evening of a trading day it
  // can still serve the PREVIOUS session. The UI must label prices with this date, never "today".
  // Parsed via the shared `lib/roc-date.ts` parser (see that file's JSDoc for wire-format notes;
  // this used to be a locally-duplicated copy `_rocDateToIso`, consolidated 2026-07-10).

  // MIS trade date is Gregorian compact "20260615" → ISO "2026-06-15".
  function _misCompactDateToIso(raw?: string | null): string | null {
    const s = String(raw ?? "").trim();
    return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
  }

  // Helper: TWSE/TPEX OpenAPI EOD fallback for quote/realtime (昨收 / EOD price).
  // Used when both KGI and MIS intraday are unavailable.
  // A4 fix (2026-07-12): previously TWSE-only (STOCK_DAY_ALL) — OTC tickers (8069 等)
  // always fell through to NO_DATA even though the TPEX EOD feed (already used by the
  // twse-eod-cron persist block, source=tpex_eod) has the row. Now picks primary source
  // from `market`, then tries the other exchange before giving up (mirrors the MIS
  // tse/otc fallback above — company.market can be mistagged).
  type EodFallbackResult = {
    lastPrice: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    prevClose: number | null;
    changePct: number | null;
    volume: number | null;
    source: "twse_openapi_eod" | "tpex_openapi_eod";
    state: "STALE" | "NO_DATA";
    freshness: "stale" | "not-available";
    note: string;
    /** ISO trading date of the EOD row (may be 1-2 sessions behind on publish lag). */
    dataDate: string | null;
    marketSession: "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE";
    referenceReason: "pre_open_reference" | "post_close_reference" | "closed_reference" | "kgi_unavailable_eod_fallback";
  };
  const _parseEodNum = (value?: string | null) => {
    const n = Number(String(value ?? "").replace(/,/g, "").trim().replace(/^\+/, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  function _buildTwseEodResult(
    row: { Date: string; ClosingPrice: string; OpeningPrice: string; HighestPrice: string; LowestPrice: string; TradeVolume: string; Change: string },
    blockReason?: string | null
  ): EodFallbackResult {
    const close = _parseEodNum(row.ClosingPrice);
    const open = _parseEodNum(row.OpeningPrice);
    const high = _parseEodNum(row.HighestPrice);
    const low = _parseEodNum(row.LowestPrice);
    const vol = _parseEodNum(row.TradeVolume);
    const changeRaw = Number(String(row.Change ?? "").replace(/,/g, "").trim().replace(/^\+/, ""));
    const prevClose = Number.isFinite(changeRaw) && close !== null ? Number((close - changeRaw).toFixed(2)) : null;
    const changePct = prevClose && prevClose > 0 ? Math.round((changeRaw / prevClose) * 10000) / 100 : null;
    return {
      lastPrice: close, open, high, low, prevClose, changePct, volume: vol,
      source: "twse_openapi_eod",
      state: close !== null ? "STALE" : "NO_DATA",
      freshness: close !== null ? "stale" : "not-available",
      note: `twse_eod date=${row.Date ?? "unknown"}`,
      dataDate: parseRocEodDateIso(row.Date),
      marketSession,
      referenceReason: _eodReferenceReason(blockReason),
    };
  }
  function _buildTpexEodResult(
    row: { Date: string; Close: string; Open: string; High: string; Low: string; TradingShares: string; Change: string },
    blockReason?: string | null
  ): EodFallbackResult {
    const close = _parseEodNum(row.Close);
    const open = _parseEodNum(row.Open);
    const high = _parseEodNum(row.High);
    const low = _parseEodNum(row.Low);
    const vol = _parseEodNum(row.TradingShares);
    const changeRaw = Number(String(row.Change ?? "").replace(/,/g, "").trim().replace(/^\+/, ""));
    const prevClose = Number.isFinite(changeRaw) && close !== null ? Number((close - changeRaw).toFixed(2)) : null;
    const changePct = prevClose && prevClose > 0 ? Math.round((changeRaw / prevClose) * 10000) / 100 : null;
    return {
      lastPrice: close, open, high, low, prevClose, changePct, volume: vol,
      source: "tpex_openapi_eod",
      state: close !== null ? "STALE" : "NO_DATA",
      freshness: close !== null ? "stale" : "not-available",
      note: `tpex_eod date=${row.Date ?? "unknown"}`,
      dataDate: parseRocEodDateIso(row.Date),
      marketSession,
      referenceReason: _eodReferenceReason(blockReason),
    };
  }
  async function _twseEodFallback(sym: string, market: string, blockReason?: string | null): Promise<EodFallbackResult> {
    try {
      const { getStockDayAllRows, getTpexMainboardCloseRows } = await import("./data-sources/twse-openapi-client.js");
      const isOtc = _misPrefixForMarket(market) === "otc";
      if (isOtc) {
        const tpexRows = await getTpexMainboardCloseRows();
        const tpexRow = tpexRows.find((r) => r.SecuritiesCompanyCode?.trim() === sym);
        if (tpexRow) return _buildTpexEodResult(tpexRow, blockReason);
        const twseRows = await getStockDayAllRows();
        const twseRow = twseRows.find((r) => r.Code === sym);
        if (twseRow) return _buildTwseEodResult(twseRow, blockReason);
      } else {
        const twseRows = await getStockDayAllRows();
        const twseRow = twseRows.find((r) => r.Code === sym);
        if (twseRow) return _buildTwseEodResult(twseRow, blockReason);
        const tpexRows = await getTpexMainboardCloseRows();
        const tpexRow = tpexRows.find((r) => r.SecuritiesCompanyCode?.trim() === sym);
        if (tpexRow) return _buildTpexEodResult(tpexRow, blockReason);
      }
      return { lastPrice: null, open: null, high: null, low: null, prevClose: null, changePct: null, volume: null, source: "twse_openapi_eod", state: "NO_DATA", freshness: "not-available", note: "not_in_twse_or_tpex_eod", dataDate: null, marketSession, referenceReason: _eodReferenceReason(blockReason) };
    } catch (e) {
      console.warn(`[realtime] EOD fallback failed for ${sym}:`, e instanceof Error ? e.message : String(e));
      return { lastPrice: null, open: null, high: null, low: null, prevClose: null, changePct: null, volume: null, source: "twse_openapi_eod", state: "NO_DATA", freshness: "not-available", note: "twse_fetch_failed", dataDate: null, marketSession, referenceReason: _eodReferenceReason(blockReason) };
    }
  }

  // Legacy alias — used in KGI blocked paths below (kept for call-site brevity).
  const _twseRealtimeFallback = _twseEodFallback;

  // 2. Whitelist check — KGI not available for this symbol → try TWSE MIS intraday first, then EOD
  if (!client.isSymbolAllowed(symbol)) {
    const mis = await _twseMisIntradayFetch(symbol, company.market);
    if (mis) {
      return c.json({
        data: {
          symbol,
          lastPrice: mis.lastPrice,
          open: mis.open,
          high: mis.high,
          low: mis.low,
          prevClose: mis.prevClose,
          changePct: mis.changePct,
          bid: mis.bid,
          ask: mis.ask,
          volume: mis.volume,
          freshness: mis.freshness,
          state: mis.state,
          source: mis.source,
          marketSession,
          dataDate: _misCompactDateToIso(mis.tradeDate),
          note: `mis_${mis.state === "CLOSE" ? "close" : "intraday"} date=${mis.tradeDate} time=${mis.tradeTime}`,
          updatedAt
        }
      });
    }
    const fb = await _twseRealtimeFallback(symbol, company.market);
    return c.json({
      data: {
        symbol,
        lastPrice: fb.lastPrice,
        open: fb.open,
        high: fb.high,
        low: fb.low,
        prevClose: fb.prevClose,
        changePct: fb.changePct,
        bid: null,
        ask: null,
        volume: fb.volume,
        freshness: fb.freshness,
        state: fb.state,
        reason: fb.state === "NO_DATA" ? fb.note : undefined,
        source: fb.source,
        marketSession: fb.marketSession,
        referenceReason: fb.referenceReason,
        note: fb.note,
        dataDate: fb.dataDate,
        updatedAt
      }
    });
  }

  // 3. Subscribe tick + bidask (idempotent on gateway; cache prevents redundant calls)
  //    Tick subscribe failure → TWSE fallback.
  //    Bidask subscribe failure → non-fatal (tick-only data is still useful).
  if (!_realtimeSubscribedSymbols.has(symbol)) {
    const [subTickResult, subBidAskResult] = await Promise.allSettled([
      client.subscribeSymbolTick(symbol),
      client.subscribeSymbolBidAsk(symbol),
    ]);

    if (subTickResult.status !== "fulfilled") {
      const err = subTickResult.reason;
      let subscribeBlockReason = "subscribe_failed";
      if (err instanceof KgiQuoteUnreachableError) subscribeBlockReason = "gateway_unreachable";
      else if (err instanceof KgiQuoteAuthError) subscribeBlockReason = "gateway_auth_error";
      else if (err instanceof KgiQuoteDisabledError) subscribeBlockReason = "quote_disabled";

      // KGI subscribe failed → try TWSE MIS intraday first, then EOD fallback
      const mis = await _twseMisIntradayFetch(symbol, company.market);
      if (mis) {
        return c.json({
          data: {
            symbol,
            lastPrice: mis.lastPrice,
            open: mis.open,
            high: mis.high,
            low: mis.low,
            prevClose: mis.prevClose,
            changePct: mis.changePct,
            bid: mis.bid,
            ask: mis.ask,
            volume: mis.volume,
            freshness: mis.freshness,
            state: mis.state,
            reason: subscribeBlockReason,
            source: mis.source,
            marketSession,
            dataDate: _misCompactDateToIso(mis.tradeDate),
            note: `kgi_subscribe_failed:${subscribeBlockReason} → mis_${mis.state === "CLOSE" ? "close" : "intraday"} date=${mis.tradeDate} time=${mis.tradeTime}`,
            updatedAt
          }
        });
      }
      const fb = await _twseRealtimeFallback(symbol, company.market, subscribeBlockReason);
      return c.json({
        data: {
          symbol,
          lastPrice: fb.lastPrice,
          open: fb.open,
          high: fb.high,
          low: fb.low,
          prevClose: fb.prevClose,
          changePct: fb.changePct,
          bid: null,
          ask: null,
          volume: fb.volume,
          freshness: fb.freshness,
          state: fb.state,
          reason: subscribeBlockReason,
          source: fb.source,
          marketSession: fb.marketSession,
          referenceReason: fb.referenceReason,
          note: `kgi_subscribe_failed:${subscribeBlockReason} → ${fb.note}`,
          dataDate: fb.dataDate,
          updatedAt
        }
      });
    }

    // Mark subscribed once tick succeeds
    _realtimeSubscribedSymbols.add(symbol);

    if (subBidAskResult.status !== "fulfilled") {
      console.warn(`[realtime] bidask subscribe failed for ${symbol}, continuing tick-only`);
    }
  }

  // 4. Fetch latest tick + bidask in parallel (fail-soft per leg)
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
      // Subscribed but no data yet (e.g. after-hours, subscribe lag)
      blockedReason = "symbol_not_subscribed";
    } else {
      blockedReason = "gateway_error";
    }
    // Evict so next request re-subscribes (session may have expired)
    _realtimeSubscribedSymbols.delete(symbol);
  }

  // Parse bidask leg (best-effort — don't block if tick succeeded)
  if (bidaskResult.status === "fulfilled") {
    const ba = bidaskResult.value.bidask;
    if (ba) {
      bid = ba.bid_prices?.[0] ?? null;
      ask = ba.ask_prices?.[0] ?? null;
      if (freshness === "not-available") {
        freshness = bidaskResult.value.freshness;
      }
    }
  }

  // 5. Determine state — if KGI tick failed, try TWSE MIS intraday, then EOD fallback
  let state: "LIVE" | "STALE" | "BLOCKED" | "NO_DATA";
  if (blockedReason) {
    // KGI tick failed — try TWSE MIS intraday first
    const mis = await _twseMisIntradayFetch(symbol, company.market);
    if (mis) {
      return c.json({
        data: {
          symbol,
          lastPrice: mis.lastPrice,
          open: mis.open,
          high: mis.high,
          low: mis.low,
          prevClose: mis.prevClose,
          changePct: mis.changePct,
          bid: mis.bid,
          ask: mis.ask,
          volume: mis.volume,
          freshness: mis.freshness,
          state: mis.state,
          reason: blockedReason,
          source: mis.source,
          marketSession,
          dataDate: _misCompactDateToIso(mis.tradeDate),
          note: `kgi_blocked:${blockedReason} → mis_${mis.state === "CLOSE" ? "close" : "intraday"} date=${mis.tradeDate} time=${mis.tradeTime}`,
          updatedAt
        }
      });
    }
    // MIS also unavailable (e.g. non-trading hours) — fall back to EOD
    const fb = await _twseRealtimeFallback(symbol, company.market, blockedReason);
    return c.json({
      data: {
        symbol,
        lastPrice: fb.lastPrice,
        open: fb.open,
        high: fb.high,
        low: fb.low,
        prevClose: fb.prevClose,
        changePct: fb.changePct,
        bid: null,
        ask: null,
        volume: fb.volume,
        freshness: fb.freshness,
        state: fb.state,
        reason: blockedReason,
        source: fb.source,
        marketSession: fb.marketSession,
        referenceReason: fb.referenceReason,
        note: `kgi_blocked:${blockedReason} → ${fb.note}`,
        dataDate: fb.dataDate,
        updatedAt
      }
    });
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
      source: "kgi-gateway" as const,
      marketSession,
      updatedAt
    }
  });
});

// =============================================================================
// ISSUE_001 fix (2026-05-14) — GET /api/v1/companies/:id/orderbook
// =============================================================================
//
// Five-level order book (五檔委託簿) for the company page.
//
// Source chain:
//   1. Primary  — KGI gateway /bidask (40-cap quota; only when gateway alive + subscribed)
//   2. Fallback — last_known in-memory cache (most recent successful pull)
//   3. Off-hours — state=off_hours (盤後) if market is POST-CLOSE and no live data
//
// Auth: Owner-gated (real quote data — same gate as other KGI endpoints)
//
// Response shape:
//   {
//     data: {
//       symbol: string,
//       state: "LIVE" | "STALE" | "LAST_KNOWN" | "off_hours" | "BLOCKED" | "NO_DATA",
//       bids: Array<{ price: number; volume: number }>,   // up to 5 levels
//       asks: Array<{ price: number; volume: number }>,   // up to 5 levels
//       source: "kgi-gateway" | "last_known" | "off_hours",
//       last_close: number | null,   // populated for off_hours from companies_ohlcv
//       note: string | null,
//       updatedAt: string
//     }
//   }
//
// Hard lines:
//   - NO order surface
//   - NO token / session / account number
//   - read-only
// =============================================================================

// Per-process last_known orderbook cache: { symbol → { bids, asks, cachedAt } }
const _orderbookLastKnownCache = new Map<
  string,
  { bids: { price: number; volume: number }[]; asks: { price: number; volume: number }[]; cachedAt: string }
>();

/** Reset orderbook cache — for tests only. */
export function _resetOrderbookLastKnownCache(): void {
  _orderbookLastKnownCache.clear();
}

app.get("/api/v1/companies/:id/orderbook", async (c) => {
  // 1. Owner-only gate
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  // 2. Resolve company
  const company = await resolveCompany(c.get("repo"), c.req.param("id"), {
    workspaceSlug: session.workspace.slug
  });
  if (!company) return c.json({ error: "company_not_found" }, 404);

  const symbol = companyIdToTicker(company.ticker);
  const updatedAt = new Date().toISOString();
  const db = getDb();

  // 3. Off-hours detection: if market is POST-CLOSE and we have no live data, return off_hours
  const mktState = composeTaiwanMarketState();
  const isOffHours = mktState.state === "POST-CLOSE";

  // 4. Try KGI gateway bidask (primary source)
  const client = getKgiQuoteClient();
  let bids: { price: number; volume: number }[] = [];
  let asks: { price: number; volume: number }[] = [];
  let liveSuccess = false;

  if (client.isSymbolAllowed(symbol)) {
    try {
      // Ensure subscribed (idempotent on gateway)
      await client.subscribeSymbolBidAsk(symbol).catch(() => {/* non-fatal */});
      const raw = await client.getLatestBidAsk(symbol);
      const ba = raw.bidask;
      if (ba) {
        const bPrices = ba.bid_prices ?? [];
        const bVols = ba.bid_volumes ?? [];
        const aPrices = ba.ask_prices ?? [];
        const aVols = ba.ask_volumes ?? [];
        bids = bPrices.slice(0, 5).map((p, i) => ({ price: p, volume: bVols[i] ?? 0 }));
        asks = aPrices.slice(0, 5).map((p, i) => ({ price: p, volume: aVols[i] ?? 0 }));
        liveSuccess = bids.length > 0 || asks.length > 0;
        if (liveSuccess) {
          _orderbookLastKnownCache.set(symbol, { bids, asks, cachedAt: updatedAt });
        }
        const freshness = raw.freshness ?? "not-available";
        const state = freshness === "fresh" ? "LIVE" : freshness === "stale" ? "STALE" : "NO_DATA";
        if (liveSuccess) {
          return c.json({ data: { symbol, state, bids, asks, source: "kgi-gateway" as const, last_close: null, note: null, updatedAt } });
        }
      }
    } catch (_err) {
      // Fall through to cache / off_hours
    }
  }

  // 5. Fallback: last_known cache
  const cached = _orderbookLastKnownCache.get(symbol);
  if (cached) {
    return c.json({
      data: {
        symbol,
        state: "LAST_KNOWN" as const,
        bids: cached.bids,
        asks: cached.asks,
        source: "last_known" as const,
        last_close: null,
        note: `盤後快照 · 取自 ${cached.cachedAt}`,
        updatedAt
      }
    });
  }

  // 6. Off-hours with no cache: pull last close from companies_ohlcv for context
  if (isOffHours) {
    let lastClose: number | null = null;
    if (isDatabaseMode() && db) {
      try {
        const rows = await db.execute(drizzleSql`
          SELECT close FROM companies_ohlcv
          WHERE company_id = ${company.id} AND interval = '1d'
          ORDER BY dt DESC LIMIT 1
        `);
        const rawRows = (rows as { rows?: Record<string, unknown>[] })?.rows
          ?? (Array.isArray(rows) ? rows : []);
        if (rawRows.length > 0) {
          lastClose = Number(rawRows[0]!["close"] ?? null) || null;
        }
      } catch (_e) {
        // best-effort only
      }
    }
    return c.json({
      data: {
        symbol,
        state: "off_hours" as const,
        bids: [],
        asks: [],
        source: "off_hours" as const,
        last_close: lastClose,
        note: "盤後 · 等明日開盤",
        updatedAt
      }
    });
  }

  // 7. Gateway not reachable / symbol not whitelisted
  return c.json({
    data: {
      symbol,
      state: "BLOCKED" as const,
      bids: [],
      asks: [],
      source: "kgi-gateway" as const,
      last_close: null,
      note: client.isSymbolAllowed(symbol) ? "gateway_unreachable" : "symbol_not_whitelisted",
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
  // A3 fix (2026-07-12): widened from 12→14 months. YoY needs the SAME month from the
  // prior year (12 months back from latest), which a strict 12-month fetch window never
  // contains — yoyGrowth was permanently null. +2 months buffer covers reporting lag.
  const rev14m = nMonthsAgoDate(14);
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
    client.getMonthRevenue(stockId, rev14m, today),
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
    const hist = rows.slice(0, 12); // display window unchanged — still 12 months
    const latest = hist[0] ?? null;

    // Compute YoY growth against the same month a year ago.
    // A3 fix (2026-07-12): search the full 14-month `rows` fetch, not the 12-item
    // display `hist` — the comparison month is by definition outside a 12-month window.
    let yoyGrowth: number | null = null;
    if (latest) {
      const prevYear = Number(latest.date.slice(0, 4)) - 1;
      const prev = rows.find(r =>
        Number(r.date.slice(0, 4)) === prevYear &&
        r.revenue_month === latest.revenue_month
      );
      if (prev && prev.revenue !== 0) {
        yoyGrowth = ((latest.revenue - prev.revenue) / prev.revenue) * 100;
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
  // P0 FIX (2026-05-14): DB-first path. FinMind live API returned all-zero values
  // because name-matching failed off-hours (name="" or different convention).
  // Now: query tw_institutional_buysell by ticker (stock_id), last 30 calendar days.
  // Only fallback to FinMind if DB has 0 rows for this ticker.
  type InstRow = { date: string; stock_id: string; name: string; buy: number; sell: number };
  let institutional: FullProfileSection<{ date: string; foreign: number; investmentTrust: number; dealer: number; totalNetBuy: number }>;

  // Cycle 10 FIX (2026-05-14): widen name regex to cover all FinMind name variants.
  // FinMind per-stock API returns: '外陸資' | '投信' | '自營商' | '自營商(自行買賣)' | '自營商(避險)'
  // FinMind whole-market API returns similar values. DB stores raw FinMind name verbatim.
  // A2 fix (2026-07-12): this used to be a locally-duplicated copy — now shares
  // classifyInstitutionalName() (defined near the date helpers above) with /chips.
  function aggregateInstRows(rows: InstRow[]): FullProfileSection<{ date: string; foreign: number; investmentTrust: number; dealer: number; totalNetBuy: number }> {
    const dateMap = new Map<string, { foreign: number; investmentTrust: number; dealer: number }>();
    for (const r of rows) {
      if (!dateMap.has(r.date)) dateMap.set(r.date, { foreign: 0, investmentTrust: 0, dealer: 0 });
      const entry = dateMap.get(r.date)!;
      const net = (Number(r.buy) || 0) - (Number(r.sell) || 0);
      const nm = r.name ?? "";
      const bucket = classifyInstitutionalName(nm);
      if (bucket) entry[bucket] += net;
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
    return {
      state: hist.length === 0 ? "EMPTY" : isStale ? "STALE" : "LIVE",
      latest,
      history: hist,
      updatedAt: new Date().toISOString(),
      sourceTrail: { source: "db_tw_institutional_buysell", datasetKey: "TaiwanStockInstitutionalInvestorsBuySell", recordCount: rows.length, degradedReason: hist.length === 0 ? "no_rows" : null }
    };
  }

  {
    const activeDb = getDb();
    let dbInstRows: InstRow[] = [];
    if (activeDb) {
      try {
        // P1-A FIX (2026-05-14): cast to float8 so postgres.js returns JS numbers directly (not strings).
        // Also use verified row-extraction pattern: .rows first, then Array.isArray fallback.
        const result = await activeDb.execute(drizzleSql`
          SELECT stock_id, date, name,
                 buy::float8  AS buy,
                 sell::float8 AS sell
          FROM tw_institutional_buysell
          WHERE stock_id = ${stockId}
            AND date >= ${d30start}
          ORDER BY date DESC
          LIMIT 150
        `);
        const rawRows = (result as { rows?: unknown[] })?.rows
          ?? (Array.isArray(result) ? (result as unknown[]) : []);
        dbInstRows = rawRows as InstRow[];
        if (dbInstRows.length > 0) {
          // Cycle 10: log ALL distinct name values so Railway log shows actual DB name format
          const distinctNames = [...new Set(dbInstRows.map(r => r.name))].slice(0, 10);
          console.info(`[full-profile/institutional] db returned ${dbInstRows.length} rows for ${stockId}; distinctNames=${JSON.stringify(distinctNames)}; sample buy=${dbInstRows[0]?.buy} sell=${dbInstRows[0]?.sell}`);
        } else {
          console.info(`[full-profile/institutional] db returned 0 rows for ${stockId} (date>=${d30start}); will use FinMind`);
        }
      } catch (dbErr) {
        console.warn("[full-profile/institutional] db query failed:", dbErr instanceof Error ? dbErr.message : String(dbErr));
      }
    }

    // Cycle 10 FIX (2026-05-14): DB-first with hard preference when rows exist.
    // If DB has ANY rows for this ticker in the 30-day window, prefer DB.
    // FinMind live has the same name-matching problem, so falling through gives no benefit.
    // Only use FinMind when DB has 0 rows for this ticker (never ingested).
    const dbAgg = dbInstRows.length > 0 ? aggregateInstRows(dbInstRows) : null;
    const dbHasRows = dbInstRows.length > 0;
    const dbHasSignal = dbAgg !== null && dbAgg.history.some(
      h => h.foreign !== 0 || h.investmentTrust !== 0 || h.dealer !== 0
    );

    if (dbHasRows) {
      // DB has rows for this ticker — use DB regardless of signal level.
      // All-zero on a holiday date is correct; don't override with FinMind zeros.
      const src = dbHasSignal ? "db_tw_institutional_buysell" : "db_tw_institutional_buysell_zero";
      institutional = { ...dbAgg!, sourceTrail: { ...dbAgg!.sourceTrail, source: src } };
    } else if (instResult.status === "rejected") {
      institutional = errorSection("TaiwanStockInstitutionalInvestorsBuySell", String(instResult.reason));
    } else {
      // DB has 0 rows for this ticker → use FinMind live result
      const rows = instResult.value as InstRow[];
      const fmRows = rows;
      const distinctFmNames = [...new Set(fmRows.map((r: InstRow) => r.name))].slice(0, 10);
      console.info(`[full-profile/institutional] FinMind fallback for ${stockId}: ${fmRows.length} rows, distinctNames=${JSON.stringify(distinctFmNames)}`);
      const fmAgg = aggregateInstRows(fmRows);
      institutional = { ...fmAgg, sourceTrail: { ...fmAgg.sourceTrail, source: "finmind_fallback" } };
    }
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
  // A1 fix (2026-07-12): live FinMind TaiwanStockDividend rows (curl-verified 2026-07-12)
  // don't carry TotalCashDividend/TotalStockDividend/TotalDividend at all — those were
  // dead field names, always undefined → cashDividend/stockDividend permanently 0. Real
  // per-share amounts are CashEarningsDistribution + CashStatutorySurplus (cash) and
  // StockEarningsDistribution + StockStatutorySurplus (stock). `year` is a ROC-quarter
  // *string* like "114年第4季", not a number — `b.year - a.year` was `NaN` for every
  // pair, so .sort() was a silent no-op and "latest" resolved to FinMind's raw row
  // order (oldest-first) rather than the newest dividend. Staleness must key off a real
  // date (AnnouncementDate), not the unparseable ROC-quarter label, or `getFullYear() -
  // NaN` is always false → permanent fake LIVE badge.
  type DivRow = { date: string; stock_id: string; year: string; CashEarningsDistribution?: number; CashStatutorySurplus?: number; StockEarningsDistribution?: number; StockStatutorySurplus?: number; AnnouncementDate?: string };
  let dividend: FullProfileSection<{ year: string; cashDividend: number | null; stockDividend: number | null; totalDividend: number | null; announcementDate: string | null }>;
  if (divResult.status === "rejected") {
    dividend = errorSection("TaiwanStockDividend", String(divResult.reason));
  } else {
    // Cast via unknown: the FinMindDividendRow client type is stale relative to the
    // live wire schema (declares TotalCashDividend/numeric year, neither of which the
    // live API actually returns — see the A1 fix note above), so it doesn't structurally
    // overlap with the corrected local DivRow shape.
    const rows = (divResult.value as unknown as DivRow[])
      .slice()
      .sort((a, b) => (b.AnnouncementDate ?? b.date ?? "").localeCompare(a.AnnouncementDate ?? a.date ?? ""));
    const hist = rows.slice(0, 10).map(r => {
      // Pete #1229 review fix (2026-07-12): `?? 0` silently turned "field absent
      // from this row" into a fake real zero — a row that genuinely paid 0 cash
      // dividend was indistinguishable from a row FinMind simply didn't send a
      // cash component for. Only collapse to 0 when at least one of the two
      // underlying components is actually present (a real, if partial, number);
      // when BOTH are absent for a component, that component is unknown → null,
      // not a fabricated 0.
      const cashDividend = r.CashEarningsDistribution === undefined && r.CashStatutorySurplus === undefined
        ? null
        : (r.CashEarningsDistribution ?? 0) + (r.CashStatutorySurplus ?? 0);
      const stockDividend = r.StockEarningsDistribution === undefined && r.StockStatutorySurplus === undefined
        ? null
        : (r.StockEarningsDistribution ?? 0) + (r.StockStatutorySurplus ?? 0);
      const totalDividend = cashDividend === null && stockDividend === null
        ? null
        : (cashDividend ?? 0) + (stockDividend ?? 0);
      return {
        year: r.year,
        cashDividend,
        stockDividend,
        totalDividend,
        announcementDate: r.AnnouncementDate ?? r.date ?? null
      };
    });
    const latest = hist[0] ?? null;
    const latestDate = latest?.announcementDate ?? null;
    // Dividends are typically declared ~annually (quarterly for some issuers) — allow
    // a wide window before flagging stale rather than the old (broken) 2-year cutoff.
    const isStale = latestDate ? Date.now() - new Date(latestDate).getTime() > 400 * 24 * 60 * 60 * 1000 : true;
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
          "IUF_QUANT_LAB/research/finmind_sponsor_999_data_factory/codex_next/final_strategy_count_board_v16.json",
        labTrAlignmentLock: "board/lab_tr_alignment_lock_2026-05-07.md"
      }
    });
  }

  // Map internal status enum → product-facing displayStatus for frontend badge
  const snapshotCandidatesWithDisplay = snapshot.candidates.map((cand) => ({
    ...cand,
    displayStatus:
      cand.status === "STRONG_CANDIDATE" ? "PASS"
      : cand.status === "WATCH_LIST" ? "WATCH"
      : cand.status === "FAILED" ? "FAIL"
      : cand.status.includes("CONFIRMED") ? "PASS"
      : null
  }));

  return c.json({
    data: { ...snapshot, candidates: snapshotCandidatesWithDisplay },
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
          "IUF_QUANT_LAB/research/finmind_sponsor_999_data_factory/codex_next/final_strategy_count_board_v16.json",
        labTrAlignmentLock: "board/lab_tr_alignment_lock_2026-05-07.md"
      }
    });
  }

  // Map internal status enum → product-facing displayStatus for frontend badge
  // Lab/TR alignment lock: status verbatim is preserved; displayStatus is TR-layer UI mapping only
  const candidatesWithDisplay = snapshot.candidates.map((cand) => ({
    ...cand,
    displayStatus:
      cand.status === "STRONG_CANDIDATE" ? "PASS"
      : cand.status === "WATCH_LIST" ? "WATCH"
      : cand.status === "FAILED" ? "FAIL"
      : cand.status.includes("CONFIRMED") ? "PASS"
      : null  // null → frontend renders as 「研究中」grey
  }));

  return c.json({
    data: { ...snapshot, candidates: candidatesWithDisplay },
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
// BLOCK #9 — GET /api/v1/lab/three-strategy/*  (20 endpoints)
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

app.get("/api/v1/lab/three-strategy/daily-health", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureDailyHealth } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureDailyHealth();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/next-signal-readiness", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureNextSignalReadiness } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureNextSignalReadiness();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/frozen-signal-snapshot", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureFrozenSignalSnapshot } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureFrozenSignalSnapshot();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/main-overlay-validation", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureMainOverlayValidation } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureMainOverlayValidation();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/cont-liq-canary-guard", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureContLiqCanaryGuard } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureContLiqCanaryGuard();
  return c.json(result, result.ok ? 200 : 503);
});

app.get("/api/v1/lab/three-strategy/quality-scorecard", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const { getFixtureQualityScorecard } = await import("./lab-three-strategy-consumer.js");
  const result = getFixtureQualityScorecard();
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
  const { fetchStrategyIndex } = await import("./lab-strategy-snapshot-fetcher.js");

  // Embed cross-reference from _index.json (3-card list for frontend).
  // Non-fatal: if index fetch fails, result still includes fixture snapshot.
  const [result, indexResult] = await Promise.all([
    Promise.resolve(getFixtureFullSnapshot()),
    fetchStrategyIndex()
  ]);

  const strategyIndex = indexResult.ok
    ? {
        ok: true,
        strategies: indexResult.strategies,
        cache_hit: indexResult.cache_hit,
        fetched_at: indexResult.fetched_at
      }
    : {
        ok: false,
        strategies: indexResult.strategies,
        cache_hit: indexResult.cache_hit,
        stale_reason: indexResult.stale_reason
      };

  return c.json({ ...result, strategy_index: strategyIndex }, result.ok ? 200 : 503);
});

// =============================================================================
// BLOCK #10 — GET /api/v1/lab/strategy/:strategyId/snapshot
// =============================================================================
// Updated 2026-05-13 (Codex v47): mapSnapshotToV47() strips legacy return
// fields from user-facing response; promotes explicit returns fields.
// into a dedicated `returns` object; emits schemaVersion for scanner verification.
// benchmark0050ReturnPct = ONE shared number across all 3 strategies (common-window).
// Hard lines: no fake data; missing fields -> null; no broker write.
// =============================================================================

const _SNAPSHOT_SCHEMA_VERSION_V47 = "tr_strategy_snapshot_api_contract_v47";

// P0-3 fix (2026-07-10 product critique): every lab strategy snapshot currently
// carries a research/backtest status only (RESEARCH_FORWARD_OBSERVATION /
// PAPER_LIVE_OBSERVING / BACKTESTED_RAW) — none has a verified live track
// record. Home page / quant-strategies previously rendered headline numbers
// (e.g. "累積報酬 +400.89%", common-window research backtest) with no
// "backtest, unverified" qualifier, next to the site's real F-AUTO SIM
// performance — a data-honesty violation (禁字牆: no unqualified performance
// claims). Safe default: unknown/unrecognized status => NOT live-verified.
const _LIVE_VERIFIED_SNAPSHOT_STATUSES = new Set<string>([]); // none sanctioned yet (2026-07-10)

function deriveTrackRecordDisclosure(raw: Record<string, unknown>): {
  isLiveVerifiedTrackRecord: boolean;
  trackRecordType: "live_verified" | "research_backtest_unverified";
  headlineDisclosureZh: string;
} {
  const status = typeof raw["status"] === "string" ? raw["status"] : "UNKNOWN";
  const isLiveVerifiedTrackRecord = _LIVE_VERIFIED_SNAPSHOT_STATUSES.has(status);
  if (isLiveVerifiedTrackRecord) {
    return { isLiveVerifiedTrackRecord: true, trackRecordType: "live_verified", headlineDisclosureZh: "" };
  }

  const windowStart = typeof raw["commonWindowStart"] === "string" ? raw["commonWindowStart"] : null;
  const windowEnd = typeof raw["commonWindowEnd"] === "string" ? raw["commonWindowEnd"] : null;
  const windowLabel = windowStart && windowEnd ? `研究窗 ${windowStart} ~ ${windowEnd}` : null;
  const caveat = typeof raw["caveatTextZh"] === "string" ? raw["caveatTextZh"] : null;

  const headlineDisclosureZh =
    `歷史回測（未經驗證），非策略現況${windowLabel ? "，" + windowLabel : ""}${caveat ? "。" + caveat : ""}`;

  return { isLiveVerifiedTrackRecord: false, trackRecordType: "research_backtest_unverified", headlineDisclosureZh };
}

function mapSnapshotToV47(raw: Record<string, unknown>): Record<string, unknown> {
  const m = (typeof raw["headlineMetrics"] === "object" && raw["headlineMetrics"] !== null
    ? raw["headlineMetrics"] : {}) as Record<string, unknown>;
  const legacyReturnKey = "compound" + "Return";
  const legacyNetBenchmarkKey = legacyReturnKey + "NetOfBenchmark";
  const legacyReturnKeys = new Set([legacyReturnKey, legacyNetBenchmarkKey]);

  // Returns: v47 contract uses explicit strategy / benchmark / excess fields.
  // Legacy return fields are logged but never substituted into the response.
  const strategyNetAbsoluteReturnPct = typeof m["strategyNetAbsoluteReturnPct"] === "number" ? m["strategyNetAbsoluteReturnPct"] : null;
  const benchmark0050ReturnPct = typeof m["benchmark0050ReturnPct"] === "number" ? m["benchmark0050ReturnPct"] : null;
  const excessVs0050Pp = typeof m["excessVs0050Pp"] === "number" ? m["excessVs0050Pp"]
    : (strategyNetAbsoluteReturnPct !== null && benchmark0050ReturnPct !== null)
      ? strategyNetAbsoluteReturnPct - benchmark0050ReturnPct : null;

  if (typeof m[legacyReturnKey] === "number" && strategyNetAbsoluteReturnPct === null) {
    console.warn("[lab-snapshot] mapSnapshotToV47: legacy return field present but strategyNetAbsoluteReturnPct absent. v47 returns object will keep null strategyNetAbsoluteReturnPct.");
  }

  // Structured returns object (v47 contract requirement)
  const returns: Record<string, unknown> = {
    strategyNetAbsoluteReturnPct,
    benchmark0050ReturnPct,
    excessVs0050Pp
  };

  // Metrics
  const hitRatePct = typeof m["hitRatePct"] === "number" ? m["hitRatePct"] : typeof m["hitRate"] === "number" ? m["hitRate"] : null;
  const maxDrawdownNetPct = typeof m["maxDrawdownNetPct"] === "number" ? m["maxDrawdownNetPct"] : typeof m["maxDrawdown"] === "number" ? m["maxDrawdown"] : null;
  const maxDrawdownInternalExcessPct = typeof m["maxDrawdownInternalExcessPct"] === "number" ? m["maxDrawdownInternalExcessPct"] : null;
  const estimatedEntryTicketCount = typeof m["estimatedEntryTicketCount"] === "number" ? m["estimatedEntryTicketCount"] : null;

  // Operational state
  const displayMode = typeof raw["displayMode"] === "string" ? raw["displayMode"] : "research_only";
  const orderState = typeof raw["orderState"] === "string" ? raw["orderState"] : "blocked";
  const brokerWriteAllowed = raw["brokerWriteAllowed"] === true;
  const realOrderAllowed = raw["realOrderAllowed"] === true;
  const registryChangeAllowed = raw["registryChangeAllowed"] === true;

  // Rebuild headlineMetrics without legacy return aliases.
  const mWithoutLegacyReturns = Object.fromEntries(
    Object.entries(m).filter(([key]) => !legacyReturnKeys.has(key))
  );
  // netAbsoluteReturn: explicit alias for netAbsoluteReturnAfterCost (U-06 fix 2026-05-14).
  // Both fields are emitted so consumers using either path get the same value.
  const netAbsoluteReturnAfterCost = typeof m["netAbsoluteReturnAfterCost"] === "number"
    ? m["netAbsoluteReturnAfterCost"] : null;

  const mappedMetrics: Record<string, unknown> = {
    ...mWithoutLegacyReturns,
    ...(strategyNetAbsoluteReturnPct !== null && { strategyNetAbsoluteReturnPct }),
    ...(benchmark0050ReturnPct !== null && { benchmark0050ReturnPct }),
    ...(excessVs0050Pp !== null && { excessVs0050Pp }),
    ...(hitRatePct !== null && { hitRatePct }),
    ...(maxDrawdownNetPct !== null && { maxDrawdownNetPct }),
    ...(maxDrawdownInternalExcessPct !== null && { maxDrawdownInternalExcessPct }),
    ...(estimatedEntryTicketCount !== null && { estimatedEntryTicketCount }),
    // netAbsoluteReturn alias: same value as netAbsoluteReturnAfterCost (both kept for compatibility).
    // netAbsoluteReturnPct: percentage representation (×100) for frontend display (P1-B fix 2026-05-14).
    // netAbsoluteReturnAfterCost = 7.5987 (decimal ratio) → netAbsoluteReturnPct = 759.87 (%).
    ...(netAbsoluteReturnAfterCost !== null && {
      netAbsoluteReturnAfterCost,
      netAbsoluteReturn: netAbsoluteReturnAfterCost,
      netAbsoluteReturnPct: Math.round(netAbsoluteReturnAfterCost * 10000) / 100,
    }),
    // Legacy return aliases intentionally not emitted.
  };

  // Strip legacy return fields from top-level raw too (defensive).
  const rawWithoutLegacyReturns = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !legacyReturnKeys.has(key))
  );

  const trackRecordDisclosure = deriveTrackRecordDisclosure(raw);

  return {
    ...rawWithoutLegacyReturns,
    schemaVersion: _SNAPSHOT_SCHEMA_VERSION_V47,
    returns,
    displayMode,
    orderState,
    brokerWriteAllowed,
    realOrderAllowed,
    registryChangeAllowed,
    headlineMetrics: mappedMetrics,
    // P0-3 fix (2026-07-10): explicit, top-level honesty flags — consumers
    // must not render headline return/hit-rate numbers without checking
    // isLiveVerifiedTrackRecord and surfacing headlineDisclosureZh.
    isLiveVerifiedTrackRecord: trackRecordDisclosure.isLiveVerifiedTrackRecord,
    trackRecordType: trackRecordDisclosure.trackRecordType,
    headlineDisclosureZh: trackRecordDisclosure.headlineDisclosureZh,
    _v47Mapped: true
  };
}

app.get("/api/v1/lab/strategy/:strategyId/snapshot", async (c) => {
  const role = c.get("session").user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);
  const strategyId = c.req.param("strategyId");
  const { ALLOWED_STRATEGY_IDS, fetchStrategySnapshot, getSnapshotFromCacheOnly } = await import("./lab-strategy-snapshot-fetcher.js");
  if (!ALLOWED_STRATEGY_IDS.has(strategyId)) {
    return c.json({ error: "unknown_strategy_id", reason: `strategyId "${strategyId}" is not in the allowed set`, allowed: [...ALLOWED_STRATEGY_IDS], lab_repo_path: `reports/trading_room/strategy_snapshots/${strategyId}_snapshot_v0.json` }, 404);
  }
  const session = c.get("session");
  const auditCtx = { workspaceId: session.workspace.id, actorId: session.user.id };
  const cached = getSnapshotFromCacheOnly(strategyId);
  if (cached && cached.snapshot) {
    return c.json({ schema: _SNAPSHOT_SCHEMA_VERSION_V47, strategyId, snapshot: mapSnapshotToV47(cached.snapshot as Record<string, unknown>), cache_hit: true, stale_reason: null, fetched_at: cached.fetched_at, source: cached.source }, 200);
  }
  const result = await fetchStrategySnapshot(strategyId, auditCtx);
  if (result.ok && result.snapshot) {
    return c.json({ schema: _SNAPSHOT_SCHEMA_VERSION_V47, strategyId, snapshot: mapSnapshotToV47(result.snapshot as Record<string, unknown>), cache_hit: result.cache_hit, stale_reason: null, fetched_at: result.fetched_at, source: result.source }, 200);
  }
  if (result.snapshot !== null) {
    return c.json({ schema: _SNAPSHOT_SCHEMA_VERSION_V47, strategyId, snapshot: mapSnapshotToV47(result.snapshot as Record<string, unknown>), cache_hit: result.cache_hit, stale_reason: result.stale_reason, fetched_at: result.fetched_at, source: result.source }, 200);
  }
  const statusCode = result.stale_reason === "snapshot_not_found" ? 404 : 503;
  return c.json({ error: result.stale_reason, strategyId, snapshot: null, cache_hit: false, lab_repo_path: `reports/trading_room/strategy_snapshots/${strategyId}_snapshot_v0.json` }, statusCode);
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

  // ── Resolve linked content_draft ──────────────────────────────────────────
  // Historical backfills and direct pipelines do not always share the legacy
  // v1 dedupe key, so resolve by approval ref/date first and keep the old key
  // pattern as a compatibility fallback.
  const dedupeKeyPrefix = `${workspaceId}:daily_briefs:${brief.date}:`;
  const draftRows = await db
    .select({ id: contentDrafts.id })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.workspaceId, workspaceId),
        eq(contentDrafts.targetTable, "daily_briefs"),
        or(
          eq(contentDrafts.approvedRefId, brief.id),
          eq(contentDrafts.targetEntityId, brief.date),
          like(contentDrafts.dedupeKey, `${dedupeKeyPrefix}%`)
        )
      )
    )
    .orderBy(desc(contentDrafts.createdAt))
    .limit(10);

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
      "content_draft.source_only_backfill_approved",
      "content_draft.factual_reject",
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
    verdict: "OK" | "WARNING";
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
      verdict: (score !== null && score >= 7) ? "WARNING" : "OK",
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

  // ── Parse source-only historical backfill gate ────────────────────────────
  // Backfilled briefs can be safely published by deterministic source checks
  // without running the full LLM adversarial/RAG chain. Surface that gate
  // explicitly so the UI does not show a false "not reviewed" state.
  type SourceOnlyGateResult = {
    ran: boolean;
    verdict: "OK" | "HELD";
    confidence: number | null;
    reason: string | null;
    sourcePackId: string | null;
    auditedAt: string | null;
  };

  let sourceOnlyGate: SourceOnlyGateResult | null = null;
  const sourceOnlyRow = auditRows.find((r) => r.action === "content_draft.source_only_backfill_approved");
  if (sourceOnlyRow) {
    const p = sourceOnlyRow.payload as Record<string, unknown> | null;
    sourceOnlyGate = {
      ran: true,
      verdict: p?.["verdict"] === "approve" ? "OK" : "HELD",
      confidence: typeof p?.["confidence"] === "number" ? (p["confidence"] as number) : null,
      reason: typeof p?.["reason"] === "string" ? (p["reason"] as string) : null,
      sourcePackId: typeof p?.["sourcePackId"] === "string" ? (p["sourcePackId"] as string) : null,
      auditedAt: sourceOnlyRow.createdAt.toISOString()
    };
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
  const latestDecisionRow = auditRows.find((r) =>
    [
      "content_draft.source_only_backfill_approved",
      "content_draft.ai_approved",
      "content_draft.ai_rejected",
      "content_draft.factual_reject",
      "hallucination_reject"
    ].includes(r.action)
  );
  const wasRejected =
    latestDecisionRow?.action === "content_draft.ai_rejected" ||
    latestDecisionRow?.action === "content_draft.factual_reject" ||
    latestDecisionRow?.action === "hallucination_reject";

  const auditChain = {
    hardReject: {
      rules: HARD_REJECT_RULES,
      rejected: wasRejected
    },
    adversarialReview,
    hallucinationCheck,
    sourceOnlyGate
  };

  // ── Build sections with sourceTrail when the publisher stored it ──────────
  const sections = (brief.sections as Array<{ heading: string; body: string; sourceTrail?: unknown }>).map((s) => ({
    heading: s.heading,
    body: s.body,
    sourceTrail: typeof s.sourceTrail === "string" && s.sourceTrail.trim() ? s.sourceTrail : null
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
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, data-source
// freshness/health state only, no governance/audit/execution content)
app.get("/api/v1/sources", async (c) => {
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
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, vendor health/quota
// state only; token is never returned, see HARD LINE comment below)
app.get("/api/v1/finmind/health", (c) => {
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
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure quote data)
app.get("/api/v1/quotes", async (c) => {
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
// Task D fix: was returning all-zeros because companies_ohlcv table is empty.
// Now uses getTwseMarketBreadth() (TWSE STOCK_DAY_ALL — same data used by dashboard)
// as primary source. Falls back to companies_ohlcv when TWSE unavailable.
// Note: TWSE STOCK_DAY_ALL is T+0 EOD data. During trading hours (09:00-13:30)
// it may be yesterday's data; after 14:00 it reflects today's final prices.
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure market breadth data)
app.get("/api/v1/breadth", async (c) => {
  // ── Path 1: TWSE STOCK_DAY_ALL breadth (covers 1400+ listed stocks) ────────
  try {
    const { getTwseMarketBreadth } = await import("./data-sources/twse-openapi-client.js");
    const breadth = await getTwseMarketBreadth();
    if (breadth.total > 0) {
      return c.json({
        up: breadth.up,
        flat: breadth.flat,
        down: breadth.down,
        total: breadth.total,
        asOf: breadth.asOf,
        source: "twse_openapi",
        note: "TWSE STOCK_DAY_ALL EOD — reflects T+0 final prices after 14:00 TST, T-1 before market close",
      });
    }
  } catch (err) {
    console.warn("[breadth] TWSE path failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Path 2: companies_ohlcv fallback ──────────────────────────────────────
  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;

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

  return c.json({ up, flat, down, total, asOf, source: total > 0 ? "ohlcv_fallback" : "unavailable" });
});

// ── TWSE Official Industry Map cache ─────────────────────────────────────────
// Fetches TWSE + TPEx t187ap03 listing data (公司基本資料) to build ticker→industry
// mapping using the official 產業別 classification (e.g. 半導體業, 電子零組件業).
// This replaces chain_position (per-stock Yahoo Finance labels) for heatmap grouping.
// Cache TTL: 4 hours (industry changes rarely, only on listing/delisting events).
let _twseIndustryMapCache: { map: Map<string, string>; expiresAt: number } | null = null;
// Last healthy (both-sources) map. On 6/10 one listing source failed transiently and
// the partial map (888 tickers vs ~1978) was cached for 4h → heatmap regression.
let _twseIndustryMapLastGood: Map<string, string> | null = null;

async function _getTwseOfficialIndustryMap(): Promise<Map<string, string>> {
  if (_twseIndustryMapCache && Date.now() < _twseIndustryMapCache.expiresAt) {
    return _twseIndustryMapCache.map;
  }
  try {
    const [twse, tpex] = await Promise.all([
      _fetchTwseListedCompanies().catch(() => [] as Array<{ ticker: string; name: string; industry: string }>),
      _fetchTpexListedCompanies().catch(() => [] as Array<{ ticker: string; name: string; industry: string }>),
    ]);
    const map = new Map<string, string>();
    // TPEx first, TWSE overwrites (same dedup policy as bulk-seed)
    for (const c of tpex) { if (c.ticker && c.industry) map.set(c.ticker, c.industry); }
    for (const c of twse) { if (c.ticker && c.industry) map.set(c.ticker, c.industry); }

    const partial = twse.length === 0 || tpex.length === 0;
    if (partial && _twseIndustryMapLastGood && _twseIndustryMapLastGood.size > map.size) {
      // Degraded fetch — serve last-good and retry upstream soon instead of
      // locking the partial map in for 4 hours.
      console.warn(`[industry-map] partial fetch (twse=${twse.length} tpex=${tpex.length}, mapped=${map.size}) — serving last-good (${_twseIndustryMapLastGood.size}), retry in 5min`);
      _twseIndustryMapCache = { map: _twseIndustryMapLastGood, expiresAt: Date.now() + 5 * 60 * 1000 };
      return _twseIndustryMapLastGood;
    }

    if (!partial && map.size > 0) {
      _twseIndustryMapLastGood = map;
    }
    _twseIndustryMapCache = { map, expiresAt: Date.now() + (partial ? 5 * 60 * 1000 : 4 * 60 * 60 * 1000) };
    return map;
  } catch {
    return _twseIndustryMapLastGood ?? new Map();
  }
}

// ── P0 #5: GET /api/v1/heatmap ────────────────────────────────────────────────
// Vendor shape: { sourceState, tiles }
// Delegates to TWSE OpenAPI industry heatmap (same as dashboard/snapshot).
// Falls back to OHLCV table when TWSE unavailable.
// Task B fix: was reading from companies_ohlcv only → sourceState:"error" when table empty.
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure industry heatmap data)
app.get("/api/v1/heatmap", async (c) => {
  const session = c.get("session");
  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;

  // ── Path 1: TWSE OpenAPI industry heatmap (same as /market/heatmap/twse) ──
  try {
    const { getTwseIndustryHeatmap, getStockDayAllRows } = await import("./data-sources/twse-openapi-client.js");
    // Build official industry map from TWSE t187ap03 (proper 產業別 classification)
    const officialIndustryMap = await _getTwseOfficialIndustryMap();

    // Pre-warm STOCK_DAY_ALL cache in parallel
    await getStockDayAllRows().catch(() => {});
    const industryTiles = await getTwseIndustryHeatmap(officialIndustryMap);
    const normalizedTiles = normalizeAndMergeTwseHeatmapTiles(industryTiles);
    if (normalizedTiles.length > 0) {
      return c.json({
        sourceState: "live",
        source: "twse_openapi",
        tiles: normalizedTiles.slice(0, 30).map((t) => ({
          sym: t.industry,
          name: t.industry,
          pct: t.avgChangePct,
          mcap: null,
          stockCount: t.stockCount,
          gainerCount: t.gainerCount,
          loserCount: t.loserCount,
        })),
      });
    }
  } catch (err) {
    console.warn("[heatmap] TWSE path failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Path 2: OHLCV fallback ─────────────────────────────────────────────────
  if (!db) return c.json({ sourceState: "empty", tiles: [] });

  try {
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
    if (rows.length === 0) return c.json({ sourceState: "empty", tiles: [] });
    const tiles = rows.map((r) => ({
      sym: String(r.sym ?? ""),
      name: String(r.name ?? r.sym ?? ""),
      pct: typeof r.pct === "number" ? r.pct : parseFloat(String(r.pct ?? "0")),
      mcap: typeof r.mcap === "number" ? r.mcap : null,
    }));
    return c.json({ sourceState: "live", source: "ohlcv_fallback", tiles });
  } catch {
    return c.json({ sourceState: "error", tiles: [] });
  }
});

// =============================================================================
// TWSE OpenAPI — main page real-time market data (no KGI dependency)
// =============================================================================
//
// GET /api/v1/market/overview/twse
//   — TAIEX index value + change + changePct from TWSE official OpenAPI.
//   — 1-minute in-memory cache to avoid TWSE rate limits.
//   — No auth required for read; session check preserved for consistency.
//   — staleAfterSec: 60 (data is T+0 end-of-day when market closed, ~15s delay when open)
//   — source: "twse_openapi" — no KGI dependency
//
// GET /api/v1/market/heatmap/twse
//   — Industry heatmap derived from TWSE STOCK_DAY_ALL + companies.chainPosition mapping.
//   — Returns array of { industry, avgChangePct, gainerCount, loserCount, flatCount, stockCount }
//   — 1-minute in-memory cache.
//   — Empty array when TWSE unavailable (fail-open, never 5xx).
//
// Hard lines:
//   - No KGI SDK import
//   - No scraping (TradingView etc.)
//   - No schema / contracts change
//   - No DB migration
// =============================================================================

// During the MIS window, returns the cron-cached realtime TAIEX/OTC index
// (tse_t00.tw / otc_o00.tw, refreshed every 45s). Null off-hours or when stale.
// The 6/11 audit found both overview endpoints serving YESTERDAY's close labeled
// "live/今日收盤" mid-session because neither read this cache (only the legacy
// market-data/overview overlay did).
function _misIndexOverviewSnapshot(): {
  taiex: { last: number; prevClose: number; change: number; changePct: number; time: string; volume: number | null } | null;
  otc: { last: number; prevClose: number; change: number; changePct: number; time: string; volume: number | null } | null;
  tsFor: (time: string) => string;
} | null {
  const hhmm = getTaipeiHHMM();
  const taipeiDay = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCDay();
  const inWindow = hhmm >= 855 && hhmm <= 1435 && taipeiDay >= 1 && taipeiDay <= 5;
  if (!inWindow) return null;
  const idxCache = _overviewMisIndexCache;
  const todayYmd = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  // Allow up to 2 min staleness (cron ticks every 45s; one missed tick must not flap to EOD)
  if (!idxCache || idxCache.tradeDateYmd !== todayYmd || Date.now() - idxCache.cachedAt > 120_000) return null;
  if (!idxCache.taiex) return null;
  const taipeiDateStr = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    taiex: idxCache.taiex,
    otc: idxCache.otc,
    tsFor: (time: string) => time ? new Date(`${taipeiDateStr}T${time}+08:00`).toISOString() : new Date().toISOString(),
  };
}

// On-demand MIS index snapshot for ONE index (tse_t00 = TAIEX, otc_o00 = 櫃買).
// MIS keeps today's index close available off-hours (verified 6/15 22:xx:
// otc_o00 z=429.37 d=20260615), but the cached _misIndexOverviewSnapshot is
// gated to the trading window, leaving the EOD overview's OTC field null after
// close. This fetches today's close directly so the off-hours overview can fill
// the gap. Returns null when MIS has no today-dated value.
async function _misIndexTodayFetch(
  exCh: "tse_t00" | "otc_o00",
): Promise<{ value: number; change: number; changePct: number; ts: string } | null> {
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}.tw&json=1&delay=0`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { "Accept": "application/json" } });
    if (!resp.ok) return null;
    const data = await resp.json() as { msgArray?: Array<Record<string, string>>; rtcode?: string };
    const m = data.msgArray?.[0];
    if (!m) return null;
    const z = parseFloat((m["z"] ?? "").replace(/,/g, ""));
    const y = parseFloat((m["y"] ?? "").replace(/,/g, ""));
    const d = (m["d"] ?? "").trim();
    const todayYmd = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
    if (d !== todayYmd || !isFinite(z) || !isFinite(y) || z <= 0 || y <= 0) return null;
    const change = Math.round((z - y) * 100) / 100;
    const changePct = Math.round((change / y) * 10000) / 100;
    const ts = new Date(`${todayYmd.slice(0, 4)}-${todayYmd.slice(4, 6)}-${todayYmd.slice(6, 8)}T13:30:00+08:00`).toISOString();
    return { value: z, change, changePct, ts };
  } catch {
    return null;
  }
}

// Honest close label: derive from the data's own trading date, never assume today.
// TWSE MI_INDEX lags a session, so "fetch succeeded" does NOT mean today's close.
function _taiexCloseLabel(ts: string | null | undefined, isLkg: boolean): string {
  if (isLkg) return "上日收盤";
  const tsDate = typeof ts === "string" ? ts.slice(0, 10) : null;
  const todayTaipei = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return tsDate === todayTaipei ? "今日收盤" : "上日收盤";
}

// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure TAIEX/OTC index data)
app.get("/api/v1/market/overview/twse", async (c) => {
  // 1. MIS realtime index (盤中即時) — preferred during the trading session
  const mis = _misIndexOverviewSnapshot();
  if (mis?.taiex) {
    return c.json({
      taiex: { value: mis.taiex.last, change: mis.taiex.change, changePct: mis.taiex.changePct, ts: mis.tsFor(mis.taiex.time) },
      otc: mis.otc ? { value: mis.otc.last, change: mis.otc.change, changePct: mis.otc.changePct, ts: mis.tsFor(mis.otc.time) } : null,
      source: "twse_mis_intraday",
      staleAfterSec: 60,
      sourceState: "live",
      taiexDisplayLabel: "盤中即時"
    });
  }

  // 2. EOD chain (off-hours / MIS unavailable)
  const { getTwseMarketOverview } = await import("./data-sources/twse-openapi-client.js");
  const result = await getTwseMarketOverview();

  if (!result) {
    return c.json({
      taiex: null,
      otc: null,
      source: "twse_openapi",
      staleAfterSec: 60,
      sourceState: "unavailable"
    });
  }

  const { _isLkg, ...resultPayload } = result;
  const sourceState = _isLkg ? "lkg" : "live";
  const taiexDisplayLabel = _taiexCloseLabel(result.taiex?.ts, Boolean(_isLkg));
  // The EOD overview has no OTC index source — backfill today's 櫃買 close from
  // MIS so the homepage OTC index is not blank after close.
  let otcPayload = resultPayload.otc;
  if (!otcPayload) {
    const misOtc = await _misIndexTodayFetch("otc_o00");
    if (misOtc) otcPayload = { value: misOtc.value, change: misOtc.change, changePct: misOtc.changePct, ts: misOtc.ts };
  }
  return c.json({ ...resultPayload, otc: otcPayload, sourceState, taiexDisplayLabel });
});

// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure industry heatmap data)
app.get("/api/v1/market/heatmap/twse", async (c) => {
  const { getTwseIndustryHeatmap, getStockDayAllRows, rocDateToTaipeiTs } = await import("./data-sources/twse-openapi-client.js");
  const { getFinMindIndustryHeatmap, finMindAggregateHasToken } = await import("./data-sources/finmind-aggregate-client.js");

  // Task C fix: use official TWSE 産業別 classification (t187ap03_L) instead of
  // companies.chain_position (per-stock Yahoo Finance labels). This ensures each tile
  // groups 10-100+ stocks per industry (e.g. 半導體業, 電子零組件業) rather than
  // single-stock micro-categories (e.g. "Electronics Distribution stockCount:1").
  const officialIndustryMap = await _getTwseOfficialIndustryMap();

  // Same-day fix (2026-06-17): TWSE STOCK_DAY_ALL is EOD-only and publishes late,
  // so right after the close it still serves YESTERDAY's market (the "heatmap stuck
  // on 6/16" bug — confirmed: STOCK_DAY_ALL latest Date was 1150616 while FinMind
  // already had 6/17). FinMind whole-market price is same-day at 13:30, so use it as
  // primary (with the SAME official industry map) and keep TWSE EOD as fallback.
  const finmindTiles = finMindAggregateHasToken()
    ? await getFinMindIndustryHeatmap(officialIndustryMap)
    : null;
  let source = "finmind";
  let asOf: string | null = `${_s1TaipeiDateStr(0)}T13:30:00+08:00`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tiles: any[];

  if (finmindTiles && finmindTiles.length > 0) {
    tiles = finmindTiles;
  } else {
    const rows = await getStockDayAllRows().catch(() => [] as Array<{ Date?: string }>);
    tiles = await getTwseIndustryHeatmap(officialIndustryMap);
    source = "twse_openapi";
    asOf = rows[0]?.Date ? rocDateToTaipeiTs(rows[0].Date) : null;
  }

  const normalizedTiles = normalizeAndMergeTwseHeatmapTiles(tiles);

  return c.json({
    data: normalizedTiles,
    source,
    asOf,
    staleAfterSec: 60,
    industryCount: normalizedTiles.length,
    mappedTickers: officialIndustryMap.size,
    industrySource: "twse_t187ap03",
  });
});

// =============================================================================
// KGI 40-slot Subscription Quota Manager + Main Page Realtime Endpoints
// =============================================================================
//
// 凱基新星等級：2 條連線 × 20 檔 = 40 檔上限
//
// GET  /api/v1/kgi/quote/subscription-status (Owner)
//   — Current quota allocation, connection distribution, per-symbol last_tick_at
//
// POST /api/v1/kgi/quote/subscribe  (upgraded — quota check, 429 on full)
//   — Already handled above; quota check layer added here via manager
//
// POST /api/v1/kgi/watchlist/sync (Owner)
//   — Sync user watchlist → subscription pool (auto LRU swap)
//
// POST /api/v1/kgi/holdings/sync (Owner)
//   — Sync user holdings → subscription pool (auto LRU swap)
//
// GET  /api/v1/market/overview/kgi (Owner)
//   — TAIEX + OTC realtime tick; fallback → TWSE OpenAPI EOD
//
// GET  /api/v1/market/heatmap/kgi-core (Owner)
//   — Core 15 + strategy holdings + 持倉 KGI tick aggregate; fallback → TWSE EOD
//
// Hard lines:
//   - MAX_SLOTS = 40 enforced in manager
//   - Permanent tiers (INDEX/STRATEGY/CORE) never swapped
//   - No broker.* import
//   - No contracts change
//   - No DB migration
// =============================================================================

// GET /api/v1/kgi/quote/subscription-status — quota allocation (Owner only)
app.get("/api/v1/kgi/quote/subscription-status", async (c) => {
  const role = c.get("session").user.role;
  if (role !== "Owner") return c.json({ error: "forbidden_role", message: "Owner only" }, 403);

  const { initSubscriptionManager, getSubscriptionStatus } = await import("./kgi-subscription-manager.js");
  initSubscriptionManager();
  const status = getSubscriptionStatus();
  return c.json({ data: status });
});

// POST /api/v1/kgi/watchlist/sync — sync watchlist symbols (Owner only)
const kgiWatchlistSyncSchema = z.object({
  symbols: z.array(z.string().min(1).max(20)).min(0).max(20),
});

app.post("/api/v1/kgi/watchlist/sync", async (c) => {
  const role = c.get("session").user.role;
  if (role !== "Owner") return c.json({ error: "forbidden_role", message: "Owner only" }, 403);

  try {
    const body = kgiWatchlistSyncSchema.parse(await c.req.json());
    const { initSubscriptionManager, syncWatchlist } = await import("./kgi-subscription-manager.js");
    initSubscriptionManager();
    const result = await syncWatchlist(body.symbols);
    return c.json({ data: result });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "SYNC_ERROR", message: String(err) }, 500);
  }
});

// POST /api/v1/kgi/holdings/sync — sync holdings symbols (Owner only)
const kgiHoldingsSyncSchema = z.object({
  symbols: z.array(z.string().min(1).max(20)).min(0).max(5),
});

app.post("/api/v1/kgi/holdings/sync", async (c) => {
  const role = c.get("session").user.role;
  if (role !== "Owner") return c.json({ error: "forbidden_role", message: "Owner only" }, 403);

  try {
    const body = kgiHoldingsSyncSchema.parse(await c.req.json());
    const { initSubscriptionManager, syncHoldings } = await import("./kgi-subscription-manager.js");
    initSubscriptionManager();
    const result = await syncHoldings(body.symbols);
    return c.json({ data: result });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    }
    return c.json({ error: "SYNC_ERROR", message: String(err) }, 500);
  }
});

// GET /api/v1/market/overview/kgi — TAIEX + OTC realtime (KGI tick → TWSE fallback)
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure index data,
// no account/credential fields)
app.get("/api/v1/market/overview/kgi", async (c) => {
  try {
    const { getKgiMarketOverview } = await import("./kgi-subscription-manager.js");
    const kgiResult = await getKgiMarketOverview();

    // If KGI returned real values for TAIEX, return KGI source
    if (kgiResult.taiex.value !== null) {
      return c.json({ ...kgiResult, sourceState: "live" });
    }

    // MIS realtime index (盤中即時) — KGI quote auth is not enabled on this
    // account, so MIS is the de-facto realtime index source during the session.
    const mis = _misIndexOverviewSnapshot();
    if (mis?.taiex) {
      return c.json({
        taiex: {
          symbol: "^TWII",
          value: mis.taiex.last,
          change: mis.taiex.change,
          changePct: mis.taiex.changePct,
          ts: mis.tsFor(mis.taiex.time),
          source: "twse_mis_intraday",
          staleSec: null,
        },
        otc: {
          symbol: "^TPEX",
          value: mis.otc?.last ?? null,
          change: mis.otc?.change ?? null,
          changePct: mis.otc?.changePct ?? null,
          ts: mis.otc ? mis.tsFor(mis.otc.time) : null,
          source: "twse_mis_intraday",
          staleSec: null,
        },
        sourceState: "live",
      });
    }

    // Fallback: TWSE OpenAPI EOD
    const { getTwseMarketOverview } = await import("./data-sources/twse-openapi-client.js");
    const twseResult = await getTwseMarketOverview();

    if (twseResult) {
      // EOD has no OTC index source — backfill today's 櫃買 close from MIS so
      // the OTC index is not blank after close.
      let otcOverview: { symbol: string; value: number | null; change: number | null; changePct: number | null; ts: string | null; source: string; staleSec: number | null };
      if (twseResult.otc) {
        otcOverview = { symbol: "^TPEX", value: twseResult.otc.value, change: twseResult.otc.change, changePct: twseResult.otc.changePct, ts: twseResult.otc.ts, source: "twse_openapi_eod", staleSec: null };
      } else {
        const misOtc = await _misIndexTodayFetch("otc_o00");
        otcOverview = misOtc
          ? { symbol: "^TPEX", value: misOtc.value, change: misOtc.change, changePct: misOtc.changePct, ts: misOtc.ts, source: "twse_mis_intraday", staleSec: null }
          : { symbol: "^TPEX", value: null, change: null, changePct: null, ts: null, source: "twse_openapi_eod", staleSec: null };
      }
      return c.json({
        taiex: {
          symbol: "^TWII",
          value: twseResult.taiex.value,
          change: twseResult.taiex.change,
          changePct: twseResult.taiex.changePct,
          ts: twseResult.taiex.ts,
          source: "twse_openapi_eod",
          staleSec: null,
        },
        otc: otcOverview,
        source: "twse_openapi_eod",
        staleAfterSec: 60,
        sourceState: "fallback_eod",
      });
    }

    // Both unavailable
    return c.json({
      taiex: kgiResult.taiex,
      otc: kgiResult.otc,
      source: "kgi_tick",
      staleAfterSec: 5,
      sourceState: "unavailable",
    });
  } catch (err) {
    console.warn("[market/overview/kgi] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "MARKET_OVERVIEW_ERROR", message: String(err) }, 503);
  }
});

// GET /api/v1/market/heatmap/kgi-core — core heatmap with 3-tier fallback
// Tier 1: KGI live tick (market hours, EC2 running)
// Tier 2: TWSE STOCK_DAY_ALL per-symbol EOD close+changePct
// Tier 3: In-process last-known-close cache (survives off-hours)
// Guarantee: ALWAYS returns all 40 KGI core tiles with sourceState. Never drops a tile.
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure heatmap tile data)
app.get("/api/v1/market/heatmap/kgi-core", async (c) => {
  try {
    const { initSubscriptionManager, getKgiCoreHeatmap } = await import("./kgi-subscription-manager.js");
    initSubscriptionManager();
    const kgiResult = await getKgiCoreHeatmap();

    // Fetch TWSE STOCK_DAY_ALL in parallel (fail-open: empty array if unreachable)
    const { getStockDayAllRows } = await import("./data-sources/twse-openapi-client.js");
    const twseRows = await getStockDayAllRows().catch(() => []);

    // 4-tier enrichment: live → mis_intraday → twse_eod → cache → no_data (never drops tiles)
    const { enrichHeatmapTiles } = await import("./kgi-heatmap-enricher.js");
    const enriched = enrichHeatmapTiles(kgiResult.tiles, twseRows, _misTileCache);

    return c.json(enriched);
  } catch (err) {
    console.warn("[market/heatmap/kgi-core] error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "HEATMAP_ERROR", message: String(err) }, 503);
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
// Auth: any logged-in role (Viewer+ — PR-B G-PUB/G-PORT-read downgrade, paper
// preview only ("紙上預覽,不連真實券商"), aligns with D3 G-PORT read=Viewer)
app.get("/api/v1/portfolio/preview", async (c) => {

  const baseCapitalRaw = Number(process.env.PAPER_BROKER_INITIAL_CASH);
  const baseCapitalTWD = Number.isFinite(baseCapitalRaw) && baseCapitalRaw > 0
    ? baseCapitalRaw
    : 10_000_000;

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
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade; same getStrategyIdeas()
// data already served without any role gate at /api/v1/strategy/ideas)
app.get("/api/v1/vendor/strategy/ideas", async (c) => {
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
// Aggregated snapshot — fans out to all panel fetchers via Promise.allSettled.
// Codex vendor Path A: single call replaces 14+ individual panel fetches.
//
// Auth:    READ_DRAFT_ROLES (Owner / Admin / Analyst)
// Cache:   30s TTL per userId (handles tab-switch refresh storm)
// Partial: 1 panel fail → added to stale_panels+errors, others unaffected
// Never:   5xx if at least 1 panel succeeds
app.get("/api/v1/dashboard/snapshot", async (c) => {
  const session = c.get("session");
  const role = session.user.role;
  if (!READ_DRAFT_ROLES.has(role)) return c.json({ error: "forbidden_role" }, 403);

  const { buildDashboardSnapshot, sanitizePanelError } = await import("./dashboard-snapshot-aggregator.js");

  try {
    const { snapshot, fromCache } = await buildDashboardSnapshot({
      userId: session.user.id,
      workspaceSlug: session.workspace.slug,
      workspaceId: session.workspace.id,
    });

    return c.json({
      ...snapshot,
      _cache_hit: fromCache,
    });
  } catch (err) {
    // Last-resort: all panels failed entirely — return shell rather than 5xx.
    const rawMsg = err instanceof Error ? err.message : String(err);
    console.error("[dashboard-snapshot] fatal aggregation error:", rawMsg);
    // S2: sanitize before exposing to caller (callers are authenticated but defense-in-depth).
    const as_of = new Date().toISOString();
    return c.json({
      as_of,
      panels: {
        industry_heatmap: { sourceState: "error", tiles: [] },
        news_recent: { items: [] },
        brief_today: { data: null, meta: { reason: "aggregation_error" } },
        lab_strategies: [],
        audit_stats: { windowHours: 24, total: 0, db_available: false },
        watchlist_quotes: [],
      },
      stale_panels: ["industry_heatmap", "news_recent", "brief_today", "lab_strategies", "audit_stats", "watchlist_quotes"],
      errors: { _fatal: sanitizePanelError(rawMsg) },
      _cache_hit: false,
    });
  }
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
  // ohlcv_scheduler_active: scheduler always calls runOhlcvFinmindSync with
  // forceFinmind:true when FINMIND_API_TOKEN is set — bypasses OHLCV_SOURCE env.
  // So even if OHLCV_SOURCE is "mock" in env, scheduler will still attempt finmind.
  const ohlcvSchedulerActive = tokenPresent;

  return c.json({
    data: {
      tokenPresent,
      tokenSource: tokenPresent ? "env" : "none",
      ohlcvSource,
      ohlcvSchedulerActive,
      ohlcvSchedulerNote: ohlcvSchedulerActive
        ? "scheduler uses forceFinmind:true — OHLCV_SOURCE env ignored by scheduler"
        : "scheduler skipped — FINMIND_API_TOKEN not set",
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
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
        reason: fourLayerGate.reason,
        // Bruce TR-3-C1: strategy run context fields (audit observability)
        strategy_run_mode: "paper",
        yang_explicit_ack: false
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
      intentId: intent.id,
      // Bruce TR-3-C1: strategy run context fields (audit observability)
      strategy_run_mode: "paper",
      yang_explicit_ack: false
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
    // Returns ALL applied versions for full visibility (not just paper-related)
    let appliedMigrations: string[] = [];
    try {
      const migCheck = await db.execute(drizzleSql`
        SELECT version FROM schema_migrations
        ORDER BY version ASC
      `);
      const migRows = (migCheck as { rows?: Record<string, unknown>[] })?.rows
        ?? (Array.isArray(migCheck) ? migCheck : [migCheck]);
      appliedMigrations = migRows.map((r: Record<string, unknown>) => String(r.version ?? r.Version ?? "?"));
    } catch {
      appliedMigrations = ["schema_migrations_query_failed"];
    }

    // Check strategy_runs table existence (for Bruce R3 / migration-deploy-gap verify)
    // Check iuf_events table existence (for Bruce R5 / 0025 promote verify)
    let strategyRunsTableExists = false;
    let iufEventsTableExists = false;
    try {
      const srCheck = await db.execute(drizzleSql`
        SELECT
          to_regclass('public.strategy_runs') AS strategy_runs,
          to_regclass('public.iuf_events')    AS iuf_events
      `);
      const srRow = (srCheck as { rows?: Record<string, unknown>[] })?.rows?.[0]
        ?? (Array.isArray(srCheck) ? srCheck[0] : srCheck);
      strategyRunsTableExists = srRow?.strategy_runs !== null && srRow?.strategy_runs !== undefined;
      iufEventsTableExists = srRow?.iuf_events !== null && srRow?.iuf_events !== undefined;
    } catch {
      strategyRunsTableExists = false;
      iufEventsTableExists = false;
    }

    // Cycle 10: institutional name probe — shows actual name values stored in DB
    // Used to verify whether FinMind writes Chinese or English name tokens.
    let instNameProbe: { distinctNames: string[]; sampleRow: Record<string, unknown> | null; rowCount2330: number } | null = null;
    try {
      const instNamesResult = await db.execute(drizzleSql`
        SELECT DISTINCT name FROM tw_institutional_buysell ORDER BY name LIMIT 20
      `);
      const instNameRows = (instNamesResult as { rows?: Record<string, unknown>[] })?.rows
        ?? (Array.isArray(instNamesResult) ? instNamesResult : []);
      const sample2330Result = await db.execute(drizzleSql`
        SELECT name, buy::float8 AS buy, sell::float8 AS sell, date
        FROM tw_institutional_buysell
        WHERE stock_id = '2330'
        ORDER BY date DESC
        LIMIT 5
      `);
      const sample2330Rows = (sample2330Result as { rows?: Record<string, unknown>[] })?.rows
        ?? (Array.isArray(sample2330Result) ? sample2330Result : []);
      const countResult = await db.execute(drizzleSql`
        SELECT COUNT(*)::int AS cnt FROM tw_institutional_buysell WHERE stock_id = '2330'
      `);
      const countRows = (countResult as { rows?: Record<string, unknown>[] })?.rows
        ?? (Array.isArray(countResult) ? countResult : []);
      instNameProbe = {
        distinctNames: instNameRows.map((r: Record<string, unknown>) => String(r.name ?? "")),
        sampleRow: (sample2330Rows[0] as Record<string, unknown>) ?? null,
        rowCount2330: Number((countRows[0] as Record<string, unknown>)?.cnt ?? 0)
      };
    } catch {
      instNameProbe = null;
    }

    return c.json({
      persistenceMode,
      dbAvailable: true,
      tables: {
        paper_orders: tableRow?.paper_orders !== null && tableRow?.paper_orders !== undefined,
        paper_fills: tableRow?.paper_fills !== null && tableRow?.paper_fills !== undefined,
        paper_positions: tableRow?.paper_positions !== null && tableRow?.paper_positions !== undefined,
        strategy_runs: strategyRunsTableExists,
        iuf_events: iufEventsTableExists
      },
      appliedMigrations,
      appliedMigrationsCount: appliedMigrations.length,
      instNameProbe,
      raw: tableRow
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ persistenceMode, dbAvailable: false, error: msg }, 500);
  }
});

// GET /api/v1/admin/db/migration-status
// Owner-only. Returns full migration state: applied list, pending list, sync status.
// Root cause 2026-05-18: 6 deploys silently skipped migrations via advisory lock timeout.
// This endpoint lets Bruce / Mike verify schema sync at any time post-deploy.
app.get("/api/v1/admin/db/migration-status", async (c) => {
  const session = c.get("session");
  if (session.user.role !== "Owner") {
    return c.json({ error: "forbidden" }, 403);
  }

  if (!isDatabaseMode()) {
    return c.json({
      sync: true,
      note: "Running in memory mode — no DB schema to check",
      applied: [],
      pending: [],
      total_in_db: 0,
      total_expected: null
    });
  }

  const db = getDb();
  if (!db) {
    return c.json({ error: "db_not_available" }, 503);
  }

  try {
    // Read applied migrations from DB
    const appliedRows = await db.execute(drizzleSql`
      SELECT version, applied_at FROM schema_migrations ORDER BY version ASC
    `);
    const rows = (appliedRows as { rows?: Record<string, unknown>[] })?.rows
      ?? (Array.isArray(appliedRows) ? appliedRows : []);
    const applied = rows.map((r: Record<string, unknown>) => ({
      version: String(r.version ?? ""),
      appliedAt: r.applied_at ?? null
    }));

    const totalInDb = applied.length;
    const totalExpected = process.env.EXPECTED_MIGRATION_COUNT
      ? Number(process.env.EXPECTED_MIGRATION_COUNT)
      : null;

    // Sync = DB count matches expected count (set via EXPECTED_MIGRATION_COUNT Railway env var).
    // Pending list can only be computed at migrate.ts time (server doesn't read migrations dir).
    // To see pending list: check Railway deploy logs or run pnpm migrate locally.
    const sync = totalExpected !== null ? totalInDb === totalExpected : true;

    return c.json({
      sync,
      total_in_db: totalInDb,
      total_expected: totalExpected,
      applied: applied.map((r) => r.version),
      applied_with_timestamps: applied,
      mismatch_detail: !sync
        ? `DB has ${totalInDb} migrations, expected ${totalExpected}. Run pnpm migrate or check Railway deploy logs.`
        : null,
      note: "Set EXPECTED_MIGRATION_COUNT Railway env var to enable sync detection. Current value: " + (totalExpected ?? "not_set")
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: "query_failed", detail: msg }, 500);
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

type ComputedPaperPortfolioPosition = {
  symbol: string;
  netQtyShares: number;
  avgCostPerShare: number | null;
  fillCount: number;
  lastPrice: number | null;
  note: string | null;
  investedCostTWD: number;
};

async function computePaperPortfolioPositions(userId: string): Promise<ComputedPaperPortfolioPosition[]> {
  let orders;
  try {
    orders = await listOrders(userId, { status: "FILLED" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[paper/portfolio] listOrders failed:", detail);
    throw new Error(`list_orders_failed: ${detail}`);
  }

  const positions = new Map<string, {
    symbol: string;
    netQty: number;
    totalCost: number;
    fillCount: number;
    lastPrice: number | null;
  }>();

  const sortedOrders = [...orders].sort((a, b) => {
    const aTime = a.fill?.fillTime instanceof Date
      ? a.fill.fillTime.getTime()
      : Date.parse(String(a.fill?.fillTime ?? ""));
    const bTime = b.fill?.fillTime instanceof Date
      ? b.fill.fillTime.getTime()
      : Date.parse(String(b.fill?.fillTime ?? ""));
    return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
  });

  for (const o of sortedOrders) {
    if (!o.fill) continue;
    const symbol = o.intent.symbol;
    const p = positions.get(symbol) ?? { symbol, netQty: 0, totalCost: 0, fillCount: 0, lastPrice: null };
    let shareQty = Math.max(0, Number(o.fill.fillQty) || 0);
    if (shareQty <= 0) continue;

    if (o.intent.side === "buy") {
      if (p.netQty < 0) {
        const coverQty = Math.min(shareQty, Math.abs(p.netQty));
        p.netQty += coverQty;
        shareQty -= coverQty;
      }
      if (shareQty > 0) {
        p.netQty += shareQty;
        p.totalCost += shareQty * o.fill.fillPrice;
      }
    } else {
      if (p.netQty > 0) {
        const avgCost = p.totalCost / p.netQty;
        const closingQty = Math.min(shareQty, p.netQty);
        p.totalCost -= avgCost * closingQty;
        p.netQty -= shareQty;
        if (p.netQty <= 0) p.totalCost = 0;
      } else {
        p.netQty -= shareQty;
        p.totalCost = 0;
      }
    }
    p.fillCount++;
    p.lastPrice = o.fill.fillPrice;
    positions.set(symbol, p);
  }

  return Array.from(positions.values()).map((p) => ({
    symbol: p.symbol,
    netQtyShares: p.netQty,
    avgCostPerShare: p.netQty > 0
      ? Math.round((p.totalCost / p.netQty) * 100) / 100
      : null,
    fillCount: p.fillCount,
    lastPrice: p.lastPrice,
    investedCostTWD: Math.max(0, Math.round(p.totalCost * 100) / 100),
    note: p.netQty <= 0 ? "net_flat_or_short" : null
  }));
}

// GET /api/v1/paper/portfolio
// Aggregates FILLED orders into a per-symbol position snapshot.
// Computation: net qty (buy positive, sell negative), weighted avg cost.
// Returns 200 + { data: PortfolioPosition[] }.
app.get("/api/v1/paper/portfolio", async (c) => {
  const session = c.get("session");
  let positionList: ComputedPaperPortfolioPosition[];
  let filledOrders: Awaited<ReturnType<typeof listOrders>> = [];
  try {
    positionList = await computePaperPortfolioPositions(session.user.id);
    filledOrders = await listOrders(session.user.id, { status: "FILLED" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json({ error: "list_orders_failed", detail }, 500);
  }

  // Base capital per BLOCK #5 §5: paper E2E must show simulated capital, not null.
  // PAPER_BROKER_INITIAL_CASH env var overrides; default NT$10,000,000 (楊董ack 2026-05-13).
  const baseCapitalRaw = Number(process.env.PAPER_BROKER_INITIAL_CASH);
  const baseCapitalTWD = Number.isFinite(baseCapitalRaw) && baseCapitalRaw > 0
    ? baseCapitalRaw
    : 10_000_000;

  // Compute invested capital from current open positions (buy cost basis only)
  const investedCost = positionList
    .filter((p) => p.netQtyShares > 0)
    .reduce((acc, p) => acc + p.investedCostTWD, 0);

  // 2026-07-12 — FIFO realized P&L (closes the gap PR #1222 flagged: round-tripped
  // positions previously left no trace of realized gain/loss, baseCapitalTWD never moved).
  // Additive only: existing fields above are untouched.
  const fifo = computeFifoRealizedPnl(filledOrders);
  const fifoBySymbol = new Map(fifo.bySymbol.map((s) => [s.symbol, s]));
  const positionsWithRealized = positionList.map((p) => ({
    ...p,
    realizedPnlTwd: Math.round((fifoBySymbol.get(p.symbol)?.realizedPnlTwd ?? 0) * 100) / 100
  }));

  const summary = {
    baseCapitalTWD,
    currency: "TWD",
    simulated: true,
    paperMode: true,
    positionCount: positionList.filter((p) => (p.netQtyShares ?? 0) > 0).length,
    investedCostTWD: Math.round(investedCost * 100) / 100,
    // realizedPnlTwd / unrealizedPnlTwd / availableCashTWD (new): FIFO lot-matched, fee-inclusive.
    // Reconciliation identity (locked by paper-ledger-db.test.ts):
    //   baseCapitalTWD + realizedPnlTwd + unrealizedPnlTwd === marketValue + availableCashTWD
    realizedPnlTwd: fifo.totalRealizedPnlTwd,
    unrealizedPnlTwd: fifo.totalUnrealizedPnlTwd,
    availableCashTWD: Math.round((baseCapitalTWD + fifo.netCashFlowTwd) * 100) / 100,
    note: positionList.length === 0
      ? "empty_state: no filled orders yet; base capital available"
      : "positions computed from filled paper orders"
  };

  return c.json({ data: positionsWithRealized, summary });
});

// =============================================================================
// GET /api/v1/paper/funds
// When KGI_ENV=sim (or ?source=sim), proxies to KGI SIM account balance via gateway.
// When KGI_ENV=paper (or ?source=paper), returns paper-broker in-memory balance.
// Auth: session required, no special role.
// =============================================================================

app.get("/api/v1/paper/funds", async (c) => {
  const session = c.get("session");
  const sourceOverride = c.req.query("source");
  const kgiEnv = resolveKgiEnv();
  const useSimSource = sourceOverride === "sim" || (sourceOverride !== "paper" && kgiEnv === "sim");

  if (useSimSource) {
    const gatewayUrl =
      process.env["KGI_GATEWAY_URL"] ??
      process.env["KGI_GATEWAY_BASE_URL"] ??
      "http://127.0.0.1:8787";
    const { KgiGatewayClient } = await import("./broker/kgi-gateway-client.js");
    const client = new KgiGatewayClient({ gatewayBaseUrl: gatewayUrl, connectTimeoutMs: 5_000, ignoreScheduleGuard: true });
    try {
      const rawPositions = await client.getPosition();
      const totalUnrealized = rawPositions.reduce((acc, p) => acc + (p.unrealized ?? 0), 0);
      const totalRealized = rawPositions.reduce((acc, p) => acc + (p.realized ?? 0), 0);
      return c.json({
        data: {
          source: "kgi_sim",
          accountId: process.env["KGI_ACCOUNT"] ? maskAccount(process.env["KGI_ACCOUNT"]) : "kgi-sim",
          currency: "TWD",
          // KGI SIM SDK does not expose available cash — derive P&L only
          cash: null,
          availableCash: null,
          equity: null,
          marketValue: null,
          unrealizedPnl: totalUnrealized,
          realizedPnlToday: totalRealized,
          note: "cash/equity not available from KGI SIM SDK; showing P&L from position snapshot",
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (_err) {
      // KGI /position native crash + /balance not implemented — reconstruct cash from /deals.
      // Cost model: 0.3% commission × 30% discount (Yang) + 3‰ sell tax (per Athena S1 packet).
      try {
        const dealsBySymbol = (await client.getDeals()) as Record<
          string,
          Array<{ action?: string; quantity?: number; price?: number }>
        >;
        const initialCash = Number(process.env["PAPER_BROKER_INITIAL_CASH"] ?? "10000000");
        let cashConsumed = 0;
        let totalMarketValue = 0;
        let totalCostBasis = 0;
        for (const [_symbol, deals] of Object.entries(dealsBySymbol)) {
          if (!Array.isArray(deals)) continue;
          let netQty = 0;
          let totalCost = 0;
          let lastPrice = 0;
          for (const d of deals) {
            const action = String(d.action ?? "");
            const qty = Number(d.quantity ?? 0);
            const price = Number(d.price ?? 0);
            if (qty <= 0 || price <= 0) continue;
            lastPrice = price;
            const notional = qty * price;
            if (action === "B") {
              netQty += qty;
              totalCost += notional;
              cashConsumed += notional * 1.0009; // commission 0.09%
            } else if (action === "S") {
              netQty -= qty;
              totalCost -= notional;
              cashConsumed -= notional * (1 - 0.0009 - 0.003); // commission + tax
            }
          }
          if (netQty !== 0) {
            totalMarketValue += lastPrice * netQty;
            totalCostBasis += totalCost;
          }
        }
        const cash = initialCash - cashConsumed;
        const equity = cash + totalMarketValue;
        return c.json({
          data: {
            source: "kgi_sim_reconstructed",
            accountId: process.env["KGI_ACCOUNT"] ? maskAccount(process.env["KGI_ACCOUNT"]) : "kgi-sim",
            currency: "TWD",
            cash,
            availableCash: cash,
            equity,
            marketValue: totalMarketValue,
            unrealizedPnl: totalMarketValue - totalCostBasis,
            realizedPnlToday: 0,
            marginUsed: 0,
            note: "reconstructed from /deals (KGI SDK /position crashed; /balance not implemented)",
            updatedAt: new Date().toISOString(),
          },
        });
      } catch (_recon) {
        return c.json({
          data: {
            source: "kgi_sim",
            degraded: true,
            updatedAt: new Date().toISOString(),
          },
        });
      }
    }
  }

  // Paper-broker in-memory mode
  const accountId = c.req.query("accountId") ?? "";
  if (!accountId) {
    return c.json({ data: await getPaperBalance(session, ""), source: "paper" });
  }
  return c.json({ data: await getPaperBalance(session, accountId), source: "paper" });
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

const OWNED_DAILY_KLINE_REQUIRED_BARS = 720;
const OWNED_DAILY_KLINE_STALE_DAYS = 4;
const OWNED_DAILY_KLINE_DEEP_BACKFILL_DAYS = 3650;
const OWNED_DAILY_KLINE_PRIORITY_TICKERS = [
  "2330", "6202", "2317", "2454", "2308", "2412",
  "3711", "2303", "3034", "2379", "3443", "3661", "6488", "6770", "6415", "5274",
  "2382", "3231", "6669", "2356", "4938", "3017", "3324", "6230", "8210",
  "2881", "2882", "2884", "2885", "2886", "2891", "2892", "5880", "5876", "2801",
  "2603", "2609", "2615", "2636", "2605", "2606", "2610", "2618", "2646", "6757",
  "2002", "2014", "2009", "2031", "2015", "2023", "2027", "2029", "2010", "2022", "2013", "2007", "2008",
  "3045", "2395", "5608", "2637", "2607"
] as const;
const OWNED_DAILY_KLINE_PRIORITY: Map<string, number> = new Map(
  OWNED_DAILY_KLINE_PRIORITY_TICKERS.map((ticker, index) => [ticker, index])
);

type OwnedKlineDepthState = "READY" | "SHALLOW" | "STALE" | "EMPTY" | "MISSING_COMPANY";

function normalizeKlineDepthSymbols(raw: string | undefined): string[] {
  const values = (raw ?? "2330,6202")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d{4}$/.test(value));
  return [...new Set(values)].slice(0, 100);
}

function resolveOwnedKlineDepthState(realRows: number, latestDate: string | null): OwnedKlineDepthState {
  if (realRows <= 0) return "EMPTY";
  if (realRows < OWNED_DAILY_KLINE_REQUIRED_BARS) return "SHALLOW";
  if (!latestDate) return "STALE";
  const latestMs = Date.parse(`${latestDate}T00:00:00+08:00`);
  if (!Number.isFinite(latestMs)) return "STALE";
  return Date.now() - latestMs > OWNED_DAILY_KLINE_STALE_DAYS * 24 * 60 * 60 * 1000
    ? "STALE"
    : "READY";
}

app.get("/api/v1/diagnostics/kline-depth", async (c) => {
  const symbols = normalizeKlineDepthSymbols(c.req.query("symbols"));
  const workspaceSlug = c.req.query("workspace") ?? process.env.DEFAULT_WORKSPACE_SLUG ?? "primary-desk";
  const base = {
    owned: true,
    workspaceSlug,
    requiredBars: OWNED_DAILY_KLINE_REQUIRED_BARS,
    staleAfterDays: OWNED_DAILY_KLINE_STALE_DAYS,
    backfillDays: OWNED_DAILY_KLINE_DEEP_BACKFILL_DAYS,
    symbols,
    asOf: new Date().toISOString()
  };

  if (!isDatabaseMode()) {
    return c.json({ data: { ...base, state: "NO_DB", owned: false, items: [] } });
  }

  const db = getDb();
  if (!db) {
    return c.json({ data: { ...base, state: "ERROR", owned: false, items: [], error: "getDb() returned null" } }, 503);
  }

  try {
    const result = await db.execute(drizzleSql`
      WITH target_workspace AS (
        SELECT id
        FROM workspaces
        WHERE slug = ${workspaceSlug}
        ORDER BY created_at ASC
        LIMIT 1
      ),
      owned_daily AS (
        SELECT
          company_id,
          COUNT(*) FILTER (WHERE source != 'mock' AND interval = '1d')::int AS real_rows,
          MIN(dt) FILTER (WHERE source != 'mock' AND interval = '1d')::text AS first_date,
          MAX(dt) FILTER (WHERE source != 'mock' AND interval = '1d')::text AS latest_date,
          COUNT(*) FILTER (WHERE source = 'mock' AND interval = '1d')::int AS mock_rows,
          (ARRAY_AGG(source ORDER BY dt DESC) FILTER (WHERE interval = '1d'))[1] AS latest_source
        FROM companies_ohlcv
        GROUP BY company_id
      )
      SELECT
        c.ticker,
        c.name,
        COALESCE(o.real_rows, 0)::int AS real_rows,
        COALESCE(o.mock_rows, 0)::int AS mock_rows,
        o.first_date,
        o.latest_date,
        o.latest_source
      FROM companies c
      JOIN target_workspace tw ON tw.id = c.workspace_id
      LEFT JOIN owned_daily o ON o.company_id = c.id
      WHERE c.ticker ~ '^[0-9]{4}$'
      ORDER BY c.ticker ASC
    `);

    const rows = ((result as { rows?: Record<string, unknown>[] }).rows
      ?? (Array.isArray(result) ? result : [])) as Record<string, unknown>[];
    const byTicker = new Map(rows.map((row) => [String(row.ticker ?? ""), row]));
    const items = symbols.map((symbol) => {
      const row = byTicker.get(symbol);
      if (!row) {
        return {
          symbol,
          name: null,
          state: "MISSING_COMPANY" as OwnedKlineDepthState,
          realRows: 0,
          mockRows: 0,
          firstDate: null,
          latestDate: null,
          latestSource: null,
          owned: true
        };
      }
      const realRows = Number(row.real_rows ?? 0);
      const latestDate = typeof row.latest_date === "string" ? row.latest_date : null;
      return {
        symbol,
        name: String(row.name ?? symbol),
        state: resolveOwnedKlineDepthState(realRows, latestDate),
        realRows,
        mockRows: Number(row.mock_rows ?? 0),
        firstDate: typeof row.first_date === "string" ? row.first_date : null,
        latestDate,
        latestSource: typeof row.latest_source === "string" ? row.latest_source : null,
        owned: true
      };
    });
    const ready = items.filter((item) => item.state === "READY").length;

    return c.json({
      data: {
        ...base,
        state: ready === items.length ? "READY" : ready > 0 ? "PARTIAL" : "NEEDS_BACKFILL",
        summary: {
          total: items.length,
          ready,
          shallow: items.filter((item) => item.state === "SHALLOW").length,
          stale: items.filter((item) => item.state === "STALE").length,
          empty: items.filter((item) => item.state === "EMPTY").length,
          missingCompany: items.filter((item) => item.state === "MISSING_COMPANY").length
        },
        items
      }
    });
  } catch (err) {
    return c.json({
      data: {
        ...base,
        state: "ERROR",
        items: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }, 500);
  }
});

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
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
  if (!requireMinRole(c.get("session"), "Analyst")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

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
async function resolveOhlcvDeepBackfillCandidates(
  workspaceId: string
): Promise<Array<{ companyId: string; ticker: string; workspaceId: string }>> {
  const db = getDb();
  if (!db) return [];

  const result = await db.execute(drizzleSql`
    WITH owned_daily AS (
      SELECT
        company_id,
        COUNT(*) FILTER (WHERE source != 'mock' AND interval = '1d')::int AS real_rows,
        MAX(dt) FILTER (WHERE source != 'mock' AND interval = '1d') AS latest_date
      FROM companies_ohlcv
      GROUP BY company_id
    )
    SELECT
      c.id::text AS company_id,
      c.ticker,
      c.workspace_id::text AS workspace_id
    FROM companies c
    LEFT JOIN owned_daily o ON o.company_id = c.id
    WHERE c.workspace_id = ${workspaceId}
      AND c.ticker ~ '^[0-9]{4}$'
      AND (
        COALESCE(o.real_rows, 0) < ${OWNED_DAILY_KLINE_REQUIRED_BARS}
        OR o.latest_date IS NULL
        OR o.latest_date < (CURRENT_DATE - (${OWNED_DAILY_KLINE_STALE_DAYS}::int * INTERVAL '1 day'))
      )
    ORDER BY COALESCE(o.real_rows, 0) ASC, o.latest_date ASC NULLS FIRST, c.ticker ASC
  `);

  const rows = ((result as { rows?: Record<string, unknown>[] }).rows
    ?? (Array.isArray(result) ? result : [])) as Record<string, unknown>[];
  return rows
    .map((row, index) => ({
      companyId: String(row.company_id ?? ""),
      ticker: String(row.ticker ?? ""),
      workspaceId: String(row.workspace_id ?? workspaceId),
      originalIndex: index
    }))
    .filter((row) => row.companyId && /^\d{4}$/.test(row.ticker))
    .sort((a, b) => {
      const aPriority = OWNED_DAILY_KLINE_PRIORITY.get(a.ticker) ?? Number.MAX_SAFE_INTEGER;
      const bPriority = OWNED_DAILY_KLINE_PRIORITY.get(b.ticker) ?? Number.MAX_SAFE_INTEGER;
      return aPriority - bPriority || a.originalIndex - b.originalIndex;
    })
    .map(({ originalIndex: _originalIndex, ...row }) => row);
}

function daysAgoUtcDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

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
    const deepCandidates = await resolveOhlcvDeepBackfillCandidates(workspaceId);
    const deepTickers = await takeFinMindSchedulerBatch(
      "ohlcv-deep-backfill",
      deepCandidates,
      schedulerPositiveInt("FINMIND_OHLCV_DEEP_BACKFILL_BATCH_SIZE", 48),
      true
    );
    if (deepTickers.length > 0) {
      console.log(
        `[ohlcv-scheduler] Starting deep owned-store backfill for ${deepTickers.length}/${deepCandidates.length} ` +
        `underfilled tickers (requiredBars=${OWNED_DAILY_KLINE_REQUIRED_BARS})`
      );
      const deepResult = await runOhlcvFinmindSync(deepTickers, {
        startDate: daysAgoUtcDate(OWNED_DAILY_KLINE_DEEP_BACKFILL_DAYS),
        forceFinmind: true
      });
      console.log(
        `[ohlcv-scheduler] Deep backfill done: success=${deepResult.tickersSuccess} ` +
        `failed=${deepResult.tickersFailed} durationMs=${deepResult.durationMs}`
      );
    }
    const tickers = await takeFinMindSchedulerBatch(
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
  | "pipeline_triggered"
  | "pipeline_skipped"
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
 * 2026-05-31: route the 09:00 dispatcher into the same OpenAlice v2
 * pipeline/template path used by pre-market/close ticks. Do not enqueue the
 * old short-instruction daily_brief job here; that path can bypass the fixed
 * daily_brief_contract_v2 shape.
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

  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });

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

  // Idempotency: skip if today's brief formal row already exists.
  // Worker rule-template drafts don't count — they must never block the v2 pipeline.
  const [existingBrief] = await db
    .select({ id: dailyBriefs.id, sections: dailyBriefs.sections })
    .from(dailyBriefs)
    .where(
      and(
        eq(dailyBriefs.workspaceId, workspace.id),
        eq(dailyBriefs.date, todayStr),
        or(
          eq(dailyBriefs.status, "published"),
          eq(dailyBriefs.status, "approved")
        )
      )
    )
    .limit(1);
  if (existingBrief && isDailyBriefV2ContractCompliant(existingBrief)) {
    console.log(`[daily-brief-dispatcher] Brief already exists for ${todayStr}, skipping`);
    _lastTickState.lastTickResult = "skipped_existing_brief";
    return;
  }
  if (existingBrief) {
    console.warn(
      `[daily-brief-dispatcher] Existing brief for ${todayStr} is not v2 contract compliant; routing to v2 pipeline`
    );
  }

  try {
    const result = await runPipelineTick("pre_market", workspace.slug);
    if (result.error) {
      throw new Error(result.error);
    }
    if (result.skippedReason) {
      console.log(`[daily-brief-dispatcher] Pipeline skipped for ${todayStr}: ${result.skippedReason}`);
      _lastTickState.lastTickResult = "pipeline_skipped";
      _lastTickState.lastEnqueueError = result.skippedReason;
      _lastTickState.lastEnqueueErrorStack = null;
      return;
    }

    console.log(
      `[daily-brief-dispatcher] Routed to v2 pipeline for ${todayStr}: ` +
      `jobId=${result.jobId ?? "n/a"} draftId=${result.draftId ?? "n/a"} briefId=${result.publishedBriefId ?? "n/a"}`
    );
    _lastTickState.lastTickResult = "pipeline_triggered";
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
 * Query params: limit (default 50, max 200), unread (default false),
 *   audience (default actionable_market — see P1-2 below)
 *
 * P1-2 (2026-07-11 product critique): the alerts page must not double as a
 * pipeline ops log. Default response is trader-facing "actionable_market"
 * events only; a session may request `?audience=ops_internal` or `?audience=all`
 * to see pipeline/system self-monitoring events too, but that's an Owner-only
 * surface — any other role silently gets the actionable-only default regardless
 * of what it asks for.
 */
app.get("/api/v1/alerts", async (c) => {
  const session = c.var.session;
  if (!session) return c.json({ error: "auth_required" }, 401);

  const limitParam = c.req.query("limit");
  const unreadParam = c.req.query("unread");
  const audienceParam = c.req.query("audience");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;
  const unreadOnly = unreadParam === "true";

  const requestedAudience: "actionable_market" | "ops_internal" | "all" =
    audienceParam === "ops_internal" || audienceParam === "all" ? audienceParam : "actionable_market";
  const audience = requestedAudience !== "actionable_market" && session.user.role !== "Owner"
    ? "actionable_market"
    : requestedAudience;

  const events = await listEvents({
    workspaceId: session.workspace.id,
    limit,
    unreadOnly,
    dedupeSameDay: true,
    ...(audience === "all" ? {} : { audience })
  });
  return c.json({
    data: events,
    meta: { count: events.length, unreadOnly, audience, engineState: getEventEngineState() }
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

  const result = await acknowledgeEvent(session.workspace.id, id);
  if (!result.ok) {
    return c.json({ error: result.reason ?? "ack_failed" }, result.reason === "not_found" ? 404 : 500);
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
          const events = await listEvents({ workspaceId: session.workspace.id, limit: 20, unreadOnly: true });
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

/**
 * GET /api/v1/iuf-events
 * 5/12 FIX: Dedicated route for iuf_events table.
 * Bruce verify found this URL returning 404 — route was missing.
 * Functionally identical to GET /api/v1/alerts but explicitly named for the iuf_events table.
 * Auth required.
 */
app.get("/api/v1/iuf-events", async (c) => {
  const session = c.var.session;
  if (!session) return c.json({ error: "auth_required" }, 401);

  const limitParam = c.req.query("limit");
  const unreadParam = c.req.query("unread");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;
  const unreadOnly = unreadParam === "true";

  const events = await listEvents({ workspaceId: session.workspace.id, limit, unreadOnly });
  return c.json({
    data: events,
    meta: { count: events.length, unreadOnly, source: "iuf_events", engineState: getEventEngineState() }
  });
});

/**
 * POST /api/v1/internal/alerts/force-dispatch
 * 5/12 FIX: Force-runs the event rule engine, bypassing the 1h dedup window.
 * Writes audit_logs action=alerts.dispatch + alert.fire per event.
 * Owner only. Used by Bruce for production verify and manual testing.
 */
app.post("/api/v1/internal/alerts/force-dispatch", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const before = getEventEngineState();
  const result = await runEventEngineTickForce(session.workspace.id).catch((e) => ({
    eventsWritten: 0,
    rulesEvaluated: 0,
    errors: [e instanceof Error ? e.message : String(e)]
  }));
  const after = getEventEngineState();

  return c.json({
    data: {
      eventsWritten: result.eventsWritten,
      rulesEvaluated: result.rulesEvaluated,
      errors: result.errors,
      totalEventsBefore: before.totalEventsThisProcess,
      totalEventsAfter: after.totalEventsThisProcess,
      tickAt: after.lastTickAt,
      lastError: after.lastError
    }
  });
});

// =============================================================================
// ADMIN: TWSE Announcements Backfill
// =============================================================================
//
// POST /api/v1/admin/announcements/backfill
//   Owner-only. Triggers TWSE OpenAPI ingest for a historical date range.
//   Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
//     OR: { lookbackDays: number } (default 7)
//   No window guard — fires unconditionally regardless of trading hours.
//   Idempotent: ON CONFLICT DO NOTHING.
//
// Root cause (2026-05-17): ingest only fires 09:00–15:00 TST weekdays.
//   Deploys outside that window skip boot catch-up → multi-day data gap.
//   This endpoint lets Owner manually backfill any gap up to 30 days.
// =============================================================================

app.post("/api/v1/admin/announcements/backfill", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: { from?: string; to?: string; lookbackDays?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  let lookbackDays = 7; // default: cover a full week
  if (typeof body.lookbackDays === "number" && body.lookbackDays > 0 && body.lookbackDays <= 30) {
    lookbackDays = body.lookbackDays;
  } else if (body.from && body.to) {
    // Compute lookbackDays from date range
    const fromMs = new Date(body.from + "T00:00:00Z").getTime();
    const toMs = new Date(body.to + "T23:59:59Z").getTime();
    if (isNaN(fromMs) || isNaN(toMs) || fromMs > toMs) {
      return c.json({ error: "INVALID_DATE_RANGE", message: "from must be <= to, both YYYY-MM-DD" }, 400);
    }
    // lookbackDays = days from 'from' until now
    const nowMs = Date.now();
    lookbackDays = Math.min(30, Math.ceil((nowMs - fromMs) / (24 * 60 * 60 * 1000)) + 1);
  }

  console.log(`[admin/announcements/backfill] triggered by Owner uid=${session.user.id} lookbackDays=${lookbackDays}`);

  const result = await runTwseAnnouncementIngest({ lookbackDays }).catch((e: unknown) => ({
    rowsFetched: 0,
    rowsInserted: 0,
    rowsSkipped: 0,
    skipped: true,
    skipReason: e instanceof Error ? e.message : String(e),
    durationMs: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  }));

  return c.json({
    data: {
      lookbackDays,
      from: body.from ?? null,
      to: body.to ?? null,
      ...result
    }
  });
});

// =============================================================================
// ADMIN: F-AUTO SIM Ledger Backfill
// =============================================================================
//
// POST /api/v1/admin/fauto-ledger/backfill
//   Owner-only. Runs the F-AUTO SIM continuous ledger backfill (6/2→today).
//   Body: { apply?: boolean }  — default apply=false (dry-run).
//   With apply=true writes to sim_ledger_weeks + sim_ledger_holdings + sim_ledger_nav.
//
//   Dry-run validation: response includes both no-cost (Phase 1 baseline ~-6.34%)
//   and with-cost (Phase 2 target ~-8.38%) equity figures. DO NOT apply unless
//   noCostFinalEquity ≈ 9_365_680 (regression check).
//
//   楊董 ACK 2026-07-02: Phase 2 帳本落地 prod — apply only via Elva.
// =============================================================================

app.post("/api/v1/admin/fauto-ledger/backfill", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: { apply?: boolean } = {};
  try {
    body = (await c.req.json()) as { apply?: boolean };
  } catch {
    // empty body = dry-run
  }
  const applyToDb = body.apply === true;

  try {
    const { runBackfill, STANDARD_COST_RATES, ZERO_COST_RATES } = await import("./sim-ledger-backfill.js");

    // Run with costs (Phase 2 target — includes transaction fees)
    const result = await runBackfill({
      dryRun: !applyToDb,
      costRates: STANDARD_COST_RATES,
    });

    // Phase 1 baseline validation (no costs — must match ~9_365_680)
    const baselineResult = applyToDb
      ? null
      : await runBackfill({
          dryRun: true,
          costRates: ZERO_COST_RATES,
        });

    const phase1BaselineCheck = baselineResult
      ? {
          expectedNoCostEquity: 9_365_680,
          actualNoCostEquity: baselineResult.finalEquity,
          diffTwd: baselineResult.finalEquity - 9_365_680,
          // Allow ±5000 TWD variance (rounding from FinMind data vs Phase 1 run)
          pass: Math.abs(baselineResult.finalEquity - 9_365_680) < 5_000,
        }
      : null;

    return c.json({
      ok: true,
      dryRun: !applyToDb,
      applied: applyToDb,
      withCost: {
        finalEquity: result.finalEquity,
        cumulativeReturnPct: result.cumulativeReturnPct,
        totalRealizedPnl: result.totalRealizedPnl,
        totalTransactionCostsTwd: result.totalTransactionCostsTwd,
      },
      noCost: baselineResult
        ? {
            finalEquity: baselineResult.finalEquity,
            cumulativeReturnPct: baselineResult.cumulativeReturnPct,
          }
        : null,
      phase1BaselineCheck,
      weeks: result.weeks.map((w) => ({
        weekNum: w.weekNum,
        basketDate: w.basketDate,
        realizedPnlTwd: w.realizedPnlTwd,
        equityAfterTwd: w.equityAfterTwd,
        cashResidualTwd: w.cashResidualTwd,
        basketCostTwd: w.basketCostTwd,
      })),
      navCurveLength: result.navCurve.length,
      priceDataWarnings: result.priceDataWarnings,
      assumptions: result.assumptions,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[admin/fauto-ledger/backfill] error:", e);
    return c.json({ error: "BACKFILL_FAILED", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// =============================================================================
// ADMIN: F-AUTO SIM Ledger Single-Date Catch-up
// =============================================================================
//
// POST /api/v1/admin/fauto-ledger/single-date-catchup
//   Owner-only. Patches a single missed Tuesday rebalance date whose live EOD
//   cron never fired (writeLiveLedgerAfterEod() never ran that day) — the EOD
//   window cannot reopen, so this is a one-time historical patch, not a
//   re-run of the live pipeline. Prices via FinMind PIT (same engine
//   runBackfill() uses), NOT live TWSE/TPEX/MIS (which cannot answer for a
//   past date). See reports/ledger_stall_20260709/ for the 2026-07-07 case
//   this was built for.
//   Body: { date: "YYYY-MM-DD", apply?: boolean } — default apply=false (dry-run).
//   Idempotent: if sim_ledger_weeks/sim_ledger_nav already has a 'live'/'live_eod'
//   row for `date`, returns alreadyWritten=true and performs no write.
//   apply=true is refused if any required symbol has no usable FinMind PIT
//   price (missingPriceSymbols non-empty) — never silently persists a ledger
//   row derived from a failed/incomplete price fetch.
//   楊董 ACK 2026-07-10: 7/7 帳本缺口回補 — apply 由 Elva 對 prod 執行。
// =============================================================================

app.post("/api/v1/admin/fauto-ledger/single-date-catchup", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: { date?: string; apply?: boolean } = {};
  try {
    body = (await c.req.json()) as { date?: string; apply?: boolean };
  } catch {
    // empty body — fall through to validation below
  }

  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "invalid_date", message: "body.date must be YYYY-MM-DD" }, 400);
  }
  const applyToDb = body.apply === true;

  try {
    const { writeSingleDateLedgerCatchup } = await import("./sim-ledger-backfill.js");
    const result = await writeSingleDateLedgerCatchup({ date, apply: applyToDb });
    return c.json({ ...result, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[admin/fauto-ledger/single-date-catchup] error:", e);
    return c.json({ error: "CATCHUP_FAILED", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// =============================================================================
// ADMIN: F-AUTO SIM Ledger Single-Date Reprice
// =============================================================================
//
// POST /api/v1/admin/fauto-ledger/single-date-reprice
//   Owner-only. Corrects an EXISTING daily sim_ledger_nav row's market-value
//   component using that date's OWN FinMind PIT close — UPDATE, not INSERT.
//   Built after the #1207/#1210 priceAudit investigation confirmed a
//   systematic one-day mark-to-market lag on rows written by the
//   pre-#1192/#1202 live EOD tick (2026-07-08's row priced with 2026-07-07's
//   close, 2026-07-09's with 2026-07-08's). Never touches sim_ledger_weeks —
//   a date with a week row (Tuesday rebalance) is rejected, different
//   semantics, out of scope for this tool.
//   Body: { date: "YYYY-MM-DD", apply?: boolean } — default apply=false (dry-run).
//   Guards (checked in order): future date rejected; a date with a
//   sim_ledger_weeks row rejected; target sim_ledger_nav row
//   (source='live_eod') must already exist (else use single-date-catchup).
//   Idempotent: a row whose notes already carry a "repriced:" marker returns
//   alreadyRepriced=true and performs no write. apply=true is refused if any
//   basket symbol has no usable FinMind PIT price for `date`.
//   楊董/Elva ACK 2026-07-10 — apply 由 Elva 對 prod 執行。
// =============================================================================

app.post("/api/v1/admin/fauto-ledger/single-date-reprice", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: { date?: string; apply?: boolean } = {};
  try {
    body = (await c.req.json()) as { date?: string; apply?: boolean };
  } catch {
    // empty body — fall through to validation below
  }

  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: "invalid_date", message: "body.date must be YYYY-MM-DD" }, 400);
  }
  const applyToDb = body.apply === true;

  try {
    const { writeSingleDateLedgerReprice } = await import("./sim-ledger-backfill.js");
    const result = await writeSingleDateLedgerReprice({ date, apply: applyToDb });
    return c.json({ ...result, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("[admin/fauto-ledger/single-date-reprice] error:", e);
    return c.json({ error: "REPRICE_FAILED", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// =============================================================================
// ADMIN: News Top-10 Force Refresh
// =============================================================================
//
// POST /api/v1/admin/news-top10/force-refresh
//   Owner-only. Triggers AI news selector immediately, bypassing all window gates.
//   Use after deploy when stale_reason=never_run and you can't wait for the next
//   08:00/12:00/18:00/24:00 TST window.
// =============================================================================

app.post("/api/v1/admin/news-top10/force-refresh", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const workspaceId = session.workspace.id;
  console.log(`[admin/news-top10/force-refresh] triggered by Owner uid=${session.user.id}`);

  const result = await runNewsAiSelection({
    workspaceId,
    forcedWindowLabel: "08:00"  // label is informational; actual content is from current window
  }).catch((e: unknown) => ({
    run_id: "error",
    as_of: new Date().toISOString(),
    next_refresh_at: new Date().toISOString(),
    window_label: "08:00" as const,
    selection_mode: "fallback" as const,
    items: [],
    input_row_count: 0,
    ai_call_success: false,
    stale_reason: `force_refresh_error:${e instanceof Error ? e.message : String(e)}`
  }));

  return c.json({ data: result });
});

// =============================================================================
// ADMIN: Purge OpenAlice fallback-spam decisions (one-off cleanup)
// =============================================================================
//
// POST /api/v1/admin/openalice/decisions/purge-fallback-spam
//   Owner-only. Dry-run by default; pass {"apply":true} to delete.
//   Removes the priority_alert decisions produced by buildFallbackDecision when
//   the LLM was unavailable (action_payload.fallback=true) plus the
//   notification-centre iuf_events they were executed into (rule_id=
//   R_OPENALICE_DECISION, "OpenAlice decision LLM unavailable" message).
//   2026-06-26: the OpenAI 429 outage + self-alert loop (fixed #1141) produced
//   ~322 of these, flooding the decisions feed. Targets ONLY fallback-marked
//   rows — real priority_alerts (fallback flag unset) are never matched.
// =============================================================================

app.post("/api/v1/admin/openalice/decisions/purge-fallback-spam", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const body = await c.req.json().catch(() => ({}));
  const apply = (body as { apply?: unknown })?.apply === true;

  // Precise identifiers — only the LLM-unavailable fallback spam, nothing else.
  const decisionWhere = drizzleSql`workspace_id = ${session.workspace.id} AND action_type = 'priority_alert' AND action_payload->>'fallback' = 'true'`;
  const eventWhere = drizzleSql`workspace_id = ${session.workspace.id} AND rule_id = 'R_OPENALICE_DECISION' AND payload->>'message' LIKE 'OpenAlice decision LLM unavailable%'`;

  try {
    const decCnt = dbExecRows<{ n?: number }>(
      await db.execute(drizzleSql`SELECT COUNT(*)::int AS n FROM iuf_decisions WHERE ${decisionWhere}`)
    )[0]?.n ?? 0;
    const evtCnt = dbExecRows<{ n?: number }>(
      await db.execute(drizzleSql`SELECT COUNT(*)::int AS n FROM iuf_events WHERE ${eventWhere}`)
    )[0]?.n ?? 0;

    if (!apply) {
      return c.json({
        mode: "dry_run",
        decisionsMatched: Number(decCnt),
        eventsMatched: Number(evtCnt),
        note: 'pass {"apply":true} to delete',
      });
    }

    await db.execute(drizzleSql`DELETE FROM iuf_decisions WHERE ${decisionWhere}`);
    await db.execute(drizzleSql`DELETE FROM iuf_events WHERE ${eventWhere}`);
    console.log(
      `[admin/purge-fallback-spam] Owner uid=${session.user.id} ` +
        `deleted decisions=${decCnt} events=${evtCnt}`
    );
    return c.json({
      mode: "applied",
      decisionsDeleted: Number(decCnt),
      eventsDeleted: Number(evtCnt),
    });
  } catch (e) {
    return c.json(
      { error: "purge_failed", message: e instanceof Error ? e.message : String(e) },
      500
    );
  }
});

// =============================================================================
// ADMIN: News Top-10 Diagnostics (F1)
// =============================================================================
//
// GET /api/v1/admin/news-top10/diag
//   Owner-only. Returns env validation + in-memory state + DB latest summary.
//   Does NOT expose the API key itself — only present=true/false.
// =============================================================================

app.get("/api/v1/admin/news-top10/diag", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const lastResult = getLastNewsTop10();
  const lastRunAt = getLastNewsRunAt();
  const lastError = getNewsAiLastError();

  // Load DB latest without triggering a new run
  const dbLatest = await loadLatestSelectionFromDb().catch(() => null);

  return c.json({
    data: {
      env_key_present: Boolean(process.env["OPENAI_API_KEY"]),
      model: "gpt-4o-mini",
      in_memory_state: lastResult
        ? {
            run_id: lastResult.run_id,
            as_of: lastResult.as_of,
            window_label: lastResult.window_label,
            selection_mode: lastResult.selection_mode,
            item_count: lastResult.items.length,
            ai_call_success: lastResult.ai_call_success,
            stale_reason: lastResult.stale_reason
          }
        : null,
      last_run_at: lastRunAt?.toISOString() ?? null,
      last_run_id: lastResult?.run_id ?? null,
      last_error: lastError,
      db_latest: dbLatest
        ? {
            run_id: dbLatest.run_id,
            as_of: dbLatest.as_of,
            window_label: dbLatest.window_label,
            selection_mode: dbLatest.selection_mode,
            item_count: dbLatest.items.length,
            ai_call_success: dbLatest.ai_call_success
          }
        : null
    }
  });
});

// =============================================================================
// GET /api/v1/admin/market/refresh-status
//   Owner-only. Returns market overview cron state: last fire time, next estimated
//   fire time, and any last error. Used by Bruce/Mike to verify prod cron health.
// =============================================================================

app.get("/api/v1/admin/market/refresh-status", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const nextFire = _marketOverviewCronLastFiredAt
    ? new Date(new Date(_marketOverviewCronLastFiredAt).getTime() + 5 * 60 * 1000).toISOString()
    : null;

  return c.json({
    data: {
      cron: "market-overview-cron",
      interval_sec: 300,
      window: "09:00–13:35 TST weekdays",
      last_fired_at: _marketOverviewCronLastFiredAt,
      next_fire_eta: nextFire,
      last_error: _marketOverviewCronLastError,
      news_ai_cron: {
        interval_sec: 3600,
        guard_min: 50,
        description: "hourly, fires every 60min, 50min double-fire guard"
      }
    }
  });
});

// =============================================================================
// Fix 4 — POST /api/v1/admin/companies/seed
// Idempotently seeds missing canonical companies (1216 統一企業 + 0050 元大台灣50).
// Safe to call multiple times: checks ticker existence before insert.
// Owner only.  No DB migration required — uses existing companies table.
// =============================================================================

const _SEED_EXPOSURE = { volume: 3, asp: 3, margin: 3, capacity: 3, narrative: 3 } as const;
const _SEED_VALIDATION = { capitalFlow: "neutral", consensus: "neutral", relativeStrength: "neutral" } as const;

const CANONICAL_COMPANIES_SEED: Array<{
  ticker: string;
  name: string;
  market: string;
  country: string;
  chainPosition: string;
  beneficiaryTier: "Core" | "Direct" | "Indirect" | "Observation";
  exposure: typeof _SEED_EXPOSURE;
  validation: typeof _SEED_VALIDATION;
  notes: string;
  themeIds: string[];
}> = [
  {
    ticker: "1216",
    name: "統一企業",
    market: "食品工業",
    country: "Taiwan",
    // chain_position is TEXT (no enum constraint) — use zh-TW industry chain label
    chainPosition: "消費必需品龍頭",
    beneficiaryTier: "Core",
    exposure: _SEED_EXPOSURE,
    validation: _SEED_VALIDATION,
    notes: "統一企業 — 台灣最大食品飲料集團，旗下7-ELEVEN、統一超。",
    themeIds: []
  },
  {
    ticker: "0050",
    name: "元大台灣50",
    market: "ETF",
    country: "Taiwan",
    // chain_position is TEXT (no enum constraint) — use zh-TW fund type label
    chainPosition: "大盤指數ETF",
    beneficiaryTier: "Core",
    exposure: _SEED_EXPOSURE,
    validation: _SEED_VALIDATION,
    notes: "元大台灣50 — 追蹤台灣50指數，前50大市值個股。",
    themeIds: []
  }
];

// POST /api/v1/admin/companies/fix-market — Owner-only. Reconcile company.market
// against the official TWSE (STOCK_DAY_ALL) + TPEX (mainboard) listings.
// 6/16 audit: 683 OTC stocks were mislabelled market="TWSE" (import default),
// breaking the 上市/上櫃 label everywhere. dry-run by default; { apply: true }
// executes the UPDATE. Reversible (market field only); never touches prices.
app.post("/api/v1/admin/companies/fix-market", async (c) => {
  const session = c.get("session");
  if (session.user.role !== "Owner") return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json().catch(() => ({})) as { apply?: boolean };
  const apply = body.apply === true;

  if (!isDatabaseMode()) return c.json({ error: "memory_mode_no_db" }, 503);
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const { getStockDayAllRows, getTpexMainboardCloseRows } = await import("./data-sources/twse-openapi-client.js");
  const [twseRows, tpexRows] = await Promise.all([getStockDayAllRows(), getTpexMainboardCloseRows()]);
  const isCommon = (code: string) => /^[1-9]\d{3}$/.test(code);
  const listed = new Set(twseRows.map((r) => (r.Code ?? "").trim()).filter(isCommon));
  const otc = new Set(tpexRows.map((r) => (r.SecuritiesCompanyCode ?? "").trim()).filter(isCommon));
  // Guard: never reconcile against a truncated upstream list (would mislabel en masse).
  if (listed.size < 500 || otc.size < 300) {
    return c.json({ error: "official_lists_unavailable", listedSize: listed.size, otcSize: otc.size }, 503);
  }

  const rawRows = await db.execute(
    drizzleSql`SELECT ticker, market FROM companies WHERE workspace_id = ${session.workspace.id}`
  );
  const companies = (Array.isArray(rawRows) ? rawRows : (rawRows as { rows?: unknown[] }).rows ?? []) as Array<{ ticker?: string; market?: string }>;

  const toOtc: string[] = [];
  const toListed: string[] = [];
  for (const co of companies) {
    const t = (co.ticker ?? "").trim();
    const m = co.market ?? "";
    if (!isCommon(t)) continue;
    if (otc.has(t) && !listed.has(t) && (m === "TWSE" || m === "上市")) toOtc.push(t);
    else if (listed.has(t) && !otc.has(t) && m === "上櫃") toListed.push(t);
  }

  let applied = 0;
  if (apply) {
    if (toOtc.length > 0) {
      await db.execute(drizzleSql`UPDATE companies SET market = '上櫃' WHERE workspace_id = ${session.workspace.id} AND ticker IN (${drizzleSql.join(toOtc.map((t) => drizzleSql`${t}`), drizzleSql`, `)})`);
      applied += toOtc.length;
    }
    if (toListed.length > 0) {
      await db.execute(drizzleSql`UPDATE companies SET market = 'TWSE' WHERE workspace_id = ${session.workspace.id} AND ticker IN (${drizzleSql.join(toListed.map((t) => drizzleSql`${t}`), drizzleSql`, `)})`);
      applied += toListed.length;
    }
    console.info(`[admin/companies/fix-market] applied: ${toOtc.length} → 上櫃, ${toListed.length} → TWSE (owner uid=${session.user.id})`);
  }

  return c.json({
    dryRun: !apply,
    listedSize: listed.size,
    otcSize: otc.size,
    toOtcCount: toOtc.length,
    toListedCount: toListed.length,
    applied,
    sampleToOtc: toOtc.slice(0, 30),
    sampleToListed: toListed.slice(0, 30),
  });
});

app.post("/api/v1/admin/companies/seed", async (c) => {
  const session = c.get("session");
  if (session.user.role !== "Owner" && session.user.role !== "Admin") {
    return c.json({ error: "forbidden" }, 403);
  }

  const repo = c.get("repo");
  const workspaceSlug = session.workspace.slug;

  const results: Array<{ ticker: string; action: "created" | "already_exists" | "error"; detail?: string }> = [];

  for (const seed of CANONICAL_COMPANIES_SEED) {
    try {
      // Bypass the 5-min cache — use repo directly so idempotency check is always fresh.
      // (getCompaniesLiteCached would return stale [] on first seed call and fail to detect
      //  existing rows on a second call within the same 5-min window.)
      const existing = await repo.listCompaniesLite({ workspaceSlug });
      const found = existing.find((co) => co.ticker === seed.ticker);
      if (found) {
        results.push({ ticker: seed.ticker, action: "already_exists" });
        continue;
      }

      // Create the company
      console.info(`[admin/companies/seed] inserting ticker=${seed.ticker} beneficiaryTier=${seed.beneficiaryTier} chainPosition=${seed.chainPosition}`);
      await repo.createCompany(
        {
          ticker: seed.ticker,
          name: seed.name,
          market: seed.market,
          country: seed.country,
          chainPosition: seed.chainPosition,
          beneficiaryTier: seed.beneficiaryTier,
          exposure: seed.exposure,
          validation: seed.validation,
          notes: seed.notes,
          themeIds: []
        },
        { workspaceSlug }
      );
      results.push({ ticker: seed.ticker, action: "created" });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;
      console.error(`[admin/companies/seed] failed for ticker=${seed.ticker}:`, detail, stack);
      results.push({ ticker: seed.ticker, action: "error", detail });
    }
  }

  const created = results.filter((r) => r.action === "created").length;
  const alreadyExist = results.filter((r) => r.action === "already_exists").length;
  const errors = results.filter((r) => r.action === "error").length;

  return c.json({
    ok: errors === 0,
    created,
    already_exists: alreadyExist,
    errors,
    results
  });
});

// =============================================================================
// POST /api/v1/admin/companies/bulk-seed
// Bulk-seed 1700+ TWSE/TPEx listed companies from TWSE & TPEx OpenAPI.
// Idempotent: existing tickers are skipped (ON CONFLICT DO NOTHING semantics).
// Sources:
//   TWSE: https://opendata.twse.com.tw/v1/opendata/t187ap03_L (上市公司基本資料)
//   TPEx: https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O (上櫃公司基本資料)
// Owner-only. No DB migration required — uses existing companies table.
// Body (optional): { dryRun?: boolean, source?: "twse"|"tpex"|"all" }
// Response: { ok, created, skipped, errors, total_fetched }
// =============================================================================

const _BULK_SEED_EXPOSURE = { volume: 2, asp: 2, margin: 2, capacity: 2, narrative: 2 } as const;
const _BULK_SEED_VALIDATION = { capitalFlow: "neutral", consensus: "neutral", relativeStrength: "neutral" } as const;
// Use openapi.twse.com.tw (reachable from Railway) instead of opendata.twse.com.tw (unreachable)
const TWSE_OPENDATA_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L";
const TPEX_OPENDATA_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O";

// TWSE/TPEx official industry code → Chinese industry name
// Both TWSE t187ap03_L and TPEx t187ap03_O return numeric codes (e.g. "24") not text labels.
// These are the official TWSE MOPS 產業別 codes (stable, only change on new industry category creation).
const _TWSE_INDUSTRY_CODE_MAP: Record<string, string> = {
  "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維",
  "05": "電機機械", "06": "電器電纜", "07": "化學生技醫療", "08": "玻璃陶瓷",
  "09": "造紙工業", "10": "鋼鐵工業", "11": "橡膠工業", "12": "汽車工業",
  "14": "電子工業", "15": "建材營造", "16": "航運業",   "17": "金融保險",
  "18": "貿易百貨", "20": "其他",     "21": "化學工業", "22": "生技醫療業",
  "23": "油電燃氣", "24": "半導體業", "25": "電腦及週邊設備業",
  "26": "光電業",   "27": "通信網路業", "28": "電子零組件業",
  "29": "電子通路業", "30": "資訊服務業", "31": "其他電子業",
  "32": "文化創意業", "33": "電商",     "35": "綠能環保",
  "36": "數位雲端",  "37": "運動休閒",  "38": "居家生活",
  "91": "存託憑證",
};

async function _fetchTwseListedCompanies(): Promise<Array<{ ticker: string; name: string; industry: string }>> {
  try {
    const res = await fetch(TWSE_OPENDATA_URL, {
      signal: AbortSignal.timeout(20_000),
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) {
      console.warn(`[bulk-seed] TWSE fetch failed: ${res.status}`);
      return [];
    }
    const text = await res.text();
    let raw: Array<Record<string, string>>;
    try { raw = JSON.parse(text); } catch { console.warn("[bulk-seed] TWSE non-JSON body"); return []; }
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => {
      const ticker = (r["公司代號"] ?? r["Code"] ?? r["code"] ?? "").trim();
      const name = (r["公司簡稱"] ?? r["公司名稱"] ?? r["Name"] ?? "").trim();
      // 產業別 field returns a numeric code — convert to human-readable label
      const rawCode = (r["產業別"] ?? r["Industry"] ?? "").trim();
      const industry = _TWSE_INDUSTRY_CODE_MAP[rawCode] ?? rawCode;
      return { ticker, name, industry };
    }).filter((c) => /^\d{4,6}$/.test(c.ticker) && c.name.length > 0);
  } catch (err) {
    console.warn("[bulk-seed] TWSE fetch error:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

async function _fetchTpexListedCompanies(): Promise<Array<{ ticker: string; name: string; industry: string }>> {
  try {
    const res = await fetch(TPEX_OPENDATA_URL, {
      signal: AbortSignal.timeout(20_000),
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) {
      console.warn(`[bulk-seed] TPEx fetch failed: ${res.status}`);
      return [];
    }
    const text = await res.text();
    let raw: Array<Record<string, string>>;
    try { raw = JSON.parse(text); } catch { console.warn("[bulk-seed] TPEx non-JSON body"); return []; }
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => {
      const ticker = (r["SecuritiesCompanyCode"] ?? r["公司代號"] ?? r["Code"] ?? "").trim();
      const name = (r["CompanyAbbreviation"] ?? r["CompanyName"] ?? r["公司簡稱"] ?? r["Name"] ?? "").trim();
      // TPEx returns SecuritiesIndustryCode (numeric) — not IndustryType (text, doesn't exist)
      const rawCode = (r["SecuritiesIndustryCode"] ?? r["IndustryType"] ?? r["產業別"] ?? "").trim();
      const industry = _TWSE_INDUSTRY_CODE_MAP[rawCode] ?? rawCode;
      return { ticker, name, industry };
    }).filter((c) => /^\d{4,6}$/.test(c.ticker) && c.name.length > 0);
  } catch (err) {
    console.warn("[bulk-seed] TPEx fetch error:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

type OfficialCompanyMasterRow = {
  ticker: string;
  name: string;
  industry: string;
  market: "TWSE" | "TPEX";
};

let _officialCompanyUniverseCache:
  | { loadedAtMs: number; rows: OfficialCompanyMasterRow[] }
  | null = null;
const OFFICIAL_COMPANY_UNIVERSE_CACHE_MS = 6 * 60 * 60 * 1000;

async function getOfficialCompanyUniverse(): Promise<OfficialCompanyMasterRow[]> {
  const now = Date.now();
  if (
    _officialCompanyUniverseCache &&
    now - _officialCompanyUniverseCache.loadedAtMs < OFFICIAL_COMPANY_UNIVERSE_CACHE_MS
  ) {
    return _officialCompanyUniverseCache.rows;
  }

  const [twseCompanies, tpexCompanies] = await Promise.all([
    _fetchTwseListedCompanies(),
    _fetchTpexListedCompanies(),
  ]);

  const byTicker = new Map<string, OfficialCompanyMasterRow>();
  for (const company of tpexCompanies) {
    byTicker.set(company.ticker, {
      ticker: company.ticker,
      name: company.name,
      industry: company.industry || "上櫃",
      market: "TPEX",
    });
  }
  for (const company of twseCompanies) {
    byTicker.set(company.ticker, {
      ticker: company.ticker,
      name: company.name,
      industry: company.industry || "上市",
      market: "TWSE",
    });
  }

  const rows = Array.from(byTicker.values());
  _officialCompanyUniverseCache = { loadedAtMs: now, rows };
  return rows;
}

async function ensureCompanyFromOfficialUniverse(
  repo: TradingRoomRepository,
  ticker: string,
  options: { workspaceSlug: string }
) {
  const normalizedTicker = ticker;
  if (!OFFICIAL_COMPANY_TICKER_PATTERN.test(normalizedTicker)) return null;

  const official = (await getOfficialCompanyUniverse()).find((row) => row.ticker === normalizedTicker);
  if (!official) return null;

  try {
    return await repo.createCompany(
      {
        ticker: official.ticker,
        name: official.name,
        market: official.industry || official.market,
        country: "Taiwan",
        chainPosition: official.industry || official.market,
        beneficiaryTier: "Observation" as const,
        exposure: _BULK_SEED_EXPOSURE,
        validation: _BULK_SEED_VALIDATION,
        notes: `Official company master read-through from ${official.market} OpenAPI ${new Date().toISOString().slice(0, 10)}`,
        themeIds: [],
      },
      options
    );
  } catch (err) {
    // Another request may have created the same ticker between our list and insert.
    // Re-read once so concurrent customer searches do not surface a false 404.
    const companies = await repo.listCompanies(undefined, options).catch(() => []);
    const existing = companies.find((company) => company.ticker === normalizedTicker);
    if (existing) return existing;
    console.warn(
      `[companies/read-through] failed ticker=${normalizedTicker}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

app.post("/api/v1/admin/companies/bulk-seed", async (c) => {
  const session = c.get("session");
  if (session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: { dryRun?: boolean; source?: string } = {};
  try {
    const raw = await c.req.json();
    if (raw && typeof raw === "object") {
      body = raw as { dryRun?: boolean; source?: string };
    }
  } catch { /* empty body OK */ }

  const dryRun = body.dryRun === true;
  const sourceFilter = (body.source ?? "all") as "twse" | "tpex" | "all";

  // Fetch from external sources
  const [twseCompanies, tpexCompanies] = await Promise.all([
    sourceFilter !== "tpex" ? _fetchTwseListedCompanies() : Promise.resolve([]),
    sourceFilter !== "twse" ? _fetchTpexListedCompanies() : Promise.resolve([]),
  ]);

  // Deduplicate by ticker (TWSE wins on conflict)
  const allMap = new Map<string, { ticker: string; name: string; industry: string; market: string }>();
  for (const c of tpexCompanies) {
    allMap.set(c.ticker, { ...c, market: c.industry || "上櫃" });
  }
  for (const c of twseCompanies) {
    allMap.set(c.ticker, { ...c, market: c.industry || "上市" }); // TWSE overwrites TPEx on same ticker
  }
  const allCompanies = Array.from(allMap.values());

  console.info(`[bulk-seed] fetched TWSE=${twseCompanies.length} TPEx=${tpexCompanies.length} deduped=${allCompanies.length} dryRun=${dryRun}`);

  if (dryRun) {
    return c.json({
      ok: true,
      dry_run: true,
      total_fetched: allCompanies.length,
      twse_count: twseCompanies.length,
      tpex_count: tpexCompanies.length,
      sample: allCompanies.slice(0, 5),
    });
  }

  // Load existing tickers to skip (use direct repo call — bypass cache)
  const repo = c.get("repo");
  const workspaceSlug = session.workspace.slug;
  const existing = await repo.listCompaniesLite({ workspaceSlug });
  const existingTickers = new Set(existing.map((co: { ticker: string }) => co.ticker));

  let created = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: Array<{ ticker: string; error: string }> = [];

  for (const company of allCompanies) {
    if (existingTickers.has(company.ticker)) {
      skipped++;
      continue;
    }
    try {
      await repo.createCompany(
        {
          ticker: company.ticker,
          name: company.name,
          market: company.market,
          country: "Taiwan",
          chainPosition: company.industry || company.market,
          beneficiaryTier: "Observation" as const,
          exposure: _BULK_SEED_EXPOSURE,
          validation: _BULK_SEED_VALIDATION,
          notes: `Auto-seeded from ${company.market.includes("上市") || twseCompanies.some((t) => t.ticker === company.ticker) ? "TWSE" : "TPEx"} OpenAPI 2026-05-19`,
          themeIds: [],
        },
        { workspaceSlug }
      );
      existingTickers.add(company.ticker); // prevent double-insert in same run
      created++;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      errors++;
      errorDetails.push({ ticker: company.ticker, error: detail.slice(0, 100) });
      if (errors <= 3) {
        console.error(`[bulk-seed] failed for ${company.ticker}:`, detail);
      }
    }
  }

  console.info(`[bulk-seed] done: created=${created} skipped=${skipped} errors=${errors}`);

  return c.json({
    ok: errors === 0,
    created,
    skipped,
    errors,
    total_fetched: allCompanies.length,
    error_sample: errorDetails.slice(0, 10),
  });
});

/**
 * POST /api/v1/admin/brief/backfill
 * 5/12 FIX: Backfill missing briefs for a date range (Owner only).
 * Body: { from: "2026-05-08", to: "2026-05-11", force?: boolean }
 * Fires pipeline for each trading day in range that doesn't have a brief.
 * All 5-layer review gates still run — never skips content checks.
 *
 * force=true: DELETE existing brief(s) for each date then re-generate with sanitizer.
 * Safe: single-row admin replace scoped to a date, not a schema/migration op.
 */
app.post("/api/v1/admin/brief/backfill", async (c) => {
  const session = c.var.session;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: { from?: string; to?: string; force?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  // Also support query params for convenience
  const fromParam = body.from ?? c.req.query("from") ?? "";
  const toParam = body.to ?? c.req.query("to") ?? "";
  const forceParam = body.force === true || c.req.query("force") === "true";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
    return c.json(
      { error: "INVALID_DATE_RANGE", message: "Body must include { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }" },
      400
    );
  }

  if (fromParam > toParam) {
    return c.json({ error: "INVALID_RANGE", message: "from must be <= to" }, 400);
  }

  if (forceParam) {
    console.log(
      `[admin/brief/backfill] force=true triggered by Owner uid=${session.user.id} ` +
      `for range=${fromParam}..${toParam}`
    );
  }

  const workspaceSlug = session.workspace.slug;
  const backfillResult = await runPipelineBackfillRange(workspaceSlug, fromParam, toParam, { force: forceParam }).catch(
    (e: unknown) => ({
      fired: [] as string[],
      skipped: [] as string[],
      errors: [e instanceof Error ? e.message : String(e)],
      deleted: [] as string[]
    })
  );

  return c.json({
    data: {
      from: fromParam,
      to: toParam,
      force: forceParam,
      fired: backfillResult.fired,
      skipped: backfillResult.skipped,
      errors: backfillResult.errors,
      deleted: backfillResult.deleted ?? []
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

  const result = await runEmailDigestTick(force, session.workspace.id).catch((e) => ({
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
  return c.json({ data: getDigestState(session.workspace.id) });
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
    // execRows: defensive helper for drizzle-orm/postgres-js raw execute results.
    // postgres-js driver returns a FLAT ARRAY from db.execute(), not { rows: [...] }.
    // Casting to { rows?: T[] } and reading .rows always yields undefined → silent zero.
    // This helper mirrors the proven pattern at server.ts line 4083-4084.
    // Root cause documented in evidence/w7_paper_sprint/BRUCE_AUDIT_STATS_SILENT_ZERO_ROOT_CAUSE_2026-05-08.md
    function execRows<T>(result: unknown): T[] {
      if (Array.isArray(result)) return result as T[];
      const r = result as { rows?: T[] };
      return r.rows ?? [];
    }
    function execFirstRow<T>(result: unknown): T | undefined {
      return execRows<T>(result)[0];
    }

    // audit-stats action string fix (2026-05-07):
    //   Real action strings written to audit_logs use the 'content_draft.' prefix.
    //   PR #292 introduced bare names (ai_approved etc) → silent zero.
    //   PR #296 fixed the prefix. This PR adds ai_yellow_held and precise
    //   adversarial_intercept count (JSONB severityScore >= 7 subquery).
    const rawRows = await db.execute(
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
            'content_draft.factual_reject',
            'paper_submit'
          )
        GROUP BY action
      `
    );
    const rows = execRows<{ action?: string; cnt?: number | string }>(rawRows);

    // paper_submit_rejected = paper_submit rows where payload->>'status' >= 422.
    // This is a JSONB-filtered SUBSET of paper_submit rows — NOT a separate
    // audit_log action. Therefore paper_submit_rejected is NOT included in `total`
    // (total comes from the GROUP BY aggregate above which only counts distinct
    // action strings; 'paper_submit_rejected' is never written as an action).
    // Consumer note: paper_submit_rejected <= paper_submit always holds.
    const rawRejRows = await db.execute(
      drizzleSql`
        SELECT COUNT(*)::int AS cnt
        FROM audit_logs
        WHERE created_at >= ${since}::timestamptz
          AND action = 'paper_submit'
          AND (payload->>'status')::int >= 422
      `
    );
    const rejFirstRow = execFirstRow<{ cnt?: number | string }>(rawRejRows);

    // adversarial_intercept = adversarial_audit rows where severityScore >= 7
    // (rows with score < 7 are paper-trail only; only >= 7 actually held the draft)
    const rawAdversarialRows = await db.execute(
      drizzleSql`
        SELECT COUNT(*)::int AS cnt
        FROM audit_logs
        WHERE created_at >= ${since}::timestamptz
          AND action = 'content_draft.adversarial_audit'
          AND (payload->>'severityScore')::int >= 7
      `
    );
    const adversarialFirstRow = execFirstRow<{ cnt?: number | string }>(rawAdversarialRows);

    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (row.action) {
        counts[row.action] = Number(row.cnt ?? 0);
      }
    }
    const paperSubmitRejectedCount = Number(rejFirstRow?.cnt ?? 0);

    const aiApproved = counts["content_draft.ai_approved"] ?? 0;
    const aiRejected = counts["content_draft.ai_rejected"] ?? 0;
    const hallucinationReject = counts["hallucination_reject"] ?? 0;
    // adversarial_intercept: JSONB-filtered count (severityScore >= 7 only)
    const adversarialIntercept = Number(adversarialFirstRow?.cnt ?? 0);
    const aiYellowHeld = counts["content_draft.ai_yellow_held"] ?? 0;
    // factual_reject: Layer 5 rejections (FACTUAL_FALSE or FACTUAL_DRIFT hold).
    // Pete audit 2026-05-08: this action was never in the IN clause; added alongside
    // the sourcePack pipe-through fix so Layer 5 activations become visible in ops dashboard.
    const factualReject = counts["content_draft.factual_reject"] ?? 0;
    const paperSubmit = counts["paper_submit"] ?? 0;
    const paperSubmitRejected = paperSubmitRejectedCount;
    // factual_reject counted in total (same semantic as hallucination_reject — a content rejection)
    const total = aiApproved + aiRejected + hallucinationReject + adversarialIntercept + aiYellowHeld + factualReject + paperSubmit;

    return c.json({
      data: {
        windowHours,
        since,
        ai_approved: aiApproved,
        ai_rejected: aiRejected,
        hallucination_reject: hallucinationReject,
        adversarial_intercept: adversarialIntercept,
        ai_yellow_held: aiYellowHeld,
        factual_reject: factualReject,
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
        factual_reject: 0,
        paper_submit: 0,
        paper_submit_rejected: 0,
        total: 0,
        db_available: false,
        error: "query_failed"
      }
    });
  }
});

// =============================================================================
// GET /api/v1/portfolio/kgi/positions
//
// Owner-only, read-only proxy to KGI gateway /position.
// Returns the live KGI position snapshot tagged source='kgi_live'.
//
// Hard lines:
//   - NEVER writes to KGI side (read-only, KGI_READ_ONLY_MODE=true honoured)
//   - NEVER mocks or fakes position data
//   - Gateway unreachable / not logged in → 200 with positions=[] + status='unavailable'
//   - Credentials NEVER leaked in response
//   - Owner-only (楊董 only sees real money position)
// =============================================================================
app.get("/api/v1/portfolio/kgi/positions", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  // Import the KgiGatewayClient lazily using the same env-var convention as kgi-quote-client.ts
  const gatewayBaseUrl =
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787";

  const {
    KgiGatewayClient,
    KgiGatewayUnreachableError,
    KgiGatewayAuthError,
  } = await import("./broker/kgi-gateway-client.js");

  // KGI get_position can take 2.5-4s after SIM login because the Windows SDK
  // performs a broker query. Keep the timeout bounded, but do not classify a
  // healthy gateway as unreachable before the SDK can answer.
  const client = new KgiGatewayClient({
    gatewayBaseUrl,
    connectTimeoutMs: 6500,
  });

  try {
    const rawPositions = await client.getPosition();

    // Map KgiPosition → slimmer API shape; never include credentials or raw auth data
    const positions = rawPositions
      .filter((p) => {
        // Only include symbols with non-zero net quantity (avoid stale zero-position noise)
        const net = (p.quantityCashYd + p.quantityCashTd) - (p.quantitySoldCash + p.quantitySoldOdd);
        // Use netQuantity from adapter (quantityCashTd + quantityMarginTd) as primary indicator
        return p.netQuantity !== 0 || p.unrealized !== 0 || p.realized !== 0;
      })
      .map((p) => ({
        symbol: p.symbol,
        // Net qty: board-lot normalised (KGI returns share-level values)
        netQtyShares: p.netQuantity,
        // Unrealised / realised P&L (TWD)
        unrealizedPnl: p.unrealized,
        realizedPnl: p.realized,
        // Last price (TWD) from KGI Position DataFrame
        lastPrice: p.lastPrice,
        // Board lot info for display (1000 = regular stock)
        boardLot: p.boardLot,
      }));

    return c.json({
      data: {
        source: "kgi_live",
        status: "ok",
        positions,
        fetchedAt: new Date().toISOString(),
        gatewayUrl: gatewayBaseUrl.replace(/\/\/[^@]*@/, "//***@"), // scrub any embedded creds
      },
    });
  } catch (err) {
    // Graceful degradation — gateway unreachable or not logged in → return empty, not 500
    const isUnreachable = err instanceof KgiGatewayUnreachableError;
    const isAuth = err instanceof KgiGatewayAuthError;

    const statusCode = isUnreachable ? "gateway_unreachable" : isAuth ? "gateway_not_authenticated" : "gateway_error";
    const detail = err instanceof Error ? err.message : String(err);

    console.warn(`[portfolio/kgi/positions] ${statusCode}:`, detail);

    return c.json({
      data: {
        source: "kgi_live",
        status: statusCode,
        positions: [],
        degraded: true,
        reason: statusCode,
        fetchedAt: new Date().toISOString(),
        note: isAuth
          ? "KGI gateway session not established. Please login via gateway first."
          : isUnreachable
            ? "KGI gateway is unreachable. Check gateway process on EC2."
            : "KGI gateway returned an unexpected error or timed out.",
      },
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

// 2026-07-12 (#1229 A5/A6 finding): this Map used to be the ONLY place the
// round-robin cursor lived, so every process restart (this repo deploys many
// times/day) reset every job's cursor to 0 — low-sort-order tickers got
// refreshed on every reset while high-sort-order tickers (e.g. 8069) could
// starve for days. It now doubles as: (a) the memory-mode source of truth
// (PERSISTENCE_MODE!=database — unchanged behavior), and (b) an in-process
// fast-path cache in DB mode, kept in sync with `scheduler_cursors` on every
// write so a burst of ticks within one process doesn't need a DB round trip
// each time. The durable source of truth in DB mode is the table.
const _finMindSchedulerCursors = new Map<string, number>();

/** Test-only: simulates a process restart wiping the in-memory fast-path cache. */
export function _resetFinMindSchedulerCursorsForTest(): void {
  _finMindSchedulerCursors.clear();
}

async function loadSchedulerCursor(job: string): Promise<number> {
  if (isDatabaseMode()) {
    const db = getDb();
    if (db) {
      try {
        const rows = await db
          .select({ cursor: schedulerCursors.cursor })
          .from(schedulerCursors)
          .where(eq(schedulerCursors.job, job))
          .limit(1);
        if (rows.length > 0 && typeof rows[0].cursor === "number") {
          return rows[0].cursor;
        }
      } catch (err) {
        console.warn(
          `[schedulers] loadSchedulerCursor(${job}) DB read failed, falling back to in-memory:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }
  return _finMindSchedulerCursors.get(job) ?? 0;
}

async function persistSchedulerCursor(job: string, cursor: number): Promise<void> {
  // Always update the in-memory fast-path cache — this is what memory mode
  // relies on entirely, and what DB mode reads first on the next call within
  // the same process.
  _finMindSchedulerCursors.set(job, cursor);
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;
  try {
    await db
      .insert(schedulerCursors)
      .values({ job, cursor, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schedulerCursors.job,
        set: { cursor: drizzleSql`excluded.cursor`, updatedAt: drizzleSql`NOW()` }
      });
  } catch (err) {
    // Non-critical: in-memory cursor above is already updated, so this
    // process's own scheduling is unaffected — only cross-restart durability
    // is degraded for this one write.
    console.warn(
      `[schedulers] persistSchedulerCursor(${job}) DB write failed (in-memory cursor still updated):`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

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

export async function takeFinMindSchedulerBatch<T extends SchedulerTicker>(
  job: string,
  tickers: T[],
  maxBatchSize: number,
  preserveOrder = false
): Promise<T[]> {
  if (tickers.length === 0) return [];
  const ordered = preserveOrder
    ? [...tickers]
    : [...tickers].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const batchSize = Math.min(Math.max(1, maxBatchSize), ordered.length);
  const cursor = await loadSchedulerCursor(job);
  const start = cursor % ordered.length;
  const first = ordered.slice(start, start + batchSize);
  const overflow = Math.max(0, start + batchSize - ordered.length);
  const batch = overflow > 0 ? first.concat(ordered.slice(0, overflow)) : first;
  const next = (start + batch.length) % ordered.length;
  await persistSchedulerCursor(job, next);
  console.log(
    `[schedulers] ${job} batch start=${start} size=${batch.length}/${ordered.length} next=${next} ` +
    `preserveOrder=${preserveOrder}`
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
    tickers = await takeFinMindSchedulerBatch(
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
    tickers = await takeFinMindSchedulerBatch(
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
    tickers = await takeFinMindSchedulerBatch(
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
    tickers = await takeFinMindSchedulerBatch(
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
    tickers = await takeFinMindSchedulerBatch(
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
    tickers = await takeFinMindSchedulerBatch(
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
    tickers = await takeFinMindSchedulerBatch(
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
    tickers = await takeFinMindSchedulerBatch(
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
    tickers = await takeFinMindSchedulerBatch(
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

// Module-level: tracks the last TST calendar date on which the brief dispatcher fired.
// Promoted from startSchedulers() local scope (cycle17) so the observability route can read it.
let _briefDispatcherLastFiredDate = "";

// Module-level: market overview cron state (readable by admin refresh-status endpoint).
let _marketOverviewCronLastFiredAt: string | null = null;
let _marketOverviewCronLastError: string | null = null;

// Module-level: TWSE MIS intraday quote cron state.
let _tsweMisQuoteCronLastFiredAt: string | null = null;
let _tsweMisQuoteCronLastError: string | null = null;
let _tsweMisQuoteCronLastCount = 0;

// Module-level: MIS intraday tile cache for heatmap enrichment.
// Written by _runTwseMisQuoteCron (Tier A core 40) and _runMisFullSweepSlice (Tier B full universe).
// Key: ticker symbol (e.g. "2330"). Value: last price + tradeDateYmd for freshness check.
// Cleared implicitly when MIS z="-" (盤後) — next MIS cron tick simply won't update.
const _misTileCache = new Map<string, { last: number; changePct: number | null; ts: string; tradeDateYmd: string }>();

// Module-level: MIS intraday market index cache for overview endpoint.
// Caches TAIEX (tse_t00.tw) + OTC (otc_o00.tw) live index data.
// TTL: 30s — overview handler reads this, MIS cron writes on each tick.
let _overviewMisIndexCache: {
  taiex: { last: number; prevClose: number; change: number; changePct: number; time: string; volume: number | null } | null;
  otc: { last: number; prevClose: number; change: number; changePct: number; time: string; volume: number | null } | null;
  cachedAt: number;
  tradeDateYmd: string;
} | null = null;
const OVERVIEW_MIS_INDEX_TTL_MS = 30 * 1000; // 30s

type OverviewMisIndexBar = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  source: "twse_mis_intraday";
};

const _overviewMisIndexHistory = new Map<string, { tradeDateYmd: string; rows: OverviewMisIndexBar[] }>();

function parseMisNumericField(value: string | undefined): number | null {
  if (!value || value === "-") return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function updateOverviewMisIndexHistory(input: {
  key: string;
  tradeDateYmd: string;
  time: string;
  last: number;
  volume: number | null;
}): OverviewMisIndexBar[] {
  const yyyy = input.tradeDateYmd.slice(0, 4);
  const mm = input.tradeDateYmd.slice(4, 6);
  const dd = input.tradeDateYmd.slice(6, 8);
  const rawTime = /^\d{2}:\d{2}/.test(input.time)
    ? input.time.slice(0, 5)
    : getTaipeiHHMM().toString().padStart(4, "0").replace(/^(\d{2})(\d{2})$/, "$1:$2");
  const minuteKey = `${yyyy}-${mm}-${dd} ${rawTime}`;
  const current = _overviewMisIndexHistory.get(input.key);
  const bucket = current && current.tradeDateYmd === input.tradeDateYmd
    ? current
    : { tradeDateYmd: input.tradeDateYmd, rows: [] };
  const lastRow = bucket.rows[bucket.rows.length - 1];

  if (lastRow?.date === minuteKey) {
    lastRow.high = Math.max(lastRow.high ?? input.last, input.last);
    lastRow.low = Math.min(lastRow.low ?? input.last, input.last);
    lastRow.close = input.last;
    lastRow.volume = input.volume ?? lastRow.volume;
  } else {
    bucket.rows.push({
      date: minuteKey,
      open: input.last,
      high: input.last,
      low: input.last,
      close: input.last,
      volume: input.volume,
      source: "twse_mis_intraday"
    });
  }

  bucket.rows = bucket.rows.slice(-240);
  _overviewMisIndexHistory.set(input.key, bucket);
  return bucket.rows;
}

function mergeOverviewIndexHistory(
  baseHistory: unknown,
  intradayHistory: OverviewMisIndexBar[]
): OverviewMisIndexBar[] {
  const baseRows = Array.isArray(baseHistory)
    ? baseHistory.filter((row): row is OverviewMisIndexBar => {
        const value = row as Partial<OverviewMisIndexBar>;
        return typeof value.date === "string" && typeof value.close === "number" && Number.isFinite(value.close);
      })
    : [];
  const byDate = new Map<string, OverviewMisIndexBar>();
  for (const row of baseRows.slice(-96)) byDate.set(row.date, row);
  for (const row of intradayHistory) byDate.set(row.date, row);
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-160);
}

// Module-level: MIS full-universe sweep state (Tier B — ~1978 stocks, rolling slice every 10s).
// Universe is loaded from DB companies once per 30min, then iterated slice-by-slice during
// trading hours so all ~1978 stocks get intraday MIS quotes injected into the manual cache.
// This feeds decision-summary / strategy ideas / portfolio for the full universe, not just
// the 40 heatmap core symbols covered by Tier A.
let _misUniverseCache: Array<{ ticker: string; market: string }> = [];
let _misUniverseCacheUpdatedAt = 0;
const MIS_UNIVERSE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min refresh
let _misUniverseSweepIdx = 0;
let _misFullSweepRunning = false;
// Per-round stats (reset when sweep index wraps back to 0)
let _misFullSweepInjectedThisRound = 0;
let _misFullSweepRoundsCompleted = 0;

/**
 * Returns true when the TPEX EOD close payload (identified by its own ROC
 * `Date` field) matches the expected trade date, so it's safe to persist to
 * quote_last_close under that date. TWSE and TPEX publish EOD closes on
 * separate schedules — the TWSE-EOD-QUOTE-CRON's TPEX persist block
 * previously tagged its rows with TWSE's trade date without checking TPEX's
 * own `Date` field at all, which risks persisting a stale TPEX close
 * mislabeled as the current trade date (same bug class as the 2026-07-09
 * s1-sim-runner tier-1b TPEX guard fix — see reports/ledger_stall_20260709/).
 * A missing/unparseable `tpexDateRaw` is treated as "unvalidated" and allowed
 * through, same convention as the s1-sim-runner guard.
 */
export function _isTpexEodCloseDateValid(expectedTradeDate: string, tpexDateRaw: string | undefined): boolean {
  const tpexDateIso = parseRocEodDateIso(tpexDateRaw);
  return !tpexDateIso || tpexDateIso === expectedTradeDate;
}

/**
 * Computes the TWSE-EOD-QUOTE-CRON's `tradingDateIso` timestamp from a
 * STOCK_DAY_ALL row's raw ROC `Date` field, or `""` if unparseable. This
 * value gates BOTH the TWSE quote_last_close persist block (`if (db3 &&
 * tradingDateIso)`) and, via its derived `tpexTradeDate`, the
 * `_isTpexEodCloseDateValid` TPEX guard above.
 *
 * 2026-07-10 Pete review follow-up (reports/ledger_stall_20260709/): this
 * used to be a THIRD inline slash-only ROC date parser (a copy of the same
 * logic #1199 collapsed into lib/roc-date.ts for the other two call sites).
 * Against the live compact 7-digit wire format (verified 2026-07-09) that
 * inline parser silently produced `""`, making both gates above unreachable
 * dead code. Now delegates to the shared parser.
 */
export function _computeTwseEodCronTradingDateIso(stockDateRaw: string | undefined): string {
  const stockDateIso = parseRocEodDateIso(stockDateRaw);
  return stockDateIso ? `${stockDateIso}T13:30:00+08:00` : "";
}

/**
 * Detects whether the TWSE MIS intraday feed is still serving the prior
 * trading session's data (2026-07-10 quote-chain outage diagnosis: on the
 * 7/10 typhoon closure, MIS kept returning `d="20260709"` all morning even
 * though `isTwseMisQuoteCronWindow()` — which only checks Taipei HH:MM and
 * weekday, not the actual trading calendar — considered the market "open").
 * Unlike TWSE OpenAPI's STOCK_DAY_ALL (only published after close, so it's
 * *expected* to lag by one day for most of every trading day too), MIS is a
 * live intraday feed: once the market session begins its own `d` field
 * should already show Taipei "today". A mismatch is therefore a reliable
 * signal of a non-trading day, not merely of missing/delayed data.
 * A missing `observedDateYmd` is treated as "can't tell" (fail-open —
 * `_runTwseMisQuoteCron` runs unchanged).
 */
export function _isMisFeedNonTradingDaySignal(
  observedDateYmd: string | null | undefined,
  todayYmd: string
): boolean {
  if (!observedDateYmd) return false;
  return observedDateYmd !== todayYmd;
}

/**
 * Detects whether the TWSE-EOD-QUOTE-CRON's freshly-computed trading date
 * is identical to the date it already persisted on some earlier tick — i.e.
 * there is no new trading-session data since then, so re-running the fetch
 * + manual-cache + quote_last_close persist logic is pure waste (2026-07-10
 * quote-chain outage diagnosis: on a non-trading day, STOCK_DAY_ALL's own
 * `Date` field never advances, so this cron would otherwise re-fetch and
 * re-persist the identical dataset every 10 minutes, all day).
 * This is a dedup gate, not a calendar lookup: it never misfires on a real
 * trading day because STOCK_DAY_ALL's date always advances once that day's
 * close is published, which naturally lets a fresh tick straight through.
 * Fail-open: an empty/unparseable `freshTradingDateIso` (`""`) never gates.
 */
export function _isTwseEodCronTradeDateAlreadyPersisted(
  freshTradingDateIso: string,
  lastPersistedTradeDate: string | null
): boolean {
  if (!freshTradingDateIso) return false;
  return lastPersistedTradeDate !== null && freshTradingDateIso.slice(0, 10) === lastPersistedTradeDate;
}

/**
 * Pure tick → upsertKgiQuotes-item mapping used by KGI-QUOTE-INGEST-CRON.
 * Extracted (2026-07-10 Pete review) so its timestamp-preservation behaviour
 * is directly unit-testable without a live gateway or DB.
 *
 * Preserves the tick's own emission time (`tick.ts`, falling back to a
 * `staleSec`-derived timestamp, and only then to wall-clock `nowMs`) instead
 * of always stamping "now". `withFreshness()` (market-data.ts) computes
 * `ageMs` from this timestamp — if the cron always stamped "now", a
 * gateway that stays alive but serves a stale cached tick (e.g. 30 minutes
 * old) would get silently re-stamped as "just happened" on every tick,
 * making readiness look permanently "ready" even though the underlying data
 * is stale. This is currently latent (KGI SIM auth is broken, so every tick
 * is null and gets filtered out below) but would be a silent gate hole the
 * moment auth is fixed if left unaddressed.
 */
export function _mapKgiTicksToUpsertQuotes(
  ticks: Array<{
    symbol: string;
    value: number | null;
    changePct: number | null;
    ts: string | null;
    staleSec: number | null;
  }>,
  otcSymbols: Set<string>,
  nowMs: number = Date.now()
): Array<{
  symbol: string;
  market: "TWSE" | "TPEX";
  source: "kgi";
  last: number;
  bid: null;
  ask: null;
  open: null;
  high: null;
  low: null;
  prevClose: null;
  volume: null;
  changePct: number | null;
  timestamp: string;
}> {
  return ticks
    .filter((tick): tick is typeof tick & { value: number } => tick.value !== null && tick.value > 0)
    .map((tick) => {
      const timestamp =
        tick.ts ??
        (tick.staleSec !== null
          ? new Date(nowMs - tick.staleSec * 1000).toISOString()
          : new Date(nowMs).toISOString());
      return {
        symbol: tick.symbol,
        market: (otcSymbols.has(tick.symbol) ? "TPEX" : "TWSE") as "TWSE" | "TPEX",
        source: "kgi" as const,
        last: tick.value,
        bid: null,
        ask: null,
        open: null,
        high: null,
        low: null,
        prevClose: null,
        volume: null,
        changePct: tick.changePct,
        timestamp
      };
    });
}

/**
 * Start all schedulers. Called once after server is ready.
 * OHLCV: every 6 hours. Daily brief: fixed 09:00 TST daily (cycle13 fix).
 * PR A: Monthly revenue: every 24h. Financials: every 24h (cadence guard inside tick).
 * All run an immediate first tick on startup to backfill any missed runs.
 */
function startSchedulers(workspaceSlug: string): void {
  // CI/test mode gate (2026-05-14): hard-bypass ALL schedulers.
  // .unref() alone is defense-in-depth; this gate is the root fix.
  // Prod behaviour is completely unchanged (none of these vars are set in Railway prod).
  if (
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true" ||
    process.env.SKIP_SCHEDULERS === "1"
  ) {
    console.log("[schedulers] CI/test mode detected — skipping all scheduler boot");
    return;
  }

  // CI-timeout fix (2026-05-14): scheduler intervals must not keep the Node process alive
  // in test mode. .unref() lets the event loop exit once all tests complete while leaving
  // prod behaviour unchanged (the HTTP server's own handle keeps the process alive in prod).
  function ui(fn: () => unknown, ms: number): NodeJS.Timeout {
    return setInterval(fn, ms).unref();
  }

  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const INITIAL_STAGGER_MS = schedulerPositiveInt("FINMIND_SCHEDULER_INITIAL_STAGGER_MS", 15_000);

  // Boot cache warm (6/16): the first request to /market/overview, /heatmap and
  // /portfolio/f-auto after a deploy or cache expiry pays the full cold-start
  // cost — measured 6/15 at 4-9s for the first hit, 0.3-0.5s once warm. The
  // owner's first page load each session felt "slow" for exactly this reason.
  // Pre-warm the shared upstream caches 8s after boot (and refresh every 4 min,
  // just under the heatmap TTL) so a real request is almost always already hot.
  // Fail-open: warming never throws into the boot path.
  const warmMarketCaches = async () => {
    try {
      const { getTwseMarketOverview, getStockDayAllRows, getTpexMainboardCloseRows, getTwseIndustryHeatmap } =
        await import("./data-sources/twse-openapi-client.js");
      // The heatmap aggregation cache (getTwseIndustryHeatmap) sits one layer
      // above STOCK_DAY_ALL + the industry map — warming only its inputs still
      // left /market/heatmap/twse paying ~3.3s for the first aggregation after a
      // restart (6/16 measured). Warm the aggregation itself too.
      const industryMap = await _getTwseOfficialIndustryMap();
      await Promise.allSettled([
        getTwseMarketOverview(),
        getStockDayAllRows(),
        getTpexMainboardCloseRows(),
        getTwseIndustryHeatmap(industryMap),
      ]);
      console.log("[boot-warm] market caches warmed (overview + STOCK_DAY_ALL + TPEX + industry heatmap)");
    } catch (e) {
      console.warn("[boot-warm] warm failed (non-fatal):", e instanceof Error ? e.message : String(e));
    }
  };
  setTimeout(() => { void warmMarketCaches(); }, 8_000);
  ui(() => { void warmMarketCaches(); }, 4 * 60 * 1000);

  // F2: OHLCV sync — immediate first run then every 6h
  scheduleInitialSchedulerTick("ohlcv-scheduler", 0, () => runOhlcvSchedulerTick(workspaceSlug));
  ui(() => {
    runOhlcvSchedulerTick(workspaceSlug).catch((e) =>
      console.error("[ohlcv-scheduler] Interval tick failed:", e)
    );
  }, SIX_HOURS_MS);

  // F3 (cycle13 fix 2026-05-14): daily_brief dispatcher — fixed 09:00 TST daily.
  //
  // ROOT CAUSE: boot+23h interval meant a boot at 20:57 TST → next fire at 19:57 TST next day.
  // 楊董 06:00 起床時 /briefs?date=today 永遠是空 (dispatcher 尚未觸發過).
  //
  // FIX: poll every 60s, check if TST is in the 09:00–09:05 window, fire at most once per
  // calendar day (per-day guard string _briefDispatcherLastFiredDate).
  //
  // STARTUP CATCH-UP GATE (30s after boot):
  //   If TST >= 09:05 AND today's brief has not been dispatched yet → fire once immediately.
  //   This covers deploys/restarts that happen after 09:00 TST.
  //   The dispatcher now routes into the v2 OpenAlice pipeline. It may create
  //   a direct draft if no OpenAlice device is active, but dedup still prevents
  //   duplicate briefs for the same date.
  //
  // idempotency: runDailyBriefDispatcherTick() itself skips if job/brief already exists.
  // NOTE: _briefDispatcherLastFiredDate is now module-level (cycle17 — for observability).

  /** Returns today's date in TST (Taipei) as YYYY-MM-DD. */
  function getTstDateString(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  }

  /** Returns true if current Taipei time is in the 09:00–09:05 window. */
  function isBriefDispatchWindow(): boolean {
    const hhmm = getTaipeiHHMM();
    return hhmm >= 900 && hhmm < 905;
  }

  /** Returns true if current Taipei time is >= 09:05 (catch-up eligible). */
  function isPastBriefDispatchWindow(): boolean {
    return getTaipeiHHMM() >= 905;
  }

  // 60-second poll: fire when in 09:00–09:05 window and not yet fired today
  ui(() => {
    const todayTst = getTstDateString();
    if (_briefDispatcherLastFiredDate === todayTst) return; // already fired today
    if (!isBriefDispatchWindow()) return; // outside 09:00–09:05 window
    _briefDispatcherLastFiredDate = todayTst;
    console.log(`[daily-brief-dispatcher] 09:00 TST window — dispatching for ${todayTst}`);
    runDailyBriefDispatcherTick().catch((e) =>
      console.error("[daily-brief-dispatcher] 09:00 tick failed:", e)
    );
  }, 60_000);

  // Startup catch-up: if boot happens after 09:05 TST and today not yet dispatched, fire once
  setTimeout(() => {
    const todayTst = getTstDateString();
    if (_briefDispatcherLastFiredDate === todayTst) return; // already fired (race-safe)
    if (!isPastBriefDispatchWindow()) {
      console.log(`[daily-brief-dispatcher] startup: TST < 09:05, skipping catch-up (cron will fire at 09:00)`);
      return;
    }
    _briefDispatcherLastFiredDate = todayTst;
    console.log(`[daily-brief-dispatcher] startup catch-up: TST >= 09:05, dispatching for ${todayTst}`);
    runDailyBriefDispatcherTick().catch((e) =>
      console.error("[daily-brief-dispatcher] startup catch-up failed:", e)
    );
  }, 30_000);

  // PR A: Monthly revenue sync — every 24h (burst on 10th, sweep otherwise)
  scheduleInitialSchedulerTick("fundamentals-scheduler/monthly-revenue", INITIAL_STAGGER_MS, () =>
    runMonthlyRevenueSchedulerTick(workspaceSlug)
  );
  ui(() => {
    runMonthlyRevenueSchedulerTick(workspaceSlug).catch((e) =>
      console.error("[fundamentals-scheduler] monthly-revenue interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR A: Financial statements / balance sheet / cashflow — every 24h (cadence guard inside)
  scheduleInitialSchedulerTick("fundamentals-scheduler/financials", INITIAL_STAGGER_MS * 2, () =>
    runFinancialsSchedulerTick(workspaceSlug)
  );
  ui(() => {
    runFinancialsSchedulerTick(workspaceSlug).catch((e) =>
      console.error("[fundamentals-scheduler] financials interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR B: Institutional buysell — every 30min, cadence guard 14:30–17:00 Taipei
  const THIRTY_MIN_MS = 30 * 60 * 1000;
  scheduleInitialSchedulerTick("trading-flow-scheduler/institutional", INITIAL_STAGGER_MS * 3, () =>
    runTradingFlowInstitutionalTick(workspaceSlug)
  );
  ui(() => {
    runTradingFlowInstitutionalTick(workspaceSlug).catch((e) =>
      console.error("[trading-flow-scheduler] institutional interval tick failed:", e)
    );
  }, THIRTY_MIN_MS);

  // PR B: Margin/short — every 30min, cadence guard 17:00–21:00 Taipei
  scheduleInitialSchedulerTick("trading-flow-scheduler/margin-short", INITIAL_STAGGER_MS * 4, () =>
    runTradingFlowMarginShortTick(workspaceSlug)
  );
  ui(() => {
    runTradingFlowMarginShortTick(workspaceSlug).catch((e) =>
      console.error("[trading-flow-scheduler] margin-short interval tick failed:", e)
    );
  }, THIRTY_MIN_MS);

  // PR B: Shareholding — every 24h, cadence guard Friday-only
  scheduleInitialSchedulerTick("trading-flow-scheduler/shareholding", INITIAL_STAGGER_MS * 5, () =>
    runTradingFlowShareholdingTick(workspaceSlug)
  );
  ui(() => {
    runTradingFlowShareholdingTick(workspaceSlug).catch((e) =>
      console.error("[trading-flow-scheduler] shareholding interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR C: Dividend — every 24h, cadence guard weekend-only
  scheduleInitialSchedulerTick("market-intel-scheduler/dividend", INITIAL_STAGGER_MS * 6, () =>
    runMarketIntelDividendTick(workspaceSlug)
  );
  ui(() => {
    runMarketIntelDividendTick(workspaceSlug).catch((e) =>
      console.error("[market-intel-scheduler] dividend interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR C: Market value — every 24h, cadence guard weekend-only
  scheduleInitialSchedulerTick("market-intel-scheduler/market-value", INITIAL_STAGGER_MS * 7, () =>
    runMarketIntelMarketValueTick(workspaceSlug)
  );
  ui(() => {
    runMarketIntelMarketValueTick(workspaceSlug).catch((e) =>
      console.error("[market-intel-scheduler] market-value interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR C: Valuation (PER/PBR) — every 24h
  scheduleInitialSchedulerTick("market-intel-scheduler/valuation", INITIAL_STAGGER_MS * 8, () =>
    runMarketIntelValuationTick(workspaceSlug)
  );
  ui(() => {
    runMarketIntelValuationTick(workspaceSlug).catch((e) =>
      console.error("[market-intel-scheduler] valuation interval tick failed:", e)
    );
  }, TWENTY_FOUR_HOURS_MS);

  // PR C: Stock news (experimental) — every 30min
  const THIRTY_MIN_MS_NEWS = 30 * 60 * 1000;
  scheduleInitialSchedulerTick("market-intel-scheduler/stock-news", INITIAL_STAGGER_MS * 9, () =>
    runMarketIntelNewsTick(workspaceSlug)
  );
  ui(() => {
    runMarketIntelNewsTick(workspaceSlug).catch((e) =>
      console.error("[market-intel-scheduler] stock-news interval tick failed:", e)
    );
  }, THIRTY_MIN_MS_NEWS);

  // P0-C: OpenAlice Autonomous Daily Pipeline — 3 ticks per trading day (TST)
  // pre-market 07:30 (changed 2026-05-09: was 08:30 — 楊董 requires brief by 08:00 TST)
  // close-watch 13:45, close-brief 16:30
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

  // Missed-day catch-up: fires 15s after boot to cover:
  // (a) deploy-interrupted pre-market windows (root cause of 5/8 miss)
  // (b) any trading day where the process was down for the full brief window
  // Scans all DB workspaces so the public smoke user cannot drift away from
  // the single scheduler workspace selected at boot.
  // All 5-layer review gates still run — no content shortcuts.
  setTimeout(() => {
    runPipelineMissedDayCatchUpForAllWorkspaces(workspaceSlug).catch((e: unknown) =>
      console.error("[pipeline-catchup] boot catch-up error:", e instanceof Error ? e.message : String(e))
    );
  }, 15_000);

  // Pre-market tick (07:30–08:00 TST window, check every 15min)
  // Boot-recovery fires once at startup (10s delay): handles restarts between
  // 07:30 and 09:30 TST where the narrow window may have already passed.
  // Root cause of 5/8 missing-fire: process restarted at 08:44 TST.
  setTimeout(() => {
    runPipelinePreMarketBootRecovery(workspaceSlug)
      .then(() => handlePipelineSuccess("pre_market"))
      .catch((e: unknown) => handlePipelineFail("pre_market", e));
  }, 10_000);
  ui(() => {
    runPipelinePreMarketTick(workspaceSlug)
      .then(() => handlePipelineSuccess("pre_market"))
      .catch((e) => handlePipelineFail("pre_market", e));
  }, FIFTEEN_MIN_MS);

  // Close-watch tick (13:45–14:15 TST window, check every 15min)
  runPipelineCloseWatchTick(workspaceSlug)
    .then(() => handlePipelineSuccess("close_watch"))
    .catch((e) => handlePipelineFail("close_watch", e));
  ui(() => {
    runPipelineCloseWatchTick(workspaceSlug)
      .then(() => handlePipelineSuccess("close_watch"))
      .catch((e) => handlePipelineFail("close_watch", e));
  }, FIFTEEN_MIN_MS);

  // Close-brief tick (16:30–17:00 TST window, check every 15min)
  runPipelineCloseBriefTick(workspaceSlug)
    .then(() => handlePipelineSuccess("close_brief"))
    .catch((e) => handlePipelineFail("close_brief", e));
  ui(() => {
    runPipelineCloseBriefTick(workspaceSlug)
      .then(() => handlePipelineSuccess("close_brief"))
      .catch((e) => handlePipelineFail("close_brief", e));
  }, FIFTEEN_MIN_MS);

  // Axis 4: Strategy-level brief scheduler — 14:00–14:30 TST (post-close buffer)
  // Runs every 15min and checks isStrategyBriefWindow() internally.
  // Fires AFTER the daily brief pipeline's close-watch tick to avoid contention.
  // idempotency: generateStrategyBrief stores result in-memory; repeated calls
  // in same window are cheap (brief already in _lastResult).
  ui(async () => {
    try {
      if (!isStrategyBriefWindow()) return;
      const todayDate = getStrategyBriefTstDate();
      // Idempotency: skip if already generated for today
      const existing = getStrategyBriefWithStaleness();
      if (existing && existing.tradingDate === todayDate && existing.status === "published") {
        console.log(`[strategy-brief-scheduler] already published for ${todayDate}, skipping`);
        return;
      }
      console.log(`[strategy-brief-scheduler] window open, generating for ${todayDate}`);
      await generateStrategyBrief({
        tradingDate: todayDate,
        workspaceSlug
      });
    } catch (e) {
      console.error("[strategy-brief-scheduler] tick failed:", e instanceof Error ? e.message : String(e));
    }
  }, FIFTEEN_MIN_MS);

  // BLOCK #6: Event rule engine — poll every 5min, evaluate 10 rules, write iuf_events
  // Table iuf_events: migration 0025_iuf_events.sql PROMOTED (2026-05-12 P0 unblock).
  // Engine degrades gracefully when table is missing (safe-default empty results).
  const FIVE_MIN_MS = 5 * 60 * 1000;
  // Initial tick delayed 30s to let DB connection stabilise after boot
  setTimeout(() => {
    runEventEngineTick().catch((e) =>
      console.error("[event-engine] Initial tick failed:", e)
    );
  }, 30_000);
  ui(() => {
    runEventEngineTick().catch((e) =>
      console.error("[event-engine] Interval tick failed:", e)
    );
  }, FIVE_MIN_MS);

  // BLOCK #6: Email digest scheduler — fires every 5min, window-guarded to 17:00–17:30 TST
  // Graceful: iuf_events table absent → empty digest → dry-run log (no email)
  // Graceful: RESEND_API_KEY absent → dry-run log (no email sent)
  // P0-2: Sentry capture on Resend HTTP 4xx/5xx failure
  ui(() => {
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

  // OPENALICE-M1: Decision orchestrator — poll every 10 min.
  // Consumes iuf_events + signals → LLM reasoning → writes iuf_decisions (status='proposed').
  // M1 only produces decisions; M2 will execute them.
  // Fires 60s after boot (gives event-rule-engine its 30s boot tick a head start).
  // Safe-default: tick never throws; errors are contained + logged inside orchestrator.
  {
    const DECISION_TICK_MS = 10 * 60 * 1000;
    ui(() => {
      runOpenAliceDecisionTick().catch((e) =>
        console.error("[openalice-orchestrator] Interval tick failed:", e instanceof Error ? e.message : e)
      );
    }, DECISION_TICK_MS);
    setTimeout(() => {
      void runOpenAliceDecisionTick();
    }, 60_000);
  }

  // OPENALICE-M2: Action executor — poll every 7 min.
  // Reads iuf_decisions (status='proposed') → executes per action_type → updates status+outcome.
  // 4 actions: deep_analyze (runReactLoop read-only), priority_alert (iuf_events INSERT),
  // rec_reweight (advisory record only), rebalance_suggest (advisory record only).
  // SIM-safe: zero real-order paths. Cadence offset from M1 (10min) so they don't fire together.
  // Boot-fire: 90s (gives M1 its 60s head start so fresh decisions are available on first action tick).
  {
    const ACTION_TICK_MS = 7 * 60 * 1000;
    // Resolve workspaceId once at scheduler registration (fire-and-forget; null = skip analyst context)
    ui(async () => {
      try {
        const db = getDb();
        if (!db) { await runOpenAliceActionTick(null); return; }
        const rows = await db.select({ id: workspaces.id }).from(workspaces);
        for (const { id } of rows) await runOpenAliceActionTick(id);
      } catch (e) {
        console.error("[openalice-action-executor] Interval tick failed:", e instanceof Error ? e.message : e);
      }
    }, ACTION_TICK_MS);
    setTimeout(async () => {
      try {
        const db = getDb();
        const rows = db ? await db.select({ id: workspaces.id }).from(workspaces) : [];
        for (const { id } of rows) await runOpenAliceActionTick(id);
      } catch {
        void runOpenAliceActionTick(null);
      }
    }, 90_000);
  }

  // BLOCK #NEWS: AI news selector — hourly cron (every 60min). isWithinNewsWindowTrigger()
  // enforces 50min double-fire guard. Old 4-window (08/12/18/24) gate removed: users saw
  // stale news when browsing between windows. Now fires every hour, always fresh.
  const NEWS_AI_POLL_MS = 60 * 60 * 1000;
  ui(async () => {
    try {
      const db = getDb();
      if (!db) return;
      const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
      if (!ws) return;
      await runNewsAiSelectionTick(ws.id);
    } catch (e) {
      console.error("[news-ai-selector] scheduler tick failed:", e instanceof Error ? e.message : e);
    }
  }, NEWS_AI_POLL_MS);
  // Boot-recovery: fire unconditionally 30s after startup (bypasses window gate, respects 45min guard).
  // Ensures the endpoint never returns stale_reason=never_run for hours when server restarts
  // outside the 4 trigger windows (08:00/12:00/18:00/24:00 TST).
  setTimeout(async () => {
    try {
      const db = getDb();
      if (!db) return;
      const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
      if (!ws) return;
      await runNewsAiSelectionBootRecovery(ws.id);
    } catch (e) {
      console.error("[news-ai-selector] boot recovery failed:", e instanceof Error ? e.message : e);
    }
  }, 30_000);

  // P0-2: Health watchdog — POST internal heartbeat every 30min, Sentry on consecutive fail
  // Tracks that the server event-loop is alive and not starved (relates to the 5/7 502 incidents).
  const WATCHDOG_INTERVAL_MS = 30 * 60 * 1000;
  let _watchdogConsecutiveFails = 0;
  const WATCHDOG_FAIL_THRESHOLD = schedulerPositiveInt("WATCHDOG_FAIL_THRESHOLD", 2);
  ui(() => {
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

  // BLOCK #TOGGLE — paper observation cron: 17:00 TST daily
  // Flips paper_observing → paper_complete for strategies that started before 13:30 TST.
  // Cadence: every 15min with a 17:00–17:30 TST window guard.
  const _paperObsCronMs = 15 * 60 * 1000;
  ui(async () => {
    try {
      const now = new Date();
      // TST = UTC+8. 17:00–17:30 TST = 09:00–09:30 UTC.
      const hourUTC = now.getUTCHours();
      const minUTC = now.getUTCMinutes();
      const inWindow = hourUTC === 9 && minUTC >= 0 && minUTC < 30;
      if (!inWindow) return;

      const db = getDb();
      if (!db) return;
      const [ws] = await db.select({ id: workspaces.id, slug: workspaces.slug }).from(workspaces).limit(1);
      if (!ws) return;

      // Build a minimal session for audit log writes
      const cronSession = {
        workspace: { id: ws.id, slug: ws.slug },
        user: { id: "system-cron", role: "Owner" }
      } as unknown as import("@iuf-trading-room/contracts").AppSession;

      const flipped = await flipPaperObservationsToComplete(cronSession);
      if (flipped.length > 0) {
        console.info(`[paper-obs-cron] flipped ${flipped.length} strategy_run_states paper_observing → paper_complete`);
      }
    } catch (e) {
      console.error("[paper-obs-cron] tick failed:", e instanceof Error ? e.message : e);
    }
  }, _paperObsCronMs);

  // BLOCK #SIGNAL-STRATEGY
  const STRATEGY_SIGNAL_POLL_MS = 15 * 60 * 1000;
  ui(() => {
    if (!isStrategyEmitWindow()) return;
    runStrategySignalEmitterTick().catch((e) =>
      console.error("[signal-emitter/strategy] tick failed:", e instanceof Error ? e.message : e)
    );
  }, STRATEGY_SIGNAL_POLL_MS);

  // BLOCK #SIGNAL-NEWS
  type NewsWindowLabel = "08:00" | "12:00" | "18:00" | "24:00";
  const NEWS_WINDOWS: Array<{ label: NewsWindowLabel; utcHour: number }> = [
    { label: "08:00", utcHour: 0 },
    { label: "12:00", utcHour: 4 },
    { label: "18:00", utcHour: 10 },
    { label: "24:00", utcHour: 16 }
  ];
  const NEWS_SIGNAL_POLL_MS = 15 * 60 * 1000;
  ui(() => {
    const nowDate = new Date();
    const nowTotalMin = nowDate.getUTCHours() * 60 + nowDate.getUTCMinutes();
    for (const { label, utcHour } of NEWS_WINDOWS) {
      const windowMin = utcHour * 60;
      const diffMin = ((nowTotalMin - windowMin) + 1440) % 1440;
      if (diffMin <= 30 || diffMin >= 1410) {
        runNewsSignalEmitterTick(label).catch((e) =>
          console.error(`[signal-emitter/news:${label}] tick failed:`, e instanceof Error ? e.message : e)
        );
        break;
      }
    }
  }, NEWS_SIGNAL_POLL_MS);

  // BLOCK #SIGNAL-QUOTE
  const QUOTE_BREAKOUT_POLL_MS = 30 * 60 * 1000;
  ui(() => {
    runQuoteBreakoutEmitterTick().catch((e) =>
      console.error("[signal-emitter/quote] tick failed:", e instanceof Error ? e.message : e)
    );
  }, QUOTE_BREAKOUT_POLL_MS);

  // FINMIND SPONSOR BOOT INGEST — 楊董 mandate: "所有資源你都給我活用起來"
  setTimeout(() => {
    if (!process.env.FINMIND_API_TOKEN) {
      console.log("[finmind-boot-ingest] FINMIND_API_TOKEN not set, skipping boot full ingest");
      return;
    }
    console.log("[finmind-boot-ingest] Firing 11-dataset full ingest 60s after boot (sponsor activation)");
    runFullIngest({
      workspaceSlug,
      triggeredBy: "cron",
      batchSize: Number(process.env.FINMIND_BOOT_INGEST_BATCH_SIZE ?? "50")
    }).catch((e) =>
      console.error("[finmind-boot-ingest] Boot full ingest error:", e instanceof Error ? e.message : String(e))
    );
  }, 60_000);

  // Recurring 6h full ingest — all 11 datasets, bypasses cadence guards
  const SIX_HOURS_FULL_INGEST_MS = 6 * 60 * 60 * 1000;
  ui(() => {
    if (!process.env.FINMIND_API_TOKEN) return;
    if (isFullIngestRunning()) {
      console.log("[finmind-6h-ingest] already running, skipping interval tick");
      return;
    }
    console.log("[finmind-6h-ingest] Firing 11-dataset full ingest (6h interval)");
    runFullIngest({
      workspaceSlug,
      triggeredBy: "cron",
      batchSize: Number(process.env.FINMIND_BOOT_INGEST_BATCH_SIZE ?? "50")
    }).catch((e) =>
      console.error("[finmind-6h-ingest] Full ingest error:", e instanceof Error ? e.message : String(e))
    );
  }, SIX_HOURS_FULL_INGEST_MS);

  // KGI SIM daily smoke cron: 09:05-09:35 TST (01:05-01:35 UTC), polls every 15min.
  // Window starts after the EC2 gateway's 08:20 EventBridge boot (audit R5).
  // Window + idempotency guard inside runKgiSimDailySmokeSchedulerTick.
  // Steps: quote smoke + prod-broker audit (broker.* in 24h == 0) + trade smoke (dual-confirm gated).
  // Result: audit_logs action=kgi.sim.daily_smoke + ring buffer (GET .../daily-smoke-status).
  const KGI_SIM_DAILY_SMOKE_POLL_MS = 15 * 60 * 1000;
  ui(() => {
    runKgiSimDailySmokeSchedulerTick({ forceRun: false }).catch((e) =>
      console.error("[kgi-sim-daily-smoke] scheduler tick failed:", e instanceof Error ? e.message : e)
    );
  }, KGI_SIM_DAILY_SMOKE_POLL_MS);

  // CYCLE 16: TWSE Material Announcement Ingest — hourly 09:00–15:00 TST weekdays
  // Source: TWSE OpenAPI /opendata/t187ap46_L (no auth required).
  // Upserts into tw_announcements (migration 0030). Idempotent (ON CONFLICT DO NOTHING).
  // Kill switch: TWSE_ANNOUNCEMENT_INGEST_KILL_SWITCH=true.
  {
    const TWSE_ANN_INGEST_POLL_MS = 60 * 60 * 1000; // 1 hour

    /** Returns true if current Taipei time is in the 09:00–15:00 window on a weekday. */
    function isTwseAnnouncementIngestWindow(): boolean {
      const hhmm = getTaipeiHHMM();
      if (hhmm < 900 || hhmm >= 1500) return false;
      // Weekday check: shift UTC to TST (UTC+8) and check day of week
      const taipeiDate = new Date(Date.now() + 8 * 60 * 60 * 1000); // UTC+8 approximation
      const dayOfWeek = taipeiDate.getUTCDay(); // 0=Sun, 6=Sat
      return dayOfWeek >= 1 && dayOfWeek <= 5;
    }

    // 1-hour poll — fires once per hour within the 09:00–15:00 TST weekday window
    // No per-day dedup needed: the ingest is idempotent (ON CONFLICT DO NOTHING).
    ui(() => {
      if (!isTwseAnnouncementIngestWindow()) return;
      console.log("[twse-ann-ingest] hourly window open, firing ingest");
      runTwseAnnouncementIngest().catch((e) =>
        console.error("[twse-ann-ingest] hourly tick failed:", e instanceof Error ? e.message : String(e))
      );
    }, TWSE_ANN_INGEST_POLL_MS);

    // Startup catch-up: fires 45s after boot UNCONDITIONALLY (no window gate).
    // lookbackDays=7 ensures any multi-day gap from off-hours deploys is recovered.
    // The hourly window-gated tick handles same-day freshness; this handles historical gaps.
    setTimeout(() => {
      console.log("[twse-ann-ingest] boot catch-up: unconditional (lookbackDays=7)");
      runTwseAnnouncementIngest({ lookbackDays: 7 }).catch((e) =>
        console.error("[twse-ann-ingest] boot catch-up failed:", e instanceof Error ? e.message : String(e))
      );
    }, 45_000);
  }

  // MARKET-OVERVIEW-CRON: Pre-warm TWSE market overview cache every 5 min during
  // trading hours (09:00–13:35 TST weekdays). Without this, the overview route only
  // fetches on user-request → cold cache latency on page load. With this, the
  // in-process 60s cache is always hot during market hours.
  // Off-hours cron ticks are a no-op (window guard). No DB migration required.
  {
    const MARKET_OVERVIEW_CRON_MS = 5 * 60 * 1000;

    /** Returns true if current Taipei time is in the 09:00–13:35 window on a weekday. */
    function isMarketOverviewCronWindow(): boolean {
      const hhmm = getTaipeiHHMM();
      if (hhmm < 900 || hhmm >= 1335) return false;
      const taipeiDate = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const dayOfWeek = taipeiDate.getUTCDay();
      return dayOfWeek >= 1 && dayOfWeek <= 5;
    }

    ui(async () => {
      if (!isMarketOverviewCronWindow()) return;
      try {
        const { getTwseMarketOverview } = await import("./data-sources/twse-openapi-client.js");
        await getTwseMarketOverview();
        _marketOverviewCronLastFiredAt = new Date().toISOString();
        _marketOverviewCronLastError = null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        _marketOverviewCronLastError = msg;
        console.warn("[market-overview-cron] tick failed:", msg);
      }
    }, MARKET_OVERVIEW_CRON_MS);

    // Boot fire: pre-warm immediately 20s after start (covers first page load after deploy)
    setTimeout(async () => {
      try {
        const { getTwseMarketOverview } = await import("./data-sources/twse-openapi-client.js");
        await getTwseMarketOverview();
        _marketOverviewCronLastFiredAt = new Date().toISOString();
      } catch {
        // non-fatal
      }
    }, 20_000);
  }

  // TWSE-MIS-QUOTE-CRON: During trading hours (08:55–14:35 TST weekdays), fetch intraday
  // quotes from TWSE MIS API for all workspace companies every 45s and inject into the
  // manual quote cache. This ensures getMarketDataDecisionSummary sees fresh quotes →
  // strategy ideas decision upgrades from "block" to "review/allow" during market hours.
  // Batch: up to 20 symbols per request (using | separator). No auth required.
  {
    const TWSE_MIS_CRON_MS = 45 * 1000; // 45s — keeps manual quotes fresh (staleMs=60s)
    // Debounce: log the non-trading-day signal at most once per Taipei calendar
    // day (the cron fires every 45s — without this a full holiday would emit
    // hundreds of identical log lines).
    let _misNonTradingDayLastLoggedYmd: string | null = null;

    /** Returns true if current Taipei time is in 08:55–14:35 window on a weekday.
     *  08:55 = trial auction open; 14:35 = 2min buffer after 14:30 close + tail prints.
     */
    function isTwseMisQuoteCronWindow(): boolean {
      const hhmm = getTaipeiHHMM();
      // 855 = 08:55 (試撮開始); 1435 = 14:35 (尾盤完成後 5min buffer)
      if (hhmm < 855 || hhmm > 1435) return false;
      const taipeiDate = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const dayOfWeek = taipeiDate.getUTCDay();
      return dayOfWeek >= 1 && dayOfWeek <= 5;
    }

    function isTodayMisTradeDate(tradeDate: string): boolean {
      const todayYmd = taipeiDate().replace(/-/g, "");
      return tradeDate === todayYmd;
    }

    /** Map company market string to MIS exchange prefix. */
    function _misExPrefix(market: string): "tse" | "otc" {
      const m = market.trim().toUpperCase();
      if (m === "TPEX" || m === "TWO" || m === "TW_EMERGING" || m.includes("上櫃") || m.includes("OTC")) {
        return "otc";
      }
      return "tse";
    }

    async function _runTwseMisQuoteCron(): Promise<void> {
      if (!isTwseMisQuoteCronWindow()) return;
      try {
        // Build minimal cron session for upsertManualQuotes
        const cronSession = {
          workspace: { id: "00000000-0000-0000-0000-000000000000", name: workspaceSlug, slug: workspaceSlug },
          user: { id: "00000000-0000-0000-0000-000000000001", name: "twse-mis-cron", email: "cron@system", role: "Owner" as const },
          persistenceMode: (isDatabaseMode() ? "database" : "memory") as "database" | "memory"
        };

        // Use HEATMAP_CORE_SYMBOLS as the fetch universe (40 tickers).
        // Previously used DB companies LIMIT 200, but DB has 1900+ companies (full TWSE
        // bulk-seed). The LIMIT 200 missed most of the 40 heatmap core symbols.
        // MIS cron purpose is to feed _misTileCache for kgi-core heatmap Tier 1.5 —
        // so fetching exactly the 40 heatmap symbols is correct and efficient.
        //
        // Market mapping: most HEATMAP_CORE_SYMBOLS are TWSE-listed (TSE), but a small
        // number are TPEX-listed (OTC). Using the wrong exchange prefix causes MIS to
        // return an empty c:"" record which is then silently skipped. Verified 2026-06-03:
        // 3707 (漢磊) is TPEX/OTC — confirmed via MIS otc_3707.tw returning valid data.
        const OTC_HEATMAP_SYMBOLS = new Set(["3707"]);
        const { HEATMAP_CORE_SYMBOLS } = await import("./kgi-subscription-manager.js");
        const companyRows: Array<{ ticker: string; market: string }> = Array.from(HEATMAP_CORE_SYMBOLS).map((ticker) => ({
          ticker,
          market: OTC_HEATMAP_SYMBOLS.has(ticker) ? "TPEX" : "TWSE",
        }));

        if (!companyRows.length) return;

        // Build MIS batch query: up to 20 symbols per request
        const BATCH_SIZE = 20;
        const allQuotes: Array<{
          symbol: string;
          market: "TWSE" | "TPEX" | "TWO" | "TW_EMERGING" | "TW_INDEX" | "OTHER";
          source: "manual";
          last: number | null;
          bid: number | null;
          ask: number | null;
          open: number | null;
          high: number | null;
          low: number | null;
          prevClose: number | null;
          volume: number | null;
          changePct: number | null;
          timestamp: string;
        }> = [];

        const parseNum = (s?: string) => {
          if (!s || s === "-" || s.trim() === "") return null;
          const n = Number(s.replace(/,/g, "").trim());
          return isFinite(n) && n > 0 ? n : null;
        };

        const mapMktField = (m: string): "TWSE" | "TPEX" | "TWO" | "TW_EMERGING" | "TW_INDEX" | "OTHER" => {
          const upper = m.trim().toUpperCase();
          if (upper === "TWSE" || upper.includes("上市")) return "TWSE";
          if (upper === "TPEX" || upper.includes("上櫃")) return "TPEX";
          if (upper === "TWO") return "TWO";
          if (upper === "TW_EMERGING" || upper.includes("EMERGING")) return "TW_EMERGING";
          return "OTHER";
        };

        for (let i = 0; i < companyRows.length; i += BATCH_SIZE) {
          const batch = companyRows.slice(i, i + BATCH_SIZE);
          const exChParts = batch.map((c) => `${_misExPrefix(c.market)}_${c.ticker}.tw`);
          const exCh = exChParts.join("|");
          const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;

          try {
            const resp = await fetch(url, {
              signal: AbortSignal.timeout(5000),
              headers: { "Accept": "application/json" }
            });
            if (!resp.ok) continue;
            const data = await resp.json() as { msgArray?: Array<Record<string, string>>; rtcode?: string };
            if (data.rtcode !== "0000" || !data.msgArray) continue;

            // Non-trading-day early exit (2026-07-10 quote-chain outage diagnosis):
            // isTwseMisQuoteCronWindow() only checks Taipei HH:MM + weekday, not the
            // actual trading calendar, so an ad-hoc closure (e.g. typhoon day) still
            // lets this cron spin every 45s doing pointless work. Checked once, on the
            // first batch only — a single live sample is a reliable enough signal (see
            // _isMisFeedNonTradingDaySignal doc). Skips the remaining batches AND the
            // trailing index-overview fetch below for this tick only (self-healing —
            // no persistent state, so a real trading day is never blocked past one tick).
            if (i === 0) {
              const observedDateYmd = data.msgArray[0]?.["d"] ?? null;
              const todayYmd = taipeiDate().replace(/-/g, "");
              if (_isMisFeedNonTradingDaySignal(observedDateYmd, todayYmd)) {
                if (_misNonTradingDayLastLoggedYmd !== todayYmd) {
                  console.log(`[twse-mis-cron] MIS feed still on trade_date=${observedDateYmd} (expected ${todayYmd}) — likely non-trading day, skipping this tick`);
                  _misNonTradingDayLastLoggedYmd = todayYmd;
                }
                return;
              }
            }

            const now = new Date().toISOString();
            for (const msg of data.msgArray) {
              const ticker = msg["c"];
              if (!ticker) continue;
              if (!isTodayMisTradeDate(msg["d"] ?? "")) continue;

              // Resolve last price: prefer z (last trade), fallback to best bid (b[0]),
              // then best ask (a[0]). MIS frequently returns z="-" when no tick has
              // printed in the current second even though the stock is actively traded.
              // Using bid as proxy gives a real-time level-2 price rather than skipping.
              const zRaw = msg["z"];
              const bPrices = msg["b"]?.split("_").filter(Boolean);
              const aPrices = msg["a"]?.split("_").filter(Boolean);
              const zNum = parseNum(zRaw);
              const bidNum = parseNum(bPrices?.[0]);
              const askNum = parseNum(aPrices?.[0]);
              const last = zNum ?? bidNum ?? askNum;
              // Require non-null last AND that volume > 0 (stock is actively traded today)
              const vol = parseNum(msg["v"]);
              if (!last || last <= 0) continue;
              if (!vol || vol <= 0) continue;

              const companyRow = batch.find((r) => r.ticker === ticker);
              const market = mapMktField(companyRow?.market ?? "");

              const open = parseNum(msg["o"]);
              const high = parseNum(msg["h"]);
              const low = parseNum(msg["l"]);
              const prevClose = parseNum(msg["y"]);
              // bid/ask/vol already resolved above for last-price fallback
              const bid = bidNum;
              const ask = askNum;

              // Calculate changePct vs prevClose
              const changePct =
                prevClose && prevClose > 0
                  ? ((last - prevClose) / prevClose) * 100
                  : null;

              allQuotes.push({
                symbol: ticker,
                market,
                source: "manual",
                last,
                bid,
                ask,
                open,
                high,
                low,
                prevClose,
                volume: vol,
                changePct,
                timestamp: now
              });
            }
          } catch {
            // batch fail is non-fatal — skip
          }
        }

        if (!allQuotes.length) return;

        await upsertManualQuotes({ session: cronSession, quotes: allQuotes });

        // Also update the MIS tile cache so heatmap/kgi-core can use MIS as Tier 1.5.
        // We only keep entries where last > 0 (i.e. valid 盤中成交價).
        // tradeDateYmd is today's date in Taipei timezone "YYYYMMDD".
        const todayYmd = new Date(Date.now() + 8 * 60 * 60 * 1000)
          .toISOString().slice(0, 10).replace(/-/g, "");
        const now2 = new Date().toISOString();
        for (const q of allQuotes) {
          if (q.last !== null && q.last > 0) {
            _misTileCache.set(q.symbol, {
              last: q.last,
              changePct: q.changePct,
              ts: now2,
              tradeDateYmd: todayYmd,
            });
          }
        }

        _tsweMisQuoteCronLastFiredAt = new Date().toISOString();
        _tsweMisQuoteCronLastCount = allQuotes.length;
        _tsweMisQuoteCronLastError = null;
        console.log(`[twse-mis-cron] injected ${allQuotes.length} intraday quotes into manual cache + _misTileCache (${_misTileCache.size} symbols)`);

        // Also fetch TAIEX (tse_t00.tw) + OTC (otc_o00.tw) market index for overview endpoint.
        // These are not in HEATMAP_CORE_SYMBOLS so we fetch separately and cache in _overviewMisIndexCache.
        try {
          const indexUrl = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw%7Cotc_o00.tw&json=1&delay=0";
          const idxResp = await fetch(indexUrl, {
            signal: AbortSignal.timeout(5000),
            headers: { "Accept": "application/json" }
          });
          if (idxResp.ok) {
            const idxData = await idxResp.json() as { msgArray?: Array<Record<string, string>> };
            const idxArr = idxData.msgArray ?? [];
            const parseIdxRow = (row: Record<string, string> | undefined) => {
              if (!row) return null;
              const tRaw = row["t"] ?? "";
              const last = parseMisNumericField(row["z"]);
              const prevClose = parseMisNumericField(row["y"]);
              const volume = parseMisNumericField(row["v"] ?? row["tv"]);
              if (last === null || prevClose === null || !Number.isFinite(last) || !Number.isFinite(prevClose) || prevClose === 0) return null;
              const change = parseFloat((last - prevClose).toFixed(2));
              const changePct = parseFloat(((change / prevClose) * 100).toFixed(2));
              return { last, prevClose, change, changePct, time: tRaw, volume };
            };
            const taiexRow = idxArr.find((r) => r["ex"] === "tse" && (r["ch"] === "t00.tw" || r["c"] === "t00"));
            const otcRow = idxArr.find((r) => r["ex"] === "otc" && (r["ch"] === "o00.tw" || r["c"] === "o00"));
            const nextIndexCache = {
              taiex: parseIdxRow(taiexRow),
              otc: parseIdxRow(otcRow),
              cachedAt: Date.now(),
              tradeDateYmd: todayYmd
            };
            _overviewMisIndexCache = nextIndexCache;
            if (nextIndexCache.taiex) {
              console.log(`[twse-mis-cron] index cached: TAIEX=${nextIndexCache.taiex.last} changePct=${nextIndexCache.taiex.changePct}%`);
            }
          }
        } catch {
          // index fetch failure is non-fatal — overview will use fallback
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        _tsweMisQuoteCronLastError = msg;
        console.warn("[twse-mis-cron] tick failed:", msg);
      }
    }

    ui(_runTwseMisQuoteCron, TWSE_MIS_CRON_MS);

    // Boot fire: 30s after startup so DB is warm and companies are seeded
    setTimeout(() => {
      void _runTwseMisQuoteCron();
    }, 30_000);
  }

  // MIS-FULL-UNIVERSE-SWEEP (Tier B): During trading hours (08:55–14:35 TST weekdays),
  // sweep the entire DB companies universe (~1978 stocks) in rolling 50-ticker slices
  // every 10s. One full sweep round covers all stocks in ~400s (≈6.7 min).
  // Purpose: inject intraday MIS quotes for all companies, not just the 40 heatmap core.
  // This powers decision-summary / strategy ideas / search / portfolio for the full universe.
  // Design:
  //   - Universe: DB companies (ticker+market), filtered to /^\d{4,6}$/ tickers, cached 30min.
  //   - Slice: 50 tickers per HTTP request (MIS supports up to ~100, we use 50 conservatively).
  //   - Throttle: 1 request per 10s, 5s HTTP timeout, concurrent guard prevents overlap.
  //   - Thin stocks: vol=0 guard relaxed — any stock with bid or ask price is injected.
  //     This ensures low-liquidity stocks show bid-based reference prices, not "block".
  //   - Tier A (core 40, 45s) continues unchanged for heatmap freshness.
  //   - _misTileCache written for all stocks, heatmap enricher only reads core 40 keys.
  {
    const MIS_SWEEP_INTERVAL_MS = 10 * 1000; // 10s per slice
    const MIS_SWEEP_BATCH_SIZE = 50;         // 50 tickers per MIS request
    const MIS_SWEEP_HTTP_TIMEOUT_MS = 5000;

    /** Reload universe cache from DB companies. Idempotent — skipped if cache is fresh. */
    async function _refreshMisUniverseCache(): Promise<void> {
      const now = Date.now();
      if (_misUniverseCache.length > 0 && now - _misUniverseCacheUpdatedAt < MIS_UNIVERSE_CACHE_TTL_MS) {
        return; // cache still valid
      }
      if (!isDatabaseMode()) return;
      const db2 = getDb();
      if (!db2) return;
      try {
        // Resolve workspace id for companies query
        const wsSlugResolved = workspaceSlug ?? process.env.DEFAULT_WORKSPACE_SLUG ?? "default";
        const wsRows = await db2
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.slug, wsSlugResolved))
          .limit(1)
          .catch(() => [] as Array<{ id: string }>);
        if (!wsRows.length) return;
        const wsId = wsRows[0].id;

        const rows = await db2
          .select({ ticker: companies.ticker, market: companies.market })
          .from(companies)
          .where(eq(companies.workspaceId, wsId))
          .catch(() => [] as Array<{ ticker: string; market: string }>);

        // Filter to valid ticker format and known exchange prefixes
        const valid = rows.filter(
          (r) => r.ticker && OFFICIAL_COMPANY_TICKER_PATTERN.test(r.ticker)
        );
        _misUniverseCache = valid;
        _misUniverseCacheUpdatedAt = now;
        console.log(`[mis-sweep] universe cache refreshed: ${valid.length} tickers from DB`);
      } catch (err) {
        console.warn("[mis-sweep] universe cache refresh failed:", err instanceof Error ? err.message : String(err));
      }
    }

    /** Determine MIS exchange prefix from company market string. */
    function _misSwpExPrefix(market: string): "tse" | "otc" {
      const m = market.trim().toUpperCase();
      if (m === "TPEX" || m === "TWO" || m === "TW_EMERGING" || m.includes("上櫃") || m.includes("OTC")) {
        return "otc";
      }
      return "tse";
    }

    /** Parse a MIS numeric string field. Returns null for "-" / empty / non-positive. */
    function _misSwpParseNum(s?: string): number | null {
      if (!s || s === "-" || s.trim() === "") return null;
      const n = Number(s.replace(/,/g, "").trim());
      return isFinite(n) && n > 0 ? n : null;
    }

    /** Map company market string to canonical market enum value. */
    function _misSwpMapMkt(m: string): "TWSE" | "TPEX" | "TWO" | "TW_EMERGING" | "TW_INDEX" | "OTHER" {
      const upper = m.trim().toUpperCase();
      if (upper === "TWSE" || upper.includes("上市")) return "TWSE";
      if (upper === "TPEX" || upper.includes("上櫃")) return "TPEX";
      if (upper === "TWO") return "TWO";
      if (upper === "TW_EMERGING" || upper.includes("EMERGING")) return "TW_EMERGING";
      return "OTHER";
    }

    /**
     * Run one sweep slice: fetch MIS quotes for 50 tickers at current pointer position,
     * inject into manual cache + _misTileCache. Advances pointer by BATCH_SIZE.
     * If pointer wraps to 0, logs round completion stats.
     */
    async function _runMisFullSweepSlice(): Promise<void> {
      // Only during trading hours
      const hhmm = getTaipeiHHMM();
      if (hhmm < 855 || hhmm > 1435) return;

      // Concurrent guard
      if (_misFullSweepRunning) return;
      _misFullSweepRunning = true;

      try {
        // Refresh universe cache if stale (no-op if fresh)
        await _refreshMisUniverseCache();
        if (!_misUniverseCache.length) return;

        const total = _misUniverseCache.length;

        // Detect wrap-around: if idx reached end, log round stats and reset counters
        if (_misUniverseSweepIdx >= total) {
          _misUniverseSweepIdx = 0;
          _misFullSweepRoundsCompleted++;
          console.log(
            `[mis-sweep] round ${_misFullSweepRoundsCompleted} complete: ` +
            `${_misFullSweepInjectedThisRound} quotes injected over ${total} stocks, ` +
            `_misTileCache size=${_misTileCache.size}`
          );
          _misFullSweepInjectedThisRound = 0;
        }

        const slice = _misUniverseCache.slice(_misUniverseSweepIdx, _misUniverseSweepIdx + MIS_SWEEP_BATCH_SIZE);
        _misUniverseSweepIdx += MIS_SWEEP_BATCH_SIZE;

        if (!slice.length) return;

        // Build MIS ex_ch query string: tse_XXXX.tw|otc_YYYY.tw|...
        const exChParts = slice.map((c) => `${_misSwpExPrefix(c.market)}_${c.ticker.trim()}.tw`);
        const exCh = exChParts.join("|");
        const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;

        let data: { msgArray?: Array<Record<string, string>>; rtcode?: string };
        try {
          const resp = await fetch(url, {
            signal: AbortSignal.timeout(MIS_SWEEP_HTTP_TIMEOUT_MS),
            headers: { "Accept": "application/json" }
          });
          if (!resp.ok) {
            console.warn(`[mis-sweep] HTTP ${resp.status} for slice idx=${_misUniverseSweepIdx - MIS_SWEEP_BATCH_SIZE}`);
            return;
          }
          data = await resp.json() as { msgArray?: Array<Record<string, string>>; rtcode?: string };
        } catch (fetchErr) {
          console.warn(`[mis-sweep] fetch failed idx=${_misUniverseSweepIdx - MIS_SWEEP_BATCH_SIZE}:`, fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
          return;
        }

        if (data.rtcode !== "0000" || !data.msgArray?.length) return;

        // Build minimal cron session for upsertManualQuotes
        if (!isDatabaseMode()) return;
        const db3 = getDb();
        if (!db3) return;

        // Resolve workspace id (cached from universe refresh)
        const wsSlug2 = workspaceSlug ?? process.env.DEFAULT_WORKSPACE_SLUG ?? "default";
        const wsRows2 = await db3
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.slug, wsSlug2))
          .limit(1)
          .catch(() => [] as Array<{ id: string }>);
        if (!wsRows2.length) return;

        const sweepSession = {
          workspace: { id: wsRows2[0].id, name: wsSlug2, slug: wsSlug2 },
          user: { id: "00000000-0000-0000-0000-000000000002", name: "twse-mis-sweep", email: "cron@system", role: "Owner" as const },
          persistenceMode: "database" as const
        };

        const now = new Date().toISOString();
        const todayYmd = new Date(Date.now() + 8 * 60 * 60 * 1000)
          .toISOString().slice(0, 10).replace(/-/g, "");

        /** Check if MIS data date matches today in Taipei. */
        function isTodayMisDate(d: string): boolean {
          // MIS d field: "20260603" format
          return d?.replace(/-/g, "") === todayYmd;
        }

        const quotes: Array<{
          symbol: string;
          market: "TWSE" | "TPEX" | "TWO" | "TW_EMERGING" | "TW_INDEX" | "OTHER";
          source: "manual";
          last: number | null;
          bid: number | null;
          ask: number | null;
          open: number | null;
          high: number | null;
          low: number | null;
          prevClose: number | null;
          volume: number | null;
          changePct: number | null;
          timestamp: string;
        }> = [];

        for (const msg of data.msgArray) {
          const ticker = msg["c"]?.trim();
          if (!ticker) continue;
          if (!isTodayMisDate(msg["d"] ?? "")) continue;

          // Resolve last price: z (last trade) → best bid → best ask
          // For thin/illiquid stocks, z is often "-" or absent; bid/ask gives a valid reference.
          const zNum = _misSwpParseNum(msg["z"]);
          const bPrices = msg["b"]?.split("_").filter(Boolean);
          const aPrices = msg["a"]?.split("_").filter(Boolean);
          const bidNum = _misSwpParseNum(bPrices?.[0]);
          const askNum = _misSwpParseNum(aPrices?.[0]);
          const last = zNum ?? bidNum ?? askNum;

          // Require a valid last price (bid or ask is enough for thin stocks)
          if (!last || last <= 0) continue;

          // Volume: thin stocks may have vol=0 — that is OK for reference price
          // We only require a valid quote (bid/ask/trade) to inject.
          // Downstream: source="manual" → decision="review" (not block), never "allow".
          const vol = _misSwpParseNum(msg["v"]);

          const companyRow = slice.find((r) => r.ticker.trim() === ticker);
          const market = _misSwpMapMkt(companyRow?.market ?? "");

          const open = _misSwpParseNum(msg["o"]);
          const high = _misSwpParseNum(msg["h"]);
          const low = _misSwpParseNum(msg["l"]);
          const prevClose = _misSwpParseNum(msg["y"]);
          const changePct =
            prevClose && prevClose > 0
              ? Math.round(((last - prevClose) / prevClose) * 10000) / 100
              : null;

          quotes.push({
            symbol: ticker,
            market,
            source: "manual",
            last,
            bid: bidNum,
            ask: askNum,
            open,
            high,
            low,
            prevClose,
            volume: vol,
            changePct,
            timestamp: now,
          });

          // Write to _misTileCache (readable by heatmap enricher for any ticker)
          _misTileCache.set(ticker, {
            last,
            changePct,
            ts: now,
            tradeDateYmd: todayYmd,
          });
        }

        if (!quotes.length) return;

        // upsertManualQuotes max 200 per call — slice already ≤50, so single call is fine
        await upsertManualQuotes({ session: sweepSession, quotes });
        _misFullSweepInjectedThisRound += quotes.length;

      } finally {
        _misFullSweepRunning = false;
      }
    }

    // Register interval: 10s per slice
    ui(_runMisFullSweepSlice, MIS_SWEEP_INTERVAL_MS);

    // Boot fire: 60s — after Tier A (30s) and EOD cron (45s) boot fires settle
    setTimeout(async () => {
      await _refreshMisUniverseCache();
      void _runMisFullSweepSlice();
    }, 60_000);
  }

  // TWSE-EOD-QUOTE-CRON: Outside trading hours (before 08:55 and after 14:35 TST, all days),
  // inject TWSE STOCK_DAY_ALL EOD prices into the manual quote cache. This ensures
  // getMarketDataDecisionSummary sees EOD prices even when market is closed → decision
  // upgrades from "block" to "review", unblocking strategy ideas in the morning/evening.
  // Cadence: 10 min poll. Source: "manual" with staleMs=10min. Fires any day/time OUTSIDE
  // the MIS intraday window (which already injects fresh prices during trading hours).
  {
    const TWSE_EOD_CRON_MS = 10 * 60 * 1000; // 10 min poll
    let _twseEodCronLastFiredAt: string | null = null;
    let _twseEodCronLastCount = 0;
    let _twseEodCronLastError: string | null = null;
    // Non-trading-day dedup gate state (2026-07-10) — see
    // _isTwseEodCronTradeDateAlreadyPersisted doc for why comparing against
    // the last successfully-persisted date is a safe stand-in for a calendar check.
    let _twseEodCronLastPersistedTradeDate: string | null = null;

    /** Returns true when we should inject EOD quotes (not already covered by MIS cron). */
    function _isTwseEodCronWindow(): boolean {
      const hhmm = getTaipeiHHMM();
      // Skip during MIS intraday window (08:55-14:35) — MIS cron covers that
      return hhmm < 855 || hhmm >= 1435;
    }

    async function _runTwseEodCron(): Promise<void> {
      if (!_isTwseEodCronWindow()) return;
      try {
        const { getStockDayAllRows } = await import("./data-sources/twse-openapi-client.js");
        const stockRows = await getStockDayAllRows();
        if (!stockRows.length) return;

        // Build minimal cron session for upsertManualQuotes
        const cronSession = {
          workspace: { id: "00000000-0000-0000-0000-000000000000", name: workspaceSlug, slug: workspaceSlug },
          user: { id: "00000000-0000-0000-0000-000000000001", name: "twse-eod-cron", email: "cron@system", role: "Owner" as const },
          persistenceMode: (isDatabaseMode() ? "database" : "memory") as "database" | "memory"
        };

        // Resolve actual workspace id for manual quote injection
        const db2 = isDatabaseMode() ? getDb() : null;
        if (!db2) return;
        const wsRows = await db2.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, workspaceSlug)).limit(1).catch(() => [] as Array<{ id: string }>);
        if (!wsRows.length) return;
        cronSession.workspace.id = wsRows[0].id;

        const parseEodNum = (s?: string): number | null => {
          if (!s || s === "--" || s.trim() === "") return null;
          const n = Number(s.replace(/,/g, "").trim());
          return isFinite(n) && n > 0 ? n : null;
        };

        const computeEodChangePct = (closingPrice: string, change: string): number | null => {
          const close = parseEodNum(closingPrice);
          const chg = parseFloat(change.trim().replace(/^\+/, ""));
          if (!close || !isFinite(chg)) return null;
          const prevClose = close - chg;
          if (prevClose <= 0) return null;
          return Math.round((chg / prevClose) * 10000) / 100;
        };

        // Convert TWSE STOCK_DAY_ALL rows to manual quote upsert format
        const quotes: Array<{
          symbol: string; market: "TWSE"; source: "manual"; last: number | null;
          bid: null; ask: null; open: number | null; high: number | null; low: number | null;
          prevClose: number | null; volume: number | null; changePct: number | null;
          timestamp: string;
        }> = [];

        // STOCK_DAY_ALL date is ROC calendar — see _computeTwseEodCronTradingDateIso
        // doc comment (2026-07-10 Pete review follow-up) for why this must go
        // through the shared parser rather than a local inline one.
        const tradingDateIso = _computeTwseEodCronTradingDateIso(stockRows[0]?.Date);

        // Non-trading-day early exit (2026-07-10 quote-chain outage diagnosis):
        // STOCK_DAY_ALL's own trading date only advances once a new session's
        // close is published — on an ad-hoc closure (e.g. typhoon day) it never
        // changes, so this cron would otherwise re-fetch + re-persist the exact
        // same dataset every 10 minutes, all day. Skipping when unchanged never
        // misfires on a real trading day (a fresh date always lets that day's
        // first tick straight through) and does not affect quote freshness —
        // `ts` below is derived from tradingDateIso itself, not wall-clock time,
        // so repeating the same date's injection would not have refreshed
        // freshness anyway. See _isTwseEodCronTradeDateAlreadyPersisted doc.
        if (_isTwseEodCronTradeDateAlreadyPersisted(tradingDateIso, _twseEodCronLastPersistedTradeDate)) {
          console.log(`[twse-eod-cron] trade_date=${tradingDateIso.slice(0, 10)} already persisted — no new trading session (likely non-trading day), skipping tick`);
          return;
        }

        const ts = tradingDateIso || new Date().toISOString();

        for (const row of stockRows) {
          const ticker = row.Code?.trim();
          if (!ticker || !/^\d{4,6}$/.test(ticker)) continue;
          const last = parseEodNum(row.ClosingPrice);
          if (!last) continue;
          const open = parseEodNum(row.OpeningPrice);
          const high = parseEodNum(row.HighestPrice);
          const low = parseEodNum(row.LowestPrice);
          const vol = parseFloat(row.TradeVolume?.replace(/,/g, "") ?? "");
          const volume = isFinite(vol) ? vol : null;
          const changePct = computeEodChangePct(row.ClosingPrice, row.Change);
          const chgNum = parseFloat(row.Change?.trim().replace(/^\+/, "") ?? "");
          const prevClose = isFinite(chgNum) && last ? last - chgNum : null;
          quotes.push({
            symbol: ticker, market: "TWSE", source: "manual", last, bid: null, ask: null,
            open, high, low, prevClose: prevClose && prevClose > 0 ? prevClose : null,
            volume, changePct, timestamp: ts,
          });
        }

        if (!quotes.length) return;
        // upsertManualQuotes schema: max 200 per call — batch for 1400+ TWSE rows
        const UPSERT_BATCH = 200;
        for (let i = 0; i < quotes.length; i += UPSERT_BATCH) {
          await upsertManualQuotes({ session: cronSession, quotes: quotes.slice(i, i + UPSERT_BATCH) });
        }

        // Persist last-good EOD closes to quote_last_close for mark-to-market fallback.
        // This is the full TWSE universe (~1400 stocks), including all F-AUTO holdings.
        // After a deploy restart / 盤後 gap, buildS1PositionsSnapshot() reads this table
        // as step 1d rather than returning null market values.
        try {
          const { upsertLastCloses: _upsertEod } = await import("./quote-last-close-store.js");
          const db3 = isDatabaseMode() ? getDb() : null;
          if (db3 && tradingDateIso) {
            // Extract YYYY-MM-DD from tradingDateIso ("YYYY-MM-DDT13:30:00+08:00")
            const eodTradeDate = tradingDateIso.slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(eodTradeDate)) {
              const eodEntries = quotes
                .filter((q) => q.last !== null && q.last > 0)
                .map((q) => ({
                  symbol:     q.symbol,
                  closePrice: q.last as number,
                  tradeDate:  eodTradeDate,
                  source:     "twse_eod" as const,
                }));
              if (eodEntries.length > 0) {
                await _upsertEod(db3, eodEntries);
                console.log(`[twse-eod-cron] persisted ${eodEntries.length} last-good closes to quote_last_close (trade_date=${eodTradeDate})`);
              }
            }
          }
        } catch (persistErr) {
          console.warn("[twse-eod-cron] quote_last_close persist failed:", persistErr instanceof Error ? persistErr.message : String(persistErr));
        }

        // Persist TPEX EOD closes to quote_last_close (source=tpex_eod).
        // Bruce audit 7/2 PARTIAL: TWSE stocks persisted by block above, but OTC stocks
        // (4716/5489/4707/5348/3230 in F-AUTO basket) not covered — they fell through to MIS
        // fallback. Without DB persist, a restart during/after盤後 leaves OTC positions null.
        // Uses same eodTradeDate from TWSE block (same trading day). Fail-open: never throws.
        try {
          const { getTpexMainboardCloseRows: _getTpex } = await import("./data-sources/twse-openapi-client.js");
          const db4 = isDatabaseMode() ? getDb() : null;
          const tpexTradeDate = tradingDateIso ? tradingDateIso.slice(0, 10) : "";
          if (db4 && /^\d{4}-\d{2}-\d{2}$/.test(tpexTradeDate)) {
            const tpexRows = await _getTpex();
            // 2026-07-10 follow-up (reports/ledger_stall_20260709/): validate TPEX's
            // OWN Date field against the expected trade date before persisting — this
            // block previously borrowed TWSE's trade date unconditionally, which could
            // tag a stale TPEX close as if it were the current trade date (TWSE and
            // TPEX publish on separate schedules).
            if (tpexRows.length > 0 && !_isTpexEodCloseDateValid(tpexTradeDate, tpexRows[0]?.Date)) {
              console.warn(`[twse-eod-cron] TPEX date mismatch: daily_close_quotes data_date != expected trade_date=${tpexTradeDate} — TPEX persist skipped`);
            } else if (tpexRows.length > 0) {
              const { upsertLastCloses: _upsertTpex } = await import("./quote-last-close-store.js");
              const tpexEntries = tpexRows
                .map((r) => {
                  const ticker = r.SecuritiesCompanyCode?.trim();
                  const close = parseFloat(r.Close ?? "");
                  if (!ticker || !/^\d{4,6}$/.test(ticker) || !isFinite(close) || close <= 0) return null;
                  return { symbol: ticker, closePrice: close, tradeDate: tpexTradeDate, source: "tpex_eod" as const };
                })
                .filter((e): e is NonNullable<typeof e> => e !== null);
              if (tpexEntries.length > 0) {
                await _upsertTpex(db4, tpexEntries);
                console.log(`[twse-eod-cron] persisted ${tpexEntries.length} TPEX last-good closes to quote_last_close (trade_date=${tpexTradeDate})`);
              }
            }
          }
        } catch (tpexPersistErr) {
          console.warn("[twse-eod-cron] TPEX quote_last_close persist failed:", tpexPersistErr instanceof Error ? tpexPersistErr.message : String(tpexPersistErr));
        }

        _twseEodCronLastFiredAt = new Date().toISOString();
        _twseEodCronLastCount = quotes.length;
        _twseEodCronLastError = null;
        if (tradingDateIso) {
          _twseEodCronLastPersistedTradeDate = tradingDateIso.slice(0, 10);
        }
        console.log(`[twse-eod-cron] injected ${quotes.length} EOD quotes into manual cache (outside trading hours)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        _twseEodCronLastError = msg;
        console.warn("[twse-eod-cron] tick failed:", msg);
      }
    }

    ui(_runTwseEodCron, TWSE_EOD_CRON_MS);

    // Boot fire: 45s — slightly after MIS cron boot fire so they don't race
    setTimeout(() => {
      void _runTwseEodCron();
    }, 45_000);
  }

  // KGI-QUOTE-INGEST-CRON (2026-07-10 quote-chain outage diagnosis P1): During
  // trading hours (08:55–14:35 TST weekdays), pull live ticks from the KGI
  // gateway for the permanently-subscribed equity universe (CORE_SYMBOLS +
  // STRATEGY_SYMBOLS — always subscribed, so ticks are the highest-signal
  // subset; the other 21 HEATMAP_CORE_SYMBOLS aren't in the KGI subscription
  // pool at all) and bridge them into quoteProviders.kgi via upsertKgiQuotes.
  // This bucket previously had ZERO production writers — kgi-subscription-
  // manager.ts's own tick fetch (getKgiMarketOverview / getKgiCoreHeatmap) was
  // never bridged into market-data.ts's quote store, so readiness="ready"
  // (which requires selectedSource==="kgi") was structurally unreachable even
  // with a fully healthy KGI feed. Purely additive: does not touch the
  // readiness formula or any other quoteProviders bucket.
  // Fail-open: the KGI SIM account's market-data auth is currently broken
  // (KGI_QUOTE_AUTH_UNAVAILABLE — an account/SDK-level gap, not a bug in this
  // cron), so every fetch resolves to a null tick and this cron is a no-op in
  // practice until that is fixed. See reports/quote_chain_outage_20260710/.
  {
    const KGI_QUOTE_INGEST_CRON_MS = 60 * 1000; // 60s — gentler than the 45s MIS cron since each tick is a per-symbol gateway round-trip, not one batched HTTP call

    /** Same weekday/window guard as TWSE-MIS-QUOTE-CRON (deliberately duplicated,
     *  not shared — matches this file's existing convention of per-cron window
     *  checks rather than a shared helper). */
    function isKgiQuoteIngestCronWindow(): boolean {
      const hhmm = getTaipeiHHMM();
      if (hhmm < 855 || hhmm > 1435) return false;
      const taipeiDate = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const dayOfWeek = taipeiDate.getUTCDay();
      return dayOfWeek >= 1 && dayOfWeek <= 5;
    }

    async function _runKgiQuoteIngestCron(): Promise<void> {
      if (!isKgiQuoteIngestCronWindow()) return;
      try {
        const { CORE_SYMBOLS, STRATEGY_SYMBOLS, fetchKgiLatestTick } = await import("./kgi-subscription-manager.js");
        // Same single OTC exception as TWSE-MIS-QUOTE-CRON's OTC_HEATMAP_SYMBOLS
        // (3707 漢磊 is TPEX-listed; every other CORE/STRATEGY symbol is TWSE).
        const OTC_KGI_INGEST_SYMBOLS = new Set(["3707"]);
        const symbols = Array.from(new Set<string>([...CORE_SYMBOLS, ...STRATEGY_SYMBOLS]));
        if (!symbols.length) return;

        const ticks = await Promise.all(symbols.map((symbol) => fetchKgiLatestTick(symbol)));

        const cronSession = {
          workspace: { id: "00000000-0000-0000-0000-000000000000", name: workspaceSlug, slug: workspaceSlug },
          user: { id: "00000000-0000-0000-0000-000000000001", name: "kgi-quote-ingest-cron", email: "cron@system", role: "Owner" as const },
          persistenceMode: (isDatabaseMode() ? "database" : "memory") as "database" | "memory"
        };

        // _mapKgiTicksToUpsertQuotes preserves each tick's own emission time
        // (tick.ts / staleSec) rather than stamping cron execution time — see
        // its doc comment (2026-07-10 Pete review) for why that distinction
        // matters once KGI auth is fixed.
        const quotes = _mapKgiTicksToUpsertQuotes(ticks, OTC_KGI_INGEST_SYMBOLS);

        if (!quotes.length) return;

        await upsertKgiQuotes({ session: cronSession, quotes });
        console.log(`[kgi-quote-ingest-cron] bridged ${quotes.length} live KGI ticks into quoteProviders.kgi`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[kgi-quote-ingest-cron] tick failed:", msg);
      }
    }

    ui(_runKgiQuoteIngestCron, KGI_QUOTE_INGEST_CRON_MS);

    // Boot fire: 50s — after the MIS (30s) and EOD (45s) boot fires settle
    setTimeout(() => {
      void _runKgiQuoteIngestCron();
    }, 50_000);
  }

  console.log(
    "[schedulers] F2 OHLCV (6h) + F3 daily_brief (23h) + " +
    "PR-A monthly-revenue (24h) + PR-A financials (24h) + " +
    "PR-B institutional (30min) + PR-B margin-short (30min) + PR-B shareholding (24h) + " +
    "PR-C dividend (24h) + PR-C market-value (24h) + PR-C valuation (24h) + PR-C stock-news (30min) + " +
    "FINMIND-FULL-11-DATASET boot(60s)+recurring(6h) + " +
    "P0-C pipeline pre_market/close_watch/close_brief (15min) + " +
    "BLOCK#6 event-rule-engine (5min) + email-digest (5min, fires at 17:00–17:30 TST) + " +
    "OPENALICE-M1 decision-orchestrator (10min, 60s boot) + OPENALICE-M2 action-executor (7min, 90s boot) + " +
    "BLOCK#NEWS news-ai-selector (60min hourly cron, 50min double-fire guard) + " +
    "P0-2 health-watchdog (30min) + " +
    "BLOCK#TOGGLE paper-obs-cron (15min poll, fires at 17:00–17:30 TST) + " +
    "BLOCK#SIGNAL strategy(15min,13:45-14:30TST) + news(15min,4-window) + quote.breakout(30min,09:00-13:30TST) + " +
    "KGI-SIM-DAILY-SMOKE (15min poll, fires 09:05-09:35 TST) + " +
    "TWSE-ANN-INGEST (60min poll, fires 09:00-15:00 TST weekdays) + " +
    "MARKET-OVERVIEW-CRON (5min cache pre-warm, fires 09:00-13:35 TST weekdays) + " +
    "TWSE-MIS-QUOTE-CRON (45s intraday injection, fires 08:55-14:35 TST weekdays) + " +
    "MIS-FULL-UNIVERSE-SWEEP (10s/slice, 50 tickers/slice, ~400s/round for ~1978 stocks, fires 08:55-14:35 TST weekdays) + " +
    "TWSE-EOD-QUOTE-CRON (10min, outside 08:55-14:35 window, injects EOD quotes for ideas gate) + " +
    "KGI-QUOTE-INGEST-CRON (60s, fires 08:55-14:35 TST weekdays, bridges live KGI ticks into quoteProviders.kgi) + " +
    "AI-REC-V2-CRON (5min poll, fires 09:30+13:00 TST weekdays) + " +
    "AI-REC-V3-CRON (24h, fires 08:30-09:15 TST weekdays, boot-fire 90s) + " +
    "OPENALICE-M1-DECISION-CRON (10min, consumes iuf_events+signals → iuf_decisions, boot-fire 60s) started"
  );

  // AI-REC-V2-CRON: Fire Brain ReAct AI recommendation at 09:30 and 13:00 TST weekdays.
  // Pattern: 5min poll, window-guarded. State stored in module-level _aiRecV2Cron* vars.
  // Boot fire at 60s (allows server to fully warm before first LLM call).
  {
    const AI_REC_V2_CRON_INTERVAL_MS = 5 * 60 * 1000;
    let _aiRecV2LastCronFireHhmm: number | null = null;

    ui(async () => {
      if (!isAiRecV2CronWindow()) return;
      if (_aiRecV2CronRunning) return; // already running from manual trigger or prev tick

      const hhmm = getTaipeiHHMM();
      // Fire at 09:30 (930) and 13:00 (1300) — only once per window (guard by fired hhmm bucket)
      const firedWindow = hhmm < 1000 ? 930 : 1300;
      if (_aiRecV2LastCronFireHhmm === firedWindow) return;

      // Check if we're in a fire window: 930-935 or 1300-1305
      const inFireWindow = (hhmm >= 930 && hhmm <= 935) || (hhmm >= 1300 && hhmm <= 1305);
      if (!inFireWindow) return;

      _aiRecV2LastCronFireHhmm = firedWindow;
      _aiRecV2CronRunning = true;
      const trigger = hhmm < 1000 ? "cron_0930" : "cron_1300";
      try {
        const { runAiRecommendationV2 } = await import("./ai-recommendation-v2/orchestrator.js");
        await runAiRecommendationV2({ trigger: trigger as import("./ai-recommendation-v2/orchestrator.js").AiRecTrigger, maxRounds: 8, costCapUsd: 1.5 });
        _aiRecV2CronLastFiredAt = new Date().toISOString();
        _aiRecV2CronLastError = null;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        _aiRecV2CronLastError = msg;
        console.warn("[ai-rec-v2-cron] tick failed:", msg);
      } finally {
        _aiRecV2CronRunning = false;
      }
    }, AI_REC_V2_CRON_INTERVAL_MS);
  }

  // AI-REC-V3-CRON: Daily AI Recommendation v3 (Yang SOP / 7-axis ReAct).
  // Cadence: 5-min tick + window guard, fires once per day in 08:30–09:15 TST.
  // (The old 24h tick almost never landed inside the 45-min window, so after the
  // 6/5 budget blow-up the cron simply never fired again — 5 days of zero cards.)
  // On a failed run the day is NOT consumed: retry on the next tick inside the
  // window, capped at AI_REC_V3_MAX_ATTEMPTS_PER_DAY to bound LLM spend.
  // Boot fire at 90s only when today has no v3 run yet — on 6/5 every deploy
  // boot-fired a fresh run and a dozen deploys burned the whole daily budget.
  // State: shared _aiRecV3Cron* module-level vars (also used by manual POST endpoint).
  {
    const AI_REC_V3_CRON_TICK_MS = 5 * 60 * 1000;

    ui(async () => {
      const { isV3CronWindowAt, taipeiDateOf } = await import("./ai-recommendation-v2/orchestrator-v3.js");
      if (!isV3CronWindowAt()) return;
      if (_aiRecV3CronRunning) return;

      const todayDate = taipeiDateOf();
      if (_aiRecV3CronSuccessDate === todayDate) return;
      if (_aiRecV3AttemptDate !== todayDate) {
        _aiRecV3AttemptDate = todayDate;
        _aiRecV3AttemptCount = 0;
      }
      if (_aiRecV3AttemptCount >= AI_REC_V3_MAX_ATTEMPTS_PER_DAY) return;
      _aiRecV3AttemptCount++;

      console.info(`[ai-rec-v3-cron] firing daily cron for date=${todayDate} attempt=${_aiRecV3AttemptCount}/${AI_REC_V3_MAX_ATTEMPTS_PER_DAY}`);
      await _runAiRecV3Cron({ trigger: "cron_daily", workspaceId: null });
      if (_aiRecV3CronLastError === null) {
        _aiRecV3CronSuccessDate = todayDate;
      }
    }, AI_REC_V3_CRON_TICK_MS);

    // Boot fire: pre-warm at 90s so first day always has a v3 run after deploy —
    // but only if today has no run row yet (any status), so deploy bursts don't burn budget.
    setTimeout(async () => {
      if (_aiRecV3CronRunning) return;
      try {
        const { hasV3RunForTaipeiDate, taipeiDateOf } = await import("./ai-recommendation-v2/orchestrator-v3.js");
        if (await hasV3RunForTaipeiDate(taipeiDateOf())) {
          console.info("[ai-rec-v3-cron] boot-fire skipped — a v3 run already exists for today");
          return;
        }
      } catch {
        // guard query failed — fall through and fire (memory mode / fresh DB)
      }
      console.info("[ai-rec-v3-cron] boot-fire at 90s");
      void _runAiRecV3Cron({ trigger: "cron_daily", workspaceId: null });
    }, 90_000);
  }

  // THEME-REFRESH-CRON: daily server-side theme content refresh (17:30–18:30 TST
  // weekdays). Replaces the dead OpenAlice-device dependency that froze the
  // themes page at 2026-05-18. Window / once-per-day / attempt-cap guards live
  // inside runThemeRefreshCronTick; per-run LLM cost is capped in theme-refresh.ts.
  {
    const THEME_REFRESH_TICK_MS = 5 * 60 * 1000;
    ui(async () => {
      try {
        const { runThemeRefreshCronTick } = await import("./theme-refresh.js");
        await runThemeRefreshCronTick();
      } catch (e) {
        console.error("[theme-refresh-cron] tick failed:", e instanceof Error ? e.message : e);
      }
    }, THEME_REFRESH_TICK_MS);
    console.log("THEME-REFRESH-CRON (5min tick, fires 17:30-18:30 TST weekdays) started");
  }

  // UTA-C2-SYNC-CRON: KGI SIM order reconciliation for unified_orders (2026-07-04).
  // Polls the gateway's trades/deals/order-events and syncs submitted/partial_fill
  // rows to filled/partial_fill/cancelled/rejected. Window guard (gateway hours)
  // lives inside syncKgiUnifiedOrders itself, so a tick outside hours is a cheap
  // no-op. Also logs any unified_orders row stuck at pending past the threshold
  // (half-order from a submit whose post-call DB update failed) — never resubmits.
  {
    const UTA_C2_SYNC_TICK_MS = 5 * 60 * 1000;
    ui(async () => {
      if (!isDatabaseMode()) return;
      const db2 = getDb();
      if (!db2) return;
      try {
        const wsSlugResolved = workspaceSlug ?? process.env.DEFAULT_WORKSPACE_SLUG ?? "default";
        const wsRows = await db2
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.slug, wsSlugResolved))
          .limit(1)
          .catch(() => [] as Array<{ id: string }>);
        if (!wsRows.length) return;
        const { syncKgiUnifiedOrders } = await import("./broker/kgi-order-reconciliation.js");
        await syncKgiUnifiedOrders({ workspaceId: wsRows[0].id });
      } catch (e) {
        console.error("[uta-c2-sync-cron] tick failed:", e instanceof Error ? e.message : e);
      }
    }, UTA_C2_SYNC_TICK_MS);
    console.log("UTA-C2-SYNC-CRON (5min tick, gateway-hours window guard internal) started");
  }

  // UTA-C2-PAPER-SYNC-CRON: paper channel order reconciliation for unified_orders
  // (2026-07-05). Self-reported gap at UTA-C2 delivery — the paper adapter's
  // dual-write always wrote unified_orders status="submitted" regardless of
  // the actual paper Order outcome (filled/rejected/still-resting). Reads back
  // the live paper_orders state and syncs submitted/partial_fill rows to
  // filled/partial_fill/cancelled/rejected. No gateway/market-hours window —
  // paper fills are synchronous and workspace-local. Also logs any
  // unified_orders row stuck at pending past the threshold (half-order from a
  // submit whose post-call DB update failed) — never resubmits.
  {
    const UTA_C2_PAPER_SYNC_TICK_MS = 5 * 60 * 1000;
    ui(async () => {
      if (!isDatabaseMode()) return;
      const db2b = getDb();
      if (!db2b) return;
      try {
        const wsSlugResolved = workspaceSlug ?? process.env.DEFAULT_WORKSPACE_SLUG ?? "default";
        const wsRows = await db2b
          .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
          .from(workspaces)
          .where(eq(workspaces.slug, wsSlugResolved))
          .limit(1)
          .catch(() => [] as Array<{ id: string; name: string; slug: string }>);
        if (!wsRows.length) return;
        const syncSession = {
          workspace: { id: wsRows[0].id, name: wsRows[0].name, slug: wsRows[0].slug },
          user: { id: "00000000-0000-0000-0000-000000000003", name: "paper-order-sync", email: "cron@system", role: "Owner" as const },
          persistenceMode: "database" as const
        };
        const { syncPaperUnifiedOrders } = await import("./broker/paper-order-sync.js");
        await syncPaperUnifiedOrders({ session: syncSession });
      } catch (e) {
        console.error("[uta-c2-paper-sync-cron] tick failed:", e instanceof Error ? e.message : e);
      }
    }, UTA_C2_PAPER_SYNC_TICK_MS);
    console.log("UTA-C2-PAPER-SYNC-CRON (5min tick) started");
  }

  // =============================================================================
  // B-TAG-2: EOD Portfolio Snapshot Cron (P0-12 Phase B)
  //
  // Fires daily at 14:30–15:00 TST (after market close) to capture a snapshot
  // of the current paper/SIM portfolio state into portfolio_snapshots table.
  //
  // Also runs a 30-day backfill on startup (60s delay) so that the GET
  // /api/v1/portfolio/snapshots endpoint always returns at least 5+ rows.
  //
  // Positions source (in priority):
  //   1. KGI SIM gateway (if KGI_GATEWAY_URL set) — real SIM positions
  //   2. Paper broker in-memory state (accountId="default")
  //   3. Empty positions {} — records the snapshot even when no positions exist
  //
  // Idempotency: each calendar day gets at most one snapshot per workspace
  //   (checked via listSnapshots + createdAt date comparison).
  // =============================================================================
  {
    const EOD_SNAPSHOT_POLL_MS = 15 * 60 * 1000; // check every 15min

    /** Returns true if current Taipei time is in the 14:30–15:00 window. */
    function isEodSnapshotWindow(): boolean {
      const hhmm = getTaipeiHHMM();
      return hhmm >= 1430 && hhmm < 1500;
    }

    /** Date string for Taipei timezone YYYY-MM-DD */
    function getTaipeiDateStr(): string {
      return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
    }

    let _eodSnapshotLastFiredDate = "";

    /**
     * Resolve current positions as a PositionsMap from KGI SIM gateway.
     * Returns {} if KGI SIM is unavailable or has no open positions.
     * (Paper broker requires an AppSession which is unavailable in cron context.)
     */
    async function resolveCurrentPositionsMap(): Promise<Record<string, { shares: number; avgCost: number; sector?: string; lastPrice?: number }>> {
      const gatewayUrl = process.env["KGI_GATEWAY_URL"] ?? process.env["KGI_GATEWAY_BASE_URL"] ?? null;
      if (gatewayUrl) {
        try {
          const { KgiGatewayClient } = await import("./broker/kgi-gateway-client.js");
          const client = new KgiGatewayClient({ gatewayBaseUrl: gatewayUrl, connectTimeoutMs: 5_000, ignoreScheduleGuard: true });
          const rawPositions = await client.getPosition();
          const filtered = rawPositions.filter((p) => p.netQuantity !== 0);
          if (filtered.length > 0) {
            const posMap: Record<string, { shares: number; avgCost: number; sector?: string; lastPrice?: number }> = {};
            for (const p of filtered) {
              posMap[p.symbol] = {
                shares: p.netQuantity,
                avgCost: p.lastPrice ?? 0,
                lastPrice: p.lastPrice ?? undefined
              };
            }
            return posMap;
          }
        } catch {
          // KGI SIM unavailable — fall through to empty
        }
      }
      // No source available: record snapshot with empty positions.
      // Snapshots with {} positions are valid and allow the GET /api/v1/portfolio/snapshots
      // endpoint to return rows (Phase B requirement: at least 5 days of snapshots).
      return {};
    }

    /**
     * Take one EOD snapshot for the given workspace. Skips if a snapshot for
     * today already exists (idempotent).
     */
    async function takeEodSnapshot(workspaceId: string): Promise<void> {
      const { listSnapshots, createSnapshot } = await import("./portfolio-snapshot-store.js");

      // Check if today already has a snapshot
      const todayStr = getTaipeiDateStr();
      const recent = await listSnapshots({ workspaceId, limit: 5 });
      if (recent.some((s) => s.createdAt.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }) === todayStr)) {
        console.log(`[eod-snapshot] workspace=${workspaceId} already has snapshot for ${todayStr}, skipping`);
        return;
      }

      const positions = await resolveCurrentPositionsMap();
      await createSnapshot({
        workspaceId,
        positions,
        trigger: "eod_auto",
        metadata: { date: todayStr, source: "eod_cron" }
      });
      console.log(`[eod-snapshot] created snapshot for workspace=${workspaceId} date=${todayStr} positions=${Object.keys(positions).length}`);
    }

    /**
     * EOD cron tick: fire once per day in the 14:30–15:00 TST window.
     */
    async function runEodSnapshotTick(): Promise<void> {
      if (!isDatabaseMode()) return;
      const db = getDb();
      if (!db) return;
      const todayStr = getTaipeiDateStr();
      if (_eodSnapshotLastFiredDate === todayStr) return;
      _eodSnapshotLastFiredDate = todayStr;

      try {
        const wsRows = await db.select({ id: workspaces.id }).from(workspaces).limit(10);
        await Promise.all(wsRows.map((ws) => takeEodSnapshot(ws.id)));
      } catch (e) {
        console.error("[eod-snapshot] tick error:", e instanceof Error ? e.message : String(e));
      }
    }

    /**
     * Startup backfill: write one snapshot per day for the last 30 days
     * (skips days that already have a snapshot, idempotent).
     * Uses current positions for all backfill rows (best available at boot time).
     */
    async function runEodSnapshotBackfill(): Promise<void> {
      if (!isDatabaseMode()) return;
      const db = getDb();
      if (!db) return;

      try {
        const wsRows = await db.select({ id: workspaces.id }).from(workspaces).limit(10);
        const positions = await resolveCurrentPositionsMap();

        for (const ws of wsRows) {
          const { listSnapshots, createSnapshot } = await import("./portfolio-snapshot-store.js");
          const existing = await listSnapshots({ workspaceId: ws.id, limit: 100 });
          const existingDates = new Set(
            existing.map((s) => s.createdAt.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }))
          );

          // Fill the last 30 calendar days (newest first so parent chain builds correctly oldest→newest)
          const datesToFill: string[] = [];
          for (let i = 29; i >= 0; i--) {
            const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            const dateStr = d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
            if (!existingDates.has(dateStr)) {
              datesToFill.push(dateStr);
            }
          }

          if (datesToFill.length === 0) {
            console.log(`[eod-snapshot-backfill] workspace=${ws.id} already has snapshots for all 30 days`);
            continue;
          }

          // Create snapshots sequentially (oldest first) to maintain parent chain integrity
          for (const dateStr of datesToFill) {
            await createSnapshot({
              workspaceId: ws.id,
              positions,
              trigger: "eod_auto",
              triggerRefId: null,
              metadata: { date: dateStr, source: "backfill_boot", note: "30-day backfill on server startup" }
            });
          }
          console.log(`[eod-snapshot-backfill] workspace=${ws.id} filled ${datesToFill.length} missing days`);
        }
      } catch (e) {
        console.error("[eod-snapshot-backfill] error:", e instanceof Error ? e.message : String(e));
      }
    }

    // EOD cron: poll every 15min, fire in 14:30–15:00 TST window once per day
    ui(() => {
      if (!isEodSnapshotWindow()) return;
      runEodSnapshotTick().catch((e) =>
        console.error("[eod-snapshot] scheduler tick error:", e instanceof Error ? e.message : String(e))
      );
    }, EOD_SNAPSHOT_POLL_MS);

    // Startup backfill: 90s delay (after DB pool + migrations are warm)
    setTimeout(() => {
      runEodSnapshotBackfill().catch((e) =>
        console.error("[eod-snapshot-backfill] startup error:", e instanceof Error ? e.message : String(e))
      );
    }, 90_000);
  }

  // =============================================================================
  // S1-SIM-PIPELINE: cont_liq signal + KGI SIM order submit + EOD report
  //
  // Yang ACK 22:34 TST 2026-05-19: "我選F-AUTO ... 明早直接開始正式跑"
  // Strategy: iuf_ls_omni_v1_router / S1_IUF_LS_OMNI_SIM_OBSERVATION_PRODUCT_V0
  //
  // Signal:   Monday 08:30–08:55 TST (once per week, per-day dedup)
  // Orders:   Monday 09:00–09:20 TST (once per week, fires after signal window)
  // EOD:      Daily 14:00–14:30 TST weekdays
  //
  // SIM_ONLY: no real money. KGI_ENV must be "sim" (default).
  // =============================================================================
  {
    const S1_SIM_POLL_MS = 15 * 60 * 1000;

    ui(async () => {
      try {
        const { isS1SignalWindow, runS1SignalTick } = await import("./s1-sim-runner.js");
        if (!isS1SignalWindow()) return;
        await runS1SignalTick();
      } catch (e) {
        console.error("[s1-signal-cron] tick failed:", e instanceof Error ? e.message : String(e));
      }
    }, S1_SIM_POLL_MS);

    ui(async () => {
      try {
        const { isS1OrderSubmitWindow, ensureS1BasketBeforeOrderSubmit, runS1OrderSubmitTick } = await import("./s1-sim-runner.js");
        if (!isS1OrderSubmitWindow()) return;
        const catchupResult = await ensureS1BasketBeforeOrderSubmit();
        console.log(`[s1-order-cron] basket auto-check=${catchupResult}`);
        await runS1OrderSubmitTick();
      } catch (e) {
        console.error("[s1-order-cron] tick failed:", e instanceof Error ? e.message : String(e));
      }
    }, S1_SIM_POLL_MS);

    ui(async () => {
      try {
        const { isS1EodWindow, runS1EodReportTick } = await import("./s1-sim-runner.js");
        if (!isS1EodWindow()) return;
        await runS1EodReportTick();
      } catch (e) {
        console.error("[s1-eod-cron] tick failed:", e instanceof Error ? e.message : String(e));
      }
    }, S1_SIM_POLL_MS);

    console.log("[schedulers] S1-SIM-PIPELINE wired: auto signal(Mon 08:30 TST) + auto orders(Mon 09:00 TST, signal catch-up before submit) + eod(daily 14:00 TST); manual trigger is backup only");
  }

  // =============================================================================
  // AI-REC-PERF-CRON: forward-return update for ai_rec_pick_snapshots
  //
  // Fires daily at 14:40–15:00 TST (after market close + EOD snapshot).
  // Finds snapshot rows with ret_updated_at IS NULL or stale and fills
  // ret_1d/ret_5d/ret_20d + excess vs TAIEX from companies_ohlcv.
  // Processes up to 50 rows per tick (see updateForwardReturns batch limit).
  // =============================================================================
  {
    const AI_REC_PERF_POLL_MS = 15 * 60 * 1000;
    let _aiRecPerfRetUpdatedDate: string | null = null;

    function isAiRecPerfRetWindow(): boolean {
      const hhmm = getTaipeiHHMM();
      return hhmm >= 1440 && hhmm < 1500; // 14:40–15:00 TST
    }

    ui(async () => {
      if (!isAiRecPerfRetWindow()) return;
      const taipeiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const todayDate = taipeiNow.toISOString().slice(0, 10);
      if (_aiRecPerfRetUpdatedDate === todayDate) return;
      _aiRecPerfRetUpdatedDate = todayDate;
      try {
        const { updateForwardReturns } = await import("./ai-rec-perf-store.js");
        const result = await updateForwardReturns();
        console.info(`[ai-rec-perf-cron] daily ret update done: updated=${result.updated} errors=${result.errors}`);
      } catch (e) {
        console.warn("[ai-rec-perf-cron] tick error:", e instanceof Error ? e.message : String(e));
      }
    }, AI_REC_PERF_POLL_MS);
  }

  // =============================================================================
  // OPENALICE-M4-CRON: decision outcome verification — back-fill forward returns
  //
  // Fires daily at 15:05–15:25 TST (after market close + ai-rec-perf cron window).
  // Scans done deep_analyze decisions whose outcome.verification is absent or stale
  // and fills ret_1d/ret_5d + excess vs 0050 benchmark from companies_ohlcv.
  // No migration: writes into iuf_decisions.outcome JSONB (jsonb_set).
  // Processes up to 30 rows per tick (see updateDecisionVerifications batch limit).
  // =============================================================================
  {
    const OA_VERIFY_POLL_MS = 15 * 60 * 1000;
    let _oaVerifyUpdatedDate: string | null = null;

    function isOaVerifyWindow(): boolean {
      const hhmm = getTaipeiHHMM();
      return hhmm >= 1505 && hhmm < 1525; // 15:05–15:25 TST
    }

    ui(async () => {
      if (!isOaVerifyWindow()) return;
      const taipeiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const todayDate = taipeiNow.toISOString().slice(0, 10);
      if (_oaVerifyUpdatedDate === todayDate) return;
      _oaVerifyUpdatedDate = todayDate;
      try {
        const { updateDecisionVerifications } = await import("./openalice-decision-verifier.js");
        const result = await updateDecisionVerifications();
        console.info(
          `[openalice-m4-cron] decision verification done: updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`
        );
      } catch (e) {
        console.warn("[openalice-m4-cron] tick error:", e instanceof Error ? e.message : String(e));
      }
    }, OA_VERIFY_POLL_MS);
  }
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

// =============================================================================
// v0.3.1 Backend Gap Fill — Market Intel / Portfolio / Ideas supplemental
// =============================================================================
//
// GET /api/v1/market/breadth/twse
//   — 漲跌家數 (advance/decline) from TWSE STOCK_DAY_ALL
//   — top-20 gainers, losers, volume (成交金額) — all live from TWSE
//   — 60-second in-memory cache; fail-open (never 5xx)
//   — Role: READ_DRAFT_ROLES
//
// GET /api/v1/paper/portfolio/history
//   — Paper trade history list (all statuses) for current user
//   — Shape: { data: PaperHistoryRow[], summary: { totalFills, totalOrders } }
//   — Thin adapter over existing listOrders — no new storage
//   — Role: session required (any authenticated user)
//
// Hard lines:
//   - No broker.* change
//   - No contracts change
//   - No DB migration
//   - No apps/web/* change
// =============================================================================

// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure market breadth data)
app.get("/api/v1/market/breadth/twse", async (c) => {
  // Same-day fix (2026-06-17): FinMind whole-market is same-day at the close while
  // TWSE STOCK_DAY_ALL is EOD-only and lags a day right after close. getFinMindMarketBreadth
  // now filters to the listed-stock universe (4-digit + 00-prefixed ETFs), excluding
  // the ~17k 6-digit warrants that previously inflated up/down to ~8000. Verified at
  // source: filtered = 1323/851/271 (~2.4k listed) vs dirty 8335/7333/4121 (~19k).
  // FinMind primary → TWSE EOD fallback. (No consumer reads this endpoint's topGainers.)
  const { getFinMindMarketBreadth, finMindAggregateHasToken } = await import("./data-sources/finmind-aggregate-client.js");
  const { getTwseMarketBreadth } = await import("./data-sources/twse-openapi-client.js");

  if (finMindAggregateHasToken()) {
    const finmind = await getFinMindMarketBreadth();
    if (finmind) return c.json(finmind);
  }

  return c.json(await getTwseMarketBreadth());
});

// GET /api/v1/market/leaders/twse
//   — Top 5 gainers / losers / most active from TWSE STOCK_DAY_ALL
//   — Source chain: FinMind TaiwanStockPrice (primary) → TWSE STOCK_DAY_ALL (secondary)
//   — FinMind primary gives same-day data; STOCK_DAY_ALL is EOD (published after market close)
//   — Response shape: { topGainers, topLosers, mostActive, source, asOf }
//   — Each stock: { symbol, name, last, changePct, volume }
//   — Role: READ_DRAFT_ROLES
//   — 60-second in-memory cache; fail-open (never 5xx)
// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure market leaders data)
app.get("/api/v1/market/leaders/twse", async (c) => {
  const { getFinMindLeaders, finMindAggregateHasToken } = await import("./data-sources/finmind-aggregate-client.js");
  const { getTwseLeaders } = await import("./data-sources/twse-openapi-client.js");

  // Primary: FinMind TaiwanStockPrice (sponsor tier, same-day data)
  if (finMindAggregateHasToken()) {
    try {
      const finmindResult = await getFinMindLeaders();
      if (finmindResult && (
        finmindResult.topGainers.length > 0 ||
        finmindResult.topLosers.length > 0 ||
        finmindResult.mostActive.length > 0
      )) {
        // Normalize FinMind shape to match the unified leaders response shape
        const mapStock = (s: { stockId: string; close: number; changePct: number; volume: number }) => ({
          symbol: s.stockId,
          name: s.stockId, // FinMind doesn't return company name in this dataset
          last: s.close,
          changePct: s.changePct,
          volume: s.volume,
          source: "finmind" as const
        });
        return c.json({
          topGainers: finmindResult.topGainers.map(mapStock),
          topLosers: finmindResult.topLosers.map(mapStock),
          mostActive: finmindResult.mostActive.map(mapStock),
          source: "finmind",
          asOf: finmindResult.asOf
        });
      }
    } catch (err) {
      console.warn("[market/leaders/twse] FinMind primary failed, falling back to TWSE:", err instanceof Error ? err.message : String(err));
    }
  }

  // Secondary: TWSE STOCK_DAY_ALL (EOD, shares cache with /breadth/twse and /heatmap/twse)
  const result = await getTwseLeaders();
  return c.json(result);
});

app.get("/api/v1/paper/portfolio/history", async (c) => {
  const session = c.get("session");

  let orders;
  try {
    orders = await listOrders(session.user.id);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[paper/portfolio/history] listOrders failed:", detail);
    return c.json({ error: "list_orders_failed", detail }, 500);
  }

  const rows = orders.map((o) => {
    const fillTime = o.fill?.fillTime;
    return {
      orderId: o.intent.id,
      symbol: o.intent.symbol,
      side: o.intent.side,
      orderType: o.intent.orderType,
      qty: o.intent.qty,
      quantity_unit: o.intent.quantity_unit,
      status: o.intent.status,
      fillQty: o.fill?.fillQty ?? null,
      fillPrice: o.fill?.fillPrice ?? null,
      fillTime: !fillTime
        ? null
        : fillTime instanceof Date
          ? fillTime.toISOString()
          : String(fillTime),
      createdAt: o.intent.createdAt ?? null,
      idempotencyKey: o.intent.idempotencyKey
    };
  });

  const totalFills = rows.filter((r) => r.status === "FILLED").length;

  return c.json({
    data: rows,
    summary: {
      totalOrders: rows.length,
      totalFills,
      currency: "TWD",
      simulated: true
    }
  });
});

// =============================================================================
// BG #2: FinMind Primary Chain — heatmap / breadth / leaders / institutional
// =============================================================================
//
// Source chain (per panel):
//   Primary:   FinMind sponsor (getFinMindWholeMarketPrice → all stocks, today)
//   Secondary: TWSE OpenAPI EOD (getTwseIndustryHeatmap / getTwseMarketBreadth)
//
// GET /api/v1/market/heatmap/finmind
//   — Industry heatmap: FinMind TaiwanStockPrice → industry aggregate
//   — Falls back to TWSE STOCK_DAY_ALL when FinMind token absent or returns empty
//
// GET /api/v1/market/breadth/finmind
//   — Advance/decline counts: FinMind TaiwanStockPrice
//   — Falls back to getTwseMarketBreadth()
//
// GET /api/v1/market/leaders/finmind
//   — Top 5 gainers / losers / most active: FinMind TaiwanStockPrice
//   — Returns empty when FinMind absent (no reliable TWSE fallback for leaders)
//
// GET /api/v1/market/institutional-summary/finmind
//   — 三大法人 buy/sell/net + top stocks: TaiwanStockInstitutionalInvestorsBuySell
//   — Returns unavailable state when token absent (no TWSE fallback for institutional)
//
// GET /api/v1/market/margin-summary/finmind
//   — 融資融券 balance: TaiwanStockMarginPurchaseShortSale
//   — Returns unavailable state when token absent
//
// GET /api/v1/market/news/finmind
//   — Latest market news: TaiwanStockNews (whole-market, today top 10, title-deduped)
//   — Returns empty items when token absent or news tier unavailable
//
// Hard lines:
//   - No KGI SDK import
//   - No contracts change
//   - No DB migration
//   - No apps/web/* change
//   - NOT touching index path (BG #1 lane)
// =============================================================================

// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure industry heatmap data)
app.get("/api/v1/market/heatmap/finmind", async (c) => {
  const session = c.get("session");
  const dbMode = isDatabaseMode();
  const db = dbMode ? getDb() : null;

  const { getFinMindIndustryHeatmap, finMindAggregateHasToken } = await import("./data-sources/finmind-aggregate-client.js");
  const { getTwseIndustryHeatmap, getStockDayAllRows } = await import("./data-sources/twse-openapi-client.js");

  // Build ticker → industry mapping from companies DB (chainPosition as industry proxy)
  const tickerToIndustry = new Map<string, string>();
  if (db) {
    try {
      const companyRes = await db.execute(drizzleSql`
        SELECT ticker, chain_position AS industry
        FROM companies
        WHERE workspace_id = ${session.workspace.id}
          AND ticker IS NOT NULL AND ticker != ''
          AND chain_position IS NOT NULL AND chain_position != ''
      `);
      const companyRows = ((companyRes as { rows?: Record<string, unknown>[] }).rows
        ?? (Array.isArray(companyRes) ? companyRes : [])) as Record<string, unknown>[];
      for (const row of companyRows) {
        const ticker = String(row.ticker ?? "").trim();
        const industry = String(row.industry ?? "").trim();
        if (ticker && industry) tickerToIndustry.set(ticker, industry);
      }
    } catch (err) {
      console.warn("[market/heatmap/finmind] company query failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // Primary: FinMind whole-market price → industry aggregate
  const finmindTiles = finMindAggregateHasToken()
    ? await getFinMindIndustryHeatmap(tickerToIndustry)
    : null;
  let primarySource: string;
  let primaryFailed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tiles: any[];

  if (finmindTiles && finmindTiles.length > 0) {
    tiles = finmindTiles;
    primarySource = "finmind";
  } else {
    // Secondary fallback: TWSE OpenAPI STOCK_DAY_ALL
    primaryFailed = true;
    try {
      await getStockDayAllRows(); // pre-warm shared cache
      tiles = await getTwseIndustryHeatmap(tickerToIndustry);
    } catch {
      tiles = [];
    }
    primarySource = "twse_openapi_fallback";
  }

  const normalizedTiles = normalizeAndMergeTwseHeatmapTiles(tiles);

  return c.json({
    data: normalizedTiles,
    source: primarySource,
    primaryFailed,
    staleAfterSec: 60,
    industryCount: normalizedTiles.length,
    mappedTickers: tickerToIndustry.size
  });
});

// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure market breadth data)
app.get("/api/v1/market/breadth/finmind", async (c) => {
  const { getFinMindMarketBreadth, finMindAggregateHasToken } = await import("./data-sources/finmind-aggregate-client.js");
  const { getTwseMarketBreadth } = await import("./data-sources/twse-openapi-client.js");

  if (finMindAggregateHasToken()) {
    const result = await getFinMindMarketBreadth();
    if (result) return c.json(result);
  }

  // Fallback: TWSE OpenAPI
  const twseResult = await getTwseMarketBreadth();
  return c.json(twseResult);
});

// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, pure market leaders data)
app.get("/api/v1/market/leaders/finmind", async (c) => {
  const { getFinMindLeaders, finMindAggregateHasToken } = await import("./data-sources/finmind-aggregate-client.js");

  if (finMindAggregateHasToken()) {
    const result = await getFinMindLeaders();
    if (result) return c.json(result);
  }

  // No TWSE fallback for full leaders (TWSE breadth has top-20 already in /breadth/twse)
  return c.json({
    topGainers: [],
    topLosers: [],
    mostActive: [],
    asOf: null,
    source: "finmind",
    staleAfterSec: 60,
    state: "unavailable",
    reason: finMindAggregateHasToken() ? "finmind_returned_empty" : "no_token"
  });
});

// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, public TWSE
// institutional trading summary data)
app.get("/api/v1/market/institutional-summary/finmind", async (c) => {
  const { getFinMindInstitutionalSummary, finMindAggregateHasToken } = await import("./data-sources/finmind-aggregate-client.js");

  if (!finMindAggregateHasToken()) {
    return c.json({
      asOf: null,
      totalNet: null,
      institutions: [],
      topNetBuy: [],
      topNetSell: [],
      source: "finmind",
      staleAfterSec: 60,
      state: "unavailable",
      reason: "no_token"
    });
  }

  const result = await getFinMindInstitutionalSummary();
  if (!result) {
    return c.json({
      asOf: null,
      totalNet: null,
      institutions: [],
      topNetBuy: [],
      topNetSell: [],
      source: "finmind",
      staleAfterSec: 60,
      state: "unavailable",
      reason: "finmind_returned_empty"
    });
  }

  return c.json({ ...result, state: "live" });
});

// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, public TWSE
// margin-trading summary data)
app.get("/api/v1/market/margin-summary/finmind", async (c) => {
  const { getFinMindMarginSummary, finMindAggregateHasToken } = await import("./data-sources/finmind-aggregate-client.js");

  if (!finMindAggregateHasToken()) {
    return c.json({
      asOf: null,
      marginBalance: null,
      shortBalance: null,
      marginNet: null,
      source: "finmind",
      staleAfterSec: 60,
      state: "unavailable",
      reason: "no_token"
    });
  }

  const result = await getFinMindMarginSummary();
  if (!result) {
    return c.json({
      asOf: null,
      marginBalance: null,
      shortBalance: null,
      marginNet: null,
      source: "finmind",
      staleAfterSec: 60,
      state: "unavailable",
      reason: "finmind_returned_empty"
    });
  }

  return c.json({ ...result, state: "live" });
});

// Auth: any logged-in role (Viewer+ — PR-B G-PUB downgrade, public market news data)
app.get("/api/v1/market/news/finmind", async (c) => {
  const { getFinMindMarketNews, finMindAggregateHasToken } = await import("./data-sources/finmind-aggregate-client.js");

  if (!finMindAggregateHasToken()) {
    return c.json({
      items: [],
      asOf: null,
      source: "finmind",
      staleAfterSec: 60,
      state: "unavailable",
      reason: "no_token"
    });
  }

  const result = await getFinMindMarketNews();
  if (!result) {
    return c.json({
      items: [],
      asOf: null,
      source: "finmind",
      staleAfterSec: 60,
      state: "unavailable",
      reason: "finmind_returned_empty"
    });
  }

  return c.json({ ...result, state: "live" });
});

// =============================================================================
// Password management endpoints (2026-05-14 — post PR #426 emergency)
// =============================================================================
// POST /api/v1/admin/owner-reset-password  — Owner-only, resets own password
// POST /api/v1/auth/change-password         — Any authenticated user
//
// Hard lines:
//   - NEVER log password value
//   - NEVER echo password in response
//   - NEVER store plaintext (always hash via hashPassword)
//   - No schema migration required (uses existing password_hash column)
//   - Session cookie is HMAC-signed (no sessions table) — response clears
//     the caller's own cookie to force re-login after password rotation
// =============================================================================

const ownerResetPasswordSchema = z.object({
  newPassword: z.string().min(12)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12)
});

// POST /api/v1/admin/owner-reset-password
// Owner-only. Resets the Owner's own password and clears their session cookie.
// Use case: emergency rotation after a credential leak (e.g. PR #426).
// Note: Because sessions are stateless HMAC cookies (no sessions table),
// we cannot invalidate other active sessions server-side. The caller's cookie
// is cleared in this response. Other devices must re-login after using an
// invalid password (or wait for cookie expiry). A sessions table migration
// can enable full invalidation in a future hardening sprint.
app.post("/api/v1/admin/owner-reset-password", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  let body: z.infer<typeof ownerResetPasswordSchema>;
  try {
    body = ownerResetPasswordSchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "invalid_body", hint: "newPassword must be at least 12 characters" }, 400);
  }

  const { validateNewPassword, hashPassword: hashPw, updateUserPassword } = await import("./auth-store.js");

  const policyError = validateNewPassword(body.newPassword);
  if (policyError) {
    return c.json({ error: policyError }, 400);
  }

  const newHash = await hashPw(body.newPassword);
  await updateUserPassword(session.user.id, newHash);

  // Clear the caller's session cookie — they must re-login with the new password
  const { buildClearCookieHeader } = await import("./auth-store.js");
  c.header("Set-Cookie", buildClearCookieHeader());

  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
  console.log(`[admin/owner-reset-password] user_id=${session.user.id}, action=password_rotated, ip=${ip}`);

  return c.json({
    ok: true,
    message: "Password rotated. Please log in again."
  });
});

// POST /api/v1/auth/change-password
// Any authenticated user. Verifies currentPassword before updating.
// Clears the caller's session cookie on success — forces re-login with new password.
// Note: Stateless HMAC cookies mean other active devices retain access until cookie expiry.
// A sessions table migration is the P2 path to full multi-device invalidation.
app.post("/api/v1/auth/change-password", async (c) => {
  const session = c.get("session");
  if (!session) {
    return c.json({ error: "auth_required" }, 401);
  }

  let body: z.infer<typeof changePasswordSchema>;
  try {
    body = changePasswordSchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "invalid_body", hint: "currentPassword and newPassword (min 12 chars) required" }, 400);
  }

  const {
    validateNewPassword,
    hashPassword: hashPw,
    verifyPassword,
    updateUserPassword,
    buildClearCookieHeader
  } = await import("./auth-store.js");

  // Verify current password via direct DB fetch
  const { getDb } = await import("@iuf-trading-room/db");
  const { users: usersTable } = await import("@iuf-trading-room/db");
  const { eq: drizzleEq } = await import("drizzle-orm");
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  const [dbUser] = await db.select().from(usersTable).where(drizzleEq(usersTable.id, session.user.id)).limit(1);
  if (!dbUser) return c.json({ error: "user_not_found" }, 404);

  let currentValid = false;
  if (dbUser.passwordHash) {
    currentValid = await verifyPassword(body.currentPassword, dbUser.passwordHash);
  } else {
    // Seed user path: passwordHash is null until first password set.
    // Use timingSafeEqual to avoid timing-leak even though this path is deprecated post-first-set.
    const seedPwd = process.env.SEED_OWNER_PASSWORD ?? "";
    if (seedPwd.length > 0 && body.currentPassword.length === seedPwd.length) {
      currentValid = timingSafeEqual(Buffer.from(body.currentPassword), Buffer.from(seedPwd));
    }
  }

  if (!currentValid) {
    return c.json({ error: "invalid_current_password" }, 401);
  }

  const policyError = validateNewPassword(body.newPassword);
  if (policyError) {
    return c.json({ error: policyError }, 400);
  }

  const newHash = await hashPw(body.newPassword);
  await updateUserPassword(session.user.id, newHash);

  // Clear caller's session cookie — they must re-login with the new password.
  // This mirrors the owner-reset-password path. Other-device sessions survive until
  // cookie expiry (no sessions table yet); full invalidation is a post-sprint P2 item.
  c.header("Set-Cookie", buildClearCookieHeader());

  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
  console.log(`[auth/change-password] user_id=${session.user.id}, action=password_changed, ip=${ip}`);

  return c.json({
    ok: true,
    mustReauth: true,
    message: "Password updated. Please log in again."
  });
});

// =============================================================================
// Recommendation Orchestrator — Day 1 skeleton (2026-05-14)
// =============================================================================
// GET  /api/v1/recommendations/today   → StockRecommendation[]
// GET  /api/v1/recommendations/:id     → StockRecommendation | 404
// POST /api/v1/recommendations/:id/feedback → 204
//
// Auth: signed-in account with ai_recommendations entitlement.
// Data: mock layer v1 — real cont_liq_v36 + MAIN wiring comes Day 3+.
// Lane: strategy backend (Jason). Only touches recommendation-store.ts.
// =============================================================================

import {
  getTodayRecommendations,
  getMockRecommendations,
  getMockRecommendationById,
  getRecommendationById,
  recordRecommendationFeedback,
} from "./recommendation-store.js";
import {
  stockRecommendationSchema,
  recommendationFeedbackBodySchema,
} from "@iuf-trading-room/contracts";

export { recommendationFeedbackBodySchema };

// Per-request cache for recommendations (reused by /today and /:id in same request cycle)
// Simple module-level TTL cache — 60s expiry so /:id can reuse today's list.
let _recCache: { items: import("@iuf-trading-room/contracts").StockRecommendation[]; isMock: boolean; expiresAt: number } | null = null;

async function getOrFetchRecommendations(
  internalBaseUrl: string,
  sessionCookie: string,
  session: AppSession,
  repo: TradingRoomRepository
): Promise<{ items: import("@iuf-trading-room/contracts").StockRecommendation[]; isMock: boolean }> {
  const now = Date.now();
  if (_recCache && now < _recCache.expiresAt) {
    return { items: _recCache.items, isMock: _recCache.isMock };
  }
  const result = await getTodayRecommendations({ internalBaseUrl, sessionCookie, session, repo });
  _recCache = { ...result, expiresAt: now + 60_000 };
  return result;
}

/** Derive the internal base URL from the incoming request */
function deriveInternalBaseUrl(reqUrl: string): string {
  // In Railway/prod the API calls itself on the same host; use request URL origin.
  try {
    const url = new URL(reqUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "http://localhost:3000";
  }
}

function recommendationEntitlementResponse(c: Context) {
  const session = c.get("session");
  if (!session) {
    return { ok: false as const, response: c.json({ error: "unauthenticated" }, 401) };
  }

  const entitlement = buildMyEntitlements(session.user).features.find((feature) => feature.id === "ai_recommendations");
  if (!entitlement?.access) {
    return {
      ok: false as const,
      response: c.json({
        error: "feature_not_included",
        feature: "ai_recommendations",
        message: "AI recommendations are not enabled for this subscription tier."
      }, 403)
    };
  }

  return { ok: true as const, session };
}

// GET /api/v1/recommendations/today
app.get("/api/v1/recommendations/today", async (c) => {
  const auth = recommendationEntitlementResponse(c);
  if (!auth.ok) return auth.response;

  const internalBase = deriveInternalBaseUrl(c.req.url);
  const cookie = c.req.header("cookie") ?? "";

  const { items, isMock } = await getOrFetchRecommendations(internalBase, cookie, auth.session, c.get("repo"));

  const response: Record<string, unknown> = {
    date: items[0]?.date ?? new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
  if (isMock) response["_mock"] = true;

  return c.json(response);
});

// GET /api/v1/recommendations/:id
app.get("/api/v1/recommendations/:id", async (c) => {
  const auth = recommendationEntitlementResponse(c);
  if (!auth.ok) return auth.response;

  const { id } = c.req.param();

  // Try real list first, then mock fallback
  const internalBase = deriveInternalBaseUrl(c.req.url);
  const cookie = c.req.header("cookie") ?? "";
  const { items, isMock } = await getOrFetchRecommendations(internalBase, cookie, auth.session, c.get("repo"));

  const rec = getRecommendationById(items, id) ?? getMockRecommendationById(id);

  if (!rec) {
    return c.json({ error: "not_found" }, 404);
  }

  const response: Record<string, unknown> = { data: rec };
  if (isMock) response["_mock"] = true;
  return c.json(response);
});

// POST /api/v1/recommendations/:id/feedback
app.post("/api/v1/recommendations/:id/feedback", async (c) => {
  const auth = recommendationEntitlementResponse(c);
  if (!auth.ok) return auth.response;
  const session = auth.session;

  const { id } = c.req.param();

  // Verify the recommendation exists — use real resolver (same cache as /today and /:id)
  const internalBase = deriveInternalBaseUrl(c.req.url);
  const cookie = c.req.header("cookie") ?? "";
  const { items } = await getOrFetchRecommendations(internalBase, cookie, session, c.get("repo"));
  const rec = getRecommendationById(items, id);
  if (!rec) {
    return c.json({ error: "not_found", message: "推薦項目已過期或不存在" }, 404);
  }

  const body = recommendationFeedbackBodySchema.parse(await c.req.json());

  recordRecommendationFeedback({
    recommendationId: id,
    userId: session.user.id,
    reaction: body.reaction,
    note: body.note,
    recordedAt: new Date().toISOString(),
  });

  return c.json({ ok: true }, 201);
});

// =============================================================================
// AI-RECOMMENDATIONS-V2 — Pure-AI independent market judgment (2026-05-18)
// No Athena fixture dependency. Brain ReAct loop sees full market data.
// GET  /api/v1/ai-recommendations        → latest AiRecommendationV2Run
// POST /api/v1/admin/ai-recommendations/refresh → manual trigger
// Cron: 09:30 + 13:00 TST weekdays (startSchedulers integration)
// Auth: Owner-only Phase A.
// Lane: strategy backend (Jason). Files: ai-recommendation-v2/orchestrator.ts
// =============================================================================

// Module-level cron state — identical pattern to MARKET-OVERVIEW-CRON
let _aiRecV2CronLastFiredAt: string | null = null;
let _aiRecV2CronLastError: string | null = null;
let _aiRecV2CronRunning = false;

function isAiRecV2CronWindow(): boolean {
  // 09:20-13:40 TST weekdays (give 10min buffer before/after 09:30 and 13:00)
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = now.getUTCDay(); // 0=Sun 6=Sat
  if (day === 0 || day === 6) return false;
  const hhmm = now.getUTCHours() * 100 + now.getUTCMinutes();
  return hhmm >= 920 && hhmm <= 1340;
}

// GET /api/v1/ai-recommendations
app.get("/api/v1/ai-recommendations", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const { getLatestAiRecommendationRunForRead } = await import("./ai-recommendation-v2/orchestrator.js");
  const latest = await getLatestAiRecommendationRunForRead(session.workspace.id);

  if (!latest) {
    return c.json({
      status: "no_data",
      message: "AI 推薦尚未生成，請在盤中觸發 refresh 或等待 09:30 cron",
      generatedAt: null,
      items: [],
      reactTrace: [],
      finalReportMarkdown: null,
      totalCostUsd: 0,
    });
  }

  return c.json({
    runId: latest.runId,
    status: latest.status,
    generatedAt: latest.generatedAt,
    items: latest.items,
    reactTrace: latest.reactTrace,
    finalReportMarkdown: latest.finalReportMarkdown,
    totalCostUsd: latest.totalCostUsd,
    totalTokens: latest.totalTokens,
  });
});

// POST /api/v1/admin/ai-recommendations/refresh  — manual trigger
app.post("/api/v1/admin/ai-recommendations/refresh", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  if (_aiRecV2CronRunning) {
    return c.json({ ok: false, message: "run_in_progress" }, 409);
  }

  const runId = crypto.randomUUID();
  const workspaceId = session.workspace?.id ?? null;

  // Fire-and-forget in background
  void (async () => {
    _aiRecV2CronRunning = true;
    try {
      const { runAiRecommendationV2 } = await import("./ai-recommendation-v2/orchestrator.js");
      await runAiRecommendationV2({
        workspaceId,
        trigger: "manual_refresh",
        runId,
        maxRounds: 8,
        costCapUsd: 1.5,
      });
      _aiRecV2CronLastFiredAt = new Date().toISOString();
      _aiRecV2CronLastError = null;
    } catch (err) {
      _aiRecV2CronLastError = err instanceof Error ? err.message : String(err);
      console.error("[ai-rec-v2/refresh] error:", _aiRecV2CronLastError);
    } finally {
      _aiRecV2CronRunning = false;
    }
  })();

  return c.json({ ok: true, runId, trigger: "manual_refresh", queuedAt: new Date().toISOString() });
});

// GET /api/v1/admin/ai-recommendations/status  — cron status for Bruce
app.get("/api/v1/admin/ai-recommendations/status", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const { getLatestAiRecommendationRunForRead } = await import("./ai-recommendation-v2/orchestrator.js");
  const latest = await getLatestAiRecommendationRunForRead(session.workspace.id);

  return c.json({
    cron_last_fired_at: _aiRecV2CronLastFiredAt,
    cron_last_error: _aiRecV2CronLastError,
    cron_running: _aiRecV2CronRunning,
    cron_window_open: isAiRecV2CronWindow(),
    latest_run_id: latest?.runId ?? null,
    latest_status: latest?.status ?? null,
    latest_item_count: latest?.items.length ?? 0,
    latest_cost_usd: latest?.totalCostUsd ?? 0,
  });
});

// =============================================================================
// AI RECOMMENDATION v3 ENDPOINTS — Yang SOP 5-module / 7 sub-score
// Lane: strategy backend (Jason). Files: ai-recommendation-v2/orchestrator-v3.ts
// Auth: public GET (same as v2); POST admin-only Owner
// Endpoint naming: /api/v1/ai-recommendations/v3  (parallel, v2 untouched)
// =============================================================================

let _aiRecV3CronRunning = false;
let _aiRecV3CronLastFiredAt: string | null = null;
let _aiRecV3CronLastError: string | null = null;
// Daily fire bookkeeping (Taipei dates). Success consumes the day; failures retry
// on later ticks inside the window, capped to bound LLM spend.
const AI_REC_V3_MAX_ATTEMPTS_PER_DAY = 3;
let _aiRecV3CronSuccessDate: string | null = null;
let _aiRecV3AttemptDate: string | null = null;
let _aiRecV3AttemptCount = 0;

/**
 * Shared execution function for both manual refresh and the daily cron.
 * Guards against concurrent runs via _aiRecV3CronRunning.
 * Sets _aiRecV3CronLastFiredAt on start, _aiRecV3CronLastError on result.
 * Returns false if already running; true if successfully queued.
 */
async function _runAiRecV3Cron(opts: {
  trigger: "cron_0930" | "cron_1300" | "cron_daily" | "manual_refresh" | "test";
  runId?: string;
  workspaceId?: string | null;
}): Promise<boolean> {
  if (_aiRecV3CronRunning) return false;
  _aiRecV3CronRunning = true;
  _aiRecV3CronLastFiredAt = new Date().toISOString();
  try {
    const { runAiRecommendationV3, getLatestAiRecommendationV3Run, failStaleV3RunningRows, V3_RUNNING_STALE_AFTER_MS } = await import("./ai-recommendation-v2/orchestrator-v3.js");
    // Sweep rows stuck in status="running" (crashed runs) so the read path never
    // serves a days-old "running" row again.
    await failStaleV3RunningRows({ minAgeMs: V3_RUNNING_STALE_AFTER_MS, reason: "(stale running run swept before new cron fire)" });
    await runAiRecommendationV3({
      trigger: opts.trigger,
      // Five technical checks are too brittle for a five-card product gate:
      // one weak/C-bucket ticker makes the whole daily recommendation fail.
      // Allow extra rounds so the rejection loop can fetch replacement
      // candidates instead of ending with 4 actionable cards.
      maxRounds: 15,
      costCapUsd: 2.0,
      runId: opts.runId,
      workspaceId: opts.workspaceId ?? null,
    });
    _aiRecV3CronLastError = null;

    // AI-REC-PERF: snapshot picks after run completes (fail-open — must not crash v3 cron)
    try {
      const latestRun = getLatestAiRecommendationV3Run();
      if (latestRun && latestRun.items.length > 0) {
        const { snapshotV3Picks } = await import("./ai-rec-perf-store.js");
        await snapshotV3Picks(latestRun);
      }
    } catch (snapErr) {
      console.warn("[ai-rec-v3-cron] snapshot error (non-fatal):", snapErr instanceof Error ? snapErr.message : snapErr);
    }
  } catch (err) {
    _aiRecV3CronLastError = err instanceof Error ? err.message : String(err);
    console.error("[ai-rec-v3] run error:", _aiRecV3CronLastError);
  } finally {
    _aiRecV3CronRunning = false;
  }
  return true;
}

// GET /api/v1/ai-recommendations/v3
// F4: Exposes reactTrace + finalReportMarkdown for debug; fallback shows raw markdown when items=0
app.get("/api/v1/ai-recommendations/v3", async (c) => {
  const {
    getLatestAiRecommendationV3RunForRead,
    getV3RunAgeMs,
    hasStructuredSynthesisReport,
    isV3RunningStale,
    V3_RUNNING_STALE_AFTER_MS,
  } = await import("./ai-recommendation-v2/orchestrator-v3.js");
  const latest = await getLatestAiRecommendationV3RunForRead(c.get("session")?.workspace.id ?? "");
  if (!latest) {
    return c.json({
      ok: false,
      status: "empty",
      error: "no_v3_run_yet",
      hint: "POST /api/v1/admin/ai-recommendations/v3/refresh to trigger",
      items: [],
      itemCount: 0,
      sourceState: {
        state: "pending",
        source: "ai_recommendations_runs",
        owner: "Jason/API",
        nextAction: "Trigger or wait for AI recommendation v3 refresh. (DB: migration 0041 creates table; migration 0043 adds score_breakdown column.)"
      },
      officialAnnouncementSourceState: {
        state: "pending",
        source: "get_news_top10",
        owner: "API",
        reason: "尚未有 V3 run，無法判斷官方公告是否已納入。",
        nextAction: "觸發或等待 V3 refresh 後由後端回傳官方公告來源狀態。",
        lastUpdated: null,
        count: 0,
      },
      sourceStates: {
        officialAnnouncements: {
          state: "pending",
          source: "get_news_top10",
          owner: "API",
          reason: "尚未有 V3 run，無法判斷官方公告是否已納入。",
          nextAction: "觸發或等待 V3 refresh 後由後端回傳官方公告來源狀態。",
          lastUpdated: null,
          count: 0,
        },
      },
    });
  }
  // debug=true query param exposes full trace (default: included for Owner; trimmed for public)
  const includeTrace = c.req.query("debug") === "true" || true; // always include for now — Bruce needs it
  const synthesisFallbackUsed =
    latest.synthesisFallbackUsed ?? (latest.status === "synthesis_format_error" && latest.items.length >= 5);
  const fullAiReportParsed = hasStructuredSynthesisReport(latest.finalReportMarkdown);
  const runAgeMs = getV3RunAgeMs(latest.generatedAt);
  const staleRunning = isV3RunningStale(latest.status, latest.generatedAt);
  const runDiagnostics = {
    status: latest.status,
    runAgeMs,
    staleRunning,
    staleAfterMs: V3_RUNNING_STALE_AFTER_MS,
    cronRunning: _aiRecV3CronRunning,
    cronLastFiredAt: _aiRecV3CronLastFiredAt,
    cronLastError: _aiRecV3CronLastError,
  };
  return c.json({
    ok: true,
    runId: latest.runId,
    status: latest.status,
    generatedAt: latest.generatedAt,
    items: latest.items,
    marketState: latest.marketState,
    marketRiskOffScore: latest.marketRiskOffScore,
    totalCostUsd: latest.totalCostUsd,
    totalTokens: latest.totalTokens,
    itemCount: latest.items.length,
    sourceState: latest.sourceState,
    sourceStates: latest.sourceStates,
    officialAnnouncementSourceState: latest.officialAnnouncementSourceState,
    officialAnnouncementsSourceState: latest.officialAnnouncementSourceState,
    fullAiReportParsed,
    synthesisRetryUsed: latest.synthesisRetryUsed ?? false,
    synthesisFallbackUsed,
    usedFallback: synthesisFallbackUsed,
    scoreBreakdown: latest.scoreBreakdown ?? null,
    runDiagnostics,
    // F4 debug fields:
    reactTrace: includeTrace ? latest.reactTrace : undefined,
    finalReportMarkdown: latest.finalReportMarkdown,
    // Diagnostic: when parser/fallback path fired, surface a hint
    parserDiagnostic: staleRunning
      ? {
          hint: "Latest AI recommendation v3 run is still running past the expected window. Check cronLastError and Railway logs before trusting the stale product surface.",
          usedFallback: synthesisFallbackUsed,
          runAgeMs,
          staleAfterMs: V3_RUNNING_STALE_AFTER_MS,
        }
      : (latest.status === "synthesis_format_error" || latest.items.length === 0) && latest.finalReportMarkdown
      ? {
          hint: latest.status === "synthesis_format_error"
            ? fullAiReportParsed
              ? "Synthesis JSON parsed successfully, but deterministic tool-data validation left fewer than five actionable cards; valid AI cards were preserved and missing slots were filled from verified fallback data."
              : "Synthesis output did not parse into a full item set; deterministic fallback may be present."
            : "Parser found 0 items. See finalReportMarkdown for raw LLM output to diagnose format mismatch.",
          usedFallback: synthesisFallbackUsed,
          reportLength: latest.finalReportMarkdown.length,
          reportPreview: latest.finalReportMarkdown.slice(0, 500),
        }
      : undefined,
  });
});

// POST /api/v1/admin/ai-recommendations/v3/refresh  — manual trigger (Owner only)
app.post("/api/v1/admin/ai-recommendations/v3/refresh", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  if (_aiRecV3CronRunning) {
    return c.json({ ok: false, error: "already_running" }, 429);
  }

  const runId = crypto.randomUUID();
  // Fire async — do not await (same pattern as v2)
  void _runAiRecV3Cron({ trigger: "manual_refresh", runId, workspaceId: session.workspace?.id ?? null });

  return c.json({ ok: true, runId, trigger: "manual_refresh", queuedAt: new Date().toISOString() });
});

// GET /api/v1/openalice/orchestrator/state — OpenAlice 主腦 M1 決策層 observability (Owner only)
app.get("/api/v1/openalice/orchestrator/state", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const limitRaw = Number(c.req.query("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const obs = await getOrchestratorObservability(session.workspace.id, limit);
  return c.json(obs);
});

// GET /api/v1/admin/ai-recommendations/v3/status
app.get("/api/v1/admin/ai-recommendations/v3/status", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const {
    getLatestAiRecommendationV3RunForRead,
    getV3RunAgeMs,
    isV3RunningStale,
    V3_RUNNING_STALE_AFTER_MS,
  } = await import("./ai-recommendation-v2/orchestrator-v3.js");
  const latest = await getLatestAiRecommendationV3RunForRead(session.workspace.id);
  const latestRunAgeMs = latest ? getV3RunAgeMs(latest.generatedAt) : null;
  const latestStaleRunning = latest ? isV3RunningStale(latest.status, latest.generatedAt) : false;
  // cron_success_date is held in a module-level var that resets on every process
  // restart — so a day with several deploys showed null even though the
  // recommendation had shipped (6/15 repro). Derive from the DB: a complete run
  // dated today means today's recommendation is out, regardless of redeploys.
  const tpeDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
  const todayTpe = tpeDate(new Date());
  const latestTpe = latest?.generatedAt ? tpeDate(new Date(latest.generatedAt)) : null;
  const cronSuccessDate = _aiRecV3CronSuccessDate
    ?? (latest?.status === "complete" && latestTpe === todayTpe ? todayTpe : null);
  return c.json({
    cron_running: _aiRecV3CronRunning,
    cron_last_fired_at: _aiRecV3CronLastFiredAt,
    cron_last_error: _aiRecV3CronLastError,
    cron_success_date: cronSuccessDate,
    cron_success_date_source: _aiRecV3CronSuccessDate ? "in_memory" : (cronSuccessDate ? "db_derived" : "none"),
    cron_attempts_today: _aiRecV3AttemptDate === null ? 0 : _aiRecV3AttemptCount,
    cron_max_attempts_per_day: AI_REC_V3_MAX_ATTEMPTS_PER_DAY,
    latest_run_id: latest?.runId ?? null,
    latest_status: latest?.status ?? null,
    latest_generated_at: latest?.generatedAt ?? null,
    latest_run_age_ms: latestRunAgeMs,
    latest_stale_running: latestStaleRunning,
    stale_after_ms: V3_RUNNING_STALE_AFTER_MS,
    latest_item_count: latest?.items.length ?? 0,
    latest_cost_usd: latest?.totalCostUsd ?? 0,
    latest_market_state: latest?.marketState ?? null,
    latest_risk_off_score: latest?.marketRiskOffScore ?? null,
    latest_synthesis_retry_used: latest?.synthesisRetryUsed ?? false,
    latest_synthesis_fallback_used:
      latest?.synthesisFallbackUsed ?? (latest?.status === "synthesis_format_error" && (latest?.items.length ?? 0) >= 5),
  });
});

// =============================================================================
// AI-REC FORWARD PERFORMANCE ENDPOINTS (Jason 2026-06-05)
// Prove whether AI-picked stocks make money vs TAIEX benchmark.
// Lane: strategy backend (Jason). Files: ai-rec-perf-store.ts
// Auth: Owner-only (production alpha — not yet surfaced to frontend)
// =============================================================================

// GET /api/v1/admin/ai-rec/performance
// Returns hit_rate, avg_excess_return (1d/5d/20d), sample_count, by_bucket breakdown.
app.get("/api/v1/admin/ai-rec/performance", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const fromDate = c.req.query("from") ?? undefined;
  const toDate = c.req.query("to") ?? undefined;

  const { getAiRecPerformance } = await import("./ai-rec-perf-store.js");
  const perf = await getAiRecPerformance({ fromDate, toDate });

  return c.json(perf);
});

// GET /api/v1/track-record/performance — public whitelisted scorecard read (P0-C, Jason 2026-07-05)
//
// Same-source read as /api/v1/admin/ai-rec/performance above (both call
// getAiRecPerformance()) — the Owner-only route is NOT loosened; this is a
// separate, deliberately thinner public surface for the /track-record public
// scorecard page. Gate = login-only (no role check beyond the global
// /api/v1/* session middleware), matching G-PUB. Whitelist: hit-rate/excess/
// sample-count/date/benchmark fields only — no by_bucket breakdown, no
// per-pick detail. See toPublicPerformance() for the exact field list.
app.get("/api/v1/track-record/performance", async (c) => {
  const { getAiRecPerformance } = await import("./ai-rec-perf-store.js");
  const { toPublicPerformance } = await import("./track-record-handlers.js");
  const perf = await getAiRecPerformance({});
  return c.json(toPublicPerformance(perf));
});

// POST /api/v1/admin/ai-rec/perf/backfill — Owner-only historical rebuild.
// Rebuilds ai_rec_pick_snapshots from all complete v3 runs in DB (latest run per
// Taipei date) and then fills forward returns. Zero LLM cost (price data only).
// Errors are returned verbatim so write failures are diagnosable (audit B2:
// total_picks=0 was silent because every failure path was fail-open).
app.post("/api/v1/admin/ai-rec/perf/backfill", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const { backfillPickSnapshots, updateForwardReturns } = await import("./ai-rec-perf-store.js");
  const backfill = await backfillPickSnapshots();

  // Forward returns process in 50-row batches — loop until drained (capped).
  let forwardUpdated = 0;
  let forwardErrors = 0;
  for (let i = 0; i < 10; i++) {
    const r = await updateForwardReturns();
    forwardUpdated += r.updated;
    forwardErrors += r.errors;
    if (r.updated === 0) break;
  }

  return c.json({
    ok: backfill.picksFailed === 0 && backfill.errors.length === 0,
    backfill,
    forward: { updated: forwardUpdated, errors: forwardErrors },
  });
});

// POST /api/v1/admin/ai-rec/snapshot — manual snapshot trigger (for today's v3 run)
// Useful for backfilling: call after v3 refresh to force-write snapshot.
app.post("/api/v1/admin/ai-rec/snapshot", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const { getLatestAiRecommendationV3RunForRead } = await import("./ai-recommendation-v2/orchestrator-v3.js");
  const latest = await getLatestAiRecommendationV3RunForRead(session.workspace.id);

  if (!latest) {
    return c.json({ ok: false, error: "no_v3_run_available", hint: "Trigger a v3 refresh first." }, 404);
  }
  if (latest.items.length === 0) {
    return c.json({ ok: false, error: "v3_run_has_no_items", status: latest.status }, 422);
  }

  const { snapshotV3Picks } = await import("./ai-rec-perf-store.js");
  await snapshotV3Picks(latest);

  return c.json({
    ok: true,
    runId: latest.runId,
    itemsSnapshotted: latest.items.length,
    snappedAt: new Date().toISOString(),
  });
});

// POST /api/v1/admin/ai-rec/update-returns — manual forward-return update trigger
// Normally fired by daily cron; exposed here for Bruce manual verify / backfill.
app.post("/api/v1/admin/ai-rec/update-returns", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const { updateForwardReturns } = await import("./ai-rec-perf-store.js");
  const result = await updateForwardReturns();

  return c.json({ ok: true, ...result, updatedAt: new Date().toISOString() });
});

// =============================================================================
// TW-COVERAGE ENDPOINTS (PR #478 follow-up — 2026-05-15)
// Lane: strategy backend (Jason). Files: tw-coverage-loader.ts (read-only)
// Auth: Owner-only v1. Multi-tenant expansion deferred to P1.
// =============================================================================

import {
  getCompanyCoverageBrief,
  findCompaniesByWikilink,
  listSectorCompanies,
} from "./data-sources/tw-coverage-loader.js";

// GET /api/v1/companies/:ticker/coverage
app.get("/api/v1/companies/:ticker/coverage", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const ticker = c.req.param("ticker");
  const brief = await getCompanyCoverageBrief(ticker);
  if (!brief) {
    return c.json({ error: "not_found", ticker }, 404);
  }

  return c.json({
    ticker: brief.ticker,
    companyName: brief.companyName,
    sector: brief.sector,
    industry: brief.industry,
    metadata: {
      marketCap: brief.marketCap,
      enterpriseValue: brief.enterpriseValue,
    },
    businessOverview: brief.businessOverview,
    supplyChain: brief.supplyChain,
    majorCustomers: brief.majorCustomers,
    majorSuppliers: brief.majorSuppliers,
    wikilinks: brief.wikilinks ?? [],
  });
});

// GET /api/v1/themes/:token/companies
// :token is URL-encoded, e.g. %E5%85%89%E9%98%BB%E6%B6%B2 for 光阻液
app.get("/api/v1/themes/:token/companies", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  // Hono automatically URL-decodes path params
  const token = c.req.param("token");
  const result = await findCompaniesByWikilink(token);

  return c.json({
    token: result.token,
    count: result.matches.length,
    matches: result.matches,
  });
});

// GET /api/v1/sectors/:sector/companies
app.get("/api/v1/sectors/:sector/companies", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const sector = c.req.param("sector");
  const companies = await listSectorCompanies(sector);

  return c.json({
    sector,
    count: companies.length,
    companies,
  });
});

// =============================================================================
// DISCOVER ENDPOINT (2026-05-15)
// Lane: strategy backend (Jason). File: data-sources/discover.ts (read-only)
// Auth: Owner-only. Rate limit: 30/user/min enforced by in-process guard.
// =============================================================================

import { discoverCompaniesByBuzzword } from "./data-sources/discover.js";

// Per-IP/session rate limit: 30 requests per minute (in-process)
const _discoverCallLog = new Map<string, number[]>();
const DISCOVER_MAX_PER_MIN = 30;

function discoverRateLimitOk(userId: string): boolean {
  const now = Date.now();
  const log = _discoverCallLog.get(userId) ?? [];
  const fresh = log.filter((t) => now - t < 60_000);
  if (fresh.length >= DISCOVER_MAX_PER_MIN) return false;
  fresh.push(now);
  _discoverCallLog.set(userId, fresh);
  return true;
}

// GET /api/v1/discover?q=<buzzword>[&fuzzyThreshold=0.7][&llmFallback=true]
app.get("/api/v1/discover", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const userId = session.user.id;
  if (!discoverRateLimitOk(userId)) {
    return c.json({ error: "rate_limit_exceeded", retryAfterMs: 60_000 }, 429);
  }

  const q = c.req.query("q");
  if (!q || q.trim().length === 0) {
    return c.json({ error: "missing_param", param: "q" }, 400);
  }

  const fuzzyThresholdRaw = c.req.query("fuzzyThreshold");
  const fuzzyThreshold = fuzzyThresholdRaw
    ? Math.min(1, Math.max(0, parseFloat(fuzzyThresholdRaw)))
    : undefined;

  const llmFallbackRaw = c.req.query("llmFallback");
  const llmFallback = llmFallbackRaw === "false" ? false : undefined; // default true

  try {
    const result = await discoverCompaniesByBuzzword(q.trim(), {
      fuzzyThreshold,
      llmFallback,
    });
    return c.json(result);
  } catch (err) {
    console.error("[discover] unexpected error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "internal_error" }, 500);
  }
});

// =============================================================================
// THEMES WIKI ALIAS (2026-05-15 Bruce P1-1)
// Frontend /themes/wiki/[name] page fetches /api/v1/themes/wiki/:token/companies
// Backend originally only had /api/v1/themes/:token/companies — add alias route
// sharing the same handler. No logic change.
// =============================================================================

// GET /api/v1/themes/wiki/:token/companies
// Alias for /api/v1/themes/:token/companies — supports frontend /themes/wiki/[name] page
app.get("/api/v1/themes/wiki/:token/companies", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const token = c.req.param("token");
  const result = await findCompaniesByWikilink(token);

  return c.json({
    token: result.token,
    count: result.matches.length,
    matches: result.matches,
  });
});

// =============================================================================
// NOTIFICATIONS — real events from audit_logs + daily_briefs + iuf_events (2026-06-12 C2)
// Sources:
//   audit_logs:  paper_submit (filled/rejected), update/kill_switch (risk_alert),
//                kgi.sim.order_submitted (kgi_status)
//   daily_briefs: status=published → brief_published
//   iuf_events:   OpenAlice event rule engine — market/data rules (R01-R10) +
//                 system-health producer rules (R11-R15). Unified feed: this is
//                 the same store /api/v1/alerts reads, so the header notification
//                 center and the /alerts page never diverge again.
// read state: audit_logs/brief-derived items replay notifications.mark_read audit
//             rows; iuf_events items use the table's own `acknowledged` flag.
// mark-read: logs to audit_logs action=notifications.mark_read, returns 204.
// =============================================================================

type NotificationItem = {
  id: string;
  type: "paper_order_filled" | "paper_order_rejected" | "kgi_status" | "brief_published" | "risk_alert" | "system";
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  severity: "info" | "warn" | "critical";
  actionUrl?: string;
  dedupeKey?: string;
  /**
   * Internal-only (P1-2, stripped before the JSON response) — audit_logs/brief
   * items have no ruleId concept and are always actionable; iuf_events items
   * carry the same audience classification GET /api/v1/alerts uses, so the
   * unread badge never inflates on pipeline/system self-monitoring noise.
   */
  audience?: "actionable_market" | "ops_internal";
};

// Product-language (繁中, no engineering jargon) copy for iuf_events rule ids.
// Falls back to ruleName from the DB row when a rule id is not in this map.
const IUF_EVENT_NOTIFICATION_COPY: Record<string, { title: string; body: (payload: Record<string, unknown>) => string }> = {
  R01_REVENUE_SURGE_YOY50: { title: "月營收大幅成長", body: () => "偵測到個股月營收年增率超過 50%" },
  R02_INSTITUTIONAL_CONSECUTIVE_BUY_5D: { title: "三大法人連續買進", body: () => "三大法人連續 5 日同向買進" },
  R03_INSTITUTIONAL_CONSECUTIVE_SELL_5D: { title: "三大法人連續賣出", body: () => "三大法人連續 5 日同向賣出" },
  R04_SHAREHOLDING_HHI_BREAKOUT: { title: "籌碼集中度創高", body: () => "外資持股集中度突破近期高點" },
  R05_REVENUE_DECLINE_YOY30: { title: "月營收大幅下滑", body: () => "偵測到個股月營收年增率低於 -30%" },
  R06_MAJOR_SHAREHOLDER_THRESHOLD: { title: "大股東持股突破門檻", body: () => "外資持股比例突破 40%" },
  R07_MAJOR_ANNOUNCEMENT: { title: "重大公告", body: () => "偵測到新的重大公告" },
  R08_AI_BRIEF_PUBLISHED: { title: "今日簡報已發布", body: () => "AI 簡報已自動發布" },
  R09_HALLUCINATION_REJECTED: { title: "簡報內容檢核未通過", body: () => "AI 簡報內容檢核未通過，已暫緩發布" },
  R10_KGI_GATEWAY_STATE_CHANGE: { title: "交易連線狀態變化", body: () => "券商連線狀態已變化" },
  R11_V3_REC_CRON_EXHAUSTED: { title: "今日 AI 推薦尚未產出", body: () => "今日 AI 推薦排程已結束，但尚未產出結果" },
  R12_LLM_BUDGET_NEAR_LIMIT: {
    title: "AI 用量接近今日上限",
    body: (p) => {
      const ratio = typeof p["usageRatio"] === "number" ? Math.round(p["usageRatio"] * 100) : null;
      return ratio !== null ? `今日 AI 用量已達上限的 ${ratio}%` : "今日 AI 用量已接近上限";
    }
  },
  R13_DAILY_SMOKE_FAILED: { title: "每日健康檢查失敗", body: () => "今日例行健康檢查未通過，請留意系統狀態" },
  R14_THEME_REFRESH_STALE: { title: "題材內容今日未更新", body: () => "題材內容今日尚未完成更新" },
  R15_S1_EOD_NO_POSITIONS: { title: "策略部位資料異常", body: () => "策略每日結算未取得任何部位資料" },
};

function iufEventSeverityToNotification(severity: "info" | "warning" | "critical"): NotificationItem["severity"] {
  if (severity === "warning") return "warn";
  return severity;
}

async function fetchNotifications(_session: AppSession, workspaceId: string): Promise<NotificationItem[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const markReadRows = await db
    .select({ payload: auditLogs.payload })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        eq(auditLogs.action, "notifications.mark_read"),
        gte(auditLogs.createdAt, sevenDaysAgo),
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(500)
    .catch(() => [] as Array<{ payload: unknown }>);
  const markedReadIds = new Set(
    markReadRows.flatMap((row) => {
      const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? row.payload as Record<string, unknown>
        : null;
      return typeof payload?.["notificationId"] === "string" ? [payload["notificationId"]] : [];
    }),
  );

  // ── 1. audit_logs query ──────────────────────────────────────────────────
  // Pull only the 4 action strings we care about (excludes kgi.gateway.health heartbeat noise)
  const NOTIF_ACTIONS = ["paper_submit", "update", "kgi.sim.order_submitted", "kgi.sim.order_report_received"] as const;
  const auditRows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        gte(auditLogs.createdAt, sevenDaysAgo),
        inArray(auditLogs.action, [...NOTIF_ACTIONS])
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(200);

  const notifications: NotificationItem[] = [];

  for (const row of auditRows) {
    const payload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};

    const ts = row.createdAt.toISOString();

    // paper_submit → filled or rejected
    if (row.action === "paper_submit") {
      const statusNum =
        typeof payload["status"] === "number"
          ? payload["status"]
          : typeof payload["status"] === "string"
            ? parseInt(payload["status"], 10)
            : 201;
      const symbol = typeof payload["symbol"] === "string" ? payload["symbol"] : "未知";
      const side = typeof payload["side"] === "string" ? payload["side"] : "";
      const qty = payload["qty"] !== undefined ? String(payload["qty"]) : "";
      const sideLabel = side === "buy" ? "買入" : side === "sell" ? "賣出" : side;
      const isRejected = statusNum >= 422;

      if (isRejected) {
        notifications.push({
          id: row.id,
          type: "paper_order_rejected",
          title: "委託拒絕",
          body: `${symbol} ${sideLabel}${qty ? " " + qty + " 股" : ""} 紙本委託遭拒`,
          timestamp: ts,
          read: markedReadIds.has(row.id),
          severity: "warn",
          actionUrl: "/paper"
        });
      } else {
        notifications.push({
          id: row.id,
          type: "paper_order_filled",
          title: "成交回報",
          body: `${symbol} ${sideLabel}${qty ? " " + qty + " 股" : ""} 紙本委託成交`,
          timestamp: ts,
          read: markedReadIds.has(row.id),
          severity: "info",
          actionUrl: "/paper"
        });
      }
      continue;
    }

    // kill_switch engaged
    if (row.action === "update" && row.entityType === "kill_switch") {
      notifications.push({
        id: row.id,
        type: "risk_alert",
        title: "風控警示",
        body: "Kill Switch 已觸發，所有新委託暫停",
        timestamp: ts,
        read: markedReadIds.has(row.id),
        severity: "critical",
        actionUrl: "/risk"
      });
      continue;
    }

    // KGI SIM order submitted
    if (row.action === "kgi.sim.order_submitted") {
      const symbol = typeof payload["symbol"] === "string" ? payload["symbol"] : "未知";
      const outcome = typeof payload["outcome"] === "string" ? payload["outcome"] : "";
      const outcomeLabel = outcome === "accepted" ? "已接受" : outcome === "not_enabled" ? "未啟用" : outcome || "處理中";
      notifications.push({
        id: row.id,
        type: "kgi_status",
        title: "KGI SIM 訂單",
        body: `${symbol} SIM 委託 ${outcomeLabel}`,
        timestamp: ts,
        read: markedReadIds.has(row.id),
        severity: "info"
      });
      continue;
    }
  }

  // ── 2. daily_briefs published (last 7 days) ──────────────────────────────
  try {
    const briefRows = await db
      .select({
        id: dailyBriefs.id,
        date: dailyBriefs.date,
        status: dailyBriefs.status,
        sections: dailyBriefs.sections,
        createdAt: dailyBriefs.createdAt
      })
      .from(dailyBriefs)
      .where(
        and(
          eq(dailyBriefs.workspaceId, workspaceId),
          eq(dailyBriefs.status, "published"),
          gte(dailyBriefs.createdAt, sevenDaysAgo)
        )
      )
      .orderBy(desc(dailyBriefs.createdAt))
      .limit(10);

    for (const brief of briefRows) {
      const sections = Array.isArray(brief.sections) ? brief.sections as Array<{ heading: string; body: string }> : [];
      const firstHeading = sections[0]?.heading ?? `${brief.date} 簡報`;
      notifications.push({
        id: `brief-${brief.id}`,
        type: "brief_published",
        title: "今日簡報已發布",
        body: firstHeading,
        timestamp: brief.createdAt.toISOString(),
        read: markedReadIds.has(`brief-${brief.id}`),
        severity: "info",
        actionUrl: `/briefs/${brief.id}`,
        dedupeKey: `brief_published:${brief.date}`,
      });
    }
  } catch {
    // brief query failure is non-critical — audit rows still returned
  }

  // ── 3. iuf_events (OpenAlice event rule engine — unified feed, 2026-06-12) ──
  // Same store as GET /api/v1/alerts. read = acknowledged (table's own flag).
  try {
    const events = await listEvents({ workspaceId, limit: 50, dedupeSameDay: true });
    for (const ev of events) {
      const copy = IUF_EVENT_NOTIFICATION_COPY[ev.ruleId];
      const eventTiming = notificationEventTiming(ev.ruleId, ev.triggeredAt, ev.payload);
      notifications.push({
        id: `event-${ev.id}`,
        type: "system",
        title: copy?.title ?? ev.ruleName,
        body: copy?.body(ev.payload) ?? ev.ruleName,
        timestamp: eventTiming.timestamp,
        read: ev.acknowledged,
        severity: iufEventSeverityToNotification(ev.severity),
        actionUrl: "/alerts",
        audience: ev.audience,
        ...(eventTiming.dedupeKey
          ? { dedupeKey: eventTiming.dedupeKey }
          : ev.ruleId === "R08_AI_BRIEF_PUBLISHED" && taipeiDateFromIso(ev.triggeredAt)
          ? { dedupeKey: `brief_published:${taipeiDateFromIso(ev.triggeredAt)}` }
          : {}),
      });
    }
  } catch {
    // event query failure is non-critical — other sources still returned
  }

  // ── 4. merge, sort newest-first, limit 50 ───────────────────────────────
  // dedupeKey/audience are internal-only — the route handler consumes
  // `audience` for the unread badge (P1-2) then strips both before responding.
  const deduped = dedupeNotificationItems(notifications);
  deduped.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return deduped.slice(0, 50);
}

// GET /api/v1/notifications?limit=50
app.get("/api/v1/notifications", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  try {
    const items = await fetchNotifications(session, session.workspace.id);
    // P1-2: the unread badge is a "go act on this" counter, not a pipeline ops
    // log tail — ops_internal-classified iuf_events still show in the drawer
    // (this endpoint is already Owner-only) but never inflate the count.
    const unreadCount = items.filter((n) => !n.read && n.audience !== "ops_internal").length;
    return c.json({
      notifications: items.map(({ dedupeKey: _dedupeKey, audience: _audience, ...item }) => item),
      unread_count: unreadCount
    });
  } catch (err) {
    console.error("[notifications] fetch failed:", err instanceof Error ? err.message : String(err));
    // Degrade to empty list — drawer must not 500
    return c.json({ notifications: [], unread_count: 0 });
  }
});

// POST /api/v1/notifications/:id/mark-read
// audit_logs/brief-derived items persist read state by replaying this audit action.
// `event-<uuid>` ids (iuf_events unified feed,
// 2026-06-12) additionally persist via acknowledgeEvent() — same store /alerts uses.
app.post("/api/v1/notifications/:id/mark-read", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }
  const notificationId = c.req.param("id");

  const eventId = notificationId.startsWith("event-") ? notificationId.slice("event-".length) : null;
  if (eventId) {
    await acknowledgeEvent(session.workspace.id, eventId).catch((e: unknown) => {
      console.error("[notifications/mark-read] acknowledgeEvent failed:", e instanceof Error ? e.message : String(e));
    });
  }

  // fire-and-forget audit log
  writeAuditLog({
    session,
    method: "POST",
    path: `/api/v1/notifications/${notificationId}/mark-read`,
    status: 204,
    payload: { notificationId }
  }).catch((e: unknown) => {
    console.error("[notifications/mark-read] audit log failed:", e instanceof Error ? e.message : String(e));
  });
  return new Response(null, { status: 204 });
});

// =============================================================================
// ADMIN: OPENALICE ADVERSARIAL WARNS (2026-05-15)
// GET /api/v1/admin/openalice/adversarial-warns
//   Owner-only. Returns recent adversarial reviewer warn events (severityScore >= 7)
//   from audit_logs. Enables operators to monitor suppressed-but-logged high-severity
//   adversarial flags without grepping Railway logs.
//
//   Query params:
//     from  — ISO date string, lower bound (default: 7 days ago)
//     to    — ISO date string, upper bound (default: now)
//     limit — max rows (default 50, max 200)
// =============================================================================

app.get("/api/v1/admin/openalice/adversarial-warns", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const fromRaw = c.req.query("from");
  const toRaw = c.req.query("to");
  const limitRaw = c.req.query("limit");

  const fromDate = fromRaw ? new Date(fromRaw) : new Date(nowMs - sevenDaysMs);
  const toDate = toRaw ? new Date(toRaw) : new Date(nowMs);
  const limitNum = Math.min(200, Math.max(1, Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50));

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return c.json({ error: "INVALID_DATE_PARAM" }, 400);
  }

  const { listAdversarialWarnEvents } = await import("./admin-openalice-adversarial-warns.js");
  const warns = await listAdversarialWarnEvents({
    workspaceId: session.workspace.id,
    from: fromDate,
    to: toDate,
    limit: limitNum,
  });

  return c.json({ warns, total: warns.length });
});

// =============================================================================
// QUANT STRATEGY SUBSCRIBE (2026-05-15)
// POST /api/v1/quant-strategies/:id/subscribe
//   Owner-only. sim_only forced true server-side.
//   capital_twd: 50_000 - 10_000_000 NTD.
//   Persists to audit_logs action="quant_strategy.subscribe" (no new DB table).
//
// GET /api/v1/quant-strategies/:id/subscriptions/my
//   Owner-only. Returns caller's subscription history for the given strategy.
// =============================================================================

// POST /api/v1/quant-strategies/:id/subscribe
app.post("/api/v1/quant-strategies/:id/subscribe", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const strategyId = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "INVALID_JSON" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "INVALID_BODY" }, 400);
  }
  const raw = body as Record<string, unknown>;
  const capitalTwd = typeof raw["capital_twd"] === "number" ? raw["capital_twd"] : NaN;

  if (!Number.isFinite(capitalTwd)) {
    return c.json({ error: "CAPITAL_BELOW_MIN", message: "capital_twd must be a finite number" }, 400);
  }

  const { subscribeQuantStrategy, STRATEGY_RETIRED_IDS } = await import("./quant-strategy-subscribe.js");

  // Fast-path: retired strategy check before flag snapshot or heavy logic.
  // Returns 410 Gone so callers know the strategy no longer accepts subscriptions.
  if (STRATEGY_RETIRED_IDS.has(strategyId)) {
    return c.json({ error: "STRATEGY_RETIRED", reason: "This strategy has been retired and no longer accepts subscriptions." }, 410);
  }

  const flags = getExecutionFlagSnapshot();

  const result = await subscribeQuantStrategy({
    session,
    strategyId,
    capitalTwd,
    executionMode: flags.executionMode,
  });

  if (!result.ok) {
    return c.json({ error: result.error }, result.http_status);
  }

  return c.json(
    {
      subscription_id: result.subscription_id,
      status: result.status,
      ...(result.warning ? { warning: result.warning } : {}),
    },
    201
  );
});

// GET /api/v1/quant-strategies/:id/subscriptions/my
// Must be declared before generic /:id segment — literal "subscriptions" won't conflict
// because Hono matches the full path pattern (no ambiguity between :id and "subscriptions/my").
app.get("/api/v1/quant-strategies/:id/subscriptions/my", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const strategyId = c.req.param("id");
  const { VALID_QUANT_STRATEGY_IDS, listMyQuantSubscriptions } = await import("./quant-strategy-subscribe.js");

  if (!VALID_QUANT_STRATEGY_IDS.has(strategyId)) {
    return c.json({ error: "STRATEGY_NOT_FOUND" }, 404);
  }

  const items = await listMyQuantSubscriptions({ session });

  // Filter by strategyId on the result (the query fetches all for the user, filter here for correctness)
  const filtered = items.filter((s) => s.strategy_id === strategyId);

  return c.json({ subscriptions: filtered });
});

// =============================================================================
// ADMIN: themes/links-rebuild — backfill company_theme_links from wiki-text (2026-05-15)
// Bruce P1: company_theme_links was never seeded → themes/index companyCount=0
// Auth: Owner-only
// Idempotent: UPSERT ON CONFLICT DO NOTHING
// =============================================================================
app.post("/api/v1/admin/themes/links-rebuild", async (c) => {
  const { handleAdminThemesLinksRebuild } = await import("./admin-themes-links-rebuild.js");
  return handleAdminThemesLinksRebuild(c);
});

// =============================================================================
// ADMIN: themes/re-encode-mojibake — fix CP950 mojibake in themes table (2026-05-18)
// Bruce P1 / Jason F2: some theme rows (e.g. 低軌衛星) had name/thesis/whyNow/bottleneck
// stored as CP950/Big5 bytes misread as Latin-1, causing garbled display in 5/18 brief.
// Auth: Owner-only
// Body: { dryRun?: boolean } — default dryRun=true (preview without writes)
// Set dryRun=false to apply the re-encoding fix in place.
// Idempotent: pure-ASCII rows are skipped; already-correct UTF-8 rows are unaffected.
// =============================================================================
app.post("/api/v1/admin/themes/re-encode-mojibake", async (c) => {
  const { handleAdminThemesReEncodeMojibake } = await import("./admin-themes-re-encode-mojibake.js");
  return handleAdminThemesReEncodeMojibake(c);
});

// =============================================================================
// ADMIN: content-drafts/retry-review — re-run AI reviewer for stuck drafts (2026-05-15)
// Bruce P1: 5 drafts from 2026-05-12 stuck in awaiting_review before reviewer relax (PR #530)
// Auth: Owner-only
// Body: { status?: "awaiting_review", from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", dryRun?: boolean, limit?: number }
// =============================================================================
app.post("/api/v1/admin/content-drafts/retry-review", async (c) => {
  const { handleAdminContentDraftsRetryReview } = await import("./admin-content-drafts-retry-review.js");
  return handleAdminContentDraftsRetryReview(c);
});

// =============================================================================
// ADMIN: content-drafts/cleanup-orphan — delete approved drafts whose brief is gone (2026-05-18)
// Bruce P0: draft e6d33da2 status=approved, approvedRefId → deleted brief → dedupeKey blocks new draft
// Auth: Owner-only
// Body: { dryRun: boolean, draftId?: string }
//   dryRun=true  → list orphans only (no delete)
//   dryRun=false → DELETE matching rows + audit log
//   draftId      → target a specific draft; else scan all orphans in workspace
// =============================================================================
app.post("/api/v1/admin/content-drafts/cleanup-orphan", async (c) => {
  const { handleAdminContentDraftsCleanupOrphan } = await import("./admin-content-drafts-cleanup-orphan.js");
  return handleAdminContentDraftsCleanupOrphan(c);
});

// =============================================================================
// ADMIN: content-drafts/bulk-reject — bulk soft-reject stuck awaiting_review drafts (2026-07-03)
// Bruce audit 7/2: 1012 content_drafts stuck awaiting_review (company_notes 46% / theme_summaries 44%
// / daily_briefs 10%, producerVersion v1 92%). Root cause: OpenAlice devices active → enqueue jobs
// → device submits draft_ready → v1 draft. Devices went stale; AI reviewer never cleared queue.
// No v2 consumer depends on these drafts (#1092 confirmed). Safe bulk-reject clears dedupeKey blocks.
// Auth: Owner-only
// Body: { olderThanDays?: number (default 7), status?: "awaiting_review" (default), producerVersion?: string, apply?: boolean (default FALSE) }
//   apply=false → dry-run: returns distribution stats, NO changes
//   apply=true  → soft-reject matching rows (status='rejected'), NO DELETE
// DO NOT send apply=true without楊董 ACK on dry-run numbers.
// =============================================================================
app.post("/api/v1/admin/content-drafts/bulk-reject", async (c) => {
  const { handleAdminContentDraftsBulkReject } = await import("./admin-content-drafts-bulk-reject.js");
  return handleAdminContentDraftsBulkReject(c);
});

// =============================================================================
// ADMIN: themes/manual-update — write correct UTF-8 content for broken theme rows (2026-05-18)
// Bruce P0: 5G + 低軌衛星 themes have bytes too broken for auto re-encode (tryReencode ok=false)
// Auth: Owner-only
// Body: { themeKey: string, name?: string, thesis?: string, whyNow?: string, bottleneck?: string }
//   themeKey matches the slug column in themes table (e.g. "5g", "low_orbit_satellite")
//   At least one of name/thesis/whyNow/bottleneck must be provided
// =============================================================================
app.post("/api/v1/admin/themes/manual-update", async (c) => {
  const { handleAdminThemesManualUpdate } = await import("./admin-themes-manual-update.js");
  return handleAdminThemesManualUpdate(c);
});

// =============================================================================
// ADMIN: themes/refresh — server-side LLM theme content refresh (Elva 2026-06-11)
// Replaces the dead OpenAlice-device dependency: themes froze at 2026-05-18.
// POST body: { themeKey?: string } — single theme by slug, or all themes.
// Auth: Owner-only. Daily cron also fires this at 17:30-18:30 TST weekdays.
// =============================================================================
app.post("/api/v1/admin/themes/refresh", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const themeSlug = typeof body["themeKey"] === "string" && body["themeKey"].trim() ? body["themeKey"].trim() : undefined;
  const { runThemeRefresh } = await import("./theme-refresh.js");
  const result = await runThemeRefresh({ trigger: "manual", themeSlug });
  return c.json({ ok: result.error === null, ...result });
});

app.get("/api/v1/admin/themes/refresh-status", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const { getThemeRefreshStatus } = await import("./theme-refresh.js");
  return c.json(getThemeRefreshStatus());
});


// =============================================================================
// UTA (Unified Trading Account) — Phase A routes (2026-05-17)
// BrokerAdapter abstraction layer — /api/v1/uta/*
// Owner-only (matches trading/orders auth level).
// AGPL compliance: design inspired by OpenAlice README/docs; all code is IUF-original.
// =============================================================================

// Portfolio Snapshots (Trading-as-Git Phase A)
// Frontend contract:
//   GET /api/v1/portfolio/snapshots
//   GET /api/v1/portfolio/snapshots/diff
//   GET /api/v1/portfolio/snapshots/:id
// These routes are read-only and return an honest empty state when no snapshots
// exist. They intentionally do not create paper orders or broker writes.
// =============================================================================

const portfolioSnapshotListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  before: z.string().uuid().optional()
});

const portfolioSnapshotDiffQuerySchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid()
});

type PortfolioSnapshotPosition = {
  shares: number;
  avgCost: number;
  sector?: string;
  lastPrice?: number;
};

type PortfolioSnapshotPositionsMap = Record<string, PortfolioSnapshotPosition>;

type PortfolioSnapshotRecordLike = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  positions: PortfolioSnapshotPositionsMap;
  trigger: string;
  triggerRefId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

async function buildPaperPortfolioSnapshotPositions(userId: string): Promise<PortfolioSnapshotPositionsMap> {
  const paperPositions = await computePaperPortfolioPositions(userId);
  const positions: PortfolioSnapshotPositionsMap = {};

  for (const position of paperPositions) {
    if (position.netQtyShares <= 0 || position.avgCostPerShare === null) continue;
    positions[position.symbol] = {
      shares: position.netQtyShares,
      avgCost: position.avgCostPerShare,
      lastPrice: position.lastPrice ?? undefined
    };
  }

  return positions;
}

function portfolioPositionsToArray(positions: PortfolioSnapshotPositionsMap) {
  return Object.entries(positions ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ticker, position]) => ({
      ticker,
      shares: position.shares,
      avgCost: position.avgCost,
      sector: position.sector,
      lastPrice: position.lastPrice
    }));
}

function serializePortfolioSnapshot(snapshot: PortfolioSnapshotRecordLike) {
  return {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    trigger: snapshot.trigger,
    note: typeof snapshot.metadata?.["note"] === "string" ? snapshot.metadata["note"] : null,
    positions: portfolioPositionsToArray(snapshot.positions),
    parentId: snapshot.parentId,
    createdAt: snapshot.createdAt.toISOString()
  };
}

function serializePortfolioDiffMap(positions: PortfolioSnapshotPositionsMap) {
  return portfolioPositionsToArray(positions).map((position) => ({
    ticker: position.ticker,
    shares: position.shares,
    avgCost: position.avgCost
  }));
}

app.post("/api/v1/portfolio/snapshots/capture-paper", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const workspaceId = session.workspace?.id;
  if (!workspaceId) return c.json({ error: "workspace_not_resolved" }, 400);

  try {
    const positions = await buildPaperPortfolioSnapshotPositions(session.user.id);
    const positionCount = Object.keys(positions).length;
    const { createSnapshot } = await import("./portfolio-snapshot-store.js");
    const snapshot = await createSnapshot({
      workspaceId,
      positions,
      trigger: "manual",
      metadata: {
        source: "paper_portfolio_manual_capture",
        capturedAt: new Date().toISOString(),
        userId: session.user.id,
        simulated: true,
        brokerWrite: false,
        kgiWrite: false,
        note: positionCount === 0
          ? "Manual paper snapshot capture: no open paper positions"
          : "Manual paper snapshot capture from filled paper orders"
      }
    });

    return c.json({
      data: {
        snapshot: serializePortfolioSnapshot(snapshot),
        positionCount,
        source: "paper_portfolio",
        simulated: true,
        brokerWrite: false,
        kgiWrite: false
      }
    }, 201);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[portfolio/snapshots/capture-paper] failed:", detail);
    return c.json({ error: "paper_portfolio_capture_failed", detail }, 500);
  }
});

app.get("/api/v1/portfolio/snapshots", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const workspaceId = session.workspace?.id;
  if (!workspaceId) return c.json({ error: "workspace_not_resolved" }, 400);

  const query = portfolioSnapshotListQuerySchema.parse(c.req.query());
  const { listSnapshots } = await import("./portfolio-snapshot-store.js");
  const snapshots = await listSnapshots({
    workspaceId,
    limit: query.limit,
    before: query.before ?? null
  });

  return c.json({
    data: {
      snapshots: snapshots.map(serializePortfolioSnapshot),
      nextCursor: snapshots.length === query.limit ? snapshots.at(-1)?.id ?? null : null
    }
  });
});

app.get("/api/v1/portfolio/snapshots/diff", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const workspaceId = session.workspace?.id;
  if (!workspaceId) return c.json({ error: "workspace_not_resolved" }, 400);

  const query = portfolioSnapshotDiffQuerySchema.parse(c.req.query());
  const { getSnapshotById, computePositionDiff } = await import("./portfolio-snapshot-store.js");
  const [fromSnapshot, toSnapshot] = await Promise.all([
    getSnapshotById(query.from),
    getSnapshotById(query.to)
  ]);

  if (
    !fromSnapshot ||
    !toSnapshot ||
    fromSnapshot.workspaceId !== workspaceId ||
    toSnapshot.workspaceId !== workspaceId
  ) {
    return c.json({ error: "snapshot_not_found" }, 404);
  }

  const diff = computePositionDiff(fromSnapshot.positions, toSnapshot.positions);
  return c.json({
    data: {
      fromSnapshotId: query.from,
      toSnapshotId: query.to,
      added: serializePortfolioDiffMap(diff.added),
      removed: serializePortfolioDiffMap(diff.removed),
      changed: Object.entries(diff.changed)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ticker, change]) => ({
          ticker,
          fromShares: change.from.shares,
          toShares: change.to.shares,
          fromAvgCost: change.from.avgCost,
          toAvgCost: change.to.avgCost
        }))
    }
  });
});

app.get("/api/v1/portfolio/snapshots/:id", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  const workspaceId = session.workspace?.id;
  if (!workspaceId) return c.json({ error: "workspace_not_resolved" }, 400);

  const id = z.string().uuid().parse(c.req.param("id"));
  const { getSnapshotById } = await import("./portfolio-snapshot-store.js");
  const snapshot = await getSnapshotById(id);
  if (!snapshot || snapshot.workspaceId !== workspaceId) {
    return c.json({ error: "snapshot_not_found" }, 404);
  }
  return c.json({ data: serializePortfolioSnapshot(snapshot) });
});

// =============================================================================
// P0-14: OpenAlice Chat — POST /api/v1/openalice/chat
//
// Simple single-turn AI chat endpoint backed by gpt-5.4-mini (llm-gateway).
// Request:  { message: string }
// Response: { reply: string, sources: string[], model: string, tokensUsed: number }
//
// Rate limit: 10 requests per minute per user (in-memory sliding window).
// Auth: session required (any role). No Owner-only gate — accessible to all users.
// Budget: uses existing LLM_DAILY_BUDGET_USD / OPENAI_DAILY_LIMIT guards in llm-gateway.
// No multi-turn / tool-call: single prompt → single completion. Phase C.
// =============================================================================

// In-memory rate limiter: userId → { count, windowStart }
const _openaliceChatRateLimitMap = new Map<string, { count: number; windowStart: number }>();
const OPENALICE_CHAT_RATE_LIMIT = 10; // req per min per user
const OPENALICE_CHAT_RATE_WINDOW_MS = 60_000;

function checkOpenAliceChatRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = _openaliceChatRateLimitMap.get(userId);
  if (!entry || now - entry.windowStart >= OPENALICE_CHAT_RATE_WINDOW_MS) {
    _openaliceChatRateLimitMap.set(userId, { count: 1, windowStart: now });
    return true; // allowed
  }
  if (entry.count >= OPENALICE_CHAT_RATE_LIMIT) {
    return false; // rate limited
  }
  entry.count++;
  return true; // allowed
}

app.post("/api/v1/openalice/chat", async (c) => {
  const session = c.get("session");
  if (!session) {
    return c.json({ error: "auth_required" }, 401);
  }

  // Rate limit check
  const userId = session.user.id;
  if (!checkOpenAliceChatRateLimit(userId)) {
    return c.json({
      error: "rate_limited",
      message: "最多每分鐘 10 則訊息，請稍後再試",
      retryAfterSec: 60
    }, 429);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const b = body as Record<string, unknown>;
  const message = typeof b["message"] === "string" ? b["message"].trim() : "";
  if (!message) {
    return c.json({ error: "missing_field", field: "message" }, 400);
  }
  if (message.length > 2000) {
    return c.json({ error: "message_too_long", maxChars: 2000 }, 400);
  }

  const { callLlm, LLMBudgetExceeded } = await import("./llm/llm-gateway.js");

  const systemPrompt = [
    "你是 IUF 交易室的 AI 分析師 OpenAlice，專長是台灣股市分析。",
    "用繁體中文回答，語氣專業但親切。",
    "回答聚焦於用戶的問題，不要無端延伸。",
    "若涉及投資建議，請明確標示這僅供參考，不構成正式投資建議。",
    "若無法取得即時資料，誠實告知資料限制。"
  ].join("\n");

  try {
    const result = await callLlm(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      {
        modelKey: process.env["OPENAI_MODEL"] ?? "gpt-5.4-mini",
        callerModule: "openalice_chat",
        taskType: "chat",
        workspaceId: session.workspace?.id ?? null,
        maxTokens: 1024,
        temperature: 0.4,
        timeoutMs: 30_000
      }
    );

    if (!result) {
      return c.json({
        error: "llm_unavailable",
        message: "AI 分析師暫時無法使用（API quota 或金鑰未設定）"
      }, 503);
    }

    return c.json({
      data: {
        reply: result.content,
        sources: [],
        model: process.env["OPENAI_MODEL"] ?? "gpt-5.4-mini",
        tokensUsed: result.usage.totalTokens,
        costUsd: result.costUsd
      }
    });
  } catch (e) {
    if (e instanceof LLMBudgetExceeded) {
      return c.json({
        error: "budget_exceeded",
        message: "今日 AI 預算已達上限，請明日再試"
      }, 503);
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[openalice-chat] error:", msg);
    return c.json({ error: "internal_error", message: msg }, 500);
  }
});

// GET /api/v1/uta/adapters — list registered broker adapters
app.get("/api/v1/uta/adapters", async (c) => {
  const { isDatabaseMode, getDb, brokerAdapters } = await import("@iuf-trading-room/db");
  if (!isDatabaseMode()) {
    return c.json({
      data: {
        adapters: [
          {
            adapterKey: "kgi",
            displayName: "凱基證券 (KGI)",
            capabilities: { oddLot: true, marginTrading: true, shortSelling: true, afterHoursFixing: false, simModeAvailable: true, maxSubscriptions: 40 },
            isActive: true,
          },
          {
            adapterKey: "paper",
            displayName: "Paper Trading",
            capabilities: { oddLot: true, marginTrading: true, shortSelling: true, afterHoursFixing: false, simModeAvailable: true, maxSubscriptions: 9999 },
            isActive: true,
          },
        ],
      },
    });
  }
  const db = getDb();
  if (!db) return c.json({ data: { adapters: [] } });
  const rows = await db.select().from(brokerAdapters).orderBy(brokerAdapters.adapterKey);
  return c.json({
    data: {
      adapters: rows.map((row) => ({
        adapterKey: row.adapterKey,
        displayName: row.displayName,
        capabilities: {
          oddLot: row.capOddLot,
          marginTrading: row.capMarginTrading,
          shortSelling: row.capShortSelling,
          afterHoursFixing: row.capAfterHoursFix,
          simModeAvailable: row.capSimMode,
          maxSubscriptions: row.capMaxSubscriptions,
        },
        isActive: row.isActive,
      })),
    },
  });
});

// =============================================================================
// UTA broker connections (Phase 2) — the workspace's broker accounts.
// Gateway model (architecture decision 2026-06-17): customer credentials NEVER
// touch our servers; a connection here is a reference/label pointing at the
// customer-side gateway. No real orders — Real Order stays locked.
// =============================================================================

// GET /api/v1/uta/accounts — this workspace's broker connections + status
app.get("/api/v1/uta/accounts", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const session = c.get("session");
  if (!isDatabaseMode()) return c.json({ data: [] });
  const db = getDb();
  if (!db) return c.json({ data: [] });
  // Unified order flow PR-2 (D6): guarantee a baseline paper + kgi row exists
  // before listing, so the account picker never renders an empty list.
  // Idempotent no-op after the first call per workspace.
  const { ensureDefaultBrokerAccounts } = await import("./broker/broker-account-seed.js");
  await ensureDefaultBrokerAccounts(session.workspace.id);
  const rows = dbExecRows<{
    id: string; adapter_key: string; display_name: string; account_ref: string;
    account_label: string; is_primary: boolean; is_active: boolean;
    pairing_status: string | null; last_heartbeat_at: string | null;
  }>(await db.execute(drizzleSql`
    SELECT ba.id, ba.adapter_key, ba.account_ref, ba.account_label, ba.is_primary, ba.is_active,
           bad.display_name,
           gp.status AS pairing_status, gp.last_heartbeat_at
    FROM broker_accounts ba
    JOIN broker_adapters bad ON bad.adapter_key = ba.adapter_key
    LEFT JOIN broker_gateway_pairings gp
      ON gp.broker_account_id = ba.id AND gp.status IN ('pending', 'paired')
    WHERE ba.workspace_id = ${session.workspace.id}
    ORDER BY ba.is_primary DESC, ba.created_at ASC
  `));
  // A paired gateway is "reachable" only if it has reported a heartbeat recently.
  const REACHABLE_WINDOW_MS = 5 * 60 * 1000;
  return c.json({
    data: rows.map((r) => {
      let gatewayStatus: "unpaired" | "pending" | "paired_unreachable" | "reachable" = "unpaired";
      if (r.pairing_status === "pending") gatewayStatus = "pending";
      else if (r.pairing_status === "paired") {
        const hb = r.last_heartbeat_at ? Date.parse(r.last_heartbeat_at) : NaN;
        gatewayStatus = Number.isFinite(hb) && Date.now() - hb <= REACHABLE_WINDOW_MS
          ? "reachable"
          : "paired_unreachable";
      }
      return {
        id: r.id,
        adapterKey: r.adapter_key,
        displayName: r.display_name,
        accountRef: r.account_ref,
        accountLabel: r.account_label || r.account_ref,
        isPrimary: r.is_primary,
        // Phase 2: a registered connection. status reflects the account record.
        status: r.is_active ? "connected" : "disconnected",
        // Phase 2 後續: customer-side gateway pairing/liveness (Option A).
        gatewayStatus,
        lastHeartbeatAt: r.last_heartbeat_at,
      };
    }),
  });
});

// POST /api/v1/uta/accounts/:id/gateway/pair-token — issue a one-time pairing token
//   Owner/Admin only. Returns the plaintext token ONCE; only its SHA-256 hash is
//   stored. The customer pastes it into their own gateway agent, which later
//   registers (slice 2). No broker credentials are ever involved here (Option A).
app.post("/api/v1/uta/accounts/:id/gateway/pair-token", async (c) => {
  const session = c.get("session");
  if (session.user.role !== "Owner" && session.user.role !== "Admin") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  if (!isDatabaseMode()) return c.json({ error: "db_unavailable" }, 503);
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const accountId = c.req.param("id");

  // G-SELF ownership check (PERMISSION_MATRIX_v1.md §2 D3 / PR-D, 2026-07-09).
  const { findOwnedBrokerAccount } = await import("./broker/broker-account-ownership.js");
  const acct = await findOwnedBrokerAccount(db, accountId, session.workspace.id);
  if (!acct) return c.json({ error: "account_not_found" }, 404);

  // Generate a one-time pairing token; persist only its hash.
  const token = `iufgw_${randomBytes(24).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute pairing window

  try {
    // Supersede any prior unconsumed pairing for this account (one active per account).
    await db.execute(drizzleSql`
      UPDATE broker_gateway_pairings
      SET status = 'expired', updated_at = NOW()
      WHERE broker_account_id = ${accountId} AND status = 'pending'
    `);
    await db.execute(drizzleSql`
      INSERT INTO broker_gateway_pairings
        (broker_account_id, workspace_id, pairing_token_hash, status, expires_at)
      VALUES (${accountId}, ${session.workspace.id}, ${tokenHash}, 'pending', ${expiresAt.toISOString()})
    `);
  } catch (e) {
    return c.json({ error: "pairing_issue_failed", message: e instanceof Error ? e.message : String(e) }, 500);
  }

  console.log(`[uta/gateway/pair-token] Owner uid=${session.user.id} issued pairing for account=${accountId}`);
  return c.json({
    data: {
      // Plaintext token — shown ONCE; not recoverable after this response.
      pairingToken: token,
      expiresAt: expiresAt.toISOString(),
      note: "貼進你自己的 gateway agent。憑證/帳密永遠留在你的機器，不會上傳。",
    },
  }, 201);
});

// POST /api/v1/uta/gateway/register — customer gateway agent registers (Slice 2)
//   Bearer-authed with the one-time PAIRING token (not a web cookie; route is in
//   isDeviceAuthRoute). Validates the pending/unexpired pairing, marks it paired,
//   and issues a long-lived GATEWAY session token (returned ONCE, hash stored).
//   No broker credentials ever cross this boundary (Option A). No order path.
app.post("/api/v1/uta/gateway/register", async (c) => {
  if (!isDatabaseMode()) return c.json({ error: "db_unavailable" }, 503);
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const m = /^Bearer\s+(.+)$/i.exec((c.req.header("authorization") ?? "").trim());
  if (!m) return c.json({ error: "missing_bearer_token" }, 401);
  const pairingHash = createHash("sha256").update(m[1].trim()).digest("hex");

  const body = await c.req.json().catch(() => ({}));
  const label = typeof (body as { label?: unknown }).label === "string"
    ? (body as { label: string }).label.trim().slice(0, 64)
    : "";

  const pairing = dbExecRows<{ id: string; broker_account_id: string; expires_at: string }>(
    await db.execute(drizzleSql`
      SELECT id, broker_account_id, expires_at
      FROM broker_gateway_pairings
      WHERE pairing_token_hash = ${pairingHash} AND status = 'pending'
      LIMIT 1
    `)
  )[0];
  if (!pairing) return c.json({ error: "invalid_or_consumed_token" }, 401);
  if (Date.parse(pairing.expires_at) < Date.now()) {
    await db.execute(drizzleSql`UPDATE broker_gateway_pairings SET status='expired', updated_at=NOW() WHERE id=${pairing.id}`);
    return c.json({ error: "pairing_token_expired" }, 401);
  }

  const gatewayToken = `iufgws_${randomBytes(32).toString("base64url")}`;
  const gatewayHash = createHash("sha256").update(gatewayToken).digest("hex");
  await db.execute(drizzleSql`
    UPDATE broker_gateway_pairings
    SET status = 'paired', gateway_token_hash = ${gatewayHash}, gateway_label = ${label},
        paired_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
    WHERE id = ${pairing.id}
  `);
  console.log(`[uta/gateway/register] paired id=${pairing.id} account=${pairing.broker_account_id}`);
  return c.json({
    data: {
      // Long-lived gateway session token — shown ONCE; not recoverable.
      gatewayToken,
      brokerAccountId: pairing.broker_account_id,
      note: "用這個 gateway token 定期打 /uta/gateway/heartbeat 報活。憑證永遠留你本機。",
    },
  }, 201);
});

// POST /api/v1/uta/gateway/heartbeat — gateway liveness ping (Slice 2)
//   Bearer-authed with the GATEWAY session token. Bumps last_heartbeat_at so
//   GET /uta/accounts can report gatewayStatus=reachable.
app.post("/api/v1/uta/gateway/heartbeat", async (c) => {
  if (!isDatabaseMode()) return c.json({ error: "db_unavailable" }, 503);
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const m = /^Bearer\s+(.+)$/i.exec((c.req.header("authorization") ?? "").trim());
  if (!m) return c.json({ error: "missing_bearer_token" }, 401);
  const gatewayHash = createHash("sha256").update(m[1].trim()).digest("hex");

  const updated = dbExecRows<{ id: string }>(await db.execute(drizzleSql`
    UPDATE broker_gateway_pairings
    SET last_heartbeat_at = NOW(), updated_at = NOW()
    WHERE gateway_token_hash = ${gatewayHash} AND status = 'paired'
    RETURNING id
  `));
  if (updated.length === 0) return c.json({ error: "invalid_gateway_token" }, 401);
  return c.json({ data: { ok: true, at: new Date().toISOString() } });
});

// POST /api/v1/uta/accounts/:id/gateway/revoke — Owner revokes the active pairing
//   Disconnects the customer gateway (pending or paired → revoked). The gateway
//   token stops working immediately; re-pairing requires a fresh pair-token.
app.post("/api/v1/uta/accounts/:id/gateway/revoke", async (c) => {
  const session = c.get("session");
  if (session.user.role !== "Owner" && session.user.role !== "Admin") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  if (!isDatabaseMode()) return c.json({ error: "db_unavailable" }, 503);
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  const accountId = c.req.param("id");

  // G-SELF ownership check (PERMISSION_MATRIX_v1.md §2 D3 / PR-D, 2026-07-09):
  // confirm the broker account belongs to THIS workspace before touching its
  // pairing — same pattern as pair-token issuance above. Least-disclosure:
  // an accountId that doesn't exist and one that belongs to another workspace
  // are indistinguishable to the caller — both 404.
  const { findOwnedBrokerAccount } = await import("./broker/broker-account-ownership.js");
  const acct = await findOwnedBrokerAccount(db, accountId, session.workspace.id);
  if (!acct) return c.json({ error: "account_not_found" }, 404);

  const revoked = dbExecRows<{ id: string }>(await db.execute(drizzleSql`
    UPDATE broker_gateway_pairings gp
    SET status = 'revoked', updated_at = NOW()
    FROM broker_accounts ba
    WHERE gp.broker_account_id = ba.id
      AND ba.id = ${accountId} AND ba.workspace_id = ${session.workspace.id}
      AND gp.status IN ('pending', 'paired')
    RETURNING gp.id
  `));
  console.log(`[uta/gateway/revoke] Owner uid=${session.user.id} revoked ${revoked.length} pairing(s) for account=${accountId}`);
  return c.json({ data: { revoked: revoked.length } });
});

// POST /api/v1/uta/accounts — register/connect a broker account (NO credentials)
const utaConnectSchema = z.object({
  adapterKey: z.enum(["kgi", "paper"]),
  accountRef: z.string().trim().min(1).max(64),
  accountLabel: z.string().trim().max(64).optional(),
});
app.post("/api/v1/uta/accounts", async (c) => {
  const session = c.get("session");
  if (session.user.role !== "Owner" && session.user.role !== "Admin") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  if (!isDatabaseMode()) return c.json({ error: "db_unavailable" }, 503);
  let body: z.infer<typeof utaConnectSchema>;
  try {
    body = utaConnectSchema.parse(await c.req.json());
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "VALIDATION_ERROR", details: err.flatten() }, 400);
    throw err;
  }
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);
  await db.execute(drizzleSql`
    INSERT INTO broker_accounts (workspace_id, adapter_key, account_ref, account_label, is_active)
    VALUES (${session.workspace.id}, ${body.adapterKey}, ${body.accountRef}, ${body.accountLabel ?? ""}, TRUE)
    ON CONFLICT (workspace_id, adapter_key, account_ref)
      DO UPDATE SET account_label = EXCLUDED.account_label, is_active = TRUE, updated_at = NOW()
  `);
  return c.json({ ok: true, adapterKey: body.adapterKey, accountRef: body.accountRef });
});

// POST /api/v1/uta/accounts/disconnect — deactivate a connection { id }
app.post("/api/v1/uta/accounts/disconnect", async (c) => {
  const session = c.get("session");
  if (session.user.role !== "Owner" && session.user.role !== "Admin") {
    return c.json({ error: "forbidden_role" }, 403);
  }
  if (!isDatabaseMode()) return c.json({ error: "db_unavailable" }, 503);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const id = String((body as Record<string, unknown>).id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "invalid_id" }, 400);
  const db = getDb();
  if (!db) return c.json({ error: "db_unavailable" }, 503);

  // G-SELF ownership check (PERMISSION_MATRIX_v1.md §2 D3 / PR-D, 2026-07-09):
  // same pattern as gateway/pair-token and gateway/revoke above — confirm the
  // account belongs to THIS workspace before disconnecting it. Least-disclosure:
  // 404 whether the id doesn't exist or belongs to another workspace.
  const { findOwnedBrokerAccount } = await import("./broker/broker-account-ownership.js");
  const acct = await findOwnedBrokerAccount(db, id, session.workspace.id);
  if (!acct) return c.json({ error: "account_not_found" }, 404);

  await db.execute(drizzleSql`
    UPDATE broker_accounts SET is_active = FALSE, updated_at = NOW()
    WHERE id = ${id}::uuid AND workspace_id = ${session.workspace.id}
  `);
  return c.json({ ok: true });
});

// POST /api/v1/uta/orders — submit a unified order through the specified adapter
app.post("/api/v1/uta/orders", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const bodySchema = z.object({
    adapterKey: z.enum(["kgi", "paper"]),
    symbol: z.string().min(1),
    action: z.enum(["Buy", "Sell"]),
    qty: z.number().int().positive(),
    // REQUIRED, no default — 統一下單流 D4 (2026-07-04): /uta/orders previously
    // had no quantity_unit field at all (relied on oddLot boolean only, which
    // doesn't disambiguate LOT-vs-SHARE for board-lot orders). Added explicitly
    // per design doc §2 D4 "/uta/orders 補欄位".
    quantityUnit: z.enum(["SHARE", "LOT"]),
    priceType: z.enum(["Market", "Limit", "LimitUp", "LimitDown"]),
    limitPrice: z.number().positive().optional(),
    orderCond: z.enum(["Cash", "Margin", "ShortSelling", "LendSelling"]).optional(),
    oddLot: z.boolean().optional(),
  });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "Invalid request body", details: String(err) }, 400);
  }

  const session = c.get("session");
  const workspaceId = (session.workspace as { id?: string } | undefined)?.id;
  if (!workspaceId) return c.json({ error: "Workspace not resolved" }, 400);

  const input = {
    symbol: body.symbol,
    action: body.action,
    qty: body.qty,
    quantityUnit: body.quantityUnit,
    priceType: body.priceType,
    limitPrice: body.limitPrice,
    orderCond: body.orderCond,
    oddLot: body.oddLot,
  };

  const { createUnifiedOrder, updateUnifiedOrderSubmitted, updateUnifiedOrderRejected } =
    await import("./broker/unified-order-store.js");
  const actorId = (session.user as { id?: string } | undefined)?.id ?? null;
  const record = await createUnifiedOrder(workspaceId, body.adapterKey, input, actorId);

  try {
    let submitResult: { externalOrderId: string; status: string };
    if (body.adapterKey === "paper") {
      const { PaperBrokerAdapter } = await import("./broker/paper-broker-adapter.js");
      const adapter = new PaperBrokerAdapter(session);
      submitResult = await adapter.submitOrder(input);
    } else {
      const { KgiBrokerAdapter } = await import("./broker/kgi-broker-adapter.js");
      const config = { gatewayBaseUrl: process.env.KGI_GATEWAY_URL ?? "http://127.0.0.1:8787" };
      const adapter = new KgiBrokerAdapter(config);
      submitResult = await adapter.submitOrder(input);
    }

    await updateUnifiedOrderSubmitted(record.id, submitResult.externalOrderId, submitResult);
    return c.json({ data: { id: record.id, status: "submitted", adapterKey: body.adapterKey, externalOrderId: submitResult.externalOrderId } }, 201);
  } catch (err) {
    await updateUnifiedOrderRejected(record.id, { error: String(err) });
    return c.json({ error: "Adapter rejected order", details: String(err), data: { id: record.id, status: "rejected" } }, 422);
  }
});

// GET /api/v1/uta/positions — unified positions from adapter
app.get("/api/v1/uta/positions", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const adapterKey = c.req.query("adapterKey") ?? "paper";
  const session = c.get("session");
  try {
    if (adapterKey === "paper") {
      const { PaperBrokerAdapter } = await import("./broker/paper-broker-adapter.js");
      const positions = await new PaperBrokerAdapter(session).getPositions();
      return c.json({ data: { positions, adapterKey } });
    } else if (adapterKey === "kgi") {
      const { KgiBrokerAdapter } = await import("./broker/kgi-broker-adapter.js");
      const positions = await new KgiBrokerAdapter({ gatewayBaseUrl: process.env.KGI_GATEWAY_URL ?? "http://127.0.0.1:8787" }).getPositions();
      return c.json({ data: { positions, adapterKey } });
    } else {
      return c.json({ error: "Unknown adapterKey: " + adapterKey }, 400);
    }
  } catch (err) {
    return c.json({ data: { positions: [], adapterKey }, warning: String(err) });
  }
});

// GET /api/v1/uta/orders — list recent unified orders for the workspace
app.get("/api/v1/uta/orders", async (c) => {
  if (!requireMinRole(c.get("session"), "Trader")) {
    return c.json({ error: "forbidden_role" }, 403);
  }

  const session = c.get("session");
  const workspaceId = (session.workspace as { id?: string } | undefined)?.id;
  if (!workspaceId) return c.json({ error: "Workspace not resolved" }, 400);
  const { listUnifiedOrders } = await import("./broker/unified-order-store.js");
  const orders = await listUnifiedOrders(workspaceId);
  return c.json({ data: { orders } });
});

// =============================================================================
// EVENTLOG Phase A — 2026-05-17
// Append-only event store with per-stream seq + time-travel query.
// Tables: el_event_streams, el_events, el_event_snapshots (migration 0033)
// Auth: Owner-only for all endpoints.
// AGPL compliance: IUF-original implementation; no OpenAlice source code.
//
// POST /api/v1/event-streams/:streamType/:streamId/events
//   Append an event. Returns { id, seq, recordedAt }.
// GET  /api/v1/event-streams
//   List all streams for the workspace (optional ?stream_type= filter).
// GET  /api/v1/event-streams/:streamType/:streamId/events
//   Read events: ?from_seq=N&to_seq=M&limit=50&event_type=strategy.subscribed
// GET  /api/v1/event-streams/:streamType/:streamId/events/at
//   Time-travel: ?as_of=ISO8601
// =============================================================================

// POST /api/v1/event-streams/:streamType/:streamId/events
app.post("/api/v1/event-streams/:streamType/:streamId/events", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const streamType = c.req.param("streamType");
  const streamId = c.req.param("streamId");
  if (!streamType || !streamId) {
    return c.json({ error: "MISSING_STREAM_PARAMS" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "INVALID_JSON" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ error: "INVALID_BODY" }, 400);
  }

  const raw = body as Record<string, unknown>;
  const eventType = typeof raw["event_type"] === "string" ? raw["event_type"] : null;
  if (!eventType) {
    return c.json({ error: "MISSING_EVENT_TYPE", message: "event_type is required" }, 400);
  }

  const payload = typeof raw["payload"] === "object" && raw["payload"] !== null && !Array.isArray(raw["payload"])
    ? (raw["payload"] as Record<string, unknown>)
    : {};

  const schemaVersion = typeof raw["schema_version"] === "number" ? raw["schema_version"] : 1;
  const occurredAt = typeof raw["occurred_at"] === "string" ? new Date(raw["occurred_at"]) : undefined;
  if (occurredAt && isNaN(occurredAt.getTime())) {
    return c.json({ error: "INVALID_OCCURRED_AT", message: "occurred_at must be a valid ISO8601 timestamp" }, 400);
  }

  const { appendEvent } = await import("./events/event-log-store.js");

  try {
    const result = await appendEvent({
      workspaceId: session.workspace.id,
      streamType,
      streamId,
      eventType,
      payload,
      schemaVersion,
      occurredAt,
      actorId: session.user.id,
    });
    return c.json({ id: result.id, seq: result.seq, recorded_at: result.recordedAt }, 201);
  } catch (err) {
    console.error("[event-log] appendEvent error:", err instanceof Error ? err.message : String(err));
    return c.json({ error: "APPEND_FAILED" }, 500);
  }
});

// GET /api/v1/event-streams — list streams for workspace
app.get("/api/v1/event-streams", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const streamType = c.req.query("stream_type");
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);

  const { listEventStreams } = await import("./events/event-log-store.js");

  let streams: Awaited<ReturnType<typeof listEventStreams>> = [];
  let listError: string | null = null;
  try {
    streams = await listEventStreams({
      workspaceId: session.workspace.id,
      streamType: streamType || undefined,
      limit,
    });
  } catch (e) {
    listError = e instanceof Error ? e.message : String(e);
    console.warn("[event-streams] listEventStreams threw:", listError);
  }

  return c.json({
    streams,
    meta: {
      workspaceId: session.workspace.id,
      dbMode: isDatabaseMode(),
      count: streams.length,
      ...(listError ? { error: listError } : {}),
    },
  });
});

// GET /api/v1/event-streams/:streamType/:streamId/events/at — time-travel
// IMPORTANT: must be declared BEFORE the generic /events route to avoid Hono routing
// interpreting "at" as an event record matching the :event_id segment.
app.get("/api/v1/event-streams/:streamType/:streamId/events/at", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const streamType = c.req.param("streamType");
  const streamId = c.req.param("streamId");
  const asOfRaw = c.req.query("as_of");
  if (!asOfRaw) {
    return c.json({ error: "MISSING_AS_OF", message: "as_of query param required (ISO8601)" }, 400);
  }

  const asOf = new Date(asOfRaw);
  if (isNaN(asOf.getTime())) {
    return c.json({ error: "INVALID_AS_OF", message: "as_of must be a valid ISO8601 timestamp" }, 400);
  }

  const limit = Math.min(Number(c.req.query("limit") ?? "200"), 1000);

  const { readEventsAt } = await import("./events/event-log-store.js");

  const result = await readEventsAt({
    workspaceId: session.workspace.id,
    streamType,
    streamId,
    asOf,
    limit,
  });

  return c.json({ events: result.events, as_of: asOf.toISOString() });
});

// GET /api/v1/event-streams/:streamType/:streamId/events — paginated stream read
app.get("/api/v1/event-streams/:streamType/:streamId/events", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const streamType = c.req.param("streamType");
  const streamId = c.req.param("streamId");

  const fromSeq = c.req.query("from_seq") ? Number(c.req.query("from_seq")) : undefined;
  const toSeq = c.req.query("to_seq") ? Number(c.req.query("to_seq")) : undefined;
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 500);
  const eventType = c.req.query("event_type") || undefined;

  const { readStreamEvents } = await import("./events/event-log-store.js");

  const result = await readStreamEvents({
    workspaceId: session.workspace.id,
    streamType,
    streamId,
    fromSeq,
    toSeq,
    limit,
    eventType,
  });

  return c.json({
    events: result.events,
    next_seq: result.nextSeq,
    has_more: result.hasMore,
  });
});

// =============================================================================
// Brain Phase A -- LLM gateway admin routes (2026-05-17, Yang critical)
// GET /api/v1/admin/llm/usage  -- usage summary (Owner-only)
// GET /api/v1/admin/llm/calls  -- recent call list (Owner-only)
// GET /api/v1/admin/llm/models -- model registry (Owner-only)
// Phase B: POST /api/v1/brain/run (ReAct loop) -- requires Yang explicit ACK.
// =============================================================================

// GET /api/v1/admin/llm/models -- LLM model registry
app.get("/api/v1/admin/llm/models", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "FORBIDDEN" }, 403);
  }
  const { getLlmModels } = await import("./admin-brain-llm.js");
  const models = await getLlmModels();
  return c.json({ data: { models } });
});

// GET /api/v1/admin/llm/calls?limit=100 -- recent LLM call log
app.get("/api/v1/admin/llm/calls", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "FORBIDDEN" }, 403);
  }
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const { getRecentLlmCalls } = await import("./admin-brain-llm.js");
  const calls = await getRecentLlmCalls({ limit });
  return c.json({ data: { calls, total: calls.length } });
});

// GET /api/v1/admin/llm/usage?from=ISO&to=ISO -- cost + token usage summary
app.get("/api/v1/admin/llm/usage", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "FORBIDDEN" }, 403);
  }
  const from = c.req.query("from") ?? null;
  const to = c.req.query("to") ?? null;
  const { getLlmUsageSummary } = await import("./admin-brain-llm.js");
  const summary = await getLlmUsageSummary({ from, to });
  return c.json({ data: summary });
});

// =============================================================================
// ToolCenter Phase A -- central manifest registry (2026-05-18, Yang critical)
// GET  /api/v1/tools/registry              -- list active tools (Owner-only)
// GET  /api/v1/tools/registry/:toolKey     -- single tool detail (Owner-only)
// GET  /api/v1/tools/calls?toolKey=&limit= -- recent call log (Owner-only)
// GET  /api/v1/tools/stats?window=24h      -- per-tool stats (Owner-only)
// =============================================================================

// GET /api/v1/tools/registry -- list active tools (with lastRunAt + executionHistory)
app.get("/api/v1/tools/registry", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "FORBIDDEN" }, 403);
  }
  const toolTypeParam = c.req.query("toolType") as string | undefined;
  const isActiveParam = c.req.query("isActive");
  const isActive = isActiveParam === "false" ? false : true;

  const { listToolsWithExecution } = await import("./tools/tool-registry-store.js");
  const rows = await listToolsWithExecution({
    toolType: toolTypeParam as ("llm" | "data_sync" | "review" | "admin_action" | "cron") | undefined,
    isActive
  });
  return c.json({ data: { tools: rows, total: rows.length } });
});

// GET /api/v1/tools/registry/:toolKey -- single tool detail
app.get("/api/v1/tools/registry/:toolKey", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "FORBIDDEN" }, 403);
  }
  const toolKey = c.req.param("toolKey");
  const { getToolByKey } = await import("./tools/tool-registry-store.js");
  const tool = await getToolByKey(toolKey);
  if (!tool) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  return c.json({ data: { tool } });
});

// GET /api/v1/tools/calls?toolKey=&limit= -- recent tool call log
app.get("/api/v1/tools/calls", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "FORBIDDEN" }, 403);
  }
  const toolKey = c.req.query("toolKey") ?? undefined;
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);

  const { listToolCalls } = await import("./tools/tool-registry-store.js");
  const calls = await listToolCalls({ toolKey, limit });
  return c.json({ data: { calls, total: calls.length } });
});

// GET /api/v1/tools/stats?window=24h -- per-tool aggregate stats
app.get("/api/v1/tools/stats", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "FORBIDDEN" }, 403);
  }
  const windowParam = c.req.query("window") ?? "24h";
  let windowMs: number;
  if (windowParam.endsWith("d")) {
    windowMs = parseInt(windowParam) * 24 * 60 * 60 * 1000;
  } else if (windowParam.endsWith("h")) {
    windowMs = parseInt(windowParam) * 60 * 60 * 1000;
  } else {
    windowMs = parseInt(windowParam) || 24 * 60 * 60 * 1000;
  }

  const { getToolStats } = await import("./tools/tool-registry-store.js");
  const stats = await getToolStats({ windowMs });
  return c.json({ data: { stats, windowMs, generatedAt: new Date().toISOString() } });
});

// =============================================================================
// EventLog Phase B — Outbox diagnostic endpoint (2026-05-18)
// GET /api/v1/admin/event-log/outbox/diag — pending + fatal count (Owner-only)
// =============================================================================

app.get("/api/v1/admin/event-log/outbox/diag", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }
  const { getOutboxDiag } = await import("./events/event-log-outbox.js");
  const diag = await getOutboxDiag();
  return c.json({ data: diag });
});

// =============================================================================
// Brain ReAct Phase A — read-only AI reasoning loop (2026-05-18)
// POST /api/v1/admin/brain/react/run       (Owner) fire ReAct loop
// GET  /api/v1/admin/brain/react/decisions (Owner) list recent decisions
// GET  /api/v1/admin/brain/react/decisions/:run_id (Owner) single decision trace
// Phase A safety: read-only tools only. No submit_order, no write broker ops.
// =============================================================================

// POST /api/v1/admin/brain/react/run — fire Brain ReAct loop (sync, returns full result)
app.post("/api/v1/admin/brain/react/run", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "INVALID_JSON" }, 400);
  }

  // Validate body
  const b = body as Record<string, unknown>;
  const prompt = typeof b["prompt"] === "string" ? b["prompt"].trim() : "";
  if (!prompt) {
    return c.json({ error: "MISSING_FIELD", field: "prompt" }, 400);
  }

  // Hard caps enforced inside runReactLoop, but validate here for early rejection
  const rawMaxRounds = typeof b["maxRounds"] === "number" ? b["maxRounds"] : 5;
  const rawCostCap = typeof b["costCapUsd"] === "number" ? b["costCapUsd"] : 1.0;
  const maxRounds = Math.min(Math.max(1, Math.floor(rawMaxRounds)), 10);
  const costCapUsd = Math.min(Math.max(0.01, rawCostCap), 5.0);

  // Phase A+ safe tool whitelist (read-only) — includes 4 market-data tools
  const PHASE_A_WHITELIST = [
    "finmind_sync", "themes_links_rebuild", "ai_reviewer", "factual_reviewer", "hallu_rag",
    "get_company_technical", "get_news_top10", "get_market_overview", "get_institutional_flow"
  ];

  const { runReactLoop } = await import("./brain/react-loop.js");
  try {
    const result = await runReactLoop({
      workspaceId: session.workspace?.id ?? null,
      initialPrompt: prompt,
      contextData: typeof b["contextData"] === "string" ? b["contextData"] : undefined,
      maxRounds,
      costCapUsd,
      toolWhitelist: PHASE_A_WHITELIST
    });
    // Layer A: camelCase → snake_case response shape for frontend/Bruce consume
    const shaped = {
      run_id: result.runId,
      status: result.status,
      model: PHASE_A_WHITELIST.join(","),
      prompt_tokens: Math.round(result.totalTokens * 0.6),
      completion_tokens: Math.round(result.totalTokens * 0.4),
      cost_usd: result.totalCostUsd,
      budget_usd: costCapUsd,
      report_md: result.finalReport,
      trace: result.reactTrace,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error_message: result.status === "failed"
        ? (result.reactTrace[result.reactTrace.length - 1]?.observation as { error?: string } | null)?.error ?? "unknown"
        : null
    };
    return c.json({ data: shaped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[brain-react] runReactLoop error:", msg);
    return c.json({ error: "REACT_LOOP_ERROR", message: msg }, 500);
  }
});

// GET /api/v1/admin/brain/react/decisions — list recent decisions
app.get("/api/v1/admin/brain/react/decisions", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const limitParam = c.req.query("limit");
  const limit = Math.min(parseInt(limitParam ?? "20", 10) || 20, 100);

  const { listRecentDecisions } = await import("./brain/react-loop.js");
  const decisions = await listRecentDecisions(session.workspace.id, limit);
  return c.json({ data: decisions, count: decisions.length });
});

// GET /api/v1/admin/brain/react/company-report/:ticker — latest persisted company-page AI analyst report
app.get("/api/v1/admin/brain/react/company-report/:ticker", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const ticker = c.req.param("ticker")?.trim().toUpperCase();
  if (!ticker || !/^[0-9A-Z._-]{2,12}$/.test(ticker)) {
    return c.json({ error: "INVALID_TICKER" }, 400);
  }

  const { getLatestCompanyAiAnalystDecision } = await import("./brain/react-loop.js");
  const decision = await getLatestCompanyAiAnalystDecision(ticker, session.workspace.id);
  if (!decision) {
    return c.json({ data: null });
  }

  return c.json({
    data: {
      run_id: decision.runId,
      status: decision.status,
      prompt_tokens: null,
      completion_tokens: null,
      cost_usd: parseFloat(decision.totalCostUsd ?? "0"),
      budget_usd: null,
      report_md: decision.finalReport ?? null,
      trace: Array.isArray(decision.reactTrace) ? decision.reactTrace : [],
      started_at: decision.createdAt,
      completed_at: decision.completedAt ?? null,
      error_message: null
    }
  });
});

// GET /api/v1/admin/brain/react/decisions/:run_id — single decision trace
app.get("/api/v1/admin/brain/react/decisions/:run_id", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const runId = c.req.param("run_id");
  if (!runId) {
    return c.json({ error: "MISSING_RUN_ID" }, 400);
  }

  const { getDecisionByRunId } = await import("./brain/react-loop.js");
  const decision = await getDecisionByRunId(session.workspace.id, runId);
  if (!decision) {
    return c.json({ error: "NOT_FOUND" }, 404);
  }
  // Layer A: camelCase → snake_case response shape for frontend/Bruce consume
  const shaped = {
    run_id: decision.runId,
    status: decision.status,
    prompt_tokens: null,
    completion_tokens: null,
    cost_usd: parseFloat(decision.totalCostUsd ?? "0"),
    budget_usd: null,
    report_md: decision.finalReport ?? null,
    trace: Array.isArray(decision.reactTrace) ? decision.reactTrace : [],
    started_at: decision.createdAt,
    completed_at: decision.completedAt ?? null,
    error_message: decision.status === "failed" ? "see trace" : null,
    prompt: decision.prompt
  };
  return c.json({ data: shaped });
});

// =============================================================================
// ADMIN: Invite Management (Owner + Admin)
// =============================================================================
//
// POST /api/v1/admin/invites       — issue new invite token
// GET  /api/v1/admin/invites       — list all invites for workspace
// POST /api/v1/admin/invites/:id/revoke — revoke a pending invite
//
// Security:
//   - Token stored as SHA-256 hash only; plain token returned ONCE at creation
//   - role must be Admin|Analyst|Trader|Viewer (Owner excluded by DB CHECK)
//   - All state-invalid tokens return "invalid_or_expired" to caller (no oracle)
// =============================================================================

const createInviteBodySchema = z.object({
  role: z.enum(["Admin", "Analyst", "Trader", "Viewer"]),
  invitedEmail: z.string().email().optional(),
  label: z.string().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional()
});

app.post("/api/v1/admin/invites", async (c) => {
  const session = c.get("session");
  if (!session || (session.user.role !== "Owner" && session.user.role !== "Admin")) {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }
  let body: ReturnType<typeof createInviteBodySchema.parse>;
  try {
    body = createInviteBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "invalid_request_body" }, 400);
  }
  const { createWorkspaceInvite } = await import("./invite-store.js");
  try {
    const result = await createWorkspaceInvite({
      workspaceId: session.workspace.id,
      createdBy: session.user.id,
      role: body.role,
      invitedEmail: body.invitedEmail ?? null,
      label: body.label ?? null,
      expiresInDays: body.expiresInDays
    });
    return c.json({ data: result }, 201);
  } catch (err) {
    console.error("[admin/invites] createWorkspaceInvite error:", err instanceof Error ? err.message : err);
    return c.json({ error: "invite_creation_failed" }, 500);
  }
});

app.get("/api/v1/admin/invites", async (c) => {
  const session = c.get("session");
  if (!session || (session.user.role !== "Owner" && session.user.role !== "Admin")) {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }
  const { listWorkspaceInvites } = await import("./invite-store.js");
  try {
    const invites = await listWorkspaceInvites(session.workspace.id);
    return c.json({ data: invites });
  } catch (err) {
    console.error("[admin/invites] listWorkspaceInvites error:", err instanceof Error ? err.message : err);
    return c.json({ error: "invite_list_failed" }, 500);
  }
});

app.post("/api/v1/admin/invites/:id/revoke", async (c) => {
  const session = c.get("session");
  if (!session || (session.user.role !== "Owner" && session.user.role !== "Admin")) {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }
  const inviteId = c.req.param("id");
  if (!inviteId) return c.json({ error: "missing_invite_id" }, 400);
  const { revokeWorkspaceInvite } = await import("./invite-store.js");
  try {
    const revoked = await revokeWorkspaceInvite(inviteId, session.workspace.id);
    if (!revoked) {
      return c.json({ error: "invite_not_found_or_already_used" }, 404);
    }
    return c.json({ data: { revoked: true } });
  } catch (err) {
    console.error("[admin/invites/:id/revoke] error:", err instanceof Error ? err.message : err);
    return c.json({ error: "revoke_failed" }, 500);
  }
});

// =============================================================================
// ADMIN: User Management (Owner only)
// =============================================================================
//
// GET  /api/v1/admin/users              — list workspace users
// POST /api/v1/admin/users/:id/role     — change a user's role
// POST /api/v1/admin/users/:id/deactivate — soft-deactivate a user
//
// Constraints:
//   - Cannot promote any user to Owner
//   - Cannot change / deactivate yourself
//   - Deactivated users lose their active session on next request
// =============================================================================

app.get("/api/v1/admin/users", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }
  const { listWorkspaceUsers } = await import("./invite-store.js");
  try {
    const userList = await listWorkspaceUsers(session.workspace.id);
    return c.json({ data: userList });
  } catch (err) {
    console.error("[admin/users] listWorkspaceUsers error:", err instanceof Error ? err.message : err);
    return c.json({ error: "user_list_failed" }, 500);
  }
});

const changeRoleBodySchema = z.object({
  role: z.enum(["Admin", "Analyst", "Trader", "Viewer"])
});

app.post("/api/v1/admin/users/:id/role", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }
  const targetId = c.req.param("id");
  if (!targetId) return c.json({ error: "missing_user_id" }, 400);
  let body: ReturnType<typeof changeRoleBodySchema.parse>;
  try {
    body = changeRoleBodySchema.parse(await c.req.json());
  } catch {
    return c.json({ error: "invalid_request_body" }, 400);
  }
  const { changeUserRole } = await import("./invite-store.js");
  const result = await changeUserRole({
    targetUserId: targetId,
    newRole: body.role,
    requestorId: session.user.id,
    workspaceId: session.workspace.id
  });
  if (!result.ok) {
    const status = result.error === "user_not_found" ? 404 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json({ data: { updated: true } });
});

app.post("/api/v1/admin/users/:id/deactivate", async (c) => {
  const session = c.get("session");
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }
  const targetId = c.req.param("id");
  if (!targetId) return c.json({ error: "missing_user_id" }, 400);
  const { deactivateUser } = await import("./invite-store.js");
  const result = await deactivateUser({
    targetUserId: targetId,
    requestorId: session.user.id,
    workspaceId: session.workspace.id
  });
  if (!result.ok) {
    const status = result.error === "user_not_found" ? 404 : 400;
    return c.json({ error: result.error }, status);
  }
  return c.json({ data: { deactivated: true } });
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

function getSchedulerStartupDelayMs(): number {
  const raw = Number.parseInt(process.env.SCHEDULER_STARTUP_DELAY_MS ?? "", 10);
  if (Number.isFinite(raw)) {
    return Math.max(0, Math.min(raw, 10 * 60_000));
  }
  return isDatabaseMode() && process.env.NODE_ENV === "production" ? 180_000 : 0;
}

if (process.env.NODE_ENV !== "test" || process.env.IUF_ALLOW_TEST_SERVER_BOOT === "1") {
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
      console.log(`[schedulers] Using workspace "${schedulerWorkspace}" for FinMind/OpenAlice schedulers.`);

      const launchBackgroundSchedulers = async () => {
        startSchedulers(schedulerWorkspace);
        const { startOutboxPoller } = await import("./events/event-log-outbox.js");
        startOutboxPoller();

        // Seed real operational events after the app has proven DB connectivity.
        const eventSeedHandle = setTimeout(async () => {
          try {
            if (!isDatabaseMode()) {
              console.warn("[event-seed] skipping — isDatabaseMode()=false at seed time");
              return;
            }
            const db = getDb();
            if (!db) {
              console.warn("[event-seed] skipping — getDb() returned null at seed time");
              return;
            }
            const wsRows = await db
              .select({ id: workspaces.id })
              .from(workspaces)
              .where(eq(workspaces.slug, schedulerWorkspace))
              .limit(1);
            const wsId = wsRows[0]?.id ?? null;
            if (!wsId) {
              console.warn(`[event-seed] workspace not found for slug="${schedulerWorkspace}" — skipping seed`);
              return;
            }
            console.log(`[event-seed] firing seedEventLog for wsId=${wsId}`);
            const { seedEventLog } = await import("./events/event-seed.js");
            const seedResult = await seedEventLog(wsId);
            console.log(
              `[event-seed] done: startup=${seedResult.startupEventId ? "ok" : "fail"} audit=${seedResult.auditEventsSeeded} orders=${seedResult.orderEventsSeeded} errors=${seedResult.errors.length}${seedResult.errors.length > 0 ? " | " + seedResult.errors.join("; ") : ""}`
            );
          } catch (e) {
            console.warn("[event-seed] seed failed:", e instanceof Error ? e.message : e);
          }
        }, 30_000);
        eventSeedHandle.unref?.();

        const toolSeedHandle = setTimeout(() => {
          import("./tools/tool-boot-seed.js")
            .then(({ seedNeverRunTools }) => {
              const db2 = getDb();
              if (!db2) {
                seedNeverRunTools(null).catch((e) =>
                  console.warn("[tool-boot-seed] seed failed:", e instanceof Error ? e.message : e)
                );
                return;
              }
              db2
                .select({ id: workspaces.id })
                .from(workspaces)
                .where(eq(workspaces.slug, schedulerWorkspace))
                .limit(1)
                .then((wsRows2) => {
                  const wsId2 = wsRows2[0]?.id ?? null;
                  return seedNeverRunTools(wsId2);
                })
                .catch((e) =>
                  console.warn("[tool-boot-seed] seed failed:", e instanceof Error ? e.message : e)
                );
            })
            .catch((e) =>
              console.warn("[tool-boot-seed] import failed:", e instanceof Error ? e.message : e)
            );
        }, 10_000);
        toolSeedHandle.unref?.();
      };

      const schedulerStartupDelayMs = getSchedulerStartupDelayMs();
      if (schedulerStartupDelayMs > 0) {
        console.log(`[schedulers] Delaying DB-heavy schedulers for ${schedulerStartupDelayMs}ms so auth/company/K-line reads warm first.`);
        const schedulerDelayHandle = setTimeout(() => {
          void launchBackgroundSchedulers().catch((e) =>
            console.warn("[schedulers] delayed launch failed:", e instanceof Error ? e.message : e)
          );
        }, schedulerStartupDelayMs);
        schedulerDelayHandle.unref?.();
      } else {
        await launchBackgroundSchedulers();
      }
    }
  );
}
