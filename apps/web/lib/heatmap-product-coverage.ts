import { isUsableHeatmapTile, type HeatmapUsabilityTile } from "./heatmap-tile-usability";

// Kept as an alias so existing imports of `HeatmapCoverageTile` (this file's
// public type) keep working unchanged — the shape is identical to the
// canonical usability tile shared with the tile-render gate.
export type HeatmapCoverageTile = HeatmapUsabilityTile;

export const MIN_PRODUCT_HEATMAP_COVERAGE = 70;

// 2026-07-24: the coverage count now runs through the exact same
// `isUsableHeatmapTile()` predicate the tile-render gate uses (readiness /
// no_data / valid move / freshness), instead of a separately-maintained
// "verified move" check that didn't look at readiness/freshness at all. See
// `heatmap-tile-usability.ts` doc comment for why this was unified — a
// PR #1361 review finding (Pete 🟡 #1/#2).
export function hasProductHeatmapCoverage(tiles: HeatmapCoverageTile[]) {
  const symbols = new Set<string>();

  for (const tile of tiles) {
    const symbol = tile.symbol?.trim();
    if (!symbol) continue;
    if (!isUsableHeatmapTile(tile)) continue;
    symbols.add(symbol);
  }

  return symbols.size >= MIN_PRODUCT_HEATMAP_COVERAGE;
}
