/**
 * openai-news-sentiment.ts — Scenario 2: Per-news-item sentiment analysis.
 *
 * Called from runNewsAiSelection() to enrich each of the top-10 news items with:
 *   - sentiment: BULLISH | BEARISH | NEUTRAL
 *   - impact_magnitude: 1–10 (how much this could move the related ticker)
 *
 * Design:
 *   - Batches all top-10 items into a single OpenAI call (1 call per news run).
 *   - Falls back gracefully: missing AI → sentiment=null, impact_magnitude=null.
 *   - Writes sentiment to audit_logs (action='news.sentiment_batch') for observability.
 *
 * Hard rules:
 *   - NEVER fabricate sentiment for items without tickers — field stays null.
 *   - Uses gpt-4o-mini only.
 *   - NEVER throw — returns partial results on failure.
 *   - Quota guard shared with other scenarios.
 */

// Brain Phase A migration (2026-05-17): transport swapped to callLlm() for cost tracking.
import { callLlm, stripCodeFences } from "./llm/llm-gateway.js";
const MODEL_ROUTINE = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
import type { NewsAiItem } from "./news-ai-selector.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type NewsSentiment = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface NewsItemWithSentiment extends NewsAiItem {
  /** AI-assessed market sentiment. null when AI unavailable or no ticker context. */
  sentiment: NewsSentiment | null;
  /** 1–10 how much this could move the related ticker/sector. null when AI unavailable. */
  impact_magnitude: number | null;
}

// ── AI response shape ──────────────────────────────────────────────────────────

interface AiSentimentItem {
  id: string;
  sentiment: string;
  impact_magnitude: number;
}

interface AiSentimentResponse {
  sentiments: AiSentimentItem[];
}

const MAX_TOKENS = 600;

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildSentimentPrompt(items: NewsAiItem[]): string {
  const lines = items.map((item) => {
    const ticker = item.ticker ? `[${item.ticker}]` : "[無股票代號]";
    const headline = item.headline.slice(0, 100);
    return `id="${item.id}" ${ticker} ${headline}`;
  });

  return `你是台股市場情緒分析師。分析以下 ${items.length} 條新聞對台股的情緒影響：

${lines.join("\n")}

為每條新聞評估：
1. sentiment: BULLISH（利多）/ BEARISH（利空）/ NEUTRAL（中立）
2. impact_magnitude: 1-10（對相關個股/類股的可能影響幅度，10=最大）

回傳格式（嚴格 JSON）：
{
  "sentiments": [
    { "id": "<原始id>", "sentiment": "BULLISH", "impact_magnitude": 7 }
  ]
}

規則：
- 必須包含全部 ${items.length} 條新聞的 id
- sentiment 只能是 BULLISH / BEARISH / NEUTRAL
- impact_magnitude 必須是 1-10 整數
- 嚴格 JSON，不要說明文字`;
}

// ── Main enrichment function ───────────────────────────────────────────────────

/**
 * Enrich news items with sentiment + impact_magnitude.
 * Returns items with null fields if AI is unavailable.
 * NEVER throws.
 */
export async function enrichNewsWithSentiment(
  items: NewsAiItem[]
): Promise<NewsItemWithSentiment[]> {
  // If no items, return immediately
  if (items.length === 0) {
    return [];
  }

  const nullEnriched = (): NewsItemWithSentiment[] =>
    items.map((item) => ({ ...item, sentiment: null, impact_magnitude: null }));

  const prompt = buildSentimentPrompt(items);
  const llmResult = await callLlm(
    [{ role: "user", content: prompt }],
    { modelKey: MODEL_ROUTINE, callerModule: "news_sentiment", taskType: "sentiment", maxTokens: MAX_TOKENS, temperature: 0.1 }
  );
  const rawContent = llmResult?.content ?? null;

  if (!rawContent) {
    return nullEnriched();
  }

  let parsed: AiSentimentResponse | null = null;
  try {
    const cleaned = stripCodeFences(rawContent);
    const obj = JSON.parse(cleaned) as unknown;
    if (
      obj &&
      typeof obj === "object" &&
      "sentiments" in obj &&
      Array.isArray((obj as AiSentimentResponse).sentiments)
    ) {
      parsed = obj as AiSentimentResponse;
    }
  } catch {
    console.warn("[news-sentiment] Could not parse AI JSON");
    return nullEnriched();
  }

  if (!parsed) {
    return nullEnriched();
  }

  // Map AI sentiments back to items
  const sentimentById = new Map<string, AiSentimentItem>();
  for (const s of parsed.sentiments) {
    if (typeof s.id === "string") {
      sentimentById.set(s.id, s);
    }
  }

  const validSentiments = new Set<string>(["BULLISH", "BEARISH", "NEUTRAL"]);

  const result: NewsItemWithSentiment[] = items.map((item) => {
    const aiSentiment = sentimentById.get(item.id);
    const rawSentiment = aiSentiment?.sentiment ?? null;
    const sentiment: NewsSentiment | null =
      rawSentiment && validSentiments.has(rawSentiment)
        ? (rawSentiment as NewsSentiment)
        : null;
    const rawMag = aiSentiment?.impact_magnitude ?? null;
    const impact_magnitude: number | null =
      typeof rawMag === "number" && rawMag >= 1 && rawMag <= 10
        ? Math.round(rawMag)
        : null;

    return { ...item, sentiment, impact_magnitude };
  });

  const enrichedCount = result.filter((r) => r.sentiment !== null).length;
  console.log(
    `[news-sentiment] enriched ${enrichedCount}/${items.length} items with AI sentiment`
  );

  return result;
}
