import { expect, test } from "@playwright/test";
import { saveRouteScreenshot } from "./helpers";

/**
 * Mobile M5 (2026-07-10) — /portfolio 981-1000px breakpoint-mismatch fix.
 *
 * Root cause (Bruce final acceptance, 2026-07-10 —
 * reports/mobile_final_acceptance_20260710/BRUCE_MOBILE_FINAL_ACCEPTANCE_2026-07-10.md):
 * FinalOnlyFrame.tsx's overlay-disable rule fires at `@media (max-width: 1000px)`,
 * but the shared Sidebar's own compact-bar collapse (`.app-sidebar` @1000px in
 * globals.css was fine, but `.app-tactical-sidebar.tac-sidebar` /
 * `.tac-sidebar`/`.tac-brand`/`.tac-nav` collapse) only fired at
 * `@media (max-width: 980px)`. In the 981-1000px band the overlay was
 * correctly disabled (in-flow, no click interception) but sidebar content
 * never collapsed, rendering at its full ~718px list height and squeezing the
 * /portfolio trading iframe down to ~182px of a 900px-tall viewport.
 *
 * Fix: moved every sidebar-collapse-specific selector in globals.css from
 * 980px to 1000px, aligned with FinalOnlyFrame.tsx and the pre-existing
 * `.app-sidebar` @1000px block. See globals.css comments near the two moved
 * blocks for the full selector list.
 *
 * This spec runs on the "desktop-chromium" project with the viewport
 * overridden per-width (mirrors bruce_mobile_final_acceptance_20260710.spec.ts's
 * 995px check, generalized into a 6-point sweep across the old dead band).
 */

const DESKTOP_PROJECT = "desktop-chromium";

type ShellBoxes = {
  sidebar: { top: number; bottom: number; height: number; width: number } | null;
  iframe: { top: number; bottom: number; height: number; width: number } | null;
  viewportWidth: number;
};

async function measurePortfolioShell(page: import("@playwright/test").Page): Promise<ShellBoxes> {
  await page.goto("/portfolio");
  await page.locator(".iuf-final-content-frame iframe").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);

  return page.evaluate(() => {
    const sidebar = document.querySelector(".app-sidebar");
    const iframeEl = document.querySelector(".iuf-final-content-frame iframe");
    const s = sidebar?.getBoundingClientRect();
    const f = iframeEl?.getBoundingClientRect();
    return {
      sidebar: s ? { top: s.top, bottom: s.bottom, height: s.height, width: s.width } : null,
      iframe: f ? { top: f.top, bottom: f.bottom, height: f.height, width: f.width } : null,
      viewportWidth: window.innerWidth,
    };
  });
}

// Widths spanning the old 20px dead band (981-1000px), plus the clean
// boundaries on either side (975/980 = old compact-below-980 range,
// 1001 = desktop fixed-column layout takes over).
const COMPACT_WIDTHS = [975, 980, 981, 995, 1000];

for (const width of COMPACT_WIDTHS) {
  test(`m5: /portfolio at ${width}px — sidebar compact, iframe keeps usable height`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `breakpoint sweep runs on the "${DESKTOP_PROJECT}" project.`);
    test.setTimeout(45_000);

    await page.setViewportSize({ width, height: 900 });
    const boxes = await measurePortfolioShell(page);

    await saveRouteScreenshot(page, testInfo, `m5_portfolio_${width}px`);

    expect(boxes.sidebar, `sidebar should be present in the DOM at ${width}px`).not.toBeNull();
    expect(boxes.iframe, `trading-room iframe should be present in the DOM at ${width}px`).not.toBeNull();

    // Below/at the (now-unified) 1000px breakpoint, the sidebar must have
    // collapsed into the compact horizontal nav strip (natural height < 200px)
    // — this is the exact condition that was broken for 981-1000px pre-fix.
    expect(
      boxes.sidebar!.height,
      `sidebar should collapse to compact-bar height at ${width}px, got ${boxes.sidebar!.height}px (dead-band regression if >=200px)`,
    ).toBeLessThan(200);

    expect(
      boxes.iframe!.height,
      `iframe should keep a usable fraction of the 900px viewport at ${width}px, got ${boxes.iframe!.height}px (sidebar squeeze regression if <=400px)`,
    ).toBeGreaterThan(400);
  });
}

