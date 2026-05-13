/**
 * twse-announcement-ingest.ts — TWSE OpenAPI material-announcement ingest job
 *
 * Cycle 16 (2026-05-14): P1-B backlog — populate tw_announcements from TWSE OpenAPI.
 *
 * Source: TWSE OpenAPI /opendata/t187ap46_L
 *   - Returns all recent material announcements across all listed stocks.
 *   - No auth required. No per-ticker loop needed — one fetch covers all codes.
 *   - Field shape: { Date, Code, Name, Title, Content, Link? }
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

/** Fetch all material announcements from TWSE OpenAPI in one request. */
export async function fetchAllTwseMaterialAnnouncements(
  fetchOverride?: typeof fetch
): Promise<TwseMaterialRow[]> {
  const doFetch = fetchOverride ?? globalThis.fetch;
  const url = `${TWSE_BASE_URL}/opendata/t187ap46_L`;

  try {
    const resp = await doFetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!resp.ok) {
      console.warn(`[twse-ann-ingest] TWSE OpenAPI HTTP ${resp.status}`);
      return [];
    }
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("application/json") && !ct.includes("text/json")) {
      console.warn("[twse-ann-ingest] TWSE OpenAPI non-JSON response:", ct);
      return [];
    }
    const raw = await resp.json();
    if (!Array.isArray(raw)) {
      console.warn("[twse-ann-ingest] TWSE OpenAPI unexpected shape (not array)");
      return [];
    }
    return raw as TwseMaterialRow[];
  } catch (err) {
    console.warn("[twse-ann-ingest] TWSE OpenAPI fetch failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
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
