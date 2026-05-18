/**
 * react-loop.ts — Brain ReAct Phase A core loop.
 *
 * Phase A scope:
 *   - Read-only tools only (whitelist enforced).
 *   - No write-ops, no submit_order, no broker side-effects.
 *   - Yang ACK gate: any tool NOT in toolWhitelist → mark failed immediately.
 *
 * Architecture:
 *   1. Reason: callLlm() — LLM writes {thought, toolName, toolInput} as JSON
 *   2. Act:    callTool() — executes the tool (ToolCenter audit)
 *   3. Observe: append result to trace
 *   4. Repeat until maxRounds reached, costCap exceeded, or LLM returns Final Answer
 *
 * Cost enforcement:
 *   - Per-session costCapUsd hard limit (default 1.0 USD)
 *   - Hard caps: maxRounds <= 10, costCapUsd <= 5.0
 *
 * DB persistence:
 *   - Creates brain_decisions row (status=running) before loop starts
 *   - Updates row on completion (status=complete|failed|budget_exceeded)
 *   - DB writes are fire-and-forget — never block loop execution
 *
 * LLM protocol:
 *   - System prompt instructs LLM to output JSON:
 *     { "thought": "...", "toolName": "tool_key"|null, "toolInput": {...}|null }
 *   - null toolName = Final Answer (LLM is done reasoning)
 *   - After Final Answer round, one more synthesis call produces markdown report
 *
 * Safe tools (Phase A read-only whitelist):
 *   finmind_sync, themes_links_rebuild, ai_reviewer, factual_reviewer, hallu_rag
 *   Plus any get_* tool added to the whitelist by the caller.
 *
 * AGPL compliance: all code is IUF-original. ReAct pattern from Google Brain 2022 paper (public).
 */

import { randomUUID } from "crypto";
import { callLlm, estimateCostUsd, type LlmMessage } from "../llm/llm-gateway.js";
import { callTool } from "../tools/tool-registry-store.js";
import { getDb, isDatabaseMode, brainDecisions } from "@iuf-trading-room/db";
import { eq } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReactLoopOptions {
  workspaceId?: string | null;
  initialPrompt: string;
  /** Context data injected into system prompt (market data, holdings, etc.) */
  contextData?: string;
  maxRounds?: number;
  /** Hard cap on total LLM cost per session (USD). Default 1.0. Max 5.0. */
  costCapUsd?: number;
  /** Allowed tool keys. Must be non-empty. Tools not in this list → session fails. */
  toolWhitelist: string[];
  /** Pre-assigned run_id for idempotency. If omitted, a UUID is generated. */
  runId?: string;
}

export interface ReactStep {
  round: number;
  thought: string;
  toolName: string | null;
  toolInput: unknown | null;
  observation: unknown | null;
  tokensUsed: number;
}

