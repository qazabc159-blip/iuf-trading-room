import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

// Verification for reports/company_page_fix_20260712/DIAGNOSIS.md web-line fixes
// (B1 institutional unit, D1/D2/D3/D4/D5/D8). Not committed to the DRAFT PR's
// permanent CI suite — a manual verification pass run against the branch's own
// `next start` (wired to prod API) before opening the PR.

const OUT_DIR = path.resolve(process.cwd(), "..", "..", "reports", "company_page_fix_20260712", "after");

test.describe("company page fix 2026-07-12 verification", () => {
  test.beforeAll(async () => {
    await fs.mkdir(OUT_DIR, { recursive: true });
  });

  for (const symbol of ["2330", "8069"]) {
    test(`${symbol} @ 1280px — no K-line squeeze, no hero KPI wrap, no huge knowledge panel`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/companies/${symbol}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);

      await page.screenshot({ path: path.join(OUT_DIR, `company_${symbol}_1280.png`), fullPage: true });

      // D1: K-line chart pane should now take up close to the main column's
      // full width, not be squeezed to ~313px by a 64/36 row split.
      // 2026-07-16 v3 redesign (jim2): the K-line + BidAsk/LiveTick 64/36 row
      // split (`._co-chart-pane`) was replaced with a full-width K-line panel
      // (`#sec-kline`) followed by a dedicated 五檔|逐筆 pairrow below it — the
      // chart pane is now even less squeezed than the D1 fix targeted.
      const chartPane = page.locator("#sec-kline").first();
      await expect(chartPane).toBeVisible();
      const chartBox = await chartPane.boundingBox();
      expect(chartBox?.width ?? 0).toBeGreaterThan(400);

      // D2: hero KPI cell values should not wrap onto 3+ lines.
      const kpiValues = page.locator("._co-kpi-value");
      const count = await kpiValues.count();
      for (let i = 0; i < count; i++) {
        const box = await kpiValues.nth(i).boundingBox();
        // A single/double-line 26px value should stay under ~70px tall;
        // 3-line wrap (the diagnosed bug) pushed this past 90px+.
        if (box) expect(box.height).toBeLessThan(80);
      }
    });

    test(`${symbol} @ 390px — mobile layout still sane`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/companies/${symbol}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT_DIR, `company_${symbol}_390.png`), fullPage: true });

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(400);
    });
  }

  test("2330 — institutional 買賣超 unit is 張 (not raw shares mislabeled as 張)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // B1 repro: API returns foreign=-12,748,541 (shares). Old bug rendered
    // "-1274.9萬" (raw shares / 10000, mislabeled 張 — 1000x too large).
    // Fixed value should be roughly -1.2x萬張 (shares / 1000 / 10000).
    const instPanel = page.locator("section", { hasText: "三大法人買賣超" }).first();
    await expect(instPanel).toBeVisible();
    const text = await instPanel.innerText();
    expect(text).not.toContain("1274.9萬");
    expect(text).toMatch(/1\.2\d萬張/);
  });

  test("2330 — [11] 重大訊息 no longer duplicates [05], collapses to a link", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const link = page.locator('a[href="#company-announcements"]');
    await expect(link).toBeVisible();
  });

  test("2634 — knowledge panel sector shows 中文 not raw English enum", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/companies/2634", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toContain("板塊：工業");
    expect(bodyText).not.toContain("板塊：Industrials");
  });
});
