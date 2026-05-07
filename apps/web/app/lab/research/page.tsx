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
  const sprintId = payload?.meta.sprintId ?? "v15";
  const portfolioVerdict =
    payload?.data?.portfolioVerdict ?? "THREE_STRATEGY_PORTFOLIO_VALID_RESEARCH_SYSTEM";
  const candidateCount = payload?.meta.candidateCount ?? 0;

  return (
    <Panel
      code="LAB"
      title="Lab 研究進度框架"
      sub="verbatim from Athena · TR 不可改寫"
      right={`sprint ${sprintId}`}
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
            v11 sprint
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8e8", margin: "6px 0" }}>
            KILL_NO_EDGE
          </div>
          <div className="tg soft" style={{ fontSize: 12, lineHeight: 1.6 }}>
            v11 sprint 結果：沒 edge，正式退場。<br />
            不會被軟化為「待重啟」或「研究 ongoing」；TR 顯示遵循 Lab 原文。
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
            {sprintId} sprint
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8e8", margin: "6px 0" }}>
            研究系統 / 候選 {candidateCount} 個
          </div>
          <div className="tg soft" style={{ fontSize: 12, lineHeight: 1.6 }}>
            產出 research candidates，皆 RESEARCH_ONLY。
            <br />
            未過 Athena schema + Bruce harness 雙簽前，不入 paper / live。
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
            portfolio verdict
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
            {portfolioVerdict}
          </div>
          <div className="tg soft" style={{ fontSize: 12, lineHeight: 1.6 }}>
            Lab 整體框架語義：「3 策略組合 valid 但仍是研究系統，未批准推廣」。
            TR 不會顯示為 approved。
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
        Source of truth / Athena (Lab CEO) + IUF_QUANT_LAB sanctioned snapshots only.
        TR 是 read-only consumer；TR 永遠不會替 Lab 寫狀態、不會替 Lab 改名 enum、不會把
        KILL_NO_EDGE 改寫為「待重啟」、不會自建假 strategy snapshot 冒充 Lab registry。
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
    fetchError = friendlyDataError(error, "量化研究 /research API 暫時無法讀取。");
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
