/**
 * kgi-heatmap-enricher.ts — 3-tier fallback enricher for KGI core heatmap
 *
 * Tier 1 (live):       KGI gateway tick   — market hours, EC2 running
 * Tier 2 (twse_eod):   TWSE STOCK_DAY_ALL — per-symbol EOD price + changePct
 * Tier 2.5 (no_data):  quote_last_close DB table — 盤後 price-only fallback,
 *                      survives deploy restarts (unlike Tier 3's in-process
 *                      cache). Only populated by the caller when after-hours
 *                      (see server.ts's after-hours gate using
 *                      lib/trading-calendar). 2026-07-17: this tier's schema
 *                      structurally has no prevClose/change data, so it can
 *                      never supply a real % move — reported as "no_data"
 *                      (not "twse_eod") so the frontend never renders a
 *                      fabricated/blank % for it; price is still returned.
 * Tier 3 (cache):      In-process last-known-close — survives off-hours gap
 *                      within a single process lifetime
 *
 * 2026-07-17 data-honesty gating (楊董抓到熱力圖「一堆 0% 一堆空缺」): any
 * tile whose changePct cannot be determined — Tier 2.5's structural gap
 * above, or a Tier 2 row with an implausible exact-zero Change contradicted
 * by our own prior-day cache (see isZeroChangePlausible) — is reported as
 * sourceState="no_data", never as a normal tier with a fabricated 0%/blank
 * %. See reports/sprint_2026_07_17/HEATMAP_DATA_HONESTY_GATING_2026_07_17.md.
 *
 * Hard lines:
 *   - Never drops tiles: always returns >= 0 tiles with sourceState set
 *   - Does NOT import broker.*
 *   - Does NOT modify tickerToIndustry / TWSE industry aggregate logic
 *   - Does NOT rewrite the KGI 40-symbol list
 *   - Cache update is additive (union, never removes known symbols)
 */

import type { KgiHeatmapTile } from "./kgi-subscription-manager.js";
import { parseTwseNumber, type StockDayAllRow } from "./data-sources/twse-openapi-client.js";
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
  /** 2026-07-17: price MAY be populated even when sourceState="no_data" —
   * e.g. an OTC/TPEX symbol resolved via Tier 2.5 (quote_last_close), which
   * structurally has no change/prevClose data. "no_data" means "do not
   * render as a valid %-move tile", not "literally nothing is known". */
  price: number | null;
  /** null whenever sourceState="no_data" (see price doc above) — a tile
   * must never mix a known price with a fabricated or missing % move. */
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

