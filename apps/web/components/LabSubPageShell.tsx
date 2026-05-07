/**
 * LabSubPageShell — shared shell for /lab/strategies, /lab/candidates, /lab/research
 *
 * Per Lab/TR Alignment Lock 2026-05-07 (board/lab_tr_alignment_lock_2026-05-07.md):
 *   - All candidates are RESEARCH_ONLY; no Sharpe / equity / win-rate / allocation %
 *   - status verbatim from lab JSON (TR must NEVER rename / soften)
 *   - blocked state when source='unavailable' → 「目前無 Lab approved 策略可推廣」 grey
 *   - Header MUST contain:
 *       Quant Lab status: RESEARCH_SYSTEM
 *       No strategy approved for Trading Room promotion
 *       Latest Lab frame: v11 KILL_NO_EDGE / v15 research candidates
 *   - Each candidate row MUST contain:
 *       strategyId, "research-only" amber pill, "Awaiting Athena/Bruce gates" caption,
 *       caveats list (from endpoint, verbatim)
 *   - Forbidden display: Sharpe / equity / win-rate / total trades / P&L / allocation %
 *
 * This component is server-only-friendly (no useState/useEffect); SSR fetch happens
 * in each page.tsx via radarLabApi.strategies(), then passed in as props.
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
    sub: "research-only · 未批准 TR 推廣",
    note: "本頁僅顯示 IUF Quant Lab 釋出的「研究候選」清單；未經 Athena schema 與 Bruce harness 雙簽前，皆 NOT approved for paper/live。本頁不顯示 Sharpe、equity curve、勝率、配置比例。",
  },
  candidates: {
    code: "LAB",
    title: "量化研究 / 候選名單",
    sub: "research-only · awaiting gates",
    note: "與「候選策略」同一份來源；此頁強調候選審核排程，等 Athena 把 status 推進 PAPER_PROPOSED / PAPER_LIVE 才會出現在 Trading Room 交易模組。",
  },
  research: {
    code: "LAB",
    title: "量化研究 / Lab 進度",
    sub: "v11 KILL_NO_EDGE · v15 研究系統",
    note: "整體 Lab 狀態框架：v11 sprint 已 KILL_NO_EDGE（沒 edge 退場）；v15 sprint 產出 3 個研究候選但未批准。Trading Room 不會替 Lab 改寫狀態 enum。",
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
      research-only
    </span>
  );
}

function GatesCaption() {
  return (
    <span className="tg soft" style={{ display: "block", marginTop: 4 }}>
      Awaiting Athena schema gate &amp; Bruce harness gate · Not approved for paper/live
    </span>
  );
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
          {candidate.strategyId}
        </span>
        <ResearchOnlyPill />
        <span className="tg soft" style={{ marginLeft: "auto", fontSize: 11 }}>
          status / {labStatusDisplayWording(candidate.status)}
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
            Caveats（Lab 原文）
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
          Next action（Lab 指示）/ {candidate.nextAction}
        </div>
      )}

      <div className="tg soft" style={{ fontSize: 10, opacity: 0.65 }}>
        source / {candidate.labGovernanceSource}
      </div>
    </article>
  );
}

function HeaderDisclaimerBlock({
  payload,
}: {
  payload: LabStrategiesResponse | null;
}) {
  const sprintId = payload?.meta.sprintId ?? "v15";
  const candidateCount = payload?.meta.candidateCount ?? 0;
  const portfolioVerdict =
    payload?.data?.portfolioVerdict ?? "THREE_STRATEGY_PORTFOLIO_VALID_RESEARCH_SYSTEM";

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
        Quant Lab status: RESEARCH_SYSTEM
      </div>
      <div style={{ fontSize: 13, color: "#e0e0e0", fontWeight: 600 }}>
        No strategy approved for Trading Room promotion
      </div>
      <div className="tg soft" style={{ fontSize: 11 }}>
        Latest Lab frame: v11 KILL_NO_EDGE / v15 research candidates · sprint {sprintId} ·{" "}
        {candidateCount} 候選 · verdict {portfolioVerdict}
      </div>
    </section>
  );
}

function BlockedState({ reason }: { reason: string }) {
  return (
    <Panel code="LAB" title="目前無 Lab approved 策略可推廣" right="暫停">
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
          Quant Lab snapshot 暫時無法讀取
        </div>
        <div className="tg soft" style={{ fontSize: 11, marginBottom: 12 }}>
          來源狀態 / source=unavailable · 沒有可推廣的 approved 策略
        </div>
        <div style={{ fontSize: 12 }}>{reason}</div>
        <div className="tg soft" style={{ fontSize: 11, marginTop: 14, opacity: 0.8 }}>
          Trading Room 永遠不會用假策略 / 假績效 / 假配置比例填補空狀態。
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
    "目前無 Lab approved 策略可推廣（source=unavailable）";

  return (
    <PageFrame code={meta.code} title={meta.title} sub={meta.sub} note={meta.note}>
      <HeaderDisclaimerBlock payload={payload} />

      {blocked ? (
        <BlockedState reason={blockedReason} />
      ) : (
        <Panel
          code="LAB"
          title="研究候選（research-only）"
          sub="未經 Athena schema + Bruce harness 雙簽，不可進 paper/live"
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
            禁止顯示欄位（per Lab/TR alignment lock）：Sharpe、equity curve、勝率、總交易數、P&amp;L、配置比例 %、買賣建議、目標價、必賺 wording。違反 = stop-line。
          </div>
        </Panel>
      )}

      {extraPanel}
    </PageFrame>
  );
}
