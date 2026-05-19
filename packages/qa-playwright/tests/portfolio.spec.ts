import { expect, test } from "@playwright/test";
import {
  API_BASE_URL,
  expectNoServerError,
  extractFrame,
  fetchJson,
  saveRouteScreenshot
} from "./helpers";

type LookupResponse = { items?: Array<{ ticker?: string; symbol?: string; name?: string }> };
type PreviewResponse = { data?: { blocked?: boolean; riskCheck?: { decision?: string }; quoteGate?: { decision?: string } } };

const SYMBOLS = ["2330", "2454", "2317", "1809", "1723"];

test("/portfolio supports 5-symbol handoff, visible ticket update, indicator toggles, and paper preview", async ({ page, request }, testInfo) => {
  for (const symbol of SYMBOLS) {
    const lookup = await fetchJson<LookupResponse>(request, `/api/v1/companies/lookup?q=${symbol}`);
    expect(JSON.stringify(lookup), `lookup must resolve ${symbol}`).toContain(symbol);

    await page.goto(`/portfolio?symbol=${symbol}`, { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);
    await expect(page.locator("iframe")).toHaveCount(1);

    const frame = extractFrame(page);
    await expect(frame.locator("body"), `portfolio iframe must show selected symbol ${symbol}`).toContainText(symbol);
    await expect(frame.locator("body")).toContainText(/委託|Paper|紙上|買進|LONG/i);

    for (const label of ["MA20", "VWAP"]) {
      const toggle = frame.getByText(label, { exact: true }).first();
      if (await toggle.count()) {
        await toggle.click();
        await toggle.click();
      }
    }
  }

  const preview = await request.post(`${API_BASE_URL}/api/v1/paper/preview`, {
    data: {
      idempotencyKey: `qa-preview-${Date.now()}`,
      symbol: "2330",
      side: "buy",
      orderType: "limit",
      qty: 1,
      quantity_unit: "SHARE",
      price: 2240
    }
  });
  expect(preview.ok(), `paper preview must return 2xx, got ${preview.status()}`).toBeTruthy();
  const previewJson = (await preview.json()) as PreviewResponse;
  expect(previewJson.data?.riskCheck?.decision, "paper preview must run real risk check").toBeTruthy();

  await saveRouteScreenshot(page, testInfo, "portfolio");
});
