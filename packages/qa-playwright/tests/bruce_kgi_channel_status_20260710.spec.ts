import { expect, test } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

/**
 * Bruce — 7/10 盤中補驗 item 3: kgi channel 現況誠實記錄
 *
 * KGI UTA 帳號 gatewayStatus=unpaired (confirmed via GET /api/v1/uta/accounts
 * at verify time). This spec drives the real UI: switch broker strip to KGI,
 * set a small odd-lot order (2330 x1 股), click submit, and records whatever
 * Chinese message the ticket surfaces. Does NOT require an accepted outcome —
 * F-AUTO's EC2 gateway is a separate lane, not touched here.
 */

const DESKTOP_PROJECT = "desktop-chromium";

test("bruce-reverify: KGI channel broker-strip select + submit — intraday message shape", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `Runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(60_000);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/portfolio");
  const frame = extractFrame(page);
  const kgiBtn = frame.locator('#broker-strip .bbtn[data-broker="kgi"]');
  await kgiBtn.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(4000); // let the first refreshClientLive() cycle fully settle capitalReady

  const badgeTextBefore = await kgiBtn.textContent().catch(() => null);

  await kgiBtn.click({ timeout: 8000 });
  await page.waitForTimeout(3000); // applyBrokerSubmitVisibility() swaps #submit-btn -> #submit-kgi-sim-btn

  // NOTE: when broker=kgi is active, final-v031-live.ts's applyBrokerSubmitVisibility()
  // hides #submit-btn (paper) and reveals #submit-kgi-sim-btn — that is the real
  // actionable button for this channel, not #submit-btn.
  const kgiSubmitBtn = frame.locator("#submit-kgi-sim-btn");
  await kgiSubmitBtn.waitFor({ state: "visible", timeout: 10000 });

  const shareUnitBtn = frame.locator('#t-unit button[data-unit="share"]');
  await shareUnitBtn.click({ timeout: 8000 }).catch(() => null);
  const qtyInput = frame.locator("#t-qty");
  await qtyInput.fill("1").catch(() => null);
  await qtyInput.dispatchEvent("input").catch(() => null);
  await page.waitForTimeout(500);

  await saveRouteScreenshot(page, testInfo, "bruce_kgi_channel_before_submit");

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

  await kgiSubmitBtn.click({ timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(9000); // full preview -> loadBrokerAccounts -> submitUnifiedOrder round trip

  const labelText = await frame.locator("#submit-kgi-sim-label").first().textContent().catch(() => null);
  const gateText = await frame.locator(".gate .h .v").first().textContent().catch(() => null);

  await saveRouteScreenshot(page, testInfo, "bruce_kgi_channel_after_submit");

  testInfo.attach("kgi-channel-trace", {
    body: JSON.stringify({ badgeTextBefore, networkResponses, labelText, gateText }, null, 2),
    contentType: "application/json",
  });

  const combinedText = `${labelText ?? ""} ${gateText ?? ""}`;
  expect(
    /Error|undefined|NaN|\[object|TypeError|at Object\.|stack trace/i.test(combinedText),
    `KGI channel surfaced a raw/non-product error string: "${combinedText}"`,
  ).toBeFalsy();
});
