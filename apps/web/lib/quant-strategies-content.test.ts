import { describe, expect, it } from "vitest";

import {
  QUANT_COMPLIANCE_FOOTER,
  QUANT_GOVERNANCE_NOTES,
  QUANT_PAGE_HEADER,
  QUANT_STRATEGIES_CONTENT,
  formatMilestoneDate,
  getQuantStrategyContent,
  milestoneState,
} from "./quant-strategies-content";

const BANNED_PATTERNS: RegExp[] = [
  /approved/i,
  /live-ready/i,
  /alpha confirmed/i,
  /可以跟單/,
  /保證獲利/,
  /已驗證/,
  /前向/,
  /S1\b/,
  /V5-1/,
  /V3-4/,
  /F-AUTO/i,
];

function allVisibleStrings(): string[] {
  const strings: string[] = [QUANT_PAGE_HEADER.title, QUANT_PAGE_HEADER.subtitle, QUANT_PAGE_HEADER.note];
  strings.push(...QUANT_GOVERNANCE_NOTES, QUANT_COMPLIANCE_FOOTER);
  for (const strategy of QUANT_STRATEGIES_CONTENT) {
    strings.push(
      strategy.name,
      strategy.oneLiner,
      strategy.statusBadge,
      strategy.nextAction.label,
      strategy.detail.summary,
      ...strategy.chips,
      ...strategy.detail.mechanics,
      ...strategy.milestones.map((m) => m.label),
    );
  }
  return strings;
}

describe("quant-strategies-content v9.1", () => {
  it("exposes exactly the two v9.1 strategies with stable slugs", () => {
    expect(QUANT_STRATEGIES_CONTENT.map((s) => s.id)).toEqual(["fundamental-momentum", "trend-continuation"]);
    expect(getQuantStrategyContent("fundamental-momentum")?.name).toBe("基本面動能");
    expect(getQuantStrategyContent("trend-continuation")?.name).toBe("趨勢延續");
    expect(getQuantStrategyContent("does-not-exist")).toBeNull();
  });

  it("carries the three ACK'd milestone dates and nothing else fabricated", () => {
    const allDates = QUANT_STRATEGIES_CONTENT.flatMap((s) => s.milestones.map((m) => m.date)).filter(
      (d): d is string => d != null,
    );
    expect(new Set(allDates)).toEqual(new Set(["2026-07-13", "2026-08-03", "2026-08-12"]));
  });

  it("每張策略卡都有 3 步里程碑樣板 + 下一個動作", () => {
    for (const strategy of QUANT_STRATEGIES_CONTENT) {
      expect(strategy.milestones).toHaveLength(3);
      expect(strategy.nextAction.label.length).toBeGreaterThan(0);
      expect(strategy.nextAction.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("milestoneState: past/today dates are done, future dates are upcoming, null is pending", () => {
    const today = "2026-07-19";
    expect(milestoneState("2026-07-13", today)).toBe("done");
    expect(milestoneState("2026-07-19", today)).toBe("done");
    expect(milestoneState("2026-08-03", today)).toBe("upcoming");
    expect(milestoneState(null, today)).toBe("pending");
  });

  it("formatMilestoneDate: renders MM/DD, honest 待排定 for unscheduled steps", () => {
    expect(formatMilestoneDate("2026-08-12")).toBe("08/12");
    expect(formatMilestoneDate(null)).toBe("待排定");
  });

  it("0 運行績效數字：不含任何百分比報酬數字或 NAV 字樣（本頁文案只能用「不顯示/將揭露」這類誠實揭露句子提到本金／持倉，不能出現實際數字）", () => {
    const combined = allVisibleStrings().join("\n");
    // 任何形如 12.34% / +1.23% 的報酬數字一律禁止。
    expect(combined).not.toMatch(/[+-]?\d+(\.\d+)?%/);
    expect(combined).not.toMatch(/\bNAV\b/);
  });

  it("禁字掃描：全部可見文案 0 命中內部工程/誇大詞彙", () => {
    const combined = allVisibleStrings().join("\n");
    for (const pattern of BANNED_PATTERNS) {
      expect(combined).not.toMatch(pattern);
    }
  });
});
