"use client";

import type { CompanyDetailQuote, CompanyDetailView } from "@/lib/company-adapter";
import type { CompanyRealtimeQuote } from "@/lib/api";
import { industryLabel } from "@/lib/industry-i18n";

// Subset of OhlcvBar fields needed for OHLC display
type OhlcvSnapshot = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dt: string;
};

const CO_HERO_CSS = `
/* ── _co-hero-* — company detail hero bar product-grade upgrade ── */
@keyframes _co-pulse-ring {
  0%   { box-shadow: 0 0 0 0 rgba(78,205,130,0.55); }
  70%  { box-shadow: 0 0 0 7px rgba(78,205,130,0); }
  100% { box-shadow: 0 0 0 0 rgba(78,205,130,0); }
}
@keyframes _co-glow-amber {
  0%, 100% { text-shadow: 0 0 8px rgba(226,184,92,0.5); }
  50%       { text-shadow: 0 0 20px rgba(226,184,92,0.9); }
}
@keyframes _co-glow-red {
  0%, 100% { text-shadow: 0 0 8px rgba(230,57,70,0.5); }
  50%       { text-shadow: 0 0 20px rgba(230,57,70,0.9); }
}
@media (prefers-reduced-motion: reduce) {
  ._co-live-badge-dot,
  ._co-price-up,
  ._co-price-dn { animation: none !important; }
}

._co-hero-wrap {
  margin: 4px 0 0;
  border-left: 3px solid rgba(226,184,92,0.8);
  background: linear-gradient(90deg, rgba(226,184,92,0.09) 0%, rgba(226,184,92,0.02) 44%, transparent 100%),
              rgba(5,8,12,0.52);
  position: relative;
  overflow: hidden;
}
._co-hero-wrap::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(226,184,92,0.03) 0%, transparent 60%);
  pointer-events: none;
}

/* Identity row */
._co-hero-identity {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 14px;
  padding: 16px 20px 10px;
}
._co-hero-symbol {
  font-family: var(--mono);
  font-size: 28px;
  font-weight: 800;
  color: var(--gold, #c8943f);
  line-height: 1.1;
}
._co-hero-name {
  font-family: var(--sans-tc);
  font-size: 17px;
  color: var(--night-ink, #e7ecf3);
}
._co-hero-meta {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--night-mid, #91a0b5);
  padding: 0 20px 12px;
  letter-spacing: 0.04em;
}

/* KPI strip — 7 cells matching homepage metric style */
._co-kpi-strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-top: 1px solid rgba(220,228,240,0.07);
}
@media (max-width: 1080px) {
  ._co-kpi-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  ._co-kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

._co-kpi-cell {
  min-width: 0;
  display: grid;
  gap: 5px;
  align-content: start;
  padding: 13px 16px 14px;
  border-right: 1px solid rgba(220,228,240,0.08);
}
._co-kpi-cell:last-child { border-right: none; }

._co-kpi-label {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.09em;
  color: var(--night-mid, #91a0b5);
  line-height: 1;
}
._co-kpi-value {
  font-family: var(--mono);
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--night-ink, #e7ecf3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
._co-kpi-value.--md {
  font-size: 20px;
}
._co-kpi-value.--sm {
  font-size: 16px;
}
._co-kpi-sub {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--night-soft, #566276);
  line-height: 1.35;
}
._co-price-up {
  color: var(--tw-up-bright, #ff5b6b) !important;
  animation: _co-glow-red 3.2s ease-in-out infinite;
}
._co-price-dn {
  color: var(--tw-dn-bright, #4adb88) !important;
  animation: _co-glow-amber 3.2s ease-in-out infinite;
}
._co-price-flat { color: var(--night-mid, #91a0b5) !important; }
._co-amber {
  color: var(--gold-bright, #e2b85c) !important;
}

/* Live / stale badges */
._co-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border: 1px solid rgba(78,205,130,0.42);
  background: rgba(78,205,130,0.08);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--tw-dn-bright, #4adb88);
}
._co-live-badge-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--tw-dn-bright, #4adb88);
  animation: _co-pulse-ring 1.8s ease-out infinite;
}
._co-stale-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border: 1px solid rgba(200,148,63,0.42);
  background: rgba(200,148,63,0.08);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--gold-bright, #e2b85c);
}
._co-wait-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border: 1px solid rgba(145,160,181,0.22);
  background: rgba(145,160,181,0.04);
  font-family: var(--mono);
  font-size: 10px;
  color: var(--night-soft, #566276);
}
`;

