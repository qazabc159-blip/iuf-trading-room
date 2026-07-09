import { test, expect } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// Mobile M4 (2026-07-09) — /portfolio app-shell sidebar overlay regression.
// Discovered during PR-4 (統一下單流 D6) mobile 390px pass: <aside
// class="app-sidebar"> intercepted pointer events across the entire embedded
// trading-room iframe viewport at 390px, so a real (non-force) tap on any
// iframe control would silently miss. Root cause: FinalOnlyFrame.tsx's
// desktop-only sidebar reposition rule ("keep the 252px sidebar column above
// the fixed full-height frame") had no mobile counterpart, so at <=1000px
// the frame goes full-width (no reserved sidebar column) while the sidebar
// was still being forced to position:relative + height:100dvh + a z-index
// above the frame — blowing it up into a full-viewport opaque overlay (see
// reports/unified_order_frontend_20260709/PR4_VERIFICATION.md and
// reports/mobile_m4_20260709/before_portfolio_390_overlay_bug.png).
// Runs only on the mobile-iphone-13 project (390x844), matching
// mobile-390.spec.ts's convention.

const MOBILE_PROJECT = "mobile-iphone-13";

test.describe("mobile 390px — /portfolio shell does not block the embedded trading room", () => {
  test("broker-strip button inside the iframe receives a real (non-force) click", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== MOBILE_PROJECT,
      `mobile M4 shell-overlay gate is dedicated to the "${MOBILE_PROJECT}" project.`,
    );
    test.setTimeout(45_000);

    await page.goto("/portfolio");
    const frame = extractFrame(page);
    const kgiBtn = frame.locator('#broker-strip .bbtn[data-broker="kgi"]');
    await kgiBtn.waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1000);

    await saveRouteScreenshot(page, testInfo, "mobile390_portfolio_shell_before_click");

    // Real click, no force:true — before the fix this times out because
    // <aside class="app-sidebar"> intercepts pointer events across the
    // whole viewport (verified: reports/mobile_m4_20260709/BEFORE_repro
    // failure log).
    await kgiBtn.click({ timeout: 8000 });
    await expect(kgiBtn, "clicking the KGI broker button should toggle it active — proves the click actually reached the iframe, not just resolved a no-op").toHaveClass(/active/, { timeout: 5000 });

    await saveRouteScreenshot(page, testInfo, "mobile390_portfolio_shell_after_click");
  });

  test("sidebar does not overlay the embedded trading-room iframe", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== MOBILE_PROJECT,
      `mobile M4 shell-overlay gate is dedicated to the "${MOBILE_PROJECT}" project.`,
    );
    test.setTimeout(45_000);

    await page.goto("/portfolio");
    await page.locator(".iuf-final-content-frame iframe").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(1000);

    const boxes = await page.evaluate(() => {
      const sidebar = document.querySelector(".app-sidebar");
      const iframeEl = document.querySelector(".iuf-final-content-frame iframe");
      const s = sidebar?.getBoundingClientRect();
      const f = iframeEl?.getBoundingClientRect();
      return {
        sidebar: s ? { top: s.top, bottom: s.bottom, height: s.height } : null,
        iframe: f ? { top: f.top, bottom: f.bottom, height: f.height } : null,
      };
    });

    expect(boxes.sidebar, "sidebar should be present in the DOM").not.toBeNull();
    expect(boxes.iframe, "trading-room iframe should be present in the DOM").not.toBeNull();
    // The sidebar must not blow up to (near-)full-viewport height and must
    // sit entirely above the iframe — no vertical overlap between the two.
    expect(boxes.sidebar!.height, "sidebar should not force full-viewport height at 390px").toBeLessThan(200);
    expect(
      boxes.sidebar!.bottom,
      `sidebar (bottom=${boxes.sidebar!.bottom}) must not extend past the iframe's top (top=${boxes.iframe!.top}) — any overlap means the sidebar can intercept iframe taps`,
    ).toBeLessThanOrEqual(boxes.iframe!.top + 1);
    // The iframe itself must get real vertical space, not the ~150px
    // browser-default intrinsic <iframe> height (a sign the flex chain
    // collapsed and the iframe never received a real height).
    expect(boxes.iframe!.height, "iframe should fill the remaining viewport height, not collapse to intrinsic default").toBeGreaterThan(400);
  });
});
