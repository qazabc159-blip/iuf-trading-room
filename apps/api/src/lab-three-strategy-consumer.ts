/**
 * lab-three-strategy-consumer.ts
 *
 * Read-only consumer for the IUF Quant Lab three-strategy paper fixture API data.
 *
 * Lab / TR Alignment Lock rules (2026-05-07):
 *   - TR NEVER writes to lab repo
 *   - TR NEVER fabricates strategy status or metrics
 *   - All strategies displayed with PAPER_FIXTURE / RESEARCH_ONLY disclaimer
 *   - cash_order_path = BLOCKED_until_Yang_final_manual_ACK — enforced here
 *   - No promotion wording / buy-signal / allocation% shown as executable
 *   - No credentials, broker tokens, or system-internal identifiers in payload
 *
 * Embed source (read-only consume, copied from lab repo):
 *   data/lab/three-strategy/three_strategy_paper_fixture_api_snapshot_v1.json
 *
 * This module is loaded by:
 *   GET /api/v1/lab/three-strategy/* (14 endpoints, Owner/Admin/Analyst auth)
 *
 * Hard lines enforced here (not in caller):
 *   - cashOrderPath: "BLOCKED_until_Yang_final_manual_ACK" always returned
 *   - mode: "READ_ONLY_FIXTURE_API" / "PAPER_FIXTURE" always set
 *   - No broker write-side fields exposed
 *   - Graceful null on any file/parse error — never crash caller
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Snapshot shape (three_strategy_paper_fixture_api_snapshot_v1.json) ─────────

export type ThreeStrategyEntry = {
  strategy_id: string;
  display_name_zh: string;
  pilot_role: string;
  pilot_status: string;
  capital_cap_twd_max: number;
  position_cap: number;
  latest_state: string;
  caveat: string;
  cash_order_path: string;
  broker_route: string;
};

export type SignalEntry = Record<string, unknown>;
export type PaperOrderEntry = Record<string, unknown>;
export type PositionEntry = Record<string, unknown>;
export type RiskEventEntry = Record<string, unknown>;

type SnapshotJson = {
  schema_version: string;
  created_at_taipei: string;
  mode: string;
  cash_order_path: string;
  broker_write_side_touched: boolean;
  broker_route: string;
  health: {
    ok: boolean;
    endpoint_count: number;
    source_file_count: number;
    missing_source_files: string[];
  };
  contract: Record<string, unknown>;
  files: Array<{ key: string; path: string; exists: boolean; bytes: number }>;
  status: Record<string, unknown>;
  strategies: ThreeStrategyEntry[];
  risk_config: Record<string, unknown>;
  signal_schema: Record<string, unknown>;
  signals: SignalEntry[];
  paper_orders: PaperOrderEntry[];
  positions: PositionEntry[];
  risk_events: RiskEventEntry[];
  decision_matrix: Record<string, unknown>;
  execution_board: unknown[];
  position_sensitivity: Record<string, unknown>;
  master_index: Record<string, unknown>;
  // New in 20-endpoint upgrade (Athena P0 2026-05-08)
  daily_health: Record<string, unknown>;
  next_signal_readiness: Record<string, unknown>;
  frozen_signal_snapshot: Record<string, unknown>;
  main_overlay_validation: Record<string, unknown>;
  cont_liq_canary_guard: Record<string, unknown>;
  quality_scorecard: Record<string, unknown>;
};

// ── Public output shape ────────────────────────────────────────────────────────

export type ThreeStrategyFixtureSnapshot = SnapshotJson;

export type ThreeStrategyFixtureResult<T> =
  | { ok: true; data: T; meta: FixtureMeta }
  | { ok: false; data: null; meta: FixtureMeta };

export type FixtureMeta = {
  source: "embedded_lab_fixture" | "unavailable";
  mode: "READ_ONLY_FIXTURE_API";
  cashOrderPath: "BLOCKED_until_Yang_final_manual_ACK";
  fixtureLabel: "PAPER_FIXTURE";
  schemaVersion: string;
  createdAtTaipei: string;
  reason?: string;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const CASH_ORDER_PATH = "BLOCKED_until_Yang_final_manual_ACK" as const;
const FIXTURE_LABEL = "PAPER_FIXTURE" as const;
const FIXTURE_MODE = "READ_ONLY_FIXTURE_API" as const;

// ── Path resolution ────────────────────────────────────────────────────────────

function resolveSnapshotPath(): string {
  const __file = fileURLToPath(import.meta.url);
  const __dir = dirname(__file);
  // apps/api/src → ../../.. → monorepo root
  const monorepoRoot = join(__dir, "..", "..", "..");
  return join(
    monorepoRoot,
    "data",
    "lab",
    "three-strategy",
    "three_strategy_paper_fixture_api_snapshot_v1.json"
  );
}

// ── Loader ─────────────────────────────────────────────────────────────────────

let _cached: SnapshotJson | null | undefined = undefined;

/**
 * Load and parse the embedded three-strategy paper fixture snapshot.
 * Cached after first successful load.
 * Returns null on any error (never throws).
 */
