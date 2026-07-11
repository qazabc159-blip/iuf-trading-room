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
