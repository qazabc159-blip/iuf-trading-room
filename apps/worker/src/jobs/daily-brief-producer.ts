/**
 * daily-brief-producer.ts
 *
 * Generates a daily brief by aggregating:
 * - Most recent theme summaries from theme_summaries table
 * - Top themes by priority from themes table
 * - Recent company notes from company_notes table
 *
 * Writes result to daily_briefs table. Skips if today's brief already exists.
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

export async function runDailyBriefProducer(): Promise<{
  briefId: string;
  date: string;
  sectionCount: number;
  skipped: boolean;
}> {
  const db = getDb();
  if (!db) {
    throw new Error("[daily-brief] PERSISTENCE_MODE must be database");
  }

  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("[daily-brief] No workspace found");

  const today = new Date().toISOString().split("T")[0]!;

  // skip if today's brief already exists
  const [existing] = await db
    .select()
    .from(dailyBriefs)
    .where(and(eq(dailyBriefs.workspaceId, workspace.id), eq(dailyBriefs.date, today)))
    .limit(1);

  if (existing) {
    return { briefId: existing.id, date: today, sectionCount: existing.sections.length, skipped: true };
  }

  // gather data
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

  // derive market state from highest-priority theme
  const marketState = topThemes[0]?.marketState ?? "Balanced";

  // build sections
  const sections: Array<{ heading: string; body: string }> = [];

  // section 1: market overview
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

  // section 2: theme summaries
  if (recentSummaries.length > 0) {
    const lines = recentSummaries.map(
      (s) => `[${s.generatedAt.toISOString().slice(0, 16)}] ${s.summary.slice(0, 300)}`
    );
    sections.push({
      heading: "Theme Summaries",
      body: lines.join("\n\n---\n\n")
    });
  }

  // section 3: company notes
  if (recentNotes.length > 0) {
    const lines = recentNotes.map(
      (n) => `[${n.generatedAt.toISOString().slice(0, 16)}]\n${n.note.slice(0, 400)}`
    );
    sections.push({
      heading: "Company Notes",
      body: lines.join("\n\n---\n\n")
    });
  }

  // fallback if no data yet
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
    skipped: false
  };
}
