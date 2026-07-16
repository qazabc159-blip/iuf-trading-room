"use client";

import { useEffect, useState } from "react";
import { getCompanyFullProfile, type FullProfileInstitutionalRow } from "@/lib/api";
import { formatInstitutionalNetLotsZh } from "@/lib/institutional-lots-format";

// 30 日累計淨買賣超 — Pete review (#1293) 抓到：舊 ChipsPanel 的 net30d
// （apps/web/lib/api.ts CompanyChipsData，近 30 日累計）在拆分時被拿掉，
// InstitutionalPanel 原本只顯示 latest（單日快照），是被移除的獨立指標，非
// 純格式重整。/full-profile 的 tradingFlow.institutional.history 本來就是
// 近 30 曆日資料（apps/api/src/server.ts:11028 "last 30 calendar days"），
// 在這裡直接加總即可補回 30 日視角，零新增後端呼叫。
interface Net30d {
  foreign: number;
  investmentTrust: number;
  dealer: number;
  totalNetBuy: number;
}

function sumHistory30d(history: FullProfileInstitutionalRow[]): Net30d {
  return history.reduce(
    (acc, row) => ({
      foreign: acc.foreign + (row.foreign ?? 0),
      investmentTrust: acc.investmentTrust + (row.investmentTrust ?? 0),
      dealer: acc.dealer + (row.dealer ?? 0),
      totalNetBuy: acc.totalNetBuy + (row.totalNetBuy ?? 0),
    }),
    { foreign: 0, investmentTrust: 0, dealer: 0, totalNetBuy: 0 }
  );
}

type InstState =
  | { status: "loading" }
  | { status: "blocked"; reason: string }
  | { status: "empty"; date: string }
  | { status: "live"; row: FullProfileInstitutionalRow; date: string; stale: boolean; net30d: Net30d | null };

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
._inst-value.buy, ._inst-total-val.buy { color: var(--tw-up-bright, #e63946); }
._inst-value.sell, ._inst-total-val.sell { color: var(--tac-ok, #4ade80); }
._inst-value.flat, ._inst-total-val.flat { color: var(--night-mid, #91a0b5); }
._inst-total-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 4px 0;
  font-family: var(--mono); font-size: 10.5px;
}
._inst-total-label { color: var(--night-mid, #91a0b5); }
._inst-total-val { font-weight: 700; font-variant-numeric: tabular-nums; }
`;

function tone(value: number): string {
  return value > 0 ? "buy" : value < 0 ? "sell" : "flat";
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
          setState({ status: "blocked", reason: "full-profile 尚未回傳 tradingFlow.institutional。" });
          return;
        }
        if (section.state === "BLOCKED" || section.state === "ERROR") {
          setState({ status: "blocked", reason: section.sourceTrail?.degradedReason ?? "法人資料暫時無法讀取；請確認 FinMind / full-profile 狀態。" });
          return;
        }
        if (!section.latest) {
          const date = section.updatedAt?.slice(0, 10) ?? "--";
          setState({ status: "empty", date });
          return;
        }
        const row = section.latest as FullProfileInstitutionalRow;
        const history = (section.history ?? []) as FullProfileInstitutionalRow[];
        const net30d = history.length > 0 ? sumHistory30d(history) : null;
        setState({ status: "live", row, date: row.date, stale: section.state === "STALE", net30d });
      })
      .catch((err) => {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ status: "blocked", reason: `法人資料讀取失敗：${msg.slice(0, 80)}` });
      });
    return () => { active = false; };
  }, [companyId]);

  // 2026-07-17 empty-state collapse: blocked/empty 都是「抓不到法人資料」——
  // 楊董規則「空態=整欄位移除，非佔位卡」，不留「近 30 日暫無...」空白卡。
  if (state.status === "blocked" || state.status === "empty") {
    return null;
  }

  return (
    <section className="panel hud-frame" style={{ marginBottom: 12 }}>
      <style>{INST_CSS}</style>
      <h3 className="ascii-head" style={{ marginBottom: 6 }}>
        <span className="ascii-head-bracket">法人</span> 三大法人買賣超
        {state.status === "live" && (
          <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>
            {state.date}{state.stale ? " (略舊)" : ""}
          </span>
        )}
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在讀取 FinMind 三大法人買賣超資料。</span>
        </div>
      )}

      {state.status === "live" && (() => {
        const { row, net30d } = state;
        const cells = [
          { label: "外資", value: row.foreign },
          { label: "投信", value: row.investmentTrust },
          { label: "自營商", value: row.dealer },
        ];
        return (
          <>
            <div className="_inst-bar">
              {cells.map(({ label, value }) => (
                <div key={label} className="_inst-cell">
                  <span className="_inst-label">{label}</span>
                  <span className={`_inst-value ${tone(value)}`}>{formatInstitutionalNetLotsZh(value)}</span>
                </div>
              ))}
            </div>
            <div className="_inst-total-row">
              <span className="_inst-total-label">三大法人合計（單日）</span>
              <span className={`_inst-total-val ${tone(row.totalNetBuy)}`}>{formatInstitutionalNetLotsZh(row.totalNetBuy)}</span>
            </div>
            {net30d && (
              <div className="_inst-total-row">
                <span className="_inst-total-label">近 30 日累計</span>
                <span className={`_inst-total-val ${tone(net30d.totalNetBuy)}`}>{formatInstitutionalNetLotsZh(net30d.totalNetBuy)}</span>
              </div>
            )}
          </>
        );
      })()}
    </section>
  );
}
