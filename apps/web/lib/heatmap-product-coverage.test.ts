import { describe, expect, it } from "vitest";
import { hasProductHeatmapCoverage, MIN_PRODUCT_HEATMAP_COVERAGE } from "./heatmap-product-coverage";

function tile(symbol: number, pct: number | null = 1) {
  return { symbol: String(1000 + symbol), pct };
}

describe("heatmap product coverage gate", () => {
  it("blocks cold-start core-only heatmaps before the representative feed is ready", () => {
    const coldStartTiles = Array.from({ length: 23 }, (_, index) => tile(index));
    expect(hasProductHeatmapCoverage(coldStartTiles)).toBe(false);
  });

  it("allows product heatmaps once the representative feed has broad verified coverage", () => {
    const productTiles = Array.from({ length: MIN_PRODUCT_HEATMAP_COVERAGE }, (_, index) => tile(index));
    expect(hasProductHeatmapCoverage(productTiles)).toBe(true);
  });

  it("does not count no-data or unverified tiles toward product coverage", () => {
    const rows = [
      ...Array.from({ length: MIN_PRODUCT_HEATMAP_COVERAGE - 1 }, (_, index) => tile(index)),
      { symbol: "9998", pct: null, sourceState: "no_data" },
      { symbol: "9999", pct: null, close: null, prevClose: null },
    ];

    expect(hasProductHeatmapCoverage(rows)).toBe(false);
  });
});
