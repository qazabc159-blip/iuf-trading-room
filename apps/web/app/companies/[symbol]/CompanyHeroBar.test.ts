/**
 * CompanyHeroBar.test.ts
 * P1-10 (reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md): the KPI
 * strip's price cell used `white-space:nowrap; overflow:hidden;
 * text-overflow:ellipsis`, which truncated the page's most important number
 * ("最新價") to "2,41…" whenever the rendered text exceeded the cell width.
 *
 * Source-grep test (no jsdom/testing-library dependency in this repo — see
 * industry-heatmap-representatives.test.ts for the established convention).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("./CompanyHeroBar.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");
const pageSourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
const pageSource = readFileSync(pageSourcePath, "utf8");

// The base rule (desktop + all sizes) is the multi-line block right after
// `._co-kpi-value {` that also sets `font-family: var(--mono)` — distinct
// from the single-line `@media (max-width: 640px) { ._co-kpi-value { ... } }`
// font-size override earlier in the file, which never touched overflow/wrap
// behaviour and is untouched by this fix.
const baseValueBlock = source.match(/\._co-kpi-value \{\r?\n[\s\S]*?font-family: var\(--mono\);[\s\S]*?\r?\n\}/)?.[0] ?? "";

describe("CompanyHeroBar KPI value truncation gate", () => {
  it("finds the base ._co-kpi-value rule to assert against", () => {
    expect(baseValueBlock).not.toBe("");
  });

  it("no longer truncates numeric KPI values with an ellipsis", () => {
    expect(baseValueBlock).not.toContain("text-overflow: ellipsis");
    expect(baseValueBlock).not.toContain("white-space: nowrap");
  });

  it("allows long numeric values to wrap instead of being cut off", () => {
    expect(baseValueBlock).toContain("overflow-wrap: anywhere");
  });
});

/**
 * Regression lock (2026-07-20, jim9): React #418 intraday hydration mismatch.
 *
 * Root cause: `computeFreshnessMode`/`computeFreshness_ms` are age-based
 * (kgi-gateway quotes flip live<->stale at a <=2s cutoff; the "略舊 Ns" age
 * text re-buckets every second). The component used to call `Date.now()`
 * directly inside its render body, so the SSR pass (server request instant)
 * and the client's first hydration-render pass (a later, different real
 * instant) could compute two different freshness values for the identical
 * `realtimeQuote` prop — flipping the FreshnessBadge's mode/DOM branch and
 * throwing an intermittent #418, reproducible only intraday while a
 * kgi-gateway quote is in flight (off-hours quotes are eod/close, which are
 * age-independent, so this never fired after 15:00).
 *
 * Fix: freshness is computed from a `nowMs` local that is pinned to a
 * server-captured `serverNowMs` prop until a post-mount effect swaps it for
 * the client's live clock — guaranteeing the SSR output and the client's
 * first render are byte-identical (see `serverNowMs` prop doc comment in
 * CompanyHeroBar.tsx). This test locks that pattern at the source level so
 * a future edit can't silently reintroduce a bare `Date.now()` call inside
 * the render body (the actual runtime proof is
 * packages/qa-playwright/tests/jim3_company_hydration_20260719.spec.ts,
 * which asserts zero pageerrors on real page loads).
 */
describe("CompanyHeroBar freshness computation stays SSR/hydration-safe", () => {
  it("does not call Date.now() directly inside computeFreshnessMode/computeFreshness_ms", () => {
    expect(source).not.toContain("computeFreshnessMode(realtimeQuote, Date.now())");
    expect(source).not.toContain("computeFreshness_ms(realtimeQuote, Date.now())");
  });

  it("gates the clock behind a mounted flag seeded by a server-provided instant", () => {
    expect(source).toMatch(/const \[mounted, setMounted\] = useState\(false\)/);
    expect(source).toMatch(/const nowMs = mounted \? Date\.now\(\) : serverNowMs/);
    expect(source).toContain("computeFreshnessMode(realtimeQuote, nowMs)");
    expect(source).toContain("computeFreshness_ms(realtimeQuote, nowMs)");
  });

  it("requires callers to pass serverNowMs (no silent Date.now() fallback default)", () => {
    expect(source).toMatch(/serverNowMs: number;/);
    expect(source).not.toMatch(/serverNowMs\s*=\s*Date\.now\(\)/);
  });

  it("page.tsx (Server Component) supplies serverNowMs from its own request-time clock", () => {
    expect(pageSource).toMatch(/<CompanyHeroBar[\s\S]*?serverNowMs=\{Date\.now\(\)\}[\s\S]*?\/>/);
  });
});
