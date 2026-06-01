import { expect, test } from "@playwright/test";
import { WEB_BASE_URL, expectNoServerError, saveRouteScreenshot } from "./helpers";

const isLocalPrWeb = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(WEB_BASE_URL);

function isS1ObservationUrl(url: string): boolean {
  if (url.includes("/api/v1/internal/s1-sim/")) return true;

  try {
    const parsed = new URL(url);
    const proxiedPath = parsed.searchParams.get("path");
    return proxiedPath?.includes("/api/v1/internal/s1-sim/") ?? false;
  } catch {
    return false;
  }
}

test("/ops/f-auto renders owner-only S1 SIM observation panels @smoke", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const observed: Array<{ url: string; status: number }> = [];

  page.on("response", (response) => {
    const url = response.url();
    if (isS1ObservationUrl(url)) {
      observed.push({ url, status: response.status() });
    }
  });

  await page.goto("/ops/f-auto", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);
  await expect(page).not.toHaveURL(/\/login/);

  await expect(page.locator("body")).toContainText("F-AUTO");
  const bodyText = await page.locator("body").innerText();
  if (isLocalPrWeb && bodyText.includes("Owner 限定")) {
    await saveRouteScreenshot(page, testInfo, "ops-f-auto-local-owner-gate");
    return;
  }
  await expect(page.locator("body")).toContainText("S1-STAT");
  await expect(page.locator("body")).toContainText("S1-BASKET");
  await expect(page.locator("body")).toContainText("S1-EOD");

  await page.waitForTimeout(6_000);

  const s1Statuses = observed.filter((entry) => isS1ObservationUrl(entry.url));
  expect(s1Statuses.length, "F-AUTO page must call S1 status/basket/EOD read endpoints").toBeGreaterThanOrEqual(3);
  expect(
    s1Statuses.filter((entry) => entry.status >= 500 || entry.status === 404 || entry.status === 501),
    "S1 observation endpoints must be deployed and not server-error",
  ).toEqual([]);

  await saveRouteScreenshot(page, testInfo, "ops-f-auto");
});
