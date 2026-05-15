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

function normalizeSeverity(value: unknown): NormalizedNotification["severity"] {
  if (value === "critical") return "critical";
  if (value === "warning" || value === "warn") return "warning";
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
  const createdAt = stringField(source, "createdAt") ?? stringField(source, "occurredAt") ?? stringField(source, "timestamp");
  const readAt = stringField(source, "readAt") ?? (source["read"] === true ? createdAt ?? new Date(0).toISOString() : null);
  const metadata = objectRecord(source["metadata"]) ?? undefined;

  return {
    id: stringField(source, "id") ?? `notification-${index}`,
    type,
    category: stringField(source, "category") ?? type,
    title: stringField(source, "title"),
    message: stringField(source, "message") ?? stringField(source, "body"),
    severity: normalizeSeverity(source["severity"]),
    createdAt,
    occurredAt: createdAt,
    href: normalizeHref(source["href"] ?? source["actionUrl"], type),
    readAt,
    ...(metadata ? { metadata } : {}),
  };
}

export async function GET(request: NextRequest) {
  const query = new URLSearchParams();
  const limit = request.nextUrl.searchParams.get("limit");
  const unreadOnly = request.nextUrl.searchParams.get("unread_only");
  if (limit) query.set("limit", limit);
  if (unreadOnly) query.set("unread_only", unreadOnly);

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

    const body = (await response.json()) as {
      notifications?: unknown;
      unread_count?: unknown;
      unreadCount?: unknown;
    };
    const notifications = Array.isArray(body.notifications)
      ? body.notifications.map(normalizeNotification).filter((item): item is NormalizedNotification => Boolean(item))
      : [];
    const computedUnreadCount = notifications.filter((notification) => !notification.readAt).length;

    return NextResponse.json({
      notifications,
      unread_count: typeof body.unread_count === "number"
        ? body.unread_count
        : typeof body.unreadCount === "number"
          ? body.unreadCount
          : computedUnreadCount,
      meta: { source: "api" },
    });
  } catch {
    return emptyPayload({ source: "error", reason: "NOTIFICATIONS_FETCH_FAILED" });
  }
}
