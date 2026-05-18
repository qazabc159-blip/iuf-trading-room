/**
 * twse-announcement-ingest.ts — TWSE OpenAPI material-announcement ingest job
 *
 * Cycle 16 (2026-05-14): P1-B backlog — populate tw_announcements from TWSE OpenAPI.
 *
 * Source: TWSE OpenAPI /opendata/t187ap11_L  (重要事項公告 — primary)
 *   Fallback: /opendata/t187ap46_L           (deprecated endpoint, kept as fallback)
 *
 *   - Returns all recent material announcements across all listed stocks.
 *   - No auth required. No per-ticker loop needed — one fetch covers all codes.
 *   - Field shape: { Date, Code, Name, Title, Content, Link? }
 *
 * Endpoint switch (2026-05-18):
 *   t187ap46_L was deprecated / returning 302 or empty JSON silently.
 *   t187ap11_L (重要事項公告) is the actively maintained TWSE endpoint.
 *   Fallback chain: t187ap11_L → t187ap46_L (both fail → ingest returns 0 rows).
 *
 * Schedule (wired in server.ts):
 *   - Hourly during 09:00–15:00 TST on weekdays.
 *   - One-shot: fetches the full list, upserts rows from today + yesterday.
 *   - Startup catch-up: fires 45s after boot when current time is within trading hours.
 *
 * Idempotency:
 *   INSERT ... ON CONFLICT (COALESCE(ticker_symbol,''), announced_at, title_hash) DO NOTHING
 *   Using the unique index created by migration 0030_tw_announcements.sql.
 *
 * Hard lines:
 *   - Never throws to caller (all errors logged, function returns result object).
 *   - Graceful if tw_announcements table not yet promoted (logs warning, returns skipped).
 *   - Kill switch: TWSE_ANNOUNCEMENT_INGEST_KILL_SWITCH=true → skipped.
 *   - No secrets required (TWSE OpenAPI is public).
 *   - INSERT-only — no UPDATE, no DELETE.
 */

import { createHash } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "@iuf-trading-room/db";

// ── Kill switch ────────────────────────────────────────────────────────────────

function isKillSwitchOn(): boolean {
  return process.env.TWSE_ANNOUNCEMENT_INGEST_KILL_SWITCH === "true";
}

// ── SHA-256 title hash ─────────────────────────────────────────────────────────

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ── TWSE OpenAPI fetch ─────────────────────────────────────────────────────────

const TWSE_BASE_URL = "https://openapi.twse.com.tw/v1";
const FETCH_TIMEOUT_MS = 8000;

// Primary endpoint: t187ap11_L (重要事項公告, actively maintained)
// Fallback endpoint: t187ap46_L (deprecated, kept as safety net)
const TWSE_ANN_PRIMARY_PATH = "/opendata/t187ap11_L";
const TWSE_ANN_FALLBACK_PATH = "/opendata/t187ap46_L";

export interface TwseMaterialRow {
  /** Trading date YYYY/MM/DD */
  Date: string;
  /** Stock code e.g. "2330" */
  Code: string;
  /** Company name */
  Name: string;
  /** Announcement title */
  Title: string;
  /** Announcement content (may be empty) */
  Content?: string;
  /** Source URL (optional) */
  Link?: string;
}

/**
 * Fetch from a single TWSE endpoint path.
 * Returns rows on success, null on HTTP error / non-JSON / wrong shape.
 * Logs warn with details so silently-empty results are surfaced.
 */
