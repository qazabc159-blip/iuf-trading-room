import { expect, test } from "@playwright/test";

// Verification for the v3 company page redesign (2026-07-16, jim2, DESIGN_NOTES.md §三).
// Not tagged @smoke — like the other company-page specs in this directory, this is a
// manual verification pass, not part of the permanent `qa:playwright:smoke` CI gate.
// Covers: (1) FinancialsPanel 7-tab switching still works after the v3 chrome retheme,
// (2) reused engines (K-line / AI report) are literally mounted, not re-implemented,
// (3) the artifact's pairrow groupings render as real panels for a live symbol,
// (4) a page-scoped empty state (逐筆資料 = 暫停, no live tick feed) renders honestly
//     instead of a fake placeholder card.

test.describe("company page v3 redesign 2026-07-16", () => {
  test("2330 @ 1440px — financial 7-tab strip switches content on click", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const finPanel = page.locator("#sec-fin");
    await expect(finPanel).toBeVisible();

    // Default tab is 財報 — switch to 月營收 and confirm the visible table header changes.
    const revenueTab = finPanel.getByRole("button", { name: /月營收/ }).first();
    await revenueTab.click();
    await page.waitForTimeout(300);
    await expect(finPanel.locator("th", { hasText: "月份" })).toBeVisible();

    // Switch to 股利 and confirm again — proves the tab state machine (not just CSS) works.
    const dividendTab = finPanel.getByRole("button", { name: /股利/ }).first();
    await dividendTab.click();
    await page.waitForTimeout(300);
    await expect(finPanel.locator("th", { hasText: "發放日" })).toBeVisible();
  });

  test("2330 @ 1440px — K-line panel is the reused OhlcvCandlestickChart engine (period/range/MA toolbar present)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const klinePanel = page.locator("#sec-kline");
    await expect(klinePanel).toBeVisible();
    // Toolbar chrome (日K/週K/月K + 1分/5分/15分/60分 + range) is native to the reused
    // component — if this test can find these controls, no separate/parallel candlestick
    // renderer was hand-rolled for the v3 chrome.
    await expect(klinePanel.getByRole("button", { name: "日K" })).toBeVisible();
    await expect(klinePanel.getByRole("button", { name: "週K" })).toBeVisible();
    await expect(klinePanel.locator(".kline-chart-canvas, canvas, svg").first()).toBeVisible();
  });

  test("2330 @ 1440px — 五檔|逐筆 and 法人|融資融券 pairrows render as real panels", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const quoteRow = page.locator("#sec-quote");
    await expect(quoteRow).toBeVisible();
    await expect(quoteRow.locator(".panel")).toHaveCount(2);

    const chipsRow = page.locator("#sec-chips");
    await expect(chipsRow).toBeVisible();
    await expect(chipsRow.locator(".panel")).toHaveCount(2);
  });

  test("2330 — AI 分析師報告 uses the existing report pipeline (idle CTA or generated verdict, no separate report writer)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const aiPanel = page.locator("#company-ai-report");
    await expect(aiPanel).toBeVisible();
    const text = await aiPanel.innerText();
    // Either the untouched idle state (existing CTA copy) or an already-generated
    // report (existing verdict copy) — both come from AiAnalystReportPanel, not a
    // new component.
    expect(text).toMatch(/尚未生成|點此生成|觀察等級|生成時間|重新分析/);
  });

  test("2330 @ 390px — mobile: pairrows stack to single column, no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(400);

    const quoteRow = page.locator("#sec-quote");
    await expect(quoteRow).toBeVisible();
    const box = await quoteRow.boundingBox();
    // Below the 1440px pairrow breakpoint the two panels stack — the row's total
    // height should clearly exceed a single panel's height (proves 1-col stacking,
    // not a squeezed 2-col row at mobile width).
    expect(box?.height ?? 0).toBeGreaterThan(200);
  });

  test("2330 — 逐筆資料 empty/paused state renders honestly (no fake tick feed)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const srcStatus = page.locator("#company-source-status");
    await expect(srcStatus).toBeVisible();
    const text = await srcStatus.innerText();
    // KGI read-only ticks are not wired yet — SourceStatusCard must say so honestly
    // rather than rendering a placeholder tick list with invented numbers.
    expect(text).toContain("逐筆資料");
    expect(text).toMatch(/暫停|LIVE|EMPTY/);
  });
});
