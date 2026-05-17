/**
 * openalice-factual-reviewer.ts
 *
 * BLOCK #10 — Factual fact-checker: 3rd LLM layer in the OpenAlice review chain.
 *
 * Position in chain (additive only — does not modify upstream layers):
 *   Layer 1: Hard-reject rule engine (7-rule keyword filter)
 *   Layer 2: AI reviewer (gpt-4o-mini, source-label vs advice classification)
 *   Layer 3: Adversarial reviewer (gpt-4.1, bias detection)
 *   Layer 4: Hallucination RAG (gpt-4.1, sourceTrail cross-validate)
 *   Layer 5: *** Factual reviewer (gpt-4.1, FinMind raw row ground-truth) ***  ← this file
 *
 * Responsibilities:
 *   - Compare factual claims in the brief content against raw FinMind data rows
 *     (sampleRows fetched during source pack collection, up to 3 rows per source)
 *   - Classify each brief as FACTUAL_OK / FACTUAL_DRIFT / FACTUAL_FALSE
 *   - FACTUAL_FALSE  → force reject + audit_log type=content_draft.factual_reject
 *   - FACTUAL_DRIFT  → manual_review queue (same as adversarial severityScore >= 7)
 *   - FACTUAL_OK     → pass through
 *
 * Cost guard:
 *   - Skip entirely if rawSources is empty (nothing to cross-check against)
 *   - 1 LLM call per brief (single-verdict summary, NOT per-claim)
 *   - Estimated ~$0.005/brief × 30 brief/day ≈ $0.15/day (negligible)
 *
 * Safe-default:
 *   - Returns null on ANY failure — never blocks the pipeline
 *   - All audit log writes are non-throwing
 *
 * Model: OPENAI_FACTUAL_REVIEWER_MODEL env, default "gpt-4.1"
 * 楊董 ACK: "2x cost OK" + "全都 ack 不要偏離我得主軸能夠優化做更好我都接受"
 */

import { callLlm } from "./llm/llm-gateway.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const FACTUAL_MODEL =
  process.env["OPENAI_FACTUAL_REVIEWER_MODEL"] ?? "gpt-4.1";
const CALL_TIMEOUT_MS = 20_000;
const MAX_TOKENS = 500;
const TEMPERATURE = 0.1; // deterministic — fact-checking should not be creative

// ── Types ──────────────────────────────────────────────────────────────────────

export type FactualVerdict =
  | "FACTUAL_OK"       // All checked claims align with raw data
  | "FACTUAL_DRIFT"    // At least one claim partially misrepresents data (manual review)
  | "FACTUAL_FALSE";   // At least one claim contradicts raw data (force reject)

export type FactualReviewResult = {
  factualVerdict: FactualVerdict;
  driftFlags: string[];   // human-readable description of each issue found
  reasoning: string;      // 2-3 sentence factual assessment
};

export type RawSourceForFactual = {
  sourceId: string;   // e.g. "companies_ohlcv", "tw_monthly_revenue"
  content: string;    // raw JSON rows (sampleRows) or metadata if no rows
};

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildFactualPrompt(
  briefContent: string,
  rawSources: RawSourceForFactual[]
): string {
  const contentStr = briefContent.slice(0, 3_000);

  const sourcesStr = rawSources
    .map((s) => `[${s.sourceId}]\n${s.content.slice(0, 600)}`)
    .join("\n\n")
    .slice(0, 4_000);

  return `You are a financial fact-checker for a Taiwan-stock research platform.
Your task: cross-check factual claims in the brief content against the provided raw FinMind data rows.

Classify claims as:
- FACTUAL_OK      : All verifiable factual claims align with the raw data provided.
- FACTUAL_DRIFT   : At least one claim partially misrepresents or exaggerates the data.
  Examples:
    • Brief says "月營收 YoY +50%" but raw row shows YoY = +20% → FACTUAL_DRIFT
    • Brief says "外資連 5 日買進" but raw shows 連 3 日 → FACTUAL_DRIFT
    • Numbers are directionally correct but magnitude is off → FACTUAL_DRIFT
- FACTUAL_FALSE   : At least one claim directly contradicts the raw data.
  Examples:
    • Brief says stock closed up when raw OHLCV shows it closed down → FACTUAL_FALSE
    • Brief cites a specific number that does not appear and contradicts what is in the raw data → FACTUAL_FALSE

## Important Constraints

1. Only check claims that are verifiable against the provided raw data rows.
   If a claim cannot be verified (data not in raw rows), DO NOT flag it — return FACTUAL_OK for that claim.
2. Do NOT re-run compliance rules (buy/sell advice, target prices, guarantees).
   Those are handled upstream by other reviewers. Your role is factual accuracy only.
3. Do NOT penalize appropriate uncertainty language ("約", "大約", "估計", "roughly").
4. Rounding differences within 5% are acceptable — not FACTUAL_DRIFT.
5. If rawSources contain metadata-only entries (no actual row data), verdict must be FACTUAL_OK
   because there is nothing to cross-check against.
6. Respond ONLY in the JSON format below. No markdown fence. No extra text.

## Brief Content

"""
${contentStr}
"""

## Raw FinMind Data Rows

"""
${sourcesStr}
"""

## Output Format

{
  "factualVerdict": "FACTUAL_OK|FACTUAL_DRIFT|FACTUAL_FALSE",
  "driftFlags": [
    "<specific discrepancy finding, 1 sentence each>"
  ],
  "reasoning": "<2-3 sentences: overall factual assessment>"
}

Where:
- driftFlags: empty array [] if verdict is FACTUAL_OK; list each discrepancy for DRIFT or FALSE
- reasoning: concise factual judgment — what a data auditor would write`;
}

