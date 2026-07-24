/**
 * F4 tests: heatmap stale render + MarketStateBanner wording
 *
 * Tests cover:
 * 1. live tiles → normal color logic (pct rendered, no stale class)
 * 2. eod tiles  → stale dot indicator (is-stale class, sourceState=twse_eod)
 * 3. no_data tiles → deriveTileClasses/getDisplayPct/staleDotLabel's gray
 *    "visible but no price" styling (is-no-data class, displayPct=0) — this
 *    describes the pre-2026-07-14 design. That decision was superseded
 *    (楊董: 缺角要遞補真公司, not a gray placeholder) — isUsableTile below now
 *    imports the REAL render-inclusion gate, which filters no_data tiles out
 *    before they ever reach these styling helpers. The styling helpers stay
 *    as local pure-function tests of "what classes would this produce", the
 *    inclusion GATE itself (isUsableTile/isUsableHeatmapTile) is the one
 *    piece kept byte-identical to production (Pete-13 review 🟡#2).
 * 4. MarketStateBanner freshness → correct wording per state
 *
 * These test pure logic extracted from the components.
 * No React/DOM needed — pure TypeScript unit tests.
 */

import { describe, expect, it } from "vitest";
import { isKgiTradingHours } from "./kgi-trading-hours";
import { isUsableHeatmapTile } from "./heatmap-tile-usability";
import { buildBannerText, deriveFreshness, formatTradeDateWithWeekday } from "./market-state-banner";

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

// isUsableTile used to be a local inline copy of the real render-inclusion
// gate. Pete-13 review 🟡#2 (2026-07-24, QA misc batch ticket #2) flagged
// that its no_data branch had been INVERTED relative to the real predicate
// (`return true` here vs the real `isUsableHeatmapTile()`'s `return false`
// for sourceState==="no_data") — a leftover from the pre-2026-07-14 design
// where no_data tiles rendered as a gray placeholder tile ("gray but
// visible", see the Test 3 describe block below). That design was replaced
// (楊董 2026-07-14 定案: 缺角要遞補真公司, not a gray block) — no_data tiles
// are filtered out of the candidate pool entirely today, never reaching
// HeatmapTile. Importing the real function directly (rather than fixing the
// inline mock's boolean by hand) removes the drift risk permanently instead
// of leaving a second copy that could invert again unnoticed.
function isUsableTile(tile: MockTile): boolean {
  return isUsableHeatmapTile(tile);
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

// ── MarketStateBanner logic (P0-5 fix): imported directly from
// lib/market-state-banner.ts, NOT re-implemented here. The original P0-5 bug
// (banner showed "07/10 (五) 收盤" on a typhoon holiday with no 07/10 close)
// shipped in part because this test file used to keep its own stale inline
// copy of the banner's wall-clock date logic — the copy tested fine, but
// diverged from the real (buggy) component. Importing the real functions
// makes that class of drift impossible.

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

  it("no_data tile isUsable returns false — filtered out of the grid entirely, not rendered as a gray placeholder (real predicate, Pete-13 fix)", () => {
    const tile: MockTile = {
      symbol: "2882", name: "國泰金", pct: null, price: null, weight: 5,
      source: "no_data", sourceState: "no_data",
    };
    expect(isUsableTile(tile)).toBe(false);
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
    expect(buildBannerText(freshness, "05/17 (日)")).toBeNull();
  });

  it("Weekend (Sunday) TST → freshness=eod → amber banner with 收盤 wording", () => {
    // Sunday 2026-05-17 10:00 TST (2026-05-17 is a Sunday)
    const now = tst(2026, 5, 17, 10, 0);
    // Sunday is a weekend — KGI trading hours = false
    expect(isKgiTradingHours(now)).toBe(false);
    const freshness = deriveFreshness(now);
    expect(freshness).toBe("eod");
    const text = buildBannerText(freshness, "05/15 (五)");
    expect(text).not.toBeNull();
    expect(text).toContain("休市");
    expect(text).toContain("05/15");
    expect(text).toContain("收盤資料");
    // exactly one "收盤" occurrence — no more duplicated "收盤 收盤資料" (P0-5)
    expect(text!.match(/收盤/g)?.length).toBe(1);
  });

  it("weekday after-close (14:30 TST) → freshness=eod → amber banner", () => {
    // Monday 2026-05-19 14:30 TST → after 14:10
    const now = tst(2026, 5, 19, 14, 30);
    expect(isKgiTradingHours(now)).toBe(false);
    const freshness = deriveFreshness(now);
    expect(freshness).toBe("eod");
    const text = buildBannerText(freshness, "05/19 (二)");
    expect(text).toContain("收盤資料");
  });

  it("cache freshness → red banner with 延遲 wording", () => {
    const text = buildBannerText("cache", "05/17 (日)");
    expect(text).not.toBeNull();
    expect(text).toContain("延遲");
    expect(text).toContain("05/17");
  });

  it("no closeLabel available → shows '收盤資料' with no date, never a guessed date", () => {
    // This is the "沒有就不顯日期只顯「收盤」" fallback (P0-5 fix requirement).
    const text = buildBannerText("eod", null);
    expect(text).toBe("台股目前盤後或週末休市，顯示 收盤資料");
  });
});

