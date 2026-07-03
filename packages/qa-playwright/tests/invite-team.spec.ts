import { expect, test } from "@playwright/test";
import { WEB_BASE_URL, expectNoServerError, saveRouteScreenshot } from "./helpers";

/**
 * Smoke tests for invite UI (#1157 — Jim).
 *
 * Two concerns:
 * 1. /register is PUBLIC — must be accessible WITHOUT authentication.
 *    - Shows invite-required notice when no ?invite= param.
 *    - Does NOT redirect to /login.
 *
 * 2. /admin/team is OWNER-ONLY — must redirect unauthenticated users to /login.
 *
 * @smoke tag: runs in CI against the local PR build.
 */

// ── Unauthenticated tests (storageState cleared) ──────────────────────────────

test.describe("invite routes: public/private guard", () => {
  // Override project storageState → run without auth cookies.
  // This is the canonical pattern for testing unauthenticated behaviour in this
  // suite (see playwright.config.ts: storageState is set at the project level).
  test.use({ storageState: undefined });

  test("/register is publicly accessible without auth @smoke", async ({ page }, testInfo) => {
    await page.goto(`${WEB_BASE_URL}/register`, { waitUntil: "domcontentloaded" });

    // Must NOT redirect to /login
    expect(page.url(), "/register must not redirect to /login when unauthenticated").not.toMatch(/\/login/);

    // Should render the IUF brand + invite-required notice (no ?invite= param)
    await expect(page.locator("body"), "register page must contain IUF brand text").toContainText("IUF");
    await expect(page.locator("body"), "register page must contain invite notice").toContainText("邀請制");

    await expectNoServerError(page);
    await saveRouteScreenshot(page, testInfo, "register-no-token");
  });

  test("/register with ?invite= param shows the registration form @smoke", async ({ page }, testInfo) => {
    // Use a fake token — we just verify the form renders, not that registration succeeds
    await page.goto(`${WEB_BASE_URL}/register?invite=fake-test-token-abc123`, { waitUntil: "domcontentloaded" });

    expect(page.url(), "register with invite token must not redirect").not.toMatch(/\/login/);

    // Form fields should be visible
    await expect(page.locator("input[type='text'][autocomplete='name'], input[placeholder*='姓名']"), "name field must render").toHaveCount(1);
    await expect(page.locator("input[type='email']"), "email field must render").toHaveCount(1);
    await expect(page.locator("input[type='password']").first(), "password field must render").toBeVisible();

    // Password policy hints section should exist in the page
    await expect(page.locator("body")).toContainText("12 個字元");

    await expectNoServerError(page);
    await saveRouteScreenshot(page, testInfo, "register-with-token");
  });

  test("/admin/team redirects unauthenticated users to /login @smoke", async ({ page }, testInfo) => {
    await page.goto(`${WEB_BASE_URL}/admin/team`, { waitUntil: "domcontentloaded" });

    // Must redirect to /login
    expect(page.url(), "/admin/team must redirect unauthenticated users to /login").toMatch(/\/login/);

    await saveRouteScreenshot(page, testInfo, "admin-team-unauthenticated-redirect");
  });
});

// ── Authenticated smoke: /admin/team renders (Owner-gated page loads) ─────────

test("/admin/team renders the team management shell for authenticated users @smoke", async ({ page }, testInfo) => {
  // Uses default storageState (authenticated as Owner in CI/staging).
  // On a local build without the Owner cookie, the page shows "無權限" —
  // either way the page should NOT 500 or redirect to /login.
  test.setTimeout(30_000);

  await page.goto(`${WEB_BASE_URL}/admin/team`, { waitUntil: "domcontentloaded" });

  // Authenticated → must stay on /admin/team (not /login)
  expect(page.url(), "/admin/team must not redirect authenticated users to /login").not.toMatch(/\/login/);

  // Page must contain our panel code
  await expect(page.locator("body"), "page must render TEAM panel code").toContainText("TEAM");

  await page.waitForTimeout(4_000); // allow client hydration + gate check

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const isOwnerGate = /無權限|Owner/.test(bodyText);
  const isLoaded = /團隊|邀請|用戶/.test(bodyText);

  expect(
    isOwnerGate || isLoaded,
    "/admin/team must show either owner-gate or team content (not a blank shell)",
  ).toBe(true);

  await expectNoServerError(page);
  await saveRouteScreenshot(page, testInfo, "admin-team-authenticated");
});
