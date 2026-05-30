export type HeatmapCoverageTile = {
  symbol?: string | null;
  pct?: number | null;
  change?: number | null;
  close?: number | null;
  prevClose?: number | null;
  sourceState?: string | null;
};

export const MIN_PRODUCT_HEATMAP_COVERAGE = 70;

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function hasHeatmapVerifiedMove(tile: HeatmapCoverageTile) {
  if (finiteNumber(tile.pct) !== null) return true;
  if (finiteNumber(tile.change) !== null) return true;

  const close = finiteNumber(tile.close);
  const prevClose = finiteNumber(tile.prevClose);
  return close !== null && prevClose !== null && prevClose > 0;
}

export function hasProductHeatmapCoverage(tiles: HeatmapCoverageTile[]) {
  const symbols = new Set<string>();

  for (const tile of tiles) {
    const symbol = tile.symbol?.trim();
    if (!symbol) continue;
    if (tile.sourceState === "no_data") continue;
    if (!hasHeatmapVerifiedMove(tile)) continue;
    symbols.add(symbol);
  }

  return symbols.size >= MIN_PRODUCT_HEATMAP_COVERAGE;
}
