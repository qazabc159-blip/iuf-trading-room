/**
 * quant-strategy-subscribe.ts
 *
 * Handles subscription logic for quant strategies.
 * v1: audit_logs append only — no new DB table (Phase 2 task).
 *
 * Constraints (hard-locked):
 *   - sim_only always forced true server-side
 *   - capital_twd: 50_000 - 10_000_000 NTD
 *   - strategy id must be in VALID_QUANT_STRATEGY_IDS
 *   - executionMode must be "paper" (PAPER_MODE_REQUIRED gate)
 *   - Owner-only
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { auditLogs, getDb, isDatabaseMode } from "@iuf-trading-room/db";
import type { AppSession } from "@iuf-trading-room/contracts";
import { appendEvent } from "./events/event-log-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Canonical subscribe-endpoint strategy IDs.
 * Must match ALLOWED_STRATEGY_IDS in lab-strategy-snapshot-fetcher.ts.
 */
export const VALID_QUANT_STRATEGY_IDS = new Set([
  "cont_liq_v36",
  "strategy_002",
  "strategy_003",
]);

/**
 * Retired strategy IDs.
 *
 * These IDs are no longer valid subscribe targets. If a caller POSTs with any
 * of these IDs (directly or via an alias that resolves to a retired token),
 * the handler returns 410 Gone with a STRATEGY_RETIRED error body.
 *
 * Retired strategies:
 *   - rs_20_60_low_drawdown__h20__top5
 *       rs_20_60 family RETIRED 2026-05-09 per Athena morning update.
 *       Previously aliased to strategy_003 (Family C × SBL overlay) but that
 *       mapping conflated two distinct strategies in the audit log with no
 *       differentiation (Athena minor caveat A). Retired IDs now return 410 so
 *       callers are informed the strategy is gone, not silently rerouted.
 */
export const STRATEGY_RETIRED_IDS = new Set([
  "rs_20_60_low_drawdown__h20__top5",
]);

/**
 * Alias map: display-name / lab candidate_id → canonical subscribe ID.
 *
 * UI surfaces (/lab/strategies, /lab/three-strategy) surface Lab candidate_id
 * values which are long-form strings (e.g. "MAIN_execution_rank_buffer_top20").
 * If any UI passes these directly to POST .../subscribe, it would get a
 * STRATEGY_NOT_FOUND 404.  This map resolves them to the canonical short ID
 * before validation, so the endpoint is tolerant of both forms.
 *
 * Mapping rationale (2026-05-15, Jason):
 *   - MAIN_execution_rank_buffer_top20 → strategy_002
 *       Lab uses "MAIN" label for the execution-rank-buffer strategy.
 *       strategy_002 is the canonical subscribe-side ID per ALLOWED_STRATEGY_IDS.
 *   - strategy_002_revenue_yoy_surprise → strategy_002
 *       Long-form detail page key from /lab/three-strategy/[strategyId]/page.tsx.
 *   - cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25 → cont_liq_v36
 *       Lab full strategy name used in /lab/three-strategy snapshot responses.
 *   - cont_liq_h20_top3_market_trail20_gt_5pct → cont_liq_v36
 *       Old legacy ID — redirects to cont_liq_v36 per TR page note.
 *   - strategy_003_ma200_trend_follow → strategy_003
 *       Long-form detail page key from /lab/three-strategy/[strategyId]/page.tsx.
 *   - family_c_sbl_overlay → strategy_003
 *       Frontend strategy-data.ts id for Family C / SBL overlay card.
 *   - class5_revenue_momentum → strategy_002
 *       Frontend strategy-data.ts id for Class 5 revenue momentum card.
 *
 * NOTE: rs_20_60_low_drawdown__h20__top5 was previously aliased to strategy_003.
 * That mapping has been removed (2026-05-15): rs_20_60 is RETIRED and now lives
 * in STRATEGY_RETIRED_IDS — callers get 410 Gone, not a silent reroute that
 * pollutes strategy_003 audit logs with a different strategy's subscriptions.
 */
