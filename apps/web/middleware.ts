import { type NextRequest, NextResponse } from "next/server";

/**
 * Route protection middleware.
 *
 * Auth detection uses the API-issued `iuf_session` cookie as the routing gate.
 * `iuf_auth=1` is only a client-side presence hint and can survive after a
 * cross-subdomain cookie migration, so it must not be trusted by middleware.
 *
 * Public routes: /login, /register, /forgot-password, /reset-password,
 * /_next/*, /favicon.ico
 * Everything else redirects to /login if not authenticated.
 */

const PUBLIC_PATHS = new Set(["/login", "/register", "/forgot-password", "/reset-password"]);
const PRESENCE_COOKIE = "iuf_auth";
const SESSION_COOKIE = "iuf_session";
const CANONICAL_APP_ORIGIN = "https://app.eycvector.com";
const FINAL_V031_ROUTE_REWRITES = new Map([
  ["/market-intel", "/final-v031/market-intel"],
  ["/portfolio", "/final-v031/portfolio"]
]);
const PUBLIC_FINAL_V031_EMBEDS = new Set([
  "/final-v031/portfolio/kline-frame"
]);

function isRailwayPublicHost(host: string): boolean {
  return host.endsWith(".up.railway.app");
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (PUBLIC_FINAL_V031_EMBEDS.has(pathname)) return true;
  // Next.js internals and static assets
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/robots.txt") return true;
  // PWA installability (app/manifest.ts serves at /manifest.webmanifest).
  // Icons under /icons/* and app/apple-icon.png etc. are *.png/*.ico and
  // already bypass this middleware entirely via the matcher's extension
  // exclusion below — only the manifest route needs an explicit allow.
  // /sw.js is reserved for a future service worker (not implemented yet).
  if (pathname === "/manifest.webmanifest") return true;
  if (pathname === "/sw.js") return true;
  return false;
}

/** Add noindex header to every response; remove when app goes public. */
function addNoindex(response: ReturnType<typeof NextResponse.next> | ReturnType<typeof NextResponse.redirect>) {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function clearPresenceCookie(response: ReturnType<typeof NextResponse.next> | ReturnType<typeof NextResponse.redirect>) {
  response.cookies.set(PRESENCE_COOKIE, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax"
  });
  return response;
}

function addNoStore(response: ReturnType<typeof NextResponse.next> | ReturnType<typeof NextResponse.rewrite>) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Vercel-CDN-Cache-Control", "no-store");
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("host") ?? "";

  if (process.env.NODE_ENV === "production" && isRailwayPublicHost(host)) {
    const canonicalUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, CANONICAL_APP_ORIGIN);
    return addNoindex(NextResponse.redirect(canonicalUrl, 308));
  }

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublicPath(pathname)) {
    const response = NextResponse.next();
    if (request.cookies.get(PRESENCE_COOKIE)?.value === "1" && !hasSessionCookie) {
      clearPresenceCookie(response);
    }
    return addNoindex(response);
  }

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);

    const response = NextResponse.redirect(loginUrl);
    if (request.cookies.get(PRESENCE_COOKIE)?.value === "1") {
      clearPresenceCookie(response);
    }
    return addNoindex(response);
  }

  const finalV031Rewrite = FINAL_V031_ROUTE_REWRITES.get(pathname);
  if (finalV031Rewrite) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = finalV031Rewrite;
    return addNoStore(addNoindex(NextResponse.rewrite(rewriteUrl)));
  }

  return addNoindex(NextResponse.next());
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files.
     * Using negative lookahead to skip:
     *   - /_next/static (Next.js static assets)
     *   - /_next/image (Next.js image optimization)
     *   - /favicon.ico
     *   - public folder files with extensions (.png, .jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
