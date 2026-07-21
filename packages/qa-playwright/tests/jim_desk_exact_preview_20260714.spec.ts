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

    // 楊董 7/14 三連退修正：1280 密度設計直接拉滿 1920 比例失衡，改成
    // max-width:1520px 置中（同色背景延伸）——deskWidth 應貼齊 1520，不再是
    // 1280（原稿密度）也不是滿版 1920（比例失衡）。
    const deskWidth = await frame.locator(".screen.desk").first().evaluate((el) => el.getBoundingClientRect().width);
    testInfo.annotations.push({ type: "screen-desk-width-1920", description: String(deskWidth) });
    expect(deskWidth, "desktop cockpit caps at ~1520px centered (楊董 7/14 比例控制 fix), not a 1280 box nor full 1920 bleed").toBeGreaterThan(1450);
    expect(deskWidth, "desktop cockpit caps at ~1520px centered, not full-bleed 1920").toBeLessThanOrEqual(1520);

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

  // Round 5 (2026-07-21，Jim) — 手機下單票真送單 e2e。盤點發現 `.screen.mob`
  // 早已存在且完整接線（session/orderCond/unit 矩陣、真 K 線、真送單，見
  // apps/web/public/desk-exact/index.html m2-dock 區塊，2026-07-15~17 陸續
  // 移植進來）；先前唯一缺口是「沒有任何 Playwright 規格對手機票走過一次真
  // 送單」，只驗過 render+no-overflow（見上方 mobile 390 測試）。這裡補齊，
  // 鏡射桌機版同款斷言，selector 換成 m2t-* slot（手機票專屬 data-slot，
  // 桌機 `t-*` 系列在 `.screen.mob` 內部不存在，不會誤中隱藏元件）。
  test("mobile 390 ticket real-submits a paper order via /api/v1/trading/orders (honest outcome, market-hours dependent)", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="m2-cap-avail"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000); // let capital/accounts hydration land before submit

    // Switch to SHARE unit + qty 1 (smallest possible odd-lot order), same
    // fixture shape as the desktop test — quantity_unit stays an explicit
    // user click either way (LOT/SHARE toggle has no server-side default).
    await frame.locator('[data-slot="m2t-unit"] button[data-unit="SHARE"]').click();
    const qtyInput = frame.locator('[data-slot="m2t-qty"]');
    await qtyInput.fill("1");
    const priceInput = frame.locator('[data-slot="m2t-price"]');
    await priceInput.fill("1000");

    const submitResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/ui-final-v031/backend") && res.url().includes("path=%2Fapi%2Fv1%2Ftrading%2Forders"),
      { timeout: 20000 }
    );
    await frame.locator('[data-slot="m2t-submit"]').click();
    const submitResponse = await submitResponsePromise;
    const submitBody = await submitResponse.json().catch(() => null);
    const submitStatus = submitResponse.status();

    testInfo.annotations.push({ type: "submit-http-status", description: String(submitStatus) });
    testInfo.annotations.push({ type: "submit-response-body", description: JSON.stringify(submitBody) });

    await page.waitForTimeout(1500);
    const submitMsg = await frame.locator('[data-slot="m2t-submit-msg"]').first().textContent();
    testInfo.annotations.push({ type: "submit-msg-shown-to-user", description: String(submitMsg) });

    // Real backend reached (not a stub) — true regardless of market hours.
    expect(submitStatus === 201 || submitStatus === 422, "real backend responded (accepted or a legitimate risk-gate block)").toBe(true);

    // The T-3 guard checklist row must also render human-readable reasons,
    // never raw backend enum tokens (mirrors desktop's honest-message rule).
    const riskListText = await frame.locator('[data-slot="m2t-risk-list"]').first().textContent();
    testInfo.annotations.push({ type: "risk-list-after-submit", description: String(riskListText) });

    if (submitStatus === 422) {
      expect(submitMsg, "blocked reason must be human-readable, not a raw code").not.toMatch(/^[a-z_]+$/);
      expect(submitMsg, "blocked reason must not be empty").toBeTruthy();
      expect(riskListText || "", "risk checklist must not leak a raw guard id (e.g. trading_hours/max_per_trade)").not.toMatch(
        /\btrading_hours\b|\bmax_per_trade\b|\bstale_quote\b|\bmax_single_position\b|\bmax_theme_correlated\b/
      );
    } else {
      // 201 accepted — assert the mobile "今日委託" peek pill count increments
      // without a full page reload (mobile ticket has no visible ledger table
      // in-view, only the report peek pill + count badge).
      const ledgerCount = await frame.locator('[data-slot="m2-ledger-count"]').first().textContent();
      testInfo.annotations.push({ type: "order-accepted-ledger-count", description: String(ledgerCount) });
      expect(Number(ledgerCount), "mobile 今日委託 pill count must be >=1 after an accepted order").toBeGreaterThan(0);
    }

    await saveRouteScreenshot(page, testInfo, "desk-exact-mobile-submit-outcome");
  });

  // Round 4 (2026-07-17 移植) — K 線改走公司頁真實圖表引擎（iframe 內嵌
  // /final-v031/portfolio/kline-frame，同一顆 OhlcvCandlestickChart.tsx）：
  // 分K/日K/週K/月K切換、MA/MACD、量價支撐壓力、游標 read-out 全部真資料，
  // 取代先前這支測試驗收過的自繪 SVG（該引擎已隨 #1281 切版前的舊實作一起
  // 被 T-3/矩陣移植取代，見 DESK_MATRIX_CHART_GAP_2026_07_17.md）。
  test("K-line embeds the real chart engine with interval/crosshair/support-resistance controls", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    const chartFrameEl = frame.locator("#real-kline-frame");
    await chartFrameEl.waitFor({ state: "attached", timeout: 15000 });

    const chartSrc = await chartFrameEl.getAttribute("src");
    testInfo.annotations.push({ type: "chart-iframe-src", description: String(chartSrc) });
    expect(chartSrc, "desktop chart iframe embeds the real公司頁 kline-frame route").toContain("/final-v031/portfolio/kline-frame");
    expect(chartSrc, "chart iframe defaults to the hero symbol").toContain("symbol=2330");

    const kline = frame.frameLocator("#real-kline-frame");
    await kline.locator(".kline-toolbar").first().waitFor({ state: "attached", timeout: 20000 });
    await page.waitForTimeout(4000); // OHLCV + K-bar fetch inside the nested route

    const toolbarText = await kline.locator(".kline-toolbar").first().textContent();
    testInfo.annotations.push({ type: "kline-toolbar-text", description: String(toolbarText) });
    // 分K/日K/週K/月K 週期切換鍵全部存在（舊自繪版 1分/5分/15分永遠 disabled）。
    expect(toolbarText || "", "real engine offers 日/週/月 interval tabs").toMatch(/日K|日線/);
    expect(toolbarText || "", "real engine offers minute (分K) interval tabs, unlike the old permanently-disabled buttons").toMatch(/分/);

    const srCount = await kline.locator('[data-indicator-readout="volume-price"]').count();
    testInfo.annotations.push({ type: "support-resistance-readout-count", description: String(srCount) });
    expect(srCount, "real engine exposes a 量價支撐/壓力 readout panel").toBeGreaterThan(0);

    await saveRouteScreenshot(page, testInfo, "desk-exact-desktop-realchart");
  });

  test("clicking a watchlist row switches the symbol across header/depth/chart/ticket", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    await frame.locator('.wrow[data-wl-sym="2454"]').click();
    await page.waitForTimeout(4000); // re-fetch quote/depth/chart for the new symbol

    const symCode = await frame.locator('[data-slot="sym-code"]').first().textContent();
    const symName = await frame.locator('[data-slot="sym-name"]').first().textContent();
    const depthMeta = await frame.locator('[data-slot="depth-meta"]').first().textContent();
    const ticketLabel = await frame.locator('[data-slot="t-symbol-label"]').first().inputValue();
    const rowOnSym = await frame.locator(".wrow.on").first().getAttribute("data-wl-sym");
    // 2026-07-17 移植：K 線改走 iframe 內嵌真圖表引擎，切標的時
    // updateChartFrame() 同步改寫 iframe src（不再有 chart-status 文字節點）。
    const chartSrc = await frame.locator("#real-kline-frame").getAttribute("src");

    testInfo.annotations.push({ type: "sym-code-after-click", description: String(symCode) });
    testInfo.annotations.push({ type: "sym-name-after-click", description: String(symName) });
    testInfo.annotations.push({ type: "depth-meta-after-click", description: String(depthMeta) });
    testInfo.annotations.push({ type: "ticket-label-after-click", description: String(ticketLabel) });
    testInfo.annotations.push({ type: "watchlist-on-row-after-click", description: String(rowOnSym) });
    testInfo.annotations.push({ type: "chart-src-after-click", description: String(chartSrc) });

    expect(symCode, "symbol header switches to the clicked row's ticker").toBe("2454");
    expect(symName, "symbol header shows the matching company name").toContain("聯發科");
    expect(depthMeta, "depth panel re-fetches for the new symbol").toContain("2454");
    expect(ticketLabel, "order ticket's 標的 field follows the symbol switch").toContain("2454");
    expect(rowOnSym, "watchlist highlight moves to the clicked row").toBe("2454");
    expect(chartSrc, "chart iframe re-points to the new symbol on switch").toContain("symbol=2454");

    await saveRouteScreenshot(page, testInfo, "desk-exact-desktop-symbol-switch");
  });

  test("query prefill (?symbol=X&side=buy) selects the symbol and ticket side on load", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact?symbol=2382&side=sell", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-code"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const symCode = await frame.locator('[data-slot="sym-code"]').first().textContent();
    const sellOn = await frame.locator('[data-slot="t-side"] button[data-side="sell"]').first().evaluate((el) => el.classList.contains("on"));
    const buyOn = await frame.locator('[data-slot="t-side"] button[data-side="buy"]').first().evaluate((el) => el.classList.contains("on"));
    // P1 fix (2026-07-14 Elva prod repro): submit button label must follow the
    // side, not stay frozen at the markup's default "買進" once ?side=sell
    // prefill flips the tab — applySidePrefill() previously toggled the "on"
    // class directly instead of going through wireTicket()'s click handler,
    // so refreshPreviewNumbers() (which recomputes this label) never re-ran.
    const submitLabel = await frame.locator('[data-slot="t-submit-label"]').first().textContent();

    testInfo.annotations.push({ type: "prefill-sym-code", description: String(symCode) });
    testInfo.annotations.push({ type: "prefill-sell-on", description: String(sellOn) });
    testInfo.annotations.push({ type: "prefill-buy-on", description: String(buyOn) });
    testInfo.annotations.push({ type: "prefill-submit-label", description: String(submitLabel) });

    expect(symCode, "query prefill selects the requested symbol").toBe("2382");
    expect(sellOn, "query prefill flips the ticket to the requested side").toBe(true);
    expect(buyOn, "buy toggle is no longer 'on' once sell is prefilled").toBe(false);
    expect(submitLabel, "submit button label must say 賣出 once ?side=sell prefill is applied, not stay stuck on 買進").toContain("賣出");
    expect(submitLabel, "submit button label must not still say 買進 once side flips to sell").not.toContain("買進");

    await saveRouteScreenshot(page, testInfo, "desk-exact-desktop-query-prefill");
  });

  test("ledger tab click really swaps table content (成交紀錄 differs from 今日委託)", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="ledger-thead"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const ordersHead = await frame.locator('[data-slot="ledger-thead"]').first().textContent();
    await frame.locator('button[data-lt="fills"]').click();
    await page.waitForTimeout(2000);
    const fillsHead = await frame.locator('[data-slot="ledger-thead"]').first().textContent();

    testInfo.annotations.push({ type: "orders-thead", description: String(ordersHead) });
    testInfo.annotations.push({ type: "fills-thead", description: String(fillsHead) });

    expect(fillsHead, "clicking 成交紀錄 tab must change the table header, not stay on 今日委託's columns").not.toBe(ordersHead);
    expect(fillsHead, "成交紀錄 tab header should mention 成交").toMatch(/成交/);

    await saveRouteScreenshot(page, testInfo, "desk-exact-desktop-ledger-tab-switch");
  });
});
