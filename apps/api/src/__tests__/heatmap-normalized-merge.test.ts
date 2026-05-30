import test from "node:test";
import assert from "node:assert/strict";

import { normalizeTwseIndustryZhTw } from "../utils/twse-industry-normalize.js";
import { normalizeAndMergeTwseHeatmapTiles } from "../utils/heatmap-normalized-merge.js";

test("normalizeAndMergeTwseHeatmapTiles merges labels that normalize to the same industry", () => {
  const tiles = normalizeAndMergeTwseHeatmapTiles([
    {
      industry: "semiconductors",
      avgChangePct: 1,
      gainerCount: 2,
      loserCount: 0,
      flatCount: 0,
      stockCount: 2,
      source: "twse_openapi",
    },
    {
      industry: "semiconductor",
      avgChangePct: -1,
      gainerCount: 0,
      loserCount: 1,
      flatCount: 0,
      stockCount: 1,
      source: "twse_openapi",
    },
  ]);

  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].industry, normalizeTwseIndustryZhTw("semiconductors"));
  assert.equal(tiles[0].gainerCount, 2);
  assert.equal(tiles[0].loserCount, 1);
  assert.equal(tiles[0].flatCount, 0);
  assert.equal(tiles[0].stockCount, 3);
  assert.equal(tiles[0].avgChangePct, 0.33);
});

test("normalizeAndMergeTwseHeatmapTiles keeps separate industries and sorts by move size", () => {
  const tiles = normalizeAndMergeTwseHeatmapTiles([
    {
      industry: "banks",
      avgChangePct: 0.4,
      gainerCount: 1,
      loserCount: 0,
      flatCount: 0,
      stockCount: 1,
      source: "twse_openapi",
    },
    {
      industry: "steel",
      avgChangePct: -2.5,
      gainerCount: 0,
      loserCount: 2,
      flatCount: 0,
      stockCount: 2,
      source: "twse_openapi",
    },
  ]);

  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].industry, normalizeTwseIndustryZhTw("steel"));
  assert.equal(tiles[1].industry, normalizeTwseIndustryZhTw("banks"));
});
