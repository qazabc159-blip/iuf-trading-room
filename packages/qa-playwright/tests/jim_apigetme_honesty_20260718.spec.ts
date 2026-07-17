import { expect, test, type BrowserContext, type Route } from "@playwright/test";
import { WEB_BASE_URL } from "./helpers";

// Wave2 P1 fix (2026-07-18): `apiGetMe()` (apps/web/lib/auth-client.ts) used to
// collapse "not logged in / network blip / session expired / api_base unset"
// into the same `ok:false`, so `/ops/f-auto` (this spec) and the company page's
// AI 分析師報告 panel (same apiGetMe() + role-gate pattern) showed a false
// "此頁面僅限帳號擁有者檢視" message even when a real owner's session merely
// failed to resolve. Fixed by distinguishing:
//   (a) fetch/network failure or non-2xx `/auth/me` → "請重新登入" (session-error)
//   (b) a genuine 200 response with role !== "Owner" → "僅限帳號擁有者" (not-owner)
//
// This spec mocks `**/auth/me` directly — both pages call apiGetMe() as a
// client-side fetch (bypassing the same-origin ui-final-v031 backend proxy) —
// so it is deterministic and does not depend on a real backend session or
// wall-clock trading hours. Runs against a local `next start` (no live
// backend needed): PageFrame/FAutoPage render with zero other data
// dependencies until role resolves.

test.use({ storageState: { cookies: [], origins: [] } });

const SESSION_COOKIE_DOMAIN = new URL(WEB_BASE_URL).hostname;

async function withMockSessionCookie(context: BrowserContext) {
  await context.addCookies([
    { name: "iuf_session", value: "playwright-mock-session", domain: SESSION_COOKIE_DOMAIN, path: "/" },
  ]);
}

async function mockAuthMe(context: BrowserContext, outcome: { status: number; body?: unknown }) {
  await context.route("**/auth/me", async (route: Route) => {
    return route.fulfill({
      status: outcome.status,
      contentType: "application/json",
      body: JSON.stringify(outcome.body ?? {}),
    });
  });
}

const NON_OWNER_ME_BODY = {
  user: { id: "u1", email: "analyst@example.com", name: "Analyst", role: "Analyst", workspaceId: "w1" },
  workspace: { id: "w1", name: "Test Workspace", slug: "test" },
};

test.describe("apiGetMe honest session-vs-role messaging @smoke", () => {
  test("/ops/f-auto shows 請重新登入 (not a false owner-lock) when /auth/me fails", async ({ page, context }) => {
    await withMockSessionCookie(context);
    await mockAuthMe(context, { status: 500 });

    await page.goto("/ops/f-auto", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("請重新登入")).toBeVisible();
    await expect(page.getByText("此頁面僅限帳號擁有者檢視")).toHaveCount(0);
  });

  test("/ops/f-auto shows the real owner-lock when /auth/me succeeds with role !== Owner", async ({ page, context }) => {
    await withMockSessionCookie(context);
    await mockAuthMe(context, { status: 200, body: NON_OWNER_ME_BODY });

    await page.goto("/ops/f-auto", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("此頁面僅限帳號擁有者檢視")).toBeVisible();
    await expect(page.getByText("請重新登入")).toHaveCount(0);
  });
});
