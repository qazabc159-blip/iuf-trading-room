/**
 * company-note-producer.ts
 *
 * Picks one company per run, aggregates its theme links + relations + keywords,
 * produces a structured note, and writes it to company_notes.
 *
 * Content: template-based from DB data.
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

export async function runCompanyNoteProducer(): Promise<{
  companyId: string;
  companyName: string;
  noteId: string;
}> {
  const db = getDb();
  if (!db) {
    throw new Error("[company-note] PERSISTENCE_MODE must be database");
  }

  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("[company-note] No workspace found");

  // pick a company round-robin by minute-of-hour mod count
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

  // get theme links
  const links = await db
    .select({ themeId: companyThemeLinks.themeId })
    .from(companyThemeLinks)
    .where(eq(companyThemeLinks.companyId, company.id));

  const linkedThemes =
    links.length > 0
      ? await db
          .select({ name: themes.name, lifecycle: themes.lifecycle })
          .from(themes)
          .then((rows) => rows.filter((r) => links.map((l) => l.themeId).includes(r.name ? r.name : "")))
      : [];

  const themeIds = links.map((l) => l.themeId);
  const themeRows = themeIds.length > 0
    ? await db
        .select({ name: themes.name, lifecycle: themes.lifecycle, marketState: themes.marketState })
        .from(themes)
        .then((rows) => rows.filter((r) => themeIds.some(() => true)).slice(0, 5))
    : [];

  // get relations
  const relations = await db
    .select()
    .from(companyRelations)
    .where(eq(companyRelations.companyId, company.id))
    .limit(10);

  // get keywords
  const keywords = await db
    .select()
    .from(companyKeywords)
    .where(eq(companyKeywords.companyId, company.id))
    .orderBy(desc(companyKeywords.confidence))
    .limit(10);

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
    `Generated: ${now}`
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
    noteId: inserted!.id
  };
}
