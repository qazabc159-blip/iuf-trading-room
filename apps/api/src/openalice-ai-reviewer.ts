/**
 * openalice-ai-reviewer.ts
 *
 * Automated quality + safety reviewer for content_drafts.
 * Fires asynchronously after createContentDraft (Option Y — non-blocking).
 *
 * Feature flag: OPENALICE_AI_REVIEWER_ENABLED (default "true").
 * Timeout: 10 s hard limit via AbortSignal.timeout.
 * Cost cap: max_tokens=300 on gpt-5.4-mini  (~$0.0003/call, well under $0.001).
 * API key: read from env, NEVER logged.
 */

import { auditLogs, contentDrafts, getDb, isDatabaseMode } from "@iuf-trading-room/db";
import { eq } from "drizzle-orm";

import { approveContentDraft, rejectContentDraft } from "./content-draft-store.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const AI_REVIEWER_ID = "ai-reviewer:gpt-5.4-mini";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
// Locked model — do NOT read from env (same pattern as daily-theme-summary-producer).
const OPENAI_MODEL = "gpt-5.4-mini";
const CALL_TIMEOUT_MS = 10_000;
const MAX_TOKENS = 300;

// ── Feature-flag check ────────────────────────────────────────────────────────

function isAiReviewerEnabled(): boolean {
  const raw = process.env["OPENALICE_AI_REVIEWER_ENABLED"];
  // Default ON; only disabled by explicit "false"
  return raw !== "false";
}

// ── Verdict type ──────────────────────────────────────────────────────────────

export type AiReviewVerdict = "approve" | "reject" | "manual_review";

export type AiReviewResult = {
  verdict: AiReviewVerdict;
  reason: string;
  flagged_issues: string[];
  confidence: number;
};

// ── Debug surface (last reviewer error per draft — in-memory, non-critical) ───

const _lastReviewerErrors = new Map<string, string>();

export function _getLastReviewerError(draftId: string): string | undefined {
  return _lastReviewerErrors.get(draftId);
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildReviewPrompt(draft: {
  id: string;
  targetTable: string;
  payload: unknown;
  createdAt: string;
}): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const payloadStr = JSON.stringify(draft.payload, null, 2).slice(0, 3000);

  return `You are a compliance reviewer for a financial research platform.
Review the following content draft and return ONLY valid JSON.

## Hard Reject Rules (any match → verdict: "reject")
1. Contains trading action words: buy / sell / 進場 / 賣出 / 買進 / 出脫
2. Contains target price / 目標價 / 預測股價 with a specific number
3. Contains guarantee / 必賺 / 翻倍 / 保證
4. Contains hallucinated news (specific event, number, or company name cited WITHOUT a source URL)
5. payload.llm_meta.fallback_template === true OR payload.llm_meta.provider === "fallback"
6. Any section body is empty OR shorter than 50 characters
7. payload.date (if present) does not equal today's date: ${today}

## Draft Metadata
- draftId: ${draft.id}
- targetTable: ${draft.targetTable}
- createdAt: ${draft.createdAt}

## Draft Payload
\`\`\`json
${payloadStr}
\`\`\`

## Instructions
- Check each hard reject rule strictly.
- If ANY rule triggers → verdict MUST be "reject".
- If content passes all rules but quality is uncertain → verdict "manual_review".
- If content passes all rules and quality is clearly acceptable → verdict "approve".
- confidence: 0.0–1.0 (your certainty in the verdict).
- flagged_issues: list each rule violation found (empty array if none).

Return ONLY this JSON (no markdown fence, no extra text):
{"verdict":"approve|reject|manual_review","reason":"<1 sentence>","flagged_issues":[],"confidence":0.9}`;
}

// ── OpenAI call ───────────────────────────────────────────────────────────────

async function callOpenAiReviewer(prompt: string): Promise<AiReviewResult | null> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    // No key → can't review → leave awaiting_review (safe default)
    return null;
  }

  let res: Response;
  try {
    res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Key is in header only, not in any log output
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_TOKENS,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Do NOT log the apiKey — only log non-sensitive error message
    console.warn(`[ai-reviewer] OpenAI call failed: ${msg}`);
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    console.warn(`[ai-reviewer] OpenAI HTTP ${res.status}: ${body.slice(0, 120)}`);
    return null;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    console.warn("[ai-reviewer] OpenAI response not JSON");
    return null;
  }

  const rawContent: string | null | undefined =
    data &&
    typeof data === "object" &&
    "choices" in data &&
    Array.isArray((data as { choices: unknown[] }).choices)
      ? (
          (data as { choices: Array<{ message?: { content?: string } }> }).choices[0]?.message
            ?.content ?? null
        )
      : null;

  if (!rawContent) {
    console.warn("[ai-reviewer] OpenAI returned empty content");
    return null;
  }

  try {
    // Strip potential markdown fences
    const clean = rawContent.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(clean) as Partial<AiReviewResult>;

    const verdict = parsed.verdict;
    if (verdict !== "approve" && verdict !== "reject" && verdict !== "manual_review") {
      console.warn(`[ai-reviewer] Invalid verdict: ${verdict}`);
      return null;
    }

    return {
      verdict,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : "",
      flagged_issues: Array.isArray(parsed.flagged_issues)
        ? (parsed.flagged_issues as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5
    };
  } catch {
    console.warn("[ai-reviewer] Could not parse OpenAI verdict JSON");
    return null;
  }
}

