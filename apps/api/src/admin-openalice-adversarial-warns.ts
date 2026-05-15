/**
 * admin-openalice-adversarial-warns.ts
 *
 * GET /api/v1/admin/openalice/adversarial-warns
 *
 * Owner-only. Returns recent adversarial reviewer warn events
 * (severityScore >= 7) from audit_logs so operators can inspect
 * without grepping Railway logs.
 *
 * Query params:
 *   from  — ISO date string, inclusive lower bound on createdAt (default: 7 days ago)
 *   to    — ISO date string, inclusive upper bound on createdAt (default: now)
 *   limit — max rows to return (default 50, max 200)
 *
 * Response: { warns: AdversarialWarnEntry[]; total: number }
 *
 * Note: Only reads from audit_logs — no DB writes, no side effects.
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { auditLogs, getDb, isDatabaseMode } from "@iuf-trading-room/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdversarialWarnEntry = {
  audit_log_id: string;
  draft_id: string;
  workspace_id: string;
  severity_score: number;
  adversarial_flags: string[];
  reasoning: string;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Core query
// ---------------------------------------------------------------------------

export async function listAdversarialWarnEvents(input: {
  workspaceId: string;
  from: Date;
  to: Date;
  limit: number;
}): Promise<AdversarialWarnEntry[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.workspaceId, input.workspaceId),
          eq(auditLogs.action, "content_draft.adversarial_audit"),
          gte(auditLogs.createdAt, input.from),
          lte(auditLogs.createdAt, input.to)
        )
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(input.limit);

    // Filter server-side: only rows where severityScore >= 7
    const warns: AdversarialWarnEntry[] = [];
    for (const row of rows) {
      const payload =
        row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {};

      const severityScore =
        typeof payload["severityScore"] === "number" ? payload["severityScore"] : 0;

      if (severityScore < 7) continue;

      const adversarialFlags = Array.isArray(payload["adversarialFlags"])
        ? (payload["adversarialFlags"] as unknown[])
            .filter((f): f is string => typeof f === "string")
        : [];

      const reasoning =
        typeof payload["reasoning"] === "string"
          ? payload["reasoning"].slice(0, 500)
          : "";

      warns.push({
        audit_log_id: row.id,
        draft_id: row.entityId ?? "",
        workspace_id: row.workspaceId,
        severity_score: severityScore,
        adversarial_flags: adversarialFlags,
        reasoning,
        created_at: row.createdAt.toISOString(),
      });
    }

    return warns;
  } catch (err) {
    console.warn(
      "[admin-adversarial-warns] query failed:",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}