function signed(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function priceTone(value: number | null | undefined) {
  if (typeof value !== "number") return "flat" as const;
  if (value > 0) return "up" as const;
  if (value < 0) return "dn" as const;
  return "flat" as const;
}

function fmtPrice(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("zh-TW", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function fmtVol(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}億`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(0)}萬`;
  return value.toLocaleString("zh-TW");
}

function formatAsOf(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const month = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  const day = String(taipei.getUTCDate()).padStart(2, "0");
  const hour = String(taipei.getUTCHours()).padStart(2, "0");
  const minute = String(taipei.getUTCMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

const tierLabel: Record<string, string> = {
  Core: "核心受惠",
  Direct: "直接受惠",
  Indirect: "間接受惠",
  Observation: "觀察",
};

const marketLabel: Record<string, string> = {
  TWSE: "上市",
  TPEX: "上櫃",
  OTC: "上櫃",
};

export function CompanyHeroBar({
  company,
  quote,
  realtimeQuote,
  lastBar,
}: {
  company: CompanyDetailView;
  quote: CompanyDetailQuote | null;
  realtimeQuote?: CompanyRealtimeQuote | null;
  lastBar?: OhlcvSnapshot | null;
}) {
  // Best price: prefer realtime KGI gateway price, fallback to last OHLCV close
  const bestPrice = realtimeQuote?.lastPrice ?? quote?.last ?? null;
  const changePercent = quote?.changePercent ?? company.intradayChgPct;
  const changePct = changePercent ?? null;
  const tone = priceTone(changePct);

  // Data state
  const rtState = realtimeQuote?.state;
  const isLive = rtState === "LIVE";
  const isStale = rtState === "STALE";
  const rtSource = realtimeQuote ? "KGI 即時" : quote?.source === "kgi" ? "KGI" : quote?.source === "finmind" ? "FinMind" : null;

  // Volume: prefer realtime
  const vol = realtimeQuote?.volume ?? quote?.volume ?? null;

  // OHLC from last bar
  const open = lastBar?.open ?? null;
  const high = lastBar?.high ?? null;
  const low = lastBar?.low ?? null;

  const themes = company.themes.map((t) => industryLabel(t)).join(" / ");
  const asOf = realtimeQuote?.updatedAt ?? quote?.asOf;

  // Momentum label
  const momentum = changePct !== null
    ? (Math.abs(changePct) > 1.5 ? (changePct > 0 ? "偏強" : "偏弱") : changePct > 0.2 ? "略強" : changePct < -0.2 ? "略弱" : "中性")
    : "待接";

  return (
    <>
      <style>{CO_HERO_CSS}</style>
      <div className="_co-hero-wrap">
        {/* Identity row */}
        <div className="_co-hero-identity">
          <span className="_co-hero-symbol">{company.symbol}</span>
          <span className="_co-hero-name">{company.name}</span>
          <span className="badge badge-blue">{marketLabel[company.market] ?? company.market}</span>
          <span className="badge badge-yellow">{tierLabel[company.beneficiaryTier] ?? company.beneficiaryTier}</span>
          {isLive ? (
            <span className="_co-live-badge">
              <span className="_co-live-badge-dot" />
              即時
            </span>
          ) : isStale ? (
            <span className="_co-stale-badge">略舊</span>
          ) : (
            <span className="_co-wait-badge">等待報價</span>
          )}
        </div>

        {/* Meta line */}
        <div className="_co-hero-meta">
          {industryLabel(company.chainPosition)} / {themes || "尚無主題"} / 更新 {formatAsOf(asOf)} / 來源 {rtSource ?? "待接"}
        </div>

        {/* 7-cell KPI strip */}
        <div className="_co-kpi-strip">
          {/* 1. Price */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">最新價</span>
            <span className={`_co-kpi-value ${tone === "up" ? "_co-price-up" : tone === "dn" ? "_co-price-dn" : ""}`}>
              {fmtPrice(bestPrice)}
            </span>
            <span className="_co-kpi-sub">TWD</span>
          </div>

          {/* 2. Change % */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">漲跌幅</span>
            <span className={`_co-kpi-value ${tone === "up" ? "_co-price-up" : tone === "dn" ? "_co-price-dn" : "_co-price-flat"}`}>
              {signed(changePct)}%
            </span>
            <span className="_co-kpi-sub">{signed(quote?.change)}</span>
          </div>

          {/* 3. Volume */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">成交量</span>
            <span className="_co-kpi-value --md">{fmtVol(vol)}</span>
            <span className="_co-kpi-sub">股 / 張</span>
          </div>

          {/* 4. Open */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">開盤</span>
            <span className="_co-kpi-value --md">{fmtPrice(open)}</span>
            <span className="_co-kpi-sub">今日</span>
          </div>

          {/* 5. High */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">最高</span>
            <span className={`_co-kpi-value --md ${high !== null ? "_co-price-up" : ""}`}>{fmtPrice(high)}</span>
            <span className="_co-kpi-sub">今日</span>
          </div>

          {/* 6. Low */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">最低</span>
            <span className={`_co-kpi-value --md ${low !== null ? "_co-price-dn" : ""}`}>{fmtPrice(low)}</span>
            <span className="_co-kpi-sub">今日</span>
          </div>

          {/* 7. Momentum */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">動能</span>
            <span className={`_co-kpi-value --sm ${tone === "up" ? "_co-amber" : tone === "dn" ? "_co-price-dn" : "_co-price-flat"}`}>
              {momentum}
            </span>
            <span className="_co-kpi-sub">
              {realtimeQuote?.bid !== null && realtimeQuote?.bid !== undefined ? `B ${fmtPrice(realtimeQuote.bid)}` : ""}
              {realtimeQuote?.ask !== null && realtimeQuote?.ask !== undefined ? ` A ${fmtPrice(realtimeQuote.ask)}` : ""}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