async function fetchFromTwsePath(
  path: string,
  doFetch: typeof fetch
): Promise<TwseMaterialRow[] | null> {
  const url = `${TWSE_BASE_URL}${path}`;
  let resp: Response;
  try {
    resp = await doFetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`[twse-ann-ingest] fetch ${path} network error:`, err instanceof Error ? err.message : String(err));
    return null;
  }

  // Detect 302 (redirect to login/error page) or non-2xx
  if (resp.status === 302 || resp.status === 301) {
    const location = resp.headers.get("location") ?? "(no location)";
    console.warn(`[twse-ann-ingest] ${path} returned ${resp.status} redirect → ${location} (endpoint deprecated/unavailable)`);
    return null;
  }
  if (resp.status === 404) {
    console.warn(`[twse-ann-ingest] ${path} returned 404 (endpoint not found)`);
    return null;
  }
  if (!resp.ok) {
    console.warn(`[twse-ann-ingest] ${path} HTTP ${resp.status} (ingest fail)`);
    return null;
  }

  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.includes("application/json") && !ct.includes("text/json")) {
    console.warn(`[twse-ann-ingest] ${path} non-JSON content-type: ${ct} (endpoint may have changed format)`);
    return null;
  }

  let raw: unknown;
  try {
    raw = await resp.json();
  } catch (err) {
    console.warn(`[twse-ann-ingest] ${path} JSON parse error:`, err instanceof Error ? err.message : String(err));
    return null;
  }

  if (!Array.isArray(raw)) {
    console.warn(`[twse-ann-ingest] ${path} unexpected shape (not array), got:`, typeof raw);
    return null;
  }

  return raw as TwseMaterialRow[];
}

/**
 * Fetch all material announcements from TWSE OpenAPI.
 * Uses t187ap11_L (primary) with fallback to t187ap46_L.
 * Returns empty array only if both endpoints fail.
 */
export async function fetchAllTwseMaterialAnnouncements(
  fetchOverride?: typeof fetch
): Promise<TwseMaterialRow[]> {
  const doFetch = fetchOverride ?? globalThis.fetch;

  // Try primary endpoint first
  const primary = await fetchFromTwsePath(TWSE_ANN_PRIMARY_PATH, doFetch);
  if (primary !== null) {
    if (primary.length > 0) {
      console.log(`[twse-ann-ingest] primary ${TWSE_ANN_PRIMARY_PATH} returned ${primary.length} rows`);
    } else {
      console.log(`[twse-ann-ingest] primary ${TWSE_ANN_PRIMARY_PATH} returned 0 rows (market closed or no announcements)`);
    }
    return primary;
  }

  // Primary failed — try fallback
  console.warn(`[twse-ann-ingest] primary ${TWSE_ANN_PRIMARY_PATH} failed, trying fallback ${TWSE_ANN_FALLBACK_PATH}`);
  const fallback = await fetchFromTwsePath(TWSE_ANN_FALLBACK_PATH, doFetch);
  if (fallback !== null) {
    console.log(`[twse-ann-ingest] fallback ${TWSE_ANN_FALLBACK_PATH} returned ${fallback.length} rows`);
    return fallback;
  }

  console.warn(`[twse-ann-ingest] both primary and fallback endpoints failed — ingest returning 0 rows`);
  return [];
}

// ── Parse TWSE date to ISO timestamp ──────────────────────────────────────────

/**
 * TWSE Date field: "YYYY/MM/DD" → ISO timestamp at 00:00:00+08:00 (TST).
 * Returns null if unparseable.
 */
export function parseTwseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  // Normalise: "YYYY/MM/DD" → "YYYY-MM-DD"
  const iso = dateStr.replace(/\//g, "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  // Use TST noon (04:00 UTC) as the timestamp — avoids timezone-boundary edge cases
  // while keeping the date semantically correct for all consumers.
  return `${iso}T04:00:00.000Z`;
}

// ── Result type ────────────────────────────────────────────────────────────────

export interface TwseAnnouncementIngestResult {
  rowsFetched: number;
  rowsInserted: number;
  rowsSkipped: number;
  skipped: boolean;
  skipReason: string | null;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

// ── Main ingest function ───────────────────────────────────────────────────────

/**
 * runTwseAnnouncementIngest — fetch TWSE material announcements and upsert to tw_announcements.
 *
 * @param opts.lookbackDays - How many calendar days to ingest (default: 2 = today + yesterday)
 * @param opts.fetchOverride - For testing: override the fetch function
 */
export async function runTwseAnnouncementIngest(opts?: {
  lookbackDays?: number;
  fetchOverride?: typeof fetch;
}): Promise<TwseAnnouncementIngestResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  function makeSkipped(reason: string): TwseAnnouncementIngestResult {
    const now = new Date().toISOString();
    return {
      rowsFetched: 0,
      rowsInserted: 0,
      rowsSkipped: 0,
      skipped: true,
      skipReason: reason,
      durationMs: Date.now() - t0,
      startedAt,
      finishedAt: now
    };
  }

  if (isKillSwitchOn()) {
    console.log("[twse-ann-ingest] skipped=killswitch_on");
    return makeSkipped("killswitch_on");
  }

