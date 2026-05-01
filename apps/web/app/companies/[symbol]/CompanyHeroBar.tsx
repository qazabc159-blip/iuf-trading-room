"use client";

import type { CompanyDetailQuote, CompanyDetailView } from "@/lib/company-adapter";
import { industryLabel } from "@/lib/industry-i18n";

function signed(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function tone(value: number | null | undefined) {
  if (typeof value !== "number") return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

function formatAsOf(value: string | null | undefined) {
  if (!value) return "無資料";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
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
  const source = quote?.source ? quote.source.toUpperCase() : "無資料";
  const quoteTone = tone(changePercent);
  const themes = company.themes.map((theme) => industryLabel(theme)).join(" / ");

  return (
    <div className="company-hero-bar">
      <div className="company-hero-main">
        <div>
          <div className="tg gold">公司總覽</div>
          <div className="company-hero-title">
            <span className="num">{company.symbol}</span>
            <span className="tc">{company.name}</span>
            <span className="badge badge-blue">{marketLabel[company.market] ?? company.market}</span>
            <span className="badge badge-yellow">{tierLabel[company.beneficiaryTier] ?? company.beneficiaryTier}</span>
          </div>
        </div>
        <div className="tg soft">
          {industryLabel(company.chainPosition)} / {themes || "尚無主題"}
        </div>
      </div>

      <div className="company-hero-quote">
        <div className="company-hero-price num">{quote?.last?.toLocaleString("zh-TW") ?? "--"}</div>
        <div className={`badge ${quoteTone === "up" ? "badge-red" : quoteTone === "down" ? "badge-green" : "badge-blue"}`}>
          {signed(changePercent)}%
        </div>
        <div className="tg soft">量 {quote?.volume?.toLocaleString("zh-TW") ?? "--"}</div>
        <div className="tg muted">更新 {formatAsOf(quote?.asOf)}</div>
        <div className="tg badge badge-blue">來源 {source}</div>
      </div>
    </div>
  );
}
