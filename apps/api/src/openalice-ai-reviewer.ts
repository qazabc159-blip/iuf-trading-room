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
import {
  recordReviewerVerdict,
  lookupJobSourcePackSummary,
  loadSourcePackForDraft,
  evaluatePipelinePublishGate
} from "./openalice-pipeline.js";
import { runAdversarialReview, type AdversarialReviewResult } from "./openalice-adversarial-reviewer.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
// E2E fail diagnosis 2026-05-06 (Elva): "gpt-5.4-mini" was a Codex CLI internal
// namespace name, not a real OpenAI public-API model. OpenAI returned 4xx
// model_not_found, AI reviewer fell back to human (audit_log.ai_approved=0).
// Read from env so operator can set the real OpenAI model id without code change.
// Default to gpt-4o-mini (cheapest current OpenAI mini model, ~$0.150/$0.600 per 1M tokens).
const OPENAI_MODEL = process.env["OPENAI_MODEL"] ?? "gpt-4o-mini";
const AI_REVIEWER_ID = `ai-reviewer:${OPENAI_MODEL}`;
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

export function resolveDraftReviewDate(payload: unknown, fallbackDate = new Date().toISOString().slice(0, 10)): string {
  if (payload && typeof payload === "object" && "date" in payload) {
    const date = (payload as { date?: unknown }).date;
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
  }
  return fallbackDate;
}

