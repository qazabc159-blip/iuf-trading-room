import type { EffectiveMarketQuote } from "@/lib/api";

/**
 * Pure derivation of a mobile watchlist cell's display state from a single
 * `/api/v1/market-data/effective-quotes` item (2026-07-20).
 *
 * Mirrors `apps/web/public/desk-exact/index.html`'s `effectiveQuoteStateLabel()`
 * + watchlist fallback priority (2026-07-16/19 #1307/#1309/#1310 — same
 * incident lineage): `closed_snapshot` is a legitimate off-hours closing price
 * (weekend/holiday/outside session), `official_close` + `stale` is a live-feed
 * interruption that fell back to the last close. Both must show the real
 * price with an honest "MM/DD 收盤" label — never silently look "live" (that
 * was the exact bug Pete's #1310 review caught on desk). Anything else with a
 * usable last price is genuinely live; anything with no usable last price is
 * genuinely empty — no data to fabricate.
 */

function fmtCloseDateMD(iso: string | null | undefined): string | null {
  return typeof iso === "string" && iso.length >= 10 ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : null;
}

export type EffectiveFallbackCellState =
  | { status: "closed"; lastPrice: number; priceChg: number | null; pctChg: number | null; dateLabel: string }
  | { status: "live"; lastPrice: number; priceChg: number | null; pctChg: number | null; volume: number; time: string }
  | { status: "empty" };

export function deriveEffectiveFallbackCellState(
  item: EffectiveMarketQuote | undefined
): EffectiveFallbackCellState {
  const q = item?.selectedQuote;
  if (!item || !q || q.last == null) return { status: "empty" };

  const priceChg = q.prevClose != null ? q.last - q.prevClose : null;
  const pctChg = q.changePct ?? null;

  if (item.freshnessStatus === "closed_snapshot") {
    const d = fmtCloseDateMD(item.closedSnapshotTradeDate);
    return { status: "closed", lastPrice: q.last, priceChg, pctChg, dateLabel: d ? `${d} 收盤` : "收盤快照" };
  }
  if (item.selectedSource === "official_close" && item.freshnessStatus === "stale") {
    const d = fmtCloseDateMD(item.closedSnapshotTradeDate);
    return {
      status: "closed",
      lastPrice: q.last,
      priceChg,
      pctChg,
      dateLabel: d ? `${d} 收盤（即時中斷）` : "收盤價（即時中斷）",
    };
  }
  return { status: "live", lastPrice: q.last, priceChg, pctChg, volume: q.volume ?? 0, time: q.timestamp ?? "" };
}
