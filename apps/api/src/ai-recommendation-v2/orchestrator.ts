/**
 * orchestrator.ts — AI Recommendation v2: Pure-AI Independent Market Judgment
 *
 * Architecture:
 *   [整體市場 data 抓全套] → [Brain ReAct AI 分析師] → [structured AiStockRecommendationV2[]]
 *
 * Key design:
 *   - Zero dependency on Athena fixture / cont_liq_v36 / Class5 / Family C
 *   - Uses Brain ReAct loop (react-loop.ts) with 5 market-data read-only tools
 *   - Parses AI markdown report → AiStockRecommendationV2[] items
 *   - Persists result to ai_recommendations_runs table (DB mode) or in-memory (test mode)
 *   - Parallel to existing /api/v1/recommendations (v1 not broken)
 *
 * Tool whitelist (read-only, no write-ops):
 *   get_market_overview, get_sector_rotation, get_company_technical,
 *   get_institutional_flow, get_news_top10
 *
 * AGPL compliance: all code is IUF-original. ReAct pattern from Google Brain 2022 paper.
 */

import { randomUUID } from "crypto";
import type { AiStockRecommendationV2 } from "@iuf-trading-room/contracts";
import { callTool } from "../tools/tool-registry-store.js";
import {
  getMarketOverview,
  getSectorRotation,
  getCompanyTechnical,
  getInstitutionalFlow,
  getNewsTop10,
} from "../tools/market-data-tools.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AiRecTrigger = "cron_0930" | "cron_1300" | "manual_refresh" | "test";

export interface AiRecommendationRunOptions {
  workspaceId?: string | null;
  trigger?: AiRecTrigger;
  maxRounds?: number;
  costCapUsd?: number;
  /** Pre-assigned run_id for idempotency */
  runId?: string;
  /** Today's date in YYYY-MM-DD (TST). Defaults to server clock. */
  dateStr?: string;
}

export interface AiRecommendationRunResult {
  runId: string;
  status: "complete" | "failed" | "budget_exceeded";
  generatedAt: string;
  items: AiStockRecommendationV2[];
  reactTrace: unknown[];
  finalReportMarkdown: string;
  totalCostUsd: number;
  totalTokens: number;
  /** UUID of the ai_recommendations_runs DB row (null in memory mode) */
  dbRowId: string | null;
}

// ── In-memory cache (latest run, per-process) ─────────────────────────────────
// Serves the GET endpoint without hitting DB on every request.

let _latestRunCache: AiRecommendationRunResult | null = null;
let _latestRunCacheExpiresAt: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getLatestAiRecommendationRun(): AiRecommendationRunResult | null {
  if (_latestRunCache && Date.now() < _latestRunCacheExpiresAt) {
    return _latestRunCache;
  }
  return null;
}

