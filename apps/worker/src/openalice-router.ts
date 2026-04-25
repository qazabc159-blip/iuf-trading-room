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
  companyNotes,
  contentDrafts,
  dailyBriefs,
  getDb,
  openAliceDevices,
  openAliceJobs,
  themeSummaries
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
 * P0.5 addition — closes the fallback-path duplicate gap.
 *
 * `fallback_local` writes directly into the formal table and intentionally
 * skips `content_drafts`. Without this check, the next producer tick sees an
 * empty content_drafts for the entity and would run fallback again, producing
 * a duplicate formal-table row.
 *
 * Scope: only `theme_summaries` and `company_notes` — the two tables touched
 * by the P0 scope-locked producers. Other target tables fall through to the
 * content_drafts check as before.
 *
 * Coarseness: this check does not consider `producerVersion`. That is
 * intentional — when a formal row already exists in the 24-hr window we do
 * not want a version bump to produce another row automatically. A deliberate
 * re-run path (admin action) can bypass this at the application layer later.
 */
export async function findRecentFormalRow(input: {
  workspaceId: string;
  targetTable: string;
  targetEntityId: string;
  windowSeconds?: number;
  now?: Date;
}): Promise<{ id: string; generatedAt: Date } | null> {
  const db = getDb();
  if (!db) return null;

  const now = input.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - (input.windowSeconds ?? CONTENT_DRAFT_DEDUPE_WINDOW_SECONDS) * 1000
  );

  if (input.targetTable === "theme_summaries") {
    const rows = await db
      .select({ id: themeSummaries.id, generatedAt: themeSummaries.generatedAt })
      .from(themeSummaries)
      .where(
        and(
          eq(themeSummaries.workspaceId, input.workspaceId),
          eq(themeSummaries.themeId, input.targetEntityId),
          gte(themeSummaries.generatedAt, cutoff)
        )
      )
      .orderBy(desc(themeSummaries.generatedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  if (input.targetTable === "company_notes") {
    const rows = await db
      .select({ id: companyNotes.id, generatedAt: companyNotes.generatedAt })
      .from(companyNotes)
      .where(
        and(
          eq(companyNotes.workspaceId, input.workspaceId),
          eq(companyNotes.companyId, input.targetEntityId),
          gte(companyNotes.generatedAt, cutoff)
        )
      )
      .orderBy(desc(companyNotes.generatedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  if (input.targetTable === "daily_briefs") {
    // targetEntityId is the date string (YYYY-MM-DD); createdAt is the proxy for recency.
    const rows = await db
      .select({ id: dailyBriefs.id, generatedAt: dailyBriefs.createdAt })
      .from(dailyBriefs)
      .where(
        and(
          eq(dailyBriefs.workspaceId, input.workspaceId),
          eq(dailyBriefs.date, input.targetEntityId),
          gte(dailyBriefs.createdAt, cutoff)
        )
      )
      .orderBy(desc(dailyBriefs.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  return null;
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
  | { kind: "skip_existing_formal_row"; rowId: string; generatedAt: Date }
  | { kind: "skip_existing_draft"; dedupeKey: string; draftId: string }
  | { kind: "skip_pending_job"; jobId: string }
  | { kind: "enqueue_openalice" }
  | { kind: "fallback_local" };

/**
 * Central routing decision for a producer run.
 *
 * Rules (P0-C + P0.5 fallback-dedupe fix):
 *   0. If a formal-table row for the same entity was created in the last 24 h → skip.
 *      Closes the duplicate gap left by the original P0-C: fallback_local writes
 *      directly to the formal table without touching content_drafts, so
 *      rule 1 alone did not cover the fallback path.
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

  const existingFormal = await findRecentFormalRow({
    workspaceId: input.workspaceId,
    targetTable: input.targetTable,
    targetEntityId: input.targetEntityId,
    now: input.now
  });
  if (existingFormal) {
    return {
      kind: "skip_existing_formal_row",
      rowId: existingFormal.id,
      generatedAt: existingFormal.generatedAt
    };
  }

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
