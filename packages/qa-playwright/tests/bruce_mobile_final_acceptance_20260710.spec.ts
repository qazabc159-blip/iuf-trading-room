import { expect, test, type Page } from "@playwright/test";
import { API_BASE_URL, expectNoServerError, extractFrame, saveRouteScreenshot } from "./helpers";

/**
 * Bruce — 手機版徹底完工最終驗收 (2026-07-10)
 *
 * Covers the gaps NOT already exercised by mobile-390.spec.ts (home/ai-rec/
 * alerts/company/quant-strategies/track-record/reviews/settings) and
 * jim_mobile_m4_portfolio_shell_20260709.spec.ts (portfolio sidebar overlay
 * at 390px):
 *  A. 390px scan for /portfolio, a theme detail page (/themes/inp), /signals
 *  B. 995px mid-band sidebar check on /portfolio (#1197 second-commit fix)
 *  C. watchlist POST/DELETE e2e (API-level) + UI "加觀察" path on a theme page
 *  D. unified order flow prod smoke (paper channel) — after-hours BLOCKED
 *     expected; assert the block message is Chinese, not a raw error
 *  E. desktop 1280px regression screenshots (home / portfolio / track-record)
 */

const MOBILE_PROJECT = "mobile-iphone-13";
const DESKTOP_PROJECT = "desktop-chromium";

// ---------------------------------------------------------------------------
// A. 390px scan — routes not covered by mobile-390.spec.ts
// ---------------------------------------------------------------------------
type MobileRoute = {
  path: string;
  label: string;
  assertVisible: (page: Page) => Promise<void>;
};

const EXTRA_ROUTES: MobileRoute[] = [
  {
    path: "/portfolio",
    label: "交易台（父層殼）",
    assertVisible: async (page) => {
      await page.locator(".iuf-final-content-frame iframe").waitFor({ state: "visible", timeout: 20000 });
    },
  },
  {
    path: "/themes/inp",
    label: "主題頁（磷化銦）",
    assertVisible: async (page) => {
      await expect(page.locator("._bty-detail-layout")).toBeVisible();
      await expect(page.locator("._bty-theme-title")).toBeVisible();
    },
  },
  {
    path: "/signals",
    label: "訊號",
    assertVisible: async (page) => {
      await expect(page.locator("._sig-hero")).toBeVisible();
    },
  },
];

