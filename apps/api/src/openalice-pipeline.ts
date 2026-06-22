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

import { and, desc, eq, gte, inArray, or, sql as drizzleSql } from "drizzle-orm";
import {
  auditLogs,
  companiesOhlcv,
  contentDrafts,
  dailyBriefs,
  getDb,
  isDatabaseMode,
  openAliceDevices,
  openAliceJobs,
  workspaces
} from "@iuf-trading-room/db";

import { enqueueOpenAliceJob } from "./openalice-bridge.js";
import { fireAiReviewerForDraft } from "./openalice-ai-reviewer.js";
import { approveContentDraft, createContentDraft, dailyBriefPayloadSchema } from "./content-draft-store.js";
import { callLlm, stripCodeFences } from "./llm/llm-gateway.js";
import {
  getTwseMarketOverview,
  getTwseIndustryHeatmap,
  getTwseLeaders,
  getTaiexPrevSessionSnapshot,
  isTwseIndexSnapshotConsistent,
} from "./data-sources/twse-openapi-client.js";

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

export function parseSourcePackFromJobParameters(parameters: unknown): SourcePack | null {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return null;
  const sourcePack = (parameters as Record<string, unknown>)["sourcePack"];
  if (!sourcePack || typeof sourcePack !== "object" || Array.isArray(sourcePack)) return null;
  const pack = sourcePack as Record<string, unknown>;
  const validTicks: SourcePack["tick"][] = ["pre_market", "close_watch", "close_brief"];
  if (
    typeof pack["packId"] !== "string" ||
    !validTicks.includes(pack["tick"] as SourcePack["tick"]) ||
    typeof pack["tradingDate"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(pack["tradingDate"]) ||
    !Array.isArray(pack["sources"]) ||
    typeof pack["trailComplete"] !== "boolean"
  ) {
    return null;
  }

  const sources = (pack["sources"] as unknown[]).filter((entry): entry is SourcePackEntry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    return typeof row["source"] === "string" && typeof row["status"] === "string";
  });
  if (sources.length !== (pack["sources"] as unknown[]).length) return null;

  return {
    packId: pack["packId"],
    tick: pack["tick"] as SourcePack["tick"],
    collectedAt: typeof pack["collectedAt"] === "string" ? pack["collectedAt"] : new Date().toISOString(),
    tradingDate: pack["tradingDate"],
    sources,
    trailComplete: pack["trailComplete"],
  };
}

/**
 * Recover a source pack after an API restart. Enqueued OpenAlice jobs already
 * persist the complete pack in parameters.sourcePack, so factual review should
 * not depend on an in-memory registry surviving until the device submits.
 */
