/**
 * openalice-pipeline.ts
 *
 * OpenAlice Autonomous Daily Pipeline — BLOCK #4 P0-C main axis.
 *
 * Pipeline = scheduler → source pack collector → generator → AI reviewer (PR #218) → publisher gate → audit log.
 *
 * Scheduler ticks (TST = Taipei Standard Time UTC+8):
 *   - pre-market  07:30 TST  (pre-open; generate here, published by 08:00 TST)
 *   - close-watch 13:45 TST  (intraday near-close)
 *   - close-brief 16:30 TST  (post-close daily summary)
 *
 * Skip: non-trading days (weekends + TW holidays from tw_trading_calendar).
 * Always: fail-closed — missing source → mark MISSING_SOURCE, never fake content.
 * Publish gate (Green tier): source trail complete + AI reviewer approve + confidence>=0.7 + 0 red flags.
 * Yellow tier (strategy/ranking/metrics content): awaiting_review, no auto-publish.
 * Red tier (buy/sell/target/guarantee/Sharpe): forced reject.
 *
 * ADDITIVE ONLY — does not modify existing dispatcher (PR #198).
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { and, desc, eq, gte, sql as drizzleSql } from "drizzle-orm";
import {
  auditLogs,
  companiesOhlcv,
  contentDrafts,
  dailyBriefs,
  getDb,
  isDatabaseMode,
  workspaces
} from "@iuf-trading-room/db";

import { enqueueOpenAliceJob } from "./openalice-bridge.js";
import { fireAiReviewerForDraft } from "./openalice-ai-reviewer.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SourceStatus =
  | "LIVE"
  | "STALE"
  | "EMPTY"
  | "BLOCKED"
  | "DEGRADED"
  | "ERROR"
  | "MOCK"
  | "FALLBACK"
  | "CLOSED"
  | "MISSING";

export type SourcePackEntry = {
  source: string;
  status: SourceStatus;
  rowCount: number | null;
  latestDate: string | null;
  note: string | null;
  /** Up to 3 real DB rows for RAG cross-validation. Null when no DB or table missing. */
  sampleRows?: Record<string, unknown>[] | null;
};

export type SourcePack = {
  packId: string;
  tick: "pre_market" | "close_watch" | "close_brief";
  collectedAt: string;
  tradingDate: string;
  sources: SourcePackEntry[];
  trailComplete: boolean; // true if all required sources are LIVE or DEGRADED
};

export type PipelineRunResult = {
  runId: string;
  tick: "pre_market" | "close_watch" | "close_brief";
  tradingDate: string;
  skippedReason: string | null;
  sourcePack: SourcePack | null;
  jobId: string | null;
  draftId: string | null;
  reviewerVerdict: "approve" | "reject" | "manual_review" | null;
  confidence: number | null;
  publishedBriefId: string | null;
  totalCostUsd: number | null;
  durationMs: number;
  error: string | null;
};

// ── Strategy registry snapshot (axis 4) ──────────────────────────────────────

/**
 * Trimmed shape of each strategy entry in the Lab snapshot.
 * No code internals — summary metrics + caveats only.
 */
export type StrategyRegistryEntry = {
  strategyId: string;
  name: string;
  type: "short_term" | "mid_term" | "long_term" | "reversal";
  status: "BACKTESTED_RAW" | "PORTFOLIO_BACKTESTED_RAW" | "PAPER_PROPOSED" | "PAPER_LIVE";
  latestSummary: {
    totalTrades: number;
    rawPnl: number;
    maxDd: number;
    avgHoldingDays: number;
  };
  caveats: string[];
};

type StrategySnapshot = {
  schema: string;
  snapshotAt: string;
  strategies: StrategyRegistryEntry[];
};

/**
 * Load the Lab strategy snapshot from `data/lab/strategies-snapshot.json`
 * (published by Athena and committed into the IUF Trading Room repo).
 *
 * Returns null (never throws) when:
 *  - file does not exist (Lab hasn't pushed a snapshot yet)
 *  - file is malformed JSON
 *  - strategies array is missing or empty
 *
 * Callers treat null as "no strategy section this run" — graceful skip.
 * NEVER returns fake data or placeholder values.
 */
export function loadStrategySnapshot(): StrategyRegistryEntry[] | null {
  try {
    // Resolve path relative to this file: apps/api/src/ → 3 levels up → monorepo root
    const __file = fileURLToPath(import.meta.url);
    const __dir = dirname(__file);
    const snapshotPath = join(__dir, "..", "..", "..", "data", "lab", "strategies-snapshot.json");
    const raw = readFileSync(snapshotPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("strategies" in parsed) ||
      !Array.isArray((parsed as StrategySnapshot).strategies) ||
      (parsed as StrategySnapshot).strategies.length === 0
    ) {
      console.warn("[pipeline] strategies-snapshot.json malformed or empty — skipping strategy section");
      return null;
    }
    const snapshot = parsed as StrategySnapshot;
    return snapshot.strategies;
  } catch {
    // File not found or JSON parse error — degrade silently
    return null;
  }
}

// ── In-memory debug surface (aligns with PR #215 dispatcher-debug pattern) ───

export type PipelineState = {
  lastRunAt: string | null;
  lastTick: "pre_market" | "close_watch" | "close_brief" | null;
  lastTradingDate: string | null;
  lastResult: PipelineRunResult | null;
  lastFailureReason: string | null;
  totalRunsThisProcess: number;
  lastGeneratedAt: string | null;
  lastReviewedAt: string | null;
  lastPublishedAt: string | null;
  nextRunAt: string | null;
  sourcePackCount: number;
  reviewerVerdict: "approve" | "reject" | "manual_review" | null;
};

export let _lastPipelineState: PipelineState = {
  lastRunAt: null,
  lastTick: null,
  lastTradingDate: null,
  lastResult: null,
  lastFailureReason: null,
  totalRunsThisProcess: 0,
  lastGeneratedAt: null,
  lastReviewedAt: null,
  lastPublishedAt: null,
  nextRunAt: null,
  sourcePackCount: 0,
  reviewerVerdict: null
};

function updatePipelineState(partial: Partial<PipelineState>) {
  _lastPipelineState = { ..._lastPipelineState, ...partial };
}

// ── Job → sourcePackSummary registry (Gap 2 fix: adversarial reviewer needs sourcePack context) ──
//
// Maps jobId → sourcePackSummary string so that fireAiReviewerForDraft can pass
// a real summary to runAdversarialReview (Category C bias detection).
// In-memory only — process restart is acceptable (summary is non-critical context).

const _jobSourcePackSummaryMap = new Map<string, string>();

/**
 * Register a sourcePackSummary for a given pipeline jobId.
 * Called from generateDailyBrief immediately after enqueueOpenAliceJob succeeds.
 */
export function registerJobSourcePackSummary(jobId: string, summary: string): void {
  _jobSourcePackSummaryMap.set(jobId, summary);
  // Cap map size to prevent unbounded growth (keep last 100 jobs)
  if (_jobSourcePackSummaryMap.size > 100) {
    const firstKey = _jobSourcePackSummaryMap.keys().next().value;
    if (firstKey !== undefined) _jobSourcePackSummaryMap.delete(firstKey);
  }
}

/**
 * Look up sourcePackSummary by jobId.
 * Returns null if the job was not registered (e.g., non-pipeline draft or process restart).
 */
export function lookupJobSourcePackSummary(jobId: string): string | null {
  return _jobSourcePackSummaryMap.get(jobId) ?? null;
}

// ── Job → full SourcePack registry (Layer 5 factual reviewer fix 2026-05-08) ──
//
// Maps jobId → full SourcePack object so evaluatePipelinePublishGate can pass
// real sampleRows to the factual reviewer (Layer 5).
// Pete audit finding: sourcePack=null at call-site → Layer 5 condition
//   `if (draftContentForFactual && sourcePack)` is always false → 0% activation.
// Fix: store full SourcePack per jobId (parallel to summary map above).
// In-memory only — process restart means legacy drafts (before restart) still
// degrade gracefully to null → single-pass fallback, never blocking.

const _jobSourcePackMap = new Map<string, SourcePack>();

