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
 * was the exact bug Pete's #1310 review caught on desk).
 *
 * Pete #1313 review 🔴1 (2026-07-20): the first cut of this function let
 * *any other* non-fresh source (twse_mis/kgi/manual/tradingview quotes that
 * are themselves stale, not routed through the official_close tier) fall
 * through to the final `"live"` branch. This is a real, reachable path —
 * `fetchEffectiveQuoteFallback()` only calls this endpoint once KGI ticks
 * already came back empty, and `includeStale:true` makes
 * `resolveMarketQuotes()` (apps/api/src/market-data.ts) treat *any* cached
 * quote as eligible regardless of age. Result: a genuinely stale twse_mis/
 * kgi/manual quote got labeled "live" with a green pulsing dot — exactly the
 * "假即時" failure mode #1310 fixed on desk, just reintroduced one tier over.
 * Fix: only `freshnessStatus === "fresh"` is ever "live"; every other
 * non-empty case (generic `"stale"`/`"missing"`-with-a-cached-last) gets an
 * honest degraded "來源（略舊）" label — matches desk's own
 * `effectiveQuoteStateLabel()`, which suffixes every non-fresh, non-closed
 * source with "（略舊）" rather than ever calling it live, and `/quote`
 * page's `freshnessLabel()` fresh→"即時"/stale→"略舊" convention.
 */

function fmtCloseDateMD(iso: string | null | undefined): string | null {
  return typeof iso === "string" && iso.length >= 10 ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}` : null;
}

/** Mirrors desk-exact's inline srcLabel mapping — no enum leak to the UI. */
function sourceLabel(source: EffectiveMarketQuote["selectedSource"]): string {
  if (source === "twse_mis") return "證交所";
  if (source === "kgi") return "凱基";
  if (source === "paper") return "模擬";
  if (source === "manual") return "手動資料";
  return "行情";
}

export type EffectiveFallbackCellState =
  | { status: "closed"; lastPrice: number; priceChg: number | null; pctChg: number | null; dateLabel: string }
  | { status: "stale"; lastPrice: number; priceChg: number | null; pctChg: number | null; label: string }
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
  if (item.freshnessStatus !== "fresh") {
    // Generic degraded fallback: any other source (twse_mis/kgi/manual/
    // tradingview) whose own cached quote is itself stale/missing-but-cached.
    // Never "live" — honest "來源（略舊）" label, same convention as desk.
    return { status: "stale", lastPrice: q.last, priceChg, pctChg, label: `${sourceLabel(item.selectedSource)}（略舊）` };
  }
  return { status: "live", lastPrice: q.last, priceChg, pctChg, volume: q.volume ?? 0, time: q.timestamp ?? "" };
}
