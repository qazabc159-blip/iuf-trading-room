import type { ExecutionGateDecision } from "@iuf-trading-room/contracts";

// Shared vocabulary between OrderTicket, MarketDataBanner, and the execution
// timeline. Keeping a single source of truth means the three surfaces never
// drift when the gate's allow / review_required / review_accepted /
// review_unusable / block / quote_unknown vocabulary changes.

export const QUOTE_GATE_COLOR: Record<ExecutionGateDecision, string> = {
  allow: "var(--phosphor)",
  review_accepted: "var(--phosphor)",
  review_required: "var(--amber)",
  review_unusable: "var(--danger, #ff4d4d)",
  block: "var(--danger, #ff4d4d)",
  quote_unknown: "var(--amber)"
};

export const QUOTE_GATE_LABEL: Record<ExecutionGateDecision, string> = {
  allow: "允許送單",
  review_accepted: "REVIEW 已接受",
  review_required: "需勾選接受 REVIEW 報價",
  review_unusable: "REVIEW 已勾選但報價仍不可用",
  block: "報價不可執行",
  quote_unknown: "報價未知（伺服器仍會最終判斷）"
};

// Hints for the aggregated decision-summary tally surface (e.g. the portfolio
// banner). The banner reports mode-level allow / review / block totals across
// many symbols, so it can't pick a single ExecutionGateDecision — instead it
// uses this map to describe what each tally means in gate-override terms.
export const MODE_DECISION_HINT: Record<"allow" | "review" | "block", string> = {
  allow: "送單可直接通過閘道",
  review: "送單需勾選接受 REVIEW 報價（quote_review 覆寫）才能通過",
  block: "報價不可執行 · 送單會被伺服器閘阻擋"
};

export type QuoteDecisionModeSummary = {
  decision: "allow" | "review" | "block";
};

export type ModeHintRow = {
  mode: "paper" | "execution";
  decision: "review" | "block";
};

// Pure helper for ExecutionTimeline's per-mode hint block. Given the paper and
// execution mode decisions, returns the non-allow rows in a stable order so
// the timeline can render one hint per lane that still has a constraint. When
// both modes allow, returns []. When the lanes disagree (e.g. paper allow +
// execution review), only the non-allow lane appears — so the reader sees
// exactly which lane the hint belongs to.
export function buildModeHintRows(
  paper: QuoteDecisionModeSummary | undefined,
  execution: QuoteDecisionModeSummary | undefined
): ModeHintRow[] {
  const rows: ModeHintRow[] = [];
  if (paper && paper.decision !== "allow") {
    rows.push({ mode: "paper", decision: paper.decision });
  }
  if (execution && execution.decision !== "allow") {
    rows.push({ mode: "execution", decision: execution.decision });
  }
  return rows;
}