/**
 * Register the full SourcePack for a given pipeline jobId.
 * Called from generateDailyBrief immediately after enqueueOpenAliceJob succeeds.
 * Used by loadSourcePackForDraft to pipe real sampleRows to Layer 5 factual reviewer.
 */
export function registerJobSourcePack(jobId: string, pack: SourcePack): void {
  _jobSourcePackMap.set(jobId, pack);
  // Cap map size to prevent unbounded growth (keep last 100 jobs, same as summary map)
  if (_jobSourcePackMap.size > 100) {
    const firstKey = _jobSourcePackMap.keys().next().value;
    if (firstKey !== undefined) _jobSourcePackMap.delete(firstKey);
  }
}

/**
 * Resolve the full SourcePack for a given content_draft by looking up its sourceJobId.
 * Returns null if:
 *   - draft has no sourceJobId (non-pipeline draft)
 *   - job was not in registry (process restart, legacy brief)
 * Caller MUST treat null as graceful degradation (single-pass fallback), not an error.
 */
export function loadSourcePackForDraft(draftSourceJobId: string | null | undefined): SourcePack | null {
  if (!draftSourceJobId) return null;
  return _jobSourcePackMap.get(draftSourceJobId) ?? null;
}

// ── Taipei time helpers ───────────────────────────────────────────────────────

function getTaipeiDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function getTaipeiHHMM(now: Date = new Date()): number {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);
  return parseInt(formatted.replace(":", ""), 10);
}

function getTaipeiDayOfWeek(now: Date = new Date()): number {
  // 0 = Sunday, 1 = Monday ... 6 = Saturday (Taipei local)
  const dateStr = getTaipeiDate(now);
  return new Date(dateStr + "T00:00:00+08:00").getDay();
}

// ── Trading calendar check ────────────────────────────────────────────────────

/**
 * Returns true if today is a Taiwan Stock Exchange trading day.
 * Uses tw_trading_calendar DB table if available (Athena spec dataset #9).
 * Falls back to weekend-only check when table is absent (DEGRADED mode).
 */
async function isTwTradingDay(tradingDate: string): Promise<boolean> {
  // Weekend fast-path (Taipei local DOW)
  const parts = tradingDate.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;

  // DB holiday check — table may not exist (DRAFT migration not yet promoted)
  if (!isDatabaseMode()) return true;
  const db = getDb();
  if (!db) return true;

  try {
    const rows = await db.execute(
      drizzleSql`SELECT is_trading_day FROM tw_trading_calendar WHERE date = ${tradingDate} LIMIT 1`
    );
    const row = (rows as { rows?: Array<{ is_trading_day?: boolean }> }).rows?.[0];
    if (row === undefined) {
      // Date not in table → assume trading day (conservative, better than skipping)
      return true;
    }
    return row.is_trading_day !== false;
  } catch {
    // Table doesn't exist yet (migration not promoted) → fall back to weekend check only
    return true;
  }
}

// ── Source pack collector ─────────────────────────────────────────────────────

const STALE_DAYS_THRESHOLD = 2; // rows older than this many days are STALE

async function collectSourcePack(
  workspaceId: string,
  tick: SourcePack["tick"],
  tradingDate: string
): Promise<SourcePack> {
  const packId = randomUUID();
  const collectedAt = new Date().toISOString();
  const sources: SourcePackEntry[] = [];

  if (!isDatabaseMode()) {
    // Memory mode — all sources MOCK
    const mockEntry = (source: string): SourcePackEntry => ({
      source,
      status: "MOCK",
      rowCount: 0,
      latestDate: null,
      note: "memory_mode_no_db",
      sampleRows: null
    });
    sources.push(
      mockEntry("companies_ohlcv"),
      mockEntry("tw_monthly_revenue"),
      mockEntry("tw_institutional_buysell"),
      mockEntry("tw_margin_short"),
      mockEntry("market_overview")
    );
    return {
      packId,
      tick,
      collectedAt,
      tradingDate,
      sources,
      trailComplete: false
    };
  }

  const db = getDb();
  if (!db) {
    const errEntry = (source: string): SourcePackEntry => ({
      source,
      status: "ERROR",
      rowCount: null,
      latestDate: null,
      note: "db_unavailable",
      sampleRows: null
    });
    sources.push(
      errEntry("companies_ohlcv"),
      errEntry("tw_monthly_revenue"),
      errEntry("tw_institutional_buysell"),
      errEntry("tw_margin_short"),
      errEntry("market_overview")
    );
    return { packId, tick, collectedAt, tradingDate, sources, trailComplete: false };
  }

  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - STALE_DAYS_THRESHOLD);

  // 1. OHLCV daily (companies_ohlcv)
  try {
    const ohlcvRows = await db.execute(
      drizzleSql`SELECT COUNT(*) AS cnt, MAX(dt) AS latest FROM companies_ohlcv WHERE workspace_id = ${workspaceId}`
    );
    const ohlcvRow = (ohlcvRows as { rows?: Array<{ cnt?: string | number; latest?: string }> }).rows?.[0];
    const ohlcvCount = ohlcvRow ? Number(ohlcvRow.cnt ?? 0) : 0;
    const ohlcvLatest = ohlcvRow?.latest ?? null;
    const ohlcvStatus: SourceStatus =
      ohlcvCount === 0
        ? "EMPTY"
        : ohlcvLatest && new Date(ohlcvLatest) < staleThreshold
        ? "STALE"
        : "LIVE";
    // Fetch up to 3 recent rows as real row sample for RAG cross-validation
    let ohlcvSampleRows: Record<string, unknown>[] | null = null;
    if (ohlcvCount > 0) {
      try {
        const sampleRes = await db.execute(
          drizzleSql`SELECT ticker, dt, open, high, low, close, volume FROM companies_ohlcv WHERE workspace_id = ${workspaceId} ORDER BY dt DESC LIMIT 3`
        );
        ohlcvSampleRows = ((sampleRes as { rows?: Record<string, unknown>[] }).rows ?? []);
      } catch {
        // sample fetch failure is non-fatal — leave null
      }
    }
    sources.push({
      source: "companies_ohlcv",
      status: ohlcvStatus,
      rowCount: ohlcvCount,
      latestDate: ohlcvLatest,
      note: null,
      sampleRows: ohlcvSampleRows
    });
  } catch (e) {
    sources.push({
      source: "companies_ohlcv",
      status: "ERROR",
      rowCount: null,
      latestDate: null,
      note: e instanceof Error ? e.message.slice(0, 100) : "unknown_error",
      sampleRows: null
    });
  }

  // 2. Monthly revenue (tw_monthly_revenue — DEGRADED OK)
  await collectTableSource(db, sources, "tw_monthly_revenue", workspaceId, staleThreshold, 30);

  // 3. Institutional flow (tw_institutional_buysell — DEGRADED OK)
  await collectTableSource(db, sources, "tw_institutional_buysell", workspaceId, staleThreshold, 5);

  // 4. Margin/short (tw_margin_short — DEGRADED OK)
  await collectTableSource(db, sources, "tw_margin_short", workspaceId, staleThreshold, 5);

  // 5. Market overview (no dedicated table — derive from daily_briefs recency)
  try {
    const briefRows = await db
      .select({ id: dailyBriefs.id, date: dailyBriefs.date })
      .from(dailyBriefs)
      .where(eq(dailyBriefs.workspaceId, workspaceId))
      .orderBy(desc(dailyBriefs.date))
      .limit(1);

    const latestBrief = briefRows[0];
    const overviewStatus: SourceStatus = latestBrief ? "LIVE" : "EMPTY";
    sources.push({
      source: "market_overview",
      status: overviewStatus,
      rowCount: latestBrief ? 1 : 0,
      latestDate: latestBrief?.date ?? null,
      note: null,
      sampleRows: null  // market_overview derives from brief recency; no raw row sample applicable
    });
  } catch (e) {
    sources.push({
      source: "market_overview",
      status: "ERROR",
      rowCount: null,
      latestDate: null,
      note: e instanceof Error ? e.message.slice(0, 100) : "unknown_error",
      sampleRows: null
    });
  }

  // Trail complete: all required sources are LIVE, DEGRADED, or STALE (not ERROR/EMPTY/MISSING/BLOCKED)
  const REQUIRED_SOURCES = ["companies_ohlcv"];
  const DEGRADED_OK_SOURCES = [
    "tw_monthly_revenue",
    "tw_institutional_buysell",
    "tw_margin_short",
    "market_overview"
  ];
  const trailComplete =
    REQUIRED_SOURCES.every((s) => {
      const entry = sources.find((e) => e.source === s);
      return entry && (entry.status === "LIVE" || entry.status === "STALE");
    }) &&
    DEGRADED_OK_SOURCES.every((s) => {
      const entry = sources.find((e) => e.source === s);
      return (
        entry &&
        (entry.status === "LIVE" ||
          entry.status === "STALE" ||
          entry.status === "DEGRADED" ||
          entry.status === "EMPTY")
      );
    });

  return { packId, tick, collectedAt, tradingDate, sources: filterSourcePackEntries(sources), trailComplete };
}

