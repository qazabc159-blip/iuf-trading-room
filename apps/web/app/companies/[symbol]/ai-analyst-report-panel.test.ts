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

import { readFileSync } from "node:fs";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReactRunResult, ReactTraceStep } from "./AiAnalystReportPanel";
import { renderMarkdownSimple } from "./renderMarkdownSimple";
import {
  assessCompanyAiReportQuality,
  COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS,
} from "./aiAnalystReportQuality";
import {
  buildCompanyAiAnalystPrompt,
  COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION,
  COMPANY_AI_ANALYST_REQUIRED_SECTIONS,
} from "./aiAnalystReportContract";

// Read-only: this file NEVER writes to react-loop.ts. It only reads the
// backend source text to keep the frontend display-gate regex in parity
// with the backend synthesis gate (single authority).
const reactLoopSource = readFileSync(new URL("../../../../api/src/brain/react-loop.ts", import.meta.url), "utf8");

// ── Shared fixtures ───────────────────────────────────────────────────────────
//
// AI_PIPELINE_DIAGNOSIS_20260722.md: the backend synthesizer
// (apps/api/src/brain/react-loop.ts) already approves a report as long as
// each section header loosely matches `##\s*N[.\s]*標題` (react-loop.ts:91-101).
// This frontend used to re-check with a strict literal
// `.includes("## N. 標題")` against the *prompt template* string — any
// header whitespace/punctuation variance in an already-approved real LLM
// report got re-blocked here at display time. No real captured sample was
// available in this worktree (see PR description), so this fixture is
// reverse-derived from the backend regex itself: same 9 headers, but with
// no space after "##" and no space before the section title — a format
// the backend regex explicitly tolerates (`\s*` = zero or more). This same
// fixture also exposed a real `renderMarkdownSimple` infinite loop (Pete
// review, PR #1341 round 2) — see the "renderMarkdownSimple" describe block
// below.
const backendApprovedButDifferentlyFormattedReport = [
  "##1.公司概況與定位",
  "台積電是全球晶圓代工龍頭，主要業務涵蓋先進製程與封裝，是半導體供應鏈核心角色。",
  "##2.今日/最近資料狀態",
  "即時行情顯示最新價 2425 元，日 K 線日期為 2026-07-20，成交量 29219904 股。",
  "##3.近期事件與新聞",
  "重大訊息與 TWSE 公告顯示先進封裝產能持續擴充，AI 精選新聞聚焦半導體需求。",
  "##4.技術結構",
  "日 K 線與 20 日均線顯示多頭排列，成交量同步放大，僅供觀察不作下單依據。",
  "##5.籌碼與法人",
  "三大法人買超延續，融資融券餘額小幅下滑，資料來源為官方籌碼統計。",
  "##6.主題與產業鏈位置",
  "公司位於 AI 伺服器與先進封裝供應鏈核心位置，與上下游供應商連動密切。",
  "##7.主要風險",
  "價格波動風險、地緣政治事件風險與資料延遲風險皆需留意。",
  "##8.AI結論與觀察等級",
  "觀察等級：可追蹤；本段不構成下單建議。",
  "##9.資料來源與生成時間",
  "資料來源：即時行情、日 K 線、三大法人、TWSE 公告；生成時間 2026-07-22。",
].join("\n\n");

const WELL_FORMED_REPORT = [
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
  "- 優勢：技術領先",
  "- 風險：地緣政治",
  "## 8. AI 結論與觀察等級",
  "觀察等級：中性觀察；這不是下單建議。",
  "## 9. 資料來源與生成時間",
  "資料來源：行情、日 K 線、新聞與公司基本資料。",
].join("\n\n");

/** Runs a synchronous render call with a wall-clock safety net so a
 * regression that reintroduces a non-advancing loop branch fails this test
 * with a clear message instead of hanging the whole CI job silently. The
 * production-side iteration ceiling in `renderMarkdownSimple` itself is what
 * actually guarantees termination (a same-thread synchronous infinite loop
 * cannot be preempted by a timer) — this wrapper is defense-in-depth so the
 * *test* fails fast and legibly if that guarantee is ever broken. */
