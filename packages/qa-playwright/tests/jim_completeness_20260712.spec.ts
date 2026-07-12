import { test, expect } from "@playwright/test";
import { WEB_BASE_URL, saveRouteScreenshot } from "./helpers";

// Real-browser verification for the two completeness items:
// 1. /companies/[symbol] hero「帶入模擬單」CTA -> /portfolio query round-trip
//    (decision-chain gap: 看完研究要下紙上單得自己繞路).
// 2. /settings/subscription P2-7 english-jargon -> Chinese translation.

test.describe("company hero prefill CTA -> /portfolio handoff", () => {
  test("clicking 帶入模擬單 navigates to /portfolio with ticker+prefill query preserved", async ({ page }, testInfo) => {
    await page.goto(`${WEB_BASE_URL}/companies/2330`, { waitUntil: "networkidle" });
    const cta = page.getByTestId("company-hero-prefill-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/portfolio?ticker=2330&prefill=true");

    await Promise.all([page.waitForURL(/\/portfolio\?/), cta.click()]);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/portfolio");
    expect(url.searchParams.get("ticker")).toBe("2330");
    expect(url.searchParams.get("prefill")).toBe("true");
    await saveRouteScreenshot(page, testInfo, "jim_completeness_portfolio_after_cta");
  });

  test("CTA is >=44px touch target at 390px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${WEB_BASE_URL}/companies/2330`, { waitUntil: "networkidle" });
    const cta = page.getByTestId("company-hero-prefill-cta");
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await saveRouteScreenshot(page, testInfo, "jim_completeness_company_hero_390");
  });

  test("company hero at 1280px desktop", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${WEB_BASE_URL}/companies/2330`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("company-hero-prefill-cta")).toBeVisible();
    await saveRouteScreenshot(page, testInfo, "jim_completeness_company_hero_1280");
  });
});

test.describe("/settings/subscription P2-7 中文化", () => {
  test("no raw english jargon clauses remain visible", async ({ page }, testInfo) => {
    await page.goto(`${WEB_BASE_URL}/settings/subscription`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    for (const jargon of ["forward observation", "SIM-only", "Daily smoke"]) {
      expect(bodyText, `should not visibly render raw jargon: ${jargon}`).not.toContain(jargon);
    }
    // Brand names should still be present untouched.
    expect(bodyText).toContain("Starter");
    expect(bodyText).toContain("Pro");
    expect(bodyText).toContain("Premium");
    await saveRouteScreenshot(page, testInfo, "jim_completeness_subscription_1280");
  });

  test("subscription page at 390px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${WEB_BASE_URL}/settings/subscription`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    for (const jargon of ["forward observation", "SIM-only", "Daily smoke"]) {
      expect(bodyText).not.toContain(jargon);
    }
    await saveRouteScreenshot(page, testInfo, "jim_completeness_subscription_390");
  });
});