export async function loadLatestAiRecommendationRunFromDb(): Promise<AiRecommendationRunResult | null> {
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return null;
    const db = getDb();
    if (!db) return null;
    const { desc, sql } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(aiRecommendationsRuns)
      .where(sql`${aiRecommendationsRuns.trigger} not like ${"%:v3"}`)
      .orderBy(desc(aiRecommendationsRuns.generatedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      runId: row.runId,
      status: row.status as AiRecommendationRunResult["status"],
      generatedAt: row.generatedAt.toISOString(),
      items: (row.items ?? []) as AiStockRecommendationV2[],
      reactTrace: (row.reactTrace ?? []) as unknown[],
      finalReportMarkdown: row.finalReportMarkdown ?? "",
      totalCostUsd: Number(row.costUsd ?? 0),
      totalTokens: row.totalTokens ?? 0,
      dbRowId: row.id,
    };
  } catch (e) {
    console.warn("[ai-rec-v2] loadLatestAiRecommendationRunFromDb failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getLatestAiRecommendationRunForRead(): Promise<AiRecommendationRunResult | null> {
  const cached = getLatestAiRecommendationRun();
  if (cached) return cached;
  const dbRun = await loadLatestAiRecommendationRunFromDb();
  if (!dbRun) return null;
  _latestRunCache = dbRun;
  _latestRunCacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return dbRun;
}

export function _resetAiRecommendationCache(): void {
  _latestRunCache = null;
  _latestRunCacheExpiresAt = 0;
}

// ── Date helper ───────────────────────────────────────────────────────────────

function todayTst(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// ── DB persistence ────────────────────────────────────────────────────────────

async function persistRunStart(opts: {
  id: string;
  runId: string;
  workspaceId?: string | null;
  trigger: AiRecTrigger;
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
      trigger: opts.trigger,
      items: [],
      reactTrace: [],
    });
  } catch (e) {
    console.warn("[ai-rec-v2] persistRunStart failed:", e instanceof Error ? e.message : e);
  }
}

async function persistRunComplete(opts: {
  id: string;
  status: string;
  items: AiStockRecommendationV2[];
  reactTrace: unknown[];
  finalReportMarkdown: string;
  costUsd: number;
  totalTokens: number;
  model: string;
}): Promise<void> {
  try {
    const { getDb, isDatabaseMode, aiRecommendationsRuns } = await import("@iuf-trading-room/db");
    if (!isDatabaseMode()) return;
    const db = getDb();
    if (!db) return;
    const { eq } = await import("drizzle-orm");
    await db
      .update(aiRecommendationsRuns)
      .set({
        status: opts.status,
        items: opts.items as unknown[],
        reactTrace: opts.reactTrace,
        finalReportMarkdown: opts.finalReportMarkdown,
        costUsd: opts.costUsd.toFixed(8),
        totalTokens: opts.totalTokens,
        model: opts.model,
        completedAt: new Date(),
      })
      .where(eq(aiRecommendationsRuns.id, opts.id));
  } catch (e) {
    console.warn("[ai-rec-v2] persistRunComplete failed:", e instanceof Error ? e.message : e);
  }
}

// ── Ticker validation ─────────────────────────────────────────────────────────

/**
 * Year pattern list: LLM tends to hallucinate current/recent years as tickers.
 * Reject any ticker that is ONLY digits and matches a year from 2010–2035.
 */
const YEAR_PATTERN = /^(201\d|202[0-9]|2030|2031|2032|2033|2034|2035)$/;

/**
 * Valid TW stock ticker: 4 digits (e.g. 2330) or 4 digits + 1 uppercase letter (e.g. 0050T).
 * Rejects: years, 3-digit codes, 5+ digit codes without a valid letter suffix, etc.
 */
export function validateTicker(ticker: string): { valid: boolean; reason?: string } {
  if (!ticker) return { valid: false, reason: "empty" };
  // Must be 4-digit or 4-digit+letter format
  if (!/^\d{4}[A-Z]?$/.test(ticker)) {
    return { valid: false, reason: `format_invalid: "${ticker}" is not 4-digit or 4-digit+letter` };
  }
  // Reject year patterns (2020, 2021, 2022 ... 2030 etc.)
  const digitPart = ticker.replace(/[A-Z]$/, "");
  if (YEAR_PATTERN.test(digitPart)) {
    return { valid: false, reason: `year_pattern: "${ticker}" looks like a calendar year, not a ticker` };
  }
  return { valid: true };
}

/**
 * Builds a Set of valid TW ticker codes from TWSE STOCK_DAY_ALL.
 * Used to reject hallucinated tickers that don't appear in live market data.
 * Returns empty set if TWSE data unavailable (fail-open: caller treats empty as "no whitelist").
 */
export async function buildTickerWhitelist(): Promise<Set<string>> {
  try {
    const { getStockDayAllRows } = await import("../data-sources/twse-openapi-client.js");
    const rows = await getStockDayAllRows().catch(() => []);
    const whitelist = new Set<string>();
    for (const row of rows as Array<{ Code?: string }>) {
      if (row.Code && /^\d{4,6}[A-Z]?$/.test(row.Code)) {
        whitelist.add(row.Code);
      }
    }
    return whitelist;
  } catch {
    return new Set<string>(); // fail-open: no whitelist enforcement if data unavailable
  }
}

// ── Markdown parser ───────────────────────────────────────────────────────────

/**
 * Parses the Brain ReAct final markdown report → AiStockRecommendationV2[].
 *
 * Expected markdown format from AI (flexible — parser is tolerant):
 * Each stock block:
 *   ## 2330 台積電
 *   - 進場: 870-890
 *   - TP1: 920  TP2: 960
 *   - 停損: 850
 *   - 信心: 0.8
 *   - 推薦理由: ...
 *   - 分類: 今日首選
 *
 * Buckets (action):
 *   今日首選 | 可觀察布局（研究參考）| 等回檔 | 高風險排除 | 資料不足暫不推薦
 */
const BUCKET_MAP: Record<string, AiStockRecommendationV2["action"]> = {
  "今日首選": "今日首選",
  "可觀察": "可觀察布局（研究參考）",
  "可觀察布局": "可觀察布局（研究參考）",
  "等回檔": "等回檔",
  "高風險": "高風險排除",
  "高風險排除": "高風險排除",
  "資料不足": "資料不足暫不推薦",
};

function extractAction(text: string): AiStockRecommendationV2["action"] {
  for (const [key, val] of Object.entries(BUCKET_MAP)) {
    if (text.includes(key)) return val;
  }
  return "可觀察布局（研究參考）";
}

function parseFloat2(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : n;
}

function extractPriceRange(line: string): { low: number | null; high: number | null } {
  const m = line.match(/(\d+(?:\.\d+)?)\s*[-~～至到]\s*(\d+(?:\.\d+)?)/);
  if (m) return { low: parseFloat2(m[1]), high: parseFloat2(m[2]) };
  const single = line.match(/(\d{2,5}(?:\.\d+)?)/);
  if (single) {
    const v = parseFloat2(single[1]);
    return { low: v, high: v };
  }
  return { low: null, high: null };
}

export function parseAiReportToRecommendations(
  markdown: string,
  dateStr: string
): AiStockRecommendationV2[] {
  const results: AiStockRecommendationV2[] = [];
  if (!markdown || markdown.trim().length === 0) return results;

  // Split by stock headings — ## XXXX or ### XXXX or numbered "1. XXXX"
  const stockBlocks = markdown.split(/(?=^##+ \d{4}|^\d+\.\s+\d{4})/m);

  for (const block of stockBlocks) {
    if (!block.trim()) continue;

    // Extract ticker (4-digit TW stock code)
    const tickerMatch = block.match(/\b(\d{4,6}[A-Z]?)\b/);
    if (!tickerMatch) continue;
    const ticker = tickerMatch[1]!;

    // F1: Validate ticker format — reject year patterns and malformed codes
    const tickerValidation = validateTicker(ticker);
    if (!tickerValidation.valid) {
      console.warn(`[ai-rec-v2] REJECT hallucinated ticker "${ticker}": ${tickerValidation.reason}`);
      continue;
    }

    // Extract company name (Chinese chars after ticker on same heading line)
    const nameMatch = block.match(new RegExp(ticker + "\\s+([\\u4e00-\\u9fff\\w\\s]{2,20})"));
    const companyName = nameMatch ? nameMatch[1]!.trim() : ticker;

    // Extract fields from bullet lines
    const lines = block.split("\n");
    let tp1: number | null = null;
    let tp2: number | null = null;
    let stopLoss: number | null = null;
    let confidence: number | null = null;
    let entryLow: number | null = null;
    let entryHigh: number | null = null;
    let rationaleLines: string[] = [];
    let bucket: AiStockRecommendationV2["action"] = "可觀察布局（研究參考）";

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (/進場|entry|entry price/.test(lower)) {
        const pr = extractPriceRange(line);
        entryLow = pr.low;
        entryHigh = pr.high;
      } else if (/tp1|目標一|target 1/.test(lower)) {
        tp1 = parseFloat2(line.match(/[\d.]+/)?.[0]);
      } else if (/tp2|目標二|target 2/.test(lower)) {
        tp2 = parseFloat2(line.match(/[\d.]+/)?.[0]);
      } else if (/停損|stop|sl/.test(lower)) {
        stopLoss = parseFloat2(line.match(/[\d.]+/)?.[0]);
      } else if (/信心|confidence/.test(lower)) {
        const cv = line.match(/([01](?:\.\d+)?)/);
        confidence = cv ? parseFloat2(cv[1]) : null;
      } else if (/分類|bucket|類別/.test(lower)) {
        bucket = extractAction(line);
      } else if (/理由|reason|推薦|why|because/.test(lower)) {
        rationaleLines.push(line.replace(/^[-*•\s]+/, "").trim());
      } else if (line.trim().startsWith("-") || line.trim().startsWith("*")) {
        // Catch any remaining bullet as rationale candidate
        const content = line.replace(/^[-*•\s]+/, "").trim();
        if (content.length > 10 && !/^\d/.test(content)) {
          rationaleLines.push(content);
        }
      }
    }

    // If no explicit bucket found, infer from content
    if (bucket === "可觀察布局（研究參考）") {
      bucket = extractAction(block);
    }

    const rationale = rationaleLines.join("; ") || block.slice(0, 200).replace(/\n/g, " ").trim();

    // Build AiStockRecommendationV2 — use all available fields; null where missing
    const rec: AiStockRecommendationV2 = {
      id: randomUUID(),
      ticker,
      companyName,
      action: bucket,
      date: dateStr,
      confidence: confidence ?? (bucket === "今日首選" ? 0.8 : bucket === "高風險排除" ? 0.2 : 0.5),
      rationale,
      entryPriceRange: (entryLow !== null || entryHigh !== null)
        ? { low: entryLow, high: entryHigh }
        : null,
      tp1: tp1 ?? null,
      tp2: tp2 ?? null,
      stopLoss: stopLoss ?? null,
      aiGenerated: true,
      source: "brain_react_v2",
    };

    // Deduplicate by ticker — keep first occurrence
    if (!results.some(r => r.ticker === ticker)) {
      results.push(rec);
    }
  }

  return results;
}

// ── Post-synthesis item validation (F2 + F3) ─────────────────────────────────

/**
 * validateAndEnrichItems:
 *   F2: Forces a real get_company_technical call for each candidate ticker.
 *       Items whose ticker returns lastPrice=null (no DB data) are rejected unless
 *       DB mode is unavailable (test mode: all items pass through).
 *   F3: Builds TWSE ticker whitelist from live STOCK_DAY_ALL.
 *       Items whose ticker is not in whitelist are rejected (fail-open: if whitelist is
 *       empty because TWSE data unavailable, no items are rejected on this criterion).
 *
 * This is applied post-synthesis so that LLM-hallucinated tickers are caught before persist.
 */
export async function validateAndEnrichItems(
  items: AiStockRecommendationV2[],
  workspaceId?: string | null
): Promise<AiStockRecommendationV2[]> {
  if (items.length === 0) return items;

  // F3: Build ticker whitelist from TWSE (fail-open if unavailable)
  const whitelist = await buildTickerWhitelist();
  const hasWhitelist = whitelist.size > 0;

  const validated: AiStockRecommendationV2[] = [];

  for (const item of items) {
    // F3: Whitelist check — only enforce when whitelist is populated
    if (hasWhitelist && !whitelist.has(item.ticker)) {
      console.warn(`[ai-rec-v2] REJECT "${item.ticker}": not in TWSE ticker whitelist (${whitelist.size} known tickers)`);
      continue;
    }

    // F2: Force real get_company_technical call
    let techData: Awaited<ReturnType<typeof getCompanyTechnical>> | null = null;
    try {
      techData = await getCompanyTechnical(item.ticker);
    } catch {
      techData = null;
    }

    // If DB is available but no OHLCV rows exist → reject (hallucinated ticker)
    // If DB is unavailable (test mode, techData returns base with all nulls and source="companies_ohlcv") → pass through
    if (techData !== null && techData.lastPrice === null && techData.asOf === null) {
      // Check if DB mode is active — only reject in DB mode with missing data
      let dbMode = false;
      try {
        const { isDatabaseMode } = await import("@iuf-trading-room/db");
        dbMode = isDatabaseMode();
      } catch {
        dbMode = false;
      }
      if (dbMode) {
        console.warn(`[ai-rec-v2] REJECT "${item.ticker}": get_company_technical returned no OHLCV data (DB mode active)`);
        continue;
      }
    }

    // Enrich: if we got real price data, add it to the item metadata
    if (techData && techData.lastPrice !== null) {
      // Attach real price as a rationale supplement (does not override core fields)
      const priceNote = `実証確認: 終値${techData.lastPrice} RSI${techData.rsi14 ?? "N/A"} MA20${techData.ma20 ?? "N/A"}`;
      item.rationale = item.rationale ? `${item.rationale} | ${priceNote}` : priceNote;
    }

    validated.push(item);
  }

  return validated;
}

// ── dispatchTool for ReAct (market data tools) ─────────────────────────────────

async function dispatchMarketTool(
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
      default:
        throw new Error(`TOOL_NOT_FOUND: ${toolName} is not in ai-recommendation-v2 tool whitelist`);
    }
  });
}

