/**
 * quote-store.ts — 中央 quote store（前端 singleton）
 *
 * 設計原則：
 * - 一個 store 管理所有已訂閱 symbol 的報價
 * - 避免每個元件各自打一條行情路（合并 fan-out 到同一 fetch cycle）
 * - 先用輪詢 snapshot 端點；之後接 WS 只換傳輸層，API 不變
 * - 誠實標示 freshness_mode — age>2s 一定標 stale，不假裝 live
 *
 * freshness_mode 語義：
 *   live     — KGI 即時 (<= 2s 舊)
 *   intraday — TWSE MIS 盤中近即時 (> 2s 但當日盤中)
 *   stale    — 資料 > 2s 或來源不確定
 *   eod      — 昨收 / 盤後 EOD 資料
 *
 * PARTIAL — 等 Jason 補 GET /api/v1/realtime/snapshot?symbols=... 後端端點，
 *            目前 fan-out 至 /api/v1/companies/:id/quote/realtime (per-symbol)
 */

"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { getCompanyQuoteRealtime } from "@/lib/api";
import type { CompanyRealtimeQuote } from "@/lib/api";
import { realtimeFreshnessMode, type FreshnessMode } from "@/lib/realtime-freshness";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * canonical freshness_mode — 這是給 UI 消費的 4 個狀態。
 * 來自後端 state + source + freshness 欄位的對應。
 */
export type { FreshnessMode };

/**
 * QuoteEntry — store 內每個 symbol 的報價快照
 */
export type QuoteEntry = {
  symbol: string;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  /** 原始後端 state */
  state: "LIVE" | "STALE" | "BLOCKED" | "NO_DATA";
  /** 原始後端 source */
  source: string;
  /** 計算出的 freshness_mode（給 UI 用） */
  freshness_mode: FreshnessMode;
  /** ms since data was captured */
  freshness_ms: number;
  updatedAt: string;
  /** 最後一次成功 fetch 的時間戳 */
  fetchedAt: number;
};

// ── freshness 計算 ─────────────────────────────────────────────────────────────

/**
 * 將後端 CompanyRealtimeQuote 對應為 canonical FreshnessMode。
 *
 * 規則（優先順序）：
 * 1. source = twse_openapi_eod → eod
 * 2. state = BLOCKED | NO_DATA → eod（資料不可用，不假裝）
 * 3. source = twse_intraday → intraday
 * 4. source = kgi-gateway，freshness = fresh，age <= 2s → live
 * 5. 其他有價格 → stale（age > 2s 一律 stale，不可假裝 live）
 */
export function computeFreshnessMode(
  quote: CompanyRealtimeQuote,
  nowMs: number,
): FreshnessMode {
  return realtimeFreshnessMode(quote, nowMs);
}

export function computeFreshness_ms(quote: CompanyRealtimeQuote, nowMs: number): number {
  if (!quote.updatedAt) return -1;
  return Math.max(0, nowMs - Date.parse(quote.updatedAt));
}

function toQuoteEntry(symbol: string, quote: CompanyRealtimeQuote): QuoteEntry {
  const nowMs = Date.now();
  return {
    symbol,
    lastPrice: quote.lastPrice,
    bid: quote.bid,
    ask: quote.ask,
    volume: quote.volume,
    state: quote.state,
    source: quote.source,
    freshness_mode: computeFreshnessMode(quote, nowMs),
    freshness_ms: computeFreshness_ms(quote, nowMs),
    updatedAt: quote.updatedAt,
    fetchedAt: nowMs,
  };
}

// ── Store 內部實作（singleton per React tree） ──────────────────────────────────

type QuoteMap = Map<string, QuoteEntry>;

interface QuoteStoreCtx {
  quotes: QuoteMap;
  subscribe: (symbol: string) => void;
  unsubscribe: (symbol: string) => void;
}

const QuoteStoreContext = createContext<QuoteStoreCtx | null>(null);