export const STRATEGY_ID_ALIASES: Readonly<Record<string, string>> = {
  // Lab candidate_id long-form → canonical
  "MAIN_execution_rank_buffer_top20": "strategy_002",
  "strategy_002_revenue_yoy_surprise": "strategy_002",
  "cont_liquidity_relative_strength__h20__top5__turnover_cap_0.25": "cont_liq_v36",
  "cont_liq_h20_top3_market_trail20_gt_5pct": "cont_liq_v36",
  "strategy_003_ma200_trend_follow": "strategy_003",
  // Frontend strategy-data.ts ids → canonical
  "class5_revenue_momentum": "strategy_002",
  "family_c_sbl_overlay": "strategy_003",
} as const;

/**
 * Resolve an incoming strategyId to its canonical form.
 * If the id is already canonical (in VALID_QUANT_STRATEGY_IDS), return as-is.
 * If it matches an alias, return the canonical target.
 * Otherwise return the original (will fail validation in subscribeQuantStrategy).
 *
 * NOTE: retired IDs (STRATEGY_RETIRED_IDS) are NOT in this map. They pass
 * through unchanged here, and the caller checks STRATEGY_RETIRED_IDS before
 * whitelist validation to return 410.
 */
export function resolveStrategyId(id: string): string {
  if (VALID_QUANT_STRATEGY_IDS.has(id)) return id;
  return STRATEGY_ID_ALIASES[id] ?? id;
}

/**
 * Resolve an incoming strategyId and capture the original alias display name.
 * Returns { canonicalId, aliasFrom } where aliasFrom is set when the caller
 * passed a non-canonical alias — recorded in the audit log for traceability.
 *
 * This solves Athena caveat A: MAIN_execution_rank_buffer_top20 and
 * class5_revenue_momentum both map to strategy_002; without aliasFrom the
 * audit_log payload cannot distinguish which Lab UI surface triggered the call.
 */
export function resolveStrategyIdWithMeta(id: string): { canonicalId: string; aliasFrom?: string } {
  if (VALID_QUANT_STRATEGY_IDS.has(id)) return { canonicalId: id };
  const canonical = STRATEGY_ID_ALIASES[id];
  if (canonical !== undefined) return { canonicalId: canonical, aliasFrom: id };
  return { canonicalId: id }; // unknown — will fail whitelist
}

export const CAPITAL_MIN_TWD = 50_000;
export const CAPITAL_MAX_TWD = 10_000_000;

/**
 * Paper-readiness status for each canonical strategy.
 * "paper_ready"    — live paper execution gate OPEN (requires explicit Yang ACK Phase 1
 *                    pre-reg; NEVER auto-flip here — Owner ACK gate is mandatory)
 * "forward_obs"    — forward observation candidate: subscription accepted, paper exec
 *                    deferred until explicit Yang ACK Phase 1 pre-reg
 * "backtested_raw" — still in backtest validation; paper exec deferred, warning surfaced
 *
 * This map must be manually updated when 楊董 explicitly ACKs a strategy paper-ready
 * (Phase 1 pre-reg). NEVER auto-promote — it is a hard Yang ACK gate.
 *
 * 2026-05-15 Truth Board v14 §3 alignment:
 *   - cont_liq_v36: 13-axis quality lock PASS + Truth Board v14 CLEAN.
 *     Remaining gate: Yang ACK Phase 1 pre-reg (楊董 3 天不在 / 不 lock / 不真單).
 *     Status = forward_obs until explicit ACK. DO NOT set paper_ready here.
 *   - strategy_002: Class 5 — forward observation candidate (compound +169.56%,
 *     Truth Board v10 quality lock PASS, Bruce attestation CLEAN_WITH_CAVEAT).
 *   - strategy_003: Family C × SBL v3A R6d — full 4-gate PASS (Truth Board v14).
 *     Forward obs; Yang ACK Phase 1 pre-reg also required before paper exec.
 */
export const STRATEGY_READINESS: Readonly<Record<string, "paper_ready" | "forward_obs" | "backtested_raw">> = {
  "cont_liq_v36":  "paper_ready",   // S1/F-AUTO KGI SIM observation gate opened by Yang ACK; SIM-only, real order remains blocked.
  "strategy_002":  "forward_obs",   // Class 5 — forward observation candidate
  "strategy_003":  "forward_obs",   // Family C × SBL v3A R6d — v14 4-gate PASS, forward obs
} as const;

