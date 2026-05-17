import { type NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

export const dynamic = "force-dynamic";

type NormalizedNotification = {
  id: string;
  type?: string;
  category?: string;
  title?: string;
  message?: string;
  severity?: "info" | "warning" | "critical";
  createdAt?: string;
  occurredAt?: string;
  href?: string;
  readAt?: string | null;
  metadata?: Record<string, unknown>;
};

function emptyPayload(meta: Record<string, unknown>) {
  return NextResponse.json({
    notifications: [],
    unread_count: 0,
    meta,
  });
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringField(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstStringField(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = stringField(source, key);
    if (value) return value;
  }
  return undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstArray(...values: unknown[]) {
  return values.find((value): value is unknown[] => Array.isArray(value)) ?? [];
}

function nestedRecord(source: Record<string, unknown> | null, key: string) {
  return source ? objectRecord(source[key]) : null;
}

function extractNotificationArray(body: unknown) {
  if (Array.isArray(body)) return body;
  const root = objectRecord(body);
  const dataRecord = nestedRecord(root, "data");
  const metaRecord = nestedRecord(root, "meta");

  return firstArray(
    root?.["notifications"],
    root?.["items"],
    root?.["alerts"],
    dataRecord?.["notifications"],
    dataRecord?.["items"],
    dataRecord?.["alerts"],
    metaRecord?.["notifications"],
  );
}

function extractUnreadCount(body: unknown, fallback: number) {
  const root = objectRecord(body);
  const dataRecord = nestedRecord(root, "data");
  const metaRecord = nestedRecord(root, "meta");
  const dataMetaRecord = nestedRecord(dataRecord, "meta");
  const candidates = [
    root?.["unread_count"],
    root?.["unreadCount"],
    dataRecord?.["unread_count"],
    dataRecord?.["unreadCount"],
    metaRecord?.["unread_count"],
    metaRecord?.["unreadCount"],
    dataMetaRecord?.["unread_count"],
    dataMetaRecord?.["unreadCount"],
  ];
  for (const candidate of candidates) {
    const value = finiteNumber(candidate);
    if (value !== null) return Math.max(0, value);
  }
  return fallback;
}

function normalizeSeverity(value: unknown): NormalizedNotification["severity"] {
  if (typeof value !== "string") return "info";
  const normalized = value.trim().toLowerCase();
  if (["critical", "danger", "error", "fatal", "high"].includes(normalized)) return "critical";
  if (["warning", "warn", "medium"].includes(normalized)) return "warning";
  return "info";
}

function normalizeHref(value: unknown, type?: string) {
  const raw = typeof value === "string" && value.startsWith("/") ? value : undefined;
  if (raw === "/paper") return "/portfolio";
  if (raw === "/risk") return "/alerts";
  if (raw) return raw;
  if (type === "paper_order_filled" || type === "paper_order_rejected" || type === "kgi_status") return "/portfolio";
  if (type === "brief_published") return "/briefs";
  return "/alerts";
}

function normalizeNotification(value: unknown, index: number): NormalizedNotification | null {
  const source = objectRecord(value);
  if (!source) return null;

  const type = stringField(source, "type");
  const createdAt = stringField(source, "createdAt")
    ?? stringField(source, "created_at")
    ?? stringField(source, "occurredAt")
    ?? stringField(source, "occurred_at")
    ?? stringField(source, "timestamp");
  const readAt = stringField(source, "readAt")
    ?? stringField(source, "read_at")
    ?? (source["read"] === true || source["is_read"] === true ? createdAt ?? new Date(0).toISOString() : null);
  const metadata = objectRecord(source["metadata"]) ?? undefined;

  return {
    id: stringField(source, "id") ?? `notification-${index}`,
    type,
    category: stringField(source, "category") ?? type,
    title: firstStringField(source, "title", "headline", "summary", "event", "action"),
    message: firstStringField(source, "message", "body", "description", "text", "content", "summary", "subtitle"),
    severity: normalizeSeverity(source["severity"]),
    createdAt,
    occurredAt: createdAt,
    href: normalizeHref(source["href"] ?? source["actionUrl"] ?? source["action_url"], type),
    readAt,
    ...(metadata ? { metadata } : {}),
  };
}

export async function GET(request: NextRequest) {
  const query = new URLSearchParams();
  const limit = request.nextUrl.searchParams.get("limit");
  const unreadOnly = request.nextUrl.searchParams.get("unread_only") ?? request.nextUrl.searchParams.get("unread");
  if (limit) query.set("limit", limit);
  if (unreadOnly) {
    query.set("unread_only", unreadOnly);
    query.set("unread", unreadOnly);
  }

  if (!API_BASE) {
    return emptyPayload({ source: "unavailable", reason: "API_BASE_UNCONFIGURED" });
  }

  try {
    const response = await fetch(`${API_BASE}/api/v1/notifications${query.toString() ? `?${query.toString()}` : ""}`, {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": WORKSPACE_SLUG,
        ...(request.headers.get("cookie") ? { Cookie: request.headers.get("cookie") ?? "" } : {}),
      },
    });

    if (response.status === 401 || response.status === 403) {
      return emptyPayload({ source: "blocked", status: response.status });
    }

    if (!response.ok) {
      return emptyPayload({ source: "error", status: response.status });
    }

    if (response.status === 204) {
      return emptyPayload({ source: "api", status: response.status });
    }

    const responseText = await response.text();
    if (!responseText.trim()) {
      return emptyPayload({ source: "api", reason: "EMPTY_BODY" });
    }

    const body = JSON.parse(responseText) as unknown;
    const notifications = extractNotificationArray(body)
      .map(normalizeNotification)
      .filter((item): item is NormalizedNotification => Boolean(item));
    const computedUnreadCount = notifications.filter((notification) => !notification.readAt).length;

    return NextResponse.json({
      notifications,
      unread_count: extractUnreadCount(body, computedUnreadCount),
      meta: { source: "api" },
    });
  } catch {
    return emptyPayload({ source: "error", reason: "NOTIFICATIONS_FETCH_FAILED" });
  }
}
