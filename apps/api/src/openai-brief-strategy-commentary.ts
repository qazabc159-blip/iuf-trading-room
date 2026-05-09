/**
 * openai-brief-strategy-commentary.ts — Scenario 3: Daily strategy context commentary.
 *
 * Purpose:
 *   For each of the 3 active lab strategies (cont_liq_v36, strategy_002, strategy_003),
 *   generate 1 paragraph stating whether today's market conditions are consistent with
 *   the strategy's entry / observation / exit conditions.
 *
 * Input:
 *   - Lab snapshot (fetched from GitHub raw via lab-strategy-snapshot-fetcher.ts)
 *   - Today's Taiwan market state (injected as string summary by the caller)
 *
 * Output (stored in-memory, served via GET endpoint):
 *   {
 *     generated_at: ISO string,
 *     trading_date: "YYYY-MM-DD",
 *     strategies: [
 *       {
 *         strategy_id: "cont_liq_v36",
 *         label: string,
 *         condition: "entry_favorable" | "observe" | "exit_favorable" | "neutral",
 *         commentary: string (1 paragraph, ≤120 chars),
 *         disclaimer: "research_only"
 *       }
 *     ],
 *     generation_mode: "ai" | "template_fallback",
 *     stale_reason: string | null
 *   }
 *
 * Trigger:
 *   - Called from startSchedulers at 08:30 TST (after brief window).
 *   - Also available via POST /api/v1/internal/strategy-commentary/fire-now (Owner only).
 *
 * Hard rules:
 *   - NEVER generate buy/sell/target/guarantee wording.
 *   - MUST label every output research_only.
 *   - NEVER fake lab snapshot data — if snapshot unavailable, use template fallback.
 *   - Stale gate: if last_run > 25h, surface stale_reason.
 *   - Uses gpt-4o-mini (routine).
 */

import { randomUUID } from "node:crypto";
import { callOpenAi, stripCodeFences, MODEL_ROUTINE } from "./openai-quota-guard.js";
import { fetchStrategySnapshot, ALLOWED_STRATEGY_IDS } from "./lab-strategy-snapshot-fetcher.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const STALE_AFTER_MS = 25 * 60 * 60 * 1000; // 25h
const MAX_TOKENS = 1200;

// ── Types ──────────────────────────────────────────────────name──────────────────

export type StrategyCondition =
  | "entry_favorable"
  | "observe"
  | "exit_favorable"
  | "neutral";

export interface StrategyCommentaryItem {
  strategy_id: string;
  label: string;
  condition: StrategyCondition;
  commentary: string;
  disclaimer: "research_only";
}

export type CommentaryGenerationMode = "ai" | "template_fallback";

export interface BriefStrategyCommentaryResult {
  run_id: string;
  generated_at: string;
  trading_date: string;
  strategies: StrategyCommentaryItem[];
  generation_mode: CommentaryGenerationMode;
  stale_reason: string | null;
}

// ── In-memory state ────────────────────────────────────────────────────────────

let _lastResult: BriefStrategyCommentaryResult | null = null;
let _lastRunAt: Date | null = null;

export function getLastBriefStrategyCommentary(): BriefStrategyCommentaryResult | null {
  return _lastResult;
}

export function getBriefStrategyCommentaryWithStaleness(): BriefStrategyCommentaryResult | null {
  if (!_lastResult) return null;
  const ageMs = _lastRunAt ? Date.now() - _lastRunAt.getTime() : Infinity;
  if (ageMs > STALE_AFTER_MS) {
    return {
      ..._lastResult,
      stale_reason: `last_run_over_${Math.round(ageMs / (60 * 60 * 1000))}h_ago`
    };
  }
  return _lastResult;
}

export function _resetBriefStrategyCommentary(): void {
  _lastResult = null;
  _lastRunAt = null;
}

// ── Template fallback ──────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<string, string> = {
  cont_liq_v36: "持續流動性 v36",
  strategy_002: "策略 002",
  strategy_003: "策略 003"
};

function buildTemplateFallback(tradingDate: string): StrategyCommentaryItem[] {
  return Array.from(ALLOWED_STRATEGY_IDS).map((strategyId) => ({
    strategy_id: strategyId,
    label: STRATEGY_LABELS[strategyId] ?? strategyId,
    condition: "neutral" as StrategyCondition,
    commentary: `${tradingDate} 市場資料載入中，策略狀態待確認。`,
    disclaimer: "research_only" as const
  }));
}

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildCommentaryPrompt(
  tradingDate: string,
  marketSummary: string,
  snapshots: Array<{ strategyId: string; label: string; snapshotSummary: string }>
): string {
  const strategyLines = snapshots.map((s) =>
    `策略 ID: ${s.strategyId} (${s.label})\n${s.snapshotSummary}`
  ).join("\n\n");

  return `你是台股量化研究分析師。今日日期：${tradingDate}。

今日市場狀況摘要：
${marketSummary}

以下是三個量化策略的快照資訊：
${strategyLines}

對每個策略，評估今日市場條件是否符合策略的進場/觀察/退出條件。

回傳格式（嚴格 JSON）：
{
  "strategies": [
    {
      "strategy_id": "cont_liq_v36",
      "condition": "entry_favorable",
      "commentary": "流動性指標符合進場門檻，動量方向一致。"
    }
  ]
}

規則：
- condition 只能是 entry_favorable / observe / exit_favorable / neutral
- commentary ≤ 60 字，純研究分析，不含買入/賣出/目標價等交易指令
- 必須包含全部 ${snapshots.length} 個策略
- 嚴格 JSON，不要說明文字
- 所有內容屬研究分析，非投資建議`;
}

