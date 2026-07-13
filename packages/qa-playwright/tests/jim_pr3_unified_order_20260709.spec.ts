import { test, expect } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// PR-3 (統一下單流): iframe 雙 handler 合一 verification.
// Real browser, real prod backend (local dev serving the branch code,
// same-origin proxy at /api/ui-final-v031/backend hitting prod API).
// Verifies: single submit endpoint (/api/v1/trading/orders) is actually
// called by both the paper and KGI SIM buttons, SIM submit stays one-click
// (no new confirmation step), and error text is product-grade Chinese (no
// raw backend message).
//
// Note: this verification runs off-hours (outside 09:00-13:30 Asia/Taipei),
// so every real submit is legitimately risk-blocked with a 422
// (guard: trading_hours) — that's correct server behavior, not a defect.
// This gives a real, live blocked-response scenario to verify the D5
// reason-code vocab against, in place of a full accepted-order screenshot
// (which requires trading hours to produce).
//
// 台股下單能力矩陣 T-3 (2026-07-13) follow-up: this test used to type a
// hardcoded limit price of "10" — with the client-side matrix gating added
// in T-3 (mirrors order-rules.ts §4.3/§4.4 tick/漲跌停), a limit price of 10
// for 2330 (trading around 2,400+) is correctly flagged as outside the ±10%
// band and greys out the submit button before any network call, which broke
// this test's original intent (verify routing + Chinese error text, not
// price mechanics). Fix: stop overwriting #t-price — wait for hydration to
// auto-populate it from the live quote (waitForTicketReady below) and use
// that value, which is guaranteed tick/band-legal since it *is* the refPrice
// the matrix checks against. Also dropped the SHARE-unit toggle (kept the
// default LOT): T-3's §4.6 quantity rule requires regular-session orders to
// be whole lots, so qty=1 SHARE is now a genuine matrix violation (1 share
// is not a multiple of 1,000) unrelated to what this test verifies.
//
// Verified this fix is desktop-chromium-clean; mobile-iphone-13 has a
// pre-existing flake on this spec unrelated to T-3 — reproduced against a
// clean (pre-T-3) origin/main build with both the original hardcoded-price
// version and this fixed version, so it is not a regression introduced
// here. Not chased further: T-3 (and this whole vendor ticket) is a
// desktop-only surface per the 2026-07-13 桌面重排 decision.

async function waitForCapitalReady(frame: ReturnType<typeof extractFrame>) {
  // capitalReady flips true asynchronously after refreshClientLive()'s first
  // fetch resolves — the submit-btn click handler no-ops while it's false, so
  // interacting before this is ready silently swallows the click.
  await expect(frame.locator("#summary-avail")).not.toHaveText("--", { timeout: 20000 });
}

async function waitForTicketReady(frame: ReturnType<typeof extractFrame>) {
  await waitForCapitalReady(frame);
  // Same hydration pass that fills #summary-avail also auto-fills #t-price
  // from the live/last-good quote — wait for it instead of typing a
  // hardcoded value so the price always satisfies the T-3 tick/漲跌停 gate.
  await expect(frame.locator("#t-price")).not.toHaveValue("", { timeout: 20000 });
}

test.describe("unified order flow PR-3", () => {
  test("paper ticket submits via the unified endpoint and shows the Chinese trading-hours block, not raw text", async ({ page }, testInfo) => {
    const calls: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/ui-final-v031/backend")) {
        calls.push(req.url());
      }
    });

    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForTicketReady(frame);

    // Fill a valid limit ticket — #t-price is left as the hydration-filled
    // live quote value (see file-header note). Unit stays the default LOT.
    await frame.locator("#t-qty").fill("1");

    await saveRouteScreenshot(page, testInfo, "pr3_before_submit_paper");

    await frame.locator("#submit-btn").click();
    await page.waitForTimeout(2500);

    await saveRouteScreenshot(page, testInfo, "pr3_after_submit_paper");

    const unifiedCalls = calls.filter((u) => u.includes("path=%2Fapi%2Fv1%2Ftrading%2Forders"));
    const legacyCalls = calls.filter((u) => u.includes("kgi%2Fsim%2Forder"));
    expect(unifiedCalls.length, `expected a POST to /api/v1/trading/orders, saw: ${JSON.stringify(calls)}`).toBeGreaterThan(0);
    expect(legacyCalls.length).toBe(0);

    // Off-hours -> risk-blocked. Gate text must be the Chinese guard label
    // (交易時段), never the backend's raw "Blocked by trading_hours." summary.
    const gateText = await frame.locator(".gate .h .v").innerText();
    expect(gateText).not.toMatch(/Blocked by|trading_hours|Error:|TypeError|undefined/);
    expect(gateText).toContain("交易時段");
  });

  test("KGI SIM ticket submits via the unified endpoint and shows product-grade text", async ({ page }, testInfo) => {
    const calls: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/ui-final-v031/backend")) {
        calls.push(req.url());
      }
    });

    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#broker-strip .bbtn[data-broker='kgi']").waitFor({ state: "visible", timeout: 20000 });
    await frame.locator("#broker-strip .bbtn[data-broker='kgi']").click();
    await frame.locator("#submit-kgi-sim-btn").waitFor({ state: "visible", timeout: 10000 });
    await waitForTicketReady(frame);

    // Fill a valid limit ticket — #t-price is left as the hydration-filled
    // live quote value; unit stays the default LOT (see paper-ticket test's
    // comment above for why).
    await frame.locator("#t-qty").fill("1");

    await saveRouteScreenshot(page, testInfo, "pr3_before_submit_kgi");

    await frame.locator("#submit-kgi-sim-btn").click();
    await page.waitForTimeout(4000);

    await saveRouteScreenshot(page, testInfo, "pr3_after_submit_kgi");

    const unifiedCalls = calls.filter((u) => u.includes("path=%2Fapi%2Fv1%2Ftrading%2Forders"));
    const legacyCalls = calls.filter((u) => u.includes("kgi%2Fsim%2Forder"));
    expect(unifiedCalls.length, `expected a POST to /api/v1/trading/orders, saw: ${JSON.stringify(calls)}`).toBeGreaterThan(0);
    expect(legacyCalls.length).toBe(0);

    // Gate text must be product-grade Chinese, never a raw backend message
    // (engineering identifiers/summary strings, backend error codes).
    const gateText = await frame.locator(".gate .h .v").innerText();
    expect(gateText).not.toMatch(/Blocked by|trading_hours|kgi_channel_unavailable|Error:|TypeError|undefined/);
    expect(gateText).toContain("交易時段");
  });

  test("invalid ticket still blocks locally with no network call (unchanged behavior)", async ({ page }, testInfo) => {
    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);
    await frame.locator("#t-qty").fill("0");
    // Client-side live validation disables the button on invalid input before
    // any click — assert the blocked state directly instead of clicking a
    // disabled element (which would hang on actionability checks).
    await expect(frame.locator("#submit-btn")).toBeDisabled({ timeout: 5000 });
    await saveRouteScreenshot(page, testInfo, "pr3_invalid_ticket_blocked");
  });
});
