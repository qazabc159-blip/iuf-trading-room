/**
 * company-hero-prefill-cta.test.ts
 *
 * P0 決策鏈斷節 (體檢報告)：公司頁 hero 沒有「帶入交易室」CTA — 看完研究要下
 * 紙上單得自己繞路。Verifies (1) the href builder (apps/web/lib/company-prefill.ts)
 * matches the existing /portfolio handoff contract used by SignalCtaRow /
 * ai-recommendation-handoff (ticker + prefill=true, same param names/values —
 * see portfolio-handoff.ts HANDOFF_PARAMS), (2) the built href round-trips
 * end-to-end through parsePaperPrefillSearchParams (the function /portfolio's
 * page.tsx actually calls) without loss, and (3) the CTA markup/CSS is
 * present with a 44px touch target (source-grep — importing CompanyHeroBar.tsx
 * itself fails Vite's JSX parser on unrelated pre-existing syntax, same
 * reason CompanyHeroBar.test.ts only ever source-greps it).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildCompanyPrefillHref } from "@/lib/company-prefill";
import { parsePaperPrefillSearchParams } from "@/lib/portfolio-handoff";

const sourcePath = fileURLToPath(new URL("./CompanyHeroBar.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

describe("buildCompanyPrefillHref", () => {
  it("builds a /portfolio href with ticker + prefill=true, matching SignalCtaRow's contract", () => {
    expect(buildCompanyPrefillHref("2330")).toBe("/portfolio?ticker=2330&prefill=true");
  });

  it("URL-encodes symbols with special characters", () => {
    expect(buildCompanyPrefillHref("00631L")).toBe("/portfolio?ticker=00631L&prefill=true");
  });
});

describe("company hero CTA -> /portfolio query round-trip", () => {
  it("the built href parses back into an enabled prefill with the same symbol", () => {
    const href = buildCompanyPrefillHref("2330");
    const query = href.split("?")[1] ?? "";
    const parsed = parsePaperPrefillSearchParams(new URLSearchParams(query));
    expect(parsed).not.toBeNull();
    expect(parsed?.enabled).toBe(true);
    expect(parsed?.symbol).toBe("2330");
  });
});

describe("company hero CTA markup + touch target", () => {
  it("renders a 帶入模擬單 link using buildCompanyPrefillHref", () => {
    expect(source).toContain('href={buildCompanyPrefillHref(company.symbol)}');
    expect(source).toContain("帶入模擬單");
    expect(source).toContain('data-testid="company-hero-prefill-cta"');
  });

  it("imports buildCompanyPrefillHref from the shared lib (not a local duplicate)", () => {
    expect(source).toContain('import { buildCompanyPrefillHref } from "@/lib/company-prefill";');
  });

  it("the CTA class enforces a >=44px touch target on all breakpoints (not just mobile)", () => {
    const ctaBlock = source.match(/\._co-hero-cta \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(ctaBlock).not.toBe("");
    expect(ctaBlock).toContain("min-height: 44px");
    expect(ctaBlock).toContain("min-width: 44px");
  });
});
