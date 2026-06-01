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

const GET_ALLOWLIST = [
  /^\/api\/v1\/market-intel\/(?:news-top10|announcements)(?:\?|$)/,
  /^\/api\/v1\/data-sources\/finmind\/status(?:\?|$)/,
  /^\/api\/v1\/market\/(?:heatmap\/twse|institutional-summary\/finmind)(?:\?|$)/,
  /^\/api\/v1\/strategy\/ideas(?:\?|$)/,
  /^\/api\/v1\/paper\/(?:health|fills|orders|portfolio|positions|funds)(?:\?|$|\/)/,
  /^\/api\/v1\/portfolio\/kgi\/positions(?:\?|$)/,
  /^\/api\/v1\/companies(?:\?|$|\/)/,
  /^\/api\/v1\/themes\/[^/]+\/companies(?:\?|$)/,
  /^\/api\/v1\/kgi\/status(?:\?|$)/,
  /^\/api\/v1\/kgi\/sim\/(?:positions|orders|balance)(?:\?|$)/,
  /^\/api\/v1\/internal\/kgi\/sim\/daily-smoke-status(?:\?|$)/,
  /^\/api\/v1\/internal\/s1-sim\/(?:status|basket|eod-report)(?:\?|$)/,
  /^\/api\/v1\/kgi\/quote\/(?:bidask|ticks)(?:\?|$)/,
];

const POST_ALLOWLIST = [
  /^\/api\/v1\/paper\/(?:preview|submit)(?:\?|$)/,
  /^\/api\/v1\/kgi\/sim\/order(?:\?|$)/,
];

function isAllowed(method: string, path: string) {
  const list = method === "POST" ? POST_ALLOWLIST : method === "GET" ? GET_ALLOWLIST : [];
  return list.some((pattern) => pattern.test(path));
}

function isKgiQuoteReadOnlyPath(method: string, path: string) {
  return method === "GET" && /^\/api\/v1\/kgi\/quote\/(?:bidask|ticks)(?:\?|$)/.test(path);
}

function readPath(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") ?? "";
  if (!path.startsWith("/api/v1/")) return null;
  if (path.includes("://") || path.includes("\\") || path.includes("\n") || path.includes("\r")) return null;
  return path;
}

async function proxy(request: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { ok: false, error: "API_BASE_UNCONFIGURED" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const path = readPath(request);
  if (!path || !isAllowed(request.method, path)) {
    return NextResponse.json(
      { ok: false, error: "FINAL_V031_PROXY_PATH_BLOCKED" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const upstreamUrl = new URL(path, API_BASE);
  const headers = new Headers({
    "Content-Type": request.headers.get("content-type") ?? "application/json",
    "x-workspace-slug": request.headers.get("x-workspace-slug") ?? WORKSPACE_SLUG,
  });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);

  const response = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" ? undefined : await request.text(),
    cache: "no-store",
  });

  if (!response.ok && isKgiQuoteReadOnlyPath(request.method, path)) {
    return NextResponse.json(
      {
        data: null,
        degraded: true,
        source: "kgi_quote_read_only",
        upstreamStatus: response.status,
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
}

export async function GET(request: NextRequest) {
  return proxy(request);
}

export async function POST(request: NextRequest) {
  return proxy(request);
}
