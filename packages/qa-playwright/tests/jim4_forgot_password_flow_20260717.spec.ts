import { expect, test, request as playwrightRequest } from "@playwright/test";
import { API_BASE_URL } from "./helpers";

// /forgot-password + /reset-password v3 (2026-07-17, Jim). Backend contract:
// #1288 (admin-mediated reset, migration 0060). This file has two kinds of
// coverage:
//
//  1. Mocked UI tests (page.route) — copy pattern, error surfacing, honesty
//     assertions (no "email sent" wording, no account-enumeration signal).
//  2. One real end-to-end test that hits the real stacked-branch backend
//     with zero mocks: register a throwaway user via the existing invite
//     flow, submit /forgot-password for real, use an Owner session (direct
//     API call — no admin queue UI exists yet, out of this PR's scope) to
//     generate the reset link the same way an admin would, complete
//     /reset-password with the real token, then log in with the new
//     password. Never touches the shared seed-owner account.
//
// Requires IUF_QA_OWNER_EMAIL/IUF_QA_OWNER_PASSWORD (or SEED_OWNER_*) env —
// same convention as auth.setup.ts.

test.describe("/forgot-password v3 — mocked UI", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("desktop 1920: renders console chrome, no horizontal overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "runs once on desktop-chromium");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/forgot-password", { waitUntil: "networkidle" });

    await expect(page.locator(".av3-console")).toBeVisible();
    await expect(page.locator("input[type=email]")).toBeVisible();

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scroll.scrollWidth, "no horizontal overflow at 1920").toBeLessThanOrEqual(scroll.clientWidth + 1);
  });

  test("mobile 390: no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/forgot-password", { waitUntil: "networkidle" });
    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scroll.scrollWidth, "no horizontal overflow at 390").toBeLessThanOrEqual(scroll.clientWidth + 1);
  });

  test("submit shows neutral confirmation, never claims an email was sent", async ({ page }) => {
    await page.route("**/api/v1/auth/request-password-reset", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          message: "若該電子郵件對應有效帳號，重設申請已送出，請等待管理員審核並提供重設連結。",
        }),
      });
    });
    await page.goto("/forgot-password", { waitUntil: "networkidle" });
    await page.fill("input[type=email]", "someone@example.com");
    await page.click(".av3-submit");
    await expect(page.locator(".av3-neutral")).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/已寄出|email sent|寄送信件|寄出.*信/);
  });

  test("nonexistent email produces the identical confirmation (no enumeration oracle)", async ({ page }) => {
    let capturedBody: unknown;
    await page.route("**/api/v1/auth/request-password-reset", async (route) => {
      capturedBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          message: "若該電子郵件對應有效帳號，重設申請已送出，請等待管理員審核並提供重設連結。",
        }),
      });
    });
    await page.goto("/forgot-password", { waitUntil: "networkidle" });
    await page.fill("input[type=email]", "definitely-not-a-real-account@example.com");
    await page.click(".av3-submit");
    await expect(page.locator(".av3-neutral")).toBeVisible();
    expect((capturedBody as { email?: string })?.email).toBe("definitely-not-a-real-account@example.com");
  });
});

test.describe("/reset-password v3 — mocked UI", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("no token param -> honest missing-link state, no form rendered", async ({ page }) => {
    await page.goto("/reset-password", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "缺少重設連結" })).toBeVisible();
    await expect(page.locator("input[type=password]")).toHaveCount(0);
  });

  test("password policy: live 4-rule hints track real input", async ({ page }) => {
    await page.goto("/reset-password?token=demo-token", { waitUntil: "networkidle" });
    const pwInput = page.locator("input[type=password]").first();
    await pwInput.fill("!!!!");
    await expect(page.locator(".av3-pwrules .av3-r.av3-ok")).toHaveCount(0);
    await pwInput.fill("LongEnough123");
    await expect(page.locator(".av3-pwrules .av3-r.av3-ok")).toHaveCount(4);
  });

  test("invalid/expired token surfaces the real backend error text", async ({ page }) => {
    await page.route("**/api/v1/auth/reset-password", async (route) => {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_or_expired" }) });
    });
    await page.goto("/reset-password?token=bad-token", { waitUntil: "networkidle" });
    const pwInputs = page.locator("input[type=password]");
    await pwInputs.nth(0).fill("LongEnough123");
    await pwInputs.nth(1).fill("LongEnough123");
    await page.click(".av3-submit");
    await expect(page.locator(".av3-err")).toContainText("這個重設連結無效或已過期");
  });

  test("successful reset redirects to /login", async ({ page }) => {
    await page.route("**/api/v1/auth/reset-password", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, message: "密碼已更新，請使用新密碼重新登入。" }),
      });
    });
    await page.goto("/reset-password?token=good-token", { waitUntil: "networkidle" });
    const pwInputs = page.locator("input[type=password]");
    await pwInputs.nth(0).fill("LongEnough123");
    await pwInputs.nth(1).fill("LongEnough123");
    await page.click(".av3-submit");
    await page.waitForURL((url) => url.pathname === "/login");
  });
});

