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

function safeStrategyId(value: string) {
  const id = value.trim();
  if (!id || id.length > 80 || !/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ strategyId: string }> },
) {
  const { strategyId: rawStrategyId } = await context.params;
  const strategyId = safeStrategyId(rawStrategyId);
  if (!strategyId) {
    return NextResponse.json(
      { subscriptions: [], error: "BAD_STRATEGY_ID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!API_BASE) {
    return NextResponse.json(
      { subscriptions: [], error: "API_BASE_UNCONFIGURED" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const upstream = await fetch(
    `${API_BASE}/api/v1/quant-strategies/${encodeURIComponent(strategyId)}/subscriptions/my`,
    {
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-slug": request.headers.get("x-workspace-slug") ?? WORKSPACE_SLUG,
        ...(request.headers.get("cookie") ? { Cookie: request.headers.get("cookie") as string } : {}),
      },
    },
  );

  const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";
  const text = await upstream.text();
  return new NextResponse(text || JSON.stringify({ subscriptions: [] }), {
    status: upstream.status,
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": contentType,
    },
  });
}
