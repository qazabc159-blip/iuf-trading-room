/**
 * content-draft-store.ts
 *
 * OpenAlice result review queue: drafts sit in `content_drafts` awaiting human
 * approval before being copied atomically into the formal table.
 *
 * Supported target tables (P0-B scope-lock): theme_summaries, company_notes.
 * daily_briefs / review_summaries / signal_clusters / trade_plan_draft will be
 * added in later phases (P0.5 / P1 / P2).
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  companyNotes,
  contentDrafts,
  getDb,
  isDatabaseMode,
  openAliceDevices,
  themeSummaries,
  workspaces
} from "@iuf-trading-room/db";
import { z } from "zod";

export const CONTENT_DRAFT_TARGET_TABLES = ["theme_summaries", "company_notes"] as const;
export type ContentDraftTargetTable = (typeof CONTENT_DRAFT_TARGET_TABLES)[number];

export const contentDraftStatuses = ["awaiting_review", "approved", "rejected"] as const;
export type ContentDraftStatus = (typeof contentDraftStatuses)[number];

export const contentDraftListQuerySchema = z.object({
  status: z.enum(contentDraftStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  workspaceSlug: z.string().min(1).max(120).optional()
});

export const contentDraftRejectSchema = z.object({
  reason: z.string().trim().min(1).max(2_000)
});

export const themeSummaryPayloadSchema = z.object({
  themeId: z.string().uuid(),
  summary: z.string().min(1),
  companyCount: z.number().int().nonnegative().default(0)
});

export const companyNotePayloadSchema = z.object({
  companyId: z.string().uuid(),
  note: z.string().min(1)
});

export type ContentDraftPayload =
  | (z.infer<typeof themeSummaryPayloadSchema> & { __table: "theme_summaries" })
  | (z.infer<typeof companyNotePayloadSchema> & { __table: "company_notes" });

export type ContentDraftRecord = {
  id: string;
  workspaceId: string;
  sourceJobId: string | null;
  targetTable: string;
  targetEntityId: string | null;
  payload: unknown;
  status: ContentDraftStatus;
  dedupeKey: string;
  producerVersion: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  approvedRefId: string | null;
  createdAt: string;
  updatedAt: string;
};

const CONTENT_DRAFT_DEDUPE_WINDOW_SECONDS = 24 * 60 * 60;
const OPENALICE_ACTIVE_DEVICE_SECONDS = 5 * 60;

export function isContentDraftTargetTable(value: string): value is ContentDraftTargetTable {
  return (CONTENT_DRAFT_TARGET_TABLES as readonly string[]).includes(value);
}

export function computeContentDraftDedupeKey(input: {
  workspaceId: string;
  targetTable: string;
  targetEntityId: string | null | undefined;
  producerVersion: string;
}) {
  const entity = input.targetEntityId ?? "_none_";
  return `${input.workspaceId}:${input.targetTable}:${entity}:${input.producerVersion}`;
}

export function isOpenAliceDeviceActivePayload(
  lastSeenAt: string | Date | null | undefined,
  now: Date = new Date(),
  activeSeconds: number = OPENALICE_ACTIVE_DEVICE_SECONDS
) {
  if (!lastSeenAt) return false;
  const ts = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  return ts.getTime() >= now.getTime() - activeSeconds * 1000;
}

/**
 * Returns true if the workspace has at least one active OpenAlice device with
 * lastSeenAt within the last 5 minutes (configurable via OPENALICE_ACTIVE_DEVICE_SECONDS).
 * Used by producers (P0-C) to decide whether to enqueue OpenAlice job or fall
 * back to local rule-template write.
 */
export async function isOpenAliceActiveForWorkspace(workspaceId: string, now: Date = new Date()) {
  if (!isDatabaseMode()) return false;
  const db = getDb();
  if (!db) return false;

  const cutoff = new Date(now.getTime() - OPENALICE_ACTIVE_DEVICE_SECONDS * 1000);
  const rows = await db
    .select({ lastSeenAt: openAliceDevices.lastSeenAt })
    .from(openAliceDevices)
    .where(
      and(
        eq(openAliceDevices.workspaceId, workspaceId),
        eq(openAliceDevices.status, "active"),
        gte(openAliceDevices.lastSeenAt, cutoff)
      )
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Check if a draft with the same dedupe_key was written within the 24-hr window
 * and is still in awaiting_review / approved status. Returns the existing record
 * if found, otherwise null.
 *
 * Callers use this to avoid producing duplicate drafts. A rejected draft does
 * not block re-run (explicitly allowed per P0-C rule).
 */
export async function findRecentContentDraftByDedupeKey(input: {
  dedupeKey: string;
  windowSeconds?: number;
  now?: Date;
}) {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  const now = input.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - (input.windowSeconds ?? CONTENT_DRAFT_DEDUPE_WINDOW_SECONDS) * 1000
  );

  const rows = await db
    .select()
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.dedupeKey, input.dedupeKey),
        gte(contentDrafts.createdAt, cutoff)
      )
    )
    .orderBy(desc(contentDrafts.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.status === "rejected") return null;
  return row;
}

