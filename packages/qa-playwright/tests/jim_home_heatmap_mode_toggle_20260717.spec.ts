import { expect, test } from "@playwright/test";

// 2026-07-17 根因修復驗收：楊董深夜回報「首頁熱力圖又換了、沒辦法切換」。
//
// 根因：apps/web/app/page.tsx 的 HeatZonePanel 把 showKgiFallback（純粹代表
// 「現在不在 KGI 09:00-14:10 即時報價時段」，每天 14:10-09:00 與整個週末皆為
// true）也塞進 effectiveMode 的強制條件：
//   const effectiveMode = showKgiFallback || showCoverageFallback ? "all" : activeMode;
// 導致「核心熱力圖」／「全市場熱力圖」這組切換 tab，在收盤後與週末永遠被鎖死在
// 「全市場熱力圖」（MarketWideHeatmap，產業長條格視覺），使用者點「核心熱力圖」
// 連結完全沒有反應——因為 effectiveMode 從不看 URL 的 heatmap 參數，只看
// showKgiFallback。这跟原稿核准的磚格熱力圖（IndustryHeatmap treemap）視覺完全
// 不同，才會被誤認為「又換了」。
//
// 修復：只有 showCoverageFallback（代表股 EOD 覆蓋率真的不足，例如冷啟動）才
// 強制切到全市場救援視圖；showKgiFallback 只保留告示 banner，不再蓋掉使用者
// 的模式選擇。
//
// 這支 spec 不依賴測試時當下是否為盤中/盤後——不論何時執行，只要代表股 EOD
// 覆蓋率正常（showCoverageFallback=false，prod 正常運作下恆真），核心/全市場
// 兩個 tab 都必須能真實切換且反映在 DOM 上。
test.describe("/ homepage heatmap core/全市場 mode toggle", () => {
  test("clicking 核心熱力圖 renders the treemap grid, clicking 全市場熱力圖 renders the market-wide grid, and they are mutually exclusive", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });

    // Start on core mode (default route, no query).
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator(".heat-mode-tabs").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(1200);

    const offHoursBannerCount = await page.locator(".tac-kgi-offhours-banner").count();
    testInfo.annotations.push({ type: "off-hours-banner-present", description: String(offHoursBannerCount > 0) });

    // ── Core mode assertions ──────────────────────────────────────────────
    // Regression lock for the exact bug: even when the off-hours banner is
    // showing (KGI real-time closed), the core tab must still be the active
    // one on the default route — it must NOT be silently overridden to 全市場.
    const coreTab = page.locator(".heat-mode-tabs a", { hasText: "核心熱力圖" });
    const allTab = page.locator(".heat-mode-tabs a", { hasText: "全市場熱力圖" });
    await expect(coreTab).toHaveClass(/is-active/);
    await expect(allTab).not.toHaveClass(/is-active/);
    await expect(page.locator(".tac-industry-heatmap")).toBeVisible();
    await expect(page.locator(".tac-market-wide-heatmap")).toHaveCount(0);

    const coreTileCount = await page.locator(".heatmapgrid .tile").count();
    testInfo.annotations.push({ type: "core-tile-count", description: String(coreTileCount) });
    expect(coreTileCount).toBeGreaterThan(0);

    // ── Switch to 全市場熱力圖 via real click (not direct goto) ───────────
    await allTab.click();
    await page.waitForURL(/heatmap=all/, { timeout: 15000 });
    await page.locator(".tac-market-wide-heatmap").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(800);

    await expect(allTab).toHaveClass(/is-active/);
    await expect(coreTab).not.toHaveClass(/is-active/);
    await expect(page.locator(".tac-industry-heatmap")).toHaveCount(0);
    await expect(page.locator(".tac-market-wide-heatmap")).toBeVisible();

    const wideCellCount = await page.locator(".tac-market-wide-cell").count();
    testInfo.annotations.push({ type: "wide-cell-count", description: String(wideCellCount) });

    // ── Switch back to 核心熱力圖 via real click ──────────────────────────
    await coreTab.click();
    await page.waitForURL((url) => !url.search.includes("heatmap=all"), { timeout: 15000 });
    await page.locator(".tac-industry-heatmap").first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(800);

    await expect(coreTab).toHaveClass(/is-active/);
    await expect(allTab).not.toHaveClass(/is-active/);
    await expect(page.locator(".tac-market-wide-heatmap")).toHaveCount(0);
    await expect(page.locator(".heatmapgrid .tile").first()).toBeVisible();
  });
});