/**
 * F1 fix (Pete BLOCK#5 followup): strip source pack entries whose name or note
 * contains BROKEN/ORPHAN/DEPRECATED metadata tokens. These tokens come from
 * theme-registry names that were never cleaned up in the DB and must not leak
 * into brief generator instructions or content. The AI reviewer should not be
 * responsible for this cleanup — filter upstream before sources enter the generator.
 */
const NON_PRODUCTION_SOURCE_PATTERN = /\[(?:BROKEN(?:-\d+)?|DEPRECATED|ORPHAN)\]|\bplaceholder\b|\bto\s+fix\b/i;

/**
 * RED-2 fix (Pete BG audit 2026-05-07): exported pattern so the gate function and
 * the output sanitizer can both use the same token set without duplication.
 * Tests reference this directly to verify the pattern catches all relevant token forms.
 */
export const BROKEN_TOKEN_PATTERN = /\[(?:BROKEN(?:-\d+)?|DEPRECATED|ORPHAN)\]/i;

export function filterSourcePackEntries(sources: SourcePackEntry[]): SourcePackEntry[] {
  return sources.filter((entry) => {
    const searchable = `${entry.source} ${entry.note ?? ""}`;
    return !NON_PRODUCTION_SOURCE_PATTERN.test(searchable);
  });
}

async function collectTableSource(
  db: NonNullable<ReturnType<typeof getDb>>,
  sources: SourcePackEntry[],
  tableName: string,
  workspaceId: string,
  staleThreshold: Date,
  staleThresholdDays: number
) {
  try {
    // Raw SQL to avoid requiring schema table references for DRAFT tables
    const rows = await db.execute(
      drizzleSql.raw(`SELECT COUNT(*) AS cnt, MAX(date) AS latest FROM ${tableName} WHERE stock_id IN (SELECT ticker FROM companies WHERE workspace_id = '${workspaceId}') LIMIT 1`)
    );
    const row = (rows as { rows?: Array<{ cnt?: string | number; latest?: string }> }).rows?.[0];
    const count = row ? Number(row.cnt ?? 0) : 0;
    const latest = row?.latest ?? null;
    const adjustedThreshold = new Date();
    adjustedThreshold.setDate(adjustedThreshold.getDate() - staleThresholdDays);
    const status: SourceStatus =
      count === 0
        ? "EMPTY"
        : latest && new Date(latest) < adjustedThreshold
        ? "STALE"
        : "LIVE";
    // Fetch up to 3 recent rows as real row sample for RAG cross-validation (non-fatal if fails)
    let sampleRows: Record<string, unknown>[] | null = null;
    if (count > 0) {
      try {
        const sampleRes = await db.execute(
          drizzleSql.raw(`SELECT * FROM ${tableName} WHERE stock_id IN (SELECT ticker FROM companies WHERE workspace_id = '${workspaceId}') ORDER BY date DESC LIMIT 3`)
        );
        sampleRows = ((sampleRes as { rows?: Record<string, unknown>[] }).rows ?? []);
      } catch {
        // sample fetch failure is non-fatal
      }
    }
    sources.push({
      source: tableName,
      status,
      rowCount: count,
      latestDate: latest,
      note: null,
      sampleRows
    });
  } catch {
    // Table may not exist (DRAFT migration not promoted) — mark DEGRADED (not ERROR)
    sources.push({
      source: tableName,
      status: "DEGRADED",
      rowCount: null,
      latestDate: null,
      note: "table_not_found_or_draft_not_promoted",
      sampleRows: null
    });
  }
}

// ── Generator ─────────────────────────────────────────────────────────────────

