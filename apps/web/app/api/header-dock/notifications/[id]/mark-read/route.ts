import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");
const WORKSPACE_SLUG = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

function safeNotificationId(value: string) {
  const id = value.trim();
  if (!id || id.length > 180 || !/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = safeNotificationId(rawId);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "BAD_NOTIFICATION_ID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!API_BASE) {
    return NextResponse.json(
      { ok: false, error: "API_BASE_UNCONFIGURED" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const upstream = await fetch(
    `${API_BASE}/api/v1/notifications/${encodeURIComponent(id)}/mark-read`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": request.headers.get("x-workspace-slug") ?? WORKSPACE_SLUG,
        ...(request.headers.get("cookie") ? { Cookie: request.headers.get("cookie") as string } : {}),
      },
    },
  );

  if (upstream.status === 204) {
    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE_HEADERS });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";
  const text = await upstream.text();
  return new NextResponse(text || JSON.stringify({ ok: upstream.ok }), {
    status: upstream.status,
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": contentType,
    },
  });
}