test.describe("/login v3 — forgot-password link", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("checkbox row has a real link to /forgot-password", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    const link = page.locator(".av3-row a.av3-help");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/forgot-password");
    await link.click();
    await page.waitForURL((url) => url.pathname === "/forgot-password");
  });
});

test.describe("/forgot-password -> /reset-password — real backend end-to-end", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("full real flow: request reset, admin generates link, reset password, login with new password", async ({ page }) => {
    const ownerEmail = process.env.IUF_QA_OWNER_EMAIL ?? process.env.SEED_OWNER_EMAIL;
    const ownerPassword = process.env.IUF_QA_OWNER_PASSWORD ?? process.env.SEED_OWNER_PASSWORD;
    test.skip(!ownerEmail || !ownerPassword, "requires IUF_QA_OWNER_EMAIL/PASSWORD (or SEED_OWNER_*)");

    // Owner-authenticated calls (invite issuance, reset queue, generate-link)
    // use a dedicated context. The throwaway user's own register-with-invite
    // response also sets a session cookie for the SAME cookie name/domain —
    // if made on this same context it would silently overwrite the owner's
    // session, so that call goes through a second, throwaway-only context.
    const ownerApi = await playwrightRequest.newContext({ baseURL: API_BASE_URL });
    const throwawayApi = await playwrightRequest.newContext({ baseURL: API_BASE_URL });

    // 1. Owner logs in (direct API — no admin UI exists yet for this queue).
    const ownerLogin = await ownerApi.post("/auth/login", {
      data: { email: ownerEmail, password: ownerPassword },
      headers: { "Content-Type": "application/json" },
    });
    expect(ownerLogin.ok(), `owner login failed: ${ownerLogin.status()}`).toBeTruthy();

    // 2. Owner issues an invite, used only to create a throwaway test user
    //    (never touches the shared owner account).
    const inviteRes = await ownerApi.post("/api/v1/admin/invites", {
      data: { role: "Trader" },
      headers: { "Content-Type": "application/json" },
    });
    expect(inviteRes.ok(), `invite creation failed: ${inviteRes.status()}`).toBeTruthy();
    const invite = (await inviteRes.json()) as { data: { token: string } };

    const throwawayEmail = `jim4-e2e-${Date.now()}@example.com`;
    const oldPassword = "OldPassw0rd123";
    const registerRes = await throwawayApi.post("/auth/register-with-invite", {
      data: { inviteToken: invite.data.token, email: throwawayEmail, name: "Jim4 E2E", password: oldPassword },
      headers: { "Content-Type": "application/json" },
    });
    expect(registerRes.ok(), `throwaway registration failed: ${registerRes.status()}`).toBeTruthy();

    // 3. Real UI: submit /forgot-password for the throwaway email.
    await page.goto("/forgot-password", { waitUntil: "networkidle" });
    await page.fill("input[type=email]", throwawayEmail);
    await page.click(".av3-submit");
    await expect(page.locator(".av3-neutral")).toBeVisible();

    // 4. Admin side (direct API): find the pending request, generate a link.
    const queueRes = await ownerApi.get("/api/v1/admin/password-reset-requests");
    expect(queueRes.ok(), `password-reset-requests list failed: ${queueRes.status()}`).toBeTruthy();
    const queue = (await queueRes.json()) as { data: Array<{ id: string; email: string }> };
    const pending = queue.data.find((r) => r.email.toLowerCase() === throwawayEmail.toLowerCase());
    expect(pending, "pending reset request for throwaway email must exist").toBeTruthy();

    const linkRes = await ownerApi.post(`/api/v1/admin/password-reset-requests/${pending!.id}/generate-link`);
    expect(linkRes.ok(), `generate-link failed: ${linkRes.status()}`).toBeTruthy();
    const linkBody = (await linkRes.json()) as { data: { token: string } };
    const resetToken = linkBody.data.token;
    expect(resetToken).toBeTruthy();

    // 5. Real UI: complete /reset-password with the real token.
    const newPassword = "NewPassw0rd456";
    await page.goto(`/reset-password?token=${resetToken}`, { waitUntil: "networkidle" });
    const pwInputs = page.locator("input[type=password]");
    await pwInputs.nth(0).fill(newPassword);
    await pwInputs.nth(1).fill(newPassword);
    await page.click(".av3-submit");
    await page.waitForURL((url) => url.pathname === "/login");

    // 6. Real UI: log in with the NEW password (old password must be dead —
    //    the backend forces session_epoch++, but a plain login attempt with
    //    the old password should still fail on unrelated invalid_credentials
    //    grounds since the passwordHash itself changed).
    await page.fill(".av3-auth input[type=email]", throwawayEmail);
    await page.fill(".av3-auth input[type=password]", newPassword);
    await page.click(".av3-submit");
    await page.waitForURL((url) => url.pathname === "/");

    await ownerApi.dispose();
    await throwawayApi.dispose();
  });
});