export function loadThreeStrategySnapshot(): SnapshotJson | null {
  if (_cached !== undefined) return _cached;

  const snapshotPath = resolveSnapshotPath();
  let raw: string;
  try {
    raw = readFileSync(snapshotPath, "utf-8");
  } catch {
    console.warn(
      `[lab-three-strategy] Snapshot not found at ${snapshotPath} — returning null`
    );
    _cached = null;
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[lab-three-strategy] Snapshot JSON parse failed — returning null");
    _cached = null;
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("strategies" in parsed) ||
    !("signals" in parsed)
  ) {
    console.warn("[lab-three-strategy] Snapshot missing required fields — returning null");
    _cached = null;
    return null;
  }

  _cached = parsed as SnapshotJson;
  return _cached;
}

// ── Helper: build meta ─────────────────────────────────────────────────────────

function makeMeta(
  snapshot: SnapshotJson | null,
  reason?: string
): FixtureMeta {
  if (snapshot === null) {
    return {
      source: "unavailable",
      mode: FIXTURE_MODE,
      cashOrderPath: CASH_ORDER_PATH,
      fixtureLabel: FIXTURE_LABEL,
      schemaVersion: "three_strategy_paper_fixture_api_v1",
      createdAtTaipei: "",
      reason:
        reason ??
        "Embedded fixture snapshot not found. " +
          "Expected at data/lab/three-strategy/three_strategy_paper_fixture_api_snapshot_v1.json"
    };
  }
  return {
    source: "embedded_lab_fixture",
    mode: FIXTURE_MODE,
    cashOrderPath: CASH_ORDER_PATH,
    fixtureLabel: FIXTURE_LABEL,
    schemaVersion: snapshot.schema_version,
    createdAtTaipei: snapshot.created_at_taipei
  };
}

// ── Per-endpoint accessors ─────────────────────────────────────────────────────

/** GET /health equivalent */
export function getFixtureHealth(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return {
    ok: true,
    data: {
      ok: snapshot.health.ok,
      endpoint_count: snapshot.health.endpoint_count,
      source_file_count: snapshot.health.source_file_count,
      missing_source_files: snapshot.health.missing_source_files,
      mode: FIXTURE_MODE,
      cash_order_path: CASH_ORDER_PATH
    },
    meta
  };
}

/** GET /api/trading-room/three-strategy/status */
export function getFixtureStatus(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return {
    ok: true,
    data: {
      ...snapshot.status,
      cash_order_path: CASH_ORDER_PATH,
      mode: FIXTURE_MODE,
      fixture_label: FIXTURE_LABEL
    },
    meta
  };
}

/** GET /api/trading-room/three-strategy/files */
export function getFixtureFiles(): ThreeStrategyFixtureResult<unknown[]> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.files, meta };
}

/** GET /api/trading-room/three-strategy/strategies */
export function getFixtureStrategies(): ThreeStrategyFixtureResult<ThreeStrategyEntry[]> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  // Enforce alignment lock: cash_order_path always BLOCKED
  const strategies = snapshot.strategies.map((s) => ({
    ...s,
    cash_order_path: CASH_ORDER_PATH,
    broker_route: "NONE_PAPER_ONLY",
    fixture_label: FIXTURE_LABEL,
    pilot_status: s.pilot_status ?? "READINESS_REVIEW_ONLY"
  }));
  return { ok: true, data: strategies, meta };
}

/** GET /api/trading-room/three-strategy/signals  (optional ?strategy_id= filter) */
export function getFixtureSignals(strategyId?: string): ThreeStrategyFixtureResult<SignalEntry[]> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  let signals = snapshot.signals ?? [];
  if (strategyId) {
    signals = signals.filter((s) => s["strategy_id"] === strategyId);
  }
  // Strip any inadvertent credential or internal-engineering fields
  const safe = signals.map((s) => stripInternalFields(s));
  return { ok: true, data: safe, meta };
}

