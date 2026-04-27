/**
 * ring-buffer.ts — Ring buffer eviction warning helper.
 *
 * W3 B1: H-9 ring buffer eviction warning.
 *
 * The KGI gateway uses Python deque(maxlen=200) per symbol.
 * When the buffer approaches capacity, older ticks are silently evicted.
 * This module provides a warning threshold check so apps/api can emit
 * a structured warning log when the buffer is near capacity.
 *
 * Hard lines:
 *  - This module MUST NOT affect quote/order behavior (read-only observability)
 *  - No import from order modules
 *  - No side effects beyond returning/logging the warning
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default buffer max size (matches Python deque(maxlen=200) in gateway). */
export const BUFFER_MAXLEN_DEFAULT = 200;

/**
 * Warn when buffer used / max >= this fraction.
 * 0.9 = 90% capacity → warn that eviction is active or imminent.
 */
export const BUFFER_EVICTION_WARN_THRESHOLD = 0.9;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BufferStatus {
  symbol: string;
  bufferUsed: number;
  bufferMax: number;
  /**
   * True when bufferUsed / bufferMax >= BUFFER_EVICTION_WARN_THRESHOLD.
   * At this point the buffer is near capacity; new ticks are evicting old ones.
   */
  nearCapacity: boolean;
  /**
   * True when bufferUsed === bufferMax (eviction is occurring on every new tick).
   */
  atCapacity: boolean;
  /** Utilisation fraction: bufferUsed / bufferMax. */
  utilizationFraction: number;
}

// ---------------------------------------------------------------------------
// Check function
// ---------------------------------------------------------------------------

/**
 * Evaluate ring buffer utilisation for a symbol.
 *
 * Called in getRecentTicks result processing to detect near-capacity state.
 * Returns a BufferStatus — caller decides whether to emit warning log.
 *
 * Does NOT log itself (separation of concerns — logger.ts logs).
 */
export function checkBufferStatus(
  symbol: string,
  bufferUsed: number,
  bufferMax: number = BUFFER_MAXLEN_DEFAULT
): BufferStatus {
  const effectiveMax = bufferMax > 0 ? bufferMax : BUFFER_MAXLEN_DEFAULT;
  const fraction = bufferUsed / effectiveMax;
  return {
    symbol,
    bufferUsed,
    bufferMax: effectiveMax,
    nearCapacity: fraction >= BUFFER_EVICTION_WARN_THRESHOLD,
    atCapacity: bufferUsed >= effectiveMax,
    utilizationFraction: fraction,
  };
}
