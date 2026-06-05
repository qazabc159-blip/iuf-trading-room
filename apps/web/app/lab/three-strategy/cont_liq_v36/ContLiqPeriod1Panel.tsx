"use client";

/**
 * ContLiqPeriod1Panel — cont_liq v36 前向觀察第一期
 *
 * Observation start: 2026-05-06
 * Holdings: 3707 / 2426 / 6205 / 2486
 * Expected exit: 2026-06-03 (H20 target)
 * Mode: research observation only — no real order, no production execution
 *
 * HARD LINES:
 *   - entry_price from server (FinMind OHLCV 2026-05-06 close) — no fake
 *   - latest_price from KGI ticks 30s poll — stale flagged if not live
 *   - status banner always shown — cannot be hidden
 *   - FORBIDDEN: endorsement wording, live-ready claims, real-order claims, follow-trade claims
 *   - ALLOWED: research tracking / observation / simulated / not a trading recommendation / pending H20 maturation
 */

import { useState, useEffect, useCallback } from "react";

import { formatMobileKgiBlockedReason } from "../../../m/mobile-kgi-copy";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HoldingEntryInput {
  ticker: string;
  displayName: string;
  entryPrice: number | null;
  entryPriceSource: "ohlcv_5_6_close" | "unavailable";
}

interface LiveQuote {
  price: number | null;
  quoteTime: string | null;
  state: "loading" | "live" | "stale" | "blocked";
  reason?: string;
}

interface HoldingRow extends HoldingEntryInput {
  liveQuote: LiveQuote;
  unrealizedReturn: number | null; // decimal (0.05 = 5%)
  unrealizedPnlTwd: number | null; // TWD equal-weight basket
}

