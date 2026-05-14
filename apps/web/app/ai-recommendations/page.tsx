import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

const BUCKETS = [
  { label: "今日首選", range: "80+", state: "資料同步中" },
  { label: "可布局", range: "70-79", state: "資料同步中" },
  { label: "等回檔", range: "60-69", state: "資料同步中" },
  { label: "高風險排除", range: "<60", state: "資料不補假數字" },
  { label: "資料不足暫不推薦", range: "MISSING", state: "顯示同步中" },
];

export default function AiRecommendationsPage() {
  return (
    <PageFrame
      code="AI"
      title="AI 推薦"
      sub="推薦引擎"
      note="此頁保留真實資料口徑：缺資料只顯示同步中，不以假分數補位。"
    >
      <style>{`
        ._rec-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 16px;
        }
        ._rec-tabs a,
        ._rec-prefill {
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
        ._rec-tabs a:hover,
        ._rec-prefill:hover {
          color: var(--tac-fg-0);
          border-color: rgba(200, 148, 63, 0.42);
          background: rgba(200, 148, 63, 0.08);
        }
        ._rec-bucket-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
          padding: 16px;
        }
        ._rec-bucket {
          min-height: 138px;
          border: 1px solid rgba(200, 148, 63, 0.18);
          border-radius: 8px;
          background:
            linear-gradient(180deg, rgba(200, 148, 63, 0.055), transparent 72%),
            rgba(9, 14, 20, 0.82);
          padding: 13px;
        }
        ._rec-bucket span {
          display: block;
          color: var(--tac-brand);
          font: 900 10px/1 var(--mono);
        }
        ._rec-bucket b {
          display: block;
          margin-top: 10px;
          color: var(--tac-fg-0);
          font: 850 15px/1.25 var(--sans-tc);
        }
        ._rec-bucket small {
          display: block;
          margin-top: 9px;
          color: var(--tac-fg-3);
          font: 700 11px/1.5 var(--sans-tc);
        }
        ._rec-contract {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 16px;
          padding: 0 16px 16px;
        }
        ._rec-contract-box {
          border-top: 1px solid var(--tac-line);
          padding-top: 14px;
          color: var(--tac-fg-2);
          font-size: 12px;
          line-height: 1.7;
        }
        ._rec-contract-box ul {
          margin: 8px 0 0;
          padding-left: 17px;
        }
        @media (max-width: 1180px) {
          ._rec-bucket-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 760px) {
          ._rec-bucket-grid,
          ._rec-contract { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="_rec-tabs" aria-label="AI 推薦子頁">
        <Link href="/runs">策略批次</Link>
        <Link href="/signals">訊號證據</Link>
      </div>

      <Panel code="AI-01" title="推薦分層" sub="依總分、風險與資料品質分層；正式推薦資料接入後即時呈現。">
        <div className="_rec-bucket-grid">
          {BUCKETS.map((bucket) => (
            <article key={bucket.label} className="_rec-bucket">
              <span>{bucket.range}</span>
              <b>{bucket.label}</b>
              <small>{bucket.state}</small>
            </article>
          ))}
        </div>
        <div className="_rec-contract">
          <div className="_rec-contract-box">
            <b className="tg gold">推薦卡欄位</b>
            <ul>
              <li>股票代號、排名、建議動作、信心分數、總分</li>
              <li>進場區、停損規則、目標價、部位建議</li>
              <li>技術面、籌碼、新聞、主題、量化、總經理由</li>
              <li>報價、K 線、籌碼、新聞、量化資料品質</li>
            </ul>
          </div>
          <div className="_rec-contract-box">
            <b className="tg gold">交易室帶入</b>
            <p>推薦確認後會帶入股票、方向、停損、目標與風險額度。</p>
            <Link className="_rec-prefill" href="/portfolio?prefill=true&from_rec=stub">
              一鍵帶到交易室
            </Link>
          </div>
        </div>
      </Panel>
    </PageFrame>
  );
}