// ── Core runAiRecommendationV2 ─────────────────────────────────────────────────

const TOOL_WHITELIST = [
  "get_market_overview",
  "get_sector_rotation",
  "get_company_technical",
  "get_institutional_flow",
  "get_news_top10",
] as const;

/**
 * Runs the AI Recommendation v2 loop.
 * Uses Brain ReAct reasoning with 5 market-data read-only tools.
 * Persists to ai_recommendations_runs table (DB mode) or in-memory (test mode).
 * Returns structured AiRecommendationRunResult.
 */
export async function runAiRecommendationV2(
  opts: AiRecommendationRunOptions = {}
): Promise<AiRecommendationRunResult> {
  const runId = opts.runId ?? randomUUID();
  const dbRowId = randomUUID();
  const trigger = opts.trigger ?? "manual_refresh";
  const dateStr = opts.dateStr ?? todayTst();
  const generatedAt = new Date().toISOString();
  const model = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";

  // Persist start row before work starts so readers can recover process state.
  await persistRunStart({ id: dbRowId, runId, workspaceId: opts.workspaceId, trigger });

  let reactResult: Awaited<ReturnType<typeof import("../brain/react-loop.js")["runReactLoop"]>>;
  try {
    const { runReactLoop } = await import("../brain/react-loop.js");

    // Override dispatchTool inside the loop by extending it via toolWhitelist
    // The react-loop uses its own dispatchTool internally; we need to call it with
    // our market-data-specific whitelist. We do this by wrapping the loop with
    // a custom dispatch override pattern: provide a custom contextData so the LLM
    // knows what tools are available, and handle dispatch ourselves.
    //
    // Implementation: We run a custom mini-ReAct loop that calls our dispatchMarketTool.
    // This avoids coupling to react-loop internals while reusing the cost/token accounting.
    reactResult = await runCustomMarketReActLoop({
      runId,
      workspaceId: opts.workspaceId,
      dateStr,
      maxRounds: opts.maxRounds ?? 8,
      costCapUsd: opts.costCapUsd ?? 1.5,
      model,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[ai-rec-v2] ReAct loop error:", errMsg);
    const failed: AiRecommendationRunResult = {
      runId,
      status: "failed",
      generatedAt,
      items: [],
      reactTrace: [],
      finalReportMarkdown: `Error: ${errMsg}`,
      totalCostUsd: 0,
      totalTokens: 0,
      dbRowId,
    };
    await persistRunComplete({
      id: dbRowId,
      status: "failed",
      items: [],
      reactTrace: [],
      finalReportMarkdown: `Error: ${errMsg}`,
      costUsd: 0,
      totalTokens: 0,
      model,
    });
    _latestRunCache = failed;
    _latestRunCacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return failed;
  }

  // Parse markdown → structured items
  const rawItems = parseAiReportToRecommendations(reactResult.finalReport, dateStr);

  // F2 + F3: Validate items — force get_company_technical call + ticker whitelist check
  const items = await validateAndEnrichItems(rawItems, opts.workspaceId);

  const result: AiRecommendationRunResult = {
    runId,
    status: reactResult.status,
    generatedAt,
    items,
    reactTrace: reactResult.reactTrace,
    finalReportMarkdown: reactResult.finalReport,
    totalCostUsd: reactResult.totalCostUsd,
    totalTokens: reactResult.totalTokens,
    dbRowId,
  };

  // Persist completion before returning so deploy/restart keeps the latest run.
  await persistRunComplete({
    id: dbRowId,
    status: reactResult.status,
    items,
    reactTrace: reactResult.reactTrace,
    finalReportMarkdown: reactResult.finalReport,
    costUsd: reactResult.totalCostUsd,
    totalTokens: reactResult.totalTokens,
    model,
  });

  // Update in-memory cache
  _latestRunCache = result;
  _latestRunCacheExpiresAt = Date.now() + CACHE_TTL_MS;

  return result;
}

// ── Custom mini-ReAct loop for market data tools ───────────────────────────────
// Separate from the Brain ReAct loop to avoid coupling to its internal dispatchTool.
// Reuses callLlm + estimateCostUsd from llm-gateway; same JSON protocol.

interface MarketReActStep {
  round: number;
  thought: string;
  toolName: string | null;
  toolInput: unknown | null;
  observation: unknown | null;
  tokensUsed: number;
}

async function runCustomMarketReActLoop(opts: {
  runId: string;
  workspaceId?: string | null;
  dateStr: string;
  maxRounds: number;
  costCapUsd: number;
  model: string;
}): Promise<{
  runId: string;
  status: "complete" | "failed" | "budget_exceeded";
  reactTrace: MarketReActStep[];
  finalReport: string;
  totalTokens: number;
  totalCostUsd: number;
  decisionId: string | null;
}> {
  const { callLlm } = await import("../llm/llm-gateway.js");
  type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

  const maxRounds = Math.min(opts.maxRounds, 10);
  const costCap = Math.min(opts.costCapUsd, 5.0);
  const trace: MarketReActStep[] = [];
  let totalTokens = 0;
  let totalCostUsd = 0;

  const systemPrompt = `You are IUF Brain, an independent Taiwan stock market AI analyst.
Today is ${opts.dateStr} (Taipei time).
Your task: Analyze the current overall market (大盤, sector rotation, news, institutional flow) and recommend 5-10 Taiwan stocks worth watching TODAY.

CRITICAL RULES — ANTI-HALLUCINATION:
1. Every stock ticker you recommend MUST be a real 4-digit Taiwan stock code (e.g., 2330, 2454, 2317).
2. NEVER use calendar years (2020, 2021, 2022, 2023, 2024, 2025, 2026, etc.) as tickers.
3. NEVER invent tickers. Only use tickers you have explicitly seen in tool results.
4. You MUST call get_company_technical for EACH ticker before recommending it.
5. If get_company_technical returns no price data for a ticker, DO NOT recommend it.
6. Only recommend tickers that appeared in actual tool results (sector rotation, news, or technical data).
7. If sector/news tools return no usable candidates, use this core candidate universe for get_company_technical calls:
   2330, 2454, 2317, 2308, 2412, 3711, 3707, 2882, 2881, 6505.

You have access to these tools: ${TOOL_WHITELIST.join(", ")}

ALWAYS respond with valid JSON only. No markdown, no explanation outside the JSON.
Format:
{"thought": "<your reasoning in 1-3 sentences>", "toolName": "<tool_key or null>", "toolInput": <{...} or null>}

Rules:
- Start by getting market overview, then sector rotation, then news.
- For each promising ticker, MUST call get_company_technical to verify it has real data.
- When you have enough info (after at least 4 rounds), set toolName to null for Final Answer.
- Keep thoughts concise.`;

  const messages: LlmMessage[] = [{ role: "system", content: systemPrompt }];
  let userMsg = `Analyze the Taiwan market for ${opts.dateStr} and recommend stocks. Start with get_market_overview.`;
  messages.push({ role: "user", content: userMsg });

  for (let round = 1; round <= maxRounds; round++) {
    // Cost guard
    if (totalCostUsd >= costCap) {
      return { runId: opts.runId, status: "budget_exceeded", reactTrace: trace, finalReport: `Budget cap $${costCap} reached after ${round - 1} rounds.`, totalTokens, totalCostUsd, decisionId: null };
    }

    const llmResult = await callLlm(messages, {
      modelKey: opts.model,
      callerModule: "ai_rec_v2",
      taskType: "react_reason",
      workspaceId: opts.workspaceId,
      maxTokens: 768,
      temperature: 0.1,
    });
    if (!llmResult) {
      // LLM unavailable (no API key in test mode) — return gracefully
      return { runId: opts.runId, status: "failed", reactTrace: trace, finalReport: "(LLM unavailable)", totalTokens, totalCostUsd, decisionId: null };
    }

    // Accumulate cost from LLM result
    totalTokens += llmResult.usage.totalTokens;
    totalCostUsd += llmResult.costUsd;
    const raw = llmResult.content;

    // Parse step
    const step = parseMarketStep(raw);

    // Tool whitelist check
    if (step.toolName && !(TOOL_WHITELIST as readonly string[]).includes(step.toolName)) {
      const errStep: MarketReActStep = { round, thought: step.thought, toolName: step.toolName, toolInput: step.toolInput, observation: `BLOCKED: tool ${step.toolName} not in whitelist`, tokensUsed: llmResult.usage.totalTokens };
      trace.push(errStep);
      return { runId: opts.runId, status: "failed", reactTrace: trace, finalReport: `Tool not in whitelist: ${step.toolName}`, totalTokens, totalCostUsd, decisionId: null };
    }

    // Final answer
    if (!step.toolName) {
      trace.push({ round, thought: step.thought, toolName: null, toolInput: null, observation: null, tokensUsed: llmResult.usage.totalTokens });
      // Synthesis
      const report = await synthesizeReport(trace, opts.dateStr, opts.model);
      return { runId: opts.runId, status: "complete", reactTrace: trace, finalReport: report, totalTokens, totalCostUsd, decisionId: null };
    }

    // Execute tool
    let observation: unknown;
    try {
      observation = await dispatchMarketTool(step.toolName, step.toolInput, opts.workspaceId);
    } catch (err) {
      observation = { error: err instanceof Error ? err.message : String(err) };
    }

    trace.push({ round, thought: step.thought, toolName: step.toolName, toolInput: step.toolInput, observation, tokensUsed: llmResult.usage.totalTokens });

    // Add observation to conversation
    messages.push({ role: "assistant", content: raw });
    messages.push({ role: "user", content: `Tool ${step.toolName} result: ${JSON.stringify(observation).slice(0, 2000)}` });
  }

  // Max rounds reached — synthesize with what we have
  const report = await synthesizeReport(trace, opts.dateStr, opts.model);
  return { runId: opts.runId, status: "complete", reactTrace: trace, finalReport: report, totalTokens, totalCostUsd, decisionId: null };
}

function parseMarketStep(raw: string): { thought: string; toolName: string | null; toolInput: unknown | null } {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { thought?: string; toolName?: string | null; toolInput?: unknown };
    return {
      thought: String(parsed.thought ?? "(no thought)"),
      toolName: parsed.toolName ?? null,
      toolInput: parsed.toolInput ?? null,
    };
  } catch {
    return { thought: cleaned.slice(0, 300), toolName: null, toolInput: null };
  }
}

async function synthesizeReport(
  trace: MarketReActStep[],
  dateStr: string,
  model: string
): Promise<string> {
  const { callLlm: callLlmFn } = await import("../llm/llm-gateway.js");
  const traceText = trace
    .map(s => `Round ${s.round}:\nThought: ${s.thought}\nTool: ${s.toolName ?? "(Final Answer)"}\nResult: ${JSON.stringify(s.observation).slice(0, 500)}`)
    .join("\n\n");

  const synthesisPrompt = `Based on this market analysis, write a stock recommendation report for ${dateStr}.

## Analysis Trace
${traceText}

CRITICAL ANTI-HALLUCINATION RULES:
1. ONLY recommend tickers explicitly mentioned in the Analysis Trace above.
2. NEVER use calendar years (2024, 2025, 2026, etc.) as ticker codes.
3. NEVER invent company names or tickers not present in tool results.
4. If a ticker had get_company_technical called and showed real price data → include it.
5. If no real price data was retrieved for a ticker → use 分類: 資料不足暫不推薦 or omit.

Write recommendations in this format for EACH recommended stock:

## [ticker] [company name]
- 進場: [price range, e.g. 870-890 — ONLY if seen in tool results; else write "N/A"]
- TP1: [target 1]  TP2: [target 2]
- 停損: [stop loss]
- 信心: [0.0-1.0]
- 推薦理由: [reasoning with market data evidence — cite specific numbers from trace]
- 分類: [今日首選 | 可觀察布局 | 等回檔 | 高風險排除 | 資料不足暫不推薦]

Recommend 5-10 stocks. Only use tickers and data from the trace above.`;

  const llmResult = await callLlmFn(
    [
      { role: "system", content: "You are a Taiwan stock market analyst. Write structured markdown reports." },
      { role: "user", content: synthesisPrompt }
    ],
    { modelKey: model, callerModule: "ai_rec_v2", taskType: "synthesis", maxTokens: 2048, temperature: 0.3 }
  );

  return llmResult?.content ?? "(synthesis unavailable — LLM returned null)";
}