interface BasketKpi {
  avgReturn: number | null;
  totalPnlTwd: number | null;
  bench0050Return: number | null;
  excess: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY0 = "2026-05-06";
const EXPECTED_EXIT = "2026-06-03";
const H20_TARGET = 20; // trading days
// equal-weight, assume 10,000 TWD per holding for P&L illustration
const POSITION_SIZE_TWD = 10_000;
const POLL_INTERVAL_MS = 30_000;

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL as string | undefined) ??
  (typeof window !== "undefined" && window.location.port === "3000"
    ? "http://localhost:3001"
    : "");

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
._cl1-wrap {
  font-family: var(--mono, monospace);
}
._cl1-anchor {
  padding: 18px 22px 14px;
  margin-bottom: 16px;
  background: rgba(11,16,23,0.92);
  border: 1px solid rgba(255,184,0,0.28);
  border-left: 4px solid #ffb800;
  border-radius: 6px;
}
._cl1-anchor-eyebrow {
  font-size: 10px;
  font-weight: 700;
  color: #888;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  margin-bottom: 6px;
}
._cl1-anchor-date {
  font-size: 32px;
  font-weight: 850;
  color: #ffb800;
  letter-spacing: -0.5px;
  line-height: 1.1;
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
}
._cl1-anchor-sub {
  font-size: 11px;
  color: #666;
}
._cl1-table-wrap {
  margin-bottom: 16px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  overflow: hidden;
}
._cl1-table-head {
  display: grid;
  grid-template-columns: 68px 1fr 100px 100px 100px 100px 120px;
  gap: 0;
  padding: 7px 12px;
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 10px;
  color: #555;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
._cl1-table-row {
  display: grid;
  grid-template-columns: 68px 1fr 100px 100px 100px 100px 120px;
  gap: 0;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  align-items: center;
  transition: background 0.15s;
}
._cl1-table-row:last-child {
  border-bottom: none;
}
._cl1-table-row:hover {
  background: rgba(255,255,255,0.02);
}
._cl1-cell {
  font-size: 12px;
  color: #c8c8c8;
  line-height: 1.4;
}
._cl1-cell-ticker {
  font-size: 14px;
  font-weight: 700;
  color: #ffb800;
}
._cl1-cell-name {
  font-size: 11px;
  color: #aaa;
}
._cl1-cell-price {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
._cl1-cell-price.up { color: #ef5350; }
._cl1-cell-price.dn { color: #4caf50; }
._cl1-cell-price.flat { color: #c8c8c8; }
._cl1-cell-price.dim { color: #555; }
._cl1-ret.pos { color: #ef5350; }
._cl1-ret.neg { color: #4caf50; }
._cl1-ret.zero { color: #666; }
._cl1-ret.dim { color: #444; }
._cl1-quote-time {
  font-size: 9px;
  color: #444;
  margin-top: 2px;
}
._cl1-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
._cl1-badge.live {
  background: rgba(46,204,113,0.12);
  border: 1px solid rgba(46,204,113,0.35);
  color: #2ecc71;
}
._cl1-badge.stale {
  background: rgba(255,184,0,0.10);
  border: 1px solid rgba(255,184,0,0.3);
  color: #ffb800;
}
._cl1-badge.blocked {
  background: rgba(224,80,80,0.10);
  border: 1px solid rgba(224,80,80,0.3);
  color: #e05050;
}
._cl1-badge.loading {
  background: rgba(100,100,100,0.10);
  border: 1px solid rgba(100,100,100,0.25);
  color: #666;
}
._cl1-kpi-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 16px;
}
._cl1-kpi-cell {
  padding: 14px 16px;
  background: rgba(11,16,23,0.92);
}
._cl1-kpi-label {
  font-size: 10px;
  color: #555;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  margin-bottom: 6px;
}
._cl1-kpi-value {
  font-size: 24px;
  font-weight: 800;
  color: #c8c8c8;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  margin-bottom: 2px;
}
._cl1-kpi-value.pos { color: #ef5350; }
._cl1-kpi-value.neg { color: #4caf50; }
._cl1-kpi-value.amber { color: #ffb800; }
._cl1-kpi-value.dim { color: #444; }
._cl1-kpi-sub {
  font-size: 9px;
  color: #444;
}
._cl1-progress-wrap {
  margin-bottom: 16px;
  padding: 16px 18px;
  background: rgba(11,16,23,0.88);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
}
._cl1-progress-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
}
._cl1-progress-title {
  font-size: 10px;
  font-weight: 700;
  color: #888;
  letter-spacing: 1px;
  text-transform: uppercase;
}
._cl1-progress-count {
  font-size: 13px;
  font-weight: 700;
  color: #ffb800;
}
._cl1-progress-bar-bg {
  height: 6px;
  background: rgba(255,255,255,0.07);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}
._cl1-progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #ffb800 0%, rgba(255,184,0,0.6) 100%);
  border-radius: 3px;
  transition: width 0.6s ease;
  min-width: 2px;
}
._cl1-progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: #444;
}
._cl1-status-banner {
  padding: 14px 16px;
  margin-bottom: 16px;
  background: rgba(11,16,23,0.82);
  border: 1px solid rgba(255,184,0,0.22);
  border-left: 3px solid #ffb800;
  border-radius: 5px;
  font-size: 11px;
  color: #888;
  line-height: 1.7;
}
._cl1-status-banner strong {
  color: #ffb800;
  font-weight: 700;
}
._cl1-poll-footer {
  font-size: 9px;
  color: #333;
  text-align: right;
  margin-top: 8px;
}
@media (max-width: 900px) {
  ._cl1-kpi-bar { grid-template-columns: repeat(2, 1fr); }
  ._cl1-table-head,
  ._cl1-table-row { grid-template-columns: 60px 1fr 80px 80px 80px 80px 100px; font-size: 10px; }
}
@media (max-width: 640px) {
  ._cl1-table-head { display: none; }
  ._cl1-table-row {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    gap: 4px 8px;
    padding: 10px 10px;
  }
  ._cl1-anchor-date { font-size: 24px; }
  ._cl1-kpi-bar { grid-template-columns: repeat(2, 1fr); }
}
@media (prefers-reduced-motion: reduce) {
  ._cl1-progress-bar-fill { transition: none; }
  ._cl1-table-row { transition: none; }
}
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(v: number | null): string {
  if (v == null) return "--";
  return v.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v: number | null): string {
  if (v == null) return "--";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(2)}%`;
}

function fmtPnl(v: number | null): string {
  if (v == null) return "--";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
}

function retTone(v: number | null): string {
  if (v == null) return "dim";
  if (v > 0) return "pos";
  if (v < 0) return "neg";
  return "zero";
}

/** Count calendar days between two YYYY-MM-DD strings */
function calendarDaysBetween(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Approximate Taiwan trading days (Mon-Fri, not counting holidays) */
function approxTradingDays(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  let count = 0;
  const cur = new Date(a);
  while (cur <= b) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(0, count - 1); // exclude observation start
}

// ── KGI quote fetch (client-side) ─────────────────────────────────────────────

async function fetchLatestPrice(ticker: string): Promise<LiveQuote> {
  try {
    const qs = new URLSearchParams({ symbol: ticker, limit: "1" }).toString();
    const res = await fetch(`${API_BASE}/api/v1/kgi/quote/ticks?${qs}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      return {
        price: null,
        quoteTime: null,
        state: "blocked",
        reason: formatMobileKgiBlockedReason(res.status, txt),
      };
    }
    const body = (await res.json()) as {
      data?: { ticks?: Array<{ close?: number; datetime?: string; _received_at?: string }>; count?: number };
    };
    const ticks = body.data?.ticks ?? [];
    if (ticks.length === 0) {
      return {
        price: null,
        quoteTime: null,
        state: "stale",
        reason: "盤後 — 無即時 tick（尚無訂閱或已收盤）",
      };
    }
    const tick = ticks[0];
    const price = tick.close ?? null;
    const quoteTime = tick.datetime ?? tick._received_at ?? null;
    return { price, quoteTime, state: price != null ? "live" : "stale" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return {
      price: null,
      quoteTime: null,
      state: "blocked",
      reason: msg.includes("GATEWAY_UNREACHABLE")
        ? "KGI gateway 離線"
        : msg.includes("SYMBOL_NOT_ALLOWED")
        ? "此標的尚未訂閱"
        : `連線異常: ${msg.slice(0, 40)}`,
    };
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function QuoteBadge({ state, reason }: { state: LiveQuote["state"]; reason?: string }) {
  if (state === "live") return <span className="_cl1-badge live">即時</span>;
  if (state === "stale") return <span className="_cl1-badge stale" title={reason}>盤後</span>;
  if (state === "loading") return <span className="_cl1-badge loading">載入中</span>;
  return <span className="_cl1-badge blocked" title={reason}>{reason ? reason.slice(0, 14) : "BLOCKED"}</span>;
}

function HoldingTableRow({ row }: { row: HoldingRow }) {
  const retClass = retTone(row.unrealizedReturn);
  const priceClass =
    row.unrealizedReturn == null
      ? "dim"
      : row.unrealizedReturn > 0
      ? "up"
      : row.unrealizedReturn < 0
      ? "dn"
      : "flat";

  return (
    <div className="_cl1-table-row">
      <div className="_cl1-cell _cl1-cell-ticker">{row.ticker}</div>
      <div className="_cl1-cell _cl1-cell-name">{row.displayName}</div>
      <div className="_cl1-cell" style={{ fontSize: 11, color: "#888" }}>
        {row.entryPrice != null ? (
          <>
            <div>{fmtPrice(row.entryPrice)}</div>
            <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>
              {row.entryPriceSource === "ohlcv_5_6_close" ? "5/6 收盤" : "不可用"}
            </div>
          </>
        ) : (
          <span style={{ color: "#444" }}>--</span>
        )}
      </div>
      <div className={`_cl1-cell _cl1-cell-price ${priceClass}`}>
        {fmtPrice(row.liveQuote.price)}
        {row.liveQuote.quoteTime && (
          <div className="_cl1-quote-time">{row.liveQuote.quoteTime.slice(0, 16)}</div>
        )}
      </div>
      <div className={`_cl1-cell _cl1-ret ${retClass}`}>
        {fmtPct(row.unrealizedReturn)}
      </div>
      <div className={`_cl1-cell _cl1-ret ${retClass}`}>
        {row.unrealizedPnlTwd != null ? `${fmtPnl(row.unrealizedPnlTwd)} TWD` : "--"}
      </div>
      <div className="_cl1-cell">
        <QuoteBadge state={row.liveQuote.state} reason={row.liveQuote.reason} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContLiqPeriod1Panel({
  holdings,
  bench0050EntryPrice,
}: {
  holdings: HoldingEntryInput[];
  bench0050EntryPrice: number | null;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const tradingDaysElapsed = approxTradingDays(DAY0, today);
  const calDaysElapsed = calendarDaysBetween(DAY0, today);
  const progressPct = Math.min(100, (tradingDaysElapsed / H20_TARGET) * 100);

  const [rows, setRows] = useState<HoldingRow[]>(() =>
    holdings.map((h) => ({
      ...h,
      liveQuote: { price: null, quoteTime: null, state: "loading" as const },
      unrealizedReturn: null,
      unrealizedPnlTwd: null,
    }))
  );

  const [bench0050Latest, setBench0050Latest] = useState<LiveQuote>({
    price: null,
    quoteTime: null,
    state: "loading",
  });

  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);

  const pollQuotes = useCallback(async () => {
    // Fetch all holdings + 0050 in parallel
    const tickerList = holdings.map((h) => h.ticker);
    const [quoteResults, bench0050Quote] = await Promise.all([
      Promise.all(tickerList.map((t) => fetchLatestPrice(t))),
      fetchLatestPrice("0050"),
    ]);

    setBench0050Latest(bench0050Quote);

    setRows((prev) =>
      prev.map((row, i) => {
        const lq = quoteResults[i];
        let unrealizedReturn: number | null = null;
        let unrealizedPnlTwd: number | null = null;

        if (row.entryPrice != null && lq.price != null && row.entryPrice > 0) {
          unrealizedReturn = (lq.price - row.entryPrice) / row.entryPrice;
          unrealizedPnlTwd = unrealizedReturn * POSITION_SIZE_TWD;
        }

        return { ...row, liveQuote: lq, unrealizedReturn, unrealizedPnlTwd };
      })
    );

    setLastPolledAt(new Date().toLocaleTimeString("zh-TW", { hour12: false }));
  }, [holdings]);

  useEffect(() => {
    pollQuotes();
    const timer = setInterval(pollQuotes, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pollQuotes]);

  // Basket KPI
  const kpi: BasketKpi = (() => {
    const withReturn = rows.filter((r) => r.unrealizedReturn != null);
    const avgReturn =
      withReturn.length > 0
        ? withReturn.reduce((s, r) => s + r.unrealizedReturn!, 0) / withReturn.length
        : null;
    const totalPnlTwd =
      withReturn.length > 0
        ? rows.reduce((s, r) => s + (r.unrealizedPnlTwd ?? 0), 0)
        : null;

    let bench0050Return: number | null = null;
    if (bench0050EntryPrice != null && bench0050EntryPrice > 0 && bench0050Latest.price != null) {
      bench0050Return = (bench0050Latest.price - bench0050EntryPrice) / bench0050EntryPrice;
    }

    const excess =
      avgReturn != null && bench0050Return != null ? avgReturn - bench0050Return : null;

    return { avgReturn, totalPnlTwd, bench0050Return, excess };
  })();

  return (
    <div className="_cl1-wrap">
      <style>{CSS}</style>

      {/* Status banner — always shown, cannot be removed */}
      <div className="_cl1-status-banner">
        <strong>研究前向觀察期間</strong><br />
        本區僅供研究追蹤用途。無真實下單，無生產環境執行。結果在 H20 觀察期結束前不算成熟。<br />
        <strong>非交易建議。非已驗證策略。不適合跟單。</strong><br />
        這是模擬觀察紀錄，不是買賣建議。
      </div>

      {/* Observation-start hero */}
      <div className="_cl1-anchor">
        <div className="_cl1-anchor-eyebrow">觀察起始日 — 5/6 鎖定觀察組合</div>
        <div className="_cl1-anchor-date">{DAY0}</div>
        <div className="_cl1-anchor-sub">
          策略：持續流動性強勢策略 v36（cont_liq_v36）&nbsp;·&nbsp;
          入場日：{DAY0}&nbsp;·&nbsp;
          預期退出：{EXPECTED_EXIT}&nbsp;·&nbsp;
          等權 4 檔
        </div>
      </div>

      {/* Progress */}
      <div className="_cl1-progress-wrap">
        <div className="_cl1-progress-header">
          <span className="_cl1-progress-title">前向觀察進度</span>
          <span className="_cl1-progress-count">
            約 {tradingDaysElapsed} 交易日 / H20 目標
          </span>
        </div>
        <div className="_cl1-progress-bar-bg">
          <div
            className="_cl1-progress-bar-fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="_cl1-progress-meta">
          <span>開始：{DAY0}（觀察起始日）</span>
          <span>今日：{today}（+{calDaysElapsed} 日曆日）</span>
          <span>預期退出：{EXPECTED_EXIT}</span>
        </div>
      </div>

      {/* Basket KPI hero */}
      <div className="_cl1-kpi-bar">
        <div className="_cl1-kpi-cell">
          <div className="_cl1-kpi-label">組合未實現報酬</div>
          <div className={`_cl1-kpi-value ${kpi.avgReturn == null ? "dim" : kpi.avgReturn >= 0 ? "pos" : "neg"}`}>
            {fmtPct(kpi.avgReturn)}
          </div>
          <div className="_cl1-kpi-sub">4 檔等權平均</div>
        </div>
        <div className="_cl1-kpi-cell">
          <div className="_cl1-kpi-label">等權損益（試算）</div>
          <div className={`_cl1-kpi-value ${kpi.totalPnlTwd == null ? "dim" : kpi.totalPnlTwd >= 0 ? "pos" : "neg"}`}>
            {kpi.totalPnlTwd != null ? `${fmtPnl(kpi.totalPnlTwd)} TWD` : "--"}
          </div>
          <div className="_cl1-kpi-sub">每檔假設 10,000 TWD（研究試算）</div>
        </div>
        <div className="_cl1-kpi-cell">
          <div className="_cl1-kpi-label">0050 同期報酬</div>
          <div className={`_cl1-kpi-value ${kpi.bench0050Return == null ? "dim" : kpi.bench0050Return >= 0 ? "pos" : "neg"}`}>
            {fmtPct(kpi.bench0050Return)}
          </div>
          <div className="_cl1-kpi-sub">5/6 → 今日（基準）</div>
        </div>
        <div className="_cl1-kpi-cell">
          <div className="_cl1-kpi-label">超額報酬 vs 0050</div>
          <div className={`_cl1-kpi-value ${kpi.excess == null ? "dim" : kpi.excess >= 0 ? "amber" : "neg"}`}>
            {fmtPct(kpi.excess)}
          </div>
          <div className="_cl1-kpi-sub">觀察組合 − 0050（前向觀察中）</div>
        </div>
      </div>

      {/* Per-holding table */}
      <div className="_cl1-table-wrap">
        <div className="_cl1-table-head">
          <div>代號</div>
          <div>名稱</div>
          <div>入場價 (5/6)</div>
          <div>最新報價</div>
          <div>未實現報酬</div>
          <div>損益試算</div>
          <div>報價狀態</div>
        </div>
        {rows.map((row) => (
          <HoldingTableRow key={row.ticker} row={row} />
        ))}
      </div>

      {/* Poll footer */}
      <div className="_cl1-poll-footer">
        {lastPolledAt ? `最後更新：${lastPolledAt}（每 30 秒自動刷新）` : "正在載入即時報價…"}
        &nbsp;·&nbsp;
        盤後期間 KGI 報價為盤中最後快取，標記「盤後」
      </div>

      {/* Research disclaimer repeat — cannot be truncated */}
      <div
        style={{
          marginTop: 20,
          padding: "12px 14px",
          background: "rgba(100,100,100,0.04)",
          border: "1px solid rgba(100,100,100,0.12)",
          borderRadius: 5,
          fontSize: 11,
          color: "#555",
          lineHeight: 1.7,
        }}
      >
        本區為第一期研究紀錄。數據來源：入場價 = FinMind OHLCV 2026-05-06 收盤；
        即時報價 = KGI 報價服務；0050 基準 = 同期 OHLCV 比較。
        等權損益為研究試算（每檔 10,000 TWD），不代表實際倉位大小。
        策略尚在前向觀察期，H20 到期前不得作為任何投資決策依據。
      </div>
    </div>
  );
}
