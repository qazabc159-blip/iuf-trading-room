/**
 * kgi-heatmap-enricher.ts — 3-tier fallback enricher for KGI core heatmap
 *
 * Tier 1 (live):       KGI gateway tick   — market hours, EC2 running
 * Tier 2 (twse_eod):   TWSE STOCK_DAY_ALL — per-symbol EOD price + changePct
 * Tier 3 (cache):      In-process last-known-close — survives off-hours gap
 *
 * Hard lines:
 *   - Never drops tiles: always returns >= 0 tiles with sourceState set
 *   - Does NOT import broker.*
 *   - Does NOT modify tickerToIndustry / TWSE industry aggregate logic
 *   - Does NOT rewrite the KGI 40-symbol list
 *   - Cache update is additive (union, never removes known symbols)
 */

import type { KgiHeatmapTile } from "./kgi-subscription-manager.js";
import type { StockDayAllRow } from "./data-sources/twse-openapi-client.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TileSourceState = "live" | "twse_eod" | "cache" | "no_data";

export interface EnrichedHeatmapTile {
  symbol: string;
  name?: string;
  /** null only when sourceState="no_data" */
  price: number | null;
  change: number | null;
  changePct: number | null;
  tier: string;
  ts: string | null;
  /** Per-tile data provenance */
  sourceState: TileSourceState;
  /** Human-readable wording for UI tooltip */
  sourceLabel: string;
}

export interface EnrichedHeatmapResult {
  tiles: EnrichedHeatmapTile[];
  source: "kgi_tick" | "kgi_heatmap_enricher";
  staleAfterSec: number;
  tileCount: number;
  liveTileCount: number;
  twseEodTileCount: number;
  cacheTileCount: number;
  /** Top-level freshness bucket for frontend banner */
  dataFreshness: "live" | "eod" | "cache" | "none";
}

// ── In-process last-known-close cache (F2 — no DB migration) ──────────────────
// Persists as long as the process is alive.
// Updated whenever we observe: (a) live KGI tick, (b) TWSE EOD row.
// TTL: 48h — stale beyond 2 days is not meaningful for Taiwan equities.

interface LastCloseEntry {
  price: number;
  change: number | null;
  changePct: number | null;
  ts: string;
  dateTag: string; // "YYYY-MM-DD" — the date this price belongs to
}

const _lastCloseCache = new Map<string, LastCloseEntry>();
const CACHE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h

export function _resetLastCloseCache(): void {
  _lastCloseCache.clear();
}

/** Update last-known-close from a live KGI tick (Tier 1 write-through). */
export function updateLastCloseFromTick(
  symbol: string,
  price: number,
  change: number | null,
  changePct: number | null,
  ts: string
): void {
  const dateTag = ts.slice(0, 10); // "YYYY-MM-DD"
  _lastCloseCache.set(symbol, { price, change, changePct, ts, dateTag });
}

/** Update last-known-close entries from a TWSE STOCK_DAY_ALL batch. */
export function updateLastCloseFromTwse(rows: StockDayAllRow[]): void {
  for (const row of rows) {
    const code = row.Code?.trim();
    if (!code) continue;
    const close = parseFloat(row.ClosingPrice);
    const chg = parseFloat(row.Change?.trim() ?? "");
    if (!isFinite(close)) continue;

    const changeVal = isFinite(chg) ? chg : null;
    const prevClose = changeVal != null && (close - changeVal) !== 0 ? close - changeVal : null;
    const pct = prevClose != null ? Math.round((changeVal! / prevClose) * 10000) / 100 : null;

    // Derive ISO date from TWSE ROC date "114/05/18" → "2026-05-18"
    const dateTag = parseTwseDate(row.Date ?? "");
    const ts = dateTag ? `${dateTag}T13:30:00+08:00` : new Date().toISOString();

    // Only update if entry doesn't exist or is older
    const existing = _lastCloseCache.get(code);
    if (!existing || dateTag > existing.dateTag) {
      _lastCloseCache.set(code, { price: close, change: changeVal, changePct: pct, ts, dateTag });
    }
  }
}

/** Parse TWSE date formats: "114/05/18" or "1140518" → "2026-05-18" */
function parseTwseDate(raw: string): string {
  const s = raw.trim();
  // Slash format: "114/05/18"
  if (s.includes("/")) {
    const parts = s.split("/");
    if (parts.length === 3) {
      const rocYear = parseInt(parts[0]!, 10);
      return `${rocYear + 1911}-${parts[1]!.padStart(2, "0")}-${parts[2]!.padStart(2, "0")}`;
    }
  }
  // Compact format: "1140518"
  if (s.length === 7) {
    const rocYear = parseInt(s.slice(0, 3), 10);
    return `${rocYear + 1911}-${s.slice(3, 5)}-${s.slice(5, 7)}`;
  }
  return "";
}

