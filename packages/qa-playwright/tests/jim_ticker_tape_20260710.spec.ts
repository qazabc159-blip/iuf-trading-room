import { expect, test, type Page } from "@playwright/test";
import { saveRouteScreenshot } from "./helpers";

/**
 * Ticker tape (2026-07-10) — Epic trading-desk slice S5, site-wide banner.
 * `reports/epic_trading_desk_20260702/EPIC_TRADING_DESK_EXCHANGE_GRADE.md`.
 *
 * Consumes the same `GET /api/v1/market-data/overview` endpoint the homepage
 * and `/m` mobile brief already call (`apps/web/components/TickerTape.tsx`,
 * fetched client-side from a "use client" component — a new call site for
 * this endpoint; the homepage/`/m` only ever called it server-side before).
 * Rendered at the root layout level (`apps/web/app/layout.tsx`), skipped on
 * `/login`, `/register`, `/m`, the homepage (`/` already ships its own
 * real-data `.tac-ticker`), and every `<FinalOnlyFrame/>` full-bleed iframe
 * wrapper page (`/portfolio`, `/market-intel`, `/final-v031/*` — Pete review
 * 2026-07-10, PR #1208 NEEDS_FIX round: the ticker would mount into the DOM
 * but be visually covered/off-screen there while still polling for nothing).
 * See `lib/ticker-tape.ts` `shouldRenderTickerTape`.
 *
 * IMPORTANT — local harness limitation (documented precedent: Jim per-agent
 * memory `local_playwright_cross_site_cookie_2026_07_09.md`): this repo's API
 * CORS allowlist (`CORS_ORIGINS` on the Hono server) only includes the real
 * prod web origin (`https://app.eycvector.com`) and `http://localhost:3000`
 * by code default — a locally-run dev server on a *different* port (needed
 * here because port 3000 was already held by another concurrent worktree
 * session) gets a genuine browser CORS rejection on this endpoint, same as
 * any other direct-to-backend client call would (`apiGetMe()` in
 * `auth-client.ts` hits the identical wall under the same conditions — this
 * is not specific to the ticker). Tests that need to see real rendered
 * content therefore mock the endpoint response via `page.route()` with a
 * realistic fixture; a separate test proves the REAL (unmocked) network path
 * degrades honestly to the "empty" data-state rather than fabricating
 * numbers or crashing — that assertion is exercised against the true CORS
 * failure, not a mock, so it is a genuine regression guard.
 */

const DESKTOP_PROJECT = "desktop-chromium";
const MOBILE_PROJECT = "mobile-iphone-13";
const TICKER_LABEL = '[aria-label="大盤與權值股即時報價跑馬燈"]';

function overviewFixture(overrides: {
  state?: "LIVE" | "STALE" | "EMPTY" | "BLOCKED";
  reason?: string | null;
  timestamp?: string;
} = {}) {
  const state = overrides.state ?? "LIVE";
  // A real EMPTY/BLOCKED backend response has no index/heatmap payload —
  // model that here too, so this fixture can't accidentally make the
  // "no fabricated numbers" test pass for the wrong reason (badge says
  // "empty" while still showing fake numbers underneath).
  const hasPayload = state === "LIVE" || state === "STALE";
  return {
    data: {
      generatedAt: new Date().toISOString(),
      providers: [],
      marketContext: {
        state,
        source: "twse_mis_intraday",
        index: hasPayload
          ? {
              state,
              symbol: "t00",
              market: "TW_INDEX",
              name: "加權指數",
              source: "twse_mis_intraday",
              last: 43225.54,
              change: 76.08,
              changePct: 0.18,
              timestamp: overrides.timestamp ?? new Date().toISOString(),
              freshnessStatus: "fresh",
              reason: overrides.reason ?? null,
            }
          : null,
        breadth: { state, up: 520, down: 380, flat: 100, total: 1000, updatedAt: null, source: "mis", reason: null },
        heatmap: hasPayload
          ? [
              { symbol: "2330", market: "TW", name: "台積電", source: "mis", last: 1105, prevClose: 1090, change: 15, changePct: 1.38, volume: 34680000, timestamp: new Date().toISOString(), weight: 30, readiness: "ready", freshnessStatus: "fresh" },
              { symbol: "2317", market: "TW", name: "鴻海", source: "mis", last: 210.5, prevClose: 211.5, change: -1, changePct: -0.47, volume: 12000000, timestamp: new Date().toISOString(), weight: 12, readiness: "ready", freshnessStatus: "fresh" },
              { symbol: "2454", market: "TW", name: "聯發科", source: "mis", last: 1580, prevClose: 1580, change: 0, changePct: 0, volume: 3000000, timestamp: new Date().toISOString(), weight: 8, readiness: "ready", freshnessStatus: "fresh" },
            ]
          : [],
      },
      symbols: { total: 0, byMarket: [] },
      quotes: {
        total: 0, fresh: 0, stale: 0, latestQuoteTimestamp: null,
        readiness: { connectedSources: [], disconnectedSources: [], preferredSourceOrder: [], effectiveSelection: { total: 0, ready: 0, degraded: 0, blocked: 0, strategyUsable: 0, paperUsable: 0, liveUsable: 0 } },
        bySource: [], byMarket: [],
      },
      quality: { evaluatedSymbols: 0, history: { ready: 0, degraded: 0, blocked: 0, total: 0 }, bars: { ready: 0, degraded: 0, blocked: 0, total: 0 } },
      leaders: { topGainers: [], topLosers: [], mostActive: [] },
    },
  };
}

