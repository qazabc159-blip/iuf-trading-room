/**
 * company-prefill.ts — builds the /companies/[symbol] hero「帶入模擬單」CTA
 * href.
 *
 * Mirrors SignalCtaRow.buildPrefillHref (apps/web/app/signals/SignalCtaRow.tsx)
 * and the same /portfolio handoff contract consumed by
 * parsePaperPrefillSearchParams (apps/web/lib/portfolio-handoff.ts
 * HANDOFF_PARAMS): ticker + prefill=true only — the company hero has no
 * recommendation direction to hand off, just "start a paper order on this
 * ticker".
 *
 * Kept in a plain .ts file (not inline in CompanyHeroBar.tsx) so it can be
 * unit-tested directly — importing CompanyHeroBar.tsx itself into a vitest
 * module graph fails Vite's JSX parser on unrelated pre-existing syntax in
 * that file (see CompanyHeroBar.test.ts, which only ever source-greps it).
 */
export function buildCompanyPrefillHref(symbol: string) {
  const params = new URLSearchParams({ ticker: symbol, prefill: "true" });
  return `/portfolio?${params.toString()}`;
}
