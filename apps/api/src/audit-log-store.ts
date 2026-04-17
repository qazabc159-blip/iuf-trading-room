import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { AppSession } from "@iuf-trading-room/contracts";
import { auditLogs, getDb, isDatabaseMode } from "@iuf-trading-room/db";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "merge"
  | "register"
  | "revoke"
  | "cleanup"
  | "review"
  | "ingest"
  | "import"
  | "replace";

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

type ParsedAuditTarget = {
  action: AuditAction;
  entityType: string;
  entityId: string;
};

const specialAuditRoutes: Array<{
  matcher: RegExp;
  action: AuditAction;
  entityType: string;
  entityId?: string | ((match: RegExpExecArray) => string);
}> = [
  {
    matcher: /^\/api\/v1\/openalice\/register$/,
    action: "register",
    entityType: "openalice_device",
    entityId: "pending"
  },
  {
    matcher: /^\/api\/v1\/openalice\/devices\/([^/]+)\/revoke$/,
    action: "revoke",
    entityType: "openalice_device",
    entityId: (match) => match[1] ?? "unknown"
  },
  {
    matcher: /^\/api\/v1\/openalice\/devices\/cleanup$/,
    action: "cleanup",
    entityType: "openalice_device",
    entityId: "stale_cleanup"
  },
  {
    matcher: /^\/api\/v1\/openalice\/jobs\/([^/]+)\/review$/,
    action: "review",
    entityType: "openalice_job",
    entityId: (match) => match[1] ?? "unknown"
  },
  {
    matcher: /^\/api\/v1\/webhooks\/tradingview$/,
    action: "ingest",
    entityType: "tradingview_webhook",
    entityId: "event"
  },
  {
    matcher: /^\/api\/v1\/import\/my-tw-coverage$/,
    action: "import",
    entityType: "my_tw_coverage",
    entityId: "import"
  },
  {
    matcher: /^\/api\/v1\/companies\/([^/]+)\/relations$/,
    action: "replace",
    entityType: "company_relation",
    entityId: (match) => match[1] ?? "unknown"
  },
  {
    matcher: /^\/api\/v1\/companies\/([^/]+)\/keywords$/,
    action: "replace",
    entityType: "company_keyword",
    entityId: (match) => match[1] ?? "unknown"
  },
  {
    matcher: /^\/api\/v1\/companies\/merge$/,
    action: "merge",
    entityType: "company_merge",
    entityId: "pending"
  },
  {
    matcher: /^\/api\/v1\/risk\/limits$/,
    action: "replace",
    entityType: "risk_limit",
    entityId: "pending"
  },
  {
    matcher: /^\/api\/v1\/risk\/kill-switch$/,
    action: "update",
    entityType: "kill_switch",
    entityId: "pending"
  },
  {
    matcher: /^\/api\/v1\/risk\/checks$/,
    action: "create",
    entityType: "risk_check",
    entityId: "pending"
  }
];

function singularize(value: string) {
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }

  if (value.endsWith("s")) {
    return value.slice(0, -1);
  }

  return value;
}

export function parseAuditTarget(method: string, path: string): ParsedAuditTarget | null {
  for (const route of specialAuditRoutes) {
    const match = route.matcher.exec(path);
    if (!match) {
      continue;
    }

    return {
      action: route.action,
      entityType: route.entityType,
      entityId:
        typeof route.entityId === "function"
          ? route.entityId(match)
          : route.entityId ?? "unknown"
    };
  }

  const match = /^\/api\/v1\/([^/]+)(?:\/([^/]+))?/.exec(path);
  if (!match) {
    return null;
  }

  const resource = singularize(match[1] ?? "resource");
  const entityId = match[2] ?? "pending";
  const action =
    method === "POST"
      ? "create"
      : method === "PATCH"
        ? "update"
        : method === "DELETE"
          ? "delete"
          : null;

  if (!action) {
    return null;
  }

  return {
    action,
    entityType: resource,
    entityId
  };
}

export async function writeAuditLog(input: {
  session: AppSession;
  method: string;
  path: string;
  status: number;
  payload?: Record<string, unknown>;
}) {
  if (!isDatabaseMode()) {
    return null;
  }

  const db = getDb();
  if (!db) {
    return null;
  }

  const target = parseAuditTarget(input.method, input.path);
  if (!target) {
    return null;
  }

  const [row] = await db
    .insert(auditLogs)
    .values({
      workspaceId: input.session.workspace.id,
      actorId: input.session.user.id,
      action: target.action,
      entityType: target.entityType,
      entityId: target.entityId,
      payload: {
        method: input.method,
        path: input.path,
        status: input.status,
        role: input.session.user.role,
        ...(input.payload ?? {})
      }
    })
    .returning();

  return row ?? null;
}

