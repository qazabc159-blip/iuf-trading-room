import { expect, test, type Page, type Route } from "@playwright/test";
import { extractFrame, saveRouteScreenshot } from "./helpers";

/**
 * /desk-exact 主報價 header + 自選清單 twse_mis fallback（2026-07-16 診斷病灶 #1）
 * + 下單票委託價動態 seed（病灶 #2）+「今日委託」台北日過濾（病灶 #3）。
 *
 * `apiFetch()` in public/desk-exact/index.html always calls through the
 * same-origin Next.js proxy `/api/ui-final-v031/backend?path=<encoded inner
 * path+query>` — no cross-origin CORS wall like the direct-to-backend ticker
 * tape tests, so these mocks intercept that one proxy route and dispatch on
 * the decoded inner path, leaving every other endpoint (capital, depth,
 * chart, ledger tabs) to hit the real backend exactly like the existing
 * jim_desk_exact_preview_20260714.spec.ts submit test does.
 */

const DESKTOP_PROJECT = "desktop-chromium";
const WL_SYMBOLS = ["2330", "2454", "2382", "2317", "3661", "2881", "3035", "2618", "3443", "2308"];

function decodeInnerPath(routeUrl: string): { innerPath: string; innerParams: URLSearchParams } {
  const outer = new URL(routeUrl);
  const inner = outer.searchParams.get("path") || "";
  const [innerPath, innerQuery] = inner.split("?");
  return { innerPath: innerPath || "", innerParams: new URLSearchParams(innerQuery || "") };
}

function tickFixture(close: number, prevClose: number) {
  return {
    data: {
      ticks: [
        {
          close,
          price_chg: close - prevClose,
          pct_chg: ((close - prevClose) / prevClose) * 100,
          open: close - 1,
          high: close + 2,
          low: close - 3,
          total_volume: 12345000
        }
      ]
    }
  };
}

function effectiveQuoteItem(symbol: string, last: number, prevClose: number, freshnessStatus: "fresh" | "stale" = "fresh") {
  return {
    symbol,
    market: "TW",
    selectedSource: "twse_mis",
    selectedQuote: {
      symbol,
      market: "TW",
      source: "twse_mis",
      last,
      bid: last - 0.5,
      ask: last + 0.5,
      open: last - 1,
      high: last + 2,
      low: last - 3,
      prevClose,
      volume: 9876000,
      changePct: ((last - prevClose) / prevClose) * 100,
      timestamp: new Date().toISOString(),
      ageMs: 5000,
      isStale: freshnessStatus === "stale"
    },
    freshnessStatus,
    fallbackReason: "none",
    staleReason: "none",
    readiness: "degraded"
  };
}

// Deterministic per-symbol fixture price so watchlist rows differ visibly.
function fallbackPriceFor(symbol: string) {
  const i = WL_SYMBOLS.indexOf(symbol);
  const last = 100 + (i >= 0 ? i : 0) * 10 + 0.5;
  return { last, prevClose: last - 1.5 };
}

async function mockDeskBackend(
  page: Page,
  opts: {
    ticksMode: "healthy" | "down";
    effectiveQuotesFreshness?: "fresh" | "stale";
  }
) {
  await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
    const { innerPath, innerParams } = decodeInnerPath(route.request().url());

    if (innerPath === "/api/v1/kgi/quote/ticks") {
      if (opts.ticksMode === "healthy") {
        const symbol = innerParams.get("symbol") || "2330";
        const { last, prevClose } = fallbackPriceFor(symbol);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tickFixture(last, prevClose)) });
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "QUOTE_NOT_AVAILABLE", message: "No quote data (mocked KGI outage)." })
      });
      return;
    }

    if (innerPath === "/api/v1/market-data/effective-quotes") {
      const symbols = (innerParams.get("symbols") || "").split(",").filter(Boolean);
      const items = symbols.map((sym) => {
        const { last, prevClose } = fallbackPriceFor(sym);
        return effectiveQuoteItem(sym, last, prevClose, opts.effectiveQuotesFreshness ?? "fresh");
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items } }) });
      return;
    }

    await route.continue();
  });
}

