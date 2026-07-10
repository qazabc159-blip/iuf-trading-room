/**
 * fauto-nav-pricing-quality.ts — pure helpers for the #1192 `pricingQuality`
 * marker on F-AUTO NAV curve points.
 *
 * Consumed by `apps/web/app/ops/f-auto/FAutoNavPanel.tsx` (shared by
 * `/ops/f-auto` and `/track-record`). Kept as a plain, hook-free module
 * (no React import) so it can be unit-tested directly with fixture arrays,
 * matching the existing `weekly-review-format.ts` / `member-quote-cap.ts`
 * pattern in this codebase.
 *
 * Points/weeks without a `pricingQuality` marker (e.g. `/track-record`'s
 * public whitelist payload, which drops the field entirely, or ledger rows
 * written before #1192) read as "official" — no badge, no noise. Only
 * "mis_fallback_full" surfaces a badge.
 */
import type { NavCurvePoint } from "./fauto-sim-api";

export const PRICING_QUALITY_REASON = "以驗證行情回退計算（非官方收盤）";

export function hasDegradedPricing(navCurve: NavCurvePoint[]): boolean {
  return navCurve.some((p) => p.pricingQuality === "mis_fallback_full");
}

export function degradedPricingCount(navCurve: NavCurvePoint[]): number {
  return navCurve.filter((p) => p.pricingQuality === "mis_fallback_full").length;
}

export function weekHasDegradedPricing(weekNum: number, navCurve: NavCurvePoint[]): boolean {
  return navCurve.some((p) => p.weekNum === weekNum && p.pricingQuality === "mis_fallback_full");
}
