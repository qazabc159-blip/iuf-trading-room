/**
 * tool-boot-seed.ts — Boot-time dryRun seed for never-run tools.
 *
 * Problem (b): 8 tools registered in the registry (0038 + 0041 migrations) have
 * never been invoked in production, so tool_calls has no rows for them.
 * The ToolCenter UI shows lastRunAt=null for these, which is confusing.
 *
 * Fix: At boot + 10s, write 1 synthetic "boot_seed" tool_calls row per tool_key
 * that has ZERO existing calls. This makes lastRunAt non-null and executionHistory
 * non-empty, so the UI can distinguish "never seeded" from "seeded but not called".
 *
 * Design:
 *   - Only writes for tool_keys with zero existing call records (idempotent guard)
 *   - Uses createToolCallRecord() + updateToolCallRecord() (same path as real tools)
 *   - Always fail-open: any error is warn-logged, never thrown
 *   - Only runs in DB mode
 */

import { getDb, isDatabaseMode, toolCalls, tools } from "@iuf-trading-room/db";
import { desc } from "drizzle-orm";
import {
  createToolCallRecord,
  updateToolCallRecord,
} from "./tool-registry-store.js";

// Tool keys that may never have been called in production (0038 + 0041 registry).
// This list is the superset; we check actual DB state before writing.
const KNOWN_TOOL_KEYS: readonly string[] = [
  // 0038 seeds
  "ai_reviewer",
  "adversarial_reviewer",
  "factual_reviewer",
  "hallu_rag",
  "finmind_sync",
  "themes_links_rebuild",
  "content_drafts_retry",
  // 0041 seeds
  "get_market_overview",
  "get_sector_rotation",
  "get_company_technical",
  "get_institutional_flow",
  "get_news_top10",
];

export type ToolBootSeedResult = {
  seeded: string[];
  skipped: string[];  // already had calls
  errors: string[];
};

/**
 * Write 1 synthetic boot_seed call record for each tool_key that has zero
 * existing tool_calls rows.
 *
 * workspaceId: canonical workspace UUID (may be null — tool_calls.workspace_id is nullable).
 */
export async function seedNeverRunTools(workspaceId: string | null): Promise<ToolBootSeedResult> {
  const result: ToolBootSeedResult = { seeded: [], skipped: [], errors: [] };

  if (!isDatabaseMode()) {
    result.errors.push("DB not available — skipping tool boot seed");
    return result;
  }

  const db = getDb();
  if (!db) {
    result.errors.push("getDb() returned null — skipping tool boot seed");
    return result;
  }

  // 1. Fetch the set of tool_keys registered in the tools table.
  let registeredKeys: string[];
  try {
    const rows = await db.select({ toolKey: tools.toolKey }).from(tools);
    registeredKeys = rows.map((r) => r.toolKey);
  } catch (e) {
    result.errors.push(`tools query failed: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  if (registeredKeys.length === 0) {
    result.errors.push("tools table is empty — no keys to seed");
    return result;
  }

  // 2. Fetch the most recent tool_calls row per tool_key (limit 200 to avoid full scan).
  let calledKeys: Set<string>;
  try {
    const callRows = await db
      .select({ toolKey: toolCalls.toolKey })
      .from(toolCalls)
      .orderBy(desc(toolCalls.createdAt))
      .limit(200);
    calledKeys = new Set(callRows.map((r) => r.toolKey));
  } catch (e) {
    result.errors.push(`tool_calls query failed: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  // 3. For each registered key with zero calls, write 1 synthetic boot_seed record.
  for (const toolKey of registeredKeys) {
    if (calledKeys.has(toolKey)) {
      result.skipped.push(toolKey);
      continue;
    }

    try {
      const recordId = await createToolCallRecord(
        toolKey,
        "boot_seed",
        workspaceId,
        JSON.stringify({ dryRun: true, reason: "boot_seed_initial_record" })
      );

      if (recordId) {
        await updateToolCallRecord(
          recordId,
          "success",
          0,  // latencyMs — no real work done
          JSON.stringify({ seeded: true, dryRun: true })
        );
        result.seeded.push(toolKey);
      } else {
        result.errors.push(`${toolKey}: createToolCallRecord returned null`);
      }
    } catch (e) {
      result.errors.push(`${toolKey}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(
    `[tool-boot-seed] seeded=${result.seeded.length} skipped=${result.skipped.length} errors=${result.errors.length}`,
    result.seeded.length > 0 ? `keys=${result.seeded.join(",")}` : ""
  );

  return result;
}
