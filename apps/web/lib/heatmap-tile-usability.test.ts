import { describe, expect, it } from "vitest";
import { deriveHeatmapMove, isUsableHeatmapTile } from "./heatmap-tile-usability";

// These pin the exact behavior that used to live as private helpers inside
// industry-heatmap.tsx (deriveMove/validMove/isUsableTile) before the
// 2026-07-24 extraction (PR #1361 review fix — banner/tile dual-criteria
// unification). The function bodies were moved verbatim, so every case here
// should behave identically to before the move — this is the "normal-path
// zero diff" pin for the tile-render gate.

describe("deriveHeatmapMove", () => {
  it("derives pct/change from close+prevClose when both present", () => {
    const move = deriveHeatmapMove({ symbol: "2330", close: 1000, prevClose: 980 });
    expect(move.pct).toBeCloseTo(2.04, 1);
    expect(move.change).toBe(20);
  });

  it("derives pct from close+change when prevClose absent", () => {
    const move = deriveHeatmapMove({ symbol: "2330", close: 1000, change: 20 });
    expect(move.change).toBe(20);
    expect(move.pct).toBeCloseTo(2.04, 1);
  });

  it("falls back to a bare pct field when neither close/prevClose nor close/change resolve", () => {
    const move = deriveHeatmapMove({ symbol: "2330", pct: 1.5 });
    expect(move.pct).toBe(1.5);
  });

  it("derives intraday pct from close+open as last resort", () => {
    const move = deriveHeatmapMove({ symbol: "2330", close: 110, open: 100 });
    expect(move.pct).toBeCloseTo(10, 1);
    expect(move.change).toBe(10);
  });

  it("returns null pct when nothing resolvable", () => {
    const move = deriveHeatmapMove({ symbol: "2330" });
    expect(move.pct).toBeNull();
    expect(move.change).toBeNull();
  });

  it("uses price as a close fallback", () => {
    const move = deriveHeatmapMove({ symbol: "2330", price: 500, prevClose: 490 });
    expect(move.pct).not.toBeNull();
  });
});

describe("isUsableHeatmapTile", () => {
  it("usable: live tile with a verified move, no readiness/freshness flags set", () => {
    expect(isUsableHeatmapTile({ symbol: "2330", name: "台積電", pct: 1.2 })).toBe(true);
  });

  it("usable: freshnessStatus=fresh with a verified move", () => {
    expect(isUsableHeatmapTile({ symbol: "2330", name: "台積電", pct: 1.2, freshnessStatus: "fresh" })).toBe(true);
  });

  it("unusable: empty symbol", () => {
    expect(isUsableHeatmapTile({ symbol: "  ", name: "台積電", pct: 1.2 })).toBe(false);
  });

  it("unusable: empty name (when name field is present)", () => {
    expect(isUsableHeatmapTile({ symbol: "2330", name: "", pct: 1.2 })).toBe(false);
  });

  it("usable: name omitted entirely (banner-side callers don't always carry name)", () => {
    expect(isUsableHeatmapTile({ symbol: "2330", pct: 1.2 })).toBe(true);
  });

  it("unusable: readiness=blocked even with a verified move", () => {
    expect(isUsableHeatmapTile({ symbol: "2330", name: "台積電", pct: 1.2, readiness: "blocked" })).toBe(false);
  });

  it("unusable: sourceState=no_data (backfilled/rendered elsewhere, not as a gray tile)", () => {
    expect(isUsableHeatmapTile({ symbol: "2330", name: "台積電", pct: null, sourceState: "no_data" })).toBe(false);
  });

  it("unusable: no verified move at all", () => {
    expect(isUsableHeatmapTile({ symbol: "2330", name: "台積電", pct: null })).toBe(false);
  });

  it("unusable: freshnessStatus=missing even with a verified move — the #1361 divergence case", () => {
    expect(isUsableHeatmapTile({ symbol: "2330", name: "台積電", pct: 1.2, freshnessStatus: "missing" })).toBe(false);
  });

  it("usable: freshnessStatus=stale/closed_snapshot with a verified move (stale ≠ missing)", () => {
    expect(isUsableHeatmapTile({ symbol: "2330", name: "台積電", pct: 1.2, freshnessStatus: "stale" })).toBe(true);
    expect(isUsableHeatmapTile({ symbol: "2330", name: "台積電", pct: 1.2, freshnessStatus: "closed_snapshot" })).toBe(true);
  });
});