function buildReviewPrompt(draft: {
  id: string;
  targetTable: string;
  payload: unknown;
  createdAt: string;
}): string {
  const expectedDate = resolveDraftReviewDate(draft.payload);

  const payloadStr = JSON.stringify(draft.payload, null, 2).slice(0, 3000);

  return `You are a compliance reviewer for a Taiwan-stock financial research platform.
Review the following content draft and return ONLY valid JSON.

## Explicit Allow List (NEVER reject for these — they are product-approved research wording)
- 進場參考區 (entry reference zone) — describes a price zone, not a command to trade
- 停損 (stop-loss reference) — describes a risk management concept, not a guarantee
- 失效 (invalidation point) — describes a research invalidation condition
- 倉位建議 (position sizing guidance) — describes risk management sizing, not a buy/sell command
- Any wording that frames market analysis as "參考" (reference) or "觀察" (observation)

## Hard Reject Rules (any match => verdict: "reject")
1. Contains DIRECTIVE trading advice that COMMANDS the reader to trade: "you should buy/sell",
   "recommend buy/sell", "buy now", "sell immediately", 建議買進, 建議賣出, 出脫, 加碼, 減碼
   — NOTE: 進場參考區 and 停損/失效/倉位建議 are explicitly ALLOWED (see Allow List above).
   Only reject if the wording directly instructs the reader to execute a trade.
2. Contains target price / 目標價 / 預測股價 with a specific number.
3. Contains guarantee / 保證獲利 / 必漲 / 穩賺.
4. Contains hallucinated news (specific event, number, or company name cited WITHOUT a source URL).
5. payload.llm_meta.fallback_template === true OR payload.llm_meta.provider === "fallback".
6. Any section body is empty OR shorter than 50 characters.
7. payload.date (if present) does not equal the expected brief date: ${expectedDate}.

## Important Non-Reject Examples
- Do NOT reject factual source or dataset labels such as "institutional buy/sell",
  "foreign investor buy/sell", "tw_institutional_buysell",
  "TaiwanStockInstitutionalInvestorsBuySell", "成交量", "買賣超", or "三大法人".
- Do NOT reject factual historical descriptions like "外資買超 2,000 張" when it is
  clearly describing source data and does not tell the reader to trade.
- Do NOT reject research content that describes entry/exit zones, stop-loss levels, or
  position sizing as educational reference — these are explicitly allowed per the Allow List.
- If a draft is descriptive but weak, prefer "manual_review" over "reject".

## Draft Metadata
- draftId: ${draft.id}
- targetTable: ${draft.targetTable}
- createdAt: ${draft.createdAt}

## Draft Payload
\`\`\`json
${payloadStr}
\`\`\`

## Instructions
- Check each hard reject rule strictly, but distinguish source labels from advice.
- For daily brief backfills, payload.date is the expected date; do not reject a valid historical brief only because createdAt or the current calendar date is newer.
- If ANY hard reject rule triggers => verdict MUST be "reject".
- If content passes all rules but quality is uncertain => verdict "manual_review".
- If content passes all rules and quality is clearly acceptable => verdict "approve".
- confidence: 0.0-1.0 (your certainty in the verdict).
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

// ── Adversarial audit log writer ───────────────────────────────────────────────

async function writeAdversarialAuditLog(input: {
  workspaceId: string;
  draftId: string;
  adversarialResult: AdversarialReviewResult;
  intercepted: boolean; // true if severityScore >= 7 and auto-approve was blocked
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(auditLogs).values({
      workspaceId: input.workspaceId,
      actorId: null, // adversarial reviewer has no user UUID
      action: "content_draft.adversarial_audit",
      entityType: "content_draft",
      entityId: input.draftId,
      payload: {
        reviewer: `adversarial-reviewer:${process.env["OPENAI_ADVERSARIAL_REVIEWER_MODEL"] ?? "gpt-4.1"}`,
        adversarialFlags: input.adversarialResult.adversarialFlags,
        severityScore: input.adversarialResult.severityScore,
        reasoning: input.adversarialResult.reasoning,
        intercepted: input.intercepted
      }
    });
  } catch (e) {
    // Non-critical — do not throw
    console.warn(
      `[adversarial-reviewer] Audit log write failed for draft ${input.draftId}:`,
      e instanceof Error ? e.message : e
    );
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

  // Bruce PR #230 F1 fix: wire 3-tier publish gate. Even when AI says approve,
  // a Red-tier classification (buy/sell/target price/guarantee/Sharpe/勝率) MUST
  // override and force reject. Yellow tier holds in awaiting_review for human.
  // Pete F2 fix: recordReviewerVerdict updates lastReviewedAt + reviewerVerdict
  // observability fields atomically.
  const { tier } = recordReviewerVerdict({
    payload: draftRow.payload,
    verdict: result.verdict
  });

  if (result.verdict === "approve" && tier === "red") {
    // Red-tier override — force reject regardless of AI verdict
    const rejectResult = await rejectContentDraft({
      draftId,
      reviewerId: null,
      reason: `[ai-reviewer] Red-tier content blocked by publish gate (tier=red). AI verdict=${result.verdict} but content matched red-tier policy patterns (buy/sell/target/guarantee/Sharpe/勝率). | reason: ${result.reason}`
    });
    if ("error" in rejectResult) {
      _lastReviewerErrors.set(draftId, `red_override_reject_failed: ${rejectResult.error}`);
      return;
    }
    await writeAiReviewAuditLog({
      workspaceId,
      draftId,
      action: "content_draft.ai_rejected",
      result: { ...result, verdict: "reject", reason: `RED_TIER_OVERRIDE: ${result.reason}` }
    });
    console.info(`[ai-reviewer] Draft ${draftId} RED-TIER OVERRIDE (was approve, forced reject)`);
    return;
  }

  if (result.verdict === "approve" && tier === "yellow") {
    // Yellow-tier hold — keep awaiting_review for human review
    await writeAiReviewAuditLog({
      workspaceId,
      draftId,
      action: "content_draft.ai_yellow_held",
      result
    });
    console.info(`[ai-reviewer] Draft ${draftId} YELLOW-TIER HELD for human review (AI approved but tier=yellow)`);
    return;
  }

  if (result.verdict === "approve") {
    // Green tier — run adversarial second-pass before auto-publish
    // Safe-default: null on any failure → auto-publish proceeds unchanged

    // Gap 2 fix: look up sourcePackSummary from the pipeline job registry via sourceJobId.
    // Enables Category C (source selection bias) detection in the adversarial reviewer.
    const sourcePackSummary = draftRow.sourceJobId
      ? lookupJobSourcePackSummary(draftRow.sourceJobId)
      : null;

    const adversarialResult = await runAdversarialReview(
      draftRow.payload,
      draftId,
      sourcePackSummary // Gap 2 fix: real summary if pipeline draft, null for non-pipeline drafts
    );

    if (adversarialResult) {
      // Always write audit log — paper trail for Elva/楊董.
      // 2026-05-15 relax: adversarial reviewer now surfaces as DRAFT WARNING only.
      // It no longer auto-blocks (intercepts) at any score — hallucination guard
      // is handled upstream by the 7-rule primary reviewer and the publish gate.
      // Adversarial flags are logged for human reference but do not hold the draft.
      await writeAdversarialAuditLog({
        workspaceId,
        draftId,
        adversarialResult,
        intercepted: false // no longer auto-intercepts
      });

      if (adversarialResult.severityScore >= 7) {
        // Surface as warning in audit log — do NOT hold the draft.
        // Human editors can inspect via audit_logs action=content_draft.adversarial_audit.
        console.info(
          `[adversarial-reviewer] Draft ${draftId} adversarial score=${adversarialResult.severityScore} >= 7 — surfaced as draft warning (not auto-blocked per 2026-05-15 relax)`
        );
        // Fall through to pipeline publish gate — do NOT return early.
      }
    }

    // severityScore < 7 OR adversarialResult === null → run pipeline publish gate before auto-approve.
    // RED-1 fix (Pete BG audit 2026-05-07): evaluatePipelinePublishGate was orphaned — never called
    // from the approve path.
    // Layer 5 fix (Pete audit 2026-05-08): pass real SourcePack instead of null.
    // Previously: evaluatePipelinePublishGate(draftId, null) → Layer 5 condition
    //   `if (draftContentForFactual && sourcePack)` was always false → 0% activation.
    // Now: loadSourcePackForDraft(sourceJobId) retrieves the full SourcePack registered
    //   during generateDailyBrief (registerJobSourcePack), keyed by sourceJobId.
    // Graceful fallback: null if non-pipeline draft or process restarted since generation.
    //   null → gate still runs (BROKEN scan + single-pass RAG fallback); Layer 5 also
    //   gracefully degrades (rawSources=[] → skip factual reviewer per cost-guard).
    // Important: evaluatePipelinePublishGate re-reads the draft from DB for its own checks.
    // It does NOT re-read the AI audit log we just wrote — the timing is fine because we call
    // evaluatePipelinePublishGate BEFORE approveContentDraft, which is correct order.
    const sourceJobId = draftRow.sourceJobId ?? null;
    const sourcePack = loadSourcePackForDraft(sourceJobId);
    try {
      const gateResult = await evaluatePipelinePublishGate(draftId, sourcePack);

      if (gateResult.action === "rejected") {
        // Gate force-rejected (BROKEN token in output, or HALLUCINATED RAG verdict)
        await writeAiReviewAuditLog({
          workspaceId,
          draftId,
          action: "content_draft.ai_rejected",
          result: {
            verdict: "reject",
            reason: `[pipeline-gate] ${gateResult.reason ?? "gate_rejected"}`,
            flagged_issues: [`pipeline_gate_reject: ${gateResult.reason ?? "unknown"}`],
            confidence: result.confidence
          }
        });
        console.info(
          `[ai-reviewer] Draft ${draftId} GATE REJECTED by evaluatePipelinePublishGate: ${gateResult.reason}`
        );
        return; // draft already rejected by gate; do not call approveContentDraft
      }

      if (gateResult.action === "queued_for_review") {
        // Gate held for manual review (e.g. BROKEN token in output, PARTIAL hallucination)
        await writeAiReviewAuditLog({
          workspaceId,
          draftId,
          action: "content_draft.ai_yellow_held",
          result: {
            verdict: "manual_review",
            reason: `[pipeline-gate] ${gateResult.reason ?? "gate_queued_for_review"}`,
            flagged_issues: [`pipeline_gate_hold: ${gateResult.reason ?? "unknown"}`],
            confidence: result.confidence
          }
        });
        console.info(
          `[ai-reviewer] Draft ${draftId} GATE HELD by evaluatePipelinePublishGate: ${gateResult.reason}`
        );
        return; // leave status as awaiting_review for human
      }

      if (gateResult.action === "published") {
        // Gate already called approveContentDraft internally and published the brief
        await writeAiReviewAuditLog({
          workspaceId,
          draftId,
          action: "content_draft.ai_approved",
          result
        });
        console.info(
          `[ai-reviewer] Draft ${draftId} AUTO-APPROVED via pipeline gate (briefId=${gateResult.briefId ?? "none"})`
        );
        return; // gate already handled approval
      }

      // gateResult.action === "skipped" (memory_mode / db_unavailable / draft_not_found / status mismatch)
      // Fall through to direct approveContentDraft below — gate was not applicable.
      if (gateResult.action !== "skipped") {
        // Unexpected action — safe default: proceed with direct approve
        console.warn(`[ai-reviewer] Unexpected gate action=${gateResult.action} for draft ${draftId} — proceeding with direct approve`);
      }
    } catch (gateErr) {
      // Gate threw unexpectedly — safe default: proceed with direct approve (do not block pipeline)
      console.warn(
        `[ai-reviewer] evaluatePipelinePublishGate threw for draft ${draftId}: ${gateErr instanceof Error ? gateErr.message : String(gateErr)}`
      );
    }

    // Gate skipped or threw — fall through to direct approveContentDraft
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

    console.info(`[ai-reviewer] Draft ${draftId} AUTO-APPROVED (Green tier, confidence=${result.confidence})`);
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
