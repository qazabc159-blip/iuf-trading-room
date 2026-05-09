"use client";

import { useEffect, useState } from "react";
import { getCompanyFullProfile, type FullProfileInstitutionalRow } from "@/lib/api";

type InstState =
  | { status: "loading" }
  | { status: "blocked"; reason: string }
  | { status: "empty"; date: string }
  | { status: "live"; row: FullProfileInstitutionalRow; date: string; stale: boolean };

const INST_CSS = `
._inst-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: rgba(220,228,240,0.06);
  border: 1px solid rgba(220,228,240,0.09);
  margin-top: 8px;
}
._inst-cell {
  background: rgba(5,8,12,0.60);
  padding: 10px 12px 11px;
  display: flex; flex-direction: column; gap: 3px;
}
._inst-label {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: var(--night-mid, #91a0b5);
}
._inst-value {
  font-family: var(--mono);
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
._inst-value.buy  { color: var(--tw-up-bright, #e63946); }
._inst-value.sell { color: var(--tac-ok, #4ade80); }
._inst-value.flat { color: var(--night-mid, #91a0b5); }
._inst-sub {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--night-mid, #91a0b5);
}
._inst-total-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 4px 0;
  font-family: var(--mono); font-size: 10.5px;
}
._inst-total-label { color: var(--night-mid, #91a0b5); }
._inst-total-val { font-weight: 700; font-variant-numeric: tabular-nums; }
._inst-total-val.buy  { color: var(--tw-up-bright, #e63946); }
._inst-total-val.sell { color: var(--tac-ok, #4ade80); }
._inst-total-val.flat { color: var(--night-mid, #91a0b5); }
`;

function fmtLots(v: number): string {
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}萬`;
  return `${sign}${abs.toLocaleString("zh-TW")}`;
}

function tone(v: number): string {
  return v > 0 ? "buy" : v < 0 ? "sell" : "flat";
}

export function InstitutionalPanel({ companyId }: { companyId: string }) {
  const [state, setState] = useState<InstState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    getCompanyFullProfile(companyId)
      .then((res) => {
        if (!active) return;
        const section = res?.data?.tradingFlow?.institutional;
        if (!section) {
          setState({ status: "blocked", reason: "full-profile 回應缺少 tradingFlow.institutional" });
          return;
        }
        if (section.state === "BLOCKED" || section.state === "ERROR") {
          setState({ status: "blocked", reason: section.sourceTrail?.degradedReason ?? "法人資料暫時無法讀取（FinMind 離線）" });
          return;
        }
        if (!section.latest) {
          const date = section.updatedAt?.slice(0, 10) ?? "--";
          setState({ status: "empty", date });
          return;
        }
        const row = section.latest as FullProfileInstitutionalRow;
        const stale = section.state === "STALE";
        setState({ status: "live", row, date: row.date, stale });
      })
      .catch((err) => {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ status: "blocked", reason: `法人資料讀取失敗：${msg.slice(0, 80)}` });
      });
    return () => { active = false; };
  }, [companyId]);

  return (
    <section className="panel hud-frame" style={{ marginBottom: 12 }}>
      <style>{INST_CSS}</style>
      <h3 className="ascii-head" style={{ marginBottom: 6 }}>
        <span className="ascii-head-bracket">法人</span> 今日三大法人
        {state.status === "live" && (
          <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>
            {state.date}{state.stale ? " (略舊)" : ""}
          </span>
        )}
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在讀取 FinMind 三大法人資料…</span>
        </div>
      )}

      {state.status === "blocked" && (
        <div className="state-panel">
          <span className="badge badge-red">BLOCKED</span>
          <span className="tg soft">來源：FinMind TaiwanStockInstitutionalInvestorsBuySell</span>
          <span className="state-reason">{state.reason}</span>
        </div>
      )}

      {state.status === "empty" && (
        <div className="state-panel">
          <span className="badge badge-yellow">無資料</span>
          <span className="tg soft">今日尚無法人買賣資料（{state.date}）</span>
          <span className="state-reason">盤前或非交易日可能無資料；收盤後 FinMind 約 30 分鐘更新。</span>
        </div>
      )}

      {state.status === "live" && (() => {
        const { row } = state;
        const cells = [
          { label: "外資", value: row.foreign,         unit: "張" },
          { label: "投信", value: row.investmentTrust,  unit: "張" },
          { label: "自營", value: row.dealer,           unit: "張" },
        ];
        return (
          <>
            <div className="_inst-bar">
              {cells.map(({ label, value, unit }) => (
                <div key={label} className="_inst-cell">
                  <span className="_inst-label">{label}</span>
                  <span className={`_inst-value ${tone(value)}`}>{fmtLots(value)}</span>
                  <span className="_inst-sub">{unit}</span>
                </div>
              ))}
            </div>
            <div className="_inst-total-row">
              <span className="_inst-total-label">三大法人合計</span>
              <span className={`_inst-total-val ${tone(row.totalNetBuy)}`}>{fmtLots(row.totalNetBuy)} 張</span>
            </div>
          </>
        );
      })()}
    </section>
  );
}
