/**
 * openai-signal-confidence.ts — Scenario 4: AI confidence scoring per signal.
 *
 * Purpose:
 *   When a signal is emitted (or on-demand), call gpt-4o-mini to assess:
 *     - confidence_0_100: integer 0–100 (AI view of signal strength)
 *     - reasoning: 1 sentence explaining the confidence level (≤60 chars)
 *
 * Design:
 *   - In-memory Map: signalId → AssessmentResult (TTL 12h).
 *   - On-demand via POST /api/v1/internal/signals/:signalId/assess-confidence (Owner only).
 *   - Assessment is supplemental — never replaces the 1-5 scale confidence in the Signal record.
 *   - Falls back gracefully: AI unavailable → confidence_0_100=null, mode="algo_fallback".
 *
 * Hard rules:
 *   - NEVER recommend buy/sell/target in reasoning.
 *   - NEVER throw — returns fallback on any error.
 *   - Uses gpt-4o-mini only.
 *   - Quota guard shared.
 *   - Stores assessment result in-memory only (no DB write required — supplemental only).
 */

// Brain Phase A migration (2026-05-17): transport swapped to callLlm() for cost tracking.
import { callLlm, stripCodeFences } from "./llm/llm-gateway.js";
const MODEL_ROUTINE = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
import type { Signal } from "@iuf-trading-room/contracts";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SignalConfidenceMode = "ai" | "algo_fallback";

export interface SignalConfidenceAssessment {
  signal_id: string;
  /** AI confidence score 0–100. null when AI unavailable. */
  confidence_0_100: number | null;
  /** One-sentence reasoning (research_only). null when AI unavailable. */
  reasoning: string | null;
  /** How the assessment was made. */
  mode: SignalConfidenceMode;
  /** ISO timestamp of assessment. */
  assessed_at: string;
  disclaimer: "research_only";
}

// ── In-memory store (TTL 12h) ──────────────────────────────────────────────────

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

interface CacheEntry {
  assessment: SignalConfidenceAssessment;
  cachedAt: Date;
}

const _cache = new Map<string, CacheEntry>();

export function getSignalConfidenceAssessment(signalId: string): SignalConfidenceAssessment | null {
  const entry = _cache.get(signalId);
  if (!entry) return null;
  const ageMs = Date.now() - entry.cachedAt.getTime();
  if (ageMs > CACHE_TTL_MS) {
    _cache.delete(signalId);
    return null;
  }
  return entry.assessment;
}

export function _resetSignalConfidenceCache(): void {
  _cache.clear();
}

// ── Algo fallback: map 1-5 confidence to 0-100 ────────────────────────────────

function algoFallbackScore(signal: Signal): number {
  // Signal.confidence is 1–5; map to 0–100 proportionally
  return Math.round(((signal.confidence - 1) / 4) * 100);
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

const MAX_TOKENS = 300;

function buildConfidencePrompt(signal: Signal): string {
  const dir = signal.direction === "bullish" ? "看多" : signal.direction === "bearish" ? "看空" : "中立";
  const themeCount = signal.themeIds.length;
  const companyCount = signal.companyIds.length;

  return `你是台股量化策略分析師。以下是一個交易訊號的摘要：

標題：${signal.title}
摘要：${signal.summary.slice(0, 200)}
方向：${dir}（${signal.direction}）
類別：${signal.category}
原始信心度：${signal.confidence}/5
主題數：${themeCount} 個
相關公司數：${companyCount} 家
建立時間：${signal.createdAt}

請評估此訊號的可信度，回傳 0-100 的信心分數及一句分析理由。

回傳格式（嚴格 JSON）：
{
  "confidence_0_100": 75,
  "reasoning": "多重主題共振，方向明確，信號品質高"
}

規則：
- confidence_0_100 必須是 0-100 整數
- reasoning ≤ 30 字，純研究分析，不含買入/賣出/目標價
- 嚴格 JSON，不要說明文字`;
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Assess a signal's AI confidence.
 * Returns cached result if within TTL.
 * NEVER throws.
 */
export async function assessSignalConfidence(signal: Signal): Promise<SignalConfidenceAssessment> {
  const assessedAt = new Date().toISOString();

  // Return cached if fresh
  const cached = getSignalConfidenceAssessment(signal.id);
  if (cached) {
    return cached;
  }

  const algoFallback = (): SignalConfidenceAssessment => {
    const assessment: SignalConfidenceAssessment = {
      signal_id: signal.id,
      confidence_0_100: algoFallbackScore(signal),
      reasoning: null,
      mode: "algo_fallback",
      assessed_at: assessedAt,
      disclaimer: "research_only"
    };
    _cache.set(signal.id, { assessment, cachedAt: new Date() });
    return assessment;
  };

  const prompt = buildConfidencePrompt(signal);
  const llmResult = await callLlm(
    [{ role: "user", content: prompt }],
    { modelKey: MODEL_ROUTINE, callerModule: "signal_confidence", taskType: "confidence_scoring", maxTokens: MAX_TOKENS, temperature: 0.2 }
  );
  const rawContent = llmResult?.content ?? null;

  if (!rawContent) {
    return algoFallback();
  }

  let confidence_0_100: number | null = null;
  let reasoning: string | null = null;

  try {
    const cleaned = stripCodeFences(rawContent);
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const rawScore = obj["confidence_0_100"];
    if (typeof rawScore === "number" && rawScore >= 0 && rawScore <= 100) {
      confidence_0_100 = Math.round(rawScore);
    }
    const rawReasoning = obj["reasoning"];
    if (typeof rawReasoning === "string" && rawReasoning.length > 0) {
      reasoning = rawReasoning.slice(0, 60);
    }
  } catch {
    console.warn("[signal-confidence] Could not parse AI JSON");
    return algoFallback();
  }

  if (confidence_0_100 === null) {
    return algoFallback();
  }

  const assessment: SignalConfidenceAssessment = {
    signal_id: signal.id,
    confidence_0_100,
    reasoning,
    mode: "ai",
    assessed_at: assessedAt,
    disclaimer: "research_only"
  };

  _cache.set(signal.id, { assessment, cachedAt: new Date() });

  console.log(
    `[signal-confidence] signal_id=${signal.id} confidence=${confidence_0_100} ` +
    `mode=ai reasoning="${reasoning ?? ""}"`
  );

  return assessment;
}
