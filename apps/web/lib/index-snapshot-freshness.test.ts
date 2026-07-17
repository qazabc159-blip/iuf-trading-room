/**
 * index-snapshot-freshness.test.ts — 2026-07-17 data-honesty gating fix
 *
 * Covers the "banner 顯示 07/16 收盤但熱力圖磚是 07/17" bug: readMarketIndex()
 * in app/page.tsx must prefer whichever TAIEX snapshot has the genuinely
 * newer trade date so the banner date never disagrees with the heatmap
 * tiles the user is looking at.
 */
import { describe, expect, it } from "vitest";
import { isNewerTaipeiTradeDate, resolveAuthoritativeTradeDate } from "./index-snapshot-freshness";

describe("isNewerTaipeiTradeDate", () => {
  it("candidate one day newer than current → true (the 07/16 banner vs 07/17 tiles repro)", () => {
    expect(isNewerTaipeiTradeDate("2026-07-17T05:30:00.000Z", "2026-07-16T08:00:00.000Z")).toBe(true);
  });

  it("candidate one day older than current → false", () => {
    expect(isNewerTaipeiTradeDate("2026-07-16T08:00:00.000Z", "2026-07-17T05:30:00.000Z")).toBe(false);
  });

  it("same calendar date (different times of day) → false, not 'newer'", () => {
    expect(isNewerTaipeiTradeDate("2026-07-17T01:00:00.000Z", "2026-07-17T13:30:00.000Z")).toBe(false);
  });

  it("candidate missing/unparseable → always false", () => {
    expect(isNewerTaipeiTradeDate(null, "2026-07-16T08:00:00.000Z")).toBe(false);
    expect(isNewerTaipeiTradeDate(undefined, "2026-07-16T08:00:00.000Z")).toBe(false);
    expect(isNewerTaipeiTradeDate("not-a-date", "2026-07-16T08:00:00.000Z")).toBe(false);
  });

  it("current missing/unparseable but candidate valid → true (prefer the one we can date)", () => {
    expect(isNewerTaipeiTradeDate("2026-07-17T05:30:00.000Z", null)).toBe(true);
    expect(isNewerTaipeiTradeDate("2026-07-17T05:30:00.000Z", undefined)).toBe(true);
  });

  it("both missing → false", () => {
    expect(isNewerTaipeiTradeDate(null, null)).toBe(false);
  });

  it("Taipei calendar-date boundary: a UTC timestamp that rolls into the next Taipei day (+8h) is compared correctly", () => {
    // 2026-07-16T17:00:00Z = 2026-07-17 01:00 Taipei — a day past the other's
    // 2026-07-16T15:00:00Z = 2026-07-16 23:00 Taipei.
    expect(isNewerTaipeiTradeDate("2026-07-16T17:00:00.000Z", "2026-07-16T15:00:00.000Z")).toBe(true);
  });
});

// ── 2026-07-17 Round 2 (楊董升級 — 治本閘門): the single authoritative
// trade-date resolver that <MarketStateBanner>/readMarketIndex() both feed
// from, so the banner and the heatmap tiles/index panel cannot structurally
// disagree the way "banner 07/16 vs tiles 07/17" did.
describe("resolveAuthoritativeTradeDate", () => {
  it("picks the source with the genuinely newer trade date (the 07/16 banner vs 07/17 tiles repro)", () => {
    const result = resolveAuthoritativeTradeDate([
      { source: "twse_overview", tradeDate: "2026-07-16T08:00:00.000Z" },
      { source: "market_context_index", tradeDate: "2026-07-17T05:30:00.000Z" },
    ]);
    expect(result.tradeDate).toBe("2026-07-17T05:30:00.000Z");
    expect(result.chosenSource).toBe("market_context_index");
  });

  it("a source with no date is never chosen over one that has a valid date", () => {
    const result = resolveAuthoritativeTradeDate([
      { source: "a", tradeDate: null },
      { source: "b", tradeDate: "2026-07-17T05:30:00.000Z" },
    ]);
    expect(result.tradeDate).toBe("2026-07-17T05:30:00.000Z");
    expect(result.chosenSource).toBe("b");
  });

  it("all sources missing a date resolves to null — never guesses from the wall clock (P0-5 lineage)", () => {
    const result = resolveAuthoritativeTradeDate([
      { source: "a", tradeDate: null },
      { source: "b", tradeDate: undefined },
    ]);
    expect(result.tradeDate).toBeNull();
    expect(result.chosenSource).toBeNull();
  });

  it("order-independent: same result regardless of candidate array order", () => {
    const forward = resolveAuthoritativeTradeDate([
      { source: "a", tradeDate: "2026-07-16T08:00:00.000Z" },
      { source: "b", tradeDate: "2026-07-17T05:30:00.000Z" },
    ]);
    const reversed = resolveAuthoritativeTradeDate([
      { source: "b", tradeDate: "2026-07-17T05:30:00.000Z" },
      { source: "a", tradeDate: "2026-07-16T08:00:00.000Z" },
    ]);
    expect(forward.chosenSource).toBe("b");
    expect(reversed.chosenSource).toBe("b");
  });
});
