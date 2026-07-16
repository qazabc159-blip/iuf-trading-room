"use client";

import { useEffect, useState } from "react";

import { getCompanyShareholding, type CompanyShareholdingData } from "@/lib/api";

// 2026-07-17 — #17 拆分（DESIGN_NOTES.md §三 #17 `#sec-hold`）：本面板原本同時
// 顯示三大法人買賣超 + 融資融券餘額 + 外資持股，前兩項與上方 sec-chips pairrow
// 的 InstitutionalPanel/MarginShortPanel 30 日表完全重複（page.tsx 先前註解已
// 揭露此問題）。收斂為單一職責：只顯示「外資持股與分佈」，不再呼叫
// getCompanyChips（三大法人/融資券端點），避免同一份資訊在頁面上出現兩次。

type ShareholdingState =
  | { status: "loading" }
  | { status: "blocked" }
  | { status: "empty" }
  | { status: "live"; data: CompanyShareholdingData };

function pct(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return `${value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}%`;
}

function formatShares(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 十億股`;
  }
  return `${value.toLocaleString("zh-TW")} 股`;
}

export function ChipsPanel({ companyId }: { companyId: string }) {
  const [state, setState] = useState<ShareholdingState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    getCompanyShareholding(companyId, { months: 6 })
      .then((res) => {
        if (!active) return;
        const data = res.data;
        const hasData = Boolean(data?.latest || data?.holdingLevels?.length);
        setState(hasData ? { status: "live", data } : { status: "empty" });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: "blocked" });
      });
    return () => {
      active = false;
    };
  }, [companyId]);

  // 2026-07-17 empty-state collapse：blocked/empty 都是「抓不到外資持股資料」—
  // 楊董規則「空態=整欄位移除，非佔位卡」，不留空白狀態卡在頁面上。
  if (state.status === "blocked" || state.status === "empty") {
    return null;
  }

  const latest = state.status === "live" ? state.data.latest : null;
  const topLevels = state.status === "live" ? state.data.holdingLevels.slice(0, 6) : [];

  return (
    <section id="sec-hold" className="panel hud-frame company-intel-panel company-chips-console">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">持股</span> 外資持股與分佈
        <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>FinMind 外資持股 / 股權分散</span>
      </h3>

      {state.status === "loading" && (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在讀取外資持股與股權分散資料。</span>
        </div>
      )}

      {state.status === "live" && (
        <div className="ownership-block">
          <div className="source-line">
            <span className="badge badge-green">正常</span>
            <span className="tg soft">持股日 {latest?.date ?? state.data.latestLevelDate ?? "--"}</span>
          </div>
          {latest ? (
            <div className="metric-grid compact-metric-grid">
              <div className="metric-tile">
                <span className="tg soft">外資持股</span>
                <strong>{pct(latest.ForeignInvestmentSharesRatio)}</strong>
                <span className="tg soft">{formatShares(latest.ForeignInvestmentShares)}</span>
              </div>
              <div className="metric-tile">
                <span className="tg soft">外資尚可投資</span>
                <strong>{pct(latest.ForeignInvestmentRemainRatio)}</strong>
                <span className="tg soft">{formatShares(latest.ForeignInvestmentRemainingShares)}</span>
              </div>
              <div className="metric-tile">
                <span className="tg soft">發行股數</span>
                <strong>{formatShares(latest.NumberOfSharesIssued)}</strong>
                <span className="tg soft">申報 {latest.RecentlyDeclareDate || "--"}</span>
              </div>
            </div>
          ) : null}
          {topLevels.length > 0 ? (
            <div className="ownership-bars">
              {topLevels.map((row) => (
                <div className="ownership-bar" key={`${row.date}-${row.HoldingSharesLevel}`}>
                  <span>{row.HoldingSharesLevel}</span>
                  <span className="ownership-bar-track">
                    <i style={{ width: `${Math.max(2, Math.min(100, row.percent))}%` }} />
                  </span>
                  <strong>{pct(row.percent)}</strong>
                  <span className="tg soft">{row.people.toLocaleString("zh-TW")} 人</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