/** GET /api/trading-room/three-strategy/paper-orders  (optional ?strategy_id= filter) */
export function getFixturePaperOrders(strategyId?: string): ThreeStrategyFixtureResult<PaperOrderEntry[]> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  let orders = snapshot.paper_orders ?? [];
  if (strategyId) {
    orders = orders.filter((o) => o["strategy_id"] === strategyId);
  }
  return { ok: true, data: orders.map(stripInternalFields), meta };
}

/** GET /api/trading-room/three-strategy/positions  (optional ?strategy_id= filter) */
export function getFixturePositions(strategyId?: string): ThreeStrategyFixtureResult<PositionEntry[]> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  let positions = snapshot.positions ?? [];
  if (strategyId) {
    positions = positions.filter((p) => p["strategy_id"] === strategyId);
  }
  return { ok: true, data: positions.map(stripInternalFields), meta };
}

/** GET /api/trading-room/three-strategy/risk-events  (optional ?strategy_id= filter) */
export function getFixtureRiskEvents(strategyId?: string): ThreeStrategyFixtureResult<RiskEventEntry[]> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  let events = snapshot.risk_events ?? [];
  if (strategyId) {
    events = events.filter((e) => e["strategy_id"] === strategyId);
  }
  return { ok: true, data: events.map(stripInternalFields), meta };
}

/** GET /api/trading-room/three-strategy/risk-config */
export function getFixtureRiskConfig(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.risk_config ?? {}, meta };
}

/** GET /api/trading-room/three-strategy/decision-matrix */
export function getFixtureDecisionMatrix(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.decision_matrix ?? {}, meta };
}

/** GET /api/trading-room/three-strategy/execution-board */
export function getFixtureExecutionBoard(): ThreeStrategyFixtureResult<unknown[]> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.execution_board ?? [], meta };
}

/** GET /api/trading-room/three-strategy/position-sensitivity */
export function getFixturePositionSensitivity(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.position_sensitivity ?? {}, meta };
}

/** GET /api/trading-room/three-strategy/master-index */
export function getFixtureMasterIndex(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.master_index ?? {}, meta };
}

// ── New 20-endpoint accessors (Athena P0 upgrade 2026-05-08) ──────────────────

/** GET /api/trading-room/three-strategy/daily-health */
export function getFixtureDailyHealth(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.daily_health ?? {}, meta };
}

/** GET /api/trading-room/three-strategy/next-signal-readiness */
export function getFixtureNextSignalReadiness(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.next_signal_readiness ?? {}, meta };
}

/** GET /api/trading-room/three-strategy/frozen-signal-snapshot */
export function getFixtureFrozenSignalSnapshot(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.frozen_signal_snapshot ?? {}, meta };
}

/** GET /api/trading-room/three-strategy/main-overlay-validation */
export function getFixtureMainOverlayValidation(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.main_overlay_validation ?? {}, meta };
}

/** GET /api/trading-room/three-strategy/cont-liq-canary-guard */
export function getFixtureContLiqCanaryGuard(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.cont_liq_canary_guard ?? {}, meta };
}

/** GET /api/trading-room/three-strategy/quality-scorecard */
export function getFixtureQualityScorecard(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  return { ok: true, data: snapshot.quality_scorecard ?? {}, meta };
}

/** GET /api/trading-room/three-strategy/snapshot — full payload */
export function getFixtureFullSnapshot(): ThreeStrategyFixtureResult<Record<string, unknown>> {
  const snapshot = loadThreeStrategySnapshot();
  const meta = makeMeta(snapshot);
  if (!snapshot) return { ok: false, data: null, meta };
  // Return the full snapshot but always override guardrails
  return {
    ok: true,
    data: {
      ...snapshot,
      cash_order_path: CASH_ORDER_PATH,
      mode: FIXTURE_MODE,
      fixture_label: FIXTURE_LABEL
    },
    meta
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Strip fields that should not surface to frontend consumers:
 * - Any field containing "password", "token", "secret", "credential", "api_key"
 * - Internal sprint_id, model_name, internal codex engineering IDs
 * (Per Lab/TR alignment lock: no credentials, no raw engineering semantics)
 */
const FORBIDDEN_FIELD_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /credential/i,
  /api_key/i,
  /model_name/i,
  /sprint_id/i
];

function stripInternalFields(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!FORBIDDEN_FIELD_PATTERNS.some((re) => re.test(k))) {
      result[k] = v;
    }
  }
  return result;
}

// ── Reset cache (test helper only) ────────────────────────────────────────────

/** @internal — only for unit tests that need to reset the in-memory cache */
export function _resetThreeStrategyCache(): void {
  _cached = undefined;
}
