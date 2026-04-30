"use client";

import { useMemo, useState } from "react";
import type { ChipsRow } from "@/lib/company-adapter";

type Tab = "institutional" | "margin" | "holders";

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function tone(value: number) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

export function ChipsPanel({ rows }: { rows: ChipsRow[] }) {
  const [tab, setTab] = useState<Tab>("institutional");
  const totals = useMemo(() => rows.reduce(
    (acc, row) => ({
      foreign: acc.foreign + row.foreign,
      trust: acc.trust + row.trust,
      dealer: acc.dealer + row.dealer,
    }),
    { foreign: 0, trust: 0, dealer: 0 },
  ), [rows]);
  const maxAbs = Math.max(...rows.map((row) => Math.abs(row.foreign) + Math.abs(row.trust) + Math.abs(row.dealer)), 1);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">CHP</span>
          <span className="tg muted"> - </span>
          <span className="tg gold">籌碼面板</span>
          <div className="panel-sub">法人 / 融資券 / 大戶 placeholder</div>
        </div>
        <div className="company-tabs-inline">
          {([
            ["institutional", "三大法人"],
            ["margin", "融資券"],
            ["holders", "大戶"],
          ] as const).map(([key, label]) => (
            <button className={tab === key ? "mini-button" : "outline-button"} key={key} onClick={() => setTab(key)} type="button">{label}</button>
          ))}
        </div>
      </div>

      {tab === "institutional" && (
        <div className="chips-panel">
          <div className="chips-summary">
            <span className={`badge ${tone(totals.foreign) === "up" ? "badge-red" : "badge-green"}`}>外資 {signed(totals.foreign)} BN</span>
            <span className={`badge ${tone(totals.trust) === "up" ? "badge-red" : "badge-green"}`}>投信 {signed(totals.trust)} BN</span>
            <span className={`badge ${tone(totals.dealer) === "up" ? "badge-red" : "badge-green"}`}>自營 {signed(totals.dealer)} BN</span>
          </div>
          {rows.slice(0, 16).map((row) => {
            const total = row.foreign + row.trust + row.dealer;
            return (
              <div className="row chips-row" key={row.date}>
                <span className="tg soft">{row.date}</span>
                <div className="bar"><span style={{ width: `${Math.max(4, Math.abs(total) / maxAbs * 100)}%` }} /></div>
                <span className={`num ${tone(total)}`}>{signed(total)}</span>
              </div>
            );
          })}
        </div>
      )}

      {tab === "margin" && (
        <div className="company-data-table">
          <div className="row company-margin-row table-head"><span>日序</span><span>融資餘額</span><span>融券餘額</span><span>券資比</span></div>
          {rows.slice(0, 12).map((row) => (
            <div className="row company-margin-row" key={row.date}>
              <span className="tg">{row.date}</span>
              <span className="num">{row.marginBalance.toLocaleString("en-US")}</span>
              <span className="num">{row.shortBalance.toLocaleString("en-US")}</span>
              <span className="num gold">{((row.shortBalance / row.marginBalance) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}

      {tab === "holders" && (
        <div className="terminal-note">大戶持股資料尚未接回。此格保留給 W7 D6 後端 endpoint。</div>
      )}
    </section>
  );
}

