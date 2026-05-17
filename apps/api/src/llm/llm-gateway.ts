/**
 * llm-gateway.ts — Unified LLM call entry point for IUF Brain Phase A.
 *
 * Phase A scope:
 *   - callLlm() is the unified entry point for NEW or MIGRATED code
 *   - Every call writes an llm_calls row (cost ledger) and updates llm_cost_daily
 *   - Budget guard: if today's cost exceeds LLM_DAILY_BUDGET_USD, throw LLMBudgetExceeded
 *   - Quota guard: checks OPENAI_DAILY_LIMIT (same limit as openai-quota-guard.ts)
 *   - Does NOT import from openai-quota-guard to avoid circular dependency
 *
 * Callsite migration:
 *   - Migrated modules: openalice-ai-reviewer.ts, openai-news-sentiment.ts (Phase A demo)
 *   - Remaining 11 modules: continue using callOpenAi() from openai-quota-guard.ts
 *   - Phase B: migrate all remaining modules + deprecate openai-quota-guard.ts
 *
 * Phase B (NOT implemented — requires Yang explicit ACK):
 *   - Multi-model fallback routing (LLM_FALLBACK_MODEL env)
 *   - Anthropic Claude support
 *   - ReAct loop tool invocation (enableBrainReAct=true gate)
 *   - Full deprecation of openai-quota-guard.ts
 *   - ReAct write-ops (create_order, paper_submit) — NEVER in Phase A
 *
 * Hard rules:
 *   - NEVER log API keys
 *   - Returns null on quota/API failure; only throws LLMBudgetExceeded
 *   - DB writes are fire-and-forget (cost ledger failure must not block LLM response)
 *   - No ReAct write ops in Phase A — hardcoded, not config-switchable
 */

