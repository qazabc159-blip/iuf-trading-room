import { describe, expect, it } from "vitest";

import {
  QUANT_COMPLIANCE_FOOTER,
  QUANT_GOVERNANCE_NOTES,
  QUANT_PAGE_HEADER,
  QUANT_STRATEGIES_CONTENT,
  deriveStrategyProgress,
  formatMilestoneDate,
  formatNextAction,
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

// Pete review #1311 round 2（🔴 must-fix）：statusBadge/nextAction 不再是
// 靜態欄位，掃描禁字/百分比時要涵蓋「跨多個日期算出來的 derived 文字」，
// 不能只掃內容模組本身的靜態字串——否則 derive 出來的文案漏檢。
const CHECKPOINT_DATES = ["2026-07-01", "2026-07-19", "2026-08-05", "2026-09-01"];

function allVisibleStrings(): string[] {
  const strings: string[] = [QUANT_PAGE_HEADER.title, QUANT_PAGE_HEADER.subtitle, QUANT_PAGE_HEADER.note];
  strings.push(...QUANT_GOVERNANCE_NOTES, QUANT_COMPLIANCE_FOOTER);
  for (const strategy of QUANT_STRATEGIES_CONTENT) {
    strings.push(
      strategy.name,
      strategy.oneLiner,
      strategy.detail.summary,
      ...strategy.chips,
      ...strategy.detail.mechanics,
      ...strategy.milestones.map((m) => m.label),
    );
    for (const today of CHECKPOINT_DATES) {
      const progress = deriveStrategyProgress(strategy, today);
      strings.push(progress.badge, formatNextAction(progress));
    }
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

  it("每張策略卡都有 3 步里程碑樣板；不再有靜態 statusBadge/nextAction 欄位", () => {
    for (const strategy of QUANT_STRATEGIES_CONTENT) {
      expect(strategy.milestones).toHaveLength(3);
      expect(strategy).not.toHaveProperty("statusBadge");
      expect(strategy).not.toHaveProperty("nextAction");
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

  describe("deriveStrategyProgress — single source of truth for badge/nextAction (Pete #1311 round 2 🔴)", () => {
    it("基本面動能 today (2026-07-19)：已過 07/13，下一步是 08/12 真金試點", () => {
      const strategy = getQuantStrategyContent("fundamental-momentum")!;
      const progress = deriveStrategyProgress(strategy, "2026-07-19");
      expect(progress.badge).toBe("模擬盤觀察中");
      expect(progress.nextAction).toEqual({ label: "真金試點", date: "2026-08-12" });
    });

    it("基本面動能 08/13 之前：什麼都還沒到，下一步是 07/13 模擬盤觀察起算", () => {
      const strategy = getQuantStrategyContent("fundamental-momentum")!;
      const progress = deriveStrategyProgress(strategy, "2026-07-01");
      expect(progress.badge).toBe("排程準備中");
      expect(progress.nextAction).toEqual({ label: "模擬盤觀察起算", date: "2026-07-13" });
    });

    it("基本面動能 08/12 之後：3 步全數到達，翻成終態，不再宣稱有下一步", () => {
      const strategy = getQuantStrategyContent("fundamental-momentum")!;
      const progress = deriveStrategyProgress(strategy, "2026-09-01");
      expect(progress.badge).toBe("真金試點已啟動");
      expect(progress.nextAction).toBeNull();
      expect(formatNextAction(progress)).toBe("里程碑已全數達成");
    });

    it("趨勢延續 today (2026-07-19)：下一步是 08/03 排程首組合", () => {
      const strategy = getQuantStrategyContent("trend-continuation")!;
      const progress = deriveStrategyProgress(strategy, "2026-07-19");
      expect(progress.badge).toBe("排程準備中");
      expect(progress.nextAction).toEqual({ label: "排程首組合", date: "2026-08-03" });
    });

    it("趨勢延續 08/03 過後：翻成「排程執行中」，下一步指向真金試點（尚未排定日期，誠實顯示待排定，不編日期）", () => {
      const strategy = getQuantStrategyContent("trend-continuation")!;
      const progress = deriveStrategyProgress(strategy, "2026-08-05");
      expect(progress.badge).toBe("排程執行中");
      expect(progress.nextAction).toEqual({ label: "真金試點", date: null });
      expect(formatNextAction(progress)).toBe("真金試點 · 待排定");
    });

    it("跨日期不變量：nextAction 永遠不會指向一個已經到達（<= today）的日期——不然就是 null（終態）或尚未排定（null date）", () => {
      for (const strategy of QUANT_STRATEGIES_CONTENT) {
        for (const today of CHECKPOINT_DATES) {
          const progress = deriveStrategyProgress(strategy, today);
          if (progress.nextAction != null && progress.nextAction.date != null) {
            expect(progress.nextAction.date > today).toBe(true);
          }
        }
      }
    });
  });

  it("0 運行績效數字：不含任何百分比報酬數字或 NAV 字樣（含 derive 出來的 badge/nextAction 文字）", () => {
    const combined = allVisibleStrings().join("\n");
    // 任何形如 12.34% / +1.23% 的報酬數字一律禁止。
    expect(combined).not.toMatch(/[+-]?\d+(\.\d+)?%/);
    expect(combined).not.toMatch(/\bNAV\b/);
  });

  it("禁字掃描：全部可見文案（含 derive 出來的 badge/nextAction）0 命中內部工程/誇大詞彙", () => {
    const combined = allVisibleStrings().join("\n");
    for (const pattern of BANNED_PATTERNS) {
      expect(combined).not.toMatch(pattern);
    }
  });
});
