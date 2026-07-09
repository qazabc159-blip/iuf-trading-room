"use client";

import Link from "next/link";
import { useState } from "react";

import { addWatchlistSymbol } from "@/lib/api";

type WatchState = "idle" | "saving" | "saved" | "error";

function buildPrefillHref(ticker: string, side: "buy" | "sell" | null) {
  const params = new URLSearchParams({ ticker, prefill: "true" });
  if (side) params.set("side", side);
  return `/portfolio?${params.toString()}`;
}

export function SignalCtaRow({
  ticker,
  companyName,
  direction,
  stale = false,
}: {
  ticker: string;
  companyName: string;
  direction: "bullish" | "bearish" | "neutral";
  stale?: boolean;
}) {
  const [watchState, setWatchState] = useState<WatchState>("idle");
  const side = direction === "bullish" ? "buy" : direction === "bearish" ? "sell" : null;

  async function handleAddWatchlist() {
    if (watchState === "saving" || watchState === "saved") return;
    setWatchState("saving");
    const result = await addWatchlistSymbol(ticker, companyName);
    setWatchState(result.ok ? "saved" : "error");
  }

  return (
    <div className="_sig-cta-row">
      <Link href={`/companies/${ticker}`} className="mini-button">
        看公司
      </Link>
      <button
        type="button"
        className="mini-button"
        onClick={handleAddWatchlist}
        disabled={watchState === "saving" || watchState === "saved"}
        data-tone={watchState === "saved" ? "ok" : watchState === "error" ? "bad" : undefined}
      >
        {watchState === "saving" ? "加入中…" : watchState === "saved" ? "已加入" : watchState === "error" ? "加入失敗，重試" : "加觀察"}
      </button>
      {/* 過期訊號不誘導帶單（design doc §4「灰顯不誘導」）：不給可點連結，用禁用態說明。 */}
      {stale ? (
        <span
          className="mini-button"
          aria-disabled="true"
          data-disabled="true"
          title="此訊號已過期，請先確認最新報價再考慮下單"
        >
          帶入模擬單
        </span>
      ) : (
        <Link href={buildPrefillHref(ticker, side)} className="mini-button">
          帶入模擬單
        </Link>
      )}
    </div>
  );
}
