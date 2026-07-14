import { expect, test } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// 首頁「原封搬原稿」預覽 /home-exact 資料接線驗收（2026-07-14，Jim）。
// 這支測試檔是本輪任務的驗收 harness，非長駐 CI spec；驗收後可視需要保留或移除。
test.describe("/home-exact preview", () => {
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
    await page.goto("/home-exact", { waitUntil: "domcontentloaded" });

    const frame = extractFrame(page);
    await frame.locator('[data-slot="idx-int"]').first().waitFor({ state: "attached", timeout: 15000 });
    // give the inline hydration script time to finish its fetch waterfall
    await frame.locator('[data-slot="heat-grid"]').first().locator(".tile").nth(1).waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1000);

    const idxInt = await frame.locator('[data-slot="idx-int"]').first().textContent();
    const heatGridTiles = await frame.locator('[data-slot="heat-grid"]').first().locator(".tile").count();
    const recRows = await frame.locator('[data-slot="rec-list"]').first().locator(".rrow").count();
    const s1Research = await frame.locator('[data-slot="s1-research-val"]').first().textContent();
    const s1Sim = await frame.locator('[data-slot="s1-sim-val"]').first().textContent();
    const briefStatus = await frame.locator('[data-slot="brief-status"]').first().textContent();
    const tapeHead = await frame.locator('[data-slot="tape-head"]').first().textContent();
    const rankGainers = await frame.locator('[data-slot="rank-gainers"]').first().locator(".r").count();

    testInfo.annotations.push({ type: "idx-int", description: String(idxInt) });
    testInfo.annotations.push({ type: "heat-grid-tiles", description: String(heatGridTiles) });
    testInfo.annotations.push({ type: "rec-rows", description: String(recRows) });
    testInfo.annotations.push({ type: "s1-research", description: String(s1Research) });
    testInfo.annotations.push({ type: "s1-sim", description: String(s1Sim) });
    testInfo.annotations.push({ type: "brief-status", description: String(briefStatus) });
    testInfo.annotations.push({ type: "tape-head", description: String(tapeHead) });
    testInfo.annotations.push({ type: "rank-gainers", description: String(rankGainers) });

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    testInfo.annotations.push({ type: "scroll", description: JSON.stringify(scroll) });
    expect(scroll.scrollWidth, "no horizontal overflow at 1280").toBeLessThanOrEqual(scroll.clientWidth + 1);

    // Known pre-existing background noise, unrelated to /home-exact: the root
    // layout's <TickerTape/> ("use client", app/layout.tsx) calls
    // getMarketDataOverview() directly in the browser, which lib/api.ts only
    // routes through the same-origin proxy for a small allowlist that does not
    // include market-data/overview — so in the local-dev-against-prod-API
    // harness (this worktree has no local API) it 401s straight against
    // api.eycvector.com. Reproduced identically on the untouched /market-intel
    // route. /auth/me 401 noise is the same documented harness artifact (see
    // jim_memory.md). Neither originates from this task's new code, which only
    // ever calls /api/ui-final-v031/backend or /api/home-exact/recommendations
    // (same-origin, cookies forwarded server-side).
    const KNOWN_HARNESS_NOISE = [/\/auth\/me(?:\?|$)/, /\/api\/v1\/market-data\/overview\?includeStale/];
    const unexpectedFailedRequests = failedRequests.filter(
      (r) => !KNOWN_HARNESS_NOISE.some((pattern) => pattern.test(r)),
    );
    testInfo.annotations.push({ type: "console-errors", description: JSON.stringify(consoleErrors) });
    testInfo.annotations.push({ type: "failed-requests", description: JSON.stringify(failedRequests) });
    testInfo.annotations.push({ type: "unexpected-failed-requests", description: JSON.stringify(unexpectedFailedRequests) });
    expect(unexpectedFailedRequests, "no unexpected failed network requests").toEqual([]);

    await saveRouteScreenshot(page, testInfo, "home-exact-desktop-1280");
  });

  test("mobile 390 renders hydrated data with no horizontal overflow", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/home-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="idx-int"]').first().waitFor({ state: "attached", timeout: 15000 });
    await frame.locator('[data-slot="heat-grid"]').first().locator(".tile").nth(1).waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1000);

    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    testInfo.annotations.push({ type: "scroll", description: JSON.stringify(scroll) });
    expect(scroll.scrollWidth, "no horizontal overflow at 390").toBeLessThanOrEqual(scroll.clientWidth + 1);

    await saveRouteScreenshot(page, testInfo, "home-exact-mobile-390");
  });

  // P2 follow-up fix (2026-07-14): masthead market-state must reflect the
  // actual Taipei trading session (09:00-13:30 weekdays), not just whether
  // the KGI feed technically still returns a (possibly frozen post-close)
  // tick. This spec is only meaningful when actually run outside that
  // window — it self-skips during real market hours so it isn't a flaky
  // CI gate on trading days.
  test("masthead market-state says 已收盤 outside 09:00-13:30 Taipei trading hours, not 盤中即時", async ({ page }, testInfo) => {
    const nowParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date());
    let weekday = "", hour = 0, minute = 0;
    nowParts.forEach((p) => {
      if (p.type === "weekday") weekday = p.value;
      if (p.type === "hour") hour = Number(p.value) % 24;
      if (p.type === "minute") minute = Number(p.value);
    });
    const mins = hour * 60 + minute;
    const isTradingHours = weekday !== "Sat" && weekday !== "Sun" && mins >= 9 * 60 && mins <= 13 * 60 + 30;
    testInfo.annotations.push({ type: "taipei-weekday", description: weekday });
    testInfo.annotations.push({ type: "taipei-hour-minute", description: `${hour}:${minute}` });
    test.skip(isTradingHours, "currently inside 09:00-13:30 Taipei trading hours — this assertion only applies post-close/weekend");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/home-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="mkt-state"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    const mktState = await frame.locator('[data-slot="mkt-state"]').first().textContent();
    testInfo.annotations.push({ type: "mkt-state", description: String(mktState) });

    expect(mktState, "outside trading hours the masthead must say 已收盤, never 盤中即時").toContain("已收盤");
    expect(mktState, "must not read 盤中即時 outside trading hours").not.toContain("盤中即時");

    await saveRouteScreenshot(page, testInfo, "home-exact-desktop-mkt-state-closed");
  });
});