test.describe("/desk-exact quote fallback + ticket price seed + today-orders filter", () => {
  test("KGI ticks healthy: header + watchlist render from ticks, ticket price seeds from tick close", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await mockDeskBackend(page, { ticksMode: "healthy" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(4000);

    const symState = await frame.locator('[data-slot="sym-state"]').first().textContent();
    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const wl2454 = await frame.locator('[data-slot="wl-v-2454"]').first().textContent();
    const ticketPrice = await frame.locator('[data-slot="t-price"]').first().inputValue();

    testInfo.annotations.push({ type: "sym-state", description: String(symState) });
    testInfo.annotations.push({ type: "sym-price", description: String(symPrice) });
    testInfo.annotations.push({ type: "wl-v-2454", description: String(wl2454) });
    testInfo.annotations.push({ type: "ticket-price", description: String(ticketPrice) });

    const expected2330 = fallbackPriceFor("2330");
    const expected2454 = fallbackPriceFor("2454");
    expect(symState, "header shows the KGI tick label when ticks are healthy (not the fallback label)").toBe("即時 tick");
    expect(symPrice, "header price comes from the tick fixture").toBe(expected2330.last.toFixed(2));
    expect(wl2454, "watchlist row 2454 comes from ticks").toBe(expected2454.last.toFixed(2));
    expect(Number(ticketPrice), "ticket price seeds from the current symbol's tick close").toBeCloseTo(expected2330.last, 2);

    await saveRouteScreenshot(page, testInfo, "desk-exact-quote-kgi-healthy");
  });

  test("KGI ticks down (mocked outage): header + watchlist fall back to twse_mis effective-quotes, ticket price still seeds", async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await mockDeskBackend(page, { ticksMode: "down", effectiveQuotesFreshness: "fresh" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(4000);

    const symState = await frame.locator('[data-slot="sym-state"]').first().textContent();
    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const wl2454 = await frame.locator('[data-slot="wl-v-2454"]').first().textContent();
    const ticketPrice = await frame.locator('[data-slot="t-price"]').first().inputValue();

    testInfo.annotations.push({ type: "sym-state", description: String(symState) });
    testInfo.annotations.push({ type: "sym-price", description: String(symPrice) });
    testInfo.annotations.push({ type: "wl-v-2454", description: String(wl2454) });
    testInfo.annotations.push({ type: "ticket-price", description: String(ticketPrice) });

    const expected2330 = fallbackPriceFor("2330");
    const expected2454 = fallbackPriceFor("2454");
    // This is the regression guard for 2026-07-16 診斷 #1: with the raw KGI
    // tick buffer empty, header/watchlist must NOT collapse to "尚無報價"
    // while the (unmocked, still-healthy) bidask panel next to it is alive —
    // they must show the twse_mis-sourced fallback with an honest human label.
    expect(symState, "header must not say 尚無報價 when the twse_mis fallback has real data").not.toBe("尚無報價");
    expect(symState, "header must show a human-readable provenance label, not a raw source enum").toBe("證交所即時");
    expect(symPrice, "header falls back to the effective-quotes price").toBe(expected2330.last.toFixed(2));
    expect(wl2454, "watchlist row 2454 falls back to effective-quotes (not stuck at --)").toBe(expected2454.last.toFixed(2));
    expect(Number(ticketPrice), "ticket price still seeds from the fallback quote's last price").toBeCloseTo(expected2330.last, 2);

    await saveRouteScreenshot(page, testInfo, "desk-exact-quote-fallback-kgi-down");
  });

  test("both sources unavailable: header shows honest empty state and ticket price stays blank (not a fabricated number)", async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/kgi/quote/ticks") {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "QUOTE_NOT_AVAILABLE" }) });
        return;
      }
      if (innerPath === "/api/v1/market-data/effective-quotes") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items: [] } }) });
        return;
      }
      await route.continue();
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(4000);

    const symState = await frame.locator('[data-slot="sym-state"]').first().textContent();
    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const ticketPrice = await frame.locator('[data-slot="t-price"]').first().inputValue();

    testInfo.annotations.push({ type: "sym-state", description: String(symState) });
    testInfo.annotations.push({ type: "ticket-price", description: String(ticketPrice) });

    expect(symState, "honest empty state when neither source has data").toBe("尚無報價");
    expect(symPrice).toBe("--");
    expect(ticketPrice, "ticket price must stay empty (not a fabricated static number) when no quote is available").toBe("");
  });

  test("今日委託 tab only shows today's (Taipei) orders, filtering out a mocked older order", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    const todayIso = new Date().toISOString();
    const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/uta/orders") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              orders: [
                {
                  id: "order_today_00000001",
                  symbol: "2330",
                  action: "Buy",
                  qty: 1,
                  quantityUnit: "SHARE",
                  limitPrice: 1000,
                  filledQty: 0,
                  status: "submitted",
                  createdAt: todayIso
                },
                {
                  id: "order_yesterday_0000002",
                  symbol: "2454",
                  action: "Sell",
                  qty: 2,
                  quantityUnit: "LOT",
                  limitPrice: 900,
                  filledQty: 2,
                  status: "filled",
                  createdAt: yesterdayIso
                }
              ]
            }
          })
        });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="ledger-count-orders"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(3000);

    const ledgerCount = await frame.locator('[data-slot="ledger-count-orders"]').first().textContent();
    const rowsText = await frame.locator('[data-slot="ledger-rows"]').first().textContent();

    testInfo.annotations.push({ type: "ledger-count-orders", description: String(ledgerCount) });
    testInfo.annotations.push({ type: "rows-text", description: String(rowsText) });

    expect(ledgerCount, "只留今日委託 — 昨日單必須被過濾掉").toBe("1");
    expect(rowsText || "", "today's order (2330) must be present").toContain("2330");
    expect(rowsText || "", "yesterday's order (2454) must be filtered out of 今日委託").not.toContain("2454");

    await saveRouteScreenshot(page, testInfo, "desk-exact-orders-today-filter");
  });
});
