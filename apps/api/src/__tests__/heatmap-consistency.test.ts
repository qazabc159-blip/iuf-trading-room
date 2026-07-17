/**
 * Heatmap consistency + last-good guardrails (Elva 2026-06-11, audit R2).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/heatmap-consistency.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

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

test("kgi-core heatmap: comma-formatted TWSE ClosingPrice (>=1,000) must not truncate to a single digit (2026-07-17 P1 regression)", () => {
  // Repro of the 2026-07-17 prod bug: TWSE STOCK_DAY_ALL/afterTrading rows
  // format ClosingPrice with a thousands-comma once price crosses 1,000
  // ("2,470.0000"). A bare parseFloat() stopped at the comma and returned
  // just `2` — exactly what Bruce's prod verify caught for 2330/2454/2308/
  // 3008/6669 (all >=1,000 that day) while the other 35 sub-1,000 tiles
  // were unaffected.
  const kgiTiles: KgiHeatmapTile[] = [
    { symbol: "2330", name: "台積電", price: null, change: null, changePct: null, tier: "core", ts: null, source: "kgi_tick" },
  ];
  const twseRows = [stockRow("2330", "2,470.0000", "-30.0000", "1150717")];

  const result = enrichHeatmapTiles(kgiTiles, twseRows);
  const tile = result.tiles[0]!;
  assert.equal(tile.sourceState, "twse_eod");
  assert.equal(tile.price, 2470, `price must be the full comma-parsed value, got ${tile.price}`);
  assert.equal(tile.change, -30);
  assert.ok(tile.changePct !== null && Math.abs(tile.changePct - -1.2) < 0.05, `changePct ≈ -1.2, got ${tile.changePct}`);
});

test("kgi-core heatmap: a TWSE row with an implausible changePct must never leak a corrupted price — falls through to no_data", () => {
  // Defense-in-depth: even if some future/unforeseen parse issue produces a
  // garbage close price (simulated here directly, independent of the comma
  // bug above), the resulting pctRaw computation blows past the ±10% daily
  // limit band. The enricher must drop the WHOLE row (not just null
  // changePct while still serving the corrupted price) so the tile falls
  // through to the next tier (here: no_data, since no cache/db/MIS entry
  // exists for this symbol in this test).
  const kgiTiles: KgiHeatmapTile[] = [
    { symbol: "3008", name: "大立光", price: null, change: null, changePct: null, tier: "core", ts: null, source: "kgi_tick" },
  ];
  // close=2 (garbage), change=-180 (real magnitude) → prevClose=182, pctRaw ≈ -98.9% (implausible)
  const twseRows = [stockRow("3008", "2", "-180", "1150717")];

  const result = enrichHeatmapTiles(kgiTiles, twseRows);
  const tile = result.tiles[0]!;
  assert.equal(tile.sourceState, "no_data", `corrupted row must not surface as twse_eod, got ${tile.sourceState}`);
  assert.equal(tile.price, null, `price must never be the corrupted value 2, got ${tile.price}`);
});

test("PERF: fetchKgiLatestTick short-circuits when the gateway is scheduled off", () => {
  // 6/15 15:13: /heatmap/kgi-core (40 parallel symbols) and /overview/kgi
  // burned ~3.5s per request because fetchKgiLatestTick had no scheduled-off
  // guard — every off-hours call waited the full 3s gateway timeout. The guard
  // must run before the fetch so the enricher/overview fall through to MIS/EOD.
  const src = readFileSync(path.join(process.cwd(), "apps/api/src/kgi-subscription-manager.ts"), "utf8");
  const fnStart = src.indexOf("async function fetchKgiLatestTick");
  assert.ok(fnStart >= 0, "fetchKgiLatestTick must exist");
  // Slice to the next top-level declaration so we capture the whole function.
  const rel = src.slice(fnStart + 1).search(/\n(?:async )?function /);
  const fnBody = src.slice(fnStart, rel >= 0 ? fnStart + 1 + rel : undefined);
  const guardIdx = fnBody.indexOf("isKgiGatewayScheduledOff");
  const fetchIdx = fnBody.indexOf("await fetch(");
  assert.ok(guardIdx >= 0, "fetchKgiLatestTick must consult isKgiGatewayScheduledOff");
  assert.ok(fetchIdx >= 0, "fetchKgiLatestTick must still call the gateway during a live session");
  assert.ok(guardIdx < fetchIdx, "the scheduled-off guard must run before the gateway fetch");
  assert.match(fnBody, /if \(isKgiGatewayScheduledOff\(\)\) return nullTickSnapshot\(symbol\)/);
});
