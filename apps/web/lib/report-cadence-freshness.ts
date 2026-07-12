// apps/web/lib/report-cadence-freshness.ts — B2 fix (2026-07-12 diagnosis).
//
// full-profile's STALE classification uses one blanket threshold for every
// FinMind dataset. Quarterly financials and monthly revenue release far less
// often than that threshold assumes — a genuinely-current Q1 filing (period end
// 3/31) stays "the latest" until roughly August, but was labeled "資料過期"
// (data expired) for months, alarming operators over normal reporting cadence.
//
// This is display-copy only — it does NOT change or override the backend
// `state` field (still shown honestly as the badge color/label everywhere
// else); it only adds a cadence-aware explanation for [06]/[07] so operators
// can tell "normal reporting lag" apart from "data pipeline actually broken".

const QUARTER_GRACE_DAYS = 120; // TWSE quarterly filings; next quarter isn't due yet within this window
const MONTH_GRACE_DAYS = 45; // TWSE monthly revenue must publish within 10 days of month-end; allow buffer

function daysBetween(fromIso: string, now: Date): number | null {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  return (now.getTime() - from.getTime()) / 86_400_000;
}

/** periodEndDateIso e.g. "2026-03-31" (Q1 period end, as returned in financialStatement.latest.date). */
export function quarterlyReportCadenceNote(periodEndDateIso: string | null | undefined, now: Date = new Date()): string | null {
  if (!periodEndDateIso) return null;
  const days = daysBetween(periodEndDateIso, now);
  if (days === null || days < 0 || days > QUARTER_GRACE_DAYS) return null;
  return `本期為 ${periodEndDateIso} 財報，屬目前最新一季公告；季報通常每季僅公布一次，下一季財報公布前皆為最新資料，並非資料異常。`;
}

/** year/month e.g. 2026, 5 (May revenue, period end 2026-05-31). */
export function monthlyRevenueCadenceNote(
  year: number | null | undefined,
  month: number | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!year || !month) return null;
  const periodEnd = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of `month`
  const days = daysBetween(periodEnd.toISOString(), now);
  if (days === null || days < 0 || days > MONTH_GRACE_DAYS) return null;
  return `本期為 ${year}/${String(month).padStart(2, "0")} 月營收，屬目前最新一期公告；月營收通常每月僅公布一次，並非資料異常。`;
}