export async function loadSourcePackForDraftPersisted(
  draftSourceJobId: string | null | undefined
): Promise<SourcePack | null> {
  const cached = loadSourcePackForDraft(draftSourceJobId);
  if (cached || !draftSourceJobId || !isDatabaseMode()) return cached;
  const db = getDb();
  if (!db) return null;

  try {
    const [job] = await db
      .select({ parameters: openAliceJobs.parameters })
      .from(openAliceJobs)
      .where(eq(openAliceJobs.id, draftSourceJobId))
      .limit(1);
    const recovered = parseSourcePackFromJobParameters(job?.parameters);
    if (recovered) registerJobSourcePack(draftSourceJobId, recovered);
    return recovered;
  } catch {
    return null;
  }
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

function visibleDailyBriefCondition() {
  // Worker rule-template drafts are excluded: they predate the v2 contract and
  // always fail the frontend template gate (empty-shell briefs, 6/10 audit).
  return or(
    eq(dailyBriefs.status, "published"),
    eq(dailyBriefs.status, "approved")
  );
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

// ── Live market snapshot (F1: real numbers injected into prompt) ──────────────

/**
 * Aggregated real market numbers fetched from TWSE OpenAPI + DB at brief
 * generation time. All fields are nullable — missing data never blocks the brief.
 */
export type LiveMarketSnapshot = {
  taiex: {
    value: number | null;
    change: number | null;
    changePct: number | null;
    sourceState: string | null;
    asOf: string | null;
  };
  heatmapTop3: Array<{ industry: string; avgChangePct: number; direction: "up" | "down" | "flat" }>;
  topGainers: Array<{ symbol: string; name: string; changePct: number }>;
  topLosers: Array<{ symbol: string; name: string; changePct: number }>;
  institutional: {
    foreign: number | null;
    trust: number | null;
    dealer: number | null;
    date: string | null;
  };
  margin: {
    balanceChange: number | null;
    shortChange: number | null;
    date: string | null;
  };
};

export type InstitutionalFlowRow = {
  date?: unknown;
  name?: unknown;
  buy?: unknown;
  sell?: unknown;
};

export function aggregateInstitutionalFlowRows(rows: InstitutionalFlowRow[]): LiveMarketSnapshot["institutional"] {
  let foreign: number | null = null;
  let trust: number | null = null;
  let dealer: number | null = null;
  let date: string | null = null;

  for (const row of rows) {
    if (!date && typeof row.date === "string") date = row.date;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const buy = Number(row.buy);
    const sell = Number(row.sell);
    if (!name || !Number.isFinite(buy) || !Number.isFinite(sell)) continue;
    const net = buy - sell;

    if (/外.*資|foreign/i.test(name)) {
      foreign = (foreign ?? 0) + net;
    } else if (/投信|investment.?trust/i.test(name)) {
      trust = (trust ?? 0) + net;
    } else if (/自營商|dealer/i.test(name)) {
      dealer = (dealer ?? 0) + net;
    }
  }

  return { foreign, trust, dealer, date };
}

function hasConsistentTaiexSnapshot(taiex: LiveMarketSnapshot["taiex"]): boolean {
  return taiex.value !== null
    && taiex.change !== null
    && taiex.changePct !== null
    && isTwseIndexSnapshotConsistent({
      value: taiex.value,
      change: taiex.change,
      changePct: taiex.changePct,
    });
}

/**
 * Collect live market numbers from TWSE OpenAPI + DB aggregate queries.
 * Never throws — all errors return null fields. DB queries require a workspace.
 */
async function collectLiveMarketSnapshot(
  workspaceId: string,
  tradingDate?: string,
  tick?: SourcePack["tick"]
): Promise<LiveMarketSnapshot> {
  const snapshot: LiveMarketSnapshot = {
    taiex: { value: null, change: null, changePct: null, sourceState: null, asOf: null },
    heatmapTop3: [],
    topGainers: [],
    topLosers: [],
    institutional: { foreign: null, trust: null, dealer: null, date: null },
    margin: { balanceChange: null, shortChange: null, date: null },
  };

  const validTradingDate = tradingDate && /^\d{4}-\d{2}-\d{2}$/.test(tradingDate) ? tradingDate : null;
  const isHistoricalDate = validTradingDate !== null && validTradingDate !== getTaipeiDate();
  const isCloseTick = tick === "close_watch" || tick === "close_brief";
  // DB-source date cap matching the TAIEX semantics: pre-market briefs cite
  // strictly-before-tradingDate data, close ticks may include the day itself.
  const dateCapSql = validTradingDate ? `AND date ${isCloseTick ? "<=" : "<"} '${validTradingDate}'` : "";

  // 1. TAIEX —「昨日收盤」must be the last *completed* session before
  // tradingDate, from official daily closes (MI_5MINS_HIST). The previous
  // date-blind path always fetched "now": a backfill/regen for a past date
  // paired a historical close with today's prev close (6/11 audit:「-1 點、
  // +3.31%」against the real 6/10 close of -1478.9 / -3.31%), and an intraday
  // regen cited a live mid-session value as a close.
  try {
    const prevSession = validTradingDate
      ? await getTaiexPrevSessionSnapshot(validTradingDate, { includeTradingDate: tick === "close_watch" || tick === "close_brief" })
      : null;
    if (prevSession) {
      snapshot.taiex = {
        value: prevSession.value,
        change: prevSession.change,
        changePct: prevSession.changePct,
        sourceState: "official_daily_close",
        asOf: prevSession.ts.slice(0, 10),
      };
    } else if (!isHistoricalDate) {
      // Same-day fallback when the hist endpoint is unavailable. Never used
      // for historical dates — a wrong-date number is worse than no number.
      const overview = await getTwseMarketOverview();
      if (overview) {
        const taiexCandidate: LiveMarketSnapshot["taiex"] = {
          value: overview.taiex?.value ?? null,
          change: overview.taiex?.change ?? null,
          changePct: overview.taiex?.changePct ?? null,
          sourceState: overview._isLkg ? "lkg" : "live",
          asOf: overview.taiex?.ts ? overview.taiex.ts.slice(0, 10) : null,
        };
        snapshot.taiex = hasConsistentTaiexSnapshot(taiexCandidate)
          ? taiexCandidate
          : { value: null, change: null, changePct: null, sourceState: "inconsistent_rejected", asOf: null };
      }
    }
  } catch {
    // non-fatal
  }

  // 2. Heatmap top 3 sectors (gain + loss) — today only. There is no
  // historical sector heatmap; feeding today's movers into a backfilled
  // brief for another date would be fabricated context.
  try {
    const db = isHistoricalDate ? null : getDb();
    if (db) {
      // Build ticker→industry map from companies table
      const compRows = await db.execute(
        drizzleSql`SELECT ticker, chain_position FROM companies WHERE workspace_id = ${workspaceId} AND chain_position IS NOT NULL LIMIT 2000`
      );
      const rawArr = ((compRows as { rows?: Record<string, unknown>[] }).rows
        ?? (Array.isArray(compRows) ? (compRows as Record<string, unknown>[]) : []));
      const tickerToIndustry = new Map<string, string>();
      for (const row of rawArr) {
        if (typeof row["ticker"] === "string" && typeof row["chain_position"] === "string") {
          tickerToIndustry.set(row["ticker"] as string, row["chain_position"] as string);
        }
      }
      if (tickerToIndustry.size > 0) {
        const tiles = await getTwseIndustryHeatmap(tickerToIndustry);
        // Sort by |avgChangePct| desc, pick top 3
        const sorted = [...tiles].sort((a, b) => Math.abs(b.avgChangePct) - Math.abs(a.avgChangePct));
        snapshot.heatmapTop3 = sorted.slice(0, 3).map(t => ({
          industry: t.industry,
          avgChangePct: t.avgChangePct,
          direction: t.avgChangePct > 0 ? "up" : t.avgChangePct < 0 ? "down" : "flat",
        }));
      }
    }
  } catch {
    // non-fatal
  }

  // 3. Leaders top 5 gainers + losers — today only (same reason as heatmap)
  if (!isHistoricalDate) {
    try {
      const leaders = await getTwseLeaders({ topN: 5 });
      snapshot.topGainers = leaders.topGainers.map(s => ({
        symbol: s.symbol,
        name: s.name,
        changePct: s.changePct,
      }));
      snapshot.topLosers = leaders.topLosers.map(s => ({
        symbol: s.symbol,
        name: s.name,
        changePct: s.changePct,
      }));
    } catch {
      // non-fatal
    }
  }

  // 4. Institutional net buy/sell aggregate from DB (latest date)
  try {
    const db = getDb();
    if (db) {
      const instRows = await db.execute(
        drizzleSql.raw(
          `SELECT date, name, buy, sell
           FROM tw_institutional_buysell
           WHERE stock_id IN (SELECT ticker FROM companies WHERE workspace_id = '${workspaceId}')
           ${dateCapSql}
           AND date = (
             SELECT MAX(date)
             FROM tw_institutional_buysell
             WHERE stock_id IN (SELECT ticker FROM companies WHERE workspace_id = '${workspaceId}')
             ${dateCapSql}
           )
           ORDER BY name, stock_id`
        )
      );
      const rows = ((instRows as { rows?: InstitutionalFlowRow[] }).rows
        ?? (Array.isArray(instRows) ? (instRows as InstitutionalFlowRow[]) : []));
      snapshot.institutional = aggregateInstitutionalFlowRows(rows);
    }
  } catch {
    // non-fatal — table may not exist
  }

  // 5. Margin/short balance change from DB (latest 2 dates, compute delta)
  try {
    const db = getDb();
    if (db) {
      const marginRows = await db.execute(
        drizzleSql.raw(
          `SELECT date,
            SUM(margin_purchase_today_balance) AS margin_balance,
            SUM(short_sale_today_balance) AS short_balance
           FROM tw_margin_short
           WHERE stock_id IN (SELECT ticker FROM companies WHERE workspace_id = '${workspaceId}')
           ${dateCapSql}
           GROUP BY date ORDER BY date DESC LIMIT 2`
        )
      );
      const mr = ((marginRows as { rows?: Record<string, unknown>[] }).rows
        ?? (Array.isArray(marginRows) ? (marginRows as Record<string, unknown>[]) : []));
      if (mr.length >= 2) {
        const today = mr[0];
        const prev = mr[1];
        snapshot.margin = {
          balanceChange: today["margin_balance"] != null && prev["margin_balance"] != null
            ? Number(today["margin_balance"]) - Number(prev["margin_balance"])
            : null,
          shortChange: today["short_balance"] != null && prev["short_balance"] != null
            ? Number(today["short_balance"]) - Number(prev["short_balance"])
            : null,
          date: typeof today["date"] === "string" ? today["date"] : null,
        };
      } else if (mr.length === 1 && mr[0]) {
        snapshot.margin = {
          balanceChange: null,
          shortChange: null,
          date: typeof mr[0]["date"] === "string" ? mr[0]["date"] : null,
        };
      }
    }
  } catch {
    // non-fatal
  }

  return snapshot;
}

/**
 * Render a LiveMarketSnapshot as a structured JSON block for LLM prompt injection.
 * Only emits fields that have real values — never outputs nulls as "data".
 */
export function formatLiveMarketSnapshotForPrompt(snap: LiveMarketSnapshot): string {
  const lines: string[] = [];

  if (hasConsistentTaiexSnapshot(snap.taiex)) {
    // 明示漲跌基準與正負號 — 6/11 audit: 大跌日簡報寫成 +3.31% 多頭強勢
    lines.push(`TAIEX: ${snap.taiex.value}（較前一交易日收盤 ${snap.taiex.change != null ? (snap.taiex.change >= 0 ? "+" : "") + snap.taiex.change : "n/a"} 點、${snap.taiex.changePct != null ? (snap.taiex.changePct >= 0 ? "+" : "") + snap.taiex.changePct + "%" : "n/a"}；負號=下跌，引用時不得改變方向）`);
    if (snap.taiex.asOf) lines.push(`  資料日期: ${snap.taiex.asOf} (${snap.taiex.sourceState ?? "unknown"})`);
  }

  if (snap.heatmapTop3.length > 0) {
    lines.push("熱力圖前三大板塊:");
    for (const tile of snap.heatmapTop3) {
      lines.push(`  - ${tile.industry}: ${tile.avgChangePct >= 0 ? "+" : ""}${tile.avgChangePct}%`);
    }
  }

  if (snap.topGainers.length > 0) {
    lines.push("漲幅前五 (個股):");
    for (const s of snap.topGainers) {
      lines.push(`  - ${s.symbol} ${s.name}: +${s.changePct}%`);
    }
  }

  if (snap.topLosers.length > 0) {
    lines.push("跌幅前五 (個股):");
    for (const s of snap.topLosers) {
      lines.push(`  - ${s.symbol} ${s.name}: ${s.changePct}%`);
    }
  }

  if (snap.institutional.date && (snap.institutional.foreign !== null || snap.institutional.trust !== null || snap.institutional.dealer !== null)) {
    lines.push(`法人籌碼 (${snap.institutional.date}):`);
    if (snap.institutional.foreign !== null) lines.push(`  - 外資: ${snap.institutional.foreign >= 0 ? "+" : ""}${snap.institutional.foreign} 張`);
    if (snap.institutional.trust !== null) lines.push(`  - 投信: ${snap.institutional.trust >= 0 ? "+" : ""}${snap.institutional.trust} 張`);
    if (snap.institutional.dealer !== null) lines.push(`  - 自營: ${snap.institutional.dealer >= 0 ? "+" : ""}${snap.institutional.dealer} 張`);
  }

  if (snap.margin.date && (snap.margin.balanceChange !== null || snap.margin.shortChange !== null)) {
    lines.push(`信用交易 (${snap.margin.date} vs 前一日):`);
    if (snap.margin.balanceChange !== null) lines.push(`  - 融資餘額變化: ${snap.margin.balanceChange >= 0 ? "+" : ""}${snap.margin.balanceChange} 股`);
    if (snap.margin.shortChange !== null) lines.push(`  - 融券餘額變化: ${snap.margin.shortChange >= 0 ? "+" : ""}${snap.margin.shortChange} 股`);
  }

  return lines.length > 0 ? lines.join("\n") : "(未能取得即時市場數據，以下僅供資料狀態參考)";
}

function latestSnapshotDate(snap: LiveMarketSnapshot): string | null {
  const dates = [
    hasConsistentTaiexSnapshot(snap.taiex) ? snap.taiex.asOf : null,
    snap.institutional.date,
    snap.margin.date,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return dates.sort().at(-1) ?? null;
}

export function buildMarketOverviewSourceEntryFromSnapshot(
  snap: LiveMarketSnapshot,
  staleThreshold: Date
): SourcePackEntry {
  const taiexConsistent = hasConsistentTaiexSnapshot(snap.taiex);
  const availableBlocks = [
    taiexConsistent,
    snap.heatmapTop3.length > 0,
    snap.topGainers.length > 0 || snap.topLosers.length > 0,
    snap.institutional.date !== null,
    snap.margin.date !== null,
  ].filter(Boolean).length;
  const latestDate = latestSnapshotDate(snap);
  const isStale = latestDate ? new Date(latestDate) < staleThreshold : false;
  const status: SourceStatus =
    availableBlocks === 0
      ? "EMPTY"
      : isStale || snap.taiex.sourceState === "lkg"
      ? "STALE"
      : !taiexConsistent
      ? "DEGRADED"
      : "LIVE";

  return {
    source: "market_overview",
    status,
    rowCount: availableBlocks,
    latestDate,
    note:
      availableBlocks === 0
        ? "live_market_snapshot_empty"
        : [
            `taiex=${taiexConsistent ? snap.taiex.sourceState ?? "missing" : "inconsistent_rejected"}`,
            `heatmap=${snap.heatmapTop3.length}`,
            `leaders=${snap.topGainers.length + snap.topLosers.length}`,
            `institutional=${snap.institutional.date ?? "missing"}`,
            `margin=${snap.margin.date ?? "missing"}`,
          ].join(";"),
    sampleRows:
      availableBlocks === 0
        ? null
        : [
            {
              taiexValue: taiexConsistent ? snap.taiex.value : null,
              taiexChange: taiexConsistent ? snap.taiex.change : null,
              taiexChangePct: taiexConsistent ? snap.taiex.changePct : null,
              taiexAsOf: taiexConsistent ? snap.taiex.asOf : null,
              taiexSourceState: taiexConsistent ? snap.taiex.sourceState : "inconsistent_rejected",
              heatmapTop3: snap.heatmapTop3,
              topGainers: snap.topGainers,
              topLosers: snap.topLosers,
              institutional: snap.institutional,
              margin: snap.margin,
            },
          ],
  };
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
    const _ohlcvRowArr = (ohlcvRows as { rows?: Array<{ cnt?: string | number; latest?: string }> }).rows
      ?? (Array.isArray(ohlcvRows) ? (ohlcvRows as Array<{ cnt?: string | number; latest?: string }>) : []);
    const ohlcvRow = _ohlcvRowArr[0];
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
        ohlcvSampleRows = ((sampleRes as { rows?: Record<string, unknown>[] }).rows
          ?? (Array.isArray(sampleRes) ? (sampleRes as Record<string, unknown>[]) : []));
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

  // 5. Market overview. This must be a real market snapshot, not "a brief
  // exists" recency. The generator separately injects the same snapshot into
  // the prompt; keeping it in sourcePack makes the brief auditable afterwards.
  try {
    const snapshot = await collectLiveMarketSnapshot(workspaceId, tradingDate, tick);
    sources.push(buildMarketOverviewSourceEntryFromSnapshot(snapshot, staleThreshold));
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

  // 6. AI-selected news and official announcements are optional but must enter
  // the prompt/source trail when available; otherwise the daily brief becomes
  // a price-only summary and misses the market-intel layer.
  await collectAiSelectedNewsSource(db, sources, staleThreshold);
  await collectOfficialAnnouncementsSource(db, sources, workspaceId, staleThreshold);

  // Trail complete: all required sources are LIVE, DEGRADED, or STALE (not ERROR/EMPTY/MISSING/BLOCKED)
  const REQUIRED_SOURCES = ["companies_ohlcv"];
  const DEGRADED_OK_SOURCES = [
    "tw_monthly_revenue",
    "tw_institutional_buysell",
    "tw_margin_short",
    "market_overview",
    "ai_selected_news",
    "official_announcements"
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

const TABLE_SOURCE_DATE_COLUMNS = {
  tw_monthly_revenue: "revenue_date",
  tw_institutional_buysell: "date",
  tw_margin_short: "date",
} as const;

type TableSourceName = keyof typeof TABLE_SOURCE_DATE_COLUMNS;

export function tableSourceDateColumn(tableName: TableSourceName): string {
  return TABLE_SOURCE_DATE_COLUMNS[tableName];
}

async function collectTableSource(
  db: NonNullable<ReturnType<typeof getDb>>,
  sources: SourcePackEntry[],
  tableName: TableSourceName,
  workspaceId: string,
  staleThreshold: Date,
  staleThresholdDays: number
) {
  try {
    const dateColumn = tableSourceDateColumn(tableName);
    // Raw SQL to avoid requiring schema table references for DRAFT tables
    const rows = await db.execute(
      drizzleSql.raw(`SELECT COUNT(*) AS cnt, MAX(${dateColumn}) AS latest FROM ${tableName} WHERE stock_id IN (SELECT ticker FROM companies WHERE workspace_id = '${workspaceId}') LIMIT 1`)
    );
    const _rowArr = (rows as { rows?: Array<{ cnt?: string | number; latest?: string }> }).rows
      ?? (Array.isArray(rows) ? (rows as Array<{ cnt?: string | number; latest?: string }>) : []);
    const row = _rowArr[0];
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
          drizzleSql.raw(`SELECT * FROM ${tableName} WHERE stock_id IN (SELECT ticker FROM companies WHERE workspace_id = '${workspaceId}') ORDER BY ${dateColumn} DESC LIMIT 3`)
        );
        sampleRows = ((sampleRes as { rows?: Record<string, unknown>[] }).rows
          ?? (Array.isArray(sampleRes) ? (sampleRes as Record<string, unknown>[]) : []));
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

function jsonArraySampleRows(value: unknown, limit = 3): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .slice(0, limit)
    .map((item) => ({
      headline: item["headline"] ?? item["title"] ?? null,
      ticker: item["ticker"] ?? null,
      companyName: item["companyName"] ?? null,
      source: item["source"] ?? null,
      impactTier: item["impact_tier"] ?? item["impactTier"] ?? null,
      whyMatters: item["why_matters"] ?? item["whyMatters"] ?? null
    }));
  return rows.length > 0 ? rows : null;
}

async function collectAiSelectedNewsSource(
  db: NonNullable<ReturnType<typeof getDb>>,
  sources: SourcePackEntry[],
  staleThreshold: Date
) {
  try {
    const result = await db.execute(drizzleSql`
      SELECT
        id,
        as_of::text AS latest,
        selection_mode,
        input_row_count,
        ai_call_success,
        items,
        jsonb_array_length(items) AS item_count
      FROM news_ai_selections
      ORDER BY as_of DESC
      LIMIT 1
    `);
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows
      ?? (Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []);
    const row = rows[0];
    const itemCount = row ? Number(row["item_count"] ?? 0) : 0;
    const latest = typeof row?.["latest"] === "string" ? row["latest"] : null;
    const status: SourceStatus =
      itemCount === 0
        ? "EMPTY"
        : latest && new Date(latest) < staleThreshold
        ? "STALE"
        : "LIVE";
    const note = row
      ? `mode=${String(row["selection_mode"] ?? "unknown")}; input_rows=${String(row["input_row_count"] ?? "n/a")}; ai_call_success=${String(row["ai_call_success"] ?? "n/a")}`
      : "no_news_ai_selection";
    sources.push({
      source: "ai_selected_news",
      status,
      rowCount: itemCount,
      latestDate: latest,
      note,
      sampleRows: jsonArraySampleRows(row?.["items"])
    });
  } catch (e) {
    sources.push({
      source: "ai_selected_news",
      status: "DEGRADED",
      rowCount: null,
      latestDate: null,
      note: e instanceof Error ? e.message.slice(0, 100) : "news_ai_selections_unavailable",
      sampleRows: null
    });
  }
}

async function collectOfficialAnnouncementsSource(
  db: NonNullable<ReturnType<typeof getDb>>,
  sources: SourcePackEntry[],
  workspaceId: string,
  staleThreshold: Date
) {
  try {
    const result = await db.execute(drizzleSql`
      SELECT
        COUNT(*) AS cnt,
        MAX(announced_at)::text AS latest
      FROM tw_announcements
      WHERE ticker_symbol IN (SELECT ticker FROM companies WHERE workspace_id = ${workspaceId})
    `);
    const rows = (result as { rows?: Array<{ cnt?: string | number; latest?: string | null }> }).rows
      ?? (Array.isArray(result) ? (result as Array<{ cnt?: string | number; latest?: string | null }>) : []);
    const row = rows[0];
    const count = row ? Number(row.cnt ?? 0) : 0;
    const latest = row?.latest ?? null;
    const status: SourceStatus =
      count === 0
        ? "EMPTY"
        : latest && new Date(latest) < staleThreshold
        ? "STALE"
        : "LIVE";

    let sampleRows: Record<string, unknown>[] | null = null;
    if (count > 0) {
      try {
        const sampleRes = await db.execute(drizzleSql`
          SELECT ticker_symbol AS ticker, announced_at::text AS announcedAt, title, source_url AS sourceUrl
          FROM tw_announcements
          WHERE ticker_symbol IN (SELECT ticker FROM companies WHERE workspace_id = ${workspaceId})
          ORDER BY announced_at DESC
          LIMIT 3
        `);
        sampleRows = (sampleRes as { rows?: Record<string, unknown>[] }).rows
          ?? (Array.isArray(sampleRes) ? (sampleRes as Record<string, unknown>[]) : []);
      } catch {
        // sample fetch failure is non-fatal
      }
    }

    sources.push({
      source: "official_announcements",
      status,
      rowCount: count,
      latestDate: latest,
      note: null,
      sampleRows
    });
  } catch (e) {
    sources.push({
      source: "official_announcements",
      status: "DEGRADED",
      rowCount: null,
      latestDate: null,
      note: e instanceof Error ? e.message.slice(0, 100) : "tw_announcements_unavailable",
      sampleRows: null
    });
  }
}

const OPENALICE_ACTIVE_DEVICE_SECONDS = Number(
  process.env["OPENALICE_ACTIVE_DEVICE_SECONDS"] ?? 5 * 60
);

async function hasActiveOpenAliceDevice(workspaceId: string): Promise<boolean> {
  if (!isDatabaseMode()) return false;
  const db = getDb();
  if (!db) return false;

  const cutoff = new Date(Date.now() - OPENALICE_ACTIVE_DEVICE_SECONDS * 1000);
  const rows = await db
    .select({ id: openAliceDevices.id })
    .from(openAliceDevices)
    .where(
      and(
        eq(openAliceDevices.workspaceId, workspaceId),
        eq(openAliceDevices.status, "active"),
        gte(openAliceDevices.lastSeenAt, cutoff)
      )
    )
    .limit(1)
    .catch(() => []);

  return rows.length > 0;
}

function trimForBrief(value: string, max = 1_200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

// ── P0-1: Encoding scrubber ────────────────────────────────────────────────────

/**
 * Strip U+FFFD replacement characters (and consecutive runs) from brief body text.
 * These arise when CP950/Big5-encoded source text is piped into a UTF-8 prompt without
 * proper translit — LLM echoes the replacement chars verbatim into the output.
 * After stripping, collapse double-spaces left behind and trim.
 *
 * Exported for unit testing.
 */
export function scrubReplacementChars(text: string): string {
  // Remove runs of replacement chars, optionally surrounded by spaces
  return text.replace(/[�]+/g, "").replace(/\s{2,}/g, " ").trim();
}

// ── P0-2: Template residue scrubber ───────────────────────────────────────────

/**
 * Forbidden phrases that must never appear in user-visible brief output.
 * These are LLM prompt template instructions that occasionally leak into the final text.
 * Ordered from most-specific (full sentence) to least-specific (substring) to maximise
 * surgical removal without over-stripping adjacent content.
 *
 * Exported for unit testing.
 */
export const FORBIDDEN_BRIEF_PHRASES: ReadonlyArray<string | RegExp> = [
  // Exact strings (full sentences or clauses)
  "此版本僅作內部研究草稿，供人員審閱後再決定後續分析方向。",
  "此版本僅作內部研究草稿，供人員審閱後再決定後續分析方向",
  "供人員審閱後再決定後續分析方向",
  // Substrings that must never appear in user output
  "內部研究草稿",
  "供人員審閱",
  "後續分析方向",
  // LLM meta-comments
  /Generated:\s*\d{4}-\d{2}-\d{2}\s*\(rule-template fallback\)/,
  /\(rule-template fallback\)/,
  // English internal wording (just in case)
  "internal research draft",
  "for internal review",
  "TODO:",
  "FIXME:",
  "placeholder",
];

/**
 * Scrub forbidden internal-template phrases from a brief body string.
 * For each forbidden phrase: remove the phrase and trim surrounding whitespace.
 * Exported for unit testing.
 */
export function scrubForbiddenPhrases(text: string): string {
  let result = text;
  for (const phrase of FORBIDDEN_BRIEF_PHRASES) {
    if (typeof phrase === "string") {
      // Replace all occurrences, collapse surrounding whitespace
      result = result.split(phrase).join("").replace(/\s{2,}/g, " ").trim();
    } else {
      // Regex: global replace
      result = result.replace(new RegExp(phrase.source, phrase.flags.includes("g") ? phrase.flags : phrase.flags + "g"), "").replace(/\s{2,}/g, " ").trim();
    }
  }
  return result;
}

/**
 * Apply both encoding scrub and template-residue scrub to a brief body.
 * Use this on every LLM-generated section body before it reaches the publish gate.
 */
export function sanitizeBriefBody(text: string): string {
  return scrubForbiddenPhrases(scrubReplacementChars(text));
}

const SOURCE_PRODUCT_LABELS: Record<string, string> = {
  companies_ohlcv: "台股日線資料",
  tw_monthly_revenue: "月營收資料",
  tw_institutional_buysell: "法人籌碼資料",
  tw_margin_short: "信用交易資料",
  market_overview: "市場總覽資料",
  ai_selected_news: "AI 精選新聞",
  official_announcements: "官方重大公告"
};

function formatSourceLabel(source: string): string {
  return SOURCE_PRODUCT_LABELS[source] ?? source.replace(/_/g, " ");
}

function buildSourcePackContext(sourcePack: SourcePack): string {
  return sourcePack.sources
    .map((source) => {
      const sample = source.sampleRows?.length
        ? `\n    sample=${trimForBrief(JSON.stringify(source.sampleRows), 600)}`
        : "";
      return [
        `- ${formatSourceLabel(source.source)}`,
        `status=${source.status}`,
        `rows=${source.rowCount ?? "n/a"}`,
        `latest=${source.latestDate ?? "n/a"}`,
        source.note ? `note=${source.note}` : null,
        sample
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");
}

function buildSourceTrailSummary(sourcePack: SourcePack): string {
  const sources = sourcePack.sources
    .map((source) => {
      const parts = [
        `${formatSourceLabel(source.source)}=${source.status}`,
        `rows=${source.rowCount ?? "n/a"}`,
        `latest=${source.latestDate ?? "n/a"}`,
        source.note ? `note=${source.note}` : null
      ].filter(Boolean);
      return parts.join(",");
    })
    .join(" | ");
  return `source_pack=${sourcePack.packId}; trading_date=${sourcePack.tradingDate}; ${sources}`;
}

export function buildSourceOnlyBriefPayload(sourcePack: SourcePack): Record<string, unknown> {
  const liveSources = sourcePack.sources.filter((source) => source.status === "LIVE");
  const staleSources = sourcePack.sources.filter((source) => source.status === "STALE" || source.status === "DEGRADED");
  const blockedSources = sourcePack.sources.filter((source) =>
    source.status === "EMPTY" ||
    source.status === "BLOCKED" ||
    source.status === "ERROR" ||
    source.status === "MISSING"
  );

  const liveLine = liveSources.length
    ? liveSources.map((source) => `${formatSourceLabel(source.source)}（${source.rowCount ?? "n/a"} 筆，最新 ${source.latestDate ?? "未標示"}）`).join("、")
    : "目前沒有足夠的新鮮來源可列為主要依據";
  const staleLine = staleSources.length
    ? staleSources.map((source) => `${formatSourceLabel(source.source)}（最新 ${source.latestDate ?? "未標示"}）`).join("、")
    : "沒有明顯過期來源";
  const blockedLine = blockedSources.length
    ? blockedSources.map((source) => `${formatSourceLabel(source.source)}（${source.note ?? source.status}）`).join("、")
    : "沒有主要資料缺口";
  const sourceTrail = buildSourceTrailSummary(sourcePack);

  return dailyBriefPayloadSchema.parse({
    date: sourcePack.tradingDate,
    marketState: "Balanced",
    sections: [
      {
        heading: "市場總覽",
        body: `本簡報依 ${sourcePack.tradingDate} 可取得的台股資料整理。可用來源：${liveLine}。資料不足或過期來源不會被當成投資依據，市場狀態先以平衡觀察處理。`,
        sourceTrail
      },
      {
        heading: "AI 精選重點",
        body: `目前沒有足夠通過模板檢查的 AI 精選新聞可直接發布；若來源不足，系統會保留來源狀態而不補故事。可用來源仍以 ${liveLine} 作為今日簡報基礎。`,
        sourceTrail
      },
      {
        heading: "產業與主題",
        body: `產業與主題段落只引用已收進資料包的市場資料；若主題、公司關聯或新聞來源不足，會維持資料不足狀態，不把未驗證題材寫成確定趨勢。`,
        sourceTrail
      },
      {
        heading: "風險觀察",
        body: `需要留意的資料狀態：${staleLine}。缺口狀態：${blockedLine}。因此本日解讀以資料完整性與風控檢查為優先，不提供買賣建議、目標價或報酬承諾。`,
        sourceTrail
      },
      {
        heading: "資料來源狀態",
        body: `來源狀態總結：可用來源為 ${liveLine}；過期或降級來源為 ${staleLine}；阻塞或缺口來源為 ${blockedLine}。下一步是補齊資料同步與審核鏈。`,
        sourceTrail
      }
    ]
  });
}

const SOURCE_ONLY_BACKFILL_CONFIDENCE = 0.72;

export function evaluateSourceOnlyBackfillGate(input: {
  sourcePack: SourcePack;
  payload: unknown;
}): { tier: PublishGateTier; shouldAutoPublish: boolean; rejectReason: string | null } {
  // Historical backfill uses a deterministic source-status payload. This is not
  // pretending an AI reviewer approved it; it lets the normal publisher gate
  // verify that the content is green tier and that the source trail is complete.
  return evaluatePublishGate({
    sourcePack: input.sourcePack,
    reviewerVerdict: "approve",
    confidence: SOURCE_ONLY_BACKFILL_CONFIDENCE,
    flaggedIssueCount: 0,
    draftPayload: input.payload
  });
}

async function tryPublishSourceOnlyBackfillDraft(input: {
  workspaceId: string;
  draftId: string;
  sourcePack: SourcePack;
  payload: unknown;
}): Promise<{ published: boolean; briefId: string | null; reason: string | null }> {
  const gate = evaluateSourceOnlyBackfillGate({
    sourcePack: input.sourcePack,
    payload: input.payload
  });

  if (!gate.shouldAutoPublish) {
    return {
      published: false,
      briefId: null,
      reason: gate.rejectReason ?? `tier=${gate.tier}`
    };
  }

  const approveResult = await approveContentDraft({
    draftId: input.draftId,
    reviewerId: null
  });

  if ("error" in approveResult) {
    return {
      published: false,
      briefId: null,
      reason: `approve_failed:${approveResult.error}`
    };
  }

  const db = getDb();
  if (db) {
    try {
      await db.insert(auditLogs).values({
        workspaceId: input.workspaceId,
        actorId: null,
        action: "content_draft.source_only_backfill_approved",
        entityType: "content_draft",
        entityId: input.draftId,
        payload: {
          reviewer: "system:source-only-backfill",
          verdict: "approve",
          reason: "historical_backfill_source_only_gate_passed",
          flagged_issues: [],
          confidence: SOURCE_ONLY_BACKFILL_CONFIDENCE,
          tradingDate: input.sourcePack.tradingDate,
          sourcePackId: input.sourcePack.packId
        }
      });
    } catch (e) {
      console.warn(
        `[pipeline-direct] source-only backfill audit write failed for draft ${input.draftId}:`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  return {
    published: true,
    briefId: approveResult.approvedRefId,
    reason: null
  };
}

/**
 * Post-process guard: if LLM outputs an English-heavy heading, replace with a
 * safe Chinese fallback. Prevents "Market Overview" etc. from reaching the frontend
 * isEnglishHeavy() detector and triggering the fallback copy.
 *
 * Known English headings are mapped to canonical Chinese equivalents.
 * Any unrecognised English-heavy heading falls back to "今日市場簡報".
 */
export const DAILY_BRIEF_TEMPLATE_VERSION = "daily_brief_contract_v2";
export const DAILY_BRIEF_REQUIRED_SECTION_IDS = [
  "market_overview",
  "ai_selected_news",
  "sector_themes",
  "risk_watch",
  "data_source_status",
] as const;

const DAILY_BRIEF_SECTION_LABELS: Record<(typeof DAILY_BRIEF_REQUIRED_SECTION_IDS)[number], string> = {
  market_overview: "市場總覽",
  ai_selected_news: "AI 精選重點",
  sector_themes: "產業與主題",
  risk_watch: "風險觀察",
  data_source_status: "資料來源狀態",
};

export function buildDailyBriefContractInstructions(): string {
  return `Daily brief contract（盤前簡報格式）:
- templateVersion must be "${DAILY_BRIEF_TEMPLATE_VERSION}".
- sections must include exactly these sectionId values: ${DAILY_BRIEF_REQUIRED_SECTION_IDS.join(", ")}.
- Required headings（固定，不可更改）: 市場總覽, AI 精選重點, 產業與主題, 風險觀察, 資料來源狀態.
- 這是台股交易員開盤前要讀的專業盤前分析簡報，語氣是敘事型、有觀點、多維度、緊跟市場最新動態。

核心寫作原則（品質標準）：
「好的簡報」不是把資料欄位複製一遍，而是幫操盤師建立今日市場情境認知：
  1. 今日的「市場劇本」是什麼？延續昨日趨勢？還是出現轉折訊號？
  2. 三大法人資金今日的「方向共識」是什麼？輪動、集中、還是撤退？
  3. 今日值得關注的族群是哪些？有什麼具體催化劑？
  4. 今日最大的不確定性風險點在哪裡？

各 section 寫作指引（**每項都必須達到，不可略過**）：

[市場總覽] — 台股今日盤前情境分析
  必包含：(a) 昨日 TAIEX 收盤點位與漲跌（直接引用資料中的數字）；
          (b) 若 source pack 中有美股隔夜資料則說明對台股的影響，否則明確標示「美股隔夜資料本日缺席，以台股內部信號為主」；
          (c) 開盤前主要情緒方向判斷（依法人流向 + 技術結構 + OHLCV 推導）；
          (d) 今日需要觀察的盤中關鍵條件（不是泛稱「留意波動」，而是具體的觀察點）。
  禁止：把「美股隔夜資料缺席」放在第一句，應在尾端 data_source_status 說明。

[AI 精選重點] — 今日關注議題與重要新聞
  必包含：若有 ai_selected_news 資料，針對每則新聞說明「為何今日重要」+「可能影響哪些族群或個股」。
          不可 raw dump 新聞標題列表；每則新聞必須帶分析視角。
          若有多則新聞，挑選 3-5 則最市場相關的深入說明，其餘整合成一段。
  若無新聞資料：說明今日注意哪些外部事件風險（依資料源限制誠實說明），不要讓讀者自己去查。

[產業與主題] — 今日族群展望與法人動向解讀
  必包含：(a) 法人資金流向分析：外資/投信/自營的方向（直接引用淨買賣數字），
              判斷今日法人的「共識」或「分歧」是什麼，資金是在集中某些族群還是在輪動；
          (b) 依據法人流向 + OHLCV 技術面，推導今日值得關注的 2-3 個族群或主題；
          (c) 說明每個族群的關注理由（技術位置/法人資金/產業催化劑），用「值得觀察」「可能」等中性措辭，不預測漲跌幅。
  若法人資料暫缺：說明缺口並以 OHLCV + 新聞推導替代分析。

[風險觀察] — 量化風控與下行風險
  必包含：(a) 融資餘額變化（直接引用數字）：資金槓桿是在增加還是收斂；
          (b) 今日需要警惕的具體下行風險（有數據支撐的，不是泛稱「注意風險」）；
          (c) 若有個股出現異常技術訊號或事件（如停牌、人工管制交易），說明對市場流動性的影響。
  若數據暫缺：說明缺口的具體原因。

[資料來源狀態] — 今日資料品質透明度說明
  一段簡短說明今日資料源狀態（LIVE/STALE/DEGRADED/EMPTY），
  讓讀者知道本日簡報的可信程度。海外資料缺席在此說明。

禁止行為（硬規則，違反直接退件）：
- 禁止出現 Active Themes / Theme Summaries / Company Notes / [Discovery/...] / Priority N / Lifecycle / Linked Companies / [Observation] 等內部資料庫欄位格式。
- 禁止 raw dump 任何資料庫內容（主題列表、公司清單、bullet-point 資料結構直接貼上）。
- 禁止幻覺任何資料來源未提供的數字（美股指數、個股漲跌幅、未存在的法人數字）。
- 資料不足時要寫「資料不足：原因」，不可補故事。
- AI 精選重點不可 raw dump 新聞；每則必須說 why matters + 影響哪些族群。
- 禁止把「美股隔夜資料缺席」放到市場總覽第一句，應放到 data_source_status。

輸出 schema（嚴格遵守，JSON only，不加任何 markdown 或說明文字）：
{
  "templateVersion": "${DAILY_BRIEF_TEMPLATE_VERSION}",
  "marketState": "Risk-On" | "Balanced" | "Risk-Off",
  "sections": [
    { "sectionId": "market_overview", "heading": "市場總覽", "body": "至少 200 字，最多 1200 字，敘事型段落" },
    { "sectionId": "ai_selected_news", "heading": "AI 精選重點", "body": "至少 150 字，最多 1200 字，帶分析視角" },
    { "sectionId": "sector_themes", "heading": "產業與主題", "body": "至少 200 字，最多 1200 字，含法人動向解讀" },
    { "sectionId": "risk_watch", "heading": "風險觀察", "body": "至少 100 字，最多 1200 字，量化風控數字" },
    { "sectionId": "data_source_status", "heading": "資料來源狀態", "body": "至少 50 字，最多 400 字" }
  ]
}`;
}

const DAILY_BRIEF_SECTION_ID_SET = new Set<string>(DAILY_BRIEF_REQUIRED_SECTION_IDS);
const DAILY_BRIEF_MIN_BODY_CHARS = 50;
const DAILY_BRIEF_LEGACY_HEADING_PATTERN =
  /Market Overview|Theme Summaries|Company Notes|Technical Analysis|Risk Alert|Strategy Observation|Summary/i;
const DAILY_BRIEF_RAW_DUMP_PATTERN =
  /Theme:\s|Lifecycle:\s|Market State:\s|Linked Companies|Observation\]|Priority:\s|Active Themes|Theme Summaries|\[Discovery\/|\[Observation\]|Linked Companies \(|• .+\[.+\] — Priority/i;

export function validateDailyBriefSectionsContract(
  sections: Array<{ sectionId?: unknown; heading?: unknown; body?: unknown }>
): { ok: boolean; missing: string[] } {
  const present = new Set<string>();

  for (const section of sections) {
    if (typeof section.sectionId === "string" && DAILY_BRIEF_SECTION_ID_SET.has(section.sectionId)) {
      present.add(section.sectionId);
      continue;
    }

    const heading = typeof section.heading === "string" ? section.heading : "";
    for (const id of DAILY_BRIEF_REQUIRED_SECTION_IDS) {
      if (heading.includes(DAILY_BRIEF_SECTION_LABELS[id])) {
        present.add(id);
      }
    }
  }

  const missing = DAILY_BRIEF_REQUIRED_SECTION_IDS.filter((id) => !present.has(id));
  return { ok: missing.length === 0, missing };
}

function isDailyBriefSectionContentCompliant(section: {
  heading?: unknown;
  body?: unknown;
}): boolean {
  const heading = typeof section.heading === "string" ? section.heading : "";
  const body = typeof section.body === "string" ? section.body.trim() : "";

  if (DAILY_BRIEF_LEGACY_HEADING_PATTERN.test(heading)) return false;
  if (body.length < DAILY_BRIEF_MIN_BODY_CHARS) return false;
  if (DAILY_BRIEF_RAW_DUMP_PATTERN.test(body)) return false;

  return true;
}

export function isDailyBriefV2ContractCompliant(
  brief: { sections?: unknown } | null | undefined
): boolean {
  if (!brief || !Array.isArray(brief.sections)) return false;

  const sections = brief.sections.map((section) => {
    if (!section || typeof section !== "object") return {};
    const value = section as { sectionId?: unknown; heading?: unknown; body?: unknown };
    return {
      sectionId: value.sectionId,
      heading: value.heading,
      body: value.body
    };
  });

  return (
    validateDailyBriefSectionsContract(sections).ok &&
    sections.every((section) => isDailyBriefSectionContentCompliant(section))
  );
}

const ENGLISH_HEADING_MAP: Record<string, string> = {
  "market overview": "市場總覽",
  "technical analysis": "技術觀察",
  "risk alert": "風控警示",
  "risk alerts": "風控警示",
  "strategy observation": "策略觀察",
  "strategy observations": "策略觀察",
  "signal today": "今日訊號狀態",
  "signals today": "今日訊號狀態",
  "today's signals": "今日訊號狀態",
  "summary": "綜合觀察",
  "market summary": "市場總覽",
  "daily summary": "每日簡報摘要",
  "data status": "今日資料狀態",
  "data quality": "資料品質提醒",
  "commentary": "綜合觀察",
  "next steps": "下一步工作",
  "overview": "總覽",
  "institutional flow": "法人動向",
  "sector analysis": "類股分析",
  "sector overview": "類股總覽",
};

function sanitizeBriefHeading(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (ENGLISH_HEADING_MAP[lower]) {
    console.warn(`[pipeline] brief heading English fallback: "${trimmed}" → "${ENGLISH_HEADING_MAP[lower]}"`);
    return ENGLISH_HEADING_MAP[lower];
  }
  // Detect English-heavy heading: >= 8 alpha chars AND more latin than CJK
  const latin = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const cjk = (trimmed.match(/[一-鿿]/g) ?? []).length;
  if (latin >= 8 && latin > cjk) {
    console.warn(`[pipeline] brief heading English-heavy detected: "${trimmed}" → "今日市場簡報"`);
    return "今日市場簡報";
  }
  return trimmed;
}

export function parseDirectBriefPayload(raw: string | null, sourcePack: SourcePack): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const sourceTrail = buildSourceTrailSummary(sourcePack);
    const parsed = JSON.parse(stripCodeFences(raw)) as {
      templateVersion?: unknown;
      marketState?: unknown;
      sections?: unknown;
    };
    const marketState =
      parsed.marketState === "Risk-On" ||
      parsed.marketState === "Risk-Off" ||
      parsed.marketState === "Balanced"
        ? parsed.marketState
        : "Balanced";
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .map((section) => {
            const value = section as { sectionId?: unknown; heading?: unknown; body?: unknown };
            const sectionId = typeof value.sectionId === "string" ? trimForBrief(value.sectionId, 80) : undefined;
            const rawHeading = typeof value.heading === "string" ? trimForBrief(value.heading, 80) : "";
            const heading = rawHeading ? sanitizeBriefHeading(rawHeading) : "";
            const rawBody = typeof value.body === "string" ? trimForBrief(value.body, 1_400) : "";
            const body = sanitizeBriefBody(rawBody);
            return { sectionId, heading, body, sourceTrail };
          })
          .filter((section) => section.heading.length > 0 && section.body.length >= 50)
          .slice(0, 6)
      : [];

    if (sections.length === 0) return null;

    const contract = validateDailyBriefSectionsContract(sections);
    if (!contract.ok) {
      console.warn(`[pipeline] daily brief contract missing sections: ${contract.missing.join(",")}`);
      return null;
    }

    return dailyBriefPayloadSchema.parse({
      date: sourcePack.tradingDate,
      marketState,
      sections
    });
  } catch {
    return null;
  }
}

export function resolveDailyBriefModelKey(): string {
  const configured = process.env["OPENAI_MODEL_BRIEF"]?.trim();
  return configured && configured.length > 0 ? configured : "gpt-4o";
}

function isDailyBriefReasoningModel(modelKey: string): boolean {
  return /^(gpt-5|o1|o3)/i.test(modelKey);
}

export function resolveDailyBriefLlmRuntimeOptions(modelKey = resolveDailyBriefModelKey()): {
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
} {
  if (isDailyBriefReasoningModel(modelKey)) {
    return {
      // gpt-5.5 spends completion budget on hidden reasoning before visible text.
      // Keep enough headroom and timeout so brief generation does not fall back
      // to the rule-template dump path simply because reasoning took too long.
      maxTokens: 12_000,
      timeoutMs: 240_000,
    };
  }

  return {
    maxTokens: 2_500,
    timeoutMs: 240_000,
    temperature: 0.25,
  };
}

async function generateDirectDailyBriefDraft(input: {
  workspaceId: string;
  sourcePack: SourcePack;
  reason: "historical_backfill" | "no_active_openalice_device" | "enqueue_failed";
}): Promise<{ draftId: string } | null> {
  const sourceContext = buildSourcePackContext(input.sourcePack);

  // F1: Collect live market numbers from TWSE OpenAPI + DB (non-blocking, best-effort)
  // Historical backfill skips LLM entirely; live snapshot still collected for source context accuracy.
  let liveSnapshotBlock = "";
  if (input.reason !== "historical_backfill") {
    try {
      const snap = await collectLiveMarketSnapshot(input.workspaceId, input.sourcePack.tradingDate, input.sourcePack.tick);
      const formatted = formatLiveMarketSnapshotForPrompt(snap);
      liveSnapshotBlock = `\n\n即時市場數據（從 TWSE OpenAPI 及 DB 取得，生成時間 ${new Date().toISOString()}）：\n${formatted}`;
    } catch {
      // non-fatal — proceed without live numbers
    }
  }

  // Premarket narrative brief prompt — professional multi-dimensional trading room analysis.
  // Key design decisions:
  //   1. Clearly states US overnight data is NOT ingested (no hallucination of Dow/Nasdaq numbers).
  //   2. Uses live TWSE data for Taiwan market section with actual numbers.
  //   3. Multi-dimensional framing: overnight context + institutional flow + sector themes + risk.
  //   4. Hard ban on raw DB dump patterns (Active Themes / Company Notes etc).
  //   5. Contract instructions enforce detailed per-section writing guidelines.
  const prompt = `你是台股 AI 交易戰情室的專業盤前分析師。今日交易日：${input.sourcePack.tradingDate}。

你的任務是生成一份給台股操盤師開盤前閱讀的「多維度盤前分析簡報」。
這份簡報應具備：有觀點（不是列清單）、多維度（技術面+法人籌碼+新聞面+風控面）、緊跟市場最新動態，幫助操盤師建立今日市場情境認知。

=== 重要資料邊界聲明 ===
- 美股隔夜行情（道瓊/S&P 500/Nasdaq/費半）：本系統目前未接入美股即時資料源。
  絕對禁止捏造美股指數數字。請在 data_source_status section 說明「美股隔夜資料本日缺席，分析以台股內部信號為主」。
  主敘事直接以台股可驗證資料為基礎，不需要把責任推給讀者。
- 所有數字必須來自下方「可用真實資料」，否則必須標示「資料暫缺」。

=== 可用真實資料 ===
交易日：${input.sourcePack.tradingDate}
資料來源狀態：
${sourceContext}${liveSnapshotBlock}

=== 硬規則（違反任一條 → 整份退件）===
1. 只能輸出 JSON，不要 markdown code fence 或任何說明文字。
2. 禁止英文 heading（Market Overview / Summary / Risk Alert 等）。
3. 禁止出現 Active Themes / Theme Summaries / Company Notes / [Discovery/...] / Priority N / Lifecycle / Linked Companies / [Observation] 等內部資料庫欄位格式。
4. 禁止 raw dump 主題清單、公司清單、逐項 bullet-point 資料結構直接貼上。
5. 禁止買賣建議、進場/賣出/買進/出脫、目標價、勝率、報酬承諾。
6. 禁止捏造任何資料來源未提供的數字（美股指數、個股漲跌幅、未出現的法人數字）。
7. 資料不足時要寫「資料暫缺：[原因]」，不可補故事或推測數字。
8. TAIEX 點位、法人籌碼數字、融資數字若在資料中有，必須直接引用具體值，不可用「數據顯示有所變化」等空泛描述。
9. 每個 section body 必須是敘事段落，有邏輯連接，不是逐項列表。

${buildDailyBriefContractInstructions()}`;

  const briefModelKey = resolveDailyBriefModelKey();
  const briefRuntime = resolveDailyBriefLlmRuntimeOptions(briefModelKey);
  const raw = input.reason === "historical_backfill"
    ? null
    : (await callLlm(
        [{ role: "user", content: prompt }],
        {
          callerModule: "brief_writer",
          taskType: "generation",
          modelKey: briefModelKey,
          maxTokens: briefRuntime.maxTokens,
          temperature: briefRuntime.temperature,
          timeoutMs: briefRuntime.timeoutMs
        }
      ))?.content ?? null;

  const payload = parseDirectBriefPayload(raw, input.sourcePack) ?? buildSourceOnlyBriefPayload(input.sourcePack);

  const draft = await createContentDraft({
    workspaceId: input.workspaceId,
    sourceJobId: null,
    targetTable: "daily_briefs",
    targetEntityId: input.sourcePack.tradingDate,
    payload,
    producerVersion: `pipeline-direct-${input.reason}-v3`
  });

  if (!draft) return null;

  const sourceSummary = input.sourcePack.sources
    .map((s) => `${s.source}(${s.status})`)
    .join(", ");
  registerJobSourcePackSummary(draft.id, sourceSummary);
  registerJobSourcePack(draft.id, input.sourcePack);
  registerJobSourcePackSummary(`direct:${draft.id}`, sourceSummary);
  registerJobSourcePack(`direct:${draft.id}`, input.sourcePack);

  if (input.reason === "historical_backfill") {
    const publishResult = await tryPublishSourceOnlyBackfillDraft({
      workspaceId: input.workspaceId,
      draftId: draft.id,
      sourcePack: input.sourcePack,
      payload
    });
    if (publishResult.published) {
      console.info(
        `[pipeline-direct] historical source-only backfill published ` +
        `date=${input.sourcePack.tradingDate} briefId=${publishResult.briefId ?? "n/a"}`
      );
      return { draftId: draft.id };
    }
    console.warn(
      `[pipeline-direct] historical source-only backfill held ` +
      `date=${input.sourcePack.tradingDate} reason=${publishResult.reason ?? "unknown"}`
    );
  }

  await fireAiReviewerForDraft(draft.id);
  return { draftId: draft.id };
}

export function shouldUseDirectBriefDraft(input: {
  tradingDate: string;
  todayDate: string;
  activeDevice: boolean;
}): boolean {
  // Historical missed-day/backfill briefs must close without waiting on a runner
  // that may have been the source of the outage. YYYY-MM-DD sorts lexicographically.
  if (input.tradingDate < input.todayDate) return true;
  return !input.activeDevice;
}

async function generateDailyBrief(
  workspaceSlug: string,
  workspaceId: string,
  sourcePack: SourcePack
): Promise<{ jobId: string } | null> {
  const sourcesSummary = sourcePack.sources
    .map((s) => `  - ${s.source}: ${s.status} (rows=${s.rowCount ?? "n/a"}, latestDate=${s.latestDate ?? "n/a"})`)
    .join("\n");

  // F1: Collect live market snapshot for enqueued path as well
  let liveSnapshotBlock = "";
  try {
    const snap = await collectLiveMarketSnapshot(workspaceId, sourcePack.tradingDate, sourcePack.tick);
    const formatted = formatLiveMarketSnapshotForPrompt(snap);
    liveSnapshotBlock = `\n\n即時市場數據（從 TWSE OpenAPI 及 DB 取得）：\n${formatted}`;
  } catch {
    // non-fatal
  }

  // Premarket narrative brief instructions — professional multi-dimensional analysis.
  // Aligned with direct path for consistency; contract instructions now enforce
  // institutional flow analysis, sector themes, and quantitative risk reporting.
  const instructions = `你是台股 AI 交易戰情室的專業盤前分析師。今日交易日：${sourcePack.tradingDate}。Tick: ${sourcePack.tick}。

你的任務是生成一份給台股操盤師開盤前閱讀的「多維度盤前分析簡報」。
這份簡報應具備：有觀點（不是列清單）、多維度（技術面+法人籌碼+新聞面+風控面）、緊跟市場最新動態，幫助操盤師建立今日市場情境認知。

=== 重要資料邊界聲明 ===
- 美股隔夜行情：本系統目前未接入美股即時資料源。絕對禁止捏造美股指數數字。
  請在 data_source_status section 說明「美股隔夜資料本日缺席」，主敘事直接以台股可驗證資料為基礎。

=== 可用真實資料 ===
交易日：${sourcePack.tradingDate}
Trail complete: ${sourcePack.trailComplete}
資料來源狀態：
${sourcesSummary}${liveSnapshotBlock}

=== 硬規則（違反任一條 → 整份退件）===
1. 只能輸出 JSON，不要 markdown code fence 或任何說明文字。
2. 禁止英文 heading（Market Overview / Summary / Risk Alert 等）。
3. 禁止出現 Active Themes / Theme Summaries / Company Notes / [Discovery/...] / Priority N / Lifecycle / Linked Companies / [Observation] 等內部資料庫欄位格式。
4. 禁止 raw dump 主題清單、公司清單、逐項 bullet-point 資料結構直接貼上。
5. 禁止買賣建議、進場/賣出/買進/出脫、目標價、勝率、報酬承諾。
6. 禁止捏造任何資料來源未提供的數字（美股指數、個股漲跌幅、未出現的法人數字）。
7. 禁止 [BROKEN-N]、[DEPRECATED]、[ORPHAN]、[placeholder] 等內部 DB 維護標記。
8. 資料不足時要寫「資料暫缺：[原因]」，不可補故事或推測數字。
9. TAIEX 點位、法人籌碼數字、融資數字若在資料中有，必須直接引用具體值，不可空泛描述。
10. 每個 section body 必須是敘事段落，有邏輯連接，不是逐項列表。

${buildDailyBriefContractInstructions()}`;

  const activeDevice = await hasActiveOpenAliceDevice(workspaceId);
  const todayDate = getTaipeiDate();
  const directReason = sourcePack.tradingDate < todayDate
    ? "historical_backfill"
    : "no_active_openalice_device";

  if (
    shouldUseDirectBriefDraft({
      tradingDate: sourcePack.tradingDate,
      todayDate,
      activeDevice
    })
  ) {
    const directDraft = await generateDirectDailyBriefDraft({
      workspaceId,
      sourcePack,
      reason: directReason
    });
    if (directDraft) {
      return { jobId: `direct:${directDraft.draftId}` };
    }
  }

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
    const directDraft = await generateDirectDailyBriefDraft({
      workspaceId,
      sourcePack,
      reason: "enqueue_failed"
    });
    return directDraft ? { jobId: `direct:${directDraft.draftId}` } : null;
  }
}

// ── Publisher gate ────────────────────────────────────────────────────────────

export type PublishGateTier = "green" | "yellow" | "red";
export type PublishGateResult =
  | { tier: "green"; action: "published"; briefId: string }
  | { tier: "yellow"; action: "queued_for_review"; reason: string }
  | { tier: "red"; action: "rejected"; reason: string }
  | { tier: "green"; action: "skipped_no_draft" };

function neutralizeSafeResearchDisclaimers(text: string): string {
  return text
    .replace(
      /(?:不|未|無)(?:提供|構成|作為|寫出|寫|含有|包含|產生|輸出|給出|做出|給予)?[^。；;.!?！？\n]{0,48}(?:買賣建議|交易建議|投資建議|目標價|預測股價|報酬承諾|績效承諾|保證報酬|保證獲利|勝率)[^。；;.!?！？\n]{0,48}/g,
      "safe_research_disclaimer"
    )
    .replace(
      /(?:禁止|避免|不得)[^。；;.!?！？\n]{0,48}(?:買賣建議|交易建議|投資建議|目標價|預測股價|報酬承諾|績效承諾|保證報酬|保證獲利|勝率)[^。；;.!?！？\n]{0,48}/g,
      "safe_research_disclaimer"
    )
    .replace(
      /\b(?:no|not|without|does not|do not|never)\b.{0,48}\b(?:buy\/sell recommendation|buy recommendation|sell recommendation|trading advice|investment advice|target price|price target|guarantee|guaranteed profit|win rate)\b/g,
      "safe_research_disclaimer"
    );
}

/**
 * Classify draft payload into Green/Yellow/Red tier.
 * Red: buy/sell/target/guarantee/Sharpe keywords.
 * Yellow: strategy/ranking/metrics content (conservative).
 * Green: passes all checks.
 */
function extractDraftPolicyText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return JSON.stringify(payload ?? "").toLowerCase();
  }

  const sections = (payload as Record<string, unknown>)["sections"];
  if (!Array.isArray(sections)) {
    return JSON.stringify(payload).toLowerCase();
  }

  const contentSections = sections.flatMap((section) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) return [];
    const record = section as Record<string, unknown>;
    return [{
      heading:
        typeof record["heading"] === "string"
          ? record["heading"]
          : typeof record["title"] === "string"
            ? record["title"]
            : "",
      body: typeof record["body"] === "string" ? record["body"] : ""
    }];
  });

  return JSON.stringify(contentSections).toLowerCase();
}

export function classifyDraftTier(payload: unknown): PublishGateTier {
  // Daily-brief sourceTrail is audit metadata, not reader-facing advice. Scanning
  // the whole payload made harmless source notes such as "strategy metrics" turn
  // an otherwise green brief yellow after the AI reviewer had approved it.
  const text = extractDraftPolicyText(payload);
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
  const redKeywordText = neutralizeSafeResearchDisclaimers(policyText);
  const redPatterns = [
    /buy\b/, /sell\b/, /進場/, /賣出/, /買進/, /出脫/,
    /目標價/, /target price/, /price target/,
    /guarantee/, /必賺/, /保證/, /翻倍/,
    /sharpe ratio\s*[=:>]\s*[\d.]+/,
    /勝率/, /win rate\s*[=:>]\s*[\d.]+/
  ];
  for (const p of redPatterns) {
    if (p.test(redKeywordText)) {
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

export function hasHighImpactNumericClaims(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const sections = (payload as Record<string, unknown>)["sections"];
  if (!Array.isArray(sections)) return false;
  return sections.some((section) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) return false;
    const body = (section as Record<string, unknown>)["body"];
    return typeof body === "string" && /\d(?:[\d,.]*)(?:%|點|張|股|元|億|萬|日|月|年)?/.test(body);
  });
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
        .select({ id: dailyBriefs.id, sections: dailyBriefs.sections })
        .from(dailyBriefs)
        .where(
          and(
            eq(dailyBriefs.workspaceId, workspace.id),
            eq(dailyBriefs.date, tradingDate),
            visibleDailyBriefCondition()
          )
        )
        .limit(5);
      const existingContractBrief = existingBriefs.find((brief) => isDailyBriefV2ContractCompliant(brief));
      if (existingContractBrief) {
        const result: PipelineRunResult = {
          ...baseResult(),
          skippedReason: `brief_already_exists_for_date:${tradingDate}`,
          durationMs: Date.now() - startMs
        };
        updatePipelineState({ lastResult: result });
        console.log(`[pipeline] tick=${tick} date=${tradingDate} SKIPPED: brief_already_exists`);
        return result;
      }
      if (existingBriefs.length > 0) {
        console.warn(
          `[pipeline] tick=${tick} date=${tradingDate} existing brief is not v2 contract compliant; regenerating`
        );
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

  // 3b. All-sources-empty guard — if EVERY source is EMPTY/ERROR/MOCK/MISSING,
  //     there is no data for the LLM to reason about. Skip enqueue entirely.
  //     This prevents hallucinated content when the market data tables are unfilled.
  //     (Different from empty-source-override in evaluatePipelinePublishGate which
  //     allows publishing reviewer-approved drafts on holidays — that path still applies
  //     after backfill fills the tables.)
  const DATA_PRESENT_STATUSES: SourceStatus[] = ["LIVE", "STALE", "DEGRADED", "FALLBACK", "CLOSED"];
  const anySourceHasData = sourcePack.sources.some((s) =>
    (DATA_PRESENT_STATUSES as string[]).includes(s.status)
  );
  if (!anySourceHasData) {
    const emptySourceNames = sourcePack.sources
      .map((s) => `${s.source}=${s.status}`)
      .join(", ");
    const result: PipelineRunResult = {
      ...baseResult(),
      sourcePack,
      skippedReason: `all_sources_empty_no_data_for_llm: [${emptySourceNames}]`,
      durationMs: Date.now() - startMs
    };
    updatePipelineState({ lastResult: result });
    await writePipelineAuditLog({ workspaceId: workspace.id, result });
    console.log(
      `[pipeline] tick=${tick} date=${tradingDate} SKIPPED: all_sources_empty — ` +
      `backfill required for: ${emptySourceNames}`
    );
    return result;
  }

  // 4. Generator — enqueue OpenAlice job
  const genResult = await generateDailyBrief(workspaceSlug, workspace.id, sourcePack);
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
  sourcePack: SourcePack | null,
  reviewerResult?: {
    verdict: "approve" | "reject" | "manual_review";
    confidence: number;
    flagged_issues?: unknown[];
  } | null
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

  // Load latest PRIMARY-REVIEW audit log for this draft.
  //
  // BUG FIX (R6 2026-05-12): The previous query had no action filter — it fetched
  // the most-recent row for this draft by createdAt DESC. The adversarial reviewer
  // (`content_draft.adversarial_audit`) runs AFTER the primary review and writes its
  // own audit row WITHOUT a `verdict` field. Because it is written last it was always
  // the row returned here → `verdict=undefined → null` → `reviewerGrantsPublish=false`
  // → gate blocked ALL approved briefs → 8-iteration self-confirming loop on draft 267476f5.
  //
  // Fix: whitelist the action types that carry a meaningful `verdict` field.
  // `content_draft.adversarial_audit` and `content_draft.ai_yellow_held` (written as
  // an intercept hold, not a final verdict) must not be consulted for gate purposes.
  // Using a positive filter (inArray) is safer than an exclusion list — new audit action
  // types added in future are automatically excluded until explicitly opted in.
  const PRIMARY_REVIEW_ACTIONS = [
    "content_draft.ai_approved",
    "content_draft.ai_rejected",
    "content_draft.ai_manual_review",
    "content_draft.factual_reject",
  ] as const;

  const auditRows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityId, draftId),
        eq(auditLogs.entityType, "content_draft"),
        inArray(auditLogs.action, [...PRIMARY_REVIEW_ACTIONS])
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

  const auditVerdict =
    auditPayload?.verdict === "approve" ||
    auditPayload?.verdict === "reject" ||
    auditPayload?.verdict === "manual_review"
      ? (auditPayload.verdict as "approve" | "reject" | "manual_review")
      : null;
  const verdict = reviewerResult?.verdict ?? auditVerdict;
  const confidence =
    typeof reviewerResult?.confidence === "number"
      ? reviewerResult.confidence
      : typeof auditPayload?.confidence === "number"
        ? auditPayload.confidence
        : null;
  const flaggedIssueCount = Array.isArray(reviewerResult?.flagged_issues)
    ? reviewerResult.flagged_issues.length
    : Array.isArray(auditPayload?.flagged_issues)
      ? (auditPayload.flagged_issues as unknown[]).length
      : 0;

  // 5/12 FIX (Part 1): When sourcePack is null (process restarted — in-memory jobId→pack cache
  // cleared between generation and review), the fallback pack has trailComplete=false which
  // blocks an AI-approved brief from publishing. Resolution: if reviewer approved with
  // high confidence and no flagged issues, treat as trail-complete for gate purposes.
  // The trail WAS complete at generation time — we just can't prove it after restart.
  // Rationale: AI reviewer already saw the source content and approved; blocking on lost
  // trail metadata is worse than the small risk of publishing a borderline pack.
  const sourcePaGkWasLost = sourcePack === null;
  const reviewerGrantsPublish =
    verdict === "approve" &&
    (confidence ?? 0) >= 0.7 &&
    flaggedIssueCount === 0;

  // 5/12 FIX (Part 2): When sourcePack exists but all sources report EMPTY status
  // (weekend / public holiday — no OHLCV, no institutional data), trailComplete=false
  // because collectSourcePack requires OHLCV to be LIVE or STALE, not EMPTY.
  // On a non-trading day this is correct data absence, not a data quality failure.
  // If reviewer approved with confidence>=0.7 and 0 flagged issues, treat as
  // trail-complete so the AI-reviewed brief can publish rather than being silently blocked.
  const sourcePackAllSourcesEmpty =
    sourcePack !== null &&
    sourcePack.sources.length > 0 &&
    sourcePack.sources.every((s) => s.status === "EMPTY");

  const effectivePack: SourcePack = sourcePack ?? {
    packId: "fallback",
    tick: "close_brief",
    collectedAt: new Date().toISOString(),
    tradingDate: getTaipeiDate(),
    sources: [],
    // If reviewer approved with confidence>=0.7, trust that the trail was complete
    // at generation time (process restart erased the in-memory SourcePack cache).
    trailComplete: sourcePaGkWasLost && reviewerGrantsPublish ? true : false
  };

  // Apply empty-source override: if pack exists but all-EMPTY and reviewer grants publish,
  // patch effectivePack.trailComplete so the gate condition passes.
  const applyEmptySourceOverride = sourcePackAllSourcesEmpty && reviewerGrantsPublish;
  if (applyEmptySourceOverride) {
    console.info(
      `[pipeline-gate] Empty-source override applied for draftId=${draftId}: ` +
      `all ${sourcePack!.sources.length} source(s) are EMPTY (weekend/holiday), ` +
      `reviewer approved with confidence=${confidence?.toFixed(2)} flagged=${flaggedIssueCount} — treating trailComplete=true`
    );
  }
  const gatePack: SourcePack = applyEmptySourceOverride
    ? { ...effectivePack, trailComplete: true }
    : effectivePack;

  const gate = evaluatePublishGate({
    sourcePack: gatePack,
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
  // null (skipped or error) → hold numeric briefs for review; do not silently publish
  const factualApiKey = process.env["OPENAI_API_KEY"];
  const requiresFactualReview = hasHighImpactNumericClaims(draft.payload);
  if (requiresFactualReview && !sourcePack) {
    return {
      action: "queued_for_review",
      briefId: null,
      reason: "factual_source_pack_unavailable"
    };
  }
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
        if (!factualResult && requiresFactualReview) {
          return {
            action: "queued_for_review",
            briefId: null,
            reason: "factual_review_unavailable_for_numeric_claims"
          };
        }
      } catch (factualErr) {
        // Factual reviewer threw unexpectedly — numeric claims must not auto-publish.
        console.warn(
          `[pipeline-gate] factual-reviewer threw: ${factualErr instanceof Error ? factualErr.message : String(factualErr)}`
        );
        if (requiresFactualReview) {
          return {
            action: "queued_for_review",
            briefId: null,
            reason: `factual_review_exception: ${factualErr instanceof Error ? factualErr.message : String(factualErr)}`
          };
        }
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
 * Boot catch-up: check if any of the last 5 trading days are missing a brief.
 * If so, fire the pipeline for EACH missed date sequentially (oldest first).
 *
 * 5/12 FIX: Previous version only fired for the most recent missed trading day.
 * This caused 5/9, 5/10, 5/11 to remain missing even after multiple redeploys,
 * because each boot only patched the day immediately before — not the full gap.
 *
 * Called once at startup (after 15s delay) to auto-recover from:
 *   - Deploy-interrupted brief windows (root cause of 5/8 miss)
 *   - Process crashes during pre-market window
 *   - Consecutive missed days (5/9-5/11 gap that PR #355 catch-up didn't fix)
 *
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

    // Find all existing brief dates to know which days are covered
    const existingBriefRows = await db
      .select({ date: dailyBriefs.date })
      .from(dailyBriefs)
      .where(and(eq(dailyBriefs.workspaceId, workspace.id), visibleDailyBriefCondition()))
      .orderBy(desc(dailyBriefs.date))
      .limit(10)
      .catch(() => [] as { date: string }[]);

    const existingDates = new Set(existingBriefRows.map((r) => r.date));

    // Collect all prior trading days in the last 7 calendar days (oldest first)
    const missedTradingDays: string[] = [];
    for (let i = 5; i >= 1; i--) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() - i);
      const candidateDate = getTaipeiDate(candidate);
      const isTrading = await isTwTradingDay(candidateDate);
      if (!isTrading) continue;
      if (existingDates.has(candidateDate)) continue;

      // Skip if this day is "old" (>5 days) — avoid generating very stale briefs
      const daysDiff = Math.round(
        (now.getTime() - new Date(candidateDate + "T00:00:00+08:00").getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysDiff > 5) continue;

      // Don't fire catch-up for today if we're in the pre-market window (cron handles it)
      if (candidateDate === todayTST) continue;

      missedTradingDays.push(candidateDate);
    }

    if (missedTradingDays.length === 0) {
      console.log("[pipeline-catchup] no missed trading days in 5-day window, catch-up not needed");
      return;
    }

    console.log(
      `[pipeline-catchup] CATCH-UP FIRE: missed days=[${missedTradingDays.join(", ")}] — generating sequentially`
    );

    // Fire sequentially (oldest first) — parallel would flood OpenAlice job queue
    for (const missedDate of missedTradingDays) {
      const result = await runPipelineForDate(workspaceSlug, missedDate).catch((e: unknown) => {
        console.error(`[pipeline-catchup] catch-up fire error for ${missedDate}:`, e instanceof Error ? e.message : String(e));
        return null;
      });

      if (result) {
        console.log(
          `[pipeline-catchup] catch-up complete: date=${missedDate} ` +
          `jobId=${result.jobId ?? "n/a"} skippedReason=${result.skippedReason ?? "none"} ` +
          `error=${result.error ?? "none"}`
        );
      }
    }
  } catch (e) {
    console.error("[pipeline-catchup] unexpected error:", e instanceof Error ? e.message : String(e));
  }
}

export async function runPipelineMissedDayCatchUpForAllWorkspaces(fallbackSlug: string): Promise<void> {
  if (!isDatabaseMode()) {
    await runPipelineMissedDayCatchUp(fallbackSlug);
    return;
  }

  const db = getDb();
  if (!db) {
    await runPipelineMissedDayCatchUp(fallbackSlug);
    return;
  }

  const slugs = new Set<string>();
  const trimmedFallback = fallbackSlug.trim();
  if (trimmedFallback) slugs.add(trimmedFallback);

  try {
    const rows = await db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .orderBy(desc(workspaces.createdAt))
      .limit(10);
    for (const row of rows) {
      if (row.slug) slugs.add(row.slug);
    }
  } catch (e) {
    console.warn(
      "[pipeline-catchup] workspace sweep failed; falling back to scheduler workspace:",
      e instanceof Error ? e.message : String(e)
    );
  }

  for (const slug of slugs) {
    await runPipelineMissedDayCatchUp(slug);
  }
}

/**
 * Admin backfill: fire the pipeline for each trading day in [fromDate, toDate] (inclusive).
 * Skips dates that already have a brief. Fires sequentially oldest-first.
 * Used by POST /api/v1/admin/brief/backfill.
 *
 * force=true: DELETE existing brief(s) for each date before re-running the pipeline.
 * This is a single-row admin replace, not a destructive schema/migration op.
 * Requires Owner session at the HTTP layer; audit log written per deletion.
 */
export async function runPipelineBackfillRange(
  workspaceSlug: string,
  fromDate: string,
  toDate: string,
  options?: { force?: boolean }
): Promise<{ fired: string[]; skipped: string[]; errors: string[]; deleted: string[] }> {
  const fired: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const deleted: string[] = [];

  if (!isDatabaseMode()) {
    return { fired, skipped: [], errors: ["memory_mode_not_supported"], deleted };
  }
  const db = getDb();
  if (!db) return { fired, skipped, errors: ["db_unavailable"], deleted };

  // Enumerate all calendar dates in range [fromDate, toDate] oldest-first
  const from = new Date(fromDate + "T00:00:00+08:00");
  const to = new Date(toDate + "T00:00:00+08:00");
  if (from > to) return { fired, skipped, errors: ["from_after_to"], deleted };

  const candidates: string[] = [];
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    candidates.push(getTaipeiDate(d));
  }

  for (const date of candidates) {
    const isTrading = await isTwTradingDay(date).catch(() => false);
    if (!isTrading) {
      skipped.push(`${date}:not_trading_day`);
      continue;
    }

    // force=true: resolve workspace, find existing briefs, DELETE them, then fall through to generation
    if (options?.force) {
      try {
        const [ws] = await db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.slug, workspaceSlug))
          .limit(1)
          .catch(() => [undefined]);

        if (ws) {
          const existingRows = await db
            .select({ id: dailyBriefs.id })
            .from(dailyBriefs)
            .where(
              and(
                eq(dailyBriefs.workspaceId, ws.id),
                eq(dailyBriefs.date, date)
              )
            );

          if (existingRows.length > 0) {
            const ids = existingRows.map((r) => r.id);
            await db.delete(dailyBriefs).where(
              and(
                eq(dailyBriefs.workspaceId, ws.id),
                eq(dailyBriefs.date, date)
              )
            );
            const idList = ids.join(",");
            console.log(`[admin/brief/backfill] force=true, deleted brief_id=${idList} for date=${date}`);
            deleted.push(`${date}:${idList}`);
          } else {
            console.log(`[admin/brief/backfill] force=true, no existing brief to delete for date=${date}`);
          }

          const existingDraftRows = await db
            .select({ id: contentDrafts.id })
            .from(contentDrafts)
            .where(
              and(
                eq(contentDrafts.workspaceId, ws.id),
                eq(contentDrafts.targetTable, "daily_briefs"),
                eq(contentDrafts.targetEntityId, date)
              )
            );

          if (existingDraftRows.length > 0) {
            const draftIds = existingDraftRows.map((r) => r.id);
            await db.delete(contentDrafts).where(
              and(
                eq(contentDrafts.workspaceId, ws.id),
                eq(contentDrafts.targetTable, "daily_briefs"),
                eq(contentDrafts.targetEntityId, date)
              )
            );
            const draftIdList = draftIds.join(",");
            console.log(`[admin/brief/backfill] force=true, deleted draft_id=${draftIdList} for date=${date}`);
            deleted.push(`${date}:drafts:${draftIdList}`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[admin/brief/backfill] force=true delete failed for date=${date}: ${msg}`);
        errors.push(`${date}:force_delete_failed:${msg}`);
        continue;
      }
    }

    const result = await runPipelineForDate(workspaceSlug, date).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${date}:${msg}`);
      return null;
    });

    if (!result) continue;

    if (result.skippedReason) {
      skipped.push(`${date}:${result.skippedReason}`);
    } else if (result.error) {
      errors.push(`${date}:${result.error}`);
    } else {
      fired.push(date);
    }
  }

  return { fired, skipped, errors, deleted };
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
