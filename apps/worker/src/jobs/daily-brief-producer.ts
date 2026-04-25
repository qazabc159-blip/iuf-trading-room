/**
 * daily-brief-producer.ts (P0-C routing)
 *
 * Generates a daily brief by aggregating:
 * - Most recent theme summaries from theme_summaries table
 * - Top themes by priority from themes table
 * - Recent company notes from company_notes table
 *
 * Routing (OpenAlice-first):
 *   1. OpenAlice — if an active Windows runner is present, enqueue a daily_brief
 *      job. The runner submits a draft_ready result which the API mirrors into
 *      content_drafts (awaiting_review). Reviewer approves → daily_briefs row.
 *   2. Fallback — no active device → write directly to daily_briefs (same
 *      rule-template logic as original producer). Annotates fallback_reason.
 *
 * Skips if today's brief already exists in daily_briefs OR a non-rejected draft
 * for today is already awaiting_review in content_drafts.
 */
import { and, desc, eq, gte } from "drizzle-orm";

import {
  companyNotes,
  dailyBriefs,
  getDb,
  themeSummaries,
  themes,
  workspaces
} from "@iuf-trading-room/db";

import {
  decideProducerRoute,
  enqueueOpenAliceJobFromWorker
} from "../openalice-router.js";

const PRODUCER_VERSION = "v1";
const TASK_TYPE = "daily_brief";
const TARGET_TABLE = "daily_briefs";

export async function runDailyBriefProducer(): Promise<{
  briefId?: string;
  date: string;
  sectionCount?: number;
  skipped: boolean;
  route:
    | "openalice"
    | "fallback_local"
    | "skipped_existing_draft"
    | "skipped_pending_job"
    | "skipped_existing_formal_row";
  jobId?: string;
  fallbackReason?: string;
  skippedFor?: string;
}> {
  const db = getDb();
  if (!db) {
    throw new Error("[daily-brief] PERSISTENCE_MODE must be database");
  }

  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("[daily-brief] No workspace found");

  const today = new Date().toISOString().split("T")[0]!;

  const route = await decideProducerRoute({
    workspaceId: workspace.id,
    targetTable: TARGET_TABLE,
    targetEntityId: today,
    taskType: TASK_TYPE,
    producerVersion: PRODUCER_VERSION
  });

  if (route.kind === "skip_existing_formal_row") {
    return {
      date: today,
      skipped: true,
      route: "skipped_existing_formal_row",
      skippedFor: route.rowId
    };
  }

  if (route.kind === "skip_existing_draft") {
    return {
      date: today,
      skipped: true,
      route: "skipped_existing_draft",
      skippedFor: route.draftId
    };
  }

  if (route.kind === "skip_pending_job") {
    return {
      date: today,
      skipped: true,
      route: "skipped_pending_job",
      skippedFor: route.jobId
    };
  }

  // --- gather data for both paths ---
  const topThemes = await db
    .select()
    .from(themes)
    .where(eq(themes.workspaceId, workspace.id))
    .orderBy(desc(themes.priority), desc(themes.updatedAt))
    .limit(5);

  const recentSummaries = await db
    .select()
    .from(themeSummaries)
    .where(eq(themeSummaries.workspaceId, workspace.id))
    .orderBy(desc(themeSummaries.generatedAt))
    .limit(5);

  const recentNotes = await db
    .select()
    .from(companyNotes)
    .where(eq(companyNotes.workspaceId, workspace.id))
    .orderBy(desc(companyNotes.generatedAt))
    .limit(3);

  // --- OpenAlice path ---
  if (route.kind === "enqueue_openalice") {
    const topThemesParam = topThemes.map((t) => ({
      name: t.name,
      marketState: t.marketState,
      priority: t.priority
    }));
    const recentSummariesParam = recentSummaries.map((s) => s.summary.slice(0, 400));
    const recentNotesParam = recentNotes.map((n) => n.note.slice(0, 400));

    const job = await enqueueOpenAliceJobFromWorker({
      workspaceId: workspace.id,
      taskType: TASK_TYPE,
      schemaName: "daily_brief_v1",
      instructions: [
        `Produce a structured daily research brief for date: ${today}.`,
        `Top ${topThemes.length} themes by priority attached in parameters.`,
        `Include up to 5 recent theme summaries and 3 recent company notes.`,
        `Output JSON: {marketState, sections[{heading,body}]} — 3–6 sections.`
      ].join("\n"),
      contextRefs: [
        ...topThemes.slice(0, 5).map((t) => ({ type: "theme", id: t.id }))
      ],
      parameters: {
        date: today,
        topThemes: topThemesParam,
        recentSummaries: recentSummariesParam,
        recentNotes: recentNotesParam,
        targetTable: TARGET_TABLE,
        targetEntityId: today,
        producerVersion: PRODUCER_VERSION
      }
    }).catch((err: unknown) => {
      // enqueue failure — fall through to fallback_local below
      console.error("[daily-brief] enqueue failed:", err);
      return null;
    });

    if (job) {
      return {
        date: today,
        skipped: false,
        route: "openalice",
        jobId: job.id
      };
    }

    // enqueue threw — fall through to fallback_local
    console.warn("[daily-brief] OpenAlice enqueue failed, using fallback_local");
  }

  // --- fallback_local path (rule-template direct write) ---
  const fallbackReason =
    route.kind === "enqueue_openalice"
      ? "openalice_enqueue_failed"
      : "no_active_device";

  const marketState = topThemes[0]?.marketState ?? "Balanced";
  const sections: Array<{ heading: string; body: string }> = [];

  if (topThemes.length > 0) {
    const lines = topThemes.map(
      (t) =>
        `• ${t.name} [${t.lifecycle}/${t.marketState}] — Priority ${t.priority}: ${t.thesis.slice(0, 150) || "No thesis."}`
    );
    sections.push({
      heading: "Market Overview",
      body: `Market State: ${marketState}\n\nActive Themes:\n${lines.join("\n")}`
    });
  }

  if (recentSummaries.length > 0) {
    const lines = recentSummaries.map(
      (s) => `[${s.generatedAt.toISOString().slice(0, 16)}] ${s.summary.slice(0, 300)}`
    );
    sections.push({
      heading: "Theme Summaries",
      body: lines.join("\n\n---\n\n")
    });
  }

  if (recentNotes.length > 0) {
    const lines = recentNotes.map(
      (n) => `[${n.generatedAt.toISOString().slice(0, 16)}]\n${n.note.slice(0, 400)}`
    );
    sections.push({
      heading: "Company Notes",
      body: lines.join("\n\n---\n\n")
    });
  }

  if (sections.length === 0) {
    sections.push({
      heading: "Status",
      body: `Daily brief generated at ${today}. No theme or company data available yet. Run theme-summary and company-note producers first.`
    });
  }

  const [inserted] = await db
    .insert(dailyBriefs)
    .values({
      workspaceId: workspace.id,
      date: today,
      marketState,
      sections,
      generatedBy: "worker",
      status: "draft"
    })
    .returning();

  return {
    briefId: inserted!.id,
    date: today,
    sectionCount: sections.length,
    skipped: false,
    route: "fallback_local",
    fallbackReason
  };
}
