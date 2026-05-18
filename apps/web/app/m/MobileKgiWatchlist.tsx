"use client";

// MobileKgiWatchlist — 手機版 KGI 即時報價 watchlist
// 15s poll, 4-state (loading/live/blocked/empty), mobile-optimised large numbers.
// Default watchlist: 0050 / 2330 / 2454 (top-3 liquidity).
// Hard rule: NO fake / mock data. Shows BLOCKED if gateway unreachable.

import { useCallback, useEffect, useRef, useState } from "react";

import { formatMobileKgiBlockedReason } from "./mobile-kgi-copy";

type QuoteState =
  | { status: "loading" }
  | { status: "live"; lastPrice: number; priceChg: number; pctChg: number; volume: number; time: string }
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
    const data = await res.json() as { symbol: string; ticks: Array<{ close?: number; price_chg?: number; pct_chg?: number; volume?: number; datetime?: string }>; count: number };
    if (!data.ticks || data.ticks.length === 0) {
      return { status: "blocked", reason: "尚無 tick（未訂閱）" };
    }
    const tick = data.ticks[0];
    if (!tick.close) {
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

function TickerCell({ item, q }: { item: WatchItem; q: QuoteState }) {
  if (q.status === "loading") {
    return (
      <div className="_mob-kgi-ticker-cell">
        <div className="_mob-kgi-symbol">{item.symbol}</div>
        <div className={`_mob-kgi-price loading`}>--.-</div>
        <div className="_mob-kgi-chg flat">--</div>
        <div className="_mob-kgi-vol">載入中…</div>
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
    const results = await Promise.all(watchlist.map(w => fetchQuoteForSymbol(w.symbol)));
    const next: TickerQuotes = {};
    let live = 0;
    watchlist.forEach((w, i) => {
      next[w.symbol] = results[i];
      if (results[i].status === "live") live++;
    });
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
            {anyLive ? `${liveCount}/${watchlist.length} 活躍` : "離線"}{lastUpdated ? ` · ${lastUpdated}` : ""}
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
