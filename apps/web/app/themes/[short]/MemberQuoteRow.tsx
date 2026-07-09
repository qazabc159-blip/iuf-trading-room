"use client";

import { useEffect, useState, type MouseEvent } from "react";

import { addWatchlistSymbol, getCompanyQuoteRealtime, type CompanyRealtimeQuote } from "@/lib/api";

// 主題成員列連動（decision-flow C-2）：現價＋今日漲跌＋「加觀察」鍵。
// 逐檔 lazy fetch（mount 後才打），避免主題頁一次對大量成員發出報價請求拖慢頁面。
//
// fetchQuote=false（呼叫端依 cap 決定）時完全不打 quote/realtime，只顯示靜態「未即時報價」——
// 這不是 loading 狀態的變體，是刻意不發請求。「加觀察」寫入不受影響，永遠可點。
// Why: 主題成員可達百餘檔，若每列各自 useEffect 無上限發 GET /companies/:id/quote/realtime，
// 掛載瞬間就是 N 個併發請求，會撞 KGI 新星 40-slot 訂閱硬上限（kgi-subscription-manager.ts
// MAX_SLOTS=40）並用 LRU 把其他頁面正在看的報價換掉，還會對 MIS 直打 N 次。
type WatchState = "idle" | "saving" | "saved" | "error";
type QuoteState =
  | { status: "not-fetched" }
  | { status: "loading" }
  | { status: "ok"; quote: CompanyRealtimeQuote }
  | { status: "empty" };

function formatPrice(value: number | null | undefined) {
  if (value == null) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function formatChangePct(value: number | null | undefined) {
  if (value == null) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function changeTone(value: number | null | undefined) {
  if (value == null) return undefined;
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

export function MemberQuoteRow({
  ticker,
  name,
  fetchQuote = true,
}: {
  ticker: string;
  name: string;
  fetchQuote?: boolean;
}) {
  const [quoteState, setQuoteState] = useState<QuoteState>(fetchQuote ? { status: "loading" } : { status: "not-fetched" });
  const [watchState, setWatchState] = useState<WatchState>("idle");

  useEffect(() => {
    if (!fetchQuote) return;
    let cancelled = false;
    getCompanyQuoteRealtime(ticker).then((quote) => {
      if (cancelled) return;
      setQuoteState(quote ? { status: "ok", quote } : { status: "empty" });
    });
    return () => {
      cancelled = true;
    };
  }, [ticker, fetchQuote]);

  async function handleAddWatchlist(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (watchState === "saving" || watchState === "saved") return;
    setWatchState("saving");
    const result = await addWatchlistSymbol(ticker, name);
    setWatchState(result.ok ? "saved" : "error");
  }

  const tone = quoteState.status === "ok" ? changeTone(quoteState.quote.changePct) : undefined;

  return (
    <div className="_bty-member-quote-row">
      <span
        className="_bty-member-price"
        data-tone={tone}
        title={
          quoteState.status === "ok"
            ? `資料狀態：${quoteState.quote.state}`
            : quoteState.status === "not-fetched"
              ? "此頁報價請求有上限，未即時報價；點進公司頁看即時價"
              : undefined
        }
      >
        {quoteState.status === "not-fetched" && "未報價"}
        {quoteState.status === "loading" && "讀取中…"}
        {quoteState.status === "empty" && "無報價"}
        {quoteState.status === "ok" && (
          <>
            {formatPrice(quoteState.quote.lastPrice)}
            <i>{formatChangePct(quoteState.quote.changePct)}</i>
          </>
        )}
      </span>
      <button
        type="button"
        className="_bty-member-watch-btn"
        onClick={handleAddWatchlist}
        disabled={watchState === "saving" || watchState === "saved"}
        data-tone={watchState === "saved" ? "ok" : watchState === "error" ? "bad" : undefined}
      >
        {watchState === "saving" ? "加入中…" : watchState === "saved" ? "已加入" : watchState === "error" ? "重試" : "加觀察"}
      </button>
    </div>
  );
}
