/**
 * index-snapshot-freshness.ts — 2026-07-17 data-honesty gating fix
 *
 * 楊董抓到：首頁頂 banner 顯示「07/16 (四) 收盤」但同一頁的熱力圖磚顯示
 * 07/17 資料 — banner 日期跟 tile 日期不一致。
 *
 * Root cause: `/market/overview/twse` (MI_INDEX-derived TAIEX index) and
 * `market-data/overview`'s `marketContext.index` (the SAME backend response
 * that produces `marketContext.heatmap`, i.e. the data behind the visible
 * heatmap tiles) are two INDEPENDENTLY-fetched TWSE upstream datasets. They
 * can publish on different schedules and disagree by a whole trading
 * session — each is individually honest (correctly labeled with its own
 * true date), but together they can confuse the user.
 *
 * Fix: `readMarketIndex()` in app/page.tsx prefers marketContext.index's
 * own price+date as ONE atomic unit whenever it is genuinely a newer trade
 * date than the twseOverview snapshot — this never mixes a price from one
 * snapshot with a date from the other (that would reintroduce the 6/10
 * sign-contradiction bug class — see heatmap-consistency.test.ts on the
 * API side), and keeps the banner date consistent with the tiles the user
 * is actually looking at (both come from the same request).
 *
 * 2026-07-17 Round 2 (楊董升級 — 治本閘門, not another single-symbol patch):
 * the SAME date-mismatch disease also hit `<MarketStateBanner />`, called
 * with NO props at page.tsx — it fell back to its OWN independent
 * client-side `getMarketDataOverview()` fetch, entirely decoupled from the
 * server-rendered `market`/`realtimeMarket` data everything else on the
 * page already uses. `resolveAuthoritativeTradeDate()` below is the
 * frontend half of the mirror-image backend gate
 * (`apps/api/src/market-data-integrity-gate.ts`) — the ONE trade date every
 * consumer (banner text, index panel, heatmap tiles) must derive from, so
 * they cannot structurally disagree. `readMarketIndex()` now uses this
 * n-way resolver (superseding the old pairwise isNewerTaipeiTradeDate call
 * site), and its resolved `updatedAt` is passed directly into
 * `<MarketStateBanner lastCloseDate={...} />`, eliminating the redundant
 * independent fetch entirely.
 */

import { getMarketDataOverview, getTwseMarketOverview } from "./api";
import { taipeiCalendarDate } from "./taipei-date";

/**
 * Returns true when `candidate`'s Taipei calendar date is strictly newer
 * than `current`'s. An unparseable/missing `candidate` is never "newer"; an
 * unparseable/missing `current` with a valid `candidate` counts as newer
 * (nothing to lose by preferring the one we CAN date).
 */
export function isNewerTaipeiTradeDate(
  candidate: string | null | undefined,
  current: string | null | undefined
): boolean {
  const candidateDate = taipeiCalendarDate(candidate);
  const currentDate = taipeiCalendarDate(current);
  if (!candidateDate) return false;
  if (!currentDate) return true;
  return candidateDate > currentDate;
}

/**
 * The single authoritative trade date every display surface must derive
 * from (mirror of `resolveAuthoritativeTradeDate()` in
 * `apps/api/src/market-data-integrity-gate.ts`). Picks the candidate with
 * the newest known-valid Taipei calendar date; a candidate with no
 * parseable date is never chosen over one that has one. Returns `null`
 * (never a wall-clock guess) when no candidate has a valid date.
 */
export function resolveAuthoritativeTradeDate(
  candidates: Array<{ source: string; tradeDate: string | null | undefined }>
): { tradeDate: string | null; chosenSource: string | null } {
  let best: { source: string; dateKey: string; tradeDate: string } | null = null;
  for (const candidate of candidates) {
    const key = taipeiCalendarDate(candidate.tradeDate);
    if (!key || !candidate.tradeDate) continue;
    if (!best || key > best.dateKey) {
      best = { source: candidate.source, dateKey: key, tradeDate: candidate.tradeDate };
    }
  }
  return best ? { tradeDate: best.tradeDate, chosenSource: best.source } : { tradeDate: null, chosenSource: null };
}

/**
 * 2026-07-18 wave2: `/companies/[symbol]` and `/ai-recommendations` rendered
 * a bare `<MarketStateBanner />` with no `lastCloseDate` prop, so it fell
 * back to its own single-source client fetch (`marketContext.index.timestamp`
 * only) — the same disease `resolveAuthoritativeTradeDate()` fixed for the
 * homepage banner. This is the lightweight, page-agnostic version of
 * `MarketStateBannerSection` in `app/page.tsx`: fetch just the two date
 * sources (no heatmap/kgi machinery those pages don't need), resolve, and
 * return a `lastCloseDate` prop. Fail-open (never throws — the banner is
 * cosmetic; a resolution failure should fall back to the component's own
 * single-source client fetch rather than break the page).
 *
 * 2026-07-18 追查（company/airec 仍顯 07/16，homepage 顯 07/17 的真根因）：
 * 這支函式本身的候選比較邏輯（`resolveAuthoritativeTradeDate` 用 Taipei 日曆
 * 日比較）從一開始就是對的——不是「跟首頁用不同 resolver」。真正的 bug 在下游：
 * `market_context_index` 候選的 timestamp 是 UTC "Z" 格式（例如
 * "2026-07-16T16:00:00.000Z"，其 Taipei 日曆日其實是 07-17），這個 resolver
 * 選中它後把「原始字串」回傳給呼叫端，呼叫端（`MarketStateBanner` →
 * `formatTradeDateWithWeekday` → 舊版 `formatAsOfDate`）再對這個字串做
 * `slice(0, 10)` 天真截斷，截出的是 UTC 日期「07-16」而非 Taipei 日期
 * 「07-17」。首頁沒踩到是因為它的 KGI 分支拿到的時間戳恰好已經是
 * Taipei-local「+08:00」格式（slice 剛好對），並非首頁的日期邏輯比較高明。
 * 已在 `lib/taipei-date.ts` 收斂成單一 Taipei 日曆日轉換函式，
 * `lib/data-state-copy.ts::formatAsOfDate()` 與
 * `lib/market-state-banner.ts::formatTradeDateWithWeekday()` 的 weekday 推導
 * 都改用它，徹底消滅這個下游 naive-slice 重複實作，而不是再加一個候選來源。
 */
export async function resolveBannerLastCloseDate(): Promise<string | null> {
  const [overview, twse] = await Promise.allSettled([
    getMarketDataOverview({ includeStale: true, topLimit: 1 }),
    getTwseMarketOverview(),
  ]);

  const overviewIndex = overview.status === "fulfilled" ? overview.value.data?.marketContext?.index : null;
  const overviewUsable = overviewIndex && overviewIndex.last !== null && overviewIndex.state !== "EMPTY";
  // getTwseMarketOverview() uses requestRaw() (returns the body directly, unlike
  // request()'s {data: T} envelope) — do not add a redundant `.data` here.
  const twseTaiex = twse.status === "fulfilled" ? twse.value.taiex : null;

  const resolved = resolveAuthoritativeTradeDate([
    { source: "market_context_index", tradeDate: overviewUsable ? overviewIndex!.timestamp : null },
    { source: "twse_overview", tradeDate: twseTaiex?.ts ?? null },
  ]);

  return resolved.tradeDate;
}