export interface ReactLoopResult {
  runId: string;
  status: "complete" | "failed" | "budget_exceeded";
  reactTrace: ReactStep[];
  finalReport: string;
  totalTokens: number;
  totalCostUsd: number;
  /** UUID of the brain_decisions row written to DB (null if DB unavailable). */
  decisionId: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HARD_MAX_ROUNDS = 10;
const HARD_MAX_COST_USD = 5.0;
const DEFAULT_MAX_ROUNDS = 5;
const DEFAULT_COST_CAP_USD = 1.0;
const LOOP_MODEL_KEY = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";

// ── System prompt template ─────────────────────────────────────────────────────

function buildSystemPrompt(toolWhitelist: string[], contextData?: string): string {
  const toolList = toolWhitelist.join(", ");
  const context = contextData ? `\n\n## Current Market Context\n${contextData}` : "";

  return `You are IUF Brain, an AI analysis assistant for a trading control tower.
Your goal is to analyze the provided context and produce a clear, actionable report for the operator.

You have access to these tools: ${toolList}
If you need no more information, set toolName to null (Final Answer).

ALWAYS respond with valid JSON only. No markdown, no explanation outside the JSON.
Format:
{"thought": "<your reasoning>", "toolName": "<tool_key or null>", "toolInput": <{...} or null>}

Rules:
- Only use tools from the allowed list.
- Call at most one tool per round.
- When you have enough information, set toolName to null to finalize.
- Keep thoughts concise (< 200 words).${context}`;
}

function buildSynthesisPrompt(trace: ReactStep[], initialPrompt: string): string {
  const traceText = trace
    .map((s) => `Round ${s.round}:\nThought: ${s.thought}\nTool: ${s.toolName ?? "(none)"}\nObservation: ${JSON.stringify(s.observation)}`)
    .join("\n\n");

  return `Based on this analysis trace, write a concise markdown report for the operator.

## Original Request
${initialPrompt}

## Analysis Trace
${traceText}

Write a clear markdown report (2-4 paragraphs). Include: key findings, any concerns, and recommended next action.`;
}

// ── DB helpers (fire-and-forget) ──────────────────────────────────────────────

async function createDecisionRow(opts: {
  runId: string;
  workspaceId?: string | null;
  prompt: object;
}): Promise<string | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const id = randomUUID();
    await db.insert(brainDecisions).values({
      id,
      runId: opts.runId,
      workspaceId: opts.workspaceId ?? null,
      prompt: opts.prompt,
      reactTrace: [],
      status: "running",
      totalTokens: 0,
      totalCostUsd: "0"
    });
    return id;
  } catch (e) {
    console.warn("[react-loop] createDecisionRow failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function finalizeDecisionRow(opts: {
  decisionId: string;
  status: string;
  reactTrace: ReactStep[];
  finalReport: string;
  totalTokens: number;
  totalCostUsd: number;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;

  try {
    await db
      .update(brainDecisions)
      .set({
        status: opts.status,
        reactTrace: opts.reactTrace as unknown[],
        finalReport: opts.finalReport,
        totalTokens: opts.totalTokens,
        totalCostUsd: opts.totalCostUsd.toFixed(8),
        completedAt: new Date()
      })
      .where(eq(brainDecisions.id, opts.decisionId));
  } catch (e) {
    console.warn("[react-loop] finalizeDecisionRow failed:", e instanceof Error ? e.message : e);
  }
}

// ── LLM step parser ────────────────────────────────────────────────────────────

interface LlmStep {
  thought: string;
  toolName: string | null;
  toolInput: unknown | null;
}

function parseLlmStep(raw: string): LlmStep {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { thought?: string; toolName?: string | null; toolInput?: unknown };
    return {
      thought: String(parsed.thought ?? "(no thought)"),
      toolName: parsed.toolName ?? null,
      toolInput: parsed.toolInput ?? null
    };
  } catch {
    // If LLM gave non-JSON, treat as final thought
    return {
      thought: cleaned.slice(0, 300),
      toolName: null,
      toolInput: null
    };
  }
}

// ── Tool executor ──────────────────────────────────────────────────────────────

/**
 * Dispatches a tool call by key. Only supports tools available via dynamic import.
 * Phase A: finmind_sync, themes_links_rebuild, ai_reviewer, factual_reviewer, hallu_rag.
 * Unknown tool keys → throws (caught by caller → marks session failed).
 */
async function dispatchTool(
  toolName: string,
  toolInput: unknown,
  workspaceId?: string | null
): Promise<unknown> {
  // callTool() wraps with ToolCenter audit (tool_calls row).
  // Brain ReAct calls tools with brain_react callerType.
  return callTool(toolName, "brain_react", workspaceId, toolInput, async (input) => {
    switch (toolName) {
      case "finmind_sync": {
        // triggerFinMindSyncTracked in finmind-sync-tool.ts supports "institutional_buysell" | "margin_short"
        const { triggerFinMindSyncTracked } = await import("../tools/finmind-sync-tool.js");
        const inp = input as { dataset?: "institutional_buysell" | "margin_short"; tickers?: Array<{ ticker: string }>; startDate?: string; endDate?: string };
        return triggerFinMindSyncTracked({
          dataset: inp.dataset ?? "institutional_buysell",
          tickers: inp.tickers ?? [],
          startDate: inp.startDate,
          endDate: inp.endDate
        }, workspaceId, "llm");
      }
      case "themes_links_rebuild": {
        // triggerThemesLinksRebuildTracked(workspaceId, callerType)
        const { triggerThemesLinksRebuildTracked } = await import("../tools/themes-links-rebuild-tool.js");
        return triggerThemesLinksRebuildTracked(workspaceId ?? "", "llm");
      }
      case "ai_reviewer": {
        // fireAiReviewerForDraftTracked(draftId, workspaceId) — Phase B wrap in ai-reviewer
        const { fireAiReviewerForDraftTracked } = await import("../openalice-ai-reviewer.js");
        const inp = input as { draftId: string };
        await fireAiReviewerForDraftTracked(inp.draftId, workspaceId ?? "");
        return { draftId: inp.draftId, status: "review_dispatched" };
      }
      case "factual_reviewer": {
        // runFactualReview(briefContent, rawSources, draftId) — with empty rawSources returns null (safe)
        const { runFactualReview } = await import("../openalice-factual-reviewer.js");
        const inp = input as { briefContent?: string; draftId?: string };
        // Empty rawSources → cost guard triggers → returns null immediately (no LLM cost)
        return runFactualReview(inp.briefContent ?? "", [], inp.draftId ?? "brain_react");
      }
      case "hallu_rag": {
        // runRagHallucinationCheck — full input required; Brain provides content at minimum
        const { runRagHallucinationCheck } = await import("../hallucination-rag.js");
        const inp = input as { content: string; claimExtractModel?: string; crossValidateModel?: string };
        const model = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
        return runRagHallucinationCheck({
          apiKey: process.env["OPENAI_API_KEY"] ?? "",
          content: inp.content,
          sourceTrail: [],
          rawSources: [],
          claimExtractModel: inp.claimExtractModel ?? model,
          crossValidateModel: inp.crossValidateModel ?? model
        });
      }
      default:
        throw new Error(`TOOL_NOT_FOUND: ${toolName} is not registered in Phase A tool dispatcher`);
    }
  });
}

