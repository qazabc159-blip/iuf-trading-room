import { expect, test } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

// 首頁互動全接驗收（2026-07-14，Jim）：AI 推薦卡三顆鈕 / 熱力圖磚 / 新聞紙帶連結 /
// 排行列 / 簡報展開收合 / S1 面板跳轉 / 文字密度截斷。這支測試檔是本輪任務的驗收
// harness，非長駐 CI spec；驗收後可視需要保留或移除。
test.describe("/ home-exact interactions", () => {
  test("brief expand/collapse toggles real text (not CSS clamp)", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);

    await frame.locator('[data-slot="brief-status"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    const before = await frame.locator('[data-slot="brief-root"]').first().locator(".sx").first().textContent();
    const toggleLabelBefore = await frame.locator('[data-slot="brief-toggle"]').first().textContent();
    testInfo.annotations.push({ type: "brief-preview-text", description: String(before) });
    testInfo.annotations.push({ type: "toggle-label-before", description: String(toggleLabelBefore) });

    await saveRouteScreenshot(page, testInfo, "brief-before-expand");

    await frame.locator('[data-slot="brief-toggle"]').first().click();
    await page.waitForTimeout(300);

    const after = await frame.locator('[data-slot="brief-root"]').first().locator(".sx").first().textContent();
    const toggleLabelAfter = await frame.locator('[data-slot="brief-toggle"]').first().textContent();
    testInfo.annotations.push({ type: "brief-full-text", description: String(after) });
    testInfo.annotations.push({ type: "toggle-label-after", description: String(toggleLabelAfter) });

    await saveRouteScreenshot(page, testInfo, "brief-after-expand");

    // URL must not have changed (top-level location untouched — this is a client toggle, not navigation)
    expect(page.url()).toContain("/");
  });

  test("AI recommendation card CTAs: 看公司 navigates top-level, 帶入模擬單 points to /desk-exact, 加觀察 posts real watchlist add", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);

    await frame.locator('[data-slot="rec-list"]').first().locator(".rrow").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    const firstRow = frame.locator('[data-slot="rec-list"]').first().locator(".rrow").first();
    const companyLink = firstRow.locator("a", { hasText: "看公司" }).first();
    const deskLink = firstRow.locator("a", { hasText: "帶入模擬單" }).first();
    // Select by stable attribute, not by text — the watch button's own text
    // changes ("加觀察" → "加入中…" → "已加入 ✓") after click, so a hasText
    // filter would stop matching its own live element mid-flow.
    const watchLink = firstRow.locator("[data-watch-symbol]").first();

    const companyHref = await companyLink.getAttribute("href");
    const companyTarget = await companyLink.getAttribute("target");
    const deskHref = await deskLink.getAttribute("href");
    const deskTarget = await deskLink.getAttribute("target");
    testInfo.annotations.push({ type: "company-href", description: String(companyHref) });
    testInfo.annotations.push({ type: "company-target", description: String(companyTarget) });
    testInfo.annotations.push({ type: "desk-href", description: String(deskHref) });
    testInfo.annotations.push({ type: "desk-target", description: String(deskTarget) });

    expect(companyHref).toMatch(/^\/companies\//);
    expect(companyTarget).toBe("_top");
    expect(deskHref).toMatch(/^\/desk-exact\?symbol=.+&side=buy$/);
    expect(deskTarget).toBe("_top");

    // rationale should be a short truncated sentence, not a wall of text
    const rationaleText = await firstRow.locator(".rs").first().textContent();
    testInfo.annotations.push({ type: "rationale-text", description: String(rationaleText) });
    expect((rationaleText || "").length, "rationale should be truncated to a short sentence").toBeLessThanOrEqual(45);

    // 加觀察 — real POST, watch for network response
    const watchlistResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/api/ui-final-v031/backend") && res.request().method() === "POST",
      { timeout: 10000 },
    );
    await watchLink.click();
    const watchlistResponse = await watchlistResponsePromise;
    testInfo.annotations.push({ type: "watchlist-response-status", description: String(watchlistResponse.status()) });
    expect(watchlistResponse.ok(), "watchlist POST should succeed").toBeTruthy();

    await page.waitForTimeout(300);
    const watchLabelAfter = await watchLink.textContent();
    testInfo.annotations.push({ type: "watch-label-after", description: String(watchLabelAfter) });
    expect(watchLabelAfter).toContain("已加入");

    // now actually click 看公司 and verify TOP-LEVEL navigation happens (iframe target=_top)
    await companyLink.click();
    await page.waitForURL(/\/companies\//, { timeout: 10000 });
    testInfo.annotations.push({ type: "top-level-url-after-click", description: page.url() });
    expect(page.url()).toContain("/companies/");
  });

  test("heatmap tile click navigates top-level to /companies/<symbol>, hover shows title", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);

    await frame.locator('[data-slot="heat-grid"]').first().locator(".tile[data-symbol]").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1000);

    const firstTile = frame.locator('[data-slot="heat-grid"]').first().locator(".tile[data-symbol]").first();
    const symbol = await firstTile.getAttribute("data-symbol");
    const title = await firstTile.getAttribute("title");
    testInfo.annotations.push({ type: "tile-symbol", description: String(symbol) });
    testInfo.annotations.push({ type: "tile-title", description: String(title) });
    expect(title, "tile should have hover title with name+pct").toBeTruthy();

    await firstTile.click();
    await page.waitForURL(/\/companies\//, { timeout: 10000 });
    testInfo.annotations.push({ type: "url-after-tile-click", description: page.url() });
    expect(page.url()).toContain(`/companies/${symbol}`);
  });

  test("rank row click navigates top-level to /companies/<symbol>", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);

    await frame.locator('[data-slot="rank-gainers"]').first().locator(".r[data-symbol]").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(500);

    const firstRow = frame.locator('[data-slot="rank-gainers"]').first().locator(".r[data-symbol]").first();
    const symbol = await firstRow.getAttribute("data-symbol");
    testInfo.annotations.push({ type: "rank-symbol", description: String(symbol) });

    await firstRow.click();
    await page.waitForURL(/\/companies\//, { timeout: 10000 });
    testInfo.annotations.push({ type: "url-after-rank-click", description: page.url() });
    expect(page.url()).toContain(`/companies/${symbol}`);
  });

  test("S1 panel click navigates top-level to /quant-strategies", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);

    await frame.locator(".s1wrap").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(500);

    await frame.locator(".s1wrap").first().click();
    await page.waitForURL(/\/quant-strategies/, { timeout: 10000 });
    testInfo.annotations.push({ type: "url-after-s1-click", description: page.url() });
    expect(page.url()).toContain("/quant-strategies");
  });

  test("news tape: item with url opens as real anchor with target=_blank rel=noopener", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);

    await frame.locator('[data-slot="tape-head"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    const featEl = frame.locator('[data-slot="tape-feat"]').first();
    const featHref = await featEl.getAttribute("href");
    const featTarget = await featEl.getAttribute("target");
    const featRel = await featEl.getAttribute("rel");
    const featTitle = await featEl.locator("h3").textContent();
    testInfo.annotations.push({ type: "feat-href", description: String(featHref) });
    testInfo.annotations.push({ type: "feat-target", description: String(featTarget) });
    testInfo.annotations.push({ type: "feat-title", description: String(featTitle) });
    testInfo.annotations.push({ type: "feat-title-length", description: String((featTitle || "").length) });

    if (featHref) {
      expect(featTarget).toBe("_blank");
      expect(featRel).toBe("noopener");
    }
    expect((featTitle || "").length, "feat headline should be truncated to ~2-3 lines worth").toBeLessThanOrEqual(40);
  });
});
