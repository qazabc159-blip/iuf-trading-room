/**
 * kgi-heatmap-enricher.ts — 3-tier fallback enricher for KGI core heatmap
 *
 * Tier 1 (live):       KGI gateway tick   — market hours, EC2 running
 * Tier 2 (twse_eod):   TWSE STOCK_DAY_ALL — per-symbol EOD price + changePct
 * Tier 2.5 (twse_eod): quote_last_close DB table — 盤後 fallback, survives
 *                      deploy restarts (unlike Tier 3's in-process cache).
 *                      Only populated by the caller when after-hours (see
 *                      server.ts's after-hours gate using lib/trading-calendar).
 * Tier 3 (cache):      In-process last-known-close — survives off-hours gap
 *                      within a single process lifetime
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
import { parseRocEodDateIso } from "./lib/roc-date.js";
import type { LastCloseResult } from "./quote-last-close-store.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TileSourceState = "live" | "twse_mis_intraday" | "twse_eod" | "cache" | "no_data";

// ── MIS intraday tile cache entry (written by server.ts cron, read by enricher) ───
export interface MisTileEntry {
  /** Last traded price (盤中成交價) */
  last: number;
  changePct: number | null;
  /** ISO 8601 timestamp of when MIS was fetched */
  ts: string;
  /** TWSE trade date "YYYYMMDD" — used to detect if data is from today */
  tradeDateYmd: string;
}

