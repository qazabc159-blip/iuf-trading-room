/**
 * admin-content-drafts-retry-review.ts
 *
 * Handler logic for:
 *   POST /api/v1/admin/content-drafts/retry-review
 *
 * Owner-only admin endpoint to re-run the AI reviewer pipeline for
 * content drafts that are stuck in "awaiting_review" status.
 *
 * Use-case: PR #530 relaxed the reviewer rules. Drafts that were blocked
 * before the deploy remain in awaiting_review and need a re-run.
 *
 * Request body:
 *   {
 *     status?: "awaiting_review",   // default: "awaiting_review" (only valid value)
 *     from?: "YYYY-MM-DD",          // filter createdAt >= from (inclusive)
 *     to?: "YYYY-MM-DD",            // filter createdAt <= to (inclusive)
 *     dryRun?: boolean,             // default: false — if true, return count only
 *     limit?: number                // max drafts to process (default 30, max 50)
 *   }
 *
 * Response:
 *   { data: { processed, approved, rejected, manual, errors, dryRun } }
 *
 * Hard lines:
 *   - Owner-only.
 *   - NEVER modifies drafts directly — delegates to fireAiReviewerForDraft().
 *   - Writes audit_log for the trigger action.
 *   - Fails open: partial errors do not abort the batch.
 */

import type { Context } from "hono";
import { getDb, isDatabaseMode, contentDrafts, auditLogs } from "@iuf-trading-room/db";
import type { AppSession } from "@iuf-trading-room/contracts";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { fireAiReviewerForDraft } from "./openalice-ai-reviewer.js";

export interface RetryReviewRequest {
  status?: string;
  from?: string;  // YYYY-MM-DD
  to?: string;    // YYYY-MM-DD
  dryRun?: boolean;
  limit?: number;
}

export interface RetryReviewResult {
  processed: number;
  approved: number;
  rejected: number;
  manual: number;
  errors: number;
  dryRun: boolean;
}

const MAX_BATCH_CONCURRENT = 5;

/**
 * Core retry logic — exported so tests can call it directly.
 */
export async function retryContentDraftReview(
  workspaceId: string,
  input: RetryReviewRequest
): Promise<RetryReviewResult> {
  const result: RetryReviewResult = {
    processed: 0,
    approved: 0,
    rejected: 0,
    manual: 0,
    errors: 0,
    dryRun: input.dryRun === true
  };

  if (!isDatabaseMode()) {
    return result;
  }

  const db = getDb();
  if (!db) {
    return result;
  }

  const limit = Math.min(input.limit ?? 30, 50);

  // Build date filter conditions
  const conditions = [
    eq(contentDrafts.workspaceId, workspaceId),
    eq(contentDrafts.status, "awaiting_review")
  ];

  if (input.from) {
    // from is YYYY-MM-DD — start of day UTC
    const fromDate = new Date(`${input.from}T00:00:00.000Z`);
    if (!isNaN(fromDate.getTime())) {
      conditions.push(gte(contentDrafts.createdAt, fromDate));
    }
  }

  if (input.to) {
    // to is YYYY-MM-DD — end of day UTC
    const toDate = new Date(`${input.to}T23:59:59.999Z`);
    if (!isNaN(toDate.getTime())) {
      conditions.push(lte(contentDrafts.createdAt, toDate));
    }
  }

  const rows = await db
    .select({ id: contentDrafts.id, status: contentDrafts.status })
    .from(contentDrafts)
    .where(and(...conditions))
    .orderBy(desc(contentDrafts.createdAt))
    .limit(limit)
    .catch(() => [] as Array<{ id: string; status: string }>);

  result.processed = rows.length;

  if (input.dryRun) {
    return result;
  }

  // Process in chunks to avoid overwhelming OpenAI quota
  for (let i = 0; i < rows.length; i += MAX_BATCH_CONCURRENT) {
    const chunk = rows.slice(i, i + MAX_BATCH_CONCURRENT);

    const outcomes = await Promise.allSettled(
      chunk.map(async (draft) => {
        await fireAiReviewerForDraft(draft.id);
        // Re-read status to determine outcome
        const [updated] = await db
          .select({ status: contentDrafts.status })
          .from(contentDrafts)
          .where(eq(contentDrafts.id, draft.id))
          .limit(1);
        return updated?.status ?? "unknown";
      })
    );

    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        const status = outcome.value;
        if (status === "approved") result.approved++;
        else if (status === "rejected") result.rejected++;
        else if (status === "awaiting_review") result.manual++;
        else result.errors++;
      } else {
        result.errors++;
      }
    }
  }

  return result;
}

/**
 * Triggered by POST /api/v1/admin/content-drafts/retry-review
 * Auth must be checked inside this handler.
 */
export async function handleAdminContentDraftsRetryReview(
  c: Context
): Promise<Response> {
  const session = c.get("session") as AppSession | undefined;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const workspaceId = session.workspace.id;

  // Parse body — graceful on missing fields
  let body: RetryReviewRequest = {};
  try {
    const raw = await c.req.json();
    if (raw && typeof raw === "object") {
      body = raw as RetryReviewRequest;
    }
  } catch {
    // Empty body is fine — all params have defaults
  }

  // Only "awaiting_review" is a valid status for this endpoint
  if (body.status && body.status !== "awaiting_review") {
    return c.json({ error: "invalid_status", message: "Only awaiting_review is supported" }, 400);
  }

  const result = await retryContentDraftReview(workspaceId, body);

  // Write audit log
  if (isDatabaseMode()) {
    const db = getDb();
    if (db) {
      await db
        .insert(auditLogs)
        .values({
          workspaceId,
          actorId: session.user.id,
          action: "admin.content_drafts.retry_review",
          entityType: "content_draft",
          entityId: workspaceId,
          payload: {
            ...result,
            from: body.from ?? null,
            to: body.to ?? null,
            limit: body.limit ?? 30,
            triggeredAt: new Date().toISOString()
          }
        })
        .catch((err: unknown) => {
          console.error("[admin-content-drafts-retry-review] audit log write failed:", err);
        });
    }
  }

  return c.json({ data: result });
}
