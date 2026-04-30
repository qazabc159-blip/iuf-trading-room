"use client";

import { useMemo, useState } from "react";
import type { DividendRow, FinancialRow, RevenueRow } from "@/lib/company-adapter";

type Tab = "quarterly" | "yearly" | "revenue" | "dividend";

function tone(value: number) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

function money(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function FinancialsPanel({
  symbol,
  quarterly,
  yearly,
  revenue,
  dividend,
}: {
  symbol: string;
  quarterly: FinancialRow[];
  yearly: FinancialRow[];
  revenue: RevenueRow[];
  dividend: DividendRow[];
}) {
  const [tab, setTab] = useState<Tab>("quarterly");
  const maxRevenue = useMemo(() => Math.max(...revenue.map((item) => item.revenue), 1), [revenue]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">FIN</span>
          <span className="tg muted"> - </span>
          <span className="tg gold">財報與營收</span>
          <div className="panel-sub">{symbol} mock financial surface</div>
        </div>
        <div className="company-tabs-inline">
          {([
            ["quarterly", "季報"],
            ["yearly", "年報"],
            ["revenue", "月營收"],
            ["dividend", "股利"],
          ] as const).map(([key, label]) => (
            <button className={tab === key ? "mini-button" : "outline-button"} key={key} onClick={() => setTab(key)} type="button">{label}</button>
          ))}
        </div>
      </div>

      {tab === "quarterly" || tab === "yearly" ? (
        <div className="company-data-table">
          <div className="row company-fin-row table-head">
            <span>期別</span><span>營收</span><span>毛利率</span><span>營益率</span><span>EPS</span><span>YoY</span>
          </div>
          {(tab === "quarterly" ? quarterly : yearly).map((row) => (
            <div className="row company-fin-row" key={row.period}>
              <span className="tg">{row.period}</span>
              <span className="num">{money(row.revenue)}</span>
              <span className="num">{row.grossMargin.toFixed(1)}%</span>
              <span className="num">{row.opMargin.toFixed(1)}%</span>
              <span className="num">{row.eps.toFixed(2)}</span>
              <span className={`num ${tone(row.yoy)}`}>{row.yoy > 0 ? "+" : ""}{row.yoy.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "revenue" && (
        <div className="revenue-bars">
          {revenue.slice(0, 18).map((row) => (
            <div className="revenue-bar" key={row.month}>
              <span className="tg soft">{row.month}</span>
              <div className="bar"><span style={{ width: `${Math.max(8, (row.revenue / maxRevenue) * 100)}%` }} /></div>
              <b className={`num ${tone(row.yoy)}`}>{row.yoy > 0 ? "+" : ""}{row.yoy.toFixed(1)}%</b>
            </div>
          ))}
        </div>
      )}

      {tab === "dividend" && (
        <div className="company-data-table">
          <div className="row company-div-row table-head">
            <span>年度</span><span>現金</span><span>股票</span><span>殖利率</span>
          </div>
          {dividend.map((row) => (
            <div className="row company-div-row" key={row.year}>
              <span className="tg">{row.year}</span>
              <span className="num">{row.cash.toFixed(2)}</span>
              <span className="num">{row.stock.toFixed(2)}</span>
              <span className="num gold">{row.yieldPct.toFixed(2)}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