async function generateDailyBrief(
  workspaceSlug: string,
  sourcePack: SourcePack
): Promise<{ jobId: string } | null> {
  const sourcesSummary = sourcePack.sources
    .map((s) => `  - ${s.source}: ${s.status} (rows=${s.rowCount ?? "n/a"}, latestDate=${s.latestDate ?? "n/a"})`)
    .join("\n");

  const instructions = `Generate a structured daily brief for Taiwan stock market date ${sourcePack.tradingDate}.
Tick context: ${sourcePack.tick}.
Source pack ID: ${sourcePack.packId}.
Trail complete: ${sourcePack.trailComplete}.

Available data sources:
${sourcesSummary}

Rules (STRICT — any violation → reject):
- Do NOT generate buy/sell/進場/賣出/買進/出脫 recommendations.
- Do NOT include price targets (目標價) or guarantees (必賺/保證).
- Do NOT hallucinate news events without source URLs.
- Mark each section clearly if data was MISSING/DEGRADED.
- date field MUST equal "${sourcePack.tradingDate}".
- Each section body MUST be >= 50 characters.
- Only reference data that exists in the source pack above.
- NEVER include metadata tokens such as [BROKEN-N], [DEPRECATED], [ORPHAN], or [placeholder] in any output field. These are internal DB maintenance markers and must not appear in published content.

Output schema: daily_brief_v1`;

  try {
    const job = await enqueueOpenAliceJob({
      workspaceSlug,
      taskType: "daily_brief",
      schemaName: "daily_brief_v1",
      instructions,
      contextRefs: [
        { type: "source_pack", id: sourcePack.packId },
        { type: "trading_date", id: sourcePack.tradingDate },
        { type: "tick", id: sourcePack.tick }
      ],
      parameters: {
        sourcePack: {
          packId: sourcePack.packId,
          tick: sourcePack.tick,
          tradingDate: sourcePack.tradingDate,
          trailComplete: sourcePack.trailComplete,
          sources: sourcePack.sources
        }
      }
    });

    // Gap 2 fix: register sourcePackSummary so adversarial reviewer can use it for Category C bias detection
    const summary = sourcePack.sources
      .map((s) => `${s.source}(${s.status})`)
      .join(", ");
    registerJobSourcePackSummary(job.jobId, summary);

    // Layer 5 fix (Pete audit 2026-05-08): register full SourcePack so factual reviewer
    // receives real sampleRows instead of null. loadSourcePackForDraft() looks this up
    // by sourceJobId at evaluatePipelinePublishGate call-site in openalice-ai-reviewer.ts.
    registerJobSourcePack(job.jobId, sourcePack);

    return { jobId: job.jobId };
  } catch (e) {
    console.error("[pipeline] enqueueOpenAliceJob failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ── Publisher gate ────────────────────────────────────────────────────────────

export type PublishGateTier = "green" | "yellow" | "red";
export type PublishGateResult =
  | { tier: "green"; action: "published"; briefId: string }
  | { tier: "yellow"; action: "queued_for_review"; reason: string }
  | { tier: "red"; action: "rejected"; reason: string }
  | { tier: "green"; action: "skipped_no_draft" };

/**
 * Classify draft payload into Green/Yellow/Red tier.
 * Red: buy/sell/target/guarantee/Sharpe keywords.
 * Yellow: strategy/ranking/metrics content (conservative).
 * Green: passes all checks.
 */
export function classifyDraftTier(payload: unknown): PublishGateTier {
  const text = JSON.stringify(payload ?? "").toLowerCase();
  const policyText = text
    .replace(/taiwanstockinstitutionalinvestorsbuysell/g, "institutional_flow_dataset")
    .replace(/tw_institutional_buysell/g, "institutional_flow_dataset")
    .replace(/institutional buy\/sell/g, "institutional_flow_dataset")
    .replace(/foreign investor buy\/sell/g, "institutional_flow_dataset")
    // F2 fix (Pete BLOCK#5 followup): normalize Chinese institutional source labels so that
    // factual descriptions like "外資連續3日買進" or "投信賣出科技股" are not misclassified
    // as action advice. These labels describe historical data flow (source labels), not trade
    // recommendations. The regex allows intervening characters between the institution name and
    // the buy/sell verb (e.g. "外資連續3日買進", "外資買超", "投信買進台積電").
    .replace(/外資.{0,12}(?:買進|賣出|買超|賣超|買入|出脫)/g, "institutional_flow_data")
    .replace(/投信.{0,12}(?:買進|賣出|買超|賣超|買入|出脫)/g, "institutional_flow_data")
    .replace(/自營商.{0,12}(?:買進|賣出|買超|賣超|買入|出脫)/g, "institutional_flow_data")
    .replace(/法人.{0,12}(?:買進|賣出|買超|賣超|買入|出脫)/g, "institutional_flow_data")
    .replace(/三大法人.{0,20}(?:買進|賣出|買超|賣超|淨買超|淨賣超)/g, "institutional_flow_data")
    .replace(/\bbuy\/sell\b/g, "flow_dataset")
    .replace(/\bbuy\b/g, "data_buy")
    .replace(/\bsell\b/g, "data_sell");

  // English action advice patterns: run on raw text (buy/sell not yet neutralized).
  const englishAdvicePatterns = [
    /\b(?:you should|should|recommend(?:ed)? to|recommendation[:\s-]*)\s+(?:buy|sell)\b/,
    /\b(?:buy|sell)\b.{0,40}\b(?:now|immediately|before earnings|your positions)\b/
  ];
  for (const p of englishAdvicePatterns) {
    if (p.test(text)) {
      return "red";
    }
  }

  // Chinese action advice patterns: run on policyText (institutional labels already normalized).
  // This prevents "外資連續3日買進" (institutional source data) from triggering a false positive
  // while still catching "建議買進" / "買進 訊號" type action advice patterns.
  const chineseAdvicePatterns = [
    /(建議|應該|可以|請|立刻|現在|操作上|策略上).{0,20}(買進|買入|賣出|出脫|進場|加碼|減碼|做多|做空)/,
    /(買進|買入|賣出|出脫|進場|加碼|減碼|做多|做空).{0,20}(建議|訊號|操作|目標價)/
  ];
  for (const p of chineseAdvicePatterns) {
    if (p.test(policyText)) {
      return "red";
    }
  }

  const redSemanticPatterns = [
    /(?:target price|price target)\s*[=:：]?\s*\d+(?:\.\d+)?/,
    /(目標價|預測股價).{0,12}\d+(?:\.\d+)?/,
    /(guarantee|guaranteed profit|保證獲利|必漲|穩賺)/,
    /sharpe ratio\s*[=:>]\s*[\d.]+/,
    /(勝率|win rate)\s*[=:：>]?\s*[\d.]+/
  ];
  for (const p of redSemanticPatterns) {
    if (p.test(policyText)) {
      return "red";
    }
  }

  // Red tier keywords
  // Pete PR #230 F3 fix: 勝率 (win rate) added — was missing from red-tier classifier
  const redPatterns = [
    /buy\b/, /sell\b/, /進場/, /賣出/, /買進/, /出脫/,
    /目標價/, /target price/, /price target/,
    /guarantee/, /必賺/, /保證/, /翻倍/,
    /sharpe ratio\s*[=:>]\s*[\d.]+/,
    /勝率/, /win rate\s*[=:>]\s*[\d.]+/
  ];
  for (const p of redPatterns) {
    if (p.test(policyText)) {
      return "red";
    }
  }

  // Yellow tier (advisory — may contain strategy/ranking)
  const yellowPatterns = [
    /ranking/, /rank \d/, /strategy/, /策略/, /排名/, /metrics/
  ];
  for (const p of yellowPatterns) {
    if (p.test(text)) {
      return "yellow";
    }
  }

  return "green";
}

/**
 * Apply publisher gate after AI reviewer verdict.
 * Returns an action to take on the draft.
 */
export function evaluatePublishGate(input: {
  sourcePack: SourcePack;
  reviewerVerdict: "approve" | "reject" | "manual_review" | null;
  confidence: number | null;
  flaggedIssueCount: number;
  draftPayload: unknown;
}): { tier: PublishGateTier; shouldAutoPublish: boolean; rejectReason: string | null } {
  const tier = classifyDraftTier(input.draftPayload);

  // Red tier: always reject regardless of AI verdict
  if (tier === "red") {
    return {
      tier: "red",
      shouldAutoPublish: false,
      rejectReason: "red_tier_content_detected: buy/sell/target/guarantee/Sharpe"
    };
  }

  // Yellow tier: queue for human review, never auto-publish
  if (tier === "yellow") {
    return {
      tier: "yellow",
      shouldAutoPublish: false,
      rejectReason: null
    };
  }

  // Green tier: require all gate conditions
  const gatePass =
    input.sourcePack.trailComplete &&
    input.reviewerVerdict === "approve" &&
    (input.confidence ?? 0) >= 0.7 &&
    input.flaggedIssueCount === 0;

  return {
    tier: "green",
    shouldAutoPublish: gatePass,
    rejectReason: gatePass
      ? null
      : buildGateFailReason(input.sourcePack, input.reviewerVerdict, input.confidence, input.flaggedIssueCount)
  };
}

function buildGateFailReason(
  sourcePack: SourcePack,
  verdict: "approve" | "reject" | "manual_review" | null,
  confidence: number | null,
  flaggedIssueCount: number
): string {
  const reasons: string[] = [];
  if (!sourcePack.trailComplete) reasons.push("source_trail_incomplete");
  if (verdict !== "approve") reasons.push(`reviewer_verdict=${verdict ?? "null"}`);
  if ((confidence ?? 0) < 0.7) reasons.push(`confidence=${confidence ?? 0}<0.7`);
  if (flaggedIssueCount > 0) reasons.push(`flagged_issues=${flaggedIssueCount}`);
  return reasons.join("; ");
}

// ── Audit log writer ──────────────────────────────────────────────────────────

async function writePipelineAuditLog(input: {
  workspaceId: string;
  result: PipelineRunResult;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(auditLogs).values({
      workspaceId: input.workspaceId,
      actorId: null,
      action: "openalice_pipeline.run",
      entityType: "pipeline_run",
      entityId: input.result.runId,
      payload: {
        tick: input.result.tick,
        tradingDate: input.result.tradingDate,
        skippedReason: input.result.skippedReason,
        sourcePackCount: input.result.sourcePack?.sources.length ?? 0,
        trailComplete: input.result.sourcePack?.trailComplete ?? false,
        draftId: input.result.draftId,
        reviewerVerdict: input.result.reviewerVerdict,
        confidence: input.result.confidence,
        publishedBriefId: input.result.publishedBriefId,
        totalCostUsd: input.result.totalCostUsd,
        durationMs: input.result.durationMs,
        error: input.result.error
      }
    });
  } catch (e) {
    console.warn(
      "[pipeline] audit log write failed:",
      e instanceof Error ? e.message : String(e)
    );
  }
}

// ── Main pipeline runner ──────────────────────────────────────────────────────

/**
 * Run one pipeline tick. Called by scheduler or admin trigger.
 * Never throws — all errors are contained and surfaced via _lastPipelineState.
 */
export async function runPipelineTick(
  tick: SourcePack["tick"],
  workspaceSlug: string,
  options?: {
    /**
     * Override the trading date (YYYY-MM-DD) for catch-up / manual fire.
     * When set, ALSO bypasses the isTwTradingDay check so Owner can force-generate
     * a brief for a specific date (e.g., Friday that was missed due to deploys).
     */
    forceDate?: string;
  }
): Promise<PipelineRunResult> {
  const runId = randomUUID();
  const startMs = Date.now();
  const now = new Date();
  // forceDate: allow manual fire for a specific trading date (e.g., missed Friday)
  const tradingDate = options?.forceDate ?? getTaipeiDate(now);

  const baseResult = (): PipelineRunResult => ({
    runId,
    tick,
    tradingDate,
    skippedReason: null,
    sourcePack: null,
    jobId: null,
    draftId: null,
    reviewerVerdict: null,
    confidence: null,
    publishedBriefId: null,
    totalCostUsd: null,
    durationMs: Date.now() - startMs,
    error: null
  });

  updatePipelineState({
    lastRunAt: now.toISOString(),
    lastTick: tick,
    lastTradingDate: tradingDate,
    totalRunsThisProcess: _lastPipelineState.totalRunsThisProcess + 1
  });

  // 1. Trading day check
  // forceDate bypasses this check — Owner explicitly requested a specific date.
  if (!options?.forceDate) {
    const isTradingDay = await isTwTradingDay(tradingDate);
    if (!isTradingDay) {
      const result: PipelineRunResult = {
        ...baseResult(),
        skippedReason: "not_a_trading_day",
        durationMs: Date.now() - startMs
      };
      updatePipelineState({ lastResult: result });
      console.log(`[pipeline] tick=${tick} date=${tradingDate} SKIPPED: not_a_trading_day`);
      return result;
    }
  } else {
    console.log(`[pipeline] tick=${tick} date=${tradingDate} forceDate=true (trading day check bypassed)`);
  }

  // 2. Resolve workspace
  if (!isDatabaseMode()) {
    const result: PipelineRunResult = {
      ...baseResult(),
      skippedReason: "memory_mode_no_db",
      durationMs: Date.now() - startMs
    };
    updatePipelineState({ lastResult: result, lastFailureReason: "memory_mode_no_db" });
    return result;
  }

  const db = getDb();
  if (!db) {
    const result: PipelineRunResult = {
      ...baseResult(),
      error: "db_unavailable",
      durationMs: Date.now() - startMs
    };
    updatePipelineState({ lastResult: result, lastFailureReason: "db_unavailable" });
    return result;
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1)
    .catch(() => [undefined]);

  if (!workspace) {
    const result: PipelineRunResult = {
      ...baseResult(),
      error: `workspace_not_found:${workspaceSlug}`,
      durationMs: Date.now() - startMs
    };
    updatePipelineState({ lastResult: result, lastFailureReason: result.error });
    return result;
  }

  // 2b. Dedup check — skip if a published/approved brief already exists for today's date.
  // Applies on both normal and forceDate runs to prevent duplicate content.
  // forceDate can still override by passing forceDate with allowDuplicate=true (reserved for future).
  if (!options?.forceDate) {
    // Normal run: skip if brief already published today
    try {
      const existingBriefs = await db
        .select({ id: dailyBriefs.id })
        .from(dailyBriefs)
        .where(
          and(
            eq(dailyBriefs.workspaceId, workspace.id),
            eq(dailyBriefs.date, tradingDate)
          )
        )
        .limit(1);
      if (existingBriefs.length > 0) {
        const result: PipelineRunResult = {
          ...baseResult(),
          skippedReason: `brief_already_exists_for_date:${tradingDate}`,
          durationMs: Date.now() - startMs
        };
        updatePipelineState({ lastResult: result });
        console.log(`[pipeline] tick=${tick} date=${tradingDate} SKIPPED: brief_already_exists`);
        return result;
      }
    } catch {
      // DB check failed — proceed anyway (non-fatal dedup, better than blocking)
    }
  }

  // 3. Source pack collection
  let sourcePack: SourcePack;
  try {
    sourcePack = await collectSourcePack(workspace.id, tick, tradingDate);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const result: PipelineRunResult = {
      ...baseResult(),
      error: `source_pack_collection_failed: ${errMsg}`,
      durationMs: Date.now() - startMs
    };
    updatePipelineState({ lastResult: result, lastFailureReason: result.error });
    await writePipelineAuditLog({ workspaceId: workspace.id, result });
    return result;
  }

  updatePipelineState({ sourcePackCount: sourcePack.sources.length });

  // 4. Generator — enqueue OpenAlice job
  const genResult = await generateDailyBrief(workspaceSlug, sourcePack);
  if (!genResult) {
    const result: PipelineRunResult = {
      ...baseResult(),
      sourcePack,
      error: "generator_enqueue_failed",
      durationMs: Date.now() - startMs
    };
    updatePipelineState({
      lastResult: result,
      lastFailureReason: "generator_enqueue_failed",
      lastGeneratedAt: null
    });
    await writePipelineAuditLog({ workspaceId: workspace.id, result });
    return result;
  }

  const generatedAt = new Date().toISOString();
  updatePipelineState({ lastGeneratedAt: generatedAt });
  console.log(
    `[pipeline] tick=${tick} date=${tradingDate} jobId=${genResult.jobId} job_enqueued`
  );

  // 5. AI reviewer fires asynchronously from submitOpenAliceResult → fireAiReviewerForDraft.
  //    Pipeline records job enqueued; actual review + publish gate fires when runner calls
  //    /api/v1/openalice/jobs/:id/result (existing endpoint, PR #218 already wired).
  //    The pipeline audit log captures the enqueue event; post-review publish gate is
  //    handled in submitOpenAliceResult (see server.ts patching in registerPipelinePublishGate).

  const result: PipelineRunResult = {
    ...baseResult(),
    sourcePack,
    jobId: genResult.jobId,
    durationMs: Date.now() - startMs
  };

  updatePipelineState({ lastResult: result });
  await writePipelineAuditLog({ workspaceId: workspace.id, result });

  console.log(
    `[pipeline] tick=${tick} date=${tradingDate} jobId=${genResult.jobId} ` +
    `sources=${sourcePack.sources.length} trailComplete=${sourcePack.trailComplete} done`
  );

  return result;
}

// ── Publish gate integration (called from content-draft approve path) ─────────

/**
 * Evaluate and apply the publisher gate after AI reviewer completes.
 * Called non-blocking from fireAiReviewerForDraft hook.
 *
 * This function reads the AI review audit log for the draft, then
 * decides whether to auto-publish, queue, or reject.
 */
export async function evaluatePipelinePublishGate(
  draftId: string,
  sourcePack: SourcePack | null
): Promise<{
  action: "published" | "queued_for_review" | "rejected" | "skipped";
  briefId: string | null;
  reason: string | null;
}> {
  if (!isDatabaseMode()) return { action: "skipped", briefId: null, reason: "memory_mode" };
  const db = getDb();
  if (!db) return { action: "skipped", briefId: null, reason: "db_unavailable" };

  // Load draft
  const [draft] = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.id, draftId))
    .limit(1)
    .catch(() => [undefined]);

  if (!draft) return { action: "skipped", briefId: null, reason: "draft_not_found" };
  if (draft.status !== "awaiting_review") {
    return { action: "skipped", briefId: null, reason: `status=${draft.status}` };
  }

  // Load latest AI reviewer audit log for this draft
  const auditRows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityId, draftId),
        eq(auditLogs.entityType, "content_draft")
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1)
    .catch(() => [] as typeof auditLogs.$inferSelect[]);

  const auditRow = auditRows[0];
  const auditPayload =
    auditRow?.payload &&
    typeof auditRow.payload === "object" &&
    !Array.isArray(auditRow.payload)
      ? (auditRow.payload as Record<string, unknown>)
      : null;

  const verdict =
    auditPayload?.verdict === "approve" ||
    auditPayload?.verdict === "reject" ||
    auditPayload?.verdict === "manual_review"
      ? (auditPayload.verdict as "approve" | "reject" | "manual_review")
      : null;
  const confidence = typeof auditPayload?.confidence === "number" ? auditPayload.confidence : null;
  const flaggedIssueCount = Array.isArray(auditPayload?.flagged_issues)
    ? (auditPayload.flagged_issues as unknown[]).length
    : 0;

  // Use a minimal fallback source pack if none provided
  const effectivePack: SourcePack = sourcePack ?? {
    packId: "fallback",
    tick: "close_brief",
    collectedAt: new Date().toISOString(),
    tradingDate: getTaipeiDate(),
    sources: [],
    trailComplete: false
  };

  const gate = evaluatePublishGate({
    sourcePack: effectivePack,
    reviewerVerdict: verdict,
    confidence,
    flaggedIssueCount,
    draftPayload: draft.payload
  });

  if (gate.tier === "red") {
    // Force reject
    try {
      const { rejectContentDraft } = await import("./content-draft-store.js");
      await rejectContentDraft({
        draftId,
        reviewerId: null,
        reason: `[pipeline-gate] ${gate.rejectReason ?? "red_tier"}`
      });
    } catch {
      // Non-critical
    }
    return {
      action: "rejected",
      briefId: null,
      reason: gate.rejectReason
    };
  }

  if (gate.tier === "yellow" || !gate.shouldAutoPublish) {
    // Leave in awaiting_review for human
    return {
      action: "queued_for_review",
      briefId: null,
      reason: gate.rejectReason ?? "yellow_tier_or_gate_conditions_not_met"
    };
  }

  // ── Gap 3 / RED-2: BROKEN/DEPRECATED token output scan ─────────────────────
  // Scans the fully-generated draft payload for leaked [BROKEN-N], [DEPRECATED],
  // or [ORPHAN] metadata tokens before auto-publish. These tokens originate in
  // stale DB theme names and can be mirrored into LLM output even when filtered
  // from the source pack input (two-layer defence: instruction-side + gate-side).
  // RED-2 fix: uses module-level BROKEN_TOKEN_PATTERN (not an inline redefinition)
  // so the same pattern is shared with tests and filterSourcePackEntries layer.
  const draftPayloadStr = JSON.stringify(draft.payload ?? "");
  if (BROKEN_TOKEN_PATTERN.test(draftPayloadStr)) {
    console.warn(
      `[pipeline-gate] Draft ${draftId} contains BROKEN/DEPRECATED metadata tokens — routing to awaiting_review`
    );
    return {
      action: "queued_for_review",
      briefId: null,
      reason: "broken_deprecated_token_in_content"
    };
  }

  // ── Hallucination RAG gate (BLOCK #6) ───────────────────────────────────────
  // Runs AFTER AI reviewer 7-hard-reject, BEFORE auto-publish.
  // HALLUCINATED         → force reject + audit_log HALLUCINATION_REJECT
  // PARTIAL + conf<0.7   → manual_review queue
  // OK or PARTIAL≥0.7    → pass through to auto-publish
  // ERROR                → safe-default: manual_review (block publish)
  const ragApiKey = process.env["OPENAI_API_KEY"];
  if (ragApiKey) {
    const draftContent =
      draft.payload &&
      typeof draft.payload === "object" &&
      !Array.isArray(draft.payload) &&
      "content" in draft.payload &&
      typeof (draft.payload as { content?: unknown }).content === "string"
        ? (draft.payload as { content: string }).content
        : null;

    if (draftContent) {
      try {
        const { runRagHallucinationCheck } = await import("./hallucination-rag.js");

        // Gap 1 fix: extract real rawSources from sourcePack instead of hardcoded []
        // Gap 3 fix (Pete BG audit): use real sampleRows for RAG content when available.
        // sampleRows = up to 3 actual DB rows fetched in collectSourcePack/collectTableSource.
        // Fallback to metadata-only when sampleRows is null (memory mode / table missing / DRAFT migration).
        // Cap at 3 rows to keep gpt-4.1 input token cost bounded.
        const rawSources = sourcePack
          ? sourcePack.sources.map((entry) => ({
              sourceId: entry.source,
              content: entry.sampleRows && entry.sampleRows.length > 0
                ? JSON.stringify(entry.sampleRows.slice(0, 3))
                : JSON.stringify({
                    status: entry.status,
                    rowCount: entry.rowCount,
                    latestDate: entry.latestDate,
                    note: entry.note
                  }),
              sha256: null,
              url: null
            }))
          : [];

        const ragResult = await runRagHallucinationCheck({
          apiKey: ragApiKey,
          content: draftContent,
          sourceTrail: sourcePack ? sourcePack.sources : null,
          rawSources, // Gap 1 fix: real sources enable 2-pass RAG (was always [] → single-pass fallback)
          claimExtractModel: process.env["OPENAI_CLAIM_EXTRACT_MODEL"] ?? "gpt-4o-mini",
          crossValidateModel: process.env["OPENAI_HALLUCINATION_VERIFY_MODEL"] ?? "gpt-4.1"
        });

        console.info(
          `[pipeline-gate] hallucination-RAG verdict=${ragResult.verdict} ` +
          `confidence=${ragResult.confidence.toFixed(2)} flags=${ragResult.flags.length} ` +
          `ragUsed=${ragResult.ragUsed} draftId=${draftId}`
        );

        if (ragResult.verdict === "HALLUCINATED") {
          // Force reject — write audit log
          try {
            const db2 = getDb();
            if (db2) {
              await db2.insert(auditLogs).values({
                workspaceId: draft.workspaceId,
                actorId: null,
                action: "hallucination_reject",
                entityId: draftId,
                entityType: "content_draft",
                payload: {
                  type: "HALLUCINATION_REJECT",
                  verdict: ragResult.verdict,
                  confidence: ragResult.confidence,
                  flags: ragResult.flags,
                  reasoning: ragResult.reasoning,
                  ragUsed: ragResult.ragUsed
                }
              });
            }
          } catch {
            // audit log failure is non-critical
          }
          try {
            const { rejectContentDraft } = await import("./content-draft-store.js");
            await rejectContentDraft({
              draftId,
              reviewerId: null,
              reason: `[hallucination-gate] HALLUCINATED confidence=${ragResult.confidence.toFixed(2)}`
            });
          } catch {
            // Non-critical
          }
          return {
            action: "rejected",
            briefId: null,
            reason: `hallucination_detected: confidence=${ragResult.confidence.toFixed(2)}`
          };
        }

        if (
          ragResult.verdict === "ERROR" ||
          (ragResult.verdict === "PARTIAL_HALLUCINATED" && ragResult.confidence < 0.7)
        ) {
          return {
            action: "queued_for_review",
            briefId: null,
            reason: `hallucination_gate_manual_review: verdict=${ragResult.verdict} confidence=${ragResult.confidence.toFixed(2)}`
          };
        }
        // OK or PARTIAL_HALLUCINATED with confidence>=0.7 → fall through to publish
      } catch (ragErr) {
        // RAG check threw unexpectedly — safe default: queue for human review
        console.warn(
          `[pipeline-gate] hallucination-RAG threw: ${ragErr instanceof Error ? ragErr.message : String(ragErr)}`
        );
        return {
          action: "queued_for_review",
          briefId: null,
          reason: `hallucination_gate_exception: ${ragErr instanceof Error ? ragErr.message : String(ragErr)}`
        };
      }
    }
  }
  // ── end hallucination RAG gate ───────────────────────────────────────────────

  // ── Factual reviewer gate (BLOCK #10) ────────────────────────────────────────
  // Runs AFTER hallucination RAG gate, BEFORE auto-publish.
  // Uses raw FinMind sampleRows (up to 3 per source) as ground-truth.
  // FACTUAL_FALSE  → force reject + audit_log type=content_draft.factual_reject
  // FACTUAL_DRIFT  → manual_review queue (same threshold as adversarial score>=7)
  // FACTUAL_OK     → pass through to auto-publish
  // null (skipped or error) → safe-default: pass through (never block on null)
  const factualApiKey = process.env["OPENAI_API_KEY"];
  if (factualApiKey) {
    const draftContentForFactual =
      draft.payload &&
      typeof draft.payload === "object" &&
      !Array.isArray(draft.payload) &&
      "content" in draft.payload &&
      typeof (draft.payload as { content?: unknown }).content === "string"
        ? (draft.payload as { content: string }).content
        : null;

    if (draftContentForFactual && sourcePack) {
      // Build raw sources — only entries with real sampleRows (arrays with length > 0)
      const factualRawSources = sourcePack.sources
        .filter((entry) => entry.sampleRows && entry.sampleRows.length > 0)
        .map((entry) => ({
          sourceId: entry.source,
          content: JSON.stringify((entry.sampleRows ?? []).slice(0, 3))
        }));

      try {
        const { runFactualReview } = await import("./openalice-factual-reviewer.js");
        const factualResult = await runFactualReview(
          draftContentForFactual,
          factualRawSources,
          draftId
        );

        if (factualResult) {
          console.info(
            `[pipeline-gate] factual-reviewer verdict=${factualResult.factualVerdict} ` +
            `flags=${factualResult.driftFlags.length} draftId=${draftId}`
          );

          if (factualResult.factualVerdict === "FACTUAL_FALSE") {
            // Force reject — write audit log
            try {
              const db3 = getDb();
              if (db3) {
                await db3.insert(auditLogs).values({
                  workspaceId: draft.workspaceId,
                  actorId: null,
                  action: "content_draft.factual_reject",
                  entityId: draftId,
                  entityType: "content_draft",
                  payload: {
                    type: "FACTUAL_FALSE_REJECT",
                    factualVerdict: factualResult.factualVerdict,
                    driftFlags: factualResult.driftFlags,
                    reasoning: factualResult.reasoning
                  }
                });
              }
            } catch {
              // audit log failure is non-critical
            }
            try {
              const { rejectContentDraft } = await import("./content-draft-store.js");
              await rejectContentDraft({
                draftId,
                reviewerId: null,
                reason: `[factual-gate] FACTUAL_FALSE: ${factualResult.driftFlags.join("; ")}`
              });
            } catch {
              // Non-critical
            }
            return {
              action: "rejected",
              briefId: null,
              reason: `factual_false_detected: ${factualResult.driftFlags.slice(0, 2).join("; ")}`
            };
          }

          if (factualResult.factualVerdict === "FACTUAL_DRIFT") {
            // Route to manual review — write audit log
            try {
              const db4 = getDb();
              if (db4) {
                await db4.insert(auditLogs).values({
                  workspaceId: draft.workspaceId,
                  actorId: null,
                  action: "content_draft.factual_reject",
                  entityId: draftId,
                  entityType: "content_draft",
                  payload: {
                    type: "FACTUAL_DRIFT_HOLD",
                    factualVerdict: factualResult.factualVerdict,
                    driftFlags: factualResult.driftFlags,
                    reasoning: factualResult.reasoning
                  }
                });
              }
            } catch {
              // audit log failure is non-critical
            }
            return {
              action: "queued_for_review",
              briefId: null,
              reason: `factual_drift_detected: ${factualResult.driftFlags.slice(0, 2).join("; ")}`
            };
          }
          // FACTUAL_OK → fall through to auto-publish
        }
        // null (skipped / no real rows / API error) → safe-default: fall through
      } catch (factualErr) {
        // Factual reviewer threw unexpectedly — safe-default: pass through (do not block publish)
        console.warn(
          `[pipeline-gate] factual-reviewer threw: ${factualErr instanceof Error ? factualErr.message : String(factualErr)}`
        );
        // Do NOT return here — let publish proceed
      }
    }
  }
  // ── end factual reviewer gate ─────────────────────────────────────────────────

  // Green + gate pass → auto-publish via approveContentDraft
  try {
    const { approveContentDraft } = await import("./content-draft-store.js");
    const approveResult = await approveContentDraft({ draftId, reviewerId: null });
    if ("error" in approveResult) {
      return { action: "queued_for_review", briefId: null, reason: `approve_failed:${approveResult.error}` };
    }
    updatePipelineState({
      lastPublishedAt: new Date().toISOString(),
      reviewerVerdict: verdict
    });
    console.info(`[pipeline-gate] Draft ${draftId} AUTO-PUBLISHED briefId=${approveResult.approvedRefId}`);
    return { action: "published", briefId: approveResult.approvedRefId, reason: null };
  } catch (e) {
    return {
      action: "queued_for_review",
      briefId: null,
      reason: `publish_exception:${e instanceof Error ? e.message : String(e)}`
    };
  }
}

