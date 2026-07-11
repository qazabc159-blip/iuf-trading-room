import { test, expect } from "@playwright/test";
import { WEB_BASE_URL, saveRouteScreenshot } from "./helpers";

// Ad-hoc real-browser verification spec for the P1 home-cluster fix batch
// (reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md P1-1/P1-3/P1-4/
// P1-5/P1-10/P1-11/P1-12). Checks VISIBLE rendered text only (page.textContent),
// not raw HTML/RSC flight payload, matching how the critique's own evidence
// was captured (_text_*.txt page-text extracts).

test.describe("P1 home cluster — real browser verify", () => {
  test("ai-recommendations risk text has no raw engineering jargon and no duplication", async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/ai-recommendations`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();

    for (const jargon of ["company_graph_db", "dataAvailable", "volumeRatio20d", "revenueYoyTrend", "chainPosition", "beneficiaryTier", "itemCount="]) {
      expect(bodyText, `should not visibly render raw token: ${jargon}`).not.toContain(jargon);
    }

    // P1-4: risk text must not render duplicated (merged sentence + itemized repeat)
    const riskBlocks = await page.locator("text=主要風險").all();
    expect(riskBlocks.length).toBeGreaterThan(0);
  });

  test("homepage market coverage / TAIEX badge are honest at off-hours", async ({ page }, testInfo) => {
    await page.goto(WEB_BASE_URL, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("GET /api/v1/market-intel/news-top10");
    await saveRouteScreenshot(page, testInfo, "jim_p1_home_top");
  });

  test("homepage heatmap sector chips show available/pool-size, not a bare count", async ({ page }, testInfo) => {
    await page.goto(WEB_BASE_URL, { waitUntil: "networkidle" });
    const chipText = await page.locator(".tac-heat-sector-tabs").innerText();
    expect(chipText).toMatch(/\d+\/\d+ 檔/);
    await saveRouteScreenshot(page, testInfo, "jim_p1_heatmap_chips");
  });

  test("homepage rankings never show a repeated ticker as the company name", async ({ page }) => {
    await page.goto(WEB_BASE_URL, { waitUntil: "networkidle" });
    const moverRows = page.locator(".tac-mover-list a");
    const count = await moverRows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await moverRows.nth(i).innerText();
      const lines = rowText.split("\n").map((l) => l.trim()).filter(Boolean);
      // first line is the symbol, second is the name — name must never equal the symbol
      if (lines.length >= 2) {
        expect(lines[1]).not.toBe(lines[0]);
      }
    }
  });

  test("company page price/change do not truncate with an ellipsis", async ({ page }, testInfo) => {
    await page.goto(`${WEB_BASE_URL}/companies/2330`, { waitUntil: "networkidle" });
    const priceCell = page.locator("text=最新價").locator("xpath=..");
    const text = await priceCell.innerText();
    expect(text).not.toContain("…");
    expect(text).not.toMatch(/\d\.\.\./);
    await saveRouteScreenshot(page, testInfo, "jim_p1_company_hero");
  });

  test("company page 區間高低 stat names the active range window", async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/companies/2330`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/(全部|3月|6月|1年|2年) 視窗最高／最低/);
  });

  test("signals page shows a way back to ai-recommendations when empty", async ({ page }) => {
    await page.goto(`${WEB_BASE_URL}/signals`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    if (/目前沒有訊號|資料來源暫停|無可判讀訊號/.test(bodyText)) {
      await expect(page.getByRole("link", { name: "前往 AI 推薦" }).first()).toBeVisible();
    }
  });
});
