/**
 * market-data-integrity-gate.ts — 2026-07-17（楊董升級：治本不補丁）
 *
 * Background: a string of heatmap bugs on 2026-07-17 (#1294 endpoint wedge,
 * #1295 comma-truncation, #1297 Round 1 no_data gating, 2395 fake-0%
 * residual, banner/tile date mismatch) turned out to be the SAME underlying
 * disease wearing different faces: **no single, cross-validated, authoritative
 * data layer** — every display surface (heatmap tile, index panel, banner)
 * independently trusted whatever value it happened to receive from whatever
 * upstream fetch it happened to make, with no structural guard against a
 * partial/corrupted/self-contradicting value slipping through as if valid.
 *
 * This module is that guard. It does NOT replace the existing 3-tier
 * enricher (`kgi-heatmap-enricher.ts`) — it provides the STRUCTURAL
 * invariant checks that tier's output (and any other market-data display
 * value, e.g. banner/index) must satisfy before being treated as valid:
 *
 *   1. verifyQuoteTuple()               — a tile's price+change+changePct
 *                                          must be internally arithmetically
 *                                          consistent and within the daily
 *                                          ±10.5% limit band. A "price with
 *                                          null/0 change treated as valid"
 *                                          is exactly the bug class this
 *                                          closes structurally.
 *   2. isPriceMagnitudePlausible()      — catches "known large-cap showing
 *                                          a single digit" even when (by
 *                                          coincidence of some OTHER bug)
 *                                          the arithmetic in #1 happens to
 *                                          look internally consistent.
 *   3. crossValidateWithIndependentSource() — for values ambiguous by
 *                                          construction (exact-zero change),
 *                                          the ONLY way to tell "genuinely
 *                                          flat" from "upstream batch
 *                                          artifact" is an INDEPENDENT
 *                                          source (never the same feed, and
 *                                          never our own cache DERIVED from
 *                                          that same feed — see the 2395
 *                                          root cause below). Fails CLOSED:
 *                                          no independent confirmation ⇒
 *                                          not trustworthy, full stop.
 *   4. resolveAuthoritativeTradeDate()  — the single trade-date every
 *                                          consumer (banner text, index
 *                                          panel, heatmap tiles) must derive
 *                                          from, so they cannot structurally
 *                                          disagree the way banner="07/16"
 *                                          vs tiles="07/17" did.
 *
 * 2395 root cause (why "cross-check against our own prior-day cache" from
 * #1297 Round 1 was NOT enough): TWSE STOCK_DAY_ALL reported
 * Change="0.0000" for 2395 while the true prevClose (per TWSE MIS
 * getStockInfo.jsp, an INDEPENDENT endpoint) was 519, not 513 — a real
 * -1.16% move. #1297 Round 1 cross-checked the exact-zero claim against our
 * own `_lastCloseCache`, which is itself write-through-populated FROM THE
 * SAME STOCK_DAY_ALL FEED. On a fresh process (deploy restart wipes the
 * in-memory cache), the FIRST occurrence of the bug that day had no prior
 * entry to contradict it, got accepted (documented "no ground truth"
 * limitation), and was then cached under today's date — every SUBSEQUENT
 * poll that same day compared against that already-contaminated same-day
 * entry and found it "self-consistent" (513≈513), never catching the bug.
 * Same-source self-confirmation is fundamentally unable to catch a bug in
 * that same source. This module fixes it by requiring genuine independent
 * confirmation (TWSE MIS) and failing closed when unavailable, never
 * accepting an unconfirmed ambiguous value "by default".
 *
 * Exported for external verification (a scheduled daily data-quality canary
 * is being built separately by another agent) — `verifyQuoteTuple()` and
 * `crossValidateWithIndependentSource()` are pure functions any caller
 * (including an external canary script importing this module, or a future
 * ops endpoint) can call directly against a candidate value.
 *
 * Hard lines: pure functions only (no DB/network I/O in this module itself —
 * `crossValidateWithIndependentSource()` takes an already-fetched
 * independent value as input; the caller is responsible for fetching it,
 * e.g. via `data-sources/twse-mis-quote-client.ts`'s `getTwseMisQuoteSnapshot()`).
 */

export type IntegrityRejectionReason =
  | "missing_trade_date"
  | "missing_close"
  | "missing_change_or_pct"
  | "changePct_arithmetic_mismatch"
  | "changePct_exceeds_daily_limit"
  | "price_magnitude_anomaly"
  | "independent_source_unavailable"
  | "independent_source_mismatch";

export interface VerifiedQuoteTuple {
  verified: true;
  source: string;
  tradeDate: string;
  close: number;
  change: number;
  changePct: number;
}

export interface QuoteRejection {
  verified: false;
  reason: IntegrityRejectionReason;
}

export type QuoteVerificationResult = VerifiedQuoteTuple | QuoteRejection;

export interface QuoteCandidate {
  source: string;
  tradeDate: string | null;
  close: number | null;
  change: number | null;
  changePct: number | null;
}

/** Taiwan equities' regulatory daily price-limit band (±10%, small rounding
 * tolerance) — same threshold as kgi-heatmap-enricher.ts's isPlausibleChangePct
 * (2026-07-14 origin), reused here rather than duplicated logic diverging. */
const DAILY_LIMIT_PCT = 10.5;

/** Tolerance for "does changePct arithmetically match change/prevClose" —
 * same convention as twse-openapi-client.ts's INDEX_CONSISTENCY_TOLERANCE_PCT. */
const ARITHMETIC_TOLERANCE_PCT = 0.15;