// ── Core runReactLoop ──────────────────────────────────────────────────────────

/**
 * Runs the Brain ReAct loop.
 *
 * Phase A safety guarantees:
 *   - toolWhitelist is checked BEFORE any tool is dispatched
 *   - Any tool not in whitelist → status=failed immediately
 *   - No write-ops, no broker calls, no order submission
 */
export async function runReactLoop(opts: ReactLoopOptions): Promise<ReactLoopResult> {
  const runId = opts.runId ?? randomUUID();
  const maxRounds = Math.min(opts.maxRounds ?? DEFAULT_MAX_ROUNDS, HARD_MAX_ROUNDS);
  const costCapUsd = Math.min(opts.costCapUsd ?? DEFAULT_COST_CAP_USD, HARD_MAX_COST_USD);
  const trace: ReactStep[] = [];
  let totalTokens = 0;
  let totalCostUsd = 0;

  // Create DB row (fire-and-forget)
  const decisionId = await createDecisionRow({
    runId,
    workspaceId: opts.workspaceId,
    prompt: {
      intent: opts.initialPrompt,
      contextData: opts.contextData ?? null,
      toolWhitelist: opts.toolWhitelist,
      maxRounds,
      costCapUsd
    }
  });

  const systemPrompt = buildSystemPrompt(opts.toolWhitelist, opts.contextData);
  const conversationHistory: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: opts.initialPrompt }
  ];

  let finalStatus: "complete" | "failed" | "budget_exceeded" = "complete";
  let failReason = "";

  // ── ReAct loop ────────────────────────────────────────────────────────────
  for (let round = 1; round <= maxRounds; round++) {
    // Pre-round cost check
    if (totalCostUsd >= costCapUsd) {
      finalStatus = "budget_exceeded";
      break;
    }

    // ── Reason: LLM call ──
    const llmResult = await callLlm(conversationHistory, {
      modelKey: LOOP_MODEL_KEY,
      callerModule: "brain_react",
      taskType: "react_reason",
      workspaceId: opts.workspaceId,
      maxTokens: 512,
      temperature: 0.1
    });

    if (!llmResult) {
      // LLM call failed or quota exhausted
      finalStatus = "failed";
      failReason = "LLM call returned null (quota exceeded or API error)";
      trace.push({
        round,
        thought: failReason,
        toolName: null,
        toolInput: null,
        observation: null,
        tokensUsed: 0
      });
      break;
    }

    totalTokens += llmResult.usage.totalTokens;
    totalCostUsd += llmResult.costUsd;

    // ── Parse step ──
    const step = parseLlmStep(llmResult.content);

    // ── Final Answer round (no tool call) ──
    if (step.toolName === null) {
      trace.push({
        round,
        thought: step.thought,
        toolName: null,
        toolInput: null,
        observation: null,
        tokensUsed: llmResult.usage.totalTokens
      });
      // Append assistant turn to history for synthesis context
      conversationHistory.push({ role: "assistant", content: llmResult.content });
      finalStatus = "complete";
      break;
    }

    // ── Whitelist check (Phase A safety gate) ──
    if (!opts.toolWhitelist.includes(step.toolName)) {
      finalStatus = "failed";
      failReason = `WHITELIST_VIOLATION: tool '${step.toolName}' is not in the allowed whitelist`;
      trace.push({
        round,
        thought: step.thought,
        toolName: step.toolName,
        toolInput: step.toolInput,
        observation: { error: failReason },
        tokensUsed: llmResult.usage.totalTokens
      });
      break;
    }

    // ── Act: call tool ──
    let observation: unknown;
    try {
      observation = await dispatchTool(step.toolName, step.toolInput, opts.workspaceId);
    } catch (e) {
      // Tool failure does not abort the loop — LLM is told about the failure
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn(`[react-loop] tool '${step.toolName}' failed: ${errMsg}`);
      observation = { error: errMsg, toolName: step.toolName };
    }

    trace.push({
      round,
      thought: step.thought,
      toolName: step.toolName,
      toolInput: step.toolInput,
      observation,
      tokensUsed: llmResult.usage.totalTokens
    });

    // ── Update conversation history ──
    conversationHistory.push({ role: "assistant", content: llmResult.content });
    conversationHistory.push({
      role: "user",
      content: `Tool observation (round ${round}):\n${JSON.stringify(observation, null, 2)}\n\nContinue your analysis.`
    });

    // Post-round cost check (for budget_exceeded status at loop end)
    if (totalCostUsd >= costCapUsd) {
      finalStatus = "budget_exceeded";
      break;
    }
  }

  // If loop exhausted all rounds without Final Answer
  if (finalStatus === "complete" && trace.length > 0 && trace[trace.length - 1]?.toolName !== null) {
    finalStatus = "complete"; // still complete — generate synthesis below
  }

  // ── Final synthesis call → markdown report ──
  let finalReport = "";
  if (finalStatus !== "failed") {
    const synthesisPrompt = buildSynthesisPrompt(trace, opts.initialPrompt);
    const synthesisResult = await callLlm(
      [{ role: "user", content: synthesisPrompt }],
      {
        modelKey: LOOP_MODEL_KEY,
        callerModule: "brain_react_synthesis",
        taskType: "react_synthesis",
        workspaceId: opts.workspaceId,
        maxTokens: 1024,
        temperature: 0.2
      }
    );

    if (synthesisResult) {
      totalTokens += synthesisResult.usage.totalTokens;
      totalCostUsd += synthesisResult.costUsd;
      finalReport = synthesisResult.content;
    } else {
      finalReport = failReason
        ? `Analysis incomplete: ${failReason}`
        : `Analysis complete. ${trace.length} reasoning steps performed. Synthesis unavailable (LLM quota).`;
    }
  } else {
    finalReport = `Analysis failed: ${failReason}`;
  }

  // ── Finalize DB row ──
  if (decisionId) {
    void finalizeDecisionRow({
      decisionId,
      status: finalStatus,
      reactTrace: trace,
      finalReport,
      totalTokens,
      totalCostUsd
    });
  }

  return {
    runId,
    status: finalStatus,
    reactTrace: trace,
    finalReport,
    totalTokens,
    totalCostUsd,
    decisionId
  };
}