// ── Batch reviewer ────────────────────────────────────────────────────────────

export type BatchReviewerResult = {
  processed: number;
  approved: number;
  rejected: number;
  manual: number;
  errors: number;
};

const MAX_BATCH_CONCURRENT = 10;

/**
 * Batch-fire AI reviewer for awaiting_review drafts.
 * Used by POST /api/v1/internal/openalice/ai-reviewer/run-batch.
 */
export async function runBatchAiReviewer(input: {
  taskType?: string;
  limit?: number;
  dryRun?: boolean;
}): Promise<BatchReviewerResult> {
  const result: BatchReviewerResult = {
    processed: 0,
    approved: 0,
    rejected: 0,
    manual: 0,
    errors: 0
  };

  if (!isDatabaseMode()) return result;
  const db = getDb();
  if (!db) return result;

  const limit = Math.min(input.limit ?? 20, 50);

  const rows = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.status, "awaiting_review"))
    .orderBy(desc(contentDrafts.createdAt))
    .limit(limit)
    .catch(() => [] as typeof contentDrafts.$inferSelect[]);

  if (input.dryRun) {
    return { ...result, processed: rows.length };
  }

  // Process in chunks of MAX_BATCH_CONCURRENT
  for (let i = 0; i < rows.length; i += MAX_BATCH_CONCURRENT) {
    const chunk = rows.slice(i, i + MAX_BATCH_CONCURRENT);

    const outcomes = await Promise.allSettled(
      chunk.map(async (draft) => {
        await fireAiReviewerForDraft(draft.id);
        // Re-read draft status to determine outcome
        const [updated] = await db
          .select({ status: contentDrafts.status })
          .from(contentDrafts)
          .where(eq(contentDrafts.id, draft.id))
          .limit(1);
        return updated?.status ?? "unknown";
      })
    );

    for (const outcome of outcomes) {
      result.processed++;
      if (outcome.status === "fulfilled") {
        const status = outcome.value;
        if (status === "approved") result.approved++;
        else if (status === "rejected") result.rejected++;
        else if (status === "awaiting_review") result.manual++;
      } else {
        result.errors++;
      }
    }
  }

  return result;
}