// ── OpenAI call ────────────────────────────────────────────────────────────────

async function callFactualOpenAi(
  prompt: string
): Promise<FactualReviewResult | null> {
  const result = await callLlm(
    [{ role: "user", content: prompt }],
    {
      modelKey: FACTUAL_MODEL,
      callerModule: "factual_reviewer",
      taskType: "review",
      maxTokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      timeoutMs: CALL_TIMEOUT_MS
    }
  );

  const rawContent = result?.content ?? null;
  if (!rawContent) {
    return null;
  }

  return parseFactualJson(rawContent);
}

// ── JSON parser (exported for unit tests) ─────────────────────────────────────

export function parseFactualJson(raw: string): FactualReviewResult | null {
  try {
    const clean = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(clean) as Partial<FactualReviewResult>;

    const verdict = parsed.factualVerdict;
    if (
      verdict !== "FACTUAL_OK" &&
      verdict !== "FACTUAL_DRIFT" &&
      verdict !== "FACTUAL_FALSE"
    ) {
      console.warn(`[factual-reviewer] Invalid factualVerdict: ${verdict}`);
      return null;
    }

    const driftFlags = Array.isArray(parsed.driftFlags)
      ? (parsed.driftFlags as unknown[])
          .filter((x): x is string => typeof x === "string")
          .slice(0, 10) // cap to prevent unbounded arrays
      : [];

    const reasoning =
      typeof parsed.reasoning === "string"
        ? parsed.reasoning.slice(0, 1_000)
        : "";

    return {
      factualVerdict: verdict,
      driftFlags,
      reasoning
    };
  } catch {
    console.warn("[factual-reviewer] Could not parse factual review JSON");
    return null;
  }
}

// ── Main exported function ─────────────────────────────────────────────────────

/**
 * Run factual fact-check on a content draft against raw FinMind data rows.
 *
 * Called from openalice-pipeline.ts evaluatePipelinePublishGate, AFTER
 * the hallucination RAG gate, BEFORE approveContentDraft.
 *
 * Cost guard: returns null immediately if rawSources is empty (nothing to check).
 *
 * @param briefContent - The brief's content string (extracted from draft.payload.content)
 * @param rawSources   - Raw FinMind data rows from source pack sampleRows
 * @param draftId      - UUID of the draft (for logging only)
 * @returns FactualReviewResult or null if review was skipped or failed.
 *          Callers MUST treat null as "skipped" — do NOT block on null.
 */
export async function runFactualReview(
  briefContent: string,
  rawSources: RawSourceForFactual[],
  draftId: string
): Promise<FactualReviewResult | null> {
  // Cost guard: nothing to check against → skip
  if (rawSources.length === 0) {
    console.info(`[factual-reviewer] Draft ${draftId}: rawSources empty — skipping factual review`);
    return null;
  }

  // Additional cost guard: skip if all sources only have metadata (no real rows)
  const hasRealRows = rawSources.some((s) => {
    try {
      const parsed = JSON.parse(s.content);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  });

  if (!hasRealRows) {
    console.info(`[factual-reviewer] Draft ${draftId}: no real data rows in rawSources — skipping factual review`);
    return null;
  }

  try {
    const prompt = buildFactualPrompt(briefContent, rawSources);
    const result = await callFactualOpenAi(prompt);

    if (result) {
      console.info(
        `[factual-reviewer] Draft ${draftId}: verdict=${result.factualVerdict} flags=${result.driftFlags.length}`
      );
    }

    return result;
  } catch (e) {
    // Absolute safe-default: any exception → null → pipeline proceeds normally
    console.warn(
      `[factual-reviewer] Unexpected error for draft ${draftId}:`,
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}
