"use client";

import type { IdeaHandoff } from "@/lib/idea-handoff";
import {
  DECISION_BADGE,
  DECISION_LABEL,
  DIRECTION_BADGE,
  DIRECTION_LABEL,
  MODE_LABEL,
  QUALITY_BADGE,
  QUALITY_LABEL
} from "@/lib/strategy-vocab";

type Props = {
  handoff: IdeaHandoff;
  onDismiss: () => void;
};

export function StrategyContextCard({ handoff, onDismiss }: Props) {
  const scorePct = Math.round(handoff.score);
  const confPct = Math.round(handoff.confidence * 100);
  const captured = (() => {
    try {
      return new Date(handoff.capturedAt).toLocaleString("zh-TW");
    } catch {
      return handoff.capturedAt;
    }
  })();

  return (
    <section className="panel hud-frame" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div>
          <p className="eyebrow">從策略推薦帶入 · IDEA CONTEXT</p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
            <span className="mono" style={{ fontSize: "var(--fs-md)", fontWeight: 700 }}>
              {handoff.symbol}
            </span>
            <span className="dim" style={{ fontSize: "var(--fs-xs)" }}>
              {handoff.companyName} · {handoff.market}
            </span>
          </div>
        </div>
        <button type="button" className="btn-sm" onClick={onDismiss} title="清除策略上下文">
          清除
        </button>
      </header>

      <div className="action-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className={DIRECTION_BADGE[handoff.direction]}>{DIRECTION_LABEL[handoff.direction]}</span>
        <span className={DECISION_BADGE[handoff.decision]}>
          {DECISION_LABEL[handoff.decision]} · {MODE_LABEL[handoff.decisionMode]}
        </span>
        <span className={QUALITY_BADGE[handoff.qualityGrade]}>{QUALITY_LABEL[handoff.qualityGrade]}</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          paddingTop: 4,
          borderTop: "1px solid var(--line, #2a2a2a)"
        }}
      >
        <Metric label="推薦分數" value={`${scorePct}`} sub="0–100" />
        <Metric label="信心度" value={`${confPct}%`} />
        <Metric label="主題" value={handoff.topThemeName ?? "—"} />
      </div>

      <div style={{ fontSize: "var(--fs-sm)" }}>
        <span className="eyebrow" style={{ marginRight: 6 }}>主要理由</span>
        <span>{handoff.primaryReason}</span>
      </div>

      {handoff.qualityReason && handoff.qualityReason !== handoff.primaryReason ? (
        <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
          品質：{handoff.qualityReason}
        </div>
      ) : null}

      <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
        帶入時間：{captured}
      </div>
    </section>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}
