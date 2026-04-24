/**
 * company-note-producer.ts (P0-C routing)
 *
 * Picks one company per run, then decides how to produce the note:
 *   1. OpenAlice-first — if an active Windows runner is present, enqueue a
 *      company_note job. The runner submits a draft_ready result which the
 *      API mirrors into content_drafts (awaiting_review).
 *   2. Fallback — otherwise (no active device) the producer writes a
 *      rule-template note directly into company_notes.
 *
 * De-dupe: `${workspaceId}:company_notes:${companyId}:v1` within 24 h.
 */
import { desc, eq } from "drizzle-orm";

import {
  companies,
  companyKeywords,
  companyNotes,
  companyRelations,
  companyThemeLinks,
  getDb,
  themes,
  workspaces
} from "@iuf-trading-room/db";

import {
  decideProducerRoute,
  enqueueOpenAliceJobFromWorker
} from "../openalice-router.js";

const PRODUCER_VERSION = "v1";
const TASK_TYPE = "company_note";
const TARGET_TABLE = "company_notes";

export async function runCompanyNoteProducer(): Promise<{
  companyId: string;
  companyName: string;
  route: "openalice" | "fallback_local" | "skipped_existing_draft" | "skipped_pending_job";
  noteId?: string;
  jobId?: string;
  skippedFor?: string;
}> {
  const db = getDb();
  if (!db) {
    throw new Error("[company-note] PERSISTENCE_MODE must be database");
  }

  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("[company-note] No workspace found");

  const allCompanies = await db
    .select()
    .from(companies)
    .where(eq(companies.workspaceId, workspace.id))
    .orderBy(desc(companies.updatedAt))
    .limit(60);

  if (allCompanies.length === 0) {
    throw new Error("[company-note] No companies in workspace");
  }

  const idx = new Date().getUTCMinutes() % allCompanies.length;
  const company = allCompanies[idx]!;

  const route = await decideProducerRoute({
    workspaceId: workspace.id,
    targetTable: TARGET_TABLE,
    targetEntityId: company.id,
    taskType: TASK_TYPE,
    producerVersion: PRODUCER_VERSION
  });

  if (route.kind === "skip_existing_draft") {
    return {
      companyId: company.id,
      companyName: company.name,
      route: "skipped_existing_draft",
      skippedFor: route.draftId
    };
  }

  if (route.kind === "skip_pending_job") {
    return {
      companyId: company.id,
      companyName: company.name,
      route: "skipped_pending_job",
      skippedFor: route.jobId
    };
  }

  const links = await db
    .select({ themeId: companyThemeLinks.themeId })
    .from(companyThemeLinks)
    .where(eq(companyThemeLinks.companyId, company.id));

  const themeIds = links.map((l) => l.themeId);
  const themeRows =
    themeIds.length > 0
      ? await db
          .select({ id: themes.id, name: themes.name, lifecycle: themes.lifecycle })
          .from(themes)
          .then((rows) => rows.filter((r) => themeIds.includes(r.id)).slice(0, 5))
      : [];

  const relations = await db
    .select()
    .from(companyRelations)
    .where(eq(companyRelations.companyId, company.id))
    .limit(10);

  const keywords = await db
    .select()
    .from(companyKeywords)
    .where(eq(companyKeywords.companyId, company.id))
    .orderBy(desc(companyKeywords.confidence))
    .limit(10);

  if (route.kind === "enqueue_openalice") {
    const job = await enqueueOpenAliceJobFromWorker({
      workspaceId: workspace.id,
      taskType: TASK_TYPE,
      schemaName: "company_note@v1",
      instructions: [
        `Produce a concise note for company: ${company.name} (${company.ticker}, ${company.market}).`,
        `Tier=${company.beneficiaryTier}, Country=${company.country}, ChainPosition=${company.chainPosition}.`,
        `Linked themes: ${themeRows.map((t) => t.name).join(", ") || "(none)"}`,
        `Keywords: ${keywords.map((k) => k.label).slice(0, 10).join(", ") || "(none)"}`,
        `Relations: ${relations.length} entries.`,
        `Output JSON: {companyId, note}.`
      ].join("\n"),
      contextRefs: [
        { type: "company", id: company.id },
        ...themeRows.map((t) => ({ type: "theme", id: t.id }))
      ],
      parameters: {
        companyId: company.id,
        companyName: company.name,
        ticker: company.ticker,
        targetTable: TARGET_TABLE,
        targetEntityId: company.id,
        producerVersion: PRODUCER_VERSION
      }
    });

    return {
      companyId: company.id,
      companyName: company.name,
      route: "openalice",
      jobId: job?.id
    };
  }

  // fallback_local — template write directly to company_notes
  const now = new Date().toISOString().split("T")[0];
  const relationLines = relations
    .map((r) => `  [${r.relationType}] → ${r.targetLabel} (confidence: ${r.confidence.toFixed(2)})`)
    .join("\n");
  const keywordLine = keywords.map((k) => `${k.label}(${k.confidence.toFixed(2)})`).join(", ");

  const note = [
    `Company Note: ${company.name} (${company.ticker}) — ${company.market}`,
    `Tier: ${company.beneficiaryTier} | Country: ${company.country}`,
    `Chain Position: ${company.chainPosition}`,
    ``,
    `Keywords: ${keywordLine || "(none)"}`,
    ``,
    `Relations (${relations.length}):`,
    relationLines || "  (none)",
    ``,
    `Existing Notes: ${company.notes.slice(0, 400) || "(none)"}`,
    ``,
    `Generated: ${now} (rule-template fallback)`
  ].join("\n");

  const [inserted] = await db
    .insert(companyNotes)
    .values({
      workspaceId: workspace.id,
      companyId: company.id,
      note
    })
    .returning();

  return {
    companyId: company.id,
    companyName: company.name,
    route: "fallback_local",
    noteId: inserted!.id
  };
}
