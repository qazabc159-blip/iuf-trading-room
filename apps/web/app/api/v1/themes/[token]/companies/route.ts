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

function safeToken(value: string) {
  const token = value.trim();
  if (!token || token.length > 180) return null;
  return token;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token: rawToken } = await context.params;
  const token = safeToken(rawToken);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "BAD_THEME_TOKEN" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!API_BASE) {
    return NextResponse.json(
      { ok: false, error: "API_BASE_UNCONFIGURED" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const upstream = await fetch(`${API_BASE}/api/v1/themes/${encodeURIComponent(token)}/companies`, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-workspace-slug": request.headers.get("x-workspace-slug") ?? WORKSPACE_SLUG,
      ...(request.headers.get("cookie") ? { Cookie: request.headers.get("cookie") as string } : {}),
    },
  });

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
