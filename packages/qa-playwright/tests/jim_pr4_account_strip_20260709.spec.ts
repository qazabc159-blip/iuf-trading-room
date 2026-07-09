import { test, expect } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// PR-4 (統一下單流 D6 帳號帶): broker strip -> account strip verification.
// Real browser, real prod backend (local dev serving the branch code).

async function waitForCapitalReady(frame: ReturnType<typeof extractFrame>) {
  await expect(frame.locator("#summary-avail")).not.toHaveText("--", { timeout: 20000 });
}

test.describe("unified order flow PR-4 (account strip)", () => {
  test("broker strip shows gatewayStatus badges sourced from /uta/accounts", async ({ page }, testInfo) => {
    const accountsCalls: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "GET" && req.url().includes("path=%2Fapi%2Fv1%2Futa%2Faccounts")) {
        accountsCalls.push(req.url());
      }
    });

    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#broker-strip").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);
    await page.waitForTimeout(500);

    expect(accountsCalls.length, "expected GET /api/v1/uta/accounts to be called").toBeGreaterThan(0);

    // Badge elements should exist on both selectable buttons (paper, kgi).
    const paperBadge = frame.locator('.bbtn[data-broker="paper"] .bstat');
    const kgiBadge = frame.locator('.bbtn[data-broker="kgi"] .bstat');
    await expect(paperBadge).toBeVisible({ timeout: 10000 });
    await expect(kgiBadge).toBeVisible({ timeout: 10000 });

    const paperBadgeText = await paperBadge.innerText();
    const kgiBadgeText = await kgiBadge.innerText();
    // Real prod data — no gateway pairing agent connected in this session, so
    // both should legitimately read the "unpaired" 未配對 state. Assert it's
    // one of the four known Chinese labels either way (not a raw code).
    const knownLabels = ["已連線", "等待配對", "等待連線", "未配對"];
    expect(knownLabels).toContain(paperBadgeText);
    expect(knownLabels).toContain(kgiBadgeText);

    // Fubon stays disabled and never gets a badge.
    const fubonBtn = frame.locator('.bbtn[data-broker="fubon"]');
    await expect(fubonBtn).toBeDisabled();
    await expect(fubonBtn.locator(".bstat")).toHaveCount(0);

    await saveRouteScreenshot(page, testInfo, "pr4_account_strip_badges");
  });

  test("switching active broker routes the submit payload accountId to the matching account", async ({ page }, testInfo) => {
    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#broker-strip").waitFor({ state: "visible", timeout: 20000 });
    await waitForCapitalReady(frame);

    const orderPosts: string[] = [];
    const orderBodies: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("path=%2Fapi%2Fv1%2Ftrading%2Forders")) {
        orderPosts.push(req.url());
        orderBodies.push(req.postData() || "");
      }
    });

    // Switch to KGI and submit — off-hours, so this will risk-block (422),
    // but the request body is what we're checking, not the outcome.
    await frame.locator("#broker-strip .bbtn[data-broker='kgi']").click();
    await frame.locator("#submit-kgi-sim-btn").waitFor({ state: "visible", timeout: 10000 });
    await frame.locator("#t-qty").fill("1");
    await frame.locator("#t-price").fill("10");
    await frame.locator("#submit-kgi-sim-btn").click();
    await page.waitForTimeout(2500);

    expect(orderPosts.length, "expected a POST to /api/v1/trading/orders after KGI submit").toBeGreaterThan(0);
    const kgiPayload = JSON.parse(orderBodies[orderBodies.length - 1] || "{}");
    expect(kgiPayload.accountId, "kgi submit must carry a non-empty accountId").toBeTruthy();

    await saveRouteScreenshot(page, testInfo, "pr4_account_routed_kgi");

    // Switch back to paper and submit again — accountId should differ.
    orderPosts.length = 0;
    orderBodies.length = 0;
    await frame.locator("#broker-strip .bbtn[data-broker='paper']").click();
    await frame.locator("#submit-btn").waitFor({ state: "visible", timeout: 10000 });
    await frame.locator("#submit-btn").click();
    await page.waitForTimeout(2500);

    expect(orderPosts.length, "expected a POST to /api/v1/trading/orders after paper submit").toBeGreaterThan(0);
    const paperPayload = JSON.parse(orderBodies[orderBodies.length - 1] || "{}");
    expect(paperPayload.accountId, "paper submit must carry a non-empty accountId").toBeTruthy();
    expect(paperPayload.accountId).not.toBe(kgiPayload.accountId);

    await saveRouteScreenshot(page, testInfo, "pr4_account_routed_paper");
  });

  test("fubon stays disabled with 即將開放 copy, never selectable", async ({ page }) => {
    await page.goto("/portfolio");
    const frame = extractFrame(page);
    await frame.locator("#broker-strip").waitFor({ state: "visible", timeout: 20000 });
    const fubonBtn = frame.locator('.bbtn[data-broker="fubon"]');
    await expect(fubonBtn).toBeDisabled();
    await expect(fubonBtn).toContainText("即將開放");
  });
});
