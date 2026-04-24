/**
 * openalice-router.ts (P0-C)
 *
 * Producer-side routing helper: decides whether a producer should enqueue an
 * OpenAlice job (active Windows device present) or fall back to direct
 * rule-template write.
 *
 * Also centralises the 24-hr dedupe-key check against content_drafts.
 * Rejected drafts do NOT block re-run — producer may retry.
 *
 * Keep in sync with apps/api/src/content-draft-store.ts (same dedupe key +
 * window). This file intentionally re-implements the helpers so the worker
 * does not import from the api package.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import {
  contentDrafts,
  getDb,
  openAliceDevices,
  openAliceJobs
} from "@iuf-trading-room/db";

export const OPENALICE_ACTIVE_DEVICE_SECONDS = Number(
  process.env.OPENALICE_ACTIVE_DEVICE_SECONDS ?? 5 * 60
);

export const CONTENT_DRAFT_DEDUPE_WINDOW_SECONDS = Number(
  process.env.CONTENT_DRAFT_DEDUPE_WINDOW_SECONDS ?? 24 * 60 * 60
);

export function computeContentDraftDedupeKey(input: {
  workspaceId: string;
  targetTable: string;
  targetEntityId: string | null | undefined;
  producerVersion: string;
}) {
  const entity = input.targetEntityId ?? "_none_";
  return `${input.workspaceId}:${input.targetTable}:${entity}:${input.producerVersion}`;
}

export async function isOpenAliceDeviceActive(
  workspaceId: string,
  now: Date = new Date()
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const cutoff = new Date(now.getTime() - OPENALICE_ACTIVE_DEVICE_SECONDS * 1000);
  const rows = await db
    .select({ id: openAliceDevices.id })
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
 * Returns a recent non-rejected draft that matches the dedupe key within the
 * 24-hr window. Callers use this to skip producer runs when a draft is already
 * awaiting review or was already approved.
 */
export async function findRecentDraftByDedupeKey(input: {
  dedupeKey: string;
  windowSeconds?: number;
  now?: Date;
}) {
  const db = getDb();
  if (!db) return null;

  const now = input.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - (input.windowSeconds ?? CONTENT_DRAFT_DEDUPE_WINDOW_SECONDS) * 1000
  );

  const rows = await db
    .select({
      id: contentDrafts.id,
      status: contentDrafts.status,
      createdAt: contentDrafts.createdAt
    })
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

/**
 * Returns true if there is already a queued or running OpenAlice job in this
 * workspace with the exact same task type + target entity. Prevents producer
 * from spamming duplicate jobs when the runner is slow.
 */
export async function findPendingOpenAliceJob(input: {
  workspaceId: string;
  taskType: string;
  targetEntityId: string;
}): Promise<{ id: string; status: string } | null> {
  const db = getDb();
  if (!db) return null;

  // Scan queued + running jobs for the workspace; filter in JS by parameter
  // match (parameters is jsonb; drizzle supports sql-level jsonb ops but
  // keeping this simple for P0).
  const rows = await db
    .select({
      id: openAliceJobs.id,
      status: openAliceJobs.status,
      parameters: openAliceJobs.parameters,
      taskType: openAliceJobs.taskType
    })
    .from(openAliceJobs)
    .where(eq(openAliceJobs.workspaceId, input.workspaceId))
    .orderBy(desc(openAliceJobs.createdAt))
    .limit(50);

  const match = rows.find((row) => {
    if (row.status !== "queued" && row.status !== "running") return false;
    if (row.taskType !== input.taskType) return false;
    const params = row.parameters as Record<string, unknown> | null;
    return params && typeof params.targetEntityId === "string" && params.targetEntityId === input.targetEntityId;
  });

  return match ? { id: match.id, status: match.status } : null;
}

export async function enqueueOpenAliceJobFromWorker(input: {
  workspaceId: string;
  taskType: string;
  schemaName: string;
  instructions: string;
  contextRefs: Array<{ type: string; id?: string; path?: string; url?: string }>;
  parameters: Record<string, unknown>;
  timeoutSeconds?: number;
  maxAttempts?: number;
}): Promise<{ id: string } | null> {
  const db = getDb();
  if (!db) return null;

  const [row] = await db
    .insert(openAliceJobs)
    .values({
      workspaceId: input.workspaceId,
      status: "queued",
      taskType: input.taskType,
      schemaName: input.schemaName,
      instructions: input.instructions,
      contextRefs: input.contextRefs,
      parameters: input.parameters,
      timeoutSeconds: input.timeoutSeconds ?? 900,
      maxAttempts: input.maxAttempts ?? 3
    })
    .returning({ id: openAliceJobs.id });

  return row ? { id: row.id } : null;
}

export type ProducerRoutingDecision =
  | { kind: "skip_existing_draft"; dedupeKey: string; draftId: string }
  | { kind: "skip_pending_job"; jobId: string }
  | { kind: "enqueue_openalice" }
  | { kind: "fallback_local" };

/**
 * Central routing decision for a producer run.
 *
 * Rules (P0-C):
 *   1. If a non-rejected draft with same dedupe_key exists in the last 24 h → skip.
 *   2. If a queued/running OpenAlice job for the same task+entity exists → skip.
 *   3. If a device is active (lastSeenAt < 5 min) → enqueue_openalice.
 *   4. Otherwise → fallback_local (direct rule-template write).
 */
export async function decideProducerRoute(input: {
  workspaceId: string;
  targetTable: string;
  targetEntityId: string;
  taskType: string;
  producerVersion?: string;
  now?: Date;
}): Promise<ProducerRoutingDecision> {
  const producerVersion = input.producerVersion ?? "v1";
  const dedupeKey = computeContentDraftDedupeKey({
    workspaceId: input.workspaceId,
    targetTable: input.targetTable,
    targetEntityId: input.targetEntityId,
    producerVersion
  });

  const existingDraft = await findRecentDraftByDedupeKey({ dedupeKey, now: input.now });
  if (existingDraft) {
    return { kind: "skip_existing_draft", dedupeKey, draftId: existingDraft.id };
  }

  const pendingJob = await findPendingOpenAliceJob({
    workspaceId: input.workspaceId,
    taskType: input.taskType,
    targetEntityId: input.targetEntityId
  });
  if (pendingJob) {
    return { kind: "skip_pending_job", jobId: pendingJob.id };
  }

  if (await isOpenAliceDeviceActive(input.workspaceId, input.now)) {
    return { kind: "enqueue_openalice" };
  }

  return { kind: "fallback_local" };
}
