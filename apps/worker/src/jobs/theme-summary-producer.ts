/**
 * theme-summary-producer.ts
 *
 * Picks one theme per run, aggregates linked companies + their notes,
 * produces a text summary, and writes it to theme_summaries.
 *
 * Content generation: template-based using DB data.
 * If ANTHROPIC_API_KEY is set in env, falls back to template anyway for now
 * (Claude integration can be wired later when the key is available in worker).
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

export async function runThemeSummaryProducer(): Promise<{
  themeId: string;
  themeName: string;
  companyCount: number;
  summaryId: string;
}> {
  const db = getDb();
  if (!db) {
    throw new Error("[theme-summary] PERSISTENCE_MODE must be database");
  }

  // get first workspace
  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("[theme-summary] No workspace found");

  // pick the most recently updated theme that hasn't been summarised recently
  const allThemes = await db
    .select()
    .from(themes)
    .where(eq(themes.workspaceId, workspace.id))
    .orderBy(desc(themes.updatedAt))
    .limit(20);

  if (allThemes.length === 0) {
    throw new Error("[theme-summary] No themes in workspace");
  }

  // pick a theme round-robin by hour-of-day mod count
  const idx = new Date().getUTCHours() % allThemes.length;
  const theme = allThemes[idx]!;

  // get linked companies
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

  // template-based summary
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
    `Generated: ${now}`
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
    summaryId: inserted!.id
  };
}
