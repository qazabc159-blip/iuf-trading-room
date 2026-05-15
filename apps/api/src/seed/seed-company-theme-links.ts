/**
 * seed-company-theme-links.ts
 *
 * Backfill script: populate company_theme_links from wiki-text matching.
 *
 * Algorithm:
 *   For each theme (name used as wikilink token), call findCompaniesByWikilink()
 *   which scans the 1,735 tw-coverage markdown files and returns companies that
 *   mention [[theme.name]] in their body. Cross-reference returned tickers
 *   against the companies table (workspace-scoped) to resolve company UUIDs.
 *   UPSERT into company_theme_links (ON CONFLICT DO NOTHING — idempotent).
 *
 * Hard lines:
 *   - UPSERT only — never DELETE or TRUNCATE existing rows.
 *   - No schema migration — company_theme_links table must already exist.
 *   - Safe to run multiple times (idempotent).
 *   - Skips themes with no coverage matches gracefully.
 *
 * Usage (standalone, from apps/api):
 *   DATABASE_URL=... npx tsx src/seed/seed-company-theme-links.ts
 *
 * Or triggered via the admin endpoint:
 *   POST /api/v1/admin/themes/links-rebuild (Owner-only)
 */

import { getDb, isDatabaseMode, companies, themes, companyThemeLinks } from "@iuf-trading-room/db";
import { eq, and, not, like, inArray } from "drizzle-orm";
import { findCompaniesByWikilink } from "../data-sources/tw-coverage-loader.js";

export interface SeedThemeLinksResult {
  themesProcessed: number;
  themesWithMatches: number;
  linksInserted: number;
  linksSkipped: number;
  errors: string[];
}

/**
 * Core backfill logic — can be called from either the seed script or the
 * admin endpoint handler.
 *
 * @param workspaceId UUID of the workspace to seed for
 */
export async function seedCompanyThemeLinks(
  workspaceId: string
): Promise<SeedThemeLinksResult> {
  const result: SeedThemeLinksResult = {
    themesProcessed: 0,
    themesWithMatches: 0,
    linksInserted: 0,
    linksSkipped: 0,
    errors: []
  };

  if (!isDatabaseMode()) {
    result.errors.push("not_database_mode");
    return result;
  }

  const db = getDb();
  if (!db) {
    result.errors.push("db_unavailable");
    return result;
  }

  // ── Step 1: Load all themes for this workspace (excluding bracket-labeled ones) ──
  let themeRows: Array<{ id: string; name: string }>;
  try {
    themeRows = await db
      .select({ id: themes.id, name: themes.name })
      .from(themes)
      .where(
        and(
          eq(themes.workspaceId, workspaceId),
          not(like(themes.name, "[%"))
        )
      );
  } catch (err) {
    result.errors.push(`themes_load_failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  if (themeRows.length === 0) {
    return result;
  }

  // ── Step 2: Build ticker → company UUID lookup map for this workspace ──
  let companyRows: Array<{ id: string; ticker: string }>;
  try {
    companyRows = await db
      .select({ id: companies.id, ticker: companies.ticker })
      .from(companies)
      .where(eq(companies.workspaceId, workspaceId));
  } catch (err) {
    result.errors.push(`companies_load_failed: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const tickerToId = new Map<string, string>();
  for (const row of companyRows) {
    tickerToId.set(row.ticker, row.id);
  }

  // ── Step 3: For each theme, find matching companies via wiki-text and UPSERT ──
  for (const theme of themeRows) {
    result.themesProcessed++;

    let wikiResult: { token: string; matches: Array<{ ticker: string }> };
    try {
      wikiResult = await findCompaniesByWikilink(theme.name);
    } catch (err) {
      result.errors.push(`wiki_search_failed theme=${theme.name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    if (wikiResult.matches.length === 0) {
      continue;
    }

    // Resolve tickers to company UUIDs (workspace-scoped)
    const linkValues: Array<{ companyId: string; themeId: string }> = [];
    for (const match of wikiResult.matches) {
      const companyId = tickerToId.get(match.ticker);
      if (companyId) {
        linkValues.push({ companyId, themeId: theme.id });
      }
    }

    if (linkValues.length === 0) {
      // Matches found in coverage but no DB company records for those tickers
      continue;
    }

    result.themesWithMatches++;

    // UPSERT — ON CONFLICT DO NOTHING (PK = companyId + themeId)
    try {
      const insertResult = await db
        .insert(companyThemeLinks)
        .values(linkValues)
        .onConflictDoNothing()
        .returning();

      result.linksInserted += insertResult.length;
      result.linksSkipped += linkValues.length - insertResult.length;
    } catch (err) {
      result.errors.push(`upsert_failed theme=${theme.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

// ── Standalone script entry point ──────────────────────────────────────────────
// Only runs when invoked directly (not when imported as a module).
// Uses an async IIFE to avoid top-level await (not supported in esbuild CJS output).
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isMain) {
  (async () => {
    // Resolve workspaceId from DB (use the first workspace found — single-tenant setup)
    const { workspaces: wsTable, getDb: getDbDirect, isDatabaseMode: isDbMode } = await import("@iuf-trading-room/db");

    if (!isDbMode()) {
      console.error("DATABASE_URL not set — set it before running this script");
      process.exit(1);
    }

    const db = getDbDirect();
    if (!db) {
      console.error("Failed to get DB connection");
      process.exit(1);
    }

    const wsRows = await db.select({ id: wsTable.id }).from(wsTable).limit(1);
    if (wsRows.length === 0) {
      console.error("No workspaces found in DB");
      process.exit(1);
    }

    const workspaceId = wsRows[0].id;
    console.log(`[seed] Running for workspaceId=${workspaceId}`);

    const result = await seedCompanyThemeLinks(workspaceId);

    console.log("[seed] Done:", JSON.stringify(result, null, 2));

    if (result.errors.length > 0) {
      console.error("[seed] Errors encountered:", result.errors);
      process.exit(1);
    }

    process.exit(0);
  })().catch((err) => {
    console.error("[seed] Fatal:", err);
    process.exit(1);
  });
}