export const BACKTESTED_RAW_WARNING =
  "Strategy is still in backtest validation phase — paper execution is deferred. " +
  "Subscription recorded for forward observation tracking.";

export const FORWARD_OBS_WARNING =
  "Strategy is in forward observation — paper execution requires explicit Owner Phase 1 " +
  "pre-reg ACK. Subscription recorded for forward observation tracking.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubscribeResult =
  | { ok: true; subscription_id: string; status: "active"; warning?: string }
  | { ok: false; error: string; http_status: 400 | 403 | 404 | 410 };

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
  const { session, capitalTwd, executionMode } = input;

  // Gate 0: check retired IDs before alias resolution.
  // Retired strategies return 410 Gone — not silently rerouted to another strategy.
  // This prevents audit log pollution (Athena caveat B).
  if (STRATEGY_RETIRED_IDS.has(input.strategyId)) {
    return {
      ok: false,
      error: "STRATEGY_RETIRED",
      http_status: 410,
    };
  }

  // Resolve alias → canonical id + capture aliasFrom for audit traceability.
  // aliasFrom is stored in the audit log payload when the caller used a non-canonical
  // display name (e.g. MAIN_execution_rank_buffer_top20 vs class5_revenue_momentum
  // both → strategy_002, but now distinguishable by aliasFrom — Athena caveat A fix).
  const { canonicalId: strategyId, aliasFrom } = resolveStrategyIdWithMeta(input.strategyId);

  // Gate 1: paper mode required
  if (executionMode !== "paper") {
    return { ok: false, error: "PAPER_MODE_REQUIRED", http_status: 403 };
  }

  // Gate 2: valid strategy id (always checked against canonical set)
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

  // Persist to audit_logs — fire-and-forget; caller handles non-DB gracefully.
  // aliasFrom is included when the caller used a non-canonical display name so the
  // audit record is traceable back to the originating Lab UI surface.
  await appendSubscribeAuditLog({
    workspaceId: session.workspace.id,
    actorId: session.user.id,
    strategyId,
    capitalTwd,
    subscriptionId,
    aliasFrom,
  });

  // Readiness check: surface warning for strategies not yet paper-ready.
  // All current strategies are forward_obs (pending Yang ACK Phase 1 pre-reg).
  // NEVER auto-promote to paper_ready — it is a hard explicit Yang ACK gate.
  // See Truth Board v14 §3 for cont_liq_v36 status.
  const readiness = STRATEGY_READINESS[strategyId];
  let warning: string | undefined;
  if (readiness === "backtested_raw") {
    warning = BACKTESTED_RAW_WARNING;
  } else if (readiness === "forward_obs") {
    warning = FORWARD_OBS_WARNING;
  }

  return { ok: true, subscription_id: subscriptionId, status: "active", ...(warning ? { warning } : {}) };
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
  aliasFrom?: string;
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
        // aliasFrom: the original display name the caller passed (if non-canonical).
        // Lets us distinguish e.g. MAIN_execution_rank_buffer_top20 vs
        // class5_revenue_momentum — both → strategy_002 but different Lab surfaces.
        // Undefined when caller already used the canonical id directly.
        ...(params.aliasFrom !== undefined ? { alias_from: params.aliasFrom } : {}),
      },
    });
  } catch (err) {
    console.warn(
      "[quant-strategy-subscribe] audit log write failed:",
      err instanceof Error ? err.message : String(err)
    );
  }

  // EventLog Phase A: double-write to el_events (additive, fire-and-forget).
  // Failure here MUST NOT propagate -- audit_logs is the primary write path.
  // Stream: strategy/<strategyId> in the workspace.
  try {
    await appendEvent({
      workspaceId: params.workspaceId,
      streamType: "strategy",
      streamId: params.strategyId,
      eventType: "strategy.subscribed",
      payload: {
        strategy_id: params.strategyId,
        capital_twd: params.capitalTwd,
        sim_only: true,
        subscription_id: params.subscriptionId,
        ...(params.aliasFrom !== undefined ? { alias_from: params.aliasFrom } : {}),
      },
      actorId: params.actorId,
    });
  } catch (err) {
    console.warn(
      "[quant-strategy-subscribe] EventLog double-write failed (non-fatal):",
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