/** Build a human-readable sourceLabel for a tile. */
function buildSourceLabel(sourceState: TileSourceState, ts: string | null): string {
  if (sourceState === "live") return "即時";
  if (!ts) return "無資料";

  // Try to build a readable date string
  const date = ts.slice(0, 10); // "YYYY-MM-DD"
  const [year, month, day] = date.split("-") as [string, string, string];
  const dow = ["日", "一", "二", "三", "四", "五", "六"][new Date(date).getDay()] ?? "";
  const dateLabel = `${month}/${day} (${dow}) 收盤`;

  if (sourceState === "twse_eod") return `${dateLabel} (TWSE)`;
  if (sourceState === "cache") return `${dateLabel} (緩存)`;
  return "無資料";
}

// ── Core enrichment function ───────────────────────────────────────────────────

/**
 * Enrich KGI heatmap tiles using 3-tier fallback.
 *
 * @param kgiTiles     Raw tiles from getKgiCoreHeatmap() — may have null price
 * @param twseRows     TWSE STOCK_DAY_ALL rows (may be empty if TWSE unreachable)
 * @returns            Fully enriched tiles with sourceState for every tile
 */
export function enrichHeatmapTiles(
  kgiTiles: KgiHeatmapTile[],
  twseRows: StockDayAllRow[]
): EnrichedHeatmapResult {
  // Update last-close cache from TWSE data (write-through for future requests)
  if (twseRows.length > 0) {
    updateLastCloseFromTwse(twseRows);
  }

  // Build per-symbol TWSE lookup map
  const twseMap = new Map<string, { price: number; change: number | null; changePct: number | null; ts: string }>();
  for (const row of twseRows) {
    const code = row.Code?.trim();
    if (!code) continue;
    const close = parseFloat(row.ClosingPrice);
    if (!isFinite(close)) continue;
    const chg = parseFloat(row.Change?.trim() ?? "");
    const changeVal = isFinite(chg) ? chg : null;
    const prevClose = changeVal != null && (close - changeVal) !== 0 ? close - changeVal : null;
    const pct = prevClose != null ? Math.round((changeVal! / prevClose) * 10000) / 100 : null;
    const dateTag = parseTwseDate(row.Date ?? "");
    const ts = dateTag ? `${dateTag}T13:30:00+08:00` : new Date().toISOString();
    twseMap.set(code, { price: close, change: changeVal, changePct: pct, ts });
  }

  let liveTileCount = 0;
  let twseEodTileCount = 0;
  let cacheTileCount = 0;

  const tiles: EnrichedHeatmapTile[] = kgiTiles.map((kgiTile) => {
    const { symbol, tier } = kgiTile;

    // ── Tier 1: KGI live tick ───────────────────────────────────────────────
    if (kgiTile.price !== null && kgiTile.changePct !== null) {
      // Write-through to last-close cache
      updateLastCloseFromTick(
        symbol,
        kgiTile.price,
        kgiTile.change,
        kgiTile.changePct,
        kgiTile.ts ?? new Date().toISOString()
      );
      liveTileCount++;
      return {
        symbol,
        name: kgiTile.name,
        price: kgiTile.price,
        change: kgiTile.change,
        changePct: kgiTile.changePct,
        tier,
        ts: kgiTile.ts,
        sourceState: "live" as TileSourceState,
        sourceLabel: buildSourceLabel("live", kgiTile.ts),
      };
    }

    // ── Tier 2: TWSE EOD ────────────────────────────────────────────────────
    const twse = twseMap.get(symbol);
    if (twse) {
      twseEodTileCount++;
      return {
        symbol,
        name: kgiTile.name,
        price: twse.price,
        change: twse.change,
        changePct: twse.changePct,
        tier,
        ts: twse.ts,
        sourceState: "twse_eod" as TileSourceState,
        sourceLabel: buildSourceLabel("twse_eod", twse.ts),
      };
    }

    // ── Tier 3: Last-known-close cache ──────────────────────────────────────
    const cached = _lastCloseCache.get(symbol);
    if (cached) {
      // Check cache age
      const cacheTs = Date.parse(cached.ts);
      if (!isNaN(cacheTs) && Date.now() - cacheTs <= CACHE_MAX_AGE_MS) {
        cacheTileCount++;
        return {
          symbol,
          name: kgiTile.name,
          price: cached.price,
          change: cached.change,
          changePct: cached.changePct,
          tier,
          ts: cached.ts,
          sourceState: "cache" as TileSourceState,
          sourceLabel: buildSourceLabel("cache", cached.ts),
        };
      }
    }

    // ── No data — still return tile shape (name + tier preserved) ──────────
    return {
      symbol,
      name: kgiTile.name,
      price: null,
      change: null,
      changePct: null,
      tier,
      ts: null,
      sourceState: "no_data" as TileSourceState,
      sourceLabel: buildSourceLabel("no_data", null),
    };
  });

  const dataFreshness: EnrichedHeatmapResult["dataFreshness"] =
    liveTileCount > 0 ? "live"
    : twseEodTileCount > 0 ? "eod"
    : cacheTileCount > 0 ? "cache"
    : "none";

  return {
    tiles,
    source: liveTileCount > 0 ? "kgi_tick" : "kgi_heatmap_enricher",
    staleAfterSec: liveTileCount > 0 ? 5 : twseEodTileCount > 0 ? 300 : 3600,
    tileCount: tiles.length,
    liveTileCount,
    twseEodTileCount,
    cacheTileCount,
    dataFreshness,
  };
}