export async function listAuditLogEntries(input: {
  session: AppSession;
  limit?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  method?: string;
  path?: string;
  status?: number;
  role?: string;
  search?: string;
  scanLimit?: number;
}) {
  if (!isDatabaseMode()) {
    return [] as AuditEntry[];
  }

  const db = getDb();
  if (!db) {
    return [] as AuditEntry[];
  }

  const filters = [eq(auditLogs.workspaceId, input.session.workspace.id)];
  if (input.action) {
    filters.push(eq(auditLogs.action, input.action));
  }
  if (input.entityType) {
    filters.push(eq(auditLogs.entityType, input.entityType));
  }
  if (input.entityId) {
    filters.push(eq(auditLogs.entityId, input.entityId));
  }
  if (input.from) {
    filters.push(gte(auditLogs.createdAt, input.from));
  }
  if (input.to) {
    filters.push(lte(auditLogs.createdAt, input.to));
  }

  const shouldPostFilter = Boolean(
    input.method || input.path || input.status !== undefined || input.role || input.search
  );
  const scanLimit = Math.max(
    input.limit ?? 50,
    input.scanLimit ?? (shouldPostFilter ? 500 : input.limit ?? 50)
  );

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...filters))
    .orderBy(desc(auditLogs.createdAt))
    .limit(scanLimit);

  const normalized = rows.map((row) => {
    const payload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    const method = typeof payload.method === "string" ? payload.method : undefined;
    const path = typeof payload.path === "string" ? payload.path : undefined;
    const status =
      typeof payload.status === "number"
        ? payload.status
        : typeof payload.status === "string" && /^\d+$/.test(payload.status)
          ? Number(payload.status)
          : undefined;
    const role = typeof payload.role === "string" ? payload.role : undefined;
    const workspace = typeof payload.workspace === "string" ? payload.workspace : undefined;

    return {
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      payload,
      createdAt: row.createdAt.toISOString(),
      method,
      path,
      status,
      role,
      workspace
    } satisfies AuditEntry;
  });

  const searchNeedle = input.search?.trim().toLowerCase();

  return normalized
    .filter((entry) => {
      if (input.method && entry.method !== input.method) {
        return false;
      }
      if (input.path && entry.path !== input.path) {
        return false;
      }
      if (input.status !== undefined && entry.status !== input.status) {
        return false;
      }
      if (input.role && entry.role !== input.role) {
        return false;
      }
      if (!searchNeedle) {
        return true;
      }

      return [
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.method ?? "",
        entry.path ?? "",
        entry.role ?? "",
        entry.workspace ?? "",
        String(entry.status ?? "")
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchNeedle);
    })
    .slice(0, input.limit ?? 50);
}

export function summarizeAuditEntries(
  entries: AuditEntry[],
  windowHours: number
): AuditSummary {
  const actionCounts = new Map<string, number>();
  const entityCounts = new Map<string, number>();

  for (const entry of entries) {
    actionCounts.set(entry.action, (actionCounts.get(entry.action) ?? 0) + 1);
    entityCounts.set(entry.entityType, (entityCounts.get(entry.entityType) ?? 0) + 1);
  }

  const actions = [...actionCounts.entries()]
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action));

  const entities = [...entityCounts.entries()]
    .map(([entityType, count]) => ({ entityType, count }))
    .sort((a, b) => b.count - a.count || a.entityType.localeCompare(b.entityType));

  return {
    windowHours,
    total: entries.length,
    latestCreatedAt: entries[0]?.createdAt ?? null,
    actions,
    entities,
    recent: entries.slice(0, 10)
  };
}

export async function getAuditLogSummary(input: {
  session: AppSession;
  hours?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  method?: string;
  path?: string;
  status?: number;
  role?: string;
  search?: string;
}) {
  const windowHours = Math.max(1, Math.min(input.hours ?? 24, 24 * 30));
  const from = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const entries = await listAuditLogEntries({
    session: input.session,
    limit: 500,
    scanLimit: 1_000,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    from,
    method: input.method,
    path: input.path,
    status: input.status,
    role: input.role,
    search: input.search
  });

  return summarizeAuditEntries(entries, windowHours);
}

function escapeCsvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function formatAuditEntriesAsCsv(entries: AuditEntry[]) {
  const header = [
    "created_at",
    "action",
    "entity_type",
    "entity_id",
    "method",
    "path",
    "status",
    "role",
    "workspace",
    "payload_json"
  ];

  const rows = entries.map((entry) => [
    entry.createdAt,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.method ?? "",
    entry.path ?? "",
    entry.status === undefined ? "" : String(entry.status),
    entry.role ?? "",
    entry.workspace ?? "",
    JSON.stringify(entry.payload ?? {})
  ]);

  return [header, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(String(value))).join(","))
    .join("\n");
}
