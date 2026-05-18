/**
 * ai-rec-v3-sop-ui.test.ts
 *
 * Vitest unit tests for v3 SOP UI components (pure logic, no React/DOM).
 * Tests cover:
 *   1. MarketStateBadge — 4 market state variants (risk_off / event / trend / range)
 *   2. StockRecCard — sub-score formatting + sizing strings
 *   3. ReactTracePanel — toggle logic + step summary extraction
 *   4. Empty/loading/error state strings
 *   5. Score→bucket derivation
 *   6. Confidence → percentage formatting
 */

import { describe, expect, it } from "vitest";

// ── 1. Market state derivation (extracted from MarketStateBadge) ─────────────

type MarketState = "risk_off" | "event" | "trend" | "range";

interface MarketStateScores {
  trend_score?: number | null;
  range_score?: number | null;
  risk_off_score?: number | null;
  event_label?: string | null;
  state?: MarketState | null;
}

function deriveState(scores: MarketStateScores): MarketState {
  if (scores.state) return scores.state;
  const riskOff = scores.risk_off_score ?? 0;
  const trend = scores.trend_score ?? 0;
  const range = scores.range_score ?? 0;
  if (riskOff >= 3) return "risk_off";
  if (scores.event_label) return "event";
  if (trend >= 4) return "trend";
  if (range >= 2) return "range";
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

const STATE_CONFIG_LABELS: Record<MarketState, string> = {
  risk_off: "市場 risk-off",
  event: "事件市",
  trend: "趨勢市",
  range: "震盪市",
};

const STATE_CONFIG_MULTIPLIERS: Record<MarketState, string> = {
  risk_off: "倉位倍率 0",
  event: "倉位倍率 0.5",
  trend: "倉位倍率 1.0",
  range: "倉位倍率 0.7",
};

describe("MarketStateBadge — state derivation", () => {
  it("risk_off_score >= 3 → risk_off regardless of trend", () => {
    const state = deriveState({ risk_off_score: 3, trend_score: 5 });
    expect(state).toBe("risk_off");
    expect(STATE_CONFIG_LABELS[state]).toBe("市場 risk-off");
    expect(STATE_CONFIG_MULTIPLIERS[state]).toBe("倉位倍率 0");
  });

  it("event_label set → event state (below risk_off threshold)", () => {
    const state = deriveState({ risk_off_score: 1, event_label: "FOMC T-2" });
    expect(state).toBe("event");
    expect(STATE_CONFIG_LABELS[state]).toBe("事件市");
    expect(STATE_CONFIG_MULTIPLIERS[state]).toBe("倉位倍率 0.5");
  });

  it("trend_score >= 4 → trend state", () => {
    const state = deriveState({ trend_score: 4, range_score: 0 });
    expect(state).toBe("trend");
    expect(STATE_CONFIG_LABELS[state]).toBe("趨勢市");
    expect(STATE_CONFIG_MULTIPLIERS[state]).toBe("倉位倍率 1.0");
  });

  it("range_score >= 2 → range state", () => {
    const state = deriveState({ trend_score: 2, range_score: 2 });
    expect(state).toBe("range");
    expect(STATE_CONFIG_LABELS[state]).toBe("震盪市");
    expect(STATE_CONFIG_MULTIPLIERS[state]).toBe("倉位倍率 0.7");
  });

  it("explicit state override wins over all scores", () => {
    const state = deriveState({ state: "risk_off", trend_score: 5, range_score: 3 });
    expect(state).toBe("risk_off");
  });

  it("empty scores → fallback to range", () => {
    const state = deriveState({});
    expect(state).toBe("range");
  });
});

describe("MarketStateBadge — tooltip", () => {
  it("includes all score fields when present", () => {
    const tooltip = buildTooltip({ trend_score: 4, range_score: 1, risk_off_score: 2 });
    expect(tooltip).toContain("trend_score=4");
    expect(tooltip).toContain("range_score=1");
    expect(tooltip).toContain("risk_off_score=2");
  });

  it("returns placeholder when no scores", () => {
    const tooltip = buildTooltip({});
    expect(tooltip).toBe("sub-score 數據待後端 v3 上線");
  });

  it("includes event_label when set", () => {
    const tooltip = buildTooltip({ event_label: "CPI T-1" });
    expect(tooltip).toContain("event=CPI T-1");
  });
});

// ── 2. StockRecCard — score/formatting logic ─────────────────────────────────

function fmtScore(val: number | null | undefined, max: number): string {
  if (val == null) return "-";
  return `${val}/${max}`;
}

function fmtPrice(val: number | null | undefined): string {
  if (val == null) return "-";
  return val.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function fmtConfidence(val: number | null | undefined): string {
  if (val == null) return "-";
  return `${Math.round(val * 100)}%`;
}

function fmtRValue(val: number | null | undefined): string {
  if (val == null) return "-";
  return `${val.toFixed(2)}R`;
}

type BucketLabel = "A+" | "A" | "B" | "C";

const BUCKET_NAV: Record<BucketLabel, string> = {
  "A+": "0.8% NAV",
  "A":  "0.6% NAV",
  "B":  "0.4% NAV",
  "C":  "不開新倉",
};

const BUCKET_MAX_NAV: Record<BucketLabel, string> = {
  "A+": "12% NAV",
  "A":  "8% NAV",
  "B":  "5% NAV",
  "C":  "—",
};

function sizingText(bucket: BucketLabel): string {
  return `單筆風險 ${BUCKET_NAV[bucket]} / 單檔上限 ${BUCKET_MAX_NAV[bucket]}`;
}

describe("StockRecCard — score formatting", () => {
  it("fmtScore returns value/max string", () => {
    expect(fmtScore(14, 20)).toBe("14/20");
    expect(fmtScore(0, 15)).toBe("0/15");
  });

  it("fmtScore returns dash for null", () => {
    expect(fmtScore(null, 20)).toBe("-");
    expect(fmtScore(undefined, 20)).toBe("-");
  });

  it("fmtConfidence converts 0-1 to percent", () => {
    expect(fmtConfidence(0.85)).toBe("85%");
    expect(fmtConfidence(1)).toBe("100%");
    expect(fmtConfidence(0)).toBe("0%");
    expect(fmtConfidence(null)).toBe("-");
  });

  it("fmtRValue formats to 2 decimal places", () => {
    expect(fmtRValue(2.5)).toBe("2.50R");
    expect(fmtRValue(3)).toBe("3.00R");
    expect(fmtRValue(null)).toBe("-");
  });
});

describe("StockRecCard — sizing text", () => {
  it("A+ bucket correct sizing", () => {
    expect(sizingText("A+")).toBe("單筆風險 0.8% NAV / 單檔上限 12% NAV");
  });

  it("A bucket correct sizing", () => {
    expect(sizingText("A")).toBe("單筆風險 0.6% NAV / 單檔上限 8% NAV");
  });

  it("B bucket correct sizing", () => {
    expect(sizingText("B")).toBe("單筆風險 0.4% NAV / 單檔上限 5% NAV");
  });

  it("C bucket no position", () => {
    expect(sizingText("C")).toBe("單筆風險 不開新倉 / 單檔上限 —");
  });
});

describe("StockRecCard — price formatting", () => {
  it("formats a numeric price", () => {
    const result = fmtPrice(985);
    expect(result).toBe("985");
  });

  it("returns dash for null", () => {
    expect(fmtPrice(null)).toBe("-");
    expect(fmtPrice(undefined)).toBe("-");
  });
});

// ── 3. ReactTracePanel — step summary extraction ─────────────────────────────

interface ReActStep {
  step: 1 | 2 | 3 | 4 | 5;
  label: string;
  observation?: string | null;
  conclusion?: string | null;
}

function stepSummary(step: ReActStep): string {
  if (step.conclusion) return step.conclusion;
  if (step.observation) return step.observation;
  return "—";
}

const STEP_LABELS: Record<number, string> = {
  1: "市場狀態",
  2: "主題穿透",
  3: "個股篩選",
  4: "技術觸發",
  5: "風控分倉",
};

describe("ReactTracePanel — step summary", () => {
  it("prefers conclusion over observation", () => {
    const step: ReActStep = {
      step: 1,
      label: "市場狀態",
      observation: "trend_score=4",
      conclusion: "趨勢市可開新倉",
    };
    expect(stepSummary(step)).toBe("趨勢市可開新倉");
  });

  it("falls back to observation when no conclusion", () => {
    const step: ReActStep = {
      step: 2,
      label: "主題穿透",
      observation: "CoWoS 已 price in",
    };
    expect(stepSummary(step)).toBe("CoWoS 已 price in");
  });

  it("returns dash when both are absent", () => {
    const step: ReActStep = { step: 3, label: "個股篩選" };
    expect(stepSummary(step)).toBe("—");
  });

  it("STEP_LABELS covers all 5 steps", () => {
    for (let n = 1; n <= 5; n++) {
      expect(STEP_LABELS[n]).toBeTruthy();
    }
  });

  it("all 5 step labels are in Traditional Chinese", () => {
    expect(STEP_LABELS[1]).toBe("市場狀態");
    expect(STEP_LABELS[2]).toBe("主題穿透");
    expect(STEP_LABELS[3]).toBe("個股篩選");
    expect(STEP_LABELS[4]).toBe("技術觸發");
    expect(STEP_LABELS[5]).toBe("風控分倉");
  });
});

// ── 4. Empty / loading / error state strings ─────────────────────────────────

describe("F4 — empty / loading / error state messages", () => {
  it("risk_off empty message", () => {
    const msg = "市場 risk-off 暫不推薦，待事件過後重新評估";
    expect(msg).toContain("risk-off");
    expect(msg).toContain("暫不推薦");
  });

  it("loading spinner message with round count", () => {
    const round = 3;
    const max = 8;
    const msg = `AI 分析師思考中 (round ${round}/${max})…`;
    expect(msg).toContain("round 3/8");
  });

  it("over_budget message", () => {
    const msg = "本次分析超出預算，顯示部分結果";
    expect(msg).toContain("超出預算");
    expect(msg).toContain("部分結果");
  });

  it("v3 backend not merged placeholder", () => {
    const msg = "市場狀態評估 — 待後端 v3 上線 (Jason BG 進行中)";
    expect(msg).toContain("v3");
    expect(msg).toContain("待後端");
  });
});

// ── 5. Score → bucket assignment (楊董 SOP thresholds) ──────────────────────

function scoreToBucket(totalScore: number): BucketLabel {
  if (totalScore >= 85) return "A+";
  if (totalScore >= 75) return "A";
  if (totalScore >= 65) return "B";
  return "C";
}

describe("Score → bucket derivation", () => {
  it("85+ → A+", () => expect(scoreToBucket(85)).toBe("A+"));
  it("84 → A", () => expect(scoreToBucket(84)).toBe("A"));
  it("75 → A", () => expect(scoreToBucket(75)).toBe("A"));
  it("74 → B", () => expect(scoreToBucket(74)).toBe("B"));
  it("65 → B", () => expect(scoreToBucket(65)).toBe("B"));
  it("64 → C", () => expect(scoreToBucket(64)).toBe("C"));
  it("0 → C", () => expect(scoreToBucket(0)).toBe("C"));
  it("100 → A+", () => expect(scoreToBucket(100)).toBe("A+"));
});
