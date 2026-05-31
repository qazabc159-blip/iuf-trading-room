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
export const COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION = "company_ai_analyst_report_v1";
const COMPANY_AI_ANALYST_TEMPLATE_MARKER = `TEMPLATE_VERSION: ${COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION}`;

const COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS = [
  { n: 1, pattern: /##\s*1[.\s]*公司概況與定位/u },
  { n: 2, pattern: /##\s*2[.\s]*今日\/最近資料狀態/u },
  { n: 3, pattern: /##\s*3[.\s]*近期事件與新聞/u },
  { n: 4, pattern: /##\s*4[.\s]*技術結構/u },
  { n: 5, pattern: /##\s*5[.\s]*籌碼與法人/u },
  { n: 6, pattern: /##\s*6[.\s]*主題與產業鏈位置/u },
  { n: 7, pattern: /##\s*7[.\s]*主要風險/u },
  { n: 8, pattern: /##\s*8[.\s]*AI\s*結論與觀察等級/u },
  { n: 9, pattern: /##\s*9[.\s]*資料來源與生成時間/u },
];

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

function buildCompanyAiAnalystSynthesisPrompt(traceText: string, initialPrompt: string, now: string): string {
  return `你是 IUF Trading Room 的公司頁 AI 分析師。請只根據初始需求與工具觀察，輸出固定格式的繁體中文 Markdown 報告。

## 初始需求
${initialPrompt}

## 工具觀察
${traceText}

## 輸出規格
必須完全照以下 9 個段落與順序輸出，不可改名、不可省略：

## 1. 公司概況與定位
說明公司名稱、主要業務、產業位置。沒有資料就寫「資料不足：原因」。

## 2. 今日/最近資料狀態
列出最新價、漲跌、K 線日期、資料是否即時或延遲。沒有資料就寫「資料不足：原因」。

## 3. 近期事件與新聞
只列與公司或產業直接相關的事件，並說明為什麼重要。不可 raw dump 新聞。

## 4. 技術結構
整理趨勢、均線、支撐壓力、量能。沒有資料就寫缺哪個 endpoint 或工具。

## 5. 籌碼與法人
整理法人、融資融券或可取得的籌碼資料。沒有資料就明確降級。

## 6. 主題與產業鏈位置
說明公司和目前主題、供應鏈、產業熱點的關聯。

## 7. 主要風險
至少列出資料風險、價格風險、事件風險。

## 8. AI 結論與觀察等級
結論只能是：可追蹤 / 中性觀察 / 資料不足 / 風險偏高暫不採用。必須註明不是下單建議。

## 9. 資料來源與生成時間
列出使用過的資料來源類型與生成時間：${now}

硬性規則：
- 每個關鍵判斷都要標出資料來源類型，例如 quote / kline / company_profile / news / institutional / margin / FinMind / KGI。
- 不可給保證獲利、必漲、勝率、重倉、All in 等語句。
- 不可輸出內部推理、工具 JSON、run_id、token 或工程除錯內容。
- 如果資料不足，照實寫「資料不足：原因」，不可猜測或補故事。`;
}

function buildSynthesisPrompt(trace: ReactStep[], initialPrompt: string): string {
  const traceText = trace
    .map((s) => `Round ${s.round}:\nThought: ${s.thought}\nTool: ${s.toolName ?? "(none)"}\nObservation: ${JSON.stringify(s.observation)}`)
    .join("\n\n");

  const now = new Date().toISOString();

  if (initialPrompt.includes(COMPANY_AI_ANALYST_TEMPLATE_MARKER)) {
    return buildCompanyAiAnalystSynthesisPrompt(traceText, initialPrompt, now);
  }

  return `根據以下分析追蹤，撰寫一份完整的繁體中文分析師報告。

## 原始請求
${initialPrompt}

## 分析追蹤
${traceText}

## 必要輸出格式（9 個段落，每段都必須有標題）

請嚴格依照以下 9 個段落輸出，標題與內容缺一不可：

## 1. 公司概況
（公司基本資料、產業定位、主要業務）

## 2. 近期事件
（最近重要公告、財報、新聞事件）

## 3. 技術結構
（K 線型態、移動均線位置、RSI、支撐壓力）

## 4. 籌碼
（外資、投信、自營商近期買賣超、融資融券）

## 5. 主題
（所屬投資主題、產業鏈位置、關聯政策）

## 6. 風險
（主要下行風險、注意事項）

## 7. AI 推薦結論
（明確的操作建議：觀察 / 可布局 / 今日首選 / 不建議；含建議進場區間或理由）

## 8. 資料來源
（列出使用的工具與資料來源）

## 9. 生成時間
${now}

---
重要規則：
- 必須輸出全部 9 個段落，不能省略任何一個
- 若缺乏某段落資料，請寫「資料不足，需補充」
- 全文使用繁體中文
- AI 推薦結論必須明確（不能曖昧帶過）`;
}

/**
 * Validates that synthesis output contains all 9 required Chinese sections.
 * Returns missing section numbers if any are absent.
 */
export function validateCompanyAiAnalystSections(report: string): number[] {
  return COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS
    .filter((r) => !r.pattern.test(report))
    .map((r) => r.n);
}

export function validateSynthesisSections(report: string, initialPrompt = ""): number[] {
  if (initialPrompt.includes(COMPANY_AI_ANALYST_TEMPLATE_MARKER)) {
    return validateCompanyAiAnalystSections(report);
  }

  const required = [
    { n: 1, pattern: /##\s*1[.\s]*公司概況/u },
    { n: 2, pattern: /##\s*2[.\s]*近期事件/u },
    { n: 3, pattern: /##\s*3[.\s]*技術結構/u },
    { n: 4, pattern: /##\s*4[.\s]*籌碼/u },
    { n: 5, pattern: /##\s*5[.\s]*主題/u },
    { n: 6, pattern: /##\s*6[.\s]*風險/u },
    { n: 7, pattern: /##\s*7[.\s]*AI\s*推薦結論/u },
    { n: 8, pattern: /##\s*8[.\s]*資料來源/u },
    { n: 9, pattern: /##\s*9[.\s]*生成時間/u },
  ];
  return required.filter(r => !r.pattern.test(report)).map(r => r.n);
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
      // ── Market-data read-only tools (Phase A+) ────────────────────────────
      case "get_company_technical": {
        const { getCompanyTechnical } = await import("../tools/market-data-tools.js");
        const inp = input as { ticker?: string };
        if (!inp.ticker) throw new Error("get_company_technical requires ticker");
        return getCompanyTechnical(inp.ticker);
      }
      case "get_news_top10": {
        const { getNewsTop10 } = await import("../tools/market-data-tools.js");
        return getNewsTop10();
      }
      case "get_market_overview": {
        const { getMarketOverview } = await import("../tools/market-data-tools.js");
        return getMarketOverview();
      }
      case "get_institutional_flow": {
        const { getInstitutionalFlow } = await import("../tools/market-data-tools.js");
        const inp = input as { ticker?: string };
        if (!inp.ticker) throw new Error("get_institutional_flow requires ticker");
        return getInstitutionalFlow(inp.ticker);
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

  // ── Final synthesis call → 9-section Chinese markdown report ──
  let finalReport = "";
  if (finalStatus !== "failed") {
    const synthesisPrompt = buildSynthesisPrompt(trace, opts.initialPrompt);

    const runSynthesis = async (): Promise<string | null> => {
      const res = await callLlm(
        [{ role: "user", content: synthesisPrompt }],
        {
          modelKey: LOOP_MODEL_KEY,
          callerModule: "brain_react_synthesis",
          taskType: "react_synthesis",
          workspaceId: opts.workspaceId,
          maxTokens: 1500,
          temperature: 0.2
        }
      );
      if (!res) return null;
      totalTokens += res.usage.totalTokens;
      totalCostUsd += res.costUsd;
      return res.content;
    };

    let synthesisContent = await runSynthesis();

    // Validate 9 sections — retry once if any missing
    if (synthesisContent) {
      const missingSections = validateSynthesisSections(synthesisContent, opts.initialPrompt);
      if (missingSections.length > 0) {
        console.warn(`[react-loop] synthesis missing sections ${missingSections.join(",")} — retrying once`);
        const retryContent = await runSynthesis();
        if (retryContent) {
          synthesisContent = retryContent;
        }
      }
    }

    if (synthesisContent) {
      finalReport = synthesisContent;
    } else {
      finalReport = failReason
        ? `分析未完成：${failReason}`
        : `分析完成。共執行 ${trace.length} 步推理。報告生成失敗（LLM 配額不足）。`;
    }
  } else {
    finalReport = `分析失敗：${failReason}`;
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
