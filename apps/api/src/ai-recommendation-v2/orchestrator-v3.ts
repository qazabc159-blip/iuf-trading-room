/**
 * orchestrator-v3.ts — AI Recommendation v3: Yang SOP 5-Module / 7 Sub-Score
 *
 * Architecture (v3 upgrade from v2):
 *   [STEP 1 市場狀態] → [STEP 2 主題穿透] → [STEP 3 個股 7 sub-score] →
 *   [STEP 4 Bucket A+/A/B/C] → [STEP 5 進場/TP/SL 結構]
 *
 * Key changes vs v2:
 *   - systemPrompt: strict 5-module SOP (not generic "recommend 5-10 stocks")
 *   - risk_off_score >= 3 → return market-skip immediately (no items)
 *   - event day multiplier 0.5 applied to position sizing
 *   - synthesizeReport: mandates 7 sub-score table + bucket + entry/TP/SL in markdown
 *   - parseAiReportToRecommendationsV3: extracts all v3 fields from structured markdown
 *
 * v2 endpoint (/api/v1/ai-recommendations) is NOT modified — fully parallel.
 * v3 endpoint: GET/POST /api/v1/ai-recommendations/v3
 *
 * Lane boundary: no risk/broker/frontend changes. Read-only ReAct.
 */

import { randomUUID } from "crypto";
import type {
  AiStockRecommendationV2,
  AiRecMarketState,
  AiRecBucket,
  AiRecSourceTrailEntry,
  AiRecRunScoreBreakdown,
} from "@iuf-trading-room/contracts";
import { callTool } from "../tools/tool-registry-store.js";
import {
  getMarketOverview,
  getSectorRotation,
  getCompanyTechnical,
  getInstitutionalFlow,
  getNewsTop10,
  getCompanyFundamentals,
  getSupplyChain,
  getCompanyNews,
} from "../tools/market-data-tools.js";

type CompanyFundamentalsObservation = Awaited<ReturnType<typeof getCompanyFundamentals>>;
type SupplyChainObservation = Awaited<ReturnType<typeof getSupplyChain>>;
type CompanyNewsObservation = Awaited<ReturnType<typeof getCompanyNews>>;

const DEFAULT_AI_REC_MODEL = "gpt-4o-mini";
const DEFAULT_AI_REC_FALLBACK_MODEL = "gpt-4o";
const AI_REC_FALLBACK_COMPLETION_TOKEN_CAPS: Array<[RegExp, number]> = [
  [/^gpt-4o(?:$|-)/i, 16000],
  [/^gpt-4\.1(?:$|-)/i, 32000],
  [/^gpt-4(?:$|-)/i, 8000],
];

type AiRecLlmMessage = { role: "system" | "user" | "assistant"; content: string };
type AiRecLlmOptions = {
  modelKey: string;
  callerModule: string;
  taskType: string;
  workspaceId?: string | null;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  responseFormat?: "json_object" | "json_schema";
  responseSchema?: {
    name: string;
    strict?: boolean;
    schema: Record<string, unknown>;
  };
};
type AiRecLlmResult = {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  costUsd: number;
  callId: string | null;
  modelKey: string;
  usedModelFallback: boolean;
};

export function resolveAiRecPrimaryModel(): string {
  return process.env["OPENAI_MODEL_AI_REC"] ?? process.env["OPENAI_MODEL"] ?? DEFAULT_AI_REC_MODEL;
}

export function resolveAiRecFallbackModel(primaryModel: string): string | null {
  const configured = process.env["OPENAI_MODEL_AI_REC_FALLBACK"]?.trim();
  const fallback = configured && configured.length > 0 ? configured : DEFAULT_AI_REC_FALLBACK_MODEL;
  if (fallback === primaryModel) return null;
  return fallback;
}

export function capAiRecFallbackMaxTokensForModel(
  modelKey: string,
  requestedMaxTokens: number | undefined
): number | undefined {
  if (requestedMaxTokens === undefined) return undefined;
  const cap = AI_REC_FALLBACK_COMPLETION_TOKEN_CAPS.find(([pattern]) => pattern.test(modelKey))?.[1];
  return cap === undefined ? requestedMaxTokens : Math.min(requestedMaxTokens, cap);
}

async function callAiRecLlmWithFallback(
  messages: AiRecLlmMessage[],
  opts: AiRecLlmOptions
): Promise<AiRecLlmResult | null> {
  const { callLlm } = await import("../llm/llm-gateway.js");
  const primary = opts.modelKey;
  const first = await callLlm(messages, opts);
  if (first) return { ...first, modelKey: primary, usedModelFallback: false };

  const fallback = resolveAiRecFallbackModel(primary);
  if (!fallback) return null;

  console.warn(
    `[v3-orchestrator] model ${primary} returned no content for ${opts.taskType}; retrying with fallback ${fallback}`
  );
  const fallbackMaxTokens = capAiRecFallbackMaxTokensForModel(fallback, opts.maxTokens);
  if (fallbackMaxTokens !== opts.maxTokens) {
    console.warn(
      `[v3-orchestrator] capped fallback ${fallback} maxTokens from ${opts.maxTokens} to ${fallbackMaxTokens} for ${opts.taskType}`
    );
  }
  const retry = await callLlm(messages, {
    ...opts,
    modelKey: fallback,
    maxTokens: fallbackMaxTokens,
    taskType: `${opts.taskType}_model_fallback`,
  });
  return retry ? { ...retry, modelKey: fallback, usedModelFallback: true } : null;
}

export type AiStockRecommendationV3Card = AiStockRecommendationV2 & {
  entry?: string;
  stop?: number | null;
  reason?: string;
  risk?: string;
};

// ── F1: Programmatic risk_off_score (deterministic — LLM cannot override) ─────

/**
 * Compute a programmatic risk_off_score BEFORE firing the LLM.
 *
 * 6 signals (楊董 SOP):
 *   S1: VIX > 25
 *   S2: VIX 5d change > 30%
 *   S3: DXY 60d Z-score > 1
 *   S4: US 10Y 20d rise > 25bp
 *   S5: WTI 10d rise > 10%
 *   S6: TAIEX < EMA60
 *
 * S1-S5 require external data sources not available in TWSE — fail-open (score=0).
 * S6 is computed from TWSE StockDay index level + EMA proxy.
 *
 * Fail-open contract: if any signal data is unavailable → signal = 0 (not 1).
 * This means programmatic score can only BLOCK when we have positive evidence.
 * A score of 0 means "data unavailable, do not block" — LLM still runs.
 *
 * Returns { score, signals, taiexIndex, taiexChangePct }
 */
export interface ProgrammaticRiskOffResult {
  score: number;
  signals: {
    vixAbove25: boolean;
    vix5dSpike: boolean;
    dxy60dZHigh: boolean;
    tenY20dUp: boolean;
    wti10dUp: boolean;
    taiexBelowEma60: boolean;
  };
  taiexIndex: number | null;
  taiexChangePct: number | null;
  dataSource: string;
  computedAt: string;
}

export async function computeProgrammaticRiskOffScore(): Promise<ProgrammaticRiskOffResult> {
  const result: ProgrammaticRiskOffResult = {
    score: 0,
    signals: {
      vixAbove25: false,
      vix5dSpike: false,
      dxy60dZHigh: false,
      tenY20dUp: false,
      wti10dUp: false,
      taiexBelowEma60: false,
    },
    taiexIndex: null,
    taiexChangePct: null,
    dataSource: "twse_openapi",
    computedAt: new Date().toISOString(),
  };

  try {
    // S1-S5: External data (VIX/DXY/10Y/WTI) — not available from TWSE.
    // These remain false (score=0) — fail-open.
    // TODO: wire Yahoo Finance or FRED API for these signals when available.

    // S6: TAIEX < EMA60
    // Use TWSE StockDay closing index to compute EMA60 proxy from index history.
    // Currently we only have today's close from MI_5MINS_INDEX — not enough for EMA60.
    // Fail-open: S6 = false when historical index data unavailable.
    const overview = await getMarketOverview();
    if (overview.taiex) {
      result.taiexIndex = overview.taiex.index;
      result.taiexChangePct = overview.taiex.changePct;

      // Try to compute EMA60 from DB if OHLCV index data exists
      // Fail-open: if no historical data, S6 = false
      const ema60 = await computeTaiexEma60FromDb();
      if (ema60 !== null && result.taiexIndex !== null && result.taiexIndex < ema60) {
        result.signals.taiexBelowEma60 = true;
        result.score += 1;
        console.info(`[v3-risk-off] S6 TAIEX(${result.taiexIndex}) < EMA60(${ema60}) → +1`);
      }
    }
  } catch (err) {
    console.warn("[v3-risk-off] computeProgrammaticRiskOffScore error:", err instanceof Error ? err.message : String(err));
  }

  console.info(`[v3-risk-off] programmatic risk_off_score = ${result.score}/6 (S1-S5 unavailable, S6 computed)`);
  return result;
}

/**
 * Compute TAIEX EMA60 from DB companies_ohlcv index data if available.
 * Uses index-level data if present, otherwise returns null (fail-open).
 */
