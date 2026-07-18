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

function tickFixture(
  close: number,
  prevClose: number,
  opts: { stale?: boolean; datetime?: string } = {}
) {
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
          total_volume: 12345000,
          datetime: opts.datetime ?? "20260716104737"
        }
      ],
      // envelope-level freshness (三輪終驗 2026-07-16 實測 shape: sibling to
      // "ticks", not per-tick) — ops 手動訂閱打進來的單一快照會是 stale:true.
      freshness: opts.stale ? "stale" : "fresh",
      stale: opts.stale ?? false
    }
  };
}

// KGI 原生（行情腿修通後）巢狀 bidask shape — 三輪終驗實測: data.bidask.*，
// 無 source 欄位，freshness/stale 在 data 這層。
function bidaskNestedFixture(bestBid: number, bestAsk: number, opts: { stale?: boolean } = {}) {
  return {
    data: {
      symbol: "2330",
      bidask: {
        bid_prices: [bestBid, bestBid - 5, bestBid - 10, bestBid - 15, bestBid - 20],
        bid_volumes: [100, 200, 300, 400, 500],
        ask_prices: [bestAsk, bestAsk + 5, bestAsk + 10, bestAsk + 15, bestAsk + 20],
        ask_volumes: [110, 210, 310, 410, 510],
        datetime: "20260716104744"
      },
      freshness: opts.stale ? "stale" : "fresh",
      stale: opts.stale ?? false
    }
  };
}

