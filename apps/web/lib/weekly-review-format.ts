/**
 * Pure formatting + week-navigation helpers for the /reviews weekly review panel.
 * Consumes `WeeklyReview` (schema "weekly_review_v1") from GET /api/v1/reviews/weekly.
 * No React, no fetch — keeps the panel component thin and testable.
 */

/** 7 days before/after the given ISO date (anchor for prev/next week nav). */
export function shiftWeekAnchor(dateIso: string, deltaWeeks: 1 | -1): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7);
  return d.toISOString().slice(0, 10);
}

/** MM/DD for a YYYY-MM-DD date string. */
export function formatMonthDay(dateIso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return dateIso;
  return `${m[1]}/${m[2]}`;
}

/** TWD amount with thousands separator and sign; null -> placeholder. */
export function formatTwdSigned(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(Math.round(value)).toLocaleString("zh-TW")}`;
}

/** Plain TWD amount with thousands separator; null -> placeholder. */
export function formatTwdPlain(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return Math.round(value).toLocaleString("zh-TW");
}

/** Percent with 2 decimals and explicit sign; null -> placeholder. */
export function formatSignedPct2(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Percent (already 0-100 scale) with 2 decimals, no sign; null -> placeholder. */
export function formatPct2(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}%`;
}

/**
 * Fraction (0-1 scale, e.g. hit rate) -> percent string with 1 decimal.
 * Returns "--" for null/NaN so small-sample fields stay honest.
 */
export function formatFractionPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Same as formatFractionPct but with explicit + sign for excess returns. */
export function formatSignedFractionPct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "--";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

/** CSS color tone for a signed number: positive -> ok (green/TW-down), negative -> bad (red/TW-up), 0/null -> neutral. */
export function signTone(value: number | null): "ok" | "bad" | "dim" {
  if (value === null || !Number.isFinite(value) || value === 0) return "dim";
  return value > 0 ? "ok" : "bad";
}

/**
 * Translate the backend's `f_auto.data_source` enum into honest product copy.
 * Never surface raw engineering strings ("kgi_gateway" / "audit_log_rebuild") to the UI.
 */
export function fAutoDataSourceLabel(dataSource: string | null): string {
  if (dataSource === "kgi_gateway") return "即時讀取";
  if (dataSource?.includes("audit") || dataSource === "orders_submitted_audit_rebuilt") {
    return "依稽核成交紀錄重建";
  }
  return "資料來源待確認";
}

/** "N/M 個交易日" delivery summary for the brief section. */
export function briefDeliverySummary(publishedCount: number, tradingDaysCount: number): string {
  return `${publishedCount}/${tradingDaysCount} 個交易日`;
}
