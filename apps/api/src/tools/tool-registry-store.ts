/**
 * tool-registry-store.ts
 *
 * OpenAlice ToolCenter Phase A — central manifest registry store.
 *
 * Responsibilities:
 *   - listTools(toolType?, isActive?) → query `tools` table
 *   - getToolByKey(toolKey) → single tool lookup
 *   - createToolCallRecord(toolKey, callerType, workspaceId, inputSummary) → write `tool_calls`
 *   - updateToolCallRecord(id, status, latencyMs, outputSummary?, errorMessage?) → update `tool_calls`
 *   - callTool<T>(toolKey, callerType, workspaceId, input, fn) → core wrapper (try/catch/timing/audit)
 *
 * Hard rules:
 *   - All DB writes are graceful — never throws on DB failure, only on tool fn failure
 *   - callTool() always writes a tool_calls row (pending → success | failure | timeout)
 *   - Memory mode: callTool() still executes fn (no DB writes, no timing — in-memory safe)
 *   - Phase A: registry only — does NOT change the underlying tool logic
 *
 * Phase B (NOT implemented — requires Yang explicit ACK):
 *   - ReAct loop tool chaining
 *   - Tool quota limits
 *   - Tool versioning
 */

import { getDb, isDatabaseMode, tools, toolCalls } from "@iuf-trading-room/db";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToolRow = typeof tools.$inferSelect;
export type ToolCallRow = typeof toolCalls.$inferSelect;

export type ToolStatus = "pending" | "success" | "failure" | "timeout";
export type ToolType = "llm" | "data_sync" | "review" | "admin_action" | "cron";
export type CallerType = "cron" | "admin_action" | "llm" | "api";

export interface ListToolsOptions {
  toolType?: ToolType;
  isActive?: boolean;
}

export interface ListToolCallsOptions {
  toolKey?: string;
  limit?: number;
}

export interface ToolCallStats {
  toolKey: string;
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  timeoutCalls: number;
  errorRate: number;
  avgLatencyMs: number | null;
}

export interface ToolStatsOptions {
  windowMs?: number; // default 24h
}

// ── listTools ────────────────────────────────────────────────────────────────

/**
 * Returns tools from the registry.
 * Memory mode: returns empty array (no DB available).
 */
