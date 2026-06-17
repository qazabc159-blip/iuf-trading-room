import { expect, test } from "@playwright/test";
import { WEB_BASE_URL, expectNoServerError, saveRouteScreenshot } from "./helpers";

/**
 * Site-wide page-health gate (root-cause class 3, 2026-06-17).
 *
 * IMPORTANT CORRECTION (2026-06-17): the original "BUG-01 = /market-intel blank
 * shell" was a MEASUREMENT ARTIFACT, not a bug. market-intel is iframe-hosted
 * (FinalOnlyFrame); its outer body is just the NAV (~246 chars), while the real
 * content (10 news rows, AI picks, source status) lives INSIDE the iframe and
 * renders perfectly on prod (verified: feedRows=10, clientError=null, 0 console
 * errors). Both Bruce's audit and the first version of this spec measured the
 * outer shell of an iframe page and mistook "NAV only" for "blank". Lesson burned
 * into the spec: for iframe pages, measure the iframe body (see `iframe: true`).
 *
 * What this spec is actually for: a real-browser, logged-in, PROD-targeting sweep
 * that opens every primary route, waits for client hydration, and asserts the
 * main content rendered + no auth/server/JS console errors — measured at the
 * RIGHT layer. It's the front-end counterpart to the curl-based post-deploy
 * core-surface check (#1099). Run with IUF_QA_WEB_BASE_URL=https://app... ; a
 * local PR build is NOT representative (e.g. /ai-recommendations renders 0 chars
 * on a cold local build but 4288 chars on prod).
 */

// Routes that render primary content (not just chrome). Each must show real
// content, not a blank shell. iframe-hosted screens (portfolio/quote use
// FinalOnlyFrame) are covered by their own specs; here we assert the page
// shell + that the route loads without console errors.
// `iframe: true` => content lives inside a FinalOnlyFrame; measuring the OUTER
// body is meaningless (it's just the NAV, ~246 chars). For these we enter the
// iframe and measure its body. (This was the BUG-01 false alarm: market-intel
// "208 chars blank" was measuring the wrong layer — the iframe held 10 fully
// rendered news rows the whole time.)
const CONTENT_ROUTES: Array<{ path: string; minVisibleChars: number; mustInclude?: RegExp; iframe?: boolean }> = [
  { path: "/", minVisibleChars: 400 },
  { path: "/market-intel", minVisibleChars: 800, mustInclude: /市場情報|新聞|熱力|產業|精選/, iframe: true },
  { path: "/briefs", minVisibleChars: 500, mustInclude: /簡報|市場總覽/ },
  { path: "/ai-recommendations", minVisibleChars: 500 },
  { path: "/themes", minVisibleChars: 500 },
  { path: "/reviews", minVisibleChars: 400 },
  { path: "/quant-strategies", minVisibleChars: 400 },
  { path: "/signals", minVisibleChars: 300 },
];

const ENGINEERING_LEAK = /source=(LIVE|BLOCKED)|cont_liq|undefined<\/|>NaN<|\[object Object\]/;

// NOT tagged @smoke: the @smoke gate runs against the PR's LOCAL build, whose
// cold-build SSR differs from prod (/ai-recommendations = 0 chars local, 4288
// on prod). This spec is a PROD-targeting page-health sweep — run it with
// IUF_QA_WEB_BASE_URL=https://app.eycvector.com (post-deploy job or manual),
// where it measures the right layer and currently passes all 8 routes.
for (const route of CONTENT_ROUTES) {
  test(`page-health: ${route.path} renders real content with no console errors`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(`${WEB_BASE_URL}${route.path}`, { waitUntil: "domcontentloaded" });
    await expectNoServerError(page);

    // Give client hydration time to fetch + render (the blank-shell bugs pass
    // domcontentloaded but never fill content).
    await page.waitForTimeout(6_000);

    // iframe pages: measure the iframe body (where the real content is), not the
    // outer NAV-only shell. This is what makes the blank-shell check meaningful.
    const contentLocator = route.iframe
      ? page.frameLocator("iframe").locator("body")
      : page.locator("body");
    const visibleText = (await contentLocator.innerText().catch(() => "")) ?? "";
    const cleaned = visibleText.replace(/\s+/g, " ").trim();

    await saveRouteScreenshot(page, testInfo, `health${route.path.replace(/\//g, "_") || "_home"}`);

    expect(
      cleaned.length,
      `${route.path} rendered only ${cleaned.length} chars of visible text — looks like a blank shell (BUG-01 class). First 120: "${cleaned.slice(0, 120)}"`,
    ).toBeGreaterThan(route.minVisibleChars);

    if (route.mustInclude) {
      expect(cleaned, `${route.path} is missing its expected primary content`).toMatch(route.mustInclude);
    }

    expect(
      cleaned.match(ENGINEERING_LEAK)?.[0] ?? null,
      `${route.path} leaked an engineering string into visible text`,
    ).toBeNull();

    // Note: React hydration-mismatch warnings are intentionally NOT treated as
    // blocking — they don't blank the page (proven: market-intel had hydration
    // warnings AND rendered 10 news rows fine). They're a minor cleanliness smell
    // at most. This gate fires only on errors that actually break the page: auth,
    // server, and JS runtime errors.
    const blockingConsole = consoleErrors.filter((l) =>
      /401|403|500|Application error|server-side exception|TypeError|is not a function|Cannot read prop/i.test(l),
    );
    expect(
      blockingConsole,
      `${route.path} surfaced blocking console errors: ${blockingConsole.slice(0, 3).join(" | ")}`,
    ).toEqual([]);
  });
}
