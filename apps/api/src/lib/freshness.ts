/**
 * freshness.ts — Canonical 4-state quote freshness model.
 *
 * W5b A1: extracted from kgi-quote-client.ts (STALE_THRESHOLD_MS, classifyFreshness).
 * This is a pure utility — no side effects, no network calls, no route registration.
 *
 * 4-state model:
 *   fresh        : ageMs <= STALE_THRESHOLD_MS             (≤ 5 s default)
 *   stale        : ageMs >  STALE_THRESHOLD_MS && ≤ HARD_STALE_MS (≤ 60 s)
 *   expired      : ageMs >  HARD_STALE_MS                  (> 60 s — treat as missing)
 *   not-available: lastReceivedAt is null / undefined / empty
 *
 * Constants (env-tunable at runtime; pure-function tests inject values directly):
 *   KGI_QUOTE_STALE_THRESHOLD_MS — default 5 000 ms
 *   KGI_QUOTE_HARD_STALE_MS      — default 60 000 ms
 *
 * Hard lines:
 *   - NO route registration
 *   - NO network calls
 *   - NO import from order modules
 *   - NO side effects
 *   - NO external deps
 *
 * Spec: evidence/path_b_w3_read_only_2026-04-27/jason_w5b_readonly_reliability_review.md §B2
 * Sprint: W5b A1
 */

// ---------------------------------------------------------------------------
// Constants (env-tunable)
// ---------------------------------------------------------------------------

/**
 * Age threshold below which quote data is considered "fresh".
 * Default: 5 000 ms.
 * Override via KGI_QUOTE_STALE_THRESHOLD_MS env var.
 */
export const STALE_THRESHOLD_MS: number = (() => {
  const raw = process.env["KGI_QUOTE_STALE_THRESHOLD_MS"];
  if (!raw) return 5_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 5_000;
})();

/**
 * Age threshold above which quote data is considered "expired" (beyond stale).
 * Default: 60 000 ms (60 s).
 * Override via KGI_QUOTE_HARD_STALE_MS env var.
 */
export const HARD_STALE_MS: number = (() => {
  const raw = process.env["KGI_QUOTE_HARD_STALE_MS"];
  if (!raw) return 60_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
})();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 4-state freshness classification. */
export type FreshnessState = "fresh" | "stale" | "expired" | "not-available";

/** Full result returned by classifyFreshness4. */
export interface FreshnessResult {
  /** Canonical 4-state classification. */
  state: FreshnessState;
  /**
   * Legacy 3-state field for backward-compat consumers (kgi-quote-client.ts).
   * Maps: fresh→"fresh" | stale→"stale" | expired→"stale" | not-available→"not-available"
   */
  freshness: "fresh" | "stale" | "not-available";
  /** true when state is stale or expired */
  stale: boolean;
  /** ISO timestamp of last reception, or null */
  staleSince: string | null;
  /** Age in ms at evaluation time, or null if not-available */
  ageMs: number | null;
}

// ---------------------------------------------------------------------------
// Core utility
// ---------------------------------------------------------------------------

/**
 * Classify quote data freshness using the 4-state model.
 *
 * @param lastReceivedAt  ISO 8601 UTC string from gateway, or null/undefined if no data.
 * @param staleThresholdMs  Override stale threshold (default: STALE_THRESHOLD_MS).
 * @param hardStaleMs       Override hard-stale threshold (default: HARD_STALE_MS).
 * @param nowMs             Override "now" epoch ms (for deterministic testing).
 *
 * @returns FreshnessResult
 *
 * Edge cases handled:
 *   - null / undefined / empty string → "not-available"
 *   - unparseable timestamp (Date.parse → NaN) → "not-available"
 *   - future timestamp (ageMs < 0, clock skew) → clamped to 0 → treated as "fresh"
 *   - zero threshold → ageMs === 0 passes (≤ 0) → "fresh"; ageMs === 1 → "stale"
 */
export function classifyFreshness4(
  lastReceivedAt: string | null | undefined,
  staleThresholdMs: number = STALE_THRESHOLD_MS,
  hardStaleMs: number = HARD_STALE_MS,
  nowMs: number = Date.now()
): FreshnessResult {
  // --- not-available: null / undefined / empty / whitespace ---
  if (!lastReceivedAt || lastReceivedAt.trim() === "") {
    return {
      state: "not-available",
      freshness: "not-available",
      stale: false,
      staleSince: null,
      ageMs: null,
    };
  }

  // --- parse timestamp ---
  const parsedMs = Date.parse(lastReceivedAt);
  if (!Number.isFinite(parsedMs)) {
    // Unparseable → treat as not-available (defensive)
    return {
      state: "not-available",
      freshness: "not-available",
      stale: false,
      staleSince: null,
      ageMs: null,
    };
  }

  // --- compute age; clamp negative (future timestamp / clock skew) to 0 ---
  const rawAgeMs = nowMs - parsedMs;
  const ageMs = rawAgeMs < 0 ? 0 : rawAgeMs;

  // --- classify ---
  if (ageMs <= staleThresholdMs) {
    return {
      state: "fresh",
      freshness: "fresh",
      stale: false,
      staleSince: null,
      ageMs,
    };
  }

  if (ageMs <= hardStaleMs) {
    return {
      state: "stale",
      freshness: "stale",
      stale: true,
      staleSince: lastReceivedAt,
      ageMs,
    };
  }

  // ageMs > hardStaleMs → expired
  return {
    state: "expired",
    freshness: "stale",  // legacy compat: expired maps to "stale" for consumers using 3-state
    stale: true,
    staleSince: lastReceivedAt,
    ageMs,
  };
}

// ---------------------------------------------------------------------------
// Legacy 3-state shim (backward compat with kgi-quote-client.ts consumers)
// ---------------------------------------------------------------------------

/**
 * Legacy 3-state shim.
 * Identical signature to the original classifyFreshness in kgi-quote-client.ts.
 * New code should use classifyFreshness4 instead.
 *
 * @deprecated use classifyFreshness4 for 4-state awareness.
 */
export function classifyFreshnessLegacy(
  lastReceivedAt: string | null | undefined,
  thresholdMs: number = STALE_THRESHOLD_MS
): { freshness: "fresh" | "stale" | "not-available"; stale: boolean; staleSince: string | null } {
  const r = classifyFreshness4(lastReceivedAt, thresholdMs, Infinity);
  return {
    freshness: r.freshness,
    stale: r.stale,
    staleSince: r.staleSince,
  };
}