// ── Scheduler tick helpers (called from startSchedulers) ─────────────────────

/**
 * Taipei HHMM 07:30 → 08:00: pre-market window.
 * Changed 2026-05-09 (was 08:30–09:00): 楊董 requires brief ready by 08:00 TST.
 */
function isPreMarketWindow(now: Date): boolean {
  const hhmm = getTaipeiHHMM(now);
  return hhmm >= 730 && hhmm < 800;
}

/**
 * Taipei HHMM 07:30 → 09:30: boot-recovery window.
 * Exported for startSchedulers boot-recovery path in server.ts.
 * If process boots between 07:30 and 09:30 TST and no brief exists for today,
 * fire the pipeline immediately (covers the 5/8 incident: process at 08:44 TST).
 */
export function isBriefBootRecoveryWindow(now: Date = new Date()): boolean {
  const hhmm = getTaipeiHHMM(now);
  return hhmm >= 730 && hhmm < 930;
}

/** Taipei HHMM 13:45 → 14:15: close-watch window */
function isCloseWatchWindow(now: Date): boolean {
  const hhmm = getTaipeiHHMM(now);
  return hhmm >= 1345 && hhmm < 1415;
}

/** Taipei HHMM 16:30 → 17:00: close-brief window */
function isCloseBriefWindow(now: Date): boolean {
  const hhmm = getTaipeiHHMM(now);
  return hhmm >= 1630 && hhmm < 1700;
}