async function computeTaiexEma60FromDb(): Promise<number | null> {
  try {
    const { getDb, isDatabaseMode } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return null;
    const db = getDb();
    if (!db) return null;

    const { sql } = await import("drizzle-orm");
    // Query TAIEX index history from DB if available (ticker = "^TWII" or "TAIEX")
    const rows = (await db.execute(sql`
      SELECT o.close AS close
      FROM companies_ohlcv o
      INNER JOIN companies c ON c.id = o.company_id
      WHERE (c.ticker = 'TAIEX' OR c.ticker = '^TWII' OR c.ticker = '0000')
        AND o.interval = '1d'
      ORDER BY o.dt DESC
      LIMIT 60
    `)) as unknown as { rows: Array<{ close: string }> };

    const closes = (rows.rows ?? [])
      .map(r => parseFloat(r.close))
      .filter(v => !isNaN(v) && v > 0);

    if (closes.length < 20) return null; // not enough data

    // Simple EMA60 (or EMA<N> with what we have)
    const n = Math.min(60, closes.length);
    const reversed = closes.slice(0, n).reverse(); // ascending
    const k = 2 / (n + 1);
    let ema = reversed[0]!;
    for (let i = 1; i < reversed.length; i++) {
      ema = reversed[i]! * k + ema * (1 - k);
    }
    return Math.round(ema * 100) / 100;
  } catch {
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AiRecTrigger = "cron_0930" | "cron_1300" | "cron_daily" | "manual_refresh" | "test";

export interface AiRecommendationV3RunOptions {
  workspaceId?: string | null;
  trigger?: AiRecTrigger;
  maxRounds?: number;
  costCapUsd?: number;
  runId?: string;
  dateStr?: string;
}

export interface AiRecommendationV3RunResult {
  runId: string;
  status: "running" | "complete" | "failed" | "budget_exceeded" | "market_risk_off" | "insufficient_tools" | "synthesis_format_error";
  generatedAt: string;
  items: AiStockRecommendationV2[];
  reactTrace: unknown[];
  finalReportMarkdown: string;
  totalCostUsd: number;
  totalTokens: number;
  marketState: AiRecMarketState | null;
  marketRiskOffScore: number | null;
  /** programmatic risk_off computation result (F1) */
  programmaticRiskOff: ProgrammaticRiskOffResult | null;
  synthesisRetryUsed?: boolean;
  synthesisFallbackUsed?: boolean;
  sourceState?: AiRecommendationV3SourceState;
  sourceStates?: Record<string, AiRecommendationV3SourceState>;
  officialAnnouncementSourceState?: AiRecommendationV3SourceState;
  dbRowId: string | null;
  /** Run-level score breakdown (computed after items parsed) */
  scoreBreakdown?: AiRecRunScoreBreakdown;
}

export interface AiRecommendationV3SourceState {
  state: "live" | "empty" | "degraded" | "pending";
  source: string;
  reason: string;
  owner: string;
  nextAction: string;
  lastUpdated: string | null;
  count?: number;
}

export interface AiRecommendationV3SourceState {
  state: "live" | "empty" | "degraded" | "pending";
  source: string;
  reason: string;
  owner: string;
  nextAction: string;
  lastUpdated: string | null;
  count?: number;
}

// ── In-memory cache (latest v3 run) ──────────────────────────────────────────

let _latestV3Cache: AiRecommendationV3RunResult | null = null;
let _latestV3CacheExpiresAt = 0;
const V3_CACHE_TTL_MS = 5 * 60 * 1000;
// Yang PR-A product gate: v3 must surface at least 5 actionable backed cards
// or remain non-complete. C bucket / high-risk-exclusion cards are useful as
// an exclusion list, but they are not recommendations and must not turn the
// product surface green.
const MIN_V3_RECOMMENDATION_ITEMS = 5;
// Max items the deterministic fallback will produce (independent of MIN threshold).
// This keeps the fallback producing a useful set even when MIN is low.
const MAX_V3_FALLBACK_ITEMS = 5;
const MIN_V3_TECHNICAL_CALLS = 5;
const V3_MULTIDIM_PREFETCH_CANDIDATES = 8;
const V3_COMPANY_NEWS_PREFETCH_CANDIDATES = 3;
const V3_BUCKET_A_PLUS_MIN_SCORE = 85;
const V3_BUCKET_A_MIN_SCORE = 75;
const V3_BUCKET_B_MIN_SCORE = 65;

function bucketFromTotalScoreV3(score: number | null | undefined): AiRecBucket | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  if (score >= V3_BUCKET_A_PLUS_MIN_SCORE) return "A+";
  if (score >= V3_BUCKET_A_MIN_SCORE) return "A";
  if (score >= V3_BUCKET_B_MIN_SCORE) return "B";
  return "C";
}

function normalizeBucketByScoreV3(bucket: AiRecBucket, score: number | null | undefined): AiRecBucket {
  return bucketFromTotalScoreV3(score) ?? bucket;
}

function isActionableRecommendationItem(item: AiStockRecommendationV2): boolean {
  if (item.isIncomplete) return false;
  if (item.bucket === "C") return false;
  if (item.action === "高風險排除") return false;
  if ((item.totalScore ?? 0) < V3_BUCKET_B_MIN_SCORE) return false;
  return true;
}

/** Count only actionable, complete recommendation items against the minimum threshold */
function completeItemCount(items: AiStockRecommendationV2[]): number {
  return items.filter(isActionableRecommendationItem).length;
}
// gpt-5.5 (reasoning model) synthesis over the candidate set takes 75–90s+ —
// the old 75s/90s timeout aborted it exactly at the limit (FETCH_ERROR,
// completionTokens=0 → empty content → deterministic fallback). Reasoning models
// need generous headroom; fast models finish well under these and are unaffected.
const V3_SYNTHESIS_TIMEOUT_MS = 240_000;
const V3_SYNTHESIS_RETRY_TIMEOUT_MS = 300_000;
export const V3_RUNNING_STALE_AFTER_MS = 45 * 60 * 1000;

export function getV3RunAgeMs(generatedAt: string, nowMs = Date.now()): number | null {
  const startedMs = Date.parse(generatedAt);
  if (!Number.isFinite(startedMs)) return null;
  return Math.max(0, nowMs - startedMs);
}

export function isV3RunningStale(status: AiRecommendationV3RunResult["status"], generatedAt: string, nowMs = Date.now()): boolean {
  if (status !== "running") return false;
  const ageMs = getV3RunAgeMs(generatedAt, nowMs);
  return ageMs !== null && ageMs > V3_RUNNING_STALE_AFTER_MS;
}

/** Taipei calendar date (YYYY-MM-DD) for a given epoch ms. */
export function taipeiDateOf(nowMs = Date.now()): string {
  return new Date(nowMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Daily cron fire window: 08:30–09:15 TST weekdays (pre-market, after EC2 gateway 08:20 start). */
export function isV3CronWindowAt(nowMs = Date.now()): boolean {
  const taipei = new Date(nowMs + 8 * 60 * 60 * 1000);
  const day = taipei.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hhmm = taipei.getUTCHours() * 100 + taipei.getUTCMinutes();
  return hhmm >= 830 && hhmm <= 915;
}

/**
 * Marks v3 rows stuck in status="running" older than minAgeMs as failed.
 * A run that crashes mid-loop (e.g. LLMBudgetExceeded) used to leave its row
 * "running" forever, which the read path then skipped for days.
 */
export async function failStaleV3RunningRows(opts: { minAgeMs: number; reason: string }): Promise<number> {
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return 0;
    const db = getDb();
    if (!db) return 0;
    const { sql, and, eq, lt } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - opts.minAgeMs);
    const rows = await db
      .update(aiRecommendationsRuns)
      .set({ status: "failed", finalReportMarkdown: opts.reason, completedAt: new Date() })
      .where(and(
        sql`${aiRecommendationsRuns.trigger} like ${`%${V3_TRIGGER_SUFFIX}`}`,
        eq(aiRecommendationsRuns.status, "running"),
        lt(aiRecommendationsRuns.generatedAt, cutoff)
      ))
      .returning({ id: aiRecommendationsRuns.id });
    if (rows.length > 0) {
      console.warn(`[ai-rec-v3] marked ${rows.length} stuck running run(s) as failed: ${opts.reason}`);
    }
    return rows.length;
  } catch (e) {
    console.warn("[ai-rec-v3] failStaleV3RunningRows failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * True if any v3 run row (any status) exists for the given Taipei calendar date.
 * Boot-fire guard: on 6/5 every deploy boot-fired a fresh v3 run, and a dozen
 * deploys in one day burned the whole LLM daily budget.
 */
export async function hasV3RunForTaipeiDate(dateStr: string): Promise<boolean> {
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return false;
    const db = getDb();
    if (!db) return false;
    const { sql, and, gte, lt } = await import("drizzle-orm");
    const dayStart = new Date(`${dateStr}T00:00:00+08:00`);
    if (!Number.isFinite(dayStart.getTime())) return false;
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ id: aiRecommendationsRuns.id })
      .from(aiRecommendationsRuns)
      .where(and(
        sql`${aiRecommendationsRuns.trigger} like ${`%${V3_TRIGGER_SUFFIX}`}`,
        gte(aiRecommendationsRuns.generatedAt, dayStart),
        lt(aiRecommendationsRuns.generatedAt, dayEnd)
      ))
      .limit(1);
    return rows.length > 0;
  } catch (e) {
    console.warn("[ai-rec-v3] hasV3RunForTaipeiDate failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

export type V3RunReadCandidate = {
  status: string;
  items?: unknown;
};

function v3RunCandidateItemCount(row: V3RunReadCandidate): number {
  return Array.isArray(row.items) ? row.items.length : 0;
}

function isReadableV3RunCandidate(row: V3RunReadCandidate): boolean {
  return row.status !== "running" && v3RunCandidateItemCount(row) > 0;
}

export function pickAiRecommendationV3RunForRead<T extends V3RunReadCandidate>(rows: T[]): T | null {
  const latest = rows[0];
  if (!latest) return null;
  if (isReadableV3RunCandidate(latest)) return latest;
  return rows.find((row) => row.status === "complete" && v3RunCandidateItemCount(row) > 0)
    ?? rows.find(isReadableV3RunCandidate)
    ?? latest;
}

export function getLatestAiRecommendationV3Run(): AiRecommendationV3RunResult | null {
  if (_latestV3Cache && Date.now() < _latestV3CacheExpiresAt) {
    return _latestV3Cache;
  }
  return null;
}

const V3_TRIGGER_SUFFIX = ":v3";

export function v3DbTrigger(trigger: AiRecTrigger): string {
  // 0042 allows the historical morning/afternoon/manual/test v3 trigger set.
  // The new once-daily scheduler is the same pre-market product run, so store it
  // under the allowed morning v3 bucket instead of creating an env-sensitive
  // migration just to add cron_daily:v3.
  if (trigger === "cron_daily") return "cron_0930:v3";
  return `${trigger}${V3_TRIGGER_SUFFIX}`;
}

async function persistV3RunStart(opts: {
  id: string;
  runId: string;
  workspaceId?: string | null;
  trigger: AiRecTrigger;
  model: string;
}): Promise<void> {
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return;
    const db = getDb();
    if (!db) return;
    await db.insert(aiRecommendationsRuns).values({
      id: opts.id,
      runId: opts.runId,
      workspaceId: opts.workspaceId ?? null,
      status: "running",
      trigger: v3DbTrigger(opts.trigger),
      model: opts.model,
      items: [],
      reactTrace: [],
    });
  } catch (e) {
    console.warn("[ai-rec-v3] persistV3RunStart failed:", e instanceof Error ? e.message : e);
  }
}

async function persistV3RunComplete(result: AiRecommendationV3RunResult, model: string): Promise<void> {
  if (!result.dbRowId) return;
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return;
    const db = getDb();
    if (!db) return;
    const { eq } = await import("drizzle-orm");
    await db
      .update(aiRecommendationsRuns)
      .set({
        status: result.status,
        items: result.items as unknown[],
        reactTrace: result.reactTrace,
        finalReportMarkdown: result.finalReportMarkdown,
        costUsd: result.totalCostUsd.toFixed(8),
        totalTokens: result.totalTokens,
        model,
        completedAt: new Date(),
        scoreBreakdown: result.scoreBreakdown ? (result.scoreBreakdown as unknown as Record<string, unknown>) : null,
      })
      .where(eq(aiRecommendationsRuns.id, result.dbRowId));
  } catch (e) {
    console.warn("[ai-rec-v3] persistV3RunComplete failed:", e instanceof Error ? e.message : e);
  }
}

async function finalizeV3Run(
  result: AiRecommendationV3RunResult,
  model: string,
  workspaceId?: string | null
): Promise<AiRecommendationV3RunResult> {
  const officialAnnouncementSourceState = deriveOfficialAnnouncementSourceStateFromTrace(
    result.reactTrace,
    result.generatedAt
  );
  const finalized: AiRecommendationV3RunResult = {
    ...result,
    items: await canonicalizeAiRecommendationV3Items(result.items, workspaceId),
    sourceState: {
      state: result.status === "complete" ? "live" : result.status === "synthesis_format_error" ? "degraded" : "pending",
      source: "ai_recommendations_runs",
      reason: result.status === "complete"
        ? "V3 推薦已完成，且股票卡片欄位已由後端統一正規化。"
        : `V3 推薦目前狀態為 ${result.status}。`,
      owner: "API",
      nextAction: result.status === "complete"
        ? "持續監控下游資料來源狀態。"
        : "先檢查 status、parserDiagnostic 與 LLM/tool trace，不得把未完成結果當正式推薦。",
      lastUpdated: result.generatedAt,
      count: result.items.length,
    },
    officialAnnouncementSourceState,
    sourceStates: {
      officialAnnouncements: officialAnnouncementSourceState,
    },
  };
  await persistV3RunComplete(finalized, model);
  _latestV3Cache = finalized;
  _latestV3CacheExpiresAt = Date.now() + V3_CACHE_TTL_MS;
  return finalized;
}

export async function loadLatestAiRecommendationV3RunFromDb(): Promise<AiRecommendationV3RunResult | null> {
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return null;
    const db = getDb();
    if (!db) return null;
    const { desc, sql } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(aiRecommendationsRuns)
      .where(sql`${aiRecommendationsRuns.trigger} like ${`%${V3_TRIGGER_SUFFIX}`}`)
      .orderBy(desc(aiRecommendationsRuns.generatedAt))
      .limit(10);
    const row = pickAiRecommendationV3RunForRead(rows);
    if (!row) return null;
    const result: AiRecommendationV3RunResult = {
      runId: row.runId,
      status: row.status as AiRecommendationV3RunResult["status"],
      generatedAt: row.generatedAt.toISOString(),
      items: (row.items ?? []) as AiStockRecommendationV2[],
      reactTrace: (row.reactTrace ?? []) as unknown[],
      finalReportMarkdown: row.finalReportMarkdown ?? "",
      totalCostUsd: Number(row.costUsd ?? 0),
      totalTokens: row.totalTokens ?? 0,
      marketState: null,
      marketRiskOffScore: null,
      programmaticRiskOff: null,
      synthesisRetryUsed: false,
      synthesisFallbackUsed:
        row.status === "synthesis_format_error" &&
        ((row.items ?? []) as unknown[]).length >= MIN_V3_RECOMMENDATION_ITEMS,
      dbRowId: row.id,
      // Restore score_breakdown from DB (migration 0043 column)
      scoreBreakdown: row.scoreBreakdown ? (row.scoreBreakdown as unknown as AiRecRunScoreBreakdown) : undefined,
    };
    const officialAnnouncementSourceState = deriveOfficialAnnouncementSourceStateFromTrace(
      result.reactTrace,
      result.generatedAt
    );
    return {
      ...result,
      items: await canonicalizeAiRecommendationV3Items(result.items, row.workspaceId ?? null),
      sourceState: {
        state: result.status === "complete" ? "live" : result.status === "synthesis_format_error" ? "degraded" : "pending",
        source: "ai_recommendations_runs",
        reason: result.status === "complete"
          ? "V3 推薦已從資料庫載入，且股票卡片欄位已由後端統一正規化。"
          : `V3 推薦目前狀態為 ${result.status}。`,
        owner: "API",
        nextAction: result.status === "complete"
          ? "持續監控下游資料來源狀態。"
          : "先檢查 status、parserDiagnostic 與 LLM/tool trace，不得把未完成結果當正式推薦。",
        lastUpdated: result.generatedAt,
        count: result.items.length,
      },
      officialAnnouncementSourceState,
      sourceStates: {
        officialAnnouncements: officialAnnouncementSourceState,
      },
    };
  } catch (e) {
    console.warn("[ai-rec-v3] loadLatestAiRecommendationV3RunFromDb failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getLatestAiRecommendationV3RunForRead(): Promise<AiRecommendationV3RunResult | null> {
  const cached = getLatestAiRecommendationV3Run();
  if (cached) return cached;
  const dbRun = await loadLatestAiRecommendationV3RunFromDb();
  if (!dbRun) return null;
  _latestV3Cache = dbRun;
  _latestV3CacheExpiresAt = Date.now() + V3_CACHE_TTL_MS;
  return dbRun;
}

export function _resetAiRecommendationV3Cache(): void {
  _latestV3Cache = null;
  _latestV3CacheExpiresAt = 0;
}

// ── Date helper ───────────────────────────────────────────────────────────────

function todayTst(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// ── Tool whitelist ────────────────────────────────────────────────────────────

const TOOL_WHITELIST_V3 = [
  "get_market_overview",
  "get_sector_rotation",
  "get_company_technical",
  "get_institutional_flow",
  "get_news_top10",
  "get_company_fundamentals",
  "get_supply_chain",
  "get_company_news",
] as const;

// ── dispatchTool ──────────────────────────────────────────────────────────────

async function dispatchMarketToolV3(
  toolName: string,
  toolInput: unknown,
  workspaceId?: string | null
): Promise<unknown> {
  return callTool(toolName, "brain_react", workspaceId, toolInput, async (input) => {
    switch (toolName) {
      case "get_market_overview":
        return getMarketOverview();
      case "get_sector_rotation": {
        const inp = input as { limit?: number } | null;
        return getSectorRotation(inp?.limit ?? 20);
      }
      case "get_company_technical": {
        const inp = input as { ticker?: string } | null;
        if (!inp?.ticker) return { error: "ticker_required" };
        return getCompanyTechnical(inp.ticker);
      }
      case "get_institutional_flow": {
        const inp = input as { ticker?: string } | null;
        if (!inp?.ticker) return { error: "ticker_required" };
        return getInstitutionalFlow(inp.ticker);
      }
      case "get_news_top10":
        return getNewsTop10();
      case "get_company_fundamentals": {
        const inp = input as { ticker?: string } | null;
        if (!inp?.ticker) return { error: "ticker_required" };
        return getCompanyFundamentals(inp.ticker);
      }
      case "get_supply_chain": {
        const inp = input as { ticker?: string } | null;
        if (!inp?.ticker) return { error: "ticker_required" };
        return getSupplyChain(inp.ticker);
      }
      case "get_company_news": {
        const inp = input as { ticker?: string } | null;
        if (!inp?.ticker) return { error: "ticker_required" };
        return getCompanyNews(inp.ticker);
      }
      default:
        throw new Error(`TOOL_NOT_FOUND: ${toolName} not in v3 whitelist`);
    }
  });
}

// ── Yang SOP system prompt (5-module strict) ──────────────────────────────────

function buildV3SystemPrompt(dateStr: string, programmaticRiskOffScore: number): string {
  const riskOffContext = `
=== SYSTEM-PROVIDED risk_off_score (DETERMINISTIC — DO NOT OVERRIDE) ===
系統已計算 programmatic risk_off_score = ${programmaticRiskOffScore}/6（基於可用市場資料）。
${programmaticRiskOffScore >= 3
  ? `risk_off_score >= 3 → 你必須回傳 RISK_OFF_SKIP，不推薦任何新倉。`
  : `risk_off_score < 3 → 你必須完整執行 STEP 2-5，輸出 ≥${MIN_V3_RECOMMENDATION_ITEMS} 檔可行動推薦（A+/A/B bucket）。
你不可自行判斷 risk-off 並 skip STEP 2-5。即使大盤單日跌 0.5%-1%，也必須繼續分析。
若輸出推薦數 < ${MIN_V3_RECOMMENDATION_ITEMS}，系統會自動 reject 並標記 insufficient_tools / synthesis_format_error。`}
=== END SYSTEM CONTEXT ===
`;

  return `你是 IUF 台股操盤師 AI，嚴格按楊董 SOP 6-module 框架執行多維度整合選股分析。
今天是 ${dateStr}（台北時間）。
${riskOffContext}
你有以下工具可用：${TOOL_WHITELIST_V3.join(", ")}

【重要】工具說明：
- get_market_overview：TAIEX 指數 + 量能 + 大盤狀態
- get_sector_rotation：類股輪動，按 avgChangePct 排序
- get_company_technical：個股技術面 (lastPrice/RSI/MA20/MA60/volumeRatio)
- get_institutional_flow：個股三大法人 30 日淨買賣
- get_news_top10：AI 精選市場新聞 10 則 (含 impact_tier/why_matters/tags)
- get_company_fundamentals：個股基本面 (月營收 YoY/MoM、EPS、毛利率、PER/PBR)
- get_supply_chain：個股產業鏈定位 (chainPosition/beneficiaryTier/上下游/主題)
- get_company_news：個股專屬新聞 (FinMind experimental，空 items 屬正常)

【美股隔夜/VIX/DXY/10Y/WTI：未接入。S1-S5 資料缺失，fail-open score=0，禁止幻覺推論美股訊號。】

---
[STEP 1] 市場狀態（前置條件 — 必須最先執行）
  先 callTool(get_market_overview)，從回傳資料補充確認市場狀態。
  trend_score = 1[C>EMA20] + 1[EMA20>EMA60] + 1[EMA60>EMA120] + 1[ADX14>22] + 1[RS20>0]（滿分5）
  range_score = 1[|C-EMA60|/EMA60<5%] + 1[ADX14<18] + 1[BBWidth<40pct]（滿分3）

  判斷優先序：risk-off > event > trend > range
  ★★ CRITICAL: 系統 programmatic risk_off_score = ${programmaticRiskOffScore}。
  ${programmaticRiskOffScore >= 3
    ? "risk_off_score >= 3 → 你必須在第一輪 toolName=null，thought 包含「RISK_OFF_SKIP」。"
    : `risk_off_score < 3 → 你絕對不可 RISK_OFF_SKIP。必須執行完整 STEP 2-6。
  若 event日（FOMC/CPI/法說 T-2~T+1 或振幅>2*ATR20）→ 市場狀態設 event，倉位倍率 0.5，但仍推薦。`}

[STEP 2] 主題穿透（risk_off_score < 3 時強制執行）
  callTool(get_news_top10) 識別當前強勢主題
    → 新聞中每個 item 帶有 ticker、impact_tier（HIGH/MID/LOW）、why_matters、tags
    → 優先關注 impact_tier=HIGH 或 MID 的 ticker
    → 排除 impact_tier=LOW 且 tags 只含「市場新聞」的非主題性新聞
  callTool(get_sector_rotation) 找資金流入板塊
    → sectors 按 avgChangePct 排序，取前 5 名板塊作為題材優先過濾
  根據楊董 4 層產業鏈框架定位標的：
    第一層龍頭（8分）| 第二層系統/模組（14分）| 第三層關鍵零件（16分）| 材料/設備（20分）
  排除「已 price in」：法人連5日大量買超且股價20日漲>30% 的公司直接跳過

[STEP 3] 個股 7 sub-score（每候選股 0-100 合計）
  ★★ 必須至少呼叫 get_company_technical ${MIN_V3_TECHNICAL_CALLS} 次（不同 ticker）。
  每個推薦標的都需要 get_company_technical 工具支撐，否則視為未驗證無效。

  ★★★ 技術資料空值處理（極重要，嚴格遵守）：
  當 get_company_technical 回傳 lastPrice=null（代表 DB 中無此股的 OHLCV 資料），
  該 ticker 視為「無法評分」，不得用 0 填寫評分，也不得列入推薦卡片。
  連續 2 次 get_company_technical 回傳 null → 立即停止嘗試新聞中的候選，
  改為依序呼叫下方核心候選清單，直到累積 ${MIN_V3_TECHNICAL_CALLS} 個有效 lastPrice > 0 的回傳。

  核心候選清單（有 OHLCV 歷史資料，優先使用）：
  2330（台積電）、2454（聯發科）、2317（鴻海）、2308（台達電）、3711（日月光投控）、
  3289（宜特）、3265（台星科）、3312（弘憶股）、2412（中華電）、3324（雙鴻）

  若 STEP 2 新聞有 ticker 且 impact_tier ≠ LOW → 先嘗試那些 ticker
  若 2 次 null → 切換到核心候選清單，不要繼續浪費輪次在無資料的冷門股上

  - 主題位置 /20（依 STEP 2 產業鏈層位判定；無法確認產業鏈位置 → 8 分，不要猜）
  - 營收/財報 /15（近3月YoY正且至少2月加速 → 滿分；只1月加速 → 8分；負成長 → 0；無資料 → 8）
  - 法人/ETF /15（5日外資+投信同向淨買超/20均量 > 0.5 → 滿；單向 → 8；流出 → 0；無資料 → 8）
  - 融資/借券/擁擠 /15（融資5日降溫 → 滿；持平 → 8；5日增>12%且股價漲>15% → 扣分至0；無資料 → 8）
  - 相對強弱量能 /10（RS20>0且突破量>1.3均量 → 滿；RS正但量不足 → 5；RS負 → 0；用 volumeRatio20d 與 changePct 判斷）
  - 技術結構 /20（aboveMa20+aboveMa60 同時 true + rsi14 45-75 → 14分以上；部分符合 → 按比例）
  - 估值/事件 /5（法說/除息/注意股等加減分；無事件 → 3）
  totalScore = 7個分數相加，最大100
  ★★★ 嚴禁在任何 sub-score 填寫 0 除非有明確負面訊號；「無資料」應填預設值而非 0

[STEP 3.5] 基本面驗證（強制執行，提升「營收/財報」sub-score 精準度）
  ★★ 對 STEP 3 有效技術資料的標的，各呼叫一次 callTool(get_company_fundamentals)。
  重點讀取：
  → monthlyRevenue[0..2]：最近 3 月的 yoy 值 — 判斷是 accelerating / positive / negative
  → epsLatestQuarter：最近一季 EPS（>0 為正成長）
  → grossMarginPct / operatingMarginPct：毛利率趨勢
  → per / pbr：估值水位（PER < 15 視為便宜；PER > 30 視為貴）
  ★★ dataAvailable=false 時：此標的財務面資料不可用，revenue sub-score 維持預設 8，
     不得編造任何財務數字。
  ★★ 基本面資料必須用於修正「營收/財報」分數（最大 ±5 分調整）：
     revenueYoyTrend=accelerating → +4；positive → +2；negative → -4；unavailable → 0
     EPS > 0 → +2；EPS < 0 → -2；無資料 → 0

[STEP 3.6] 產業鏈定位（強制執行，提升「主題位置」sub-score 精準度）
  ★★ 對 STEP 3 有效技術資料的標的，各呼叫一次 callTool(get_supply_chain)。
  重點讀取：
  → chainPosition：供應鏈層位（"CoAP_Chip"/"EMS"/"Material" 等）
  → beneficiaryTier："Core"(核心受益)/Direct/Indirect/Observation
  → themes：關聯投資主題（name + lifecycle，Expansion 最強）
  → suppliers/customers/peers：上下游關聯股（可輔助判斷受益傳導）
  ★★ dataAvailable=false 時：chainPosition 不明，theme sub-score 維持預設 8，不得猜測。
  ★★ beneficiaryTier 與楊董 4 層框架對應：
     Core ≈ 第一層龍頭（20分上限）；Direct ≈ 第二/三層（14-16分）；
     Indirect ≈ 第三/四層（10-14分）；Observation ≈ 觀察（8分）
  ★★ themes[0].lifecycle=Expansion → theme sub-score 可給到滿分；Crowded → -4

[STEP 3.7] 個股催化劑（選擇性執行，補充最重要的 2-3 個候選標的）
  對 STEP 3 最高分的前 3 個候選標的，各呼叫一次 callTool(get_company_news)。
  重點讀取：
  → state="live" + items：有個股專屬新聞 → 找法說/重大合約/除息/併購/AI 訂單等催化劑
  → state="empty"：此標的今日無個股新聞（正常，標注在 synthesis 中）
  → state="unavailable"：FinMind token 問題，此維度暫缺，分析時誠實標注
  ★★ items 有法說 / 重大合約 / 除息 / 轉機消息 → valuation/事件 sub-score +2 至 +5
  ★★ 禁止幻覺：state="empty"/"unavailable" 時，不得編造任何個股新聞。

[STEP 4] Bucket assign（依 totalScore）
  totalScore >= 85 → A+ 今日首選（0.8% NAV）
  75–84 → A 可觀察布局（0.6% NAV）
  65–74 → B 等回檔（0.4% NAV）
  < 65 → C 高風險排除（不開新倉）

[STEP 5] 每檔輸出（A+/A/B 才算推薦；C bucket 是排除名單）
  ★★ 最終輸出必須包含 ≥${MIN_V3_RECOMMENDATION_ITEMS} 檔真實資料支撐的 A+/A/B 推薦卡片（否則系統拒絕此次分析）。
  ★★ C bucket 可以輸出，但只能標示高風險排除 / 不開新倉，不可拿來湊推薦數。
  ★★ PARSER 格式規則（必須遵守，否則解析失敗）：
     - 每檔 heading 必須是「## XXXX 公司名」（兩個#，空格，4位數ticker，空格，中文名）
     - 不得用 ###、#### 或 **ticker** bold heading
     - 不得在 ticker heading 前後穿插任何非 ticker heading（例如 ## 市場分析 會被誤解析）
     - 所有欄位用「- 欄位名: 值」bullet 格式，不得用 markdown table
  格式嚴格如下（解析器依賴此格式）：
  進場區：OTE 0.618-0.705 回踩（具體價格區間）或突破後回測不破
  TP1：前波高 or 整數關（具體價格）
  TP2：月線上緣 or 年線頂部（具體價格）
  SL：結構失效點外 0.5 ATR（具體價格），上限 8%
  R值：(TP1-進場中點)/(進場中點-SL)
  信心：0.0-1.0
  ★★ 必加欄位「一句話理由」：≤80 字白話中文，說明為什麼現在可以買（給操盤師 5 秒快速判斷用）
  ★★★ 「一句話理由」必須同時引用 2 個以上維度（技術+法人、或技術+基本面、或基本面+產業鏈）

---
回應格式（每輪 JSON，無 markdown 包裝）：
{"thought": "<1-3句分析>", "toolName": "<工具名稱 or null>", "toolInput": <{...} or null>}

規則：
- 先完成 STEP 1（market overview），再 STEP 2（news+sector），再 STEP 3（技術/法人個股，≥5次）
- 接著 STEP 3.5（基本面，每個候選各一次），STEP 3.6（產業鏈，每個候選各一次），STEP 3.7（個股新聞，前3個）
- 至少執行 13 輪工具呼叫再給最終答案：
    1次overview + 1次news + 1次sector + 5次technical + 3次fundamentals + 3次supply_chain
  （company_news 若能多叫更好，但不是硬性最低門檻）
- 最終答案時 toolName=null，thought 包含完整多維度分析摘要
- ★★ 禁止在 risk_off_score < 3 時使用 RISK_OFF_SKIP（系統已驗證，LLM 不可 override）`;
}

// ── Yang SOP synthesis prompt ──────────────────────────────────────────────────
// Product policy: reports/spec/ai_recommendation_theme_penetration_sop_v1.md

function buildV3SynthesisPrompt(traceText: string, dateStr: string, programmaticRiskOffScore: number): string {
  return `你是 IUF 台股操盤師 AI。根據以下 ReAct 分析過程，輸出符合楊董 SOP 的深度個股推薦報告（${dateStr}）。

=== HARD GATE ===
system_programmatic_risk_off_score = ${programmaticRiskOffScore}/6
${programmaticRiskOffScore >= 3
  ? "只有在這個分數 >= 3 時，才可以輸出 RISK_OFF_FINAL_SKIP 並不推薦新倉。"
  : `這個分數 < 3，所以 RISK_OFF_FINAL_SKIP / RISK_OFF_SKIP 完全禁止。即使大盤偏弱，也要依據已查到的個股資料輸出至少 ${MIN_V3_RECOMMENDATION_ITEMS} 檔 A+/A/B 可行動卡片；C「高風險排除」只能放在排除名單，不可拿來湊推薦數。`}
=== END HARD GATE ===

=== 深度分析要求（CRITICAL — 違反視同輸出失敗）===
【每檔股票必須具備「該股專屬」的 thesis — 嚴禁套版】

A. 「為什麼買」欄位每一點都必須引用 trace 中該股的具體數據（多維度整合，至少引用2個維度）：
   - 技術結構：「收盤 XXX，突破月線 YYY，量 Z 萬張為近 20 日均量 A 倍」（取自 get_company_technical）
   - 法人買賣：「外資連續 X 日買超 Y 張，佔流通籌碼 Z%」（取自 get_institutional_flow 或 trace）
   - 基本面：「月營收 YoY X% 連續加速 / 最近季 EPS X 元 / 毛利率 X%」（取自 get_company_fundamentals trace）
   - 產業鏈定位：「供應鏈定位 [chainPosition]，屬楊董第N層 [beneficiaryTier] 受益股，主題 [theme] lifecycle=[lifecycle]」（取自 get_supply_chain trace）
   - 個股催化劑：「個股新聞 [具體標題/事件]，為本週近期催化劑」（取自 get_company_news 或 get_news_top10 trace）
   - 可辨別的數字就填數字；trace 中沒有對應數字就說「依 trace 基本面資料暫缺，維持預設分」而不是捏造數字

B. 「為什麼買」絕對禁止的套版句（會被自動檢測為 FAIL）：
   ❌ 「技術面良好」/ 「指標偏多」/ 「籌碼面穩定」/ 「市場認可」
   ❌ 「在台股當前環境下具有相對優勢」（無差異化，每股都能用）
   ❌ 把另一檔股票的新聞/法人數字直接搬來用（跨股複製）
   ❌ dataAvailable=false 時仍編造 EPS / 月營收數字（禁止幻覺）
   ✅ 正確示例（技術+法人+基本面）：「外資連 3 日買超 1.2 萬張 + 月營收 YoY +15% 加速 + 月線多頭排列突破頸線 XXX」
   ✅ 正確示例（技術+產業鏈+催化劑）：「供應鏈定位 CoAP_Chip 第三層，AI 伺服器主題 Expansion 期，上週法說釋利多，技術面 W 底突破 XXX」
   ✅ 正確示例（基本面缺資料時）：「技術面頸線 XXX 突破量縮回測 + 外資連 5 日淨買；基本面 FinMind 資料暫缺，維持預設分」

C. 「一句話理由」必須包含：[具體數字或事件] + [當下時機性] + [至少2個不同維度]
   ❌ 「具備長線投資價值」/ 「短期動能強勁」— 不具體，每股都能用
   ❌ 只引用技術面（RSI/均線）— 必須搭配法人 or 基本面 or 產業鏈 or 個股新聞
   ✅ 「月營收 YoY+22% 連加速 3 月 + 外資買超 + AI 伺服器族群，技術面突破月線 XXX」
   ✅ 「供應鏈第三層 CoAP 直接受益，上季 EPS X 元年增 Y%，法人連買，技術頸線突破待確認」

D. 跨股禁令：每支股票的理由必須互不相同。若 trace 顯示數檔股票都在同一族群，
   理由仍要區分各自的「本週新聞催化劑」或「具體技術位置」或「基本面差異」，不允許理由字字相同。

E. 美股隔夜/VIX/DXY：【未接入，不得在分析中編造美股隔夜訊號。如有相關判斷，應明確標注「美股資料未接入，僅依台股內部訊號判斷」。】

F. ORCHESTRATOR-PREFETCH 強制資料：trace 中若出現「[ORCHESTRATOR PREFETCH]」步驟，
   那是後端已對候選股程式化補抓的基本面/產業鏈/個股新聞資料，可信度等同 tool observation。
   每檔輸出的 reason/source/subScores 必須使用這些資料：
   - dataAvailable=true 時，revenue/margin/theme 不得停留在無資料預設分（revenue=8、margin=8、theme=10/8）。
   - dataAvailable=false 時，必須明寫「資料暫缺，維持預設分」，禁止補腦財務數字或產業鏈位置。
   - sourceTrail 會保留 get_company_fundamentals / get_supply_chain / get_company_news，請在理由中對應引用。
=== END 深度分析要求 ===

## 分析過程（以下為 ReAct trace，包含真實市場工具回傳數據）
${traceText}

---
## 輸出格式（CRITICAL — 必須嚴格遵守）

輸出必須是一個有效的 JSON 陣列，不得有任何 markdown 包裝（不要加 \`\`\`json ... \`\`\`，不要加說明文字）。
陣列中每個元素代表一支股票（A+/A/B 才算推薦；C 代表高風險排除、不開新倉）。

每個元素的 JSON 結構如下（所有欄位必填，不得省略）：
{
  "ticker": "4位數字代碼，例如2330",
  "companyName": "中文公司名稱",
  "action": "A+今日首選 | A可觀察布局 | B等回檔 | C高風險排除",
  "totalScore": 整數0-100,
  "marketState": "risk_off | event | trend | range",
  "subScores": {
    "theme": 整數0-20,
    "revenue": 整數0-15,
    "institutional": 整數0-15,
    "margin": 整數0-15,
    "rs": 整數0-10,
    "technical": 整數0-20,
    "valuation": 整數0-5
  },
  "entryLow": 數字（進場區低點，根據 lastPrice 計算，例如 lastPrice*0.98）,
  "entryHigh": 數字（進場區高點，例如 lastPrice*1.01）,
  "entryReason": "OTE 0.618-0.705 / 突破後回測不破 / 具體技術事件",
  "tp1": 數字（TP1 具體價格）,
  "tp1Reason": "前波高/整數關/具體技術位",
  "tp2": 數字（TP2 具體價格）,
  "tp2Reason": "月線上緣/年線/具體技術位",
  "stopLoss": 數字（停損具體價格）,
  "atrMultiple": 0.5,
  "rRatio": 數字（計算值）,
  "confidence": 數字0.0-1.0,
  "navPct": 數字（A+=0.008, A=0.006, B=0.004, C=0）,
  "marketMultiplier": 數字（1.0 | 0.9 | 0.7 | 0.6 | 0.5 | 0.4 | 0.3 | 0）,
  "whyBuy": ["bull thesis 第1點（含具體數字/事件）", "bull thesis 第2點（含具體數字/事件）"],
  "whyNotBuy": ["bear case 第1點（具體風險）", "bear case 第2點（具體風險）"],
  "oneLineReason": "≤80字，含具體數字/事件+當下時機性，每支股票必須與其他股票不同"
}

規則：
- 推薦 A+/A/B 的股票，至少 ${MIN_V3_RECOMMENDATION_ITEMS} 檔。
- C 分類只作為排除名單，不算推薦卡（可以包含在陣列中但 action 必須是「C高風險排除」）。
- 只有 system_programmatic_risk_off_score >= 3 時，才可輸出空陣列 [] 並在 JSON 外加一行說明（但通常 risk_off >= 3 已在系統層攔截）。
- 當 system_programmatic_risk_off_score < 3 時，禁止輸出空陣列。
- 使用真實市場資料（來自 ReAct trace），不要捏造數字。

=== 分數填寫規則（CRITICAL）===
1. 只為 get_company_technical 回傳 lastPrice > 0 的標的輸出股票卡。lastPrice=null 的代表 DB 無資料，不得輸出該 ticker。
2. 各 sub-score 「無資料」預設值：theme=10、revenue=8、institutional=8、margin=8、rs=5、technical=10、valuation=3。
   → 絕對不可因為「工具查不到」就把所有欄位填 0 — 0 代表有明確負面訊號（如融資大增、RS 轉負），不代表資料缺失。
3. confidence：有 lastPrice 資料 → 不得低於 0.4；無任何技術資料 → 不得輸出該 ticker。
4. entryLow/entryHigh/tp1/tp2/stopLoss：必須根據 lastPrice 計算實際數值。不得填寫 null 或 0 作為佔位符。
5. oneLineReason：必須具體說明「為什麼現在、為什麼這支股票」，不得用「風險高但值得觀察」這類套話。
6. 分數閾值（A+ >= 85, A = 75-84, B = 65-74, C < 65）必須嚴格遵守。totalScore 與 action 不能矛盾。
=== END 分數填寫規則 ===`;
}

// ── JSON Schema v3 — strict structured output definition ─────────────────────────────────────
//
// Used with OpenAI json_schema mode (strict=true). OpenAI guarantees the response matches
// this schema exactly — no markdown wrapping, no missing fields, no format surprises.
//
// OpenAI strict mode constraints:
//   - Root must be type:"object" (cannot be a top-level array)
//   - Every key must appear in `required`
//   - `additionalProperties: false` at every level
//
// We wrap the stock array in { items: [...] } so the root is an object.
// parseV3JsonSynthesis() already handles the {items:[...]} wrapper.

const V3_SYNTHESIS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["items"],
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: [
          "ticker", "companyName", "action", "totalScore", "marketState",
          "subScores", "entryLow", "entryHigh", "entryReason",
          "tp1", "tp1Reason", "tp2", "tp2Reason", "stopLoss",
          "atrMultiple", "rRatio", "confidence", "navPct", "marketMultiplier",
          "whyBuy", "whyNotBuy", "oneLineReason"
        ],
        additionalProperties: false,
        properties: {
          ticker:           { type: "string" },
          companyName:      { type: "string" },
          action:           { type: "string", enum: ["A+今日首選", "A可觀察布局", "B等回檔", "C高風險排除"] },
          totalScore:       { type: "number" },
          marketState:      { type: "string", enum: ["risk_off", "event", "trend", "range"] },
          subScores: {
            type: "object",
            required: ["theme", "revenue", "institutional", "margin", "rs", "technical", "valuation"],
            additionalProperties: false,
            properties: {
              theme:         { type: "number" },
              revenue:       { type: "number" },
              institutional: { type: "number" },
              margin:        { type: "number" },
              rs:            { type: "number" },
              technical:     { type: "number" },
              valuation:     { type: "number" },
            },
          },
          entryLow:         { type: "number" },
          entryHigh:        { type: "number" },
          entryReason:      { type: "string" },
          tp1:              { type: "number" },
          tp1Reason:        { type: "string" },
          tp2:              { type: "number" },
          tp2Reason:        { type: "string" },
          stopLoss:         { type: "number" },
          atrMultiple:      { type: "number" },
          rRatio:           { type: "number" },
          confidence:       { type: "number" },
          navPct:           { type: "number" },
          marketMultiplier: { type: "number" },
          whyBuy:           { type: "array", items: { type: "string" } },
          whyNotBuy:        { type: "array", items: { type: "string" } },
          oneLineReason:    { type: "string" },
        },
      },
    },
  },
};

