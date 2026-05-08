/**
 * Shared shell for Lab research pages.
 * Keep research candidates separate from paper trading and real orders, and do not
 * display unverified performance, allocation, or trading advice.
 */

import type { ReactNode } from "react";

import { PageFrame, Panel } from "@/components/PageFrame";
import {
  labStatusDisplayWording,
  type LabStrategiesResponse,
  type LabStrategyCandidate,
} from "@/lib/radar-lab";

type LabSubPageMode = "strategies" | "candidates" | "research";

type LabSubPageShellProps = {
  mode: LabSubPageMode;
  payload: LabStrategiesResponse | null;
  fetchError: string | null;
  /** Optional extra panel rendered after the candidates list (used by /lab/research). */
  extraPanel?: ReactNode;
};

const MODE_META: Record<LabSubPageMode, { code: string; title: string; sub: string; note: string }> = {
  strategies: {
    code: "LAB",
    title: "量化研究 / 候選策略",
    sub: "研究候選 / 未進交易流程",
    note: "本頁僅顯示正式量化研究候選；未經完整驗證前，不進紙上或實盤流程，也不顯示未驗證績效、勝率或配置比例。",
  },
  candidates: {
    code: "LAB",
    title: "量化研究 / 候選名單",
    sub: "審核排程 / 紙上驗證前",
    note: "與「候選策略」同一份來源；此頁強調候選審核排程，通過完整驗證後才會進入紙上交易模組。",
  },
  research: {
    code: "LAB",
    title: "量化研究 / Lab 進度",
    sub: "研究批次 / 候選狀態",
    note: "整體量化研究狀態：只顯示正式候選與限制；未通過完整驗證前不進紙上或實盤流程。",
  },
};

function ResearchOnlyPill() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: 4,
        background: "rgba(255, 184, 0, 0.12)",
        border: "1px solid rgba(255, 184, 0, 0.45)",
        color: "#ffb800",
        fontSize: 11,
        letterSpacing: 0.4,
        fontWeight: 600,
      }}
    >
      研究候選
    </span>
  );
}

function GatesCaption() {
  return (
    <span className="tg soft" style={{ display: "block", marginTop: 4 }}>
      等待完整驗證；尚未進入紙上或實盤流程
    </span>
  );
}

function shortStrategyId(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function CandidateRow({ candidate }: { candidate: LabStrategyCandidate }) {
  return (
    <article
      className="lab-bundle-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        border: "1px solid rgba(255, 184, 0, 0.25)",
        borderRadius: 6,
        background: "rgba(20, 20, 24, 0.55)",
      }}
    >
      <div
        className="lab-bundle-head"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}
      >
        <span
          className="tg gold"
          style={{ fontFamily: "monospace", fontSize: 12, letterSpacing: 0.4 }}
        >
          策略 {shortStrategyId(candidate.strategyId)}
        </span>
        <ResearchOnlyPill />
        <span className="tg soft" style={{ marginLeft: "auto", fontSize: 11 }}>
          狀態 / {labStatusDisplayWording(candidate.status)}
        </span>
      </div>

      <div>
        <div className="lab-bundle-title" style={{ fontSize: 14, fontWeight: 600 }}>
          {candidate.displayName}
        </div>
        <GatesCaption />
      </div>

      {candidate.caveats.length > 0 && (
        <div>
          <span className="tg soft" style={{ fontSize: 11, fontWeight: 600 }}>
            限制與注意事項
          </span>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#cfcfcf", fontSize: 12 }}>
            {candidate.caveats.map((c, idx) => (
              <li key={idx} style={{ marginBottom: 4 }}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidate.nextAction && (
        <div className="tg soft" style={{ fontSize: 11 }}>
          下一步 / {candidate.nextAction}
        </div>
      )}

      <div className="tg soft" style={{ fontSize: 10, opacity: 0.65 }}>
        來源 / 量化研究正式快照
      </div>
    </article>
  );
}

function HeaderDisclaimerBlock({
  payload,
}: {
  payload: LabStrategiesResponse | null;
}) {
  const candidateCount = payload?.meta.candidateCount ?? 0;

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "14px 16px",
        marginBottom: 14,
        border: "1px solid rgba(255, 184, 0, 0.35)",
        borderLeft: "3px solid #ffb800",
        background: "rgba(255, 184, 0, 0.04)",
      }}
    >
      <div className="tg gold" style={{ fontSize: 12, letterSpacing: 0.6 }}>
        量化研究狀態
      </div>
      <div style={{ fontSize: 13, color: "#e0e0e0", fontWeight: 600 }}>
        目前沒有策略進入交易流程
      </div>
      <div className="tg soft" style={{ fontSize: 11 }}>
        正式候選 {candidateCount} 個；未驗證績效與配置比例不顯示。
      </div>
    </section>
  );
}

function BlockedState({ reason }: { reason: string }) {
  return (
    <Panel code="LAB" title="目前沒有可推進策略" right="暫停">
      <div
        style={{
          padding: 18,
          borderRadius: 6,
          background: "rgba(140, 140, 140, 0.08)",
          border: "1px solid rgba(140, 140, 140, 0.25)",
          color: "#aaa",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 600, color: "#ddd", marginBottom: 8 }}>
          量化研究資料暫時無法讀取
        </div>
        <div className="tg soft" style={{ fontSize: 11, marginBottom: 12 }}>
          來源狀態 / 沒有可推進策略
        </div>
        <div style={{ fontSize: 12 }}>{reason}</div>
        <div className="tg soft" style={{ fontSize: 11, marginTop: 14, opacity: 0.8 }}>
          交易戰情室不會用假策略、假績效或假配置比例填補空狀態。
        </div>
      </div>
    </Panel>
  );
}

export function LabSubPageShell({
  mode,
  payload,
  fetchError,
  extraPanel,
}: LabSubPageShellProps) {
  const meta = MODE_META[mode];
  const blocked =
    fetchError !== null ||
    payload === null ||
    payload.meta.source === "unavailable" ||
    payload.data === null;

  const candidates: LabStrategyCandidate[] = payload?.data?.candidates ?? [];

  const blockedReason =
    fetchError ??
    payload?.meta.reason ??
    "目前沒有可推進策略。";

  return (
    <PageFrame code={meta.code} title={meta.title} sub={meta.sub} note={meta.note}>
      <HeaderDisclaimerBlock payload={payload} />

      {blocked ? (
        <BlockedState reason={blockedReason} />
      ) : (
        <Panel
          code="LAB"
          title="研究候選"
          sub="未經完整驗證，不進紙上或實盤流程"
          right={`${candidates.length} 候選`}
        >
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            }}
          >
            {candidates.map((c) => (
              <CandidateRow key={c.strategyId} candidate={c} />
            ))}
          </div>

          <div
            className="terminal-note"
            style={{ marginTop: 14, fontSize: 11, lineHeight: 1.6 }}
          >
            本頁只顯示候選狀態與限制；未驗證績效、配置比例與買賣建議不顯示。
          </div>
        </Panel>
      )}

      {extraPanel}
    </PageFrame>
  );
}
