import { expect, test } from "@playwright/test";
import { saveRouteScreenshot } from "./helpers";

/**
 * Mobile company-page collapse (2026-07-22).
 *
 * /companies/2330 at 390px was a ~23,910px scroll-forever page (every heavy
 * table/panel fully expanded, same as desktop). This wraps the heaviest
 * sections (財報 7-tab / 知識-上下游圖譜 / 法人籌碼-融資融券 / 外資持股 /
 * 逐筆成交明細 / 重大訊息 / 完整資料區 [06]-[11]) in CompanyMobileDrawer — a
 * native <details>/<summary> collapse. Hero/K線/五檔/AI 報告 stay directly
 * visible (unwrapped) on both viewports.
 *
 * The `open` attribute ships present in the SSR HTML for every viewport
 * (desktop/tablet never touch it — zero visual/layout change from before
 * this drawer existed). A tiny inline script per drawer (no React state,
 * no "use client") removes `open` before paint only when
 * matchMedia("(max-width: 768px)") — so mobile starts collapsed, desktop
 * stays exactly as it was. See CompanyMobileDrawer.tsx for why this can't be
 * done with a plain CSS override (Chromium's native details-content
 * collapse-animation box clips a child's height regardless of the child's
 * own `display` value).
 */

const MOBILE_PROJECT = "mobile-iphone-13";
const DESKTOP_PROJECT = "desktop-chromium";

test("mobile 390px: heavy sections start collapsed, hero/K-line stay visible, tap expands", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== MOBILE_PROJECT, `mobile-only check runs on the "${MOBILE_PROJECT}" project.`);

  await page.goto("/companies/2330");
  await page.locator(".company-workbench-shell").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);

  // Hero/K線/AI report are never wrapped — visible immediately, no tap needed.
  await expect(page.locator(".company-workbench-shell")).toBeVisible();
  await expect(page.locator("#company-ai-report")).toBeVisible();

  // A representative heavy drawer (財報與估值) starts collapsed: summary row
  // visible, body content not visible until tapped.
  const finDrawer = page.locator("#sec-fin");
  await expect(finDrawer).toBeVisible();
  const finSummary = finDrawer.locator("> summary");
  await expect(finSummary).toBeVisible();
  await expect(finSummary).toContainText("財報與估值");
  const finBody = finDrawer.locator("> ._co-mdrawer-body");
  await expect(finBody).toBeHidden();

  await saveRouteScreenshot(page, testInfo, "jim_mobile_collapse_before_tap");

  // Tap the summary — native <details> toggle, no JS handler of our own.
  await finSummary.click();
  await expect(finBody).toBeVisible();
  await expect(finDrawer).toHaveJSProperty("open", true);

  await saveRouteScreenshot(page, testInfo, "jim_mobile_collapse_after_tap");

  // Page height must be dramatically shorter than the pre-fix ~23,910px.
  const height = await page.evaluate(() => document.body.scrollHeight);
  expect(height, `mobile body height ${height}px should be well under the pre-fix ~23,910px`).toBeLessThan(10000);

  // No page-level horizontal overflow introduced by the drawer chrome.
  const overflow = await page.evaluate(() => document.body.scrollWidth - document.body.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("desktop 1440px: drawer summary hidden, all sections stay expanded (zero regression)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `desktop-only check runs on the "${DESKTOP_PROJECT}" project.`);

  await page.goto("/companies/2330");
  await page.locator(".company-workbench-shell").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);

  const finDrawer = page.locator("#sec-fin");
  await expect(finDrawer).toBeVisible();
  // The custom summary chrome never existed on desktop before this pass —
  // it must stay hidden there.
  await expect(finDrawer.locator("> summary")).toBeHidden();
  // Body content stays visible without any tap.
  await expect(finDrawer.locator("> ._co-mdrawer-body")).toBeVisible();
  await expect(page.locator("#company-full-profile ._co-mdrawer-body")).toBeVisible();

  await saveRouteScreenshot(page, testInfo, "jim_desktop_collapse_unwrapped");
});