// ── JSON parser v3 (primary — replaces fragile markdown parser for structured output) ──────────
//
// When synthesis is called with responseFormat:"json_schema", gpt-5.5 returns a schema-guaranteed
// JSON object with an "items" array. This parser converts that array into AiStockRecommendationV2[].
// The markdown parser below is retained as fallback for non-JSON model responses.

interface V3JsonStockItem {
  ticker?: unknown;
  companyName?: unknown;
  action?: unknown;
  totalScore?: unknown;
  marketState?: unknown;
  subScores?: unknown;
  entryLow?: unknown;
  entryHigh?: unknown;
  entryReason?: unknown;
  tp1?: unknown;
  tp1Reason?: unknown;
  tp2?: unknown;
  tp2Reason?: unknown;
  stopLoss?: unknown;
  atrMultiple?: unknown;
  rRatio?: unknown;
  confidence?: unknown;
  navPct?: unknown;
  marketMultiplier?: unknown;
  whyBuy?: unknown;
  whyNotBuy?: unknown;
  oneLineReason?: unknown;
}

/**
 * Parse a JSON array of stock items (from structured output) into AiStockRecommendationV2[].
 * Returns [] if the content is not a valid JSON array or has no parseable items.
 * Falls through silently — caller will use markdown parser as fallback.
 */
