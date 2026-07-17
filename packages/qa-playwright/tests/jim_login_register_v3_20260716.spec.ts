import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

// /login + /register v3 verification (2026-07-16, Jim). Round-specific
// acceptance harness for the byte-exact design-draft port (supersedes
// jim_login_productize_20260715.spec.ts, which asserted the previous
// round's `.login-panel`/`.login-shell` class names — those no longer
// exist in the v3 DOM). Not @smoke-tagged: /login and /register don't need
// the shared owner-session storageState, and this file's job is one-time
// acceptance for this redesign, not a permanent CI gate.

const REPORT_DIR =
  process.env.IUF_QA_REPORT_DIR ?? path.resolve(process.cwd(), "../../reports", "login_register_v3_shot");

async function ensureDir() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
}

test.describe("/login v3 — visual + real auth flow", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("desktop 1920: renders console chrome, no horizontal overflow, no SIM/roadmap language", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "runs once on desktop-chromium");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/login", { waitUntil: "networkidle" });

    await expect(page.locator(".av3-console")).toBeVisible();
    await expect(page.locator(".av3-auth input[type=email]")).toBeVisible();
    await expect(page.locator(".av3-register a.av3-cta")).toBeVisible();

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scroll.scrollWidth, "no horizontal overflow at 1920").toBeLessThanOrEqual(scroll.clientWidth + 1);

    // 楊董裁決禁字：SIM/模擬字樣、01-04 能力清單殘留一律清零
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/SIM|模擬/);
    expect(bodyText).not.toMatch(/0[1-4]\s*[·:]/);

    await ensureDir();
    await page.screenshot({ path: path.join(REPORT_DIR, "login-desktop-1920.png"), fullPage: true });
  });

  test("mobile 390: no horizontal overflow, form-first layout", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login", { waitUntil: "networkidle" });

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scroll.scrollWidth, "no horizontal overflow at 390").toBeLessThanOrEqual(scroll.clientWidth + 1);

    const emailBox = await page.locator(".av3-auth input[type=email]").boundingBox();
    expect(emailBox, "email input must have a bounding box").not.toBeNull();
    expect(emailBox!.y, "email field visible within first screen").toBeLessThan(844);

    await ensureDir();
    await page.screenshot({ path: path.join(REPORT_DIR, "login-mobile-390.png"), fullPage: true });
  });

  test("empty submit shows client-side validation error", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.click(".av3-submit");
    await expect(page.locator(".av3-err")).toHaveText("請輸入電子信箱與密碼。");
  });

  test("wrong credentials surface real backend error message", async ({ page }) => {
    await page.route("**/auth/login", async (route) => {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "invalid_credentials" }) });
    });
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.fill(".av3-auth input[type=email]", "wrong@example.com");
    await page.fill(".av3-auth input[type=password]", "wrongpassword123");
    await page.click(".av3-submit");
    await expect(page.locator(".av3-err")).toHaveText("帳號或密碼錯誤。");
  });

  test("successful login redirects to /", async ({ page }) => {
    await page.route("**/auth/login", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "set-cookie": "iuf_session=e2e-fake-session; Path=/; SameSite=Lax" },
        body: JSON.stringify({
          user: { id: "u1", email: "owner@example.com", name: "Owner", role: "Admin", workspaceId: "w1" },
          workspace: { id: "w1", name: "IUF", slug: "iuf" },
        }),
      });
    });
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.fill(".av3-auth input[type=email]", "owner@example.com");
    await page.fill(".av3-auth input[type=password]", "correctpassword123");
    await page.click(".av3-submit");
    await page.waitForURL((url) => url.pathname === "/");
  });
});

