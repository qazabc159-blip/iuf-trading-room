"use client";

// MobileKgiWatchlist — 手機版 KGI 即時報價 watchlist
// 15s poll, 6-state (loading/live/closed/stale/blocked/empty), mobile-optimised
// large numbers. Default watchlist: 0050 / 2330 / 2454 (top-3 liquidity).
// "closed" = effective-quotes closed_snapshot/official_close+stale fallback (real
// last-close price, honest "MM/DD 收盤" label) — 2026-07-20, mirrors desk-exact.
// "stale" = any other effective-quotes source (twse_mis/kgi/manual/tradingview)
// whose own cached quote isn't fresh — real price, honest "來源（略舊）" label,
// never "live" (Pete #1313 review 🔴1 — this must never be mislabeled live).
// Hard rule: NO fake / mock data. Shows BLOCKED if gateway unreachable and no
// closing-price fallback exists either.
// 2026-07-20 盤中 P0: a KGI tick with a frozen buffer (no push since a prior
// session — see kgi-tick-freshness.ts) is treated the same as a missing tick
// and routed through the effective-quotes fallback, instead of being shown
// directly just because it has *a* value.

import { useCallback, useEffect, useRef, useState } from "react";

import { formatMobileKgiBlockedReason } from "./mobile-kgi-copy";
import { deriveEffectiveFallbackCellState } from "./mobile-quote-effective-fallback";
import { isKgiTickFreshEnoughToTrust } from "./kgi-tick-freshness";
import { isKgiGatewayScheduledOff } from "@/lib/kgi-trading-hours";
import { getEffectiveQuotes } from "@/lib/api";
import { DataStateBadge } from "@/components/DataStateBadge";

type QuoteState =
  | { status: "loading" }
  | { status: "live"; lastPrice: number; priceChg: number; pctChg: number; volume: number; time: string }
  | { status: "closed"; lastPrice: number; priceChg: number | null; pctChg: number | null; dateLabel: string }
  | { status: "stale"; lastPrice: number; priceChg: number | null; pctChg: number | null; label: string }
  | { status: "blocked"; reason: string }
  | { status: "empty" };

type WatchItem = { symbol: string; label: string };

const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: "0050", label: "元大台灣50" },
  { symbol: "2330", label: "台積電" },
  { symbol: "2454", label: "聯發科" },
];

const POLL_MS = 15_000;
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

const WATCHLIST_CSS = `
  ._mob-kgi-section {
    padding: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  ._mob-kgi-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  ._mob-kgi-code {
    font-size: 10px;
    color: #ffb800;
    font-weight: 600;
    font-family: var(--mono, monospace);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  ._mob-kgi-right {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    font-family: var(--mono, monospace);
  }
  ._mob-kgi-ticker-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    background: rgba(255,255,255,0.06);
    margin: 10px 12px;
    border-radius: 8px;
    overflow: hidden;
  }
  ._mob-kgi-ticker-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 14px 8px 12px;
    background: rgba(0,0,0,0.35);
    gap: 4px;
    min-height: 88px;
    text-align: center;
  }
  ._mob-kgi-symbol {
    font-size: 13px;
    font-weight: 700;
    color: rgba(255,255,255,0.55);
    font-family: var(--mono, monospace);
    line-height: 1;
  }
  ._mob-kgi-price {
    font-size: 26px;
    font-weight: 800;
    font-family: var(--mono, monospace);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    margin: 3px 0;
  }
  ._mob-kgi-price.up { color: #ef5350; }
  ._mob-kgi-price.dn { color: #4caf50; }
  ._mob-kgi-price.flat { color: rgba(255,255,255,0.75); }
  ._mob-kgi-price.loading { color: rgba(255,255,255,0.2); }
  ._mob-kgi-price.blocked { color: rgba(255,255,255,0.2); }
  ._mob-kgi-chg {
    font-size: 12px;
    font-weight: 600;
    font-family: var(--mono, monospace);
    line-height: 1;
  }
  ._mob-kgi-chg.up { color: #ef5350; }
  ._mob-kgi-chg.dn { color: #4caf50; }
  ._mob-kgi-chg.flat { color: rgba(255,255,255,0.4); }
  ._mob-kgi-vol {
    font-size: 10px;
    color: rgba(255,255,255,0.35);
    font-family: var(--mono, monospace);
    line-height: 1;
    margin-top: 2px;
  }
  ._mob-kgi-live-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4caf50;
    margin-right: 5px;
    animation: _mkq-pulse 2s ease-in-out infinite;
    vertical-align: middle;
  }
  @keyframes _mkq-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    ._mob-kgi-live-dot { animation: none; }
  }
`;

