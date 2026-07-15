import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

// /login productize verification (2026-07-15, Jim). 楊董退件五宗罪修復驗收：
// 識別複用（desk-exact/home-exact CSS tokens）、表單手機首屏、文案產品化、
// 條件式錯誤框、無 roadmap 狀態表。這支測試檔是本輪驗收 harness，非長駐 CI spec。
// /login 不需登入即可直接開啟，不套用既有 auth.setup 依賴。

const REPORT_DIR =
  process.env.IUF_QA_REPORT_DIR ?? path.resolve(process.cwd(), "../../reports", "login_shot");

async function ensureDir() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
}

test.describe("/login productize", () => {
  test("desktop 1920: form panel visible above the fold, no console errors, no horizontal overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "runs once on desktop-chromium");
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/login", { waitUntil: "networkidle" });

    await expect(page.locator(".login-panel")).toBeVisible();
    await expect(page.locator(".login-panel input[type=email]")).toBeVisible();

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    testInfo.annotations.push({ type: "scroll-1920", description: JSON.stringify(scroll) });
    expect(scroll.scrollWidth, "no horizontal overflow at 1920").toBeLessThanOrEqual(scroll.clientWidth + 1);

    // Roadmap-table sins must be gone.
    await expect(page.getByText("正式券商寫入維持關閉")).toHaveCount(0);
    await expect(page.getByText("券商綁定")).toHaveCount(0);
    await expect(page.getByText("訂閱權限")).toHaveCount(0);
    await expect(page.getByText("錯誤訊息會顯示在這裡")).toHaveCount(0);
    await expect(page.getByText("可登入")).toHaveCount(0);

    testInfo.annotations.push({ type: "console-errors", description: JSON.stringify(consoleErrors) });
    expect(consoleErrors.filter((e) => !/\/auth\/me/.test(e))).toEqual([]);

    await ensureDir();
    await page.screenshot({ path: path.join(REPORT_DIR, "login-desktop-1920.png"), fullPage: true });
  });

  test("desktop 1280: no horizontal overflow, panel visible", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "runs once on desktop-chromium");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/login", { waitUntil: "networkidle" });
    await expect(page.locator(".login-panel")).toBeVisible();

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(scroll.scrollWidth, "no horizontal overflow at 1280").toBeLessThanOrEqual(scroll.clientWidth + 1);

    await ensureDir();
    await page.screenshot({ path: path.join(REPORT_DIR, "login-desktop-1280.png"), fullPage: true });
  });

  test("mobile 390: form panel is the first screen (no scroll needed to reach email field)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "runs once (viewport is set manually)");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login", { waitUntil: "networkidle" });

    const emailInput = page.locator(".login-panel input[type=email]");
    await expect(emailInput).toBeVisible();
    const box = await emailInput.boundingBox();
    testInfo.annotations.push({ type: "email-input-box", description: JSON.stringify(box) });
    expect(box, "email input must have a bounding box").not.toBeNull();
    // First screen = within the 844px viewport without any scrolling.
    expect(box!.y, "email field must be visible within the first 844px screen (no scroll)").toBeLessThan(844);

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(scroll.scrollWidth, "no horizontal overflow at 390").toBeLessThanOrEqual(scroll.clientWidth + 1);

    await ensureDir();
    await page.screenshot({ path: path.join(REPORT_DIR, "login-mobile-390.png"), fullPage: true });
  });

  test("/register stays unaffected (shared template classes untouched)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "runs once on desktop-chromium");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/register", { waitUntil: "networkidle" });
    // No-token notice or the invite form — either way it must still render
    // the (untouched) shared .login-brand/.login-panel template.
    await expect(page.locator(".login-panel")).toBeVisible();

    await ensureDir();
    await page.screenshot({ path: path.join(REPORT_DIR, "register-regression-1920.png"), fullPage: true });
  });
});
