import { expect, test } from "@playwright/test";
import { extractFrame } from "./helpers";

/**
 * 量化策略頁 v9.1 驗收（2026-07-19，Jim-6）。
 *
 * 楊董 ACK：內容照 v9.1 fact-sheet 定稿（0 運行績效數字），視覺借首頁「戰情
 * 台」語言。本檔驗證：①目錄頁兩張策略卡都真的渲染 ②三個里程碑日期
 * （07/13／08/03／08/12）確實出現在畫面上 ③首頁新的里程碑迷你卡點擊仍然
 * 正確導向 /quant-strategies（`.qmini-wrap`，v9.1 命名整潔後的 class）。
 *
 * Pete review #1311 round 2 🟡1：補 `@smoke` tag——CI `qa:playwright:smoke`
 * 只跑 `--grep @smoke`（`.github/workflows/ci.yml` Playwright P0 job），PR
 * 事件會先在本機 `next dev -p 3300` 起一份「這個 PR 自己的程式碼」再跑，跟
 * 本檔案本機驗證方式（`next start` + prod API + owner session）同一套流程，
 * 掛 tag 前已用同款流程本機驗證過三個測試皆綠。
 */
test.describe("/quant-strategies v9.1 fact-sheet @smoke", () => {
  test("directory page renders both v9.1 strategy cards with milestone dates", async ({ page }) => {
    await page.goto("/quant-strategies", { waitUntil: "domcontentloaded" });

    await expect(page.locator(".page-frame")).toBeVisible();

    const cards = page.locator('[data-testid="quant-strategy-card"]');
    await expect(cards).toHaveCount(2);

    await expect(page.getByText("基本面動能")).toBeVisible();
    await expect(page.getByText("趨勢延續")).toBeVisible();

    // 里程碑三步日期（07/13 SIM 觀察起 / 08/03 排程首組合 / 08/12 真金試點）。
    await expect(page.getByText("07/13")).toBeVisible();
    await expect(page.getByText("08/03")).toBeVisible();
    await expect(page.getByText("08/12")).toBeVisible();

    // 0 運行績效數字：淨值曲線只做「將揭露」空位。
    await expect(page.getByText("淨值曲線 · 將揭露").first()).toBeVisible();
  });

  test("detail page renders the selected strategy's own milestones", async ({ page }) => {
    await page.goto("/quant-strategies/trend-continuation", { waitUntil: "domcontentloaded" });

    await expect(page.locator(".page-frame")).toBeVisible();
    await expect(page.getByRole("heading", { name: "趨勢延續" })).toBeVisible();
    await expect(page.getByText("08/03")).toBeVisible();
  });

  test("home quant mini card click still navigates top-level to /quant-strategies", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);

    await frame.locator(".qmini-wrap").first().waitFor({ state: "attached", timeout: 15000 });
    await expect(frame.locator(".qmini-wrap").first().getByText("基本面動能")).toBeVisible();

    await frame.locator(".qmini-wrap").first().click();
    await page.waitForURL(/\/quant-strategies/, { timeout: 10000 });
    testInfo.annotations.push({ type: "url-after-click", description: page.url() });
    expect(page.url()).toContain("/quant-strategies");
  });
});