test("m5: /portfolio at 1001px — desktop fixed-column layout, iframe unaffected", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `breakpoint sweep runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(45_000);

  await page.setViewportSize({ width: 1001, height: 900 });
  const boxes = await measurePortfolioShell(page);

  await saveRouteScreenshot(page, testInfo, "m5_portfolio_1001px");

  expect(boxes.sidebar, "sidebar should be present in the DOM at 1001px").not.toBeNull();
  expect(boxes.iframe, "trading-room iframe should be present in the DOM at 1001px").not.toBeNull();
  // At 1001px both FinalOnlyFrame.tsx's and globals.css's sidebar-collapse
  // media queries no longer apply — the desktop fixed-column layout takes
  // over (sidebar reserves a fixed-width column, iframe is position:fixed
  // inset with left:252px). Sidebar and iframe are independently full-height
  // here by design (not a squeeze — they occupy separate horizontal regions),
  // so the only invariant that matters is that the iframe still gets a real,
  // usable height.
  expect(
    boxes.iframe!.height,
    `iframe should render at desktop full height at 1001px, got ${boxes.iframe!.height}px`,
  ).toBeGreaterThan(400);
});

// ---------------------------------------------------------------------------
// Cross-page regression: the sidebar-collapse breakpoint move affects every
// route that renders the shared Sidebar (root layout), not just /portfolio.
// Spot-check the home page (which also renders a second, page.tsx-local
// `.tac-sidebar` inside `.tactical-dashboard`) and one ordinary route to
// confirm the same 981-1000px band now collapses correctly elsewhere too.
// ---------------------------------------------------------------------------
const OTHER_ROUTES = ["/", "/track-record"];

for (const routePath of OTHER_ROUTES) {
  test(`m5: ${routePath} at 995px — sidebar collapses (cross-page regression check)`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `breakpoint sweep runs on the "${DESKTOP_PROJECT}" project.`);
    test.setTimeout(45_000);

    await page.setViewportSize({ width: 995, height: 900 });
    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const sidebarHeight = await page.evaluate(() => {
      const sidebar = document.querySelector(".tac-sidebar");
      return sidebar?.getBoundingClientRect().height ?? null;
    });

    await saveRouteScreenshot(page, testInfo, `m5_other_route_995px_${routePath.replace(/\//g, "_") || "_home"}`);

    expect(sidebarHeight, `.tac-sidebar should be present on ${routePath} at 995px`).not.toBeNull();
    expect(
      sidebarHeight!,
      `${routePath} sidebar should collapse to compact-bar height at 995px, got ${sidebarHeight}px`,
    ).toBeLessThan(200);
  });
}

// ---------------------------------------------------------------------------
// 1280px desktop regression: unchanged from before this fix (1280 > 1000, no
// media query touched by M5 applies here). Screenshot-only sanity check.
// ---------------------------------------------------------------------------
test("m5: /portfolio at 1280px desktop — unchanged 3-column layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `desktop regression runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(30_000);

  await page.setViewportSize({ width: 1280, height: 900 });
  const boxes = await measurePortfolioShell(page);

  await saveRouteScreenshot(page, testInfo, "m5_portfolio_1280px_desktop");

  // Not asserting an exact pixel width here — the reserved desktop column
  // (.app-sidebar { width: 252px }) measures a few px narrower in practice
  // due to scrollbar/border box-model quirks unrelated to M5. What matters
  // for "unchanged 3-column layout" is that the sidebar is still a narrow
  // fixed column (not the mobile 100%-width compact bar) and the iframe
  // still renders full-height.
  expect(boxes.sidebar!.width, "sidebar should keep its desktop fixed-width column at 1280px, not the mobile 100%-wide compact bar").toBeLessThan(300);
  expect(boxes.sidebar!.width, "sidebar should keep its desktop fixed-width column at 1280px").toBeGreaterThan(200);
  expect(boxes.iframe!.height, "iframe should render at full desktop height at 1280px").toBeGreaterThan(400);
});