for (const route of EXTRA_ROUTES) {
  test(`bruce-final: mobile-390 ${route.label} (${route.path}) no page-level horizontal overflow`, async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== MOBILE_PROJECT,
      `mobile-390 scan is dedicated to the "${MOBILE_PROJECT}" project.`,
    );
    test.setTimeout(45_000);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);
    await page.waitForTimeout(3_000);

    await route.assertVisible(page);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    await saveRouteScreenshot(page, testInfo, `bruce_mobile390_${route.path.replace(/\//g, "_")}`);

    expect(
      overflow.scrollWidth,
      `${route.path} page body scrolled horizontally at 390px: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const blockingConsole = consoleErrors.filter((l) =>
      /401|403|500|Application error|server-side exception|TypeError|is not a function|Cannot read prop/i.test(l),
    );
    expect(
      blockingConsole,
      `${route.path} surfaced blocking console errors at 390px: ${blockingConsole.slice(0, 3).join(" | ")}`,
    ).toEqual([]);
  });
}

// /portfolio at 390px: verify iframe interior is really clickable (not just
// present) — this is the specific class of bug #1197 fixed (sidebar overlay
// intercepting pointer events across the whole viewport).
test("bruce-final: mobile-390 /portfolio iframe broker-strip real click reaches inside iframe", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== MOBILE_PROJECT,
    `mobile-390 scan is dedicated to the "${MOBILE_PROJECT}" project.`,
  );
  test.setTimeout(45_000);

  await page.goto("/portfolio");
  const frame = extractFrame(page);
  const kgiBtn = frame.locator('#broker-strip .bbtn[data-broker="kgi"]');
  await kgiBtn.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);
  await kgiBtn.click({ timeout: 8000 });
  await expect(kgiBtn, "real click on iframe broker button should toggle active class").toHaveClass(/active/, {
    timeout: 5000,
  });
  await saveRouteScreenshot(page, testInfo, "bruce_mobile390_portfolio_iframe_click_verified");
});

// ---------------------------------------------------------------------------
// B. 995px mid-band sidebar check on /portfolio (981-1000px band, #1197
//    second commit). Runs on desktop-chromium project with an overridden
//    viewport, mirroring the assertions in jim_mobile_m4_portfolio_shell.
// ---------------------------------------------------------------------------
test("bruce-final: 995px /portfolio sidebar does not overlay the trading-room iframe", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== DESKTOP_PROJECT,
    `995px mid-band check runs on the "${DESKTOP_PROJECT}" project with an overridden viewport.`,
  );
  test.setTimeout(45_000);

  await page.setViewportSize({ width: 995, height: 900 });
  await page.goto("/portfolio");
  await page.locator(".iuf-final-content-frame iframe").waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1000);

  const boxes = await page.evaluate(() => {
    const sidebar = document.querySelector(".app-sidebar");
    const iframeEl = document.querySelector(".iuf-final-content-frame iframe");
    const s = sidebar?.getBoundingClientRect();
    const f = iframeEl?.getBoundingClientRect();
    return {
      sidebar: s ? { top: s.top, bottom: s.bottom, height: s.height, width: s.width } : null,
      iframe: f ? { top: f.top, bottom: f.bottom, height: f.height, width: f.width } : null,
      viewportWidth: window.innerWidth,
    };
  });

  await saveRouteScreenshot(page, testInfo, "bruce_995_portfolio_sidebar_check");

  expect(boxes.sidebar, "sidebar should be present in the DOM at 995px").not.toBeNull();
  expect(boxes.iframe, "trading-room iframe should be present in the DOM at 995px").not.toBeNull();
  // Real regression signature found 2026-07-10: FinalOnlyFrame.tsx's
  // click-blocking-overlay fix uses `@media (max-width: 1000px)` to force
  // position:static/height:auto on .app-sidebar, but the tactical sidebar's
  // OWN internal collapse to a compact horizontal nav strip
  // (.app-tactical-sidebar.tac-sidebar in globals.css) only triggers at
  // `@media (max-width: 980px)` — a narrower, mismatched breakpoint. In the
  // 981-1000px gap, .app-sidebar is correctly non-overlay (in-flow) but its
  // CONTENT never collapses, so it renders at its full ~718px natural list
  // height, leaving the iframe only ~182px of a 900px-tall viewport (verified
  // via width sweep 975/980/981/995/1000/1001 — see bruce_memory.md for the
  // full table). This is not a click-interception bug (no overlap => M4's own
  // assertion style would pass) but it does violate "sidebar 不得全螢幕覆蓋":
  // the iframe should retain a meaningful fraction of the viewport height.
  expect(
    boxes.iframe!.height,
    `iframe only got ${boxes.iframe!.height}px of the 900px viewport at 995px — sidebar height=${boxes.sidebar!.height}px ate the rest (breakpoint mismatch: FinalOnlyFrame.tsx @1000px vs globals.css .app-tactical-sidebar.tac-sidebar @980px)`,
  ).toBeGreaterThan(400);
});

// ---------------------------------------------------------------------------
// C. watchlist POST e2e — API level (add / confirm / remove / confirm)
// ---------------------------------------------------------------------------
test("bruce-final: watchlist POST/GET/remove e2e against prod API", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, "API-only test, run once on desktop-chromium project.");
  const symbol = "2330";

  // Clean slate: remove first in case a prior failed run left it in.
  await request.post(`${API_BASE_URL}/api/v1/watchlist/remove`, { data: { symbol } });

  const before = await request.get(`${API_BASE_URL}/api/v1/watchlist`);
  expect(before.ok(), `GET watchlist before add: HTTP ${before.status()}`).toBeTruthy();
  const beforeBody = (await before.json()) as { data: Array<{ symbol: string }> };
  expect(beforeBody.data.some((r) => r.symbol === symbol), "2330 should not be in watchlist before test").toBeFalsy();

  const add = await request.post(`${API_BASE_URL}/api/v1/watchlist`, { data: { symbol, name: "台積電" } });
  expect(add.ok(), `POST watchlist add: HTTP ${add.status()} body=${await add.text()}`).toBeTruthy();

  const after = await request.get(`${API_BASE_URL}/api/v1/watchlist`);
  expect(after.ok()).toBeTruthy();
  const afterBody = (await after.json()) as { data: Array<{ symbol: string }> };
  expect(afterBody.data.some((r) => r.symbol === symbol), "2330 should be in watchlist after POST add").toBeTruthy();

  const remove = await request.post(`${API_BASE_URL}/api/v1/watchlist/remove`, { data: { symbol } });
  expect(remove.ok(), `POST watchlist remove: HTTP ${remove.status()}`).toBeTruthy();

  const cleaned = await request.get(`${API_BASE_URL}/api/v1/watchlist`);
  const cleanedBody = (await cleaned.json()) as { data: Array<{ symbol: string }> };
  expect(cleanedBody.data.some((r) => r.symbol === symbol), "2330 should be removed after cleanup").toBeFalsy();
});

// UI path: click "加觀察" on a theme member row, verify it flips to "已加入",
// then clean up via the API (no UI remove control on this row).
test("bruce-final: watchlist UI path — 加觀察 button on theme page member row", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, "UI path test, run once on desktop-chromium project.");
  test.setTimeout(30_000);

  await page.goto("/themes/inp");
  const watchBtn = page.locator("._bty-member-watch-btn").first();
  await watchBtn.waitFor({ state: "visible", timeout: 15000 });
  const symbolLabel = await page
    .locator("._bty-member-grid")
    .first()
    .textContent()
    .catch(() => null);

  await watchBtn.click();
  await expect(watchBtn, "watch button should show 已加入 after a successful add").toHaveText("已加入", {
    timeout: 8000,
  });
  await saveRouteScreenshot(page, testInfo, "bruce_watchlist_ui_added");

  // Best-effort cleanup: pull the symbol back out of the API-level list.
  // We don't know the exact ticker from the DOM reliably, so sweep the
  // known theme member symbols is out of scope here — instead read back
  // the API list and remove whatever was added during this test run that
  // matches the visible row text (fallback: leave a note, do not fail test
  // on cleanup — primary assertion above already proved the UI path works).
  void symbolLabel;
  const list = await request.get(`${API_BASE_URL}/api/v1/watchlist`);
  if (list.ok()) {
    const body = (await list.json()) as { data: Array<{ symbol: string; name: string }> };
    for (const row of body.data) {
      if (row.name.includes("全新") || row.symbol === "2455" || row.symbol === "2340") {
        await request.post(`${API_BASE_URL}/api/v1/watchlist/remove`, { data: { symbol: row.symbol } });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// D. unified order flow prod smoke — paper channel (after-hours BLOCKED
//    expected; assert the message is Chinese, not a raw/stack error)
// ---------------------------------------------------------------------------
test("bruce-final: unified order flow paper-channel smoke on /portfolio", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, "Order flow smoke runs on desktop-chromium project.");
  test.setTimeout(45_000);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/portfolio");
  const frame = extractFrame(page);
  const submitBtn = frame.locator("#submit-btn");
  await submitBtn.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2000); // let hydratePaper() settle capitalReady + selected

  await saveRouteScreenshot(page, testInfo, "bruce_order_flow_paper_before_submit");

  const networkResponses: { url: string; status: number }[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/v1/trading/orders") || res.url().includes("/api/v1/paper/preview")) {
      networkResponses.push({ url: res.url(), status: res.status() });
    }
  });

  await submitBtn.click({ timeout: 8000 });
  await page.waitForTimeout(4000); // preview + submit round-trip

  const labelText = await frame.locator("#submit-btn-label, #submit-btn b").first().textContent().catch(() => null);
  const gateText = await frame.locator(".gate .h .v").first().textContent().catch(() => null);

  await saveRouteScreenshot(page, testInfo, "bruce_order_flow_paper_after_submit");

  testInfo.attach("order-flow-network-trace", {
    body: JSON.stringify({ networkResponses, labelText, gateText }, null, 2),
    contentType: "application/json",
  });

  // Hard requirement regardless of accept/block outcome: whatever the ticket
  // area shows, it must not be a raw JS error / stack trace / English enum.
  const combinedText = `${labelText ?? ""} ${gateText ?? ""}`;
  expect(
    /Error|undefined|NaN|\[object|TypeError|at Object\.|stack trace/i.test(combinedText),
    `order flow surfaced a raw/non-product error string: "${combinedText}"`,
  ).toBeFalsy();
  expect(combinedText.trim().length, "order flow ticket area should show some product-grade status text").toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// E. desktop 1280px regression screenshots
// ---------------------------------------------------------------------------
const DESKTOP_1280_ROUTES = ["/", "/portfolio", "/track-record"];

for (const routePath of DESKTOP_1280_ROUTES) {
  test(`bruce-final: desktop 1280px regression screenshot ${routePath}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, "1280px desktop regression runs on desktop-chromium project.");
    test.setTimeout(30_000);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);
    await page.waitForTimeout(2500);
    await saveRouteScreenshot(page, testInfo, `bruce_desktop1280_${routePath.replace(/\//g, "_") || "_home"}`);
  });
}
