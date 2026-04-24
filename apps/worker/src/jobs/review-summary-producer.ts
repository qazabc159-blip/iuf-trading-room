/**
 * review-summary-producer.ts
 *
 * Picks one theme per run, generates a retrospective review summary covering:
 * - recent developments (narrative from linked companies / notes)
 * - lifecycle stage risks
 * - near-term watch-points
 *
 * Content generation: template-based using DB data. No Claude API calls.
 * Period: rotates week/month by hour-of-day parity.
 * Interval: 30 min (configurable via REVIEW_SUMMARY_INTERVAL_MS).
 */
import { and, desc, eq } from "drizzle-orm";

import {
  companies,
  companyThemeLinks,
  getDb,
  reviewSummaries,
  themes,
  workspaces
} from "@iuf-trading-room/db";

export async function runReviewSummaryProducer(): Promise<{
  themeId: string;
  themeName: string;
  period: string;
  summaryId: string;
}> {
  const db = getDb();
  if (!db) {
    throw new Error("[review-summary] PERSISTENCE_MODE must be database");
  }

  // get first workspace
  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("[review-summary] No workspace found");

  // pick the most recently updated themes
  const allThemes = await db
    .select()
    .from(themes)
    .where(eq(themes.workspaceId, workspace.id))
    .orderBy(desc(themes.updatedAt))
    .limit(20);

  if (allThemes.length === 0) {
    throw new Error("[review-summary] No themes in workspace");
  }

  // round-robin by (minute / 2) mod count so 30-min intervals hit different themes
  const idx = Math.floor(new Date().getUTCMinutes() / 2) % allThemes.length;
  const theme = allThemes[idx]!;

  // rotate period: even hours → week, odd hours → month
  const period: "week" | "month" = new Date().getUTCHours() % 2 === 0 ? "week" : "month";

  // get linked companies for narrative
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
          .where(and(eq(companies.workspaceId, workspace.id)))
          .then((rows) => rows.filter((r) => companyIds.includes(r.id)).slice(0, 8))
      : [];

  const now = new Date().toISOString().split("T")[0]!;

  // lifecycle-specific risk note
  const lifecycleRisk: Record<string, string> = {
    Discovery: "Theme is early-stage; signals may be sparse and narrative can shift quickly.",
    Validation: "Monitor validation catalysts; false positives are common at this stage.",
    Expansion: "Momentum may attract crowding; watch for positioning extremes.",
    Crowded: "Crowding risk is elevated; any catalyst reversal can trigger sharp unwinds.",
    Distribution: "Institutional distribution may already be underway; prefer asymmetric short setups."
  };

  const riskNote = lifecycleRisk[theme.lifecycle] ?? "Review lifecycle positioning before sizing.";

  // company snippets for narrative
  const companySnippets = linkedCompanies
    .map(
      (c) =>
        `- **${c.name}** (${c.ticker}, ${c.beneficiaryTier}): ${(c.notes || "No current notes.").slice(0, 150)}`
    )
    .join("\n");

  const bodyMd = [
    `## ${period === "week" ? "Weekly" : "Monthly"} Review — ${theme.name}`,
    ``,
    `**Period**: ${period} | **Generated**: ${now}`,
    `**Lifecycle**: ${theme.lifecycle} | **Market State**: ${theme.marketState} | **Priority**: ${theme.priority}`,
    ``,
    `### Thesis`,
    theme.thesis.slice(0, 400) || "_(no thesis recorded)_",
    ``,
    `### Why Now`,
    theme.whyNow.slice(0, 300) || "_(not specified)_",
    ``,
    `### Key Bottleneck`,
    theme.bottleneck.slice(0, 300) || "_(not specified)_",
    ``,
    `### Recent Developments (${linkedCompanies.length} linked companies)`,
    companySnippets || "_(no linked companies)_",
    ``,
    `### Risk Watch-Points`,
    riskNote,
    ``,
    `### Near-Term Monitoring`,
    `- Watch for ${theme.lifecycle === "Expansion" ? "momentum exhaustion signals" : "confirmation of lifecycle transition"}`,
    `- Re-evaluate theme priority if market state shifts away from ${theme.marketState}`,
    `- Core pool count: ${theme.corePoolCount} | Observation pool: ${theme.observationPoolCount}`
  ].join("\n");

  const [inserted] = await db
    .insert(reviewSummaries)
    .values({
      workspaceId: workspace.id,
      themeId: theme.id,
      bodyMd,
      period
    })
    .returning();

  return {
    themeId: theme.id,
    themeName: theme.name,
    period,
    summaryId: inserted!.id
  };
}
