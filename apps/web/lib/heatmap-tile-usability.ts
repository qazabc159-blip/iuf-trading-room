/**
 * Canonical "is this heatmap tile safe to render" predicate.
 *
 * Single source of truth shared between:
 * - the banner-level product-coverage gate (`heatmap-product-coverage.ts`,
 *   drives the home page "核心代表股資料仍在暖機" fallback banner)
 * - the tile-render gate inside `IndustryHeatmap`
 *   (`app/components/industry-heatmap.tsx`, drives which tiles actually
 *   paint into `.heatmapgrid`)
 *
 * Before 2026-07-24 these were two independently-maintained checks
 * (`hasProductHeatmapCoverage()` only looked at symbol + move count;
 * `isUsableTile()` additionally required `readiness !== "blocked"` and
 * `freshnessStatus !== "missing"`). They could diverge: coverage would pass
 * (banner stays silent, implying "core view is fine") while every tile was
 * individually filtered out by freshness, leaving the grid empty with no
 * banner-level explanation. Flagged in PR #1361 review (Pete 🟡 #1/#2) and
 * tracked as the third instance of the same dual-criteria pattern in
 * `reports/design_redesign_20260722/DUAL_CRITERIA_AUDIT_20260723.md`.
 *
 * `deriveHeatmapMove` / `isUsableHeatmapTile` here are a verbatim relocation
 * of what used to be private helpers inside `industry-heatmap.tsx`
 * (`deriveMove` / `validMove` / `isUsableTile`) — logic is unchanged, only
 * the location moved so both call sites import the same function instead of
 * each keeping their own copy.
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
