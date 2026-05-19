import { expect, test } from "@playwright/test";
import { expectNoServerError, saveRouteScreenshot } from "./helpers";

test("/companies theme navigation does not fall into mobile or legacy routes", async ({ page }, testInfo) => {
  await page.goto("/companies", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);

  const firstThemeLink = page.locator('a[href^="/themes/"], a[href^="/companies?theme="], a[href*="theme"]').first();
  if ((await firstThemeLink.count()) > 0) {
    await firstThemeLink.click();
    await page.waitForLoadState("domcontentloaded");
  } else {
    await page.goto("/themes", { waitUntil: "domcontentloaded" });
  }

  expect(page.url(), "theme route must not use the mobile app namespace").not.toContain("/m/");
  expect(page.url(), "theme route must not use legacy company topic pages").not.toMatch(/old|legacy|mobile/i);
  await expectNoServerError(page);

  await page.goBack({ waitUntil: "domcontentloaded" });
  expect(page.url(), "back navigation must not fall into mobile namespace").not.toContain("/m/");
  await expectNoServerError(page);

  await saveRouteScreenshot(page, testInfo, "company-theme-routing");
});
