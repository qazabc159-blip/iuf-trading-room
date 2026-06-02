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

function isTradingRoomQuoteRead(url: string): boolean {
  if (url.includes("/api/v1/kgi/quote/")) return true;
  if (/\/api\/v1\/companies\/[^/]+\/quote\/realtime/.test(url)) return true;

  try {
    const parsed = new URL(url);
    const proxiedPath = parsed.searchParams.get("path") ?? "";
    return (
      proxiedPath.includes("/api/v1/kgi/quote/") ||
      /\/api\/v1\/companies\/[^/]+\/quote\/realtime/.test(proxiedPath)
    );
  } catch {
    return false;
  }
}

test("/portfolio trading room keeps K-line stable while live quote pulse reads real endpoints @smoke", async ({ page }, testInfo) => {
  test.setTimeout(90_000);

  const quoteReads: Array<{ url: string; status: number }> = [];
  const consoleErrors: string[] = [];

  page.on("response", (response) => {
    const url = response.url();
    if (isTradingRoomQuoteRead(url)) {
      quoteReads.push({ url, status: response.status() });
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/api/ui-final-v031/paper-trading-room?symbol=2330&rev=qa-live-pulse-smoke", {
    waitUntil: "domcontentloaded",
  });
  await expectNoServerError(page);
  await expect(page.locator(".troom")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#real-kline-frame")).toBeVisible({ timeout: 30_000 });

  await page.waitForFunction(
    () => Boolean((window as { __IUF_FINAL_V031_QUOTE_PULSE_STARTED__?: boolean }).__IUF_FINAL_V031_QUOTE_PULSE_STARTED__),
    { timeout: 45_000 },
  );
  await expect
    .poll(() => quoteReads.length, {
      message: "live quote pulse must read quote/bidask/ticks endpoints",
      timeout: 45_000,
    })
    .toBeGreaterThanOrEqual(2);

  const before = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>("#real-kline-frame");
    const iufWindow = window as typeof window & {
      __IUF_FINAL_V031_QUOTE_PULSE_STARTED__?: boolean;
      __IUF_FINAL_V031_LIVE_REFRESH_STARTED__?: boolean;
      __IUF_FINAL_V031_QUOTE_PULSE_ERROR__?: string | null;
      __IUF_FINAL_V031_LIVE__?: { selected?: { symbol?: string } };
    };
    return {
      frameSrc: frame?.getAttribute("src") ?? null,
      pulseStarted: Boolean(iufWindow.__IUF_FINAL_V031_QUOTE_PULSE_STARTED__),
      fullRefreshStarted: Boolean(iufWindow.__IUF_FINAL_V031_LIVE_REFRESH_STARTED__),
      pulseError: iufWindow.__IUF_FINAL_V031_QUOTE_PULSE_ERROR__ ?? null,
      symbol: iufWindow.__IUF_FINAL_V031_LIVE__?.selected?.symbol ?? null,
    };
  });

  await page.waitForTimeout(6_500);
  const afterFrameSrc = await page.evaluate(
    () => document.querySelector<HTMLIFrameElement>("#real-kline-frame")?.getAttribute("src") ?? null,
  );

  expect(before.symbol, "trading room should load the selected symbol").toBe("2330");
  expect(before.pulseStarted, "live quote pulse must start in the trading room").toBe(true);
  expect(before.fullRefreshStarted, "full live refresh guard must start once").toBe(true);
  expect(before.pulseError, "quote pulse should not throw client errors").toBeNull();
  expect(afterFrameSrc, "quote pulse must not reload or change the real K-line iframe").toBe(before.frameSrc);

  expect(quoteReads.length, "live quote pulse must read quote/bidask/ticks endpoints").toBeGreaterThanOrEqual(2);
  expect(
    quoteReads.filter((entry) => entry.status === 401 || entry.status === 403),
    "owner-session trading room quote reads must not be blocked by auth",
  ).toEqual([]);
  expect(
    quoteReads.filter((entry) => entry.status >= 500 || entry.status === 404),
    "trading room quote reads must not hit missing or server-error endpoints",
  ).toEqual([]);
  expect(
    consoleErrors.filter((line) => /401|403|Application error|server-side exception/i.test(line)),
    "trading room must not surface auth/server console errors while reading live quotes",
  ).toEqual([]);

  await saveRouteScreenshot(page, testInfo, "portfolio-live-pulse");
});

test("/portfolio supports 5-symbol handoff, visible ticket update, indicator toggles, and paper preview", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);

  for (const symbol of SYMBOLS) {
    const lookup = await fetchJson<LookupResponse>(request, `/api/v1/companies/lookup?q=${symbol}`);
    expect(JSON.stringify(lookup), `lookup must resolve ${symbol}`).toContain(symbol);

    await page.goto(`/portfolio?symbol=${symbol}`, { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);
    await expect(page.locator("iframe")).toHaveCount(1);

    const frame = extractFrame(page);
    await expect(frame.locator(".symhead .sym"), `portfolio header must switch to selected symbol ${symbol}`).toContainText(symbol, {
      timeout: 30_000,
    });
    await expect(frame.locator("#t-sym"), `paper ticket must switch to selected symbol ${symbol}`).toHaveValue(new RegExp(symbol), {
      timeout: 30_000,
    });
    await expect(frame.locator("body")).toContainText(/委託|Paper|紙上|買進|LONG/i);

    const klineFrame = frame.frameLocator("#real-kline-frame");
    await expect(frame.locator("#real-kline-frame"), "real K-line frame must be mounted").toBeVisible({ timeout: 30_000 });

    for (const selector of ["button._ind-toggle-btn._ma20", "button._ind-toggle-btn._vwap"]) {
      const toggle = klineFrame.locator(selector).first();
      await expect(toggle, `${selector} must be a visible real chart toggle`).toBeVisible({ timeout: 30_000 });
      const before = await toggle.getAttribute("aria-pressed");
      expect(before, `${selector} must expose pressed state`).toMatch(/^(true|false)$/);
      await toggle.click();
      await expect(toggle, `${selector} must change state after click`).toHaveAttribute(
        "aria-pressed",
        before === "true" ? "false" : "true",
      );
      await toggle.click();
      await expect(toggle, `${selector} must restore state after second click`).toHaveAttribute("aria-pressed", before ?? "true");
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
