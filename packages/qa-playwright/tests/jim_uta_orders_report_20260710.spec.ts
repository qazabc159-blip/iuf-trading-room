import { expect, test } from "@playwright/test";
import { expectNoServerError, saveRouteScreenshot } from "./helpers";

// 委託回報面板 (PR-A, 2026-07-10) — real-browser frameLocator verification
// against the new GET /api/v1/uta/orders panel. Not part of the standing P0
// smoke suite yet (unmerged branch); run manually with
// IUF_QA_WEB_BASE_URL=http://localhost:3000 pointed at this branch's dev
// server, IUF_QA_API_BASE_URL=https://api.eycvector.com (real prod data).

test("交易室 委託回報 tab renders honest state against live GET /uta/orders @jim-uta-orders", async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  await page.goto("/api/ui-final-v031/paper-trading-room?symbol=2330&rev=jim-uta-orders-verify", {
    waitUntil: "domcontentloaded",
  });
  await expectNoServerError(page);
  await expect(page.locator(".troom")).toBeVisible({ timeout: 30_000 });

  const tabButton = page.locator('.lhead .tb[data-lt="uta-orders"]');
  await expect(tabButton, "委託回報 tab button must be present").toBeVisible({ timeout: 15_000 });
  await expect(tabButton).toContainText("委託回報");

  // Wait for the client 15s refresh cycle's first pass (fastShell → real data)
  // to replace the SSR loading placeholder.
  const panel = page.locator('.ltab[data-lt="uta-orders"]');
  await expect(panel.locator("#uta-orders-body")).not.toContainText("委託回報載入中", { timeout: 30_000 });

  await tabButton.click();
  await expect(panel).toBeVisible({ timeout: 5_000 });

  const bodyText = await panel.locator("#uta-orders-body").innerText();
  // Either an honest empty state, or real rows with the four-state vocab —
  // never the raw backend enum leaking through.
  const isHonestEmpty = bodyText.includes("今日無委託");
  const hasRealRows = /待送出|已受理|部分成交|已成交|已撤單|已拒絕/.test(bodyText);
  expect(isHonestEmpty || hasRealRows, `#uta-orders-body must show honest empty state or four-state labels, got: ${bodyText}`).toBe(true);
  expect(bodyText).not.toMatch(/\bpending\b|\bsubmitted\b|\bpartial_fill\b|\bfilled\b|\bcancelled\b|\brejected\b/);

  await saveRouteScreenshot(page, testInfo, "trading-room-uta-orders-report");
});
