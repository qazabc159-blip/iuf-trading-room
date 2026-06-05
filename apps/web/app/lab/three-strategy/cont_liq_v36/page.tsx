/**
 * /lab/three-strategy/cont_liq_v36 — cont_liq v36 前向觀察第一期
 *
 * Server component: resolves company names + entry prices (OHLCV 2026-05-06 close)
 * Client component: ContLiqPeriod1Panel polls KGI ticks every 30s for live prices
 *
 * Holdings locked on 2026-05-06: 3707 / 2426 / 6205 / 2486
 * Mode: research observation only — no real order, no production execution
 *
 * HARD LINES:
 *   - entry_price from FinMind OHLCV 5/6 close (real data); null if unavailable
 *   - latest_price from KGI gateway (client-side); stale flagged post-market
 *   - FORBIDDEN: endorsement wording, live-ready claims, real-order claims, follow-trade claims
 */

import Link from "next/link";
import { PageFrame } from "@/components/PageFrame";
import {
  getCompanyByTicker,
  getCompanyOhlcv,
} from "@/lib/api";
import { ContLiqPeriod1Panel } from "./ContLiqPeriod1Panel";
import type { HoldingEntryInput } from "./ContLiqPeriod1Panel";
import { ContLiqHistoricalEvidencePanel } from "./ContLiqHistoricalEvidencePanel";

export const dynamic = "force-dynamic";

// ── Config ────────────────────────────────────────────────────────────────────

const DAY0 = "2026-05-06";
const TICKERS = ["3707", "2426", "6205", "2486"];

// Fallback display names when company lookup fails
const TICKER_NAME_FALLBACK: Record<string, string> = {
  "3707": "漢磊",
  "2426": "飛弘",
  "6205": "詮欣",
  "2486": "一詮",
};

// ── Server-side data fetch ────────────────────────────────────────────────────

async function resolveHolding(ticker: string): Promise<HoldingEntryInput> {
  // 1. Resolve company (name lookup)
  let displayName = TICKER_NAME_FALLBACK[ticker] ?? ticker;
  let companyId: string | null = null;
  try {
    const company = await getCompanyByTicker(ticker);
    if (company) {
      displayName = company.name ?? displayName;
      companyId = company.id;
    }
  } catch {
    // Keep the local display name when company lookup is unavailable.
  }

  // 2. Fetch OHLCV for the observation-start close price
  let entryPrice: number | null = null;
  let entryPriceSource: HoldingEntryInput["entryPriceSource"] = "unavailable";

  if (companyId) {
    try {
      const bars = await getCompanyOhlcv(companyId, {
        from: DAY0,
        to: DAY0,
        interval: "1d",
      });
      // Find the bar matching DAY0
      const bar = bars.find((b) => b.dt === DAY0) ?? bars[bars.length - 1] ?? null;
      if (bar && bar.close > 0) {
        entryPrice = bar.close;
        entryPriceSource = "ohlcv_5_6_close";
      }
    } catch {
      // leave as null — honest about data unavailability
    }
  }

  return { ticker, displayName, entryPrice, entryPriceSource };
}

async function resolve0050EntryPrice(): Promise<number | null> {
  try {
    const company = await getCompanyByTicker("0050");
    if (!company) return null;
    const bars = await getCompanyOhlcv(company.id, { from: DAY0, to: DAY0, interval: "1d" });
    const bar = bars.find((b) => b.dt === DAY0) ?? bars[bars.length - 1] ?? null;
    return bar && bar.close > 0 ? bar.close : null;
  } catch {
    return null;
  }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function ContLiqV36Period1Page() {
  // Parallel fetch all holdings + 0050 benchmark
  const [holdingResults, bench0050Entry] = await Promise.all([
    Promise.all(TICKERS.map(resolveHolding)),
    resolve0050EntryPrice(),
  ]);

  // Count how many entry prices resolved
  const resolvedCount = holdingResults.filter((h) => h.entryPrice != null).length;
  const entryDataNote =
    resolvedCount === TICKERS.length
      ? `入場價全部已從 FinMind OHLCV (${DAY0}) 取得`
      : resolvedCount > 0
      ? `${resolvedCount}/${TICKERS.length} 檔入場價已取得，其餘顯示 "--"（OHLCV 尚未 backfill）`
      : `入場價暫不可用（OHLCV 資料尚未 backfill）— 顯示 "--"，不使用假數值`;

  return (
    <PageFrame
      code="LAB"
      title="持續流動性強勢策略 — 前向觀察第一期"
      sub={`觀察起始日: ${DAY0} · 觀察標的: ${TICKERS.join(" / ")} · 預期退出: 2026-06-03 · ${entryDataNote}`}
      note="研究前向觀察記錄。不顯示背書、可上線或可跟單字樣。非交易建議。"
    >
      {/* A 區 — 前向觀察第一期 */}
      <ContLiqPeriod1Panel
        holdings={holdingResults}
        bench0050EntryPrice={bench0050Entry}
      />

      {/* B 區 — 歷史研究證據 */}
      <ContLiqHistoricalEvidencePanel />

      <div style={{ marginTop: 28, display: "flex", gap: 16, alignItems: "center" }}>
        <Link
          href="/lab/three-strategy/cont_liq_v36"
          style={{ fontSize: 12, color: "#888", textDecoration: "underline" }}
        >
          ← 返回 cont_liq v36 策略詳情
        </Link>
        <Link
          href="/lab/three-strategy"
          style={{ fontSize: 12, color: "#666", textDecoration: "underline" }}
        >
          ← 返回三條策略狀態
        </Link>
      </div>
    </PageFrame>
  );
}
