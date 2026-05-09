/**
 * openai-strategy-ranker.ts — Scenario 1: AI second-pass reranking for strategy ideas.
 *
 * Flow:
 *   1. getStrategyIdeas() produces algorithmic top-N ideas (algo_score, confidence, direction, etc.)
 *   2. This module takes top-20 of those ideas and sends a compact summary to gpt-4o-mini.
 *   3. AI returns a reordered list with `why_pick` (1 sentence, ≤60 chars) per idea.
 *   4. The reranked result is returned to the ideas endpoint when `aiRerank=true` query param.
 *
 * Fallback:
 *   - AI unavailable or quota exceeded → return original algo order, ai_rerank_mode="algo_only".
 *
 * Hard rules:
 *   - NEVER fake AI output.
 *   - NEVER recommend buy/sell/target price in why_pick.
 *   - Must label result research_only.
 *   - Only uses gpt-4o-mini (routine task).
 *   - Max 20 ideas per call (~400 tokens input).
 *   - Falls back gracefully on any error.
 */

import type { StrategyIdea } from "@iuf-trading-room/contracts";
import { callOpenAi, stripCodeFences, MODEL_ROUTINE } from "./openai-quota-guard.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AiRerankMode = "ai" | "algo_only";

export interface StrategyIdeaAiEnriched extends StrategyIdea {
  /** AI-assigned rank (1 = highest priority). Present when ai_rerank_mode="ai". */
  ai_rank: number | null;
  /** One-sentence rationale from AI (research_only). Present when ai_rerank_mode="ai". */
  why_pick: string | null;
  /** Original algorithmic score (always present). */
  algo_score: number;
}

export interface AiRerankResult {
  /** How the ranking was done. */
  ai_rerank_mode: AiRerankMode;
  /** Reranked + enriched ideas. */
  items: StrategyIdeaAiEnriched[];
  /** Disclaimer — always present. */
  disclaimer: "research_only";
}

// ── AI response shape ──────────────────────────────────────────────────────────

interface AiRerankItem {
  symbol: string;
  rank: number;
  why_pick: string;
}

interface AiRerankResponse {
  ranked: AiRerankItem[];
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

const MAX_IDEAS = 20;
const MAX_TOKENS = 800;

function buildRerankPrompt(ideas: StrategyIdea[]): string {
  const top = ideas.slice(0, MAX_IDEAS);
  const lines = top.map((idea, i) => {
    const dir = idea.direction === "bullish" ? "看多" : idea.direction === "bearish" ? "看空" : "中立";
    const theme = idea.topThemes[0]?.name ?? "無主題";
    const mktDecision = idea.marketData.decision;
    return (
      `${i + 1}. symbol=${idea.symbol} name=${idea.companyName} dir=${dir} ` +
      `score=${idea.score.toFixed(0)} signals=${idea.signalCount} ` +
      `theme=${theme} mkt_decision=${mktDecision}`
    );
  });

  return `你是一位台股量化策略分析師。以下是算法排序後的 ${top.length} 支候選股，請依照「今日整體市場條件下的進場優先順序」重新排列，給每支股票一句簡短的進場理由（≤30 字，純研究分析，不含明確買賣建議）。

候選股：
${lines.join("\n")}

回傳格式（嚴格 JSON，不要多餘文字）：
{
  "ranked": [
    { "symbol": "2330", "rank": 1, "why_pick": "動量最強，主題熱度居首" }
  ]
}

規則：
- 必須包含全部 ${top.length} 支
- why_pick ≤ 30 字，不含「買入」「賣出」「目標價」等交易指令
- rank 從 1 開始連續不重複
- 嚴格 JSON，不要說明文字`;
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Rerank strategy ideas with AI.
 * Returns original algo order with enriched fields when AI is unavailable.
 * NEVER throws.
 */
export async function rerankStrategyIdeasWithAi(ideas: StrategyIdea[]): Promise<AiRerankResult> {
  const fallback = (): AiRerankResult => ({
    ai_rerank_mode: "algo_only",
    disclaimer: "research_only",
    items: ideas.map((idea, idx) => ({
      ...idea,
      ai_rank: null,
      why_pick: null,
      algo_score: idea.score
    }))
  });

  if (ideas.length === 0) {
    return fallback();
  }

  const prompt = buildRerankPrompt(ideas);
  const rawContent = await callOpenAi({
    model: MODEL_ROUTINE,
    messages: [{ role: "user", content: prompt }],
    max_tokens: MAX_TOKENS,
    temperature: 0.3,
    label: "strategy-rerank"
  });

  if (!rawContent) {
    return fallback();
  }

  let parsed: AiRerankResponse | null = null;
  try {
    const cleaned = stripCodeFences(rawContent);
    const obj = JSON.parse(cleaned) as unknown;
    if (
      obj &&
      typeof obj === "object" &&
      "ranked" in obj &&
      Array.isArray((obj as AiRerankResponse).ranked)
    ) {
      parsed = obj as AiRerankResponse;
    }
  } catch {
    console.warn("[strategy-ranker] Could not parse AI JSON response");
    return fallback();
  }

  if (!parsed || parsed.ranked.length === 0) {
    return fallback();
  }

  // Build symbol→aiItem map
  const aiBySymbol = new Map<string, AiRerankItem>();
  for (const item of parsed.ranked) {
    if (typeof item.symbol === "string" && typeof item.rank === "number") {
      aiBySymbol.set(item.symbol, item);
    }
  }

  // Enrich ideas with AI fields
  const enriched: StrategyIdeaAiEnriched[] = ideas.map((idea) => {
    const aiItem = aiBySymbol.get(idea.symbol);
    return {
      ...idea,
      ai_rank: aiItem?.rank ?? null,
      why_pick: aiItem?.why_pick?.slice(0, 60) ?? null,
      algo_score: idea.score
    };
  });

  // Sort by ai_rank (nulls last, then by algo score)
  enriched.sort((a, b) => {
    if (a.ai_rank !== null && b.ai_rank !== null) return a.ai_rank - b.ai_rank;
    if (a.ai_rank !== null) return -1;
    if (b.ai_rank !== null) return 1;
    return b.algo_score - a.algo_score;
  });

  console.log(
    `[strategy-ranker] AI rerank complete: ${enriched.length} ideas, ` +
    `ai_mapped=${aiBySymbol.size}/${ideas.length}`
  );

  return {
    ai_rerank_mode: "ai",
    disclaimer: "research_only",
    items: enriched
  };
}
