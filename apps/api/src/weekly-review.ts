/**
 * Weekly review (復盤閉環 B4) — the "可檢討" leg of the product north star.
 *
 * v1 is deliberately quantitative-only and computed on demand:
 *   - no LLM (zero budget, zero hallucination surface)
 *   - no new tables (every number is reproducible from existing stores)
 *   - honest nulls + notes whenever a source can't answer
 *
 * Sections:
 *   1. TAIEX week timeline — official daily closes (MI_5MINS_HIST)
 *   2. F-AUTO / S1 SIM week performance — audit-rebuilt positions, mark-to-market
 *   3. AI recommendation scorecard — week slice + cumulative (ai_rec_pick_snapshots)
 *   4. Brief delivery — which trading days got a published brief
 */

import { getTaiexDailyCloses } from "./data-sources/twse-openapi-client.js";
import { buildS1PositionsSnapshot, resolveS1SimCapitalTwd } from "./s1-sim-runner.js";
import { getAiRecPerformance, type AiRecPerfResult } from "./ai-rec-perf-store.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface WeeklyReviewTaiexDay {
  date: string;
  close: number;
  change: number | null;
  changePct: number | null;
}

export interface WeeklyReview {
  schema: "weekly_review_v1";
  week_start: string; // Monday (ISO)
  week_end: string;   // Friday (ISO)
  generated_at: string;
  sim_only: true;
  taiex: {
    days: WeeklyReviewTaiexDay[];
    week_change_pct: number | null;
  };
  f_auto: {
    available: boolean;
    positions_date: string | null;
    data_source: string | null;
    positions_count: number;
    capital_twd: number | null;
    cash_residual_twd: number | null;
    total_market_value_twd: number | null;
    total_unrealized_pnl_twd: number | null;
    week_return_pct: number | null; // unrealized PnL / capital, this week's basket
    positions: Array<{
      symbol: string;
      shares: number;
      avg_cost: number;
      last_price: number | null;
      unrealized_pnl_twd: number | null;
    }>;
    notes: string[];
  };
  recommendations: {
    week: AiRecPerfResult;
    cumulative: AiRecPerfResult;
  };
  briefs: {
    trading_days: string[];      // TAIEX trading days in the week
    published_dates: string[];   // days with a published brief AND a real trading day
    missing_dates: string[];
    off_calendar_published: string[]; // briefs published on a day TAIEX has no close for (P1-8)
  };
  notes: string[];
}

