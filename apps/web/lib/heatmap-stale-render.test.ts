/**
 * F4 tests: heatmap stale render + MarketStateBanner wording
 *
 * Tests cover:
 * 1. live tiles → normal color logic (pct rendered, no stale class)
 * 2. eod tiles  → stale dot indicator (is-stale class, sourceState=twse_eod)
 * 3. no_data tiles → gray but visible (is-no-data class, displayPct=0)
 * 4. MarketStateBanner freshness → correct wording per state
 *
 * These test pure logic extracted from the components.
 * No React/DOM needed — pure TypeScript unit tests.
 */

import { describe, expect, it } from "vitest";
import { isKgiTradingHours } from "./kgi-trading-hours";

// ── Inline extracted logic from industry-heatmap.tsx ─────────────────────────
// (Same logic as the component — tested here without React dependency)

type SourceState = "live" | "twse_eod" | "cache" | "no_data" | undefined;

type MockTile = {
  symbol: string;
  name: string;
  pct: number | null;
  price: number | null;
  weight: number;
  source: string;
  sourceState?: SourceState;
  readiness?: "ready" | "degraded" | "blocked";
  freshnessStatus?: "fresh" | "stale" | "missing";
};

function deriveTileClasses(tile: MockTile): string[] {
  const isNoData = tile.sourceState === "no_data";
  const isStale = tile.sourceState === "twse_eod" || tile.sourceState === "cache";
  const classes: string[] = ["tac-heat-tile"];

  if (isNoData) {
    classes.push("flat", "is-no-data");
  } else {
    const pct = tile.pct ?? 0;
    classes.push(pct > 0 ? "up" : pct < 0 ? "down" : "flat");
  }

  if (isStale) classes.push("is-stale");
  return classes;
}

function isUsableTile(tile: MockTile): boolean {
  if (tile.symbol.trim().length === 0 || tile.name.trim().length === 0) return false;
  if (tile.readiness === "blocked") return false;
  if (tile.sourceState === "no_data") return true;
  // Standard: need a price move
  const hasMove = tile.pct !== null;
  if (!hasMove) return false;
  if (tile.freshnessStatus === "missing") return false;
  return true;
}

function getDisplayPct(tile: MockTile): number {
  return tile.sourceState === "no_data" ? 0 : (tile.pct ?? 0);
}

function staleDotLabel(sourceState: SourceState): string | null {
  if (sourceState === "twse_eod") return "收盤資料";
  if (sourceState === "cache") return "緩存資料";
  if (sourceState === "no_data") return "暫無資料";
  return null;
}

// ── Inline extracted freshness logic from MarketStateBanner.tsx ──────────────

type DataFreshness = "live" | "eod" | "cache";

function deriveFreshness(now: Date): DataFreshness {
  if (isKgiTradingHours(now)) return "live";
  return "eod";
}

function bannerText(freshness: DataFreshness, closeLabel: string): string | null {
  if (freshness === "live") return null;
  if (freshness === "eod") return `台股目前盤後或週末休市，顯示 ${closeLabel} 收盤資料`;
  if (freshness === "cache") return `資料同步暫時延遲，顯示緩存 ${closeLabel}`;
  return null;
}

// Helper: construct a Date in Asia/Taipei
function tst(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0));
}

// ── Test 1: live tiles render normal color (no stale class, pct rendered) ─────
describe("F4-T1: live tile classes", () => {
  it("live tile with positive pct gets 'up' class, no is-stale/is-no-data", () => {
    const tile: MockTile = {
      symbol: "2330", name: "台積電", pct: 1.5, price: 850, weight: 10,
      source: "realtime", sourceState: "live",
    };
    const classes = deriveTileClasses(tile);
    expect(classes).toContain("up");
    expect(classes).not.toContain("is-stale");
    expect(classes).not.toContain("is-no-data");
    expect(getDisplayPct(tile)).toBe(1.5);
  });

  it("live tile with negative pct gets 'down' class", () => {
    const tile: MockTile = {
      symbol: "2330", name: "台積電", pct: -2.1, price: 820, weight: 10,
      source: "realtime", sourceState: "live",
    };
    const classes = deriveTileClasses(tile);
    expect(classes).toContain("down");
    expect(classes).not.toContain("is-stale");
    expect(getDisplayPct(tile)).toBe(-2.1);
  });

  it("live tile is usable when pct is available", () => {
    const tile: MockTile = {
      symbol: "2330", name: "台積電", pct: 0.8, price: 850, weight: 10,
      source: "realtime", sourceState: "live",
    };
    expect(isUsableTile(tile)).toBe(true);
  });
});

