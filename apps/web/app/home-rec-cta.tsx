"use client";

// 首頁 AI 推薦頭條三鍵連動（2026-07-14）：看公司／加觀察／帶入模擬單。
// 「帶入模擬單」走新交易台契約 /desk-exact?symbol=X&side=buy（取代已停用的
// /portfolio?ticker=...&prefill=true 舊契約——舊契約隨交易台換版停用，見
// ./ai-recommendations/StockRecCard.tsx 的 LinkageCtaRow 是共用元件，服務
// /ai-recommendations 正式頁，不在本輪首頁任務範圍內故不動；這裡另開一支
// 首頁專用、走新契約的最小 CTA row，避免動到 ai-recommendations lane）。
// 加觀察沿用既有 POST /api/v1/watchlist（idempotent upsert）。

import Link from "next/link";
import { useState } from "react";

import { addWatchlistSymbol } from "@/lib/api";

type WatchState = "idle" | "saving" | "saved" | "error";

export function HomeRecCtaRow({ ticker, companyName }: { ticker: string; companyName?: string | null }) {
  const [state, setState] = useState<WatchState>("idle");

  async function handleWatch() {
    if (state === "saving" || state === "saved") return;
    setState("saving");
    const result = await addWatchlistSymbol(ticker, companyName ?? undefined);
    setState(result.ok ? "saved" : "error");
  }

  return (
    <div className="_src-cta-row">
      <Link href={`/companies/${encodeURIComponent(ticker)}`} className="_src-cta-btn">
        看公司
      </Link>
      <button
        type="button"
        className="_src-cta-btn"
        onClick={handleWatch}
        disabled={state === "saving" || state === "saved"}
      >
        {state === "saving" ? "加入中…" : state === "saved" ? "已加入" : state === "error" ? "加入失敗，重試" : "加觀察"}
      </button>
      {/* CSS `.actbtns a._src-cta-btn:last-of-type` already highlights this as
          the primary action (amber), matching the existing ledger CSS rule —
          no extra class needed here. */}
      <Link href={`/desk-exact?symbol=${encodeURIComponent(ticker)}&side=buy`} className="_src-cta-btn">
        帶入模擬單
      </Link>
    </div>
  );
}