/** Monday of the ISO week containing `date` (ISO YYYY-MM-DD, Taipei-naive). */
function mondayOf(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayTaipeiIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

/**
 * Resolve the review week for an optional anchor date. Defaults to the week
 * containing today (Taipei); an anchor inside any past week reviews that week.
 */
export function resolveReviewWeek(anchor?: string): { weekStart: string; weekEnd: string } {
  const base = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? anchor : todayTaipeiIso();
  const weekStart = mondayOf(base);
  return { weekStart, weekEnd: addDays(weekStart, 4) };
}

/**
 * P1-8 (2026-07-11 product critique): `tradingDays` must come ONLY from the
 * official TAIEX daily-close calendar (`taiexDates` — TWSE only publishes an
 * OHLC row for a date the market actually opened), never from
 * `publishedBriefDates`. The previous implementation unioned the two, which
 * meant a brief mistakenly published on a non-trading day (07/10 typhoon
 * closure — the pipeline's `isTwTradingDay` gate only checks a pre-seeded
 * calendar table, which isn't seeded for ad-hoc closures) silently counted
 * as proof of a trading day. Because that same date was also in
 * `publishedBriefDates`, the denominator and numerator inflated together —
 * "本週發布 5/5 個交易日" looked like a perfect record while hiding the
 * exact bug it should have caught. A brief published outside the real
 * calendar is now surfaced separately in `offCalendarPublished` instead of
 * silently padding the ratio.
 */
export function deriveBriefDeliveryDays(
  taiexDates: string[],
  publishedBriefDates: string[],
  weekStart: string,
  weekEnd: string,
): { tradingDays: string[]; published: string[]; missing: string[]; offCalendarPublished: string[] } {
  const inWeek = (date: string) => date >= weekStart && date <= weekEnd;
  const tradingDays = [...new Set(taiexDates.filter(inWeek))].sort();
  const publishedInWeek = publishedBriefDates.filter(inWeek);
  const published = [...new Set(publishedInWeek.filter((date) => tradingDays.includes(date)))].sort();
  const missing = tradingDays.filter((date) => !published.includes(date));
  const offCalendarPublished = [...new Set(publishedInWeek.filter((date) => !tradingDays.includes(date)))].sort();
  return { tradingDays, published, missing, offCalendarPublished };
}

export async function buildWeeklyReview(opts: {
  anchorDate?: string;
  workspaceId: string;
  /** Published brief dates (ISO), injected by the route from the repo. */
  publishedBriefDates: string[];
}): Promise<WeeklyReview> {
  const { weekStart, weekEnd } = resolveReviewWeek(opts.anchorDate);
  const notes: string[] = [];
  const today = todayTaipeiIso();
  const isCurrentWeek = weekStart <= today && today <= addDays(weekEnd, 2); // weekend after counts as current

  // 1. TAIEX timeline (rows[0] is the lead-in close before weekStart when available)
  const closes = await getTaiexDailyCloses(weekStart, weekEnd);
  const days: WeeklyReviewTaiexDay[] = [];
  for (let i = 0; i < closes.length; i++) {
    const row = closes[i];
    if (row.date < weekStart) continue;
    const prev = i > 0 ? closes[i - 1] : null;
    days.push({
      date: row.date,
      close: row.close,
      change: prev ? round2(row.close - prev.close) : null,
      changePct: prev ? round2(((row.close - prev.close) / prev.close) * 100) : null,
    });
  }
  const leadIn = closes.length > 0 && closes[0].date < weekStart ? closes[0] : null;
  const weekChangePct = leadIn && days.length > 0
    ? round2(((days[days.length - 1].close - leadIn.close) / leadIn.close) * 100)
    : null;
  if (days.length === 0) notes.push("taiex_unavailable: MI_5MINS_HIST returned no rows for this week");

  // 2. F-AUTO week performance. buildS1PositionsSnapshot reconstructs the
  // *current* week's basket from the audit log; past weeks are not
  // reconstructable yet (positions files are ephemeral) — say so instead of
  // showing the wrong week's numbers.
  let fAuto: WeeklyReview["f_auto"] = {
    available: false, positions_date: null, data_source: null, positions_count: 0,
    capital_twd: null, cash_residual_twd: null, total_market_value_twd: null,
    total_unrealized_pnl_twd: null, week_return_pct: null, positions: [], notes: [],
  };
  if (isCurrentWeek) {
    try {
      const [snap, capitalCfg] = await Promise.all([
        buildS1PositionsSnapshot(),
        resolveS1SimCapitalTwd(opts.workspaceId),
      ]);
      const capitalTwd = capitalCfg.capitalTwd;
      fAuto = {
        available: true,
        positions_date: snap.positionsDate,
        data_source: snap.dataSource,
        positions_count: snap.positions.length,
        capital_twd: capitalTwd,
        cash_residual_twd: snap.cashResidualTwd,
        total_market_value_twd: snap.totalMarketValueTwd,
        total_unrealized_pnl_twd: snap.totalUnrealizedPnlTwd,
        week_return_pct: snap.totalUnrealizedPnlTwd != null && capitalTwd > 0
          ? round2((snap.totalUnrealizedPnlTwd / capitalTwd) * 100)
          : null,
        positions: snap.positions.map((p) => ({
          symbol: p.symbol, shares: p.shares, avg_cost: p.avg_cost,
          last_price: p.last_price, unrealized_pnl_twd: p.unrealized_pnl_twd,
        })),
        notes: snap.notes,
      };
    } catch (e) {
      notes.push(`f_auto_unavailable: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`);
    }
  } else {
    notes.push("f_auto_historical_not_supported: position reconstruction only covers the current week (audit window)");
  }

  // 3. Recommendation scorecard — week slice + cumulative
  const [week, cumulative] = await Promise.all([
    getAiRecPerformance({ fromDate: weekStart, toDate: weekEnd }),
    getAiRecPerformance({}),
  ]);

  // 4. Brief delivery vs trading days
  const { tradingDays, published, missing, offCalendarPublished } = deriveBriefDeliveryDays(
    days.map((d) => d.date),
    opts.publishedBriefDates,
    weekStart,
    weekEnd,
  );
  if (offCalendarPublished.length > 0) {
    notes.push(`brief_published_off_calendar: ${offCalendarPublished.join(", ")} 有簡報發布紀錄，但 TAIEX 官方收盤資料顯示當日並非交易日（不計入交易日分母）`);
  }

  return {
    schema: "weekly_review_v1",
    week_start: weekStart,
    week_end: weekEnd,
    generated_at: new Date().toISOString(),
    sim_only: true,
    taiex: { days, week_change_pct: weekChangePct },
    f_auto: fAuto,
    recommendations: { week, cumulative },
    briefs: {
      trading_days: tradingDays,
      published_dates: published,
      missing_dates: missing,
      off_calendar_published: offCalendarPublished,
    },
    notes,
  };
}