/** No legitimate single-day TW equity close can be more than 3x or less than
 * 1/3 of a trusted reference price — the daily ±10% limit band forbids it
 * definitionally. Any close this far from a reference is corrupted upstream
 * data (e.g. a comma-truncation-style bug), independent of what any other
 * field claims. */
const MAGNITUDE_ANOMALY_RATIO = 3;

/**
 * Structural invariant #1: a quote is only "verified" when close, change,
 * and changePct are ALL present and arithmetically self-consistent within
 * the daily limit band. A tile with a price but null/0 change treated as
 * valid — the exact bug class `no_data` gating (#1297) exists to prevent —
 * must fail this check.
 */
export function verifyQuoteTuple(candidate: QuoteCandidate): QuoteVerificationResult {
  const { source, tradeDate, close, change, changePct } = candidate;
  if (!tradeDate) return { verified: false, reason: "missing_trade_date" };
  if (close === null || !Number.isFinite(close) || close <= 0) {
    return { verified: false, reason: "missing_close" };
  }
  if (change === null || changePct === null || !Number.isFinite(change) || !Number.isFinite(changePct)) {
    return { verified: false, reason: "missing_change_or_pct" };
  }
  const impliedPrevClose = close - change;
  if (impliedPrevClose <= 0) return { verified: false, reason: "changePct_arithmetic_mismatch" };
  const derivedPct = (change / impliedPrevClose) * 100;
  if (Math.abs(derivedPct - changePct) > ARITHMETIC_TOLERANCE_PCT) {
    return { verified: false, reason: "changePct_arithmetic_mismatch" };
  }
  if (Math.abs(changePct) > DAILY_LIMIT_PCT) {
    return { verified: false, reason: "changePct_exceeds_daily_limit" };
  }
  return { verified: true, source, tradeDate, close, change, changePct };
}

/**
 * Structural invariant #2: catches "known large-cap showing a single digit"
 * even when the arithmetic in verifyQuoteTuple() happens to look consistent
 * (e.g. a corrupted close paired with an equally-corrupted change that
 * still divides out to something inside the ±10.5% band by coincidence).
 * `referenceClose` should be a trusted recent price for the SAME symbol
 * (e.g. our own last-known-good cache, or an independent source) — if none
 * is available, this returns true (can't disprove, not a false accusation).
 */
export function isPriceMagnitudePlausible(close: number, referenceClose: number | null | undefined): boolean {
  if (referenceClose == null || !Number.isFinite(referenceClose) || referenceClose <= 0) return true;
  const ratio = close / referenceClose;
  return ratio >= 1 / MAGNITUDE_ANOMALY_RATIO && ratio <= MAGNITUDE_ANOMALY_RATIO;
}

/**
 * A candidate's changePct is ambiguous-by-construction and needs an
 * independent cross-check before being trusted. Kept intentionally narrow
 * (exact-zero only) — the overwhelming majority of changePct values need no
 * extra network round-trip; only the "is this really flat, or is the Change
 * field just not computed yet" case (2395) does.
 */
export function needsIndependentCrossCheck(changePct: number | null): boolean {
  return changePct === 0;
}

/**
 * Structural invariant #3 (fail-CLOSED — 2026-07-17 Round 2, the 2395
 * lesson): a suspicious value is trustworthy ONLY when an INDEPENDENT
 * source confirms it. Never falls back to "accept because we can't
 * disprove it" — that was the exact loophole in #1297 Round 1's same-source
 * `isZeroChangePlausible()`. No independent confirmation available, or the
 * independent source disagrees ⇒ not trustworthy, full stop.
 */
export function crossValidateWithIndependentSource(
  close: number,
  independentPrevClose: number | null | undefined
): { trustworthy: boolean; reason: IntegrityRejectionReason | null } {
  if (independentPrevClose == null || !Number.isFinite(independentPrevClose) || independentPrevClose <= 0) {
    return { trustworthy: false, reason: "independent_source_unavailable" };
  }
  const tolerance = Math.max(0.01, independentPrevClose * 0.001);
  const matches = Math.abs(independentPrevClose - close) <= tolerance;
  return matches ? { trustworthy: true, reason: null } : { trustworthy: false, reason: "independent_source_mismatch" };
}

/**
 * Structural invariant #4: the single authoritative trade date every
 * consumer (banner text, index panel, heatmap tiles) must derive from, so
 * they cannot structurally disagree the way "banner 顯示 07/16 但磚/指數是
 * 07/17" did (three independently-fetched TWSE upstream datasets — MI_INDEX
 * via /market/overview/twse, market-data/overview's marketContext.index,
 * and STOCK_DAY_ALL behind the heatmap tiles — each guessed its own date
 * from its own fetch timing). Picks the single NEWEST known-valid
 * (Taipei-calendar-date) candidate; ties/missing dates fall through in
 * array order (first valid one wins) since a true tie carries no
 * information to prefer one source over another.
 */
export function resolveAuthoritativeTradeDate(
  candidates: Array<{ source: string; tradeDate: string | null }>
): { tradeDate: string | null; chosenSource: string | null } {
  let best: { source: string; tradeDateKey: string; tradeDate: string } | null = null;
  for (const candidate of candidates) {
    const key = taipeiCalendarDateKey(candidate.tradeDate);
    if (!key || !candidate.tradeDate) continue;
    if (!best || key > best.tradeDateKey) {
      best = { source: candidate.source, tradeDateKey: key, tradeDate: candidate.tradeDate };
    }
  }
  return best ? { tradeDate: best.tradeDate, chosenSource: best.source } : { tradeDate: null, chosenSource: null };
}

const TAIPEI_TZ = "Asia/Taipei";

function taipeiCalendarDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: TAIPEI_TZ });
}
