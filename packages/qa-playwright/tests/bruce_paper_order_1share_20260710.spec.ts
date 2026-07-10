import { expect, test } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

/**
 * Bruce — 7/10 盤中補驗 item 2: paper channel 盤中送單完整畫面
 *
 * Task asked for "小額如 2330 零股 1 股" specifically (not the 1-lot default
 * the ticket starts with, which trips 單筆風控上限/單一部位上限 caps on 2330's
 * ~2400 price — 1 lot notional ~2.4M). Drives the real UI: switch unit to 股
 * (share), set qty to 1, then a real click on #submit-btn, and records
 * whatever the ticket surfaces (label + gate text + network round-trip to
 * /api/v1/trading/orders or /api/v1/paper/preview).
 */

const DESKTOP_PROJECT = "desktop-chromium";

test("bruce-reverify: paper channel 2330 odd-lot 1-share order — intraday full flow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `Runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(60_000);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/portfolio");
  const frame = extractFrame(page);
  const submitBtn = frame.locator("#submit-btn");
  await submitBtn.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2000); // let hydratePaper() settle capitalReady + selected

  // Switch unit to 股 (share) and set quantity to 1 — matches task's odd-lot spec.
  const shareUnitBtn = frame.locator('#t-unit button[data-unit="share"]');
  await shareUnitBtn.click({ timeout: 8000 });
  const qtyInput = frame.locator("#t-qty");
  await qtyInput.fill("1");
  await qtyInput.dispatchEvent("input");
  await page.waitForTimeout(500);

  await saveRouteScreenshot(page, testInfo, "bruce_paper_1share_before_submit");

  const networkResponses: { url: string; status: number; body?: string }[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("/api/v1/trading/orders") || res.url().includes("/api/v1/paper/preview")) {
      let body: string | undefined;
      try {
        body = await res.text();
      } catch {
        body = undefined;
      }
      networkResponses.push({ url: res.url(), status: res.status(), body });
    }
  });

  await submitBtn.click({ timeout: 8000 });
  await page.waitForTimeout(4000); // preview + submit round-trip

  const labelText = await frame.locator("#submit-btn-label, #submit-btn b").first().textContent().catch(() => null);
  const gateText = await frame.locator(".gate .h .v").first().textContent().catch(() => null);
  const notionalText = await frame.locator("#p-notional").first().textContent().catch(() => null);

  await saveRouteScreenshot(page, testInfo, "bruce_paper_1share_after_submit");

  testInfo.attach("paper-1share-order-trace", {
    body: JSON.stringify({ networkResponses, labelText, gateText, notionalText }, null, 2),
    contentType: "application/json",
  });

  // Hard requirement regardless of accept/block outcome: whatever the ticket
  // shows must not be a raw JS error / stack trace / English enum leak.
  const combinedText = `${labelText ?? ""} ${gateText ?? ""}`;
  expect(
    /Error|undefined|NaN|\[object|TypeError|at Object\.|stack trace/i.test(combinedText),
    `order flow surfaced a raw/non-product error string: "${combinedText}"`,
  ).toBeFalsy();
  expect(combinedText.trim().length, "order flow ticket area should show some product-grade status text").toBeGreaterThan(0);
});
