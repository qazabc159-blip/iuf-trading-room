// W6 Paper Sprint — Execution mode + kill switch + paper mode flags.
//
// Three-layer AND gate:
//   executionMode !== 'disabled'   (layer 1 — global enable)
//   killSwitchEnabled === false    (layer 2 — safety halt; default ON = blocked)
//   paperModeEnabled === true      (layer 3 — paper path explicitly on; default OFF)
//
// All three must be satisfied for a paper order to proceed; any failure → 422.
//
// No KGI SDK import. No KGI broker dependency. Completely standalone.

export type ExecutionMode = "disabled" | "paper" | "live";

// ---------------------------------------------------------------------------
// Environment-sourced defaults
// ---------------------------------------------------------------------------

function readExecutionMode(): ExecutionMode {
  const raw = process.env.EXECUTION_MODE ?? "disabled";
  if (raw === "paper" || raw === "live") return raw;
  // Anything else (including 'disabled', unset, or unknown) → disabled.
  return "disabled";
}

function readKillSwitchEnabled(): boolean {
  // Kill switch default is ON (blocked). Must be explicitly set to 'false' to
  // disable the kill switch and allow order submission.
  const raw = process.env.PAPER_KILL_SWITCH ?? "true";
  return raw !== "false";
}

function readPaperModeEnabled(): boolean {
  // Paper mode default is OFF. Must be explicitly set to 'true'.
  const raw = process.env.PAPER_MODE_ENABLED ?? "false";
  return raw === "true";
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