/**
 * POLL_INTERVAL_COMPANY_MS — 個股頁輪詢間隔（1.5s，可靠但不過頻）
 * 之後接 WS 時只改傳輸層，不改 hook API
 */
const POLL_INTERVAL_COMPANY_MS = 1500;

/**
 * QuoteStoreProvider — 掛在 app root 或個別頁面。
 * 管理 symbol 訂閱計數 + 輪詢 fan-out。
 */
export function QuoteStoreProvider({ children }: { children: ReactNode }) {
  const [quotes, setQuotes] = useState<QuoteMap>(new Map());
  // ref 不觸發 re-render — 用來追蹤訂閱計數（symbol → count）
  const subsRef = useRef<Map<string, number>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 追蹤 in-flight fetches，避免同時打多個相同 symbol
  const inflightRef = useRef<Set<string>>(new Set());

  const fetchSymbol = useCallback(async (symbol: string) => {
    if (inflightRef.current.has(symbol)) return;
    inflightRef.current.add(symbol);
    try {
      const q = await getCompanyQuoteRealtime(symbol);
      if (q) {
        setQuotes((prev: QuoteMap) => {
          const next = new Map(prev);
          next.set(symbol, toQuoteEntry(symbol, q));
          return next;
        });
      }
    } finally {
      inflightRef.current.delete(symbol);
    }
  }, []);

  // Poll loop — fires every POLL_INTERVAL_COMPANY_MS
  useEffect(() => {
    function tick() {
      const symbols = Array.from(subsRef.current.keys());
      for (const sym of symbols) {
        void fetchSymbol(sym);
      }
    }
    intervalRef.current = setInterval(tick, POLL_INTERVAL_COMPANY_MS);
    // 立即打一次，避免等第一個 interval
    tick();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchSymbol]);

  const subscribe = useCallback((symbol: string) => {
    const prev = subsRef.current.get(symbol) ?? 0;
    subsRef.current.set(symbol, prev + 1);
    // 立即 fetch（不等 next tick）
    void fetchSymbol(symbol);
  }, [fetchSymbol]);

  const unsubscribe = useCallback((symbol: string) => {
    const prev = subsRef.current.get(symbol) ?? 0;
    if (prev <= 1) {
      subsRef.current.delete(symbol);
    } else {
      subsRef.current.set(symbol, prev - 1);
    }
  }, []);

  return (
    <QuoteStoreContext.Provider value={{ quotes, subscribe, unsubscribe }}>
      {children}
    </QuoteStoreContext.Provider>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

/**
 * useQuoteStore — 讀取 store 內容（不訂閱 symbol）
 */
export function useQuoteStore(): QuoteStoreCtx {
  const ctx = useContext(QuoteStoreContext);
  if (!ctx) throw new Error("useQuoteStore must be used inside QuoteStoreProvider");
  return ctx;
}

/**
 * useQuote — 訂閱單一 symbol，返回 QuoteEntry | null
 * 元件 unmount 時自動取消訂閱。
 */
export function useQuote(symbol: string): QuoteEntry | null {
  const { quotes, subscribe, unsubscribe } = useQuoteStore();

  useEffect(() => {
    subscribe(symbol);
    return () => unsubscribe(symbol);
  }, [symbol, subscribe, unsubscribe]);

  return quotes.get(symbol) ?? null;
}

/**
 * useMultiQuotes — 訂閱多個 symbol（自選股清單用）
 * 返回 Map<symbol, QuoteEntry>
 */
export function useMultiQuotes(symbols: string[]): Map<string, QuoteEntry> {
  const { quotes, subscribe, unsubscribe } = useQuoteStore();
  const symbolsKey = symbols.join(",");

  useEffect(() => {
    for (const sym of symbols) subscribe(sym);
    return () => {
      for (const sym of symbols) unsubscribe(sym);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, subscribe, unsubscribe]);

  const result = new Map<string, QuoteEntry>();
  for (const sym of symbols) {
    const q = quotes.get(sym);
    if (q) result.set(sym, q);
  }
  return result;
}