// ── Store accessors ────────────────────────────────────────────────────────────

export interface DecisionListItem {
  id: string;
  runId: string;
  workspaceId: string | null;
  status: string;
  totalTokens: number;
  totalCostUsd: string;
  createdAt: string;
  completedAt: string | null;
}

export interface DecisionDetail extends DecisionListItem {
  prompt: unknown;
  reactTrace: unknown[];
  finalReport: string | null;
}

export async function listRecentDecisions(limit = 20): Promise<DecisionListItem[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  try {
    const { desc } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(brainDecisions)
      .orderBy(desc(brainDecisions.createdAt))
      .limit(Math.min(limit, 100));

    return rows.map((r) => ({
      id: r.id,
      runId: r.runId,
      workspaceId: r.workspaceId ?? null,
      status: r.status,
      totalTokens: r.totalTokens,
      totalCostUsd: r.totalCostUsd ?? "0",
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null
    }));
  } catch (e) {
    console.warn("[react-loop] listRecentDecisions failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

export async function getDecisionByRunId(runId: string): Promise<DecisionDetail | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(brainDecisions)
      .where(eq(brainDecisions.runId, runId))
      .limit(1);

    const r = rows[0];
    if (!r) return null;

    return {
      id: r.id,
      runId: r.runId,
      workspaceId: r.workspaceId ?? null,
      status: r.status,
      totalTokens: r.totalTokens,
      totalCostUsd: r.totalCostUsd ?? "0",
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      prompt: r.prompt,
      reactTrace: Array.isArray(r.reactTrace) ? r.reactTrace as unknown[] : [],
      finalReport: r.finalReport ?? null
    };
  } catch (e) {
    console.warn("[react-loop] getDecisionByRunId failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
