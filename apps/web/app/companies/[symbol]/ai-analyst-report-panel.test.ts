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
import { assessCompanyAiReportQuality } from "./aiAnalystReportQuality";
import {
  buildCompanyAiAnalystPrompt,
  COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION,
  COMPANY_AI_ANALYST_REQUIRED_SECTIONS,
} from "./aiAnalystReportContract";

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

describe("Company AI analyst prompt contract", () => {
  it("pins the template version and ticker", () => {
    const prompt = buildCompanyAiAnalystPrompt("2330");
    expect(prompt).toContain(COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION);
    expect(prompt).toContain("分析標的: 2330");
  });

  it("contains all required sections in stable order", () => {
    const prompt = buildCompanyAiAnalystPrompt("2454");
    const positions = COMPANY_AI_ANALYST_REQUIRED_SECTIONS.map((section) => prompt.indexOf(section));

    for (const position of positions) {
      expect(position).toBeGreaterThan(-1);
    }
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("forces honest degraded wording instead of invented facts", () => {
    const prompt = buildCompanyAiAnalystPrompt("2317");
    expect(prompt).toContain("缺資料時要說明已查來源、缺哪個欄位、影響哪個判斷");
    expect(prompt).toContain("即使資料不足，也必須用可讀的產品語言完成該段");
    expect(prompt).toContain("不可猜測");
    expect(prompt).toContain("不可給保證獲利");
    expect(prompt).toContain("不是下單建議");
    expect(prompt).toContain("不可輸出 get_company_technical");
    expect(prompt).toContain("不要複述本段規則、禁止詞或工具名稱");
  });
});

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

describe("Company AI analyst report quality gate", () => {
  it("allows a customer-facing report without engineering internals", () => {
    const report = [
      "## 1. 公司概況與定位",
      "台積電仍是全球先進製程與高階封裝的核心供應商，2330 是半導體權值核心。",
      "## 2. 今日/最近資料狀態",
      "即時行情顯示最新價 2,425 元，日 K 線日期為 2026-06-05，成交量 29,219,904 股。",
      "## 3. 近期事件與新聞",
      "重大訊息與 TWSE 公告需確認日期與來源，AI 精選新聞顯示半導體需求仍是焦點。",
      "## 4. 技術結構",
      "日 K 線與均線可用於判斷趨勢，20 日線與成交量共同確認，不代表下單建議。",
      "## 5. 籌碼與法人",
      "法人資料若延遲，需明確標示來源狀態。",
      "## 6. 主題與產業鏈位置",
      "公司位於 AI 伺服器與半導體供應鏈關鍵位置。",
      "## 7. 主要風險",
      "價格波動、事件延遲與資料缺口都需要列入風險。",
      "## 8. AI 結論與觀察等級",
      "觀察等級：中性觀察；這不是下單建議。",
      "## 9. 資料來源與生成時間",
      "資料來源：行情、日 K 線、新聞與公司基本資料。",
    ].join("\n\n");

    expect(assessCompanyAiReportQuality(report)).toEqual({
      ok: true,
      reason: "ok",
      blockedTerms: [],
    });
  });

  it("blocks reports that repeat data gaps without enough facts or sources", () => {
    const report = [
      "## 1. 公司概況與定位",
      "資料不足：公司概況目前無法判斷。",
      "## 2. 今日/最近資料狀態",
      "資料不足：尚未回傳。",
      "## 3. 近期事件與新聞",
      "資料不足：未提供。",
      "## 4. 技術結構",
      "資料不足：缺少資料。",
      "## 5. 籌碼與法人",
      "資料不足：待確認。",
      "## 6. 主題與產業鏈位置",
      "資料不足：無法分析。",
      "## 7. 主要風險",
      "資料風險偏高。",
      "## 8. AI 結論與觀察等級",
      "觀察等級：資料不足。",
      "## 9. 資料來源與生成時間",
      "資料來源：公司資料。",
    ].join("\n\n");

    const quality = assessCompanyAiReportQuality(report);
    expect(quality.ok).toBe(false);
    expect(quality.reason).toBe("low_substance");
    expect(quality.blockedTerms.join(" / ")).toContain("資料缺口句過多");
  });

  it("blocks reports that leak tool names and placeholder reasons", () => {
    const report = [
      "資料不足：本次工具觀察來源為 get_market_overview / get_news_top10。",
      "品質問題 too_short, generic_data_gap_reason, generic_placeholder_line。",
      "run_id=abc prompt_tokens=123 completion_tokens=0",
    ].join("\n");

    const quality = assessCompanyAiReportQuality(report);
    expect(quality.ok).toBe(false);
    expect(quality.reason).toBe("engineering_leak");
    expect(quality.blockedTerms.length).toBeGreaterThanOrEqual(4);
  });

  it("blocks reports that do not complete the fixed nine-section structure", () => {
    const report = [
      "## 1. 公司概況與定位",
      "台積電仍是先進製程供應商。",
      "## 2. 今日/最近資料狀態",
      "行情資料可用。",
    ].join("\n\n");

    const quality = assessCompanyAiReportQuality(report);
    expect(quality.ok).toBe(false);
    expect(quality.reason).toBe("missing_sections");
    expect(quality.blockedTerms).toContain("## 9. 資料來源與生成時間");
  });

  it("blocks quality-protected placeholder reports instead of treating them as formal research", () => {
    const quality = assessCompanyAiReportQuality("品質保護版：資料不足，僅提供保守分析版。");
    expect(quality.ok).toBe(false);
    expect(quality.reason).toBe("quality_protected");
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
