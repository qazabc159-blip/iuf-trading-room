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

const TAIPEI_TZ = "Asia/Taipei";

function taipeiCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: TAIPEI_TZ });
}

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
