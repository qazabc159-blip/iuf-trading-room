/**
 * kgi-core-afterhours-close.test.ts — 2026-07-15
 *
 * Covers the two pieces added to fix "盤後 kgi-core 端點空窗": a new Tier 2.5
 * DB-persisted last-close fallback in the enricher (durable across deploy
 * restarts, unlike Tier 3's in-process cache), and the after-hours gate in
 * server.ts that decides when to query it (via lib/trading-calendar, not a
 * bare wall-clock guess).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/kgi-core-afterhours-close.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import { enrichHeatmapTiles } from "../kgi-heatmap-enricher.js";
import type { KgiHeatmapTile } from "../kgi-subscription-manager.js";
import type { StockDayAllRow } from "../data-sources/twse-openapi-client.js";
import type { LastCloseResult } from "../quote-last-close-store.js";
import { _isKgiHeatmapAfterHours } from "../server.js";

function bareTile(symbol: string): KgiHeatmapTile {
  return { symbol, name: `stock-${symbol}`, price: null, change: null, changePct: null, tier: "core", ts: null, source: "kgi_tick" };
}

test("Tier 2.5: dbCloseMap fills a tile's PRICE when live/mis/twse all miss, but is honestly no_data (2026-07-17 gating fix)", () => {
  // 2026-07-17: previously labeled "twse_eod" — indistinguishable from a
  // real full EOD tile with a genuine % move — which is exactly the "有價
  // 無漲跌幅但看起來像正常格" bug 楊董 caught (OTC symbol 3707: price=68.7,
  // changePct=null, sourceState="twse_eod"). quote_last_close's schema has
  // no prevClose/change column, so this tier can NEVER supply a real %
  // move — it must be reported as "no_data" so the frontend's existing
  // no_data handling (never render a fabricated/blank %, substitute a real
  // supplemental company) applies. Price is still returned for API
  // completeness — see reports/sprint_2026_07_17/
  // HEATMAP_DATA_HONESTY_GATING_2026_07_17.md.
  const kgiTiles: KgiHeatmapTile[] = [bareTile("2330")];
  const twseRows: StockDayAllRow[] = []; // upstream unreachable / not yet published today
  const dbCloseMap = new Map<string, LastCloseResult>([
    ["2330", { closePrice: 1015, tradeDate: "2026-07-14", source: "twse_eod" }],
  ]);

  const result = enrichHeatmapTiles(kgiTiles, twseRows, undefined, undefined, dbCloseMap);
  const tile = result.tiles[0]!;
  assert.equal(tile.sourceState, "no_data", "Tier 2.5 hit must not masquerade as twse_eod");
  assert.equal(tile.price, 1015, "price is still honestly returned");
  assert.equal(tile.ts, "2026-07-14T13:30:00+08:00");
  assert.equal(result.twseEodTileCount, 0, "no_data must not count toward twseEodTileCount");
  // Never silently invents a change/changePct the DB row doesn't carry.
  assert.equal(tile.change, null);
  assert.equal(tile.changePct, null);
});

test("Tier ordering: a live TWSE STOCK_DAY_ALL row still wins over dbCloseMap", () => {
  const kgiTiles: KgiHeatmapTile[] = [bareTile("2317")];
  const twseRows: StockDayAllRow[] = [
    { Code: "2317", Name: "鴻海", ClosingPrice: "200", Change: "5", Date: "1150715", TradeVolume: "1", TradeValue: "1", OpeningPrice: "200", HighestPrice: "200", LowestPrice: "200", Transaction: "1" } as StockDayAllRow,
  ];
  const dbCloseMap = new Map<string, LastCloseResult>([
    ["2317", { closePrice: 999, tradeDate: "2026-07-10", source: "twse_eod" }],
  ]);

  const result = enrichHeatmapTiles(kgiTiles, twseRows, undefined, undefined, dbCloseMap);
  const tile = result.tiles[0]!;
  assert.equal(tile.sourceState, "twse_eod");
  assert.equal(tile.price, 200, "live-fetched Tier 2 row must win over the stale DB fallback");
});

test("Never drops a tile: dbCloseMap present but symbol missing from it still falls through honestly", () => {
  const kgiTiles: KgiHeatmapTile[] = [bareTile("9999")];
  const dbCloseMap = new Map<string, LastCloseResult>([
    ["2330", { closePrice: 1015, tradeDate: "2026-07-14", source: "twse_eod" }],
  ]);
  const result = enrichHeatmapTiles(kgiTiles, [], undefined, undefined, dbCloseMap);
  const tile = result.tiles[0]!;
  assert.equal(tile.sourceState, "no_data");
  assert.equal(tile.price, null);
});

// ── after-hours gate ─────────────────────────────────────────────────────────
// 2026-07-15 is a Wednesday (weekday); 2026-07-18 is the following Saturday.
// isTwTradingDay() falls back to a weekend-only check outside database mode
// (the default for `node --test`), so these are deterministic without a DB.

function taipeiMs(y: number, m: number, d: number, hh: number, mm: number): number {
  // Construct a UTC instant whose Taipei-local (+8) wall clock reads y-m-d hh:mm.
  return Date.UTC(y, m - 1, d, hh - 8, mm);
}

test("_isKgiHeatmapAfterHours: false during weekday market session (Wed 10:00)", async () => {
  assert.equal(await _isKgiHeatmapAfterHours(taipeiMs(2026, 7, 15, 10, 0)), false);
});

test("_isKgiHeatmapAfterHours: true after weekday close (Wed 14:00)", async () => {
  assert.equal(await _isKgiHeatmapAfterHours(taipeiMs(2026, 7, 15, 14, 0)), true);
});

test("_isKgiHeatmapAfterHours: true before weekday open (Wed 08:00)", async () => {
  assert.equal(await _isKgiHeatmapAfterHours(taipeiMs(2026, 7, 15, 8, 0)), true);
});

test("_isKgiHeatmapAfterHours: true on a non-trading weekend day even at midday (Sat 10:00)", async () => {
  assert.equal(await _isKgiHeatmapAfterHours(taipeiMs(2026, 7, 18, 10, 0)), true);
});
