/**
 * themes-links-rebuild-tool.ts
 *
 * ToolCenter Phase B — themes_links_rebuild tool wrap.
 * Wraps handleAdminThemesLinksRebuild so each invocation gets a tool_calls audit record.
 *
 * Unlike adversarial/factual reviewers, this tool does NOT take a full Hono Context —
 * it calls seedCompanyThemeLinks() directly (the underlying logic, same as the handler).
 *
 * callerType: "admin_action" | "llm"
 */

import { callTool } from "./tool-registry-store.js";

export interface ThemesLinksRebuildOutput {
  ok: boolean;
  themesProcessed: number;
  themesWithMatches: number;
  linksInserted: number;
  linksSkipped: number;
  errors: string[];
}

/**
 * triggerThemesLinksRebuildTracked — callTool-wrapped themes/links rebuild.
 * Calls seedCompanyThemeLinks() directly (same logic as admin endpoint, sans HTTP layer).
 */
export async function triggerThemesLinksRebuildTracked(
  workspaceId: string,
  callerType: string = "admin_action"
): Promise<ThemesLinksRebuildOutput> {
  return callTool(
    "themes_links_rebuild",
    callerType,
    workspaceId,
    { workspaceId },
    async (input: { workspaceId: string }): Promise<ThemesLinksRebuildOutput> => {
      const { seedCompanyThemeLinks } = await import(
        "../seed/seed-company-theme-links.js"
      );
      const result = await seedCompanyThemeLinks(input.workspaceId);
      return {
        ok: result.errors.length === 0,
        themesProcessed: result.themesProcessed,
        themesWithMatches: result.themesWithMatches,
        linksInserted: result.linksInserted,
        linksSkipped: result.linksSkipped,
        errors: result.errors
      };
    }
  );
}
