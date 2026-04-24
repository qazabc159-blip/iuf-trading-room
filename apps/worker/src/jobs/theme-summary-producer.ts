/**
 * theme-summary-producer.ts (P0-C routing)
 *
 * Picks one theme per run, then decides how to produce the summary:
 *   1. OpenAlice-first — if an active Windows runner is present, enqueue a
 *      theme_summary job. The runner submits a draft_ready result which the
 *      API mirrors into content_drafts (awaiting_review).
 *   2. Fallback — otherwise (no active device) the producer writes a
 *      rule-template summary directly into theme_summaries.
 *
 * De-dupe: a dedupeKey of `${workspaceId}:theme_summaries:${themeId}:v1` is
 * checked against content_drafts in a 24 h window. Non-rejected drafts block
 * a new run; rejected drafts allow retry.
 */
import { and, desc, eq } from "drizzle-orm";

import {
  companies,
  companyThemeLinks,
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
const TASK_TYPE = "theme_summary";
const TARGET_TABLE = "theme_summaries";

export async function runThemeSummaryProducer(): Promise<{
  themeId: string;
  themeName: string;
  companyCount: number;
  route: "openalice" | "fallback_local" | "skipped_existing_draft" | "skipped_pending_job";
  summaryId?: string;
  jobId?: string;
  skippedFor?: string;
}> {
  const db = getDb();
  if (!db) {
    throw new Error("[theme-summary] PERSISTENCE_MODE must be database");
  }

  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("[theme-summary] No workspace found");

  const allThemes = await db
    .select()
    .from(themes)
    .where(eq(themes.workspaceId, workspace.id))
    .orderBy(desc(themes.updatedAt))
    .limit(20);

  if (allThemes.length === 0) {
    throw new Error("[theme-summary] No themes in workspace");
  }

  const idx = new Date().getUTCHours() % allThemes.length;
  const theme = allThemes[idx]!;

  const route = await decideProducerRoute({
    workspaceId: workspace.id,
    targetTable: TARGET_TABLE,
    targetEntityId: theme.id,
    taskType: TASK_TYPE,
    producerVersion: PRODUCER_VERSION
  });

  if (route.kind === "skip_existing_draft") {
    return {
      themeId: theme.id,
      themeName: theme.name,
      companyCount: 0,
      route: "skipped_existing_draft",
      skippedFor: route.draftId
    };
  }

  if (route.kind === "skip_pending_job") {
    return {
      themeId: theme.id,
      themeName: theme.name,
      companyCount: 0,
      route: "skipped_pending_job",
      skippedFor: route.jobId
    };
  }

  const links = await db
    .select({ companyId: companyThemeLinks.companyId })
    .from(companyThemeLinks)
    .where(eq(companyThemeLinks.themeId, theme.id));

  const companyIds = links.map((l) => l.companyId);

  const linkedCompanies =
    companyIds.length > 0
      ? await db
          .select()
          .from(companies)
          .where(
            and(
              eq(companies.workspaceId, workspace.id)
            )
          )
          .then((rows) => rows.filter((r) => companyIds.includes(r.id)))
      : [];

  if (route.kind === "enqueue_openalice") {
    const job = await enqueueOpenAliceJobFromWorker({
      workspaceId: workspace.id,
      taskType: TASK_TYPE,
      schemaName: "theme_summary@v1",
      instructions: [
        `Produce a concise theme summary for: ${theme.name}.`,
        `Lifecycle=${theme.lifecycle}, MarketState=${theme.marketState}, Priority=${theme.priority}.`,
        `Thesis: ${theme.thesis.slice(0, 400)}`,
        `WhyNow: ${theme.whyNow.slice(0, 200)}`,
        `Include up to 10 linked companies with ticker and beneficiary tier.`,
        `Output JSON: {themeId, summary, companyCount}.`
      ].join("\n"),
      contextRefs: [
        { type: "theme", id: theme.id },
        ...linkedCompanies.slice(0, 10).map((c) => ({ type: "company", id: c.id }))
      ],
      parameters: {
        themeId: theme.id,
        themeName: theme.name,
        companyCount: linkedCompanies.length,
        targetTable: TARGET_TABLE,
        targetEntityId: theme.id,
        producerVersion: PRODUCER_VERSION
      }
    });

    return {
      themeId: theme.id,
      themeName: theme.name,
      companyCount: linkedCompanies.length,
      route: "openalice",
      jobId: job?.id
    };
  }

  // fallback_local — template write directly to theme_summaries
  const now = new Date().toISOString().split("T")[0];
  const companyLines = linkedCompanies
    .slice(0, 10)
    .map(
      (c) =>
        `- ${c.name} (${c.ticker}, ${c.market}) [${c.beneficiaryTier}]: ${c.notes.slice(0, 120) || "No notes."}`
    )
    .join("\n");

  const summary = [
    `Theme: ${theme.name}`,
    `Lifecycle: ${theme.lifecycle} | Market State: ${theme.marketState} | Priority: ${theme.priority}`,
    `Thesis: ${theme.thesis.slice(0, 300) || "(none)"}`,
    `Why Now: ${theme.whyNow.slice(0, 200) || "(none)"}`,
    ``,
    `Linked Companies (${linkedCompanies.length}):`,
    companyLines || "  (none)",
    ``,
    `Generated: ${now} (rule-template fallback)`
  ].join("\n");

  const [inserted] = await db
    .insert(themeSummaries)
    .values({
      workspaceId: workspace.id,
      themeId: theme.id,
      summary,
      companyCount: linkedCompanies.length
    })
    .returning();

  return {
    themeId: theme.id,
    themeName: theme.name,
    companyCount: linkedCompanies.length,
    route: "fallback_local",
    summaryId: inserted!.id
  };
}
