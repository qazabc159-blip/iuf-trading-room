/**
 * heatmap-tile-usability-copy.ts
 * ────────────────────────────────
 * SOURCE OF TRUTH: apps/web/lib/heatmap-tile-usability.ts
 *
 * `@iuf-trading-room/qa-playwright` has no dependency on `@iuf-trading-room/web`
 * in package.json, and this package's tsconfig.json ("rootDir": ".",
 * "include": ["tests/**\/*.ts"]) does not admit a cross-package relative TS
 * import of an apps/web source file — checked before writing this copy
 * (2026-07-24, QA misc batch ticket #1, Pete-13 review 🟡#1). No qa-playwright
 * spec has ever done a real cross-package import of apps/web internals
 * either (only comments referencing file paths as prose) — this would be the
 * first, with no existing supported pattern for it.
 *
 * Everything from the `export type HeatmapUsabilityTile` line to the end of
 * this file is meant to be BYTE-IDENTICAL to the same span of
 * apps/web/lib/heatmap-tile-usability.ts. `heatmap-usability-copy-drift.spec.ts`
 * in this same directory enforces that at test time by reading both files'
 * raw source text and diffing them — if apps/web/lib/heatmap-tile-usability.ts
 * changes and this copy isn't updated to match, that spec goes red instead of
 * silently drifting (the exact failure mode Pete-13 flagged: this file used
 * to be a hand-maintained, already-stale 2-flag subset of the real predicate
 * inside helpers.ts's checkHeatmapUpstreamCoverage()).
 *
 * When apps/web/lib/heatmap-tile-usability.ts changes, copy the same span
 * here verbatim (everything from `export type HeatmapUsabilityTile` down).
 */

export type HeatmapUsabilityTile = {
  symbol: string;
  name?: string | null;
  pct?: number | null;
  change?: number | null;
  close?: number | null;
  prevClose?: number | null;
  price?: number | null;
  open?: number | null;
  sourceState?: string | null;
  readiness?: "ready" | "degraded" | "blocked";
  freshnessStatus?: "fresh" | "stale" | "missing" | "closed_snapshot";
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMove(value: number) {
  return Math.round(value * 100) / 100;
}

export function deriveHeatmapMove(tile: HeatmapUsabilityTile) {
  const close = finiteNumber(tile.close ?? tile.price);
  const prevClose = finiteNumber(tile.prevClose);
  if (close !== null && prevClose !== null && prevClose > 0) {
    const change = roundMove(close - prevClose);
    return {
      pct: roundMove((change / prevClose) * 100),
      change,
    };
  }

  const change = finiteNumber(tile.change);
  if (close !== null && change !== null) {
    const derivedPrevClose = close - change;
    if (derivedPrevClose > 0) {
      return {
        pct: roundMove((change / derivedPrevClose) * 100),
        change: roundMove(change),
      };
    }
  }

  const pct = finiteNumber(tile.pct);
  if (pct !== null) {
    const derivedChange = close !== null && pct > -99.99 ? roundMove(close - close / (1 + pct / 100)) : null;
    return {
      pct: roundMove(pct),
      change: derivedChange,
    };
  }

  const open = finiteNumber(tile.open);
  if (close !== null && open !== null && open > 0) {
    const intradayChange = roundMove(close - open);
    return {
      pct: roundMove((intradayChange / open) * 100),
      change: intradayChange,
    };
  }

  return {
    pct: null,
    change: null,
  };
}

export function isUsableHeatmapTile(tile: HeatmapUsabilityTile) {
  if (!tile.symbol || tile.symbol.trim().length === 0) return false;
  if (tile.name != null && tile.name.trim().length === 0) return false;
  if (tile.readiness === "blocked") return false;
  // Missing representative quotes are reported in the footer, not rendered as gray empty tiles.
  if (tile.sourceState === "no_data") return false;
  // Standard path: must have a valid price move
  if (deriveHeatmapMove(tile).pct === null) return false;
  if (tile.freshnessStatus === "missing") return false;
  return true;
}
