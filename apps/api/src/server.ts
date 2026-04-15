import { timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import type { Context } from "hono";
import {
  type AppSession,
  companyMergeInputSchema,
  companyCreateInputSchema,
  companyKeywordsReplaceInputSchema,
  companyRelationsReplaceInputSchema,
  companyUpdateInputSchema,
  dailyBriefCreateInputSchema,
  marketStateSchema,
  reviewEntryCreateInputSchema,
  signalCreateInputSchema,
  signalUpdateInputSchema,
  themeCreateInputSchema,
  themeLifecycleSchema,
  themeUpdateInputSchema,
  tradePlanCreateInputSchema,
  tradePlanUpdateInputSchema
} from "@iuf-trading-room/contracts";
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

type Variables = {
  repo: TradingRoomRepository;
  session: AppSession;
};

const app = new Hono<{ Variables: Variables }>();
const repository = getTradingRoomRepository();

app.use("*", cors({ origin: "*" }));

app.use("/api/v1/*", async (c, next) => {
  const workspaceSlug = c.req.header("x-workspace-slug") ?? process.env.DEFAULT_WORKSPACE_SLUG;
  const roleHeader = c.req.header("x-user-role");
  const allowedRoles = ["Owner", "Admin", "Analyst", "Trader", "Viewer"] as const;
  const roleOverride = allowedRoles.find((role) => role === roleHeader);

  const session = await repository.getSession({
    workspaceSlug,
    roleOverride
  });

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
    uptime: process.uptime()
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

app.post("/api/v1/openalice/register", async (c) => {
  const payload = openAliceRegisterSchema.parse(await c.req.json());
  const registration = await registerOpenAliceDevice({
    workspaceSlug: c.get("session").workspace.slug,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    capabilities: payload.capabilities
  });

  return c.json({ data: registration }, 201);
});

app.get("/api/v1/openalice/devices", async (c) =>
  c.json({
    data: await listOpenAliceDevices(c.get("session").workspace.slug)
  })
);

app.post("/api/v1/openalice/devices/:deviceId/revoke", async (c) => {
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
  const payload = openAliceCleanupDevicesSchema.parse(await c.req.json().catch(() => ({})));
  return c.json({
    data: await cleanupStaleOpenAliceDevices({
      workspaceSlug: c.get("session").workspace.slug,
      staleSeconds: payload.staleSeconds
    })
  });
});

app.get("/api/v1/openalice/jobs", async (c) =>
  c.json({
    data: await listOpenAliceJobs(c.get("session").workspace.slug)
  })
);

app.patch("/api/v1/openalice/jobs/:jobId/review", async (c) => {
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

app.get("/api/v1/openalice/observability", async (c) =>
  c.json({
    data: await getOpenAliceObservabilitySnapshot(c.get("session").workspace.slug)
  })
);

app.post("/api/v1/openalice/jobs", async (c) => {
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
  const opts = { workspaceSlug: c.get("session").workspace.slug };

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

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

serve(
  {
    fetch: app.fetch,
    port,
    hostname: host
  },
  (info) => {
    console.log(`IUF Trading Room API listening on http://${host}:${info.port}`);
  }
);
