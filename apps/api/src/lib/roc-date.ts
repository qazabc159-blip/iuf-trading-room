/**
 * roc-date.ts — Shared ROC (Republic of China / Minguo) calendar date parser
 * for TWSE/TPEX EOD wire formats.
 *
 * Extracted 2026-07-10 from two parallel, independently-maintained copies
 * (s1-sim-runner.ts `_parseRocEodDateIso`, server.ts `_rocDateToIso`) per
 * Pete's #1192 review note: two parsers evolving in parallel is exactly the
 * failure mode behind the 2026-07-09 dumb-guard bug — only one of the two
 * copies had been updated to also accept the compact 7-digit wire format, so
 * the un-updated copy silently returned `null` and its date guard never
 * actually fired against live traffic.
 *
 * Both official EOD sources (TWSE STOCK_DAY_ALL, TPEX daily_close_quotes) have
 * shipped two wire formats historically:
 *   - compact 7-digit ROC, no separator: "1150709" (current, live-verified 2026-07-09)
 *   - legacy slash-separated ROC: "115/07/09" (also un-padded "115/7/9")
 *
 * Returns `null` for anything that doesn't match a known shape — callers
 * treat `null` as "unvalidated" (same as "no date to check"), never as an
 * exception.
 */
export function parseRocEodDateIso(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  const slashParts = trimmed.split("/");
  if (slashParts.length === 3) {
    const year = parseInt(slashParts[0]!, 10) + 1911;
    if (!Number.isFinite(year) || year <= 1900) return null;
    return `${year}-${slashParts[1]!.padStart(2, "0")}-${slashParts[2]!.padStart(2, "0")}`;
  }
  if (/^\d{7}$/.test(trimmed)) {
    const year = parseInt(trimmed.slice(0, 3), 10) + 1911;
    return `${year}-${trimmed.slice(3, 5)}-${trimmed.slice(5, 7)}`;
  }
  return null;
}
