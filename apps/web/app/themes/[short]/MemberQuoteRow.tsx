"use client";

import { useEffect, useState, type MouseEvent } from "react";

import { addWatchlistSymbol, getCompanyQuoteRealtime, type CompanyRealtimeQuote } from "@/lib/api";

// 主題成員列連動（decision-flow C-2）：現價＋今日漲跌＋「加觀察」鍵。
// 逐檔 lazy fetch（mount 後才打），避免主題頁一次對大量成員發出報價請求拖慢頁面。
type WatchState = "idle" | "saving" | "saved" | "error";
type QuoteState =
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

export function MemberQuoteRow({ ticker, name }: { ticker: string; name: string }) {
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "loading" });
  const [watchState, setWatchState] = useState<WatchState>("idle");

  useEffect(() => {
    let cancelled = false;
    getCompanyQuoteRealtime(ticker).then((quote) => {
      if (cancelled) return;
      setQuoteState(quote ? { status: "ok", quote } : { status: "empty" });
    });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

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
        title={quoteState.status === "ok" ? `資料狀態：${quoteState.quote.state}` : undefined}
      >
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