import { getDb, isDatabaseMode, llmCalls, llmCostDaily } from "@iuf-trading-room/db";
import { sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCallOptions {
  /**
   * Model key — e.g. "gpt-4o-mini", "gpt-4.1".
   * Defaults to OPENAI_MODEL env var, then "gpt-4o-mini".
   */
  modelKey?: string;
  /** Source module calling callLlm(), e.g. "ai_reviewer", "news_sentiment". */
  callerModule: string;
  /** Task category for analytics, e.g. "review", "summary", "ranking". */
  taskType: string;
  /** Optional workspace context for per-workspace cost tracking. */
  workspaceId?: string | null;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface LlmCallResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costUsd: number;
  /** UUID of the llm_calls row written to DB (null if DB unavailable). */
  callId: string | null;
}

/** Thrown when today's LLM spend exceeds LLM_DAILY_BUDGET_USD. */
export class LLMBudgetExceeded extends Error {
  public readonly todayCost: number;
  public readonly budget: number;
  constructor(todayCost: number, budget: number) {
    super(
      `LLM daily budget exceeded: today=${todayCost.toFixed(4)} USD, limit=${budget.toFixed(4)} USD`
    );
    this.name = "LLMBudgetExceeded";
    this.todayCost = todayCost;
    this.budget = budget;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 25_000;

/** Default daily budget in USD. Override with LLM_DAILY_BUDGET_USD env. */
export function getDailyBudgetUsd(): number {
  const env = process.env["LLM_DAILY_BUDGET_USD"];
  const parsed = env ? parseFloat(env) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5.0; // $5/day default
}

/** Daily quota limit (call count). Matches openai-quota-guard default. */
function getDailyQuotaLimit(): number {
  const env = process.env["OPENAI_DAILY_LIMIT"];
  const parsed = env ? parseInt(env, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 200;
}

/**
 * Pricing table (USD per 1M tokens).
 * Covers models in llm_models_registry seed.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini":             { input: 0.150, output: 0.600 },
  "gpt-4o":                  { input: 2.500, output: 10.000 },
  "gpt-4.1":                 { input: 2.000, output: 8.000 },
  "claude-3-haiku-20240307": { input: 0.250, output: 1.250 },
  "gpt-5.4-mini":            { input: 0.150, output: 0.600 }
};

export function estimateCostUsd(
  modelKey: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = MODEL_PRICING[modelKey] ?? MODEL_PRICING["gpt-4o-mini"]!;
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

// ── In-memory state ────────────────────────────────────────────────────────────
// Separate from openai-quota-guard counters. Only tracks callLlm() calls.

let _cachedDate = "";
let _cachedCostUsd = 0;
let _cachedCallCount = 0;

export function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function syncDay(): void {
  const today = getTodayUtc();
  if (_cachedDate !== today) {
    _cachedDate = today;
    _cachedCostUsd = 0;
    _cachedCallCount = 0;
  }
}

/** For tests: reset in-memory counters. */
export function _resetLlmGatewayForTests(): void {
  _cachedDate = "";
  _cachedCostUsd = 0;
  _cachedCallCount = 0;
}

// ── DB write helpers (fire-and-forget) ────────────────────────────────────────

interface CallRecord {
  modelKey: string;
  callerModule: string;
  taskType: string;
  workspaceId?: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  status: string;
  errorCode?: string | null;
  inputSummary?: string | null;
  outputSummary?: string | null;
}

async function writeLlmCallRow(record: CallRecord): Promise<string | null> {
  if (!isDatabaseMode()) return null;
  try {
    const db = getDb();
    if (!db) return null;
    const [row] = await db
      .insert(llmCalls)
      .values({
        workspaceId: record.workspaceId ?? null,
        modelKey: record.modelKey,
        callerModule: record.callerModule,
        taskType: record.taskType,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        totalTokens: record.totalTokens,
        costUsd: record.costUsd.toFixed(8),
        latencyMs: record.latencyMs,
        status: record.status,
        errorCode: record.errorCode ?? null,
        inputSummary: record.inputSummary ?? null,
        outputSummary: record.outputSummary ?? null
      })
      .returning({ id: llmCalls.id });
    return row?.id ?? null;
  } catch (err) {
    console.warn(
      "[llm-gateway] failed to write llm_calls row:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

async function upsertDailyCost(opts: {
  workspaceId?: string | null;
  modelKey: string;
  callerModule: string;
  costUsd: number;
  tokens: number;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  try {
    const db = getDb();
    if (!db) return;
    const today = getTodayUtc();
    const costStr = opts.costUsd.toFixed(6);
    const costNum = parseFloat(costStr);
    const tokens = opts.tokens;

    // Initial INSERT values (first call of the day for this workspace)
    const initByModel = { [opts.modelKey]: { calls: 1, tokens, cost: costNum } };
    const initByModule = { [opts.callerModule]: { calls: 1, tokens, cost: costNum } };

    // JSONB merge helpers using PostgreSQL jsonb_set + arithmetic:
    //   existing_entry = existing_json -> key (or default {"calls":0,"tokens":0,"cost":0})
    //   merged = existing_entry with calls+1, tokens+N, cost+C
    // We use the || (concat) operator to deep-merge at the model/module key level.
    //
    // Pattern:
    //   by_model || jsonb_build_object(
    //     <modelKey>,
    //     COALESCE(by_model -> <modelKey>, '{"calls":0,"tokens":0,"cost":0}'::jsonb) ||
    //     jsonb_build_object(
    //       'calls', COALESCE((by_model -> <modelKey> -> 'calls')::int, 0) + 1,
    //       'tokens', COALESCE((by_model -> <modelKey> -> 'tokens')::int, 0) + <tokens>,
    //       'cost', COALESCE((by_model -> <modelKey> -> 'cost')::float, 0) + <cost>
    //     )
    //   )
    const mergedByModel = sql`
      ${llmCostDaily.byModel} || jsonb_build_object(
        ${opts.modelKey}::text,
        COALESCE(${llmCostDaily.byModel} -> ${opts.modelKey}, '{"calls":0,"tokens":0,"cost":0}'::jsonb) || jsonb_build_object(
          'calls',  COALESCE((${llmCostDaily.byModel} -> ${opts.modelKey} -> 'calls')::int, 0) + 1,
          'tokens', COALESCE((${llmCostDaily.byModel} -> ${opts.modelKey} -> 'tokens')::int, 0) + ${tokens},
          'cost',   COALESCE((${llmCostDaily.byModel} -> ${opts.modelKey} -> 'cost')::float, 0.0) + ${costNum}
        )
      )
    `;

    const mergedByModule = sql`
      ${llmCostDaily.byModule} || jsonb_build_object(
        ${opts.callerModule}::text,
        COALESCE(${llmCostDaily.byModule} -> ${opts.callerModule}, '{"calls":0,"tokens":0,"cost":0}'::jsonb) || jsonb_build_object(
          'calls',  COALESCE((${llmCostDaily.byModule} -> ${opts.callerModule} -> 'calls')::int, 0) + 1,
          'tokens', COALESCE((${llmCostDaily.byModule} -> ${opts.callerModule} -> 'tokens')::int, 0) + ${tokens},
          'cost',   COALESCE((${llmCostDaily.byModule} -> ${opts.callerModule} -> 'cost')::float, 0.0) + ${costNum}
        )
      )
    `;

    await db
      .insert(llmCostDaily)
      .values({
        workspaceId: opts.workspaceId ?? null,
        date: today,
        totalCalls: 1,
        totalTokens: tokens,
        totalCostUsd: costStr,
        byModel: initByModel,
        byModule: initByModule
      })
      .onConflictDoUpdate({
        target: [llmCostDaily.workspaceId, llmCostDaily.date],
        set: {
          totalCalls:   sql`${llmCostDaily.totalCalls} + 1`,
          totalTokens:  sql`${llmCostDaily.totalTokens} + ${tokens}`,
          totalCostUsd: sql`${llmCostDaily.totalCostUsd} + ${costStr}`,
          byModel:      mergedByModel,
          byModule:     mergedByModule,
          updatedAt:    sql`NOW()`
        }
      });
  } catch (err) {
    console.warn(
      "[llm-gateway] failed to upsert llm_cost_daily:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── Budget check ──────────────────────────────────────────────────────────────

async function checkBudget(workspaceId?: string | null): Promise<void> {
  const budget = getDailyBudgetUsd();
  syncDay();

  // Fast path: in-memory counter already over budget
  if (_cachedCostUsd >= budget) {
    throw new LLMBudgetExceeded(_cachedCostUsd, budget);
  }

  // DB check (refreshes in-memory cache from persistent storage)
  if (isDatabaseMode()) {
    try {
      const db = getDb();
      if (!db) return;
      const today = getTodayUtc();

      // Use raw SQL to avoid complex Drizzle where clause with IS NULL matching
      const rows = await db.execute(
        sql`SELECT COALESCE(SUM(total_cost_usd), 0) AS today_cost
            FROM llm_cost_daily
            WHERE date = ${today}
              AND workspace_id IS NOT DISTINCT FROM ${workspaceId ?? null}`
      ) as unknown as Array<{ today_cost: string }>;

      const todayCost = parseFloat(rows[0]?.today_cost ?? "0");
      // Sync in-memory cache (take max to account for parallel processes)
      _cachedCostUsd = Math.max(_cachedCostUsd, todayCost);

      if (todayCost >= budget) {
        throw new LLMBudgetExceeded(todayCost, budget);
      }
    } catch (err) {
      if (err instanceof LLMBudgetExceeded) throw err;
      // DB read error → fall through (don't block LLM on DB failure)
      console.warn(
        "[llm-gateway] budget check DB error:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

// ── Quota check (in-memory, for callLlm() calls) ─────────────────────────────

function checkQuota(): boolean {
  if (!process.env["OPENAI_API_KEY"]) return false;
  syncDay();
  const limit = getDailyQuotaLimit();
  if (_cachedCallCount >= limit) {
    console.warn(`[llm-gateway] daily quota limit ${limit} reached`);
    return false;
  }
  _cachedCallCount++;
  return true;
}

// ── Core callLlm() ────────────────────────────────────────────────────────────

/**
 * Unified LLM call entry point (Phase A: OpenAI only).
 *
 * Returns null on quota exhaustion, API failure, or any non-budget error.
 * Throws LLMBudgetExceeded if today's spend exceeds LLM_DAILY_BUDGET_USD.
 *
 * DB writes (llm_calls + llm_cost_daily) are fire-and-forget — failures are
 * logged but do not propagate to the caller.
 */
export async function callLlm(
  messages: LlmMessage[],
  opts: LlmCallOptions
): Promise<LlmCallResult | null> {
  const modelKey = opts.modelKey ?? DEFAULT_MODEL;
  const startMs = Date.now();

  // ── 1. Budget guard (throws LLMBudgetExceeded if over limit) ─────────────
  await checkBudget(opts.workspaceId);

  // ── 2. Quota guard (in-memory call count) ────────────────────────────────
  if (!checkQuota()) {
    void writeLlmCallRow({
      modelKey, callerModule: opts.callerModule, taskType: opts.taskType,
      workspaceId: opts.workspaceId, promptTokens: 0, completionTokens: 0,
      totalTokens: 0, costUsd: 0, latencyMs: 0, status: "quota_exceeded"
    });
    return null;
  }

  // ── 3. API key check ─────────────────────────────────────────────────────
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return null;
  }

  // ── 4. HTTP call ─────────────────────────────────────────────────────────
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  let res: Response;
  try {
    res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelKey,
        messages,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE
      })
    });
    clearTimeout(timeout);
  } catch (e) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - startMs;
    console.warn(
      `[llm-gateway][${opts.callerModule}] fetch failed:`,
      e instanceof Error ? e.message : String(e)
    );
    void writeLlmCallRow({
      modelKey, callerModule: opts.callerModule, taskType: opts.taskType,
      workspaceId: opts.workspaceId, promptTokens: 0, completionTokens: 0,
      totalTokens: 0, costUsd: 0, latencyMs, status: "failed", errorCode: "FETCH_ERROR"
    });
    return null;
  }

  if (!res.ok) {
    const latencyMs = Date.now() - startMs;
    const body = await res.text().catch(() => "(no body)");
    console.warn(`[llm-gateway][${opts.callerModule}] HTTP ${res.status}: ${body.slice(0, 120)}`);
    void writeLlmCallRow({
      modelKey, callerModule: opts.callerModule, taskType: opts.taskType,
      workspaceId: opts.workspaceId, promptTokens: 0, completionTokens: 0,
      totalTokens: 0, costUsd: 0, latencyMs, status: "failed",
      errorCode: `HTTP_${res.status}`
    });
    return null;
  }

  // ── 5. Parse response ────────────────────────────────────────────────────
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    const latencyMs = Date.now() - startMs;
    console.warn(`[llm-gateway][${opts.callerModule}] response not JSON`);
    void writeLlmCallRow({
      modelKey, callerModule: opts.callerModule, taskType: opts.taskType,
      workspaceId: opts.workspaceId, promptTokens: 0, completionTokens: 0,
      totalTokens: 0, costUsd: 0, latencyMs, status: "failed", errorCode: "PARSE_ERROR"
    });
    return null;
  }

  type OpenAiResp = {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const resp = data as OpenAiResp;
  const content = resp?.choices?.[0]?.message?.content ?? null;
  if (!content) {
    const latencyMs = Date.now() - startMs;
    console.warn(`[llm-gateway][${opts.callerModule}] empty content`);
    void writeLlmCallRow({
      modelKey, callerModule: opts.callerModule, taskType: opts.taskType,
      workspaceId: opts.workspaceId, promptTokens: 0, completionTokens: 0,
      totalTokens: 0, costUsd: 0, latencyMs, status: "failed", errorCode: "EMPTY_CONTENT"
    });
    return null;
  }

  // ── 6. Token accounting ──────────────────────────────────────────────────
  const latencyMs = Date.now() - startMs;
  const promptTokens = resp.usage?.prompt_tokens ?? 0;
  const completionTokens = resp.usage?.completion_tokens ?? 0;
  const totalTokens = resp.usage?.total_tokens ?? promptTokens + completionTokens;
  const costUsd = estimateCostUsd(modelKey, promptTokens, completionTokens);

  // ── 7. Update in-memory cost cache ───────────────────────────────────────
  syncDay();
  _cachedCostUsd += costUsd;

  // ── 8. Input/output summaries (privacy: first 100 chars only) ───────────
  const firstUserMsg = messages.find(m => m.role === "user")?.content ?? "";
  const inputSummary = firstUserMsg.slice(0, 100) || null;
  const outputSummary = content.slice(0, 100);

  // ── 9. DB writes (fire-and-forget) ───────────────────────────────────────
  const callIdPromise = writeLlmCallRow({
    modelKey, callerModule: opts.callerModule, taskType: opts.taskType,
    workspaceId: opts.workspaceId, promptTokens, completionTokens, totalTokens,
    costUsd, latencyMs, status: "success", inputSummary, outputSummary
  });

  void upsertDailyCost({
    workspaceId: opts.workspaceId,
    modelKey,
    callerModule: opts.callerModule,
    costUsd,
    tokens: totalTokens
  });

  const callId = await callIdPromise;

  return {
    content,
    usage: { promptTokens, completionTokens, totalTokens },
    costUsd,
    callId
  };
}

// ── Re-export for migrated modules ────────────────────────────────────────────

/** Strip markdown code fences from AI JSON response. */
export function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}