export async function listTools(options: ListToolsOptions = {}): Promise<ToolRow[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const conditions = [];
  if (options.toolType !== undefined) {
    conditions.push(eq(tools.toolType, options.toolType));
  }
  if (options.isActive !== undefined) {
    conditions.push(eq(tools.isActive, options.isActive));
  }

  try {
    const rows = conditions.length > 0
      ? await db.select().from(tools).where(and(...conditions)).orderBy(tools.toolType, tools.toolKey)
      : await db.select().from(tools).orderBy(tools.toolType, tools.toolKey);
    return rows;
  } catch (e) {
    console.warn("[tool-registry-store] listTools failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ── getToolByKey ──────────────────────────────────────────────────────────────

/**
 * Returns a single tool by its stable tool_key.
 * Returns null if not found or DB unavailable.
 */
export async function getToolByKey(toolKey: string): Promise<ToolRow | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(tools)
      .where(eq(tools.toolKey, toolKey))
      .limit(1);
    return rows[0] ?? null;
  } catch (e) {
    console.warn("[tool-registry-store] getToolByKey failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── createToolCallRecord ──────────────────────────────────────────────────────

/**
 * Inserts a tool_calls row in "pending" status.
 * Returns the generated ID (UUID string) for later updateToolCallRecord().
 * Returns null on any failure (non-critical — caller must handle null gracefully).
 */
export async function createToolCallRecord(
  toolKey: string,
  callerType: string,
  workspaceId: string | null | undefined,
  inputSummary?: string
): Promise<string | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  const id = randomUUID();
  try {
    await db.insert(toolCalls).values({
      id,
      toolKey,
      callerType,
      workspaceId: workspaceId ?? null,
      inputSummary: inputSummary?.slice(0, 500) ?? null,
      status: "pending"
    });
    return id;
  } catch (e) {
    console.warn("[tool-registry-store] createToolCallRecord failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── updateToolCallRecord ──────────────────────────────────────────────────────

/**
 * Updates a tool_calls row to its terminal status.
 * Fire-and-forget semantics — never throws.
 */
export async function updateToolCallRecord(
  id: string,
  status: ToolStatus,
  latencyMs: number,
  outputSummary?: string,
  errorMessage?: string
): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;

  try {
    await db
      .update(toolCalls)
      .set({
        status,
        latencyMs,
        outputSummary: outputSummary?.slice(0, 500) ?? null,
        errorMessage: errorMessage?.slice(0, 1000) ?? null
      })
      .where(eq(toolCalls.id, id));
  } catch (e) {
    console.warn("[tool-registry-store] updateToolCallRecord failed:", e instanceof Error ? e.message : e);
  }
}

// ── listToolCalls ──────────────────────────────────────────────────────────────

/**
 * Returns recent tool_calls rows, optionally filtered by toolKey.
 * Memory mode: returns empty array.
 */
export async function listToolCalls(options: ListToolCallsOptions = {}): Promise<ToolCallRow[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const limit = Math.min(options.limit ?? 50, 200);
  const conditions = [];

  if (options.toolKey) {
    conditions.push(eq(toolCalls.toolKey, options.toolKey));
  }

  try {
    const rows = conditions.length > 0
      ? await db.select().from(toolCalls).where(and(...conditions)).orderBy(desc(toolCalls.createdAt)).limit(limit)
      : await db.select().from(toolCalls).orderBy(desc(toolCalls.createdAt)).limit(limit);
    return rows;
  } catch (e) {
    console.warn("[tool-registry-store] listToolCalls failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ── getToolStats ──────────────────────────────────────────────────────────────

/**
 * Returns per-tool aggregate stats within a time window.
 * Window defaults to 24h. Memory mode: returns empty array.
 */
export async function getToolStats(options: ToolStatsOptions = {}): Promise<ToolCallStats[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const windowMs = options.windowMs ?? 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  try {
    const rows = await db
      .select()
      .from(toolCalls)
      .where(
        // created_at >= since
        and(
          // Drizzle doesn't have gte(timestamp, date) shorthand for raw comparison,
          // so we use a raw SQL condition via the timestamp comparison approach:
          // rows from the last `windowMs` ms
          eq(toolCalls.status, toolCalls.status) // always-true placeholder for type compat
        )
      )
      .orderBy(desc(toolCalls.createdAt));

    // Filter in-memory (simpler than raw SQL GROUP BY for Phase A)
    const sinceMs = since.getTime();
    const filtered = rows.filter((r) => r.createdAt.getTime() >= sinceMs);

    // Aggregate per toolKey
    const byKey = new Map<string, {
      total: number;
      success: number;
      failure: number;
      timeout: number;
      latencies: number[];
    }>();

    for (const row of filtered) {
      let entry = byKey.get(row.toolKey);
      if (!entry) {
        entry = { total: 0, success: 0, failure: 0, timeout: 0, latencies: [] };
        byKey.set(row.toolKey, entry);
      }
      entry.total++;
      if (row.status === "success") entry.success++;
      else if (row.status === "failure") entry.failure++;
      else if (row.status === "timeout") entry.timeout++;
      if (row.latencyMs != null && row.latencyMs > 0) entry.latencies.push(row.latencyMs);
    }

    const stats: ToolCallStats[] = [];
    for (const [toolKey, entry] of byKey.entries()) {
      const avgLatencyMs = entry.latencies.length > 0
        ? Math.round(entry.latencies.reduce((a, b) => a + b, 0) / entry.latencies.length)
        : null;
      stats.push({
        toolKey,
        totalCalls: entry.total,
        successCalls: entry.success,
        failureCalls: entry.failure,
        timeoutCalls: entry.timeout,
        errorRate: entry.total > 0 ? Math.round(((entry.failure + entry.timeout) / entry.total) * 10000) / 100 : 0,
        avgLatencyMs
      });
    }

    return stats.sort((a, b) => b.totalCalls - a.totalCalls);
  } catch (e) {
    console.warn("[tool-registry-store] getToolStats failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ── callTool ─────────────────────────────────────────────────────────────────

/**
 * Core wrapper: executes `fn(input)` with try/catch/timing and writes an audit record.
 *
 * - Creates a "pending" tool_calls row before invoking fn
 * - Updates to "success" / "failure" / "timeout" after fn resolves/rejects
 * - Memory mode: executes fn directly (no DB writes)
 * - Never swallows errors from fn — re-throws after recording
 *
 * Usage:
 *   const result = await callTool("ai_reviewer", "cron", workspaceId, { draftId }, async (input) => {
 *     await fireAiReviewerForDraft(input.draftId);
 *     return { verdict: "approve" };
 *   });
 */
export async function callTool<TInput, TOutput>(
  toolKey: string,
  callerType: string,
  workspaceId: string | null | undefined,
  input: TInput,
  fn: (input: TInput) => Promise<TOutput>
): Promise<TOutput> {
  const inputSummary = typeof input === "object" && input !== null
    ? JSON.stringify(input).slice(0, 200)
    : String(input).slice(0, 200);

  // Create pending record (fire-and-forget create — null if DB unavailable)
  const recordId = await createToolCallRecord(toolKey, callerType, workspaceId, inputSummary);

  const startMs = Date.now();

  try {
    const result = await fn(input);
    const latencyMs = Date.now() - startMs;

    // Update to success (fire-and-forget)
    if (recordId) {
      const outputSummary = typeof result === "object" && result !== null
        ? JSON.stringify(result).slice(0, 200)
        : String(result).slice(0, 200);
      void updateToolCallRecord(recordId, "success", latencyMs, outputSummary);
    }

    return result;
  } catch (e) {
    const latencyMs = Date.now() - startMs;
    const errorMessage = e instanceof Error ? e.message : String(e);

    // Determine if timeout or generic failure
    const isTimeout = errorMessage.toLowerCase().includes("timeout") || errorMessage.toLowerCase().includes("aborted");
    const status: ToolStatus = isTimeout ? "timeout" : "failure";

    if (recordId) {
      void updateToolCallRecord(recordId, status, latencyMs, undefined, errorMessage);
    }

    console.warn(`[tool-registry-store] callTool(${toolKey}) ${status}: ${errorMessage}`);

    // Re-throw so caller can handle
    throw e;
  }
}
