/**
 * industry-heatmap-chip.ts — pure formatter extracted out of
 * industry-heatmap.tsx so it can be unit-tested directly.
 *
 * This project's vitest config has no JSX/React transform plugin
 * (`vitest.config.ts` + `tsconfig.base.json`'s `jsx: "preserve"`), so a
 * `.test.ts` file cannot directly `import` a `.tsx` module that contains
 * actual JSX markup — Vite's import-analysis step fails on the untransformed
 * JSX. Pure logic that needs a direct unit test (as opposed to the
 * source-grep convention used elsewhere in this file's sibling test) has to
 * live in a plain `.ts` file instead.
 */

/** Pure formatter for the sector-tab chip label.
 *
 * P1-3 (reports/product_critique_20260710/PRODUCT_CRITIQUE_v1.md): each
 * sector tab's chip used to show a bare count (e.g. "半導體業 13 檔") drawn
 * from that tab's own independent 15-symbol representative pool, while
 * "全部" showed a count from a completely different 40-symbol pool. Summing
 * the per-sector numbers never equals the "全部" total by design, which read
 * as a fake/inconsistent count. Showing "available/pool-size" makes the
 * denominator explicit and the numbers honest without claiming to be a
 * partition of the "全部" total.
 */
export function formatSectorChipCount(availableCount: number, target: number): string {
  return target > 0 ? `${availableCount}/${target} 檔` : `${availableCount} 檔`;
}