export function parseV3JsonSynthesis(
  content: string,
  dateStr: string
): AiStockRecommendationV2[] {
  if (!content || !content.trim()) return [];

  // Strip possible markdown code fences (defensive — json_object mode shouldn't add them,
  // but some model versions wrap anyway)
  const stripped = content.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Not valid JSON — fall through to markdown parser
    return [];
  }

  // Support both top-level array and {items: [...]} wrapper
  const rawArr: unknown[] = Array.isArray(parsed)
    ? parsed
    : (Array.isArray((parsed as Record<string, unknown>)?.["items"])
      ? (parsed as Record<string, unknown>)["items"] as unknown[]
      : []);

  if (rawArr.length === 0) return [];

  const yearTickerRe = /^(201\d|202[0-9]|203[0-5])$/;
  const results: AiStockRecommendationV2[] = [];

  for (const rawItem of rawArr) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
    const item = rawItem as V3JsonStockItem;

    const ticker = typeof item.ticker === "string" ? item.ticker.trim() : null;
    if (!ticker || !/^\d{4,6}[A-Z]?$/.test(ticker) || yearTickerRe.test(ticker)) continue;

    // Parse action → bucket
    const actionRaw = typeof item.action === "string" ? item.action : "";
    const bucketResult = parseBucket(actionRaw);

    // Company name
    const companyName = typeof item.companyName === "string" && item.companyName.trim()
      ? item.companyName.trim()
      : (CORE_COMPANY_NAMES[ticker] ?? ticker);
    const canonicalName = CORE_COMPANY_NAMES[ticker] ?? companyName;

    // Market state
    const marketState = parseMarketStateV3(
      typeof item.marketState === "string" ? item.marketState : "trend"
    );

    // Total score
    const totalScoreRaw = toFiniteNumber(item.totalScore);
    const totalScore = totalScoreRaw !== null ? Math.round(clampNumber(totalScoreRaw, 0, 100)) : null;

    // Sub-scores
    const ss = item.subScores && typeof item.subScores === "object" && !Array.isArray(item.subScores)
      ? item.subScores as Record<string, unknown>
      : {};
    const subScores = {
      theme: Math.round(clampNumber(toFiniteNumber(ss["theme"]) ?? 10, 0, 20)),
      revenue: Math.round(clampNumber(toFiniteNumber(ss["revenue"]) ?? 8, 0, 15)),
      institutional: Math.round(clampNumber(toFiniteNumber(ss["institutional"]) ?? 8, 0, 15)),
      margin: Math.round(clampNumber(toFiniteNumber(ss["margin"]) ?? 8, 0, 15)),
      rs: Math.round(clampNumber(toFiniteNumber(ss["rs"]) ?? 5, 0, 10)),
      technical: Math.round(clampNumber(toFiniteNumber(ss["technical"]) ?? 10, 0, 20)),
      valuation: Math.round(clampNumber(toFiniteNumber(ss["valuation"]) ?? 3, 0, 5)),
    };

    // Entry zone
    const entryLow = toFiniteNumber(item.entryLow);
    const entryHigh = toFiniteNumber(item.entryHigh);
    const entryReason = typeof item.entryReason === "string" ? item.entryReason : "";

    // Targets
    const tp1 = toFiniteNumber(item.tp1);
    const tp1Reason = typeof item.tp1Reason === "string" ? item.tp1Reason : "";
    const tp2 = toFiniteNumber(item.tp2);
    const tp2Reason = typeof item.tp2Reason === "string" ? item.tp2Reason : "";
    const slPrice = toFiniteNumber(item.stopLoss);
    const slAtrMultiple = toFiniteNumber(item.atrMultiple) ?? 0.5;
    const rRatio = toFiniteNumber(item.rRatio);

    // Position
    const confidence = toFiniteNumber(item.confidence) ?? (
      bucketResult.bucket === "A+" ? 0.85 : bucketResult.bucket === "A" ? 0.70 : 0.55
    );
    const navPct = toFiniteNumber(item.navPct) ?? (
      bucketResult.bucket === "A+" ? 0.008 : bucketResult.bucket === "A" ? 0.006 : 0.004
    );
    const marketMultiplier = toFiniteNumber(item.marketMultiplier) ?? 1.0;

    // Why buy / not buy
    const whyBuyArr = Array.isArray(item.whyBuy)
      ? (item.whyBuy as unknown[]).map(s => String(s ?? "").trim()).filter(s => s.length > 2)
      : (typeof item.whyBuy === "string" ? item.whyBuy.split(/[;；]/).map(s => s.trim()).filter(Boolean) : []);
    const whyNotBuyArr = Array.isArray(item.whyNotBuy)
      ? (item.whyNotBuy as unknown[]).map(s => String(s ?? "").trim()).filter(s => s.length > 2)
      : (typeof item.whyNotBuy === "string" ? item.whyNotBuy.split(/[;；]/).map(s => s.trim()).filter(Boolean) : []);

    // One-line reason
    const oneLineReason = typeof item.oneLineReason === "string"
      ? item.oneLineReason.trim().slice(0, 80)
      : undefined;

    // Computed total from sub-scores if not provided
    const computedTotal = subScores.theme + subScores.revenue + subScores.institutional +
      subScores.margin + subScores.rs + subScores.technical + subScores.valuation;

    const rec: AiStockRecommendationV2 = {
      id: randomUUID(),
      ticker,
      companyName: canonicalName,
      action: bucketResult.action,
      date: dateStr,
      confidence: clampNumber(confidence, 0, 1),
      rationale: oneLineReason ?? whyBuyArr.join("; ") ?? "",
      entryPriceRange: (entryLow !== null || entryHigh !== null)
        ? { low: entryLow, high: entryHigh }
        : null,
      tp1,
      tp2,
      stopLoss: slPrice,
      aiGenerated: true,
      source: "brain_react_v2",
      marketState,
      marketScores: undefined,
      subScores,
      totalScore: totalScore ?? computedTotal,
      bucket: bucketResult.bucket,
      entryZone: (entryLow !== null || entryHigh !== null) ? {
        low: entryLow,
        high: entryHigh,
        reason: entryReason || undefined,
      } : undefined,
      tp1Structured: tp1 !== null ? { price: tp1, reason: tp1Reason || undefined } : undefined,
      tp2Structured: tp2 !== null ? { price: tp2, reason: tp2Reason || undefined } : undefined,
      stopLossStructured: slPrice !== null ? {
        price: slPrice,
        atr_multiple: slAtrMultiple,
      } : undefined,
      r_ratio: rRatio ?? undefined,
      position_sizing: {
        nav_pct: clampNumber(navPct, 0, 1),
        market_multiplier: clampNumber(marketMultiplier, 0, 2),
      },
      why_buy: whyBuyArr.length > 0 ? whyBuyArr : undefined,
      why_not_buy: whyNotBuyArr.length > 0 ? whyNotBuyArr : undefined,
      whyBuyBrief: oneLineReason ?? buildWhyBuyBrief(whyBuyArr.length > 0 ? whyBuyArr : undefined),
    };

    if (!results.some(r => r.ticker === ticker)) {
      results.push(rec);
    }
  }

  return results;
}

// ── Markdown parser v3 ────────────────────────────────────────────────────────

function parseFloat2v3(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : n;
}

function extractPriceRangeV3(line: string): { low: number | null; high: number | null } {
  const m = line.match(/(\d+(?:\.\d+)?)\s*[-~～至到]\s*(\d+(?:\.\d+)?)/);
  if (m) return { low: parseFloat2v3(m[1]), high: parseFloat2v3(m[2]) };
  const single = line.match(/(\d{2,5}(?:\.\d+)?)/);
  if (single) {
    const v = parseFloat2v3(single[1]);
    return { low: v, high: v };
  }
  return { low: null, high: null };
}

function parseBucket(text: string): { bucket: AiRecBucket; action: AiStockRecommendationV2["action"] } {
  if (/A\+|A\+今日首選/.test(text) || /今日首選/.test(text)) {
    return { bucket: "A+", action: "今日首選" };
  }
  if (/^A可觀察|A 可觀察|A(?:\s|$)/.test(text) && !/A\+/.test(text)) {
    return { bucket: "A", action: "可觀察布局（研究參考）" };
  }
  if (/B等回檔|B 等回檔|等回檔/.test(text)) {
    return { bucket: "B", action: "等回檔" };
  }
  if (/C高風險|C 高風險|高風險排除/.test(text)) {
    return { bucket: "C", action: "高風險排除" };
  }
  // Fallback inference from 分類 line
  if (/今日首選/.test(text)) return { bucket: "A+", action: "今日首選" };
  if (/可觀察/.test(text)) return { bucket: "A", action: "可觀察布局（研究參考）" };
  if (/等回檔/.test(text)) return { bucket: "B", action: "等回檔" };
  return { bucket: "C", action: "高風險排除" };
}

