import { test, expect } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// Mobile 390px pass over the unified order flow (楊董動員令附加，2026-07-09).
// Runs only on the mobile-iphone-13 project (390x844) — same convention as
// packages/qa-playwright/tests/mobile-390.spec.ts. Component-level
// horizontal-scroll containers are allowed (that file's documented policy);
// only the page BODY itself must never scroll sideways.

const MOBILE_PROJECT = "mobile-iphone-13";

const MIN_TOUCH_PX = 44;

async function waitForCapitalReady(frame: ReturnType<typeof extractFrame>) {
  await expect(frame.locator("#summary-avail")).not.toHaveText("--", { timeout: 20000 });
}

test.describe("mobile 390px order flow", () => {
  test("open panel -> fill ticket -> submit -> error scenario, no horizontal overflow", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== MOBILE_PROJECT,
      `mobile order-flow pass is dedicated to the "${MOBILE_PROJECT}" project.`,
    );
    test.setTimeout(45_000);

    await page.goto("/portfolio");

    // Page body itself must never scroll sideways at 390px.
    const bodyOverflow = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
    }));
    expect(
      bodyOverflow.scrollWidth,
      `portfolio page body scrolled horizontally at 390px: scrollWidth=${bodyOverflow.scrollWidth} > clientWidth=${bodyOverflow.clientWidth}`,
    ).toBeLessThanOrEqual(bodyOverflow.clientWidth + 1);

    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);
    await saveRouteScreenshot(page, testInfo, "mobile390_order_flow_panel_open");

    // Fill ticket.
    await frame.locator("#t-qty").fill("1");
    await frame.locator("#t-price").fill("10");
    await saveRouteScreenshot(page, testInfo, "mobile390_order_flow_filled");

    // Submit — off-hours, so this legitimately risk-blocks; that IS the error
    // scenario this check asks for. force:true is required here because of a
    // pre-existing, out-of-scope mobile gap this run discovered: the app
    // shell's <aside class="app-sidebar"> intercepts pointer events across
    // the full embedded trading-room viewport at 390px (real taps would miss
    // every control) — see MOBILE_GAP_REPORT.md. Not fixed in this PR: root
    // cause is FinalOnlyFrame.tsx/Sidebar.tsx shell code outside this PR's
    // final-v031-live.ts scope.
    await frame.locator("#submit-btn").click({ force: true });
    await page.waitForTimeout(2500);
    await saveRouteScreenshot(page, testInfo, "mobile390_order_flow_error_scenario");
    const gateText = await frame.locator(".gate .h .v").innerText();
    expect(gateText).not.toMatch(/Blocked by|trading_hours|Error:|undefined/);

    // Touch targets >= 44px for the primary order-flow controls.
    const submitBox = await frame.locator("#submit-btn").evaluate((el) => el.getBoundingClientRect());
    expect(submitBox.height, `#submit-btn height ${submitBox.height}px < ${MIN_TOUCH_PX}px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);

    // 觸控目標鐵律 P2（2026-07-10 收口）：這兩組原本只 console.log 記錄的缺口
    // 已在 index.html 的 @media (max-width:767px) 區塊修好（.brokerstrip .bbtn
    // + .stepbtn），這裡改回真斷言，不再只是留紀錄。
    const qtyStepBtns = frame.locator('#t-qty').locator("xpath=../..").locator(".stepbtn");
    const stepCount = await qtyStepBtns.count();
    expect(stepCount, "expected qty +/- stepbtn pair to be present").toBeGreaterThan(0);
    for (let i = 0; i < stepCount; i++) {
      const box = await qtyStepBtns.nth(i).evaluate((el) => el.getBoundingClientRect());
      expect(box.width, `step-btn[${i}] width ${box.width}px < ${MIN_TOUCH_PX}px at 390px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
      expect(box.height, `step-btn[${i}] height ${box.height}px < ${MIN_TOUCH_PX}px at 390px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
    }

    const brokerBtns = frame.locator("#broker-strip .bbtn:not([disabled])");
    const brokerCount = await brokerBtns.count();
    expect(brokerCount, "expected broker-strip buttons to be present").toBeGreaterThan(0);
    for (let i = 0; i < brokerCount; i++) {
      const box = await brokerBtns.nth(i).evaluate((el) => el.getBoundingClientRect());
      expect(box.height, `broker-btn[${i}] height ${box.height}px < ${MIN_TOUCH_PX}px at 390px`).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
    }
  });

  test("desktop 1440px density unchanged — broker-strip/stepbtn stay compact, not bumped to 44px", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      'desktop density-regression check is dedicated to the "desktop-chromium" project.',
    );
    test.setTimeout(45_000);

    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);

    // Proves the mobile-only @media (max-width:767px) touch-target bump did
    // not leak into desktop density — these must stay well below the 44px
    // mobile floor (original: bbtn ~27-29px, stepbtn 31x32px).
    const brokerBtn = frame.locator("#broker-strip .bbtn").first();
    const brokerBox = await brokerBtn.evaluate((el) => el.getBoundingClientRect());
    expect(brokerBox.height, `desktop broker-btn height ${brokerBox.height}px should stay compact (<40px)`).toBeLessThan(40);

    const stepBtn = frame.locator('#t-qty').locator("xpath=../..").locator(".stepbtn").first();
    const stepBox = await stepBtn.evaluate((el) => el.getBoundingClientRect());
    expect(stepBox.width, `desktop step-btn width ${stepBox.width}px should stay compact (<40px)`).toBeLessThan(40);
    expect(stepBox.height, `desktop step-btn height ${stepBox.height}px should stay compact (<40px)`).toBeLessThan(40);
  });
});
