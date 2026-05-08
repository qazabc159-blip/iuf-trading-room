"use client";

import { useState } from "react";
import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanNarrativeText } from "@/lib/operator-copy";
import { labDisplay, radarLabApi, type LabSignalBundle } from "@/lib/radar-lab";

function errorText(error: unknown): string {
  return friendlyDataError(error, "量化研究動作暫時無法完成。");
}

function shortBundleId(bundleId: string) {
  return bundleId.length > 14 ? `${bundleId.slice(0, 8)}…${bundleId.slice(-4)}` : bundleId;
}

function safeSummary(value: string) {
  return cleanNarrativeText(value, "策略包摘要尚未完成中文整理；保留正式資料來源，不顯示假績效。");
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
      sub={`策略包 ${shortBundleId(bundle.bundleId)}`}
      note={`${labDisplay.producer[bundle.producer]} / ${labDisplay.status[status]} / 分歧回饋通道`}
    >
      <MetricStrip columns={6} cells={cells} />

      <div className="lab-detail-grid">
        <Panel code="BNDL-SRC" title="策略包來源" right="只讀">
          <div className="ticket lab-truth-ticket">
            <div className="tg gold">來源與治理狀態</div>
            <h2>{bundle.title}</h2>
            <p>{safeSummary(bundle.summary)}</p>
            <div className="lab-selected-metrics">
              <span><b>{bundle.symbol}</b><small>股票</small></span>
              <span><b>{bundle.themeCode}</b><small>主題</small></span>
              <span><b>{labDisplay.producer[bundle.producer]}</b><small>來源</small></span>
              <span><b>{labDisplay.status[status]}</b><small>審核狀態</small></span>
            </div>
            <div className="terminal-note" style={{ marginTop: 14 }}>
              此頁不顯示未經完整驗證的勝率、報酬、最大回撤、權益曲線或分期統計。
            </div>
          </div>
        </Panel>

        <Panel code="BNDL-GATE" title="審核與轉單邊界" right="不建立委託">
          <div className="lab-governance-list">
            <span>審核通過只代表研究收件狀態，不代表可交易或可進紙上/實盤流程。</span>
            <span>轉入模擬交易需等待策略包交接、紙上風控與完整驗證全部通過。</span>
            <span>本頁不建立真實券商委託，也不把行情資料當作成交價。</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button className="mini-button" type="button" disabled={busy} onClick={() => applyAction("APPROVED", "APPROVE")}>標記通過</button>
            <button className="outline-button" type="button" disabled={busy} onClick={() => applyAction("REJECTED", "REJECT")}>退回研究</button>
            <span className="outline-button" role="status" title="策略包轉入模擬交易的交接流程尚未完成。">待交接</span>
            <Link className="outline-button" href="/lab">返回</Link>
          </div>
          <div className="terminal-note" style={{ marginTop: 12 }}>
            轉入模擬交易需等待量化研究交接流程完成；此頁不會建立券商委託。
          </div>
          {actionError && (
            <div className="terminal-note" style={{ marginTop: 12 }}>
              暫停：量化研究動作失敗。{actionError}
            </div>
          )}
        </Panel>

        <div>
          <Panel code="PROMO" title="轉入摘要" right={labDisplay.status[status]}>
            <div className="lab-memo">{safeSummary(bundle.promotionMemo)}</div>
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
