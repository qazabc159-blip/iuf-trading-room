/**
 * Pure decision: is a `/api/v1/kgi/quote/ticks` response fresh enough to
 * trust and display directly, or should the caller treat it the same as
 * "no tick" and defer to `/market-data/effective-quotes` (which already
 * arbitrates freshness correctly across kgi/twse_mis/official_close)?
 *
 * 2026-07-20 盤中 P0: desk-exact watchlist + `/m` were displaying a frozen
 * Friday closing tick during Monday's live session (2330 顯 2,290.00 週五值)
 * while `/market-data/effective-quotes` already had a fresh twse_mis value
 * for the same symbol — because both call sites treated "tick has ANY
 * value" as "use it", ignoring the envelope-level stale flag for VALUE
 * selection (desk only used it for the label suffix; `/m`'s
 * fetchQuoteForSymbol() didn't read it at all).
 *
 * The naive fix — "isStale===true → always defer to effective-quotes" — is
 * too aggressive: D-W2D-1's STALE_THRESHOLD_MS is 5000ms
 * (kgi-quote-client.ts), so `stale` flips true after any few-second gap
 * between pushes, which is completely normal mid-session chop. Doing that
 * would (a) trigger an extra fallback round-trip almost every poll and
 * (b) break the legitimate "ops manual single-snapshot subscribe" case
 * (2026-07-16 診斷: a just-fetched one-off snapshot is real, current data
 * that happens to already be >5s old the moment it's returned — see
 * apps/web/public/desk-exact/index.html's `isStale` handling / #1310
 * regression test).
 *
 * The actual failure mode is a genuinely FROZEN buffer (no push received in
 * minutes/hours/days, not seconds). `staleSince` — the real last-received-at
 * ISO timestamp, populated by kgi-quote-client.ts's classifyFreshness()
 * whenever stale===true, sibling to `stale`/`freshness` in the response
 * envelope — lets us tell those apart by actual elapsed age instead of the
 * binary flag.
 */

export type KgiTickEnvelope = {
  stale?: boolean;
  freshness?: string;
  staleSince?: string | null;
};

// Far above the 5s stale-flag threshold (so normal mid-session chop never
// triggers a fallback round-trip), far below "frozen since last session"
// (minutes, not days) — safely separates the two failure modes above.
export const KGI_TICK_FROZEN_THRESHOLD_MS = 5 * 60 * 1000;

export function isKgiTickFreshEnoughToTrust(
  envelope: KgiTickEnvelope | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!envelope) return true;
  const isStale = envelope.stale === true || envelope.freshness === "stale";
  if (!isStale) return true;
  // No age info to judge by — stay conservative and trust it, same as the
  // pre-existing behavior (matches the ops-manual-snapshot case above).
  if (!envelope.staleSince) return true;
  const staleSinceMs = Date.parse(envelope.staleSince);
  if (!Number.isFinite(staleSinceMs)) return true;
  return nowMs - staleSinceMs <= KGI_TICK_FROZEN_THRESHOLD_MS;
}
