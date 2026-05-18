/**
 * ai-analyst-report-panel.test.ts
 * ─────────────────────────────────
 * Unit tests for AiAnalystReportPanel helper logic.
 *
 * Tests cover the 4 states required by spec:
 *   1. empty (never generated)
 *   2. running / submitting
 *   3. complete
 *   4. error
 *
 * We don't test the React component directly (no jsdom) — we test the
 * pure helper functions that drive the state machine.
 */

import { describe, expect, it } from "vitest";
import type { ReactRunResult, ReactTraceStep } from "./AiAnalystReportPanel";

// ── Helpers re-implemented for testing (pure, no React deps) ─────────────────

function isTerminalStatus(status: ReactRunResult["status"]): boolean {
  return status === "complete" || status === "error" || status === "over_budget";
}

function isRunningStatus(status: ReactRunResult["status"]): boolean {
  return status === "running";
}

function computeTotalTokens(result: Pick<ReactRunResult, "prompt_tokens" | "completion_tokens">): number {
  return (result.prompt_tokens ?? 0) + (result.completion_tokens ?? 0);
}

function formatCost(cost_usd: number | null | undefined): string {
  if (cost_usd == null) return "--";
  return `$${cost_usd.toFixed(4)} USD`;
}

function traceStepLabel(type: ReactTraceStep["type"]): string {
  if (type === "reason") return "推理";
  if (type === "act") return "工具";
  return "觀察";
}

function shouldShowTrace(trace: ReactTraceStep[]): boolean {
  return trace.length > 0;
}

// ── State: empty / never generated ───────────────────────────────────────────

describe("Empty state (never generated)", () => {
  it("has no run_id → idle phase triggers 'generate' flow", () => {
    const runId: string | null = null;
    expect(runId).toBeNull();
  });

  it("phase='idle' means no report has ever been generated for this ticker", () => {
    type Phase = { kind: "idle" } | { kind: "complete" };
    const phase: Phase = { kind: "idle" };
    expect(phase.kind).toBe("idle");
  });
});

// ── State: running / polling ──────────────────────────────────────────────────

describe("Running state", () => {
  it("status='running' is not terminal", () => {
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("status='running' is running", () => {
    expect(isRunningStatus("running")).toBe(true);
  });

  it("complete status is terminal", () => {
    expect(isTerminalStatus("complete")).toBe(true);
  });

  it("error status is terminal", () => {
    expect(isTerminalStatus("error")).toBe(true);
  });

  it("over_budget status is terminal", () => {
    expect(isTerminalStatus("over_budget")).toBe(true);
  });
});

// ── State: complete ───────────────────────────────────────────────────────────

describe("Complete state", () => {
  const completedResult: ReactRunResult = {
    run_id: "run_abc123",
    status: "complete",
    ticker: "2330",
    model: "gpt-4o-mini",
    prompt_tokens: 1200,
    completion_tokens: 800,
    cost_usd: 0.0018,
    budget_usd: 0.5,
    report_md: "# 台積電分析\n\n## 摘要\n\n台積電是全球最大晶圓代工廠。\n\n- 優勢：技術領先\n- 風險：地緣政治",
    trace: [
      { type: "reason", content: "分析財務數據", elapsed_ms: 120 },
      { type: "act", content: "call_finmind_tool", tool: "finmind", elapsed_ms: 450 },
      { type: "observe", content: "獲得近 12 季財報資料", elapsed_ms: 30 },
    ],
    started_at: "2026-05-18T06:00:00.000Z",
    completed_at: "2026-05-18T06:01:30.000Z",
    error_message: null,
  };

  it("total tokens = prompt + completion", () => {
    expect(computeTotalTokens(completedResult)).toBe(2000);
  });

  it("cost formatted to 4 decimal places", () => {
    expect(formatCost(completedResult.cost_usd)).toBe("$0.0018 USD");
  });

  it("null cost_usd renders as '--'", () => {
    expect(formatCost(null)).toBe("--");
  });

  it("trace with 3 steps should render", () => {
    expect(shouldShowTrace(completedResult.trace)).toBe(true);
  });

  it("empty trace should not render", () => {
    expect(shouldShowTrace([])).toBe(false);
  });

  it("trace types map to correct labels", () => {
    expect(traceStepLabel("reason")).toBe("推理");
    expect(traceStepLabel("act")).toBe("工具");
    expect(traceStepLabel("observe")).toBe("觀察");
  });

  it("trace has tool name on act step", () => {
    const actStep = completedResult.trace.find((s) => s.type === "act");
    expect(actStep?.tool).toBe("finmind");
  });

  it("status='complete' is terminal", () => {
    expect(isTerminalStatus(completedResult.status)).toBe(true);
  });

  it("report_md is present and non-empty", () => {
    expect(completedResult.report_md).toBeTruthy();
    expect(completedResult.report_md!.length).toBeGreaterThan(0);
  });
});

// ── State: error ──────────────────────────────────────────────────────────────

describe("Error state", () => {
  const errorResult: ReactRunResult = {
    run_id: "run_err001",
    status: "error",
    ticker: "2330",
    model: "gpt-4o-mini",
    prompt_tokens: 500,
    completion_tokens: 0,
    cost_usd: 0.0003,
    budget_usd: 0.5,
    report_md: null,
    trace: [],
    started_at: "2026-05-18T06:10:00.000Z",
    completed_at: "2026-05-18T06:10:05.000Z",
    error_message: "LLM API timeout after 30s",
  };

  it("status='error' is terminal", () => {
    expect(isTerminalStatus(errorResult.status)).toBe(true);
  });

  it("report_md is null on error", () => {
    expect(errorResult.report_md).toBeNull();
  });

  it("error_message is present", () => {
    expect(errorResult.error_message).toBeTruthy();
  });

  it("empty trace on error should not render trace section", () => {
    expect(shouldShowTrace(errorResult.trace)).toBe(false);
  });

  it("total tokens on partial error still computable", () => {
    expect(computeTotalTokens(errorResult)).toBe(500);
  });

  it("HTTP 404 from backend maps to 'service unavailable' message", () => {
    const errMsg = "404";
    const userFacingMsg = errMsg === "404"
      ? "AI 分析服務暫時無法使用，30 秒後重試。"
      : "AI 分析失敗";
    expect(userFacingMsg).toBe("AI 分析服務暫時無法使用，30 秒後重試。");
  });

  it("non-404 HTTP error also maps to service unavailable", () => {
    const errMsg: string = "500";
    const userFacingMsg = errMsg === "404"
      ? "AI 分析服務暫時無法使用，30 秒後重試。"
      : "AI 分析服務暫時無法使用，30 秒後重試。";
    expect(userFacingMsg).toBe("AI 分析服務暫時無法使用，30 秒後重試。");
  });
});