// ── Test 5 (P0-5 fix): the displayed date must come from the DATA's own
// trade date, never a wall-clock/calendar guess ─────────────────────────────
describe("F4-T5: P0-5 — trade date is derived from data, not the wall clock", () => {
  it("holiday scenario: real last close is 2026-07-09, banner must show 07/09 (四) — not 'today' 07/10", () => {
    // 2026-07-10 (Fri) is a typhoon holiday with NO trading; the API's real
    // last-close date (asOf) is 2026-07-09 (Thu). The old wall-clock logic
    // would have shown "07/10 (五)" (today's weekday) purely because 07/10
    // is a weekday and it's after 14:10 — wrong, because there was no close
    // that day. The fix must label the date using the DATA's own date.
    const label = formatTradeDateWithWeekday("2026-07-09");
    expect(label).toBe("07/09 (四)");
    expect(label).not.toContain("07/10");

    const text = buildBannerText("eod", label);
    expect(text).toBe("台股目前盤後或週末休市，顯示 07/09 (四) 收盤資料");
    expect(text?.match(/收盤/g)?.length).toBe(1);
  });

  it("normal weekday: last close 2026-05-19 (Tue) labeled correctly from its own date", () => {
    const label = formatTradeDateWithWeekday("2026-05-19");
    expect(label).toBe("05/19 (二)");
  });

  it("accepts a full ISO timestamp (not just a bare date) and still reads the date part", () => {
    const label = formatTradeDateWithWeekday("2026-07-09T05:30:00.000Z");
    expect(label).toBe("07/09 (四)");
  });

  it("missing/invalid asOf → returns null (caller must show 收盤資料 with no date, never guess)", () => {
    expect(formatTradeDateWithWeekday(null)).toBeNull();
    expect(formatTradeDateWithWeekday(undefined)).toBeNull();
    expect(formatTradeDateWithWeekday("")).toBeNull();
    expect(formatTradeDateWithWeekday("not-a-date")).toBeNull();
  });

  it("2026-07-18 banner-date-unify regression: a UTC 'Z' timestamp that rolls into the next Taipei day gets BOTH the date and weekday right (not just the date)", () => {
    // 2026-07-17 is a Friday. The real prod marketContext.index.timestamp
    // shape for that trading day's close is "2026-07-16T16:00:00.000Z" (UTC
    // calendar date 07/16, Taipei calendar date 07/17). Before the fix, the
    // date part (mmdd) and the weekday part were derived from two DIFFERENT
    // naive-slice implementations that could disagree with each other, not
    // just disagree with other pages.
    const label = formatTradeDateWithWeekday("2026-07-16T16:00:00.000Z");
    expect(label).toBe("07/17 (五)");
  });
});
