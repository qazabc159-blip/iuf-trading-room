import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

const STRATEGY_FIELDS = [
  ["量化分數", "SCORE"],
  ["市場狀態", "REGIME"],
  ["回測勝率", "WIN"],
  ["最大回撤", "MAX DD"],
  ["閘門狀態", "GATE"],
  ["最後快照", "SNAPSHOT"],
];

export default function QuantStrategiesPage() {
  return (
    <PageFrame
      code="QNT"
      title="量化策略"
      sub="Athena 訊號 / SIM-only"
      note="v1 僅顯示 SIM 執行路徑；正式交易 lane 不出現在此頁。"
    >
      <style>{`
        ._qnt-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 16px;
        }
        ._qnt-tabs a,
        ._qnt-subscribe {
          min-height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--tac-line);
          border-radius: 6px;
          padding: 0 12px;
          color: var(--tac-fg-1);
          background: rgba(8, 11, 16, 0.52);
          font: 800 11px/1 var(--mono);
          text-decoration: none;
        }
        ._qnt-tabs a:hover,
        ._qnt-subscribe:hover {
          color: var(--tac-fg-0);
          border-color: rgba(200, 148, 63, 0.42);
          background: rgba(200, 148, 63, 0.08);
        }
        ._qnt-banner {
          margin: 0 16px 14px;
          border: 1px solid rgba(220, 143, 55, 0.34);
          border-left: 3px solid var(--tac-warn);
          border-radius: 8px;
          padding: 11px 13px;
          color: var(--tac-fg-1);
          background: rgba(220, 143, 55, 0.075);
          font-size: 12px;
          line-height: 1.55;
        }
        ._qnt-field-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          padding: 16px;
        }
        ._qnt-field {
          min-height: 104px;
          border: 1px solid rgba(200, 148, 63, 0.16);
          border-radius: 8px;
          background: rgba(9, 14, 20, 0.82);
          padding: 13px;
        }
        ._qnt-field span {
          display: block;
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
        }
        ._qnt-field b {
          display: block;
          margin-top: 9px;
          color: var(--tac-fg-0);
          font: 850 14px/1.3 var(--sans-tc);
        }
        ._qnt-field small {
          display: block;
          margin-top: 7px;
          color: var(--tac-fg-3);
          font: 700 11px/1.5 var(--sans-tc);
        }
        ._qnt-subscribe-box {
          border-top: 1px solid var(--tac-line);
          margin: 0 16px 16px;
          padding-top: 14px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          color: var(--tac-fg-2);
          font-size: 12px;
          line-height: 1.7;
        }
        @media (max-width: 920px) {
          ._qnt-field-grid,
          ._qnt-subscribe-box { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="_qnt-tabs" aria-label="量化策略子頁">
        <Link href="/lab/three-strategy">Athena 三策略</Link>
        <Link href="/lab/strategies">Lab 策略清單</Link>
      </div>

      <Panel code="QNT-01" title="策略列表" sub="策略分數、回測風險與訂閱狀態接入後即時呈現。">
        <div className="_qnt-banner">
          <b className="tg gold">SIM 帳戶執行中</b> / v1 只開放模擬帳戶，不提供正式交易切換。
        </div>
        <div className="_qnt-field-grid">
          {STRATEGY_FIELDS.map(([label, field]) => (
            <article key={field} className="_qnt-field">
              <span>{field}</span>
              <b>{label}</b>
              <small>資料同步中</small>
            </article>
          ))}
        </div>
        <div className="_qnt-subscribe-box">
          <div>
            <b className="tg gold">訂閱面板</b>
            <p>投入金額 50,000 - 1,000,000 NTD；確認後只送 SIM 帳戶。</p>
          </div>
          <Link className="_qnt-subscribe" href="/portfolio">
            前往交易室
          </Link>
        </div>
      </Panel>
    </PageFrame>
  );
}
