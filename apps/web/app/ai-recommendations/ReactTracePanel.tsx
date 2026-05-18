"use client";

/**
 * ReactTracePanel — F3
 *
 * Collapsible "AI 思考過程" section.
 * Renders the 5-module SOP reasoning trace from the ReAct loop.
 *
 * Each step shows:
 *   - Step number + label
 *   - Observation / conclusion text
 *   - Tool invocations (callTool name + args)
 *
 * Backward-compatible: works with empty/null steps (shows "—").
 */

export interface ToolCall {
  tool: string;
  args?: Record<string, unknown> | null;
  result?: string | null;
}

export interface ReActStep {
  step: 1 | 2 | 3 | 4 | 5;
  label: string;
  observation?: string | null;
  conclusion?: string | null;
  tool_calls?: ToolCall[] | null;
}

export interface ReactTracePanelProps {
  steps?: ReActStep[] | null;
  /** Total number of ReAct rounds (for "round N/8" display) */
  round_current?: number | null;
  round_max?: number | null;
  /** Whether the loop is still running */
  is_running?: boolean;
  /** Override to show a cost-cap message */
  over_budget?: boolean;
}

const STEP_LABELS: Record<number, string> = {
  1: "市場狀態",
  2: "主題穿透",
  3: "個股篩選",
  4: "技術觸發",
  5: "風控分倉",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function stepSummary(step: ReActStep): string {
  if (step.conclusion) return step.conclusion;
  if (step.observation) return step.observation;
  return "—";
}

function argsDisplay(args: Record<string, unknown> | null | undefined): string {
  if (!args) return "";
  const parts = Object.entries(args)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return parts.join(", ");
}

// ── Component ────────────────────────────────────────────────────────────────

export function ReactTracePanel({
  steps,
  round_current,
  round_max,
  is_running,
  over_budget,
}: ReactTracePanelProps) {
  const hasSteps = steps && steps.length > 0;

  const roundLabel =
    round_current != null && round_max != null
      ? `round ${round_current}/${round_max}`
      : null;

  return (
    <>
      <style>{`
        ._rtp-wrap {
          border-top: 1px solid var(--tac-line, rgba(220,228,240,0.14));
          padding-top: 10px;
        }
        ._rtp-summary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          color: var(--tac-fg-0, #e8edf5);
          font: 850 12px/1 var(--sans-tc, sans-serif);
          list-style: none;
          padding: 4px 0;
          user-select: none;
        }
        ._rtp-summary::-webkit-details-marker { display: none; }
        ._rtp-badge {
          min-height: 20px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid rgba(200, 148, 63, 0.34);
          border-radius: 4px;
          padding: 0 7px;
          color: var(--tac-brand, #c8943f);
          background: rgba(200, 148, 63, 0.06);
          font: 900 9px/1 var(--mono, monospace);
        }
        ._rtp-steps {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }
        ._rtp-step {
          display: grid;
          gap: 6px;
          border: 1px solid var(--tac-line, rgba(220,228,240,0.10));
          border-radius: 6px;
          padding: 11px 13px;
          background: rgba(8, 11, 16, 0.32);
        }
        ._rtp-step-head {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        ._rtp-step-num {
          flex-shrink: 0;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(200, 148, 63, 0.14);
          color: var(--tac-brand, #c8943f);
          font: 900 10px/1 var(--mono, monospace);
          border: 1px solid rgba(200, 148, 63, 0.28);
        }
        ._rtp-step-label {
          color: var(--tac-fg-0, #e8edf5);
          font: 850 12px/1 var(--sans-tc, sans-serif);
        }
        ._rtp-step-obs {
          color: var(--tac-fg-2, #aab5c5);
          font-size: 12px;
          line-height: 1.62;
          margin: 0;
        }
        ._rtp-tools {
          display: grid;
          gap: 5px;
          margin-top: 4px;
        }
        ._rtp-tool-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          font: 800 11px/1 var(--mono, monospace);
          color: var(--tac-fg-3, #7a8aa0);
        }
        ._rtp-tool-name {
          color: var(--tac-ok, #2ecc71);
          font-weight: 900;
        }
        ._rtp-tool-args {
          color: var(--tac-fg-3, #7a8aa0);
          opacity: 0.72;
        }
        ._rtp-tool-result {
          color: var(--tac-fg-2, #aab5c5);
          grid-column: 1/-1;
          padding-left: 14px;
          font-size: 10px;
          opacity: 0.72;
        }
        ._rtp-empty-step {
          color: var(--tac-fg-3, #7a8aa0);
          font: 800 11px/1 var(--mono, monospace);
        }
        ._rtp-placeholder-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          color: var(--tac-fg-3, #7a8aa0);
          font: 800 11px/1.5 var(--mono, monospace);
        }
        ._rtp-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(200,148,63,0.2);
          border-top-color: rgba(200,148,63,0.72);
          border-radius: 50%;
          animation: _rtp-spin 0.9s linear infinite;
          flex-shrink: 0;
        }
        @keyframes _rtp-spin {
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          ._rtp-spinner { animation: none; opacity: 0.5; }
        }
      `}</style>

      <details className="_rtp-wrap">
        <summary className="_rtp-summary">
          AI 思考過程
          {roundLabel && (
            <span className="_rtp-badge">{roundLabel}</span>
          )}
          {is_running && (
            <span className="_rtp-badge" style={{ borderColor: "rgba(200,148,63,0.28)" }}>
              思考中…
            </span>
          )}
          {over_budget && (
            <span className="_rtp-badge" style={{ borderColor: "rgba(230,57,70,0.34)", color: "#e63946", background: "rgba(230,57,70,0.06)" }}>
              預算超限
            </span>
          )}
        </summary>

        <div className="_rtp-steps">
          {hasSteps ? (
            steps.map((step) => (
              <div key={step.step} className="_rtp-step">
                <div className="_rtp-step-head">
                  <span className="_rtp-step-num">{step.step}</span>
                  <span className="_rtp-step-label">
                    {step.label || STEP_LABELS[step.step] || `STEP ${step.step}`}
                  </span>
                </div>

                <p className="_rtp-step-obs">{stepSummary(step)}</p>

                {step.tool_calls && step.tool_calls.length > 0 && (
                  <div className="_rtp-tools">
                    {step.tool_calls.map((tc, idx) => (
                      <div key={idx} className="_rtp-tool-row">
                        <span className="_rtp-tool-name">callTool({tc.tool})</span>
                        {tc.args && (
                          <span className="_rtp-tool-args">
                            {argsDisplay(tc.args)}
                          </span>
                        )}
                        {tc.result && (
                          <span className="_rtp-tool-result">→ {tc.result}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            /* Placeholder: render all 5 steps as skeleton */
            Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
              <div key={n} className="_rtp-step">
                <div className="_rtp-step-head">
                  <span className="_rtp-step-num">{n}</span>
                  <span className="_rtp-step-label">
                    STEP {n} {STEP_LABELS[n]}
                  </span>
                </div>
                <p className="_rtp-empty-step">
                  {is_running ? "分析中…" : "— 待後端 v3 回傳 —"}
                </p>
              </div>
            ))
          )}

          {is_running && (
            <div className="_rtp-placeholder-row">
              <span className="_rtp-spinner" aria-hidden="true" />
              AI 分析師思考中{roundLabel ? ` (${roundLabel})` : ""}…
            </div>
          )}

          {over_budget && (
            <div
              className="_rtp-placeholder-row"
              style={{ color: "#e63946" }}
            >
              本次分析超出預算，顯示部分結果
            </div>
          )}
        </div>
      </details>
    </>
  );
}
