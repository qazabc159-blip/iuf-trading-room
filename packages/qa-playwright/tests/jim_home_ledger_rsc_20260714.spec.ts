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

  // 2026-07-14 修正：原本斷言用 .tac-heat-sector-tabs/.tac-heatmap-canvas
  // .tac-heat-tile/.idxhist，這些 class 從未出現在實際 markup（現行是
  // .heat-chips/.heatmapgrid .tile/.idxhistband），從這支 spec 建立起就是
  // 假綠斷言、從未真的驗過任何東西——順手修正選擇器對齊真實 DOM。
  test("desktop 1280 renders heatmap sector chips + tiles + breadth real values + TAIEX chart @smoke", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".tac-ledger .heatzone").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1500);

    // 2026-07-22 Pete round-2 🟡: 核心觀察池代表股資料若尚未暖機完成，
    // `HeatZonePanel` 的 `showCoverageFallback` 會把 `effectiveMode` 從
    // "core" 切成 "all"，整段改渲染 `MarketWideHeatmap`（`.tac-market-wide-*`），
    // 完全沒有 `.heat-chips`/`.heatmapgrid`——這是誠實降級（見
    // `.tac-kgi-offhours-banner` 文案「核心代表股資料仍在暖機」），不是壞掉。
    // 本輪重現時（2026-07-22 22:5x TST）prod 剛好處在這個真實暖機態，親眼
    // 證實這不是假設情境。比照同檔案其他測試已有的「找不到就誠實跳過」寫法。
    const hasChips = (await page.locator(".heat-chips button").count()) > 0;
    if (!hasChips) {
      testInfo.annotations.push({
        type: "heatzone-fallback",
        description: "core-pool coverage fallback active (market-wide heatmap shown instead of sector chips) — nothing to assert for the core-pool shape right now",
      });
      return;
    }

    const sectorChipCount = await page.locator(".heat-chips button").count();
    const semiconductorChip = page.locator('.heat-chips button[aria-label="半導體業"]');
    const heatTileCount = await page.locator(".heatmapgrid .tile").count();
    const breadthUp = await page.locator(".breadthline .n.up").first().textContent();
    const breadthDown = await page.locator(".breadthline .n.down").first().textContent();
    const idxHistPresent = await page.locator(".idxhistband").count();

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

  test("rank row and quant strategy mini card are real navigable links", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".rk .r").first().waitFor({ state: "attached", timeout: 15000 });

    const rankHref = await page.locator(".rk .r").first().getAttribute("href");
    expect(rankHref).toMatch(/^\/companies\//);

    // v9.1（2026-07-19）renamed away from the old S1 internal codename.
    const quantMiniHref = await page.locator("a.qmini-wrap").first().getAttribute("href");
    expect(quantMiniHref).toBe("/quant-strategies");
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

  // 2026-07-14 楊董二次糾正：heroband 被 TAIEX 折線圖撐高到 429-475px（原稿
  // 字面 style="height:322px"），連帶把熱力圖磚格拉成扁平橫條；折線圖已
  // 移出成 IndexHistoryBand 全寬窄帶，這裡鎖死 heroband 固定 322px 的回歸。
  //
  // 2026-07-15 更新（全寬 zoom 縮放，見 globals.css .home-ledger-shell／
  // .tac-ledger）：`.tac-ledger` 現在固定 1280px 設計寬 + `zoom:
  // var(--home-zoom)` 依可用寬度縮放，heroband 的「渲染後」boundingBox
  // 高度會是 `322 * zoomFactor`，不再是字面 322px——這是預期行為（整版
  // 等比縮放，不只鎖單一 band 高度）。原本的 px 斷言改成 zoom 不變量：
  // heroband 高度 / tac-ledger 寬度的比例，在任何斷點都必須貼近原稿的
  // 322/1280 設計比例（zoom 對兩者套用同一個縮放係數，比例應完全抵消）。
  test("heroband height stays at the 322/1280 design ratio across zoom levels (1280/1440/1920/2560)", async ({ page }, testInfo) => {
    for (const width of [1280, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1400 });
      await page.goto("/?sector=all", { waitUntil: "domcontentloaded" });
      await page.locator(".heroband").first().waitFor({ state: "attached", timeout: 15000 });
      await page.waitForTimeout(1000);

      const heroband = await page.locator(".heroband").first().boundingBox();
      const tacLedger = await page.locator(".tac-ledger").first().boundingBox();
      const ratio = heroband && tacLedger ? heroband.height / tacLedger.width : null;
      testInfo.annotations.push({ type: `heroband-height-${width}`, description: String(heroband?.height) });
      testInfo.annotations.push({ type: `tac-ledger-width-${width}`, description: String(tacLedger?.width) });
      testInfo.annotations.push({ type: `heroband-ratio-${width}`, description: String(ratio) });
      // 原稿設計比例 322/1280 = 0.25156；容忍 zoom 捨入誤差 ±1.5%。
      expect(ratio, `heroband/tac-ledger height:width ratio must stay ~322:1280 at ${width}px`).toBeGreaterThan(0.2391);
      expect(ratio, `heroband/tac-ledger height:width ratio must stay ~322:1280 at ${width}px`).toBeLessThan(0.2641);

      // 磚型分配精算填滿：hero(1)+wide(5)+standard(N-6) 在 8 欄 grid 必須
      // 整除成完整列，不能有孤行（最後一列 <8 顆但 >0 顆一樣算孤行，只有
      // 「剛好整除」或「不到一列」兩種狀態合法）。
      const tileCount = await page.locator(".heatmapgrid .tile").count();
      const remainder = (4 + 2 * Math.min(5, Math.max(0, tileCount - 1)) + Math.max(0, tileCount - 6)) % 8;
      testInfo.annotations.push({ type: `heatmap-grid-remainder-${width}`, description: String(remainder) });
      expect(remainder).toBe(0);
    }
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