async function mockOverview(page: Page, body: unknown) {
  await page.route("**/api/v1/market-data/overview**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("desktop /track-record: renders real-shaped data (mocked payload — see file header re: local CORS), does not overlap header-dock", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(45_000);

  await mockOverview(page, overviewFixture({ state: "LIVE" }));
  await page.goto("/track-record", { waitUntil: "domcontentloaded" });

  const tickerRoot = page.locator(TICKER_LABEL);
  await tickerRoot.waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(1500);

  await expect(tickerRoot).toBeVisible();
  await expect(page.locator('[data-testid="ticker-track-inner"]').first()).toContainText("加權指數");
  await expect(page.locator('[data-testid="ticker-track-inner"]').first()).toContainText("2330");
  await expect(page.locator('[data-testid="ticker-track-inner"]').first()).toContainText("+1.38%");

  const tickerBox = await tickerRoot.boundingBox();
  expect(tickerBox, "ticker tape should have a real bounding box").not.toBeNull();
  expect(tickerBox!.height).toBeGreaterThan(0);

  const dockBox = await page.locator(".header-dock").boundingBox();
  if (dockBox && tickerBox) {
    expect(
      dockBox.y,
      `header-dock (top=${dockBox.y}) should not overlap the ticker tape (bottom=${tickerBox.y + tickerBox.height})`,
    ).toBeGreaterThanOrEqual(tickerBox.y + tickerBox.height - 1);
  }

  await saveRouteScreenshot(page, testInfo, "ticker_tape_desktop_track_record_live");
});

test("desktop: EMPTY backend state shows an honest reason, no fabricated numbers", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(45_000);

  // A real EMPTY response has no index payload, so there is nowhere for a
  // custom `reason` string to live either (see overviewFixture — `reason`
  // only attaches to `index.reason`, and index is null when !hasPayload).
  // The component's own honest default text is what should show here.
  await mockOverview(page, overviewFixture({ state: "EMPTY" }));
  await page.goto("/track-record", { waitUntil: "domcontentloaded" });

  const tickerRoot = page.locator(TICKER_LABEL);
  await tickerRoot.waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(1500);

  await expect(tickerRoot).toHaveAttribute("data-state", "empty");
  await expect(tickerRoot).toContainText("目前沒有盤面資料");
  // No scrolling item track should render — nothing to fabricate numbers from.
  await expect(page.locator('[data-testid="ticker-track-inner"]')).toHaveCount(0);
  await saveRouteScreenshot(page, testInfo, "ticker_tape_desktop_empty_state");
});

test("real network path (unmocked): honestly degrades to an empty state instead of crashing or faking data", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(30_000);

  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("/track-record", { waitUntil: "domcontentloaded" });
  const tickerRoot = page.locator(TICKER_LABEL);
  await tickerRoot.waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(2000);

  await expect(tickerRoot).toBeVisible();
  const state = await tickerRoot.getAttribute("data-state");
  expect(["live", "close", "delayed", "empty"]).toContain(state);
  expect(consoleErrors, `no uncaught page errors expected, got: ${consoleErrors.join(" | ")}`).toHaveLength(0);

  await saveRouteScreenshot(page, testInfo, "ticker_tape_desktop_real_network_honest_degrade");
});

