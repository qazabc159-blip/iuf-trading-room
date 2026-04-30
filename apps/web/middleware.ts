import { type NextRequest, NextResponse } from "next/server";

/**
 * Route protection middleware.
 *
 * Auth detection uses the API-issued `iuf_session` cookie as the routing gate.
 * `iuf_auth=1` is only a client-side presence hint and can survive after a
 * cross-subdomain cookie migration, so it must not be trusted by middleware.
 *
 * Public routes: /login, /register, /_next/*, /favicon.ico
 * Everything else redirects to /login if not authenticated.
 */

const PUBLIC_PATHS = new Set(["/login", "/register"]);
const PRESENCE_COOKIE = "iuf_auth";
const SESSION_COOKIE = "iuf_session";

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Next.js internals and static assets
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/robots.txt") return true;
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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublicPath(pathname)) {
    if (PUBLIC_PATHS.has(pathname) && hasSessionCookie) {
      return addNoindex(NextResponse.redirect(new URL("/", request.url)));
    }

    const response = NextResponse.next();
    if (request.cookies.get(PRESENCE_COOKIE)?.value === "1" && !hasSessionCookie) {
      clearPresenceCookie(response);
    }
    return addNoindex(response);
  }

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);

    const response = NextResponse.redirect(loginUrl);
    if (request.cookies.get(PRESENCE_COOKIE)?.value === "1") {
      clearPresenceCookie(response);
    }
    return addNoindex(response);
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
