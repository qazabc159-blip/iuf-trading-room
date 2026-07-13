import { test, expect } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// 台股下單能力矩陣 T-3 (2026-07-13) — verifies the new session/orderCond/TIF
// ticket controls render, gate illegal combinations client-side (before any
// submit), and that legal combinations reach the unified submit endpoint
// with orderCond/session/timeInForce in the outgoing payload.
//
// Note: this run is off-hours (Asia/Taipei outside 09:00-13:30), so a legal
// combination still gets risk-blocked server-side with 交易時段 — that's
// correct behavior, not a defect (same off-hours caveat as
// jim_pr3_unified_order_20260709.spec.ts).

async function waitForCapitalReady(frame: ReturnType<typeof extractFrame>) {
  await expect(frame.locator("#summary-avail")).not.toHaveText("--", { timeout: 20000 });
}

test.describe("order type matrix T-3", () => {
  test("all five control groups render with correct default state", async ({ page }, testInfo) => {
    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);

    await expect(frame.locator("#t-session button.on")).toHaveText("整股");
    await expect(frame.locator("#t-cond button.on")).toHaveText("現股");
    await expect(frame.locator("#t-tif button.on")).toHaveText("ROD");
    await expect(frame.locator("#t-otype")).toHaveValue("limit");

    await saveRouteScreenshot(page, testInfo, "matrix_default_state");
    const ticket = frame.locator("#ticket");
    await ticket.screenshot({ path: testInfo.outputPath("matrix_ticket_default.png") });
  });

  test("switching to 盤中零股 forces SHARE unit + 現股 cond, both greyed out", async ({ page }, testInfo) => {
    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);

    // Start from a non-cash cond to prove the auto-correction actually fires.
    await frame.locator('#t-cond [data-cond="margin"]').click();
    await expect(frame.locator("#t-cond button.on")).toHaveText("融資");

    await frame.locator('#t-session [data-session="intraday_odd"]').click();

    await expect(frame.locator("#t-cond button.on")).toHaveText("現股");
    await expect(frame.locator('#t-cond [data-cond="margin"]')).toBeDisabled();
    await expect(frame.locator('#t-cond [data-cond="short"]')).toBeDisabled();
    await expect(frame.locator('#t-cond [data-cond="daytrade"]')).toBeDisabled();

    await expect(frame.locator("#t-unit button.on")).toHaveText(/股/);
    await expect(frame.locator('#t-unit [data-unit="lot"]')).toBeDisabled();
    await expect(frame.locator("#t-qty-hint")).toHaveText("零股：1–999 股");
    await expect(frame.locator("#t-session-hint")).toHaveText(/09:10/);

    await saveRouteScreenshot(page, testInfo, "matrix_intraday_odd_forces_cash_share");
  });

  test("盤後零股 forces TIF to ROD only, 盤後定價 hint shows call-auction hours", async ({ page }, testInfo) => {
    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);

    await frame.locator('#t-tif [data-tif="ioc"]').click();
    await expect(frame.locator("#t-tif button.on")).toHaveText("IOC");

    await frame.locator('#t-session [data-session="afterhours_odd"]').click();
    await expect(frame.locator("#t-tif button.on")).toHaveText("ROD");
    await expect(frame.locator('#t-tif [data-tif="ioc"]')).toBeDisabled();
    await expect(frame.locator('#t-tif [data-tif="fok"]')).toBeDisabled();
    await expect(frame.locator("#t-session-hint")).toHaveText(/13:40/);

    await frame.locator('#t-session [data-session="afterhours_fixed"]').click();
    await expect(frame.locator("#t-session-hint")).toHaveText(/14:00/);
    await expect(frame.locator("#t-tif button.on")).toHaveText("ROD");

    await saveRouteScreenshot(page, testInfo, "matrix_afterhours_tif_locked");
  });

  test("市價 order type forces TIF off ROD (IOC/FOK only)", async ({ page }, testInfo) => {
    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);

    await expect(frame.locator("#t-tif button.on")).toHaveText("ROD");
    await frame.locator("#t-otype").selectOption("market");

    await expect(frame.locator('#t-tif [data-tif="rod"]')).toBeDisabled();
    await expect(frame.locator("#t-tif button.on")).not.toHaveText("ROD");
    await expect(frame.locator("#t-price-hint")).toHaveText("市價單以當前最佳價成交");

    await saveRouteScreenshot(page, testInfo, "matrix_market_order_tif_locked");
  });

  test("illegal tick price greys out submit with a Chinese reason, legal tick clears it", async ({ page }, testInfo) => {
    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);

    await frame.locator("#t-qty").fill("1");
    // 100-500 tier tick = 0.5; 123.37 is off-grid.
    await frame.locator("#t-price").fill("123.37");
    await expect(frame.locator("#submit-btn")).toBeDisabled({ timeout: 5000 });
    const gateTextBad = await frame.locator(".gate .h .v").innerText();
    expect(gateTextBad).toContain("升降單位");
    await saveRouteScreenshot(page, testInfo, "matrix_illegal_tick_blocked");

    // On-grid price in the same tier clears the tick violation (may still be
    // blocked by off-hours 交易時段 once actually submitted, but the client-
    // side matrix gate itself must release).
    await frame.locator("#t-price").fill("123.50");
    await page.waitForTimeout(300);
    const gateTextGood = await frame.locator(".gate .h .v").innerText();
    expect(gateTextGood).not.toContain("升降單位");
    await saveRouteScreenshot(page, testInfo, "matrix_legal_tick_cleared");
  });

  test("legal ticket submits via /api/v1/trading/orders with orderCond/session/timeInForce in the payload", async ({ page }, testInfo) => {
    const bodies: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("path=%2Fapi%2Fv1%2Ftrading%2Forders")) {
        bodies.push(req.postData() || "");
      }
    });

    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);

    // Market order sidesteps tick/漲跌停 checks (client-side matrix only
    // applies those to limit orders) so this test stays focused on proving
    // orderCond/session/timeInForce round-trip through the payload, not on
    // a live quote's actual price band.
    await frame.locator("#t-otype").selectOption("market");
    await frame.locator('#t-session [data-session="intraday_odd"]').click();
    await frame.locator('#t-tif [data-tif="ioc"]').click();
    await frame.locator("#t-qty").fill("5");

    await saveRouteScreenshot(page, testInfo, "matrix_legal_combo_before_submit");
    await frame.locator("#submit-btn").click();
    await page.waitForTimeout(2500);
    await saveRouteScreenshot(page, testInfo, "matrix_legal_combo_after_submit");

    expect(bodies.length, `expected a POST to /api/v1/trading/orders, saw none`).toBeGreaterThan(0);
    const parsed = JSON.parse(bodies[bodies.length - 1]);
    expect(parsed.session).toBe("intraday_odd");
    expect(parsed.orderCond).toBe("cash");
    expect(parsed.timeInForce).toBe("ioc");
    expect(parsed.quantity_unit).toBe("SHARE");

    // Off-hours -> risk-blocked with the Chinese 交易時段 guard label, never a
    // raw backend string (same convention as jim_pr3_unified_order_20260709).
    const gateText = await frame.locator(".gate .h .v").innerText();
    expect(gateText).not.toMatch(/Blocked by|trading_hours|Error:|TypeError|undefined/);
  });

  test("KGI SIM button greys out with an honest message once orderCond leaves 現股 (T-2 pending)", async ({ page }, testInfo) => {
    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#broker-strip .bbtn[data-broker='kgi']").waitFor({ state: "visible", timeout: 20000 });
    await frame.locator("#broker-strip .bbtn[data-broker='kgi']").click();
    await frame.locator("#submit-kgi-sim-btn").waitFor({ state: "visible", timeout: 10000 });
    await waitForCapitalReady(frame);

    await frame.locator("#t-qty").fill("1");
    await frame.locator("#t-price").fill("10");
    await page.waitForTimeout(300);
    await expect(frame.locator("#submit-kgi-sim-btn")).toBeEnabled();

    await frame.locator('#t-cond [data-cond="margin"]').click();
    await page.waitForTimeout(300);
    await expect(frame.locator("#submit-kgi-sim-btn")).toBeDisabled();
    const label = await frame.locator("#submit-kgi-sim-label").innerText();
    expect(label).toContain("融資");
    expect(label).not.toMatch(/undefined|null|NaN/);

    await saveRouteScreenshot(page, testInfo, "matrix_kgi_sim_blocked_non_cash");
  });
});
