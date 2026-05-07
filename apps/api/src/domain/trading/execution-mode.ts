// W6 Paper Sprint — Execution mode + kill switch + paper mode flags.
//
// Three-layer AND gate (for full paper order SUBMISSION):
//   executionMode !== 'disabled'   (layer 1 — global enable; default "paper")
//   killSwitchEnabled === false    (layer 2 — safety halt; default ON = blocked)
//   paperModeEnabled === true      (layer 3 — paper path explicitly on; default ON)
//
// All three must be satisfied for a paper order to proceed; any failure → 422.
//
// Preview + order-ticket UI use a lighter gate (layers 1 + 3 only; no kill-switch).
// This lets the frontend render the order form and run previews even while the
// kill switch keeps actual submission locked (stop-line #2, frozen until 5/12).
//
// No KGI SDK import. No KGI broker dependency. Completely standalone.

export type ExecutionMode = "disabled" | "paper" | "live";

// ---------------------------------------------------------------------------
// Environment-sourced defaults
// ---------------------------------------------------------------------------

function readExecutionMode(): ExecutionMode {
  // Default is now "paper" so paper E2E routes are open out-of-the-box.
  // Set EXECUTION_MODE=disabled in env to explicitly shut down all order paths.
  const raw = process.env.EXECUTION_MODE ?? "paper";
  if (raw === "paper" || raw === "live") return raw;
  if (raw === "disabled") return "disabled";
  // Unknown value → paper (safe default; paper gate still requires kill-switch OFF).
  return "paper";
}

function readKillSwitchEnabled(): boolean {
  // Kill switch default is ON (blocked). Must be explicitly set to 'false' to
  // disable the kill switch and allow order submission.
  const raw = process.env.PAPER_KILL_SWITCH ?? "true";
  return raw !== "false";
}

function readPaperModeEnabled(): boolean {
  // Paper mode default is now ON so preview + order-ticket UI surfaces are live.
  // Set PAPER_MODE_ENABLED=false in env to disable paper order submissions.
  const raw = process.env.PAPER_MODE_ENABLED ?? "true";
  return raw !== "false";
}

// ---------------------------------------------------------------------------
// Runtime state (module-level singletons — override in tests via setter)
// ---------------------------------------------------------------------------

let _executionMode: ExecutionMode = readExecutionMode();
let _killSwitchEnabled: boolean = readKillSwitchEnabled();
let _paperModeEnabled: boolean = readPaperModeEnabled();

export function getExecutionMode(): ExecutionMode {
  return _executionMode;
}

export function isKillSwitchEnabled(): boolean {
  return _killSwitchEnabled;
}

export function isPaperModeEnabled(): boolean {
  return _paperModeEnabled;
}

// Setters exist ONLY for tests and ops scripts. Production path reads env vars.
export function _setExecutionMode(mode: ExecutionMode): void {
  _executionMode = mode;
}

export function _setKillSwitchEnabled(on: boolean): void {
  _killSwitchEnabled = on;
}

export function _setPaperModeEnabled(on: boolean): void {
  _paperModeEnabled = on;
}

// ---------------------------------------------------------------------------
// Gate check — throws-on-block pattern; caller wraps in try/catch → 422
// ---------------------------------------------------------------------------

export type ExecutionGateCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; layer: "execution_mode" | "kill_switch" | "paper_mode" };

export function checkPaperExecutionGate(): ExecutionGateCheckResult {
  if (_executionMode === "disabled") {
    return { allowed: false, reason: "execution_mode=disabled", layer: "execution_mode" };
  }
  if (_executionMode !== "paper") {
    return {
      allowed: false,
      reason: `execution_mode=${_executionMode} is not paper`,
      layer: "execution_mode"
    };
  }
  if (_killSwitchEnabled) {
    return { allowed: false, reason: "kill_switch=ON", layer: "kill_switch" };
  }
  if (!_paperModeEnabled) {
    return { allowed: false, reason: "paper_mode=OFF", layer: "paper_mode" };
  }
  return { allowed: true };
}

// Convenience: get a snapshot of all three flag values for diagnostics/health
export function getExecutionFlagSnapshot(): {
  executionMode: ExecutionMode;
  killSwitchEnabled: boolean;
  paperModeEnabled: boolean;
} {
  return {
    executionMode: _executionMode,
    killSwitchEnabled: _killSwitchEnabled,
    paperModeEnabled: _paperModeEnabled
  };
}
