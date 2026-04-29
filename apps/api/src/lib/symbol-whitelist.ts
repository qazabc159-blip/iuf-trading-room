/**
 * symbol-whitelist.ts — Gateway symbol whitelist utility.
 *
 * W5b A2: extracted from kgi-quote-client.ts (parseSymbolWhitelist).
 *
 * Policy: Option C — config-required (decided 2026-04-29).
 *   - No default whitelist. Env-unset / env-empty is NOT a usable state.
 *   - Callers MUST treat "not configured" as a config error and surface it
 *     as a structured WHITELIST_NOT_CONFIGURED envelope (not a 200 with
 *     a baked-in default list).
 *   - Rationale: a hardcoded default ["2330"] silently green-lit a single
 *     symbol even when ops forgot to set the env var. We removed that
 *     fallback so misconfiguration fails closed.
 *
 * Semantics:
 *   env unset (undefined / null)  → { configured: false }
 *   env empty string / whitespace → { configured: false }
 *   env = "2330"                  → { configured: true, whitelist: ["2330"] }
 *   env = "2330,2317,2454"        → { configured: true, whitelist: ["2330","2317","2454"] }
 *
 * Whitelist enforcement contract:
 *   isSymbolAllowed(symbol, whitelist) → boolean
 *   Callers MUST check this BEFORE making any SDK/network call.
 *   - When whitelist not configured → return WHITELIST_NOT_CONFIGURED envelope; 0 SDK calls.
 *   - When configured but symbol rejected → return SYMBOL_NOT_ALLOWED envelope; 0 SDK calls.
 *
 * Hard lines:
 *   - NO route registration
 *   - NO network calls
 *   - NO import from order modules
 *   - NO side effects
 *   - 0 SDK calls when symbol is rejected OR when whitelist not configured
 *
 * Spec: evidence/path_b_w3_read_only_2026-04-27/jason_w5b_readonly_reliability_review.md §B1
 *       (Option β superseded by Option C 2026-04-29)
 * Sprint: W5b A2 (DRAFT — route behavior change; no auto-merge without Bruce W9 gate)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Env var name for the symbol whitelist.
 */
export const WHITELIST_ENV_VAR = "KGI_QUOTE_SYMBOL_WHITELIST";

// ---------------------------------------------------------------------------
// Result type (discriminated union)
// ---------------------------------------------------------------------------

export type WhitelistParseResult =
  | { configured: false }
  | { configured: true; whitelist: string[] };

// ---------------------------------------------------------------------------
// Parse utility
// ---------------------------------------------------------------------------

/**
 * Parse KGI_QUOTE_SYMBOL_WHITELIST env var into a discriminated result.
 *
 * Rules (Option C — config-required):
 *  - Undefined or null → { configured: false }
 *  - Empty string or whitespace-only → { configured: false }
 *  - All-empty after split (e.g. ",,,") → { configured: false }
 *  - Otherwise: split on comma, trim each segment, drop empties → { configured: true, whitelist }
 *
 * @param raw  Raw env var value (pass process.env[WHITELIST_ENV_VAR] or inject for tests).
 * @returns    Discriminated result; callers MUST handle both branches.
 */
export function parseSymbolWhitelist(raw: string | undefined | null): WhitelistParseResult {
  if (raw == null || raw.trim() === "") {
    return { configured: false };
  }
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parsed.length === 0) {
    return { configured: false };
  }
  return { configured: true, whitelist: parsed };
}

// ---------------------------------------------------------------------------
// Enforcement utility
// ---------------------------------------------------------------------------

/**
 * Check whether a symbol is on the given whitelist.
 * Case-sensitive (TWSE symbols are all-numeric or upper-case).
 *
 * @param symbol     Symbol to check (e.g. "2330").
 * @param whitelist  Configured whitelist array. Must not be empty.
 * @returns true if symbol is allowed; false if rejected.
 *
 * Hard line: callers MUST return 422 SYMBOL_NOT_ALLOWED (0 SDK call) when false.
 *            Callers MUST NOT call this when whitelist is unconfigured —
 *            return WHITELIST_NOT_CONFIGURED envelope instead.
 */
export function isSymbolAllowed(symbol: string, whitelist: string[]): boolean {
  return whitelist.includes(symbol);
}

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

/** Structured error envelope when whitelist env is not configured. */
export interface WhitelistNotConfiguredEnvelope {
  error: {
    code: "WHITELIST_NOT_CONFIGURED";
    message: string;
    envVar: string;
  };
}

/**
 * Build a WHITELIST_NOT_CONFIGURED envelope for the unconfigured case.
 * Caller chooses HTTP status (recommend 503 — service-config error, not client error).
 */
export function buildWhitelistNotConfiguredEnvelope(): WhitelistNotConfiguredEnvelope {
  return {
    error: {
      code: "WHITELIST_NOT_CONFIGURED",
      message: `Symbol whitelist env var '${WHITELIST_ENV_VAR}' is not set. Quote routes are disabled until ops configures an explicit symbol list.`,
      envVar: WHITELIST_ENV_VAR,
    },
  };
}

/** Structured error envelope when symbol is rejected by a configured whitelist. */
export interface SymbolNotAllowedEnvelope {
  error: {
    code: "SYMBOL_NOT_ALLOWED";
    message: string;
    symbol: string;
  };
}

/**
 * Build a 422 SYMBOL_NOT_ALLOWED envelope for a rejected symbol.
 * Returns plain object — caller serialises to JSON and returns 422.
 */
export function buildSymbolNotAllowedEnvelope(symbol: string): SymbolNotAllowedEnvelope {
  return {
    error: {
      code: "SYMBOL_NOT_ALLOWED",
      message: `Symbol '${symbol}' is not on the quote whitelist (${WHITELIST_ENV_VAR}).`,
      symbol,
    },
  };
}
