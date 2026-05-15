/**
 * admin-themes-links-rebuild.ts
 *
 * Handler logic for:
 *   POST /api/v1/admin/themes/links-rebuild
 *
 * Owner-only admin endpoint to trigger a rebuild of company_theme_links
 * from wiki-text matching. Used to fix or refresh the table without a
 * DB migration or manual SQL.
 *
 * Design:
 *   - Delegates to seedCompanyThemeLinks() — same idempotent UPSERT logic
 *     as the standalone seed script.
 *   - Writes an audit_log entry for the action.
 *   - Returns a JSON result summary so the operator can verify.
 */

import type { Context } from "hono";
import { getDb, isDatabaseMode, auditLogs } from "@iuf-trading-room/db";
import type { AppSession } from "@iuf-trading-room/contracts";
import { seedCompanyThemeLinks } from "./seed/seed-company-theme-links.js";

export interface RebuildLinksResponse {
  ok: boolean;
  themesProcessed: number;
  themesWithMatches: number;
  linksInserted: number;
  linksSkipped: number;
  errors: string[];
}

/**
 * Triggered by POST /api/v1/admin/themes/links-rebuild
 * Auth must be checked by the caller (Owner-only).
 */
export async function handleAdminThemesLinksRebuild(
  c: Context
): Promise<Response> {
  const session = c.get("session") as AppSession | undefined;
  if (!session || session.user.role !== "Owner") {
    return c.json({ error: "OWNER_ONLY" }, 403);
  }

  const workspaceId = session.workspace.id;

  // Run the backfill
  const result = await seedCompanyThemeLinks(workspaceId);

  // Write audit log
  if (isDatabaseMode()) {
    const db = getDb();
    if (db) {
      await db
        .insert(auditLogs)
        .values({
          workspaceId,
          actorId: session.user.id,
          action: "admin.themes.links_rebuild",
          entityType: "theme",
          entityId: workspaceId,
          payload: {
            themesProcessed: result.themesProcessed,
            themesWithMatches: result.themesWithMatches,
            linksInserted: result.linksInserted,
            linksSkipped: result.linksSkipped,
            errorCount: result.errors.length,
            triggeredAt: new Date().toISOString()
          }
        })
        .catch((err: unknown) => {
          console.error("[admin-themes-links-rebuild] audit log write failed:", err);
        });
    }
  }

  const response: RebuildLinksResponse = {
    ok: result.errors.length === 0,
    ...result
  };

  const status = result.errors.length > 0 ? 207 : 200;
  return c.json({ data: response }, status as 200 | 207);
}