function parseMarketStateV3(text: string): AiRecMarketState {
  if (/risk_off/.test(text)) return "risk_off";
  if (/event/.test(text)) return "event";
  if (/trend/.test(text)) return "trend";
  return "range";
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function joinAliasLines(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const joined = value
      .map(line => String(line ?? "").trim())
      .filter(Boolean)
      .join("; ");
    return joined || undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return undefined;
}

function formatEntryAlias(item: AiStockRecommendationV2): string | undefined {
  const low = toFiniteNumber(item.entryZone?.low ?? item.entryPriceRange?.low);
  const high = toFiniteNumber(item.entryZone?.high ?? item.entryPriceRange?.high);
  if (low !== null && high !== null) return low === high ? String(low) : `${low}-${high}`;
  if (low !== null) return String(low);
  if (high !== null) return String(high);
  return undefined;
}

function formatRiskAlias(item: AiStockRecommendationV2): string {
  return joinAliasLines(item.why_not_buy)
    ?? (item.stopLossStructured?.price || item.stopLoss
      ? "模型未明列額外風險；請以停損價與部位控管執行"
      : "模型未明列額外風險；請先確認資料完整度再操作");
}

function withV3ContractAliases(item: AiStockRecommendationV2): AiStockRecommendationV3Card {
  const aliased = item as AiStockRecommendationV3Card;
  const stop = toFiniteNumber(item.stopLossStructured?.price ?? item.stopLoss);
  return {
    ...item,
    entry: aliased.entry ?? formatEntryAlias(item),
    stop: aliased.stop ?? stop,
    reason: aliased.reason ?? item.whyBuyBrief ?? item.rationale,
    risk: aliased.risk ?? formatRiskAlias(item),
  };
}

function withCanonicalCompanyName(
  item: AiStockRecommendationV2,
  namesByTicker: Map<string, string>
): AiStockRecommendationV2 {
  const canonical = namesByTicker.get(item.ticker) ?? CORE_COMPANY_NAMES[item.ticker] ?? null;
  if (!canonical || canonical === item.companyName) return item;
  return { ...item, companyName: canonical };
}

export function canonicalizeAiRecommendationV3ItemsWithMap(
  items: AiStockRecommendationV2[],
  namesByTicker: Map<string, string>
): AiStockRecommendationV2[] {
  return items.map((item) => withCanonicalCompanyName(item, namesByTicker));
}

export async function canonicalizeAiRecommendationV3Items(
  items: AiStockRecommendationV2[],
  workspaceId?: string | null
): Promise<AiStockRecommendationV2[]> {
  if (items.length === 0) return items;
  const namesByTicker = new Map<string, string>();
  try {
    const { getDb, isDatabaseMode, companies } = await import("@iuf-trading-room/db");
    if (isDatabaseMode()) {
      const db = getDb();
      if (db) {
        const { and, eq, inArray } = await import("drizzle-orm");
        const tickers = Array.from(new Set(items.map((item) => item.ticker).filter(Boolean)));
        const where = workspaceId
          ? and(eq(companies.workspaceId, workspaceId), inArray(companies.ticker, tickers))
          : inArray(companies.ticker, tickers);
        const rows = await db
          .select({ ticker: companies.ticker, name: companies.name })
          .from(companies)
          .where(where);
        for (const row of rows) {
          if (row.ticker && row.name) namesByTicker.set(row.ticker, row.name);
        }
      }
    }
  } catch (err) {
    console.warn("[ai-rec-v3] company-name canonical DB lookup failed:", err instanceof Error ? err.message : err);
  }

  return canonicalizeAiRecommendationV3ItemsWithMap(items, namesByTicker);
}

function traceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isOfficialAnnouncementSource(source: unknown): boolean {
  if (typeof source !== "string") return false;
  const normalized = source.trim().toLowerCase();
  return (
    normalized === "twse_announcements" ||
    normalized === "mops" ||
    normalized === "official_announcements" ||
    normalized.includes("t187ap11") ||
    normalized.includes("announcement") ||
    normalized.includes("mops")
  );
}

export function deriveOfficialAnnouncementSourceStateFromTrace(
  trace: unknown[],
  fallbackUpdatedAt: string | null = null
): AiRecommendationV3SourceState {
  const steps = Array.isArray(trace) ? trace : [];
  const newsStep = steps
    .map(traceRecord)
    .find((step) => step?.["toolName"] === "get_news_top10");

  if (!newsStep) {
    return {
      state: "pending",
      source: "get_news_top10",
      reason: "本輪 V3 trace 尚未包含新聞工具結果，無法判斷官方公告是否已納入。",
      owner: "API",
      nextAction: "下一輪 V3 refresh 必須執行 get_news_top10，並回傳官方公告來源狀態。",
      lastUpdated: fallbackUpdatedAt,
      count: 0,
    };
  }

  const observation = traceRecord(newsStep["observation"]);
  const items = Array.isArray(observation?.["items"]) ? observation["items"] as unknown[] : [];
  const officialCount = items.filter((item) => {
    const record = traceRecord(item);
    return isOfficialAnnouncementSource(record?.["source"]);
  }).length;
  const asOf = typeof observation?.["asOf"] === "string"
    ? observation["asOf"] as string
    : fallbackUpdatedAt;

  if (officialCount > 0) {
    return {
      state: "live",
      source: "get_news_top10",
      reason: `本輪新聞工具已納入 ${officialCount} 則官方公告。`,
      owner: "API",
      nextAction: "持續由新聞工具與市場情報 cron 更新。",
      lastUpdated: asOf,
      count: officialCount,
    };
  }

  return {
    state: "empty",
    source: "get_news_top10",
    reason: `本輪新聞工具已檢查 ${items.length} 則市場情報，但沒有官方公告項目；推薦使用可用市場新聞與技術資料產生。`,
    owner: "API",
    nextAction: "等待官方公告來源出現新資料；不得用新聞假裝官方公告。",
    lastUpdated: asOf,
    count: 0,
  };
}

function toBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

const CORE_COMPANY_NAMES: Record<string, string> = {
  "2330": "台積電",
  "2454": "聯發科",
  "2317": "鴻海",
  "2308": "台達電",
  "2412": "中華電",
  "3711": "日月光投控",
  "3707": "漢磊",
  "2882": "國泰金",
  "2881": "富邦金",
  "6505": "台塑化",
};

interface TechnicalObservationForFallback {
  ticker: string;
  companyName: string | null;
  lastPrice: number;
  changePct: number | null;
  rsi14: number | null;
  ma20: number | null;
  ma60: number | null;
  volumeRatio20d: number | null;
  aboveMa20: boolean;
  aboveMa60: boolean;
  source: string | null;
}

function extractTechnicalObservationForFallback(step: V3ReActStep): TechnicalObservationForFallback | null {
  if (step.toolName !== "get_company_technical") return null;
  if (!step.observation || typeof step.observation !== "object") return null;

  const obs = step.observation as Record<string, unknown>;
  const ticker = typeof obs["ticker"] === "string" ? obs["ticker"] : null;
  const lastPrice = toFiniteNumber(obs["lastPrice"]);
  if (!ticker || lastPrice === null || lastPrice <= 0) return null;

  return {
    ticker,
    companyName: typeof obs["companyName"] === "string" && obs["companyName"].trim()
      ? obs["companyName"].trim()
      : null,
    lastPrice,
    changePct: toFiniteNumber(obs["changePct"]),
    rsi14: toFiniteNumber(obs["rsi14"]),
    ma20: toFiniteNumber(obs["ma20"]),
    ma60: toFiniteNumber(obs["ma60"]),
    volumeRatio20d: toFiniteNumber(obs["volumeRatio20d"]),
    aboveMa20: toBool(obs["aboveMa20"]),
    aboveMa60: toBool(obs["aboveMa60"]),
    source: typeof obs["source"] === "string" ? obs["source"] : null,
  };
}

function technicalFallbackRank(obs: TechnicalObservationForFallback): number {
  let score = 50;
  if (obs.aboveMa20) score += 10;
  if (obs.aboveMa60) score += 10;
  if ((obs.changePct ?? 0) > 0) score += 5;
  if (obs.rsi14 !== null && obs.rsi14 >= 45 && obs.rsi14 <= 75) score += 8;
  if (obs.volumeRatio20d !== null && obs.volumeRatio20d >= 0.5) score += 5;
  if (obs.volumeRatio20d !== null && obs.volumeRatio20d > 1.5) score -= 5;
  return clampNumber(score, 0, 100);
}

interface V3MultiDimPrefetchStats {
  candidateTickers: string[];
  fundamentalsCalls: number;
  supplyChainCalls: number;
  companyNewsCalls: number;
  appendedSteps: number;
}

function emptyV3MultiDimPrefetchStats(): V3MultiDimPrefetchStats {
  return {
    candidateTickers: [],
    fundamentalsCalls: 0,
    supplyChainCalls: 0,
    companyNewsCalls: 0,
    appendedSteps: 0,
  };
}

function traceHasTickerToolObservation(
  trace: V3ReActStep[],
  toolName: string,
  ticker: string
): boolean {
  return trace.some((step) => {
    if (step.toolName !== toolName) return false;
    const input = traceRecord(step.toolInput);
    const obs = traceRecord(step.observation);
    return input?.["ticker"] === ticker || obs?.["ticker"] === ticker;
  });
}

function nextTraceRound(trace: V3ReActStep[]): number {
  const maxRound = trace.reduce((max, step) => Math.max(max, step.round), 0);
  return maxRound + 1;
}

export function extractV3MultiDimPrefetchCandidatesFromTrace(
  trace: V3ReActStep[],
  limit = V3_MULTIDIM_PREFETCH_CANDIDATES
): TechnicalObservationForFallback[] {
  const byTicker = new Map<string, TechnicalObservationForFallback>();
  for (const step of trace) {
    const obs = extractTechnicalObservationForFallback(step);
    if (!obs) continue;
    if (!byTicker.has(obs.ticker)) byTicker.set(obs.ticker, obs);
  }

  return Array.from(byTicker.values())
    .map((obs) => ({ obs, rank: technicalFallbackRank(obs) }))
    .sort((a, b) =>
      b.rank - a.rank ||
      (b.obs.changePct ?? -999) - (a.obs.changePct ?? -999) ||
      a.obs.ticker.localeCompare(b.obs.ticker)
    )
    .slice(0, limit)
    .map(({ obs }) => obs);
}

async function appendProgrammaticToolStep(
  trace: V3ReActStep[],
  toolName: "get_company_fundamentals" | "get_supply_chain" | "get_company_news",
  ticker: string,
  workspaceId?: string | null
): Promise<void> {
  let observation: unknown;
  try {
    observation = await dispatchMarketToolV3(toolName, { ticker }, workspaceId);
  } catch (err) {
    observation = { ticker, error: err instanceof Error ? err.message : String(err) };
  }

  trace.push({
    round: nextTraceRound(trace),
    thought: `[ORCHESTRATOR PREFETCH] deterministic ${toolName} for ${ticker} before synthesis.`,
    toolName,
    toolInput: { ticker },
    observation,
    tokensUsed: 0,
  });
}

async function ensureV3MultiDimPrefetchBeforeSynthesis(
  trace: V3ReActStep[],
  workspaceId?: string | null
): Promise<V3MultiDimPrefetchStats> {
  const candidates = extractV3MultiDimPrefetchCandidatesFromTrace(trace);
  const stats = emptyV3MultiDimPrefetchStats();
  stats.candidateTickers = candidates.map((candidate) => candidate.ticker);
  if (candidates.length === 0) return stats;

  for (const candidate of candidates) {
    if (traceHasTickerToolObservation(trace, "get_company_fundamentals", candidate.ticker)) continue;
    await appendProgrammaticToolStep(trace, "get_company_fundamentals", candidate.ticker, workspaceId);
    stats.fundamentalsCalls++;
    stats.appendedSteps++;
  }

  for (const candidate of candidates) {
    if (traceHasTickerToolObservation(trace, "get_supply_chain", candidate.ticker)) continue;
    await appendProgrammaticToolStep(trace, "get_supply_chain", candidate.ticker, workspaceId);
    stats.supplyChainCalls++;
    stats.appendedSteps++;
  }

  for (const candidate of candidates.slice(0, V3_COMPANY_NEWS_PREFETCH_CANDIDATES)) {
    if (traceHasTickerToolObservation(trace, "get_company_news", candidate.ticker)) continue;
    await appendProgrammaticToolStep(trace, "get_company_news", candidate.ticker, workspaceId);
    stats.companyNewsCalls++;
    stats.appendedSteps++;
  }

  console.info(
    `[v3-orchestrator] deterministic multidim prefetch: candidates=${stats.candidateTickers.join(",") || "(none)"}, ` +
    `fundamentals=${stats.fundamentalsCalls}, supply_chain=${stats.supplyChainCalls}, company_news=${stats.companyNewsCalls}`
  );
  return stats;
}

function getFundamentalsTraceByTicker(trace: V3ReActStep[]): Map<string, CompanyFundamentalsObservation> {
  const byTicker = new Map<string, CompanyFundamentalsObservation>();
  for (const step of trace) {
    if (step.toolName !== "get_company_fundamentals") continue;
    const obs = traceRecord(step.observation);
    const ticker = typeof obs?.["ticker"] === "string" ? obs["ticker"] as string : null;
    if (!ticker) continue;
    byTicker.set(ticker, obs as unknown as CompanyFundamentalsObservation);
  }
  return byTicker;
}

function getSupplyChainTraceByTicker(trace: V3ReActStep[]): Map<string, SupplyChainObservation> {
  const byTicker = new Map<string, SupplyChainObservation>();
  for (const step of trace) {
    if (step.toolName !== "get_supply_chain") continue;
    const obs = traceRecord(step.observation);
    const ticker = typeof obs?.["ticker"] === "string" ? obs["ticker"] as string : null;
    if (!ticker) continue;
    byTicker.set(ticker, obs as unknown as SupplyChainObservation);
  }
  return byTicker;
}

function getCompanyNewsTraceByTicker(trace: V3ReActStep[]): Map<string, CompanyNewsObservation> {
  const byTicker = new Map<string, CompanyNewsObservation>();
  for (const step of trace) {
    if (step.toolName !== "get_company_news") continue;
    const obs = traceRecord(step.observation);
    const ticker = typeof obs?.["ticker"] === "string" ? obs["ticker"] as string : null;
    if (!ticker) continue;
    byTicker.set(ticker, obs as unknown as CompanyNewsObservation);
  }
  return byTicker;
}

export function scoreV3RevenueFromFundamentals(fundamentals: CompanyFundamentalsObservation | null | undefined): number {
  if (!fundamentals?.dataAvailable) return 8;
  let score = 8;
  switch (fundamentals.revenueYoyTrend) {
    case "accelerating":
      score += 4;
      break;
    case "positive":
      score += 2;
      break;
    case "decelerating":
      score -= 1;
      break;
    case "negative":
      score -= 4;
      break;
  }

  const monthlyRevenue = Array.isArray(fundamentals.monthlyRevenue) ? fundamentals.monthlyRevenue : [];
  const latestYoy = monthlyRevenue
    .map((month) => month.yoy)
    .find((value): value is number => value !== null);
  if (latestYoy !== undefined) {
    if (latestYoy >= 20) score += 2;
    else if (latestYoy > 0) score += 1;
    else if (latestYoy < 0) score -= 3;
  }

  const eps = toFiniteNumber(fundamentals.epsLatestQuarter);
  if (eps !== null) {
    if (eps > 0) score += 2;
    else if (eps < 0) score -= 2;
  }

  return Math.round(clampNumber(score, 0, 15));
}

export function scoreV3MarginFromFundamentals(fundamentals: CompanyFundamentalsObservation | null | undefined): number {
  if (!fundamentals?.dataAvailable) return 8;
  const gross = toFiniteNumber(fundamentals.grossMarginPct);
  const operating = toFiniteNumber(fundamentals.operatingMarginPct);
  const eps = toFiniteNumber(fundamentals.epsLatestQuarter);
  const hasMarginData = gross !== null || operating !== null || eps !== null;
  if (!hasMarginData) return 8;

  let score = 8;
  if (gross !== null) {
    if (gross >= 50) score += 4;
    else if (gross >= 35) score += 3;
    else if (gross >= 20) score += 2;
    else if (gross > 0) score += 1;
    else score -= 2;
  }

  if (operating !== null) {
    if (operating >= 25) score += 3;
    else if (operating >= 15) score += 2;
    else if (operating > 0) score += 1;
    else score -= 3;
  }

  if (eps !== null) {
    if (eps > 0) score += 1;
    else if (eps < 0) score -= 2;
  }

  return Math.round(clampNumber(score, 0, 15));
}

function scoreV3ValuationFromFundamentals(fundamentals: CompanyFundamentalsObservation | null | undefined): number | null {
  const per = toFiniteNumber(fundamentals?.per);
  if (!fundamentals?.dataAvailable || per === null) return null;
  if (per <= 0) return 3;
  if (per < 15) return 5;
  if (per <= 25) return 4;
  if (per <= 35) return 3;
  if (per <= 50) return 2;
  return 1;
}

export function scoreV3ThemeFromSupplyChain(
  supplyChain: SupplyChainObservation | null | undefined,
  fallbackScore = 10
): number {
  if (!supplyChain?.dataAvailable) return Math.round(clampNumber(fallbackScore, 0, 20));

  const tier = String(supplyChain.beneficiaryTier ?? "").toLowerCase();
  let score = tier === "core" ? 18
    : tier === "direct" ? 15
    : tier === "indirect" ? 12
    : tier === "observation" ? 9
    : 10;

  if (supplyChain.chainPosition) score += 1;

  const themes = Array.isArray(supplyChain.themes) ? supplyChain.themes : [];
  const lifecycles = themes.map((theme) => theme.lifecycle.toLowerCase());
  if (lifecycles.some((lifecycle) => lifecycle.includes("expansion"))) score += 2;
  if (lifecycles.some((lifecycle) => lifecycle.includes("growth"))) score += 1;
  if (lifecycles.some((lifecycle) => lifecycle.includes("crowded"))) score -= 4;

  return Math.round(clampNumber(score, 0, 20));
}

function buildV3MultiDimBullets(
  fundamentals: CompanyFundamentalsObservation | null | undefined,
  supplyChain: SupplyChainObservation | null | undefined,
  companyNews: CompanyNewsObservation | null | undefined
): { whyBuy: string[]; whyNotBuy: string[] } {
  const whyBuy: string[] = [];
  const whyNotBuy: string[] = [];

  if (fundamentals) {
    if (fundamentals.dataAvailable) {
      const monthlyRevenue = Array.isArray(fundamentals.monthlyRevenue) ? fundamentals.monthlyRevenue : [];
      const latestRevenue = monthlyRevenue[0];
      const yoyText = latestRevenue && latestRevenue.yoy !== null && latestRevenue.yoy !== undefined
        ? `${latestRevenue.month}月營收YoY ${latestRevenue.yoy}%`
        : `月營收趨勢 ${fundamentals.revenueYoyTrend}`;
      whyBuy.push(
        `基本面已驗證：${yoyText}，EPS ${fundamentals.epsLatestQuarter ?? "n/a"}，毛利率 ${fundamentals.grossMarginPct ?? "n/a"}%，PER ${fundamentals.per ?? "n/a"}。`
      );
    } else {
      whyNotBuy.push(`基本面資料暫缺：FinMind ${fundamentals.reason}，revenue/margin 維持預設分。`);
    }
  }

  if (supplyChain) {
    if (supplyChain.dataAvailable) {
      const themes = Array.isArray(supplyChain.themes) ? supplyChain.themes : [];
      const themeText = themes
        .slice(0, 2)
        .map((theme) => `${theme.name}/${theme.lifecycle}`)
        .join(", ") || "未標主題";
      whyBuy.push(
        `產業鏈已驗證：定位 ${supplyChain.chainPosition ?? "未標"}，受益層級 ${supplyChain.beneficiaryTier ?? "未標"}，主題 ${themeText}。`
      );
    } else {
      whyNotBuy.push("產業鏈資料暫缺：company_graph_db 尚無定位，theme 分數維持保守。");
    }
  }

  if (companyNews) {
    if (companyNews.state === "live" && companyNews.items[0]) {
      whyBuy.push(`個股新聞催化：${companyNews.items[0].date}「${companyNews.items[0].title.slice(0, 60)}」。`);
    } else if (companyNews.state === "empty") {
      whyNotBuy.push("個股新聞：FinMind experimental 今日空陣列，未加入額外事件加分。");
    } else if (companyNews.state === "unavailable") {
      whyNotBuy.push("個股新聞：FinMind experimental 暫不可用，禁止補腦催化劑。");
    }
  }

  return { whyBuy, whyNotBuy };
}

function mergeUniqueText(first: string[] | undefined, second: string[]): string[] {
  const merged: string[] = [];
  for (const value of [...(first ?? []), ...second]) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (merged.some((existing) => existing === trimmed)) continue;
    merged.push(trimmed);
  }
  return merged;
}

export function applyDeterministicMultiDimScoresToItems(
  items: AiStockRecommendationV2[],
  trace: V3ReActStep[]
): AiStockRecommendationV2[] {
  const fundamentalsByTicker = getFundamentalsTraceByTicker(trace);
  const supplyChainByTicker = getSupplyChainTraceByTicker(trace);
  const companyNewsByTicker = getCompanyNewsTraceByTicker(trace);

  return items.map((item) => {
    const fundamentals = fundamentalsByTicker.get(item.ticker);
    const supplyChain = supplyChainByTicker.get(item.ticker);
    const companyNews = companyNewsByTicker.get(item.ticker);
    const existing = item.subScores ?? {
      theme: 10,
      revenue: 8,
      institutional: 8,
      margin: 8,
      rs: 5,
      technical: 10,
      valuation: 3,
    };

    const subScores = {
      theme: supplyChain
        ? scoreV3ThemeFromSupplyChain(supplyChain, existing.theme ?? 10)
        : existing.theme ?? 10,
      revenue: fundamentals
        ? scoreV3RevenueFromFundamentals(fundamentals)
        : existing.revenue ?? 8,
      institutional: existing.institutional ?? 8,
      margin: fundamentals
        ? scoreV3MarginFromFundamentals(fundamentals)
        : existing.margin ?? 8,
      rs: existing.rs ?? 5,
      technical: existing.technical ?? 10,
      valuation: scoreV3ValuationFromFundamentals(fundamentals) ?? existing.valuation ?? 3,
    };
    const totalScore = subScores.theme + subScores.revenue + subScores.institutional +
      subScores.margin + subScores.rs + subScores.technical + subScores.valuation;
    const currentBucket = item.bucket ?? parseBucket(item.action ?? "").bucket;
    const bucket = normalizeBucketByScoreV3(currentBucket, totalScore);
    const action = bucket === currentBucket ? item.action : parseBucket(bucket).action;
    const bullets = buildV3MultiDimBullets(fundamentals, supplyChain, companyNews);
    const why_buy = mergeUniqueText(item.why_buy, bullets.whyBuy).slice(0, 6);
    const why_not_buy = mergeUniqueText(item.why_not_buy, bullets.whyNotBuy).slice(0, 6);

    return {
      ...item,
      action,
      subScores,
      totalScore,
      bucket,
      why_buy: why_buy.length > 0 ? why_buy : item.why_buy,
      why_not_buy: why_not_buy.length > 0 ? why_not_buy : item.why_not_buy,
      whyBuyBrief: item.whyBuyBrief ?? buildWhyBuyBrief(why_buy.length > 0 ? why_buy : item.why_buy),
    };
  });
}

// ── V3 quality helpers ────────────────────────────────────────────────────────

/**
 * Mark each parsed item as incomplete when any of the 7 sub-score axes is missing.
 * incomplete items are NOT counted toward the items-per-run threshold.
 * They remain in the array with isIncomplete=true so callers can filter.
 */
export function applyIncompleteFlag(items: AiStockRecommendationV2[]): AiStockRecommendationV2[] {
  return items.map(item => {
    const ss = item.subScores;
    const missingAny = !ss ||
      ss.theme === undefined || ss.revenue === undefined ||
      ss.institutional === undefined || ss.margin === undefined ||
      ss.rs === undefined || ss.technical === undefined ||
      ss.valuation === undefined;
    if (missingAny) {
      return { ...item, isIncomplete: true };
    }
    return item;
  });
}

/**
 * Build a source trail for a specific ticker from the ReAct trace.
 * Returns which tools were called that involve that ticker (or market-level tools).
 */
export function buildSourceTrailForTicker(
  trace: V3ReActStep[],
  ticker: string
): AiRecSourceTrailEntry[] {
  const trail: AiRecSourceTrailEntry[] = [];
  for (const step of trace) {
    if (!step.toolName) continue;
    const input = step.toolInput as Record<string, unknown> | null;
    const inputTicker = typeof input?.["ticker"] === "string" ? input["ticker"] : null;
    // Include: market-level tools (no ticker input) + ticker-specific tools matching this ticker
    const isMarketLevel = ["get_market_overview", "get_sector_rotation", "get_news_top10"].includes(step.toolName);
    const isTickerMatch = inputTicker === ticker;
    if (!isMarketLevel && !isTickerMatch) continue;

    const obs = step.observation as Record<string, unknown> | null;
    const dataFields = obs
      ? Object.keys(obs).filter(k => obs[k] !== null && obs[k] !== undefined && typeof obs[k] !== "object")
      : [];

    trail.push({
      toolName: step.toolName,
      ticker: isTickerMatch ? ticker : undefined,
      round: step.round,
      dataFields: dataFields.slice(0, 10),
    });
  }
  return trail;
}

/**
 * Compute run-level score breakdown summary.
 * completeItems = items where isIncomplete !== true
 */
export function computeScoreBreakdown(items: AiStockRecommendationV2[]): AiRecRunScoreBreakdown {
  const complete = items.filter(i => !i.isIncomplete);
  const ratingDist: Record<string, number> = {};
  let totalScoreSum = 0;
  let scoreCount = 0;
  let topRating: AiRecBucket | null = null;
  const bucketOrder: AiRecBucket[] = ["A+", "A", "B", "C"];

  for (const item of complete) {
    const b = item.bucket ?? "C";
    ratingDist[b] = (ratingDist[b] ?? 0) + 1;
    if (item.totalScore !== undefined) {
      totalScoreSum += item.totalScore;
      scoreCount++;
    }
    // Top rating = highest-tier bucket seen
    const currentIdx = topRating ? bucketOrder.indexOf(topRating) : 999;
    const newIdx = bucketOrder.indexOf(b);
    if (newIdx < currentIdx) topRating = b;
  }

  return {
    itemCount: complete.length,
    incompleteCount: items.length - complete.length,
    ratingDistribution: ratingDist,
    avgTotalScore: scoreCount > 0 ? Math.round((totalScoreSum / scoreCount) * 10) / 10 : null,
    topRating,
  };
}

/**
 * Truncate a why_buy bullet list into a single ≤80 char plain-Chinese sentence.
 */
export function buildWhyBuyBrief(whyBuy: string[] | undefined): string | undefined {
  if (!whyBuy || whyBuy.length === 0) return undefined;
  // Join first 2 bullets, then truncate
  const joined = whyBuy.slice(0, 2).join("；");
  if (joined.length <= 80) return joined;
  return joined.slice(0, 79) + "…";
}

