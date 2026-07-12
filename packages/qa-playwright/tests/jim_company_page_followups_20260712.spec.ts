import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

// Verification for the 2026-07-12 company page followups batch (item 2:
// .company-data-table-fit mobile card mislabeling on [06]-[10] +
// FinancialsPanel.tsx's non-財報 tabs). Not committed to the DRAFT PR's
// permanent CI suite — a manual verification pass run against a local
// `next start` (wired to prod API) before opening the PR.

const OUT_DIR = path.resolve(process.cwd(), "..", "..", "reports", "company_page_followups_20260712", "after");

test.describe("company page followups 2026-07-12 — mobile card labels", () => {
  test.beforeAll(async () => {
    await fs.mkdir(OUT_DIR, { recursive: true });
  });

  // Reads each <td data-label> attribute directly rather than screen-scraping
  // .innerText() — Playwright's innerText() does not reliably surface CSS
  // ::before generated content (content: attr(data-label)) even though it
  // renders correctly on screen (confirmed via the screenshots this spec
  // also captures), so asserting on the attribute itself is both the more
  // direct check of the actual fix and avoids that innerText() false-negative.

  test("2330 @ 390px — [08] 法人籌碼 mobile card td[data-label] matches its OWN headers (日期/外資/投信/自營商/合計), not 財報's", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const section = page.locator("section", { hasText: "法人籌碼" }).first();
    await expect(section).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: path.join(OUT_DIR, "company_2330_390_institutional_card.png") });

    const table = section.locator("table.company-data-table-fit").first();
    const labels = await table.locator("tbody tr").first().locator("td").evaluateAll((tds) => tds.map((td) => td.getAttribute("data-label")));
    // Old bug: nth-child hardcoded 財報's 6-column labels (期別/營收/毛利率/
    // 營益率/EPS/年增率) onto every table sharing .company-data-table-fit —
    // a date column would have been mislabeled "期別" and a foreign-buy
    // column mislabeled "營收" instead of its own "日期"/"外資".
    expect(labels).toEqual(["日期", "外資", "投信", "自營商", "合計"]);
  });

  test("2330 @ 390px — [10] 股利政策 mobile card td[data-label] matches its OWN headers (年度/現金股利/股票股利/總股利/公告日)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const section = page.locator("section", { hasText: "股利政策" }).first();
    await expect(section).toBeVisible();
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: path.join(OUT_DIR, "company_2330_390_dividend_card.png") });

    const table = section.locator("table.company-data-table-fit").first();
    const labels = await table.locator("tbody tr").first().locator("td").evaluateAll((tds) => tds.map((td) => td.getAttribute("data-label")));
    expect(labels).toEqual(["年度", "現金股利", "股票股利", "總股利", "公告日"]);
  });

  test("2330 @ 390px — [03] 財報與估值 月營收 tab mobile card td[data-label] matches 月份/營收, not 期別/毛利率", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/companies/2330", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // Switch FinancialsPanel's tab strip to 月營收.
    const revenueTab = page.getByRole("tab", { name: /月營收/ }).first();
    await revenueTab.click();
    await page.waitForTimeout(500);

    const panel = page.locator(".company-finance-console").first();
    await expect(panel).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: path.join(OUT_DIR, "company_2330_390_revenue_tab_card.png") });

    const table = panel.locator("table.company-data-table-fit").first();
    const labels = await table.locator("tbody tr").first().locator("td").evaluateAll((tds) => tds.map((td) => td.getAttribute("data-label")));
    expect(labels).toEqual(["月份", "營收", "代號", "國別"]);
  });
});