// ── Audit log writer (direct DB insert, no AppSession required) ───────────────

async function writeAiReviewAuditLog(input: {
  workspaceId: string;
  draftId: string;
  action: string;
  result: AiReviewResult;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(auditLogs).values({
      workspaceId: input.workspaceId,
      actorId: null, // AI reviewer has no user UUID
      action: input.action,
      entityType: "content_draft",
      entityId: input.draftId,
      payload: {
        reviewer: AI_REVIEWER_ID,
        verdict: input.result.verdict,
        reason: input.result.reason,
        flagged_issues: input.result.flagged_issues,
        confidence: input.result.confidence
      }
    });
  } catch (e) {
    // Non-critical — do not throw
    console.warn(`[ai-reviewer] Audit log write failed for draft ${input.draftId}:`, e instanceof Error ? e.message : e);
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Asynchronously reviews a content draft using OpenAI.
 * Called non-blocking from openalice-bridge after createContentDraft.
 * Never throws — all errors are contained and surfaced via _lastReviewerErrors.
 */
export async function fireAiReviewerForDraft(draftId: string): Promise<void> {
  if (!isAiReviewerEnabled()) {
    return;
  }

  if (!isDatabaseMode()) {
    return;
  }

  const db = getDb();
  if (!db) return;

  // Load the draft
  let draftRow: typeof contentDrafts.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(contentDrafts)
      .where(eq(contentDrafts.id, draftId))
      .limit(1);
    draftRow = rows[0];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    _lastReviewerErrors.set(draftId, `db_load_failed: ${msg}`);
    return;
  }

  if (!draftRow) {
    _lastReviewerErrors.set(draftId, "draft_not_found");
    return;
  }

  if (draftRow.status !== "awaiting_review") {
    // Already processed — skip silently
    return;
  }

  const prompt = buildReviewPrompt({
    id: draftRow.id,
    targetTable: draftRow.targetTable,
    payload: draftRow.payload,
    createdAt: draftRow.createdAt.toISOString()
  });

  const result = await callOpenAiReviewer(prompt);

  if (!result) {
    // Timeout / key missing / parse error → leave awaiting_review for human
    _lastReviewerErrors.set(draftId, "ai_call_failed_or_timeout_fallback_to_human");
    return;
  }

  const workspaceId = draftRow.workspaceId;

  if (result.verdict === "approve") {
    const approveResult = await approveContentDraft({
      draftId,
      reviewerId: null // AI reviewer — no user UUID; identity stored in audit log
    });

    if ("error" in approveResult) {
      _lastReviewerErrors.set(draftId, `approve_failed: ${approveResult.error}`);
      return;
    }

    await writeAiReviewAuditLog({
      workspaceId,
      draftId,
      action: "content_draft.ai_approved",
      result
    });

    console.info(`[ai-reviewer] Draft ${draftId} AUTO-APPROVED (confidence=${result.confidence})`);
    return;
  }

  if (result.verdict === "reject") {
    const rejectResult = await rejectContentDraft({
      draftId,
      reviewerId: null,
      reason: `[ai-reviewer] ${result.reason} | issues: ${result.flagged_issues.join("; ")}`
    });

    if ("error" in rejectResult) {
      _lastReviewerErrors.set(draftId, `reject_failed: ${rejectResult.error}`);
      return;
    }

    await writeAiReviewAuditLog({
      workspaceId,
      draftId,
      action: "content_draft.ai_rejected",
      result
    });

    console.info(`[ai-reviewer] Draft ${draftId} AUTO-REJECTED: ${result.reason}`);
    return;
  }

  // verdict === "manual_review" → leave status as awaiting_review, log it
  await writeAiReviewAuditLog({
    workspaceId,
    draftId,
    action: "content_draft.ai_manual_review",
    result
  });

  console.info(`[ai-reviewer] Draft ${draftId} flagged for MANUAL_REVIEW: ${result.reason}`);
}
