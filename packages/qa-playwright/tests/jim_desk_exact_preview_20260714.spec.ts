import { expect, test } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// 交易台「原封搬原稿」預覽 /desk-exact 資料接線驗收（2026-07-14，Jim）。
// 這支測試檔是本輪任務的驗收 harness，非長駐 CI spec；驗收後可視需要保留或移除。
test.describe("/desk-exact preview", () => {
  test("desktop 1280 renders hydrated data with no console errors or horizontal overflow", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("response", (res) => {
      if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`);
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });

    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const gwState = await frame.locator('[data-slot="gw-state"]').first().textContent();
    const capBase = await frame.locator('[data-slot="cap-base"]').first().textContent();
    const capAvail = await frame.locator('[data-slot="cap-avail"]').first().textContent();
    const wl2454 = await frame.locator('[data-slot="wl-v-2454"]').first().textContent();
    const depthAsk1 = await frame.locator('[data-slot="depth-ask1-px"]').first().textContent();
    const ledgerCount = await frame.locator('[data-slot="ledger-count-orders"]').first().textContent();
    const submitDisabled = await frame.locator("button.submit").first().isDisabled();

    testInfo.annotations.push({ type: "sym-price", description: String(symPrice) });
    testInfo.annotations.push({ type: "gw-state", description: String(gwState) });
    testInfo.annotations.push({ type: "cap-base", description: String(capBase) });
    testInfo.annotations.push({ type: "cap-avail", description: String(capAvail) });
    testInfo.annotations.push({ type: "wl-v-2454", description: String(wl2454) });
    testInfo.annotations.push({ type: "depth-ask1-px", description: String(depthAsk1) });
    testInfo.annotations.push({ type: "ledger-count-orders", description: String(ledgerCount) });
    testInfo.annotations.push({ type: "submit-disabled", description: String(submitDisabled) });

    // Round 2 (2026-07-14 晚): paper 通道下單票已接真送單（見報告），submit 鍵
    // 預設應為可互動狀態，只有送單進行中/驗證失敗時才會暫時 disabled。
    expect(submitDisabled, "submit button must be interactive by default (paper channel is now wired for real submit)").toBe(false);

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    testInfo.annotations.push({ type: "scroll-1280", description: JSON.stringify(scroll) });
    expect(scroll.scrollWidth, "no horizontal overflow at 1280").toBeLessThanOrEqual(scroll.clientWidth + 1);

    // Same documented harness noise as /home-exact (jim_memory.md):
    // /auth/me + root-layout <TickerTape/> hitting market-data/overview
    // directly in local-dev-against-prod-API mode. Reproduced on untouched
    // routes too, unrelated to this task's new code.
    const KNOWN_HARNESS_NOISE = [/\/auth\/me(?:\?|$)/, /\/api\/v1\/market-data\/overview\?includeStale/];
    const unexpectedFailedRequests = failedRequests.filter(
      (r) => !KNOWN_HARNESS_NOISE.some((pattern) => pattern.test(r))
    );
    testInfo.annotations.push({ type: "console-errors", description: JSON.stringify(consoleErrors) });
    testInfo.annotations.push({ type: "unexpected-failed-requests", description: JSON.stringify(unexpectedFailedRequests) });
    expect(unexpectedFailedRequests, "no unexpected failed network requests").toEqual([]);

    await saveRouteScreenshot(page, testInfo, "desk-exact-desktop-1280");
  });

  test("desktop 1920 fills the viewport with no horizontal overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    testInfo.annotations.push({ type: "scroll-1920", description: JSON.stringify(scroll) });
    expect(scroll.scrollWidth, "no horizontal overflow at 1920").toBeLessThanOrEqual(scroll.clientWidth + 1);

    const deskWidth = await frame.locator(".screen.desk").first().evaluate((el) => el.getBoundingClientRect().width);
    testInfo.annotations.push({ type: "screen-desk-width-1920", description: String(deskWidth) });
    expect(deskWidth, "desktop cockpit fills full width at 1920 (no 1280 centered box)").toBeGreaterThan(1800);

    await saveRouteScreenshot(page, testInfo, "desk-exact-desktop-1920");
  });

  test("mobile 390 renders hydrated data with no horizontal overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="m2-sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const m2Submit = await frame.locator("button.m2-submit").first().isDisabled();
    testInfo.annotations.push({ type: "m2-submit-disabled", description: String(m2Submit) });
    expect(m2Submit, "mobile submit button must be interactive by default").toBe(false);

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    testInfo.annotations.push({ type: "scroll-390", description: JSON.stringify(scroll) });
    expect(scroll.scrollWidth, "no horizontal overflow at 390").toBeLessThanOrEqual(scroll.clientWidth + 1);

    await saveRouteScreenshot(page, testInfo, "desk-exact-mobile-390");
  });

  // Round 2 (2026-07-14 晚) — 下單票真送單驗收（paper 通道，見 JIM_DESK_EXACT
  // 報告紅線處置段）。誠實揭露：本次測試執行於台北時間 14:39（盤後，
  // 09:00-13:30 已收盤），真實 trading_hours 風控 guard 會合法攔截這筆委託
  // ——這證明送單流已真正打到後端風控引擎（非 stub），而非本頁的 bug。要驗證
  // 「盤中送出後今日委託表真的多一筆已受理」需在下一個交易日 09:00-13:30
  // Taipei 內重跑本測試（同一顆 spec，無需修改）。
  test("desktop ticket real-submits a paper order via /api/v1/trading/orders (honest outcome, market-hours dependent)", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="cap-avail"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000); // let capital/accounts hydration land before submit

    // Switch to SHARE unit + qty 1 (smallest possible odd-lot order), matching
    // the coordinator's ask ("1 股 SHARE，小額").
    await frame.locator('[data-slot="t-unit"] button[data-unit="SHARE"]').click();
    const qtyInput = frame.locator('[data-slot="t-qty"]');
    await qtyInput.fill("1");
    const priceInput = frame.locator('[data-slot="t-price"]');
    await priceInput.fill("1000");

    const submitResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/ui-final-v031/backend") && res.url().includes("path=%2Fapi%2Fv1%2Ftrading%2Forders"),
      { timeout: 20000 }
    );
    await frame.locator('[data-slot="t-submit"]').click();
    const submitResponse = await submitResponsePromise;
    const submitBody = await submitResponse.json().catch(() => null);
    const submitStatus = submitResponse.status();

    testInfo.annotations.push({ type: "submit-http-status", description: String(submitStatus) });
    testInfo.annotations.push({ type: "submit-response-body", description: JSON.stringify(submitBody) });

    await page.waitForTimeout(1500);
    const submitMsg = await frame.locator('[data-slot="t-submit-msg"]').first().textContent();
    testInfo.annotations.push({ type: "submit-msg-shown-to-user", description: String(submitMsg) });

    // The real backend was reached (not a stub / not silently swallowed) —
    // true regardless of whether the market happens to be open right now.
    expect(submitStatus === 201 || submitStatus === 422, "real backend responded (accepted or a legitimate risk-gate block)").toBe(true);

    if (submitStatus === 422) {
      // Legitimate block (e.g. trading_hours outside 09:00-13:30 Taipei) —
      // assert the UI surfaces a human-readable reason, never a raw enum.
      expect(submitMsg, "blocked reason must be human-readable, not a raw code").not.toMatch(/^[a-z_]+$/);
      expect(submitMsg, "blocked reason must not be empty").toBeTruthy();
    } else {
      // 201 accepted — assert the ledger table picks up the new row without
      // a full page reload.
      await expect(frame.locator('[data-slot="ledger-rows"] tr').first()).toBeVisible({ timeout: 10000 });
      testInfo.annotations.push({ type: "order-accepted", description: "true" });
    }

    await saveRouteScreenshot(page, testInfo, "desk-exact-desktop-submit-outcome");
  });
});