export function buildDeterministicFallbackItemsFromTrace(
  trace: V3ReActStep[],
  dateStr: string,
  marketState: AiRecMarketState
): AiStockRecommendationV2[] {
  const byTicker = new Map<string, TechnicalObservationForFallback>();
  for (const step of trace) {
    const obs = extractTechnicalObservationForFallback(step);
    if (!obs) continue;
    if (!byTicker.has(obs.ticker)) byTicker.set(obs.ticker, obs);
  }

  const fallbackItems: AiStockRecommendationV2[] = Array.from(byTicker.values())
    .map((obs) => ({ obs, rank: technicalFallbackRank(obs) }))
    .sort((a, b) =>
      b.rank - a.rank ||
      (b.obs.changePct ?? -999) - (a.obs.changePct ?? -999) ||
      a.obs.ticker.localeCompare(b.obs.ticker)
    )
    .slice(0, MAX_V3_FALLBACK_ITEMS)
    .map(({ obs, rank }) => {
      const technical = clampNumber(
        8 +
          (obs.aboveMa20 ? 4 : 0) +
          (obs.aboveMa60 ? 4 : 0) +
          (obs.rsi14 !== null && obs.rsi14 >= 45 && obs.rsi14 <= 75 ? 2 : 0) +
          (obs.volumeRatio20d !== null && obs.volumeRatio20d >= 0.5 ? 2 : 0),
        0,
        20
      );
      const rs = (obs.changePct ?? 0) > 0 ? 8 : (obs.changePct ?? 0) >= 0 ? 6 : 5;
      const subScores = {
        theme: 15,
        revenue: 8,
        institutional: 8,
        margin: 8,
        rs,
        technical,
        valuation: 3,
      };
      const totalScore = subScores.theme + subScores.revenue + subScores.institutional +
        subScores.margin + subScores.rs + subScores.technical + subScores.valuation;
      const bucket: AiRecBucket =
        totalScore >= V3_BUCKET_A_PLUS_MIN_SCORE ? "A+" :
        totalScore >= V3_BUCKET_A_MIN_SCORE ? "A" :
        totalScore >= V3_BUCKET_B_MIN_SCORE ? "B" : "C";
      const action: AiStockRecommendationV2["action"] =
        bucket === "A+" ? "今日首選" :
        bucket === "A" ? "可觀察布局（研究參考）" :
        bucket === "B" ? "等回檔" : "高風險排除";

      const entryLow = roundPrice(obs.lastPrice * 0.98);
      const entryHigh = roundPrice(obs.lastPrice * 1.01);
      const entryMid = (entryLow + entryHigh) / 2;
      const tp1 = roundPrice(obs.lastPrice * 1.05);
      const tp2 = roundPrice(obs.lastPrice * 1.1);
      const stopLoss = roundPrice(obs.lastPrice * 0.94);
      const downside = Math.max(0.01, entryMid - stopLoss);
      const upside = Math.max(0.01, tp1 - entryMid);

      return {
        id: randomUUID(),
        ticker: obs.ticker,
        companyName: obs.companyName ?? CORE_COMPANY_NAMES[obs.ticker] ?? obs.ticker,
        action,
        date: dateStr,
        confidence: bucket === "A" ? 0.68 : 0.56,
        rationale:
          `Deterministic fallback from verified get_company_technical data. ` +
          `rank=${rank}, lastPrice=${obs.lastPrice}, changePct=${obs.changePct ?? "n/a"}, ` +
          `aboveMa20=${obs.aboveMa20}, aboveMa60=${obs.aboveMa60}, rsi14=${obs.rsi14 ?? "n/a"}.`,
        entryPriceRange: { low: entryLow, high: entryHigh },
        tp1,
        tp2,
        stopLoss,
        aiGenerated: true,
        source: "brain_react_v2",
        marketState,
        subScores,
        totalScore,
        bucket,
        entryZone: {
          low: entryLow,
          high: entryHigh,
          reason: "Programmatic fallback range: 0.98x-1.01x of verified lastPrice.",
        },
        tp1Structured: {
          price: tp1,
          reason: "Conservative +5% first target from verified lastPrice.",
        },
        tp2Structured: {
          price: tp2,
          reason: "Stretch +10% second target from verified lastPrice.",
        },
        stopLossStructured: {
          price: stopLoss,
          atr_multiple: 0.5,
        },
        r_ratio: roundPrice(upside / downside),
        position_sizing: {
          nav_pct: bucket === "A+" ? 0.008 : bucket === "A" ? 0.006 : bucket === "B" ? 0.004 : 0,
          market_multiplier: marketState === "event" ? 0.5 : marketState === "range" ? 0.7 : 1,
        },
        why_buy: [
          "Verified technical data was available from get_company_technical.",
          obs.aboveMa20 ? "Price is above MA20." : "Price is not above MA20; keep sizing conservative.",
          obs.aboveMa60 ? "Price is above MA60." : "Price is not above MA60; keep sizing conservative.",
        ],
        why_not_buy: [
          "This is a deterministic fallback because the LLM did not return enough structured picks.",
          "Treat as research candidates until the full AI narrative is healthy.",
        ],
        sourceTrail: buildSourceTrailForTicker(trace, obs.ticker),
      };
    });

  return applyDeterministicMultiDimScoresToItems(fallbackItems, trace);
}

/**
 * parseAiReportToRecommendationsV3
 *
 * Parses structured markdown report from synthesizeReportV3 into AiStockRecommendationV2[]
 * with v3 fields (subScores, bucket, entryZone, tp1Structured, tp2Structured, etc.)
 *
 * Expected block format:
 *   ## XXXX 公司名
 *   - 分類: A+今日首選
 *   - 總分: 88
 *   - 主題位置分: 18
 *   - 進場區: 870-890
 *   - TP1: 920
 *   - ...
 */
