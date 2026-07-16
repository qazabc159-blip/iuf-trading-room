import { expect, test, type Page, type Route } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

/**
 * /desk-exact P0 雙修復（2026-07-17，Jim-3）驗收：
 * ① 台股下單能力完整矩陣（ROD/IOC/FOK × 現股/融資/融券/當沖 × 整股/零股 ×
 *    限價/市價）真控件，選項真送進 POST /api/v1/trading/orders payload。
 * ② K 線恢復到公司頁真實圖表引擎（分K/日/週/月切換、crosshair readout、
 *    支撐/壓力）。
 *
 * 詳見 reports/sprint_2026_07_17/DESK_MATRIX_CHART_GAP_2026_07_17.md（舊實作
 * vs 現況差異表）。同源代理 mock 慣例沿用
 * jim_desk_exact_quote_fallback_20260716.spec.ts 的 decodeInnerPath()。
 */

const DESKTOP_PROJECT = "desktop-chromium";

function decodeInnerPath(routeUrl: string): { innerPath: string; innerParams: URLSearchParams } {
  const outer = new URL(routeUrl);
  const inner = outer.searchParams.get("path") || "";
  const [innerPath, innerQuery] = inner.split("?");
  return { innerPath: innerPath || "", innerParams: new URLSearchParams(innerQuery || "") };
}

