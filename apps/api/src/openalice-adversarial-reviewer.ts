/**
 * openalice-adversarial-reviewer.ts
 *
 * Adversarial (bearish/skeptic) second-pass quality gate for OpenAlice content drafts.
 *
 * Runs AFTER the standard 7-rule AI reviewer approves a green-tier draft.
 * Checks for three bias categories:
 *   A) Overly optimistic spin
 *   B) Downside risk omission
 *   C) Source selection bias
 *
 * Output: { adversarialFlags, severityScore, reasoning }
 *   severityScore >= 7 → route to awaiting_review (manual gate)
 *   severityScore < 7  → proceed to auto-publish
 *
 * Safe-default: returns null on ANY failure — never blocks the pipeline.
 *
 * Model: OPENAI_ADVERSARIAL_REVIEWER_MODEL env, default gpt-4.1
 * Cost: ~600 input tokens / call; 楊董 ACK 2x cost OK (accuracy-priority).
 * Audit: ALL calls logged with action="content_draft.adversarial_audit" (even score < 7).
 */

import { callLlm } from "./llm/llm-gateway.js";

// ── Constants ──────────────────────────────────────────────────────────────────

// Default gpt-4.1 — accuracy-priority per 楊董 ACK (BLOCK #6 2026-05-07)
const ADVERSARIAL_MODEL =
  process.env["OPENAI_ADVERSARIAL_REVIEWER_MODEL"] ?? "gpt-4.1";
const CALL_TIMEOUT_MS = 15_000; // slightly longer than primary reviewer
const MAX_TOKENS = 400;
const TEMPERATURE = 0.2;

// ── Types ──────────────────────────────────────────────────────────────────────

export type AdversarialReviewResult = {
  adversarialFlags: string[]; // max 3 items (one per category); empty if none
  severityScore: number;      // integer 0-10
  reasoning: string;          // 2-3 sentence adversarial judgment
};

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildAdversarialPrompt(
  payload: unknown,
  sourcePackSummary: string | null
): string {
  const payloadStr = JSON.stringify(payload, null, 2).slice(0, 4000);
  const sourceSummary = sourcePackSummary?.slice(0, 800) ?? "(source pack summary not provided)";

  return `You are a bearish equity analyst performing adversarial review of a Taiwan-stock research brief.
Your role is to stress-test the content — assume it may be subtly misleading even if factually accurate.
Do NOT block publication; your job is to flag bias patterns for a human editor to consider.

You are checking for exactly three bias categories:

[CATEGORY A] Overly Optimistic Spin
- One-sided positive framing that omits balancing context
- Selective use of upward metrics while downward metrics exist in the same dataset
- Language that creates unwarranted confidence ("穩健成長", "持續強勢") without citing the data source

[CATEGORY B] Downside Risk Omission
- Sector risk, macro headwinds, or company-specific risk factors that the data implies but the brief ignores
- Any period where institutional net selling, margin pressure, or short interest increase is present in the data but not mentioned
- Silence on volatility when the source period covers high-variance windows

[CATEGORY C] Source Selection Bias
- The brief discusses themes or companies that appear to be cherry-picked from a larger source pack
- If source pack covers many themes but brief focuses only on bullish ones, flag this
- Presence of [BROKEN] or [DEPRECATED] source markers in the draft payload that indicate stale inputs

## Brief Content

"""
${payloadStr}
"""

## Source Pack Summary (what data was available to the generator)

"""
${sourceSummary}
"""

## Output Format

Return ONLY valid JSON, no markdown fence, no extra text:

{
  "adversarialFlags": [
    "CATEGORY_A: <specific finding, 1 sentence>",
    "CATEGORY_B: <specific finding, 1 sentence>",
    "CATEGORY_C: <specific finding, 1 sentence>"
  ],
  "severityScore": <integer 0-10>,
  "reasoning": "<2-3 sentences: overall adversarial assessment, what a skeptic would say>"
}

Where:
- adversarialFlags: empty array [] if no bias found in that category; 1 entry per category maximum
- severityScore: 0 = no bias detected; 10 = severe one-sided framing; 7+ = force manual_review
- reasoning: do not repeat the flags verbatim; write the net adversarial judgment

## Scoring Guide

0-3: Brief is balanced or appropriately hedged — no action needed
4-6: Mild optimistic lean — acceptable for research platform, log for audit trail only
7-8: Significant bias pattern — withhold auto-publish, route to human editor
9-10: Severe one-sided framing — treat same as manual_review (do not auto-publish)

## Constraints

- You are NOT re-running the 7 hard-reject rules (investment advice, target price, guarantees,
  hallucination, fallback template, empty sections, date mismatch). Those are upstream.
- Do NOT flag analytical interpretation as bias — bias requires a comparison point.
- Do NOT flag negative framing as bias — asymmetric negativity is fine; only asymmetric positivity is Category A.
- Respond ONLY in the JSON format above.`;
}

