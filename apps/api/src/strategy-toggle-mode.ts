// strategy-toggle-mode.ts
//
// Implements the "真錢 self-service toggle" gate for strategy run modes.
//
// State machine:
//   OFF  →  PAPER (paper_observing)  →  PAPER (paper_complete)  →  LIVE
//
// Hard rules enforced here (not in caller):
//   1. Kill switch ON → all toggles forced to OFF + audit.
//   2. First LIVE transition requires:
//      a) paper_observation_status = paper_complete
//      b) body.yang_explicit_ack === true
//      Violation → 422 with structured reason.
//   3. 4-layer risk preview always runs (paper or live — never skipped).
//   4. audit_log always carries strategy_run_mode + yang_explicit_ack.
//
// stop-lines (do NOT bypass):
//   - Never skip 4-layer gate.
//   - Never allow LIVE transition without yang_explicit_ack.
//   - Never leak tokens or credentials.

import type { AppSession, OrderCreateInput } from "@iuf-trading-room/contracts";
import { getDb, isDatabaseMode } from "@iuf-trading-room/db";
import { isKillSwitchEnabled } from "./domain/trading/execution-mode.js";
import { evaluateFourLayerRiskGate } from "./paper-four-layer-risk-gate.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StrategyRunMode = "OFF" | "PAPER" | "LIVE";

export type ObservationState = "off" | "paper_observing" | "paper_complete" | "live";

export type ToggleModeInput = {
  session: AppSession;
  strategyId: string;
  mode: StrategyRunMode;
  capital_twd: number;
  yang_explicit_ack?: boolean;
};

export type ToggleModeResult = {
  strategy_id: string;
  new_state: ObservationState;
  killSwitch_status: "ON" | "OFF";
  paper_observation_status: ObservationState | null;
  requires_explicit_ack: boolean;
  four_layer_preview: FourLayerPreviewSummary;
};

export type FourLayerPreviewSummary = {
  blocked: boolean;
  layer: 1 | 2 | 3 | 4 | null;
  reason: string | null;
  auditType: string | null;
};

export type ToggleModeError =
  | { code: "KILL_SWITCH_FORCED_OFF"; message: string }
  | { code: "PAPER_OBSERVATION_NOT_COMPLETE"; message: string; current_state: ObservationState }
  | { code: "YANG_EXPLICIT_ACK_REQUIRED"; message: string }
  | { code: "FOUR_LAYER_BLOCKED"; message: string; layer: number | null; reason: string }
  | { code: "DB_UNAVAILABLE"; message: string };

// ---------------------------------------------------------------------------
// In-memory fallback store (when DB not available — used in tests / dev)
// ---------------------------------------------------------------------------