export async function runPipelinePreMarketTick(workspaceSlug: string): Promise<void> {
  const now = new Date();
  if (!isPreMarketWindow(now)) {
    console.log("[pipeline-scheduler] pre_market skipped=outside_window");
    updatePipelineState({ nextRunAt: computeNextRunAt(now) });
    return;
  }
  const result = await runPipelineTick("pre_market", workspaceSlug).catch((e) => {
    console.error("[pipeline-scheduler] pre_market tick error:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (result) updatePipelineState({ nextRunAt: computeNextRunAt(new Date()) });
}

export async function runPipelinePreMarketBootRecovery(workspaceSlug: string): Promise<void> {
  const now = new Date();
  if (!isBriefBootRecoveryWindow(now)) {
    console.log("[pipeline-scheduler] boot_recovery skipped=outside_recovery_window");
    return;
  }
  console.log("[pipeline-scheduler] boot_recovery firing pre_market (recovery window 07:30–09:30 TST)");
  const result = await runPipelineTick("pre_market", workspaceSlug).catch((e: unknown) => {
    console.error("[pipeline-scheduler] boot_recovery error:", e instanceof Error ? e.message : String(e));
    return null;
  });
  if (result) {
    console.log(
      `[pipeline-scheduler] boot_recovery complete: publishedBriefId=${result.publishedBriefId ?? "n/a"} skippedReason=${result.skippedReason ?? "none"}`
    );
    updatePipelineState({ nextRunAt: computeNextRunAt(new Date()) });
  }
}

export async function runPipelineCloseWatchTick(workspaceSlug: string): Promise<void> {
  const now = new Date();
  if (!isCloseWatchWindow(now)) {
    console.log("[pipeline-scheduler] close_watch skipped=outside_window");
    return;
  }
  await runPipelineTick("close_watch", workspaceSlug).catch((e) => {
    console.error("[pipeline-scheduler] close_watch tick error:", e instanceof Error ? e.message : String(e));
  });
}

export async function runPipelineCloseBriefTick(workspaceSlug: string): Promise<void> {
  const now = new Date();
  if (!isCloseBriefWindow(now)) {
    console.log("[pipeline-scheduler] close_brief skipped=outside_window");
    return;
  }
  await runPipelineTick("close_brief", workspaceSlug).catch((e) => {
    console.error("[pipeline-scheduler] close_brief tick error:", e instanceof Error ? e.message : String(e));
  });
}

function computeNextRunAt(now: Date): string {
  // Pete PR #230 F1 fix: HHMM is encoded as decimal (0830/1345/1630),
  // simple subtraction (1345 - 1230 = 115) yields garbage — must convert to
  // real minutes-of-day first.
  const hhmmToMinutes = (hhmm: number): number => Math.floor(hhmm / 100) * 60 + (hhmm % 100);
  const nowMin = hhmmToMinutes(getTaipeiHHMM(now));
  // pre-market target updated to 07:30 (was 08:30 before 2026-05-09 timing fix)
  const targets = [730, 1345, 1630].map(hhmmToMinutes);
  let minutesToAdd: number;
  if (nowMin < targets[0]) minutesToAdd = targets[0] - nowMin;
  else if (nowMin < targets[1]) minutesToAdd = targets[1] - nowMin;
  else if (nowMin < targets[2]) minutesToAdd = targets[2] - nowMin;
  else minutesToAdd = 24 * 60 + targets[0] - nowMin; // next day pre-market

  const next = new Date(now.getTime() + minutesToAdd * 60 * 1000);
  return next.toISOString();
}

// Pete PR #230 F2 fix + Bruce F1 wiring helper:
// Exported so openalice-ai-reviewer can record verdict + update lastReviewedAt
// directly without re-invoking the full evaluatePipelinePublishGate flow.
// Also returns classifyDraftTier output for the caller to honor red-tier override.
export function recordReviewerVerdict(input: {
  payload: unknown;
  verdict: "approve" | "reject" | "manual_review";
}): { tier: PublishGateTier } {
  const tier = classifyDraftTier(input.payload);
  updatePipelineState({
    lastReviewedAt: new Date().toISOString(),
    reviewerVerdict: input.verdict
  });
  return { tier };
}

// ── Manual fire + catch-up ────────────────────────────────────────────────────

/**
 * Fire the pipeline for a specific trading date (Owner-only manual fire).
 * Bypasses window check and isTwTradingDay check.
 * Skips if a brief already exists for that date (dedup).
 * Does NOT skip the 5-layer review pipeline — all gates still run.
 */
export async function runPipelineForDate(
  workspaceSlug: string,
  date: string
): Promise<PipelineRunResult> {
  return runPipelineTick("pre_market", workspaceSlug, { forceDate: date });
}

/**
 * Boot catch-up: check if the last published brief is older than the most recent
 * trading day. If so, fire the pipeline for the missed date.
 *
 * Called once at startup (after 15s delay) to auto-recover from:
 *   - Deploy-interrupted brief windows (root cause of 5/8 miss)
 *   - Process crashes during pre-market window
 *
 * Only fires for the most recent missed trading day (not multi-day backfill).
 * Non-fatal: any error is logged and swallowed.
 */
export async function runPipelineMissedDayCatchUp(workspaceSlug: string): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;

  const now = new Date();
  const todayTST = getTaipeiDate(now);

  try {
    // Find the workspace
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, workspaceSlug))
      .limit(1)
      .catch(() => [undefined]);

    if (!workspace) {
      console.warn("[pipeline-catchup] workspace not found, skipping catch-up");
      return;
    }

    // Find most recent published brief date
    const latestBriefRows = await db
      .select({ date: dailyBriefs.date })
      .from(dailyBriefs)
      .where(eq(dailyBriefs.workspaceId, workspace.id))
      .orderBy(desc(dailyBriefs.date))
      .limit(1)
      .catch(() => [] as { date: string }[]);

    const lastBriefDate = latestBriefRows[0]?.date ?? null;

    // Find the most recent prior trading day (scan back up to 5 calendar days)
    let mostRecentTradingDay: string | null = null;
    for (let i = 1; i <= 5; i++) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() - i);
      const candidateDate = getTaipeiDate(candidate);
      const isTrading = await isTwTradingDay(candidateDate);
      if (isTrading) {
        mostRecentTradingDay = candidateDate;
        break;
      }
    }

    if (!mostRecentTradingDay) {
      console.log("[pipeline-catchup] no recent trading day found in 5-day window, skipping");
      return;
    }

    // If last brief is from the most recent trading day → nothing to catch up
    if (lastBriefDate && lastBriefDate >= mostRecentTradingDay) {
      console.log(`[pipeline-catchup] last brief date=${lastBriefDate} >= mostRecentTradingDay=${mostRecentTradingDay}, no catch-up needed`);
      return;
    }

    // Don't fire catch-up if it's a weekend and mostRecentTradingDay is "old" (>3 days)
    // to avoid generating a brief for an old trading day on long weekends
    const daysDiff = Math.round(
      (now.getTime() - new Date(mostRecentTradingDay + "T00:00:00+08:00").getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysDiff > 3) {
      console.log(`[pipeline-catchup] mostRecentTradingDay=${mostRecentTradingDay} is ${daysDiff} days ago (>3), skipping catch-up to avoid stale brief`);
      return;
    }

    // Don't fire catch-up if today IS a trading day and we're in pre-market window (cron will handle it)
    const isTodayTrading = await isTwTradingDay(todayTST);
    const hhmm = getTaipeiHHMM(now);
    if (isTodayTrading && hhmm >= 700 && hhmm < 900) {
      // Pre-market window — regular cron + boot recovery will handle today
      // Only catch up for yesterday if it was missed
      if (mostRecentTradingDay === todayTST) {
        console.log("[pipeline-catchup] today is trading day in pre-market window, skipping (regular cron will handle)");
        return;
      }
    }

    console.log(
      `[pipeline-catchup] CATCH-UP FIRE: lastBriefDate=${lastBriefDate ?? "none"} mostRecentTradingDay=${mostRecentTradingDay} — generating missed brief`
    );

    const result = await runPipelineForDate(workspaceSlug, mostRecentTradingDay).catch((e: unknown) => {
      console.error("[pipeline-catchup] catch-up fire error:", e instanceof Error ? e.message : String(e));
      return null;
    });

    if (result) {
      console.log(
        `[pipeline-catchup] catch-up complete: date=${mostRecentTradingDay} ` +
        `jobId=${result.jobId ?? "n/a"} skippedReason=${result.skippedReason ?? "none"} ` +
        `error=${result.error ?? "none"}`
      );
    }
  } catch (e) {
    console.error("[pipeline-catchup] unexpected error:", e instanceof Error ? e.message : String(e));
  }
}

// ── Observability additions (exported for server.ts extension) ────────────────

export function getPipelineObservabilityAddendum(): {
  lastGeneratedAt: string | null;
  lastReviewedAt: string | null;
  lastPublishedAt: string | null;
  nextRunAt: string | null;
  lastFailureReason: string | null;
  sourcePackCount: number;
  reviewerVerdict: "approve" | "reject" | "manual_review" | null;
} {
  return {
    lastGeneratedAt: _lastPipelineState.lastGeneratedAt,
    lastReviewedAt: _lastPipelineState.lastReviewedAt,
    lastPublishedAt: _lastPipelineState.lastPublishedAt,
    nextRunAt: _lastPipelineState.nextRunAt,
    lastFailureReason: _lastPipelineState.lastFailureReason,
    sourcePackCount: _lastPipelineState.sourcePackCount,
    reviewerVerdict: _lastPipelineState.reviewerVerdict
  };
}