export interface LastCloseEntry {
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

/**
 * 2026-07-17 data-honesty gating fix (楊董抓到熱力圖「一堆 0%」): a TWSE
 * STOCK_DAY_ALL row reporting an EXACT Change="0.0000" is ambiguous — it
 * could be a genuinely flat trading day, or an upstream batch-processing
 * artifact where the per-symbol Change field had not been computed yet at
 * the moment the row was published (confirmed via TWSE MIS cross-check on
 * 2026-07-17: symbol 2395 showed price=513/change=0 in STOCK_DAY_ALL while
 * MIS's own prevClose was 519 — i.e. a real -1.16% move, not flat — see
 * reports/sprint_2026_07_17/HEATMAP_DATA_HONESTY_GATING_2026_07_17.md).
 * Cross-check an exact zero against our OWN last-known prior-day close (if
 * any) before trusting it: a genuinely flat day's close must equal
 * yesterday's cached close (within rounding); if it doesn't, the "0" is not
 * trustworthy and must be treated as missing, not a fabricated flat move.
 * Known limitation: with no prior cache entry yet (e.g. right after a
 * deploy restart, before any TWSE fetch has populated the cache), there is
 * no ground truth to contradict a zero, so it is accepted — belt-and-
 * suspenders, not a complete fix for every possible timing window.
 */
export function isZeroChangePlausible(
  priorEntry: LastCloseEntry | undefined,
  close: number,
  dateTag: string
): boolean {
  if (!priorEntry) return true; // no ground truth available — can't disprove it
  if (!(priorEntry.dateTag < dateTag)) return true; // not actually a PRIOR date — nothing to compare
  const tolerance = Math.max(0.01, priorEntry.price * 0.001);
  return Math.abs(priorEntry.price - close) <= tolerance;
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

/**
 * Update last-known-close entries from a TWSE STOCK_DAY_ALL batch.
 *
 * @param priorSnapshot Optional cache snapshot taken BEFORE this call (see
 *   isZeroChangePlausible doc) — used to cross-check a suspicious exact-zero
 *   Change value against our own prior-day ground truth. Callers that don't
 *   pass one simply skip that extra guard (existing callers unaffected).
 */
export function updateLastCloseFromTwse(
  rows: StockDayAllRow[],
  priorSnapshot?: ReadonlyMap<string, LastCloseEntry>
): void {
  for (const row of rows) {
    const code = row.Code?.trim();
    if (!code) continue;
    // 2026-07-17 P1 fix: parseTwseNumber strips thousands-commas
    // ("2,470.0000") before parsing — a bare parseFloat() here silently
    // truncated at the comma (returning e.g. `2` for a 2,470 close). See
    // reports/sprint_2026_07_17/KGI_CORE_HEATMAP_PRICE_CORRUPTION_2026_07_17.md
    const close = parseTwseNumber(row.ClosingPrice);
    const changeVal = parseTwseNumber(row.Change);
    // Belt-and-suspenders (Pete review 🔴#1): don't trust parseTwseNumber's
    // return value alone — a no-trade EOD row's empty ClosingPrice must never
    // be treated as a real price=0 tile at this call site either.
    if (close === null || close <= 0) continue;

    const prevClose = changeVal != null && (close - changeVal) !== 0 ? close - changeVal : null;
    let pctRaw = prevClose != null ? Math.round((changeVal! / prevClose) * 10000) / 100 : null;
    // Defense-in-depth: a pctRaw outside the ±10% daily limit band means this
    // row is malformed upstream (comma-truncation or any other future parse
    // failure) — skip the WHOLE row rather than only nulling changePct while
    // still caching the corrupted price. Serving "price:2, changePct:null"
    // is exactly the bug this guard closes.
    if (pctRaw !== null && !isPlausibleChangePct(pctRaw)) continue;

    // Derive ISO date from TWSE ROC date "114/05/18" → "2026-05-18"
    const dateTag = parseTwseDate(row.Date ?? "");

    // 2026-07-17 data-honesty fix #2: don't cache a fabricated flat move —
    // see isZeroChangePlausible doc.
    let cachedChange = changeVal;
    if (pctRaw === 0 && priorSnapshot && !isZeroChangePlausible(priorSnapshot.get(code), close, dateTag)) {
      pctRaw = null;
      cachedChange = null;
    }

    const ts = dateTag ? `${dateTag}T13:30:00+08:00` : new Date().toISOString();

    // Only update if entry doesn't exist or is older
    const existing = _lastCloseCache.get(code);
    if (!existing || dateTag > existing.dateTag) {
      _lastCloseCache.set(code, { price: close, change: cachedChange, changePct: pctRaw, ts, dateTag });
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
  // 2026-07-17 data-honesty fix #2: snapshot the cache BEFORE the
  // write-through mutation below so we retain a pre-update "prior day"
  // ground truth to cross-check a suspicious exact-zero Change value
  // against (see isZeroChangePlausible doc). Shallow copy is sufficient —
  // LastCloseEntry values are always replaced wholesale via .set(), never
  // mutated in place.
  const priorCloseSnapshot = new Map(_lastCloseCache);

  // Update last-close cache from TWSE data (write-through for future requests)
  if (twseRows.length > 0) {
    updateLastCloseFromTwse(twseRows, priorCloseSnapshot);
  }

  // Build per-symbol TWSE lookup map.
  // 2026-07-17 P1 fix: same comma-safe parse + skip-whole-row-on-implausible-
  // pct guard as updateLastCloseFromTwse() above — see that function's
  // comment for the root cause. A row that fails the guard here is simply
  // absent from twseMap, so Tier 2 falls through to Tier 2.5/cache/no_data
  // for that symbol instead of serving a corrupted price.
  const twseMap = new Map<string, { price: number; change: number | null; changePct: number | null; ts: string }>();
  for (const row of twseRows) {
    const code = row.Code?.trim();
    if (!code) continue;
    const close = parseTwseNumber(row.ClosingPrice);
    // Belt-and-suspenders (Pete review 🔴#1): a no-trade EOD row's empty
    // ClosingPrice must never surface as a real price=0 tile.
    if (close === null || close <= 0) continue;
    const changeVal = parseTwseNumber(row.Change);
    const prevClose = changeVal != null && (close - changeVal) !== 0 ? close - changeVal : null;
    let pctRaw = prevClose != null ? Math.round((changeVal! / prevClose) * 10000) / 100 : null;
    if (pctRaw !== null && !isPlausibleChangePct(pctRaw)) continue;
    const dateTag = parseTwseDate(row.Date ?? "");
    // 2026-07-17 data-honesty fix #2: don't serve a fabricated flat move —
    // see isZeroChangePlausible doc above.
    let change = changeVal;
    if (pctRaw === 0 && !isZeroChangePlausible(priorCloseSnapshot.get(code), close, dateTag)) {
      pctRaw = null;
      change = null;
    }
    const ts = dateTag ? `${dateTag}T13:30:00+08:00` : new Date().toISOString();
    twseMap.set(code, { price: close, change, changePct: pctRaw, ts });
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
      // 2026-07-17 data-honesty gating fix #1 (楊董抓到「一堆空缺」): a row
      // whose changePct we could not determine (e.g. an implausible-zero row
      // nulled out above) must not surface as a normal "twse_eod" tile with a
      // blank %. Reclassify to "no_data" — the frontend already knows to
      // never render a no_data tile with a fabricated 0%/blank %, and
      // substitutes a real supplemental company instead (2026-07-14 楊董
      // 定案：缺角遞補真公司，不留半殘 tile）. Price/ts are still returned
      // for API completeness (e.g. ops inspection), just not counted toward
      // twseEodTileCount/dataFreshness="eod" since the % half is missing.
      if (twse.changePct === null) {
        return {
          symbol,
          name: kgiTile.name,
          sector,
          price: twse.price,
          change: null,
          changePct: null,
          tier,
          ts: twse.ts,
          sourceState: "no_data" as TileSourceState,
          sourceLabel: buildSourceLabel("no_data", twse.ts),
        };
      }
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
    // (in-process cache below) resets to empty on every deploy restart.
    //
    // 2026-07-17 data-honesty gating fix #1 (楊董抓到 OTC 股 3707 顯示
    // price=68.7/changePct=null 混在 twse_eod 桶裡): quote_last_close's
    // schema only stores close_price (no prevClose/change) — this tier can
    // NEVER supply a real % move, structurally, for ANY symbol (this is the
    // dominant path for OTC/TPEX-listed core symbols, which never appear in
    // TWSE STOCK_DAY_ALL at all, so Tier 2 can never match them either).
    // Previously mislabeled "twse_eod" — indistinguishable from a real full
    // EOD tile — which is exactly the "有價無漲跌幅但看起來像正常格" bug.
    // Reclassified to "no_data" so the frontend's existing no_data handling
    // (never render as a valid tile; substitute a real supplemental company)
    // applies here too. Price/ts still returned for API completeness.
    const dbClose = dbCloseMap?.get(symbol);
    if (dbClose) {
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
        sourceState: "no_data" as TileSourceState,
        sourceLabel: buildSourceLabel("no_data", ts),
      };
    }

    // ── Tier 3: Last-known-close cache ──────────────────────────────────────
    const cached = _lastCloseCache.get(symbol);
    if (cached) {
      // Check cache age
      const cacheTs = Date.parse(cached.ts);
      if (!isNaN(cacheTs) && Date.now() - cacheTs <= CACHE_MAX_AGE_MS) {
        const cachedChangePct = isPlausibleChangePct(cached.changePct) ? cached.changePct : null;
        // 2026-07-17 data-honesty gating fix #1: same reclassification as
        // Tier 2/2.5 above — a cached entry that never had a usable
        // changePct (e.g. cached from a TWSE row lacking a Change field, or
        // nulled out by the isZeroChangePlausible guard) must not surface as
        // a normal "cache" tile with a blank %.
        if (cachedChangePct === null) {
          return {
            symbol,
            name: kgiTile.name,
            sector,
            price: cached.price,
            change: null,
            changePct: null,
            tier,
            ts: cached.ts,
            sourceState: "no_data" as TileSourceState,
            sourceLabel: buildSourceLabel("no_data", cached.ts),
          };
        }
        cacheTileCount++;
        return {
          symbol,
          name: kgiTile.name,
          sector,
          price: cached.price,
          change: cached.change,
          changePct: cachedChangePct,
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