// ── Test 2: eod tiles render with stale dot indicator ────────────────────────
describe("F4-T2: twse_eod tile stale dot", () => {
  it("twse_eod tile has is-stale class", () => {
    const tile: MockTile = {
      symbol: "2317", name: "鴻海", pct: 0.5, price: 120, weight: 8,
      source: "twse_eod", sourceState: "twse_eod",
    };
    const classes = deriveTileClasses(tile);
    expect(classes).toContain("is-stale");
    expect(classes).not.toContain("is-no-data");
  });

  it("twse_eod tile staleDotLabel returns '收盤資料'", () => {
    expect(staleDotLabel("twse_eod")).toBe("收盤資料");
  });

  it("cache tile staleDotLabel returns '緩存資料'", () => {
    expect(staleDotLabel("cache")).toBe("緩存資料");
  });

  it("twse_eod tile still renders pct normally (not overridden to 0)", () => {
    const tile: MockTile = {
      symbol: "2317", name: "鴻海", pct: 1.2, price: 120, weight: 8,
      source: "twse_eod", sourceState: "twse_eod",
    };
    expect(getDisplayPct(tile)).toBe(1.2);
  });

  it("twse_eod tile is usable (has pct)", () => {
    const tile: MockTile = {
      symbol: "2317", name: "鴻海", pct: 0.5, price: 120, weight: 8,
      source: "twse_eod", sourceState: "twse_eod",
    };
    expect(isUsableTile(tile)).toBe(true);
  });
});

// ── Test 3: no_data tiles render gray but visible ─────────────────────────────
describe("F4-T3: no_data tile gray but visible", () => {
  it("no_data tile has is-no-data class", () => {
    const tile: MockTile = {
      symbol: "2882", name: "國泰金", pct: null, price: null, weight: 5,
      source: "no_data", sourceState: "no_data",
    };
    const classes = deriveTileClasses(tile);
    expect(classes).toContain("is-no-data");
    expect(classes).toContain("flat");
    expect(classes).not.toContain("is-stale");
  });

  it("no_data tile displayPct is forced to 0", () => {
    const tile: MockTile = {
      symbol: "2882", name: "國泰金", pct: null, price: null, weight: 5,
      source: "no_data", sourceState: "no_data",
    };
    expect(getDisplayPct(tile)).toBe(0);
  });

  it("no_data tile isUsable returns true (visible even without price)", () => {
    const tile: MockTile = {
      symbol: "2882", name: "國泰金", pct: null, price: null, weight: 5,
      source: "no_data", sourceState: "no_data",
    };
    expect(isUsableTile(tile)).toBe(true);
  });

  it("no_data tile staleDotLabel returns '暫無資料'", () => {
    expect(staleDotLabel("no_data")).toBe("暫無資料");
  });

  it("tile with pct=null and no sourceState=no_data is NOT usable (filtered out)", () => {
    const tile: MockTile = {
      symbol: "2882", name: "國泰金", pct: null, price: null, weight: 5,
      source: "unknown",
      // no sourceState — old-style tile without backend 3-tier
    };
    expect(isUsableTile(tile)).toBe(false);
  });
});

// ── Test 4: MarketStateBanner shows correct wording per dataFreshness ─────────
describe("F4-T4: MarketStateBanner freshness wording", () => {
  it("live trading hours → freshness=live → no banner", () => {
    // Monday 2026-05-19 10:00 TST → inside window
    const now = tst(2026, 5, 19, 10, 0);
    const freshness = deriveFreshness(now);
    expect(freshness).toBe("live");
    expect(bannerText(freshness, "05/17")).toBeNull();
  });

  it("Weekend (Sunday) TST → freshness=eod → amber banner with 收盤 wording", () => {
    // Sunday 2026-05-17 10:00 TST (2026-05-17 is a Sunday)
    const now = tst(2026, 5, 17, 10, 0);
    // Sunday is a weekend — KGI trading hours = false
    expect(isKgiTradingHours(now)).toBe(false);
    const freshness = deriveFreshness(now);
    expect(freshness).toBe("eod");
    const text = bannerText(freshness, "05/15");
    expect(text).not.toBeNull();
    expect(text).toContain("休市");
    expect(text).toContain("05/15");
    expect(text).toContain("收盤資料");
  });

  it("weekday after-close (14:30 TST) → freshness=eod → amber banner", () => {
    // Monday 2026-05-19 14:30 TST → after 14:10
    const now = tst(2026, 5, 19, 14, 30);
    expect(isKgiTradingHours(now)).toBe(false);
    const freshness = deriveFreshness(now);
    expect(freshness).toBe("eod");
    const text = bannerText(freshness, "05/19");
    expect(text).toContain("收盤資料");
  });

  it("cache freshness → red banner with 延遲 wording", () => {
    const freshness: DataFreshness = "cache";
    const text = bannerText(freshness, "05/17");
    expect(text).not.toBeNull();
    expect(text).toContain("延遲");
    expect(text).toContain("05/17");
  });
});
