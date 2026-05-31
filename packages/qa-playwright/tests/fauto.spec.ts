import { expect, test } from "@playwright/test";
import { expectNoServerError, saveRouteScreenshot } from "./helpers";

test("/ops/f-auto renders owner-only S1 SIM observation panels @smoke", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const observed: Array<{ url: string; status: number }> = [];

  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/v1/internal/s1-sim/")) {
      observed.push({ url, status: response.status() });
    }
  });

  await page.goto("/ops/f-auto", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);
  await expect(page).not.toHaveURL(/\/login/);

  await expect(page.locator("body")).toContainText("F-AUTO");
  await expect(page.locator("body")).toContainText("S1-STAT");
  await expect(page.locator("body")).toContainText("S1-BASKET");
  await expect(page.locator("body")).toContainText("S1-EOD");

  await page.waitForTimeout(6_000);

  const s1Statuses = observed.filter((entry) => entry.url.includes("/api/v1/internal/s1-sim/"));
  expect(s1Statuses.length, "F-AUTO page must call S1 status/basket/EOD read endpoints").toBeGreaterThanOrEqual(3);
  expect(
    s1Statuses.filter((entry) => entry.status >= 500 || entry.status === 404 || entry.status === 501),
    "S1 observation endpoints must be deployed and not server-error",
  ).toEqual([]);

  await saveRouteScreenshot(page, testInfo, "ops-f-auto");
});
