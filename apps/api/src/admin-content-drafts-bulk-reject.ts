/**
 * admin-content-drafts-bulk-reject.ts
 *
 * Handler for:
 *   POST /api/v1/admin/content-drafts/bulk-reject
 *
 * Owner-only. Bulk-rejects content_drafts that match the given filter
 * (default: status=awaiting_review, olderThanDays=7).
 *
 * Root cause (2026-07-02 Bruce audit):
 *   1012 drafts stuck in awaiting_review. Producer: apps/worker company-note-producer
 *   (10min) and theme-summary-producer (15min). When OpenAlice devices are active
 *   they enqueue OpenAlice jobs → devices submit draft_ready → v1 draft created.
 *   Devices went stale; AI reviewer never processed the queue → 1012 stuck.
 *   No v2 pipeline consumer depends on these drafts (daily_briefs pipeline reads
 *   daily_briefs table directly since #1092; theme/company paths use fallback_local
 *   when no active device). Safe to bulk-reject.
 *
 * Request body (all optional, defaults shown):
 *   {
 *     olderThanDays?: number,       // default 7, min 1, max 365
 *     status?: "awaiting_review",   // only awaiting_review supported (default)
 *     producerVersion?: string,     // optional filter e.g. "v1"
 *     apply?: boolean               // default FALSE — dry-run always default
 *   }
 *
 * Response (dry-run):
 *   { dryRun: true, wouldReject: N, distribution: { byTable, byProducerVersion }, params }
 *
 * Response (apply=true):
 *   { applied: true, rejected: N, distribution: { byTable, byProducerVersion }, params }
 *
 * Hard lines:
 *   - Owner-only.
 *   - apply=false by default — never auto-applies. Caller must explicitly send apply:true.
 *   - Soft state transition only: status='rejected', NOT DELETE.
 *   - No row is touched in dry-run mode.
 */

import type { Context } from "hono";
import { and, eq, lt, sql } from "drizzle-orm";
import { contentDrafts, getDb, isDatabaseMode } from "@iuf-trading-room/db";
import { z } from "zod";

const bulkRejectBodySchema = z.object({
  olderThanDays: z.coerce.number().int().min(1).max(365).default(7),
  status: z.enum(["awaiting_review"]).default("awaiting_review"),
  producerVersion: z.string().max(50).optional(),
  apply: z.boolean().default(false),
});

export async function handleAdminContentDraftsBulkReject(c: Context): Promise<Response> {
  const session = c.get("session") as { user: { id: string; role: string } } | null;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "owner_required" }, 403);
  }
  if (!isDatabaseMode()) {
    return c.json({ error: "database_mode_required" }, 400);
  }
  const db = getDb();
  if (!db) return c.json({ error: "database_unavailable" }, 503);

  const rawBody = await c.req.json().catch(() => ({}));
  const body = bulkRejectBodySchema.parse(rawBody);

  const cutoffDate = new Date(Date.now() - body.olderThanDays * 24 * 60 * 60 * 1000);

  // Build distribution stats (always computed — same query in both modes)
  const baseConditions = [
    eq(contentDrafts.status, body.status),
    lt(contentDrafts.createdAt, cutoffDate),
    ...(body.producerVersion ? [eq(contentDrafts.producerVersion, body.producerVersion)] : []),
  ] as Parameters<typeof and>;

  const whereClause = and(...baseConditions);

  const distRows = await db
    .select({
      targetTable: contentDrafts.targetTable,
      producerVersion: contentDrafts.producerVersion,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(contentDrafts)
    .where(whereClause)
    .groupBy(contentDrafts.targetTable, contentDrafts.producerVersion);

  const totalCount = distRows.reduce((sum, r) => sum + (r.count ?? 0), 0);
  const byTable: Record<string, number> = {};
  const byProducerVersion: Record<string, number> = {};
  for (const r of distRows) {
    byTable[r.targetTable] = (byTable[r.targetTable] ?? 0) + (r.count ?? 0);
    byProducerVersion[r.producerVersion] = (byProducerVersion[r.producerVersion] ?? 0) + (r.count ?? 0);
  }

  const params = {
    olderThanDays: body.olderThanDays,
    status: body.status,
    producerVersion: body.producerVersion ?? null,
  };

  if (!body.apply) {
    return c.json({
      dryRun: true,
      wouldReject: totalCount,
      distribution: { byTable, byProducerVersion },
      params,
    });
  }

  // apply=true — bulk status transition to 'rejected' (soft delete, no row removal)
  const now = new Date();
  await db
    .update(contentDrafts)
    .set({
      status: "rejected",
      reviewedBy: session.user.id,
      reviewedAt: now,
      rejectReason: `admin bulk-reject: olderThanDays=${body.olderThanDays} status=${body.status}${body.producerVersion ? ` producerVersion=${body.producerVersion}` : ""}`,
      updatedAt: now,
    })
    .where(whereClause);

  return c.json({
    applied: true,
    rejected: totalCount,
    distribution: { byTable, byProducerVersion },
    params,
  });
}
