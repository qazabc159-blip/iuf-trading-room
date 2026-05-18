/**
 * admin-content-drafts-cleanup-orphan.ts
 *
 * Handler for:
 *   POST /api/v1/admin/content-drafts/cleanup-orphan
 *
 * Owner-only admin endpoint that finds content_drafts where:
 *   status = 'approved' AND approvedRefId IS NOT NULL
 *   but the referenced brief (in daily_briefs) no longer exists (404).
 *
 * Root cause (2026-05-18 Bruce audit):
 *   Draft e6d33da2-e9c4-41fd-885f-fed4c37d7380 has status=approved and
 *   approvedRefId pointing to a daily_brief row that was deleted. The dedupeKey
 *   on that draft blocks new drafts from being created for 5/15 brief backfill.
 *
 * Request body:
 *   {
 *     dryRun: boolean,         // true = list only, false = DELETE matching rows
 *     draftId?: string         // if given, target that specific draft only
 *   }
 *
 * Response:
 *   { data: { dryRun, scanned, orphans, deleted, errors, audit } }
 *
 * Hard lines:
 *   - Owner-only.
 *   - Writes audit_log action="admin.content_drafts.cleanup_orphan" on real delete.
 *   - Fail-open: partial errors do not abort.
 *   - Does NOT drop anything that still has a live approvedRefId.
 */

import type { Context } from "hono";
import { getDb, isDatabaseMode, contentDrafts, dailyBriefs, auditLogs } from "@iuf-trading-room/db";
import type { AppSession } from "@iuf-trading-room/contracts";
import { eq, and, isNotNull } from "drizzle-orm";

export interface OrphanDraftRow {
  draftId: string;
  dedupeKey: string;
  approvedRefId: string;
  targetTable: string;
  createdAt: string;
  reason: string;
}

export interface CleanupOrphanResult {
  dryRun: boolean;
  scanned: number;
  orphans: OrphanDraftRow[];
  deleted: number;
  errors: string[];
}

/**
 * Core logic — exported so tests can call it directly.
 */
export async function cleanupOrphanContentDrafts(
  workspaceId: string,
  input: { dryRun: boolean; draftId?: string }
): Promise<CleanupOrphanResult> {
  const result: CleanupOrphanResult = {
    dryRun: input.dryRun,
    scanned: 0,
    orphans: [],
    deleted: 0,
    errors: []
  };

  if (!isDatabaseMode()) {
    return result;
  }

  const db = getDb();
  if (!db) {
    result.errors.push("db_unavailable");
    return result;
  }

  // ── Load candidate approved drafts with a non-null approvedRefId ─────────────
  // We only care about drafts where the referenced brief is missing.
  // Scope to daily_briefs targetTable only (the table whose rows can be deleted).
  const conditions = [
    eq(contentDrafts.workspaceId, workspaceId),
    eq(contentDrafts.status, "approved"),
    isNotNull(contentDrafts.approvedRefId)
  ];

  if (input.draftId) {
    conditions.push(eq(contentDrafts.id, input.draftId));
  }

  let candidateRows: Array<{
    id: string;
    dedupeKey: string;
    approvedRefId: string | null;
    targetTable: string;
    createdAt: Date;
  }>;

  try {
    candidateRows = await db
      .select({
        id: contentDrafts.id,
        dedupeKey: contentDrafts.dedupeKey,
        approvedRefId: contentDrafts.approvedRefId,
        targetTable: contentDrafts.targetTable,
        createdAt: contentDrafts.createdAt
      })
      .from(contentDrafts)
      .where(and(...conditions));
  } catch (err) {
    result.errors.push(`load_failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  result.scanned = candidateRows.length;

  // ── For each candidate, check if the referenced brief still exists ────────────
  for (const row of candidateRows) {
    if (!row.approvedRefId) continue;

    // Only check daily_briefs target (the only deletable target we care about here)
    if (row.targetTable !== "daily_briefs") {
      // Not a brief orphan; skip — keep it for other admin ops
      continue;
    }

    let briefExists = true;
    try {
      const briefRows = await db
        .select({ id: dailyBriefs.id })
        .from(dailyBriefs)
        .where(
          and(
            eq(dailyBriefs.id, row.approvedRefId),
            eq(dailyBriefs.workspaceId, workspaceId)
          )
        )
        .limit(1);
      briefExists = briefRows.length > 0;
    } catch (err) {
      result.errors.push(
        `brief_check_failed draft=${row.id}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    if (briefExists) {
      // Live reference — skip
      continue;
    }

    // Orphan detected
    result.orphans.push({
      draftId: row.id,
      dedupeKey: row.dedupeKey,
      approvedRefId: row.approvedRefId,
      targetTable: row.targetTable,
      createdAt: row.createdAt.toISOString(),
      reason: "approved_ref_brief_not_found"
    });
  }

  if (input.dryRun) {
    return result;
  }

  // ── DELETE orphan drafts ───────────────────────────────────────────────────────
  for (const orphan of result.orphans) {
    try {
      await db
        .delete(contentDrafts)
        .where(
          and(
            eq(contentDrafts.id, orphan.draftId),
            eq(contentDrafts.workspaceId, workspaceId)
          )
        );
      result.deleted++;
    } catch (err) {
      result.errors.push(
        `delete_failed draft=${orphan.draftId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

/**
 * POST /api/v1/admin/content-drafts/cleanup-orphan
 * Auth: Owner-only
 */
export async function handleAdminContentDraftsCleanupOrphan(
  c: Context
): Promise<Response> {
  const session = c.get("session") as AppSession | undefined;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const workspaceId = session.workspace.id;

  // Parse body
  let dryRun = true;
  let draftId: string | undefined;
  try {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body["dryRun"] === "boolean") {
      dryRun = body["dryRun"];
    }
    if (typeof body["draftId"] === "string" && body["draftId"].length > 0) {
      draftId = body["draftId"];
    }
  } catch {
    // Empty / non-JSON body — default dryRun=true
  }

  const result = await cleanupOrphanContentDrafts(workspaceId, { dryRun, draftId });

  // Write audit log on real delete
  if (!dryRun && result.deleted > 0 && isDatabaseMode()) {
    const db = getDb();
    if (db) {
      await db
        .insert(auditLogs)
        .values({
          workspaceId,
          actorId: session.user.id,
          action: "admin.content_drafts.cleanup_orphan",
          entityType: "content_draft",
          entityId: workspaceId,
          payload: {
            scanned: result.scanned,
            orphansFound: result.orphans.length,
            deleted: result.deleted,
            errorCount: result.errors.length,
            targetDraftId: draftId ?? null,
            triggeredAt: new Date().toISOString()
          }
        })
        .catch((err: unknown) => {
          console.error("[admin-content-drafts-cleanup-orphan] audit log write failed:", err);
        });
    }
  }

  const httpStatus = result.errors.length > 0 ? 207 : 200;
  return c.json({ data: result }, httpStatus as 200 | 207);
}