function priceTone(chg: number): "up" | "dn" | "flat" {
  if (chg > 0) return "up";
  if (chg < 0) return "dn";
  return "flat";
}

function signed(v: number, d = 2): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(d)}`;
}

function fmtVol(v: number): string {
  if (v >= 10000) return `${(v / 10000).toFixed(1)}萬`;
  return v.toLocaleString();
}

type TickerQuotes = Record<string, QuoteState>;

async function fetchQuoteForSymbol(symbol: string): Promise<QuoteState> {
  try {
    // Use the ticks endpoint — last tick has close/price_chg/pct_chg/volume
    const qs = new URLSearchParams({ symbol, limit: "1" }).toString();
    const res = await fetch(apiUrl(`/api/v1/kgi/quote/ticks?${qs}`), { cache: "no-store", credentials: "include" });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      return { status: "blocked", reason: formatMobileKgiBlockedReason(res.status, txt) };
    }
    const data = await res.json() as {
      symbol: string;
      ticks: Array<{ close?: number; price_chg?: number; pct_chg?: number; volume?: number; datetime?: string }>;
      count: number;
      // Envelope-level staleness (sibling to "ticks", not per-tick — see
      // apps/api/src/broker/kgi-quote-client.ts classifyFreshness()).
      stale?: boolean;
      freshness?: string;
      staleSince?: string | null;
    };
    if (!data.ticks || data.ticks.length === 0) {
      return { status: "blocked", reason: "尚無 tick（未訂閱）" };
    }
    const tick = data.ticks[0];
    if (!tick.close) {
      return { status: "empty" };
    }
    // 2026-07-20 盤中 P0: a frozen buffer (no push since a prior session —
    // e.g. still showing Friday's close on Monday) must NOT be treated as
    // "live" just because it has a value. Route it through the same
    // effective-quotes fallback as a missing tick so the (correctly
    // freshness-arbitrated) twse_mis value wins instead — see
    // kgi-tick-freshness.ts docstring for why this isn't just `!data.stale`.
    if (!isKgiTickFreshEnoughToTrust(data)) {
      return { status: "empty" };
    }
    return {
      status: "live",
      lastPrice: tick.close,
      priceChg: tick.price_chg ?? 0,
      pctChg: tick.pct_chg ?? 0,
      volume: tick.volume ?? 0,
      time: tick.datetime ?? "",
    };
  } catch {
    return { status: "blocked", reason: "連線暫停" };
  }
}

// KGI ticks has no built-in fallback (mirrors apps/web/public/desk-exact/index.html's
// fetchEffectiveQuotes() — 2026-07-16 診斷 #1). When ticks has nothing usable for a
// symbol (blocked/empty/scheduled-off/frozen — see kgi-tick-freshness.ts), batch-fetch
// the twse_mis/official_close backed effective-quotes endpoint once for all such
// symbols instead of leaving the cell on a bare "--". Only overrides symbols where the
// fallback actually has a usable price — otherwise the original ticks-derived
// blocked/empty state (with its more specific reason text) stands.
//
// 2026-07-20 盤中 P0 root cause (Pete #1313 review 🔴1 was only half-fixed): this used
// to pass includeStale:true, which makes resolveMarketQuotes() (apps/api/src/
// market-data.ts) treat ANY cached quote as eligible regardless of age and select
// purely by SOURCE PRIORITY, not recency — so a stale higher-priority kgi quote could
// win over a genuinely fresh lower-priority twse_mis quote (exactly what desk-exact
// saw: a frozen Friday kgi price with an honest "略舊" label instead of the fresh
// twse_mis value). Without includeStale, the primary selection only ever picks a
// FRESH candidate (any source) or nothing — leaving "nothing" to the route-level
// official_close/closed_snapshot fallback, which already arbitrates by recency
// correctly (#1315). This matches desk-exact's own fetchEffectiveQuotes(), which never
// passed includeStale in the first place.
async function fetchEffectiveQuoteFallback(symbols: string[]): Promise<Record<string, QuoteState>> {
  if (symbols.length === 0) return {};
  try {
    const res = await getEffectiveQuotes({ symbols: symbols.join(",") });
    const bySymbol = new Map(res.data.items.map((item) => [item.symbol, item]));
    const map: Record<string, QuoteState> = {};
    for (const symbol of symbols) {
      const derived = deriveEffectiveFallbackCellState(bySymbol.get(symbol));
      if (derived.status === "empty") continue;
      if (derived.status === "closed" || derived.status === "stale") {
        map[symbol] = derived;
      } else {
        map[symbol] = { status: "live", lastPrice: derived.lastPrice, priceChg: derived.priceChg ?? 0, pctChg: derived.pctChg ?? 0, volume: derived.volume, time: derived.time };
      }
    }
    return map;
  } catch {
    return {};
  }
}

function TickerCell({ item, q }: { item: WatchItem; q: QuoteState }) {
  if (q.status === "loading") {
    return (
      <div className="_mob-kgi-ticker-cell">
        <div className="_mob-kgi-symbol">{item.symbol}</div>
        <div className={`_mob-kgi-price loading`}>--.-</div>
        <div className="_mob-kgi-chg flat">--</div>
        <div className="_mob-kgi-vol"><DataStateBadge state="empty" label="載入中…" testId="mob-kgi-loading-badge" /></div>
      </div>
    );
  }
  if (q.status === "closed") {
    // Off-hours / intraday-interruption fallback (effective-quotes closed_snapshot
    // or official_close+stale) — real last-close price, honest "MM/DD 收盤" label
    // in place of the volume line. Never paired with a bare "--" (that pairing was
    // the pre-2026-07-20 bug: schedule-off state showed no price at all).
    const tone = q.priceChg != null ? priceTone(q.priceChg) : "flat";
    return (
      <div className="_mob-kgi-ticker-cell">
        <div className="_mob-kgi-symbol">{item.symbol}</div>
        <div className={`_mob-kgi-price ${tone}`}>{q.lastPrice.toFixed(2)}</div>
        <div className={`_mob-kgi-chg ${tone}`}>
          {q.priceChg != null && q.pctChg != null ? `${signed(q.priceChg)} (${signed(q.pctChg)}%)` : "--"}
        </div>
        <div className="_mob-kgi-vol" style={{ color: "#ffb800", fontSize: 9 }}>{q.dateLabel}</div>
      </div>
    );
  }
  if (q.status === "stale") {
    // Generic non-fresh effective-quotes fallback (twse_mis/kgi/manual/tradingview
    // whose own cached quote isn't fresh) — real price, honest "來源（略舊）" label.
    // Pete #1313 review 🔴1: this must never be folded into the "live" branch below.
    const tone = q.priceChg != null ? priceTone(q.priceChg) : "flat";
    return (
      <div className="_mob-kgi-ticker-cell">
        <div className="_mob-kgi-symbol">{item.symbol}</div>
        <div className={`_mob-kgi-price ${tone}`}>{q.lastPrice.toFixed(2)}</div>
        <div className={`_mob-kgi-chg ${tone}`}>
          {q.priceChg != null && q.pctChg != null ? `${signed(q.priceChg)} (${signed(q.pctChg)}%)` : "--"}
        </div>
        <div className="_mob-kgi-vol" style={{ color: "#ffb800", fontSize: 9 }}>{q.label}</div>
      </div>
    );
  }
  if (q.status === "blocked" || q.status === "empty") {
    return (
      <div className="_mob-kgi-ticker-cell">
        <div className="_mob-kgi-symbol">{item.symbol}</div>
        <div className={`_mob-kgi-price blocked`}>--</div>
        <div className="_mob-kgi-chg flat">{q.status === "blocked" ? "離線" : "--"}</div>
        <div className="_mob-kgi-vol" style={{ color: "#ef5350", fontSize: 9 }}>{q.status === "blocked" ? (q.reason.slice(0, 12)) : "無資料"}</div>
      </div>
    );
  }
  const tone = priceTone(q.priceChg);
  return (
    <div className="_mob-kgi-ticker-cell">
      <div className="_mob-kgi-symbol">{item.symbol}</div>
      <div className={`_mob-kgi-price ${tone}`}>{q.lastPrice.toFixed(2)}</div>
      <div className={`_mob-kgi-chg ${tone}`}>{signed(q.priceChg)} ({signed(q.pctChg)}%)</div>
      <div className="_mob-kgi-vol">量 {fmtVol(q.volume)}</div>
    </div>
  );
}

export function MobileKgiWatchlist({ watchlist = DEFAULT_WATCHLIST }: { watchlist?: WatchItem[] }) {
  const initState: TickerQuotes = Object.fromEntries(watchlist.map(w => [w.symbol, { status: "loading" as const }]));
  const [quotes, setQuotes] = useState<TickerQuotes>(initState);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [liveCount, setLiveCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    // Gateway runs on a weekday 08:20-14:10 TST EventBridge schedule. Outside
    // that window, /kgi/quote/ticks reliably returns 422/503 — skip the call
    // entirely (avoid noise) and go straight to the effective-quotes fallback
    // below, same as any other symbol ticks couldn't serve.
    const scheduledOff = isKgiGatewayScheduledOff();
    const tickResults: QuoteState[] = scheduledOff
      ? watchlist.map(() => ({ status: "empty" as const }))
      : await Promise.all(watchlist.map(w => fetchQuoteForSymbol(w.symbol)));

    const next: TickerQuotes = {};
    watchlist.forEach((w, i) => { next[w.symbol] = tickResults[i]; });

    const missing = watchlist.filter(w => next[w.symbol].status !== "live").map(w => w.symbol);
    const fallback = await fetchEffectiveQuoteFallback(missing);
    Object.entries(fallback).forEach(([symbol, state]) => { next[symbol] = state; });

    let live = 0;
    Object.values(next).forEach(state => { if (state.status === "live") live++; });
    setQuotes(next);
    setLiveCount(live);
    setLastUpdated(new Date().toLocaleTimeString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" }));
  }, [watchlist]);

  useEffect(() => {
    void fetchAll();
    intervalRef.current = setInterval(() => void fetchAll(), POLL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  const anyLive = liveCount > 0;
  const anyClosed = Object.values(quotes).some(q => q.status === "closed" || q.status === "stale");

  return (
    <>
      <style>{WATCHLIST_CSS}</style>
      <section className="_mob-kgi-section">
        <div className="_mob-kgi-head">
          <span className="_mob-kgi-code">
            {anyLive && <span className="_mob-kgi-live-dot" />}
            {anyLive ? "即時報價" : "報價"}
          </span>
          <span className="_mob-kgi-right">
            {anyLive ? `${liveCount}/${watchlist.length} 活躍` : anyClosed ? "收盤價" : "離線"}{lastUpdated ? ` · ${lastUpdated}` : ""}
          </span>
        </div>
        <div className="_mob-kgi-ticker-row">
          {watchlist.map(item => (
            <TickerCell key={item.symbol} item={item} q={quotes[item.symbol] ?? { status: "loading" }} />
          ))}
        </div>
        <div style={{ padding: "0 16px 10px", fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "var(--mono, monospace)" }}>
          公開資料 · 約 5–15 秒延遲 · 不存 cookie
        </div>
      </section>
    </>
  );
}
