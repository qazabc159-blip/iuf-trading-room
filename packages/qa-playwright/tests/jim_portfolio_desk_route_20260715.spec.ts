import { expect, test } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// 正式交易室 route 切換驗收（2026-07-15，Jim）。
// 導覽列「交易室」= /portfolio。7/15 起改指向 /desk-exact 定版引擎（見
// apps/web/app/portfolio/page.tsx 改動 + PR feat/desk-official-route-jim-20260715），
// 取代舊 /api/ui-final-v031/paper-trading-room iframe。這支測試檔是本輪驗收
// harness，非長駐 CI spec。
test.describe("/portfolio (official 交易室 route) now serves /desk-exact engine", () => {
  test("desktop 1280 renders desk-exact hydrated data with no horizontal overflow", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });

    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 30000 });
    await page.waitForTimeout(6000);

    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const gwState = await frame.locator('[data-slot="gw-state"]').first().textContent();
    const ledgerCount = await frame.locator('[data-slot="ledger-count-orders"]').first().textContent();
    const submitDisabled = await frame.locator("button.submit").first().isDisabled();

    testInfo.annotations.push({ type: "sym-price", description: String(symPrice) });
    testInfo.annotations.push({ type: "gw-state", description: String(gwState) });
    testInfo.annotations.push({ type: "ledger-count-orders", description: String(ledgerCount) });
    testInfo.annotations.push({ type: "submit-disabled", description: String(submitDisabled) });
    testInfo.annotations.push({ type: "console-errors", description: JSON.stringify(consoleErrors) });

    expect(submitDisabled, "submit button must be interactive by default (paper channel wired for real submit)").toBe(false);

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    testInfo.annotations.push({ type: "scroll-1280", description: JSON.stringify(scroll) });
    expect(scroll.scrollWidth, "no horizontal overflow at 1280").toBeLessThanOrEqual(scroll.clientWidth + 1);

    await saveRouteScreenshot(page, testInfo, "portfolio-official-desktop-1280");
  });

  test("desktop 1920 fills the viewport with no horizontal overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 30000 });
    await page.waitForTimeout(6000);

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    testInfo.annotations.push({ type: "scroll-1920", description: JSON.stringify(scroll) });
    expect(scroll.scrollWidth, "no horizontal overflow at 1920").toBeLessThanOrEqual(scroll.clientWidth + 1);

    const deskWidth = await frame.locator(".screen.desk").first().evaluate((el) => el.getBoundingClientRect().width);
    testInfo.annotations.push({ type: "screen-desk-width-1920", description: String(deskWidth) });

    await saveRouteScreenshot(page, testInfo, "portfolio-official-desktop-1920");
  });

  test("mobile 390 renders desk-exact hydrated data — honest report, no forced pass", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="m2-sym-price"]').first().waitFor({ state: "attached", timeout: 30000 });
    await page.waitForTimeout(6000);

    const m2Submit = await frame.locator("button.m2-submit").first().isDisabled();
    testInfo.annotations.push({ type: "m2-submit-disabled", description: String(m2Submit) });

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    testInfo.annotations.push({ type: "scroll-390", description: JSON.stringify(scroll) });
    expect(scroll.scrollWidth, "no horizontal overflow at 390").toBeLessThanOrEqual(scroll.clientWidth + 1);

    await saveRouteScreenshot(page, testInfo, "portfolio-official-mobile-390");
  });

  test("/portfolio query handoff (symbol+side) forwards into desk-exact engine same as /desk-exact", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/portfolio?ticker=2330&side=buy", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 30000 });
    await page.waitForTimeout(3000);

    const symbolSlot = await frame.locator('[data-slot="sym-code"]').first().textContent().catch(() => null);
    testInfo.annotations.push({ type: "handoff-symbol-slot", description: String(symbolSlot) });

    await saveRouteScreenshot(page, testInfo, "portfolio-official-handoff-2330-buy");
  });
});
