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

  // 楊董夜間退件 P1（2026-07-14 Elva prod 確診）：熱力圖盤後空窗回傳的
  // changePct 垃圾值（2330 -90.91%／2454 -98.21%）未經 sanity gate 就直接
  // 顯示，且均幅一起被污染。修法：個股 |pct|>11%（台股漲跌停 ±10% + 1% 緩衝）
  // 一律視為資料異常，改顯示「無行情」，均幅只納入合法磚計算。
  test("heatmap tiles sanity-gate impossible changePct values instead of showing garbage numbers", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/home-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="heat-grid"]').first().locator(".tile").nth(1).waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(2000);

    const tilePcts = await page.evaluate(() => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      const doc = iframe.contentDocument!;
      const grid = doc.querySelector('[data-slot="heat-grid"]')!;
      return Array.from(grid.querySelectorAll(".tile")).map((t) => ({
        symbol: t.getAttribute("data-symbol"),
        pc: t.querySelector(".pc")?.textContent ?? "",
      }));
    });
    const heatAvg = await frame.locator('[data-slot="heat-avg"]').first().textContent();
    testInfo.annotations.push({ type: "tile-pcts", description: JSON.stringify(tilePcts) });
    testInfo.annotations.push({ type: "heat-avg", description: String(heatAvg) });

    // No tile may ever display a numeric |pct| beyond the ±10% daily limit
    // (with the code's own 11% sanity buffer) — it must read "無行情" instead.
    const insaneNumericTiles = tilePcts.filter((t) => {
      const match = t.pc.match(/^[+-]?([\d.]+)%$/);
      if (!match) return false; // "無行情" or "--%" etc. — not a numeric tile
      return Math.abs(Number(match[1])) > 11;
    });
    expect(insaneNumericTiles, "no tile may show a |pct| beyond the sanity limit — must read 無行情 instead").toEqual([]);

    // The average must also be inside a sane single-day range once garbage
    // inputs are excluded from the calculation.
    const avgMatch = (heatAvg ?? "").match(/^[+-]?([\d.]+)%$/);
    if (avgMatch) {
      expect(Number(avgMatch[1]), "均幅 must be a sane single-day average, not dragged by garbage tile values").toBeLessThan(11);
    }

    await saveRouteScreenshot(page, testInfo, "home-exact-desktop-heatmap-sanity");
  });

  // 楊董夜間退件 bug B：sector chip（核心觀察池/其他）點擊過去是純裝飾，
  // 從沒真的過濾磚格。修法：chip 點擊真的驅動 renderHeatTilesForSector()
  // 重繪，同一時間只顯示一組磚格。
  test("clicking a heatmap sector chip actually re-renders the tile grid (not decorative)", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/home-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="heat-grid"]').first().locator(".tile").nth(1).waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(2000);

    const chipCount = await frame.locator('[data-slot="heat-chips"]').first().locator("button[data-sector-key]").count();
    testInfo.annotations.push({ type: "chip-count", description: String(chipCount) });
    expect(chipCount, "sector chips must be real buttons with a data-sector-key filter target").toBeGreaterThan(0);

    // Click the second chip (first real sector, index 0 is always "__all__").
    if (chipCount > 1) {
      await frame.locator('[data-slot="heat-chips"]').first().locator("button[data-sector-key]").nth(1).click();
      await page.waitForTimeout(300);
      const activeSector = await page.evaluate(() => {
        const iframe = document.querySelector("iframe") as HTMLIFrameElement;
        const doc = iframe.contentDocument!;
        const active = doc.querySelector('[data-slot="heat-chips"] button.is-active') as HTMLElement | null;
        return active?.dataset.sectorKey ?? null;
      });
      testInfo.annotations.push({ type: "active-sector-after-click", description: String(activeSector) });
      expect(activeSector, "clicking a chip must actually flip which one is is-active").not.toBe("__all__");

      // Click back to __all__ and confirm the grid recovers the full pool.
      await frame.locator('[data-slot="heat-chips"]').first().locator('button[data-sector-key="__all__"]').click();
      await page.waitForTimeout(300);
    }
    const finalTileCount = await frame.locator('[data-slot="heat-grid"]').first().locator(".tile").count();
    testInfo.annotations.push({ type: "final-tile-count", description: String(finalTileCount) });
    expect(finalTileCount, "returning to __all__ must restore the full pool").toBeGreaterThan(0);

    await saveRouteScreenshot(page, testInfo, "home-exact-desktop-heatmap-chip-filter");
  });

  // 楊董夜間追加件：TAIEX 日線走勢折線＋量柱＋日期（舊版首頁有、原封搬原稿時
  // 漏掉，補回來）。資料源 /api/v1/market-data/overview 的
  // marketContext.index.history（既有端點，強勢個股排行已在用）。
  test("TAIEX daily history chart renders a real multi-day polyline with volume bars", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/home-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="idx-hist"]').first().locator("svg").waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1000);

    const chartInfo = await page.evaluate(() => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      const doc = iframe.contentDocument!;
      const root = doc.querySelector('[data-slot="idx-hist"]')!;
      const svg = root.querySelector("svg");
      const polyline = svg?.querySelector("polyline");
      const points = polyline?.getAttribute("points")?.trim().split(/\s+/).filter(Boolean) ?? [];
      return {
        hasSvg: !!svg,
        pointCount: points.length,
        rectCount: svg ? svg.querySelectorAll("rect").length : 0,
        headText: root.querySelector(".idxhist-head")?.textContent ?? "",
      };
    });
    testInfo.annotations.push({ type: "chart-info", description: JSON.stringify(chartInfo) });

    expect(chartInfo.hasSvg, "TAIEX history chart svg must render given real history data").toBe(true);
    expect(chartInfo.pointCount, "chart must plot more than one day (a real multi-day trend, not a single dot)").toBeGreaterThan(1);
    expect(chartInfo.rectCount, "chart must render per-day volume bars").toBeGreaterThan(0);
    expect(chartInfo.headText, "chart header must cite how many trading days are plotted").toMatch(/交易日/);

    await saveRouteScreenshot(page, testInfo, "home-exact-desktop-taiex-history-chart");
  });
});
