"use client";

import { useEffect, useState } from "react";
import { getCompanyFullProfile, type FullProfileMarginShortRow } from "@/lib/api";

type MarginState =
  | { status: "loading" }
  | { status: "blocked"; reason: string }
  | { status: "empty"; date: string }
  | { status: "live"; row: FullProfileMarginShortRow; date: string; stale: boolean };

const MS_CSS = `
._ms-bar {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  background: rgba(220,228,240,0.06);
  border: 1px solid rgba(220,228,240,0.09);
  margin-top: 8px;
}
._ms-cell {
  background: rgba(5,8,12,0.60);
  padding: 10px 12px 11px;
  display: flex; flex-direction: column; gap: 3px;
}
._ms-label {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: var(--night-mid, #91a0b5);
}
._ms-value {
  font-family: var(--mono);
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  color: var(--night-ink, #e7ecf3);
}
._ms-change {
  font-family: var(--mono);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
._ms-change.up   { color: var(--tw-up-bright, #e63946); }
._ms-change.down { color: var(--tac-ok, #4ade80); }
._ms-change.flat { color: var(--night-mid, #91a0b5); }
._ms-sub {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--night-mid, #91a0b5);
  margin-top: 2px;
}
._ms-util-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 4px 0;
  font-family: var(--mono); font-size: 10px;
}
._ms-util-label { color: var(--night-mid, #91a0b5); }
`;

function fmtBalance(v: number | null): string {
  if (v == null) return "--";
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}萬`;
  return v.toLocaleString("zh-TW");
}

function fmtChange(v: number | null): { text: string; cls: string } {
  if (v == null) return { text: "--", cls: "flat" };
  const sign = v > 0 ? "+" : "";
  const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
  return { text: `${sign}${v.toLocaleString("zh-TW")}`, cls };
}

function marginUtilRate(margin: number | null, short: number | null): string | null {
  if (margin == null || short == null || margin === 0) return null;
  const rate = (short / margin * 100).toFixed(1);
  return `融券/融資比 ${rate}%`;
}

export function MarginShortPanel({ companyId }: { companyId: string }) {
  const [state, setState] = useState<MarginState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    getCompanyFullProfile(companyId)
      .then((res) => {
        if (!active) return;
        const section = res?.data?.tradingFlow?.marginShort;
        if (!section) {
          setState({ status: "blocked", reason: "full-profile 回應缺少 tradingFlow.marginShort" });
          return;
        }
        if (section.state === "BLOCKED" || section.state === "ERROR") {
          setState({ status: "blocked", reason: section.sourceTrail?.degradedReason ?? "融資券資料暫時無法讀取（FinMind 離線）" });
          return;
        }
        if (!section.latest) {
          const date = section.updatedAt?.slice(0, 10) ?? "--";
          setState({ status: "empty", date });
          return;
        }
        const row = section.latest as FullProfileMarginShortRow;
        const stale = section.state === "STALE";
        setState({ status: "live", row, date: row.date, stale });
      })
      .catch((err) => {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ status: "blocked", reason: `融資券資料讀取失敗：${msg.slice(0, 80)}` });
      });
    return () => { active = false; };
  }, [companyId]);

  return (
    <section className="panel hud-frame" style={{ marginBottom: 12 }}>
      <style>{MS_CSS}</style>
      <h3 className="ascii-head" style={{ marginBottom: 6 }}>
        <span className="ascii-head-bracket">融資券</span> 餘額變化
        {state.status === "live" && (
          <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>
            {state.date}{state.stale ? " (略舊)" : ""}
          </span>
        )}
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在讀取 FinMind 融資券餘額資料…</span>
        </div>
      )}

      {state.status === "blocked" && (
        <div className="state-panel">
          <span className="badge badge-red">BLOCKED</span>
          <span className="tg soft">來源：FinMind TaiwanStockMarginPurchaseShortSale</span>
          <span className="state-reason">{state.reason}</span>
        </div>
      )}

      {state.status === "empty" && (
        <div className="state-panel">
          <span className="badge badge-yellow">無資料</span>
          <span className="tg soft">今日尚無融資券資料（{state.date}）</span>
          <span className="state-reason">非交易日或盤前可能無資料。</span>
        </div>
      )}

      {state.status === "live" && (() => {
        const { row } = state;
        const marginChange = fmtChange(row.marginChange);
        const shortChange  = fmtChange(row.shortChange);
        const utilRate     = marginUtilRate(row.marginBalance, row.shortBalance);
        return (
          <>
            <div className="_ms-bar">
              <div className="_ms-cell">
                <span className="_ms-label">融資餘額</span>
                <span className="_ms-value">{fmtBalance(row.marginBalance)}</span>
                <span className={`_ms-change ${marginChange.cls}`}>{marginChange.text} 張</span>
                <span className="_ms-sub">vs 昨日</span>
              </div>
              <div className="_ms-cell">
                <span className="_ms-label">融券餘額</span>
                <span className="_ms-value">{fmtBalance(row.shortBalance)}</span>
                <span className={`_ms-change ${shortChange.cls}`}>{shortChange.text} 張</span>
                <span className="_ms-sub">vs 昨日</span>
              </div>
            </div>
            {utilRate && (
              <div className="_ms-util-row">
                <span className="_ms-util-label">{utilRate}</span>
              </div>
            )}
          </>
        );
      })()}
    </section>
  );
}
