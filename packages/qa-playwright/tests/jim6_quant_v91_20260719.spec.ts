import { expect, test } from "@playwright/test";

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
 * 事件會先在本機 `next dev -p 3300` 起一份「這個 PR 自己的程式碼」再跑。
 * 掛上 tag 後第一次在真 CI 跑，抓到兩個本機驗證沒抓到的問題（本機驗證只做
 * 了 HTML grep + 手動注入 cookie 的截圖，沒跑過真的 Playwright locator 斷
 * 言，這次補上教訓）：
 * ①`getByText("08/03")` 對同一頁同時命中卡片「下一個動作」文字與
 * MilestoneTrack 里程碑列的日期 span，觸發 strict-mode violation——改用
 * `.first()` 或更精確的容器 scope。
 * ②首頁不是用 `<iframe>` 呈現（2026-07-14 楊董終令重做為原生 server
 * component，見 apps/web/app/page.tsx 檔頭註記），沿用其他首頁測試檔的
 * `extractFrame()` pattern 是錯的——那兩份既有測試檔本身也沒有 `@smoke`
 * tag，从未在真 CI 跑過，這裡才第一次真的暴露出這個既有的過時假設。本檔
 * 改直接對 `page` 操作，不透過 iframe。
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
    // 同一張卡的「下一個動作」文字跟 MilestoneTrack 列都可能各自出現同一組
    // 日期，用 .first() 避免 strict-mode 多重命中報錯。
    await expect(page.getByText("07/13").first()).toBeVisible();
    await expect(page.getByText("08/03").first()).toBeVisible();
    await expect(page.getByText("08/12").first()).toBeVisible();

    // 0 運行績效數字：淨值曲線只做「將揭露」空位。
    await expect(page.getByText("淨值曲線 · 將揭露").first()).toBeVisible();
  });

  test("detail page renders the selected strategy's own milestones", async ({ page }) => {
    await page.goto("/quant-strategies/trend-continuation", { waitUntil: "domcontentloaded" });

    await expect(page.locator(".page-frame")).toBeVisible();
    await expect(page.getByRole("heading", { name: "趨勢延續" })).toBeVisible();
    await expect(page.getByText("08/03").first()).toBeVisible();
  });

  test("home quant mini card click still navigates top-level to /quant-strategies", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const quantMini = page.locator(".qmini-wrap").first();
    await quantMini.waitFor({ state: "attached", timeout: 15000 });
    await expect(quantMini.getByText("基本面動能")).toBeVisible();

    await quantMini.click();
    await page.waitForURL(/\/quant-strategies/, { timeout: 10000 });
    testInfo.annotations.push({ type: "url-after-click", description: page.url() });
    expect(page.url()).toContain("/quant-strategies");
  });
});
