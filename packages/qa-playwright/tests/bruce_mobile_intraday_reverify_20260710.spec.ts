import { expect, test } from "@playwright/test";
import { saveRouteScreenshot } from "./helpers";

/**
 * Bruce — 7/10 盤中窗補驗（#1198 M5 部署後重掃）
 *
 * Covers the one item that was FAIL in
 * reports/mobile_final_acceptance_20260710/BRUCE_MOBILE_FINAL_ACCEPTANCE_2026-07-10.md
 * (981-1000px sidebar-collapse breakpoint mismatch, FinalOnlyFrame.tsx @1000px vs
 * globals.css .app-tactical-sidebar.tac-sidebar @980px). #1198 aligned both to
 * 1000px. Re-scan the full width sweep from the original bug table
 * (975/980/981/995/1000/1001) against prod post-deploy.
 */

const DESKTOP_PROJECT = "desktop-chromium";
const SWEEP_WIDTHS = [975, 980, 981, 995, 1000, 1001];

for (const width of SWEEP_WIDTHS) {
  test(`bruce-reverify: /portfolio sidebar-collapse width sweep @${width}px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `Width sweep runs on the "${DESKTOP_PROJECT}" project.`);
    test.setTimeout(45_000);

    await page.setViewportSize({ width, height: 900 });
    await page.goto("/portfolio");
    await page.locator(".iuf-final-content-frame iframe").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1000);

    const boxes = await page.evaluate(() => {
      const sidebar = document.querySelector(".app-sidebar");
      const iframeEl = document.querySelector(".iuf-final-content-frame iframe");
      const s = sidebar?.getBoundingClientRect();
      const f = iframeEl?.getBoundingClientRect();
      return {
        sidebar: s ? { height: s.height } : null,
        iframe: f ? { height: f.height } : null,
        viewportWidth: window.innerWidth,
      };
    });

    await saveRouteScreenshot(page, testInfo, `bruce_reverify_${width}px_portfolio_sidebar`);

    testInfo.attach(`width-sweep-${width}px`, {
      body: JSON.stringify(boxes, null, 2),
      contentType: "application/json",
    });

    expect(boxes.sidebar, `sidebar should be present in DOM @${width}px`).not.toBeNull();
    expect(boxes.iframe, `trading-room iframe should be present in DOM @${width}px`).not.toBeNull();

    if (width <= 1000) {
      // Mobile/compact band (<=1000px, matches the new aligned breakpoint):
      // sidebar must have collapsed to the compact horizontal nav strip
      // (short height), and the iframe must retain most of the viewport.
      expect(
        boxes.sidebar!.height,
        `@${width}px sidebar should be collapsed (short) post-#1198, got height=${boxes.sidebar!.height}px`,
      ).toBeLessThan(200);
      expect(
        boxes.iframe!.height,
        `@${width}px iframe should retain most of the 900px viewport post-#1198, got height=${boxes.iframe!.height}px`,
      ).toBeGreaterThan(400);
    } else {
      // Desktop band (>1000px): fixed-height aside is expected, and iframe
      // should also get the full viewport height (unchanged pre-existing
      // desktop layout, not part of this fix).
      expect(
        boxes.iframe!.height,
        `@${width}px (desktop band) iframe should still get most of the 900px viewport, got height=${boxes.iframe!.height}px`,
      ).toBeGreaterThan(400);
    }
  });
}
