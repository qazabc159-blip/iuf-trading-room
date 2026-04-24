import { type NextRequest, NextResponse } from "next/server";

/**
 * Route protection middleware.
 *
 * Auth detection: checks for cookie `iuf_auth=1` (set by auth-client.ts after login).
 * This is a client-set cookie (not httpOnly), suitable for MVP redirect gating.
 * When Jason adds server-side session validation, this can be upgraded to verify
 * the JWT token against /api/v1/auth/verify.
 *
 * Public routes: /login, /register, /_next/*, /favicon.ico
 * Everything else → redirect to /login if not authenticated.
 */

const PUBLIC_PATHS = new Set(["/login", "/register"]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Next.js internals and static assets
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/api/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/robots.txt") return true;
  return false;
}

/** Add noindex header to every response — remove when app goes public. */
function addNoindex(response: ReturnType<typeof NextResponse.next> | ReturnType<typeof NextResponse.redirect>) {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    // If already authed, redirect /login and /register → home
    if (PUBLIC_PATHS.has(pathname)) {
      const authCookie = request.cookies.get("iuf_auth");
      if (authCookie?.value === "1") {
        return addNoindex(NextResponse.redirect(new URL("/", request.url)));
      }
    }
    return addNoindex(NextResponse.next());
  }

  // Protected route — check auth cookie
  const authCookie = request.cookies.get("iuf_auth");
  if (!authCookie || authCookie.value !== "1") {
    const loginUrl = new URL("/login", request.url);
    // Preserve intended destination for post-login redirect (future enhancement)
    loginUrl.searchParams.set("next", pathname);
    return addNoindex(NextResponse.redirect(loginUrl));
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
