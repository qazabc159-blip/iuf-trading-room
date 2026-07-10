import { expect, test } from "@playwright/test";
import { saveRouteScreenshot } from "./helpers";

/**
 * Follow-up round (2026-07-10) — two independent Pete-review items:
 *
 * 1. pricingQuality degraded-pricing badge on FAutoNavPanel (Pete #1192):
 *    `/api/v1/portfolio/f-auto/nav` now marks each nav point "official" or
 *    "mis_fallback_full" (#1192, 2026-07-09). This spec is a zero-regression
 *    check for the shared FAutoNavPanel component at 390px (via the public
 *    /track-record page) and 1280px (via the Owner-only /ops/f-auto page) —
 *    the render-logic itself (badge shows only when a degraded point exists)
 *    is unit-tested with fixtures in
 *    apps/web/lib/fauto-nav-pricing-quality.test.ts, since prod data may or
 *    may not currently contain a mis_fallback_full row.
 *
 * 2. Homepage `.tac-content` 981-1000px padding desync (Pete #1198 💭):
 *    `.tactical-dashboard` already collapses to a single column at 1000px
 *    (Mobile M5, #1198), but `.tac-content`'s padding override stayed at
 *    980px — leaving a 981-1000px band single-column-stacked with the
 *    desktop 32px gutter. Fixed by moving `.tac-content` into the 1000px
 *    block (see globals.css comment near line ~14304). This spec asserts
 *    the computed left padding at 995px (mid-band) matches the mobile value.
 */

const DESKTOP_PROJECT = "desktop-chromium";
const MOBILE_PROJECT = "mobile-iphone-13";

test("home: .tac-content padding is the mobile (18px) value at 995px, not the desktop (32px) value", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(45_000);

  await page.setViewportSize({ width: 995, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  const paddingLeft = await page.evaluate(() => {
    const el = document.querySelector(".tac-content");
    if (!el) return null;
    return window.getComputedStyle(el).paddingLeft;
  });

  await saveRouteScreenshot(page, testInfo, "tac_content_padding_995px");

  expect(paddingLeft, ".tac-content should exist on the homepage").not.toBeNull();
  expect(
    paddingLeft,
    `expected the 1000px-band mobile padding (18px), got ${paddingLeft} — .tac-content breakpoint desynced from .tactical-dashboard's 1000px single-column collapse again`,
  ).toBe("18px");
});

test("home: .tac-content padding is still the desktop (32px) value at 1001px (boundary, unaffected)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(45_000);

  await page.setViewportSize({ width: 1001, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  const paddingLeft = await page.evaluate(() => {
    const el = document.querySelector(".tac-content");
    return el ? window.getComputedStyle(el).paddingLeft : null;
  });

  await saveRouteScreenshot(page, testInfo, "tac_content_padding_1001px");

  expect(paddingLeft).toBe("32px");
});

test("ops/f-auto (Owner-only) at 1280px: FAutoNavPanel renders without layout regression", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(45_000);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/ops/f-auto", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  await saveRouteScreenshot(page, testInfo, "fnav_1280px_ops_f_auto");

  expect(
    overflow.scrollWidth,
    `page body should not overflow horizontally at 1280px (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test("track-record at 390px: FAutoNavPanel weekly table stays within the scroll wrapper (M3 fix intact)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== MOBILE_PROJECT, `runs on the "${MOBILE_PROJECT}" project.`);
  test.setTimeout(45_000);

  await page.goto("/track-record", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  await saveRouteScreenshot(page, testInfo, "fnav_390px_track_record");

  expect(
    overflow.scrollWidth,
    `page body should not overflow horizontally at 390px (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

// /ops/f-auto is Owner-gated by a client-side apiGetMe() fetch straight to the
// prod API — under local dev + a rewritten-domain owner cookie that gate can
// false-negative on cross-origin cookie policy (pre-existing harness artifact,
// see apps/web/app/ops/f-auto/page.tsx and prior session notes on the same
// gate pattern in /portfolio). /track-record renders the identical shared
// FAutoNavPanel with no such gate, so it's the more reliable real-content
// check for the 1280px desktop regression.
test("track-record at 1280px desktop: FAutoNavPanel renders without layout regression", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(45_000);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/track-record", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  await saveRouteScreenshot(page, testInfo, "fnav_1280px_track_record");

  expect(
    overflow.scrollWidth,
    `page body should not overflow horizontally at 1280px (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
});