test.describe("/register v3 — open registration form + validation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // 2026-07-17 (楊董 prod report): the invite-only empty-state gate is
  // retired — /register always renders the real form now, with or without
  // a `?invite=` URL param. Supersedes the old two-state (gate/form) test.
  test("no invite param -> real form still renders (invite optional)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "runs once on desktop-chromium");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/register", { waitUntil: "networkidle" });
    await expect(page.locator(".av3-reg-body")).toBeVisible();
    await expect(page.locator(".av3-reg-body input[autocomplete=name]")).toBeVisible();
    await expect(page.locator(".av3-reg-body input[type=email]")).toBeVisible();
    await expect(page.locator(".av3-badge")).toHaveCount(0);

    await ensureDir();
    await page.screenshot({ path: path.join(REPORT_DIR, "register-no-invite-1920.png"), fullPage: true });
  });

  test("with ?invite= -> same form renders, invite badge shown", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "runs once on desktop-chromium");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/register?invite=demo-token-abc123", { waitUntil: "networkidle" });
    await expect(page.locator(".av3-reg-body")).toBeVisible();
    await expect(page.locator(".av3-reg-body input[autocomplete=name]")).toBeVisible();
    await expect(page.locator(".av3-badge")).toBeVisible();

    await ensureDir();
    await page.screenshot({ path: path.join(REPORT_DIR, "register-with-invite-1920.png"), fullPage: true });
  });

  // ⚠️ Known backend gap (reported to Elva, not fixed in this frontend PR):
  // /auth/register-with-invite still requires a non-empty inviteToken
  // server-side, so a no-invite submit is currently blocked. This test locks
  // the honesty rule — the real backend error text must surface as-is, the
  // frontend must not fabricate a friendlier "invite optional" success copy.
  test("no-invite submit surfaces the real backend rejection (backend still requires invite server-side)", async ({ page }) => {
    await page.route("**/auth/register-with-invite", async (route) => {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_request_body" }) });
    });
    await page.goto("/register", { waitUntil: "networkidle" });
    await page.fill(".av3-reg-body input[autocomplete=name]", "Test User");
    await page.fill(".av3-reg-body input[type=email]", "test@example.com");
    const pwInputs = page.locator(".av3-reg-body input[type=password]");
    await pwInputs.nth(0).fill("LongEnough123");
    await pwInputs.nth(1).fill("LongEnough123");
    await page.click(".av3-submit");
    await expect(page.locator(".av3-err-persist")).toContainText("表單資料有誤");
  });

  test("mobile 390: both states have no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/register", { waitUntil: "networkidle" });
    const scrollA = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollA.scrollWidth).toBeLessThanOrEqual(scrollA.clientWidth + 1);

    await page.goto("/register?invite=demo-token-abc123", { waitUntil: "networkidle" });
    const scrollB = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollB.scrollWidth).toBeLessThanOrEqual(scrollB.clientWidth + 1);

    await ensureDir();
    await page.screenshot({ path: path.join(REPORT_DIR, "register-stateB-390.png"), fullPage: true });
  });

  test("password policy: live 4-rule hints track real input", async ({ page }) => {
    await page.goto("/register?invite=demo-token", { waitUntil: "networkidle" });
    const pwInput = page.locator(".av3-reg-body input[type=password]").first();
    await pwInput.fill("!!!!");
    await expect(page.locator(".av3-pwrules .av3-r.av3-ok")).toHaveCount(0);
    await pwInput.fill("LongEnough123");
    await expect(page.locator(".av3-pwrules .av3-r.av3-ok")).toHaveCount(4);
  });

  test("password mismatch blocks submit with real client error", async ({ page }) => {
    await page.goto("/register?invite=demo-token", { waitUntil: "networkidle" });
    await page.fill(".av3-reg-body input[autocomplete=name]", "Test User");
    await page.fill(".av3-reg-body input[type=email]", "test@example.com");
    const pwInputs = page.locator(".av3-reg-body input[type=password]");
    await pwInputs.nth(0).fill("LongEnough123");
    await pwInputs.nth(1).fill("Different123");
    await page.click(".av3-submit");
    await expect(page.locator(".av3-err-persist")).toContainText("不一致");
  });

  test("invalid/expired invite surfaces real backend error text", async ({ page }) => {
    await page.route("**/auth/register-with-invite", async (route) => {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_or_expired" }) });
    });
    await page.goto("/register?invite=bad-token", { waitUntil: "networkidle" });
    await page.fill(".av3-reg-body input[autocomplete=name]", "Test User");
    await page.fill(".av3-reg-body input[type=email]", "test@example.com");
    const pwInputs = page.locator(".av3-reg-body input[type=password]");
    await pwInputs.nth(0).fill("LongEnough123");
    await pwInputs.nth(1).fill("LongEnough123");
    await page.click(".av3-submit");
    await expect(page.locator(".av3-err-persist")).toContainText("邀請連結無效或已過期");
  });

  test("successful registration redirects to /", async ({ page }) => {
    await page.route("**/auth/register-with-invite", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "set-cookie": "iuf_session=e2e-fake-session; Path=/; SameSite=Lax" },
        body: JSON.stringify({
          user: { id: "u2", email: "new@example.com", name: "New User", role: "Trader", workspaceId: "w1" },
          workspace: { id: "w1", name: "IUF", slug: "iuf" },
        }),
      });
    });
    await page.goto("/register?invite=good-token", { waitUntil: "networkidle" });
    await page.fill(".av3-reg-body input[autocomplete=name]", "New User");
    await page.fill(".av3-reg-body input[type=email]", "new@example.com");
    const pwInputs = page.locator(".av3-reg-body input[type=password]");
    await pwInputs.nth(0).fill("LongEnough123");
    await pwInputs.nth(1).fill("LongEnough123");
    await page.click(".av3-submit");
    await page.waitForURL((url) => url.pathname === "/");
  });
});