// ── Main run function ──────────────────────────────────────────────────────────

/**
 * Generate daily strategy commentary.
 * @param tradingDate - "YYYY-MM-DD"
 * @param marketSummary - Short text summary of today's market state (injected by caller)
 */
export async function runBriefStrategyCommentary(params: {
  tradingDate: string;
  marketSummary: string;
}): Promise<BriefStrategyCommentaryResult> {
  const runId = randomUUID();
  const generatedAt = new Date().toISOString();
  const { tradingDate, marketSummary } = params;

  // 1. Fetch lab snapshots (non-fatal — fallback to template if any fail)
  const strategyIds = Array.from(ALLOWED_STRATEGY_IDS);
  const snapshotResults = await Promise.allSettled(
    strategyIds.map((id) => fetchStrategySnapshot(id))
  );

  const snapshots: Array<{ strategyId: string; label: string; snapshotSummary: string }> = [];
  for (let i = 0; i < strategyIds.length; i++) {
    const strategyId = strategyIds[i]!;
    const result = snapshotResults[i]!;
    const label = STRATEGY_LABELS[strategyId] ?? strategyId;

    let snapshotSummary = "(快照不可用)";
    if (result.status === "fulfilled" && result.value.ok) {
      const snap = result.value.snapshot;
      // Extract key fields for prompt context (non-fatal field access)
      try {
        const status = (snap as Record<string, unknown>)["status"] ?? "unknown";
        const winRate = (snap as Record<string, unknown>)["win_rate"];
        const lastSignal = (snap as Record<string, unknown>)["last_signal_at"];
        const conditionMet = (snap as Record<string, unknown>)["condition_met"];
        snapshotSummary = [
          `狀態=${status}`,
          winRate !== undefined ? `勝率=${winRate}` : null,
          lastSignal ? `最新訊號=${lastSignal}` : null,
          conditionMet !== undefined ? `條件滿足=${conditionMet}` : null
        ]
          .filter(Boolean)
          .join(", ");
      } catch {
        snapshotSummary = "(快照格式異常)";
      }
    }
    snapshots.push({ strategyId, label, snapshotSummary });
  }

  // 2. Call AI
  const prompt = buildCommentaryPrompt(tradingDate, marketSummary, snapshots);
  const rawContent = await callOpenAi({
    model: MODEL_ROUTINE,
    messages: [{ role: "user", content: prompt }],
    max_tokens: MAX_TOKENS,
    temperature: 0.3,
    label: "brief-strategy-commentary"
  });

  let strategies: StrategyCommentaryItem[];
  let generation_mode: CommentaryGenerationMode;

  if (!rawContent) {
    strategies = buildTemplateFallback(tradingDate);
    generation_mode = "template_fallback";
  } else {
    // Parse AI response
    type ParsedShape = { strategies: Array<{ strategy_id: string; condition: string; commentary: string }> };
    let parsed: ParsedShape | null = null;
    try {
      const cleaned = stripCodeFences(rawContent);
      const obj = JSON.parse(cleaned) as unknown;
      if (
        obj &&
        typeof obj === "object" &&
        "strategies" in obj &&
        Array.isArray((obj as { strategies: unknown[] }).strategies)
      ) {
        parsed = obj as ParsedShape;
      }
    } catch {
      console.warn("[brief-strategy-commentary] Could not parse AI JSON");
    }

    if (!parsed || parsed.strategies.length === 0) {
      strategies = buildTemplateFallback(tradingDate);
      generation_mode = "template_fallback";
    } else {
      const validConditions = new Set<string>([
        "entry_favorable",
        "observe",
        "exit_favorable",
        "neutral"
      ]);

      // Map AI items back to known strategy IDs
      const aiByStrategyId = new Map<string, { strategy_id: string; condition: string; commentary: string }>();
      for (const item of parsed.strategies) {
        if (typeof item.strategy_id === "string") {
          aiByStrategyId.set(item.strategy_id, item);
        }
      }

      strategies = strategyIds.map((strategyId) => {
        const label = STRATEGY_LABELS[strategyId] ?? strategyId;
        const aiItem = aiByStrategyId.get(strategyId);
        if (!aiItem) {
          return {
            strategy_id: strategyId,
            label,
            condition: "neutral" as StrategyCondition,
            commentary: `${tradingDate} AI 未回覆此策略的評估。`,
            disclaimer: "research_only" as const
          };
        }
        const condition: StrategyCondition = validConditions.has(aiItem.condition)
          ? (aiItem.condition as StrategyCondition)
          : "neutral";
        return {
          strategy_id: strategyId,
          label,
          condition,
          commentary: (aiItem.commentary ?? "").slice(0, 120),
          disclaimer: "research_only" as const
        };
      });
      generation_mode = "ai";
    }
  }

  const result: BriefStrategyCommentaryResult = {
    run_id: runId,
    generated_at: generatedAt,
    trading_date: tradingDate,
    strategies,
    generation_mode,
    stale_reason: null
  };

  _lastResult = result;
  _lastRunAt = new Date();

  console.log(
    `[brief-strategy-commentary] run_id=${runId} date=${tradingDate} ` +
    `mode=${generation_mode} strategies=${strategies.length}`
  );

  return result;
}
