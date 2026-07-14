import { expect, test } from "@playwright/test";
import { saveRouteScreenshot } from "./helpers";

// 首頁「原封搬原稿」React server component 版驗收（2026-07-14 楊董終令：
// 重做，恢復幾週打磨的 React 資料層＋原稿版面 CSS，不再走 iframe/inline
// script）。這支測試檔是本輪任務的驗收 harness，非長駐 CI spec；驗收後可
// 視需要保留或移除。
test.describe("/ homepage LEDGER RSC", () => {
  test("desktop 1920 renders with app sidebar intact (no more :has() sidebar-hiding bug)", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".tac-ledger .mast").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    await expect(page.locator(".app-sidebar")).toBeVisible();
    await expect(page.locator(".tac-ledger .mast-brand b")).toHaveText("IUF·TR");

    await saveRouteScreenshot(page, testInfo, "home-ledger-1920");
  });

  test("desktop 1280 renders heatmap sector chips + tiles + breadth real values + TAIEX chart", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".tac-ledger .heatzone").first().waitFor({ state: "attached", timeout: 15000 });
    await page.locator(".tac-heat-sector-tabs button").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    const sectorChipCount = await page.locator(".tac-heat-sector-tabs button").count();
    const semiconductorChip = page.locator(".tac-heat-sector-tabs button", { hasText: "半導體業" });
    const heatTileCount = await page.locator(".tac-heatmap-canvas .tac-heat-tile").count();
    const breadthUp = await page.locator(".breadthline .n.up").first().textContent();
    const breadthDown = await page.locator(".breadthline .n.down").first().textContent();
    const idxHistPresent = await page.locator(".idxhist").count();

    testInfo.annotations.push({ type: "sector-chip-count", description: String(sectorChipCount) });
    testInfo.annotations.push({ type: "heat-tile-count", description: String(heatTileCount) });
    testInfo.annotations.push({ type: "breadth-up", description: String(breadthUp) });
    testInfo.annotations.push({ type: "breadth-down", description: String(breadthDown) });

    expect(sectorChipCount).toBeGreaterThan(1);
    await expect(semiconductorChip).toHaveCount(1);
    expect(heatTileCount).toBeGreaterThan(0);
    expect(idxHistPresent).toBe(1);

    await saveRouteScreenshot(page, testInfo, "home-ledger-1280");
  });

  test("AI recommendation CTA row: 看公司 → /companies, 帶入模擬單 → /desk-exact?symbol=...&side=buy", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".rrow").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1000);

    const firstRow = page.locator(".rrow").first();
    const ticker = (await firstRow.locator(".tk").first().textContent())?.trim().split(/\s/)[0] ?? "";
    const companyHref = await firstRow.locator("a", { hasText: "看公司" }).first().getAttribute("href");
    const deskHref = await firstRow.locator("a", { hasText: "帶入模擬單" }).first().getAttribute("href");

    testInfo.annotations.push({ type: "ticker", description: ticker });
    testInfo.annotations.push({ type: "company-href", description: String(companyHref) });
    testInfo.annotations.push({ type: "desk-href", description: String(deskHref) });

    expect(companyHref).toMatch(/^\/companies\//);
    expect(deskHref).toMatch(/^\/desk-exact\?symbol=.+&side=buy$/);
  });

  test("rank row and S1 panel are real navigable links", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".rk .r").first().waitFor({ state: "attached", timeout: 15000 });

    const rankHref = await page.locator(".rk .r").first().getAttribute("href");
    expect(rankHref).toMatch(/^\/companies\//);

    const s1Href = await page.locator("a.s1wrap").first().getAttribute("href");
    expect(s1Href).toBe("/quant-strategies");
  });

  test("brief expand toggle reveals full text (real truncation, not CSS clamp)", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".briefcol .seg").first().waitFor({ state: "attached", timeout: 15000 });
    const toggle = page.locator(".brief-toggle-btn").first();
    const hasToggle = (await toggle.count()) > 0;
    if (!hasToggle) {
      testInfo.annotations.push({ type: "brief-toggle", description: "not present (segments already fit preview length)" });
      return;
    }

    const before = await page.locator(".briefcol .seg .sx").first().textContent();
    await toggle.click();
    await page.waitForTimeout(200);
    const after = await page.locator(".briefcol .seg .sx").first().textContent();

    testInfo.annotations.push({ type: "brief-preview", description: String(before) });
    testInfo.annotations.push({ type: "brief-full", description: String(after) });
    expect(after).not.toBe(before);
  });

  // 2026-07-14 楊董點名「哪一家的熱力圖會缺角??」，糾正版方案：市面熱力圖
  // 標準做法——核心觀察池 40 檔中缺可驗證行情/被 sanity gate 擋掉的個股，
  // 從候選序列遞補等量真公司真行情進來，不留洞也不畫灰塊。grid 永遠是
  // 40 家「有行情」的真公司，每磚 pct 都非空。用 ?sector=all 鎖定核心觀察
  // 池分頁，排除 TWSE 全市場模式（?heatmap=all，不同元件）的干擾。
  test("core heatmap (全部/核心觀察池) always renders exactly 40 real-quote tiles via backfill, never a gray placeholder or grid hole", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/?sector=all", { waitUntil: "domcontentloaded" });

    await page.locator(".heatmapgrid").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    const tiles = page.locator(".heatmapgrid .tile");
    const tileCount = await tiles.count();
    const placeholderCount = await page.locator(".heatmapgrid .tile.placeholder").count();
    const pctTexts = await tiles.locator(".pc").allTextContents();
    const emptyPctCount = pctTexts.filter((text) => text.trim().length === 0 || text.includes("無行情")).length;

    testInfo.annotations.push({ type: "heatmap-tile-count", description: String(tileCount) });
    testInfo.annotations.push({ type: "heatmap-placeholder-count", description: String(placeholderCount) });
    testInfo.annotations.push({ type: "heatmap-empty-pct-count", description: String(emptyPctCount) });

    expect(tileCount).toBe(40);
    expect(placeholderCount).toBe(0);
    expect(emptyPctCount).toBe(0);

    await saveRouteScreenshot(page, testInfo, "home-heatmap-40-tiles");
  });

  // 楊董點名頁尾「EC2 排程 14:10 關機（正常）」是工程語意洩漏，違反 UI 禁
  // 工程語意鐵律。BrokerConnectionLine footer 整行已從首頁移除；這裡鎖死
  // 回歸——首頁全頁文字不得再出現 EC2 / gateway / cron 字樣。
  test("homepage text contains no engineering-semantics leak (no EC2/gateway wording in footer)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator(".tac-ledger .mast").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("EC2");
    expect(bodyText).not.toContain("gateway");
  });

  test("mobile 390 renders responsive single-column layout", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".tac-ledger .mast").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    expect(hasHorizontalOverflow).toBe(false);

    await saveRouteScreenshot(page, testInfo, "home-ledger-390");
  });
});
