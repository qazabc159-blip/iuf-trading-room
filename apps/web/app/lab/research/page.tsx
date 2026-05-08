/**
 * /lab/research — Lab 進度框架：v11 KILL_NO_EDGE + v15 sprint summary + 整體 status
 *
 * BLOCK #8 Lane D (2026-05-07).
 * Per Lab/TR Alignment Lock 2026-05-07:
 *   - read-only consume of GET /api/v1/lab/strategies
 *   - shows v11 KILL_NO_EDGE 狀態 + v15 research candidates + portfolio verdict
 *   - 不准把 KILL_NO_EDGE 軟化成「待重啟」
 *   - 不准顯示 Sharpe / equity / win-rate / allocation %
 */

import { Panel } from "@/components/PageFrame";
import { LabSubPageShell } from "@/components/LabSubPageShell";
import { friendlyDataError } from "@/lib/friendly-error";
import { radarLabApi, type LabStrategiesResponse } from "@/lib/radar-lab";

export const dynamic = "force-dynamic";

function ResearchFrameExtra({
  payload,
}: {
  payload: LabStrategiesResponse | null;
}) {
  const candidateCount = payload?.meta.candidateCount ?? 0;

  return (
    <Panel
      code="LAB"
      title="Lab 研究進度框架"
      sub="研究批次與候選狀態"
      right={`${candidateCount} 候選`}
    >
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        }}
      >
        <div
          style={{
            padding: 14,
            border: "1px solid rgba(220, 80, 80, 0.35)",
            borderLeft: "3px solid rgba(220, 80, 80, 0.9)",
            borderRadius: 6,
            background: "rgba(220, 80, 80, 0.05)",
          }}
        >
          <div
            className="tg gold"
            style={{ fontSize: 11, letterSpacing: 0.5, color: "rgba(220, 120, 120, 0.95)" }}
          >
            前一批研究
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8e8", margin: "6px 0" }}>
            已退場
          </div>
          <div className="tg soft" style={{ fontSize: 12, lineHeight: 1.6 }}>
            前一批研究沒有穩定優勢，已正式退場。<br />
            不會被重新包裝為待重啟或可交易策略。
          </div>
        </div>

        <div
          style={{
            padding: 14,
            border: "1px solid rgba(255, 184, 0, 0.35)",
            borderLeft: "3px solid #ffb800",
            borderRadius: 6,
            background: "rgba(255, 184, 0, 0.04)",
          }}
        >
          <div className="tg gold" style={{ fontSize: 11, letterSpacing: 0.5 }}>
            最新研究批次
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8e8", margin: "6px 0" }}>
            研究系統 / 候選 {candidateCount} 個
          </div>
          <div className="tg soft" style={{ fontSize: 12, lineHeight: 1.6 }}>
            已產出研究候選。
            <br />
            未通過完整驗證前，不進紙上或實盤流程。
          </div>
        </div>

        <div
          style={{
            padding: 14,
            border: "1px solid rgba(160, 200, 255, 0.3)",
            borderLeft: "3px solid rgba(160, 200, 255, 0.85)",
            borderRadius: 6,
            background: "rgba(160, 200, 255, 0.04)",
          }}
        >
          <div
            className="tg gold"
            style={{ fontSize: 11, letterSpacing: 0.5, color: "rgba(180, 210, 255, 0.95)" }}
          >
            整體結論
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#e8e8e8",
              margin: "6px 0",
              fontFamily: "monospace",
              wordBreak: "break-word",
            }}
          >
            研究系統有效，但尚未批准進入交易流程
          </div>
          <div className="tg soft" style={{ fontSize: 12, lineHeight: 1.6 }}>
            候選策略可以被追蹤與審核，但不會被顯示為已可交易。
          </div>
        </div>
      </div>

      <div
        className="terminal-note"
        style={{
          marginTop: 14,
          fontSize: 11,
          lineHeight: 1.7,
          color: "#bbb",
        }}
      >
        來源：量化研究正式快照。交易戰情室只讀呈現，不改寫研究狀態，也不用假策略快照填補空狀態。
      </div>
    </Panel>
  );
}

export default async function LabResearchPage() {
  let payload: LabStrategiesResponse | null = null;
  let fetchError: string | null = null;
  try {
    payload = await radarLabApi.strategies();
  } catch (error) {
    fetchError = friendlyDataError(error, "量化研究進度暫時無法讀取。");
  }

  return (
    <LabSubPageShell
      mode="research"
      payload={payload}
      fetchError={fetchError}
      extraPanel={<ResearchFrameExtra payload={payload} />}
    />
  );
}
