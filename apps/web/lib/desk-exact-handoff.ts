// desk-exact-handoff.ts — shared iframe-src builder for `/desk-exact`'s static
// artifact (`apps/web/public/desk-exact/index.html`), used by both:
//   - `app/desk-exact/page.tsx` (the original preview route)
//   - `app/portfolio/page.tsx` (2026-07-15: official 交易室 route now points
//     here — see PR feat/desk-official-route-jim-20260715)
//
// The desk-exact engine's own `applyQueryPrefill()` (public/desk-exact/index.html)
// only reads two query params: `symbol` and `side`. It is owner-locked/verbatim
// artifact content — do not extend it here to consume more params; instead
// each caller narrows its own richer param set down to these two before
// calling `buildDeskExactSrc()`.
export type DeskExactHandoffParams = Record<string, string | string[] | undefined>;

export function safeDeskExactTicker(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const ticker = raw?.trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9._-]{1,16}$/.test(ticker)) return null;
  return ticker;
}

export function safeDeskExactSide(value: string | string[] | undefined): "buy" | "sell" | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "buy" || raw === "sell" ? raw : null;
}

export function buildDeskExactSrc(params: { symbol?: string | string[]; side?: string | string[] } | undefined) {
  const symbol = safeDeskExactTicker(params?.symbol);
  const side = safeDeskExactSide(params?.side);
  const query = new URLSearchParams();
  if (symbol) query.set("symbol", symbol);
  if (side) query.set("side", side);
  // Stable rev for a handoff load (same handoff = same iframe, no remount);
  // time-bucketed rev for a plain visit so a fresh load always gets the
  // latest desk HTML after a deploy — same rationale as buildPaperRoomSrc()
  // in portfolio-handoff.ts.
  query.set("rev", symbol || side ? `handoff-${symbol ?? ""}-${side ?? ""}` : Date.now().toString(36));
  return `/desk-exact/index.html?${query.toString()}`;
}