// twse_mis fallback 扁平 bidask shape（regression guard — 這是修復前唯一
// renderDepth() 認得的路徑，必須繼續吃得下）.
function bidaskFlatFixture(bestBid: number, bestAsk: number) {
  return {
    data: {
      symbol: "2330",
      source: "twse_mis_intraday",
      bid_prices: [bestBid, bestBid - 5, bestBid - 10, bestBid - 15, bestBid - 20],
      bid_volumes: [100, 200, 300, 400, 500],
      ask_prices: [bestAsk, bestAsk + 5, bestAsk + 10, bestAsk + 15, bestAsk + 20],
      ask_volumes: [110, 210, 310, 410, 510]
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

// official_close 兜底 tier（#1307/#1309, 2026-07-19）合成的 item：
// freshnessStatus:"closed_snapshot" + closedSnapshotTradeDate，非交易時段/
// deploy 重啟後的合法收盤快照，selectedSource 恆為 "official_close"。
function closedSnapshotQuoteItem(symbol: string, last: number, tradeDate: string) {
  return {
    symbol,
    market: "TW",
    selectedSource: "official_close",
    selectedQuote: {
      symbol,
      market: "TW",
      source: "official_close",
      last,
      bid: null,
      ask: null,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: null,
      changePct: null,
      timestamp: `${tradeDate}T13:30:00+08:00`,
      ageMs: 999999,
      isStale: false
    },
    freshnessStatus: "closed_snapshot",
    closedSnapshotTradeDate: tradeDate,
    fallbackReason: "none",
    staleReason: "none",
    readiness: "degraded",
    reasons: ["official_close_snapshot"]
  };
}

// official_close 兜底 tier 的另一個分支（offHours=false, market-data.ts
// _applyOfficialCloseFallback）：盤中即時報價全滅時用收盤價回補，
// freshnessStatus 是 "stale"（非 "closed_snapshot"）— reasons 帶
// "official_close_stale_intraday_fallback"。selectedSource 仍是
// "official_close"，跟一般 twse_mis 的 stale 不同來源，必須誠實標示「即時
// 中斷」，不能被籠統歸類為「即時報價」（Pete #1310 review 🔴 round 2）。
function officialCloseStaleQuoteItem(symbol: string, last: number, tradeDate: string) {
  return {
    symbol,
    market: "TW",
    selectedSource: "official_close",
    selectedQuote: {
      symbol,
      market: "TW",
      source: "official_close",
      last,
      bid: null,
      ask: null,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: null,
      changePct: null,
      timestamp: `${tradeDate}T13:30:00+08:00`,
      ageMs: 999999,
      isStale: true
    },
    freshnessStatus: "stale",
    closedSnapshotTradeDate: tradeDate,
    fallbackReason: "none",
    staleReason: "none",
    readiness: "degraded",
    reasons: ["official_close_stale_intraday_fallback"]
  };
}

// #1309 round 2「N in N out」合成的誠實 BLOCKED item：兩個真實來源＋
// quote_last_close 都沒有這檔的任何資料，selectedQuote 保持 null。
function blockedQuoteItem(symbol: string) {
  return {
    symbol,
    market: "TW",
    selectedSource: null,
    selectedQuote: null,
    freshnessStatus: "missing",
    closedSnapshotTradeDate: null,
    fallbackReason: "no_quote",
    staleReason: "none",
    readiness: "blocked",
    reasons: ["missing_quote"]
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
  // Next.js dev-mode occasionally triggers a mid-navigation HMR/live-reload
  // of the page while these tests run, which can let a couple of the
  // iframe's earliest fetches race ahead of `page.route()` re-attaching to
  // the fresh document and reach the real (unmocked) backend for one test in
  // ~10 (confirmed via manual request-tracing: the "leaked" responses were
  // themselves correctly-shaped honest live data, not garbage — a dev-server
  // timing artifact, not a functional bug). Retries give each test a fresh
  // page/context and self-heal from this rare race; CI's single-use runner
  // (no accumulated hot-reload/manual-restart history like this session)
  // is expected to see this far less often, if at all.
  test.describe.configure({ retries: 2 });

  // Warm both the page route and the proxy API route once before any mocked
  // assertions run, so at least the on-demand-compile variant of this race
  // is eliminated up front.
  test.beforeAll(async () => {
    const base = process.env.IUF_QA_WEB_BASE_URL ?? "http://127.0.0.1:3300";
    await fetch(`${base}/desk-exact`).catch(() => {});
    await fetch(`${base}/api/ui-final-v031/backend?path=%2Fapi%2Fv1%2Fkgi%2Fstatus`).catch(() => {});
  });

  test("KGI ticks healthy: header + watchlist render from ticks, ticket price seeds from tick close", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await mockDeskBackend(page, { ticksMode: "healthy" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

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
    await page.waitForTimeout(6000);

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
    await page.waitForTimeout(6000);

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
    await page.waitForTimeout(6000);

    const ledgerCount = await frame.locator('[data-slot="ledger-count-orders"]').first().textContent();
    const rowsText = await frame.locator('[data-slot="ledger-rows"]').first().textContent();

    testInfo.annotations.push({ type: "ledger-count-orders", description: String(ledgerCount) });
    testInfo.annotations.push({ type: "rows-text", description: String(rowsText) });

    expect(ledgerCount, "只留今日委託 — 昨日單必須被過濾掉").toBe("1");
    expect(rowsText || "", "today's order (2330) must be present").toContain("2330");
    expect(rowsText || "", "yesterday's order (2454) must be filtered out of 今日委託").not.toContain("2454");

    await saveRouteScreenshot(page, testInfo, "desk-exact-orders-today-filter");
  });

  // 2026-07-16 三輪終驗發現的側面 regression：行情腿修通後 bidask 端點來源從
  // twse_mis 切回 KGI 原生，response shape 從扁平 (data.{ask,bid}_prices) 變
  // 巢狀 (data.bidask.{ask,bid}_prices) — renderDepth() 只認舊扁平路徑，導致
  // KGI 源下五檔盤口整段空白（比之前更糟：舊版好歹有 twse_mis 假資料）。
  test.describe("renderDepth() bidask response shape compatibility (2026-07-16 三輪終驗 regression)", () => {
    test("KGI nested shape (data.bidask.*, fresh): depth ladder renders real values with 凱基即時 label", async ({
      page
    }, testInfo) => {
      test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
      await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
        const { innerPath } = decodeInnerPath(route.request().url());
        if (innerPath === "/api/v1/kgi/quote/bidask") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(bidaskNestedFixture(2435, 2440))
          });
          return;
        }
        await route.continue();
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
      const frame = extractFrame(page);
      await frame.locator('[data-slot="depth-ask1-px"]').first().waitFor({ state: "attached", timeout: 15000 });
      await page.waitForTimeout(6000);

      const depthMeta = await frame.locator('[data-slot="depth-meta"]').first().textContent();
      const ask1 = await frame.locator('[data-slot="depth-ask1-px"]').first().textContent();
      const bid1 = await frame.locator('[data-slot="depth-bid1-px"]').first().textContent();

      testInfo.annotations.push({ type: "depth-meta", description: String(depthMeta) });
      testInfo.annotations.push({ type: "depth-ask1-px", description: String(ask1) });
      testInfo.annotations.push({ type: "depth-bid1-px", description: String(bid1) });

      expect(ask1, "nested KGI shape must populate the ask ladder, not stay blank").toBe("2,440.00");
      expect(bid1, "nested KGI shape must populate the bid ladder, not stay blank").toBe("2,435.00");
      expect(depthMeta, "depth panel must attribute the source honestly as KGI").toContain("凱基即時");

      await saveRouteScreenshot(page, testInfo, "desk-exact-depth-kgi-nested-fresh");
    });

    test("KGI nested shape, stale snapshot: values still render with an honest 略舊 label", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
      await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
        const { innerPath } = decodeInnerPath(route.request().url());
        if (innerPath === "/api/v1/kgi/quote/bidask") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(bidaskNestedFixture(2435, 2440, { stale: true }))
          });
          return;
        }
        await route.continue();
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
      const frame = extractFrame(page);
      await frame.locator('[data-slot="depth-ask1-px"]').first().waitFor({ state: "attached", timeout: 15000 });
      await page.waitForTimeout(6000);

      const depthMeta = await frame.locator('[data-slot="depth-meta"]').first().textContent();
      const ask1 = await frame.locator('[data-slot="depth-ask1-px"]').first().textContent();

      testInfo.annotations.push({ type: "depth-meta", description: String(depthMeta) });
      testInfo.annotations.push({ type: "depth-ask1-px", description: String(ask1) });

      expect(ask1, "a stale snapshot must still render its real value, not blank").toBe("2,440.00");
      expect(depthMeta, "a stale snapshot must be honestly labeled 略舊, not silently shown as live").toContain("略舊");

      await saveRouteScreenshot(page, testInfo, "desk-exact-depth-kgi-nested-stale");
    });

    test("twse_mis flat shape (regression guard, pre-existing path): depth ladder still renders", async ({
      page
    }, testInfo) => {
      test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
      await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
        const { innerPath } = decodeInnerPath(route.request().url());
        if (innerPath === "/api/v1/kgi/quote/bidask") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(bidaskFlatFixture(2420, 2425))
          });
          return;
        }
        await route.continue();
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
      const frame = extractFrame(page);
      await frame.locator('[data-slot="depth-ask1-px"]').first().waitFor({ state: "attached", timeout: 15000 });
      await page.waitForTimeout(6000);

      const depthMeta = await frame.locator('[data-slot="depth-meta"]').first().textContent();
      const ask1 = await frame.locator('[data-slot="depth-ask1-px"]').first().textContent();
      const bid1 = await frame.locator('[data-slot="depth-bid1-px"]').first().textContent();

      testInfo.annotations.push({ type: "depth-meta", description: String(depthMeta) });
      testInfo.annotations.push({ type: "depth-ask1-px", description: String(ask1) });
      testInfo.annotations.push({ type: "depth-bid1-px", description: String(bid1) });

      expect(ask1, "the old flat twse_mis shape must keep working (no regression)").toBe("2,425.00");
      expect(bid1, "the old flat twse_mis shape must keep working (no regression)").toBe("2,420.00");
      expect(depthMeta, "flat shape is honestly attributed to 證交所").toContain("證交所即時");

      await saveRouteScreenshot(page, testInfo, "desk-exact-depth-twse-mis-flat");
    });
  });

  // 2026-07-16 三輪終驗：自選 10 檔中有 5 檔（2382/3661/3035/2618/3443）不在
  // KGI 訂閱白名單內，ticks 端點回 422 SYMBOL_NOT_ALLOWED（非 QUOTE_NOT_
  // AVAILABLE）— 驗證這種失敗原因也會觸發同一套 fallback，不是只認特定錯誤碼。
  test("SYMBOL_NOT_ALLOWED (422) on ticks also triggers the twse_mis fallback for header + watchlist", async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath, innerParams } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/kgi/quote/ticks") {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: "SYMBOL_NOT_ALLOWED",
            message: "Symbol is not on the quote whitelist (KGI_QUOTE_SYMBOL_WHITELIST)."
          })
        });
        return;
      }
      if (innerPath === "/api/v1/market-data/effective-quotes") {
        const symbols = (innerParams.get("symbols") || "").split(",").filter(Boolean);
        const items = symbols.map((sym) => {
          const { last, prevClose } = fallbackPriceFor(sym);
          return effectiveQuoteItem(sym, last, prevClose, "fresh");
        });
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items } }) });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const symState = await frame.locator('[data-slot="sym-state"]').first().textContent();
    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const wl2454 = await frame.locator('[data-slot="wl-v-2454"]').first().textContent();

    testInfo.annotations.push({ type: "sym-state", description: String(symState) });
    testInfo.annotations.push({ type: "sym-price", description: String(symPrice) });
    testInfo.annotations.push({ type: "wl-v-2454", description: String(wl2454) });

    const expected2330 = fallbackPriceFor("2330");
    const expected2454 = fallbackPriceFor("2454");
    expect(symState, "SYMBOL_NOT_ALLOWED must not collapse the header to 尚無報價").not.toBe("尚無報價");
    expect(symPrice, "SYMBOL_NOT_ALLOWED falls back to the effective-quotes price").toBe(expected2330.last.toFixed(2));
    expect(wl2454, "watchlist also falls back on SYMBOL_NOT_ALLOWED").toBe(expected2454.last.toFixed(2));

    await saveRouteScreenshot(page, testInfo, "desk-exact-symbol-not-allowed-fallback");
  });

  // 2026-07-16 三輪終驗：ops 手動訂閱打進來的是「單一快照」（buffer_used:1），
  // 回應帶 freshness:"stale" — 有值要照顯＋誠實標示，不能因為 stale 就打回
  // 「尚無報價」空狀態（那樣反而比顯示一個舊快照更誤導）。
  test("ticks with freshness:\"stale\" still renders the real price with an honest label (not 尚無報價)", async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/kgi/quote/ticks") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(tickFixture(2435, 2440, { stale: true, datetime: "20260716104737" }))
        });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const symState = await frame.locator('[data-slot="sym-state"]').first().textContent();
    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const ticketPrice = await frame.locator('[data-slot="t-price"]').first().inputValue();

    testInfo.annotations.push({ type: "sym-state", description: String(symState) });
    testInfo.annotations.push({ type: "sym-price", description: String(symPrice) });
    testInfo.annotations.push({ type: "ticket-price", description: String(ticketPrice) });

    expect(symState, "a stale tick snapshot must NOT be shown as 尚無報價 (it has real data)").not.toBe("尚無報價");
    expect(symState, "a stale tick snapshot must be honestly labeled, not silently shown as 即時 tick").not.toBe("即時 tick");
    expect(symPrice, "the real tick price still renders even though the snapshot is stale").toBe("2,435.00");
    expect(Number(ticketPrice), "ticket price still seeds from the stale-but-real tick close").toBeCloseTo(2435, 2);

    await saveRouteScreenshot(page, testInfo, "desk-exact-header-stale-tick-snapshot");
  });

  // 2026-07-19 #1307/#1309 official_close 兜底 tier fast-follow：週末/deploy
  // 重啟後 KGI ticks 全滅，effective-quotes 用 quote_last_close 合成
  // freshnessStatus:"closed_snapshot" 的真收盤價——header 必須誠實標「MM/DD 收盤」
  // （不是「略舊」，那個字眼暗示本該更新而沒更新），watchlist 底部說明文字也要
  // 從舊的靜態「示意報價」換成同一個收盤日期（coordinator 7/19 追加驗收點）。
  test("closed_snapshot freshness: header shows honest \"MM/DD 收盤\" label (not 略舊), watchlist caption updates to the same date", async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    const tradeDate = "2026-07-17";
    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath, innerParams } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/kgi/quote/ticks") {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "QUOTE_NOT_AVAILABLE" }) });
        return;
      }
      if (innerPath === "/api/v1/market-data/effective-quotes") {
        const symbols = (innerParams.get("symbols") || "").split(",").filter(Boolean);
        const items = symbols.map((sym) => closedSnapshotQuoteItem(sym, 2290 + WL_SYMBOLS.indexOf(sym), tradeDate));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items } }) });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const symState = await frame.locator('[data-slot="sym-state"]').first().textContent();
    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const wlCaption = await frame.locator('[data-slot="wl-caption"]').first().textContent();

    testInfo.annotations.push({ type: "sym-state", description: String(symState) });
    testInfo.annotations.push({ type: "sym-price", description: String(symPrice) });
    testInfo.annotations.push({ type: "wl-caption", description: String(wlCaption) });

    expect(symState, "closed_snapshot must be labeled with the honest trade date, not 略舊").toBe("07/17 收盤");
    expect(symState, "must never say 略舊 for a legitimate off-hours closing snapshot").not.toBe("行情（略舊）");
    expect(symPrice, "the real official close price still renders").toBe((2290 + WL_SYMBOLS.indexOf("2330")).toFixed(2));
    expect(wlCaption, "watchlist caption must reflect the real closing date, not the stale static 示意報價 label").toBe("07/17 收盤");
    expect(wlCaption, "must never leak the old placeholder wording once real official_close data is showing").not.toBe("示意報價");

    await saveRouteScreenshot(page, testInfo, "desk-exact-closed-snapshot-header-and-caption");
  });

  // 2026-07-19 Pete #1310 review 🔴 round 2: the SAME official_close fallback
  // tier also fires intraday when every live feed is dead (offHours=false in
  // market-data.ts's _applyOfficialCloseFallback) — freshnessStatus is
  // "stale", not "closed_snapshot". The wl-caption logic's first pass only
  // branched on "closed_snapshot" and defaulted everything else (including
  // this case) to "即時報價" — i.e. it labeled a genuinely stale closing
  // price as live, which is the exact "假裝即時" bug this whole PR exists to
  // fix. Regression-locks the offHours=false branch.
  test("official_close intraday-stale fallback (offHours=false): watchlist caption must say 即時中斷, never 即時報價", async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    const tradeDate = "2026-07-17";
    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath, innerParams } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/kgi/quote/ticks") {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "QUOTE_NOT_AVAILABLE" }) });
        return;
      }
      if (innerPath === "/api/v1/market-data/effective-quotes") {
        const symbols = (innerParams.get("symbols") || "").split(",").filter(Boolean);
        const items = symbols.map((sym) => officialCloseStaleQuoteItem(sym, 2290 + WL_SYMBOLS.indexOf(sym), tradeDate));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items } }) });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const wlCaption = await frame.locator('[data-slot="wl-caption"]').first().textContent();

    testInfo.annotations.push({ type: "sym-price", description: String(symPrice) });
    testInfo.annotations.push({ type: "wl-caption", description: String(wlCaption) });

    expect(symPrice, "the real official close price still renders").toBe((2290 + WL_SYMBOLS.indexOf("2330")).toFixed(2));
    expect(wlCaption, "must NEVER claim 即時報價 for a stale official_close intraday fallback (the bug this test guards)").not.toBe("即時報價");
    expect(wlCaption, "must honestly say the live feed is interrupted").toBe("07/17 收盤（即時中斷）");

    await saveRouteScreenshot(page, testInfo, "desk-exact-official-close-stale-intraday-caption");
  });

  // #1309 round 2「N in N out」合成的誠實 BLOCKED item（selectedQuote:null）：
  // header/watchlist 必須維持既有的誠實空狀態，不能因為新欄位（
  // closedSnapshotTradeDate/reasons 擴充）而崩潰或印出原始字串。
  test("synthesized BLOCKED item (selectedQuote:null) renders an honest empty state without crashing", async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    await page.route("**/api/ui-final-v031/backend**", async (route: Route) => {
      const { innerPath, innerParams } = decodeInnerPath(route.request().url());
      if (innerPath === "/api/v1/kgi/quote/ticks") {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "QUOTE_NOT_AVAILABLE" }) });
        return;
      }
      if (innerPath === "/api/v1/market-data/effective-quotes") {
        const symbols = (innerParams.get("symbols") || "").split(",").filter(Boolean);
        const items = symbols.map((sym) => blockedQuoteItem(sym));
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { items } }) });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk-exact", { waitUntil: "domcontentloaded" });
    const frame = extractFrame(page);
    await frame.locator('[data-slot="sym-price"]').first().waitFor({ state: "attached", timeout: 15000 });
    await page.waitForTimeout(6000);

    const symState = await frame.locator('[data-slot="sym-state"]').first().textContent();
    const symPrice = await frame.locator('[data-slot="sym-price"]').first().textContent();
    const wl2454 = await frame.locator('[data-slot="wl-v-2454"]').first().textContent();
    const wlCaption = await frame.locator('[data-slot="wl-caption"]').first().textContent();

    testInfo.annotations.push({ type: "sym-state", description: String(symState) });
    testInfo.annotations.push({ type: "sym-price", description: String(symPrice) });
    testInfo.annotations.push({ type: "wl-v-2454", description: String(wl2454) });
    testInfo.annotations.push({ type: "wl-caption", description: String(wlCaption) });

    expect(symState, "a fully blocked synthesized item must show the honest empty state").toBe("尚無報價");
    expect(symPrice).toBe("--");
    expect(wl2454, "watchlist rows must show an honest -- for a blocked item, not crash or leak raw tokens").toBe("--");
    expect(wlCaption, "no closed_snapshot rows exist, so the caption falls back to the honest default").toBe("即時報價");

    await saveRouteScreenshot(page, testInfo, "desk-exact-blocked-synthesized-item");
  });
});
