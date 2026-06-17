import { expect, test } from "@playwright/test";
import { WEB_BASE_URL, expectNoServerError, saveRouteScreenshot } from "./helpers";

/**
 * Site-wide page-health gate (root-cause class 3, 2026-06-17).
 *
 * Bruce's 6/16 manual Playwright audit found 18 bugs that SSR/curl could never
 * see — chief among them BUG-01: /market-intel rendered a blank shell (only the
 * NAV, ~246 chars of body text) because a client-side hydrate threw and was
 * swallowed by a catch. No unit test or SSR check can catch "the page is blank
 * after JS runs"; only a real browser can.
 *
 * This spec turns that manual sweep into an automated gate: open every primary
 * route, wait for client hydration, and assert (a) no auth/server/JS console
 * errors and (b) the main content actually rendered (visible text well beyond
 * just the NAV). The blank-shell class fails here instead of reaching the owner.
 *
 * NOTE: BUG-01 was prod-only (the hydrate threw against the live environment,
 * not the PR's local build), so the highest value comes from running this
 * against PROD after every deploy — wire IUF_QA_WEB_BASE_URL=https://app...
 * in the post-deploy job. It also runs in PR mode against the local build to
 * catch structural blanks before merge.
 */

// Routes that render primary content (not just chrome). Each must show real
// content, not a blank shell. iframe-hosted screens (portfolio/quote use
// FinalOnlyFrame) are covered by their own specs; here we assert the page
// shell + that the route loads without console errors.
const CONTENT_ROUTES: Array<{ path: string; minVisibleChars: number; mustInclude?: RegExp }> = [
  { path: "/", minVisibleChars: 400 },
  { path: "/market-intel", minVisibleChars: 600, mustInclude: /市場情報|新聞|熱力|產業/ },
  { path: "/briefs", minVisibleChars: 500, mustInclude: /簡報|市場總覽/ },
  { path: "/ai-recommendations", minVisibleChars: 500 },
  { path: "/themes", minVisibleChars: 500 },
  { path: "/reviews", minVisibleChars: 400 },
  { path: "/quant-strategies", minVisibleChars: 400 },
  { path: "/signals", minVisibleChars: 300 },
];

const ENGINEERING_LEAK = /source=(LIVE|BLOCKED)|cont_liq|undefined<\/|>NaN<|\[object Object\]/;

for (const route of CONTENT_ROUTES) {
  test(`page-health: ${route.path} renders real content with no console errors @smoke`, async ({ page }, testInfo) => {
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

    const visibleText = (await page.locator("body").innerText().catch(() => "")) ?? "";
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

    const blockingConsole = consoleErrors.filter((l) =>
      /401|403|500|Application error|server-side exception|TypeError|is not a function|Cannot read|hydrat/i.test(l),
    );
    expect(
      blockingConsole,
      `${route.path} surfaced blocking console errors: ${blockingConsole.slice(0, 3).join(" | ")}`,
    ).toEqual([]);
  });
}
