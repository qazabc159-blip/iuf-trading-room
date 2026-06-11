/**
 * Heatmap consistency + last-good guardrails (Elva 2026-06-11, audit R2).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/heatmap-consistency.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import { enrichHeatmapTiles, type MisTileEntry } from "../kgi-heatmap-enricher.js";
import type { KgiHeatmapTile } from "../kgi-subscription-manager.js";
import type { StockDayAllRow } from "../data-sources/twse-openapi-client.js";
import {
  getTwseIndustryHeatmap,
  _resetTwseHeatmapCache,
  _resetStockDayAllCache,
} from "../data-sources/twse-openapi-client.js";

function todayYmdTaipei(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

function stockRow(code: string, close: string, change: string, date: string): StockDayAllRow {
  return {
    Code: code,
    Name: `stock-${code}`,
    ClosingPrice: close,
    Change: change,
    Date: date,
    TradeVolume: "1000",
    TradeValue: "100000",
    OpeningPrice: close,
    HighestPrice: close,
    LowestPrice: close,
    Transaction: "10",
  } as StockDayAllRow;
}

test("MIS tile change and changePct never contradict in sign (6/10 regression)", () => {
  // Repro of the 6/10 bug: the TWSE EOD row lags a session (its implied prevClose is
  // two sessions old) while MIS has today's crash. change must come from MIS's own pct.
  const kgiTiles: KgiHeatmapTile[] = [
    { symbol: "2454", name: "聯發科", price: null, change: null, changePct: null, tier: "core", ts: null, source: "kgi_tick" },
  ];
  // Stale TWSE EOD row (yesterday's rally close 4470, change +85)
  const twseRows = [stockRow("2454", "4470", "85", "1150609")];
  const misCache = new Map<string, MisTileEntry>([
    ["2454", { last: 4150, changePct: -7.15, ts: new Date().toISOString(), tradeDateYmd: todayYmdTaipei() }],
  ]);

  const result = enrichHeatmapTiles(kgiTiles, twseRows, misCache);
  const tile = result.tiles[0]!;
  assert.equal(tile.sourceState, "twse_mis_intraday");
  assert.equal(tile.changePct, -7.15);
  assert.ok(tile.change !== null && tile.change < 0, `change must be negative to match changePct, got ${tile.change}`);
  // change ≈ last - last/(1+pct/100) = 4150 - 4469.6 ≈ -319.6
  assert.ok(Math.abs((tile.change ?? 0) - -319.64) < 1, `change ≈ -319.64, got ${tile.change}`);
});

test("getTwseIndustryHeatmap serves last-good tiles on transient upstream outage", async () => {
  _resetTwseHeatmapCache();
  _resetStockDayAllCache();

  const goodRows = [stockRow("2330", "1000", "10", "1150610")];
  const okFetch = (async () =>
    new Response(JSON.stringify(goodRows), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const failFetch = (async () => new Response("oops", { status: 503 })) as unknown as typeof fetch;

  // 1. Healthy fetch populates last-good
  const mapping1 = new Map<string, string>([["2330", "半導體業"]]);
  const tiles1 = await getTwseIndustryHeatmap(mapping1, { fetchOverride: okFetch });
  assert.ok(tiles1.length > 0, "healthy fetch should produce tiles");

  // 2. Upstream outage — must serve last-good, not an empty array.
  // Different mapping size → different TTL-cache key, so upstream is really re-hit.
  _resetStockDayAllCache();
  const mapping2 = new Map<string, string>([["2330", "半導體業"], ["2317", "電子業"]]);
  const tiles2 = await getTwseIndustryHeatmap(mapping2, { fetchOverride: failFetch });
  assert.ok(tiles2.length > 0, "outage must serve last-good tiles instead of a blank heatmap");
  assert.equal(tiles2[0]!.industry, "半導體業");

  _resetTwseHeatmapCache();
  _resetStockDayAllCache();
});