export async function createContentDraft(input: {
  workspaceId: string;
  sourceJobId: string | null;
  targetTable: ContentDraftTargetTable;
  targetEntityId: string | null;
  payload: Record<string, unknown>;
  producerVersion?: string;
}): Promise<ContentDraftRecord | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;

  const producerVersion = input.producerVersion ?? "v1";
  const dedupeKey = computeContentDraftDedupeKey({
    workspaceId: input.workspaceId,
    targetTable: input.targetTable,
    targetEntityId: input.targetEntityId,
    producerVersion
  });

  const existing = await findRecentContentDraftByDedupeKey({ dedupeKey });
  if (existing) {
    return toDraftRecord(existing);
  }

  const [row] = await db
    .insert(contentDrafts)
    .values({
      workspaceId: input.workspaceId,
      sourceJobId: input.sourceJobId,
      targetTable: input.targetTable,
      targetEntityId: input.targetEntityId,
      payload: input.payload,
      status: "awaiting_review",
      dedupeKey,
      producerVersion
    })
    .returning();

  return toDraftRecord(row);
}

export async function listContentDrafts(input: {
  workspaceSlug?: string;
  status?: ContentDraftStatus;
  limit?: number;
}): Promise<ContentDraftRecord[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const limit = input.limit ?? 50;

  const conditions = [] as ReturnType<typeof eq>[];
  if (input.workspaceSlug) {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, input.workspaceSlug))
      .limit(1);
    if (!workspace) return [];
    conditions.push(eq(contentDrafts.workspaceId, workspace.id));
  }
  if (input.status) {
    conditions.push(eq(contentDrafts.status, input.status));
  }

  const query = db
    .select()
    .from(contentDrafts)
    .orderBy(desc(contentDrafts.createdAt))
    .limit(limit);

  const rows =
    conditions.length > 0
      ? await query.where(conditions.length === 1 ? conditions[0]! : and(...conditions))
      : await query;

  return rows.map(toDraftRecord);
}

export async function approveContentDraft(input: {
  draftId: string;
  reviewerId: string | null;
}): Promise<{ draft: ContentDraftRecord; approvedRefId: string } | { error: string }> {
  if (!isDatabaseMode()) return { error: "database_mode_required" };
  const db = getDb();
  if (!db) return { error: "database_unavailable" };

  return (await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(contentDrafts)
      .where(eq(contentDrafts.id, input.draftId))
      .for("update")
      .limit(1);

    if (!draft) {
      return { error: "content_draft_not_found" };
    }

    if (draft.status !== "awaiting_review") {
      return { error: `content_draft_not_reviewable:${draft.status}` };
    }

    if (!isContentDraftTargetTable(draft.targetTable)) {
      return { error: `content_draft_unsupported_target:${draft.targetTable}` };
    }

    const now = new Date();
    let approvedRefId: string;

    if (draft.targetTable === "theme_summaries") {
      const payload = themeSummaryPayloadSchema.parse(draft.payload);
      const [inserted] = await tx
        .insert(themeSummaries)
        .values({
          workspaceId: draft.workspaceId,
          themeId: payload.themeId,
          summary: payload.summary,
          companyCount: payload.companyCount
        })
        .returning();
      if (!inserted) {
        throw new Error("content_draft_theme_summary_insert_failed");
      }
      approvedRefId = inserted.id;
    } else {
      const payload = companyNotePayloadSchema.parse(draft.payload);
      const [inserted] = await tx
        .insert(companyNotes)
        .values({
          workspaceId: draft.workspaceId,
          companyId: payload.companyId,
          note: payload.note
        })
        .returning();
      if (!inserted) {
        throw new Error("content_draft_company_note_insert_failed");
      }
      approvedRefId = inserted.id;
    }

    const [updated] = await tx
      .update(contentDrafts)
      .set({
        status: "approved",
        reviewedBy: input.reviewerId,
        reviewedAt: now,
        approvedRefId,
        updatedAt: now
      })
      .where(eq(contentDrafts.id, draft.id))
      .returning();

    return { draft: toDraftRecord(updated), approvedRefId };
  })) as { draft: ContentDraftRecord; approvedRefId: string } | { error: string };
}

export async function rejectContentDraft(input: {
  draftId: string;
  reviewerId: string | null;
  reason: string;
}): Promise<{ draft: ContentDraftRecord } | { error: string }> {
  if (!isDatabaseMode()) return { error: "database_mode_required" };
  const db = getDb();
  if (!db) return { error: "database_unavailable" };

  const [draft] = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.id, input.draftId))
    .limit(1);

  if (!draft) return { error: "content_draft_not_found" };
  if (draft.status !== "awaiting_review") {
    return { error: `content_draft_not_reviewable:${draft.status}` };
  }

  const now = new Date();
  const [updated] = await db
    .update(contentDrafts)
    .set({
      status: "rejected",
      reviewedBy: input.reviewerId,
      reviewedAt: now,
      rejectReason: input.reason,
      updatedAt: now
    })
    .where(
      and(
        eq(contentDrafts.id, draft.id),
        eq(contentDrafts.status, "awaiting_review")
      )
    )
    .returning();

  if (!updated) return { error: "content_draft_concurrent_update" };
  return { draft: toDraftRecord(updated) };
}

function toDraftRecord(row: typeof contentDrafts.$inferSelect): ContentDraftRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sourceJobId: row.sourceJobId ?? null,
    targetTable: row.targetTable,
    targetEntityId: row.targetEntityId ?? null,
    payload: row.payload,
    status: row.status as ContentDraftStatus,
    dedupeKey: row.dedupeKey,
    producerVersion: row.producerVersion,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason ?? null,
    approvedRefId: row.approvedRefId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