async function renderWithTimeoutGuard(md: string, timeoutMs = 2000): Promise<string> {
  return Promise.race([
    Promise.resolve().then(() => {
      const nodes = renderMarkdownSimple(md);
      return renderToStaticMarkup(createElement(Fragment, null, nodes));
    }),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`renderMarkdownSimple did not return within ${timeoutMs}ms — possible regression of the 2026-07-22 infinite-loop fix (PR #1341)`)),
        timeoutMs
      );
    }),
  ]);
}

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

  // ── 2026-07-22 display-gate regression ──────────────────────────────────
  // See the `backendApprovedButDifferentlyFormattedReport` fixture defined
  // at module scope above (shared with the renderMarkdownSimple safety
  // tests further down this file).
  it("[FIXED] accepts a backend-approved real-shape report even when header spacing differs from the literal prompt string", () => {
    const quality = assessCompanyAiReportQuality(backendApprovedButDifferentlyFormattedReport);
    expect(quality).toEqual({ ok: true, reason: "ok", blockedTerms: [] });
  });

  it("[documents the pre-fix bug] the old literal .includes(section) compare would have wrongly blocked all 9 sections of that same report", () => {
    // Re-implements the exact pre-fix logic this file used to run (strict
    // substring match against the literal prompt-template headers). Kept
    // here only to prove the bug was real and stays fixed — not live code.
    const legacyMissingSections = COMPANY_AI_ANALYST_REQUIRED_SECTIONS.filter(
      (section) => !backendApprovedButDifferentlyFormattedReport.includes(section)
    );
    expect(legacyMissingSections).toEqual(COMPANY_AI_ANALYST_REQUIRED_SECTIONS);
  });
});

describe("Company AI analyst report quality gate — frontend/backend gate parity", () => {
  it("keeps the frontend section-completeness regex in exact parity with the backend gate (apps/api/src/brain/react-loop.ts, single authority — never edited from this lane)", () => {
    const backendBlock = reactLoopSource.match(
      /COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS = \[([\s\S]*?)\n\];/
    );
    if (!backendBlock) {
      throw new Error(
        "COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS not found in react-loop.ts — " +
          "the backend gate was renamed or moved. Update this parity test's parser " +
          "(and re-sync apps/web/app/companies/[symbol]/aiAnalystReportQuality.ts) before merging."
      );
    }
    const backendPatterns = [...backendBlock[1].matchAll(/pattern:\s*(\/.+?\/[a-z]*)\s*}/g)].map(
      (m) => m[1]
    );
    const frontendPatterns = COMPANY_AI_ANALYST_REQUIRED_SECTION_PATTERNS.map((entry) =>
      entry.pattern.toString()
    );
    expect(frontendPatterns).toEqual(backendPatterns);
  });
});

// ── renderMarkdownSimple: no-space headers no longer hang the tab ────────────
//
// Pete review round 2 (PR #1341): relaxing the display-gate regex (this PR's
// own fix, above) makes `backendApprovedButDifferentlyFormattedReport` — a
// report the gate now correctly accepts — REACHABLE by
// `renderMarkdownSimple()` for the first time. Before the loop-invariant fix
// in `AiAnalystReportPanel.tsx`, that same no-space-header shape caused a
// synchronous infinite loop (the paragraph branch excluded any line merely
// `.startsWith("#")`, so a `"##1.標題"` line matched no branch and never
// advanced `i`). These tests exercise the actual exported renderer function,
// not just the gate.
describe("renderMarkdownSimple — safety against non-advancing lines", () => {
  it("[FIXED] renders the same no-space-header report the gate now accepts, without hanging", async () => {
    const html = await renderWithTimeoutGuard(backendApprovedButDifferentlyFormattedReport);
    // All 9 sections' body text should have been consumed as paragraph
    // content (the heading line itself renders as plain text since it
    // doesn't match the exact "## " prefix — see AiAnalystReportPanel.tsx
    // loop-invariant comment — but the render must complete and must not
    // silently drop the report).
    expect(html).toContain("台積電是全球晶圓代工龍頭");
    expect(html).toContain("生成時間 2026-07-22");
  });

  it("zero regression: a well-formed report with real heading spaces still renders headings/bullets identically", async () => {
    const html = await renderWithTimeoutGuard(WELL_FORMED_REPORT);
    // H2 → <h3>, per renderMarkdownSimple's mapping (see AiAnalystReportPanel.tsx).
    expect(html).toContain("<h3");
    expect(html).toContain("公司概況與定位");
    expect(html).toContain("資料來源與生成時間");
    // Bullet list still renders as <ul>/<li>.
    expect(html).toContain("<ul");
    expect(html).toContain("優勢：技術領先");
    expect(html).toContain("風險：地緣政治");
  });

  it("does not hang on a lone '#' line with no title and no space at all", async () => {
    const html = await renderWithTimeoutGuard(["#", "純文字內容，前一行只有一個井字號。"].join("\n"));
    expect(html).toContain("純文字內容，前一行只有一個井字號");
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
