"use client";
/**
 * /companies/[symbol] — Individual Stock Detail Page
 * W4 Frontend Cutover (DRAFT)
 *
 * Shows:
 *   - StatStrip (8 stat cells: last / Δ% / vol / high / low / open / prev-close / mktcap)
 *   - StockDetailPanel (K-line + bid/ask + tick tape, interval toggle, timezone toggle)
 *
 * No order entry. No live market data (mocked via StockDetailPanel fallback).
 * StatStrip values are deterministic mock — live market data API not yet connected.
 */
import { use } from "react";
import { AppShell } from "@/components/app-shell";
import { StockDetailPanel } from "@/components/chart/StockDetailPanel";
import { StatStrip } from "@/components/TopKpiStrip";

interface PageProps {
  params: Promise<{ symbol: string }>;
}

/** Deterministic mock last price for a ticker — stable per symbol. */
function mockLastPx(symbol: string): number {
  const BASE: Record<string, number> = {
    "2330": 920, "2454": 680, "2317": 130, "2412": 115, "2882": 52, "0050": 195,
    "3008": 2520, "6504": 82, "4915": 88, "1503": 122, "2376": 348, "3661": 2400,
  };
  if (BASE[symbol]) return BASE[symbol];
  const seed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return 100 + (seed % 900);
}

export default function StockDetailPage({ params }: PageProps) {
  const { symbol } = use(params);
  const lastPx = mockLastPx(symbol);

  // Deterministic mock stats from symbol seed — no live market data API in W4
  const seed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const chgPct  = ((seed % 700) - 300) / 100;          // -3% ~ +4%
  const vol     = 1000 * ((seed * 7) % 50 + 1);
  const high    = lastPx * (1 + Math.abs(chgPct) / 100 + 0.003);
  const low     = lastPx * (1 - Math.abs(chgPct) / 100 - 0.003);
  const open    = lastPx * (1 - chgPct / 200);
  const prevClose = lastPx / (1 + chgPct / 100);

  const chgColor = chgPct >= 0 ? "var(--tw-up)" : "var(--tw-dn)";

  const statCells = [
    { label: "LAST",       value: lastPx.toFixed(2),          color: chgColor },
    { label: "Δ%",         value: `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%`, color: chgColor },
    { label: "VOL",        value: (vol / 1000).toFixed(0) + "K" },
    { label: "HIGH",       value: high.toFixed(2) },
    { label: "LOW",        value: low.toFixed(2) },
    { label: "OPEN",       value: open.toFixed(2) },
    { label: "PREV·CLOSE", value: prevClose.toFixed(2) },
    { label: "SYMBOL",     value: symbol, color: "var(--gold-bright)" },
  ];

  return (
    <AppShell eyebrow="個股" title={`[${symbol}] 個股頁`}>
      <StatStrip cells={statCells} />
      <StockDetailPanel symbol={symbol} lastPx={lastPx} mainVisual />
    </AppShell>
  );
}
