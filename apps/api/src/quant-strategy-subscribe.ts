/**
 * quant-strategy-subscribe.ts
 *
 * Handles subscription logic for quant strategies.
 * v1: audit_logs append only — no new DB table (Phase 2 task).
 *
 * Constraints (hard-locked):
 *   - sim_only always forced true server-side
 *   - capital_twd: 50_000 – 1_000_000 NTD
 *   - strategy id must be in VALID_QUANT_STRATEGY_IDS
 *   - executionMode must be "paper" (PAPER_MODE_REQUIRED gate)
 *   - Owner-only
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { auditLogs, getDb, isDatabaseMode } from "@iuf-trading-room/db";
import type { AppSession } from "@iuf-trading-room/contracts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_QUANT_STRATEGY_IDS = new Set([
  "cont_liq_v36",
  "strategy_002",
  "strategy_003",
]);

export const CAPITAL_MIN_TWD = 50_000;
export const CAPITAL_MAX_TWD = 1_000_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubscribeResult =
  | { ok: true; subscription_id: string; status: "active" }
  | { ok: false; error: string; http_status: 400 | 403 | 404 };

export type SubscriptionRecord = {
  subscription_id: string;
  strategy_id: string;
  capital_twd: number;
  sim_only: true;
  created_at: string;
  audit_log_id: string;
};

// ---------------------------------------------------------------------------
// Core subscribe
// ---------------------------------------------------------------------------

/**
 * Subscribe a user to a quant strategy.
 * Validates capital range, strategy id, and paper-mode gate.
 * Appends to audit_logs (action="quant_strategy.subscribe").
 * Returns subscription_id on success.
 */
export async function subscribeQuantStrategy(input: {
  session: AppSession;
  strategyId: string;
  capitalTwd: number;
  executionMode: string;
}): Promise<SubscribeResult> {
  const { session, strategyId, capitalTwd, executionMode } = input;

  // Gate 1: paper mode required
  if (executionMode !== "paper") {
    return { ok: false, error: "PAPER_MODE_REQUIRED", http_status: 403 };
  }

  // Gate 2: valid strategy id
  if (!VALID_QUANT_STRATEGY_IDS.has(strategyId)) {
    return { ok: false, error: "STRATEGY_NOT_FOUND", http_status: 404 };
  }

  // Gate 3: capital range
  if (capitalTwd < CAPITAL_MIN_TWD) {
    return { ok: false, error: "CAPITAL_BELOW_MIN", http_status: 400 };
  }
  if (capitalTwd > CAPITAL_MAX_TWD) {
    return { ok: false, error: "CAPITAL_EXCEEDED_CAP", http_status: 400 };
  }

  const subscriptionId = randomUUID();

  // Persist to audit_logs — fire-and-forget pattern; caller handles non-DB gracefully
  await appendSubscribeAuditLog({
    workspaceId: session.workspace.id,
    actorId: session.user.id,
    strategyId,
    capitalTwd,
    subscriptionId,
  });

  return { ok: true, subscription_id: subscriptionId, status: "active" };
}

// ---------------------------------------------------------------------------
// Audit log append
// ---------------------------------------------------------------------------

async function appendSubscribeAuditLog(params: {
  workspaceId: string;
  actorId: string | null;
  strategyId: string;
  capitalTwd: number;
  subscriptionId: string;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLogs).values({
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      action: "quant_strategy.subscribe",
      entityType: "quant_strategy",
      entityId: params.strategyId,
      payload: {
        strategy_id: params.strategyId,
        user_id: params.actorId,
        capital_twd: params.capitalTwd,
        sim_only: true,
        subscription_id: params.subscriptionId,
      },
    });
  } catch (err) {
    console.warn(
      "[quant-strategy-subscribe] audit log write failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ---------------------------------------------------------------------------
// List my subscriptions
// ---------------------------------------------------------------------------

/**
 * Query audit_logs for quant_strategy.subscribe entries for the current user.
 * Returns a list of subscription records, newest first.
 */
export async function listMyQuantSubscriptions(input: {
  session: AppSession;
  limit?: number;
}): Promise<SubscriptionRecord[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.workspaceId, input.session.workspace.id),
          eq(auditLogs.actorId, input.session.user.id),
          eq(auditLogs.action, "quant_strategy.subscribe")
        )
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(input.limit ?? 100);

    return rows.map((row) => {
      const payload =
        row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {};

      return {
        subscription_id:
          typeof payload["subscription_id"] === "string"
            ? payload["subscription_id"]
            : row.id,
        strategy_id:
          typeof payload["strategy_id"] === "string"
            ? payload["strategy_id"]
            : row.entityId,
        capital_twd:
          typeof payload["capital_twd"] === "number"
            ? payload["capital_twd"]
            : 0,
        sim_only: true as const,
        created_at: row.createdAt.toISOString(),
        audit_log_id: row.id,
      };
    });
  } catch (err) {
    console.warn(
      "[quant-strategy-subscribe] listMyQuantSubscriptions failed:",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}
