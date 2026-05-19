/**
 * admin-brain-llm.ts — Brain Phase A admin endpoints.
 *
 * Endpoints (Owner-only):
 *   GET /api/v1/admin/llm/usage?from=ISO&to=ISO  — usage summary
 *   GET /api/v1/admin/llm/calls?limit=100         — recent call list
 *   GET /api/v1/admin/llm/models                  — model registry
 *
 * Phase B: POST /api/v1/brain/run (ReAct loop) — requires Yang explicit ACK.
 *
 * All routes require Owner role. Pattern: dynamic import in server.ts.
 */

import { getDb, isDatabaseMode, llmCalls, llmCostDaily, llmModelsRegistry } from "@iuf-trading-room/db";
import { and, between, desc, gte, lte, sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

// Metadata attached to every numeric field in LlmUsageSummary.
// source     — where the value came from (table name or "memory")
// lastUpdated — ISO8601 timestamp of the newest record included in this value
// method     — how it was derived ("db_aggregate" | "db_daily_rollup" | "memory_fallback")
// valueType  — whether the USD figure is estimated or reflects actual billing
export interface LlmFieldMetadata {
  source: string;
  lastUpdated: string | null;
  method: "db_aggregate" | "db_daily_rollup" | "memory_fallback";
  valueType: "estimated" | "actual";
}

export interface LlmUsageSummary {
  from: string;
  to: string;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  byModel: Array<{ modelKey: string; calls: number; tokens: number; costUsd: number }>;
  byModule: Array<{ callerModule: string; calls: number; tokens: number; costUsd: number }>;
  daily: Array<{ date: string; calls: number; tokens: number; costUsd: number }>;
  /** Disclaimer: cost_usd is an estimate. Actual billing: OpenAI dashboard. */
  disclaimer: string;
  /** Metadata for every numeric field in this summary (source/method/valueType). */
  metadata: {
    totalCalls: LlmFieldMetadata;
    totalTokens: LlmFieldMetadata;
    totalCostUsd: LlmFieldMetadata;
    byModel: LlmFieldMetadata;
    byModule: LlmFieldMetadata;
    daily: LlmFieldMetadata;
  };
}

export interface LlmCallEntry {
  id: string;
  modelKey: string;
  callerModule: string;
  taskType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: string;
  latencyMs: number | null;
  status: string;
  errorCode: string | null;
  createdAt: string;
}

export interface LlmModelEntry {
  modelKey: string;
  provider: string;
  displayName: string;
  inputPricePer1mTokens: string;
  outputPricePer1mTokens: string;
  maxContextTokens: number;
  capabilities: unknown;
  isActive: boolean;
}

// ── Usage summary ─────────────────────────────────────────────────────────────

export async function getLlmUsageSummary(opts: {
  from?: string | null;
  to?: string | null;
  workspaceId?: string | null;
}): Promise<LlmUsageSummary> {
  const from = opts.from ?? new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const to = opts.to ?? new Date().toISOString().slice(0, 10);

  const memoryFallbackMeta = {
    totalCalls:   { source: "memory", lastUpdated: null, method: "memory_fallback" as const, valueType: "estimated" as const },
    totalTokens:  { source: "memory", lastUpdated: null, method: "memory_fallback" as const, valueType: "estimated" as const },
    totalCostUsd: { source: "memory", lastUpdated: null, method: "memory_fallback" as const, valueType: "estimated" as const },
    byModel:      { source: "memory", lastUpdated: null, method: "memory_fallback" as const, valueType: "estimated" as const },
    byModule:     { source: "memory", lastUpdated: null, method: "memory_fallback" as const, valueType: "estimated" as const },
    daily:        { source: "memory", lastUpdated: null, method: "memory_fallback" as const, valueType: "estimated" as const },
  };

  if (!isDatabaseMode()) {
    return {
      from, to, totalCalls: 0, totalTokens: 0, totalCostUsd: 0,
      byModel: [], byModule: [], daily: [],
      disclaimer: "cost_usd is estimated; actual billing: OpenAI dashboard",
      metadata: memoryFallbackMeta,
    };
  }

  const db = getDb();
  if (!db) return { from, to, totalCalls: 0, totalTokens: 0, totalCostUsd: 0, byModel: [], byModule: [], daily: [], disclaimer: "cost_usd is estimated; actual billing: OpenAI dashboard", metadata: memoryFallbackMeta };

  // Aggregate from llm_calls for by_model and by_module breakdown
  const callRows = await db
    .select({
      modelKey: llmCalls.modelKey,
      callerModule: llmCalls.callerModule,
      calls: sql<number>`COUNT(*)`,
      tokens: sql<number>`SUM(${llmCalls.totalTokens})`,
      cost: sql<string>`SUM(${llmCalls.costUsd})`
    })
    .from(llmCalls)
    .where(
      and(
        gte(llmCalls.createdAt, new Date(`${from}T00:00:00Z`)),
        lte(llmCalls.createdAt, new Date(`${to}T23:59:59Z`))
      )
    )
    .groupBy(llmCalls.modelKey, llmCalls.callerModule);

  // Aggregate totals
  let totalCalls = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  const byModelMap = new Map<string, { calls: number; tokens: number; costUsd: number }>();
  const byModuleMap = new Map<string, { calls: number; tokens: number; costUsd: number }>();

  for (const row of callRows) {
    const calls = Number(row.calls);
    const tokens = Number(row.tokens ?? 0);
    const cost = parseFloat(row.cost ?? "0");

    totalCalls += calls;
    totalTokens += tokens;
    totalCostUsd += cost;

    const mEntry = byModelMap.get(row.modelKey) ?? { calls: 0, tokens: 0, costUsd: 0 };
    mEntry.calls += calls; mEntry.tokens += tokens; mEntry.costUsd += cost;
    byModelMap.set(row.modelKey, mEntry);

    const modEntry = byModuleMap.get(row.callerModule) ?? { calls: 0, tokens: 0, costUsd: 0 };
    modEntry.calls += calls; modEntry.tokens += tokens; modEntry.costUsd += cost;
    byModuleMap.set(row.callerModule, modEntry);
  }

  // Daily from llm_cost_daily
  const dailyRows = await db
    .select({
      date: llmCostDaily.date,
      totalCalls: llmCostDaily.totalCalls,
      totalTokens: llmCostDaily.totalTokens,
      totalCostUsd: llmCostDaily.totalCostUsd
    })
    .from(llmCostDaily)
    .where(
      and(
        gte(llmCostDaily.date, from),
        lte(llmCostDaily.date, to)
      )
    )
    .orderBy(desc(llmCostDaily.date));

  // Compute lastUpdated from the most recent llm_calls row in this window.
  const newestCallRow = callRows.length > 0 ? `${to}T23:59:59Z` : null;
  const newestDailyRow = dailyRows.length > 0 ? `${dailyRows[0]!.date}T00:00:00Z` : null;

  const aggregateMeta: LlmFieldMetadata = {
    source: "llm_calls",
    lastUpdated: newestCallRow,
    method: "db_aggregate",
    valueType: "estimated",
  };
  const dailyMeta: LlmFieldMetadata = {
    source: "llm_cost_daily",
    lastUpdated: newestDailyRow,
    method: "db_daily_rollup",
    valueType: "estimated",
  };

  return {
    from, to, totalCalls, totalTokens, totalCostUsd,
    byModel: Array.from(byModelMap.entries()).map(([modelKey, v]) => ({ modelKey, ...v })),
    byModule: Array.from(byModuleMap.entries()).map(([callerModule, v]) => ({ callerModule, ...v })),
    daily: dailyRows.map(r => ({
      date: r.date,
      calls: r.totalCalls,
      tokens: r.totalTokens,
      costUsd: parseFloat(r.totalCostUsd ?? "0")
    })),
    disclaimer: "cost_usd is estimated; actual billing: OpenAI dashboard",
    metadata: {
      totalCalls:   aggregateMeta,
      totalTokens:  aggregateMeta,
      totalCostUsd: aggregateMeta,
      byModel:      aggregateMeta,
      byModule:     aggregateMeta,
      daily:        dailyMeta,
    },
  };
}

// ── Recent calls ──────────────────────────────────────────────────────────────

export async function getRecentLlmCalls(opts: {
  limit?: number;
  workspaceId?: string | null;
}): Promise<LlmCallEntry[]> {
  if (!isDatabaseMode()) return [];

  const db = getDb();
  if (!db) return [];
  const limit = Math.min(opts.limit ?? 100, 500);

  const rows = await db
    .select()
    .from(llmCalls)
    .orderBy(desc(llmCalls.createdAt))
    .limit(limit);

  return rows.map(r => ({
    id: r.id,
    modelKey: r.modelKey,
    callerModule: r.callerModule,
    taskType: r.taskType,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    totalTokens: r.totalTokens,
    costUsd: r.costUsd ?? "0",
    latencyMs: r.latencyMs ?? null,
    status: r.status,
    errorCode: r.errorCode ?? null,
    createdAt: r.createdAt.toISOString()
  }));
}

// ── Model registry ────────────────────────────────────────────────────────────

export async function getLlmModels(): Promise<LlmModelEntry[]> {
  if (!isDatabaseMode()) {
    // Return hardcoded fallback if no DB
    return [
      {
        modelKey: "gpt-4o-mini", provider: "openai",
        displayName: "GPT-4o Mini (routine tasks)",
        inputPricePer1mTokens: "0.150000", outputPricePer1mTokens: "0.600000",
        maxContextTokens: 128000, capabilities: { functionCalling: true }, isActive: true
      }
    ];
  }

  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(llmModelsRegistry)
    .orderBy(llmModelsRegistry.provider, llmModelsRegistry.modelKey);

  return rows.map(r => ({
    modelKey: r.modelKey,
    provider: r.provider,
    displayName: r.displayName,
    inputPricePer1mTokens: r.inputPricePer1mTokens ?? "0",
    outputPricePer1mTokens: r.outputPricePer1mTokens ?? "0",
    maxContextTokens: r.maxContextTokens,
    capabilities: r.capabilities,
    isActive: r.isActive
  }));
}
