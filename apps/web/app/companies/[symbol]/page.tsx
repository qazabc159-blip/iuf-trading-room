"use client";
/**
 * /companies/[symbol] — Individual Stock Detail Page
 * W4 Frontend Cutover + W5b Visual Overhaul
 *
 * W5b changes:
 *   - Stock page header row (symbol pill + market badge)
 *   - StatStrip v2 (actual Georgia serif italic values — typography fix)
 *   - StockDetailPanel wrapped with proper HUD composition
 *   - Page structure: header → stat strip → chart panel (clear visual hierarchy)
 *
 * No order entry. No live market data (mocked via StockDetailPanel fallback).
 */
import { use } from "react";
import { AppShell } from "@/components/app-shell";
import { StockDetailPanel } from "@/components/chart/StockDetailPanel";

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

/** Deterministic mock company name */
function mockCompanyName(symbol: string): string {
  const NAMES: Record<string, string> = {
    "2330": "台灣積體電路", "2454": "聯發科技", "2317": "鴻海精密", "2412": "中華電信",
    "2882": "國泰金控", "0050": "元大台灣50", "3008": "大立光電", "6504": "南亞科技",
  };
  return NAMES[symbol] ?? `${symbol} 股份有限公司`;
}

interface StatCellData {
  label:  string;
  value:  string;
  color?: string;
}

export default function StockDetailPage({ params }: PageProps) {
  const { symbol } = use(params);
  const lastPx = mockLastPx(symbol);
  const companyName = mockCompanyName(symbol);

  // Deterministic mock stats from symbol seed — no live market data API in W4/W5
  const seed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const chgPct  = ((seed % 700) - 300) / 100;          // -3% ~ +4%
  const vol     = 1000 * ((seed * 7) % 50 + 1);
  const high    = lastPx * (1 + Math.abs(chgPct) / 100 + 0.003);
  const low     = lastPx * (1 - Math.abs(chgPct) / 100 - 0.003);
  const open    = lastPx * (1 - chgPct / 200);
  const prevClose = lastPx / (1 + chgPct / 100);

  const isGain = chgPct >= 0;
  const chgColor = isGain ? "var(--tw-up)" : "var(--tw-dn)";

  const statCells: StatCellData[] = [
    { label: "LAST",        value: lastPx.toFixed(2),                                   color: chgColor },
    { label: "CHG·%",       value: `${isGain ? "+" : ""}${chgPct.toFixed(2)}%`,         color: chgColor },
    { label: "VOL",         value: (vol / 1000).toFixed(0) + "K" },
    { label: "HIGH",        value: high.toFixed(2) },
    { label: "LOW",         value: low.toFixed(2) },
    { label: "OPEN",        value: open.toFixed(2) },
    { label: "PREV·CLOSE",  value: prevClose.toFixed(2) },
    { label: "SYMBOL",      value: symbol,                                               color: "var(--gold-bright)" },
  ];

  return (
    <AppShell eyebrow="個股" title={`[${symbol}] 個股行情`}>
      {/* Stock page header: symbol pill + company name + market badge */}
      <div className="stock-page-header">
        <span className="stock-symbol-pill">{symbol}</span>
        <span className="stock-name-label">{companyName}</span>
        <span className="stock-market-badge">TWSE</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--data-mono)", fontSize: 9, letterSpacing: "0.12em", color: "var(--night-soft)" }}>
          MOCK DATA · LIVE API PENDING
        </span>
      </div>

      {/* StatStrip v2 — actual Georgia serif italic typography fix */}
      <div
        className="stat-strip-v2"
        style={{ gridTemplateColumns: `repeat(${statCells.length}, 1fr)` }}
      >
        {statCells.map((cell, i) => (
          <div
            key={cell.label}
            className="stat-cell-v2"
            style={{ borderRight: i < statCells.length - 1 ? "1px solid var(--rule-dim)" : "none" }}
          >
            <div className="stat-cell-label">{cell.label}</div>
            <div
              className="stat-cell-value"
              style={cell.color ? { color: cell.color } : undefined}
            >
              {cell.value}
            </div>
          </div>
        ))}
      </div>

      {/* StockDetailPanel — chart + depth + tape (HUD frame applied inside panel) */}
      <StockDetailPanel symbol={symbol} lastPx={lastPx} mainVisual />
    </AppShell>
  );
}
