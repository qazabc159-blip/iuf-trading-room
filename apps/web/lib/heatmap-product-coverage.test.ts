import { describe, expect, it } from "vitest";
import { hasProductHeatmapCoverage, MIN_PRODUCT_HEATMAP_COVERAGE } from "./heatmap-product-coverage";
import { isUsableHeatmapTile } from "./heatmap-tile-usability";

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

  // 2026-07-24: root cause of PR #1361 review's product-side gap (Pete 🟡 #1/#2).
  // Coverage used to be counted with a laxer check than the tile-render gate
  // (isUsableHeatmapTile / IndustryHeatmap's isUsableTile) — a heatmap could
  // pass coverage (banner stays silent, no "暖機中" fallback) while every
  // single tile was individually excluded from the grid by freshnessStatus,
  // leaving the user looking at an unexplained empty grid. Coverage must now
  // agree with the tile gate: if every tile would be filtered from render,
  // coverage must report false so the existing "暖機中" fallback banner (and
  // the market-wide fallback view) kicks in instead.
  it("reports NO coverage when every tile has a verified move but is stale-filtered (freshnessStatus=missing) — this is the #1361 divergence fixture", () => {
    const rows = Array.from({ length: MIN_PRODUCT_HEATMAP_COVERAGE }, (_, index) => ({
      ...tile(index),
      freshnessStatus: "missing" as const,
    }));

    // Sanity: these tiles do have a verified move (this is exactly the case
    // the OLD coverage check would have wrongly counted as "covered").
    expect(rows.every((row) => isUsableHeatmapTile(row) === false)).toBe(true);
    expect(hasProductHeatmapCoverage(rows)).toBe(false);
  });

  it("reports NO coverage when every tile is readiness=blocked despite having a verified move", () => {
    const rows = Array.from({ length: MIN_PRODUCT_HEATMAP_COVERAGE }, (_, index) => ({
      ...tile(index),
      readiness: "blocked" as const,
    }));

    expect(hasProductHeatmapCoverage(rows)).toBe(false);
  });

  it("still reports coverage when tiles are fresh (freshnessStatus unset/fresh) — zero regression for the normal-data path", () => {
    const freshRows = Array.from({ length: MIN_PRODUCT_HEATMAP_COVERAGE }, (_, index) => ({
      ...tile(index),
      freshnessStatus: "fresh" as const,
    }));
    expect(hasProductHeatmapCoverage(freshRows)).toBe(true);

    const unsetFreshnessRows = Array.from({ length: MIN_PRODUCT_HEATMAP_COVERAGE }, (_, index) => tile(index));
    expect(hasProductHeatmapCoverage(unsetFreshnessRows)).toBe(true);
  });
});

describe("heatmap-tile-usability / heatmap-product-coverage share one predicate (PR #1361 review fix)", () => {
  it("hasProductHeatmapCoverage's per-tile inclusion is exactly isUsableHeatmapTile — no second copy of the judgment", () => {
    const mixedRows = [
      ...Array.from({ length: MIN_PRODUCT_HEATMAP_COVERAGE }, (_, index) => tile(index)),
      { symbol: "8001", pct: 1, freshnessStatus: "missing" as const },
      { symbol: "8002", pct: 1, readiness: "blocked" as const },
      { symbol: "8003", pct: null, sourceState: "no_data" },
    ];
    const usableSymbols = new Set(mixedRows.filter(isUsableHeatmapTile).map((row) => row.symbol));
    expect(usableSymbols.size).toBe(MIN_PRODUCT_HEATMAP_COVERAGE);
    expect(usableSymbols.has("8001")).toBe(false);
    expect(usableSymbols.has("8002")).toBe(false);
    expect(usableSymbols.has("8003")).toBe(false);
    expect(hasProductHeatmapCoverage(mixedRows)).toBe(true); // still >= threshold from the 70 base rows
  });
});
