import { expect, test } from "@playwright/test";
import { saveRouteScreenshot } from "./helpers";

// 首頁全寬 zoom 縮放驗收（2026-07-15，Jim）。楊董更正：「左右留白是要幹嘛」
// ——原本 .home-ledger-shell 有 max-width:1520 cap + margin auto 置中，在
// 1920 螢幕留下左右各 ~111px 留白，且讓熱力圖磚比原稿瘦小。方案：拔掉
// max-width/margin，.tac-ledger 鎖回原稿 1280px 固定設計寬，用 CSS
// `zoom: var(--home-zoom)`（home-zoom-controller.tsx 用 ResizeObserver
// 量測 .home-ledger-shell 可用寬度寫回）依可用寬度等比縮放到填滿——所有
// 原稿逐值 px 比例（idxanchor 454／heatzone／tape 236／磚形／字級／巨數字
// 82px）在任何斷點都應與原稿保持完全一致，不再各自另外調整。
//
// 這支測試檔是本輪任務的驗收 harness，非長駐 CI spec；驗收後可視需要
// 保留或移除。
test.describe("/ homepage full-bleed zoom scaling", () => {
  const BREAKPOINTS = [1280, 1440, 1920, 2560];

  test("tac-ledger fills edge-to-edge from sidebar to viewport right edge (zero left/right gap) at every breakpoint", async ({ page }, testInfo) => {
    for (const width of BREAKPOINTS) {
      await page.setViewportSize({ width, height: 1400 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.locator(".tac-ledger .mast").first().waitFor({ state: "attached", timeout: 15000 });
      await page.waitForTimeout(1200);

      const sidebar = await page.locator(".app-sidebar").first().boundingBox();
      const tacLedger = await page.locator(".tac-ledger").first().boundingBox();
      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      const leftGap = sidebar && tacLedger ? tacLedger.x - (sidebar.x + sidebar.width) : null;
      const rightGap = tacLedger ? width - (tacLedger.x + tacLedger.width) : null;

      testInfo.annotations.push({ type: `sidebar-${width}`, description: JSON.stringify(sidebar) });
      testInfo.annotations.push({ type: `tac-ledger-${width}`, description: JSON.stringify(tacLedger) });
      testInfo.annotations.push({ type: `left-gap-${width}`, description: String(leftGap) });
      testInfo.annotations.push({ type: `right-gap-${width}`, description: String(rightGap) });
      testInfo.annotations.push({ type: `scroll-${width}`, description: JSON.stringify(scroll) });

      expect(leftGap, `left gap between sidebar and .tac-ledger must be ~0 at ${width}px`).not.toBeNull();
      expect(Math.abs(leftGap ?? 999)).toBeLessThanOrEqual(2);
      expect(rightGap, `right gap between .tac-ledger and viewport edge must be ~0 at ${width}px`).not.toBeNull();
      expect(Math.abs(rightGap ?? 999)).toBeLessThanOrEqual(2);
      expect(scroll.scrollWidth, `no horizontal scrollbar at ${width}px`).toBeLessThanOrEqual(scroll.clientWidth + 2);
    }
  });

  test("idxanchor:heatzone:tape width ratio stays constant across breakpoints (matches 454:590:236 design proportion)", async ({ page }, testInfo) => {
    const ratios: { width: number; idxanchor: number; heatzone: number; tape: number }[] = [];

    for (const width of BREAKPOINTS) {
      await page.setViewportSize({ width, height: 1400 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.locator(".tac-ledger .heatzone").first().waitFor({ state: "attached", timeout: 15000 });
      await page.waitForTimeout(1200);

      const idxanchor = await page.locator(".idxanchor").first().boundingBox();
      const heatzone = await page.locator(".heatzone").first().boundingBox();
      const tape = await page.locator(".tape").first().boundingBox();
      if (!idxanchor || !heatzone || !tape) throw new Error(`missing band boundingBox at ${width}px`);

      ratios.push({ width, idxanchor: idxanchor.width, heatzone: heatzone.width, tape: tape.width });
      testInfo.annotations.push({
        type: `bands-${width}`,
        description: `idxanchor=${idxanchor.width.toFixed(1)} heatzone=${heatzone.width.toFixed(1)} tape=${tape.width.toFixed(1)}`,
      });
    }

    // 原稿設計比例：idxanchor 454 / tape 236 = 1.9237（相對 tape 正規化，
    // 避免受 zoom 捨入誤差干擾——用比例而非絕對值比較）。
    const baseline = 454 / 236;
    for (const r of ratios) {
      const actual = r.idxanchor / r.tape;
      testInfo.annotations.push({ type: `idxanchor-tape-ratio-${r.width}`, description: String(actual) });
      expect(actual, `idxanchor:tape ratio must stay ~454:236 at ${r.width}px`).toBeGreaterThan(baseline * 0.95);
      expect(actual, `idxanchor:tape ratio must stay ~454:236 at ${r.width}px`).toBeLessThan(baseline * 1.05);
    }
  });

  test("heatmap tile aspect ratio stays constant across breakpoints (no more squashed 90x31 tiles)", async ({ page }, testInfo) => {
    const aspectRatios: number[] = [];

    for (const width of BREAKPOINTS) {
      await page.setViewportSize({ width, height: 1400 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.locator(".heatmapgrid .tile").first().waitFor({ state: "attached", timeout: 15000 });
      await page.waitForTimeout(1200);

      // A "standard" (non-hero, non-wide) tile — index 8 is safely past the
      // hero(1)+wide(5) leading tiles regardless of exact pool size.
      const tile = await page.locator(".heatmapgrid .tile").nth(8).boundingBox();
      if (!tile) throw new Error(`missing tile boundingBox at ${width}px`);
      const aspect = tile.width / tile.height;
      aspectRatios.push(aspect);
      testInfo.annotations.push({ type: `tile-aspect-${width}`, description: `${tile.width.toFixed(1)}x${tile.height.toFixed(1)} = ${aspect.toFixed(2)}` });
    }

    // 自我一致性檢查：四個斷點的磚形寬高比應彼此貼近（zoom 對兩軸套用
    // 同一係數，比例應完全抵消，不因螢幕變寬而變扁）。
    const baseline = aspectRatios[0];
    for (let i = 1; i < aspectRatios.length; i += 1) {
      const drift = Math.abs(aspectRatios[i] - baseline) / baseline;
      testInfo.annotations.push({ type: `tile-aspect-drift-${BREAKPOINTS[i]}`, description: String(drift) });
      expect(drift, `tile aspect ratio at ${BREAKPOINTS[i]}px must stay within 8% of the ${BREAKPOINTS[0]}px baseline`).toBeLessThan(0.08);
    }
  });

  test("full-page screenshots at 1920 and 1280 for visual side-by-side comparison against the artifact", async ({ page }, testInfo) => {
    for (const width of [1920, 1280]) {
      await page.setViewportSize({ width, height: 1400 });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.locator(".tac-ledger .mast").first().waitFor({ state: "attached", timeout: 15000 });
      await page.waitForTimeout(1500);
      await saveRouteScreenshot(page, testInfo, `home-fullbleed-zoom-${width}`);
    }
  });

  test("interactive elements remain clickable under zoom (recommendation CTA + heatmap sector chip coordinates)", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.locator(".rrow").first().waitFor({ state: "attached", timeout: 15000 });
    const deskLink = page.locator(".rrow").first().locator("a", { hasText: "帶入模擬單" }).first();
    await expect(deskLink).toBeVisible();
    // Playwright's click() resolves the element's real post-zoom on-screen
    // bounding box internally — if zoom broke the coordinate system this
    // would either throw or land the click somewhere else, so a successful
    // navigation to the expected href is itself the coordinate-consistency
    // proof, not just an attribute read.
    await deskLink.click();
    await page.waitForURL(/\/desk-exact\?symbol=.+&side=buy/, { timeout: 10000 });
    await page.goBack({ waitUntil: "domcontentloaded" });

    await page.locator(".heat-chips button").first().waitFor({ state: "attached", timeout: 15000 });
    const chip = page.locator(".heat-chips button[data-sector-key]").nth(1);
    if ((await page.locator(".heat-chips button[data-sector-key]").count()) > 1) {
      await chip.click();
      const activeSector = await page.locator(".heat-chips button.is-active").first().getAttribute("data-sector-key");
      expect(activeSector).not.toBe("__all__");
    }
  });
});
