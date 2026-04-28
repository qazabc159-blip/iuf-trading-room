/**
 * symbol-whitelist.ts — Gateway symbol whitelist utility.
 *
 * W5b A2: extracted from kgi-quote-client.ts (parseSymbolWhitelist).
 * Adds improved semantics: env-unset vs env-empty-string are now distinct.
 *
 * Design (Option β from §B1 of jason_w5b_readonly_reliability_review.md):
 *   env unset       → ["2330"] (retain production backward-compat default)
 *   env empty string → ["2330"] (same fallback — explicit empty is treated as "default")
 *   env = "2330"    → ["2330"]
 *   env = "2330,2317,2454" → ["2330", "2317", "2454"]
 *
 * Whitelist enforcement contract:
 *   isSymbolAllowed(symbol, whitelist) → boolean
 *   Callers MUST check this BEFORE making any SDK/network call.
 *   When false → return 422 SYMBOL_NOT_ALLOWED envelope; 0 SDK calls.
 *
 * Hard lines:
 *   - NO route registration
 *   - NO network calls
 *   - NO import from order modules
 *   - NO side effects
 *   - 0 SDK calls when symbol is rejected
 *
 * Spec: evidence/path_b_w3_read_only_2026-04-27/jason_w5b_readonly_reliability_review.md §B1
 * Sprint: W5b A2 (DRAFT — route behavior change; no auto-merge without Bruce W9 gate)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default symbol whitelist when KGI_QUOTE_SYMBOL_WHITELIST is unset or empty.
 * Retained for backward compat (Step 3a evidence scope).
 */
export const DEFAULT_WHITELIST: readonly string[] = ["2330"] as const;

/**
 * Env var name for the symbol whitelist.
 */
export const WHITELIST_ENV_VAR = "KGI_QUOTE_SYMBOL_WHITELIST";

// ---------------------------------------------------------------------------
// Parse utility
// ---------------------------------------------------------------------------

/**
 * Parse KGI_QUOTE_SYMBOL_WHITELIST env var into a string array.
 *
 * Rules:
 *  - Undefined or null → DEFAULT_WHITELIST ["2330"]
 *  - Empty string or whitespace-only → DEFAULT_WHITELIST ["2330"]
 *  - Otherwise: split on comma, trim each segment, drop empties
 *
 * @param raw  Raw env var value (pass process.env[WHITELIST_ENV_VAR] or inject for tests).
 * @returns    Non-empty string array; always at least one entry.
 */
export function parseSymbolWhitelist(raw: string | undefined | null): string[] {
  if (!raw || raw.trim() === "") {
    return [...DEFAULT_WHITELIST];
  }
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parsed.length === 0) {
    return [...DEFAULT_WHITELIST];
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Enforcement utility
// ---------------------------------------------------------------------------

/**
 * Check whether a symbol is on the given whitelist.
 * Case-sensitive (TWSE symbols are all-numeric or upper-case).
 *
 * @param symbol     Symbol to check (e.g. "2330").
 * @param whitelist  Array from parseSymbolWhitelist(). Must not be empty.
 * @returns true if symbol is allowed; false if rejected.
 *
 * Hard line: callers MUST return 422 SYMBOL_NOT_ALLOWED (0 SDK call) when false.
 */
export function isSymbolAllowed(symbol: string, whitelist: string[]): boolean {
  return whitelist.includes(symbol);
}

// ---------------------------------------------------------------------------
// Envelope helpers (422 response shape)
// ---------------------------------------------------------------------------

/** Structured error envelope when symbol is rejected. */
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