// ── OpenAI call (adversarial) ──────────────────────────────────────────────────

async function callAdversarialOpenAi(
  prompt: string
): Promise<AdversarialReviewResult | null> {
  const result = await callLlm(
    [{ role: "user", content: prompt }],
    {
      modelKey: ADVERSARIAL_MODEL,
      callerModule: "adversarial_reviewer",
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

  return parseAdversarialJson(rawContent);
}

// ── JSON parser (exported for unit tests) ──────────────────────────────────────

export function parseAdversarialJson(raw: string): AdversarialReviewResult | null {
  try {
    const clean = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(clean) as Partial<AdversarialReviewResult>;

    const flags = Array.isArray(parsed.adversarialFlags)
      ? (parsed.adversarialFlags as unknown[])
          .filter((x): x is string => typeof x === "string")
          .slice(0, 3) // max 3 categories
      : [];

    const score = typeof parsed.severityScore === "number"
      ? Math.max(0, Math.min(10, Math.round(parsed.severityScore)))
      : null;

    if (score === null) {
      console.warn("[adversarial-reviewer] Missing or invalid severityScore");
      return null;
    }

    const reasoning = typeof parsed.reasoning === "string"
      ? parsed.reasoning.slice(0, 1000)
      : "";

    return {
      adversarialFlags: flags,
      severityScore: score,
      reasoning
    };
  } catch {
    console.warn("[adversarial-reviewer] Could not parse adversarial review JSON");
    return null;
  }
}

// ── Main exported function ─────────────────────────────────────────────────────

/**
 * Run adversarial (bearish/skeptic) review on a content draft payload.
 *
 * Called from openalice-ai-reviewer.ts after the primary reviewer approves
 * a green-tier draft, before approveContentDraft is called.
 *
 * @param payload - The content draft payload (JSON-serialisable)
 * @param draftId - UUID of the draft (for logging only)
 * @param sourcePackSummary - Optional text summary of the source pack available
 *                            to the generator. Improves Category C detection.
 * @returns AdversarialReviewResult or null if review could not be completed.
 *          Callers MUST treat null as "no finding" (do not block on null).
 */
export async function runAdversarialReview(
  payload: unknown,
  draftId: string,
  sourcePackSummary?: string | null
): Promise<AdversarialReviewResult | null> {
  try {
    const prompt = buildAdversarialPrompt(payload, sourcePackSummary ?? null);
    const result = await callAdversarialOpenAi(prompt);

    if (result) {
      console.info(
        `[adversarial-reviewer] Draft ${draftId}: score=${result.severityScore} flags=${result.adversarialFlags.length}`
      );
    }

    return result;
  } catch (e) {
    // Absolute safe-default: any exception → null → pipeline proceeds normally
    console.warn(
      `[adversarial-reviewer] Unexpected error for draft ${draftId}:`,
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

// ── ToolCenter Phase B wrapper ────────────────────────────────────────────────

/**
 * runAdversarialReviewTracked — callTool-wrapped version of runAdversarialReview.
 * Phase B: adds tool_calls audit record around the adversarial review function.
 * Uses dynamic import for tool-registry-store to avoid linter-revert of static imports.
 */
export async function runAdversarialReviewTracked(
  payload: unknown,
  draftId: string,
  sourcePackSummary?: string | null,
  workspaceId?: string | null
): Promise<AdversarialReviewResult | null> {
  const { callTool } = await import("./tools/tool-registry-store.js");
  return callTool(
    "adversarial_reviewer",
    "pipeline",
    workspaceId ?? null,
    { payload, draftId, sourcePackSummary },
    async (input: { payload: unknown; draftId: string; sourcePackSummary?: string | null }) => {
      return runAdversarialReview(input.payload, input.draftId, input.sourcePackSummary);
    }
  );
}