export interface EnrichedHeatmapTile {
  symbol: string;
  name?: string;
  /** Industry/sector label (companies.chain_position), null if unavailable
   * (DB unreachable, or symbol not found in companies table). 2026-07-14:
   * previously always undefined — this endpoint carried no sector at all,
   * so the frontend could not group the 40 heatmap tiles by industry. */
  sector: string | null;
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
  misIntradayTileCount: number;
  twseEodTileCount: number;
  cacheTileCount: number;
  /** Top-level freshness bucket for frontend banner */
  dataFreshness: "live" | "intraday" | "eod" | "cache" | "none";
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

/**
 * Taiwan equities have a regulatory daily price-limit band of ±10% (with a
 * small tolerance for rounding). HEATMAP_CORE_SYMBOLS is a fixed universe of
 * 40 established large-caps (2330, 2317, ...) — none are newly-listed or
 * disposition-category stocks, which are the only categories with a
 * different/no limit — so any |changePct| beyond this bound for one of these
 * 40 symbols is definitionally a corrupted upstream tick, never a real price
 * move. 2026-07-14: a batch read at 16:41 (well after the 14:35 MIS cron
 * cutoff) served -90.91%/-98.21% for some tiles — impossible under the daily
 * limit, so the source data itself must have been garbage (not merely
 * stale). This guard is the single choke point applied at every write AND
 * every read of a changePct value in this module, so a bad value can never
 * enter the cache in the first place, and any that pre-dates this fix
 * (already sitting in a live process's cache) is also filtered on read.
 */
export function isPlausibleChangePct(pct: number | null): boolean {
  if (pct === null) return true;
  return Number.isFinite(pct) && Math.abs(pct) <= 10.5;
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
  const safePct = isPlausibleChangePct(changePct) ? changePct : null;
  _lastCloseCache.set(symbol, { price, change, changePct: safePct, ts, dateTag });
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
    const pctRaw = prevClose != null ? Math.round((changeVal! / prevClose) * 10000) / 100 : null;
    const pct = isPlausibleChangePct(pctRaw) ? pctRaw : null;

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

/**
 * Parse TWSE date formats: "114/05/18" or "1140518" → "2026-05-18". Delegates
 * to the shared lib/roc-date.ts parser (2026-07-10 sweep, dedup of a
 * functionally-equivalent inline copy — reports/ledger_stall_20260709/).
 * Preserves the pre-existing "" (not null) return convention on unparseable
 * input, since callers compare `dateTag` as a plain string.
 *
 * NOTE: this is unrelated to the differently-scoped `parseTwseDate` in
 * jobs/twse-announcement-ingest.ts (that one converts an already-Gregorian
 * "YYYY/MM/DD" string — no ROC calendar math — a same-name/different-module
 * coincidence, not a duplicate of this ROC parser).
 */
function parseTwseDate(raw: string): string {
  return parseRocEodDateIso(raw) ?? "";
}

/** Build a human-readable sourceLabel for a tile. */
function buildSourceLabel(sourceState: TileSourceState, ts: string | null): string {
  if (sourceState === "live") return "即時";
  if (sourceState === "twse_mis_intraday") return "盤中即時 (MIS)";
  if (!ts) return "無資料";

  // Try to build a readable date string
  const date = ts.slice(0, 10); // "YYYY-MM-DD"
  const [, month, day] = date.split("-") as [string, string, string];
  const dow = ["日", "一", "二", "三", "四", "五", "六"][new Date(date).getDay()] ?? "";
  const dateLabel = `${month}/${day} (${dow}) 收盤`;

  if (sourceState === "twse_eod") return `${dateLabel} (TWSE)`;
  if (sourceState === "cache") return `${dateLabel} (緩存)`;
  return "無資料";
}

// ── Core enrichment function ───────────────────────────────────────────────────

/**
 * A same-calendar-day MIS entry can still be hours stale once the intraday
 * cron stops feeding for the day (cron window 08:55-14:35 TST) — a read at
 * e.g. 16:41 would otherwise keep echoing whatever tick happened to be last
 * captured near the 14:35 cutoff. Bound on the entry's OWN age (not a
 * wall-clock window check) so this stays deterministic in tests regardless
 * of what time of day they run: once an entry is older than this, Tier 1.5
 * is treated as unavailable and enrichment falls through to Tier 2 (TWSE
 * EOD, the authoritative close) — "盤後應 fallback 收盤價", not continue
 * serving a stale intraday snapshot.
 */
const MIS_ENTRY_MAX_AGE_MS = 30 * 60 * 1000; // 30 min — MIS cron refreshes every 15-45s while running

/**
 * Enrich KGI heatmap tiles using 4-tier fallback.
 *
 * Tier 1  (live):              KGI gateway tick — market hours, EC2 running
 * Tier 1.5 (twse_mis_intraday): TWSE MIS盤中 — 5-20s delayed, injected by MIS cron (08:55-14:35)
 * Tier 2  (twse_eod):          TWSE STOCK_DAY_ALL — per-symbol EOD price + changePct
 * Tier 3  (cache):             In-process last-known-close — survives off-hours gap
 *
 * @param kgiTiles     Raw tiles from getKgiCoreHeatmap() — may have null price
 * @param twseRows     TWSE STOCK_DAY_ALL rows (may be empty if TWSE unreachable)
 * @param misCache     TWSE MIS intraday cache from _runTwseMisQuoteCron (may be undefined)
 * @param sectorMap    ticker -> industry/sector label (companies.chain_position),
 *                     built by the route handler (may be undefined if DB unavailable)
 * @param dbCloseMap   quote_last_close DB rows (Tier 2.5) — only passed in by the
 *                     route handler when after-hours (see server.ts); undefined
 *                     during market hours or when DB unavailable
 * @returns            Fully enriched tiles with sourceState for every tile
 */
export function enrichHeatmapTiles(
  kgiTiles: KgiHeatmapTile[],
  twseRows: StockDayAllRow[],
  misCache?: Map<string, MisTileEntry>,
  sectorMap?: Map<string, string | null>,
  dbCloseMap?: Map<string, LastCloseResult>
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
    const pctRaw = prevClose != null ? Math.round((changeVal! / prevClose) * 10000) / 100 : null;
    const pct = isPlausibleChangePct(pctRaw) ? pctRaw : null;
    const dateTag = parseTwseDate(row.Date ?? "");
    const ts = dateTag ? `${dateTag}T13:30:00+08:00` : new Date().toISOString();
    twseMap.set(code, { price: close, change: changeVal, changePct: pct, ts });
  }

  // Derive today's date string "YYYYMMDD" in Taipei timezone for MIS freshness check
  const todayYmd = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  let liveTileCount = 0;
  let misIntradayTileCount = 0;
  let twseEodTileCount = 0;
  let cacheTileCount = 0;

  const tiles: EnrichedHeatmapTile[] = kgiTiles.map((kgiTile) => {
    const { symbol, tier } = kgiTile;
    const sector = sectorMap?.get(symbol) ?? null;

    // ── Tier 1: KGI live tick ───────────────────────────────────────────────
    if (kgiTile.price !== null && kgiTile.changePct !== null && isPlausibleChangePct(kgiTile.changePct)) {
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
        sector,
        price: kgiTile.price,
        change: kgiTile.change,
        changePct: kgiTile.changePct,
        tier,
        ts: kgiTile.ts,
        sourceState: "live" as TileSourceState,
        sourceLabel: buildSourceLabel("live", kgiTile.ts),
      };
    }

    // ── Tier 1.5: TWSE MIS intraday (盤中即時, 5-20s delay) ────────────────
    // Only used when MIS cache is available, contains today's trade data,
    // is not stale (see MIS_ENTRY_MAX_AGE_MS doc — the cron itself stops
    // feeding at 14:35 TST, so a same-day entry can still be hours old), and
    // carries a plausible changePct (see isPlausibleChangePct doc — a
    // corrupted upstream tick must never be served, freshness alone is not
    // sufficient).
    const misEntry = misCache?.get(symbol);
    const misEntryAgeMs = misEntry ? Date.now() - Date.parse(misEntry.ts) : NaN;
    const misEntryFresh = Number.isFinite(misEntryAgeMs) && misEntryAgeMs <= MIS_ENTRY_MAX_AGE_MS;
    if (
      misEntry &&
      misEntry.tradeDateYmd === todayYmd &&
      misEntryFresh &&
      isPlausibleChangePct(misEntry.changePct)
    ) {
      // Derive change from MIS's OWN changePct so change/changePct can never mix
      // trading days. Deriving prevClose from the TWSE EOD row produced
      // sign-contradicting tiles on 6/10 (change=+85 vs changePct=-7.15) because
      // TWSE EOD publish lags a session and its prevClose belonged to 6/8.
      const pctDenominator = misEntry.changePct !== null ? 1 + misEntry.changePct / 100 : null;
      const change = pctDenominator !== null && pctDenominator > 1e-6
        ? Math.round((misEntry.last - misEntry.last / pctDenominator) * 100) / 100
        : null;

      misIntradayTileCount++;
      return {
        symbol,
        name: kgiTile.name,
        sector,
        price: misEntry.last,
        change,
        changePct: misEntry.changePct,
        tier,
        ts: misEntry.ts,
        sourceState: "twse_mis_intraday" as TileSourceState,
        sourceLabel: buildSourceLabel("twse_mis_intraday", misEntry.ts),
      };
    }

    // ── Tier 2: TWSE EOD ────────────────────────────────────────────────────
    const twse = twseMap.get(symbol);
    if (twse) {
      twseEodTileCount++;
      return {
        symbol,
        name: kgiTile.name,
        sector,
        price: twse.price,
        change: twse.change,
        changePct: twse.changePct,
        tier,
        ts: twse.ts,
        sourceState: "twse_eod" as TileSourceState,
        sourceLabel: buildSourceLabel("twse_eod", twse.ts),
      };
    }

    // ── Tier 2.5: DB-persisted last close (quote_last_close, 盤後 fallback) ──
    // Only present when the route handler determined we're after-hours (via
    // lib/trading-calendar, not a bare wall-clock guess) and successfully
    // queried the DB. Durable across deploy restarts — the gap this closes:
    // Tier 2 (live STOCK_DAY_ALL fetch) can lag hours after close, and Tier 3
    // (in-process cache below) resets to empty on every deploy restart, so
    // right after a post-close restart every KGI-core tile fell through to
    // "no_data" until the next successful live TWSE fetch. Reported as
    // "twse_eod" — quote_last_close's own source values (twse_eod/tpex_eod/
    // mis_close/ohlcv_fallback) are all official/reconciled "last known
    // close" provenance, not live ticks, so the same honest label applies.
    const dbClose = dbCloseMap?.get(symbol);
    if (dbClose) {
      twseEodTileCount++;
      const ts = `${dbClose.tradeDate}T13:30:00+08:00`;
      return {
        symbol,
        name: kgiTile.name,
        sector,
        price: dbClose.closePrice,
        change: null,
        changePct: null,
        tier,
        ts,
        sourceState: "twse_eod" as TileSourceState,
        sourceLabel: buildSourceLabel("twse_eod", ts),
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
          sector,
          price: cached.price,
          change: cached.change,
          changePct: isPlausibleChangePct(cached.changePct) ? cached.changePct : null,
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
      sector,
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
    : misIntradayTileCount > 0 ? "intraday"
    : twseEodTileCount > 0 ? "eod"
    : cacheTileCount > 0 ? "cache"
    : "none";

  return {
    tiles,
    source: liveTileCount > 0 ? "kgi_tick" : "kgi_heatmap_enricher",
    staleAfterSec: liveTileCount > 0 ? 5 : misIntradayTileCount > 0 ? 60 : twseEodTileCount > 0 ? 300 : 3600,
    tileCount: tiles.length,
    liveTileCount,
    misIntradayTileCount,
    twseEodTileCount,
    cacheTileCount,
    dataFreshness,
  };
}
