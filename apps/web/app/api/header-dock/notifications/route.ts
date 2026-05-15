import { type NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

export const dynamic = "force-dynamic";

function emptyPayload(meta: Record<string, unknown>) {
  return NextResponse.json({
    notifications: [],
    unread_count: 0,
    meta,
  });
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

    return NextResponse.json({
      notifications: Array.isArray(body.notifications) ? body.notifications : [],
      unread_count: typeof body.unread_count === "number"
        ? body.unread_count
        : typeof body.unreadCount === "number"
          ? body.unreadCount
          : 0,
      meta: { source: "api" },
    });
  } catch {
    return emptyPayload({ source: "error", reason: "NOTIFICATIONS_FETCH_FAILED" });
  }
}
