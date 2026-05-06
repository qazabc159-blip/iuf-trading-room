"use client";

import { useState } from "react";
import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { labDisplay, radarLabApi, type LabSignalBundle } from "@/lib/radar-lab";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LabBundleDetailClient({ bundle }: { bundle: LabSignalBundle }) {
  const [status, setStatus] = useState(bundle.status);
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState(bundle.divergenceNotes);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const cells = [
    { label: "股票", value: bundle.symbol, tone: "gold" as const },
    { label: "主題", value: bundle.themeCode, tone: "muted" as const },
    { label: "來源", value: labDisplay.producer[bundle.producer], tone: "muted" as const },
    { label: "狀態", value: labDisplay.status[status], tone: status === "REJECTED" ? "status-bad" as const : status === "APPROVED" ? "status-ok" as const : "gold" as const },
    { label: "績效", value: "未核准", tone: "gold" as const },
    { label: "交易", value: "不送單", tone: "muted" as const },
  ];

  async function applyAction(nextStatus: typeof status, action: "APPROVE" | "REJECT") {
    setBusy(true);
    setActionError(null);
    try {
      await radarLabApi.bundleAction(bundle.bundleId, action);
      setStatus(nextStatus);
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitFeedback() {
    const text = feedback.trim();
    if (!text) return;
    setBusy(true);
    setActionError(null);
    try {
      await radarLabApi.bundleAction(bundle.bundleId, "DIVERGENCE_FEEDBACK", { note: text });
      setNotes((prev) => [`操作員回饋：${text}`, ...prev]);
      setFeedback("");
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame
      code="LAB-D"
      title="量化策略包明細"
      sub={bundle.bundleId}
      note={`${labDisplay.producer[bundle.producer]} / ${labDisplay.status[status]} / 分歧回饋通道`}
    >
      <MetricStrip columns={6} cells={cells} />

      <div className="lab-detail-grid">
        <Panel code="BNDL-SRC" title="策略包來源" right="只讀">
          <div className="ticket lab-truth-ticket">
            <div className="tg gold">來源與治理狀態</div>
            <h2>{bundle.title}</h2>
            <p>{bundle.summary}</p>
            <div className="lab-selected-metrics">
              <span><b>{bundle.symbol}</b><small>股票</small></span>
              <span><b>{bundle.themeCode}</b><small>主題</small></span>
              <span><b>{labDisplay.producer[bundle.producer]}</b><small>來源</small></span>
              <span><b>{labDisplay.status[status]}</b><small>審核狀態</small></span>
            </div>
            <div className="terminal-note" style={{ marginTop: 14 }}>
              此頁不顯示未經 Athena bundle schema 與 Bruce harness 核准的勝率、報酬、最大回撤、權益曲線或分期統計。
            </div>
          </div>
        </Panel>

        <Panel code="BNDL-GATE" title="審核與轉單邊界" right="不建立委託">
          <div className="lab-governance-list">
            <span>審核通過只代表研究收件狀態，不代表可交易、可回測、可 paper 或可 live。</span>
            <span>轉入模擬交易需等待 strategy bundle contract、paper risk gate、Bruce harness 全部通過。</span>
            <span>本頁不呼叫 KGI、不呼叫正式下單路由，也不使用 FinMind/K 線作為成交價。</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button className="mini-button" type="button" disabled={busy} onClick={() => applyAction("APPROVED", "APPROVE")}>標記通過</button>
            <button className="outline-button" type="button" disabled={busy} onClick={() => applyAction("REJECTED", "REJECT")}>退回研究</button>
            <span className="outline-button" role="status" title="策略包轉模擬交易的後端契約尚未完成。">待契約</span>
            <Link className="outline-button" href="/lab">返回</Link>
          </div>
          <div className="terminal-note" style={{ marginTop: 12 }}>
            轉入模擬交易需等待 量化研究交接管線 完成交接契約；此頁不會建立券商委託。
          </div>
          {actionError && (
            <div className="terminal-note" style={{ marginTop: 12 }}>
              暫停：量化研究動作失敗。{actionError}
            </div>
          )}
        </Panel>

        <div>
          <Panel code="PROMO" title="轉入摘要" right={labDisplay.status[status]}>
            <div className="lab-memo">{bundle.promotionMemo}</div>
          </Panel>

          <Panel code="DIV-FB" title="分歧回饋" right={`${notes.length} 則`}>
            <textarea
              className="lab-textarea"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="寫下要回給 量化研究的分歧回饋..."
            />
            <button className="mini-button" type="button" disabled={busy || !feedback.trim()} onClick={submitFeedback} style={{ marginTop: 10 }}>
              送出回饋
            </button>
            <div style={{ marginTop: 14 }}>
              {notes.map((note) => (
                <div className="row telex-row" key={note}>
                  <span className="tg soft">備註</span>
                  <span className="tg gold">量化</span>
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
