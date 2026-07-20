import { expect, test } from "@playwright/test";

// Regression lock for React error #418 (hydration text mismatch) on the
// company detail page (2026-07-19, jim3).
//
// Root cause: CompanyPageStyleBlock.tsx (a server component that renders a
// single <style>{`...`}</style> block) had a code comment inside its own CSS
// string that spelled out the literal characters "<style>" in plain English
// documentation ("...each panel's own inline <style> tag..."). React's SSR
// HTML serializer defensively escapes that exact substring when it appears
// inside a <style> element's own text content (to protect the HTML
// tokenizer), producing `<\73 tyle>` (CSS hex-escaped "s") in the bytes sent
// to the browser — but the RSC hydration payload used to reconcile on the
// client carries the original, unescaped string. The two permanently
// disagree, so React threw error #418 on every single load of every company
// page, unconditionally (not data/session/timing dependent — it fired for
// both authenticated and anonymous requests, both symbols, in local repro).
//
// Fix: reworded the comment to describe the tag in words, never spelling out
// the literal open-angle-bracket/s/t/y/l/e/close-angle-bracket sequence
// anywhere inside CompanyPageStyleBlock's own <style> string.
//
// This spec intentionally does NOT mock any backend calls — it loads the
// real page (fail-soft 401/empty states are fine off-hours or without a
// session) and only asserts on `pageerror` events, which is where minified
// React error #418 surfaces in the browser console.
const HYDRATION_ERROR_PATTERN =
  /Hydration failed|#418|#423|did not match|didn't match|Text content does not match/i;

const SYMBOLS = ["2330", "3661"];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

test.describe("company page — zero hydration errors 2026-07-19 (jim3)", () => {
  test.describe.configure({ retries: 1 });

  // Local `next dev` compiles the large /companies/[symbol] tree on demand —
  // warm it up once so per-test navigations below aren't racing a cold
  // webpack compile.
  test.beforeAll(async ({ browser }) => {
    const warmPage = await browser.newPage();
    await warmPage.goto("/companies/2330", { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => {});
    await warmPage.close();
  });

  for (const symbol of SYMBOLS) {
    for (const viewport of VIEWPORTS) {
      test(`/companies/${symbol} @ ${viewport.name} (${viewport.width}x${viewport.height}) — 0 pageerrors`, async ({ page }) => {
        test.setTimeout(120_000);
        const pageErrors: string[] = [];
        page.on("pageerror", (err) => pageErrors.push(err.message));

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`/companies/${symbol}`, { waitUntil: "domcontentloaded" });
        // Give React time to complete the hydration pass (and any retry
        // render) before asserting — error #418 is thrown synchronously
        // during that pass, well within this window.
        await page.waitForTimeout(3000);

        const hydrationErrors = pageErrors.filter((msg) => HYDRATION_ERROR_PATTERN.test(msg));
        expect(hydrationErrors, `hydration errors on /companies/${symbol} @ ${viewport.name}:\n${hydrationErrors.join("\n---\n")}`).toHaveLength(0);
        expect(pageErrors, `unexpected pageerrors on /companies/${symbol} @ ${viewport.name}:\n${pageErrors.join("\n---\n")}`).toHaveLength(0);
      });
    }
  }
});

// ── Round 2 (2026-07-20, jim9) — second, unrelated root cause: intraday-only
// intermittent #418 (this one WAS timing/session dependent — Elva saw it fire
// on one run and not the next against the same page). Root cause:
// CompanyHeroBar.tsx (a "use client" component, but still server-rendered on
// first load) called `Date.now()` directly inside its render body to compute
// `freshness_mode` for the FreshnessBadge. `computeFreshnessMode` is
// age-based — a kgi-gateway-sourced quote flips live<->stale at a tight <=2s
// cutoff, and the "略舊 Ns" age text re-buckets every second — so the SSR
// pass (server request instant) and the client's first hydration-render
// pass (a later, different real instant) could compute two different
// freshness values for the *same* `realtimeQuote` prop, flipping the
// badge's DOM branch and throwing #418. This only ever reproduced while a
// live kgi-gateway quote was in flight (intraday, gateway up) — off-hours
// quotes are eod/close, which are age-independent, so it never fired after
// market close, matching the 7/19 fix's "0 errors" result and this bug's
// "盤中間歇" report.
//
// Fix: apps/web/app/companies/[symbol]/CompanyHeroBar.tsx now pins its
// freshness `nowMs` to a `serverNowMs` prop (captured once by the Server
// Component in page.tsx at request time) until a post-mount effect swaps it
// for the client's own live clock — so the SSR output and the client's
// first render are byte-identical by construction, not by lucky timing. See
// CompanyHeroBar.test.ts for the source-level lock on that pattern.
//
// This E2E test cannot force the exact SSR-vs-hydrate clock race (SSR runs
// in the Node process, outside Playwright's reach — `page.clock` only
// controls the browser's Date/timers, not the server's). Instead it widens
// the *natural* SSR-to-hydrate gap by artificially delaying every JS chunk
// response, a realistic proxy for a slow client boot (throttled network /
// low-end device / large bundle) that maximizes the chance of crossing a
// timing threshold if a bare `Date.now()`-in-render bug were still present
// anywhere in this render path.
test.describe("company page — intraday clock-skew hydration safety 2026-07-20 (jim9)", () => {
  test.describe.configure({ retries: 1 });

  for (const symbol of SYMBOLS) {
    test(`/companies/${symbol} — 0 pageerrors when client JS boot is artificially delayed`, async ({ page }) => {
      test.setTimeout(60_000);
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // Delay every Next.js JS chunk response so the client's first
      // hydration-render pass lands several real seconds after the SSR
      // response was generated — widening the SSR-vs-hydrate clock gap
      // far past the 2s kgi-gateway live/stale cutoff.
      await page.route("**/_next/static/**/*.js", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.continue();
      });

      await page.goto(`/companies/${symbol}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);

      const hydrationErrors = pageErrors.filter((msg) => HYDRATION_ERROR_PATTERN.test(msg));
      expect(hydrationErrors, `hydration errors on /companies/${symbol} under delayed boot:\n${hydrationErrors.join("\n---\n")}`).toHaveLength(0);
    });
  }
});