  const db = getDb();
  if (!db) {
    console.warn("[twse-ann-ingest] no DB connection, skipping");
    return makeSkipped("no_db");
  }

  // Verify tw_announcements table exists (graceful if migration not promoted)
  try {
    const result = await db.execute(drizzleSql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tw_announcements'
      ) AS "exists"
    `);
    const rows = (result as { rows?: Record<string, unknown>[] })?.rows ?? [];
    const row = rows[0] ?? (Array.isArray(result) ? (result as Record<string, unknown>[])[0] : null);
    const exists = row?.["exists"] === true || row?.["exists"] === "true";
    if (!exists) {
      console.warn("[twse-ann-ingest] tw_announcements table not found, skipping (migration 0030 not promoted)");
      return makeSkipped("table_not_found");
    }
  } catch (err) {
    console.warn("[twse-ann-ingest] table-check failed:", err instanceof Error ? err.message : String(err));
    return makeSkipped("table_check_failed");
  }

  // Fetch all announcements from TWSE OpenAPI
  const allRows = await fetchAllTwseMaterialAnnouncements(opts?.fetchOverride);
  if (allRows.length === 0) {
    console.log("[twse-ann-ingest] TWSE returned 0 rows (market closed or API unavailable)");
    return {
      rowsFetched: 0,
      rowsInserted: 0,
      rowsSkipped: 0,
      skipped: false,
      skipReason: null,
      durationMs: Date.now() - t0,
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }

  // Filter to lookbackDays (default 2: today + yesterday)
  const lookbackDays = opts?.lookbackDays ?? 2;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const filtered = allRows.filter(row => {
    const iso = row.Date?.replace(/\//g, "-") ?? "";
    return iso >= cutoffStr;
  });

  console.log(`[twse-ann-ingest] fetched=${allRows.length} filtered(last${lookbackDays}d)=${filtered.length}`);

  let rowsInserted = 0;
  let rowsSkipped = 0;
  const fetchedAt = new Date().toISOString();

  for (const row of filtered) {
    const ticker = row.Code?.trim() || null;
    const title = (row.Title ?? "").trim();
    if (!title) {
      rowsSkipped++;
      continue;
    }

    const announcedAt = parseTwseDate(row.Date);
    if (!announcedAt) {
      rowsSkipped++;
      continue;
    }

    const titleHash = sha256Hex(title);
    const content = (row.Content ?? "").trim() || null;
    const sourceUrl = row.Link?.trim() || null;

    try {
      // INSERT ... ON CONFLICT DO NOTHING using the dedup unique index:
      //   (COALESCE(ticker_symbol,''), announced_at, title_hash)
      const insertResult = await db.execute(drizzleSql`
        INSERT INTO tw_announcements
          (ticker_symbol, announced_at, title, content, title_hash, source, source_url, fetched_at)
        VALUES
          (
            ${ticker},
            ${announcedAt}::timestamptz,
            ${title},
            ${content},
            ${titleHash},
            'twse',
            ${sourceUrl},
            ${fetchedAt}::timestamptz
          )
        ON CONFLICT (COALESCE(ticker_symbol, ''), announced_at, title_hash) DO NOTHING
      `);

      // postgres.js returns rowCount on INSERT
      const rawInsert = insertResult as { rowCount?: number; rows?: unknown[] };
      const count = rawInsert?.rowCount ?? (rawInsert?.rows as unknown[] | undefined)?.length ?? 0;
      if (count > 0) {
        rowsInserted++;
      } else {
        rowsSkipped++;
      }
    } catch (err) {
      console.warn(
        `[twse-ann-ingest] insert failed for ticker=${ticker} title="${title.slice(0, 60)}":`,
        err instanceof Error ? err.message : String(err)
      );
      rowsSkipped++;
    }
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;

  console.log(
    `[twse-ann-ingest] done — fetched=${allRows.length} filtered=${filtered.length} ` +
    `inserted=${rowsInserted} skipped=${rowsSkipped} durationMs=${durationMs}`
  );

  return {
    rowsFetched: filtered.length,
    rowsInserted,
    rowsSkipped,
    skipped: false,
    skipReason: null,
    durationMs,
    startedAt,
    finishedAt
  };
}
