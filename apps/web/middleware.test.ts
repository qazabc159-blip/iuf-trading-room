import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";

import { middleware, config } from "./middleware";

// App 化切片 1: manifest/icons/sw.js must be reachable without a session so
// the install flow doesn't get 302'd to /login. See
// reports/app_readiness_20260710/APP_READINESS_v1.md §1 ("middleware 陷阱").

function makeRequest(pathname: string, opts: { session?: boolean } = {}) {
  const url = new URL(pathname, "http://localhost/");
  const headers: Record<string, string> = {};
  if (opts.session) headers.cookie = "iuf_session=test-session-token";
  return new NextRequest(url, { headers });
}

describe("middleware — PWA install-flow whitelist", () => {
  it("allows /manifest.webmanifest through with no session (200, no redirect)", () => {
    const res = middleware(makeRequest("/manifest.webmanifest"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("allows /sw.js through with no session (200, no redirect)", () => {
    const res = middleware(makeRequest("/sw.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects an ordinary protected route to /login with no session", () => {
    const res = middleware(makeRequest("/ideas"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("a protected route still passes through once a session cookie is present", () => {
    const res = middleware(makeRequest("/ideas", { session: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware config.matcher — icon/apple-icon/favicon paths never invoke middleware", () => {
  const matcherRegex = new RegExp(config.matcher[0]);

  it("excludes image-extension icon paths from the matcher (never redirected, never checked)", () => {
    expect(matcherRegex.test("/icons/icon-192.png")).toBe(false);
    expect(matcherRegex.test("/icons/icon-512.png")).toBe(false);
    expect(matcherRegex.test("/icons/icon-maskable-512.png")).toBe(false);
    expect(matcherRegex.test("/apple-icon.png")).toBe(false);
    expect(matcherRegex.test("/icon.png")).toBe(false);
    expect(matcherRegex.test("/favicon.ico")).toBe(false);
  });

  it("still includes the manifest route and ordinary app routes in the matcher", () => {
    expect(matcherRegex.test("/manifest.webmanifest")).toBe(true);
    expect(matcherRegex.test("/sw.js")).toBe(true);
    expect(matcherRegex.test("/ideas")).toBe(true);
  });
});