test("mobile 390px /track-record: ticker tape height <=32px, no horizontal page scroll", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== MOBILE_PROJECT, `runs on the "${MOBILE_PROJECT}" project.`);
  test.setTimeout(45_000);

  await mockOverview(page, overviewFixture({ state: "LIVE" }));
  await page.goto("/track-record", { waitUntil: "domcontentloaded" });

  const tickerRoot = page.locator(TICKER_LABEL);
  await tickerRoot.waitFor({ state: "attached", timeout: 15_000 });
  await page.waitForTimeout(1500);

  await expect(tickerRoot).toBeVisible();
  const box = await tickerRoot.boundingBox();
  expect(box, "ticker tape should have a real bounding box on mobile").not.toBeNull();
  expect(box!.height, `ticker tape height should be <=32px on mobile, got ${box!.height}`).toBeLessThanOrEqual(32);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `page body should not overflow horizontally at 390px (scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);

  await saveRouteScreenshot(page, testInfo, "ticker_tape_mobile_390_track_record");
});

test("prefers-reduced-motion: reduce disables the scrolling animation", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(45_000);

  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    reducedMotion: "reduce",
  });
  const reducedPage = await context.newPage();
  await mockOverview(reducedPage, overviewFixture({ state: "LIVE" }));
  await reducedPage.goto("/track-record", { waitUntil: "domcontentloaded" });

  const tickerRoot = reducedPage.locator(TICKER_LABEL);
  await tickerRoot.waitFor({ state: "attached", timeout: 15_000 });
  await reducedPage.waitForTimeout(1500);

  const animationName = await reducedPage.evaluate(() => {
    const inner = document.querySelector('[data-testid="ticker-track-inner"]');
    if (!inner) return null;
    return window.getComputedStyle(inner).animationName;
  });

  expect(
    animationName === "none" || animationName === null,
    `expected the scroll animation to be disabled under prefers-reduced-motion, got animationName="${animationName}"`,
  ).toBeTruthy();

  await saveRouteScreenshot(reducedPage, testInfo, "ticker_tape_reduced_motion_track_record");
  await context.close();
});

test("/login: ticker tape does not render (skip-route contract)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
  test.setTimeout(30_000);

  // Fresh, unauthenticated context — /login must be reachable logged-out.
  const context = await page.context().browser()!.newContext();
  const loginPage = await context.newPage();
  await loginPage.goto("/login", { waitUntil: "domcontentloaded" });
  await loginPage.waitForTimeout(500);

  await expect(loginPage.locator(TICKER_LABEL)).toHaveCount(0);
  await context.close();
});

/**
 * Pete review, 2026-07-10 (PR #1208 NEEDS_FIX round): `/portfolio` and
 * `/market-intel` render `<FinalOnlyFrame/>` (`components/FinalOnlyFrame.tsx`)
 * — a full-bleed iframe wrapper whose `.iuf-final-content-frame` forces
 * `height:100dvh` for every screen type, and the `paper-trading-room`
 * variant additionally goes `position:fixed` at a near-max z-index. The
 * ticker would render into the DOM but be visually unreachable there, while
 * its poll timer kept firing requests for a banner nobody can see. Explicitly
 * requested: assert the substantive absence (no DOM element AND no network
 * request), not just "route doesn't crash".
 */
for (const route of ["/portfolio", "/market-intel"]) {
  test(`${route}: ticker tape does not render AND never polls market-data/overview (FinalOnlyFrame skip)`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== DESKTOP_PROJECT, `runs on the "${DESKTOP_PROJECT}" project.`);
    test.setTimeout(30_000);

    let overviewRequestFired = false;
    await page.route("**/api/v1/market-data/overview**", async (r) => {
      overviewRequestFired = true;
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overviewFixture()) });
    });

    await page.goto(route, { waitUntil: "domcontentloaded" });
    // FinalOnlyFrame's own iframe needs a moment to mount; give the ticker's
    // effect the same window it would have had to fire its first fetch.
    await page.waitForTimeout(3000);

    await expect(page.locator(TICKER_LABEL)).toHaveCount(0);
    expect(
      overviewRequestFired,
      `market-data/overview should never be requested on ${route} — the ticker must not mount/poll here at all`,
    ).toBe(false);
  });
}
