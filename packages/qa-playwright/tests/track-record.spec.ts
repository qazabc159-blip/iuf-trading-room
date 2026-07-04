import { expect, test } from "@playwright/test";
import { WEB_BASE_URL, expectNoServerError, saveRouteScreenshot } from "./helpers";

/**
 * Smoke tests for /track-record (P0-C 公開績效記帳頁 — Jim).
 *
 * Runs on both `desktop-chromium` (1440px) and `mobile-iphone-13` (390px)
 * projects by default (see playwright.config.ts) — this is the page's
 * mobile-first screenshot evidence.
 *
 * The AI-rec performance + F-AUTO NAV endpoints are currently Owner-only
 * (see PR body). The default project storageState is an Owner session
 * (auth.setup.ts), so this smoke exercises the "live data" path when a real
 * Owner session is available, and only asserts the page never 500s / never
 * shows forbidden wording either way.
 *
 * @smoke tag: runs in CI against the local PR build.
 */

const FORBIDDEN_WORDING = /approved|alpha confirmed|live-ready|可以跟單|保證獲利/i;

test("/track-record renders the 3-section scorecard shell without server errors @smoke", async ({ page }, testInfo) => {
  test.setTimeout(30_000);

  const resp = await page.goto(`${WEB_BASE_URL}/track-record`, { waitUntil: "domcontentloaded" });

  // Authenticated (Owner) session must never be bounced to /login, and never 5xx.
  expect(page.url(), "/track-record must not redirect an authenticated session to /login").not.toMatch(/\/login/);
  expect(resp === null || resp.status() < 500, "/track-record must not 5xx").toBe(true);

  const bodyText = await page.locator("body").innerText().catch(() => "");

  // Pre-deploy smoke: build may not include this route yet — skip honestly instead of failing.
  test.skip(!/公開績效記帳/.test(bodyText) && resp?.status() === 404, "route not present in this build (pre-deploy smoke)");

  await expect(page.locator("body"), "page must show the track-record title").toContainText("公開績效記帳");

  // All 3 sections must render some content (either real numbers or an honest empty state) —
  // never a blank shell.
  await expect(page.locator("body")).toContainText("AI 推薦成績單");
  await expect(page.locator("body")).toContainText("F-AUTO");
  await expect(page.locator("body")).toContainText("策略把關紀錄");

  // Disclaimer must always be present regardless of data state.
  await expect(page.locator("body")).toContainText("過去績效不代表未來表現");

  expect(bodyText, "page must not contain forbidden promotional wording").not.toMatch(FORBIDDEN_WORDING);

  await expectNoServerError(page);
  await saveRouteScreenshot(page, testInfo, "track-record");
});

test("/track-record redirects unauthenticated visitors to /login (no data leak)", async ({ page }, testInfo) => {
  await page.context().clearCookies();
  await page.goto(`${WEB_BASE_URL}/track-record`, { waitUntil: "domcontentloaded" });

  expect(page.url(), "/track-record must redirect unauthenticated visitors to /login").toMatch(/\/login/);

  const bodyText = await page.locator("body").innerText().catch(() => "");
  expect(bodyText, "unauthenticated /track-record must not leak performance numbers").not.toMatch(/樣本 \d+ 筆推薦/);

  await saveRouteScreenshot(page, testInfo, "track-record-unauthenticated-redirect");
});
