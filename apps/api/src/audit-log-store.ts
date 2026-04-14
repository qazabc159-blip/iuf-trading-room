import { and, desc, eq } from "drizzle-orm";
import type { AppSession } from "@iuf-trading-room/contracts";
import { auditLogs, getDb, isDatabaseMode } from "@iuf-trading-room/db";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "register"
  | "revoke"
  | "cleanup"
  | "review"
  | "ingest"
  | "import";

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
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

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...filters))
    .orderBy(desc(auditLogs.createdAt))
    .limit(input.limit ?? 50);

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    payload:
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    createdAt: row.createdAt.toISOString()
  }));
}