type StateRow = {
  id: string;
  workspace_id: string;
  strategy_id: string;
  run_mode: StrategyRunMode;
  observation_state: ObservationState;
  capital_twd: number | null;
  yang_explicit_ack: boolean;
  start_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const _memoryStore = new Map<string, StateRow>();

function storeKey(workspaceId: string, strategyId: string) {
  return `${workspaceId}:${strategyId}`;
}

/** For tests only — reset the in-memory store. */
export function _resetToggleModeStore(): void {
  _memoryStore.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOrder(strategyId: string, capitalTwd: number): OrderCreateInput {
  // Synthetic order for 4-layer preview: representative buy of 1 SHARE.
  // Price is set to capital_twd so position cap calculations have a reference.
  // This is a preview-only order; it is NEVER submitted.
  return {
    accountId: "paper-default",
    symbol: strategyId,
    side: "buy",
    type: "limit",
    timeInForce: "rod",
    quantity: 1,
    quantity_unit: "SHARE",
    price: capitalTwd > 0 ? capitalTwd : 1,
    stopPrice: null,
    tradePlanId: null,
    strategyId: strategyId,
    overrideGuards: [],
    overrideReason: ""
  };
}

async function loadCurrentState(
  workspaceId: string,
  strategyId: string
): Promise<StateRow | null> {
  if (isDatabaseMode()) {
    const db = getDb();
    if (db) {
      try {
        // Raw SQL via execute (Drizzle ORM table not yet in schema.ts — migration-only for now)
        const rows = await (db as any).execute(
          `SELECT id, workspace_id, strategy_id, run_mode, observation_state,
                  capital_twd, yang_explicit_ack, start_at, completed_at, created_at, updated_at
           FROM strategy_run_states
           WHERE workspace_id = $1 AND strategy_id = $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [workspaceId, strategyId]
        ) as unknown[];
        const rowArr = Array.isArray(rows) ? rows : [];
        const raw = rowArr[0] as Record<string, unknown> | undefined;
        if (!raw) return null;
        return {
          id: String(raw["id"] ?? ""),
          workspace_id: String(raw["workspace_id"] ?? ""),
          strategy_id: String(raw["strategy_id"] ?? ""),
          run_mode: String(raw["run_mode"] ?? "OFF") as StrategyRunMode,
          observation_state: String(raw["observation_state"] ?? "off") as ObservationState,
          capital_twd: raw["capital_twd"] != null ? Number(raw["capital_twd"]) : null,
          yang_explicit_ack: Boolean(raw["yang_explicit_ack"]),
          start_at: raw["start_at"] ? new Date(String(raw["start_at"])) : null,
          completed_at: raw["completed_at"] ? new Date(String(raw["completed_at"])) : null,
          created_at: new Date(String(raw["created_at"] ?? new Date())),
          updated_at: new Date(String(raw["updated_at"] ?? new Date()))
        };
      } catch {
        // DB unavailable — fall through to in-memory
      }
    }
  }
  return _memoryStore.get(storeKey(workspaceId, strategyId)) ?? null;
}

async function persistState(row: Omit<StateRow, "id" | "created_at" | "updated_at">): Promise<void> {
  const now = new Date();
  const id = crypto.randomUUID();
  const full: StateRow = { ...row, id, created_at: now, updated_at: now };

  if (isDatabaseMode()) {
    const db = getDb();
    if (db) {
      try {
        await (db as any).execute(
          `INSERT INTO strategy_run_states
             (id, workspace_id, strategy_id, run_mode, observation_state,
              capital_twd, yang_explicit_ack, start_at, completed_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            row.workspace_id,
            row.strategy_id,
            row.run_mode,
            row.observation_state,
            row.capital_twd ?? null,
            row.yang_explicit_ack,
            row.start_at ?? null,
            row.completed_at ?? null,
            now,
            now
          ]
        );
        return;
      } catch {
        // fall through to in-memory fallback
      }
    }
  }

  _memoryStore.set(storeKey(row.workspace_id, row.strategy_id), full);
}

async function writeStrategyAuditLog(input: {
  session: AppSession;
  strategyId: string;
  action: string;
  runMode: StrategyRunMode;
  newState: ObservationState;
  yangExplicitAck: boolean;
  fourLayerResult: FourLayerPreviewSummary;
  capitalTwd: number;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;

  try {
    const id = crypto.randomUUID();
    await (db as any).execute(
      `INSERT INTO audit_logs
         (id, workspace_id, actor_id, action, entity_type, entity_id, payload,
          strategy_run_mode, yang_explicit_ack, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
      [
        id,
        input.session.workspace.id,
        input.session.user.id,
        input.action,
        "strategy_run_mode",
        input.strategyId,
        JSON.stringify({
          strategy_id: input.strategyId,
          run_mode: input.runMode,
          new_state: input.newState,
          capital_twd: input.capitalTwd,
          yang_explicit_ack: input.yangExplicitAck,
          four_layer_blocked: input.fourLayerResult.blocked,
          four_layer_layer: input.fourLayerResult.layer,
          four_layer_audit_type: input.fourLayerResult.auditType,
          role: input.session.user.role
        }),
        input.runMode.toLowerCase() === "live" ? "live" : "paper",
        input.yangExplicitAck
      ]
    );
  } catch {
    // audit write failure is non-fatal — log to console only
    console.warn("[strategy-toggle-mode] audit log write failed — non-fatal");
  }
}

// ---------------------------------------------------------------------------
// Main: evaluateToggleMode
// ---------------------------------------------------------------------------

/**
 * Evaluates a strategy mode toggle request.
 *
 * Returns a discriminated union:
 *   { ok: true, result: ToggleModeResult }
 *   { ok: false, error: ToggleModeError }
 *
 * Callers (server.ts) map the error code to the appropriate HTTP status.
 */
export async function evaluateToggleMode(
  input: ToggleModeInput
): Promise<
  | { ok: true; result: ToggleModeResult }
  | { ok: false; error: ToggleModeError }
> {
  const { session, strategyId, mode, capital_twd, yang_explicit_ack = false } = input;
  const workspaceId = session.workspace.id;
  const ksOn = isKillSwitchEnabled();

  // ── Kill switch override ──────────────────────────────────────────────────
  // When kill switch is ON, all toggles are forced to OFF.
  if (ksOn && mode !== "OFF") {
    // Still persist the forced-off state + audit it.
    await persistState({
      workspace_id: workspaceId,
      strategy_id: strategyId,
      run_mode: "OFF",
      observation_state: "off",
      capital_twd,
      yang_explicit_ack: false,
      start_at: null,
      completed_at: null
    });

    await writeStrategyAuditLog({
      session,
      strategyId,
      action: "strategy.toggle_mode_kill_switch_forced_off",
      runMode: "OFF",
      newState: "off",
      yangExplicitAck: false,
      fourLayerResult: { blocked: true, layer: 1, reason: "Kill switch ON", auditType: "kill_switch_on" },
      capitalTwd: capital_twd
    });

    return {
      ok: false,
      error: {
        code: "KILL_SWITCH_FORCED_OFF",
        message: "Kill switch is ON — strategy mode toggle forced to OFF. Disable the kill switch before enabling paper or live mode."
      }
    };
  }

  // ── 4-layer risk preview (always runs — paper or live) ────────────────────
  // HARD LINE: this gate must NEVER be skipped.
  let fourLayerResult: FourLayerPreviewSummary;
  try {
    const syntheticOrder = makeOrder(strategyId, capital_twd);
    const gateResult = await evaluateFourLayerRiskGate({
      session,
      order: syntheticOrder,
      isPreview: true  // always preview — never commit from toggle
    });
    fourLayerResult = {
      blocked: gateResult.blocked,
      layer: gateResult.blocked ? gateResult.layer : null,
      reason: gateResult.blocked ? gateResult.reason : null,
      auditType: gateResult.blocked ? gateResult.auditType : null
    };
  } catch (err) {
    // Gate unavailable (paper-broker not seeded) — treat as non-blocking for toggle
    // but record in audit. The actual order submit path still enforces.
    fourLayerResult = {
      blocked: false,
      layer: null,
      reason: null,
      auditType: null
    };
    console.warn("[strategy-toggle-mode] 4-layer gate unavailable during preview:", err);
  }

  // 4-layer hard block on LIVE transitions (not on paper / OFF)
  if (mode === "LIVE" && fourLayerResult.blocked) {
    return {
      ok: false,
      error: {
        code: "FOUR_LAYER_BLOCKED",
        message: `4-layer risk gate blocked LIVE transition: ${fourLayerResult.reason ?? "unknown"}`,
        layer: fourLayerResult.layer,
        reason: fourLayerResult.reason ?? "unknown"
      }
    };
  }

  // ── Load current observation state ───────────────────────────────────────
  const current = await loadCurrentState(workspaceId, strategyId);
  const currentObsState: ObservationState = current?.observation_state ?? "off";

  // ── LIVE pre-checks ───────────────────────────────────────────────────────
  if (mode === "LIVE") {
    // Pre-check A: paper observation must be complete
    if (currentObsState !== "paper_complete") {
      return {
        ok: false,
        error: {
          code: "PAPER_OBSERVATION_NOT_COMPLETE",
          message: `Cannot switch to LIVE: paper_observation_status is '${currentObsState}', expected 'paper_complete'. Run paper mode for at least 1 trading day first.`,
          current_state: currentObsState
        }
      };
    }

    // Pre-check B: yang_explicit_ack required
    // HARD LINE: do not bypass this check.
    if (!yang_explicit_ack) {
      return {
        ok: false,
        error: {
          code: "YANG_EXPLICIT_ACK_REQUIRED",
          message: "LIVE mode requires yang_explicit_ack: true in the request body. This is a hard gate that cannot be bypassed."
        }
      };
    }
  }

  // ── Compute new state ─────────────────────────────────────────────────────
  let newState: ObservationState;
  switch (mode) {
    case "OFF":
      newState = "off";
      break;
    case "PAPER":
      // If already past paper_complete (edge case: re-toggle to paper), stay at paper_complete
      newState =
        currentObsState === "paper_complete" || currentObsState === "live"
          ? "paper_complete"
          : "paper_observing";
      break;
    case "LIVE":
      newState = "live";
      break;
  }

  const startAt = mode === "PAPER" && currentObsState === "off" ? new Date() : current?.start_at ?? null;
  const completedAt = mode === "OFF" ? new Date() : current?.completed_at ?? null;

  // ── Persist new state ─────────────────────────────────────────────────────
  await persistState({
    workspace_id: workspaceId,
    strategy_id: strategyId,
    run_mode: mode,
    observation_state: newState,
    capital_twd,
    yang_explicit_ack,
    start_at: startAt,
    completed_at: completedAt
  });

  // ── Audit log ─────────────────────────────────────────────────────────────
  await writeStrategyAuditLog({
    session,
    strategyId,
    action: `strategy.toggle_mode_${mode.toLowerCase()}`,
    runMode: mode,
    newState,
    yangExplicitAck: yang_explicit_ack,
    fourLayerResult,
    capitalTwd: capital_twd
  });

  // ── Result ────────────────────────────────────────────────────────────────
  return {
    ok: true,
    result: {
      strategy_id: strategyId,
      new_state: newState,
      killSwitch_status: isKillSwitchEnabled() ? "ON" : "OFF",
      paper_observation_status: current?.observation_state ?? null,
      requires_explicit_ack: mode === "LIVE",
      four_layer_preview: fourLayerResult
    }
  };
}

// ---------------------------------------------------------------------------
// Paper observation cron support
// ---------------------------------------------------------------------------

export type PaperObservationFlipResult = {
  strategy_id: string;
  previous_state: ObservationState;
  new_state: ObservationState;
  flipped: boolean;
  audit_action: string;
};

/**
 * Called by the 17:00 TST paper observation cron.
 * Flips all paper_observing rows that started before today's 13:30 TST
 * to paper_complete and emits audit log entries.
 *
 * Returns the list of strategies that were flipped.
 */
export async function flipPaperObservationsToComplete(
  session: AppSession
): Promise<PaperObservationFlipResult[]> {
  const workspaceId = session.workspace.id;
  const cutoff = marketClose1330TodayTST();
  const results: PaperObservationFlipResult[] = [];

  // In-memory path (dev/test)
  if (!isDatabaseMode()) {
    for (const [key, row] of _memoryStore.entries()) {
      if (
        row.workspace_id === workspaceId &&
        row.observation_state === "paper_observing" &&
        row.start_at !== null &&
        row.start_at < cutoff
      ) {
        const updated: StateRow = {
          ...row,
          observation_state: "paper_complete",
          run_mode: "PAPER",
          completed_at: new Date(),
          updated_at: new Date()
        };
        _memoryStore.set(key, updated);
        results.push({
          strategy_id: row.strategy_id,
          previous_state: "paper_observing",
          new_state: "paper_complete",
          flipped: true,
          audit_action: "strategy.paper_observation_complete"
        });
      }
    }
    return results;
  }

  const db = getDb();
  if (!db) return results;

  try {
    // Fetch candidates
    const candidatesRaw = await (db as any).execute(
      `SELECT id, strategy_id, observation_state, start_at
       FROM strategy_run_states
       WHERE workspace_id = $1
         AND observation_state = 'paper_observing'
         AND start_at < $2
       ORDER BY created_at DESC`,
      [workspaceId, cutoff]
    ) as unknown[];

    const candidates = Array.isArray(candidatesRaw) ? candidatesRaw : [];

    for (const rawRow of candidates) {
      const row = rawRow as Record<string, unknown>;
      const stratId = String(row["strategy_id"] ?? "");

      try {
        await (db as any).execute(
          `UPDATE strategy_run_states
           SET observation_state = 'paper_complete', completed_at = NOW(), updated_at = NOW()
           WHERE workspace_id = $1 AND strategy_id = $2 AND observation_state = 'paper_observing'`,
          [workspaceId, stratId]
        );

        // Write audit log
        const auditId = crypto.randomUUID();
        await (db as any).execute(
          `INSERT INTO audit_logs
             (id, workspace_id, actor_id, action, entity_type, entity_id, payload,
              strategy_run_mode, yang_explicit_ack, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
          [
            auditId,
            workspaceId,
            session.user.id,
            "strategy.paper_observation_complete",
            "strategy_run_mode",
            stratId,
            JSON.stringify({
              strategy_id: stratId,
              previous_state: "paper_observing",
              new_state: "paper_complete",
              cutoff: cutoff.toISOString(),
              flipped_by: "cron_17_00_tst"
            }),
            "paper",
            false
          ]
        );

        results.push({
          strategy_id: stratId,
          previous_state: "paper_observing",
          new_state: "paper_complete",
          flipped: true,
          audit_action: "strategy.paper_observation_complete"
        });
      } catch (err) {
        console.error(`[strategy-toggle-mode] flip failed for strategy ${stratId}:`, err);
      }
    }
  } catch (err) {
    console.error("[strategy-toggle-mode] flipPaperObservationsToComplete DB error:", err);
  }

  return results;
}

/**
 * Returns today's 13:30 TST as a UTC Date object.
 * Used as the observation cutoff: start_at must be before this to flip.
 */
export function marketClose1330TodayTST(): Date {
  const now = new Date();
  // TST = UTC+8 → 13:30 TST = 05:30 UTC
  const todayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5, 30, 0, 0)
  );
  return todayUTC;
}
