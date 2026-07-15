import { expect, test } from "@playwright/test";
import { expectNoServerError, saveRouteScreenshot } from "./helpers";

test("/companies/2330 exposes company panels with explicit live/degraded/disabled states", async ({ page }, testInfo) => {
  await page.goto("/companies/2330", { waitUntil: "domcontentloaded" });
  await expectNoServerError(page);
  await expect(page.getByRole("heading", { name: "2330", exact: true })).toBeVisible();
  await expect(page.getByLabel("AI 分析師報告")).toBeVisible();

  const panelCount = await page.locator("section.panel, div.panel").count();
  expect(panelCount, "company detail should expose at least 9 visible panels").toBeGreaterThanOrEqual(9);

  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "company page must expose explicit source states").toMatch(/LIVE|DEGRADED|COMING_SOON|EMPTY|正常|降級|無資料|暫停/);
  expect(bodyText, "company page must not expose raw application errors").not.toMatch(/Application error|server-side exception|undefined is not/i);
  // 2026-07-15 productize round: BLOCKED is an internal enum literal, never a
  // user-facing label (product language uses 暫停 instead); DerivativesPanel
  // ("衍生品/即將推出") was removed entirely rather than shipped as a
  // permanent empty placeholder — lock both regressions.
  expect(bodyText, "company page must not leak raw BLOCKED enum literal").not.toMatch(/\bBLOCKED\b/);
  expect(bodyText, "company page must not show the retired derivatives placeholder").not.toMatch(/衍生品|即將推出|權證與選擇權/);

  await saveRouteScreenshot(page, testInfo, "companies-2330");
});
