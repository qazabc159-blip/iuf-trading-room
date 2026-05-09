"use client";

import type { CompanyDetailQuote, CompanyDetailView } from "@/lib/company-adapter";
import { industryLabel } from "@/lib/industry-i18n";

const CO_HERO_CSS = `
/* ── _co-hero-* — company detail hero bar upgrade ── */
@keyframes _co-pulse-ring {
  0%   { box-shadow: 0 0 0 0 rgba(78,205,130,0.55); }
  70%  { box-shadow: 0 0 0 7px rgba(78,205,130,0); }
  100% { box-shadow: 0 0 0 0 rgba(78,205,130,0); }
}
@keyframes _co-pulse-dot {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.38; }
}
@keyframes _co-glow-amber {
  0%, 100% { text-shadow: 0 0 8px rgba(226,184,92,0.55); }
  50%       { text-shadow: 0 0 18px rgba(226,184,92,0.9); }
}
@keyframes _co-glow-red {
  0%, 100% { text-shadow: 0 0 8px rgba(230,57,70,0.55); }
  50%       { text-shadow: 0 0 18px rgba(230,57,70,0.9); }
}
@media (prefers-reduced-motion: reduce) {
  ._co-live-badge-dot,
  ._co-price-up,
  ._co-price-down { animation: none !important; }
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

/* KPI 大字 strip — 7 cells matching homepage metric style */
._co-kpi-strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-bottom: 1px solid rgba(220,228,240,0.09);
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
  padding: 14px 18px 16px;
  border-right: 1px solid rgba(220,228,240,0.09);
  position: relative;
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
  font-size: 28px;
  font-weight: 800;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  color: var(--night-ink, #e7ecf3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
._co-kpi-value.--sm {
  font-size: 20px;
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
._co-price-down {
  color: var(--tw-dn-bright, #4adb88) !important;
  animation: _co-glow-amber 3.2s ease-in-out infinite;
}
._co-price-flat { color: var(--night-mid, #91a0b5) !important; }
._co-amber {
  color: var(--gold-bright, #e2b85c) !important;
  animation: _co-glow-amber 3.2s ease-in-out infinite;
}

/* Hero name + badge row */
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

/* Live badge */
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
  width: 6px;
  height: 6px;
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
  border: 1px solid rgba(145,160,181,0.28);
  background: rgba(145,160,181,0.05);
  font-family: var(--mono);
  font-size: 10px;
  color: var(--night-soft, #566276);
}
`;

function signed(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function tone(value: number | null | undefined) {
  if (typeof value !== "number") return "flat";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
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

function formatVol(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}億`;
  if (value >= 1e4) return `${(value / 1e4).toFixed(0)}萬`;
  return value.toLocaleString("zh-TW");
}

function formatMktCap(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}兆`;
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}億`;
  return value.toLocaleString("zh-TW");
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
}: {
  company: CompanyDetailView;
  quote: CompanyDetailQuote | null;
}) {
  const changePercent = quote?.changePercent ?? company.intradayChgPct;
  const priceTone = tone(changePercent);
  const themes = company.themes.map((theme) => industryLabel(theme)).join(" / ");
  const lastPrice = quote?.last;
  const volume = quote?.volume ?? null;
  const isLive = quote?.source === "kgi" || quote?.state === "LIVE";
  const isStale = quote?.state === "STALE";

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
          {industryLabel(company.chainPosition)} / {themes || "尚無主題"} / 更新 {formatAsOf(quote?.asOf)} / 來源 {quote?.source?.toUpperCase() ?? "待接"}
        </div>

        {/* 7-cell KPI strip */}
        <div className="_co-kpi-strip">
          {/* Price */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">最新價</span>
            <span className={`_co-kpi-value ${priceTone === "up" ? "_co-price-up" : priceTone === "down" ? "_co-price-down" : ""}`}>
              {typeof lastPrice === "number" ? lastPrice.toLocaleString("zh-TW", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : "--"}
            </span>
            <span className="_co-kpi-sub">TWD</span>
          </div>

          {/* Change % */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">漲跌幅</span>
            <span className={`_co-kpi-value ${priceTone === "up" ? "_co-price-up" : priceTone === "down" ? "_co-price-down" : "_co-price-flat"}`}>
              {signed(changePercent)}%
            </span>
            <span className="_co-kpi-sub">{priceTone === "up" ? "上漲" : priceTone === "down" ? "下跌" : "持平"}</span>
          </div>

          {/* Volume */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">成交量</span>
            <span className="_co-kpi-value --sm">{formatVol(volume)}</span>
            <span className="_co-kpi-sub">股 / 張</span>
          </div>

          {/* Open */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">開盤</span>
            <span className="_co-kpi-value --sm">
              {typeof quote?.open === "number" ? quote.open.toLocaleString("zh-TW", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : "--"}
            </span>
            <span className="_co-kpi-sub">今日開盤價</span>
          </div>

          {/* High */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">最高</span>
            <span className={`_co-kpi-value --sm ${typeof quote?.high === "number" ? "_co-price-up" : ""}`}>
              {typeof quote?.high === "number" ? quote.high.toLocaleString("zh-TW", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : "--"}
            </span>
            <span className="_co-kpi-sub">今日最高</span>
          </div>

          {/* Low */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">最低</span>
            <span className={`_co-kpi-value --sm ${typeof quote?.low === "number" ? "_co-price-down" : ""}`}>
              {typeof quote?.low === "number" ? quote.low.toLocaleString("zh-TW", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : "--"}
            </span>
            <span className="_co-kpi-sub">今日最低</span>
          </div>

          {/* Market cap / momentum */}
          <div className="_co-kpi-cell">
            <span className="_co-kpi-label">動能</span>
            <span className={`_co-kpi-value --sm ${priceTone === "up" ? "_co-amber" : priceTone === "down" ? "_co-price-down" : "_co-price-flat"}`}>
              {changePercent !== null && changePercent !== undefined
                ? (Math.abs(changePercent) > 1 ? (changePercent > 0 ? "偏強" : "偏弱") : "中性")
                : "待接"}
            </span>
            <span className="_co-kpi-sub">{formatMktCap(quote?.marketCap ?? null)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