test.describe("/desk-exact order matrix + real chart engine", () => {
  // Same dev-server HMR timing note as jim_desk_exact_quote_fallback_20260716
  // — retries self-heal the rare "one iframe fetch outran page.route()" race.
  test.describe.configure({ retries: 2 });

  test.beforeAll(async () => {
    const base = process.env.IUF_QA_WEB_BASE_URL ?? "http://127.0.0.1:3300";
    await fetch(`${base}/desk-exact`).catch(() => {});
  });

  test("full matrix control set renders on both desktop and mobile tickets", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="t-session"]').first().waitFor({ state: "attached", timeout: 15000 });

    const desktopSessionCount = await frame.locator('[data-slot="t-session"] button').count();
    const desktopCondCount = await frame.locator('[data-slot="t-cond"] button').count();
    const desktopTifCount = await frame.locator('[data-slot="t-tif"] button').count();
    const desktopOtypeOptions = await frame.locator('[data-slot="t-otype"] option').allTextContents();

    testInfo.annotations.push({ type: "desktop-session-count", description: String(desktopSessionCount) });
    testInfo.annotations.push({ type: "desktop-cond-count", description: String(desktopCondCount) });
    testInfo.annotations.push({ type: "desktop-tif-count", description: String(desktopTifCount) });
    testInfo.annotations.push({ type: "desktop-otype-options", description: JSON.stringify(desktopOtypeOptions) });

    expect(desktopSessionCount, "4 session buttons: 整股/盤中零股/盤後零股/盤後定價").toBe(4);
    expect(desktopCondCount, "4 orderCond buttons: 現股/融資/融券/當沖").toBe(4);
    expect(desktopTifCount, "3 TIF buttons: ROD/IOC/FOK").toBe(3);
    expect(desktopOtypeOptions.join(""), "委託類型 select carries both 限價 and 市價").toContain("限價");
    expect(desktopOtypeOptions.join(""), "委託類型 select carries both 限價 and 市價").toContain("市價");

    await page.setViewportSize({ width: 390, height: 900 });
    const mobileSessionCount = await frame.locator('[data-slot="m2t-session"] button').count();
    const mobileCondCount = await frame.locator('[data-slot="m2t-cond"] button').count();
    const mobileTifCount = await frame.locator('[data-slot="m2t-tif"] button').count();
    const mobileOtypeOptions = await frame.locator('[data-slot="m2t-otype"] option').allTextContents();

    testInfo.annotations.push({ type: "mobile-session-count", description: String(mobileSessionCount) });
    testInfo.annotations.push({ type: "mobile-cond-count", description: String(mobileCondCount) });
    testInfo.annotations.push({ type: "mobile-tif-count", description: String(mobileTifCount) });
    testInfo.annotations.push({ type: "mobile-otype-options", description: JSON.stringify(mobileOtypeOptions) });

    expect(mobileSessionCount, "mobile ticket carries the same 4 session buttons").toBe(4);
    expect(mobileCondCount, "mobile ticket carries the same 4 orderCond buttons").toBe(4);
    expect(mobileTifCount, "mobile ticket carries the same 3 TIF buttons").toBe(3);
    expect(mobileOtypeOptions.join(""), "mobile 委託類型 select also carries 市價").toContain("市價");

    await saveRouteScreenshot(page, testInfo, "desk-exact-matrix-controls");
  });

  test("selecting an odd-lot session forces cash/SHARE and forwards real matrix fields to the order payload", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/trading/orders" && route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        testInfo.annotations.push({ type: "captured-order-payload", description: JSON.stringify(body) });
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              order: { id: "mock-order-oddlot-1", status: "acknowledged" },
              riskCheck: { decision: "allow", guards: [] },
              blocked: false,
              quoteGate: { mode: "paper", decision: "allow", blocked: false }
            }
          })
        });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="t-session"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(3000); // let capital/accounts hydration land

    await frame.locator('[data-slot="t-session"] button[data-session="intraday_odd"]').click();

    const condMarginDisabled = await frame.locator('[data-slot="t-cond"] button[data-cond="margin"]').isDisabled();
    const unitLotDisabled = await frame.locator('[data-slot="t-unit"] button[data-unit="LOT"]').isDisabled();
    const unitShareOn = await frame
      .locator('[data-slot="t-unit"] button[data-unit="SHARE"]')
      .evaluate((el) => el.classList.contains("on"));

    testInfo.annotations.push({ type: "cond-margin-disabled-after-oddlot-session", description: String(condMarginDisabled) });
    testInfo.annotations.push({ type: "unit-lot-disabled-after-oddlot-session", description: String(unitLotDisabled) });
    testInfo.annotations.push({ type: "unit-share-auto-selected", description: String(unitShareOn) });

    expect(condMarginDisabled, "融資/融券/當沖 grey out once an odd-lot session is selected (order-rules.ts §4.5)").toBe(true);
    expect(unitLotDisabled, "張(LOT) unit greys out once an odd-lot session is selected").toBe(true);
    expect(unitShareOn, "unit auto-corrects to 股(SHARE) once an odd-lot session is selected").toBe(true);

    await frame.locator('[data-slot="t-qty"]').fill("1");
    await frame.locator('[data-slot="t-price"]').fill("500");

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/ui-final-v031/backend") && res.url().includes("path=%2Fapi%2Fv1%2Ftrading%2Forders"),
      { timeout: 20000 }
    );
    await frame.locator('[data-slot="t-submit"]').click();
    await responsePromise;

    const captured = testInfo.annotations.find((a) => a.type === "captured-order-payload");
    const payload = captured ? JSON.parse(captured.description ?? "{}") : {};
    testInfo.annotations.push({ type: "final-captured-payload", description: JSON.stringify(payload) });

    expect(payload.session, "order payload carries the selected session, not a hardcoded 'regular'").toBe("intraday_odd");
    expect(payload.orderCond, "order payload carries the auto-corrected orderCond 'cash'").toBe("cash");
    expect(payload.quantity_unit, "order payload carries the auto-corrected quantity_unit 'SHARE'").toBe("SHARE");

    await saveRouteScreenshot(page, testInfo, "desk-exact-matrix-oddlot-session");
  });

  test("selecting 市價 order type forces IOC/FOK TIF and forwards type=market to the order payload", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/trading/orders" && route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        testInfo.annotations.push({ type: "captured-order-payload", description: JSON.stringify(body) });
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              order: { id: "mock-order-market-1", status: "acknowledged" },
              riskCheck: { decision: "allow", guards: [] },
              blocked: false,
              quoteGate: { mode: "paper", decision: "allow", blocked: false }
            }
          })
        });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="t-otype"]').waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(3000);

    await frame.locator('[data-slot="t-otype"]').selectOption("market");

    const rodDisabled = await frame.locator('[data-slot="t-tif"] button[data-tif="rod"]').isDisabled();
    const tifOn = await frame.locator('[data-slot="t-tif"] button.on').getAttribute("data-tif");

    testInfo.annotations.push({ type: "rod-disabled-after-market-otype", description: String(rodDisabled) });
    testInfo.annotations.push({ type: "tif-auto-selected-after-market-otype", description: String(tifOn) });

    expect(rodDisabled, "ROD greys out once 市價 order type is selected (order-rules.ts §4.1)").toBe(true);
    expect(tifOn === "ioc" || tifOn === "fok", "TIF auto-corrects to IOC or FOK once 市價 is selected").toBe(true);

    await frame.locator('[data-slot="t-qty"]').fill("1");
    await frame.locator('[data-slot="t-unit"] button[data-unit="SHARE"]').click();

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/ui-final-v031/backend") && res.url().includes("path=%2Fapi%2Fv1%2Ftrading%2Forders"),
      { timeout: 20000 }
    );
    await frame.locator('[data-slot="t-submit"]').click();
    await responsePromise;

    const captured = testInfo.annotations.find((a) => a.type === "captured-order-payload");
    const payload = captured ? JSON.parse(captured.description ?? "{}") : {};
    testInfo.annotations.push({ type: "final-captured-payload", description: JSON.stringify(payload) });

    expect(payload.type, "order payload carries type='market', not a hardcoded 'limit'").toBe("market");
    expect(["ioc", "fok"], "order payload's timeInForce matches the market-order-legal set").toContain(payload.timeInForce);

    await saveRouteScreenshot(page, testInfo, "desk-exact-matrix-market-order");
  });

  test("a 422 trading_hours guard block is shown as a prominent, human-readable message", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/trading/orders" && route.request().method() === "POST") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              order: null,
              blocked: true,
              quoteGate: null,
              riskCheck: {
                id: "mock-riskcheck-1",
                decision: "block",
                guards: [
                  {
                    guard: "trading_hours",
                    decision: "block",
                    message: "Current time is outside allowed trading hours (09:00-13:30 Asia/Taipei)."
                  }
                ]
              }
            }
          })
        });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="t-qty"]').waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(3000);

    await frame.locator('[data-slot="t-qty"]').fill("1");
    await frame.locator('[data-slot="t-unit"] button[data-unit="SHARE"]').click();
    await frame.locator('[data-slot="t-price"]').fill("500");

    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/ui-final-v031/backend") && res.url().includes("path=%2Fapi%2Fv1%2Ftrading%2Forders"),
      { timeout: 20000 }
    );
    await frame.locator('[data-slot="t-submit"]').click();
    await responsePromise;
    await page.waitForTimeout(500);

    const msgText = await frame.locator('[data-slot="t-submit-msg"]').first().textContent();
    const msgHasErrClass = await frame
      .locator('[data-slot="t-submit-msg"]')
      .first()
      .evaluate((el) => el.classList.contains("err"));
    const riskSummary = await frame.locator('[data-slot="t-risk-summary"]').first().textContent();
    const riskListText = await frame.locator('[data-slot="t-risk-list"]').first().textContent();

    testInfo.annotations.push({ type: "blocked-submit-msg", description: String(msgText) });
    testInfo.annotations.push({ type: "blocked-submit-msg-has-err-class", description: String(msgHasErrClass) });
    testInfo.annotations.push({ type: "blocked-risk-summary", description: String(riskSummary) });
    testInfo.annotations.push({ type: "blocked-risk-list-text", description: String(riskListText) });

    expect(msgText || "", "422 trading_hours block must render the human-readable Chinese label, not the raw guard code").toContain("交易時段");
    expect(msgHasErrClass, "blocked message must be visually prominent (.err class), not styled the same as a neutral hint").toBe(true);
    expect(riskListText || "", "full risk-guard panel also reflects the real block (not just a one-line summary)").toContain("交易時段");

    await saveRouteScreenshot(page, testInfo, "desk-exact-matrix-trading-hours-block");
  });

  test("chart interval tabs (分K/週K/月K) inside the real engine actually switch", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    const kline = frame.frameLocator("#real-kline-frame");
    await kline.locator(".kline-toolbar").first().waitFor({ state: "attached", timeout: 20000 });
    await page.waitForTimeout(4000);

    const weekTab = kline.locator('.kline-tab:has-text("週K")').first();
    await weekTab.waitFor({ state: "attached", timeout: 10000 });
    await weekTab.click();
    await page.waitForTimeout(1000);
    const weekActive = await weekTab.evaluate((el) => el.classList.contains("is-active"));

    testInfo.annotations.push({ type: "week-tab-active-after-click", description: String(weekActive) });
    expect(weekActive, "clicking 週K really switches the active interval tab").toBe(true);

    await saveRouteScreenshot(page, testInfo, "desk-exact-chart-interval-switch");
  });
});
