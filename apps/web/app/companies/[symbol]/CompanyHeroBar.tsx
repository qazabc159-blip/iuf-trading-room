"use client";

import type { CompanyDetailQuote, CompanyDetailView } from "@/lib/company-adapter";

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
  if (!value) return "尚無時間";
  return new Date(value).toLocaleTimeString("zh-TW", { hour12: false });
}

export function CompanyHeroBar({
  company,
  quote,
}: {
  company: CompanyDetailView;
  quote: CompanyDetailQuote | null;
}) {
  const changePercent = quote?.changePercent ?? company.intradayChgPct;
  const source = quote?.source ? quote.source.toUpperCase() : "EMPTY";

  return (
    <div className="company-hero-bar">
      <div className="company-hero-main">
        <div>
          <div className="tg gold">COMPANY NODE</div>
          <div className="company-hero-title">
            <span className="num">{company.symbol}</span>
            <span className="tc">{company.name}</span>
            <span className="badge badge-blue">{company.market}</span>
            <span className="badge badge-yellow">{company.beneficiaryTier}</span>
          </div>
        </div>
        <div className="tg soft">
          {company.chainPosition} · {company.themes.join(" / ")}
        </div>
      </div>

      <div className="company-hero-quote">
        <div className="company-hero-price num">{quote?.last?.toLocaleString("en-US") ?? "--"}</div>
        <div className={`badge ${tone(changePercent) === "up" ? "badge-red" : tone(changePercent) === "down" ? "badge-green" : "badge-blue"}`}>
          {signed(changePercent)}%
        </div>
        <div className="tg soft">量 {quote?.volume?.toLocaleString("en-US") ?? "--"}</div>
        <div className="tg muted">AS OF {formatAsOf(quote?.asOf)}</div>
        <div className="tg badge badge-blue">SRC {source}</div>
      </div>
    </div>
  );
}
