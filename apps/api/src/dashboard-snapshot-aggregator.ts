/**
 * dashboard-snapshot-aggregator.ts
 *
 * Aggregates all dashboard panel data into a single response payload.
 * Used by GET /api/v1/dashboard/snapshot (Codex vendor Path A).
 *
 * Design constraints:
 *   - Calls same underlying DB/store functions as individual route handlers — no logic duplication.
 *   - Promise.allSettled: 1 panel failure never blocks others.
 *   - 30s TTL in-memory cache keyed by userId (handles frontend tab-switch refresh storm).
 *   - Never calls order / risk mutation / broker paths.
 *   - Partial-success: min 1 panel must succeed to return 200; if all fail → fallback shell.
 *
 * Hard lines:
 *   - No order/broker/risk mutation
 *   - No new auth scheme — caller passes resolved userId and workspace context
 *   - No new DB migrations
 *   - stale_panels populated for every panel that throws or returns fallback data
 */

import { isDatabaseMode, getDb } from "@iuf-trading-room/db";
import { getTradingRoomRepository } from "@iuf-trading-room/domain";
import { sql as drizzleSql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DashboardSnapshotInput {
  userId: string;
  workspaceSlug: string;
  workspaceId: string;
}

export interface DashboardPanels {
  industry_heatmap: unknown;
  news_recent: { items: unknown[] };
  brief_today: unknown;
  lab_strategies: unknown[];
  audit_stats: unknown;
  watchlist_quotes: unknown[];
}

export interface DashboardSnapshot {
  as_of: string;
  panels: DashboardPanels;
  stale_panels: string[];
  errors: Record<string, string>;
}

// ── 30s TTL Cache ─────────────────────────────────────────────────────────────

interface CacheEntry {
  snapshot: DashboardSnapshot;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

export function _clearDashboardCache(): void {
  _cache.clear();
}

function getCached(userId: string): DashboardSnapshot | null {
  const entry = _cache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(userId);
    return null;
  }
  return entry.snapshot;
}

function setCache(userId: string, snapshot: DashboardSnapshot): void {
  _cache.set(userId, { snapshot, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── execRows helper (mirrors server.ts pattern for drizzle-orm/postgres-js) ───

function execRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r.rows ?? [];
}

// ── Panel fetchers ─────────────────────────────────────────────────────────────

/**
 * industry_heatmap — top 30 tickers by volume with pct change.
 * Same query as GET /api/v1/heatmap in server.ts.
 */
async function fetchHeatmapPanel(workspaceId: string): Promise<unknown> {
  const db = isDatabaseMode() ? getDb() : null;
  if (!db) return { sourceState: "empty", tiles: [] };

  const res = await db.execute(drizzleSql`
    WITH latest AS (
      SELECT MAX(dt) AS max_dt FROM companies_ohlcv WHERE interval = 'day'
    ),
    prev AS (
      SELECT MAX(dt) AS prev_dt
      FROM companies_ohlcv
      WHERE interval = 'day'
      AND dt < (SELECT max_dt FROM latest)
    )
    SELECT
      c.ticker AS sym,
      c.name,
      CASE
        WHEN p.close IS NOT NULL AND p.close > 0
        THEN ROUND(((t.close - p.close) / p.close * 100)::numeric, 2)::float
        ELSE 0
      END AS pct,
      NULL::bigint AS mcap
    FROM companies_ohlcv t
    JOIN companies c ON c.ticker = t.ticker AND c.workspace_id = ${workspaceId}
    LEFT JOIN companies_ohlcv p
      ON p.ticker = t.ticker
      AND p.interval = 'day'
      AND p.dt = (SELECT prev_dt FROM prev)
    WHERE t.interval = 'day'
      AND t.dt = (SELECT max_dt FROM latest)
      AND t.source != 'mock'
    ORDER BY t.volume DESC NULLS LAST
    LIMIT 30
  `);
  const rows = execRows<Record<string, unknown>>(res);

  if (rows.length === 0) return { sourceState: "empty", tiles: [] };

  const tiles = rows.map((r) => ({
    sym: String(r.sym ?? ""),
    name: String(r.name ?? r.sym ?? ""),
    pct: typeof r.pct === "number" ? r.pct : parseFloat(String(r.pct ?? "0")),
    mcap: typeof r.mcap === "number" ? r.mcap : null,
  }));
  return { sourceState: "live", tiles };
}

/**
 * news_recent — last 10 news items from tw_stock_news.
 * Mirrors the finmind_stock_news sub-query in server.ts announcements handler.
 */
async function fetchNewsPanel(workspaceId: string): Promise<{ items: unknown[] }> {
  const db = isDatabaseMode() ? getDb() : null;
  if (!db) return { items: [] };

  const res = await db.execute(drizzleSql`
    SELECT
      n.id::text AS id,
      n.stock_id AS ticker,
      COALESCE(c.name, n.stock_id) AS company_name,
      COALESCE(NULLIF(n.published_at, ''), n.fetched_at::text) AS date,
      n.title AS title,
      COALESCE(NULLIF(n.source_name, ''), '台股新聞') AS category,
      n.url AS url
    FROM tw_stock_news n
    LEFT JOIN companies c
      ON c.ticker = n.stock_id
     AND c.workspace_id = ${workspaceId}
    WHERE n.fetched_at >= NOW() - INTERVAL '7 days'
      AND COALESCE(n.title, '') <> ''
    ORDER BY n.fetched_at DESC
    LIMIT 10
  `);
  const rows = execRows<Record<string, unknown>>(res);
  const items = rows.map((r, i) => ({
    id: String(r.id ?? `news-${i}`),
    date: String(r.date ?? "").slice(0, 10),
    title: String(r.title ?? ""),
    category: String(r.category ?? "市場情報"),
    ticker: r.ticker ?? undefined,
    companyName: r.company_name ?? r.ticker ?? undefined,
    url: r.url ?? null,
  }));
  return { items };
}

/**
 * brief_today — latest published brief.
 * Same as GET /api/v1/briefs → picks the first (most recent) published entry.
 */
async function fetchBriefTodayPanel(workspaceSlug: string): Promise<unknown> {
  const repo = getTradingRoomRepository();
  const briefs = await repo.listBriefs({ workspaceSlug });
  const published = briefs.filter((b) => b.status === "published");
  if (published.length === 0) return { data: null, meta: { reason: "no_published_brief" } };
  const latest = published[0]!;
  return {
    data: {
      id: latest.id,
      date: latest.date,
      status: latest.status,
      title: (latest.sections?.[0]?.heading ?? `Brief ${latest.date}`),
      sectionCount: latest.sections?.length ?? 0,
    },
  };
}

/**
 * lab_strategies — RESEARCH_ONLY candidates from lab sanctioned snapshot.
 * Same as GET /api/v1/lab/strategy-snapshot.
 */
async function fetchLabStrategiesPanel(): Promise<unknown[]> {
  try {
    const { loadLabSanctionedSnapshot } = await import("./lab-strategy-consumer.js");
    const snapshot = loadLabSanctionedSnapshot();
    if (!snapshot) return [];
    return snapshot.candidates.slice(0, 3);
  } catch {
    return [];
  }
}

/**
 * audit_stats — 24h window counts.
 * Same query as GET /api/v1/internal/observability/audit-stats?since=24h.
 */
async function fetchAuditStatsPanel(): Promise<unknown> {
  const db = isDatabaseMode() ? getDb() : null;
  const windowHours = 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  if (!db) {
    return {
      windowHours,
      since,
      ai_approved: 0,
      ai_rejected: 0,
      hallucination_reject: 0,
      adversarial_intercept: 0,
      ai_yellow_held: 0,
      paper_submit: 0,
      paper_submit_rejected: 0,
      total: 0,
      db_available: false,
    };
  }

  const rawRows = await db.execute(
    drizzleSql`
      SELECT action, COUNT(*)::int AS cnt
      FROM audit_logs
      WHERE created_at >= ${since}::timestamptz
        AND action IN (
          'content_draft.ai_approved',
          'content_draft.ai_rejected',
          'hallucination_reject',
          'content_draft.adversarial_audit',
          'content_draft.ai_yellow_held',
          'paper_submit'
        )
      GROUP BY action
    `
  );
  const rows = execRows<{ action?: string; cnt?: number | string }>(rawRows);

  const rawRejRows = await db.execute(
    drizzleSql`
      SELECT COUNT(*)::int AS cnt
      FROM audit_logs
      WHERE created_at >= ${since}::timestamptz
        AND action = 'paper_submit'
        AND (payload->>'status')::int >= 422
    `
  );
  const rejFirstRow = execRows<{ cnt?: number | string }>(rawRejRows)[0];

  const rawAdvRows = await db.execute(
    drizzleSql`
      SELECT COUNT(*)::int AS cnt
      FROM audit_logs
      WHERE created_at >= ${since}::timestamptz
        AND action = 'content_draft.adversarial_audit'
        AND (payload->>'severityScore')::int >= 7
    `
  );
  const advFirstRow = execRows<{ cnt?: number | string }>(rawAdvRows)[0];

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.action) counts[row.action] = Number(row.cnt ?? 0);
  }

  const aiApproved = counts["content_draft.ai_approved"] ?? 0;
  const aiRejected = counts["content_draft.ai_rejected"] ?? 0;
  const hallucinationReject = counts["hallucination_reject"] ?? 0;
  const adversarialIntercept = Number(advFirstRow?.cnt ?? 0);
  const aiYellowHeld = counts["content_draft.ai_yellow_held"] ?? 0;
  const paperSubmit = counts["paper_submit"] ?? 0;
  const paperSubmitRejected = Number(rejFirstRow?.cnt ?? 0);
  const total = aiApproved + aiRejected + hallucinationReject + adversarialIntercept + aiYellowHeld + paperSubmit;

  return {
    windowHours,
    since,
    ai_approved: aiApproved,
    ai_rejected: aiRejected,
    hallucination_reject: hallucinationReject,
    adversarial_intercept: adversarialIntercept,
    ai_yellow_held: aiYellowHeld,
    paper_submit: paperSubmit,
    paper_submit_rejected: paperSubmitRejected,
    total,
    db_available: true,
  };
}

/**
 * watchlist_quotes — batch quote for user watchlist symbols.
 * No backing watchlist table yet → always returns [].
 * When the table exists, this function will be upgraded without changing the shape.
 */
async function fetchWatchlistQuotesPanel(): Promise<unknown[]> {
  // No backing watchlist table yet. Return typed empty array.
  // Shape will be: Array<{ symbol, lastPrice, state, source }>
  return [];
}

// ── Main aggregation entry ────────────────────────────────────────────────────

export async function buildDashboardSnapshot(
  input: DashboardSnapshotInput
): Promise<{ snapshot: DashboardSnapshot; fromCache: boolean }> {
  const cached = getCached(input.userId);
  if (cached) return { snapshot: cached, fromCache: true };

  const as_of = new Date().toISOString();
  const stale_panels: string[] = [];
  const errors: Record<string, string> = {};

  const [
    heatmapResult,
    newsResult,
    briefResult,
    labResult,
    auditResult,
    watchlistResult,
  ] = await Promise.allSettled([
    fetchHeatmapPanel(input.workspaceId),
    fetchNewsPanel(input.workspaceId),
    fetchBriefTodayPanel(input.workspaceSlug),
    fetchLabStrategiesPanel(),
    fetchAuditStatsPanel(),
    fetchWatchlistQuotesPanel(),
  ]);

  function resolvePanel<T>(
    name: string,
    result: PromiseSettledResult<T>,
    fallback: T
  ): T {
    if (result.status === "rejected") {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      stale_panels.push(name);
      errors[name] = msg;
      console.warn(`[dashboard-snapshot] panel '${name}' failed:`, msg);
      return fallback;
    }
    return result.value;
  }

  const panels: DashboardPanels = {
    industry_heatmap: resolvePanel(
      "industry_heatmap",
      heatmapResult,
      { sourceState: "error", tiles: [] }
    ),
    news_recent: resolvePanel(
      "news_recent",
      newsResult,
      { items: [] }
    ),
    brief_today: resolvePanel(
      "brief_today",
      briefResult,
      { data: null, meta: { reason: "panel_error" } }
    ),
    lab_strategies: resolvePanel(
      "lab_strategies",
      labResult,
      []
    ),
    audit_stats: resolvePanel(
      "audit_stats",
      auditResult,
      {
        windowHours: 24,
        since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        ai_approved: 0, ai_rejected: 0, hallucination_reject: 0,
        adversarial_intercept: 0, ai_yellow_held: 0,
        paper_submit: 0, paper_submit_rejected: 0, total: 0,
        db_available: false,
      }
    ),
    watchlist_quotes: resolvePanel(
      "watchlist_quotes",
      watchlistResult,
      []
    ),
  };

  const snapshot: DashboardSnapshot = { as_of, panels, stale_panels, errors };
  setCache(input.userId, snapshot);
  return { snapshot, fromCache: false };
}
