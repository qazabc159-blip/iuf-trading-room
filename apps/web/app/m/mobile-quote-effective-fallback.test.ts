import { describe, expect, it } from "vitest";

import { deriveEffectiveFallbackCellState } from "./mobile-quote-effective-fallback";
import type { EffectiveMarketQuote } from "@/lib/api";

function makeItem(overrides: Partial<EffectiveMarketQuote>): EffectiveMarketQuote {
  return {
    symbol: "2330",
    market: "TW",
    selectedSource: "twse_mis",
    selectedQuote: {
      symbol: "2330",
      market: "TW",
      source: "twse_mis",
      last: 1000,
      bid: null,
      ask: null,
      open: null,
      high: null,
      low: null,
      prevClose: 990,
      volume: 12345,
      changePct: 1.01,
      timestamp: "2026-07-17T05:30:00.000Z",
      ageMs: 0,
      isStale: false,
    },
    freshnessStatus: "fresh",
    closedSnapshotTradeDate: null,
    fallbackReason: "none",
    staleReason: "none",
    readiness: "ready",
    strategyUsable: true,
    paperUsable: true,
    liveUsable: true,
    synthetic: false,
    providerConnected: true,
    staleAfterMs: null,
    sourcePriority: 1,
    reasons: [],
    ...overrides,
  } as EffectiveMarketQuote;
}

describe("deriveEffectiveFallbackCellState", () => {
  it("returns empty when item is undefined (no fallback data at all)", () => {
    expect(deriveEffectiveFallbackCellState(undefined)).toEqual({ status: "empty" });
  });

  it("returns empty when selectedQuote.last is null (honest no-data, never fabricated)", () => {
    const item = makeItem({ selectedQuote: null });
    expect(deriveEffectiveFallbackCellState(item)).toEqual({ status: "empty" });
  });

  it("shows closed_snapshot as 'MM/DD 收盤' with real price (weekend/off-hours)", () => {
    const item = makeItem({
      freshnessStatus: "closed_snapshot",
      closedSnapshotTradeDate: "2026-07-17",
      selectedQuote: {
        ...makeItem({}).selectedQuote!,
        last: 1050,
        prevClose: 1030,
        changePct: 1.94,
      },
    });
    const state = deriveEffectiveFallbackCellState(item);
    expect(state.status).toBe("closed");
    if (state.status === "closed") {
      expect(state.dateLabel).toBe("07/17 收盤");
      expect(state.lastPrice).toBe(1050);
      expect(state.priceChg).toBe(20);
      expect(state.pctChg).toBe(1.94);
    }
  });

  it("falls back to '收盤快照' when closedSnapshotTradeDate is missing", () => {
    const item = makeItem({ freshnessStatus: "closed_snapshot", closedSnapshotTradeDate: null });
    const state = deriveEffectiveFallbackCellState(item);
    expect(state.status).toBe("closed");
    if (state.status === "closed") expect(state.dateLabel).toBe("收盤快照");
  });

  it("labels official_close+stale as an intraday interruption, never as live (Pete #1310 regression guard)", () => {
    const item = makeItem({
      selectedSource: "official_close",
      freshnessStatus: "stale",
      closedSnapshotTradeDate: "2026-07-16",
    });
    const state = deriveEffectiveFallbackCellState(item);
    expect(state.status).toBe("closed");
    if (state.status === "closed") {
      expect(state.dateLabel).toBe("07/16 收盤（即時中斷）");
    }
  });

  it("treats a genuinely fresh quote as live", () => {
    const item = makeItem({ freshnessStatus: "fresh", selectedSource: "twse_mis" });
    const state = deriveEffectiveFallbackCellState(item);
    expect(state.status).toBe("live");
    if (state.status === "live") {
      expect(state.lastPrice).toBe(1000);
      expect(state.volume).toBe(12345);
    }
  });

  it("labels a stale twse_mis quote as '證交所（略舊）', never as live (Pete #1313 review 🔴1 regression guard)", () => {
    // includeStale:true makes resolveMarketQuotes() treat any cached quote as
    // eligible regardless of age — a genuinely reachable path once KGI ticks
    // already failed and this fallback got called. Must never fall through
    // to the "live" branch just because it isn't closed_snapshot/official_close.
    const item = makeItem({ selectedSource: "twse_mis", freshnessStatus: "stale" });
    const state = deriveEffectiveFallbackCellState(item);
    expect(state.status).toBe("stale");
    if (state.status === "stale") {
      expect(state.label).toBe("證交所（略舊）");
      expect(state.lastPrice).toBe(1000);
    }
  });

  it("labels a stale kgi quote as '凱基（略舊）'", () => {
    const item = makeItem({ selectedSource: "kgi", freshnessStatus: "stale" });
    const state = deriveEffectiveFallbackCellState(item);
    expect(state.status).toBe("stale");
    if (state.status === "stale") expect(state.label).toBe("凱基（略舊）");
  });

  it("labels a stale manual quote as '手動資料（略舊）'", () => {
    const item = makeItem({ selectedSource: "manual", freshnessStatus: "stale" });
    const state = deriveEffectiveFallbackCellState(item);
    expect(state.status).toBe("stale");
    if (state.status === "stale") expect(state.label).toBe("手動資料（略舊）");
  });

  it("labels a stale tradingview quote as '行情（略舊）' (unmapped source falls back to the generic label)", () => {
    const item = makeItem({ selectedSource: "tradingview", freshnessStatus: "stale" });
    const state = deriveEffectiveFallbackCellState(item);
    expect(state.status).toBe("stale");
    if (state.status === "stale") expect(state.label).toBe("行情（略舊）");
  });

  it("also degrades a 'missing' freshnessStatus with a cached last price, never live", () => {
    const item = makeItem({ selectedSource: "manual", freshnessStatus: "missing" });
    const state = deriveEffectiveFallbackCellState(item);
    expect(state.status).toBe("stale");
  });
});
