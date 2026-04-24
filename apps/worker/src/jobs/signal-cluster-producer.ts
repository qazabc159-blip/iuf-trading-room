/**
 * signal-cluster-producer.ts  — DRAFT
 *
 * Rule-based signal clustering.
 * Groups companies and themes sharing recent worker-produced signals into
 * named clusters without any ML.
 *
 * Clustering rules (in priority order):
 *   1. Same theme linkage  → cluster labelled by theme name
 *   2. Same market + similar beneficiaryTier → "market-tier" cluster
 *   3. Residual (unclustered) companies → "cross-theme" cluster
 *
 * Content generation: rule-based from DB data. No Claude API calls.
 * Interval: 20 min (configurable via SIGNAL_CLUSTER_INTERVAL_MS).
 */
import { desc, eq } from "drizzle-orm";

import {
  companies,
  companyThemeLinks,
  getDb,
  signalClusters,
  themes,
  workspaces
} from "@iuf-trading-room/db";

type ClusterCandidate = {
  companyId: string;
  ticker: string;
  market: string;
  beneficiaryTier: string;
  themeIds: string[];
  themeNames: string[];
};

export async function runSignalClusterProducer(): Promise<{
  clustersWritten: number;
  clusterIds: string[];
}> {
  const db = getDb();
  if (!db) {
    throw new Error("[signal-cluster] PERSISTENCE_MODE must be database");
  }

  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("[signal-cluster] No workspace found");

  // load recent companies (limit 80 for manageable clustering)
  const allCompanies = await db
    .select()
    .from(companies)
    .where(eq(companies.workspaceId, workspace.id))
    .orderBy(desc(companies.updatedAt))
    .limit(80);

  if (allCompanies.length === 0) {
    return { clustersWritten: 0, clusterIds: [] };
  }

  // load all theme links for these companies
  const companyIdList = allCompanies.map((c) => c.id);

  const allLinks = await db
    .select({ companyId: companyThemeLinks.companyId, themeId: companyThemeLinks.themeId })
    .from(companyThemeLinks)
    .then((rows) => rows.filter((r) => companyIdList.includes(r.companyId)));

  // load theme names
  const allThemes = await db
    .select({ id: themes.id, name: themes.name })
    .from(themes)
    .where(eq(themes.workspaceId, workspace.id));

  const themeNameById = new Map(allThemes.map((t) => [t.id, t.name]));

  // build candidate objects
  const candidateMap = new Map<string, ClusterCandidate>();
  for (const c of allCompanies) {
    candidateMap.set(c.id, {
      companyId: c.id,
      ticker: c.ticker,
      market: c.market,
      beneficiaryTier: c.beneficiaryTier,
      themeIds: [],
      themeNames: []
    });
  }
  for (const link of allLinks) {
    const cand = candidateMap.get(link.companyId);
    if (cand) {
      cand.themeIds.push(link.themeId);
      const name = themeNameById.get(link.themeId);
      if (name) cand.themeNames.push(name);
    }
  }

  const candidates = [...candidateMap.values()];
  const now = new Date().toISOString().split("T")[0]!;

  // ── Rule 1: cluster by primary theme ─────────────────────────────────────
  const themeClusterMap = new Map<string, { themeName: string; tickers: string[] }>();
  const assignedCompanyIds = new Set<string>();

  for (const cand of candidates) {
    if (cand.themeIds.length === 0) continue;
    // pick the first theme as primary
    const primaryThemeId = cand.themeIds[0]!;
    const primaryThemeName = cand.themeNames[0] ?? primaryThemeId;
    const entry = themeClusterMap.get(primaryThemeId) ?? {
      themeName: primaryThemeName,
      tickers: []
    };
    entry.tickers.push(cand.ticker);
    themeClusterMap.set(primaryThemeId, entry);
    assignedCompanyIds.add(cand.companyId);
  }

  // ── Rule 2: cluster unassigned companies by market+tier ──────────────────
  const unassigned = candidates.filter((c) => !assignedCompanyIds.has(c.companyId));
  const marketTierMap = new Map<string, string[]>();
  for (const cand of unassigned) {
    const key = `${cand.market}:${cand.beneficiaryTier}`;
    const list = marketTierMap.get(key) ?? [];
    list.push(cand.ticker);
    marketTierMap.set(key, list);
    assignedCompanyIds.add(cand.companyId);
  }

  // build cluster rows
  const clusterRows: Array<{
    workspaceId: string;
    label: string;
    memberTickers: string[];
    memberThemes: string[];
    rationale_md: string;
  }> = [];

  // theme clusters
  for (const [themeId, { themeName, tickers }] of themeClusterMap) {
    if (tickers.length === 0) continue;
    clusterRows.push({
      workspaceId: workspace.id,
      label: `Theme: ${themeName}`,
      memberTickers: tickers.slice(0, 30),
      memberThemes: [themeId],
      rationale_md: [
        `## Signal Cluster — ${themeName}`,
        ``,
        `**Type**: theme-based grouping | **Generated**: ${now}`,
        ``,
        `All members share a direct theme link to **${themeName}**.`,
        ``,
        `**Members (${tickers.length})**: ${tickers.slice(0, 20).join(", ")}${tickers.length > 20 ? ` … +${tickers.length - 20} more` : ""}`,
        ``,
        `**Signal rationale**: Companies in the same theme tend to respond similarly to theme-level catalysts.`,
        `Consider monitoring for correlated price moves or divergences that may signal rotation within the theme.`
      ].join("\n")
    });
  }

  // market-tier clusters (only if ≥2 members)
  for (const [key, tickers] of marketTierMap) {
    if (tickers.length < 2) continue;
    const [market, tier] = key.split(":") as [string, string];
    clusterRows.push({
      workspaceId: workspace.id,
      label: `Market-Tier: ${market} ${tier}`,
      memberTickers: tickers.slice(0, 30),
      memberThemes: [],
      rationale_md: [
        `## Signal Cluster — ${market} ${tier}`,
        ``,
        `**Type**: market-tier grouping | **Generated**: ${now}`,
        ``,
        `Members share market **${market}** and beneficiary tier **${tier}** but have no common theme link.`,
        ``,
        `**Members (${tickers.length})**: ${tickers.slice(0, 20).join(", ")}${tickers.length > 20 ? ` … +${tickers.length - 20} more` : ""}`,
        ``,
        `**Signal rationale**: Same market + tier companies may respond similarly to macro or sector-level events`,
        `even without a shared thematic narrative.`
      ].join("\n")
    });
  }

  if (clusterRows.length === 0) {
    return { clustersWritten: 0, clusterIds: [] };
  }

  const inserted = await db
    .insert(signalClusters)
    .values(clusterRows)
    .returning({ id: signalClusters.id });

  return {
    clustersWritten: inserted.length,
    clusterIds: inserted.map((r) => r.id)
  };
}
