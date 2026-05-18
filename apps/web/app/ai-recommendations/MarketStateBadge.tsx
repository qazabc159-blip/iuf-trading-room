"use client";

/**
 * MarketStateBadge — F1
 *
 * Displays the current market regime as a full-width banner stripe.
 * 4 states: risk_off / event / trend / range
 *
 * Accepts optional live scores from the backend; falls back to
 * placeholder values when the v3 backend is not yet merged.
 *
 * Tooltip shows raw sub-scores on hover (title attribute).
 */

export type MarketState = "risk_off" | "event" | "trend" | "range";

export interface MarketStateScores {
  trend_score?: number | null;
  range_score?: number | null;
  risk_off_score?: number | null;
  event_label?: string | null;
  /** Override the auto-derived state label */
  state?: MarketState | null;
}

const STATE_CONFIG: Record<
  MarketState,
  {
    label: string;
    detail: string;
    multiplier: string;
    tone: "risk_off" | "event" | "trend" | "range";
  }
> = {
  risk_off: {
    label: "市場 risk-off",
    detail: "VIX/DXY/10Y 多項警示 — 不開新 beta 倉",
    multiplier: "倉位倍率 0",
    tone: "risk_off",
  },
  event: {
    label: "事件市",
    detail: "FOMC/CPI/法說 T-2~T+1 — 倉位倍率 0.5",
    multiplier: "倉位倍率 0.5",
    tone: "event",
  },
  trend: {
    label: "趨勢市",
    detail: "ADX>22, 均線多頭排列 — 倉位倍率 1.0",
    multiplier: "倉位倍率 1.0",
    tone: "trend",
  },
  range: {
    label: "震盪市",
    detail: "ADX<18, 指數貼近 EMA60 ±5%",
    multiplier: "倉位倍率 0.7",
    tone: "range",
  },
};

function deriveState(scores: MarketStateScores): MarketState {
  if (scores.state) return scores.state;
  const riskOff = scores.risk_off_score ?? 0;
  const trend = scores.trend_score ?? 0;
  const range = scores.range_score ?? 0;
  if (riskOff >= 3) return "risk_off";
  if (scores.event_label) return "event";
  if (trend >= 4) return "trend";
  if (range >= 2) return "range";
  // default safe fallback
  return "range";
}

function buildTooltip(scores: MarketStateScores): string {
  const parts: string[] = [];
  if (scores.trend_score != null) parts.push(`trend_score=${scores.trend_score}`);
  if (scores.range_score != null) parts.push(`range_score=${scores.range_score}`);
  if (scores.risk_off_score != null) parts.push(`risk_off_score=${scores.risk_off_score}`);
  if (scores.event_label) parts.push(`event=${scores.event_label}`);
  return parts.length > 0 ? parts.join(" / ") : "sub-score 數據待後端 v3 上線";
}

export function MarketStateBadge({
  scores,
  className,
}: {
  scores?: MarketStateScores;
  className?: string;
}) {
  const resolved = scores ?? {};
  const state = deriveState(resolved);
  const config = STATE_CONFIG[state];
  const tooltip = buildTooltip(resolved);

  return (
    <>
      <style>{`
        ._msb-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          border-radius: 7px;
          padding: 11px 16px;
          margin-bottom: 14px;
          border: 1px solid;
          font: 850 12px/1.45 var(--sans-tc, sans-serif);
        }
        ._msb-wrap._msb-risk_off {
          border-color: rgba(230, 57, 70, 0.52);
          background: rgba(230, 57, 70, 0.09);
          color: #f05f6b;
        }
        ._msb-wrap._msb-event {
          border-color: rgba(200, 148, 63, 0.52);
          background: rgba(200, 148, 63, 0.09);
          color: #c8943f;
        }
        ._msb-wrap._msb-trend {
          border-color: rgba(46, 204, 113, 0.42);
          background: rgba(46, 204, 113, 0.07);
          color: #2ecc71;
        }
        ._msb-wrap._msb-range {
          border-color: rgba(52, 152, 219, 0.42);
          background: rgba(52, 152, 219, 0.07);
          color: #3498db;
        }
        ._msb-dot {
          flex-shrink: 0;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
        }
        ._msb-label {
          font-weight: 900;
          white-space: nowrap;
        }
        ._msb-sep {
          opacity: 0.44;
          margin: 0 2px;
        }
        ._msb-detail {
          opacity: 0.82;
        }
        ._msb-mult {
          margin-left: auto;
          font: 900 11px/1 var(--mono, monospace);
          white-space: nowrap;
          opacity: 0.72;
        }
        ._msb-placeholder {
          display: flex;
          align-items: center;
          gap: 9px;
          border: 1px dashed rgba(200, 148, 63, 0.28);
          border-radius: 7px;
          padding: 9px 14px;
          margin-bottom: 14px;
          color: var(--tac-fg-3, #7a8aa0);
          font: 800 11px/1 var(--mono, monospace);
        }
      `}</style>
      <div
        className={`_msb-wrap _msb-${config.tone}${className ? ` ${className}` : ""}`}
        title={tooltip}
        aria-label={`市場狀態: ${config.label} / ${config.detail}`}
        data-market-state={state}
      >
        <span className="_msb-dot" aria-hidden="true" />
        <span className="_msb-label">{config.label}</span>
        <span className="_msb-sep">—</span>
        <span className="_msb-detail">{config.detail}</span>
        <span className="_msb-mult">{config.multiplier}</span>
      </div>
    </>
  );
}

/**
 * Placeholder shown when backend v3 data is not yet available.
 * Renders a dashed "待後端 v3" banner so the structure is visible
 * even with v2 payload.
 */
export function MarketStateBadgePlaceholder() {
  return (
    <>
      <style>{`
        ._msb-placeholder {
          display: flex;
          align-items: center;
          gap: 9px;
          border: 1px dashed rgba(200, 148, 63, 0.28);
          border-radius: 7px;
          padding: 9px 14px;
          margin-bottom: 14px;
          color: var(--tac-fg-3, #7a8aa0);
          font: 800 11px/1 var(--mono, monospace);
        }
      `}</style>
      <div className="_msb-placeholder" aria-label="市場狀態待後端 v3 上線">
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "rgba(200,148,63,0.38)",
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        市場狀態評估 — 待後端 v3 上線 (Jason BG 進行中)
      </div>
    </>
  );
}
