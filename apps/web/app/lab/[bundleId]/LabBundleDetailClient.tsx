"use client";

import { useState } from "react";
import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip, signed, toneClass } from "@/components/RadarWidgets";
import { labDisplay, radarLabApi, type LabBacktestPoint, type LabSignalBundle } from "@/lib/radar-lab";

function pointsFor(points: LabBacktestPoint[]) {
  if (points.length === 0) return "";
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  return points
    .map((point, index) => {
      const x = 12 + (index / Math.max(1, points.length - 1)) * 296;
      const y = 142 - ((point.value - min) / span) * 116;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function LabLineChart({
  points,
  stroke,
  label,
}: {
  points: LabBacktestPoint[];
  stroke: string;
  label: string;
}) {
  return (
    <svg className="lab-chart" viewBox="0 0 320 160" role="img" aria-label={label}>
      {[28, 66, 104, 142].map((y) => (
        <line key={y} x1="10" x2="310" y1={y} y2={y} stroke="var(--night-rule)" />
      ))}
      <polyline points={pointsFor(points)} fill="none" stroke={stroke} strokeWidth="2" />
      {points.map((point, index) => {
        const [x, y] = pointsFor(points).split(" ")[index].split(",");
        return <circle key={point.t} cx={x} cy={y} r="2.5" fill={stroke} />;
      })}
    </svg>
  );
}

export function LabBundleDetailClient({ bundle }: { bundle: LabSignalBundle }) {
  const [status, setStatus] = useState(bundle.status);
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState(bundle.divergenceNotes);
  const [busy, setBusy] = useState(false);

  const cells = [
    { label: "股票", value: bundle.symbol, tone: "gold" as const },
    { label: "主題", value: bundle.themeCode, tone: "muted" as const },
    { label: "信心", value: `${Math.round(bundle.confidence * 100)}%`, tone: "muted" as const },
    { label: "勝率", value: `${Math.round(bundle.backtest.winRate * 100)}%`, tone: "down" as const },
    { label: "總報酬", value: `${signed(bundle.backtest.totalReturnPct, 1)}%`, tone: toneClass(bundle.backtest.totalReturnPct) },
    { label: "最大回撤", value: `${bundle.backtest.maxDrawdownPct.toFixed(1)}%`, tone: "up" as const },
  ];

  async function applyAction(nextStatus: typeof status, action: "APPROVE" | "REJECT" | "PUSH_TO_PORTFOLIO") {
    setBusy(true);
    await radarLabApi.bundleAction(bundle.bundleId, action);
    setStatus(nextStatus);
    setBusy(false);
  }

  async function submitFeedback() {
    const text = feedback.trim();
    if (!text) return;
    setBusy(true);
    await radarLabApi.bundleAction(bundle.bundleId, "DIVERGENCE_FEEDBACK", { note: text });
    setNotes((prev) => [`operator feedback：${text}`, ...prev]);
    setFeedback("");
    setBusy(false);
  }

  return (
    <PageFrame
      code="LAB-D"
      title="量化訊號詳情"
      sub={bundle.bundleId}
      note={`[LAB-D] ${labDisplay.producer[bundle.producer]} · ${labDisplay.status[status]} · divergence feedback channel`}
    >
      <MetricStrip columns={6} cells={cells} />

      <div className="lab-detail-grid">
        <Panel code="BT-RPT" title="回測報告" right={`${bundle.backtest.tradeCount} TRADES`}>
          <div className="ticket">
            <div className="tg gold">權益曲線</div>
            <LabLineChart points={bundle.backtest.equityCurve} stroke="var(--gold-bright)" label="權益曲線" />
            <div className="tg gold" style={{ marginTop: 14 }}>回撤曲線</div>
            <LabLineChart points={bundle.backtest.drawdown} stroke="var(--tw-up-bright)" label="回撤曲線" />
          </div>
        </Panel>

        <Panel code="BT-STAT" title="期間統計" right="PERIODS">
          <div className="row table-head" style={{ gridTemplateColumns: "70px 70px 80px 80px", gap: 10 }}>
            <span>期間</span>
            <span>交易</span>
            <span>勝率</span>
            <span>報酬</span>
          </div>
          {bundle.backtest.periodStats.map((period) => (
            <div className="row" key={period.label} style={{ gridTemplateColumns: "70px 70px 80px 80px", gap: 10, padding: "10px 0" }}>
              <span className="tg gold">{period.label}</span>
              <span className="num">{period.trades}</span>
              <span className="num down">{Math.round(period.winRate * 100)}%</span>
              <span className={`num ${toneClass(period.returnPct)}`}>{signed(period.returnPct, 1)}%</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button className="mini-button" type="button" disabled={busy} onClick={() => applyAction("APPROVED", "APPROVE")}>批准</button>
            <button className="outline-button" type="button" disabled={busy} onClick={() => applyAction("REJECTED", "REJECT")}>駁回</button>
            <button className="outline-button" type="button" disabled={busy} onClick={() => applyAction("PUSHED", "PUSH_TO_PORTFOLIO")}>推送到下單台</button>
            <Link className="outline-button" href="/lab">返回佇列</Link>
          </div>
        </Panel>

        <div>
          <Panel code="PROMO" title="升級備忘" right={labDisplay.status[status]}>
            <div className="lab-memo">{bundle.promotionMemo}</div>
          </Panel>

          <Panel code="DIV-FB" title="反向回饋" right={`${notes.length} NOTES`}>
            <textarea
              className="lab-textarea"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="寫給 Quant Lab / Athena 的 divergence feedback..."
            />
            <button className="mini-button" type="button" disabled={busy || !feedback.trim()} onClick={submitFeedback} style={{ marginTop: 10 }}>
              送出回饋
            </button>
            <div style={{ marginTop: 14 }}>
              {notes.map((note) => (
                <div className="row telex-row" key={note}>
                  <span className="tg soft">NOTE</span>
                  <span className="tg gold">LAB</span>
                  <span className="tg">{note}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
