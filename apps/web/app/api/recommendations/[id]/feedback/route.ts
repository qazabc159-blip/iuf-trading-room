import { NextRequest, NextResponse } from "next/server";

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

const REACTIONS = new Set(["like", "dislike", "skip", "acted"]);

function safeRecommendationId(value: string) {
  const id = value.trim();
  if (!id || id.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await context.params;
  const id = safeRecommendationId(rawId);
  if (!id) {
    return jsonError("BAD_RECOMMENDATION_ID", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("BAD_JSON", 400);
  }

  const payload = body && typeof body === "object" ? body as { reaction?: unknown; note?: unknown } : {};
  if (typeof payload.reaction !== "string" || !REACTIONS.has(payload.reaction)) {
    return jsonError("BAD_REACTION", 400);
  }

  const note = typeof payload.note === "string" ? payload.note.slice(0, 500) : undefined;

  if (!API_BASE) {
    return jsonError("API_BASE_UNCONFIGURED", 503);
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${API_BASE}/api/v1/recommendations/${encodeURIComponent(id)}/feedback`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-slug": request.headers.get("x-workspace-slug") ?? WORKSPACE_SLUG,
          ...(request.headers.get("cookie") ? { Cookie: request.headers.get("cookie") as string } : {}),
        },
        body: JSON.stringify({ reaction: payload.reaction, ...(note ? { note } : {}) }),
      },
    );
  } catch {
    return jsonError("UPSTREAM_UNAVAILABLE", 502);
  }

  let text: string;
  try {
    text = await upstream.text();
  } catch {
    return jsonError("UPSTREAM_READ_FAILED", 502);
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";
  if (!text && upstream.status === 204) {
    return new NextResponse(null, {
      status: 204,
      headers: NO_STORE_HEADERS,
    });
  }
  if (!text) {
    return NextResponse.json(
      { ok: upstream.ok },
      { status: upstream.status, headers: NO_STORE_HEADERS },
    );
  }

  return new NextResponse(text || JSON.stringify({ ok: upstream.ok }), {
    status: upstream.status,
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": contentType,
    },
  });
}