export function parseAiReportToRecommendationsV3(
  markdown: string,
  dateStr: string
): AiStockRecommendationV2[] {
  const results: AiStockRecommendationV2[] = [];
  if (!markdown || markdown.trim().length === 0) return results;

  // Check if market is risk-off (AI returned explicit skip signal).
  //
  // IMPORTANT: Only treat as risk-off if the markdown contains an explicit
  // RISK_OFF_FINAL_SKIP sentinel OR if it contains "RISK_OFF_SKIP" AND has
  // no stock headings at all (## \d{4}).  The old check triggered on any
  // "市場 risk-off" substring, which false-positives on the synthesis section
  // header "## 市場 risk-off 分析" that LLM legitimately writes as a preamble
  // before recommending stocks — root cause of usedFallback=true ~50% runs.
  const hasStockHeadings = /^#{2,6}\s*(?:\*\*)?\d{4,6}[A-Z]?(?:\*\*)?\b/m.test(markdown);
  const isExplicitSkip = /RISK_OFF_FINAL_SKIP/.test(markdown) ||
    (/RISK_OFF_SKIP/.test(markdown) && !hasStockHeadings);
  if (isExplicitSkip) {
    return results; // Empty — genuine risk-off skip
  }

  const stockBlockStartRe = /(?=^(?:#{2,6}\s*|\d+\.\s*|[-*]\s*)?(?:\*\*)?\d{4,6}[A-Z]?(?:\*\*)?\b)/m;
  const stockBlockTickerRe = /^(?:#{2,6}\s*|\d+\.\s*|[-*]\s*)?(?:\*\*)?(\d{4,6}[A-Z]?)(?:\*\*)?\b/m;
  const yearTickerRe = /^(201\d|202[0-9]|203[0-5])$/;
  const stockBlocks = markdown.split(stockBlockStartRe);

  for (const block of stockBlocks) {
    if (!block.trim()) continue;

    const headerLine = block.split("\n").find(line => stockBlockTickerRe.test(line)) ?? "";
    const tickerMatch = headerLine.match(stockBlockTickerRe);
    if (!tickerMatch) continue;
    const ticker = tickerMatch[1]!;
    if (yearTickerRe.test(ticker)) continue;

    const nameSource = headerLine.replace(/\*/g, "");
    const nameMatch = nameSource.match(new RegExp(ticker + "\\s+([\\u4e00-\\u9fff\\w\\s]{2,20})"));
    const parsedCompanyName = nameMatch ? nameMatch[1]!.trim() : ticker;
    // Never trust an LLM heading over a canonical ticker map for core TW names.
    // A production run once emitted "2317 台積電"; the ticker is the contract.
    const companyName = CORE_COMPANY_NAMES[ticker] ?? parsedCompanyName;

    const lines = block.split("\n");

    // v3 fields
    let bucketResult: { bucket: AiRecBucket; action: AiStockRecommendationV2["action"] } = {
      bucket: "B",
      action: "等回檔",
    };
    let totalScore: number | null = null;
    let marketState: AiRecMarketState = "trend";
    let themeScore: number | null = null;
    let revenueScore: number | null = null;
    let institutionalScore: number | null = null;
    let marginScore: number | null = null;
    let rsScore: number | null = null;
    let technicalScore: number | null = null;
    let valuationScore: number | null = null;
    let entryLow: number | null = null;
    let entryHigh: number | null = null;
    let entryReason = "";
    let tp1Price: number | null = null;
    let tp1Reason = "";
    let tp2Price: number | null = null;
    let tp2Reason = "";
    let slPrice: number | null = null;
    let slAtrMultiple: number | null = null;
    let rRatio: number | null = null;
    let confidence: number | null = null;
    let navPct: number | null = null;
    let marketMultiplier: number | null = null;
    const whyBuy: string[] = [];
    const whyNotBuy: string[] = [];
    const rationaleLines: string[] = [];

    for (const line of lines) {
      const lower = line.toLowerCase();
      const value = line.replace(/^[-*•\s]*[^:：]+[:：]\s*/, "").trim();

      if (/分類[:：]/.test(line)) {
        bucketResult = parseBucket(value);
      } else if (/總分[:：]/.test(line)) {
        totalScore = parseFloat2v3(value.match(/\d+/)?.[0]);
      } else if (/市場狀態[:：]/.test(line)) {
        marketState = parseMarketStateV3(value);
      } else if (/主題位置分[:：]/.test(line)) {
        themeScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/營收財報分[:：]/.test(line)) {
        revenueScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/法人ETF分[:：]/.test(line)) {
        institutionalScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/融資借券分[:：]/.test(line)) {
        marginScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/相對強弱量能分[:：]/.test(line)) {
        rsScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/技術結構分[:：]/.test(line)) {
        technicalScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/估值事件分[:：]/.test(line)) {
        valuationScore = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/進場區[:：]/.test(line)) {
        const pr = extractPriceRangeV3(line);
        entryLow = pr.low;
        entryHigh = pr.high;
      } else if (/進場理由[:：]/.test(line)) {
        entryReason = value;
      } else if (/^- TP1[:：]/.test(line) || /^- tp1[:：]/i.test(line)) {
        // Extract price AFTER the colon, not first digit in whole line
        tp1Price = parseFloat2v3(value.match(/(\d+(?:\.\d+)?)/)?.[0]);
      } else if (/TP1理由[:：]/.test(line)) {
        tp1Reason = value;
      } else if (/^- TP2[:：]/.test(line) || /^- tp2[:：]/i.test(line)) {
        tp2Price = parseFloat2v3(value.match(/(\d+(?:\.\d+)?)/)?.[0]);
      } else if (/TP2理由[:：]/.test(line)) {
        tp2Reason = value;
      } else if (/停損[:：]/.test(line)) {
        slPrice = parseFloat2v3(value.match(/(\d+(?:\.\d+)?)/)?.[0]);
      } else if (/ATR倍數[:：]/.test(line)) {
        slAtrMultiple = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/R值[:：]/i.test(line)) {
        rRatio = parseFloat2v3(value.match(/[\d.]+/)?.[0]);
      } else if (/信心[:：]/.test(line)) {
        const cv = value.match(/([01](?:\.\d+)?)/);
        confidence = cv ? parseFloat2v3(cv[1]) : null;
      } else if (/一句話理由[:：]/.test(line)) {
        // whyBuyBrief is injected from this line (≤80 char), or falls back to buildWhyBuyBrief()
        // We store it in a temp var and override after parsing
        const brief = value.slice(0, 80);
        if (brief.length > 0) rationaleLines.push(`__BRIEF__${brief}`);
      } else if (/為什麼買[:：]/.test(line)) {
        const bullets = value.split(/[;；,，]/).map(s => s.trim()).filter(s => s.length > 2);
        whyBuy.push(...bullets);
      } else if (/為什麼不買[:：]/.test(line)) {
        const bullets = value.split(/[;；,，]/).map(s => s.trim()).filter(s => s.length > 2);
        whyNotBuy.push(...bullets);
      } else if (/NAV比重[:：]/.test(line)) {
        navPct = parseFloat2v3(value.match(/([\d.]+)/)?.[0]);
        if (navPct !== null && navPct > 1) navPct = navPct / 100; // convert % to decimal if needed
      } else if (/市場倍率[:：]/.test(line)) {
        marketMultiplier = parseFloat2v3(value.match(/([\d.]+)/)?.[0]);
      } else if (/推薦理由|rationale|理由[:：]/i.test(line)) {
        rationaleLines.push(value);
      }
    }

    // Confidence defaults by bucket
    const defaultConfidence = bucketResult.bucket === "A+" ? 0.85
      : bucketResult.bucket === "A" ? 0.70
      : 0.55;

    // nav_pct defaults by bucket
    const defaultNavPct = bucketResult.bucket === "A+" ? 0.008
      : bucketResult.bucket === "A" ? 0.006
      : 0.004;

    // Build subScores (use null-safe values)
    const subScores = (themeScore !== null || revenueScore !== null) ? {
      theme: themeScore ?? 10,
      revenue: revenueScore ?? 8,
      institutional: institutionalScore ?? 8,
      margin: marginScore ?? 8,
      rs: rsScore ?? 5,
      technical: technicalScore ?? 10,
      valuation: valuationScore ?? 3,
    } : undefined;

    // Compute totalScore from subScores if not explicitly parsed
    const computedTotal = subScores
      ? subScores.theme + subScores.revenue + subScores.institutional +
        subScores.margin + subScores.rs + subScores.technical + subScores.valuation
      : null;

    // Extract explicit brief (from "一句話理由" line stored as __BRIEF__ prefix)
    const briefLine = rationaleLines.find(l => l.startsWith("__BRIEF__"));
    const parsedBrief = briefLine ? briefLine.slice("__BRIEF__".length).slice(0, 80) : undefined;
    const cleanedRationaleLines = rationaleLines.filter(l => !l.startsWith("__BRIEF__"));
    const rationale = cleanedRationaleLines.join("; ") ||
      whyBuy.join("; ") ||
      block.slice(0, 200).replace(/\n/g, " ").trim();
    const finalTotalScore = totalScore ?? computedTotal ?? undefined;
    const finalBucket = normalizeBucketByScoreV3(bucketResult.bucket, finalTotalScore);
    const finalAction = finalBucket === bucketResult.bucket
      ? bucketResult.action
      : parseBucket(finalBucket).action;

    const rec: AiStockRecommendationV2 = {
      id: randomUUID(),
      ticker,
      companyName,
      action: finalAction,
      date: dateStr,
      confidence: confidence ?? defaultConfidence,
      rationale,
      entryPriceRange: (entryLow !== null || entryHigh !== null)
        ? { low: entryLow, high: entryHigh }
        : null,
      tp1: tp1Price,
      tp2: tp2Price,
      stopLoss: slPrice,
      aiGenerated: true,
      source: "brain_react_v2",
      // v3 fields
      marketState,
      marketScores: undefined, // Set at run level, not per-stock
      subScores,
      totalScore: finalTotalScore,
      bucket: finalBucket,
      entryZone: (entryLow !== null || entryHigh !== null) ? {
        low: entryLow,
        high: entryHigh,
        reason: entryReason || undefined,
      } : undefined,
      tp1Structured: tp1Price !== null ? {
        price: tp1Price,
        reason: tp1Reason || undefined,
      } : undefined,
      tp2Structured: tp2Price !== null ? {
        price: tp2Price,
        reason: tp2Reason || undefined,
      } : undefined,
      stopLossStructured: slPrice !== null ? {
        price: slPrice,
        atr_multiple: slAtrMultiple ?? 0.5,
      } : undefined,
      r_ratio: rRatio ?? undefined,
      position_sizing: (navPct !== null || marketMultiplier !== null) ? {
        nav_pct: navPct ?? defaultNavPct,
        market_multiplier: marketMultiplier ?? 1.0,
      } : {
        nav_pct: defaultNavPct,
        market_multiplier: 1.0,
      },
      why_buy: whyBuy.length > 0 ? whyBuy : undefined,
      why_not_buy: whyNotBuy.length > 0 ? whyNotBuy : undefined,
      // whyBuyBrief: prefer explicit "一句話理由" from parser; fallback to auto-truncation of why_buy
      whyBuyBrief: parsedBrief ?? buildWhyBuyBrief(whyBuy.length > 0 ? whyBuy : undefined),
      // isIncomplete / sourceTrail are injected by post-processing in enrichParsedItems()
    };

    if (!results.some(r => r.ticker === ticker)) {
      results.push(rec);
    }
  }

  return results;
}

/**
 * enrichV3Items — post-parse enrichment:
 * 1. applyIncompleteFlag: marks items missing any sub-score axis as isIncomplete=true
 * 2. Injects sourceTrail per item from the ReAct trace
 * items with isIncomplete=true do NOT count toward MIN_V3_RECOMMENDATION_ITEMS
 */
export function enrichV3Items(
  items: AiStockRecommendationV2[],
  trace: V3ReActStep[]
): AiStockRecommendationV3Card[] {
  const withDeterministicScores = applyDeterministicMultiDimScoresToItems(items, trace);
  const withFlag = applyIncompleteFlag(withDeterministicScores);
  return withFlag.map(item => withV3ContractAliases({
    ...item,
    sourceTrail: buildSourceTrailForTicker(trace, item.ticker),
  }));
}

// ── ReAct step parser ─────────────────────────────────────────────────────────

export function normalizeMarketToolNameV3(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "null" ||
    normalized === "none" ||
    normalized === "no_tool" ||
    normalized === "final" ||
    normalized === "final_answer" ||
    normalized === "(final_answer)" ||
    normalized === "n/a" ||
    normalized === "na"
  ) {
    return null;
  }
  return trimmed;
}

function parseMarketStepV3(raw: string): {
  thought: string;
  toolName: string | null;
  toolInput: unknown | null;
  isRiskOff: boolean;
} {
  const cleaned = raw.trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { thought?: string; toolName?: string | null; toolInput?: unknown };
    const thought = String(parsed.thought ?? "(no thought)");
    const isRiskOff = /RISK_OFF_SKIP/.test(thought);
    return {
      thought,
      toolName: normalizeMarketToolNameV3(parsed.toolName),
      toolInput: parsed.toolInput ?? null,
      isRiskOff,
    };
  } catch {
    return {
      thought: cleaned.slice(0, 300),
      toolName: null,
      toolInput: null,
      isRiskOff: /RISK_OFF_SKIP/.test(cleaned),
    };
  }
}

// ── synthesize v3 report ──────────────────────────────────────────────────────

function stringifyForTrace(value: unknown, limit: number): string {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}

function formatTraceObservationForSynthesis(step: {
  toolName: string | null;
  observation: unknown;
}): string {
  const obs = traceRecord(step.observation);
  if (!obs) return stringifyForTrace(step.observation, 600);

  if (step.toolName === "get_company_fundamentals") {
    const fundamentals = obs as unknown as CompanyFundamentalsObservation;
    const monthlyRevenue = Array.isArray(fundamentals.monthlyRevenue) ? fundamentals.monthlyRevenue : [];
    return stringifyForTrace({
      ticker: fundamentals.ticker,
      source: fundamentals.source,
      dataAvailable: fundamentals.dataAvailable,
      reason: fundamentals.reason,
      revenueYoyTrend: fundamentals.revenueYoyTrend,
      monthlyRevenue: monthlyRevenue.slice(0, 3),
      latestQuarterDate: fundamentals.latestQuarterDate,
      epsLatestQuarter: fundamentals.epsLatestQuarter,
      grossMarginPct: fundamentals.grossMarginPct,
      operatingMarginPct: fundamentals.operatingMarginPct,
      per: fundamentals.per,
      pbr: fundamentals.pbr,
      dividendYield: fundamentals.dividendYield,
      deterministicScores: {
        revenue: scoreV3RevenueFromFundamentals(fundamentals),
        margin: scoreV3MarginFromFundamentals(fundamentals),
        valuation: scoreV3ValuationFromFundamentals(fundamentals) ?? 3,
      },
    }, 1400);
  }

  if (step.toolName === "get_supply_chain") {
    const supplyChain = obs as unknown as SupplyChainObservation;
    const themes = Array.isArray(supplyChain.themes) ? supplyChain.themes : [];
    const suppliers = Array.isArray(supplyChain.suppliers) ? supplyChain.suppliers : [];
    const customers = Array.isArray(supplyChain.customers) ? supplyChain.customers : [];
    const peers = Array.isArray(supplyChain.peers) ? supplyChain.peers : [];
    return stringifyForTrace({
      ticker: supplyChain.ticker,
      source: supplyChain.source,
      dataAvailable: supplyChain.dataAvailable,
      chainPosition: supplyChain.chainPosition,
      beneficiaryTier: supplyChain.beneficiaryTier,
      themes: themes.slice(0, 4),
      suppliers: suppliers.slice(0, 3),
      customers: customers.slice(0, 3),
      peers: peers.slice(0, 3),
      deterministicThemeScore: scoreV3ThemeFromSupplyChain(supplyChain),
    }, 1400);
  }

  if (step.toolName === "get_company_news") {
    const companyNews = obs as unknown as CompanyNewsObservation;
    const items = Array.isArray(companyNews.items) ? companyNews.items : [];
    return stringifyForTrace({
      ticker: companyNews.ticker,
      source: companyNews.source,
      state: companyNews.state,
      itemCount: companyNews.itemCount,
      asOf: companyNews.asOf,
      note: companyNews.note,
      items: items.slice(0, 3),
    }, 1000);
  }

  return stringifyForTrace(step.observation, 600);
}

interface V3SynthesisAttempt {
  markdown: string;
  totalTokens: number;
  costUsd: number;
  /** Raw content from LLM (first 2000 chars) — for diagnostic even when parser fails. */
  rawContentPreview: string;
}

interface V3ParsedSynthesis {
  report: string;
  items: AiStockRecommendationV2[];
  totalTokens: number;
  costUsd: number;
  retryUsed: boolean;
  initialItemCount: number;
  /** First 2000 chars of the raw synthesis LLM content — for diagnostic even when parser fails. */
  rawSynthesisPreview: string;
}

async function synthesizeReportV3(
  trace: Array<{ round: number; thought: string; toolName: string | null; observation: unknown; tokensUsed: number }>,
  dateStr: string,
  model: string,
  programmaticRiskOffScore: number,
  repairMarkdown?: string
): Promise<V3SynthesisAttempt> {
  const traceText = trace
    .map(s => `Round ${s.round}:\n思考: ${s.thought}\n工具: ${s.toolName ?? "(Final Answer)"}\n結果: ${formatTraceObservationForSynthesis(s)}`)
    .join("\n\n");
  const rejectedRiskOffRepair = repairMarkdown?.includes("RISK_OFF_FINAL_SKIP") === true;
  const previousMarkdownForRepair = rejectedRiskOffRepair
    ? `INVALID_RISK_OFF_FINAL_SKIP_REPAIR:
The previous synthesis returned RISK_OFF_FINAL_SKIP, but this repair pass is only reached after the programmatic risk-off gate and after tool observations are available.
Do not reuse that skip answer. Ignore the rejected skip text and write stock sections from the trace observations instead.`
    : repairMarkdown?.slice(0, 9000) ?? "";
  const userPrompt = repairMarkdown
    ? `${buildV3SynthesisPrompt(traceText, dateStr, programmaticRiskOffScore)}

---
JSON_REPAIR_REQUIRED:
The previous synthesis output did not parse into at least ${MIN_V3_RECOMMENDATION_ITEMS} recommendation items.
You MUST output a valid JSON array (no markdown wrappers, no explanation text — just the JSON array).
Rewrite using the same factual basis from the trace. RISK_OFF_FINAL_SKIP is forbidden when system_programmatic_risk_off_score < 3.
CRITICAL JSON RULES:
1. Output MUST be a JSON array: [{...}, {...}, ...]
2. Each object MUST have all required fields: ticker, companyName, action, totalScore, marketState, subScores, entryLow, entryHigh, tp1, tp2, stopLoss, confidence, whyBuy (array), whyNotBuy (array), oneLineReason
3. Include at least ${MIN_V3_RECOMMENDATION_ITEMS} items with action "A+今日首選", "A可觀察布局", or "B等回檔".
4. Score thresholds: A+ >= 85, A = 75-84, B = 65-74, C < 65. totalScore must match action.
5. All price fields (entryLow, entryHigh, tp1, tp2, stopLoss) must be real numbers from lastPrice data.

Previous output (for reference — do NOT copy format if it was wrong):
${previousMarkdownForRepair}`
    : buildV3SynthesisPrompt(traceText, dateStr, programmaticRiskOffScore);

  const llmResult = await callAiRecLlmWithFallback(
    [
      {
        role: "system",
        content: "你是 IUF 台股操盤師 AI。你必須輸出一個純 JSON 陣列（不要有任何 markdown 包裝），每個元素代表一支股票的完整分析。"
      },
      { role: "user", content: userPrompt },
    ],
    {
      modelKey: model,
      callerModule: "ai_rec_v2",
      taskType: repairMarkdown ? "synthesis_format_retry" : "synthesis",
      // gpt-5.5 / o-series are REASONING models: reasoning tokens count against
      // max_completion_tokens BEFORE any answer text is emitted. 8000 gets fully
      // consumed by reasoning → empty content → "(LLM unavailable)" → 0 items.
      // Reasoning models need a far larger budget; gpt-4o-mini keeps the old value.
      maxTokens: /^(gpt-5|o1|o3)/.test(model)
        ? (repairMarkdown ? 32000 : 28000)
        : (repairMarkdown ? 10000 : 8000),
      temperature: /^(gpt-5|o1|o3)/.test(model) ? undefined : (repairMarkdown ? 0.1 : 0.2),
      timeoutMs: repairMarkdown ? V3_SYNTHESIS_RETRY_TIMEOUT_MS : V3_SYNTHESIS_TIMEOUT_MS,
      // ★ json_schema STRICT mode — OpenAI guarantees output matches V3_SYNTHESIS_JSON_SCHEMA.
      // This is the definitive fix for the markdown parser returning 0 items.
      // json_object (previous) was "loose" mode — valid JSON but no structure guarantee.
      // json_schema strict=true forces the exact fields, types, and array shape → parser cannot fail.
      // If the model rejects the schema (HTTP 400), callAiRecLlmWithFallback returns null
      // and the retry path will attempt with json_object as a safety net.
      responseFormat: "json_schema",
      responseSchema: {
        name: "v3_stock_recommendations",
        strict: true,
        schema: V3_SYNTHESIS_JSON_SCHEMA,
      },
    }
  );

  // ★ FIX #742: Use empty string (not sentinel text) when LLM returns null.
  // Old: llmResult?.content ?? "(synthesis unavailable - LLM returned null)"
  // Problem: the 43-char sentinel passes `report.trim().length > 0` retry guard
  // → repair prompt receives garbage as "previous markdown" → retry also fails.
  // Fix: empty string so retry guard `!isLlmNullReport(report)` correctly skips.
  const rawContent = llmResult?.content ?? "";
  return {
    markdown: rawContent,
    totalTokens: llmResult?.usage.totalTokens ?? 0,
    costUsd: llmResult?.costUsd ?? 0,
    // ★ Diagnostic: first 2000 chars of raw synthesis content — Elva can see exactly what
    // gpt-5.5 returned even when the parser fails (surfaced in parserDiagnostic on GET response).
    rawContentPreview: rawContent.slice(0, 2000),
  };
}

async function synthesizeAndParseReportV3(
  trace: V3ReActStep[],
  dateStr: string,
  model: string,
  programmaticRiskOffScore: number,
  allowRetry: boolean
): Promise<V3ParsedSynthesis> {
  const first = await synthesizeReportV3(trace, dateStr, model, programmaticRiskOffScore);
  let report = first.markdown;
  let totalTokens = first.totalTokens;
  let costUsd = first.costUsd;
  let retryUsed = false;

  // ★ Diagnostic: capture raw synthesis preview from the first attempt.
  // With json_schema strict mode this IS the structured JSON — parser should never fail.
  // If it does, Elva can read rawSynthesisPreview directly to see what gpt-5.5 returned.
  const rawSynthesisPreview = first.rawContentPreview;

  // ── Primary: JSON parser (structured output from json_schema strict mode) ──────────
  // With json_schema strict=true, gpt-5.5 returns a schema-guaranteed JSON object
  // with shape {items: [...]}. parseV3JsonSynthesis() handles both array and {items:[...]} wrapper.
  // parseV3JsonSynthesis() returns [] only if content is completely unparseable JSON — extremely
  // unlikely with strict mode; we still fall through to markdown parser as last-resort safety net.
  let items = enrichV3Items(parseV3JsonSynthesis(report, dateStr), trace);
  const usedJsonParser = items.length > 0;

  if (!usedJsonParser) {
    // ── Secondary: markdown parser (safety net — should not fire with json_schema strict mode) ─
    console.warn("[v3-synthesis] JSON parse returned 0 items after json_schema strict mode — falling back to markdown parser (unexpected)");
    items = enrichV3Items(parseAiReportToRecommendationsV3(report, dateStr), trace);
  } else {
    console.info(`[v3-synthesis] JSON parser succeeded (json_schema strict mode): ${items.length} items parsed`);
  }

  const initialItemCount = completeItemCount(items);

  // ★ FIX #742: detect LLM null response (empty string after fix above)
  const reportIsEmpty = report.trim().length === 0;

  if (completeItemCount(items) < MIN_V3_RECOMMENDATION_ITEMS) {
    const headingCandidates = usedJsonParser
      ? [] // JSON mode — no markdown headings to report
      : Array.from(
          report.matchAll(/^(?:#{1,6}\s+.*|\d+\.\s+\d{4,6}.*|\*\*\d{4,6}.*)$/gm),
          match => match[0]!.slice(0, 160)
        ).slice(0, 8);
    console.warn("[v3-synthesis] parser_under_min_items", JSON.stringify({
      initialItemCount,
      totalItems: items.length,
      incompleteItems: items.length - initialItemCount,
      reportLength: report.length,
      allowRetry,
      llmReturnedNull: reportIsEmpty,
      usedJsonParser,
      headingCandidates,
      rawSynthesisPreview,
      reportPreview: reportIsEmpty ? "(synthesis unavailable - LLM returned null)" : report.slice(0, 800),
      reportTail: reportIsEmpty ? "(synthesis unavailable - LLM returned null)" : report.slice(-800),
    }));
  }

  // ★ FIX #742: Only retry if report has real content (not empty/null).
  // Use completeItemCount (items with all 7 sub-scores) against MIN threshold.
  // ★ FIX #742: strict > so tie (0 vs 0) keeps original.
  if (allowRetry && completeItemCount(items) < MIN_V3_RECOMMENDATION_ITEMS) {
    const retrySeed = reportIsEmpty
      ? "LLM_NULL_OR_TIMEOUT_RETRY: first synthesis returned no JSON. Re-read the trace observations and produce a fresh JSON array now."
      : report;
    const retry = await synthesizeReportV3(trace, dateStr, model, programmaticRiskOffScore, retrySeed);
    // Try JSON parser first on retry, then markdown
    let retryItems = enrichV3Items(parseV3JsonSynthesis(retry.markdown, dateStr), trace);
    if (retryItems.length === 0) {
      retryItems = enrichV3Items(parseAiReportToRecommendationsV3(retry.markdown, dateStr), trace);
    }
    totalTokens += retry.totalTokens;
    costUsd += retry.costUsd;
    retryUsed = true;

    if (completeItemCount(retryItems) > completeItemCount(items)) {
      report = retry.markdown;
      items = retryItems;
    }
  }

  return { report, items, totalTokens, costUsd, retryUsed, initialItemCount, rawSynthesisPreview };
}

// ── Core runAiRecommendationV3 ────────────────────────────────────────────────

interface V3ReActStep {
  round: number;
  thought: string;
  toolName: string | null;
  toolInput: unknown | null;
  observation: unknown | null;
  tokensUsed: number;
}

export async function runAiRecommendationV3(
  opts: AiRecommendationV3RunOptions = {}
): Promise<AiRecommendationV3RunResult> {
  const runId = opts.runId ?? randomUUID();
  const dbRowId = randomUUID();
  const trigger = opts.trigger ?? "manual_refresh";
  const dateStr = opts.dateStr ?? todayTst();
  const generatedAt = new Date().toISOString();
  // Per-feature model override: OPENAI_MODEL_AI_REC takes priority over global OPENAI_MODEL.
  // This allows upgrading AI rec to gpt-5.5 without touching global env (which would
  // also upgrade high-frequency cheap tasks like news-top10).
  const model = resolveAiRecPrimaryModel();

  await persistV3RunStart({ id: dbRowId, runId, workspaceId: opts.workspaceId, trigger, model });

  try {
    return await runAiRecommendationV3Body({ opts, runId, dbRowId, trigger, dateStr, generatedAt, model });
  } catch (err) {
    // An error thrown mid-run (e.g. LLMBudgetExceeded inside the ReAct loop) used to
    // leave the persisted row status="running" forever — the read path then skipped it
    // and the product showed nothing for days. Persist a terminal status before rethrow.
    const message = err instanceof Error ? err.message : String(err);
    const status: AiRecommendationV3RunResult["status"] =
      err instanceof Error && err.name === "LLMBudgetExceeded" ? "budget_exceeded" : "failed";
    try {
      await finalizeV3Run({
        runId,
        status,
        generatedAt,
        items: [],
        reactTrace: [],
        finalReportMarkdown: `(run aborted: ${message})`,
        totalCostUsd: 0,
        totalTokens: 0,
        marketState: null,
        marketRiskOffScore: null,
        programmaticRiskOff: null,
        synthesisRetryUsed: false,
        synthesisFallbackUsed: false,
        dbRowId,
        scoreBreakdown: computeScoreBreakdown([]),
      }, model, opts.workspaceId);
    } catch {
      // best-effort — the original error is what the caller needs to see
    }
    throw err;
  }
}

async function runAiRecommendationV3Body(ctx: {
  opts: AiRecommendationV3RunOptions;
  runId: string;
  dbRowId: string;
  trigger: AiRecTrigger;
  dateStr: string;
  generatedAt: string;
  model: string;
}): Promise<AiRecommendationV3RunResult> {
  const { opts, runId, dbRowId, trigger, dateStr, generatedAt, model } = ctx;
  // Raised 12→18 (cap 15→22): multi-dimension forcing needs extra rounds for
  // get_company_fundamentals + get_supply_chain calls on top candidates.
  const maxRounds = Math.min(opts.maxRounds ?? 18, 22);
  const costCap = Math.min(opts.costCapUsd ?? 2.0, 5.0);

  // ── F1: Programmatic risk_off_score (before firing LLM) ──────────────────
  const programmaticRiskOff = await computeProgrammaticRiskOffScore();
  const progScore = programmaticRiskOff.score;

  console.info(`[v3-orchestrator] run ${runId} programmatic risk_off_score=${progScore}/6 (trigger=${trigger})`);

  // If programmatic score >= 3 → short-circuit, do NOT fire LLM
  if (progScore >= 3) {
    const riskOffReport = `## 市場 risk-off — 暫不推薦新倉（系統程式判斷）

系統計算 programmatic risk_off_score = ${progScore}/6，達到 ≥3 閘門。
依楊董 SOP，risk_off_score >= 3 時不開新 beta 倉，待事件過後重新評估。

觸發訊號（${progScore}/6）:
${programmaticRiskOff.signals.vixAbove25 ? "- S1: VIX > 25 ✓" : ""}
${programmaticRiskOff.signals.vix5dSpike ? "- S2: VIX 5d 漲 > 30% ✓" : ""}
${programmaticRiskOff.signals.dxy60dZHigh ? "- S3: DXY 60d Z-score > 1 ✓" : ""}
${programmaticRiskOff.signals.tenY20dUp ? "- S4: 10Y 20d 漲 > 25bp ✓" : ""}
${programmaticRiskOff.signals.wti10dUp ? "- S5: WTI 10d 漲 > 10% ✓" : ""}
${programmaticRiskOff.signals.taiexBelowEma60 ? `- S6: TAIEX(${programmaticRiskOff.taiexIndex}) < EMA60 ✓` : ""}`.trim();

    const result: AiRecommendationV3RunResult = {
      runId,
      status: "market_risk_off",
      generatedAt,
      items: [],
      reactTrace: [],
      finalReportMarkdown: riskOffReport,
      totalCostUsd: 0,
      totalTokens: 0,
      marketState: "risk_off",
      marketRiskOffScore: progScore,
      programmaticRiskOff,
      dbRowId,
      scoreBreakdown: computeScoreBreakdown([]),
    };
    return finalizeV3Run(result, model, opts.workspaceId);
  }

  const trace: V3ReActStep[] = [];
  let totalTokens = 0;
  let totalCostUsd = 0;
  let detectedMarketState: AiRecMarketState | null = null;
  let detectedRiskOffScore: number | null = progScore;

  // Inject programmatic score into system prompt — LLM cannot override
  const messages: AiRecLlmMessage[] = [
    { role: "system", content: buildV3SystemPrompt(dateStr, progScore) },
    {
      role: "user",
      content: `請開始楊董 SOP 5-module 分析，日期 ${dateStr}。
系統已確認 programmatic risk_off_score = ${progScore}/6 < 3，你必須完整執行 STEP 1→5，輸出 ≥${MIN_V3_RECOMMENDATION_ITEMS} 檔 A+/A/B 可行動推薦。
先執行 STEP 1: callTool(get_market_overview)。`,
    },
  ];

  // Track get_company_technical call count for F3 validation
  let companyTechnicalCallCount = 0;

  for (let round = 1; round <= maxRounds; round++) {
    if (totalCostUsd >= costCap) {
      let report = `Budget cap $${costCap} reached.`;
      let items: AiStockRecommendationV2[] = [];
      let synthesisRetryUsed = false;
      if (trace.length > 0) {
        if (companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS) {
          await ensureV3MultiDimPrefetchBeforeSynthesis(trace, opts.workspaceId);
        }
        const synthesis = await synthesizeAndParseReportV3(trace, dateStr, model, progScore, false);
        totalTokens += synthesis.totalTokens;
        totalCostUsd += synthesis.costUsd;
        report = synthesis.report;
        items = synthesis.items;
        synthesisRetryUsed = synthesis.retryUsed;
      }
      const result: AiRecommendationV3RunResult = {
        runId,
        status: "budget_exceeded",
        generatedAt,
        items,
        reactTrace: trace,
        finalReportMarkdown: report,
        totalCostUsd,
        totalTokens,
        marketState: detectedMarketState,
        marketRiskOffScore: detectedRiskOffScore,
        programmaticRiskOff,
        synthesisRetryUsed,
        synthesisFallbackUsed: false,
        dbRowId,
        scoreBreakdown: computeScoreBreakdown(items),
      };
      return finalizeV3Run(result, model, opts.workspaceId);
    }

    const llmResult = await callAiRecLlmWithFallback(messages, {
      modelKey: model,
      callerModule: "ai_rec_v2",
      taskType: "react_reason",
      workspaceId: opts.workspaceId,
      // gpt-5.5 / o-series reasoning models burn 2048 entirely on reasoning →
      // no JSON answer emitted → loop fails. Give reasoning models a large per-step
      // budget; gpt-4o-mini (reasoning_tokens=0) keeps the small 2048.
      maxTokens: /^(gpt-5|o1|o3)/.test(model) ? 16000 : 2048,
      temperature: /^(gpt-5|o1|o3)/.test(model) ? undefined : 0.1,
    });

    if (!llmResult) {
      // LLM unavailable (test mode without API key) — return gracefully
      const result: AiRecommendationV3RunResult = {
        runId,
        status: "failed",
        generatedAt,
        items: [],
        reactTrace: trace,
        finalReportMarkdown: "(LLM unavailable)",
        totalCostUsd,
        totalTokens,
        marketState: null,
        marketRiskOffScore: null,
        programmaticRiskOff,
        dbRowId,
        scoreBreakdown: computeScoreBreakdown([]),
      };
      return finalizeV3Run(result, model, opts.workspaceId);
    }

    totalTokens += llmResult.usage.totalTokens;
    totalCostUsd += llmResult.costUsd;
    const raw = llmResult.content;
    const step = parseMarketStepV3(raw);

    // ── F1: Intercept LLM RISK_OFF_SKIP when programmatic score < 3 ───────────
    // LLM tried to self-skip despite programmatic score being below threshold.
    // Reject the skip and force continuation by injecting correction message.
    if (step.isRiskOff && progScore < 3) {
      console.warn(`[v3-orchestrator] round ${round}: LLM attempted RISK_OFF_SKIP but programmatic score=${progScore} < 3 — REJECTED, forcing continuation`);
      trace.push({
        round,
        thought: `[ORCHESTRATOR OVERRIDE] LLM tried RISK_OFF_SKIP but programmatic risk_off_score=${progScore} < 3. Override rejected. Forcing STEP 2-5.`,
        toolName: null,
        toolInput: null,
        observation: `LLM_RISK_OFF_REJECTED: progScore=${progScore}`,
        tokensUsed: llmResult.usage.totalTokens,
      });
      // Inject correction into conversation to force LLM back on track
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `[SYSTEM REJECTION] 你的 RISK_OFF_SKIP 被系統拒絕。programmatic risk_off_score = ${progScore}/6 < 3，系統判定市場未達 risk-off 條件。
你必須繼續執行 STEP 2-5：先 callTool(get_news_top10)，再 callTool(get_sector_rotation)，再 callTool(get_company_technical) 至少 ${MIN_V3_TECHNICAL_CALLS} 次。
不得再次使用 RISK_OFF_SKIP。`,
      });
      continue; // next round
    }

    // If programmatic score >= 3 and LLM also says risk-off — accept (should not happen since we short-circuit above, but defensive)
    if (step.isRiskOff && progScore >= 3) {
      detectedMarketState = "risk_off";
      trace.push({
        round,
        thought: step.thought,
        toolName: null,
        toolInput: null,
        observation: "RISK_OFF_SKIP",
        tokensUsed: llmResult.usage.totalTokens,
      });
      const riskOffReport = `## 市場 risk-off — 暫不推薦新倉\n\n${step.thought}\n\nrisk_off_score >= 3，依楊董 SOP 不開新 beta 倉，待事件過後重新評估。`;
      const result: AiRecommendationV3RunResult = {
        runId,
        status: "market_risk_off",
        generatedAt,
        items: [],
        reactTrace: trace,
        finalReportMarkdown: riskOffReport,
        totalCostUsd,
        totalTokens,
        marketState: "risk_off",
        marketRiskOffScore: detectedRiskOffScore,
        programmaticRiskOff,
        dbRowId,
        scoreBreakdown: computeScoreBreakdown([]),
      };
      return finalizeV3Run(result, model, opts.workspaceId);
    }

    // Tool whitelist check — do NOT hard-fail; instead inject correction so LLM retries.
    // Old behaviour: immediate status="failed" on first bad toolName → $0.0006 runs die here.
    // New behaviour: warn + inject correction message, continue loop. If LLM persists past
    //   maxRounds or keeps using bad tools, we still synthesize from whatever trace we have.
    if (step.toolName && !(TOOL_WHITELIST_V3 as readonly string[]).includes(step.toolName)) {
      console.warn(`[v3-orchestrator] round ${round}: LLM requested non-whitelisted tool "${step.toolName}" — rejecting and forcing correction`);
      trace.push({
        round,
        thought: step.thought,
        toolName: step.toolName,
        toolInput: step.toolInput,
        observation: `BLOCKED: tool "${step.toolName}" not in v3 whitelist [${TOOL_WHITELIST_V3.join(", ")}]`,
        tokensUsed: llmResult.usage.totalTokens,
      });
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `[SYSTEM REJECTION] 工具「${step.toolName}」不在允許清單中。
允許工具：${TOOL_WHITELIST_V3.join(", ")}。
請改用上述工具之一，繼續 STEP 1 分析。先執行 callTool(get_market_overview)。`,
      });
      continue; // let LLM retry with correct tool
    }

    // ── F3: Final answer validation ────────────────────────────────────────────
    if (!step.toolName) {
      trace.push({
        round,
        thought: step.thought,
        toolName: null,
        toolInput: null,
        observation: null,
        tokensUsed: llmResult.usage.totalTokens,
      });

      if (companyTechnicalCallCount < MIN_V3_TECHNICAL_CALLS && round < maxRounds - 1) {
        console.warn(`[v3-orchestrator] round ${round}: final answer before enough technical calls (${companyTechnicalCallCount}/${MIN_V3_TECHNICAL_CALLS}) — forcing continuation`);
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: `[SYSTEM REJECTION] 分析不足：get_company_technical=${companyTechnicalCallCount}（需 ≥${MIN_V3_TECHNICAL_CALLS}）。
請先補齊 STEP 3 技術候選；系統會在 synthesis 前自動對候選股補抓 get_company_fundamentals / get_supply_chain / get_company_news，不需要你用 final answer 代替工具資料。`,
        });
        continue; // continue loop
      }

      const prefetchStats = companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS
        ? await ensureV3MultiDimPrefetchBeforeSynthesis(trace, opts.workspaceId)
        : emptyV3MultiDimPrefetchStats();
      const allowSynthesisRetry =
        companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS ||
        round >= maxRounds - 1;
      const synthesis = await synthesizeAndParseReportV3(trace, dateStr, model, progScore, allowSynthesisRetry);
      totalTokens += synthesis.totalTokens;
      totalCostUsd += synthesis.costUsd;
      let report = synthesis.report;
      let items = synthesis.items;
      let synthesisFallbackUsed = false;
      if (
        round >= maxRounds - 1 &&
        completeItemCount(items) < MIN_V3_RECOMMENDATION_ITEMS &&
        companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS &&
        progScore < 3
      ) {
        const fallbackItems = buildDeterministicFallbackItemsFromTrace(
          trace,
          dateStr,
          detectedMarketState ?? "trend"
        );
        if (completeItemCount(fallbackItems) >= MIN_V3_RECOMMENDATION_ITEMS) {
          console.warn(`[v3-orchestrator] run ${runId}: LLM returned ${items.length} items after ${companyTechnicalCallCount} technical calls; using deterministic fallback (${fallbackItems.length} items)`);
          items = fallbackItems;
          synthesisFallbackUsed = true;
          report = `${report}

---
Deterministic fallback applied after synthesis format retry: the LLM returned fewer than ${MIN_V3_RECOMMENDATION_ITEMS} structured recommendations even though programmatic risk_off_score=${progScore} and verified get_company_technical observations were available. Items were generated from those tool observations only. initialParsedItems=${synthesis.initialItemCount}; retryUsed=${synthesis.retryUsed}.`;
        }
      }

      // F3: Validate minimum items and tool call count (only complete items count)
      const completeCount = completeItemCount(items);
      const insufficientItems = completeCount < MIN_V3_RECOMMENDATION_ITEMS;
      const insufficientTools =
        companyTechnicalCallCount < MIN_V3_TECHNICAL_CALLS;
      const unresolvedSynthesisFormatError =
        companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS &&
        synthesis.initialItemCount < MIN_V3_RECOMMENDATION_ITEMS &&
        completeCount < MIN_V3_RECOMMENDATION_ITEMS;

      if ((insufficientItems || insufficientTools) && round < maxRounds - 1) {
        // Still have rounds left — force continuation with correction
        console.warn(`[v3-orchestrator] round ${round}: insufficient output (completeItems=${completeCount}/${items.length}, get_company_technical calls=${companyTechnicalCallCount}) — forcing continuation`);
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: `[SYSTEM REJECTION] 分析不足：可行動 A+/A/B 推薦股數=${completeCount}（需 ≥${MIN_V3_RECOMMENDATION_ITEMS}），get_company_technical=${companyTechnicalCallCount}（需 ≥${MIN_V3_TECHNICAL_CALLS}）。
系統已在 synthesis 前 deterministic prefetch 多維度資料：候選=${prefetchStats.candidateTickers.join(",") || "none"}，新增 fundamentals=${prefetchStats.fundamentalsCalls}、supply_chain=${prefetchStats.supplyChainCalls}、company_news=${prefetchStats.companyNewsCalls}。
請基於已提供的 trace 重新輸出 ≥${MIN_V3_RECOMMENDATION_ITEMS} 檔 A+/A/B；C bucket 只能作為排除名單。`,
        });
        continue; // continue loop
      }

      // Accept result (either sufficient or no rounds left)
      const status: AiRecommendationV3RunResult["status"] = synthesisFallbackUsed || unresolvedSynthesisFormatError
        ? "synthesis_format_error"
        : (insufficientItems || insufficientTools) ? "insufficient_tools" : "complete";
      if (status === "insufficient_tools") {
        console.warn(`[v3-orchestrator] run ${runId} finished with insufficient_tools: items=${items.length}, get_company_technical calls=${companyTechnicalCallCount}`);
      } else if (status === "synthesis_format_error") {
        console.warn(`[v3-orchestrator] run ${runId} finished with synthesis_format_error: initialItems=${synthesis.initialItemCount}, finalItems=${items.length}, retryUsed=${synthesis.retryUsed}, fallbackUsed=${synthesisFallbackUsed}`);
      }

      const result: AiRecommendationV3RunResult = {
        runId,
        status,
        generatedAt,
        items,
        reactTrace: trace,
        finalReportMarkdown: report,
        totalCostUsd,
        totalTokens,
        marketState: detectedMarketState ?? "trend",
        marketRiskOffScore: detectedRiskOffScore,
        programmaticRiskOff,
        synthesisRetryUsed: synthesis.retryUsed,
        synthesisFallbackUsed,
        dbRowId,
        scoreBreakdown: computeScoreBreakdown(items),
      };
      return finalizeV3Run(result, model, opts.workspaceId);
    }

    // Execute tool
    let observation: unknown;
    try {
      observation = await dispatchMarketToolV3(step.toolName, step.toolInput, opts.workspaceId);

      // Track get_company_technical calls (F3)
      if (step.toolName === "get_company_technical") {
        companyTechnicalCallCount++;
        console.info(`[v3-orchestrator] round ${round}: get_company_technical call #${companyTechnicalCallCount}`);
      }

      // Try to extract risk_off_score from market overview result
      if (step.toolName === "get_market_overview" && typeof observation === "object" && observation !== null) {
        const obs = observation as Record<string, unknown>;
        if (typeof obs["risk_off_score"] === "number") {
          detectedRiskOffScore = obs["risk_off_score"] as number;
          // Determine market state from scores (but do NOT override progScore gate)
          if ((obs["trend_score"] as number | undefined) !== undefined && (obs["trend_score"] as number) >= 4) {
            detectedMarketState = "trend";
          } else {
            detectedMarketState = "range";
          }
        }
      }
    } catch (err) {
      observation = { error: err instanceof Error ? err.message : String(err) };
    }

    trace.push({
      round,
      thought: step.thought,
      toolName: step.toolName,
      toolInput: step.toolInput,
      observation,
      tokensUsed: llmResult.usage.totalTokens,
    });

    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `Tool ${step.toolName} 結果: ${JSON.stringify(observation).slice(0, 2000)}`,
    });
  }

  // Max rounds reached — synthesize with what we have
  if (companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS) {
    await ensureV3MultiDimPrefetchBeforeSynthesis(trace, opts.workspaceId);
  }
  const synthesis = await synthesizeAndParseReportV3(trace, dateStr, model, progScore, true);
  totalTokens += synthesis.totalTokens;
  totalCostUsd += synthesis.costUsd;
  let report = synthesis.report;
  let items = synthesis.items;
  let synthesisFallbackUsed = false;
  if (
    completeItemCount(items) < MIN_V3_RECOMMENDATION_ITEMS &&
    companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS &&
    progScore < 3
  ) {
    const fallbackItems = buildDeterministicFallbackItemsFromTrace(
      trace,
      dateStr,
      detectedMarketState ?? "trend"
    );
    if (completeItemCount(fallbackItems) >= MIN_V3_RECOMMENDATION_ITEMS) {
      console.warn(`[v3-orchestrator] run ${runId}: max rounds reached with completeItems=${completeItemCount(items)}/${items.length} after ${companyTechnicalCallCount} technical calls; using deterministic fallback (${fallbackItems.length} items)`);
      items = fallbackItems;
      synthesisFallbackUsed = true;
      report = `${report}

---
Deterministic fallback applied after synthesis format retry: max rounds ended with fewer than ${MIN_V3_RECOMMENDATION_ITEMS} complete-scored recommendations even though programmatic risk_off_score=${progScore} and verified get_company_technical observations were available. Items were generated from those tool observations only. initialParsedItems=${synthesis.initialItemCount}; retryUsed=${synthesis.retryUsed}.`;
    }
  }
  const insufficientFinal =
    completeItemCount(items) < MIN_V3_RECOMMENDATION_ITEMS ||
    companyTechnicalCallCount < MIN_V3_TECHNICAL_CALLS;
  const unresolvedSynthesisFormatError =
    companyTechnicalCallCount >= MIN_V3_TECHNICAL_CALLS &&
    synthesis.initialItemCount < MIN_V3_RECOMMENDATION_ITEMS &&
    completeItemCount(items) < MIN_V3_RECOMMENDATION_ITEMS;
  const scoreBreakdown = computeScoreBreakdown(items);
  const result: AiRecommendationV3RunResult = {
    runId,
    status: synthesisFallbackUsed || unresolvedSynthesisFormatError
      ? "synthesis_format_error"
      : insufficientFinal ? "insufficient_tools" : "complete",
    generatedAt,
    items,
    reactTrace: trace,
    finalReportMarkdown: report,
    totalCostUsd,
    totalTokens,
    marketState: detectedMarketState ?? "trend",
    marketRiskOffScore: detectedRiskOffScore,
    programmaticRiskOff,
    synthesisRetryUsed: synthesis.retryUsed,
    synthesisFallbackUsed,
    dbRowId,
    scoreBreakdown,
  };
  return finalizeV3Run(result, model, opts.workspaceId);
}
